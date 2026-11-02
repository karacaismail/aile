import { test, expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { syntheticBridgeResponse } from '../src/dashboard/bridgeFixtures';
import { gviz, syntheticSheets } from '../src/dashboard/fixtures';
import { selfCheckDetectors, smallText } from './admin-detectors';
import { adminNotReadyReasons, openAdmin } from './admin-helpers';

// Kalıcı kural (CLAUDE.md › Minimum metin boyutu): web arayüzündeki tüm okunabilir metin en az 14 CSS px; gövde, tablo,
// etiket, rozet, yardımcı metin, form kontrolü/değeri/yer tutucusu, hata iletisi, çekmece, alt sayfa, menü, açılır liste
// ve diyalog dahil. Kök yazı boyutu kullanıcı tercihidir: 20 px'e büyütülünce de işlev bozulmaz.
//
// Kapsam (her test kendi kapsamını "kapsam" notuyla rapora yazar):
//  - 12 rota (11 sayfa + Ayarlar): ilk görünüm; dar profilde Sayfalar çekmecesi; varsa Filtreler çekmecesi ve içindeki
//    seçimler; varsa telefonda "Diğer" eylemler alt sayfası; ana içerikteki her etkin seçim (combobox) açıkken.
//  - Diyaloglar ve form hataları: Hesaplar (Hesap ekle, Borç ekle; telefonda Diğer → alt sayfa → diyalog), Sözlükler
//    (Terim ekle, boş gönderim alan hatası, diyalog içindeki Sözlük seçimi), Ayarlar (geçersiz Apps Script adresi).
//  - Alt görünümler: Raporlar'ın beş raporu, Sözlükler'in her sekmesi.
//  - Kök 20 px: her rota hazır, kök gerçekten 20 px, metin ≥14, sayfa yatay taşmaz, kontrol görünüm alanı dışına itilmez;
//    yolculuk: kabuktan gezinme, seçimle rapor değiştirme, form hatası.
//  Profil html[data-profile]'dan okunur (W0 AdaptiveRoot): phone | tablet | desktop. Görev koşusu chromium 320×568 ve
//  webkit 390×844; @matrix etiketli testler entegrasyonda 360/375/320×480/568×320/820/1440 projelerinde de koşar.
//
// Ölçüm: ortak e2e/admin-detectors.ts smallTextViolations (metin düğümü, form değeri/yer tutucusu, ::before/::after
// metni; display none, opacity 0, visibility hidden, kutusuz, ≤1 px ve sıfır kırpılmış "sr-only" metin hariç) + bu
// dosyadaki iki tamamlayıcı ölçüm: ::placeholder sözde öğesinin kendi boyutu ve SVG <text>'in ekran ölçeği
// (viewBox küçültmesi). Ölçülemeyen: ECharts canvas metni (Chart.tsx canvas renderer; değerler yanındaki tablo/metinde
// ölçülür) ve HTML transform ölçeği. Her ölçümden önce yazı tipleri yüklenir, sonlu animasyonlar biter ve DOM iki
// karede değişmez (sabit bekleme yok). Hazır sinyali openAdmin (e2e/admin-helpers.ts).
//
// Veri: dev sunucusu yalnız sentetik nesli verir (fixtures/generation-synthetic, VITE_BUDGET_SHEET_ID sentetik).
// Google'a çıkış yok: GViz bütçe okuması sentetik tabloyla (src/dashboard/fixtures) yanıtlanır, diğer her dış istek
// kesilir. Ayarlar alanına yalnız geçersiz örnek adres yazılır; Kaydet'e basılmaz, Sheets/Apps Script'e yazma yok.

const MIN_PX = 14;
const ROOT_PX = 20;
const MATRIX = { tag: '@matrix' } as const;

/** navigation.ts adminPages sırası + Ayarlar. "rota listesi" testi kabuktaki menüyle eşitliği denetler. */
const PAGE_ROUTES = [
  '/genel', '/butce', '/odemeler', '/hesaplar', '/alimlar', '/ev',
  '/projeler', '/taraflar', '/raporlar', '/sozlukler', '/veri',
] as const;
const ROUTES = [...PAGE_ROUTES, '/ayarlar'] as const;
/** RaporlarPage REPORTS sırası. */
const REPORTS = ['Aylık plan ve gerçek', 'Kaleme göre harcama', 'Borç ödeme planı', 'Oda bazında alımlar', 'Veri güveni özeti'] as const;

type Profile = 'phone' | 'tablet' | 'desktop';

// --- Ağ yalıtımı -----------------------------------------------------------------------------------------------------

const GVIZ = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/[^/]+\/gviz\/tq/;
const LEGACY_FEEDS = { Pano: 'summary', Plan: 'plan', 'Gerçekleşen': 'actual', 'Düzensiz giderler': 'irregular' } as const;

/** Yerel olmayan her istek: GViz → sentetik tablo (budget-dashboard.spec.ts ile aynı eşleme), diğerleri kesilir. */
async function isolateNetwork(page: Page) {
  const raw = syntheticSheets();
  await page.route((url) => /^https?:$/.test(url.protocol) && url.hostname !== '127.0.0.1', async (route) => {
    const url = route.request().url();
    if (!GVIZ.test(url)) return route.abort('blockedbyclient');
    const bridge = syntheticBridgeResponse(url);
    if (bridge) return route.fulfill({ contentType: 'application/json', body: bridge });
    const key = LEGACY_FEEDS[new URL(url).searchParams.get('sheet') as keyof typeof LEGACY_FEEDS];
    if (!key) return route.fulfill({ status: 404, body: 'Sentetik kaynakta yok' });
    const labels = key === 'plan' || key === 'actual' ? ['Kalem', ...raw.summary.map((row) => String(row[0]))] : undefined;
    const rows: unknown[][] = key === 'plan' || key === 'actual' ? raw[key].map((row) => row.slice(0, 4)) : raw[key];
    return route.fulfill({ contentType: 'application/json', body: gviz(rows, labels) });
  });
}

test.beforeEach(async ({ page }) => {
  await isolateNetwork(page);
});

// --- Ölçüm -----------------------------------------------------------------------------------------------------------

/**
 * Ortak dedektörün görmediği iki durum (sayfa bağlamında çalışır; dış kapsama başvurmaz):
 *  - boş alanın yer tutucusu kendi ::placeholder boyutuyla çizilir (ortak dedektör alanın boyutuna bakar);
 *  - SVG <text> ekranda font-size × ekran dönüşüm ölçeğiyle çizilir (viewBox küçültmesi metni 14 px altına indirir).
 */
function placeholderAndSvgText(min: number): string[] {
  const shown = (el: Element): boolean => {
    const probe = el as Element & { checkVisibility?: (options?: Record<string, boolean>) => boolean };
    if (typeof probe.checkVisibility === 'function' && !probe.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) return false;
    for (let node: Element | null = el; node; node = node.parentElement) {
      const cs = getComputedStyle(node);
      if (/rect\(0(px)?,? 0(px)?,? 0(px)?,? 0(px)?\)/.test(cs.clip) || cs.clipPath === 'inset(50%)') return false;
    }
    return true;
  };
  const label = (el: Element) => el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '') + (el.getAttribute('aria-label') ? `[${el.getAttribute('aria-label')}]` : '');
  const round = (n: number) => Math.round(n * 100) / 100;
  const out: string[] = [];
  const fields = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]), textarea');
  for (const field of Array.from(fields)) {
    const placeholder = (field.getAttribute('placeholder') || '').trim();
    if (field.value || !placeholder || !shown(field)) continue;
    const size = parseFloat(getComputedStyle(field, '::placeholder').fontSize);
    if (Number.isFinite(size) && size < min - 0.01) out.push(`${label(field)}::placeholder ${round(size)}px < ${min}px: "${placeholder.slice(0, 40)}"`);
  }
  for (const text of Array.from(document.querySelectorAll<SVGTextElement>('svg text'))) {
    const content = (text.textContent || '').replace(/\s+/g, ' ').trim();
    if (!content || !shown(text)) continue;
    const m = text.getScreenCTM();
    const size = parseFloat(getComputedStyle(text).fontSize) * (m ? Math.hypot(m.a, m.b) : 1);
    if (size < min - 0.01) out.push(`svg text (ekran ölçeği) ${round(size)}px < ${min}px: "${content.slice(0, 40)}"`);
  }
  return out;
}

async function textBelowMin(page: Page): Promise<string[]> {
  const shared = await smallText(page, { min: MIN_PX, max: 60 });
  const extra = await page.evaluate(placeholderAndSvgText, MIN_PX);
  return [...shared, ...extra];
}

/** İhlal satırındaki metin: ortak ve yerel dedektör satırı `…: "metin"` ile biter. */
const quoted = (lines: readonly string[]) => lines.map((line) => /: "(.*)"$/.exec(line)?.[1] ?? line);

let settleProbe = 0;
/**
 * Ölçüm öncesi kararlılık sinyali (sabit bekleme değil): yazı tipleri hazır, sonlu animasyon/geçiş kalmadı ve öğe sayısı
 * ile görünür metin uzunluğu art arda üç karede aynı. Sonsuz animasyonlar (yükleme şeridi) beklenmez.
 */
async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const key = `__aileMinTextSettle${++settleProbe}`;
  await page.waitForFunction((k) => {
    const store = window as unknown as Record<string, { sig: string; frames: number } | undefined>;
    const moving = document.getAnimations().some((a) => {
      if (a.playState !== 'running') return false;
      return Number.isFinite(Number(a.effect?.getComputedTiming().endTime ?? 0));
    });
    const sig = `${document.getElementsByTagName('*').length}:${document.body.innerText.length}`;
    const previous = store[k];
    const frames = !moving && previous?.sig === sig ? previous.frames + 1 : 0;
    store[k] = { sig, frames };
    return frames >= 2;
  }, key, { polling: 'raf', timeout: 10_000 });
}

/** Ölçülen durumları toplar; her durum ayrı yumuşak beklenti, test sonunda kapsam notu. */
class MinTextReport {
  private readonly states: string[] = [];

  constructor(private readonly page: Page, private readonly info: TestInfo, private readonly scope: string) {}

  async check(state: string) {
    await settle(this.page);
    const found = await textBelowMin(this.page);
    expect.soft(found, `${this.scope} › ${state}: ${MIN_PX} CSS px altında görünür metin`).toEqual([]);
    this.states.push(state);
  }

  get measured(): readonly string[] {
    return this.states;
  }

  done() {
    this.info.annotations.push({ type: 'kapsam', description: `${this.scope}: ${this.states.join(' · ')}` });
  }
}

// --- Katmanlar -------------------------------------------------------------------------------------------------------

async function profileOf(page: Page): Promise<Profile> {
  const profile = await page.evaluate(() => document.documentElement.dataset.profile);
  expect(['phone', 'tablet', 'desktop'], 'html[data-profile] (AdaptiveRoot)').toContain(profile);
  return profile as Profile;
}

const visibleDialogs = (page: Page) => page.getByRole('dialog').filter({ visible: true });
/** Beklemeden okur (ayrılmış/yok öğe = false); Locator.getAttribute öğe yoksa beklerdi. */
const expanded = (trigger: Locator) => trigger.evaluateAll((els) => els.some((el) => el.getAttribute('aria-expanded') === 'true'));

async function accessibleName(control: Locator): Promise<string> {
  return control.evaluate((el) => {
    const byIds = (ids: string | null) => (ids ?? '').split(/\s+/).map((id) => document.getElementById(id)?.textContent?.trim() ?? '').filter(Boolean).join(' ');
    return (el.getAttribute('aria-label') || byIds(el.getAttribute('aria-labelledby')) || (el as HTMLInputElement).labels?.[0]?.textContent?.trim() || '').trim();
  });
}

async function enabledComboboxes(scope: Locator): Promise<Locator[]> {
  const out: Locator[] = [];
  for (const combo of await scope.getByRole('combobox').filter({ visible: true }).all()) {
    if (await combo.isEnabled()) out.push(combo);
  }
  return out;
}

type LayerKind = 'diyalog' | 'liste';

/**
 * Tetiği açar ve açılan katmanı bekler: yeni görünür dialog (çekmece, alt sayfa, diyalog) ya da tetikte
 * aria-expanded="true" (yerinde/portal liste). Ölçer, `inside` ile iç adımları çalıştırır, Escape ile kapatır ve
 * kapandığını doğrular. Sunum (alt sayfa mı liste mi) bu dosyanın değil, katman testlerinin konusudur; burada yalnız
 * açık katmanın metni ölçülür.
 */
async function withLayer(
  page: Page,
  report: MinTextReport,
  trigger: Locator,
  what: string,
  inside?: (layer: Locator | null) => Promise<void>,
): Promise<LayerKind> {
  const before = await visibleDialogs(page).count();
  await trigger.click();
  const state = async (): Promise<LayerKind | 'kapalı'> => {
    if ((await visibleDialogs(page).count()) > before) return 'diyalog';
    return (await expanded(trigger)) ? 'liste' : 'kapalı';
  };
  await expect.poll(state, { message: `${what}: tıklamadan sonra katman açılmadı (yeni dialog ya da aria-expanded="true" yok)` }).not.toBe('kapalı');
  const kind = (await state()) as LayerKind;
  await report.check(`${what} açık (${kind})`);
  if (inside) await inside(kind === 'diyalog' ? visibleDialogs(page).last() : null);
  if ((await visibleDialogs(page).count()) > before || (await expanded(trigger))) await page.keyboard.press('Escape');
  await expect
    .poll(async () => (await visibleDialogs(page).count()) <= before && !(await expanded(trigger)), { message: `${what}: Escape katmanı kapatmadı` })
    .toBe(true);
  return kind;
}

/** Seçimde `name` seçeneğini seçer: alt sayfada role=option, listede aria-selected taşıyan görünür öğe. */
async function choose(page: Page, combo: Locator, name: string) {
  const before = await visibleDialogs(page).count();
  await combo.click();
  await expect.poll(async () => (await visibleDialogs(page).count()) > before || (await expanded(combo)), { message: `${name}: seçim açılmadı` }).toBe(true);
  if ((await visibleDialogs(page).count()) > before) {
    await visibleDialogs(page).last().getByRole('option', { name, exact: true }).click();
  } else {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    await page.locator('[aria-selected]').filter({ visible: true }).filter({ hasText: new RegExp(`^\\s*${escaped}`) }).first().click();
  }
  await expect.poll(async () => (await visibleDialogs(page).count()) <= before && !(await expanded(combo)), { message: `${name}: seçimden sonra katman kapanmadı` }).toBe(true);
}

/** Seçimin seçenek adları (açar, okur, kapatır): alt sayfada role=option adı, listede aria-selected öğenin title/metni. */
async function optionNames(page: Page, combo: Locator): Promise<string[]> {
  const before = await visibleDialogs(page).count();
  await combo.click();
  await expect.poll(async () => (await visibleDialogs(page).count()) > before || (await expanded(combo)), { message: 'seçim açılmadı' }).toBe(true);
  const sheet = (await visibleDialogs(page).count()) > before;
  const items = sheet ? visibleDialogs(page).last().getByRole('option') : page.locator('[aria-selected]').filter({ visible: true });
  await expect(items.first()).toBeVisible();
  const names = await items.evaluateAll((els) => els
    .filter((el) => el.getAttribute('aria-disabled') !== 'true')
    .map((el) => {
      const labelled = (el.getAttribute('aria-labelledby') ?? '').split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
      return (el.getAttribute('title') || labelled || el.textContent || '').replace(/\s+/g, ' ').trim();
    })
    .filter(Boolean));
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await visibleDialogs(page).count()) <= before && !(await expanded(combo)), { message: 'seçim kapanmadı' }).toBe(true);
  return names;
}

/** Uygulama içi gezinmeden sonra openAdmin ile aynı hazır sinyali (h1 görünür ve dolu, aria-busy yok). */
async function waitReady(page: Page) {
  await page.waitForFunction(`(${adminNotReadyReasons.toString()})().length === 0`, undefined, { polling: 'raf', timeout: 20_000 });
}

/** Kabuktan gezinme: masaüstünde kalıcı nav, dar profilde Sayfalar çekmecesi. */
async function navigate(page: Page, profile: Profile, label: string) {
  if (profile === 'desktop') {
    // Kalıcı nav: sayfalar "Sayfalar" menüsünde, Ayarlar ayırıcıdan sonraki yardımcı menüde; ana içerikteki bağlantı sayılmaz.
    const links = page.getByRole('link', { name: label, exact: true }).filter({ visible: true });
    const index = await links.evaluateAll((els) => els.findIndex((el) => !el.closest('main#admin-content')));
    expect(index, `kabukta "${label}" bağlantısı`).toBeGreaterThanOrEqual(0);
    await links.nth(index).click();
  } else {
    await page.getByRole('button', { name: 'Sayfalar', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: 'Sayfalar' });
    await expect(drawer).toBeVisible();
    await drawer.getByRole('link', { name: label, exact: true }).click();
    await expect(drawer).toBeHidden();
  }
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(label);
  await waitReady(page);
}

// --- Kök yazı boyutu -------------------------------------------------------------------------------------------------

/**
 * Kullanıcının kök yazı boyutunu 20 px yapar. Chromium: tarayıcı tercihi (CDP Page.setFontSizes standard=20, ayarlar ›
 * yazı tipi boyutu ile aynı yol); uygulama html boyutunu ezerse kök 20 px okunmaz ve test düşer. WebKit'te protokol yok:
 * html satır içi font-size 20 px (rem/em zinciri için aynı etki), belge oluşur oluşmaz.
 */
async function growRootFont(page: Page, browserName: string): Promise<string> {
  if (browserName === 'chromium') {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Page.setFontSizes', { fontSizes: { standard: ROOT_PX } });
    return `tarayıcı tercihi ${ROOT_PX} px (CDP)`;
  }
  await page.addInitScript((px) => {
    const apply = () => document.documentElement.style.setProperty('font-size', `${px}px`);
    if (document.documentElement) apply();
    else new MutationObserver((_, observer) => {
      if (!document.documentElement) return;
      apply();
      observer.disconnect();
    }).observe(document, { childList: true });
  }, ROOT_PX);
  return `html satır içi ${ROOT_PX} px`;
}

/** Sayfa yatay kaymaz ve görünür kontroller (kendi kaydırma kabı dışında) görünüm alanından dışarı itilmez. */
async function layoutBreaks(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const root = document.scrollingElement ?? document.documentElement;
    const width = document.documentElement.clientWidth;
    const scrollsX = (el: Element) => /(auto|scroll)/.test(getComputedStyle(el).overflowX) && el.scrollWidth > el.clientWidth + 1;
    const one = (el: Element) => {
      const cls = typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/)[0]}` : '';
      return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls}`;
    };
    const describe = (el: Element) => {
      const named = el.parentElement?.closest('[class]');
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 32);
      return `${named ? `${one(named)} › ` : ''}${one(el)}${text ? ` "${text}"` : ''}`;
    };
    if (root.scrollWidth - root.clientWidth > 1) {
      // Taşan en içteki öğeler (kendi kaydırma kabı dışında): sahibinin yeniden üretebilmesi için.
      const wide = Array.from(document.body.querySelectorAll('*')).filter((el) => {
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.right <= width + 1) return false;
        for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) if (scrollsX(node)) return false;
        return true;
      });
      const innermost = wide.filter((el) => !wide.some((other) => other !== el && el.contains(other)));
      const culprits = innermost.slice(0, 5).map((el) => `${describe(el)} sağ ${Math.round(el.getBoundingClientRect().right)}`);
      out.push(`sayfa yatay taşıyor: scrollWidth ${root.scrollWidth} > ${root.clientWidth} (${culprits.join('; ') || 'öğe bulunamadı'})`);
    }
    const controls = document.querySelectorAll('main#admin-content :is(a[href], button, input, select, textarea, [role="button"], [role="combobox"], [role="tab"], [role="link"])');
    for (const el of Array.from(controls)) {
      const probe = el as Element & { checkVisibility?: (options?: Record<string, boolean>) => boolean };
      if (typeof probe.checkVisibility === 'function' && !probe.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1) continue;
      let inScroller = false;
      for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
        if (scrollsX(node)) { inScroller = true; break; }
      }
      if (inScroller) continue;
      if (r.left < -1 || r.right > width + 1) {
        const name = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
        out.push(`${el.tagName.toLowerCase()} "${name}" görünüm alanı dışında: ${Math.round(r.left)}–${Math.round(r.right)} / ${width}`);
      }
    }
    return out.slice(0, 20);
  });
}

// --- Testler ---------------------------------------------------------------------------------------------------------

test.describe('admin görünür metin en az 14 CSS px', () => {
  for (const route of ROUTES) {
    test(`${route}: ilk görünüm ve açılan katmanlar`, MATRIX, async ({ page }, testInfo) => {
      const main = await openAdmin(page, route);
      const profile = await profileOf(page);
      const report = new MinTextReport(page, testInfo, `${route} (${profile})`);
      await report.check('ilk görünüm');

      // Telefonda tablolar akordeondur (ilk açık); kapalı satırların içeriği de ölçülsün diye "Tümünü aç".
      const expandAll = main.getByRole('button', { name: 'Tümünü aç', exact: true }).filter({ visible: true });
      let expandedGroups = 0;
      for (; expandedGroups < 10 && (await expandAll.count()) > 0; expandedGroups += 1) {
        const before = await expandAll.count();
        await expandAll.first().click();
        await expect(expandAll).toHaveCount(before - 1);
      }
      if (expandedGroups > 0) await report.check(`${expandedGroups} akordeon grubu tümü açık`);

      if (profile !== 'desktop') {
        await withLayer(page, report, page.getByRole('button', { name: 'Sayfalar', exact: true }), 'Sayfalar çekmecesi');
      }

      const filters = main.getByRole('button', { name: /^Filtreler \(/ }).filter({ visible: true });
      if ((await filters.count()) > 0) {
        await withLayer(page, report, filters.first(), 'Filtreler çekmecesi', async (drawer) => {
          if (!drawer) return;
          for (const combo of await enabledComboboxes(drawer)) {
            await withLayer(page, report, combo, `Filtreler › seçim "${await accessibleName(combo)}"`);
          }
        });
      }

      const more = main.getByRole('button', { name: 'Diğer', exact: true }).filter({ visible: true });
      if ((await more.count()) > 0) await withLayer(page, report, more.first(), 'Diğer eylemler');

      for (const combo of await enabledComboboxes(main)) {
        await withLayer(page, report, combo, `seçim "${await accessibleName(combo)}"`);
      }
      report.done();
    });
  }

  test('Hesaplar: Hesap ekle ve Borç ekle diyalogları; telefonda Diğer eylemler alt sayfası', MATRIX, async ({ page }, testInfo) => {
    const main = await openAdmin(page, '/hesaplar');
    const profile = await profileOf(page);
    const report = new MinTextReport(page, testInfo, `/hesaplar (${profile})`);

    const hesap = await withLayer(page, report, main.getByRole('button', { name: 'Hesap ekle', exact: true }), 'Hesap ekle diyaloğu');
    expect(hesap, 'Hesap ekle bir diyalog açar').toBe('diyalog');

    if (profile === 'phone') {
      // Telefonda ikincil eylem "Diğer" alt sayfasında; oradan seçilen eylem diyaloğu (telefonda alt sayfa) açar.
      const more = main.getByRole('button', { name: 'Diğer', exact: true });
      await more.click();
      const sheet = page.getByRole('dialog', { name: 'Diğer eylemler' });
      await expect(sheet).toBeVisible();
      await report.check('Diğer eylemler alt sayfası açık');
      await sheet.getByRole('menuitem', { name: 'Borç ekle' }).click();
      const dialog = page.getByRole('dialog', { name: 'Borç ekle' });
      await expect(dialog).toBeVisible();
      await report.check('Borç ekle diyaloğu açık (Diğer alt sayfasından)');
      await page.keyboard.press('Escape');
      await expect(visibleDialogs(page)).toHaveCount(0);
    } else {
      const borc = await withLayer(page, report, main.getByRole('button', { name: 'Borç ekle', exact: true }), 'Borç ekle diyaloğu');
      expect(borc, 'Borç ekle bir diyalog açar').toBe('diyalog');
    }
    report.done();
  });

  test('Sözlükler: Terim ekle diyaloğu, boş gönderimde alan hatası ve diyalogdaki Sözlük seçimi', MATRIX, async ({ page }, testInfo) => {
    const main = await openAdmin(page, '/sozlukler');
    const profile = await profileOf(page);
    const report = new MinTextReport(page, testInfo, `/sozlukler (${profile})`);

    await main.getByRole('button', { name: 'Terim ekle', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Terim ekle' });
    await expect(dialog).toBeVisible();
    await report.check('Terim ekle diyaloğu açık');

    // Boş terim adıyla gönderim kayıt yazmaz; alan hatası "Hata: …" ile görünür (TextField sözleşmesi).
    await dialog.getByRole('button', { name: 'Öneri olarak kaydet', exact: true }).click();
    await expect(dialog.getByText('Terim adı boş olamaz')).toBeVisible();
    await expect(dialog.getByRole('textbox', { name: /Terim adı/ })).toHaveAttribute('aria-invalid', 'true');
    await report.check('Terim adı alan hatası görünür');

    const combo = dialog.getByRole('combobox', { name: 'Sözlük' });
    await withLayer(page, report, combo, 'diyalogdaki Sözlük seçimi');
    await expect(dialog, 'iç seçim kapanınca diyalog açık kalır').toBeVisible();

    // Kapatma yolu (Escape/odak dönüşü) odak ve diyalog testlerinin konusudur; burada kayıt yazmayan Vazgeç kullanılır.
    await dialog.getByRole('button', { name: 'Vazgeç', exact: true }).click();
    await expect(visibleDialogs(page)).toHaveCount(0);
    report.done();
  });

  test('Ayarlar: geçersiz Apps Script adresinde alan hatası ve altlık durumu', MATRIX, async ({ page }, testInfo) => {
    const main = await openAdmin(page, '/ayarlar');
    const profile = await profileOf(page);
    const report = new MinTextReport(page, testInfo, `/ayarlar (${profile})`);

    const field = main.getByRole('textbox', { name: /Apps Script adresi/ });
    await field.fill('gecersiz-adres');
    await expect(main.getByText(/^Hata: Adres .+ biçiminde olmalı$/).first()).toBeVisible();
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    await expect(main.getByRole('button', { name: 'Kaydet', exact: true })).toBeDisabled();
    await report.check('Apps Script adresi alan hatası ve altlık durumu');

    await field.fill('');
    await expect(main.getByText(/^Hata: Adres .+ biçiminde olmalı$/)).toHaveCount(0);
    report.done();
  });

  test('Raporlar: beş raporun her biri (dar profilde Rapor seçimiyle)', MATRIX, async ({ page }, testInfo) => {
    const main = await openAdmin(page, '/raporlar');
    const profile = await profileOf(page);
    const report = new MinTextReport(page, testInfo, `/raporlar (${profile})`);
    const reportMenu = page.getByRole('navigation', { name: 'Raporlar' });
    const reportSelect = main.getByRole('combobox', { name: 'Rapor' });
    const wide = await reportMenu.isVisible();

    // Varsayılan rapor ilk görünümdedir; diğer dördü seçilir ve içerik değişmeden ölçülmez.
    await report.check(`rapor "${REPORTS[0]}" (varsayılan)`);
    if (!wide) {
      const kind = await withLayer(page, report, reportSelect, 'Rapor seçimi');
      if (profile === 'phone') expect(kind, 'telefonda Rapor seçimi alt sayfada açılır').toBe('diyalog');
    }
    for (const name of REPORTS.slice(1)) {
      const before = await main.innerText();
      if (wide) await reportMenu.getByText(name, { exact: true }).click();
      else await choose(page, reportSelect, name);
      await expect.poll(() => main.innerText(), { message: `rapor "${name}" seçilince içerik değişir` }).not.toBe(before);
      await waitReady(page);
      await report.check(`rapor "${name}"`);
    }
    report.done();
  });

  test('Sözlükler: her sözlük sekmesi', MATRIX, async ({ page }, testInfo) => {
    const main = await openAdmin(page, '/sozlukler');
    const profile = await profileOf(page);
    const report = new MinTextReport(page, testInfo, `/sozlukler (${profile})`);
    const tabs = main.getByRole('group', { name: 'Sözlük' }).getByRole('tab');
    const select = main.getByRole('combobox', { name: 'Sözlük' });

    if ((await tabs.filter({ visible: true }).count()) > 0) {
      const visibleTabs = tabs.filter({ visible: true });
      const count = await visibleTabs.count();
      expect(count, 'sözlük sekmeleri').toBeGreaterThan(1);
      for (let i = 0; i < count; i += 1) {
        const tab = visibleTabs.nth(i);
        const name = (await tab.innerText()).trim();
        if ((await tab.getAttribute('aria-disabled')) === 'true') continue;
        await tab.click();
        await expect(tab).toHaveAttribute('aria-selected', 'true');
        await report.check(`sekme "${name}"`);
      }
    } else {
      await expect(select, 'dar profilde sekmeler seçime düşer').toBeVisible();
      const names = await optionNames(page, select);
      expect(names.length, 'sözlük seçenekleri').toBeGreaterThan(1);
      for (const name of names) {
        await choose(page, select, name);
        await report.check(`sekme "${name}"`);
      }
    }
    expect(report.measured.length, 'en az iki sekme ölçüldü').toBeGreaterThan(1);
    report.done();
  });

  test('rota listesi kabuktaki menüyle aynı (12 rota)', async ({ page }) => {
    await openAdmin(page, '/genel');
    const profile = await profileOf(page);
    let scope: Locator;
    if (profile === 'desktop') {
      scope = page.locator('body');
    } else {
      await page.getByRole('button', { name: 'Sayfalar', exact: true }).click();
      scope = page.getByRole('dialog', { name: 'Sayfalar' });
      await expect(scope).toBeVisible();
    }
    const hrefs = await scope
      .getByRole('navigation', { name: 'Sayfalar' })
      .locator('a[href^="#/"]')
      .evaluateAll((links) => links.map((a) => (a.getAttribute('href') ?? '').slice(1)));
    expect(hrefs.filter((href) => href !== '/ayarlar')).toEqual([...PAGE_ROUTES]);
    await expect(scope.getByRole('link', { name: 'Ayarlar' }).first()).toHaveAttribute('href', '#/ayarlar');
    expect(ROUTES).toHaveLength(12);
  });
});

test.describe(`kök yazı boyutu ${ROOT_PX} px: işlev bozulmaz`, () => {
  for (const route of ROUTES) {
    test(`${route}: hazır, metin ≥14, sayfa taşmaz`, MATRIX, async ({ page, browserName }, testInfo) => {
      const how = await growRootFont(page, browserName);
      await openAdmin(page, route);
      const profile = await profileOf(page);
      testInfo.annotations.push({ type: 'kök', description: how });
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize), 'kök yazı boyutu kullanıcı tercihinde').toBe(`${ROOT_PX}px`);
      const report = new MinTextReport(page, testInfo, `${route} kök ${ROOT_PX} px (${profile})`);
      await report.check('ilk görünüm');
      expect.soft(await layoutBreaks(page), `${route} kök ${ROOT_PX} px: yerleşim`).toEqual([]);
      report.done();
    });
  }

  test('yolculuk: kabuktan gezinme, rapor seçimi ve form hatası', MATRIX, async ({ page, browserName }, testInfo) => {
    const how = await growRootFont(page, browserName);
    testInfo.annotations.push({ type: 'kök', description: how });
    await openAdmin(page, '/genel');
    const profile = await profileOf(page);
    const report = new MinTextReport(page, testInfo, `kök ${ROOT_PX} px yolculuk (${profile})`);

    await navigate(page, profile, 'Raporlar');
    await report.check('Raporlar');
    const main = page.locator('main#admin-content');
    const reportMenu = page.getByRole('navigation', { name: 'Raporlar' });
    const before = await main.innerText();
    if (await reportMenu.isVisible()) {
      await reportMenu.getByText('Kaleme göre harcama', { exact: true }).click();
    } else {
      await choose(page, main.getByRole('combobox', { name: 'Rapor' }), 'Kaleme göre harcama');
    }
    await expect.poll(() => main.innerText(), { message: 'rapor seçilince içerik değişir' }).not.toBe(before);
    await waitReady(page);
    await report.check('rapor "Kaleme göre harcama"');
    expect.soft(await layoutBreaks(page), 'Raporlar yerleşimi').toEqual([]);

    await navigate(page, profile, 'Ayarlar');
    const field = main.getByRole('textbox', { name: /Apps Script adresi/ });
    await field.fill('gecersiz-adres');
    await expect(main.getByText(/^Hata: Adres .+ biçiminde olmalı$/).first()).toBeVisible();
    await expect(main.getByRole('button', { name: 'Kaydet', exact: true })).toBeDisabled();
    await report.check('Ayarlar alan hatası');
    expect.soft(await layoutBreaks(page), 'Ayarlar yerleşimi').toEqual([]);
    await field.fill('');
    await expect(main.getByText(/^Hata: Adres .+ biçiminde olmalı$/)).toHaveCount(0);
    report.done();
  });
});

test.describe('öz denetim: 14 px dedektörleri kör değil', () => {
  test('bilinen belgede ihlalleri yakalar, görünmez ve sr-only metni saymaz', async ({ page }) => {
    await page.setContent(`<!doctype html>
      <html lang="tr"><head><style>
        body { font-size: 16px; margin: 0; }
        .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
        .ip { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
        .rozet::after { content: "Sözde rozet"; font-size: 11px; }
        .ph::placeholder { font-size: 10px; }
      </style></head><body><main>
        <p style="font-size:14px">Yeterli metin</p>
        <p style="font-size:16px">Büyük <span style="font-size:13px">Küçük ihlal</span></p>
        <p style="font-size:0.8rem">Rem küçük</p>
        <span class="rozet"></span>
        <p style="display:none;font-size:10px">Gizli display</p>
        <p style="visibility:hidden;font-size:10px">Gizli visibility</p>
        <p style="opacity:0;font-size:10px">Gizli opaklık</p>
        <div style="display:none"><span style="font-size:10px">Üstü gizli küçük</span></div>
        <span class="sr" style="font-size:10px">Ekran okuyucu</span>
        <span class="ip" style="font-size:10px">Kırpılmış</span>
        <p style="font-size:12px">   </p>
        <div style="font-size:12px"><b style="font-size:16px">İç büyük</b></div>
        <label>Değer <input aria-label="Değer" value="Küçük değer" style="font-size:12px"></label>
        <input aria-label="Boş" style="font-size:12px">
        <input aria-label="Yer tutucu" placeholder="Küçük yer tutucu" style="font-size:12px">
        <input aria-label="Sözde yer tutucu" class="ph" placeholder="Sözde küçük yer tutucu" style="font-size:16px">
        <input aria-label="Yeterli" placeholder="Yeterli yer tutucu" style="font-size:14px">
        <svg width="100" height="20" viewBox="0 0 200 40"><text x="0" y="30" font-size="20">SVG küçültülmüş</text></svg>
        <svg width="200" height="40" viewBox="0 0 200 40"><text x="0" y="30" font-size="16">SVG yeterli</text></svg>
      </main></body></html>`);

    const shared = await smallText(page, { min: MIN_PX, max: 60 });
    expect(quoted(shared).sort(), 'ortak dedektör').toEqual(['Küçük değer', 'Küçük ihlal', 'Küçük yer tutucu', 'Rem küçük', 'Sözde rozet'].sort());
    expect(shared.find((line) => line.includes('"Küçük ihlal"'))).toContain('13px');
    expect(shared.find((line) => line.includes('"Rem küçük"'))).toContain('12.8px');

    const extra = await page.evaluate(placeholderAndSvgText, MIN_PX);
    expect(quoted(extra).sort(), 'tamamlayıcı ölçüm (::placeholder, SVG ölçeği)').toEqual(['Küçük yer tutucu', 'SVG küçültülmüş', 'Sözde küçük yer tutucu'].sort());
    expect(extra.find((line) => line.includes('"SVG küçültülmüş"'))).toContain(' 10px');
    expect(extra.find((line) => line.includes('"Sözde küçük yer tutucu"'))).toContain(' 10px');
  });

  test('gerçek sayfada içerik, portal, sözde öğe, yer tutucu ve açık diyalog içindeki ihlali yakalar', async ({ page }) => {
    const main = await openAdmin(page, '/hesaplar');
    const before = quoted(await textBelowMin(page));
    await page.evaluate(() => {
      const style = document.createElement('style');
      style.dataset.minTextSelfcheck = '';
      style.textContent = '[data-min-text-rozet]::after{content:"Enjekte sözde";font-size:11px}[data-min-text-ph]::placeholder{font-size:10px}';
      document.head.append(style);
      const main = document.querySelector('main#admin-content');
      const add = (parent: Element | null | undefined, tag: string, css: string, text = '') => {
        const el = document.createElement(tag);
        el.style.cssText = css;
        el.textContent = text;
        el.dataset.minTextSelfcheck = '';
        parent?.append(el);
        return el;
      };
      add(main, 'p', 'font-size:12px', 'Enjekte içerik');
      add(document.body, 'div', 'position:fixed;left:0;top:0;font-size:13px;z-index:9999', 'Enjekte portal');
      add(main, 'span', 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);font-size:10px', 'Enjekte gizli');
      add(main, 'span', 'font-size:16px').setAttribute('data-min-text-rozet', '');
      const input = add(main, 'input', 'font-size:16px;width:200px') as HTMLInputElement;
      input.placeholder = 'Enjekte yer tutucu';
      input.setAttribute('aria-label', 'Enjekte alan');
      input.setAttribute('data-min-text-ph', '');
    });
    const after = quoted(await textBelowMin(page));
    expect(after.filter((text) => !before.includes(text)).sort()).toEqual(['Enjekte içerik', 'Enjekte portal', 'Enjekte sözde', 'Enjekte yer tutucu'].sort());
    expect(after).not.toContain('Enjekte gizli');

    // Açık katman (diyalog / telefonda alt sayfa) portalda; içine konan ihlal de ölçülür.
    await page.evaluate(() => document.querySelectorAll('[data-min-text-selfcheck]').forEach((el) => el.remove()));
    await main.getByRole('button', { name: 'Hesap ekle', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Hesap ekle' });
    await expect(dialog).toBeVisible();
    await dialog.evaluate((el) => {
      const small = document.createElement('span');
      small.textContent = 'Diyalog içi ihlal';
      small.style.fontSize = '12px';
      el.append(small);
    });
    await settle(page);
    expect(quoted(await textBelowMin(page))).toContain('Diyalog içi ihlal');
  });

  test('ortak dedektör öz denetimi bu motorda geçer', async ({ page }) => {
    await openAdmin(page, '/genel');
    expect(await selfCheckDetectors(page), 'ihlali yakalamayan dedektörler').toEqual([]);
  });
});
