import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, type Page } from '@playwright/test';
import { enterKeyboardMode, gotoAdmin, shiftTabKey, tabKey } from './admin-helpers';

// Odak sözleşmesi (tasarım README › Odak, AGENT.md kesin odak kuralı, src/admin/admin.css):
//  - Klavye modunda (html[data-keyboard='true'], yalnız Tab açar) odaklı kontrolde tek 3 px alt çizgi vardır:
//    kontrolün (ya da onu saran sarmalayıcının: checkbox wrapper, select selector, input affix) ::after'ı, yüksekliği
//    --aile-odak-kalinlik, rengi --aile-odak (= eylem) ya da nav üzerinde --aile-odak-nav. Alternatif: input için alttan
//    tek inset gölge çizgisi.
//  - Çevreleyen gösterge yok: outline, halka box-shadow (spread / 0-0 bulanık), dört kenarlı pseudo çerçeve.
//  - Pointer (pointerdown/touchstart) görsel modu kapatır: aynı öğede ve fareyle odaklanan alanda çizgi görünmez.
// Dedektör bu dosyada yereldir (admin-detectors.ts bu aşamada yoktu); kendini doğrulama testleri ihlali addStyleTag ile
// enjekte eder ve dedektörün yakaladığını kanıtlar. Seçiciler role/label ile; antd iç sınıflarına bağlanmaz.

// Veri: Alımlar sayfası doğrulanmış nesli okur; webServer env'inde AILE_GENERATION_DIR yok. /__aile/generation/**
// istekleri yalnız sentetik fixture'dan (fixtures/generation-synthetic) karşılanır; dev middleware sözleşmesiyle aynı
// (_meta, yalnız .json, '..'/mutlak yol reddi). Gerçek nesil okunmaz. Böylece odak, gerçek liste/filtre/arama
// kontrolleri üzerinde ölçülür; hata durumunun az öğeli sayfasında değil.
const FIXTURE_ROOT = fileURLToPath(new URL('../fixtures/generation-synthetic/', import.meta.url));
const GENERATION_ID = readdirSync(FIXTURE_ROOT).find(name => /^[a-f0-9]{64}$/.test(name) && statSync(path.join(FIXTURE_ROOT, name)).isDirectory())!;
const GENERATION_DIR = path.join(FIXTURE_ROOT, GENERATION_ID);
const GENERATION_PREFIX = '/__aile/generation/';

async function routeSyntheticGeneration(page: Page) {
  await page.route('**/__aile/generation/**', async route => {
    const url = new URL(route.request().url());
    let rel: string | null = null;
    try {
      rel = decodeURIComponent(url.pathname.slice(url.pathname.indexOf(GENERATION_PREFIX) + GENERATION_PREFIX.length));
    } catch {
      rel = null;
    }
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json; charset=utf-8', headers: { 'cache-control': 'no-store' }, body: `${JSON.stringify(body)}\n` });
    if (!rel || rel.includes('\\') || rel.includes('\0') || rel.split('/').some(part => part === '' || part === '.' || part === '..')) return json(400, { error: 'Geçersiz yol' });
    if (rel === '_meta') return json(200, { generation_id: GENERATION_ID, selectedAt: new Date().toISOString() });
    if (!rel.endsWith('.json')) return json(404, { error: 'Yalnız .json dosyaları servis edilir' });
    const file = path.resolve(GENERATION_DIR, rel);
    if (!file.startsWith(`${GENERATION_DIR}${path.sep}`)) return json(400, { error: 'Geçersiz yol' });
    try {
      if (!statSync(file).isFile()) return json(404, { error: 'Dosya yok' });
      return route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', headers: { 'cache-control': 'no-store' }, body: readFileSync(file) });
    } catch {
      return json(404, { error: 'Dosya yok' });
    }
  });
}

test.beforeEach(async ({ page }) => {
  await routeSyntheticGeneration(page);
});

/**
 * Alımlar'ı açar ve nesil yüklenene kadar bekler (liste görünür). Yükleme sırasında içerikte odaklanabilir öğe yoktur;
 * o anda basılan Tab doğal olarak belgeden çıkar ve ölçüm sayfanın kendisini değil yükleme anını yakalar.
 */
async function gotoLoadedAlimlar(page: Page) {
  await gotoAdmin(page, '/alimlar');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Alımlar' })).toBeVisible();
}

interface FocusLine {
  via: 'after' | 'inset';
  depth: number;
  height: number;
  color: string;
  widthDelta: number | null;
}

interface FocusReport {
  /** Odaklı öğe var mı (body/html değil). */
  focused: boolean;
  describe: string;
  keyboard: boolean;
  visible: boolean;
  allowed: string[];
  rings: string[];
  lines: FocusLine[];
}

/**
 * Tarayıcıda çalışır; kendi içinde kapalıdır (Playwright fn.toString() ile taşır, dış kapsama erişmez).
 * Odaklı öğeyi ve onu saran kontrol sarmalayıcılarını (en çok 5 ata) inceler.
 */
function inspectFocus(target: Element | null): FocusReport {
  const root = document.documentElement;
  const keyboard = root.dataset.keyboard === 'true';
  const tokenHost = document.querySelector('.aile-admin') ?? root;
  const vars = getComputedStyle(tokenHost);
  const toRgb = (value: string) => {
    const probe = document.createElement('span');
    probe.style.display = 'none';
    probe.style.color = value.trim();
    document.body.append(probe);
    const rgb = getComputedStyle(probe).color;
    probe.remove();
    return rgb;
  };
  const allowed = ['--aile-odak', '--aile-odak-nav', '--aile-eylem']
    .map(name => vars.getPropertyValue(name))
    .filter(value => value.trim() !== '')
    .map(toRgb);
  const thickness = parseFloat(vars.getPropertyValue('--aile-odak-kalinlik')) || 3;
  const px = (value: string) => parseFloat(value) || 0;
  const transparent = (color: string) => color === '' || color === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(color) || /\/\s*0\)$/.test(color);

  const empty: FocusReport = { focused: false, describe: String(target?.nodeName ?? 'yok'), keyboard, visible: false, allowed, rings: [], lines: [] };
  if (!target || target === document.body || target === root) return empty;

  const label = (el: Element) => {
    const name = el.getAttribute('aria-label') ?? (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
    const role = el.getAttribute('role') ?? el.nodeName.toLowerCase();
    return `${role} "${name}"`;
  };

  type Layer = { inset: boolean; color: string; x: number; y: number; blur: number; spread: number };
  const layers = (shadow: string): Layer[] => {
    if (!shadow || shadow === 'none') return [];
    return shadow.split(/,(?![^(]*\))/).map(raw => {
      const layer = raw.trim();
      const colorMatch = layer.match(/(rgba?|color|oklab|oklch|lab|lch|hsla?)\([^)]*\)/);
      const color = colorMatch ? colorMatch[0] : '';
      const nums = layer.replace(color, '').replace(/\binset\b/, '').trim().split(/\s+/).filter(Boolean).map(px);
      return { inset: /\binset\b/.test(layer), color, x: nums[0] ?? 0, y: nums[1] ?? 0, blur: nums[2] ?? 0, spread: nums[3] ?? 0 };
    });
  };
  const isRingLayer = (l: Layer) => !transparent(l.color) && (l.spread !== 0 || (l.x === 0 && l.y === 0 && l.blur > 0));
  const isBottomInset = (l: Layer) => l.inset && l.x === 0 && l.y < 0 && l.blur === 0 && l.spread === 0 && Math.abs(Math.abs(l.y) - thickness) <= 0.5;

  const rect = target.getBoundingClientRect();
  const style = getComputedStyle(target);
  const visible = rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && parseFloat(style.opacity || '1') > 0;

  // Zincir: odaklı öğe + en çok 5 ata. Halka denetimi yalnız kontrolü saran (ona sıkı oturan) sarmalayıcılarda yapılır;
  // büyük kapsayıcıların yükseltme gölgesi halka sayılmaz.
  const chain: { el: Element; depth: number; hugs: boolean }[] = [];
  let node: Element | null = target;
  for (let depth = 0; node && depth <= 5; depth += 1) {
    if (node === document.body || node === root) break;
    const r = node.getBoundingClientRect();
    const hugs = depth === 0 || (r.width <= rect.width + 48 && r.height <= rect.height + 32);
    chain.push({ el: node, depth, hugs });
    if (node.getAttribute('role') === 'dialog') break;
    node = node.parentElement;
  }

  const rings: string[] = [];
  const lines: FocusLine[] = [];
  for (const { el, depth, hugs } of chain) {
    const own = getComputedStyle(el);
    if (hugs) {
      if (own.outlineStyle !== 'none' && px(own.outlineWidth) > 0 && !transparent(own.outlineColor)) {
        rings.push(`${label(el)} (ata ${depth}): outline ${own.outlineWidth} ${own.outlineStyle} ${own.outlineColor}`);
      }
      for (const layer of layers(own.boxShadow)) {
        if (isRingLayer(layer)) rings.push(`${label(el)} (ata ${depth}): halka gölge ${own.boxShadow}`);
        else if (isBottomInset(layer) && allowed.includes(layer.color)) {
          lines.push({ via: 'inset', depth, height: Math.abs(layer.y), color: layer.color, widthDelta: 0 });
        }
      }
    }
    for (const pseudo of ['::before', '::after'] as const) {
      const ps = getComputedStyle(el, pseudo);
      if (ps.content === 'none' || ps.content === 'normal' || ps.display === 'none') continue;
      const sides = (['Top', 'Right', 'Bottom', 'Left'] as const).filter(side => {
        const width = px(ps.getPropertyValue(`border-${side.toLowerCase()}-width`));
        const borderStyle = ps.getPropertyValue(`border-${side.toLowerCase()}-style`);
        const color = ps.getPropertyValue(`border-${side.toLowerCase()}-color`);
        return width > 0 && borderStyle !== 'none' && !transparent(color);
      });
      if (hugs && sides.length >= 3) rings.push(`${label(el)} (ata ${depth}) ${pseudo}: ${sides.length} kenarlı çerçeve`);
      if (hugs && ps.outlineStyle !== 'none' && px(ps.outlineWidth) > 0 && !transparent(ps.outlineColor)) {
        rings.push(`${label(el)} (ata ${depth}) ${pseudo}: outline ${ps.outlineWidth}`);
      }
      if (hugs && layers(ps.boxShadow).some(isRingLayer)) rings.push(`${label(el)} (ata ${depth}) ${pseudo}: halka gölge ${ps.boxShadow}`);
      if (pseudo !== '::after') continue;
      const height = px(ps.height);
      const bg = ps.backgroundColor;
      if (Math.abs(height - thickness) <= 0.5 && allowed.includes(bg) && sides.length === 0) {
        const width = parseFloat(ps.width);
        const host = el as HTMLElement;
        const widthDelta = Number.isFinite(width)
          ? Math.min(Math.abs(width - host.offsetWidth), Math.abs(width - host.clientWidth))
          : null;
        lines.push({ via: 'after', depth, height, color: bg, widthDelta });
      }
    }
  }
  return { focused: true, describe: label(target), keyboard, visible, allowed, rings, lines };
}

async function activeReport(page: Page): Promise<FocusReport> {
  const handle = await page.evaluateHandle(() => document.activeElement);
  try {
    return await handle.evaluate(inspectFocus);
  } finally {
    await handle.dispose();
  }
}

/** Klavye odağı: görünür, çevreleyen gösterge yok, tek alt çizgi (renk/kalınlık tokenlardan), kontrol genişliğinde. */
function expectKeyboardLine(report: FocusReport, where: string) {
  const at = `${where} · ${report.describe}`;
  expect(report.focused, `${at}: odak belgeye düştü`).toBe(true);
  expect(report.keyboard, `${at}: klavye modu kapalı`).toBe(true);
  expect(report.visible, `${at}: odaklı öğe görünmez`).toBe(true);
  expect(report.allowed.length, 'odak renk tokenları okunamadı').toBeGreaterThan(0);
  expect(report.rings, `${at}: çevreleyen odak göstergesi`).toEqual([]);
  expect(report.lines.length, `${at}: tek alt çizgi bekleniyordu (${JSON.stringify(report.lines)})`).toBe(1);
  const [line] = report.lines;
  if (line.via === 'after' && line.widthDelta !== null) {
    expect(line.widthDelta, `${at}: çizgi kontrol genişliğinde değil`).toBeLessThanOrEqual(2);
  }
}

/** Pointer modu: çizgi yok, halka yok. */
function expectNoIndicator(report: FocusReport, where: string) {
  const at = `${where} · ${report.describe}`;
  expect(report.keyboard, `${at}: pointer sonrası klavye modu açık kaldı`).toBe(false);
  expect(report.rings, `${at}: pointer sonrası çevreleyen gösterge`).toEqual([]);
  expect(report.lines, `${at}: pointer sonrası odak çizgisi görünüyor`).toEqual([]);
}

/** Programatik odağı gerçek klavye odağına çevirir: Tab ileri + Shift+Tab geri aynı öğeye döner, mod açılır. */
async function keyboardFocus(page: Page, browserName: string, focus: () => Promise<void>) {
  await focus();
  await page.keyboard.press(tabKey(browserName));
  await page.keyboard.press(shiftTabKey(browserName));
  await page.waitForFunction(() => document.documentElement.dataset.keyboard === 'true');
}

test.describe('yönetim odak çizgisi', () => {
  test('klavye modunda ilk 8 odaklanabilir öğe: outline yok, tek 3 px alt çizgi', async ({ page, browserName }) => {
    await gotoLoadedAlimlar(page);
    await enterKeyboardMode(page, browserName);
    const seen: string[] = [];
    for (let index = 0; index < 8; index += 1) {
      if (index > 0) await page.keyboard.press(tabKey(browserName));
      const report = await activeReport(page);
      expectKeyboardLine(report, `Tab ${index + 1}`);
      seen.push(report.describe);
    }
    expect(new Set(seen).size, `Tab sırası ilerlemiyor: ${seen.join(' → ')}`).toBeGreaterThan(1);
  });

  test('pointer sonrası çizgi yok; Tab yeniden açar', async ({ page, browserName }) => {
    await gotoLoadedAlimlar(page);
    await enterKeyboardMode(page, browserName);
    await page.keyboard.press(tabKey(browserName));
    const keyboardTarget = await page.evaluateHandle(() => document.activeElement);
    expectKeyboardLine(await keyboardTarget.evaluate(inspectFocus), 'pointer öncesi');

    // İşaretçi dokunuşu görsel modu kapatır: klavyeyle odaklanmış öğede de çizgi kalmaz.
    await page.getByRole('heading', { level: 1 }).click();
    expectNoIndicator(await keyboardTarget.evaluate(inspectFocus), 'pointer sonrası önceki hedef');
    await keyboardTarget.dispose();

    // Fareyle odaklanan arama alanında (:focus-visible eşleşse bile) çizgi ve halka yok.
    const search = page.getByRole('search').first().getByRole('searchbox');
    await search.click();
    await expect(search).toBeFocused();
    expectNoIndicator(await activeReport(page), 'fareyle arama alanı');

    // Tab görsel modu yeniden açar.
    await page.keyboard.press(tabKey(browserName));
    await page.waitForFunction(() => document.documentElement.dataset.keyboard === 'true');
    expectKeyboardLine(await activeReport(page), 'pointer sonrası Tab');
  });

  test('Alımlar listesi: satır düğmesinde çizgi satırın alt kenarında, halka yok', async ({ page, browserName }) => {
    await gotoAdmin(page, '/alimlar');
    const list = page.getByRole('list', { name: 'Alımlar' });
    await expect(list).toBeVisible();
    const rows = list.getByRole('button');
    await expect(rows.first()).toBeVisible();
    await keyboardFocus(page, browserName, () => rows.first().focus());
    await expect(rows.first()).toBeFocused();
    for (let index = 0; index < 3; index += 1) {
      if (index > 0) await page.keyboard.press(tabKey(browserName));
      expect(await list.evaluate(el => el.contains(document.activeElement)), `satır ${index + 1}: odak listeden çıktı`).toBe(true);
      expectKeyboardLine(await activeReport(page), `Alımlar satır ${index + 1}`);
    }
    // Pointer ile satıra dokunmak çizgiyi kaldırır (seçim odaktan ayrıdır).
    await rows.first().click();
    const pointerReport = await activeReport(page);
    if (pointerReport.focused) expectNoIndicator(pointerReport, 'Alımlar satırı pointer');
    else expect(pointerReport.keyboard).toBe(false);
  });

  test('filtre çekmecesi içinde: odak çekmecede, her öğede tek çizgi, kapanınca açan düğmeye döner', async ({ page, browserName }) => {
    // Masaüstünde filtre paneli açık durur; çekmece dar düzende vardır. Masaüstü projesinde tablet genişliğine iner.
    const viewport = page.viewportSize();
    if (viewport && viewport.width >= 1024) await page.setViewportSize({ width: 768, height: 1024 });
    await gotoLoadedAlimlar(page);
    const opener = page.getByRole('button', { name: /^Filtreler \(/ });
    await expect(opener).toBeVisible();
    await keyboardFocus(page, browserName, () => opener.focus());
    await expect(opener).toBeFocused();
    expectKeyboardLine(await activeReport(page), 'Filtreler düğmesi');

    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: /^Filtreler/ });
    await expect(dialog).toBeVisible();
    await expect.poll(() => dialog.evaluate(el => el.contains(document.activeElement)), { message: 'odak çekmeceye girmedi' }).toBe(true);
    const entry = await activeReport(page);
    expect(entry.rings, `çekmece giriş odağı · ${entry.describe}`).toEqual([]);

    for (let index = 0; index < 8; index += 1) {
      await page.keyboard.press(tabKey(browserName));
      expect(await dialog.evaluate(el => el.contains(document.activeElement)), `Tab ${index + 1}: odak çekmeceden kaçtı`).toBe(true);
      expectKeyboardLine(await activeReport(page), `çekmece Tab ${index + 1}`);
    }

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
    expectKeyboardLine(await activeReport(page), 'çekmece kapandıktan sonra Filtreler düğmesi');
  });
});

// Dedektör kendini doğrulama: ihlal enjekte edilir, dedektör yakalamazsa test FAIL olur. Böylece "çizgi var, halka yok"
// sonucu ölçümün kör olmasından gelmez.
test.describe('odak dedektörü kendini doğrulama', () => {
  async function injectAndFocus(page: Page, browserName: string, css: string) {
    await gotoLoadedAlimlar(page);
    await page.addStyleTag({ content: css });
    await enterKeyboardMode(page, browserName);
    return activeReport(page);
  }

  test('enjekte outline halkasını yakalar', async ({ page, browserName }) => {
    const report = await injectAndFocus(page, browserName,
      "html[data-keyboard='true'] :focus-visible { outline: 3px solid rgb(200, 0, 0) !important; outline-offset: 2px !important; }");
    expect(report.focused).toBe(true);
    expect(report.rings.join(' | ')).toContain('outline');
  });

  test('enjekte box-shadow halkasını yakalar', async ({ page, browserName }) => {
    const report = await injectAndFocus(page, browserName,
      "html[data-keyboard='true'] :focus-visible { box-shadow: 0 0 0 2px rgb(200, 0, 0) !important; }");
    expect(report.rings.join(' | ')).toContain('halka gölge');
  });

  test('enjekte pseudo çerçeveyi yakalar', async ({ page, browserName }) => {
    const report = await injectAndFocus(page, browserName,
      "html[data-keyboard='true'] :focus-visible::before { content: '' !important; position: absolute !important; inset: -4px !important; border: 2px solid rgb(200, 0, 0) !important; }");
    expect(report.rings.join(' | ')).toContain('kenarlı çerçeve');
  });

  test('kaldırılmış çizgiyi (görünmez klavye odağı) yakalar', async ({ page, browserName }) => {
    const report = await injectAndFocus(page, browserName, '*::after { content: none !important; }');
    expect(report.focused).toBe(true);
    expect(report.lines).toEqual([]);
  });

  test('yanlış renkli çizgiyi token dışı sayar', async ({ page, browserName }) => {
    const report = await injectAndFocus(page, browserName,
      "html[data-keyboard='true'] :focus-visible::after { background: rgb(200, 0, 0) !important; }");
    expect(report.lines.filter(line => line.via === 'after' && line.depth === 0)).toEqual([]);
  });

  test('temiz durumda yanlış pozitif yok', async ({ page, browserName }) => {
    const report = await injectAndFocus(page, browserName, '/* ihlal yok */');
    expectKeyboardLine(report, 'temiz');
  });
});
