import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { openAdmin } from './admin-helpers';
import { overflow, smallText } from './admin-detectors';

// Raporlar — uçtan uca kullanıcı yolculuğu (sentetik nesil; dev sunucusu /__aile/generation/* isteklerini
// fixtures/generation-synthetic'ten karşılar). Tasarım: SayfaRaporlarDar (telefon) ve SayfaRaporlar (masaüstü),
// bundle.js Aile.Pages.Raporlar. Kurallar:
//  - Telefon önce: 320×568'de başlık + amaç + "Raporu dışa aktar" görünür; rapor ve dönem seçimi alttan açılan
//    sayfadadır; sonuç tablosu akordeondur (ilk satır açık); grafik telefonda yalnız tablo karşılığıyla gelir ve
//    ECharts ya da *.wide modülü hiç indirilmez. Sayfa düzeyinde yatay taşma yok.
//  - Gerçekleşen actuals.ts anlamındadır: içinde bulunulan aydan (Europe/Istanbul) sonraki dönem "Henüz yok";
//    ödeme kanıtı olmayan yazılı değer "Kaynakta yazılı" (oran yok). Plan ve gerçek ayrı değerdir.
//  - Saat sabit: 2 Kasım 2026 (İstanbul). Beklenen tutarlar fixture'dan bigint ile hesaplanır, sabit sayı yazılmaz.
// Matris (@matrix): proje görünümünde çalışır (entegrasyonda 360/375/320×480/568×320/tablet/masaüstü); profil
// html[data-profile]'dan okunur: telefon akordeon ve grafik yok; tablet ECharts grafiği + tablo (sığmazsa akordeon);
// masaüstü rapor menüsü + ECharts grafiği + tablo.

// --- Sentetik nesil ---------------------------------------------------------------------------------------------
const FIXTURE_ROOT = fileURLToPath(new URL('../fixtures/generation-synthetic/', import.meta.url));
const GENERATION_ID = readdirSync(FIXTURE_ROOT).find(name => /^[a-f0-9]{64}$/.test(name) && statSync(path.join(FIXTURE_ROOT, name)).isDirectory())!;
const GENERATION_DIR = path.join(FIXTURE_ROOT, GENERATION_ID);

interface Observation { label: string; period: string; basis: string; value: { decimal: string | null; currency: string | null }; deleted_at?: string | null }
interface ManifestFile { path: string; collection?: string }
const MANIFEST = JSON.parse(readFileSync(path.join(GENERATION_DIR, 'manifest.json'), 'utf8')) as { files: ManifestFile[] };
const OBS: Observation[] = MANIFEST.files
  .filter(file => file.collection === 'budget_observations')
  .flatMap(file => (JSON.parse(readFileSync(path.join(GENERATION_DIR, file.path), 'utf8')) as { records: Observation[] }).records)
  .filter(row => !row.deleted_at);

/** 2 Kasım 2026 10:00 İstanbul: içinde bulunulan dönem 2026-11; 2026-12 ve sonrası gelecek. */
const BUGUN = new Date('2026-11-02T10:00:00+03:00');
const SON_ALTI_AY = ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'];
const YIL_2027 = Array.from({ length: 12 }, (_, i) => `2027-${String(i + 1).padStart(2, '0')}`);
const AMAC = 'Hazır raporları açın; her rakamın hangi kayıtlardan geldiğini görün.';

const AY = new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const ayAdi = (period: string) => {
  const [year, month] = period.split('-').map(Number);
  const text = AY.format(new Date(Date.UTC(year!, month! - 1, 1, 12)));
  return text.charAt(0).toLocaleUpperCase('tr-TR') + text.slice(1);
};

/** Kesin kuruş toplamı (bigint) → "₺8.500,00". Kayan nokta yok. */
function toplam(basis: string, periods: readonly string[], label?: string): string {
  let kurus = 0n;
  for (const row of OBS) {
    if (row.basis !== basis || !periods.includes(row.period) || row.value.decimal === null) continue;
    if (label && row.label !== label) continue;
    const [whole, fraction = ''] = row.value.decimal.split('.');
    kurus += BigInt(whole!) * 100n + BigInt(`${fraction}00`.slice(0, 2));
  }
  const text = `${kurus / 100n}.${String(kurus % 100n).padStart(2, '0')}`;
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(text as `${number}`);
}

// --- Yardımcılar --------------------------------------------------------------------------------------------------
/** Geniş-özel kod ve grafik kütüphanesi: telefon profili bunları asla indirmez. */
const GENIS_ISTEK = /echarts|zrender|\.wide\.|\/wide\//;
/** Rapor grafiklerinin erişilebilir adı (role="img"): "…; değerler aşağıdaki tabloda". */
const GRAFIK_ADI = /değerler aşağıdaki tabloda/;

function istekleriKaydet(page: Page): string[] {
  const urls: string[] = [];
  page.on('request', request => { urls.push(request.url()); });
  return urls;
}

async function ac(page: Page): Promise<{ main: Locator; istekler: string[] }> {
  const istekler = istekleriKaydet(page);
  await page.clock.setFixedTime(BUGUN);
  const main = await openAdmin(page, '/raporlar');
  return { main, istekler };
}

const rapor = (main: Locator, ad: string) => main.getByRole('region', { name: ad, exact: true });
const ozet = (main: Locator) => main.getByRole('list', { name: 'Özet' });
/** Özet girdisi etiketle başlar (hasText dizgesi büyük/küçük harf duyarsızdır; "gerçekleşen" notu karışmasın). */
const ozetGirdisi = (main: Locator, etiket: string) => ozet(main).getByRole('listitem').filter({ hasText: new RegExp(`^${etiket}`) });

/** Telefonda seçim alttan açılan sayfadır (dialog adı = alan etiketi); seçenek seçilince kapanır. */
async function alttanSec(page: Page, main: Locator, alan: string, secenek: string) {
  await main.getByRole('combobox', { name: alan }).click();
  const sayfa = page.getByRole('dialog', { name: alan });
  await expect(sayfa).toBeVisible();
  await sayfa.getByRole('option', { name: secenek, exact: true }).click();
  await expect(sayfa).toBeHidden();
}

async function profil(page: Page): Promise<string> {
  return (await page.locator('html').getAttribute('data-profile')) ?? 'bilinmiyor';
}

async function tasmaYok(page: Page) {
  expect(await overflow(page, { root: '.aile-raporlar' })).toEqual([]);
  const sayfa = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(sayfa.scroll, 'sayfa düzeyinde yatay taşma').toBeLessThanOrEqual(sayfa.client);
}

// --- Telefon yolculuğu (320×568, dokunmatik; chromium ve webkit) ---------------------------------------------------
test.describe('Raporlar › telefon yolculuğu 320×568', () => {
  test.use({ viewport: { width: 320, height: 568 }, hasTouch: true });

  test('başlık, amaç ve dışa aktarma görünür; rapor seçimi alt sayfada; sonuç akordeon; grafik kodu inmez', async ({ page }) => {
    const { main, istekler } = await ac(page);
    expect(await profil(page)).toBe('phone');

    await expect(main.getByRole('heading', { level: 1, name: 'Raporlar' })).toBeVisible();
    await expect(main.getByText(AMAC)).toBeVisible();
    const disaAktar = main.getByRole('button', { name: 'Raporu dışa aktar' });
    await expect(disaAktar).toBeInViewport();
    await expect(disaAktar).toBeEnabled();

    // Rapor menüsü yalnız masaüstünde; telefonda "Rapor" seçimi.
    await expect(main.getByRole('navigation', { name: 'Raporlar' })).toHaveCount(0);
    await expect(main.getByRole('combobox', { name: 'Rapor' })).toBeVisible();
    await expect(main.getByRole('combobox', { name: 'Dönem' })).toBeVisible();

    // Varsayılan dönem: son 6 ay (Haziran – Kasım 2026), Kasım sürüyor.
    const aylik = rapor(main, 'Aylık plan ve gerçek');
    await expect(aylik).toBeVisible();
    await expect(aylik.getByText('Haziran – Kasım 2026 · Kasım sürüyor')).toBeVisible();
    await expect(aylik.getByRole('table')).toHaveCount(0);
    await expect(main.getByRole('img', { name: GRAFIK_ADI })).toHaveCount(0);
    const aylar = aylik.getByRole('button', { name: /^(Ocak|Şubat|Mart|Nisan|Mayıs|Haziran|Temmuz|Ağustos|Eylül|Ekim|Kasım|Aralık) \d{4}/ });
    await expect(aylar).toHaveCount(SON_ALTI_AY.length);
    await expect(aylar.first()).toHaveAttribute('aria-expanded', 'true');
    for (const period of SON_ALTI_AY) await expect(aylik.getByRole('button', { name: new RegExp(`^${ayAdi(period)}`) })).toBeVisible();

    // İçinde bulunulan ay: Gerçekleşen yazılı ama ödeme kanıtı yok → "Kaynakta yazılı", oran yok.
    const kasim = aylik.getByRole('button', { name: /^Kasım 2026/ });
    await expect(kasim).toContainText('Kaynakta yazılı');
    await expect(kasim).toContainText(toplam('recorded_aggregate', ['2026-11']));
    await expect(aylik).not.toContainText(/%\d/);

    // Özet: plan ve gerçek ayrı ölçü.
    await expect(ozetGirdisi(main, 'Planlanan')).toContainText(toplam('planned', SON_ALTI_AY));
    await expect(ozetGirdisi(main, 'Gerçekleşen')).toContainText(toplam('recorded_aggregate', SON_ALTI_AY));
    await expect(ozetGirdisi(main, 'Planlanan')).not.toContainText(toplam('recorded_aggregate', SON_ALTI_AY));

    // Gelecek yıl: Gerçekleşen "Henüz yok"; plan ayrı ve yazılı.
    await alttanSec(page, main, 'Dönem', '2027');
    await expect(aylik.getByRole('button', { name: /^(Ocak|Şubat|Mart|Nisan|Mayıs|Haziran|Temmuz|Ağustos|Eylül|Ekim|Kasım|Aralık) \d{4}/ })).toHaveCount(12);
    const ocak = aylik.getByRole('button', { name: /^Ocak 2027/ });
    await expect(ocak).toHaveAttribute('aria-expanded', 'true');
    await expect(ocak).toContainText('Henüz yok');
    await expect(aylik).not.toContainText('Kaynakta yazılı');
    await expect(aylik).not.toContainText(toplam('recorded_aggregate', ['2027-01']));
    await expect(ozetGirdisi(main, 'Gerçekleşen')).toContainText('Henüz yok');
    await expect(ozetGirdisi(main, 'Planlanan')).toContainText(toplam('planned', YIL_2027));

    // Rapor seçimi alt sayfada: Kaleme göre harcama → kalem akordeonu, ilk satır açık.
    await alttanSec(page, main, 'Rapor', 'Kaleme göre harcama');
    const kalem = rapor(main, 'Kaleme göre harcama');
    await expect(kalem).toBeVisible();
    await expect(kalem.getByRole('table')).toHaveCount(0);
    const kalemler = kalem.getByRole('button', { name: /^Örnek gider satırı \d/ });
    await expect(kalemler).toHaveCount(8);
    await expect(kalemler.first()).toHaveAttribute('aria-expanded', 'true');
    await expect(kalem.getByRole('button', { name: /^Örnek gider satırı 1/ })).toContainText(toplam('planned', YIL_2027, 'Örnek gider satırı 1'));

    // Dışa aktarma: görünen satırlar, istemci tarafı CSV; Sheets'e yazma yok.
    const indirme = page.waitForEvent('download');
    await disaAktar.click();
    const dosya = await indirme;
    expect(dosya.suggestedFilename()).toMatch(/^aile-rapor-kaleme-gore-harcama-\d{8}\.csv$/);
    const icerik = readFileSync((await dosya.path())!, 'utf8');
    expect(icerik.charCodeAt(0)).toBe(0xfeff);
    expect(icerik).toContain('Kalem;Ocak 2027;');
    expect(icerik).toContain('Örnek gider satırı 1;');

    await tasmaYok(page);
    expect(await smallText(page, { root: '.aile-raporlar' })).toEqual([]);
    expect(istekler.filter(url => GENIS_ISTEK.test(url))).toEqual([]);
  });

  test('Oda bazında alımlar tutar toplamaz; sahipliği belirlenmemiş ölçünün nedeni yazılı', async ({ page }) => {
    const { main } = await ac(page);
    await alttanSec(page, main, 'Rapor', 'Oda bazında alımlar');
    const oda = rapor(main, 'Oda bazında alımlar');
    await expect(oda).toBeVisible();
    await expect(oda.getByText(/^Tutar toplanmaz: alımların sahipliği belirlenmiş toplanabilir ölçüsü yok/)).toBeVisible();
    await expect(oda).not.toContainText('₺');
    await expect(oda.getByRole('button', { name: /alım/ }).first()).toHaveAttribute('aria-expanded', 'true');
    await expect(main.getByRole('button', { name: 'Raporu dışa aktar' })).toBeEnabled();
    await tasmaYok(page);
  });
});

// --- Matris (@matrix): proje görünümünde, profile göre ---------------------------------------------------------------
test.describe('Raporlar › matris', () => {
  test('profil yerleşimi: telefon akordeon ve geniş kod yok; geniş tablo + grafik; ana eylem erişilebilir; taşma yok', { tag: '@matrix' }, async ({ page }) => {
    const { main, istekler } = await ac(page);
    const p = await profil(page);
    const disaAktar = main.getByRole('button', { name: 'Raporu dışa aktar' });
    await expect(main.getByRole('heading', { level: 1, name: 'Raporlar' })).toBeVisible();
    await expect(main.getByText(AMAC)).toBeVisible();
    await expect(disaAktar).toBeInViewport();
    await expect(disaAktar).toBeEnabled();

    const aylik = rapor(main, 'Aylık plan ve gerçek');
    await expect(aylik.getByText('Haziran – Kasım 2026 · Kasım sürüyor')).toBeVisible();
    if (p === 'phone') {
      await expect(main.getByRole('combobox', { name: 'Rapor' })).toBeVisible();
      await expect(aylik.getByRole('table')).toHaveCount(0);
      await expect(main.getByRole('img', { name: GRAFIK_ADI })).toHaveCount(0);
      await expect(aylik.getByRole('button', { name: /^Haziran 2026/ })).toHaveAttribute('aria-expanded', 'true');
    } else {
      await expect(aylik.getByRole('img', { name: /Aylara göre planlanan ve gerçekleşen/ })).toBeVisible();
      if (p === 'desktop') {
        await expect(aylik.getByRole('table', { name: 'Aylık plan ve gerçek' })).toBeVisible();
        await expect(aylik.getByRole('columnheader', { name: 'Gerçekleşen' })).toBeVisible();
        const nav = main.getByRole('navigation', { name: 'Raporlar' });
        await expect(nav.getByRole('menuitem', { name: 'Aylık plan ve gerçek' })).toBeVisible();
      } else {
        // Tablet: sütunlar sıkıştırılmaz; tablo içerik genişliğine sığmazsa ResponsiveTable akordeona iner. Değerler
        // grafiğin altında ya tabloda ya akordeondadır. Rapor seçimi menü değil, "Rapor" alanıdır.
        await expect(aylik.getByRole('table', { name: 'Aylık plan ve gerçek' }).or(aylik.getByRole('button', { name: /^Haziran 2026/ }))).toBeVisible();
        await expect(main.getByRole('combobox', { name: 'Rapor' })).toBeVisible();
      }
    }
    await tasmaYok(page);
    expect(await smallText(page, { root: '.aile-raporlar' })).toEqual([]);
    const genis = istekler.filter(url => GENIS_ISTEK.test(url));
    if (p === 'phone') expect(genis).toEqual([]);
    else expect(genis.length).toBeGreaterThan(0);
  });

  test('rapor seçimi her profilde çalışır; kısa yükseklikte seçenekler erişilebilir', { tag: '@matrix' }, async ({ page }) => {
    const { main } = await ac(page);
    const p = await profil(page);
    if (p === 'desktop') {
      await main.getByRole('navigation', { name: 'Raporlar' }).getByRole('menuitem', { name: 'Veri güveni özeti' }).click();
    } else if (p === 'phone') {
      await main.getByRole('combobox', { name: 'Rapor' }).click();
      const sayfa = page.getByRole('dialog', { name: 'Rapor' });
      await expect(sayfa).toBeVisible();
      const secenek = sayfa.getByRole('option', { name: 'Veri güveni özeti', exact: true });
      await secenek.scrollIntoViewIfNeeded();
      await expect(secenek).toBeInViewport();
      await secenek.click();
      await expect(sayfa).toBeHidden();
    } else {
      await main.getByRole('combobox', { name: 'Rapor' }).click();
      await page.getByRole('option', { name: 'Veri güveni özeti', exact: true }).click();
    }
    const guven = rapor(main, 'Veri güveni özeti');
    await expect(guven).toBeVisible();
    await expect(guven.getByText(/sorun kaydı/).first()).toBeVisible();
    await tasmaYok(page);
  });
});
