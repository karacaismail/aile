import { test, expect, type Locator, type Page } from '@playwright/test';
import { openAdmin, shiftTabKey, tabKey } from './admin-helpers';
import { focusRing, selfCheckDetectors } from './admin-detectors';

// Odak sözleşmesi (AGENT.md kesin odak kuralı, tasarım README › Odak, src/admin/admin.css):
//  - Görünür odak modu kapalı başlar (html[data-keyboard='false']); yalnız Tab/Shift+Tab açar. Ok, Escape, yazma ve Enter
//    açmaz. pointerdown/touchstart yalnız görsel modu kapatır: odak yerinde kalır, blur yok.
//  - Klavye modunda odaklı kontrolde TEK 3 px alt çizgi (renk --aile-odak, nav üzerinde --aile-odak-nav):
//      kontrol  : kontrolün ya da onu saran sarmalayıcının ::after'ı, kontrol genişliğinde, odak-aralik (4 px) altında;
//      satır    : liste/tablo satırında satırın alt kenarında (bottom 0);
//      etiket   : menü öğesi, açılır alan başlığı, seçenek, onay kutusunda kontrol çizgisi ya da etiket metninin hemen
//                 altında (tasarım bundle.css .ai-ul::after, bottom -odak-aralik) tek çizgi.
//  - Çevreleyen gösterge yok: outline, halka box-shadow, dört kenarlı sözde öğe çerçevesi. Tek dar istisna: forced-colors
//    açıkken klavye modu + :focus-visible öğede outline 2px solid CanvasText.
//  - Modal katmanda (alt sayfa, çekmece, diyalog) odak içeri girer, Escape ve Kapat kapatır, odak açan kontrole döner ve
//    klavye modunda gösterge korunur. Tab/Shift+Tab arka plandaki sayfa içeriğine asla gitmez: katman içinde döner ya da
//    (yerel modal <dialog> gibi) son duraktan tarayıcı arayüzüne çıkar ve sonraki Tab katmana geri girer. Sayfa içinde
//    body'ye düşmek (document.hasFocus() iken) kayıp odaktır ve hatadır.
//  - .aile-admin dışına portallanan yerel katman (data-aile-katman / role=dialog) aynı sözleşmeye uyar: [data-focus-line]
//    düğme, [data-focus-line] sarmalayıcıdaki input ve [data-odak-zemin='nav'] yüzeyindeki bağlantı (çizgi odak-nav).
// Ölçüm paylaşılan dedektörle yapılır (e2e/admin-detectors.ts focusRingViolations, sahibi f09-detectors). Dedektörün
// modellemediği iki tasarım kalıbı yalnız onun açık seçenekleriyle ifade edilir: satır çizgisi gap = -kalınlık (beklenen
// bottom 0), etiket çizgisi target = etiket öğesi + gap = aralık - kalınlık (beklenen bottom -aralık). Dedektörün görmediği
// üç şey burada yerel ve dar tutulur: çizgi renginin token olması, tek çizgi sayımı (sözde öğe opaklığı dahil) ve etiket
// çizgisinin konağını bulmak. Öz denetim testleri her ihlali sayfaya enjekte eder (ürün durumundan bağımsız sentetik
// parça dahil) ve yakalandığını kanıtlar.
//
// Veri: playwright.admin.config.ts webServer'ı AILE_GENERATION_DIR = fixtures/generation-synthetic ve sentetik Sheet
// kimliğiyle başlatır; /__aile/generation/* sentetik nesli sunucudan verir. Bu dosya nesil için page.route sahtesi kurmaz
// (kurulsaydı sunucudan önce gelirdi). Yerel olmayan her istek (Google dahil) kesilir. Hazır sinyali openAdmin; sabit
// bekleme yok, her tuştan sonra odak ve geçişler (240 ms opaklık geçişi dahil) oturana kadar kare kare beklenir.
// Projeler: görev koşusu chromium 320×568 ve webkit 390×844 (ikisi telefon profili, dokunmatik); @matrix etiketli sayfa
// ve katman testleri entegrasyonda 360/375/320×480/568×320, tablet ve masaüstünde de koşar. Katmanı o profilde olmayan
// test atlanır (not_applicable); telefonda katmanın olmaması hatadır.

const ROUTES = [
  '/genel', '/butce', '/odemeler', '/hesaplar', '/alimlar', '/ev',
  '/projeler', '/taraflar', '/raporlar', '/sozlukler', '/veri', '/ayarlar',
] as const;
const MATRIX = { tag: '@matrix' };
/** Sayfa yolculuğunda ileri Tab durak sınırı (belge sonuna ya da başa dönüşe kadar). */
const PAGE_STOPS = 14;
/** Katman içinde başa dönüşü görmek için Tab sınırı (filtre çekmecesinde ~45 seçenek var). */
const LAYER_STOPS = 90;
const LINE_HOST = 'data-f01-line-host';
const TARGET = 'data-f01-target';
const FIRST = 'data-f01-first';
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

test.beforeEach(async ({ page }) => {
  // Google ve diğer dış adreslere ağ çağrısı yok (fetch sahtesi: istek kesilir).
  await page.route(url => !LOCAL_HOSTS.has(url.hostname), route => route.abort('blockedbyclient'));
});

type Kind = 'none' | 'container' | 'control' | 'row' | 'label';

interface FocusLine {
  where: string;
  color: string;
  opacity: number;
  width: number;
}

interface FocusPlan {
  focused: boolean;
  describe: string;
  keyboard: boolean;
  kind: Kind;
  thickness: number;
  gap: number;
  /** --aile-odak ve --aile-odak-nav, rgb olarak. */
  allowed: string[];
  /** Görünür (opak, kalınlıkta, genişliği > 0) sözde öğe çizgileri: taşıyıcılarda ve onların içinde. */
  lines: FocusLine[];
  /** Kalınlıkta ve renkli olup görünmeyen çizgiler (genişlik 0, düşük opaklık): yalnız tanı mesajı içindir. */
  hidden: string[];
  /** Etiket çizgisi taşıyan iç öğe LINE_HOST ile işaretlendi. */
  labelHost: boolean;
}

/**
 * Tarayıcıda çalışır; kendi içinde kapalıdır (dış kapsama başvurmaz). Odaklı öğeyi (ya da `targetAttr` ile işaretli öğeyi)
 * sınıflar ve görünür odak çizgilerini toplar. Taşıyıcı kuralı paylaşılan dedektörle aynıdır: hedef + başka odaklanabilir
 * içermeyen en çok 3 ata (landmark/diyalog rolünde durulur).
 */
function focusPlan(args: { hostAttr: string; targetAttr: string | null }): FocusPlan {
  const root = document.documentElement;
  document.querySelectorAll(`[${args.hostAttr}]`).forEach(el => el.removeAttribute(args.hostAttr));
  const target = args.targetAttr ? document.querySelector(`[${args.targetAttr}]`) : document.activeElement;
  const keyboard = root.dataset.keyboard === 'true';
  const px = (value: string) => {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : 0;
  };
  const host = target && target !== document.body && target !== root ? target : root;
  const vars = getComputedStyle(host);
  const thickness = px(vars.getPropertyValue('--aile-odak-kalinlik')) || 3;
  const gap = px(vars.getPropertyValue('--aile-odak-aralik')) || 4;
  const toRgb = (value: string) => {
    const probe = document.createElement('span');
    probe.style.display = 'none';
    probe.style.color = value.trim();
    document.body.append(probe);
    const rgb = getComputedStyle(probe).color;
    probe.remove();
    return rgb;
  };
  const allowed = ['--aile-odak', '--aile-odak-nav']
    .map(name => vars.getPropertyValue(name).trim())
    .filter(Boolean)
    .map(toRgb);
  const label = (el: Element) => {
    const role = el.getAttribute('role') || el.tagName.toLowerCase();
    const type = el instanceof HTMLInputElement ? `:${el.type}` : '';
    const name = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 36);
    return `${role}${type} "${name}"`;
  };
  const empty: FocusPlan = { focused: false, describe: 'belge (body)', keyboard, kind: 'none', thickness, gap, allowed, lines: [], hidden: [], labelHost: false };
  if (!target || target === document.body || target === root) return empty;

  const FOCUSABLE = 'a[href], button, input:not([type=hidden]), select, textarea, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';
  const carriers: Element[] = [target];
  for (let parent = target.parentElement; parent && carriers.length <= 3 && parent !== document.body && parent !== root; parent = parent.parentElement) {
    if (parent.querySelectorAll(FOCUSABLE).length > 1) break;
    if (/^(dialog|alertdialog|main|navigation|region|form|banner|complementary)$/.test(parent.getAttribute('role') || '')) break;
    carriers.push(parent);
  }

  const opaque = (color: string) => {
    if (!color || color === 'transparent') return false;
    const match = color.match(/rgba?\(([^)]*)\)/);
    if (!match) return true;
    const parts = match[1].split(/[\s,/]+/).filter(Boolean);
    return parts.length < 4 || parseFloat(parts[3]) > 0;
  };
  const hidden: string[] = [];
  const lineOf = (el: Element, pseudo: '::before' | '::after'): FocusLine | null => {
    const ps = getComputedStyle(el, pseudo);
    if (!ps.content || ps.content === 'none' || ps.content === 'normal') return null;
    if (ps.display === 'none' || ps.visibility === 'hidden') return null;
    if (Math.abs(px(ps.height) - thickness) > 0.5 || !opaque(ps.backgroundColor)) return null;
    const where = `${label(el)}${pseudo}`;
    const width = px(ps.width);
    let opacity = Number(ps.opacity);
    for (let node: Element | null = el; node && node !== root; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
    if (width <= 0.5) {
      if (opacity >= 0.5) hidden.push(`${where} genişlik ${ps.width} (konak ${Math.round(el.getBoundingClientRect().width)}px)`);
      return null;
    }
    if (!(opacity >= 0.5)) {
      hidden.push(`${where} opaklık ${Math.round(opacity * 100) / 100}`);
      return null;
    }
    return { where, color: ps.backgroundColor, opacity: Math.round(opacity * 100) / 100, width: Math.round(width) };
  };

  const lines: FocusLine[] = [];
  const inner: Element[] = [];
  for (const carrier of carriers) {
    for (const pseudo of ['::before', '::after'] as const) {
      const line = lineOf(carrier, pseudo);
      if (line) lines.push(line);
    }
    for (const el of Array.from(carrier.querySelectorAll('*'))) {
      if (carriers.includes(el) || inner.includes(el)) continue;
      inner.push(el);
    }
  }
  let labelHostEl: Element | null = null;
  for (const el of inner) {
    for (const pseudo of ['::before', '::after'] as const) {
      const line = lineOf(el, pseudo);
      if (!line) continue;
      lines.push(line);
      if (pseudo === '::after' && !labelHostEl) labelHostEl = el;
    }
  }

  const role = target.getAttribute('role') || '';
  const COMPOSITE = '[role=menu], [role=menubar], [role=listbox], [role=tablist], [role=tree], [role=radiogroup], [role=grid]';
  const rowLike = () => {
    if (target.matches('tr, [role=row]')) return true;
    if (!/^(BUTTON|A)$/.test(target.tagName)) return false;
    const item = target.closest('li, [role=listitem]');
    if (!item || item.querySelectorAll(FOCUSABLE).length !== 1) return false;
    const own = target.getBoundingClientRect();
    const box = item.getBoundingClientRect();
    return box.width > 0 && own.width >= box.width * 0.9;
  };
  let kind: Kind;
  if (/^(dialog|alertdialog)$/.test(role) || ((target as HTMLElement).tabIndex < 0 && target.querySelector(FOCUSABLE))) kind = 'container';
  else if (
    /^(menuitem|menuitemcheckbox|menuitemradio|option|tab|checkbox|radio|switch|treeitem)$/.test(role)
    || (target instanceof HTMLInputElement && /^(checkbox|radio)$/.test(target.type))
    || target.hasAttribute('aria-expanded')
    || Boolean(target.closest(COMPOSITE))
  ) kind = 'label';
  else if (rowLike()) kind = 'row';
  else kind = 'control';

  if (kind === 'label' && labelHostEl) labelHostEl.setAttribute(args.hostAttr, '');
  return { focused: true, describe: label(target), keyboard, kind, thickness, gap, allowed, lines, hidden, labelHost: kind === 'label' && Boolean(labelHostEl) };
}

let settleProbe = 0;
/** Odaklı öğe iki ardışık karede aynı ve sonlu hiçbir geçiş/animasyon sürmüyor (240 ms opaklık geçişi dahil). */
async function settle(page: Page) {
  const key = JSON.stringify(`__f01Settle${++settleProbe}`);
  await page.waitForFunction(
    `(() => { const w = window; const el = document.activeElement;`
      + ` const busy = document.getAnimations().some(a => a.playState === 'running' && Number.isFinite(Number(a.effect && a.effect.getComputedTiming().endTime)));`
      + ` const prev = w[${key}]; const n = prev && prev.el === el && !busy ? prev.n + 1 : 0; w[${key}] = { el, n }; return n >= 2; })()`,
    undefined,
    { polling: 'raf', timeout: 5_000 },
  );
}

async function plan(page: Page, targetAttr: string | null = null): Promise<FocusPlan> {
  return page.evaluate(focusPlan, { hostAttr: LINE_HOST, targetAttr });
}

/** Klavye modundaki odaklı öğe için sözleşme ihlalleri; boş = tek görünür alt çizgi, halka yok. */
async function keyboardProblems(page: Page, targetAttr: string | null = null): Promise<{ plan: FocusPlan; problems: string[] }> {
  await settle(page);
  const current = await plan(page, targetAttr);
  if (!current.focused) return { plan: current, problems: ['odak belgeye düştü: görünür klavye odağı yok'] };
  const problems: string[] = [];
  if (!current.keyboard) problems.push('klavye modu kapalı');
  const target = targetAttr ? `[${targetAttr}]` : undefined;
  const base = { thickness: current.thickness, gap: current.gap, ...(target ? { target } : {}) };
  if (current.kind === 'container') {
    // Katman paneli (role=dialog, tabindex -1) programatik giriş odağıdır: kontrol değildir, çizgi istenmez; halka yasak.
    problems.push(...await focusRing(page, { ...base, keyboard: false }));
    return { plan: current, problems };
  }
  if (current.kind === 'row') problems.push(...await focusRing(page, { ...base, gap: -current.thickness }));
  else if (current.kind === 'control') problems.push(...await focusRing(page, base));
  else {
    const asControl = await focusRing(page, base);
    if (asControl.length > 0 && current.labelHost) {
      problems.push(...await focusRing(page, { thickness: current.thickness, gap: current.gap - current.thickness, target: `[${LINE_HOST}]` }));
      problems.push(...await focusRing(page, { ...base, keyboard: false }));
    } else {
      problems.push(...asControl);
    }
  }
  if (current.lines.length !== 1) {
    const invisible = current.lines.length === 0 && current.hidden.length > 0 ? `; görünmeyen çizgi: ${current.hidden.join(', ')}` : '';
    problems.push(`tek alt çizgi bekleniyordu, ${current.lines.length} görünür çizgi: ${current.lines.map(line => line.where).join(', ') || 'yok'}${invisible}`);
  }
  for (const line of current.lines) {
    if (!current.allowed.includes(line.color)) problems.push(`${line.where}: çizgi rengi ${line.color} token dışı (izinli ${current.allowed.join(' / ')})`);
  }
  return { plan: current, problems };
}

/** İşaretçi modundaki odaklı öğe için ihlaller; boş = mod kapalı, çizgi ve halka yok. */
async function pointerProblems(page: Page, targetAttr: string | null = null): Promise<{ plan: FocusPlan; problems: string[] }> {
  await settle(page);
  const current = await plan(page, targetAttr);
  const problems: string[] = [];
  if (current.keyboard) problems.push('işaretçi sonrası klavye modu açık kaldı');
  if (!current.focused) return { plan: current, problems };
  if (current.lines.length > 0) problems.push(`işaretçi modunda odak çizgisi görünüyor: ${current.lines.map(line => line.where).join(', ')}`);
  const target = targetAttr ? `[${targetAttr}]` : undefined;
  problems.push(...await focusRing(page, { thickness: current.thickness, gap: current.gap, keyboard: false, ...(target ? { target } : {}) }));
  return { plan: current, problems };
}

async function expectKeyboardIndicator(page: Page, where: string, targetAttr: string | null = null) {
  const { plan: current, problems } = await keyboardProblems(page, targetAttr);
  expect(problems, `${where} · ${current.describe} (${current.kind})`).toEqual([]);
}

async function expectNoIndicator(page: Page, where: string, targetAttr: string | null = null) {
  const { plan: current, problems } = await pointerProblems(page, targetAttr);
  expect(problems, `${where} · ${current.describe}`).toEqual([]);
}

async function keyboardMode(page: Page) {
  return page.evaluate(() => document.documentElement.dataset.keyboard ?? 'yok');
}

/** Programatik odağı gerçek klavye odağına çevirir: Tab ileri + Shift+Tab geri aynı öğeye döner, mod açılır. */
async function keyboardFocus(page: Page, browserName: string, locator: Locator) {
  await locator.focus();
  await page.keyboard.press(tabKey(browserName));
  await page.keyboard.press(shiftTabKey(browserName));
  await expect(locator).toBeFocused();
  await expect.poll(() => keyboardMode(page)).toBe('true');
}

async function profileOf(page: Page) {
  return page.evaluate(() => document.documentElement.dataset.profile ?? 'bilinmiyor');
}

async function markActive(page: Page, attr: string) {
  await page.evaluate(name => {
    document.querySelectorAll(`[${name}]`).forEach(el => el.removeAttribute(name));
    document.activeElement?.setAttribute(name, '');
  }, attr);
}

async function activeIs(page: Page, attr: string) {
  return page.evaluate(name => Boolean(document.activeElement?.hasAttribute(name)), attr);
}

async function activeDescribe(page: Page) {
  return (await plan(page)).describe;
}

async function focusInside(layer: Locator) {
  return layer.evaluate(el => el.contains(document.activeElement));
}

/**
 * Katman açıkken odağın yeri: katmanda; tarayıcı arayüzünde (belge odağı bıraktı: yerel modal <dialog> davranışı, izinli);
 * belgede body'ye düşmüş (kayıp odak) ya da arka plandaki sayfa içeriğinde (tuzak delik). Son ikisi hatadır.
 */
async function focusWhere(page: Page, layer: Locator): Promise<'layer' | 'chrome' | 'lost' | 'background'> {
  if (await focusInside(layer)) return 'layer';
  return page.evaluate(() => {
    const active = document.activeElement;
    const atBody = !active || active === document.body || active === document.documentElement;
    if (atBody) return document.hasFocus() ? 'lost' : 'chrome';
    return 'background';
  });
}

// --- Dedektör öz denetimi ---------------------------------------------------------------------------------------------

test.describe('odak dedektörü öz denetimi', () => {
  test('paylaşılan dedektörler bu motorda kör değil', async ({ page }) => {
    await openAdmin(page, '/alimlar');
    expect(await selfCheckDetectors(page), 'ihlali yakalamayan dedektörler').toEqual([]);
  });

  test('gerçek sayfaya enjekte edilen her odak ihlali yakalanır; temiz durumda yanlış pozitif yok', async ({ page, browserName }) => {
    await openAdmin(page, '/alimlar');
    await page.keyboard.press(tabKey(browserName));
    await expect.poll(() => keyboardMode(page)).toBe('true');
    await markActive(page, TARGET);
    const clean = await keyboardProblems(page, TARGET);
    expect(clean.problems, `temiz · ${clean.plan.describe}`).toEqual([]);

    const injections: [string, string][] = [
      ['outline halkası', "html[data-keyboard='true'] [data-f01-target] { outline: 3px solid rgb(200, 0, 0) !important; outline-offset: 2px !important; }"],
      ['box-shadow halkası', "html[data-keyboard='true'] [data-f01-target] { box-shadow: 0 0 0 2px rgb(200, 0, 0) !important; }"],
      ['dört kenarlı sözde öğe çerçevesi', "html[data-keyboard='true'] [data-f01-target]::before { content: '' !important; position: absolute !important; inset: -4px !important; border: 2px solid rgb(200, 0, 0) !important; }"],
      ['kaldırılmış çizgi (görünmez klavye odağı)', '*::after { content: none !important; }'],
      ['genişliği sıfır çizgi', "[data-f01-target]::after, [data-f01-target] *::after { width: 0 !important; left: 0 !important; right: auto !important; }"],
      ['token dışı renkli çizgi', "html[data-keyboard='true'] [data-f01-target]::after { background: rgb(200, 0, 0) !important; }"],
      ['ikinci çizgi', "html[data-keyboard='true'] [data-f01-target]::before { content: '' !important; position: absolute !important; left: 0 !important; right: 0 !important; top: -7px !important; height: 3px !important; background: var(--aile-odak) !important; }"],
    ];
    for (const [name, css] of injections) {
      const style = await page.addStyleTag({ content: css });
      const caught = await keyboardProblems(page, TARGET);
      expect(caught.problems.length, `enjekte ${name} yakalanmadı · ${caught.plan.describe}`).toBeGreaterThan(0);
      await style.evaluate(el => (el as Element).remove());
    }
    const after = await keyboardProblems(page, TARGET);
    expect(after.problems, 'enjeksiyonlar kaldırıldıktan sonra temiz').toEqual([]);

    // İşaretçi modu: temizken gösterge yok; klavye modu dışında görünen çizgi yakalanır.
    const search = page.getByRole('searchbox').first();
    await search.click();
    await expect(search).toBeFocused();
    await expectNoIndicator(page, 'işaretçi temiz');
    const leak = await page.addStyleTag({ content: "html[data-keyboard='false'] :focus::after, html[data-keyboard='false'] :has(> :focus)::after { content: '' !important; position: absolute !important; left: 0 !important; right: 0 !important; bottom: -7px !important; height: 3px !important; background: var(--aile-odak) !important; }" });
    const leaked = await pointerProblems(page);
    expect(leaked.problems.length, 'işaretçi modunda görünen çizgi yakalanmadı').toBeGreaterThan(0);
    await leak.evaluate(el => (el as Element).remove());
  });

  test('etiket çizgisi kalıbı (sentetik): konak bulunur; saydam, sıfır ve dar çizgi yakalanır', async ({ page, browserName }) => {
    // Ürün durumundan bağımsız: tasarımın "açılır alan başlığında çizgi etiket metninin altında" kalıbı main içine sentetik
    // bir parça olarak eklenir (yalnız tokenlar; AccordionList ile aynı geometri: etiket span'ı, bottom -odak-aralik).
    await openAdmin(page, '/alimlar');
    await page.addStyleTag({ content: [
      '.f01-ul { position: relative; display: inline-block; }',
      '.f01-ul::after { content: ""; position: absolute; left: 0; right: 0; bottom: calc(-1 * var(--aile-odak-aralik));',
      '  height: var(--aile-odak-kalinlik); background: var(--aile-odak); opacity: 0; }',
      "html[data-keyboard='true'] .f01-acc:focus-visible .f01-ul::after { opacity: 1; }",
    ].join('\n') });
    await page.locator('main#admin-content').evaluate(main => {
      const head = document.createElement('button');
      head.type = 'button';
      head.className = 'f01-acc';
      head.setAttribute('aria-expanded', 'false');
      head.setAttribute('data-f01-target', '');
      head.innerHTML = '<span class="f01-ul">Örnek açılır başlık</span>';
      main.prepend(head);
    });
    await keyboardFocus(page, browserName, page.locator('button.f01-acc'));
    const clean = await keyboardProblems(page, TARGET);
    expect(clean.plan.kind, 'sentetik başlık etiket kalıbı sayılmadı').toBe('label');
    expect(clean.plan.labelHost, 'etiket çizgisinin konağı bulunamadı').toBe(true);
    expect(clean.problems, 'sentetik etiket çizgisi temiz').toEqual([]);
    const injections: [string, string][] = [
      ['saydam etiket çizgisi', '.f01-ul::after { opacity: 0 !important; }'],
      ['genişliği sıfır etiket çizgisi', '.f01-ul::after { right: auto !important; width: 0 !important; }'],
      ['etiketten dar çizgi (sarılmış satır)', '.f01-ul::after { right: auto !important; width: 6px !important; }'],
      ['yanlış aralıkta çizgi', '.f01-ul::after { bottom: 0 !important; }'],
    ];
    for (const [name, css] of injections) {
      const style = await page.addStyleTag({ content: css });
      const caught = await keyboardProblems(page, TARGET);
      expect(caught.problems.length, `enjekte ${name} yakalanmadı`).toBeGreaterThan(0);
      await style.evaluate(el => (el as Element).remove());
    }
    expect((await keyboardProblems(page, TARGET)).problems, 'enjeksiyonlar kaldırıldıktan sonra temiz').toEqual([]);
  });
});

// --- Klavye modu anahtarı ---------------------------------------------------------------------------------------------

test.describe('klavye odak modu', () => {
  test('işaretçi modunda başlar; yazma, oklar, Escape ve Enter açmaz; Shift+Tab açar', async ({ page, browserName }) => {
    await openAdmin(page, '/alimlar');
    expect(await keyboardMode(page), 'başlangıç modu').toBe('false');
    const search = page.getByRole('searchbox').first();
    await search.focus();
    await expect(search).toBeFocused();
    await page.keyboard.type('ö');
    for (const key of ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Escape', 'Backspace', 'Enter', 'Home', 'End']) {
      await page.keyboard.press(key);
      expect(await keyboardMode(page), `${key} modu açtı`).toBe('false');
    }
    await expect(search).toBeFocused();
    await expectNoIndicator(page, 'programatik odak + yazma, mod kapalı');

    await page.keyboard.press(shiftTabKey(browserName));
    await expect.poll(() => keyboardMode(page), { message: 'Shift+Tab modu açmadı' }).toBe('true');
    await expectKeyboardIndicator(page, 'Shift+Tab sonrası');
  });

  test('fare görsel modu kapatır, odak yerinde kalır; Tab yeniden açar', async ({ page, browserName }) => {
    await openAdmin(page, '/alimlar');
    const search = page.getByRole('searchbox').first();
    await keyboardFocus(page, browserName, search);
    await expectKeyboardIndicator(page, 'klavyeyle arama alanı');

    await search.click();
    await expect(search, 'pointerdown odağı aldı (blur)').toBeFocused();
    expect(await keyboardMode(page)).toBe('false');
    await expectNoIndicator(page, 'aynı alana fare');

    await page.keyboard.press(tabKey(browserName));
    await expect.poll(() => keyboardMode(page)).toBe('true');
    await markActive(page, TARGET);
    await expectKeyboardIndicator(page, 'Tab sonrası');

    // Başka yere fare: önceki klavye hedefinde çizgi kalmaz.
    await page.getByRole('heading', { level: 1 }).click();
    expect(await keyboardMode(page)).toBe('false');
    await expectNoIndicator(page, 'fare sonrası önceki klavye hedefi', TARGET);
  });

  test('dokunma görsel modu kapatır, odak yerinde kalır', async ({ page, browserName }, testInfo) => {
    test.skip(!testInfo.project.use.hasTouch, 'bu projede dokunmatik giriş yok (not_applicable)');
    await openAdmin(page, '/alimlar');
    const search = page.getByRole('searchbox').first();
    await keyboardFocus(page, browserName, search);
    await expectKeyboardIndicator(page, 'klavyeyle arama alanı');
    await search.tap();
    await expect(search, 'touchstart odağı aldı (blur)').toBeFocused();
    await expect.poll(() => keyboardMode(page)).toBe('false');
    await expectNoIndicator(page, 'dokunma sonrası');
  });

  test('mod açıkken programatik odak göstergeyi korur', async ({ page, browserName }) => {
    await openAdmin(page, '/alimlar');
    await page.keyboard.press(tabKey(browserName));
    await expect.poll(() => keyboardMode(page)).toBe('true');
    const refresh = page.getByRole('button', { name: 'Yenile' }).first();
    await refresh.focus();
    await expect(refresh).toBeFocused();
    await expectKeyboardIndicator(page, 'programatik odak (Yenile)');
  });
});

// --- Sayfa yolculuğu --------------------------------------------------------------------------------------------------

test.describe('sayfa yolculuğu: Tab ve Shift+Tab', () => {
  for (const route of ROUTES) {
    test(`${route}: her durakta tek alt çizgi, halka yok`, MATRIX, async ({ page, browserName }) => {
      await openAdmin(page, route);
      const problems: string[] = [];
      const seen: string[] = [];
      await page.keyboard.press(tabKey(browserName));
      await expect.poll(() => keyboardMode(page)).toBe('true');
      await settle(page);
      await markActive(page, FIRST);
      let wrapped = false;
      for (let index = 0; index < PAGE_STOPS; index += 1) {
        if (index > 0) {
          await page.keyboard.press(tabKey(browserName));
          await settle(page);
          if (await activeIs(page, FIRST)) {
            wrapped = true;
            break;
          }
          if (!(await plan(page)).focused) break; // belge sonu: odak tarayıcıya geçer
        }
        const result = await keyboardProblems(page);
        seen.push(result.plan.describe);
        problems.push(...result.problems.map(problem => `Tab ${index + 1} · ${result.plan.describe}: ${problem}`));
      }
      // Geri yön: birkaç Shift+Tab (belge sonundaysa önce son durağa döner). Başa dönülmüşse ilk duraktan geri belge dışıdır.
      for (let index = 0; !wrapped && index < Math.min(3, seen.length - 1); index += 1) {
        await page.keyboard.press(shiftTabKey(browserName));
        const result = await keyboardProblems(page);
        problems.push(...result.problems.map(problem => `Shift+Tab ${index + 1} · ${result.plan.describe}: ${problem}`));
      }
      expect(seen.length, `${route}: Tab ilerlemiyor (${seen.join(' → ')})`).toBeGreaterThan(1);
      expect(problems, `${route} durakları: ${seen.join(' → ')}`).toEqual([]);
    });
  }
});

// --- Açık katmanlar ---------------------------------------------------------------------------------------------------

interface LayerCase {
  name: string;
  route: string;
  opener(page: Page): Locator;
  layer(page: Page): Locator;
  /** Bu katman yalnız telefon profilinde alt sayfadır (genişte açılır liste); diğer profillerde not_applicable. */
  phoneOnly?: boolean;
}

const LAYERS: readonly LayerCase[] = [
  { name: 'Sayfalar gezinme çekmecesi', route: '/alimlar', opener: page => page.getByRole('button', { name: 'Sayfalar' }), layer: page => page.getByRole('dialog', { name: /^Sayfalar/ }) },
  { name: 'Filtreler çekmecesi', route: '/alimlar', opener: page => page.getByRole('button', { name: /^Filtreler \(/ }), layer: page => page.getByRole('dialog', { name: /^Filtreler/ }) },
  { name: 'Sıralama seçim listesi (alt sayfa)', route: '/alimlar', opener: page => page.getByRole('combobox', { name: /Sıralama/ }), layer: page => page.getByRole('dialog', { name: /^Sıralama/ }), phoneOnly: true },
  { name: 'Diğer eylemler menüsü (alt sayfa)', route: '/butce', opener: page => page.getByRole('button', { name: /^Diğer/ }), layer: page => page.getByRole('dialog', { name: /^Diğer eylemler/ }) },
  { name: 'Terim ekle diyaloğu', route: '/sozlukler', opener: page => page.getByRole('button', { name: /^Terim ekle/ }), layer: page => page.getByRole('dialog', { name: /^Terim ekle/ }) },
];

/** Sayfayı açar, açan kontrolü klavyeyle odaklar ve katmanı Enter ile açar; katman o profilde yoksa testi atlar. */
async function openLayer(page: Page, browserName: string, layerCase: LayerCase) {
  await openAdmin(page, layerCase.route);
  const profile = await profileOf(page);
  const opener = layerCase.opener(page).first();
  const present = await opener.isVisible();
  test.skip(profile !== 'phone' && (!present || Boolean(layerCase.phoneOnly)), `${layerCase.name}: ${profile} profilinde bu katman yok (not_applicable)`);
  await expect(opener, `${layerCase.name}: telefonda açan kontrol yok`).toBeVisible();
  await keyboardFocus(page, browserName, opener);
  await expectKeyboardIndicator(page, `${layerCase.name} açan kontrol`);
  const layer = layerCase.layer(page);
  await page.keyboard.press('Enter');
  await expect(layer).toBeVisible();
  await expect.poll(() => focusInside(layer), { message: `${layerCase.name}: odak katmana girmedi` }).toBe(true);
  return { opener, layer };
}

test.describe('açık katmanlar', () => {
  for (const layerCase of LAYERS) {
    test(`${layerCase.name}: odak girer; Escape ve Kapat kapatır, odak açana döner ve gösterge korunur`, MATRIX, async ({ page, browserName }) => {
      const { opener, layer } = await openLayer(page, browserName, layerCase);
      const entry = await keyboardProblems(page);
      expect(entry.problems, `giriş odağı · ${entry.plan.describe}`).toEqual([]);

      await page.keyboard.press('Escape');
      await expect(layer).toBeHidden();
      await expect(opener, 'Escape sonrası odak açana dönmedi').toBeFocused();
      expect(await keyboardMode(page)).toBe('true');
      await expectKeyboardIndicator(page, 'Escape sonrası dönüş odağı');

      // Kapat yolu üç tur: kapanış hareketi sürerken katmanın odak tuzağı dönüş odağını geri çekip katman sökülünce body'ye
      // düşürebilir (zamanlamaya bağlı yarış); tekrar, yarışı tek turdan daha güvenilir yakalar.
      for (let round = 1; round <= 3; round += 1) {
        await page.keyboard.press('Enter');
        await expect(layer).toBeVisible();
        await expect.poll(() => focusInside(layer)).toBe(true);
        const close = layer.getByRole('button', { name: 'Kapat' }).first();
        for (let index = 0; index < 4 && !(await close.evaluate(el => el === document.activeElement)); index += 1) {
          await page.keyboard.press(tabKey(browserName));
          await settle(page);
        }
        await expect(close, `tur ${round}: Kapat düğmesine Tab ile ulaşılamadı`).toBeFocused();
        await expectKeyboardIndicator(page, `tur ${round}: Kapat düğmesi`);
        await page.keyboard.press('Enter');
        await expect(layer).toBeHidden();
        await expect(opener, `tur ${round}: Kapat sonrası odak açana dönmedi`).toBeFocused();
        await expectKeyboardIndicator(page, `tur ${round}: Kapat sonrası dönüş odağı`);
      }
    });

    test(`${layerCase.name}: her durakta tek alt çizgi, halka yok`, MATRIX, async ({ page, browserName }) => {
      test.setTimeout(90_000);
      const { layer } = await openLayer(page, browserName, layerCase);
      const problems: string[] = [];
      const seen: string[] = [];
      for (let index = 0; index < LAYER_STOPS; index += 1) {
        await page.keyboard.press(tabKey(browserName));
        await settle(page);
        if (index > 0 && (await activeIs(page, FIRST))) break;
        if (!(await focusInside(layer))) break; // katmandan çıkış ayrı testte (odak tuzağı)
        if (index === 0) await markActive(page, FIRST);
        const result = await keyboardProblems(page);
        seen.push(result.plan.describe);
        problems.push(...result.problems.map(problem => `Tab ${index + 1} · ${result.plan.describe}: ${problem}`));
      }
      expect(seen.length, `${layerCase.name}: katmanda Tab durağı yok`).toBeGreaterThan(0);
      expect(problems, `${layerCase.name} durakları: ${seen.join(' → ')}`).toEqual([]);
    });

    test(`${layerCase.name}: Tab ve Shift+Tab arka plana kaçmaz, katmana döner`, MATRIX, async ({ page, browserName }) => {
      test.setTimeout(90_000);
      const { layer } = await openLayer(page, browserName, layerCase);
      const path: string[] = [];
      let leak = '';
      let wrapped = false;
      let marked = false;
      for (let index = 0; index < LAYER_STOPS; index += 1) {
        await page.keyboard.press(tabKey(browserName));
        await settle(page);
        const where = await focusWhere(page, layer);
        const describe = await activeDescribe(page);
        if (where === 'chrome') {
          path.push('(tarayıcı arayüzü)');
          continue;
        }
        if (where !== 'layer') {
          leak = `Tab ${index + 1}: ${where === 'lost' ? 'odak belgeye düştü' : `odak arka plana kaçtı → ${describe}`} (önceki: ${path.at(-1) ?? 'giriş'})`;
          break;
        }
        if (marked && (await activeIs(page, FIRST))) {
          wrapped = true;
          break;
        }
        if (!marked) {
          await markActive(page, FIRST);
          marked = true;
        }
        path.push(describe);
      }
      expect(leak, `${layerCase.name} ileri: ${path.join(' → ')}`).toBe('');
      expect(wrapped, `${layerCase.name}: ${LAYER_STOPS} Tab içinde ilk durağa dönmedi (${path.join(' → ')})`).toBe(true);
      // İlk duraktan geri: Shift+Tab son katman durağına ya da tarayıcı arayüzüne gider; arka plana asla. Tarayıcı
      // arayüzündeyse bir Shift+Tab daha katmana geri girmelidir.
      const back: string[] = [];
      for (let index = 0; index < 2; index += 1) {
        await page.keyboard.press(shiftTabKey(browserName));
        await settle(page);
        const where = await focusWhere(page, layer);
        back.push(where === 'chrome' ? '(tarayıcı arayüzü)' : await activeDescribe(page));
        expect(['layer', 'chrome'], `${layerCase.name}: Shift+Tab ${index + 1} → ${back.join(' → ')}`).toContain(where);
        if (where === 'layer') break;
      }
      expect(await focusInside(layer), `${layerCase.name}: Shift+Tab katmana geri girmedi (${back.join(' → ')})`).toBe(true);
    });
  }

  test('Sıralama seçimi: klavyeyle açılır, oklar seçenekte gezer, Escape kapatır; işaretçiyle açılınca oklar modu açmaz', MATRIX, async ({ page, browserName }) => {
    await openAdmin(page, '/alimlar');
    const combo = page.getByRole('combobox', { name: /Sıralama/ }).first();
    await keyboardFocus(page, browserName, combo);
    await expectKeyboardIndicator(page, 'Sıralama kapalı');
    await page.keyboard.press('Enter');
    const sheet = page.getByRole('dialog', { name: /^Sıralama/ });
    const listbox = page.getByRole('listbox').filter({ visible: true }).first();
    await expect(listbox).toBeVisible();
    const phoneSheet = await sheet.isVisible();
    if (phoneSheet) {
      // Alt sayfa: seçili seçeneğe Tab ile, sonra oklarla gezilir (APG listbox); her seçenekte çizgi.
      const option = listbox.getByRole('option').first();
      for (let index = 0; index < 4 && !(await focusIsOption(page)); index += 1) {
        await page.keyboard.press(tabKey(browserName));
        await settle(page);
      }
      expect(await focusIsOption(page), 'seçeneğe Tab ile ulaşılamadı').toBe(true);
      await expect(option).toBeVisible();
      await expectKeyboardIndicator(page, 'Sıralama seçeneği');
      const before = await activeDescribe(page);
      await page.keyboard.press('ArrowDown');
      await settle(page);
      expect(await focusIsOption(page), 'ArrowDown seçenekten çıkardı').toBe(true);
      expect(await activeDescribe(page), 'ArrowDown sonraki seçeneğe geçmedi').not.toBe(before);
      await expectKeyboardIndicator(page, 'ArrowDown sonrası seçenek');
    } else {
      // Geniş profil: açılır liste; DOM odağı kontrolde kalır (aria-activedescendant), çizgi kontrolde.
      await expect(combo).toBeFocused();
      await expectKeyboardIndicator(page, 'Sıralama açık (açılır liste)');
      await page.keyboard.press('ArrowDown');
      await expect(combo).toBeFocused();
      await expectKeyboardIndicator(page, 'ArrowDown sonrası kontrol');
    }
    await page.keyboard.press('Escape');
    await expect(listbox).toBeHidden();
    await expect(combo, 'Escape sonrası odak kontrole dönmedi').toBeFocused();
    await expectKeyboardIndicator(page, 'Sıralama kapandıktan sonra');

    // İşaretçiyle aç: oklar ve Escape modu açmaz, seçenekte gösterge yok.
    await combo.click();
    await expect(listbox).toBeVisible();
    expect(await keyboardMode(page)).toBe('false');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    expect(await keyboardMode(page), 'ok tuşları modu açtı').toBe('false');
    await expectNoIndicator(page, 'işaretçiyle açılmış listede ok sonrası');
    await page.keyboard.press('Escape');
    await expect(listbox).toBeHidden();
    expect(await keyboardMode(page), 'Escape modu açtı').toBe('false');
  });

  test('Diğer eylemler menüsü: oklar odağı menü öğelerinde tutar (APG menu), gösterge korunur', MATRIX, async ({ page, browserName }) => {
    const layerCase = LAYERS.find(item => item.name.startsWith('Diğer eylemler'))!;
    const { layer } = await openLayer(page, browserName, layerCase);
    const items = layer.getByRole('menuitem');
    const count = await items.count();
    expect(count, 'Diğer eylemler menüsünde öğe yok').toBeGreaterThan(0);
    for (let index = 0; index < 4 && !(await focusIsRole(page, 'menuitem')); index += 1) {
      await page.keyboard.press(tabKey(browserName));
      await settle(page);
    }
    expect(await focusIsRole(page, 'menuitem'), 'menü öğesine Tab ile ulaşılamadı').toBe(true);
    await expectKeyboardIndicator(page, 'ilk menü öğesi');
    const first = await activeDescribe(page);
    for (const key of ['ArrowDown', 'ArrowUp', 'End', 'Home']) {
      await page.keyboard.press(key);
      await settle(page);
      expect(await focusIsRole(page, 'menuitem'), `${key} odağı menü öğesinden çıkardı → ${await activeDescribe(page)}`).toBe(true);
      expect(await focusInside(layer), `${key} odağı katmandan çıkardı`).toBe(true);
      expect(await keyboardMode(page), `${key} klavye modunu kapattı`).toBe('true');
      await expectKeyboardIndicator(page, `${key} sonrası menü öğesi`);
      // Tek öğede ok aynı öğede kalır; çok öğede ArrowDown sonrakine geçer (sarmalı gezinme).
      if (key === 'ArrowDown' && count > 1) expect(await activeDescribe(page), 'ArrowDown sonraki öğeye geçmedi').not.toBe(first);
    }
  });
});

async function focusIsRole(page: Page, role: string) {
  return page.evaluate(name => document.activeElement?.getAttribute('role') === name, role);
}

async function focusIsOption(page: Page) {
  return page.evaluate(() => document.activeElement?.getAttribute('role') === 'option');
}

// --- .aile-admin dışına portallanan yerel katman ----------------------------------------------------------------------

// b04 odak kancaları (admin.css): .aile-admin dışındaki [role=dialog] / [data-aile-katman] kökünde sıfırlama ve çizgi;
// [data-focus-line] düğme kendi ::after'ını, input saran [data-focus-line] sarmalayıcıyı (:has(:focus-visible)) çizer;
// [data-odak-zemin='nav'] yüzeyinde çizgi odak-nav rengindedir. Yerel bileşenler (alt sayfa, menü, select listesi) bu
// kancalarla portallanır; burada ürün bileşeninden bağımsız, kancaların kendisi ölçülür.
const NATIVE_LAYER = [
  '<div role="dialog" aria-modal="true" aria-label="Deneme katmanı" id="f01-katman"',
  ' style="position:fixed;left:0;right:0;bottom:0;z-index:9999;padding:16px;background:Canvas">',
  '<button type="button" data-focus-line id="f01-dugme" style="min-height:44px">Uygula</button>',
  '<span data-focus-line id="f01-sarmal" style="display:block;margin-top:12px"><input id="f01-alan" aria-label="Ad"></span>',
  '<div data-odak-zemin="nav" style="padding:8px;margin-top:12px"><a href="#/genel" id="f01-nav">Genel</a></div>',
  '</div>',
].join('');

async function mountNativeLayer(page: Page) {
  await openAdmin(page, '/alimlar');
  await page.evaluate(html => {
    const host = document.createElement('div');
    host.innerHTML = html;
    document.body.append(host.firstElementChild!);
  }, NATIVE_LAYER);
  const outside = await page.evaluate(() => {
    const layer = document.getElementById('f01-katman');
    return Boolean(layer) && !layer!.closest('.aile-admin');
  });
  expect(outside, 'deneme katmanı .aile-admin dışında değil').toBe(true);
  return page.locator('#f01-katman');
}

/** Token değerinin rgb karşılığı (--aile-odak / --aile-odak-nav). */
async function tokenRgb(page: Page, token: string) {
  return page.evaluate(name => {
    const probe = document.createElement('span');
    probe.style.color = `var(${name})`;
    document.body.append(probe);
    const rgb = getComputedStyle(probe).color;
    probe.remove();
    return rgb;
  }, token);
}

test.describe('yerel portallanan katman (.aile-admin dışında)', () => {
  test('klavye Tab yolu: düğme, sarmalanmış input ve nav bağlantısında tek çizgi, doğru token rengi; işaretçi çizgiyi kaldırır', async ({ page, browserName }) => {
    const layer = await mountNativeLayer(page);
    const odak = await tokenRgb(page, '--aile-odak');
    const odakNav = await tokenRgb(page, '--aile-odak-nav');
    expect(odak, 'odak ve odak-nav aynı renk: nav ayrımı ölçülemez').not.toBe(odakNav);
    const stops: [string, string][] = [['#f01-dugme', odak], ['#f01-alan', odak], ['#f01-nav', odakNav]];

    await keyboardFocus(page, browserName, page.locator('#f01-dugme'));
    for (const [index, [selector, color]] of stops.entries()) {
      if (index > 0) await page.keyboard.press(tabKey(browserName));
      await expect(page.locator(selector)).toBeFocused();
      await expectKeyboardIndicator(page, `yerel katman Tab ${index + 1}`);
      expect((await plan(page)).lines.map(line => line.color), `${selector}: çizgi rengi`).toEqual([color]);
      expect(await focusRing(page), `${selector}: paylaşılan dedektör`).toEqual([]);
    }
    for (const [selector, color] of stops.slice(0, -1).reverse()) {
      await page.keyboard.press(shiftTabKey(browserName));
      await expect(page.locator(selector)).toBeFocused();
      await expectKeyboardIndicator(page, `yerel katman Shift+Tab ${selector}`);
      expect((await plan(page)).lines.map(line => line.color), `${selector}: geri yönde çizgi rengi`).toEqual([color]);
    }
    expect(await focusInside(layer)).toBe(true);

    // İşaretçi: input'a dokunmak modu kapatır, odak input'ta kalır, çizgi yok.
    await page.locator('#f01-alan').click();
    await expect(page.locator('#f01-alan')).toBeFocused();
    expect(await keyboardMode(page)).toBe('false');
    await expectNoIndicator(page, 'yerel katman işaretçiyle input');
    // Düğme: WebKit (macOS) tıklamada düğmeye odak vermez; işaretçi modunda odak programatik verilir.
    await page.locator('#f01-dugme').click();
    await page.locator('#f01-dugme').focus();
    await expect(page.locator('#f01-dugme')).toBeFocused();
    await expectNoIndicator(page, 'yerel katman işaretçi modunda düğme');
    // Tab görsel modu yeniden açar.
    await page.keyboard.press(tabKey(browserName));
    await expect.poll(() => keyboardMode(page)).toBe('true');
    await expect(page.locator('#f01-alan')).toBeFocused();
    await expectKeyboardIndicator(page, 'yerel katman işaretçi sonrası Tab');
  });

  test('forced-colors: yerel katmanda yalnız klavye modunda 2px solid outline', async ({ page, browserName }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await mountNativeLayer(page);
    const active = await page.evaluate(() => matchMedia('(forced-colors: active)').matches);
    test.skip(!active, `${browserName}: forced-colors emülasyonu desteklenmiyor (not_applicable)`);
    await keyboardFocus(page, browserName, page.locator('#f01-dugme'));
    await settle(page);
    const keyboardOutline = await page.locator('#f01-dugme').evaluate(el => {
      const style = getComputedStyle(el);
      return `${style.outlineStyle} ${style.outlineWidth}`;
    });
    expect(keyboardOutline, 'klavye odağında forced-colors istisnası').toBe('solid 2px');
    expect(await focusRing(page), 'forced-colors klavye odağı').toEqual([]);
    await page.locator('#f01-dugme').click();
    await page.locator('#f01-dugme').focus();
    expect(await keyboardMode(page)).toBe('false');
    expect(await page.locator('#f01-dugme').evaluate(el => getComputedStyle(el).outlineStyle), 'işaretçi modunda outline').toBe('none');
  });
});

// --- Forced-colors istisnası ------------------------------------------------------------------------------------------

test.describe('forced-colors istisnası', () => {
  test('klavye modunda yalnız 2px solid CanvasText outline; işaretçi modunda outline yok', async ({ page, browserName }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await openAdmin(page, '/alimlar');
    const active = await page.evaluate(() => matchMedia('(forced-colors: active)').matches);
    test.skip(!active, `${browserName}: forced-colors emülasyonu desteklenmiyor (not_applicable)`);

    const search = page.getByRole('searchbox').first();
    await search.click();
    await expect(search).toBeFocused();
    await expectNoIndicator(page, 'forced-colors işaretçi modu');
    const pointerOutline = await search.evaluate(el => getComputedStyle(el).outlineStyle);
    expect(pointerOutline, 'işaretçi modunda outline').toBe('none');

    await page.keyboard.press(tabKey(browserName));
    await expect.poll(() => keyboardMode(page)).toBe('true');
    await settle(page);
    const outline = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      const probe = document.createElement('span');
      probe.style.color = 'CanvasText';
      document.body.append(probe);
      const canvasText = getComputedStyle(probe).color;
      probe.remove();
      const style = getComputedStyle(el);
      return { style: style.outlineStyle, width: style.outlineWidth, color: style.outlineColor, canvasText };
    });
    expect(outline.style, 'klavye odağında outline stili').toBe('solid');
    expect(outline.width).toBe('2px');
    expect(outline.color, 'outline rengi CanvasText değil').toBe(outline.canvasText);
    const violations = await focusRing(page);
    expect(violations, 'forced-colors klavye odağı').toEqual([]);
  });
});
