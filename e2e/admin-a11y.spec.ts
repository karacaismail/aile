import { test, expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ADMIN_MAIN, openAdmin } from './admin-helpers';

// Yönetim paneli erişilebilirlik kapısı (f10-a11y). İki katman:
//  1. axe-core (@axe-core/playwright) — etiketler wcag2a, wcag2aa, wcag21aa, wcag22aa. Her rota ilk görünümde tüm
//     belgeyle taranır; açık katmanlar (Sayfalar çekmecesi, "Diğer" alt sayfası, Filtreler çekmecesi, Select alt sayfası,
//     sayfa diyalogları) katmanın kendisiyle sınırlı taranır (arkadaki örtü kontrast ölçümünü bozmasın). Modal olmayan
//     geniş açılır listeler/menüler tüm belgeyle taranır ve yalnız kapalı görünümde olmayan yeni ihlaller sayılır.
//     axe otomatik ve KISMİ bir kanıttır: WCAG başarı ölçütlerinin bir bölümünü makineyle denetler, tam uyum kanıtı
//     değildir. Ekran okuyucuyla (VoiceOver/TalkBack/NVDA) elle kontrol bu kapının dışındadır (not_run).
//  2. Yapı — Playwright ARIA snapshot (locator.ariaSnapshotJSON): landmark'lar (dar kabukta tek banner + içinde
//     "Sayfalar" düğmesi, tek main; masaüstünde main dışında tek navigation "Sayfalar"; Sayfalar çekmecesinde
//     navigation "Sayfalar"), tüm içerik landmark/diyalog içinde (atlama bağlantısı hariç), aynı rolden birden çok
//     landmark ayrı adla, tek h1 ve main içinde, h1'den önce başlık yok, başlık sırası seviye atlamaz, her form alanı ve
//     etkileşimli öğe adlı, diyalog adlı; kip sözleşmesi: modal katman aria-modal="true", kipsiz yan panel (masaüstü
//     ayrıntı, DetailPanel inline) aria-modal taşımaz ve arkasındaki sonuç bölgesi inert/aria-hidden olmaz.
// Projeler: görev koşusu chromium (320×568, telefon profili) ve webkit (390×844, telefon profili). İlk görünüm axe ve
// yapı testleri @matrix etiketlidir (entegrasyonda 360/375/320×480/568×320/tablet/masaüstü). Geniş görünüm modları
// (Ödemeler Zaman çizelgesi, Projeler Kanban/Gantt) yapı testi görünüm alanını kendisi kurar (tablet ve masaüstü).
// Emülasyon gerçek cihaz değildir. Sabit bekleme yok: hazır sinyali openAdmin, katman yerleşmesi animasyon/kutu/
// opaklık kararlılığı.
// Öz denetim en altta: bilinçli enjekte edilen ihlaller yakalanmazsa kapı FAIL olur (axe etiketleri, katman kapsamı,
// yapı dedektörü bilinen belgelerde ve gerçek sayfada, kip denetimi bilinen belgelerde).

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'];

/** navigation.ts adminPages sırası + Ayarlar (diğer admin kapılarıyla aynı 13 rota). */
const ROUTES = [
  '/genel', '/butce', '/odemeler', '/hesaplar', '/emeklilik', '/alimlar', '/ev',
  '/projeler', '/taraflar', '/raporlar', '/sozlukler', '/veri', '/ayarlar',
] as const;

/** Sayfaya özgü diyalog tetikleri (birincil eylem diyalog açar). Devre dışıysa not düşülür. */
const PAGE_DIALOGS: Partial<Record<(typeof ROUTES)[number], readonly string[]>> = {
  '/hesaplar': ['Hesap ekle'],
  '/sozlukler': ['Terim ekle'],
};

/**
 * Sayfaya özgü ayrıntı katmanı: sentetik nesildeki bilinen kayıt (fixtures/generation-synthetic › purchase_needs,
 * "Örnek kase"). İkisi de role="dialog" ve kayıt adıyla adlı; kip profile göre (DetailPanel sözleşmesi): telefon ve
 * tablette tam sayfa modal katman (aria-modal), masaüstünde liste yanında akışta kipsiz yan panel (DetailPanel inline,
 * alimlar/AlimlarGenis.wide): aria-modal yok, sonuç bölgesi arkada erişilebilir kalır, Escape yine kapatır.
 */
const PAGE_DETAILS: Partial<Record<(typeof ROUTES)[number], { region: string; row: string; modal: (profile: Profile) => boolean }>> = {
  '/alimlar': { region: 'Sonuçlar', row: 'Örnek kase', modal: (profile) => profile !== 'desktop' },
};

/** Açık katmanlarda en çok bu kadar Select açılır (her biri ayrı alt sayfa/liste). */
const MAX_SELECTS = 4;

type Profile = 'phone' | 'tablet' | 'desktop';
type AxeResults = Awaited<ReturnType<AxeBuilder['analyze']>>;
type AxeViolation = AxeResults['violations'][number];

// --- Ortak yardımcılar -----------------------------------------------------------------------------------------------

/**
 * Ağ yalıtımı: nesil webServer'ın sentetik klasöründen gelir (AILE_GENERATION_DIR); canlı GViz ve diğer Google uçları
 * kesilir, hiçbir istek internete çıkmaz (fetch stub). /butce bu yüzden "Canlı Sheet" bölgesini hata durumunda gösterir;
 * o durum da taranır.
 */
test.beforeEach(async ({ page }) => {
  for (const pattern of ['https://docs.google.com/**', 'https://*.googleapis.com/**', 'https://*.google.com/**', 'https://*.gstatic.com/**']) {
    await page.route(pattern, (route) => route.abort('blockedbyclient'));
  }
});

async function profileOf(page: Page): Promise<Profile> {
  const value = await page.evaluate(() => document.documentElement.getAttribute('data-profile')
    ?? document.querySelector('[data-profile]')?.getAttribute('data-profile') ?? '');
  if (value === 'phone' || value === 'tablet' || value === 'desktop') return value;
  throw new Error(`data-profile okunamadı: "${value}"`);
}

let settleProbe = 0;

/**
 * Yazı tipleri yüklenmiş, sonlu animasyon/geçiş kalmamış ve (hedef verildiyse) hedefin kutusu ile opaklığı üç ardışık
 * karede değişmemiş olana kadar bekler. Sabit bekleme değildir; sonsuz yükleme şeridi beklenmez.
 */
async function settle(page: Page, target?: Locator) {
  await page.evaluate(async () => { await document.fonts.ready; });
  const element = target ? await target.elementHandle() : null;
  const key = `__aileA11ySettle${++settleProbe}`;
  await page.waitForFunction(({ el, key: k }) => {
    const w = window as unknown as Record<string, { sig: string; n: number } | undefined>;
    const running = document.getAnimations().some((a) => a.playState === 'running'
      && Number.isFinite(Number(a.effect?.getComputedTiming().endTime ?? 0)));
    let sig = 'idle';
    let opaque = true;
    if (el) {
      const r = (el as Element).getBoundingClientRect();
      let opacity = 1;
      for (let n: Element | null = el as Element; n; n = n.parentElement) opacity *= Number(getComputedStyle(n).opacity);
      opaque = opacity > 0.999;
      sig = `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}`;
    }
    if (running || !opaque) { w[k] = undefined; return false; }
    const prev = w[k];
    w[k] = prev && prev.sig === sig ? { sig, n: prev.n + 1 } : { sig, n: 1 };
    return (w[k]?.n ?? 0) >= 3;
  }, { el: element, key }, { timeout: 10_000, polling: 'raf' });
  await element?.dispose();
}

async function openRoute(page: Page, route: string) {
  await openAdmin(page, route);
  await settle(page);
}

// --- axe -------------------------------------------------------------------------------------------------------------

async function axeRun(page: Page, include?: string): Promise<AxeResults> {
  let builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);
  if (include) builder = builder.include(include);
  return builder.analyze();
}

const nodeKey = (id: string, target: unknown) => `${id}|${JSON.stringify(target)}`;

function formatViolation(v: AxeViolation): string {
  const wcag = v.tags.filter((t) => /^wcag\d/.test(t)).join(',');
  const nodes = v.nodes.slice(0, 4).map((n) => {
    const reason = (n.failureSummary ?? '').split('\n').slice(1).join(' ').replace(/\s+/g, ' ').trim();
    return `${n.target.join(' ')} :: ${n.html.replace(/\s+/g, ' ').slice(0, 140)}${reason ? ` → ${reason.slice(0, 160)}` : ''}`;
  });
  const more = v.nodes.length > 4 ? ` (+${v.nodes.length - 4} öğe)` : '';
  return `${v.id} [${v.impact ?? 'etki yok'}; ${wcag}] ${v.help}: ${nodes.join(' | ')}${more}`;
}

/** Kapalı görünümde zaten raporlanan (kural, hedef) çiftlerini çıkarır; açık katmanın getirdiği yeni ihlaller kalır. */
function onlyNew(violations: readonly AxeViolation[], baseline: ReadonlySet<string>): AxeViolation[] {
  return violations
    .map((v) => ({ ...v, nodes: v.nodes.filter((n) => !baseline.has(nodeKey(v.id, n.target))) }))
    .filter((v) => v.nodes.length > 0);
}

const violationKeys = (violations: readonly AxeViolation[]) =>
  new Set(violations.flatMap((v) => v.nodes.map((n) => nodeKey(v.id, n.target))));

const SCOPE_ATTR = 'data-a11y-kapsam';

/** Katmanı geçici bir öznitelikle işaretler (axe include seçicisi), işi yapar, işareti kaldırır. */
async function withScope<T>(target: Locator, work: (selector: string) => Promise<T>): Promise<T> {
  await target.evaluate((el, attr) => el.setAttribute(attr, ''), SCOPE_ATTR);
  try {
    return await work(`[${SCOPE_ATTR}]`);
  } finally {
    await target.evaluate((el, attr) => el.removeAttribute(attr), SCOPE_ATTR).catch(() => undefined);
  }
}

// --- ARIA snapshot yapı dedektörü ------------------------------------------------------------------------------------

interface AriaNode {
  role: string;
  name?: string;
  text?: string;
  level?: number;
  url?: string;
  children?: (AriaNode | string)[];
}

interface Flat { node: AriaNode; ancestors: AriaNode[] }

const LANDMARKS = new Set(['banner', 'navigation', 'main', 'complementary', 'contentinfo', 'region', 'search', 'form']);
const DIALOGS = new Set(['dialog', 'alertdialog']);
/** Üst düzeyde landmark dışında durabilenler: diyaloglar ve canlı bölgeler (atlama bağlantısı ayrıca). */
const TOP_LEVEL_OK = new Set([...LANDMARKS, ...DIALOGS, 'status', 'alert', 'log']);
const FIELDS = new Set(['textbox', 'searchbox', 'combobox', 'listbox', 'checkbox', 'radio', 'radiogroup', 'switch', 'spinbutton', 'slider']);
const CONTROLS = new Set(['button', 'link', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'treeitem']);

async function ariaTree(locator: Locator): Promise<AriaNode[]> {
  const json = (await locator.ariaSnapshotJSON()) as unknown;
  const list = (Array.isArray(json) ? json : [json]) as (AriaNode | string)[];
  return list.map((item) => (typeof item === 'string' ? { role: 'text', text: item } : item));
}

function flatten(roots: readonly AriaNode[]): Flat[] {
  const out: Flat[] = [];
  const walk = (items: readonly (AriaNode | string)[], ancestors: AriaNode[]) => {
    for (const item of items) {
      if (typeof item === 'string') {
        if (item.trim()) out.push({ node: { role: 'text', text: item }, ancestors });
        continue;
      }
      out.push({ node: item, ancestors });
      if (item.children) walk(item.children, [...ancestors, item]);
    }
  };
  walk(roots, []);
  return out;
}

const hasName = (node: AriaNode) => Boolean(node.name && node.name.trim());
const label = (node: AriaNode) => {
  const text = node.name ?? node.text ?? '';
  const short = text.length > 60 ? `${text.slice(0, 57)}...` : text;
  return `${node.role}${node.level ? ` h${node.level}` : ''}${short ? ` "${short}"` : ''}`;
};
const where = (f: Flat) => {
  const chain = f.ancestors.filter((a) => LANDMARKS.has(a.role) || DIALOGS.has(a.role)).map(label);
  return chain.length ? ` (${chain.join(' › ')} içinde)` : ' (landmark dışında)';
};
const isSkipLink = (node: AriaNode) => node.role === 'link' && /#admin-content$/.test(node.url ?? '');
const contains = (root: AriaNode, match: (n: AriaNode) => boolean): boolean =>
  (root.children ?? []).some((c) => typeof c !== 'string' && (match(c) || contains(c, match)));

/** Başlık listesinde seviye atlaması (önceki seviye + 1'den büyük artış). */
function headingOrderViolations(headings: readonly Flat[], scope: string): string[] {
  const out: string[] = [];
  for (const h of headings) if (!h.node.level) out.push(`${scope}: seviyesiz başlık ${label(h.node)}`);
  for (let i = 1; i < headings.length; i += 1) {
    const prev = headings[i - 1]!.node;
    const cur = headings[i]!.node;
    if (prev.level && cur.level && cur.level > prev.level + 1) {
      out.push(`${scope}: başlık sırası atlıyor ${label(prev)} → ${label(cur)}`);
    }
  }
  return out;
}

/** Form alanları ve etkileşimli öğeler adlı olmalı. */
function nameViolations(nodes: readonly Flat[]): string[] {
  const out: string[] = [];
  for (const f of nodes) {
    if (FIELDS.has(f.node.role) && !hasName(f.node)) out.push(`adsız form alanı: ${label(f.node)}${where(f)}`);
    if (CONTROLS.has(f.node.role) && !hasName(f.node)) out.push(`adsız etkileşimli öğe: ${label(f.node)}${where(f)}`);
  }
  return out;
}

/**
 * Sayfa yapısı (diyaloglar hariç): landmark'lar, landmark dışı içerik, tek h1, başlık sırası, adlar. Boş liste = temiz.
 * Dar kabuk (phone/tablet): tek banner (üst bar) ve içinde "Sayfalar" düğmesi; gezinme landmark'ı çekmecede.
 * Masaüstü: main dışında tek navigation "Sayfalar"; banner en çok bir.
 */
function pageStructureViolations(roots: readonly AriaNode[], profile: Profile): string[] {
  const out: string[] = [];
  const all = flatten(roots);
  const page = all.filter((f) => !DIALOGS.has(f.node.role) && !f.ancestors.some((a) => DIALOGS.has(a.role)));
  const landmarkAncestor = (f: Flat) => f.ancestors.find((a) => LANDMARKS.has(a.role));

  const mains = page.filter((f) => f.node.role === 'main');
  if (mains.length !== 1) out.push(`main landmark sayısı ${mains.length} (tam 1 olmalı)`);
  for (const m of mains) {
    const outer = landmarkAncestor(m);
    if (outer) out.push(`main üst düzeyde değil: ${label(outer)} içinde`);
  }

  const banners = page.filter((f) => f.node.role === 'banner');
  if (profile !== 'desktop') {
    if (banners.length !== 1) out.push(`banner (üst bar) sayısı ${banners.length}; dar kabukta tam 1 olmalı`);
    else if (!contains(banners[0]!.node, (n) => n.role === 'button' && n.name === 'Sayfalar')) {
      out.push('banner içinde "Sayfalar" düğmesi yok');
    }
  } else if (banners.length > 1) {
    out.push(`banner sayısı ${banners.length} (en çok 1)`);
  }
  for (const b of banners) {
    const outer = landmarkAncestor(b);
    if (outer) out.push(`banner üst düzeyde değil: ${label(outer)} içinde`);
  }

  if (profile === 'desktop') {
    const nav = page.filter((f) => f.node.role === 'navigation' && f.node.name === 'Sayfalar');
    if (nav.length !== 1) out.push(`navigation "Sayfalar" sayısı ${nav.length}; masaüstünde tam 1 olmalı`);
    for (const n of nav) if (n.ancestors.some((a) => a.role === 'main')) out.push('navigation "Sayfalar" main içinde');
  }

  const byRole = new Map<string, Flat[]>();
  for (const f of page) {
    if (!LANDMARKS.has(f.node.role) || f.node.role === 'main') continue;
    byRole.set(f.node.role, [...(byRole.get(f.node.role) ?? []), f]);
  }
  for (const [role, list] of byRole) {
    if (list.length < 2) continue;
    const names = list.map((f) => (f.node.name ?? '').trim());
    if (names.some((n) => !n) || new Set(names).size !== names.length) {
      out.push(`aynı rolden ${list.length} landmark ayırt edici adla değil: ${role} [${names.map((n) => n || '(adsız)').join(', ')}]`);
    }
  }

  for (const item of roots) {
    if (TOP_LEVEL_OK.has(item.role) || isSkipLink(item)) continue;
    if (item.role === 'text' && !(item.text ?? '').trim()) continue;
    out.push(`landmark dışında içerik: ${label(item)}`);
  }

  const headings = page.filter((f) => f.node.role === 'heading');
  const h1s = headings.filter((h) => h.node.level === 1);
  if (h1s.length !== 1) out.push(`h1 sayısı ${h1s.length} (tam 1 olmalı)${h1s.length ? `: ${h1s.map((h) => label(h.node)).join(', ')}` : ''}`);
  for (const h of h1s) {
    if (!h.ancestors.some((a) => a.role === 'main')) out.push(`h1 main dışında: ${label(h.node)}${where(h)}`);
    if (!hasName(h.node)) out.push('h1 boş');
  }
  const firstH1 = headings.findIndex((h) => h.node.level === 1);
  if (firstH1 > 0) out.push(`h1'den önce başlık: ${headings.slice(0, firstH1).map((h) => label(h.node)).join(', ')}`);
  out.push(...headingOrderViolations(headings, 'sayfa'));

  out.push(...nameViolations(page));
  return out;
}

interface DialogExpectation { navigation?: string }

/** Diyalog yapısı: rol ve ad, içindeki başlık sırası ve adlar, beklenen gezinme landmark'ı. */
function dialogStructureViolations(roots: readonly AriaNode[], expected: DialogExpectation = {}): string[] {
  const out: string[] = [];
  const all = flatten(roots);
  const dialogs = all.filter((f) => DIALOGS.has(f.node.role));
  if (dialogs.length === 0) out.push('dialog/alertdialog rolü yok');
  for (const d of dialogs) if (!hasName(d.node)) out.push(`adsız diyalog: ${label(d.node)}`);
  const headings = all.filter((f) => f.node.role === 'heading');
  out.push(...headingOrderViolations(headings, 'diyalog'));
  out.push(...nameViolations(all));
  if (expected.navigation) {
    const nav = all.filter((f) => f.node.role === 'navigation' && f.node.name === expected.navigation);
    if (nav.length !== 1) out.push(`diyalogda navigation "${expected.navigation}" sayısı ${nav.length} (tam 1 olmalı)`);
  }
  return out;
}

async function attachAria(testInfo: TestInfo, name: string, locator: Locator) {
  const yaml = await locator.ariaSnapshot().catch((error: Error) => `ariaSnapshot alınamadı: ${error.message}`);
  await testInfo.attach(name, { body: yaml, contentType: 'text/yaml' });
}

const slug = (text: string) => text.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').toLowerCase();

// --- Katman denetimi -------------------------------------------------------------------------------------------------

interface ModalAudit {
  state: string;
  /** Verilmezse katman zaten açıktır. */
  trigger?: Locator;
  dialog: Locator;
  expected?: DialogExpectation;
  /** Beklenen kip; varsayılan modal. false: kipsiz yan panel (aria-modal yok, arka plan erişilebilir). */
  modal?: boolean;
  /** Kipsiz katmanda arkada erişilebilir kalması gereken öğe (ör. sonuç bölgesi). */
  background?: Locator;
}

/**
 * Kip sözleşmesi (APG dialog). Modal: aria-modal="true" ya da :modal <dialog>. Kipsiz: aria-modal yok, açık modal
 * <dialog> yok ve verilen arka plan öğesi inert/aria-hidden bir alt ağaçta değil. Boş liste = temiz.
 */
async function modalityViolations(dialog: Locator, modal: boolean, background?: Locator): Promise<string[]> {
  const claimsModal = await dialog.evaluate((el) => el.getAttribute('aria-modal') === 'true'
    || (el instanceof HTMLDialogElement && el.matches(':modal')));
  if (modal) return claimsModal ? [] : ['modal katmanda aria-modal="true" yok (APG modal diyalog)'];
  const out: string[] = [];
  if (claimsModal) out.push('kipsiz yan panel aria-modal="true" bildiriyor (arka plan erişilebilir kalmalı)');
  if (background) {
    const blocked = await background.first().evaluate((el) => {
      const hidden = el.closest('[inert], [aria-hidden="true"]');
      if (hidden) return `${hidden.tagName.toLowerCase()}${hidden.hasAttribute('inert') ? '[inert]' : '[aria-hidden="true"]'}`;
      const top = Array.from(document.querySelectorAll('dialog')).find((d) => d.matches(':modal') && !d.contains(el));
      return top ? 'açık modal <dialog> arka planı inert yapıyor' : '';
    });
    if (blocked) out.push(`kipsiz yan panel açıkken arka plan erişilemez: ${blocked}`);
  }
  return out;
}

/** Katmanı açar, yerleşince katman kapsamında axe + yapı + kip (modal/kipsiz) denetler, Escape ile kapatır. */
async function auditModal(page: Page, testInfo: TestInfo, audit: ModalAudit) {
  if (audit.trigger) await audit.trigger.click();
  const dialog = audit.dialog.first();
  await expect(dialog, `${audit.state}: katman açılmadı`).toBeVisible();
  await settle(page, dialog);

  const violations = await withScope(dialog, (selector) => axeRun(page, selector));
  expect.soft(violations.violations.map(formatViolation), `${audit.state}: axe ihlalleri (katman kapsamı)`).toEqual([]);

  const structure = dialogStructureViolations(await ariaTree(dialog), audit.expected);
  structure.push(...await modalityViolations(dialog, audit.modal ?? true, audit.background));
  if (structure.length) await attachAria(testInfo, `${slug(audit.state)}-aria.yaml`, dialog);
  expect.soft(structure, `${audit.state}: yapı (ARIA snapshot)`).toEqual([]);

  await page.keyboard.press('Escape');
  const closedByEscape = await expect(dialog).toBeHidden({ timeout: 3_000 }).then(() => true, () => false);
  expect.soft(closedByEscape, `${audit.state}: Escape katmanı kapatmadı`).toBe(true);
  if (!closedByEscape) {
    await dialog.getByRole('button', { name: 'Kapat', exact: true }).first().click();
    await expect(dialog).toBeHidden();
  }
  await settle(page);
}

interface PopupAudit {
  state: string;
  /** Verilmezse katman zaten açıktır. */
  trigger?: Locator;
  /** Açık olduğunun kanıtı (geniş Select: aria-expanded; menü: role=menu görünür). */
  opened: () => Promise<void>;
  closed: () => Promise<void>;
  /** Yerleşme hedefi (varsa). */
  popup?: () => Promise<Locator | null>;
  /** Kapatma eylemi; verilmezse Escape (APG açılır liste/menü). */
  close?: () => Promise<void>;
  baseline: ReadonlySet<string>;
}

/** Modal olmayan açılır katman: tüm belge taranır, yalnız kapalı görünümde olmayan ihlaller sayılır. */
async function auditPopup(page: Page, audit: PopupAudit) {
  if (audit.trigger) await audit.trigger.click();
  await audit.opened();
  const popup = audit.popup ? await audit.popup() : null;
  await settle(page, popup ?? undefined);
  const fresh = onlyNew((await axeRun(page)).violations, audit.baseline);
  expect.soft(fresh.map(formatViolation), `${audit.state}: açıkken yeni axe ihlalleri`).toEqual([]);
  if (popup) {
    // Katmanın içindeki alan ve seçenekler adlı olmalı. Kökün (açılır liste/menü) adı tetikleyiciden gelir
    // (adlı combobox/düğme + aria-controls); kök adını axe aria-input-field-name denetler, burada yinelenmez.
    const inner = (await ariaTree(popup)).flatMap((root) => root.children ?? []);
    const names = nameViolations(flatten(inner.map((c) => (typeof c === 'string' ? { role: 'text', text: c } : c))));
    expect.soft(names, `${audit.state}: adsız alan/öğe (ARIA snapshot)`).toEqual([]);
  }
  if (audit.close) await audit.close();
  else await page.keyboard.press('Escape');
  await audit.closed();
  await settle(page);
}

async function visibleEnabledComboboxes(page: Page): Promise<number[]> {
  const combos = page.getByRole('combobox').filter({ visible: true });
  const count = await combos.count();
  const out: number[] = [];
  for (let i = 0; i < count && out.length < MAX_SELECTS; i += 1) {
    if (await combos.nth(i).isEnabled()) out.push(i);
  }
  return out;
}

// --- Testler ---------------------------------------------------------------------------------------------------------

test.describe('axe: WCAG 2.0/2.1/2.2 A ve AA (otomatik, kısmi kanıt)', () => {
  for (const route of ROUTES) {
    test(`${route}: ilk görünümde ihlal yok`, { tag: '@matrix' }, async ({ page }, testInfo) => {
      await openRoute(page, route);
      const profile = await profileOf(page);
      const results = await axeRun(page);
      testInfo.annotations.push({
        type: 'axe',
        description: `${route} (${profile}): ${results.passes.length} kural geçti, ${results.incomplete.length} kural elle inceleme istiyor `
          + `(${results.incomplete.map((r) => r.id).join(', ') || 'yok'}), ${results.violations.length} ihlal. axe tam WCAG uyum kanıtı değildir.`,
      });
      expect(results.passes.length, 'axe hiçbir kuralı geçirmedi: tarama boş').toBeGreaterThan(0);
      expect(results.violations.map(formatViolation), `${route} ilk görünüm (${profile})`).toEqual([]);
    });

    test(`${route}: açık alt sayfa, diyalog ve çekmecelerde ihlal yok`, async ({ page }, testInfo) => {
      test.setTimeout(120_000);
      await openRoute(page, route);
      const profile = await profileOf(page);
      const baseline = violationKeys((await axeRun(page)).violations);
      const covered: string[] = [];

      if (profile !== 'desktop') {
        await auditModal(page, testInfo, {
          state: `${route} Sayfalar çekmecesi`,
          trigger: page.getByRole('button', { name: 'Sayfalar', exact: true }),
          dialog: page.getByRole('dialog', { name: 'Sayfalar', exact: true }),
          expected: { navigation: 'Sayfalar' },
        });
        covered.push('Sayfalar çekmecesi');
      }

      const more = page.getByRole('button', { name: 'Diğer', exact: true }).filter({ visible: true });
      if ((await more.count()) > 0) {
        if (profile === 'phone') {
          await auditModal(page, testInfo, {
            state: `${route} Diğer eylemler alt sayfası`,
            trigger: more.first(),
            dialog: page.getByRole('dialog', { name: 'Diğer eylemler', exact: true }),
          });
        } else {
          const menu = page.getByRole('menu', { name: 'Diğer eylemler' });
          await auditPopup(page, {
            state: `${route} Diğer eylemler menüsü`,
            trigger: more.first(),
            opened: () => expect(menu).toBeVisible(),
            closed: () => expect(menu).toBeHidden(),
            popup: async () => menu,
            baseline,
          });
        }
        covered.push('Diğer eylemler');
      }

      // Filtreler: dar kabukta "Filtreler (N)" modal çekmece açar (b03 FilterDrawer); masaüstünde FilterArea şeridi
      // ("Filtreleri göster") aynı sayfadaki "Filtreler" bölgesini genişletir (modal değil, Escape kapatmaz; "Paneli gizle").
      const filters = page.getByRole('button', { name: /^Filtreler/ }).filter({ visible: true });
      if ((await filters.count()) > 0) {
        const trigger = filters.first();
        const controls = await trigger.getAttribute('aria-controls');
        const drawer = page.getByRole('dialog', { name: /^Filtreler/ }).filter({ visible: true });
        const inline = controls ? page.locator(`[id="${controls}"][role="region"]`) : null;
        await trigger.click();
        const shown = { kind: '' as '' | 'dialog' | 'inline' };
        await expect.poll(async () => {
          if ((await drawer.count()) > 0) shown.kind = 'dialog';
          else if (inline && (await inline.isVisible())) shown.kind = 'inline';
          return shown.kind;
        }, { message: `${route} Filtreler: ne çekmece ne de satır içi bölge açıldı` }).not.toBe('');
        if (shown.kind === 'dialog') {
          await auditModal(page, testInfo, { state: `${route} Filtreler çekmecesi`, dialog: drawer });
          covered.push('Filtreler çekmecesi');
        } else if (inline) {
          await auditPopup(page, {
            state: `${route} Filtreler bölgesi (satır içi)`,
            opened: () => expect(inline).toBeVisible(),
            closed: () => expect(inline).toBeHidden(),
            popup: async () => inline,
            close: () => inline.getByRole('button', { name: 'Paneli gizle', exact: true }).click(),
            baseline,
          });
          covered.push('Filtreler bölgesi');
        }
      }

      for (const index of await visibleEnabledComboboxes(page)) {
        const combo = page.getByRole('combobox').filter({ visible: true }).nth(index);
        const name = (await combo.evaluate((el) => {
          const labelled = el.getAttribute('aria-labelledby');
          const byId = labelled ? labelled.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ') : '';
          return el.getAttribute('aria-label') || byId || (el as HTMLInputElement).labels?.[0]?.textContent || '';
        })).trim();
        const state = `${route} Select "${name || `#${index + 1}`}"`;
        // Seçimin hangi katmanla açılacağı (alt sayfa ya da kontrolün altında liste) f08-sheets/a03/a07 sözleşmesidir;
        // bu kapı açılan katman hangisiyse onun erişilebilirliğini denetler.
        await combo.click();
        const sheet = page.getByRole('dialog').filter({ visible: true });
        const opened = { kind: '' as '' | 'sheet' | 'list' };
        await expect.poll(async () => {
          if ((await sheet.count()) > 0) opened.kind = 'sheet';
          else if ((await combo.getAttribute('aria-expanded')) === 'true') opened.kind = 'list';
          return opened.kind;
        }, { message: `${state}: seçim katmanı açılmadı (alt sayfa ya da liste)` }).not.toBe('');
        if (opened.kind === 'sheet') {
          await auditModal(page, testInfo, { state: `${state} alt sayfası`, dialog: sheet.last() });
        } else {
          if (profile === 'phone') {
            testInfo.annotations.push({ type: 'gözlem', description: `${state}: telefonda alt sayfa yerine kontrolün altında liste açıldı` });
          }
          await auditPopup(page, {
            state: `${state} açık liste`,
            opened: () => expect(combo).toHaveAttribute('aria-expanded', 'true'),
            closed: () => expect(combo).not.toHaveAttribute('aria-expanded', 'true'),
            popup: async () => {
              const controls = await combo.getAttribute('aria-controls');
              return controls ? page.locator(`[id="${controls}"]`) : null;
            },
            baseline,
          });
        }
        covered.push(`Select "${name || `#${index + 1}`}"`);
      }

      for (const trigger of PAGE_DIALOGS[route] ?? []) {
        const button = page.getByRole('button', { name: trigger, exact: true }).filter({ visible: true }).first();
        if (!(await button.isEnabled())) {
          testInfo.annotations.push({ type: 'not_run', description: `${route} "${trigger}" diyaloğu: düğme devre dışı (veri durumu)` });
          continue;
        }
        await auditModal(page, testInfo, {
          state: `${route} ${trigger} diyaloğu`,
          trigger: button,
          dialog: page.getByRole('dialog', { name: trigger, exact: true }),
        });
        covered.push(`${trigger} diyaloğu`);
      }

      const detail = PAGE_DETAILS[route];
      if (detail) {
        const row = page.getByRole('region', { name: detail.region }).getByRole('button', { name: new RegExp(detail.row) }).first();
        if ((await row.count()) === 0) {
          testInfo.annotations.push({ type: 'not_run', description: `${route} ayrıntı: "${detail.row}" satırı yok (veri durumu)` });
        } else {
          const modal = detail.modal(profile);
          const kind = modal ? 'modal' : 'kipsiz yan panel';
          await auditModal(page, testInfo, {
            state: `${route} ayrıntı "${detail.row}" (${kind})`,
            trigger: row,
            dialog: page.getByRole('dialog', { name: detail.row, exact: true }),
            modal,
            // includeHidden: arka plan aria-hidden olsa da bulunur ve ihlal olarak yazılır (zaman aşımı değil).
            background: modal ? undefined : page.locator(ADMIN_MAIN).getByRole('region', { name: detail.region, includeHidden: true }),
          });
          covered.push(`ayrıntı "${detail.row}" (${kind})`);
        }
      }

      testInfo.annotations.push({ type: 'kapsam', description: `${route} (${profile}): ${covered.join(', ') || 'açılır katman yok'}` });
    });
  }
});

test.describe('yapı: landmark, tek h1, başlık sırası, form alanı adları (ARIA snapshot)', () => {
  for (const route of ROUTES) {
    test(`${route}: yapı sözleşmesi`, { tag: '@matrix' }, async ({ page }, testInfo) => {
      await openRoute(page, route);
      const profile = await profileOf(page);
      const body = page.locator('body');
      const found = pageStructureViolations(await ariaTree(body), profile);
      if (found.length) await attachAria(testInfo, `${slug(route)}-aria.yaml`, body);
      expect(found, `${route} (${profile}) yapı`).toEqual([]);
    });
  }
});

/**
 * Geniş görünüm modları: sorgu çubuğunun görünüm modu (segment radyosu) ilk görünüm dışındaki sunumu getirir; o sunumun
 * başlıkları (Zaman çizelgesi ayları, Kanban sütunları, Gantt "Tarihsiz", tablet akordeon grupları h3) sayfanın başlık
 * sırasına uyar. Görünüm alanı testte kurulur (tablet 820×1180, masaüstü 1440×900): görev projelerinde de koşar.
 */
const WIDE_MODES: readonly { route: (typeof ROUTES)[number]; modes: readonly string[] }[] = [
  { route: '/odemeler', modes: ['Tablo', 'Zaman çizelgesi'] },
  { route: '/projeler', modes: ['Tablo', 'Kanban', 'Gantt'] },
];
const WIDE_SIZES = [
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'masaüstü', width: 1440, height: 900 },
] as const;

test.describe('yapı: geniş görünüm modları başlık sırasını ve landmark sözleşmesini korur', () => {
  for (const { route, modes } of WIDE_MODES) {
    for (const size of WIDE_SIZES) {
      test(`${route} ${size.name} ${size.width}×${size.height}: ${modes.join(' · ')}`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width: size.width, height: size.height });
        await openRoute(page, route);
        const profile = await profileOf(page);
        expect(profile, 'görünüm alanı profili').toBe(size.name === 'tablet' ? 'tablet' : 'desktop');
        const modeGroup = page.locator(ADMIN_MAIN).getByRole('radiogroup', { name: 'Görünüm modu' });
        const found: string[] = [];
        for (const mode of modes) {
          const radio = modeGroup.getByRole('radio', { name: mode, exact: true });
          // Segment radyosu görsel gizli olabilir; etiketine basılır (birim testleriyle aynı yol).
          await modeGroup.getByText(mode, { exact: true }).click();
          await expect(radio).toHaveAttribute('aria-checked', 'true');
          await settle(page);
          const violations = pageStructureViolations(await ariaTree(page.locator('body')), profile);
          if (violations.length) await attachAria(testInfo, `${slug(route)}-${slug(size.name)}-${slug(mode)}-aria.yaml`, page.locator('body'));
          found.push(...violations.map((v) => `${mode}: ${v}`));
        }
        expect(found, `${route} (${profile}) geniş modlar yapı`).toEqual([]);
      });
    }
  }
});

// --- Öz denetim ------------------------------------------------------------------------------------------------------

const GOOD_NARROW = `
  <a href="#admin-content">İçeriğe geç</a>
  <header><p>aile · Genel durum</p><button type="button" aria-haspopup="dialog">Sayfalar</button></header>
  <main id="admin-content" tabindex="-1">
    <h1>Genel durum</h1><p>Amaç</p>
    <h2>Özet</h2><h3>Ayrıntı</h3><h2>Liste</h2>
    <label>Ara <input type="search"></label>
    <div role="combobox" aria-label="Dönem" aria-expanded="false" tabindex="0">Ekim</div>
    <button type="button">Yenile</button>
  </main>`;

const GOOD_DESKTOP = `
  <a href="#admin-content">İçeriğe geç</a>
  <aside><p>aile</p><nav aria-label="Sayfalar"><a href="#/genel">Genel durum</a></nav><nav aria-label="Yardımcı"><a href="#/ayarlar">Ayarlar</a></nav></aside>
  <main id="admin-content" tabindex="-1"><h1>Genel durum</h1><h2>Özet</h2></main>`;

interface StructureCase { name: string; profile: Profile; html: string; expect: RegExp[] }

const STRUCTURE_CASES: readonly StructureCase[] = [
  { name: 'iki h1', profile: 'phone', html: GOOD_NARROW.replace('<h2>Liste</h2>', '<h1>İkinci</h1>'), expect: [/^h1 sayısı 2/] },
  { name: 'seviye atlama', profile: 'phone', html: GOOD_NARROW.replace('<h2>Özet</h2><h3>Ayrıntı</h3>', '<h3>Özet</h3>'), expect: [/başlık sırası atlıyor heading h1 "Genel durum" → heading h3 "Özet"/] },
  { name: 'adsız alanlar', profile: 'phone', html: GOOD_NARROW.replace('<label>Ara <input type="search"></label>', '<input type="text">').replace('aria-label="Dönem" ', ''), expect: [/adsız form alanı: textbox/, /adsız form alanı: combobox/] },
  { name: 'adsız düğme', profile: 'phone', html: GOOD_NARROW.replace('<button type="button">Yenile</button>', '<button type="button"></button>'), expect: [/adsız etkileşimli öğe: button/] },
  { name: 'main yok', profile: 'phone', html: GOOD_NARROW.replace('<main id="admin-content" tabindex="-1">', '<div>').replace('</main>', '</div>'), expect: [/main landmark sayısı 0/, /h1 main dışında/] },
  { name: 'iki main', profile: 'phone', html: `${GOOD_NARROW}<main><p>ikinci</p></main>`, expect: [/main landmark sayısı 2/] },
  { name: 'landmark dışı içerik', profile: 'phone', html: `${GOOD_NARROW}<p>Serbest metin</p>`, expect: [/landmark dışında içerik: paragraph/] },
  { name: 'banner yok', profile: 'phone', html: GOOD_NARROW.replace('<header>', '<div>').replace('</header>', '</div>'), expect: [/banner \(üst bar\) sayısı 0/] },
  { name: 'Sayfalar düğmesi yok', profile: 'tablet', html: GOOD_NARROW.replace('<button type="button" aria-haspopup="dialog">Sayfalar</button>', ''), expect: [/banner içinde "Sayfalar" düğmesi yok/] },
  { name: 'h1 banner içinde', profile: 'phone', html: GOOD_NARROW.replace('<p>aile · Genel durum</p>', '<h1>aile</h1>'), expect: [/h1 sayısı 2/, /h1 main dışında: heading h1 "aile"/] },
  { name: 'h1 öncesi başlık', profile: 'phone', html: GOOD_NARROW.replace('<p>aile · Genel durum</p>', '<h2>aile</h2>'), expect: [/h1'den önce başlık: heading h2 "aile"/] },
  { name: 'masaüstü gezinme yok', profile: 'desktop', html: GOOD_DESKTOP.replace('<nav aria-label="Sayfalar"><a href="#/genel">Genel durum</a></nav>', ''), expect: [/navigation "Sayfalar" sayısı 0/] },
  { name: 'adsız iki gezinme', profile: 'desktop', html: GOOD_DESKTOP.replace('<nav aria-label="Yardımcı">', '<nav>').replace('</main>', '<nav><a href="#/x">X</a></nav></main>'), expect: [/aynı rolden 3 landmark ayırt edici adla değil: navigation/] },
];

const DIALOG_GOOD = '<div role="dialog" aria-modal="true" aria-labelledby="t"><h2 id="t">Sayfalar</h2><nav aria-label="Sayfalar"><a href="#/genel">Genel durum</a></nav><label>Ad <input></label><button type="button">Kapat</button></div>';

interface DialogCase { name: string; html: string; expected?: DialogExpectation; expect: RegExp[] }

const DIALOG_CASES: readonly DialogCase[] = [
  { name: 'adsız diyalog', html: '<div role="dialog" aria-modal="true"><p>İçerik</p></div>', expect: [/adsız diyalog/] },
  { name: 'diyalogda seviye atlama', html: '<div role="dialog" aria-label="Ekle"><h2>Ekle</h2><h4>Alt</h4></div>', expect: [/diyalog: başlık sırası atlıyor/] },
  { name: 'diyalogda adsız alan', html: '<div role="dialog" aria-label="Ekle"><input type="text"></div>', expect: [/adsız form alanı: textbox/] },
  { name: 'Sayfalar gezinmesi yok', html: '<div role="dialog" aria-label="Sayfalar"><a href="#/genel">Genel durum</a></div>', expected: { navigation: 'Sayfalar' }, expect: [/navigation "Sayfalar" sayısı 0/] },
];

const documentFor = (body: string) => `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>Öz denetim</title></head><body>${body}</body></html>`;

test.describe('öz denetim: dedektörler kör değil', () => {
  test('yapı dedektörü bilinen belgelerde ihlalleri yakalar, temiz belgede sessiz kalır', async ({ page }) => {
    await page.setContent(documentFor(GOOD_NARROW));
    expect(pageStructureViolations(await ariaTree(page.locator('body')), 'phone'), 'temiz dar belge').toEqual([]);
    await page.setContent(documentFor(GOOD_DESKTOP));
    expect(pageStructureViolations(await ariaTree(page.locator('body')), 'desktop'), 'temiz masaüstü belge').toEqual([]);

    for (const c of STRUCTURE_CASES) {
      await page.setContent(documentFor(c.html));
      const found = pageStructureViolations(await ariaTree(page.locator('body')), c.profile);
      for (const pattern of c.expect) {
        expect(found.some((m) => pattern.test(m)), `${c.name}: ${pattern} yakalanmadı; bulunan: ${JSON.stringify(found)}`).toBe(true);
      }
    }

    await page.setContent(documentFor(DIALOG_GOOD));
    expect(dialogStructureViolations(await ariaTree(page.getByRole('dialog')), { navigation: 'Sayfalar' }), 'temiz diyalog').toEqual([]);
    for (const c of DIALOG_CASES) {
      await page.setContent(documentFor(c.html));
      const found = dialogStructureViolations(await ariaTree(page.getByRole('dialog')), c.expected);
      for (const pattern of c.expect) {
        expect(found.some((m) => pattern.test(m)), `${c.name}: ${pattern} yakalanmadı; bulunan: ${JSON.stringify(found)}`).toBe(true);
      }
    }
  });

  test('kip denetimi: modal katmanda aria-modal eksiği, kipsiz yan panelde aria-modal ve erişilemez arka plan yakalanır', async ({ page }) => {
    const panel = (attrs: string) => `<div role="dialog" aria-label="Örnek kase"${attrs}><h2>Örnek kase</h2><button type="button">Kapat</button></div>`;
    const results = '<section aria-label="Sonuçlar"><button type="button">Örnek kase</button></section>';
    const check = async (body: string, modal: boolean, opener?: string) => {
      await page.setContent(documentFor(body));
      if (opener) await page.evaluate(opener);
      // includeHidden: açık modal <dialog> ARIA ağacında diğer öğeleri gizlese de bulunur (bekleme zaman aşımı yok).
      const background = page.getByRole('region', { name: 'Sonuçlar', includeHidden: true });
      const dialog = page.getByRole('dialog', { name: 'Örnek kase', includeHidden: true });
      return modalityViolations(dialog, modal, modal ? undefined : background);
    };
    expect(await check(`<main>${results}</main>${panel(' aria-modal="true"')}`, true), 'temiz modal').toEqual([]);
    expect(await check(`<main>${results}${panel('')}</main>`, false), 'temiz kipsiz yan panel').toEqual([]);

    const run = async (name: string, body: string, modal: boolean, pattern: RegExp, opener?: string) => {
      const found = await check(body, modal, opener);
      expect(found.some((m) => pattern.test(m)), `${name}: ${pattern} yakalanmadı; bulunan: ${JSON.stringify(found)}`).toBe(true);
    };
    await run('modalda aria-modal yok', `<main>${results}</main>${panel('')}`, true, /modal katmanda aria-modal="true" yok/);
    await run('kipsiz panel aria-modal diyor', `<main>${results}${panel(' aria-modal="true"')}</main>`, false, /kipsiz yan panel aria-modal="true"/);
    await run('arka plan inert', `<main><div inert>${results}</div>${panel('')}</main>`, false, /arka plan erişilemez: div\[inert\]/);
    await run('arka plan aria-hidden', `<main><div aria-hidden="true">${results}</div>${panel('')}</main>`, false, /arka plan erişilemez: div\[aria-hidden="true"\]/);
    await run(
      'arka plan modal <dialog> altında',
      `<main>${results}</main><dialog id="m"><p>Başka katman</p></dialog>${panel('')}`,
      false,
      /açık modal <dialog> arka planı inert/,
      '(document.getElementById("m")).showModal()',
    );
  });

  test('yapı dedektörü gerçek sayfaya enjekte edilen ihlalleri yakalar', async ({ page }) => {
    await openRoute(page, '/genel');
    const profile = await profileOf(page);
    const body = page.locator('body');
    const before = new Set(pageStructureViolations(await ariaTree(body), profile));
    await page.evaluate(() => {
      const main = document.querySelector('main#admin-content');
      const probe = document.createElement('div');
      probe.setAttribute('data-a11y-probe', '');
      probe.innerHTML = '<h1>Enjekte ikinci başlık</h1><h3>Enjekte atlayan başlık</h3><input type="text">';
      main?.append(probe);
      const outside = document.createElement('p');
      outside.setAttribute('data-a11y-probe', '');
      outside.textContent = 'Enjekte landmark dışı metin';
      document.body.append(outside);
    });
    const after = pageStructureViolations(await ariaTree(body), profile).filter((m) => !before.has(m));
    await page.evaluate(() => document.querySelectorAll('[data-a11y-probe]').forEach((el) => el.remove()));
    for (const pattern of [/^h1 sayısı 2/, /başlık sırası atlıyor .*"Enjekte atlayan başlık"/, /adsız form alanı: textbox/, /landmark dışında içerik: paragraph "Enjekte landmark dışı metin"/]) {
      expect(after.some((m) => pattern.test(m)), `${pattern} yakalanmadı; yeni bulgular: ${JSON.stringify(after)}`).toBe(true);
    }
  });

  test('axe dört WCAG etiketinin kurallarını gerçek sayfada çalıştırır ve enjekte ihlalleri yakalar', async ({ page }) => {
    await openRoute(page, '/genel');
    const before = violationKeys((await axeRun(page)).violations);
    await page.evaluate(() => {
      const main = document.querySelector('main#admin-content');
      const probe = document.createElement('div');
      probe.setAttribute('data-a11y-probe', '');
      probe.innerHTML = [
        '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="24" height="24">',
        '<input type="text" class="p-label">',
        '<p class="p-contrast">Düşük kontrastlı metin</p>',
        '<input type="text" aria-label="E-posta" autocomplete="uydurma-deger">',
        '<button type="button" class="p-empty"></button>',
        '<span><button type="button" class="p-tiny" aria-label="Bir">.</button><button type="button" class="p-tiny" aria-label="İki">.</button></span>',
      ].join('');
      const css = (selector: string, rules: Record<string, string>) => probe.querySelectorAll<HTMLElement>(selector).forEach((el) => {
        for (const [k, v] of Object.entries(rules)) el.style.setProperty(k, v, 'important');
      });
      probe.style.setProperty('position', 'fixed', 'important');
      probe.style.setProperty('inset', '0 auto auto 0', 'important');
      probe.style.setProperty('z-index', '2147483647', 'important');
      probe.style.setProperty('background', '#ffffff', 'important');
      probe.style.setProperty('padding', '8px', 'important');
      css('.p-contrast', { color: '#c8c8c8', background: '#ffffff', 'font-size': '16px' });
      css('.p-empty', { width: '44px', height: '44px' });
      css('.p-tiny', {
        width: '10px', height: '10px', 'min-width': '0', 'min-height': '0', padding: '0', margin: '0', border: '0',
        'font-size': '14px', 'line-height': '10px', overflow: 'hidden', display: 'inline-block',
      });
      main?.prepend(probe);
    });
    const results = await axeRun(page);
    await page.evaluate(() => document.querySelectorAll('[data-a11y-probe]').forEach((el) => el.remove()));
    const fresh = onlyNew(results.violations, before);
    const ids = new Set(fresh.map((v) => v.id));
    // wcag2a: image-alt, label, button-name · wcag2aa: color-contrast · wcag21aa: autocomplete-valid · wcag22aa: target-size
    for (const id of ['image-alt', 'label', 'button-name', 'color-contrast', 'autocomplete-valid', 'target-size']) {
      expect(ids.has(id), `${id} yakalanmadı; yeni ihlaller: ${[...ids].join(', ') || 'yok'}`).toBe(true);
    }
    const ran = new Set([...results.passes, ...results.violations, ...results.incomplete, ...results.inapplicable].map((r) => r.id));
    for (const id of ['color-contrast', 'target-size', 'autocomplete-valid', 'label', 'scrollable-region-focusable']) {
      expect(ran.has(id), `${id} kuralı çalışmadı (etiket yapılandırması)`).toBe(true);
    }
    // Etiket dışı (best-practice) kurallar sayılmaz: sonuçta yalnız WCAG etiketli kurallar var.
    for (const r of [...results.passes, ...results.violations]) {
      expect(r.tags.some((t) => WCAG_TAGS.includes(t)), `${r.id} WCAG etiketli değil`).toBe(true);
    }
  });

  test('katman kapsamı içerideki ihlali yakalar, dışarıdakini katmana yazmaz', async ({ page }) => {
    await openRoute(page, '/hesaplar');
    await page.getByRole('button', { name: 'Hesap ekle', exact: true }).filter({ visible: true }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Hesap ekle', exact: true });
    await expect(dialog).toBeVisible();
    await settle(page, dialog);
    await dialog.evaluate((el) => {
      const inside = document.createElement('input');
      inside.type = 'text';
      inside.setAttribute('data-a11y-probe', '');
      el.append(inside);
      const outside = document.createElement('img');
      outside.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
      outside.setAttribute('data-a11y-probe', '');
      document.querySelector('main#admin-content')?.prepend(outside);
    });
    const scoped = await withScope(dialog, (selector) => axeRun(page, selector));
    await page.evaluate(() => document.querySelectorAll('[data-a11y-probe]').forEach((el) => el.remove()));
    const ids = scoped.violations.map((v) => v.id);
    expect(ids, 'katman içindeki etiketsiz alan yakalanmadı').toContain('label');
    expect(ids, 'katman dışındaki görsel katman taramasına girdi').not.toContain('image-alt');
    const outsideHits = scoped.violations.flatMap((v) => v.nodes).filter((n) => /<img\b/.test(n.html));
    expect(outsideHits, 'katman dışı öğe katman kapsamında').toEqual([]);
  });
});
