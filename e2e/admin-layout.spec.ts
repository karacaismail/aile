import { test, expect, type Locator, type Page } from '@playwright/test';
import { enterKeyboardMode, gotoAdmin, horizontalOverflow, tabKey } from './admin-helpers';
import { accentEdgeViolations, motionViolations } from './admin-detectors';

// Yönetim kabuğu yerleşim kapısı (tasarim-sistemi/README.md › Kabuk + Uyarlanır teslim; shell/WorkspaceShell.tsx,
// shell/MobileNavDrawer.tsx, ui/Drawer.tsx). Kapsam: 320/768/1440'ta belge taşması yok; 1440'ta nav 272 px ve içerik
// ≤ 1480; 768/320'de 60 px yapışkan üst bar; Sayfalar çekmecesi modal, Escape kapatır, odak düğmeye döner; 200% metinde
// (zoom ve kullanıcı kök yazı boyutu) taşma yok; kavisli vurgu kenarı dedektörü; hareket dedektörü (çekmece 240 ms ve
// cubic-bezier(.65,0,.35,1), reduced-motion'da anlık). Her dedektörün kendi kendini sınayan testi en altta: bilinçli
// enjekte edilen ihlal yakalanmazsa kapı FAIL olur. Seçiciler role/label ve bizim sözleşme kökleri
// (main#admin-content, .aile-mobile-nav); antd iç sınıfı yok. Viewport her testte açıkça kurulur.

const DETECTORS = { accentEdgeViolations, motionViolations };
type DetectorName = keyof typeof DETECTORS;

const WIDTHS = { phone: { width: 320, height: 740 }, tablet: { width: 768, height: 1024 }, desktop: { width: 1440, height: 900 } } as const;
const ROUTES = ['/genel', '/butce', '/odemeler', '/hesaplar', '/alimlar', '/ev', '/projeler', '/taraflar', '/raporlar', '/sozlukler', '/veri', '/ayarlar'];
const NAV_WIDTH = 272;
const CONTENT_MAX = 1480;
const TOPBAR = 60;
const DRAWER_TABLET = 384;
const MOTION_MS = 240;
const MOTION_CURVE = [0.65, 0, 0.35, 1] as const;
/** Yalnız bizim className sözleşmemiz (MobileNavDrawer → Drawer rootClassName); antd iç sınıfı değil. */
const NAV_DRAWER_ROOT = '.aile-mobile-nav';

// --- Paylaşılan dedektörler (e2e/admin-detectors.ts) ----------------------------------------------------------------
// Dedektörler modül kapsamına bağlı değildir (src/admin/e2e-detectors.test.ts "kaynak metin olarak aktarım" bunu korur):
// fonksiyon kaynağı tarayıcıda yeniden kurulur ve gerçek getComputedStyle/getBoundingClientRect ile çalışır.

async function runDetector<K extends DetectorName>(page: Page, name: K, ...args: Parameters<(typeof DETECTORS)[K]>): Promise<string[]> {
  return page.evaluate(
    ([source, rest]) => (new Function(`return (${source})`)() as (...a: unknown[]) => string[])(...rest),
    [String(DETECTORS[name]), args] as [string, unknown[]],
  );
}

const accentEdges = (page: Page, root?: string) => runDetector(page, 'accentEdgeViolations', root ? { root } : {});

// --- Hareket dedektörü (olay tabanlı) --------------------------------------------------------------------------------
// transitionrun/animationstart olaylarını belge düzeyinde yakalar; her kayıt için o anki hesaplanmış süre, gecikme, eğri
// ve listelenen özellik okunur. Değerlendirme Node tarafında saf fonksiyonla yapılır (judgeMotion).

interface MotionRecord {
  kind: 'transition' | 'animation';
  target: string;
  property: string;
  listed: string;
  durationMs: number;
  delayMs: number;
  easing: string;
}

async function installMotionProbe(page: Page, scope: string) {
  await page.evaluate((scopeSelector) => {
    type Store = { records: MotionRecord[]; scope: string; installed?: boolean };
    const w = window as unknown as { __aileMotion?: Store };
    if (w.__aileMotion?.installed) {
      w.__aileMotion.records = [];
      w.__aileMotion.scope = scopeSelector;
      return;
    }
    const store: Store = { records: [], scope: scopeSelector, installed: true };
    w.__aileMotion = store;
    /** Virgülle ayrılmış CSS listesi; parantez içindeki virgüller (cubic-bezier) bölünmez. */
    const splitList = (value: string) => {
      const out: string[] = [];
      let depth = 0;
      let cur = '';
      for (const ch of value) {
        if (ch === '(') depth++;
        if (ch === ')') depth--;
        if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
      }
      if (cur.trim()) out.push(cur.trim());
      return out;
    };
    const ms = (v: string) => (v.trim().endsWith('ms') ? parseFloat(v) : parseFloat(v) * 1000);
    const pick = (list: string[], i: number) => list[i % Math.max(list.length, 1)] ?? '';
    const describe = (el: Element) => {
      const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
      return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls ? `.${cls}` : ''}`;
    };
    const record = (e: TransitionEvent | AnimationEvent) => {
      const target = e.target;
      if (!(target instanceof Element) || !target.closest(store.scope)) return;
      const cs = getComputedStyle(target, e.pseudoElement || null);
      if (e instanceof TransitionEvent) {
        const props = splitList(cs.transitionProperty);
        let i = props.indexOf(e.propertyName);
        if (i < 0) i = props.indexOf('all');
        if (i < 0) i = 0;
        store.records.push({
          kind: 'transition', target: describe(target) + (e.pseudoElement || ''), property: e.propertyName, listed: props[i] ?? '',
          durationMs: ms(pick(splitList(cs.transitionDuration), i)), delayMs: ms(pick(splitList(cs.transitionDelay), i)),
          easing: pick(splitList(cs.transitionTimingFunction), i),
        });
      } else {
        const names = splitList(cs.animationName);
        const i = Math.max(names.indexOf(e.animationName), 0);
        store.records.push({
          kind: 'animation', target: describe(target) + (e.pseudoElement || ''), property: e.animationName, listed: e.animationName,
          durationMs: ms(pick(splitList(cs.animationDuration), i)), delayMs: ms(pick(splitList(cs.animationDelay), i)),
          easing: pick(splitList(cs.animationTimingFunction), i),
        });
      }
    };
    document.addEventListener('transitionrun', record, true);
    document.addEventListener('animationstart', record, true);
  }, scope);
}

async function readMotion(page: Page): Promise<MotionRecord[]> {
  return page.evaluate(() => (window as unknown as { __aileMotion?: { records: MotionRecord[] } }).__aileMotion?.records ?? []);
}

/** Kapsamdaki çalışan Web Animations (CSS geçişleri dahil): reduced-motion'da boş olmalı. */
async function runningAnimations(page: Page, scope: string): Promise<string[]> {
  return page.evaluate((scopeSelector) => document.getAnimations()
    .filter((a) => {
      const t = (a.effect as KeyframeEffect | null)?.target;
      return t instanceof Element && !!t.closest(scopeSelector) && Number(a.effect?.getComputedTiming().duration ?? 0) > 0;
    })
    .map((a) => `${(a.effect as KeyframeEffect).target?.tagName.toLowerCase()} ${a.constructor.name} ${String(a.effect?.getComputedTiming().duration)}ms`), scope);
}

const CURVE_KEYWORDS: Record<string, readonly number[]> = {
  ease: [0.25, 0.1, 0.25, 1], 'ease-in': [0.42, 0, 1, 1], 'ease-out': [0, 0, 0.58, 1], 'ease-in-out': [0.42, 0, 0.58, 1],
};

function curveOf(easing: string): readonly number[] | null {
  const m = /^cubic-bezier\(([^)]+)\)$/.exec(easing.trim());
  if (m) return m[1].split(',').map((n) => Number(n.trim()));
  return CURVE_KEYWORDS[easing.trim()] ?? null;
}

/**
 * Saf değerlendirme. Normal: en az bir kayıt olmalı (boş geçiş = kanıtsız geçiş), her kayıt 240 ms, tek onaylı eğri,
 * gecikme 0 ve `transition: all` değil (UX hareket sözleşmesi). Reduced: süresi > 0 olan her kayıt ihlaldir.
 */
function judgeMotion(records: MotionRecord[], mode: { reduced: boolean; label: string }): string[] {
  const bad: string[] = [];
  if (mode.reduced) {
    for (const r of records) if (r.durationMs > 0) bad.push(`${mode.label}: reduced-motion'da ${r.kind} ${r.target} ${r.property} ${r.durationMs}ms`);
    return bad;
  }
  if (records.length === 0) bad.push(`${mode.label}: hareket kaydı yok (geçiş ölçülemedi)`);
  for (const r of records) {
    const where = `${mode.label}: ${r.kind} ${r.target} ${r.property}`;
    if (Math.abs(r.durationMs - MOTION_MS) > 0.5) bad.push(`${where} süre ${r.durationMs}ms ≠ ${MOTION_MS}ms`);
    if (r.delayMs !== 0) bad.push(`${where} gecikme ${r.delayMs}ms`);
    const curve = curveOf(r.easing);
    if (!curve || curve.length !== 4 || curve.some((v, i) => Math.abs(v - MOTION_CURVE[i]) > 1e-3)) bad.push(`${where} eğri ${r.easing}`);
    if (r.kind === 'transition' && r.listed === 'all') bad.push(`${where} transition-property all`);
  }
  return bad;
}

// --- Ortak adımlar ---------------------------------------------------------------------------------------------------

async function openAt(page: Page, size: { width: number; height: number }, hash = '/alimlar') {
  await page.setViewportSize(size);
  await gotoAdmin(page, hash);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

const pagesButton = (page: Page) => page.getByRole('button', { name: 'Sayfalar', exact: true });
const navDialog = (page: Page) => page.getByRole('dialog', { name: 'Sayfalar' });
const topBar = (page: Page) => page.locator('header').filter({ has: pagesButton(page) });
const desktopNav = (page: Page) => page.locator('aside').filter({ has: page.getByRole('navigation', { name: 'Sayfalar' }) });
const contentInner = (page: Page) => page.locator('main#admin-content > *').first();

async function activeInside(locator: Locator): Promise<boolean> {
  return locator.evaluate((el) => !!document.activeElement && el.contains(document.activeElement));
}

// --- 1. Belge taşması ve kavisli vurgu kenarı, her rota × 320/768/1440 --------------------------------------------

for (const [name, size] of Object.entries(WIDTHS)) {
  test(`${size.width} px (${name}): her rotada belge taşması ve kavisli vurgu kenarı yok`, async ({ page }) => {
    test.slow();
    await page.setViewportSize(size);
    for (const route of ROUTES) {
      await gotoAdmin(page, route);
      await expect(page.getByRole('heading', { level: 1 }), route).toBeVisible();
      expect(await horizontalOverflow(page), `${route} yatay taşma`).toEqual([]);
      expect(await accentEdges(page), `${route} kavisli vurgu kenarı`).toEqual([]);
    }
  });
}

// --- 2. Masaüstü: 272 px nav, içerik ≤ 1480 ----------------------------------------------------------------------------

test('1440 px: solda 272 px nav, üst bar yok, içerik ≤ 1480 ve nav sağında', async ({ page }) => {
  await openAt(page, WIDTHS.desktop);
  const nav = desktopNav(page);
  await expect(nav).toBeVisible();
  const navBox = (await nav.boundingBox())!;
  expect(navBox.x).toBeCloseTo(0, 0);
  expect(navBox.width).toBeCloseTo(NAV_WIDTH, 0);
  await expect(pagesButton(page)).toHaveCount(0);
  const inner = (await contentInner(page).boundingBox())!;
  expect(inner.width).toBeLessThanOrEqual(CONTENT_MAX);
  expect(inner.x).toBeGreaterThanOrEqual(NAV_WIDTH);
  expect(inner.x + inner.width).toBeLessThanOrEqual(WIDTHS.desktop.width);
});

test('geniş ekranda (2200 px) içerik tam 1480 px ve nav sağındaki alanda ortalı', async ({ page }) => {
  await openAt(page, { width: 2200, height: 900 });
  const inner = (await contentInner(page).boundingBox())!;
  expect(inner.width).toBeCloseTo(CONTENT_MAX, 0);
  const main = (await page.locator('main#admin-content').boundingBox())!;
  const leftGap = inner.x - main.x;
  const rightGap = main.x + main.width - (inner.x + inner.width);
  expect(Math.abs(leftGap - rightGap)).toBeLessThanOrEqual(1);
  expect(await horizontalOverflow(page)).toEqual([]);
});

// --- 3. Tablet ve telefon: 60 px yapışkan üst bar --------------------------------------------------------------------

for (const size of [WIDTHS.tablet, WIDTHS.phone]) {
  test(`${size.width} px: üst bar 60 px, üstte ve kaydırınca yapışkan; nav yan sütunu yok`, async ({ page }) => {
    // Kısa sayfa adı tek satıra sığar: ölçü sözleşmesi tam 60 px.
    await openAt(page, size, '/genel');
    const bar = topBar(page);
    await expect(bar).toBeVisible();
    await expect(desktopNav(page)).toHaveCount(0);
    const box = (await bar.boundingBox())!;
    expect(box.y).toBeCloseTo(0, 0);
    expect(box.height).toBeCloseTo(TOPBAR, 0);
    expect(box.width).toBeCloseTo(size.width, 0);
    expect(await bar.evaluate((el) => getComputedStyle(el).position)).toBe('sticky');

    // Kaydırılabilir içerik garanti: test için main içine boşluk eklenir (yalnız bu sayfa örneğinde).
    await page.evaluate(() => {
      const spacer = document.createElement('div');
      spacer.style.height = '300vh';
      spacer.setAttribute('aria-hidden', 'true');
      document.querySelector('main#admin-content')?.appendChild(spacer);
    });
    await page.evaluate(() => window.scrollTo(0, 800));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
    const scrolled = (await bar.boundingBox())!;
    expect(scrolled.y).toBeCloseTo(0, 0);
    expect(scrolled.height).toBeCloseTo(TOPBAR, 0);
    await expect(pagesButton(page)).toBeInViewport();
  });

  test(`${size.width} px: uzun sayfa adında üst bar ≥ 60 px, etiket kesilmez, taşma yok`, async ({ page }) => {
    await openAt(page, size, '/veri');
    const bar = topBar(page);
    const box = (await bar.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(TOPBAR - 0.5);
    const clipped = await bar.evaluate((el) => Array.from(el.querySelectorAll<HTMLElement>('*'))
      .filter((n) => n.scrollWidth > n.clientWidth + 1 && getComputedStyle(n).overflowX !== 'visible')
      .map((n) => n.tagName.toLowerCase()));
    expect(clipped, 'üst barda kesilen metin').toEqual([]);
    await expect(pagesButton(page)).toBeVisible();
    expect(await horizontalOverflow(page)).toEqual([]);
  });
}

// --- 4. Sayfalar çekmecesi: modal, odak tuzağı, Escape, odak dönüşü ----------------------------------------------------

for (const size of [WIDTHS.tablet, WIDTHS.phone]) {
  test(`${size.width} px: Sayfalar çekmecesi modal; odak içeride kalır; Escape kapatır ve odak düğmeye döner`, async ({ page, browserName }) => {
    await openAt(page, size);
    await enterKeyboardMode(page, browserName);
    const button = pagesButton(page);
    await expect(button).toHaveAttribute('aria-haspopup', 'dialog');
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await button.focus();
    await page.keyboard.press('Enter');

    const dialog = navDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect(dialog.getByRole('heading', { level: 2, name: 'Sayfalar' })).toBeVisible();
    await expect(dialog.getByRole('navigation', { name: 'Sayfalar' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Kapat' })).toBeVisible();
    await expect.poll(() => activeInside(dialog), 'açılınca odak çekmecede').toBe(true);

    // Genişlik: telefonda tam ekran (16 px örtü payı), tablette 384.
    const box = (await dialog.boundingBox())!;
    if (size.width >= 600) expect(box.width).toBeCloseTo(DRAWER_TABLET, 0);
    else {
      expect(box.width).toBeGreaterThanOrEqual(size.width - 16 - 1);
      expect(box.width).toBeLessThanOrEqual(size.width);
    }
    expect(await horizontalOverflow(page), 'çekmece açıkken taşma').toEqual([]);
    expect(await accentEdges(page), 'çekmecede kavisli vurgu kenarı').toEqual([]);

    // Odak tuzağı: bağlantı sayısından fazla Tab'da odak hep çekmecede kalır (modal).
    const stops = (await dialog.getByRole('link').count()) + 3;
    for (let i = 0; i < stops; i++) {
      await page.keyboard.press(tabKey(browserName));
      expect(await activeInside(dialog), `Tab ${i + 1}: odak çekmece dışına çıktı`).toBe(true);
    }

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(button).toBeFocused();
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('html')).toHaveAttribute('data-keyboard', 'true');
  });

  test(`${size.width} px: Kapat düğmesi kapatır ve odak döner; bağlantı seçimi gezinir, kapatır, odak main'e geçer`, async ({ page }) => {
    await openAt(page, size);
    const button = pagesButton(page);
    await button.click();
    const dialog = navDialog(page);
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Kapat' }).click();
    await expect(dialog).toBeHidden();
    await expect(button).toBeFocused();

    await button.click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('link', { name: 'Alımlar ve eşyalar' })).toHaveAttribute('aria-current', 'page');
    await dialog.getByRole('link', { name: 'Genel durum' }).click();
    await expect(page).toHaveURL(/#\/genel$/);
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Genel durum');
    await expect(page.locator('main#admin-content')).toBeFocused();
    await expect(page).toHaveTitle('Genel durum · aile');
  });
}

// --- 5. 200% metin: tarayıcı zoom'u (viewport yarıya iner) ve kullanıcı kök yazı boyutu ------------------------------

for (const size of [WIDTHS.desktop, WIDTHS.tablet]) {
  const zoomed = { width: size.width / 2, height: size.height / 2 };
  test(`${size.width} px @ 200% zoom (${zoomed.width} CSS px): taşma yok, başlık ve Sayfalar erişilebilir`, async ({ page }) => {
    await openAt(page, zoomed);
    expect(await horizontalOverflow(page)).toEqual([]);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(pagesButton(page)).toBeVisible();
    await pagesButton(page).click();
    await expect(navDialog(page)).toBeVisible();
    expect(await horizontalOverflow(page), 'zoom + çekmece').toEqual([]);
  });
}

for (const [name, size] of Object.entries(WIDTHS)) {
  test(`${size.width} px (${name}) kök yazı boyutu 200%: belge taşması yok`, async ({ page }) => {
    test.slow();
    await page.setViewportSize(size);
    for (const route of ['/genel', '/alimlar', '/butce', '/veri']) {
      await gotoAdmin(page, route);
      await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe('32px');
      expect(await horizontalOverflow(page), `${route} kök 200%`).toEqual([]);
    }
  });
}

// --- 6. Hareket: Sayfalar çekmecesi 240 ms tek eğri; reduced-motion anlık ------------------------------------------

for (const size of [WIDTHS.tablet, WIDTHS.phone]) {
  test(`${size.width} px: çekmece açılış ve kapanışı 240 ms, cubic-bezier(.65,0,.35,1), gecikmesiz`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await openAt(page, size);
    await installMotionProbe(page, NAV_DRAWER_ROOT);
    await pagesButton(page).click();
    await expect(navDialog(page)).toBeVisible();
    await page.waitForTimeout(MOTION_MS * 3);
    expect(judgeMotion(await readMotion(page), { reduced: false, label: 'açılış' })).toEqual([]);

    await installMotionProbe(page, NAV_DRAWER_ROOT);
    await page.keyboard.press('Escape');
    // İşlev anında: odak hareket bitmeden düğmeye döner.
    await expect(pagesButton(page)).toBeFocused({ timeout: MOTION_MS });
    await page.waitForTimeout(MOTION_MS * 3);
    expect(judgeMotion(await readMotion(page), { reduced: false, label: 'kapanış' })).toEqual([]);
    await expect(navDialog(page)).toBeHidden();
  });

  test(`${size.width} px reduced-motion: çekmece anlık açılır ve kapanır, hareket yok`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openAt(page, size);
    await installMotionProbe(page, NAV_DRAWER_ROOT);
    await pagesButton(page).click();
    await expect(navDialog(page)).toBeVisible({ timeout: 100 });
    expect(await runningAnimations(page, NAV_DRAWER_ROOT), 'açılışta çalışan animasyon').toEqual([]);
    expect(await runDetector(page, 'motionViolations', 'cubic-bezier(.65,0,.35,1)', MOTION_MS, { root: NAV_DRAWER_ROOT, reduced: true }))
      .toEqual([]);
    await page.waitForTimeout(MOTION_MS * 2);
    expect(judgeMotion(await readMotion(page), { reduced: true, label: 'açılış' })).toEqual([]);

    await installMotionProbe(page, NAV_DRAWER_ROOT);
    await page.keyboard.press('Escape');
    await expect(navDialog(page)).toBeHidden({ timeout: 100 });
    await expect(pagesButton(page)).toBeFocused();
    await page.waitForTimeout(MOTION_MS * 2);
    expect(judgeMotion(await readMotion(page), { reduced: true, label: 'kapanış' })).toEqual([]);
  });
}

// --- 7. Dedektör kendi kendini sınama: enjekte edilen ihlal yakalanmalı, uyumlu örnek temiz kalmalı ----------------

const ACCENT_FIXTURE = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><style>
  body { margin: 0; font: 16px/24px sans-serif; }
  .kutu { position: relative; width: 240px; height: 80px; margin: 8px; border-radius: 12px; background: rgb(255, 255, 255); }
  #v-border .kutu { border-left: 4px solid rgb(0, 80, 200); }
  #v-inline .kutu { border-inline-start: 3px solid rgb(0, 80, 200); }
  #v-top .kutu { border-top: 4px solid rgb(200, 40, 40); }
  #v-shadow .kutu { box-shadow: inset 4px 0 0 0 rgb(0, 80, 200); }
  #v-pseudo .kutu::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: rgb(0, 80, 200); }
  #ok-flat .kutu { border-left: 4px solid rgb(0, 80, 200); border-top-left-radius: 0; border-bottom-left-radius: 0; }
  #ok-uniform .kutu { border: 1px solid rgb(200, 200, 200); }
  #ok-plain .kutu { box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2); }
</style></head><body>
  <section id="v-border"><div class="kutu">Sol şerit</div></section>
  <section id="v-inline"><div class="kutu">Mantıksal şerit</div></section>
  <section id="v-top"><div class="kutu">Üst şerit</div></section>
  <section id="v-shadow"><div class="kutu">İç gölge çubuğu</div></section>
  <section id="v-pseudo"><div class="kutu">Pseudo şerit</div></section>
  <section id="ok-flat"><div class="kutu">Düz çizgi, köşesiz kenar</div></section>
  <section id="ok-uniform"><div class="kutu">Eşit kenarlık</div></section>
  <section id="ok-plain"><div class="kutu">Yükselti gölgesi</div></section>
</body></html>`;

test.describe('dedektör kendi kendini sınama', () => {
  test('kavisli vurgu kenarı: border, border-inline, üst kenar, iç gölge ve pseudo şerit yakalanır; düz/eşit/gölge temiz', async ({ page }) => {
    await page.setContent(ACCENT_FIXTURE);
    for (const root of ['#v-border', '#v-inline', '#v-top', '#v-shadow', '#v-pseudo']) {
      expect((await accentEdges(page, root)).length, `${root} ihlali yakalanmalı`).toBeGreaterThan(0);
    }
    for (const root of ['#ok-flat', '#ok-uniform', '#ok-plain']) {
      expect(await accentEdges(page, root), `${root} uyumlu`).toEqual([]);
    }
  });

  test('hareket: 500 ms ease, gecikme ve transition all yakalanır; 240 ms onaylı eğri temiz; reduced-motion her süreyi yakalar', async ({ page }) => {
    await page.setContent(`<!doctype html><html><body>
      <div id="kotu"><div class="m" style="width:40px;height:40px;transition: opacity 500ms ease 0s"></div></div>
      <div id="gecikme"><div class="m" style="width:40px;height:40px;transition: opacity 240ms cubic-bezier(.65,0,.35,1) 100ms"></div></div>
      <div id="hepsi"><div class="m" style="width:40px;height:40px;transition: all 240ms cubic-bezier(.65,0,.35,1)"></div></div>
      <div id="iyi"><div class="m" style="width:40px;height:40px;transition: opacity 240ms cubic-bezier(.65,0,.35,1)"></div></div>
    </body></html>`);
    const run = async (scope: string) => {
      await installMotionProbe(page, scope);
      await page.evaluate((s) => {
        const el = document.querySelector<HTMLElement>(`${s} .m`)!;
        void el.offsetWidth;
        el.style.opacity = el.style.opacity === '0' ? '1' : '0';
      }, scope);
      await page.waitForTimeout(800);
      return readMotion(page);
    };

    const kotu = judgeMotion(await run('#kotu'), { reduced: false, label: 'kotu' });
    expect(kotu.some((m) => m.includes('500ms'))).toBe(true);
    expect(kotu.some((m) => m.includes('eğri ease'))).toBe(true);
    expect(judgeMotion(await run('#gecikme'), { reduced: false, label: 'gecikme' }).some((m) => m.includes('gecikme 100ms'))).toBe(true);
    expect(judgeMotion(await run('#hepsi'), { reduced: false, label: 'hepsi' }).some((m) => m.includes('transition-property all'))).toBe(true);

    const iyi = await run('#iyi');
    expect(iyi.length).toBeGreaterThan(0);
    expect(judgeMotion(iyi, { reduced: false, label: 'iyi' })).toEqual([]);
    expect(judgeMotion(iyi, { reduced: true, label: 'iyi-reduced' }).length).toBeGreaterThan(0);
    expect(judgeMotion([], { reduced: false, label: 'bos' })).toEqual(['bos: hareket kaydı yok (geçiş ölçülemedi)']);
    expect(judgeMotion([], { reduced: true, label: 'bos' })).toEqual([]);
  });

  test('paylaşılan motionViolations reduced-motion kipinde süreli geçişi yakalar, sıfır süreyi geçirir', async ({ page }) => {
    await page.setContent(`<!doctype html><html><body>
      <div id="sureli"><div style="width:40px;height:40px;transition: opacity 240ms cubic-bezier(.65,0,.35,1)"></div></div>
      <div id="anlik"><div style="width:40px;height:40px;transition: none"></div></div>
    </body></html>`);
    const opts = (root: string) => ({ root, reduced: true });
    expect((await runDetector(page, 'motionViolations', 'cubic-bezier(.65,0,.35,1)', MOTION_MS, opts('#sureli'))).length).toBeGreaterThan(0);
    expect(await runDetector(page, 'motionViolations', 'cubic-bezier(.65,0,.35,1)', MOTION_MS, opts('#anlik'))).toEqual([]);
  });

  test('horizontalOverflow: enjekte edilen geniş öğe belge taşması olarak yakalanır', async ({ page }) => {
    await page.setViewportSize(WIDTHS.phone);
    await page.setContent('<!doctype html><html><body style="margin:0"><div id="genis" style="width:600px;height:20px"></div></body></html>');
    const found = await horizontalOverflow(page);
    expect(found.some((m) => m.startsWith('document'))).toBe(true);
    await page.evaluate(() => document.getElementById('genis')!.remove());
    expect(await horizontalOverflow(page)).toEqual([]);
  });
});
