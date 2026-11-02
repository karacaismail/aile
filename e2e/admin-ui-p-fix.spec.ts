import { test, expect, type Page, type Route } from '@playwright/test';
import { focusRing, smallText } from './admin-detectors';
import { horizontalOverflow, openAdmin } from './admin-helpers';

// p-fix: kabuğun tembel Sayfalar çekmecesi (shell/MobileNavDrawer, lazyResource 'shell-sayfalar') gerçek tarayıcıda,
// gerçek rotada (/genel). Niyet yalnız önyükler (M1, WCAG 3.2.1): düşmüş yüklemeden sonra Sayfalar'a yalnız odaklanmak
// modalı açmaz. Bekleme (m2): düğme aria-busy + aria-expanded, üst çubuğun altında tek ince şerit (::after; halka değil,
// reduced-motion'da durağan), kibar "Sayfalar yükleniyor…" duyurusu; Escape bekleyen açılışı iptal eder, geç gelen modül
// hiçbir şeyi açmaz. Hata: çevrim dışı parça hatası "Sayfalar yüklenemedi · Yeniden dene" (deneme odağı Sayfalar'a taşır);
// çevrim içi parça hatası eski sürümdür, "Yeni sürüm var · Yenile" sayfayı yeniden yükler (m8). Yükleniyor / hata / eski
// sürüm görünümleri ekran görüntüsüyle kayda geçer (outputPath). Projeler: chromium 320×568 ve webkit 390×844 dokunmatik.
// Ağ: modül isteği page.route ile tutulur ya da kesilir; önizleme dışına çıkan her istek kesilir (Google'a çağrı yok).
// Çevrim dışı durum navigator.onLine ile taklit edilir (setOffline Vite istemcisinin bağlantısını da keser). Emülasyon gerçek
// cihaz değildir; Firefox koşulmaz.

const ROUTE = '/genel';
const DRAWER_MODULE = (url: URL) => url.pathname.endsWith('/src/admin/shell/MobileNavDrawer.tsx');

const pagesButton = (page: Page) => page.getByRole('button', { name: 'Sayfalar', exact: true });
const topBar = (page: Page) => page.locator('.aile-admin-shell > header');
const main = (page: Page) => page.locator('main#admin-content');
const liveRegion = (page: Page) => topBar(page).locator('[aria-live="polite"]');
const notice = (page: Page) => main(page).locator('.aile-wide-notice[role="status"]');

/** Üst çubuğun bekleme şeridi (::after) hesaplanmış stili. */
const strip = (page: Page) => topBar(page).evaluate(element => {
  const style = getComputedStyle(element, '::after');
  return { content: style.content, position: style.position, height: style.height, animation: style.animationName, outline: style.outlineStyle, shadow: style.boxShadow };
});

const setOnline = (page: Page, online: boolean) => page.evaluate(value => {
  if (value) delete (navigator as unknown as Record<string, unknown>).onLine;
  else Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
}, online);

async function shot(page: Page, name: string, browserName: string) {
  await page.screenshot({ path: test.info().outputPath(`p-fix-${name}-${browserName}.png`) });
}

test.beforeEach(async ({ page }) => {
  await page.route(url => url.hostname !== '127.0.0.1', route => route.abort('blockedbyclient'));
});

test('bekleme: meşgul düğme, ince şerit, kibar duyuru; Escape iptal eder ve geç gelen modül hiçbir şeyi açmaz (m2)', async ({ page, browserName }) => {
  await openAdmin(page, ROUTE);
  let release!: () => void;
  const released = new Promise<void>(resolve => { release = resolve; });
  let requests = 0;
  await page.route(DRAWER_MODULE, async (route: Route) => { requests += 1; await released; await route.fallback(); });

  const button = pagesButton(page);
  await expect(liveRegion(page)).toHaveText('');
  await button.click();
  await expect.poll(() => requests, { message: 'çekmece modülü istenmeli' }).toBeGreaterThan(0);
  await expect(button).toHaveAttribute('aria-busy', 'true');
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await expect(liveRegion(page)).toHaveText('Sayfalar yükleniyor…');
  await expect(topBar(page)).toHaveAttribute('data-bekliyor', '');
  expect(await strip(page)).toEqual({ content: '""', position: 'absolute', height: '3px', animation: 'aile-shell-serit', outline: 'none', shadow: 'none' });
  expect(await horizontalOverflow(page), 'şerit yatay taşma yapmaz').toEqual([]);
  // Kanıt görüntüsü döngünün ortasında (parça görünür): şerit animasyonu duraklatılıp yarı süreye alınır.
  await page.evaluate(() => {
    for (const animation of document.getAnimations()) {
      if ((animation as CSSAnimation).animationName === 'aile-shell-serit') { animation.pause(); animation.currentTime = 600; }
    }
  });
  await shot(page, 'yukleniyor', browserName);

  // Hareket kapalıyken bekleme durumu anında görünür, şerit durağandır.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect((await strip(page)).animation).toBe('none');
  await shot(page, 'yukleniyor-durgun', browserName);
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  await page.keyboard.press('Escape');
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await expect(button).not.toHaveAttribute('aria-busy');
  await expect(liveRegion(page)).toHaveText('');
  await expect(topBar(page)).not.toHaveAttribute('data-bekliyor');

  release();
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.waitForTimeout(400);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(main(page)).not.toHaveAttribute('inert');

  // Modül hazır: açık etkinleştirme hemen açar.
  await button.click();
  await expect(page.getByRole('dialog', { name: 'Sayfalar' })).toBeVisible();
});

test('hata (çevrim dışı): "Sayfalar yüklenemedi · Yeniden dene"; yalnız odak açmaz (M1); deneme odağı Sayfalar\'a taşır ve açar', async ({ page, browserName }) => {
  await openAdmin(page, ROUTE);
  await setOnline(page, false);
  let requests = 0;
  let block = true;
  await page.route(DRAWER_MODULE, (route: Route) => { requests += 1; return block ? route.abort('failed') : route.fallback(); });

  const button = pagesButton(page);
  await button.click();
  await expect(notice(page)).toBeVisible({ timeout: 5000 });
  await expect(notice(page)).toHaveAttribute('data-kind', 'error');
  await expect(notice(page)).toContainText('Sayfalar yüklenemedi.');
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await expect(button).not.toHaveAttribute('aria-busy');
  await expect(main(page)).not.toHaveAttribute('inert');
  expect(await smallText(page, { root: '.aile-wide-notice' })).toEqual([]);
  await shot(page, 'hata', browserName);

  // Bağlantı geldi; kullanıcı yalnız odaklanır: deneme yok, modal yok (WCAG 3.2.1).
  block = false;
  await setOnline(page, true);
  const before = requests;
  await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); });
  await button.focus();
  await page.waitForTimeout(1200);
  expect(requests, 'yalnız odak düşmüş yüklemeyi yeniden başlatmaz').toBe(before);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(main(page)).not.toHaveAttribute('inert');

  // Açık deneme: odak Sayfalar'a geçer (bildirim sökülünce kaybolmaz), çekmece açılır, kapanınca odak geri döner.
  await notice(page).getByRole('button', { name: 'Yeniden dene' }).click();
  const dialog = page.getByRole('dialog', { name: 'Sayfalar' });
  await expect(dialog).toBeVisible();
  await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(button).toBeFocused();
  expect(await focusRing(page)).toEqual([]);
});

test('eski sürüm (çevrim içi parça hatası): "Yeni sürüm var · Yenile" sayfayı yeniden yükler (m8)', async ({ page, browserName }) => {
  await openAdmin(page, ROUTE);
  await page.route(DRAWER_MODULE, (route: Route) => route.abort('failed'));
  const button = pagesButton(page);
  await button.click();
  await expect(notice(page)).toBeVisible({ timeout: 5000 });
  await expect(notice(page)).toHaveAttribute('data-kind', 'stale-build');
  await expect(notice(page)).toContainText('Yeni sürüm var');
  await expect(notice(page).getByRole('button', { name: 'Yeniden dene' })).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(main(page)).not.toHaveAttribute('inert');
  expect(await smallText(page, { root: '.aile-wide-notice' })).toEqual([]);
  await shot(page, 'eski-surum', browserName);

  // Yenile: sayfa yeniden yüklenir (yeni index → yeni parça adları); sonra çekmece çalışır.
  await page.unroute(DRAWER_MODULE);
  await page.evaluate(() => { (window as unknown as { __pFixMarker?: boolean }).__pFixMarker = true; });
  await Promise.all([page.waitForEvent('load'), notice(page).getByRole('button', { name: 'Yenile' }).click()]);
  expect(await page.evaluate(() => (window as unknown as { __pFixMarker?: boolean }).__pFixMarker ?? false), 'sayfa yeniden yüklendi').toBe(false);
  await expect(main(page)).toBeVisible();
  await pagesButton(page).click();
  await expect(page.getByRole('dialog', { name: 'Sayfalar' })).toBeVisible();
});
