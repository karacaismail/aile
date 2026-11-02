import { test, expect, type Locator, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { enterKeyboardMode, gotoAdmin, horizontalOverflow } from './admin-helpers';

// aile yönetim paneli tipografi kapısı (tasarim-sistemi/README.md › Tipografi, İçerik ilkeleri; tokens.json › type):
//   - Outfit web fontu gerçekten yüklenir (document.fonts: @font-face tanımı + yüklü yüz + check) ve kabuğun ilk ailesidir;
//     Türkçe harfler (İ ı Ğ ğ Ş ş Ç Ö Ü) Outfit glifinden çizilir, yedek fonta düşmez.
//   - h1 1440 px'te 32/40, 600; 320 px'te en az 24 px, 600; kelime ortasından bölünmez, belgeyi yatay taşırmaz.
//   - Tablo başlıkları word-break: keep-all, overflow-wrap: normal; hiçbir kelime iki satıra bölünmez, hücreden taşmaz.
//   - Türkçe karakterli etiketler görünür: kesilmez (ellipsis/clip), 14 px altına inmez, büyük harf dönüşümü yalnız lang=tr.
//   - Para ₺8.500,00 (tr-TR, iki ondalık, ₺ önde), tabular-nums; tablo hücresinde sağa hizalı.
// Dedektörler sayfaya tek betik olarak kurulur (window.__aileTypography) ve "dedektör öz denetimi" bloğu, ihlal enjekte
// edilmiş sayfada her birinin gerçekten yakaladığını, uygun sayfada sessiz kaldığını kanıtlar. Ortak admin-detectors.ts
// tipografi dedektörü (Outfit, keep-all, Türkçe glif, para biçimi) sunmadığı için bu dosyada yerel tanımlıdır.
// Veri: sentetik nesil (fixtures/generation-synthetic) /__aile/generation/* isteklerine route ile verilir; gerçek veri yok.

interface OutfitReport {
  /** document.fonts içindeki Outfit @font-face sayısı (sistem fontu sayılmaz). */
  declared: number;
  /** status === 'loaded' olan Outfit yüzlerinin ağırlıkları. */
  loaded: string[];
  /** document.fonts.load(...) ile eşleşen yüz sayısı; sıra: 400 16px, 600 32px. */
  matched: number[];
  /** document.fonts.check(...) sonucu; sıra aynı. */
  check: boolean[];
}
interface Findings { count: number; issues: string[] }
interface TurkishReport extends Findings { chars: string }
interface MoneyReport { values: string[]; issues: string[] }
interface TypographyDetectors {
  outfit(sample: string): Promise<OutfitReport>;
  glyphGaps(chars: string, family: string): Promise<string[]>;
  wordBreaks(selector: string, requireKeepAll: boolean): Findings;
  turkishLabels(root: string): TurkishReport;
  money(root: string, cellAlign: boolean): MoneyReport;
}

declare global {
  interface Window { __aileTypography?: TypographyDetectors }
}

// --- Sayfa içi dedektörler (kendi kendine yeter; dış kapsamdan değişken kullanmaz, toString ile sayfaya kurulur) ------
function typographyDetectors(): TypographyDetectors {
  const TURKISH = /[İıĞğŞşÇçÖöÜü]/u;
  const MONEY_OK = /^-?₺(?:0|[1-9]\d{0,2}(?:\.\d{3})*),\d{2}$/u;
  const MONEY_TOKEN = /-?₺\s*\d[\d.,]*|\d[\d.,]*\s*(?:₺|TL)(?![\p{L}\p{N}])/gu;
  const WORD = /[\p{L}\p{N}]+(?:[.,'’][\p{L}\p{N}]+)*/gu;
  const MIN_TEXT = 14;

  const describe = (el: Element) => {
    const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 48);
    return `${el.tagName.toLowerCase()} "${text}"`;
  };
  const firstFamily = (el: Element) => (getComputedStyle(el).fontFamily.split(',')[0] ?? '').replace(/["']/g, '').trim().toLowerCase();

  /** Görünür mü: gizli ata, display/visibility/opacity, görsel gizli (clip/clip-path, ≤1 px) ve ekran dışı elenir. */
  const visible = (el: Element) => {
    if (el.closest('[aria-hidden="true"], [hidden], [inert]')) return false;
    const own = getComputedStyle(el);
    if (own.visibility !== 'visible' || own.display === 'none') return false;
    for (let node: Element | null = el; node && node !== document.documentElement; node = node.parentElement) {
      const cs = getComputedStyle(node);
      if (cs.opacity === '0') return false;
      if (cs.clipPath !== 'none' && cs.clipPath !== '') return false;
      if (cs.clip !== 'auto' && cs.clip !== '' && cs.position === 'absolute') return false;
    }
    const r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) return false;
    return r.right > 0 && r.bottom > 0;
  };

  /** Kesilme: kendisi ya da yakın atası ellipsis/hidden/clip/line-clamp ile içeriği gizliyor. */
  const truncated = (el: Element): string | null => {
    let node: Element | null = el;
    for (let depth = 0; node && depth < 4 && node !== document.body; depth += 1, node = node.parentElement) {
      const cs = getComputedStyle(node);
      const clipsX = cs.textOverflow === 'ellipsis' || ['hidden', 'clip'].includes(cs.overflowX);
      if (clipsX && node.scrollWidth > node.clientWidth + 1) return `${describe(node)} yatayda kesildi (${node.scrollWidth}>${node.clientWidth})`;
      const clamp = cs.getPropertyValue('-webkit-line-clamp');
      if (clamp && clamp !== 'none' && node.scrollHeight > node.clientHeight + 1) return `${describe(node)} satır sınırıyla kesildi`;
    }
    return null;
  };

  const textNodes = (root: Element) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);
    return nodes;
  };

  /** Bir kelimenin kaç ayrı satıra yayıldığı (Range.getClientRects, 2 px tolerans). */
  const wordLines = (node: Text, start: number, end: number) => {
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    const tops: number[] = [];
    for (const rect of Array.from(range.getClientRects())) {
      if (rect.width <= 0) continue;
      if (!tops.some(top => Math.abs(top - rect.top) <= 2)) tops.push(rect.top);
    }
    return tops.length;
  };

  /**
   * Metnin kutudan taşması: görünür metin düğümlerinin satır kutuları elemanın dolgu kutusu (clientLeft/clientWidth)
   * dışına çıkıyor mu. scrollWidth kullanılmaz; o, metin olmayan mutlak süsleri de sayar (ör. antd yapışkan sütun
   * gölgesi ::after, hücrenin 30 px sağına uzanır) ve metin taşmasını onlardan ayıramaz.
   */
  const textOverflow = (el: Element): string | null => {
    const box = el.getBoundingClientRect();
    const left = box.left + el.clientLeft;
    const right = left + el.clientWidth;
    let minLeft = Infinity;
    let maxRight = -Infinity;
    for (const node of textNodes(el)) {
      if (!node.data.trim() || (node.parentElement && !visible(node.parentElement))) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of Array.from(range.getClientRects())) {
        if (rect.width <= 0) continue;
        minLeft = Math.min(minLeft, rect.left);
        maxRight = Math.max(maxRight, rect.right);
      }
    }
    if (maxRight === -Infinity || (maxRight <= right + 1 && minLeft >= left - 1)) return null;
    return `${Math.round(Math.max(maxRight, right) - Math.min(minLeft, left))}>${el.clientWidth}`;
  };

  async function outfit(sample: string): Promise<OutfitReport> {
    await document.fonts.ready;
    const requests = ['400 16px Outfit', '600 32px Outfit'];
    const matched: number[] = [];
    for (const request of requests) {
      try {
        matched.push((await document.fonts.load(request, sample)).length);
      } catch {
        matched.push(0);
      }
    }
    const faces: FontFace[] = [];
    document.fonts.forEach(face => {
      if (face.family.replace(/["']/g, '').trim().toLowerCase() === 'outfit') faces.push(face);
    });
    return {
      declared: faces.length,
      loaded: faces.filter(face => face.status === 'loaded').map(face => face.weight),
      matched,
      check: requests.map(request => document.fonts.check(request, sample)),
    };
  }

  /** Aile glifi yoksa tarayıcı yedeğe düşer: iki farklı yedekle ölçülen genişlik yedeğin kendisiyle aynı çıkar. */
  async function glyphGaps(chars: string, family: string): Promise<string[]> {
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) return ['canvas 2d bağlamı yok'];
    const gaps: string[] = [];
    for (const weight of ['400', '600']) {
      try {
        await document.fonts.load(`${weight} 48px ${family}`, chars);
      } catch {
        // Yüklenemeyen yüz aşağıdaki ölçümde yedek olarak görünür.
      }
      const width = (stack: string, ch: string) => {
        ctx.font = `${weight} 48px ${stack}`;
        return ctx.measureText(ch).width;
      };
      for (const ch of Array.from(chars)) {
        const fellBackMono = Math.abs(width(`${family}, monospace`, ch) - width('monospace', ch)) < 0.01;
        const fellBackSerif = Math.abs(width(`${family}, serif`, ch) - width('serif', ch)) < 0.01;
        if (fellBackMono && fellBackSerif) gaps.push(`${weight} "${ch}" ${family} glifi yok, yedek fonta düştü`);
      }
    }
    return gaps;
  }

  function wordBreaks(selector: string, requireKeepAll: boolean): Findings {
    const issues: string[] = [];
    let count = 0;
    for (const el of Array.from(document.querySelectorAll(selector))) {
      if (!visible(el)) continue;
      count += 1;
      const cs = getComputedStyle(el);
      if (requireKeepAll && cs.wordBreak !== 'keep-all') issues.push(`${describe(el)}: word-break ${cs.wordBreak} (keep-all bekleniyor)`);
      if (cs.wordBreak === 'break-all' || cs.overflowWrap === 'anywhere' || (requireKeepAll && cs.overflowWrap !== 'normal')) {
        issues.push(`${describe(el)}: zorlayıcı kırma (word-break ${cs.wordBreak}, overflow-wrap ${cs.overflowWrap})`);
      }
      const overflow = textOverflow(el);
      if (overflow) issues.push(`${describe(el)}: metin kutusundan taşıyor (${overflow})`);
      const cut = truncated(el);
      if (cut) issues.push(cut);
      for (const node of textNodes(el)) {
        if (node.parentElement && !visible(node.parentElement)) continue;
        for (const match of node.data.matchAll(WORD)) {
          const start = match.index ?? 0;
          const lines = wordLines(node, start, start + match[0].length);
          if (lines > 1) issues.push(`${describe(el)}: "${match[0]}" ${lines} satıra bölündü`);
        }
      }
    }
    return { count, issues };
  }

  function turkishLabels(root: string): TurkishReport {
    const rootEl = document.querySelector(root);
    if (!rootEl) return { count: 0, chars: '', issues: [`kök bulunamadı: ${root}`] };
    const issues: string[] = [];
    const lang = document.documentElement.lang;
    if (!/^tr\b/i.test(lang)) issues.push(`html lang "${lang}" (tr bekleniyor)`);
    const seen = new Set<Element>();
    const chars = new Set<string>();
    for (const node of textNodes(rootEl)) {
      const parent = node.parentElement;
      if (!parent || seen.has(parent) || !TURKISH.test(node.data) || !visible(parent)) continue;
      seen.add(parent);
      for (const ch of Array.from(node.data)) if (TURKISH.test(ch)) chars.add(ch);
      const cs = getComputedStyle(parent);
      if (parseFloat(cs.fontSize) < MIN_TEXT) issues.push(`${describe(parent)}: ${cs.fontSize} (${MIN_TEXT} px altında)`);
      if (!parent.closest('code, pre, kbd, samp') && firstFamily(parent) !== 'outfit') issues.push(`${describe(parent)}: ilk aile Outfit değil (${cs.fontFamily})`);
      if (cs.textTransform !== 'none') {
        const own = parent.closest('[lang]')?.getAttribute('lang') ?? '';
        if (!/^tr\b/i.test(own)) issues.push(`${describe(parent)}: text-transform ${cs.textTransform} lang "${own}" altında (İ/ı bozulur)`);
      }
      const cut = truncated(parent);
      if (cut) issues.push(cut);
    }
    return { count: seen.size, chars: Array.from(chars).join(''), issues };
  }

  function money(root: string, cellAlign: boolean): MoneyReport {
    const rootEl = document.querySelector(root);
    if (!rootEl) return { values: [], issues: [`kök bulunamadı: ${root}`] };
    const values: string[] = [];
    const issues: string[] = [];
    for (const node of textNodes(rootEl)) {
      const parent = node.parentElement;
      if (!parent || !/\d/.test(node.data) || !visible(parent)) continue;
      const tokens = node.data.match(MONEY_TOKEN);
      if (!tokens) continue;
      const cs = getComputedStyle(parent);
      const tabular = cs.fontVariantNumeric.includes('tabular-nums') || /["']tnum["']/.test(cs.fontFeatureSettings);
      for (const raw of tokens) {
        const token = raw.trim().replace(/[.,]+$/, '');
        if (MONEY_OK.test(token)) values.push(token);
        else issues.push(`${describe(parent)}: "${token}" ₺8.500,00 biçiminde değil`);
        if (!tabular) issues.push(`${describe(parent)}: "${token}" tabular-nums değil (${cs.fontVariantNumeric})`);
        if (cellAlign) {
          const cell = parent.closest('td, th, [role=cell], [role=gridcell]');
          const align = cell ? getComputedStyle(cell).textAlign : null;
          if (cell && align !== 'right' && align !== 'end') issues.push(`${describe(parent)}: "${token}" hücrede sağa hizalı değil (${align})`);
        }
      }
    }
    return { values, issues };
  }

  return { outfit, glyphGaps, wordBreaks, turkishLabels, money };
}

async function installDetectors(page: Page) {
  await page.addScriptTag({ content: `window.__aileTypography = (${typographyDetectors.toString()})();` });
}

/** Outfit raporundan kural ihlalleri (gerçek sayfa ve öz denetim aynı yargıyı kullanır). */
function outfitProblems(report: OutfitReport): string[] {
  const problems: string[] = [];
  if (report.declared === 0) problems.push('Outfit @font-face tanımı yok (sistem fontu sayılmaz)');
  if (report.loaded.length === 0) problems.push('yüklü Outfit yüzü yok');
  report.matched.forEach((n, i) => { if (n === 0) problems.push(`${i === 0 ? '400' : '600'} ağırlığa Outfit yüzü eşleşmedi`); });
  report.check.forEach((ok, i) => { if (!ok) problems.push(`document.fonts.check ${i === 0 ? '400 16px' : '600 32px'} Outfit false`); });
  return problems;
}

// --- Sentetik nesil (route; gerçek veri ve sunucu ortamı kullanılmaz) --------------------------------------------
const GENERATION_PREFIX = '/__aile/generation/';
const FIXTURE_ROOT = fileURLToPath(new URL('../fixtures/generation-synthetic/', import.meta.url));
const FONT_ROOT = fileURLToPath(new URL('../public/fonts/', import.meta.url));

async function syntheticRoot() {
  const entries = await readdir(FIXTURE_ROOT, { withFileTypes: true });
  const generation = entries.find(entry => entry.isDirectory() && /^[a-f0-9]{64}$/.test(entry.name));
  if (!generation) throw new Error('Sentetik nesil bulunamadı (fixtures/generation-synthetic)');
  return path.join(FIXTURE_ROOT, generation.name);
}

async function serveSyntheticGeneration(page: Page) {
  const root = await syntheticRoot();
  await page.route(`**${GENERATION_PREFIX}**`, async route => {
    const { pathname } = new URL(route.request().url());
    const relative = decodeURIComponent(pathname.slice(pathname.indexOf(GENERATION_PREFIX) + GENERATION_PREFIX.length));
    const segments = relative.split('/');
    const safe = segments.every(segment => segment !== '' && segment !== '.' && segment !== '..');
    const readable = relative === 'manifest.json' || (segments[0] === 'data' && segments.length >= 3 && relative.endsWith('.json'));
    if (!safe || !readable) {
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Sentetik nesilde yok' }) });
      return;
    }
    try {
      await route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: await readFile(path.join(root, ...segments)) });
    } catch {
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Sentetik nesilde yok' }) });
    }
  });
}

const VIEWS_PATH = 'data/view_definitions/global/00000.json';

/**
 * Sentetik nesilde pivot tanımı purchase_need türünü desteklemez (AlimlarPage pivotu uydurmaz, Liste açar). Alımlar pivot
 * tablosunun başlıklarını sınamak için birim testteki PIVOT_ACIK ile aynı sentetik değişiklik: pivot.supported_kinds'a
 * purchase_need eklenir; depo bütünlüğü doğruladığı için manifestteki sha256/bytes/count da güncellenir. Sonradan kurulan
 * route öncekinden önce çalışır; diğer yollar route.fallback ile ortak sentetik servise düşer.
 */
async function enablePurchasePivot(page: Page) {
  const root = await syntheticRoot();
  const envelope = JSON.parse(await readFile(path.join(root, ...VIEWS_PATH.split('/')), 'utf8')) as { collection: string; records: Record<string, unknown>[] };
  const records = envelope.records.map(record =>
    record['key'] === 'pivot' ? { ...record, supported_kinds: [...(record['supported_kinds'] as string[]), 'purchase_need'] } : record);
  const views = JSON.stringify({ ...envelope, records });
  const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8')) as {
    files: { path: string; sha256: string; bytes: number; count?: number }[];
    counts: Record<string, number>;
  };
  manifest.files = manifest.files.map(file => (file.path === VIEWS_PATH
    ? { ...file, sha256: createHash('sha256').update(views, 'utf8').digest('hex'), bytes: Buffer.byteLength(views, 'utf8'), count: records.length }
    : file));
  manifest.counts = { ...manifest.counts, [envelope.collection]: records.length };
  const bodies: Record<string, string> = { 'manifest.json': JSON.stringify(manifest), [VIEWS_PATH]: views };
  await page.route(`**${GENERATION_PREFIX}**`, async route => {
    const { pathname } = new URL(route.request().url());
    const body = bodies[decodeURIComponent(pathname.slice(pathname.indexOf(GENERATION_PREFIX) + GENERATION_PREFIX.length))];
    if (body === undefined) await route.fallback();
    else await route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body });
  });
}

/**
 * Öğenin kendisinde, atalarında ya da içinde süren sonlu CSS geçişleri/animasyonları bitene kadar bekler (Animation.finished).
 * Çekmece 240 ms içinde soldan kayarak ve opaklığı artarak gelir; ölçüm ara karede yapılırsa etiketler ekran dışında
 * (left < 0) ya da yarı saydam sayılır. Süre tahmini yok: tarayıcının kendi animasyon nesneleri beklenir.
 */
async function settleMotion(locator: Locator) {
  await locator.evaluate(async el => {
    const running = document.getAnimations().filter(animation => {
      const target = (animation.effect as KeyframeEffect | null)?.target;
      const finite = animation.effect?.getComputedTiming().iterations !== Infinity;
      return finite && target instanceof Element && (target.contains(el) || el.contains(target));
    });
    await Promise.all(running.map(animation => animation.finished.catch(() => undefined)));
  });
}

const DESKTOP = { width: 1440, height: 900 };
const LAPTOP = { width: 1024, height: 768 };
const PHONE = { width: 320, height: 740 };
const TURKISH_GLYPHS = 'İıĞğŞşÇçÖöÜü';
const NAV_LABELS = ['Alımlar ve eşyalar', 'Bütçe ve nakit', 'Ödemeler', 'Projeler ve görevler', 'Sözlükler ve iş akışları'];
const H1_ROUTES = ['/alimlar', '/sozlukler', '/veri', '/hesaplar'];
const PIVOT_TABLE = 'Oda ve duruma göre planlanan ve gerçekleşen tutar';
const THOUSANDS = /^-?₺\d{1,3}(?:\.\d{3})+,\d{2}$/;

const detect = {
  outfit: (page: Page, sample: string) => page.evaluate(s => window.__aileTypography!.outfit(s), sample),
  glyphGaps: (page: Page, chars: string, family: string) => page.evaluate(([c, f]) => window.__aileTypography!.glyphGaps(c, f), [chars, family] as const),
  wordBreaks: (page: Page, selector: string, keepAll: boolean) =>
    page.evaluate(([s, k]) => window.__aileTypography!.wordBreaks(s, k), [selector, keepAll] as const),
  turkishLabels: (page: Page, root: string) => page.evaluate(r => window.__aileTypography!.turkishLabels(r), root),
  money: (page: Page, root: string, cellAlign: boolean) => page.evaluate(([r, a]) => window.__aileTypography!.money(r, a), [root, cellAlign] as const),
};

const HEADER_CELLS = 'th, [role=columnheader]';

/**
 * Tek h1'in hesaplanmış stili, tek sayfa içi görevde okunur. Lazy sayfa yüklenince yedek başlığın h1'i (RouteFallback,
 * aynı PageHeader) gerçek sayfanınkiyle değişir; locator.evaluate çözümleme ile çağrı arasında ayrılan öğeyi okursa
 * WebKit boş stil (NaN) döndürür. Burada sorgu ve ölçüm aynı görevdedir; birden fazla h1 ya da hiç h1 hata sayılır.
 */
async function h1Style(page: Page) {
  return page.evaluate(() => {
    const headings = Array.from(document.querySelectorAll('h1'));
    if (headings.length !== 1) return { size: NaN, weight: `h1 sayısı ${headings.length}`, lineHeight: NaN };
    const cs = getComputedStyle(headings[0]!);
    return { size: parseFloat(cs.fontSize), weight: cs.fontWeight, lineHeight: parseFloat(cs.lineHeight) };
  });
}
// AlimlarPage hash sözleşmesi (buildAlimlarHash): seçim yokken sorgu "#/alimlar/?…" biçimindedir; rota deseni
// "/alimlar/:id?" eğik çizgisiz "#/alimlar?mod=…" konumunu eşlemez ve varsayılan sayfaya yönlendirir.
const ALIMLAR_TABLO = '/alimlar/?mod=table';
const ALIMLAR_PIVOT = '/alimlar/?mod=pivot';

test.describe('yönetim tipografisi', () => {
  test.beforeEach(async ({ page }) => {
    await serveSyntheticGeneration(page);
  });

  test('Outfit web fontu yüklü, kabuğun ilk ailesi ve Türkçe glifleri kapsıyor', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await gotoAdmin(page, '/alimlar');
    await installDetectors(page);
    const report = await detect.outfit(page, `aile ${TURKISH_GLYPHS} ₺8.500,00`);
    expect(outfitProblems(report), JSON.stringify(report)).toEqual([]);
    const families = {
      main: await page.getByRole('main').evaluate(el => getComputedStyle(el).fontFamily),
      h1: await page.getByRole('heading', { level: 1 }).evaluate(el => getComputedStyle(el).fontFamily),
      nav: await page.getByRole('navigation', { name: 'Sayfalar' }).evaluate(el => getComputedStyle(el).fontFamily),
    };
    for (const [where, family] of Object.entries(families)) {
      expect(family.split(',')[0]?.replace(/["']/g, '').trim(), `${where} ilk ailesi`).toBe('Outfit');
    }
    expect(await detect.glyphGaps(page, TURKISH_GLYPHS, 'Outfit')).toEqual([]);
  });

  test('h1 1440 px: 32/40, 600 ve kelime ortasından bölünmez', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    for (const route of H1_ROUTES) {
      await gotoAdmin(page, route);
      const h1 = page.getByRole('heading', { level: 1 });
      await expect(h1).toHaveCount(1);
      await expect(h1).toBeVisible();
      expect(await h1Style(page), `${route} h1`).toEqual({ size: 32, weight: '600', lineHeight: 40 });
      await installDetectors(page);
      expect((await detect.wordBreaks(page, 'h1', false)).issues, `${route} h1 kırılma`).toEqual([]);
    }
  });

  test('h1 320 px: en az 24 px, 600, bölünmez ve belgeyi taşırmaz', async ({ page, browserName }) => {
    await page.setViewportSize(PHONE);
    for (const route of H1_ROUTES) {
      await gotoAdmin(page, route);
      const h1 = page.getByRole('heading', { level: 1 });
      await expect(h1).toBeVisible();
      const style = await h1Style(page);
      expect(style.size, `${route} h1 boyutu`).toBeGreaterThanOrEqual(24);
      expect(style.weight, `${route} h1 ağırlığı`).toBe('600');
      await installDetectors(page);
      expect((await detect.wordBreaks(page, 'h1', false)).issues, `${route} h1 kırılma`).toEqual([]);
      if (browserName === 'chromium') expect(await horizontalOverflow(page), `${route} yatay taşma`).toEqual([]);
    }
  });

  for (const viewport of [DESKTOP, LAPTOP]) {
    test(`tablo başlıkları keep-all, kelime ortasından bölünmez (${viewport.width} px)`, async ({ page }) => {
      await enablePurchasePivot(page);
      await page.setViewportSize(viewport);
      await gotoAdmin(page, ALIMLAR_TABLO);
      await expect(page.getByRole('columnheader', { name: 'Planlanan' })).toBeVisible();
      await expect(page.getByRole('columnheader', { name: 'Ödeme durumu' })).toBeVisible();
      await installDetectors(page);
      const table = await detect.wordBreaks(page, HEADER_CELLS, true);
      expect(table.count, 'görünür tablo başlığı').toBeGreaterThanOrEqual(5);
      expect(table.issues).toEqual([]);

      await gotoAdmin(page, ALIMLAR_PIVOT);
      await expect(page.getByRole('table', { name: PIVOT_TABLE })).toBeVisible();
      await installDetectors(page);
      const pivot = await detect.wordBreaks(page, HEADER_CELLS, true);
      expect(pivot.count, 'görünür pivot başlığı').toBeGreaterThan(0);
      expect(pivot.issues).toEqual([]);
    });
  }

  test('Türkçe karakterli etiketler görünür ve kesilmez (masaüstü nav, atlama bağlantısı)', async ({ page, browserName }) => {
    await page.setViewportSize(DESKTOP);
    await gotoAdmin(page, '/alimlar');
    const nav = page.getByRole('navigation', { name: 'Sayfalar' });
    for (const label of NAV_LABELS) await expect(nav.getByText(label, { exact: true })).toBeVisible();
    await enterKeyboardMode(page, browserName);
    const skip = page.getByRole('link', { name: 'İçeriğe geç' });
    await skip.focus();
    await expect(skip).toBeFocused();
    await installDetectors(page);
    const report = await detect.turkishLabels(page, 'body');
    expect(report.issues).toEqual([]);
    for (const ch of ['İ', 'ı', 'ğ', 'ş', 'ö', 'ü']) expect(report.chars, `görünür etiketlerde "${ch}"`).toContain(ch);
  });

  test('Türkçe karakterli etiketler görünür ve kesilmez (320 px sayfa çekmecesi)', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await gotoAdmin(page, '/alimlar');
    await page.getByRole('button', { name: 'Sayfalar' }).click();
    const drawer = page.getByRole('dialog', { name: 'Sayfalar' });
    await expect(drawer).toBeVisible();
    await settleMotion(drawer);
    for (const label of NAV_LABELS) await expect(drawer.getByText(label, { exact: true })).toBeVisible();
    await installDetectors(page);
    const report = await detect.turkishLabels(page, 'body');
    expect(report.issues).toEqual([]);
    for (const ch of ['ı', 'ş', 'ö', 'ü']) expect(report.chars, `görünür etiketlerde "${ch}"`).toContain(ch);
  });

  test('para ₺8.500,00 biçiminde, tabular-nums ve tabloda sağa hizalı (1440 px)', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await gotoAdmin(page, ALIMLAR_TABLO);
    await expect(page.getByRole('columnheader', { name: 'Planlanan' })).toBeVisible();
    await expect(page.getByRole('cell', { name: /^-?₺\d/ }).first()).toBeVisible();
    await installDetectors(page);
    const report = await detect.money(page, 'body', true);
    expect(report.issues).toEqual([]);
    expect(report.values.length, 'görünür tutar').toBeGreaterThan(0);
    expect(report.values.some(value => THOUSANDS.test(value)), `binlik ayraçlı tutar: ${report.values.slice(0, 5).join(' ')}`).toBe(true);
  });

  test('para ₺8.500,00 biçiminde ve tabular-nums (320 px liste)', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await gotoAdmin(page, '/alimlar');
    await expect(page.getByText(/^-?₺\d/).first()).toBeVisible();
    await installDetectors(page);
    const report = await detect.money(page, 'body', false);
    expect(report.issues).toEqual([]);
    expect(report.values.length, 'görünür tutar').toBeGreaterThan(0);
  });
});

// --- Dedektör öz denetimi: ihlal enjekte edilir → yakalanır; uygun sayfa → sessiz -----------------------------------
const SELF_CHECK_ORIGIN = 'https://aile-selfcheck.test';

const VIOLATIONS_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><style>
  body { margin: 16px; font: 16px/24px Arial, sans-serif; }
  table { table-layout: fixed; width: 120px; border-collapse: collapse; }
  th { width: 60px; padding: 0; }
  #kirik { word-break: break-all; }
  #tasan { word-break: normal; overflow-wrap: normal; }
  .ust { text-transform: uppercase; }
  .dar { width: 48px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .kucuk { font-size: 12px; }
  .tutar { font-variant-numeric: tabular-nums; }
  td { text-align: left; }
</style></head><body>
  <h1 style="width:40px;word-break:break-all">Alımlar</h1>
  <table><thead><tr><th id="kirik">Proposal</th><th id="tasan">DocTypeTemplate</th></tr></thead>
  <tbody><tr><td><span class="tutar">₺8.500,00</span></td><td><span class="tutar">₺8500</span></td></tr></tbody></table>
  <p><span class="tutar">8.500 TL</span> <span>₺1.250,00</span></p>
  <p class="ust">ışık ve iş</p>
  <p class="dar">Sözlükler ve iş akışları</p>
  <p class="kucuk">Ödeme</p>
</body></html>`;

const CLEAN_HTML = `<!doctype html>
<html lang="tr"><head><meta charset="utf-8"><style>
  @font-face { font-family: Outfit; src: url('/fonts/outfit-regular.ttf') format('truetype'); font-weight: 400 500; }
  @font-face { font-family: Outfit; src: url('/fonts/outfit-bold.ttf') format('truetype'); font-weight: 600 800; }
  body { margin: 16px; font: 16px/24px Outfit, system-ui, sans-serif; }
  h1 { font-size: 32px; line-height: 40px; font-weight: 600; }
  th { word-break: keep-all; overflow-wrap: normal; min-width: 160px; font-size: 14px; text-align: left; }
  /* antd yapışkan sütun gölgesi gibi metin dışı süs: hücrenin sağına taşan mutlak ::after metin taşması sayılmaz. */
  th:first-child { position: sticky; left: 0; }
  th:first-child::after { content: ''; position: absolute; top: 0; bottom: 0; right: -30px; width: 30px; }
  td.sayi { text-align: right; }
  .tutar { font-variant-numeric: tabular-nums; white-space: nowrap; }
  .ust { text-transform: uppercase; }
</style></head><body>
  <h1>Alımlar ve eşyalar</h1>
  <table><thead><tr><th>Planlanan tutar</th><th>Ödeme durumu</th></tr></thead>
  <tbody><tr><td class="sayi"><span class="tutar">₺8.500,00</span></td><td class="sayi"><span class="tutar">-₺1.250,50</span></td></tr></tbody></table>
  <p>İçeriğe geç · Ğ Ş ı ş ö ü ç · <span class="tutar">₺34.000,00</span> · 28.10.2026</p>
  <p class="ust">ışık ve iş</p>
</body></html>`;

async function openSelfCheck(page: Page, html: string) {
  await page.route(`${SELF_CHECK_ORIGIN}/**`, async route => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/fonts/outfit-regular.ttf' || pathname === '/fonts/outfit-bold.ttf') {
      await route.fulfill({ status: 200, contentType: 'font/ttf', body: await readFile(path.join(FONT_ROOT, path.basename(pathname))) });
      return;
    }
    if (pathname === '/') {
      await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
      return;
    }
    await route.fulfill({ status: 404, body: '' });
  });
  await page.goto(`${SELF_CHECK_ORIGIN}/`);
  await installDetectors(page);
}

test.describe('tipografi dedektörü öz denetimi', () => {
  test('enjekte edilen ihlalleri yakalar', async ({ page }) => {
    await openSelfCheck(page, VIOLATIONS_HTML);

    expect(outfitProblems(await detect.outfit(page, 'aile'))).toEqual(expect.arrayContaining([expect.stringContaining('@font-face tanımı yok')]));
    const gaps = await detect.glyphGaps(page, 'İĞŞ', 'AileYokFont');
    expect(gaps.length, 'olmayan ailenin glifleri yedeğe düşer').toBe(6);

    const headers = await detect.wordBreaks(page, 'th', true);
    expect(headers.count).toBe(2);
    expect(headers.issues).toEqual(expect.arrayContaining([
      expect.stringMatching(/"Proposal".*word-break break-all \(keep-all bekleniyor\)/),
      expect.stringMatching(/"Proposal" \d satıra bölündü/),
      expect.stringMatching(/"DocTypeTemplate".*keep-all bekleniyor/),
      expect.stringMatching(/"DocTypeTemplate".*taşıyor/),
    ]));
    const h1 = await detect.wordBreaks(page, 'h1', false);
    expect(h1.issues).toEqual(expect.arrayContaining([expect.stringMatching(/"Alımlar" \d satıra bölündü/), expect.stringContaining('zorlayıcı kırma')]));

    const turkish = await detect.turkishLabels(page, 'body');
    expect(turkish.issues).toEqual(expect.arrayContaining([
      expect.stringContaining('html lang "en"'),
      expect.stringMatching(/"ışık ve iş".*text-transform uppercase/),
      expect.stringMatching(/"Sözlükler ve iş akışları".*kesildi/),
      expect.stringMatching(/"Ödeme".*12px/),
      expect.stringMatching(/ilk aile Outfit değil/),
    ]));

    const money = await detect.money(page, 'body', true);
    // Biçimi doğru ama tabular olmayan ₺1.250,00 değer sayılır; ihlali ayrıca raporlanır.
    expect(money.values).toEqual(['₺8.500,00', '₺1.250,00']);
    expect(money.issues).toEqual(expect.arrayContaining([
      expect.stringContaining('"₺8500" ₺8.500,00 biçiminde değil'),
      expect.stringContaining('"8.500 TL" ₺8.500,00 biçiminde değil'),
      expect.stringContaining('"₺1.250,00" tabular-nums değil'),
      expect.stringContaining('"₺8.500,00" hücrede sağa hizalı değil'),
    ]));
  });

  test('uygun sayfada sessiz kalır (yanlış pozitif yok)', async ({ page }) => {
    await openSelfCheck(page, CLEAN_HTML);

    expect(outfitProblems(await detect.outfit(page, `aile ${TURKISH_GLYPHS}`))).toEqual([]);
    expect(await detect.glyphGaps(page, TURKISH_GLYPHS, 'Outfit')).toEqual([]);

    const headers = await detect.wordBreaks(page, 'th', true);
    expect(headers.count).toBe(2);
    expect(headers.issues).toEqual([]);
    expect((await detect.wordBreaks(page, 'h1', false)).issues).toEqual([]);

    const turkish = await detect.turkishLabels(page, 'body');
    expect(turkish.issues).toEqual([]);
    for (const ch of ['İ', 'ı', 'Ğ', 'ğ', 'Ş', 'ş']) expect(turkish.chars).toContain(ch);

    const money = await detect.money(page, 'body', true);
    expect(money.issues).toEqual([]);
    expect(money.values).toEqual(['₺8.500,00', '-₺1.250,50', '₺34.000,00']);
  });
});
