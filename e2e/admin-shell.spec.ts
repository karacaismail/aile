import { test, expect, type Locator, type Page } from '@playwright/test';
import { accentEdges, focusRing, smallText } from './admin-detectors';
import { adminNotReadyReasons, enterKeyboardMode, horizontalOverflow, openAdmin, shiftTabKey, tabKey } from './admin-helpers';

// Yönetim kabuğu (b01-shell): shell/WorkspaceShell.tsx (telefon temeli, yerel HTML), shell/MobileNavDrawer.tsx (Sayfalar
// alt sayfası, ARIA APG modal diyalog), shell/wide/WorkspaceNav.wide.tsx (masaüstü 272 px yan gezinme, lazyWide).
// Tasarım: tasarim-sistemi/README.md › Kabuk + Uyarlanır teslim. Sıra: önce 320×568 telefon yolculuğu, sonra @matrix
// (320×480, 360, 375, 568×320 telefon profili, 820×1180 tablet, 1440 masaüstü) ve profil değişimi.
// Seçiciler role/label ve kabuk sözleşmesi (main#admin-content, .aile-admin-shell, .aile-mobile-nav); antd iç sınıfı yok.
// Emülasyon gerçek cihaz değildir; güvenli alan (env(safe-area-inset-*)) Playwright'ta taklit edilemez.

const TOPBAR = 56;
const NAV_WIDTH = 272;
const DRAWER_TABLET = 384;
const CONTENT_MAX = 1480;
const MOTION_MS = 240;
const PHONE = { width: 320, height: 568 };
const PHONE_WEBKIT = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };
const PAGE_LINKS = [
  'Genel durum', 'Bütçe ve nakit', 'Ödemeler', 'Hesaplar ve borçlar', 'Alımlar ve eşyalar', 'Ev ve odalar',
  'Projeler ve görevler', 'Taraflar ve teklifler', 'Raporlar', 'Sözlükler ve iş akışları', 'Veri kalitesi ve içe aktarma',
];

const pagesButton = (page: Page) => page.getByRole('button', { name: 'Sayfalar', exact: true });
const navDialog = (page: Page) => page.getByRole('dialog', { name: 'Sayfalar' });
const topBar = (page: Page) => page.locator('.aile-admin-shell > header').filter({ has: pagesButton(page) });
const sideNav = (page: Page) => page.getByRole('complementary').filter({ has: page.getByRole('navigation', { name: 'Sayfalar' }) });
const main = (page: Page) => page.locator('main#admin-content');

/** Dokunmatik projede gerçek dokunuş (touch → pointer), diğerlerinde (chromium-desktop) fare tıklaması. */
const press = (target: Locator, touch: boolean | undefined) => (touch ? target.tap() : target.click());

/**
 * Profil değişiminden sonra kabuk yerine oturdu: <html data-profile> beklenen profil ve openAdmin'in hazır sinyali
 * (main görünür, dolu h1, aria-busy yok) iki ardışık karede. Geniş profilde tembel sağlayıcı/gezinme yüklenirken kök
 * aria-busy taşır (AdaptiveRoot); bu bitmeden ölçmek, sonradan gelen yeniden kurulumu gözden kaçırır.
 */
async function profileSettled(page: Page, profile: 'phone' | 'tablet' | 'desktop') {
  await expect(page.locator('html')).toHaveAttribute('data-profile', profile);
  await page.evaluate(() => { (window as unknown as { __kabukHazir?: number }).__kabukHazir = 0; });
  await page.waitForFunction(`(() => { const w = window; const ready = (${adminNotReadyReasons.toString()})().length === 0;
    w.__kabukHazir = ready ? (w.__kabukHazir ?? 0) + 1 : 0; return w.__kabukHazir >= 2; })()`, undefined, { polling: 'raf', timeout: 20_000 });
}

async function activeInside(locator: Locator): Promise<boolean> {
  return locator.evaluate(el => !!document.activeElement && el.contains(document.activeElement));
}

async function coarseInput(page: Page): Promise<boolean> {
  return (await page.locator('html').getAttribute('data-input-coarse')) !== null;
}

/** Alt sayfadaki çalışan geçiş/animasyon sayısı (süresi > 0). Ölçümden önce hareketin bitmesi beklenir. */
async function runningMotion(page: Page): Promise<number> {
  return page.evaluate(() => document.getAnimations().filter(animation => {
    const target = (animation.effect as KeyframeEffect | null)?.target;
    return target instanceof Element && !!target.closest('.aile-mobile-nav') && animation.playState === 'running'
      && Number(animation.effect?.getTiming().duration ?? 0) > 0;
  }).length);
}

async function settleMotion(page: Page) {
  await expect.poll(() => runningMotion(page), { timeout: MOTION_MS * 10 }).toBe(0);
}

interface MotionRecord { target: string; property: string; listed: string; duration: number; delay: number; easing: string }

/** transitionrun/animationstart olaylarını belge düzeyinde yakalar (zamanlamadan bağımsız kanıt); kapsam alt sayfa. */
async function installMotionProbe(page: Page) {
  await page.evaluate(() => {
    type Store = { records: MotionRecord[]; installed?: boolean };
    const w = window as unknown as { __kabukHareket?: Store };
    if (w.__kabukHareket?.installed) { w.__kabukHareket.records = []; return; }
    const store: Store = { records: [], installed: true };
    w.__kabukHareket = store;
    const split = (value: string) => {
      const out: string[] = [];
      let depth = 0;
      let current = '';
      for (const ch of value) {
        if (ch === '(') depth++;
        if (ch === ')') depth--;
        if (ch === ',' && depth === 0) { out.push(current.trim()); current = ''; } else current += ch;
      }
      if (current.trim()) out.push(current.trim());
      return out;
    };
    const ms = (value: string) => (value.trim().endsWith('ms') ? parseFloat(value) : parseFloat(value) * 1000);
    const pick = (list: string[], i: number) => list[i % Math.max(list.length, 1)] ?? '';
    const record = (event: TransitionEvent | AnimationEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest('.aile-mobile-nav')) return;
      const style = getComputedStyle(target, event.pseudoElement || null);
      const describe = `${target.tagName.toLowerCase()}.${String(target.className).split(/\s+/)[0]}`;
      if (event instanceof TransitionEvent) {
        const props = split(style.transitionProperty);
        let i = props.indexOf(event.propertyName);
        if (i < 0) i = props.indexOf('all');
        if (i < 0) i = 0;
        store.records.push({
          target: describe, property: event.propertyName, listed: props[i] ?? '', duration: ms(pick(split(style.transitionDuration), i)),
          delay: ms(pick(split(style.transitionDelay), i)), easing: pick(split(style.transitionTimingFunction), i),
        });
      } else {
        store.records.push({
          target: describe, property: event.animationName, listed: event.animationName, duration: ms(split(style.animationDuration)[0] ?? '0s'),
          delay: ms(split(style.animationDelay)[0] ?? '0s'), easing: split(style.animationTimingFunction)[0] ?? '',
        });
      }
    };
    document.addEventListener('transitionrun', record, true);
    document.addEventListener('animationstart', record, true);
  });
}

async function readMotionRecords(page: Page): Promise<MotionRecord[]> {
  return page.evaluate(() => (window as unknown as { __kabukHareket?: { records: MotionRecord[] } }).__kabukHareket?.records ?? []);
}

/** Normal: en az bir kayıt, her biri 240 ms, gecikme 0, tek onaylı eğri, `transition: all` değil. */
function motionProblems(records: MotionRecord[], label: string): string[] {
  const problems: string[] = [];
  if (records.length === 0) problems.push(`${label}: hareket kaydı yok`);
  for (const record of records) {
    const where = `${label}: ${record.target} ${record.property}`;
    if (Math.abs(record.duration - MOTION_MS) > 0.5) problems.push(`${where} süre ${record.duration}ms`);
    if (record.delay !== 0) problems.push(`${where} gecikme ${record.delay}ms`);
    if (record.easing.replace(/\s/g, '') !== 'cubic-bezier(0.65,0,0.35,1)') problems.push(`${where} eğri ${record.easing}`);
    if (record.listed === 'all') problems.push(`${where} transition-property all`);
  }
  return problems;
}

interface Margins { kenar: number; mainLeft: number; mainRight: number; barLeft: number | null; barRight: number | null }

/** Sayfa kenarı: b04 yoğunluk tokenı (--aile-yogunluk-kenar) ile main ve üst çubuğun yatay iç boşluğu, px. Emülasyonda
 *  güvenli alan 0'dır; değer tokenın bu görünümdeki bandıdır (sayfa kendi kenarını yazmaz). */
async function pageMargins(page: Page): Promise<Margins> {
  return page.evaluate(() => {
    const px = (value: string) => Number.parseFloat(value) || 0;
    const main = document.querySelector('main#admin-content')!;
    const mainStyle = getComputedStyle(main);
    const bar = document.querySelector('.aile-admin-shell > header');
    const barStyle = bar ? getComputedStyle(bar) : null;
    return {
      kenar: px(mainStyle.getPropertyValue('--aile-yogunluk-kenar')),
      mainLeft: px(mainStyle.paddingLeft),
      mainRight: px(mainStyle.paddingRight),
      barLeft: barStyle ? px(barStyle.paddingLeft) : null,
      barRight: barStyle ? px(barStyle.paddingRight) : null,
    };
  });
}

/** Kabuğun kendi işaretlemesinde (üst çubuk, atlama bağlantısı, çekmece, yan gezinme) antd sınıfı. */
async function antdInShell(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const shell = document.querySelector('.aile-admin-shell');
    if (!shell) return ['kabuk yok'];
    const own = Array.from(shell.children).filter(child => child.tagName !== 'MAIN');
    return own.flatMap(root => [root, ...Array.from(root.querySelectorAll('*'))])
      .filter(el => typeof el.className === 'string' && /(^|\s)ant-/.test(el.className))
      .map(el => `${el.tagName.toLowerCase()}.${String(el.className).split(/\s+/)[0]}`)
      .slice(0, 10);
  });
}

// --- 1. 320×568 telefon yolculuğu: üst çubuk, İçeriğe geç, Sayfalar alt sayfası (klavye + dokunma) --------------------

test('320×568 telefon: 56 px yapışkan üst çubuk, İçeriğe geç ve Sayfalar alt sayfasıyla sayfa değiştirme', async ({ page, browserName }, testInfo) => {
  const touch = testInfo.project.use.hasTouch;
  await page.setViewportSize(PHONE);
  await openAdmin(page, '/genel');
  await expect(page.locator('html')).toHaveAttribute('data-profile', 'phone');
  expect(await antdInShell(page), 'telefon kabuğunda antd işaretlemesi').toEqual([]);

  const bar = topBar(page);
  await expect(bar).toBeVisible();
  await expect(bar).toContainText(/aile\s*·\s*Genel durum/);
  const box = (await bar.boundingBox())!;
  expect(box.y).toBeCloseTo(0, 0);
  expect(box.height).toBeCloseTo(TOPBAR, 0);
  expect(box.width).toBeCloseTo(PHONE.width, 0);
  expect(await bar.evaluate(el => getComputedStyle(el).position)).toBe('sticky');
  await expect(sideNav(page)).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Sayfalar' })).toHaveCount(0);
  const minTarget = (await coarseInput(page)) ? 48 : 44;
  const button = (await pagesButton(page).boundingBox())!;
  expect(button.height).toBeGreaterThanOrEqual(minTarget - 0.5);
  expect(button.width).toBeGreaterThanOrEqual(minTarget - 0.5);
  expect(await smallText(page, { root: '.aile-admin-shell > header' })).toEqual([]);
  // Kenar: içerik ve üst çubuk aynı yoğunluk kenarında hizalı (marka ve Sayfalar içerik sütununun uçlarında).
  const margins = await pageMargins(page);
  expect(margins.kenar, '--aile-yogunluk-kenar tanımlı').toBeGreaterThan(0);
  expect(margins).toEqual({ kenar: margins.kenar, mainLeft: margins.kenar, mainRight: margins.kenar, barLeft: margins.kenar, barRight: margins.kenar });

  // Klavye: ilk durak İçeriğe geç (görünür, ekranda); Enter odağı main'e taşır, hash değişmez.
  await enterKeyboardMode(page, browserName);
  const skip = page.getByRole('link', { name: 'İçeriğe geç' });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport({ ratio: 1 });
  expect(await focusRing(page)).toEqual([]);
  await page.keyboard.press('Enter');
  await expect(main(page)).toBeFocused();
  await expect(page).toHaveURL(/#\/genel$/);

  // Sayfalar: main'den geri sekme düğmeye gelir; Enter modal alt sayfayı açar.
  await page.keyboard.press(shiftTabKey(browserName));
  await expect(pagesButton(page)).toBeFocused();
  expect(await focusRing(page)).toEqual([]);
  await expect(pagesButton(page)).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('Enter');
  const dialog = navDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await expect(pagesButton(page)).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(() => activeInside(dialog), 'açılınca odak alt sayfada').toBe(true);
  await expect(main(page)).toHaveAttribute('inert', '');
  await expect(bar).toHaveAttribute('inert', '');
  await expect(dialog.getByRole('heading', { level: 2, name: 'Sayfalar' })).toBeVisible();
  const nav = dialog.getByRole('navigation', { name: 'Sayfalar' });
  await expect(nav.getByRole('link')).toHaveCount(PAGE_LINKS.length + 1);
  await expect(nav.getByRole('link', { name: 'Genel durum' })).toHaveAttribute('aria-current', 'page');
  await settleMotion(page);
  const panel = (await dialog.boundingBox())!;
  expect(panel.x).toBeCloseTo(0, 0);
  expect(panel.width).toBeGreaterThanOrEqual(PHONE.width - 16 - 1);
  expect(panel.width).toBeLessThanOrEqual(PHONE.width);
  expect(await antdInShell(page), 'alt sayfada antd işaretlemesi').toEqual([]);
  expect(await smallText(page, { root: '.aile-mobile-nav' })).toEqual([]);
  expect(await accentEdges(page, { root: '.aile-admin-shell' })).toEqual([]);
  expect(await horizontalOverflow(page), 'alt sayfa açıkken taşma').toEqual([]);

  // Odak tuzağı: bağlantı sayısından fazla Tab'da odak alt sayfada kalır; her durakta tek alt çizgi.
  for (let i = 0; i < PAGE_LINKS.length + 4; i++) {
    await page.keyboard.press(tabKey(browserName));
    expect(await activeInside(dialog), `Tab ${i + 1}: odak alt sayfa dışına çıktı`).toBe(true);
    expect(await focusRing(page), `Tab ${i + 1}`).toEqual([]);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(pagesButton(page)).toBeFocused();
  await expect(pagesButton(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(main(page)).not.toHaveAttribute('inert', '');

  // İşaretçi (dokunmatik projede dokunuş, chromium-desktop'ta fare): Sayfalar → Ödemeler; alt sayfa kapanır, rota
  // değişir, odak main'e geçer.
  await press(pagesButton(page), touch);
  await expect(dialog).toBeVisible();
  await press(dialog.getByRole('link', { name: 'Ödemeler' }), touch);
  await expect(page).toHaveURL(/#\/odemeler$/);
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ödemeler');
  await expect(main(page)).toBeFocused();
  await expect(page).toHaveTitle('Ödemeler · aile');
  await expect(bar).toContainText('Ödemeler');
  expect(await horizontalOverflow(page)).toEqual([]);
});

test('320×568 telefon: alt sayfa 240 ms tek eğriyle açılır ve kapanır; işlev hareketi beklemez', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize(PHONE);
  await openAdmin(page, '/genel');
  await installMotionProbe(page);
  await pagesButton(page).click();
  await expect(navDialog(page)).toBeVisible();
  await settleMotion(page);
  expect(motionProblems(await readMotionRecords(page), 'açılış')).toEqual([]);

  await installMotionProbe(page);
  await page.keyboard.press('Escape');
  // İşlev anında: odak hareket bitmeden düğmeye döner; kapanış hareketi aynı süre ve eğride, sonra söküm.
  await expect(pagesButton(page)).toBeFocused({ timeout: MOTION_MS });
  await expect(page.locator('.aile-mobile-nav')).toHaveCount(0, { timeout: MOTION_MS * 10 });
  expect(motionProblems(await readMotionRecords(page), 'kapanış')).toEqual([]);
  await expect(navDialog(page)).toBeHidden();
});

test('320×568 telefon reduced-motion: alt sayfa anında açılır ve kapanır, hareket yok', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize(PHONE);
  await openAdmin(page, '/genel');
  await pagesButton(page).click();
  await expect(navDialog(page)).toBeVisible({ timeout: 100 });
  const running = await page.evaluate(() => document.getAnimations().filter(animation => {
    const target = (animation.effect as KeyframeEffect | null)?.target;
    return target instanceof Element && !!target.closest('.aile-mobile-nav') && Number(animation.effect?.getTiming().duration ?? 0) > 0;
  }).length);
  expect(running).toBe(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.aile-mobile-nav')).toHaveCount(0, { timeout: 100 });
  await expect(pagesButton(page)).toBeFocused();
});

// --- 2. Görünüm matrisi (@matrix): bu projenin görünümünde profilin kabuğu ----------------------------------------

test('kabuk bu görünümün profiline uyar: üst çubuk + alt sayfa ya da 272 px yan gezinme; taşma yok', { tag: '@matrix' }, async ({ page }) => {
  await openAdmin(page, '/genel');
  const viewport = page.viewportSize()!;
  const profile = await page.locator('html').getAttribute('data-profile');
  const shortEdge = Math.min(viewport.width, viewport.height);
  const expected = shortEdge < 480 || viewport.width < 600 ? 'phone' : viewport.width < 1024 ? 'tablet' : 'desktop';
  expect(profile).toBe(expected);
  expect(await horizontalOverflow(page)).toEqual([]);
  // Sayfa kenarı her profilde yoğunluk tokenından (bant tokenda; kabuk ayrı değer yazmaz).
  const margins = await pageMargins(page);
  expect(margins.kenar).toBeGreaterThan(0);
  expect([margins.mainLeft, margins.mainRight]).toEqual([margins.kenar, margins.kenar]);
  if (profile !== 'desktop') expect([margins.barLeft, margins.barRight]).toEqual([margins.kenar, margins.kenar]);

  if (profile === 'desktop') {
    const aside = sideNav(page);
    await expect(aside).toBeVisible();
    const box = (await aside.boundingBox())!;
    expect(box.x).toBeCloseTo(0, 0);
    expect(box.width).toBeCloseTo(NAV_WIDTH, 0);
    await expect(pagesButton(page)).toHaveCount(0);
    await expect(aside.getByRole('navigation', { name: 'Sayfalar' }).getByRole('link')).toHaveText(PAGE_LINKS);
    await expect(aside.getByRole('link', { name: 'Genel durum' })).toHaveAttribute('aria-current', 'page');
    const inner = (await page.locator('main#admin-content > *').first().boundingBox())!;
    expect(inner.width).toBeLessThanOrEqual(CONTENT_MAX);
    expect(inner.x).toBeGreaterThanOrEqual(NAV_WIDTH);
    return;
  }

  const bar = topBar(page);
  const box = (await bar.boundingBox())!;
  expect(box.y).toBeCloseTo(0, 0);
  expect(box.height).toBeCloseTo(TOPBAR, 0);
  expect(box.width).toBeCloseTo(viewport.width, 0);
  await expect(sideNav(page)).toHaveCount(0);
  expect(await antdInShell(page)).toEqual([]);

  await pagesButton(page).click();
  const dialog = navDialog(page);
  await expect(dialog).toBeVisible();
  await settleMotion(page);
  const panel = (await dialog.boundingBox())!;
  if (profile === 'tablet') expect(panel.width).toBeCloseTo(DRAWER_TABLET, 0);
  else {
    expect(panel.width).toBeGreaterThanOrEqual(viewport.width - 16 - 1);
    expect(panel.width).toBeLessThanOrEqual(viewport.width);
  }
  expect(panel.y).toBeCloseTo(0, 0);
  expect(panel.height).toBeLessThanOrEqual(viewport.height + 0.5);
  // Kısa yükseklikte liste alt sayfanın içinde kayar: Kapat görünür, son bağlantıya ulaşılır.
  await expect(dialog.getByRole('button', { name: 'Kapat' })).toBeInViewport({ ratio: 1 });
  const last = dialog.getByRole('link', { name: 'Ayarlar' });
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport({ ratio: 1 });
  expect(await horizontalOverflow(page), 'alt sayfa açıkken taşma').toEqual([]);
  expect(await smallText(page, { root: '.aile-mobile-nav' })).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(pagesButton(page)).toBeFocused();
});

// --- 3. Masaüstü (en son): 272 px yan gezinme, tembel ve yalnız geniş profilde indirilir ---------------------------

test('1440 masaüstü: yan gezinme 272 px, içerik ≤ 1480; geniş gezinme modülü telefonda indirilmez', async ({ page }) => {
  const wide: string[] = [];
  page.on('request', request => { if (/\/shell\/wide\//.test(request.url())) wide.push(new URL(request.url()).pathname); });
  await page.setViewportSize(PHONE);
  await openAdmin(page, '/alimlar');
  expect(wide, 'telefon profili geniş gezinmeyi indirdi').toEqual([]);

  await page.setViewportSize(DESKTOP);
  const aside = sideNav(page);
  await expect(aside).toBeVisible();
  const box = (await aside.boundingBox())!;
  expect(box.x).toBeCloseTo(0, 0);
  expect(box.width).toBeCloseTo(NAV_WIDTH, 0);
  await expect(pagesButton(page)).toHaveCount(0);
  await expect(topBar(page)).toHaveCount(0);
  await expect(aside.getByRole('link', { name: 'Alımlar ve eşyalar' })).toHaveAttribute('aria-current', 'page');
  await expect(aside.getByRole('link', { name: 'Ayarlar' })).toHaveAttribute('href', '#/ayarlar');
  await expect(aside.getByRole('link', { name: 'E-tabloyu aç (yeni sekmede açılır)' })).toHaveAttribute('target', '_blank');
  const inner = (await page.locator('main#admin-content > *').first().boundingBox())!;
  expect(inner.width).toBeLessThanOrEqual(CONTENT_MAX);
  expect(inner.x).toBeGreaterThanOrEqual(NAV_WIDTH);
  expect(await antdInShell(page), 'yan gezinmede antd işaretlemesi').toEqual([]);
  expect(await horizontalOverflow(page)).toEqual([]);
  expect(wide.length, 'geniş gezinme en az bir kez istendi').toBeGreaterThan(0);
  expect(new Set(wide).size, `geniş gezinme yinelenen istek: ${wide.join(', ')}`).toBe(wide.length);
});

// --- 4. Profil değişimi: rota, main, içerik, kaydırma ve odak korunur; çift başlatma yok ------------------------------

test('profil değişimi telefon ↔ masaüstü: rota, main, kaydırma ve odak korunur; geniş modül bir kez yüklenir', async ({ page, browserName }) => {
  const wide: string[] = [];
  page.on('request', request => { if (/\/shell\/wide\//.test(request.url())) wide.push(new URL(request.url()).pathname); });
  const phone = browserName === 'webkit' ? PHONE_WEBKIT : PHONE;
  await page.setViewportSize(phone);
  await openAdmin(page, '/alimlar');
  expect(wide).toEqual([]);

  // Sınama içeriği: main'in sonuna uzun bir alan ve içinde odaklanabilir düğme; main düğümü işaretlenir.
  await page.evaluate(() => {
    const host = document.querySelector('main#admin-content')!;
    const inner = host.firstElementChild ?? host;
    const spacer = document.createElement('div');
    spacer.id = 'kabuk-sinama';
    spacer.style.height = '3000px';
    const probe = document.createElement('button');
    probe.type = 'button';
    probe.id = 'kabuk-sinama-dugme';
    probe.textContent = 'Sınama düğmesi';
    probe.style.marginTop = '900px';
    spacer.append(probe);
    inner.append(spacer);
    (host as HTMLElement & { __kabukSinama?: string }).__kabukSinama = 'ayni-main';
  });
  const probeTop = () => page.evaluate(() => document.getElementById('kabuk-sinama-dugme')!.getBoundingClientRect().top);
  const sameMain = () => page.evaluate(() => (document.querySelector('main#admin-content') as HTMLElement & { __kabukSinama?: string } | null)?.__kabukSinama === 'ayni-main');
  await page.evaluate(() => { window.scrollBy(0, document.getElementById('kabuk-sinama-dugme')!.getBoundingClientRect().top - 300); });
  await expect.poll(probeTop).toBeCloseTo(300, 0);
  await page.locator('#kabuk-sinama-dugme').focus();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

  await page.setViewportSize(DESKTOP);
  await profileSettled(page, 'desktop');
  await expect(sideNav(page)).toBeVisible();
  expect(await sameMain(), 'main yeniden bağlandı').toBe(true);
  await expect(page.locator('main')).toHaveCount(1);
  await expect(page.locator('#kabuk-sinama-dugme')).toBeFocused();
  await expect(page).toHaveURL(/#\/alimlar$/);
  expect(Math.abs((await probeTop()) - 300), 'masaüstünde kaydırma konumu').toBeLessThanOrEqual(2);

  await page.setViewportSize(phone);
  await profileSettled(page, 'phone');
  await expect(topBar(page)).toBeVisible();
  await expect(sideNav(page)).toHaveCount(0);
  expect(await sameMain(), 'main yeniden bağlandı').toBe(true);
  await expect(page.locator('#kabuk-sinama-dugme')).toBeFocused();
  await expect(page).toHaveURL(/#\/alimlar$/);
  expect(Math.abs((await probeTop()) - 300), 'telefonda kaydırma konumu').toBeLessThanOrEqual(2);

  await page.setViewportSize(DESKTOP);
  await expect(sideNav(page)).toBeVisible();
  expect(new Set(wide).size, `geniş gezinme yinelenen istek: ${wide.join(', ')}`).toBe(wide.length);
  expect(wide.length).toBeGreaterThan(0);
});

test('profil değişimi: gezinmedeki odak karşılığına taşınır (Sayfalar ↔ yan gezinmede geçerli sayfa)', async ({ page, browserName }) => {
  const phone = browserName === 'webkit' ? PHONE_WEBKIT : PHONE;
  await page.setViewportSize(phone);
  await openAdmin(page, '/ev');
  await enterKeyboardMode(page, browserName);
  await page.keyboard.press(tabKey(browserName));
  await expect(pagesButton(page)).toBeFocused();

  await page.setViewportSize(DESKTOP);
  await profileSettled(page, 'desktop');
  const current = sideNav(page).getByRole('link', { name: 'Ev ve odalar' });
  await expect(current).toBeFocused();
  await expect(current).toHaveAttribute('aria-current', 'page');
  expect(await focusRing(page)).toEqual([]);

  await page.setViewportSize(phone);
  await profileSettled(page, 'phone');
  await expect(pagesButton(page)).toBeFocused();
  expect(await focusRing(page)).toEqual([]);
});
