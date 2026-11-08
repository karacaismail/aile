import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { ADMIN_MAIN, enterKeyboardMode, horizontalOverflow, openAdmin } from './admin-helpers';
import { accentEdges, focusRing, overflow, smallText } from './admin-detectors';

// Hesaplar ve borçlar — uçtan uca kullanıcı yolculuğu (sentetik nesil). Tasarım: tasarim-sistemi/README.md › Sayfa
// iskeleti, Uyarlanır teslim; bundle.js Aile.Pages.Hesaplar (Sec › Hesaplar mobileMode list, Sec › Borçlar).
//
// Görev kuralları: forecast_months tek bakiye kaynağıdır; tahmin bakiyeleri toplanmaz; tahmin olduğu metinle yazılır.
// Telefonda hesap kartı değil düz liste satırı; dönem seçimi alt sayfa. Geniş profil (tablet/masaüstü) ek olarak tüm
// dönemlerin tablosunu ve kapanış bakiyesi çizgisini lazyWide ile yükler; telefon bunları indirmez.
//
// Veri: dev sunucusu /__aile/generation/* isteğini fixtures/generation-synthetic'ten verir (playwright.admin.config.ts
// syntheticServerEnv); beklenen değerler fixture'dan hesaplanır. Saat sabittir (page.clock): "bugün" 15.03.2027,
// böylece varsayılan dönem tarihten bağımsız olarak 03.2027'dir. Google'a ağ çağrısı yoktur.
// Projeler: chromium ve webkit (görev koşusu); @matrix etiketli test entegrasyonda ek görünüm alanlarında da koşar.

// --- Sentetik nesil ---------------------------------------------------------------------------------------------
interface Money { amount: string; currency: string }
interface ForecastMonth { id: string; period: string; forecast_id: string; deleted_at?: string | null; measures: Record<string, Money> }
interface ManifestFile { path: string; kind: string; collection?: string }

const FIXTURE_ROOT = fileURLToPath(new URL('../fixtures/generation-synthetic/', import.meta.url));
const GENERATION_ID = readdirSync(FIXTURE_ROOT).find(name => /^[a-f0-9]{64}$/.test(name) && statSync(path.join(FIXTURE_ROOT, name)).isDirectory())!;
const GENERATION_DIR = path.join(FIXTURE_ROOT, GENERATION_ID);
const MANIFEST = JSON.parse(readFileSync(path.join(GENERATION_DIR, 'manifest.json'), 'utf8')) as { files: ManifestFile[] };
const MONTH_FILES = MANIFEST.files.filter(file => file.kind === 'partition' && file.collection === 'forecast_months').map(file => file.path);
const MONTHS: ForecastMonth[] = MONTH_FILES.flatMap(rel => (JSON.parse(readFileSync(path.join(GENERATION_DIR, rel), 'utf8')) as { records: ForecastMonth[] }).records)
  .filter(month => !month.deleted_at);
const PERIODS = [...new Set(MONTHS.map(month => month.period))].sort();

const tl = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const para = (money: Money) => tl.format(Number(money.amount));
/** "2027-03" → "03.2027" (tasarım: dönem 09.2033). */
const donem = (period: string) => `${period.slice(5, 7)}.${period.slice(0, 4)}`;
const olcu = (period: string, key: string) => para(MONTHS.find(month => month.period === period)!.measures[key]!);

/** Sabit "bugün": İstanbul'da 15.03.2027 12:00 → içinde bulunulan dönem 2027-03. */
const BUGUN = new Date('2027-03-15T09:00:00Z');
const BU_DONEM = '2027-03';
/** Alt sayfada listenin sonlarına doğru bir dönem (kaydırma gerektirir). */
const DIGER = PERIODS[PERIODS.length - 3]!;

const OLCULER = [
  { key: 'opening_balance', ad: 'Açılış bakiyesi' },
  { key: 'planned_outflow', ad: 'Planlanan çıkış' },
  { key: 'closing_balance', ad: 'Kapanış bakiyesi' },
] as const;

/** Geniş-özel kod, grafik ve antd istekleri (dev: /src/...*.wide.tsx, .vite/deps/echarts.js; üretim: assets/wide-*). */
const WIDE_REQUEST = /\.wide\.(?:tsx?|css)(?:[?#]|$)|\/assets\/wide-/;
const ECHARTS_REQUEST = /echarts|zrender/;
const ANTD_REQUEST = /\/(?:\.vite\/deps\/)?(?:antd|@ant-design[_/]|@rc-component[_/]|rc-[a-z-]+)[^/]*\.js|\/assets\/(?:antd|pro|icons)-/;

function istekler(page: Page): string[] {
  const urls: string[] = [];
  page.on('request', request => { urls.push(request.url()); });
  return urls;
}

async function ac(page: Page): Promise<Locator> {
  await page.clock.setFixedTime(BUGUN);
  return openAdmin(page, '/hesaplar');
}

const hesaplarBolumu = (main: Locator) => main.getByRole('region', { name: 'Hesaplar', exact: true });
const bakiyeListesi = (main: Locator, period: string) => hesaplarBolumu(main).getByRole('list', { name: `${donem(period)} dönemi bakiye tahmini` });
const donemSecici = (main: Locator) => main.getByLabel('Dönem', { exact: true });

/** Seçili dönemin düz liste satırları: üç ölçü, her biri "Tahmin" metniyle ve fixture tutarıyla; toplam satırı yok. */
async function bakiyelerGorunur(main: Locator, period: string) {
  const liste = bakiyeListesi(main, period);
  await expect(liste).toBeVisible();
  const satirlar = liste.getByRole('listitem');
  await expect(satirlar).toHaveCount(OLCULER.length);
  for (const { key, ad } of OLCULER) {
    const satir = satirlar.filter({ hasText: ad });
    await expect(satir).toHaveCount(1);
    await expect(satir).toContainText('Tahmin');
    await expect(satir).toContainText(olcu(period, key));
  }
  await expect(hesaplarBolumu(main)).not.toContainText(/Toplam/i);
}

/** Dönem seçimi: tetik → alt sayfa (dialog "Dönem") → seçenek → sayfa kapanır, liste yeni dönemi gösterir. */
async function donemSec(page: Page, main: Locator, period: string) {
  await donemSecici(main).click();
  const sayfa = page.getByRole('dialog', { name: 'Dönem' });
  await expect(sayfa).toBeVisible();
  const secenek = sayfa.getByRole('option', { name: donem(period), exact: true });
  await secenek.click();
  await expect(sayfa).toBeHidden();
  await expect(bakiyeListesi(main, period)).toBeVisible();
}

test.beforeAll(() => {
  expect(PERIODS, 'fixture forecast_months boş olmamalı').not.toHaveLength(0);
  expect(PERIODS).toContain(BU_DONEM);
  expect(DIGER).not.toBe(BU_DONEM);
});

// --- Telefon 320×568: kritik yolculuk -------------------------------------------------------------------------------
test.describe('telefon 320×568', () => {
  test.use({ viewport: { width: 320, height: 568 } });

  test('başlık, amaç ve ana eylem ilk ekranda; bakiye tahmini düz liste; dönem alt sayfadan seçilir', async ({ page }) => {
    const urls = istekler(page);
    const main = await ac(page);
    await expect(page.locator('html')).toHaveAttribute('data-profile', 'phone');

    await expect(main.getByRole('heading', { level: 1, name: 'Hesaplar ve borçlar' })).toBeInViewport();
    await expect(main.getByText('Hesap bakiyelerini ve kalan borçları, taksit planıyla birlikte görün.')).toBeVisible();
    await expect(main.getByRole('button', { name: 'Hesap ekle' })).toBeInViewport();

    // Tahmin olduğu metinle yazılır; bakiyeler toplanmaz; varsayılan dönem içinde bulunulan ay.
    const hesaplar = hesaplarBolumu(main);
    await expect(hesaplar).toContainText('tahmin');
    await expect(hesaplar).toContainText('toplanmaz');
    await bakiyelerGorunur(main, BU_DONEM);
    await expect(hesaplar).toContainText(`${donem(BU_DONEM)} · Bu ay`);

    // Telefonda tablo, kart ızgarası ve grafik yok.
    await expect(main.getByRole('table')).toHaveCount(0);
    await expect(main.getByRole('img', { name: /kapanış bakiyesi/i })).toHaveCount(0);

    await donemSec(page, main, DIGER);
    await bakiyelerGorunur(main, DIGER);
    await expect(bakiyeListesi(main, BU_DONEM)).toHaveCount(0);

    // Borçlar: kaynakta koleksiyon yok, adıyla söylenir; tutar uydurulmaz.
    const borclar = main.getByRole('region', { name: 'Borçlar', exact: true });
    await expect(borclar).toContainText('Kaynakta borç kaydı yok');
    await expect(borclar).not.toContainText('₺');

    expect(await horizontalOverflow(page)).toEqual([]);
    expect(await overflow(page)).toEqual([]);
    expect(await smallText(page, { root: ADMIN_MAIN })).toEqual([]);
    expect(await accentEdges(page, { root: ADMIN_MAIN })).toEqual([]);
    expect(urls.filter(url => WIDE_REQUEST.test(url)), 'telefon geniş-özel modül indirmemeli').toEqual([]);
    expect(urls.filter(url => ECHARTS_REQUEST.test(url)), 'telefon grafik kütüphanesi indirmemeli').toEqual([]);
  });

  test('özet en çok üç ölçü: hesap ve borç toplamı uydurulmaz; kapanış bakiyesi tahmin diye adlandırılır', async ({ page }) => {
    const main = await ac(page);
    const ozet = main.getByRole('list', { name: 'Özet' });
    const olculer = ozet.getByRole('listitem');
    await expect(olculer).toHaveCount(3);
    await expect(olculer.nth(0)).toContainText('Hesaplardaki toplam');
    await expect(olculer.nth(0)).toContainText('Kaynakta kayıt yok');
    await expect(olculer.nth(1)).toContainText('Kalan borç');
    await expect(olculer.nth(1)).toContainText('Kaynakta kayıt yok');
    await expect(olculer.nth(2)).toContainText('Kapanış bakiyesi (tahmin)');
    await expect(olculer.nth(2)).toContainText(olcu(BU_DONEM, 'closing_balance'));
    await expect(olculer.nth(2)).toContainText(`${donem(BU_DONEM)} · tahmin, gerçek değil`);
  });

  test('"Hesap ekle" alt sayfada nedenini söyler; klavyeyle açılıp Escape ile kapanınca odak düğmeye döner', async ({ page, browserName }) => {
    const main = await ac(page);
    const birincil = main.getByRole('button', { name: 'Hesap ekle' });
    const sayfa = page.getByRole('dialog', { name: 'Hesap ekle' });
    // Dokunma/işaretçi yolu: alt sayfa açılır, gerekçe görünür, Kapat kapatır.
    await birincil.click();
    await expect(sayfa).toBeVisible();
    await expect(sayfa).toContainText('Kaynakta hesap koleksiyonu yok');
    await expect(sayfa).toBeInViewport();
    await sayfa.getByRole('button', { name: 'Kapat' }).click();
    await expect(sayfa).toBeHidden();
    // Klavye yolu (WebKit'te işaretçi tıklaması düğmeye odak vermez; dönüş klavyeyle sınanır).
    await enterKeyboardMode(page, browserName);
    await birincil.focus();
    await page.keyboard.press('Enter');
    await expect(sayfa).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sayfa).toBeHidden();
    await expect(birincil).toBeFocused();
    expect(await focusRing(page)).toEqual([]);
  });

  test('klavye: dönem tetiği halkasız tek çizgiyle odaklanır; oklar ve Enter dönem seçer', async ({ page, browserName }) => {
    const main = await ac(page);
    await enterKeyboardMode(page, browserName);
    const tetik = donemSecici(main);
    await tetik.focus();
    expect(await focusRing(page)).toEqual([]);
    await page.keyboard.press('Enter');
    const sayfa = page.getByRole('dialog', { name: 'Dönem' });
    await expect(sayfa).toBeVisible();
    const sonraki = PERIODS[PERIODS.indexOf(BU_DONEM) + 1]!;
    // Liste seçili seçenekte başlar (APG listbox); ok bir sonrakine taşır, Enter seçer.
    await sayfa.getByRole('option', { name: donem(BU_DONEM), exact: true }).focus();
    await page.keyboard.press('ArrowDown');
    await expect(sayfa.getByRole('option', { name: donem(sonraki), exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(sayfa).toBeHidden();
    await bakiyelerGorunur(main, sonraki);
  });

  test('telefon antd ve @ant-design paketlerini indirmez (entegrasyon: PHONE_WITHOUT_ANTD + ui yeniden yazımı)', async ({ page }) => {
    const urls = istekler(page);
    const main = await ac(page);
    await donemSec(page, main, DIGER);
    expect(urls.filter(url => ANTD_REQUEST.test(url))).toEqual([]);
  });
});

// --- Veri durumları (telefon) ------------------------------------------------------------------------------------
test.describe('veri durumları 320×568', () => {
  test.use({ viewport: { width: 320, height: 568 } });

  test('bakiye parçası okunamazsa: "Hata: …" + "Yeniden dene", tutar yok; özet "Bilinmiyor"', async ({ page }) => {
    await page.route('**/__aile/generation/data/forecast_months/**', route =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'sentetik okuma hatası' }) }));
    const main = await ac(page);
    const hesaplar = hesaplarBolumu(main);
    const hata = hesaplar.getByRole('alert');
    await expect(hata).toContainText(/^Hata: /);
    await expect(hata.getByRole('button', { name: 'Yeniden dene' })).toBeVisible();
    await expect(hesaplar).not.toContainText('₺');
    await expect(main.getByRole('list', { name: 'Özet' }).getByRole('listitem').nth(2)).toContainText('Bilinmiyor');
    expect(await horizontalOverflow(page)).toEqual([]);
  });

  test('"Yeniden dene" kaynak düzelince bakiyeleri getirir', async ({ page }) => {
    let bozuk = true;
    await page.route('**/__aile/generation/data/forecast_months/**', route => (bozuk
      ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'sentetik okuma hatası' }) })
      : route.fallback()));
    const main = await ac(page);
    const hata = hesaplarBolumu(main).getByRole('alert');
    await expect(hata).toBeVisible();
    bozuk = false;
    await hata.getByRole('button', { name: 'Yeniden dene' }).click();
    await bakiyelerGorunur(main, BU_DONEM);
  });

  test('eski veri: yenileme başarısızsa son başarılı tahmin kalır ve "Eski veri" diye adlandırılır', async ({ page }) => {
    const main = await ac(page);
    await bakiyelerGorunur(main, BU_DONEM);
    await page.route('**/__aile/generation/manifest.json', route =>
      route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'sentetik kesinti' }) }));
    const durum = main.locator('[role="status"][data-state]');
    await durum.getByRole('button', { name: 'Yenile' }).click();
    await expect(durum).toHaveAttribute('data-state', 'stale');
    await expect(durum).toContainText('yenilenemedi');
    await expect(hesaplarBolumu(main)).toContainText('Eski veri');
    await bakiyelerGorunur(main, BU_DONEM);
  });
});

// --- Telefon görünüm alanları: kısa yükseklik, 360/375/390, yatay ---------------------------------------------------
const TELEFONLAR = [
  { ad: '320×480 kısa yükseklik', width: 320, height: 480 },
  { ad: '360×640', width: 360, height: 640 },
  { ad: '375×667', width: 375, height: 667 },
  { ad: '390×844', width: 390, height: 844 },
  { ad: '568×320 yatay telefon', width: 568, height: 320 },
] as const;

/**
 * Telefon yolculuğu (her telefon görünüm alanında aynı): profil telefon, başlık ve ana eylem erişilir, bakiye düz liste,
 * tablo/grafik yok; dönem alt sayfası görünüm alanına sığar (Kapat görünür) ve seçimi uygular; geniş-özel kod ve
 * grafik kütüphanesi istenmez; yatay taşma, kesilen metin ve 14 px altı metin yok.
 */
async function telefonYolculugu(page: Page, urls: readonly string[]) {
  const main = await ac(page);
  await expect(page.locator('html')).toHaveAttribute('data-profile', 'phone');
  await expect(main.getByRole('heading', { level: 1, name: 'Hesaplar ve borçlar' })).toBeVisible();
  const birincil = main.getByRole('button', { name: 'Hesap ekle' });
  await birincil.scrollIntoViewIfNeeded();
  await expect(birincil).toBeInViewport();
  await bakiyelerGorunur(main, BU_DONEM);
  await expect(main.getByRole('table')).toHaveCount(0);

  await donemSecici(main).click();
  const sayfa = page.getByRole('dialog', { name: 'Dönem' });
  await expect(sayfa).toBeVisible();
  await expect(sayfa.getByRole('button', { name: 'Kapat' })).toBeInViewport();
  await sayfa.getByRole('option', { name: donem(DIGER), exact: true }).click();
  await expect(sayfa).toBeHidden();
  await bakiyelerGorunur(main, DIGER);

  expect(urls.filter(url => WIDE_REQUEST.test(url) || ECHARTS_REQUEST.test(url)), 'telefon geniş-özel kod ve grafik indirmez').toEqual([]);
  expect(await horizontalOverflow(page)).toEqual([]);
  expect(await overflow(page)).toEqual([]);
  expect(await smallText(page, { root: ADMIN_MAIN })).toEqual([]);
}

for (const boyut of TELEFONLAR) {
  test.describe(`telefon ${boyut.ad}`, () => {
    test.use({ viewport: { width: boyut.width, height: boyut.height } });

    test('telefon profili kalır; ana eylem erişilir; alt sayfa görünüm alanına sığar; yatay taşma yok', async ({ page }) => {
      await telefonYolculugu(page, istekler(page));
    });
  });
}

// --- Geniş profil -----------------------------------------------------------------------------------------------
test.describe('masaüstü 1440×900', () => {
  test.use({ viewport: { width: 1440, height: 900 }, hasTouch: false });

  test('tüm dönemlerin tablosu ve kapanış çizgisi geniş modülle gelir; satır dönemi seçer; toplam yok', async ({ page }) => {
    const urls = istekler(page);
    const main = await ac(page);
    await expect(page.locator('html')).toHaveAttribute('data-profile', 'desktop');
    await bakiyelerGorunur(main, BU_DONEM);

    const projeksiyon = main.getByRole('region', { name: 'Nakit projeksiyonu', exact: true });
    await expect(projeksiyon).toContainText('tahmin');
    const tablo = projeksiyon.getByRole('table', { name: 'Nakit projeksiyonu (tahmin)' });
    await expect(tablo).toBeVisible();
    for (const period of [PERIODS[0]!, BU_DONEM, PERIODS.at(-1)!]) {
      const satir = projeksiyon.getByRole('row').filter({ hasText: donem(period) });
      await expect(satir).toContainText(olcu(period, 'closing_balance'));
    }
    await expect(projeksiyon).not.toContainText(/Toplam/i);
    // Grafik katlama altında: ECharts yalnız yuvası görünür alana girince istenir (ui/Chart); önce oraya kaydırılır.
    const cizgi = projeksiyon.getByRole('img', { name: /kapanış bakiyesi/i });
    await cizgi.or(projeksiyon.getByText('Grafik hazırlanıyor')).scrollIntoViewIfNeeded();
    await expect(cizgi).toBeVisible({ timeout: 15_000 });
    await expect(cizgi.locator('canvas').first()).toBeVisible();

    await projeksiyon.getByRole('row').filter({ hasText: donem(DIGER) }).click();
    await bakiyelerGorunur(main, DIGER);

    expect(urls.some(url => WIDE_REQUEST.test(url)), 'geniş modül yüklenmeli').toBe(true);
    expect(await horizontalOverflow(page)).toEqual([]);
    expect(await smallText(page, { root: ADMIN_MAIN })).toEqual([]);
  });

  test('klavye: tablo satırı Enter ile dönemi seçer; odak halkasız', async ({ page, browserName }) => {
    const main = await ac(page);
    await bakiyelerGorunur(main, BU_DONEM);
    const projeksiyon = main.getByRole('region', { name: 'Nakit projeksiyonu', exact: true });
    const satir = projeksiyon.getByRole('row').filter({ hasText: donem(DIGER) });
    await enterKeyboardMode(page, browserName);
    await satir.focus();
    await expect(satir).toBeFocused();
    expect(await focusRing(page)).toEqual([]);
    await page.keyboard.press('Enter');
    await bakiyelerGorunur(main, DIGER);
    await expect(satir).toHaveAttribute('aria-selected', 'true');
  });
});

test.describe('tablet 820×1180', () => {
  test.use({ viewport: { width: 820, height: 1180 } });

  test('tablet profili: tablo sığar ve kalır; dönem seçici ile liste aynı', async ({ page }) => {
    const main = await ac(page);
    await expect(page.locator('html')).toHaveAttribute('data-profile', 'tablet');
    await bakiyelerGorunur(main, BU_DONEM);
    await expect(main.getByRole('region', { name: 'Nakit projeksiyonu', exact: true }).getByRole('table', { name: 'Nakit projeksiyonu (tahmin)' })).toBeVisible();
    expect(await horizontalOverflow(page)).toEqual([]);
  });
});

// --- Matris: projenin kendi görünüm alanında profil değişmezleri ----------------------------------------------------
// Entegrasyonda chromium-360, chromium-375, chromium-short (320×480), chromium-landscape (568×320), webkit-tablet ve
// webkit-desktop projelerinde koşar; görev koşusunda chromium 320×568 ve webkit 390×844'te.
test('profil değişmezleri: telefon düz liste + alt sayfa, geniş tablo; yatay taşma yok', { tag: '@matrix' }, async ({ page }) => {
  const urls = istekler(page);
  const viewport = page.viewportSize()!;
  const telefon = viewport.width < 600 || Math.min(viewport.width, viewport.height) < 480;
  if (telefon) {
    await telefonYolculugu(page, urls);
    return;
  }
  const main = await ac(page);
  await expect(page.locator('html')).not.toHaveAttribute('data-profile', 'phone');
  await bakiyelerGorunur(main, BU_DONEM);
  await expect(main.getByRole('region', { name: 'Nakit projeksiyonu', exact: true }).getByRole('table', { name: 'Nakit projeksiyonu (tahmin)' })).toBeVisible();
  expect(await horizontalOverflow(page)).toEqual([]);
  expect(await smallText(page, { root: ADMIN_MAIN })).toEqual([]);
});
