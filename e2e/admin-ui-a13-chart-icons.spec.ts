import { test, expect, type Locator, type Page } from '@playwright/test';
import { enterKeyboardMode, horizontalOverflow, openAdmin } from './admin-helpers';

// a13-chart-icons: Chart bileşeninin uyarlamalı teslimi gerçek rotada (/genel › "Aylık plan ve gerçek").
//  - Telefon profili ECharts istemez: açıklama tablosu görünür, "Grafiği göster" (aria-expanded) kullanıcı isteyince
//    çalışma zamanını (src/admin/ui/Chart.runtime.ts → echarts) o anda indirir. Ağ kanıtı: tıklamadan önce echarts/zrender
//    ya da Chart.runtime isteği yok.
//  - Geniş profilde grafik görünür alana girince (IntersectionObserver) yüklenir; açma düğmesi yoktur.
//  - Dokunma hedefi 44 px (kaba işaretçide 48), metin ≥14 px, çevreleyen odak halkası yok (klavye modunda tek alt
//    çizgi), reduced-motion'da geçiş yok, yükleme hatası kurtarılabilir, sayfa yatay taşmaz.
// Projeler: chromium 320×568 dokunmatik, webkit 390×844 dokunmatik (emülasyon gerçek cihaz değildir). @matrix testi
// entegrasyonda ek genişliklerde (360/375/320×480/568×320 telefon; 820 tablet; 1440 masaüstü) profilini okuyarak koşar.

const ROUTE = '/genel';
const REGION = 'Aylık plan ve gerçek';
const IMG_NAME = /değerler yanındaki tabloda/;
/** Dev sunucusunda ECharts önceden paketlenmiş bağımlılık (/.vite/deps/echarts_*.js) ve tembel modül olarak istenir. */
const ECHARTS_REQUEST = /echarts|zrender|Chart\.runtime/;

function recordChartRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on('request', request => {
    if (ECHARTS_REQUEST.test(request.url())) urls.push(new URL(request.url()).pathname);
  });
  return urls;
}

/** Ayrıntı düğmesi: adı duruma göre "Grafiği göster" / "Grafiği gizle" olur; konumlayıcı iki adı da tutar. */
const toggleIn = (region: Locator) => region.getByRole('button', { name: /^Grafiği (göster|gizle)$/ });

async function profileOf(page: Page): Promise<string> {
  return page.evaluate(() => document.documentElement.dataset.profile ?? 'yok');
}

async function chartRegion(page: Page): Promise<Locator> {
  const main = await openAdmin(page, ROUTE);
  const region = main.getByRole('region', { name: REGION });
  await expect(region).toBeVisible();
  return region;
}

/** Klavye/dokunma hedefi: görünür kutu (44 px; kaba işaretçide 48 px). */
async function expectTarget(page: Page, control: Locator) {
  const coarse = await page.evaluate(() => document.documentElement.hasAttribute('data-input-coarse'));
  const box = await control.boundingBox();
  expect(box, 'kontrol görünür olmalı').not.toBeNull();
  const min = coarse ? 48 : 44;
  expect(box!.height, `yükseklik ≥ ${min}`).toBeGreaterThanOrEqual(min - 0.5);
  expect(box!.width, `genişlik ≥ ${min}`).toBeGreaterThanOrEqual(min - 0.5);
}

/** Grafik yuvasını görünür alana getirir: yüklenmeden önce yuvada yalnız "Grafik hazırlanıyor" durumu vardır. */
async function scrollChartIntoView(region: Locator) {
  const pending = region.getByRole('status').filter({ hasText: 'Grafik hazırlanıyor' });
  if (await pending.count()) await pending.scrollIntoViewIfNeeded();
  else await region.getByRole('img', { name: IMG_NAME }).scrollIntoViewIfNeeded();
}

/** İki animasyon karesi: IntersectionObserver ilk geri çağrısı ve React güncellemesi için yeterli, sabit bekleme değil. */
async function twoFrames(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function fontSize(control: Locator): Promise<number> {
  return control.evaluate(el => Number.parseFloat(getComputedStyle(el).fontSize));
}

test('profil uyumlu teslim: telefonda tablo + "Grafiği göster" (ECharts istenmez), genişte görünür grafik', { tag: '@matrix' }, async ({ page }) => {
  const requests = recordChartRequests(page);
  const region = await chartRegion(page);
  const profile = await profileOf(page);
  const table = region.getByRole('table');
  await expect(table).toBeVisible();
  const img = region.getByRole('img', { name: IMG_NAME });

  if (profile === 'phone') {
    const toggle = toggleIn(region);
    await expect(toggle).toHaveText('Grafiği göster');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(img).toHaveCount(0);
    expect(requests, 'telefon profili kullanıcı istemeden ECharts indirmez').toEqual([]);
    await expectTarget(page, toggle);
    expect(await fontSize(toggle)).toBeGreaterThanOrEqual(14);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(toggle).toHaveText('Grafiği gizle');
    await expect(img).toBeVisible();
    await expect(img.locator('canvas').first()).toBeVisible();
    expect(requests.some(url => /Chart\.runtime/.test(url)), 'kullanıcı isteyince çalışma zamanı indirilir').toBe(true);
    // Açıklama tablosu yerinde kalır; grafik tek bilgi kaynağı değildir.
    await expect(table).toBeVisible();
  } else {
    await expect(toggleIn(region)).toHaveCount(0);
    await scrollChartIntoView(region);
    await expect(img).toBeVisible();
    await expect(img.locator('canvas').first()).toBeVisible();
  }
  expect(await horizontalOverflow(page), 'sayfa yatay taşmaz').toEqual([]);
});

test.describe('telefon profili', () => {
  test('dokunma: tap açar/kapar; grafik açıklama tablosuna bağlı; ikinci açılış yeniden indirmez', async ({ page }) => {
    const requests = recordChartRequests(page);
    const region = await chartRegion(page);
    test.skip(await profileOf(page) !== 'phone', 'yalnız telefon profili');
    const toggle = toggleIn(region);
    await expect(toggle).toHaveText('Grafiği göster');
    await toggle.tap();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const img = region.getByRole('img', { name: IMG_NAME });
    await expect(img).toBeVisible();
    const described = await img.getAttribute('aria-describedby');
    expect(described).toBeTruthy();
    await expect(page.locator(`[id="${described}"]`).getByRole('table')).toBeVisible();
    const runtimeRequests = () => requests.filter(url => /Chart\.runtime/.test(url)).length;
    const afterFirst = runtimeRequests();
    expect(afterFirst).toBeGreaterThan(0);
    await toggle.tap();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(img).toHaveCount(0);
    await toggle.tap();
    await expect(region.getByRole('img', { name: IMG_NAME })).toBeVisible();
    expect(runtimeRequests(), 'çalışma zamanı yeniden indirilmez').toBe(afterFirst);
  });

  test('klavye: Enter/Space açar-kapar, Escape ve oklar durumu değiştirmez; odak halkası yok, tek alt çizgi', async ({ page, browserName }) => {
    const region = await chartRegion(page);
    test.skip(await profileOf(page) !== 'phone', 'yalnız telefon profili');
    await enterKeyboardMode(page, browserName);
    const toggle = toggleIn(region);
    await expect(toggle).toHaveText('Grafiği göster');
    await toggle.focus();
    await expect(toggle).toBeFocused();
    const ring = await toggle.evaluate(el => {
      const cs = getComputedStyle(el);
      const after = getComputedStyle(el, '::after');
      return { outline: cs.outlineStyle, outlineWidth: cs.outlineWidth, shadow: cs.boxShadow, afterContent: after.content, afterHeight: after.height, afterBottom: after.bottom };
    });
    expect(ring.outline === 'none' || ring.outlineWidth === '0px', `outline ${ring.outline} ${ring.outlineWidth}`).toBe(true);
    expect(ring.shadow).toBe('none');
    expect(ring.afterContent).not.toBe('none');
    expect(ring.afterHeight).toBe('3px');
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(region.getByRole('img', { name: IMG_NAME })).toBeVisible();
    await expect(toggle).toBeFocused();
    for (const key of ['Escape', 'ArrowDown', 'ArrowUp']) {
      await page.keyboard.press(key);
      await expect(toggle, key).toHaveAttribute('aria-expanded', 'true');
      await expect(toggle, key).toBeFocused();
    }
    await page.keyboard.press('Space');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toBeFocused();
  });

  test('reduced-motion: düğme geçişi 0 s, durum anında; grafik yine çizilir', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const region = await chartRegion(page);
    test.skip(await profileOf(page) !== 'phone', 'yalnız telefon profili');
    const toggle = toggleIn(region);
    await expect(toggle).toHaveText('Grafiği göster');
    const durations = await toggle.evaluate(el => getComputedStyle(el).transitionDuration.split(',').map(value => Number.parseFloat(value)));
    expect(Math.max(...durations)).toBe(0);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(region.getByRole('img', { name: IMG_NAME })).toBeVisible();
  });

  test('yükleme hatası kurtarılabilir: "Hata:" + "Yeniden dene"; tablo kalır; sonunda grafik çizilir', async ({ page }) => {
    let block = true;
    await page.route(/Chart\.runtime/, route => (block ? route.abort('failed') : route.continue()));
    const region = await chartRegion(page);
    test.skip(await profileOf(page) !== 'phone', 'yalnız telefon profili');
    const toggle = toggleIn(region);
    await expect(toggle).toHaveText('Grafiği göster');
    await toggle.click();
    const alert = region.getByRole('alert');
    await expect(alert).toHaveText(/^Hata: Grafik yüklenemedi/);
    expect(await fontSize(alert)).toBeGreaterThanOrEqual(14);
    await expect(region.getByRole('table')).toBeVisible();
    const retry = region.getByRole('button', { name: 'Yeniden dene' });
    await expectTarget(page, retry);
    block = false;
    await retry.click();
    // Tarayıcı başarısız dinamik importu yeniden isterse grafik gelir; önbelleklerse eylem "Sayfayı yenile" olur.
    const img = region.getByRole('img', { name: IMG_NAME });
    const reload = region.getByRole('button', { name: 'Sayfayı yenile' });
    await expect(img.or(reload)).toBeVisible();
    if (await reload.isVisible()) {
      test.info().annotations.push({ type: 'retry', description: 'tarayıcı başarısız importu önbellekledi; yenileme yolu sınandı' });
      await expect(reload).toBeFocused();
      await reload.click();
      await page.waitForFunction(() => document.readyState === 'complete');
      const again = (await openAdmin(page, ROUTE)).getByRole('region', { name: REGION });
      await toggleIn(again).click();
      await expect(again.getByRole('img', { name: IMG_NAME })).toBeVisible();
    } else {
      test.info().annotations.push({ type: 'retry', description: 'tarayıcı importu yeniden istedi; grafik yeniden denemeyle geldi' });
      await expect(img).toBeVisible();
      await expect(toggleIn(region)).toHaveText('Grafiği gizle');
      await expect(toggleIn(region)).toBeFocused();
    }
  });
});

test('geniş profil (görünüm 1280×600): grafik görünür alana girince yüklenir, açma düğmesi yok', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  const requests = recordChartRequests(page);
  const main = await openAdmin(page, ROUTE);
  expect(await profileOf(page)).toBe('desktop');
  const region = main.getByRole('region', { name: REGION });
  await expect(toggleIn(region)).toHaveCount(0);
  const top = await region.evaluate(el => el.getBoundingClientRect().top);
  const viewport = page.viewportSize()!;
  if (top > viewport.height + 1) {
    // Kat altında: görünür alana girmeden ECharts indirilmez.
    await twoFrames(page);
    expect(requests, 'görünür alan dışındaki grafik ECharts indirmez').toEqual([]);
  } else {
    test.info().annotations.push({ type: 'fold', description: `grafik ilk görünür alanda (top=${Math.round(top)}); yalnız yükleme sınandı` });
  }
  const img = region.getByRole('img', { name: IMG_NAME });
  await scrollChartIntoView(region);
  await expect(img).toBeVisible();
  await expect(img.locator('canvas').first()).toBeVisible();
  expect(requests.some(url => /Chart\.runtime/.test(url))).toBe(true);
  expect(await horizontalOverflow(page)).toEqual([]);
});
