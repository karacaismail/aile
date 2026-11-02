import { test, expect, type Locator, type Page } from '@playwright/test';
import { enterKeyboardMode, horizontalOverflow, openAdmin, tabKey } from './admin-helpers';

// a13-chart-icons: Chart bileşeninin uyarlamalı teslimi gerçek rotada (/genel › "Aylık plan ve gerçek").
// Ürün sözleşmesi (W0 + Genel sayfası): grafik yalnız geniş sunumdadır. Chart'ı çizen her sayfa parçası *.wide modülüdür
// (GenelPage.wide, raporlar/RaporGrafik.wide, butce/ButceTrend.wide, hesaplar/Projeksiyon.wide) ve lazyWide ile yalnız
// tablet/masaüstünde iner. Telefon /genel aynı değerleri ay akordeonunda verir (tablolar telefonda akordeondur) ve ne
// Chart modülünü ne ECharts'ı ister — kaydırınca da. ui/Chart'ın telefon ayrıntı düğmesi ("Grafiği göster") bileşen
// düzeyinde src/admin/ui/Chart.test.tsx'te sınanır; telefonda grafik çizen bir rota yoktur.
//  - Geniş profilde grafik görünür alana girince (IntersectionObserver) yüklenir; açma düğmesi yoktur; grafik
//    (role=img) yanındaki değer tablosuna aria-describedby ile bağlıdır, tablo grafik çizilince de yerinde kalır.
//  - ECharts çalışma zamanı (src/admin/ui/Chart.runtime.ts) tek yüklemedir: ikinci grafik onu yeniden indirmez.
//  - Yükleme hatası kurtarılabilir ("Hata: …" + "Yeniden dene", değerler kalır); eylem 44 px (kaba işaretçide 48),
//    metin ≥ 14 px, klavyeyle ulaşılır, çevreleyen odak halkası yok (klavye modunda tek alt çizgi), reduced-motion'da
//    geçiş yok; sayfa yatay taşmaz.
// Projeler: chromium 320×568 ve webkit 390×844 dokunmatik (telefon). Geniş davranış testleri bu projelerde görünümü
// 820×1180'e (tablet; dokunmatik proje kaba işaretçiyi korur) alır; @matrix testi entegrasyonda ek genişliklerde
// (360/375/320×480/568×320 telefon; 820 tablet; 1440 masaüstü) profilini okuyarak koşar. Emülasyon gerçek cihaz değildir.

const ROUTE = '/genel';
const REGION = 'Aylık plan ve gerçek';
const IMG_NAME = /değerler yanındaki tabloda/;
/** Telefonda değer tablosunun akordeon karşılığı (AccordionList bölgesi: "6 ay · Planlanan ve Gerçekleşen"). */
const AY_LISTESI = /^\d+ ay · Planlanan ve Gerçekleşen$/;
/** Dev sunucusunda ECharts önceden paketlenmiş bağımlılık (/.vite/deps/echarts_*.js) ve tembel modül olarak istenir. */
const ECHARTS_REQUEST = /echarts|zrender|Chart\.runtime/;
/** Telefonda istenmemesi gereken her grafik parçası: ECharts + Chart bileşeni (dev: /src/admin/ui/Chart.*, derleme: Chart-*). */
const CHART_REQUEST = /echarts|zrender|Chart\.runtime|\/ui\/Chart\.|\/assets\/Chart-/;
const TABLET = { width: 820, height: 1180 };

function recordRequests(page: Page, pattern: RegExp): string[] {
  const urls: string[] = [];
  page.on('request', request => {
    if (pattern.test(request.url())) urls.push(new URL(request.url()).pathname);
  });
  return urls;
}

/** Telefonda olmaması gereken ayrıntı düğmesi; konumlayıcı iki adı da tutar. */
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

/** Geniş sunumda açar: telefon görünümündeki projede görünüm önce tablete alınır (profil W0: < 600 ya da kısa kenar < 480). */
async function wideChartRegion(page: Page): Promise<Locator> {
  const { width, height } = page.viewportSize()!;
  if (width < 600 || Math.min(width, height) < 480) await page.setViewportSize(TABLET);
  const region = await chartRegion(page);
  expect(await profileOf(page), 'geniş profil').not.toBe('phone');
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

/**
 * Grafik yuvasını görünür alana getirir: yüklenmeden önce yuvada yalnız "Grafik hazırlanıyor" durumu vardır. Geniş modül
 * (lazyWide) inerken telefon sunumu yedek olarak görünebilir (Adaptive); yuva (bekleme, grafik ya da hata) çizilene kadar
 * beklenir, sonra o öğe kaydırılır.
 */
async function scrollChartIntoView(region: Locator) {
  const pending = region.getByRole('status').filter({ hasText: 'Grafik hazırlanıyor' });
  const img = region.getByRole('img', { name: IMG_NAME });
  const error = region.getByRole('alert');
  await expect(pending.or(img).or(error).first()).toBeAttached();
  const target = (await pending.count()) ? pending : (await img.count()) ? img : error;
  await target.first().scrollIntoViewIfNeeded();
}

/** İki animasyon karesi: IntersectionObserver ilk geri çağrısı ve React güncellemesi için yeterli, sabit bekleme değil. */
async function twoFrames(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function fontSize(control: Locator): Promise<number> {
  return control.evaluate(el => Number.parseFloat(getComputedStyle(el).fontSize));
}

/** Grafiğin aria-describedby ile bağlandığı öğe; değer tablosunu içermeli. */
async function describedTable(page: Page, img: Locator): Promise<Locator> {
  const described = await img.getAttribute('aria-describedby');
  expect(described, 'grafik açıklamaya bağlı').toBeTruthy();
  return page.locator(`[id="${described}"]`).getByRole('table');
}

/** Yükleme hatası: grafik yuvasında "Hata: …", değerler yerinde; "Yeniden dene" 44/48 px ve ≥ 14 px. */
async function expectLoadError(page: Page, region: Locator): Promise<Locator> {
  const alert = region.getByRole('alert');
  await expect(alert).toHaveText(/^Hata: Grafik yüklenemedi/);
  expect(await fontSize(alert)).toBeGreaterThanOrEqual(14);
  await expect(region.getByRole('table')).toBeVisible();
  const retry = region.getByRole('button', { name: 'Yeniden dene' });
  await expectTarget(page, retry);
  expect(await fontSize(retry)).toBeGreaterThanOrEqual(14);
  return retry;
}

test('profil uyumlu teslim: telefonda değer akordeonu (grafik ve ECharts istenmez), genişte görünür grafik ve yanında tablo', { tag: '@matrix' }, async ({ page }) => {
  const chartRequests = recordRequests(page, CHART_REQUEST);
  const region = await chartRegion(page);
  const profile = await profileOf(page);
  const img = region.getByRole('img', { name: IMG_NAME });

  if (profile === 'phone') {
    const values = region.getByRole('region', { name: AY_LISTESI });
    await expect(values).toBeVisible();
    await expect(values.getByRole('button', { name: /\d{4}/ }).first()).toHaveAttribute('aria-expanded', 'true');
    await expect(region.getByRole('table')).toHaveCount(0);
    await expect(toggleIn(region)).toHaveCount(0);
    await expect(region.getByRole('img')).toHaveCount(0);
    // Kullanıcı gibi sonuna kadar kaydırılır: görünür alana giren blok da grafik parçası istemez.
    await region.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await twoFrames(page);
    expect(chartRequests, 'telefon profili grafik bileşeni ya da ECharts indirmez').toEqual([]);
  } else {
    await expect(region.getByRole('table')).toBeVisible();
    await expect(toggleIn(region)).toHaveCount(0);
    await scrollChartIntoView(region);
    await expect(img).toBeVisible();
    await expect(img.locator('canvas').first()).toBeVisible();
    await expect(await describedTable(page, img)).toBeVisible();
    expect(chartRequests.some(url => /Chart\.runtime/.test(url)), 'görünür grafik çalışma zamanını ister').toBe(true);
  }
  expect(await horizontalOverflow(page), 'sayfa yatay taşmaz').toEqual([]);
});

test.describe('geniş sunum (telefon projelerinde görünüm 820×1180)', () => {
  test('grafik değer tablosuna bağlı ve tablo yerinde kalır; ikinci grafik çalışma zamanını yeniden indirmez', async ({ page }) => {
    const requests = recordRequests(page, ECHARTS_REQUEST);
    const region = await wideChartRegion(page);
    await scrollChartIntoView(region);
    const img = region.getByRole('img', { name: IMG_NAME });
    await expect(img).toBeVisible();
    const table = await describedTable(page, img);
    await expect(table).toBeVisible();
    await expect(table.getByRole('row', { name: /2026/ }).first()).toBeVisible();
    const runtimeRequests = () => requests.filter(url => /Chart\.runtime/.test(url)).length;
    const afterFirst = runtimeRequests();
    expect(afterFirst).toBeGreaterThan(0);

    // Aynı oturumda başka bir grafik (Raporlar › Aylık plan ve gerçek): yeni yükleme yok, grafik çizilir.
    await page.evaluate(() => { window.location.hash = '#/raporlar'; });
    const raporGrafigi = page.getByRole('img', { name: /Aylara göre planlanan ve gerçekleşen/ });
    const raporBekleme = page.locator('main#admin-content').getByRole('status').filter({ hasText: 'Grafik hazırlanıyor' });
    await expect(raporGrafigi.or(raporBekleme).first()).toBeAttached();
    if (await raporBekleme.count()) await raporBekleme.first().scrollIntoViewIfNeeded();
    await expect(raporGrafigi).toBeVisible();
    await expect(raporGrafigi.locator('canvas').first()).toBeVisible();
    expect(runtimeRequests(), 'çalışma zamanı yeniden indirilmez').toBe(afterFirst);
  });

  test('klavye: "Yeniden dene" Tab ile ulaşılır, Enter çalıştırır; odak bölgede kalır, oklar ve Escape durumu değiştirmez; halka yok, tek alt çizgi', async ({ page, browserName }) => {
    let block = true;
    await page.route(/Chart\.runtime/, route => (block ? route.abort('failed') : route.continue()));
    const region = await wideChartRegion(page);
    await scrollChartIntoView(region);
    const retry = await expectLoadError(page, region);

    // Klavye modu ve Tab sırası: bölgenin başlık bağlantısından sonraki durak "Yeniden dene".
    await enterKeyboardMode(page, browserName);
    await region.getByRole('link').first().focus();
    await page.keyboard.press(tabKey(browserName));
    await expect(retry).toBeFocused();
    const ring = await retry.evaluate(el => {
      const cs = getComputedStyle(el);
      const after = getComputedStyle(el, '::after');
      return { outline: cs.outlineStyle, outlineWidth: cs.outlineWidth, shadow: cs.boxShadow, afterContent: after.content, afterHeight: after.height };
    });
    expect(ring.outline === 'none' || ring.outlineWidth === '0px', `outline ${ring.outline} ${ring.outlineWidth}`).toBe(true);
    expect(ring.shadow).toBe('none');
    expect(ring.afterContent).not.toBe('none');
    expect(ring.afterHeight).toBe('3px');

    block = false;
    await page.keyboard.press('Enter');
    const img = region.getByRole('img', { name: IMG_NAME });
    const reload = region.getByRole('button', { name: 'Sayfayı yenile' });
    await expect(img.or(reload)).toBeVisible();
    // Odak kaybolmaz: başarılıysa grafiğin yuvasına, tarayıcı başarısız importu önbelleklediyse yeni eyleme geçer.
    await expect.poll(() => region.evaluate(el => el.contains(document.activeElement))).toBe(true);
    if (await reload.isVisible()) {
      test.info().annotations.push({ type: 'retry', description: 'tarayıcı başarısız importu önbellekledi; odak "Sayfayı yenile"de' });
      await expect(reload).toBeFocused();
      return;
    }
    for (const key of ['Escape', 'ArrowDown', 'ArrowUp']) {
      await page.keyboard.press(key);
      await expect(img, key).toBeVisible();
      await expect.poll(() => region.evaluate(el => el.contains(document.activeElement)), { message: key }).toBe(true);
    }
  });

  test('reduced-motion: eylem geçişi 0 s, durum anında; grafik yine çizilir', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    let block = true;
    await page.route(/Chart\.runtime/, route => (block ? route.abort('failed') : route.continue()));
    const region = await wideChartRegion(page);
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
    await scrollChartIntoView(region);
    const retry = await expectLoadError(page, region);
    const durations = await retry.evaluate(el => getComputedStyle(el).transitionDuration.split(',').map(value => Number.parseFloat(value)));
    expect(Math.max(...durations)).toBe(0);
    block = false;
    await retry.click();
    const img = region.getByRole('img', { name: IMG_NAME });
    const reload = region.getByRole('button', { name: 'Sayfayı yenile' });
    await expect(img.or(reload)).toBeVisible();
    if (await reload.isVisible()) {
      test.info().annotations.push({ type: 'retry', description: 'tarayıcı başarısız importu önbellekledi; grafik yeniden açılışta sınandı' });
      await page.unroute(/Chart\.runtime/);
      const again = await chartRegion(page);
      await scrollChartIntoView(again);
      await expect(again.getByRole('img', { name: IMG_NAME }).locator('canvas').first()).toBeVisible();
      return;
    }
    await expect(img.locator('canvas').first()).toBeVisible();
  });

  test('yükleme hatası kurtarılabilir: "Hata:" + "Yeniden dene"; değerler kalır; sonunda grafik çizilir', async ({ page }) => {
    let block = true;
    await page.route(/Chart\.runtime/, route => (block ? route.abort('failed') : route.continue()));
    const region = await wideChartRegion(page);
    await scrollChartIntoView(region);
    const retry = await expectLoadError(page, region);
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
      await scrollChartIntoView(again);
      await expect(again.getByRole('img', { name: IMG_NAME })).toBeVisible();
    } else {
      test.info().annotations.push({ type: 'retry', description: 'tarayıcı importu yeniden istedi; grafik yeniden denemeyle geldi' });
      await expect(img).toBeVisible();
      await expect(img.locator('canvas').first()).toBeVisible();
      await expect(region.getByRole('table')).toBeVisible();
    }
  });
});

test('geniş profil (görünüm 1280×600): grafik görünür alana girince yüklenir, açma düğmesi yok', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  const requests = recordRequests(page, ECHARTS_REQUEST);
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
