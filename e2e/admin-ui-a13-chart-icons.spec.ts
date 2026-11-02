import { test, expect, type Locator, type Page } from '@playwright/test';
import { accentEdges, focusRing, selfCheckDetectors, smallText, touchTargets } from './admin-detectors';
import { ADMIN_MAIN, enterKeyboardMode, horizontalOverflow, openAdmin, shiftTabKey, tabKey } from './admin-helpers';

// a13-chart-icons: Chart bileşeninin uyarlamalı teslimi gerçek rotada (/butce › "Aylık eğilim", butce/ButceTrend.wide).
// Ürün sözleşmesi (W0 + r4): grafik yalnız geniş sunumdadır. Chart'ı çizen her sayfa parçası *.wide modülüdür
// (butce/ButceTrend.wide, raporlar/RaporGrafik.wide, hesaplar/Projeksiyon.wide) ve lazyWide ile yalnız tablet/masaüstünde
// iner. /genel artık grafik çizmez (r4-sums: nesilde yaprak satır sahipliği haritası yok, dürüst aylık toplam yok); "Aylık
// plan ve gerçek" yalnız tablo (genişte) ya da ay akordeonu (telefonda) verir ve hiçbir profilde Chart/ECharts istemez.
//  - Telefon /butce: değerlerin karşılığı kalem kalem akordeondur (tablolar telefonda akordeon, ilk satır açık); "Aylık
//    eğilim" bölgesi, "Grafiği göster" düğmesi, grafik ve ECharts yoktur — sonuna kadar kaydırınca da istenmez. ui/Chart'ın
//    telefon ayrıntı düğmesi bileşen düzeyinde src/admin/ui/Chart.test.tsx'te sınanır; telefonda grafik çizen rota yoktur.
//  - Geniş profilde grafik görünür alana girince (IntersectionObserver) yüklenir; açma düğmesi yoktur; grafik (role=img,
//    "\"<kalem>\" kaleminin aylara göre … değerler yanındaki tabloda") yanındaki değer tablosuna aria-describedby ile
//    bağlıdır, tablo grafik çizilince de yerinde kalır.
//  - ECharts çalışma zamanı (src/admin/ui/Chart.runtime.ts) tek yüklemedir: ikinci grafik onu yeniden indirmez.
//  - Yükleme hatası kurtarılabilir ("Hata: …" + "Yeniden dene", değerler kalır); eylem 44 px (kaba işaretçide 48),
//    metin ≥ 14 px, klavyeyle ulaşılır, çevreleyen odak halkası yok (klavye modunda tek alt çizgi; paylaşılan odak
//    dedektörü kontrast ve geçişi de sınar), reduced-motion'da geçiş yok; sayfa yatay taşmaz.
// Ağ: dev sunucusu sentetik nesli sunar; önizleme dışına çıkan her istek (Bütçe'nin canlı GViz okuması dahil) kesilir —
// Google'a çağrı yok. Projeler: chromium 320×568 ve webkit 390×844 dokunmatik (telefon). Geniş davranış testleri bu
// projelerde görünümü 820×1180'e (tablet; dokunmatik proje kaba işaretçiyi korur) alır; @matrix testleri entegrasyonda ek
// genişliklerde (360/375/320×480/568×320 telefon; 820 tablet; 1440 masaüstü) profilini okuyarak koşar. Emülasyon gerçek
// cihaz değildir.

const ROUTE = '/butce';
const REGION = 'Aylık eğilim';
/** ButceTrend.wide: `"<kalem>" kaleminin aylara göre planlanan ve gerçekleşen tutarı; değerler yanındaki tabloda`. */
const IMG_NAME = /^".+" kaleminin aylara göre planlanan ve gerçekleşen tutarı; değerler yanındaki tabloda$/;
/** Telefonda kalem tablosunun akordeon karşılığı (ResponsiveTable mobileCaption: "8 kalem"). */
const KALEM_LISTESI = /^\d+ kalem$/;
const GENEL = '/genel';
const GENEL_REGION = 'Aylık plan ve gerçek';
/** /genel telefonda aylık değerlerin akordeonu ("6 ay · Planlanan ve Gerçekleşen"); genişte tablo. */
const AY_LISTESI = /^\d+ ay · Planlanan ve Gerçekleşen$/;
const GENEL_TABLO = 'Aylık planlanan ve gerçekleşen gider';
/** Dev sunucusunda ECharts önceden paketlenmiş bağımlılık (/.vite/deps/echarts_*.js) ve tembel modül olarak istenir. */
const ECHARTS_REQUEST = /echarts|zrender|Chart\.runtime/;
/** Telefonda istenmemesi gereken her grafik parçası: ECharts + Chart bileşeni (dev: /src/admin/ui/Chart.*, derleme: Chart-*). */
const CHART_REQUEST = /echarts|zrender|Chart\.runtime|\/ui\/Chart\.|\/assets\/Chart-/;
/** Bütçe eğiliminin geniş-özel modülü: telefon bunu da istemez. */
const TREND_MODULE = /ButceTrend\.wide/;
const TABLET = { width: 820, height: 1180 };

/** Önizleme dışına çıkan her isteği keser (Bütçe canlı GViz okuması dahil): Google'a ağ çağrısı yok. */
async function isolate(page: Page) {
  await page.route(url => url.hostname !== '127.0.0.1', route => route.abort('blockedbyclient'));
}

function recordRequests(page: Page, pattern: RegExp): string[] {
  const urls: string[] = [];
  page.on('request', request => {
    if (pattern.test(request.url())) urls.push(new URL(request.url()).pathname);
  });
  return urls;
}

/** Telefonda olmaması gereken ayrıntı düğmesi; konumlayıcı iki adı da tutar. */
const toggleIn = (scope: Locator) => scope.getByRole('button', { name: /^Grafiği (göster|gizle)$/ });
/** Çizilmiş grafik ya da bekleme yuvası (Chart'ın iki imzası); grafiksiz bölgede ikisi de yok. */
const chartMarks = (scope: Locator) => scope.locator('[role="img"][aria-describedby]').or(scope.getByRole('status').filter({ hasText: /^\s*Grafik hazırlanıyor\s*$/ }));

async function profileOf(page: Page): Promise<string> {
  return page.evaluate(() => document.documentElement.dataset.profile ?? 'yok');
}

async function openRoute(page: Page, route: string): Promise<Locator> {
  await isolate(page);
  return openAdmin(page, route);
}

/** Geniş sunumda açar: telefon görünümündeki projede görünüm önce tablete alınır (profil W0: < 600 ya da kısa kenar < 480). */
async function toWide(page: Page) {
  const { width, height } = page.viewportSize()!;
  if (width < 600 || Math.min(width, height) < 480) await page.setViewportSize(TABLET);
}

async function wideChartRegion(page: Page): Promise<Locator> {
  await toWide(page);
  const main = await openRoute(page, ROUTE);
  expect(await profileOf(page), 'geniş profil').not.toBe('phone');
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

/**
 * Grafik yuvasını görünür alana getirir: yüklenmeden önce yuvada yalnız "Grafik hazırlanıyor" durumu vardır. Bölüm (24
 * aylık tablo) görünümden uzun olabileceği için bölge değil, yuvadaki öğe (bekleme, grafik ya da hata) kaydırılır.
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

/** Kullanıcı gibi sona kadar kaydırır: belge ve taşan main kabı. */
async function scrollToEnd(page: Page) {
  await page.evaluate(selector => {
    window.scrollTo(0, document.documentElement.scrollHeight);
    for (let element = document.querySelector(selector); element; element = element.parentElement) element.scrollTop = element.scrollHeight;
  }, ADMIN_MAIN);
  await twoFrames(page);
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

/** Bölge kökü seçicisi (paylaşılan dedektörler seçici alır): section[aria-label="Aylık eğilim"]. */
const REGION_ROOT = `${ADMIN_MAIN} section[aria-label="${REGION}"]`;

/** Yükleme hatası: grafik yuvasında "Hata: …", değerler yerinde; "Yeniden dene" 44/48 px ve ≥ 14 px; bölge kuralları temiz. */
async function expectLoadError(page: Page, region: Locator): Promise<Locator> {
  const alert = region.getByRole('alert');
  await expect(alert).toHaveText(/^Hata: Grafik yüklenemedi/);
  expect(await fontSize(alert)).toBeGreaterThanOrEqual(14);
  await expect(region.getByRole('table')).toBeVisible();
  const retry = region.getByRole('button', { name: 'Yeniden dene' });
  await expectTarget(page, retry);
  expect(await fontSize(retry)).toBeGreaterThanOrEqual(14);
  expect(await smallText(page, { root: REGION_ROOT }), 'hata durumu: 14 px alt sınır').toEqual([]);
  expect(await touchTargets(page, { root: REGION_ROOT }), 'hata durumu: dokunma hedefleri').toEqual([]);
  expect(await accentEdges(page, { root: REGION_ROOT }), 'hata durumu: kavisli vurgu kenarı').toEqual([]);
  return retry;
}

/** Odaktaki öğenin halka/çizgi biçimi (öz denetimde enjekte edilen halkaya karşı da sınanır). */
async function ringOf(control: Locator) {
  return control.evaluate(el => {
    const cs = getComputedStyle(el);
    const after = getComputedStyle(el, '::after');
    return { outline: cs.outlineStyle, outlineWidth: cs.outlineWidth, shadow: cs.boxShadow, afterContent: after.content, afterHeight: after.height };
  });
}
const ringless = (ring: Awaited<ReturnType<typeof ringOf>>) => (ring.outline === 'none' || ring.outlineWidth === '0px') && ring.shadow === 'none';

test('profil uyumlu teslim: telefonda kalem akordeonu (eğilim, grafik ve ECharts istenmez), genişte görünür grafik ve yanında tablo', { tag: '@matrix' }, async ({ page }) => {
  const chartRequests = recordRequests(page, ECHARTS_REQUEST);
  const trendRequests = recordRequests(page, TREND_MODULE);
  const main = await openRoute(page, ROUTE);
  const profile = await profileOf(page);
  const region = main.getByRole('region', { name: REGION });

  if (profile === 'phone') {
    // Değerlerin telefon karşılığı: kalem kalem akordeon, ilk satır açık; tablo, eğilim bölgesi ve grafik yok.
    const values = main.getByRole('region', { name: KALEM_LISTESI });
    await expect(values).toBeVisible();
    await expect(values.locator('button[aria-expanded]').first()).toHaveAttribute('aria-expanded', 'true');
    await expect(main.getByRole('table')).toHaveCount(0);
    await expect(region).toHaveCount(0);
    await expect(toggleIn(main)).toHaveCount(0);
    await expect(chartMarks(main)).toHaveCount(0);
    // Kullanıcı gibi sonuna kadar kaydırılır: görünür alana giren blok da grafik parçası istemez.
    await scrollToEnd(page);
    await expect(toggleIn(main)).toHaveCount(0);
    await expect(chartMarks(main)).toHaveCount(0);
    expect(chartRequests, 'telefon profili ECharts ya da grafik çalışma zamanını indirmez').toEqual([]);
    expect(trendRequests, 'telefon profili geniş-özel eğilim modülünü indirmez').toEqual([]);
  } else {
    await expect(region).toBeVisible();
    await expect(region.getByRole('table')).toBeVisible();
    await expect(toggleIn(main)).toHaveCount(0);
    await scrollChartIntoView(region);
    const img = region.getByRole('img', { name: IMG_NAME });
    await expect(img).toBeVisible();
    await expect(img.locator('canvas').first()).toBeVisible();
    await expect(await describedTable(page, img)).toBeVisible();
    expect(trendRequests.length, 'geniş eğilim modülü tembel yüklenir').toBeGreaterThan(0);
    expect(chartRequests.some(url => /Chart\.runtime/.test(url)), 'görünür grafik çalışma zamanını ister').toBe(true);
    expect(await smallText(page, { root: REGION_ROOT }), 'eğilim: 14 px alt sınır').toEqual([]);
  }
  expect(await horizontalOverflow(page), 'sayfa yatay taşmaz').toEqual([]);
});

// Gerekmeyen JS/CSS telefonda indirilmez (kalıcı uyarlamalı teslim kuralı): grafik çizmeyen telefon /butce, ui/Chart
// bileşenini (Chart.tsx + Chart.css; derlemede assets/Chart-*) de istemez. Telefon görünümü olmayan projede görünüm
// 320×568'e alınır.
test('telefon /butce grafik bileşenini de indirmez: ui/Chart modülü ve stili istenmez', async ({ page }) => {
  const { width, height } = page.viewportSize()!;
  if (width >= 600 && Math.min(width, height) >= 480) await page.setViewportSize({ width: 320, height: 568 });
  const componentRequests = recordRequests(page, CHART_REQUEST);
  const main = await openRoute(page, ROUTE);
  expect(await profileOf(page), 'telefon profili').toBe('phone');
  await expect(main.getByRole('region', { name: KALEM_LISTESI })).toBeVisible();
  await scrollToEnd(page);
  expect(componentRequests, 'telefon /butce grafik bileşeni (ui/Chart) ya da ECharts istemez').toEqual([]);
});

test('/genel grafiksiz: "Aylık plan ve gerçek" yalnız değer verir (telefonda ay akordeonu, genişte tablo); grafik ve ECharts hiçbir profilde istenmez', { tag: '@matrix' }, async ({ page }) => {
  const chartRequests = recordRequests(page, CHART_REQUEST);
  const main = await openRoute(page, GENEL);
  const profile = await profileOf(page);
  const region = main.getByRole('region', { name: GENEL_REGION });
  await expect(region).toBeVisible();
  if (profile === 'phone') {
    await expect(region.getByRole('region', { name: AY_LISTESI })).toBeVisible();
    await expect(region.getByRole('table')).toHaveCount(0);
  } else {
    await expect(region.getByRole('table', { name: GENEL_TABLO })).toBeVisible();
    await expect(region.getByRole('table', { name: GENEL_TABLO }).getByRole('row', { name: /2026/ }).first()).toBeVisible();
  }
  await expect(toggleIn(main)).toHaveCount(0);
  await expect(chartMarks(main)).toHaveCount(0);
  await region.scrollIntoViewIfNeeded();
  await scrollToEnd(page);
  await expect(chartMarks(main), 'kaydırınca da grafik yuvası belirmez').toHaveCount(0);
  expect(chartRequests, `/genel (${profile}) grafik bileşeni ya da ECharts istemez`).toEqual([]);
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
    const raporBekleme = page.locator(ADMIN_MAIN).getByRole('status').filter({ hasText: 'Grafik hazırlanıyor' });
    await expect(raporGrafigi.or(raporBekleme).first()).toBeAttached();
    if (await raporBekleme.count()) await raporBekleme.first().scrollIntoViewIfNeeded();
    await expect(raporGrafigi).toBeVisible();
    await expect(raporGrafigi.locator('canvas').first()).toBeVisible();
    expect(runtimeRequests(), 'çalışma zamanı yeniden indirilmez').toBe(afterFirst);
  });

  test('klavye: "Yeniden dene" Tab sırasında, Enter çalıştırır; odak bölgede kalır, oklar ve Escape durumu değiştirmez; halka yok, tek alt çizgi', async ({ page, browserName }) => {
    let block = true;
    await page.route(/Chart\.runtime/, route => (block ? route.abort('failed') : route.continue()));
    const region = await wideChartRegion(page);
    await scrollChartIntoView(region);
    const retry = await expectLoadError(page, region);

    // Tab sırası: eğilim bölgesinde bağlantı yok; Shift+Tab "Yeniden dene"den önceki sayfa durağına (bölgenin dışı)
    // gider, Tab oradan "Yeniden dene"ye döner. Öncesi: klavye modu açık, odak grafik yuvasında (hata sonrası odak hedefi).
    await enterKeyboardMode(page, browserName);
    const slot = retry.locator('xpath=ancestor::*[@tabindex="-1"][1]');
    await slot.focus();
    await page.keyboard.press(tabKey(browserName));
    await expect(retry, 'yuvadan Tab "Yeniden dene"ye').toBeFocused();
    await page.keyboard.press(shiftTabKey(browserName));
    const before = await page.evaluate(selector => {
      const active = document.activeElement;
      const region = document.querySelector(selector);
      return { onBody: !active || active === document.body, inRegion: Boolean(region && active && region.contains(active)) };
    }, REGION_ROOT);
    expect(before.onBody, 'Shift+Tab odağı gövdeye düşürmez').toBe(false);
    expect(before.inRegion, 'bölgede "Yeniden dene"den önce durak yok').toBe(false);
    await page.keyboard.press(tabKey(browserName));
    await expect(retry, 'önceki duraktan Tab "Yeniden dene"ye').toBeFocused();

    const ring = await ringOf(retry);
    expect(ringless(ring), `outline ${ring.outline} ${ring.outlineWidth}; gölge ${ring.shadow}`).toBe(true);
    expect(ring.afterContent).not.toBe('none');
    expect(ring.afterHeight).toBe('3px');
    expect(await focusRing(page), 'paylaşılan odak dedektörü (halka, tek alt çizgi, kontrast, geçiş)').toEqual([]);

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
      const again = await wideChartRegion(page);
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

  test('/genel geniş sunumu grafik çizmez: aylık değerler tabloda, Chart ve ECharts istenmez', async ({ page }) => {
    const chartRequests = recordRequests(page, CHART_REQUEST);
    await toWide(page);
    const main = await openRoute(page, GENEL);
    expect(await profileOf(page), 'geniş profil').not.toBe('phone');
    const region = main.getByRole('region', { name: GENEL_REGION });
    await expect(region.getByRole('table', { name: GENEL_TABLO })).toBeVisible();
    await expect(toggleIn(main)).toHaveCount(0);
    await scrollToEnd(page);
    await expect(chartMarks(main)).toHaveCount(0);
    expect(chartRequests, 'grafiksiz /genel Chart ya da ECharts istemez').toEqual([]);
  });
});

test('geniş profil (görünüm 1280×600): katlama altındaki grafik görünür alana girince yüklenir, açma düğmesi yok', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  const requests = recordRequests(page, ECHARTS_REQUEST);
  const main = await openRoute(page, ROUTE);
  expect(await profileOf(page)).toBe('desktop');
  const region = main.getByRole('region', { name: REGION });
  await expect(region).toBeAttached();
  await expect(toggleIn(main)).toHaveCount(0);
  const pending = region.getByRole('status').filter({ hasText: 'Grafik hazırlanıyor' });
  await expect(pending, 'görünür alana girmeden yuvada bekleme durumu').toBeAttached();
  const top = await pending.evaluate(el => el.getBoundingClientRect().top);
  const viewport = page.viewportSize()!;
  expect(top, `önkoşul: eğilim grafiği ${viewport.width}×${viewport.height} açılışında katlamanın altında`).toBeGreaterThan(viewport.height);
  // Kat altında: görünür alana girmeden ECharts indirilmez.
  await twoFrames(page);
  expect(requests, 'görünür alan dışındaki grafik ECharts indirmez').toEqual([]);
  const img = region.getByRole('img', { name: IMG_NAME });
  await scrollChartIntoView(region);
  await expect(img).toBeVisible();
  await expect(img.locator('canvas').first()).toBeVisible();
  expect(requests.some(url => /Chart\.runtime/.test(url))).toBe(true);
  expect(await horizontalOverflow(page)).toEqual([]);
});

test('öz denetim: paylaşılan dedektörler, istek kaydı, halka ve taşma denetimleri enjekte edilen ihlali yakalar', async ({ page }) => {
  const region = await wideChartRegion(page);
  await expect(region.getByRole('table')).toBeVisible();
  expect(await selfCheckDetectors(page), 'paylaşılan dedektörler bu motorda kör değil').toEqual([]);

  // İstek kaydı: grafik desenine uyan bir istek kaydedilir (telefondaki "istenmedi" iddiası kör değil).
  const chartRequests = recordRequests(page, CHART_REQUEST);
  await page.evaluate(() => fetch('/aile/src/admin/ui/Chart.runtime.ts?oz-denetim').then(response => response.status).catch(() => 0));
  await expect.poll(() => chartRequests.some(url => /Chart\.runtime/.test(url)), { message: 'kayıt grafik isteğini görür' }).toBe(true);

  // Halka denetimi: outline + gölgeli düğme halkalı sayılır; yatay taşma denetimi görünüm dışına taşan öğeyi bulur.
  await page.evaluate(() => {
    const host = document.createElement('div');
    host.setAttribute('data-a13-oz-denetim', '');
    host.innerHTML = '<button type="button" style="outline:2px solid rgb(255, 0, 0);box-shadow:0 0 0 2px rgb(255, 0, 0);font-size:16px">halka</button>'
      + `<div style="width:${window.innerWidth + 200}px;height:4px"></div>`;
    document.body.appendChild(host);
  });
  const injected = page.locator('[data-a13-oz-denetim] button');
  expect(ringless(await ringOf(injected)), 'enjekte edilen halka yakalanır').toBe(false);
  expect((await horizontalOverflow(page)).length, 'enjekte edilen yatay taşma yakalanır').toBeGreaterThan(0);
  await page.evaluate(() => document.querySelector('[data-a13-oz-denetim]')?.remove());
  expect(await horizontalOverflow(page), 'parça kalkınca taşma yok').toEqual([]);
});
