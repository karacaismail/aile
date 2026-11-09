import { readFileSync } from 'node:fs';
import { test, expect, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { enterKeyboardMode, gotoAdmin, horizontalOverflow, openAdmin, tabKey } from './admin-helpers';
import { accentEdges, focusRing, overflow, smallText, touchTargets } from './admin-detectors';

// Emeklilik planı (#/emeklilik) — kritik kullanıcı yolculuğu, önce telefon (chromium 320×568 dokunmatik; webkit 390×844
// dokunmatik aynı yolculuğu koşar). @matrix etiketli test entegrasyonda 320×480, 360, 375, 568×320 (telefon profili),
// 820×1180 tablet ve 1440 masaüstünde de koşar. Belge: docs/EMEKLILIK-PLANI.md; katmanlar src/admin/emeklilik/contract.ts.
// Yolculuk: başlık + amaç + öneri ve "Bunu seç" ilk ekranda → üç bağımsız Evet/Hayır sorusu (yerel radyo grubu, 44/48 px)
// → sonuç özeti anında değişir (planlama ayı, yaş, ödeme, aylık + model adı, kesinti) → öneriye dönüş → sekiz bileşim
// telefonda akordeon (ilk satır açık) → "Gün ve tutarları düzenle" içinde aralık dışı gün hatası alanın yanında → bütün
// bölümler açıkken sayfadaki her etkileşimli denetim dokunma hedefini (44; kaba girişte 48) karşılar.
// Alanlar arası kural: borç ortak ödemeden az yazılınca ("4") alan hatası; sayfa hata durumuna geçmez, odak ve açık bölüm
// korunur. Geniş sunumun kırılımı kapsayıcı genişliğidir: kapsayıcı 759/760/761 (N−1/N/N+1) olacak görünüm genişlikleri
// ölçülür; ≥ 760 tam iki sütun, altında tek sütun (sonuç seçimlerin hemen altında); 768×1024 ve 1024×768 çevresi de.
// Hesap hatası ekranı (aşırı tutar → planlayıcı RangeError): adıyla, değer yankılanmadan; ağaç, odak ve açık bölüm korunur.
// Durumlar: profil yok (üretim varsayılanı: dosya içe aktarma, yalnız bellekte) ve hata, adlarıyla. Eksi işareti U+2212.
// Veri: yalnız sentetik profil (fixtures/emeklilik/profil-sentetik.json) /__aile/emeklilik/profil.json yolundan
// page.route ile verilir; kişisel profil ve geliştirme ortam değişkeni kullanılmaz. Google'a istek gitmez (kesilir).
// Hesap doğruluğu model birim testlerinin işidir; burada değerler biçim ve değişim olarak doğrulanır (ay adı + yıl,
// ₺8.500,00 biçimi, seçim değişince ay değişir). Emülasyon gerçek cihaz değildir. Firefox koşulmaz.

const PROFIL_YOLU = '**/__aile/emeklilik/profil.json';
const SENTETIK_PROFIL = readFileSync(new URL('../fixtures/emeklilik/profil-sentetik.json', import.meta.url), 'utf8');
// Amaç cümlesinin tek kaynağı shell/navigation.ts (emeklilik sayfa kaydı).
const AMAC = 'Askerlik, Bağ-Kur ve ihya seçeneklerinin emeklilik tarihine ve maliyetine etkisini karşılaştırın.';
const SORULAR = {
  askerlik: 'Askerliği borçlanacak mısınız?',
  bagkur: 'Bağ-Kur borcunu ödeyecek misiniz?',
  ihya: 'Durdurulan Bağ-Kur sürelerini ihya edecek misiniz?',
} as const;
const AY = /^(Ocak|Şubat|Mart|Nisan|Mayıs|Haziran|Temmuz|Ağustos|Eylül|Ekim|Kasım|Aralık) \d{4}$/;
const PARA = /₺\d{1,3}(?:\.\d{3})*,\d{2}/;
const MODEL_ADI = /SGK referansı|Kazanç tahmini|Elle girilen/;
/** Geniş-özel ve grafik modülleri: telefon profilinde hiçbiri istenmemeli (dev: kaynak yolu, üretim: wide-* parçası). */
const GENIS_ISTEK = /(?:\.wide(?:\.tsx?)?(?:[?#]|$)|\/wide-[^/]*\.js|echarts|zrender|\/antd\/|@ant-design)/;
const HEDEF = 44;
const HEDEF_KABA = 48;

type Profil = 'phone' | 'tablet' | 'desktop';

/** Google'a giden her isteği keser ve kaydeder (test sonunda boş olmalı). */
async function googleKapisi(page: Page): Promise<string[]> {
  const giden: string[] = [];
  await page.route(/^https?:\/\/([^/]+\.)?(google|googleapis|gstatic|googleusercontent)\.com\//, route => {
    giden.push(route.request().url());
    return route.abort('blockedbyclient');
  });
  return giden;
}

async function sentetikProfil(page: Page) {
  await page.route(PROFIL_YOLU, route => route.fulfill({ status: 200, contentType: 'application/json', body: SENTETIK_PROFIL }));
}

async function emeklilikAc(page: Page): Promise<{ main: Locator; istekler: string[]; google: string[]; profil: Profil }> {
  const google = await googleKapisi(page);
  await sentetikProfil(page);
  const istekler: string[] = [];
  page.on('request', request => istekler.push(new URL(request.url()).pathname));
  const main = await openAdmin(page, '/emeklilik');
  await expect(sonuc(main)).toBeVisible();
  const profil = (await page.evaluate(() => document.documentElement.dataset.profile)) as Profil;
  return { main, istekler, google, profil };
}

const sonuc = (main: Locator) => main.getByRole('region', { name: 'Sonuç', exact: true });
const soru = (main: Locator, anahtar: keyof typeof SORULAR) => main.getByRole('radiogroup', { name: SORULAR[anahtar] });
const planlamaAyi = (main: Locator) => sonuc(main).getByTestId('planlama-ayi');

async function kurallar(page: Page) {
  expect(await horizontalOverflow(page), 'sayfa düzeyinde yatay taşma yok').toEqual([]);
  expect(await overflow(page, { root: 'main#admin-content' }), 'görünüm alanından taşan / kesilen metin yok').toEqual([]);
  expect(await smallText(page, { root: 'main#admin-content', min: 14 }), 'okunur metin ≥ 14 CSS px').toEqual([]);
  expect(await accentEdges(page, { root: 'main#admin-content' }), 'kavisli vurgu kenarı yok').toEqual([]);
}

test.describe('Emeklilik planı › telefon', () => {
  test('telefon yolculuğu: başlık, amaç ve öneri ilk ekranda; üç soru anında sonucu değiştirir; "Bunu seç" öneriye döner; bileşimler akordeon; aralık dışı gün hatası alanın yanında; geniş modül indirilmez', async ({ page }) => {
    const { main, istekler, google, profil } = await emeklilikAc(page);
    test.skip(profil !== 'phone', 'Telefon yolculuğu yalnız telefon profilinde');

    // 1. Başlık iskeleti: bölüm → h1 → amaç; öneri satırı ve ana eylem ilk ekranda.
    await expect(main.getByText('Para', { exact: true }).first()).toBeVisible();
    await expect(main.getByRole('heading', { level: 1, name: 'Emeklilik planı' })).toBeInViewport();
    await expect(main.getByText(AMAC)).toBeInViewport();
    const oneri = main.getByRole('region', { name: 'Öneri' });
    await expect(oneri).toContainText(/Senaryo önerisi|En erken tarih senaryosu/);
    const bunuSec = oneri.getByRole('button', { name: 'Bunu seç' });
    await expect(bunuSec).toBeInViewport();

    // 2. Sonuç özeti: ay adı + yıl, yaş, ödeme ve aylık model adıyla; kesinti adıyla.
    await expect(planlamaAyi(main)).toHaveText(AY);
    await expect(sonuc(main)).toContainText(/\d+ yaşında/);
    await expect(sonuc(main)).toContainText(MODEL_ADI);
    await expect(sonuc(main)).toContainText(/Kesinti yok|kesinti/);

    // 3. Üç bağımsız soru: yerel radyo grubu Evet/Hayır, açıklama satırında gün; hedef ≥ 44 (kaba girişte 48).
    for (const anahtar of ['askerlik', 'bagkur', 'ihya'] as const) {
      const grup = soru(main, anahtar);
      await expect(grup.getByRole('radio', { name: 'Evet' })).toHaveCount(1);
      await expect(grup.getByRole('radio', { name: 'Hayır' })).toHaveCount(1);
      await expect(grup).toContainText(/\d+(?:\.\d{3})* gün/);
    }
    const kaba = await page.evaluate(() => matchMedia('(any-pointer: coarse)').matches);
    expect(await touchTargets(page, { root: '[data-bolum="secimler"]' }), `dokunma hedefi ≥ ${kaba ? HEDEF_KABA : HEDEF}`).toEqual([]);

    // 4. Askerlik Evet ↔ Hayır: planlama ayı anında değişir; öneriden ayrılınca "Bunu seç" etkin olur.
    const askerlik = soru(main, 'askerlik');
    const evetSecili = await askerlik.getByRole('radio', { name: 'Evet' }).isChecked();
    const once = (await planlamaAyi(main).textContent())?.trim();
    // Yerel radyo girdisi segmentin tamamını kaplar (tüm segment tıklanır); kullanıcının işaretçisi girdiye düşer.
    await askerlik.getByRole('radio', { name: evetSecili ? 'Hayır' : 'Evet' }).click();
    await expect(askerlik.getByRole('radio', { name: evetSecili ? 'Hayır' : 'Evet' })).toBeChecked();
    await expect(planlamaAyi(main)).not.toHaveText(once ?? '');
    await expect(planlamaAyi(main)).toHaveText(AY);
    await expect(bunuSec).toBeEnabled();
    await bunuSec.click();
    await expect(planlamaAyi(main)).toHaveText(once ?? '');
    await expect(bunuSec).toBeDisabled();

    // 5. Her seçimin payı ve ödeme biçimi (₺8.500,00) ya da adıyla bilinmiyor.
    const paylar = main.getByRole('region', { name: 'Her seçimin payı' });
    await expect(paylar.getByRole('listitem')).toHaveCount(3);
    await expect(sonuc(main)).toContainText(new RegExp(`${PARA.source}|Ödeme yok|Bilinmiyor`));

    // 6. Sekiz bileşim: telefonda akordeon, ilk satır açık; tablo yok.
    const bilesimler = main.getByRole('region', { name: 'Sekiz bileşim' });
    await bilesimler.scrollIntoViewIfNeeded();
    await expect(bilesimler.getByRole('table')).toHaveCount(0);
    const basliklar = bilesimler.locator('button.aile-acc-head');
    await expect(basliklar).toHaveCount(8);
    await expect(basliklar.first()).toHaveAttribute('aria-expanded', 'true');
    await expect(basliklar.nth(1)).toHaveAttribute('aria-expanded', 'false');

    // 7. Gün ve tutarlar: aralık dışı gün → hata alanın hemen altında, alan aria-invalid; geçerli değerle hata kalkar.
    const duzenle = main.getByRole('button', { name: 'Gün ve tutarları düzenle' });
    await duzenle.scrollIntoViewIfNeeded();
    await duzenle.click();
    const gun = main.getByLabel('Askerlikten eklenecek gün');
    await gun.fill('9999');
    await gun.blur();
    await expect(gun).toHaveAttribute('aria-invalid', 'true');
    const hata = main.getByText(/^Hata: 0 ile \d+(?:\.\d{3})* arasında bir gün girin\.$/);
    await expect(hata).toBeVisible();
    // İki kutu aynı karede ölçülür: ayrı boundingBox çağrıları arasında Disclosure açılış hareketi ya da kaydırma
    // ilerlerse aradaki mesafe yanlış ölçülür (yük altında görülen kararsızlık). Eşik değişmedi.
    const kutular = await gun.evaluate((alan, hataOgesi) => {
      const a = alan.getBoundingClientRect();
      const h = (hataOgesi as Element).getBoundingClientRect();
      return { alanUst: a.top, alanAlt: a.bottom, hataUst: h.top };
    }, await hata.elementHandle());
    expect(kutular.hataUst, 'hata alanın altında').toBeGreaterThan(kutular.alanUst);
    expect(kutular.hataUst - kutular.alanAlt, 'hata alana bitişik').toBeLessThan(48);
    await gun.fill('0');
    await gun.blur();
    await expect(gun).not.toHaveAttribute('aria-invalid', 'true');

    // 8. Bütün bölümler açık: sayfadaki her etkileşimli denetim (radyo, onay, alan, düğme, akordeon, dosya seçici) hedefi karşılar.
    const maas = main.getByRole('button', { name: 'Maaş ve aylık varsayımları' });
    await maas.scrollIntoViewIfNeeded();
    await maas.click();
    await expect(maas).toHaveAttribute('aria-expanded', 'true');
    expect(await touchTargets(page, { root: 'main#admin-content' }), `sayfadaki bütün dokunma hedefleri ≥ ${kaba ? HEDEF_KABA : HEDEF}`).toEqual([]);

    // 9. Kurallar ve teslim: geniş/antd/grafik modülü istenmez, Google'a istek yok.
    await kurallar(page);
    expect(istekler.filter(yol => GENIS_ISTEK.test(yol)), 'telefonda geniş/antd/grafik modülü').toEqual([]);
    expect(google, "Google'a istek").toEqual([]);
  });

  test('klavye: Tab radyo grubuna gelir, oklar seçimi değiştirir ve sonuç güncellenir; tek alt çizgi, halka yok', async ({ page, browserName }) => {
    const { main } = await emeklilikAc(page);
    await enterKeyboardMode(page, browserName);
    const grup = soru(main, 'askerlik');
    const secili = grup.getByRole('radio', { checked: true });
    await secili.focus();
    expect(await focusRing(page), 'radyo odağında tek alt çizgi').toEqual([]);
    const once = (await planlamaAyi(main).textContent())?.trim();
    await page.keyboard.press('ArrowDown');
    await expect(grup.getByRole('radio', { checked: true })).toBeFocused();
    await expect(planlamaAyi(main)).not.toHaveText(once ?? '');
    expect(await focusRing(page), 'ok ile seçimden sonra tek alt çizgi').toEqual([]);
    await page.keyboard.press(tabKey(browserName));
    expect(await focusRing(page), 'sonraki duraklarda halka yok').toEqual([]);
  });
});

test('Bağ-Kur borcu ortak ödemeden az ("4"): alan hatası; sayfa hata durumuna geçmez, odak ve açık bölüm korunur', async ({ page }) => {
  const { main } = await emeklilikAc(page);
  const duzenle = main.getByRole('button', { name: 'Gün ve tutarları düzenle' });
  await duzenle.scrollIntoViewIfNeeded();
  await duzenle.click();
  await main.getByRole('radiogroup', { name: 'Bağ-Kur borcunun kaynağı' }).getByRole('radio', { name: 'Tutarı gir' }).click();
  const tutar = main.getByLabel('Düzeltilmiş Bağ-Kur borcu');
  await tutar.fill('');
  await tutar.pressSequentially('4');
  await expect(tutar).toBeFocused();
  await expect(tutar).toHaveAttribute('aria-invalid', 'true');
  await expect(main.getByText('Hata: Borç, yalnız SSK yolunda da ödenecek tutardan (₺50.000,00) az olamaz.')).toBeVisible();
  await expect(duzenle).toHaveAttribute('aria-expanded', 'true');
  await expect(main.getByRole('alert')).toHaveCount(0);
  await expect(sonuc(main)).toBeVisible();
  await expect(sonuc(main)).toContainText('1 alanda hata var; sonuç son geçerli değerlerle hesaplandı.');
  await tutar.pressSequentially('00.000,00');
  await expect(tutar).toHaveValue('400.000,00');
  await expect(tutar).not.toHaveAttribute('aria-invalid', 'true');
  await expect(tutar).toBeFocused();
  await kurallar(page);
});

// Geniş sunumun kırılımı kapsayıcı genişliğidir, görünüm genişliği değil: .aile-em-genis kapsayıcısı ≥ 760 px iken ızgara
// tam iki sütundur (sonuç sağda, ayrıntı paneli genişliğinde), altında tek sütundur (sonuç seçimlerin hemen altında,
// paylardan önce; sayfanın sonuna düşmez) — EmeklilikGenis.wide.css @container (min-width: 760px). Hesaplanmış
// grid-template-columns ve kapsayıcı genişliği okunur. Görünüm genişliği kapsayıcıyı 759/760/761 yapacak biçimde ölçülerek
// bulunur (N−1/N/N+1): tablet bandında (yan gezinme yok) ve masaüstü bandında (yan gezinme var) ayrı ayrı. Ayrıca tablet
// dikey 768 ve masaüstü kırılımı 1024 çevresi (N−1/N/N+1) aynı kuralla denetlenir.
const KAPSAYICI_KIRILIMI = 760;

interface GenisYerlesim { kapsayici: number; sutun: number }

async function genisAc(page: Page, boyut: { width: number; height: number }): Promise<{ main: Locator; yerlesim: GenisYerlesim }> {
  await page.setViewportSize(boyut);
  const main = await openAdmin(page, '/emeklilik');
  await expect(sonuc(main)).toBeVisible();
  await expect(main.locator('[data-emeklilik-yerlesim]')).toHaveAttribute('data-emeklilik-yerlesim', 'genis');
  const yerlesim = await main.locator('.aile-em-genis__izgara').evaluate(izgara => ({
    kapsayici: (izgara.closest('.aile-em-genis') as HTMLElement).getBoundingClientRect().width,
    sutun: getComputedStyle(izgara).gridTemplateColumns.trim().split(/\s+/).length,
  }));
  return { main, yerlesim };
}

/** Kapsayıcı ≥ 760 ise tam iki sütun ve sonuç sağda; değilse tek sütun ve sonuç seçimlerin altında, paylardan önce. */
async function genisYerlesimDenetle(page: Page, main: Locator, yerlesim: GenisYerlesim, ad: string) {
  const kutu = async (bolum: string) => (await main.getByRole('region', { name: bolum, exact: true }).boundingBox())!;
  const secimler = await kutu('Seçimler');
  const s = await kutu('Sonuç');
  const paylar = await kutu('Her seçimin payı');
  const ihya = await kutu('İhya karşılaştırması');
  if (yerlesim.kapsayici >= KAPSAYICI_KIRILIMI) {
    expect(yerlesim.sutun, `${ad}: kapsayıcı ${yerlesim.kapsayici} ≥ 760 → iki sütun`).toBe(2);
    expect(s.x, `${ad}: sonuç sağ sütunda`).toBeGreaterThanOrEqual(secimler.x + secimler.width - 1);
    expect(s.y, `${ad}: sağ sütunda sonuç seçimlerle aynı hizada başlar`).toBeLessThan(secimler.y + secimler.height);
  } else {
    expect(yerlesim.sutun, `${ad}: kapsayıcı ${yerlesim.kapsayici} < 760 → tek sütun`).toBe(1);
    expect(s.y, `${ad}: sonuç seçimlerin altında`).toBeGreaterThanOrEqual(secimler.y + secimler.height - 1);
    expect(s.y + s.height, `${ad}: sonuç paylardan önce`).toBeLessThanOrEqual(paylar.y + 1);
  }
  expect(s.y, `${ad}: sonuç ihya karşılaştırmasından önce`).toBeLessThan(ihya.y);
  expect(await horizontalOverflow(page), `${ad}: sayfa düzeyinde yatay taşma yok`).toEqual([]);
}

test('geniş sunum kırılımı kapsayıcı genişliğinde: kapsayıcı 759/760/761 (N−1/N/N+1) tablet ve masaüstü bandında; ≥ 760 tam iki sütun, altında tek sütun', { tag: '@matrix' }, async ({ page }) => {
  // Sayfa kırılım başına yeniden açılır; macOS CI'da bu açılışların toplamı varsayılan süreyi aşar.
  test.slow();
  await googleKapisi(page);
  await sentetikProfil(page);
  // Ölçüm başlangıcı: tablet bandı (yan gezinme yok) ve masaüstü bandı (yan gezinme var); kapsayıcı görünümle birlikte büyür.
  for (const baslangic of [{ ad: 'tablet', width: 800, height: 1024 }, { ad: 'masaüstü', width: 1100, height: 800 }]) {
    const { yerlesim: olcum } = await genisAc(page, baslangic);
    const fark = baslangic.width - olcum.kapsayici;
    for (const hedef of [KAPSAYICI_KIRILIMI - 1, KAPSAYICI_KIRILIMI, KAPSAYICI_KIRILIMI + 1]) {
      const boyut = { width: Math.round(hedef + fark), height: baslangic.height };
      const ad = `${baslangic.ad} ${boyut.width}×${boyut.height}`;
      const { main, yerlesim } = await genisAc(page, boyut);
      expect(yerlesim.kapsayici, `${ad}: kapsayıcı genişliği`).toBe(hedef);
      expect(yerlesim.sutun, `${ad}: sütun sayısı`).toBe(hedef >= KAPSAYICI_KIRILIMI ? 2 : 1);
      await genisYerlesimDenetle(page, main, yerlesim, ad);
    }
  }
});

const GORUNUM_KIRILIMLARI = [
  { width: 767, height: 1024 }, { width: 768, height: 1024 }, { width: 769, height: 1024 },
  { width: 1023, height: 768 }, { width: 1024, height: 768 }, { width: 1025, height: 768 },
] as const;

test('geniş sunum tablet dikey (768×1024) ve masaüstü kırılımı (1024×768) çevresinde N−1/N/N+1: sütun sayısı kapsayıcı kuralına uyar; sonuç sayfanın sonuna düşmez', { tag: '@matrix' }, async ({ page }) => {
  // Sayfa kırılım başına yeniden açılır; macOS CI'da bu açılışların toplamı varsayılan süreyi aşar.
  test.slow();
  await googleKapisi(page);
  await sentetikProfil(page);
  for (const boyut of GORUNUM_KIRILIMLARI) {
    const { main, yerlesim } = await genisAc(page, boyut);
    await genisYerlesimDenetle(page, main, yerlesim, `${boyut.width}×${boyut.height}`);
  }
});

// Hesap hatası ekranı (planlayıcı RangeError): "Diğer aylık kesintiler" alanına güvenli kuruş aralığını aşan tutar
// yazılır (Para). Telefon (chromium 320×568, webkit 390×844), masaüstü ve @matrix projelerinde: ErrorState başlığı alan adı
// ve kuralı söyler, girilen değeri yankılamaz; tek "Varsayımları sıfırla" (erişilebilir ad benzersiz); açık bölümler, odak
// ve seçimler bölgesi (aynı düğüm) korunur; sonuç tutarları gösterilmez. Kurallar (taşma yok, metin ≥ 14 px, kavisli
// vurgu kenarı yok), klavye odağında tek alt çizgi (halka yok) ve sayfadaki bütün dokunma hedefleri (koşullu Bağ-Kur borcu
// alanı ve hata durumunun düğmesi dahil; 44, kaba girişte 48). Sıfırla hesabı geri getirir.
const ASIRI_TUTAR = '987654321987654';

test('hesap hatası: aşırı tutar ErrorState’i adıyla gösterir (değer yankılanmaz); tek sıfırla; açık bölüm, odak ve ağaç korunur; kurallar, odak çizgisi ve dokunma hedefleri; sıfırla hesabı geri getirir', { tag: '@matrix' }, async ({ page, browserName }) => {
  const { main, google } = await emeklilikAc(page);
  const gunVeTutar = main.getByRole('button', { name: 'Gün ve tutarları düzenle' });
  await gunVeTutar.scrollIntoViewIfNeeded();
  await gunVeTutar.click();
  await main.getByRole('radiogroup', { name: 'Bağ-Kur borcunun kaynağı' }).getByRole('radio', { name: 'Tutarı gir' }).click();
  const borc = main.getByLabel('Düzeltilmiş Bağ-Kur borcu');
  await expect(borc).toBeVisible();
  const maas = main.getByRole('button', { name: 'Maaş ve aylık varsayımları' });
  await maas.scrollIntoViewIfNeeded();
  await maas.click();
  await expect(maas).toHaveAttribute('aria-expanded', 'true');
  const secimler = await main.getByRole('region', { name: 'Seçimler', exact: true }).elementHandle();

  // Hata yazarken oluşur: odak alanda kalır, bölümler açık, seçimler aynı düğüm; sonuç bölümü yok.
  const kesinti = main.getByLabel('Diğer aylık kesintiler');
  await kesinti.scrollIntoViewIfNeeded();
  // Para alanı odak dışında "₺0,00", odakta düzenlenebilir "0,00" gösterir: önce odak görünümü yerleşsin, sonra silinip yazılsın.
  await kesinti.focus();
  await expect(kesinti).toHaveValue('0,00');
  await kesinti.fill('');
  await kesinti.pressSequentially(ASIRI_TUTAR);
  const uyari = main.getByRole('alert');
  await expect(uyari).toContainText('Hata: Hesap yapılamadı: Diğer kesintiler hesaplanamıyor');
  expect(await uyari.textContent(), 'hata metni değeri yankılamaz').not.toMatch(/\d{5,}/);
  await expect(kesinti).toBeFocused();
  await expect(kesinti).toHaveValue(ASIRI_TUTAR);
  await expect(gunVeTutar).toHaveAttribute('aria-expanded', 'true');
  await expect(maas).toHaveAttribute('aria-expanded', 'true');
  await expect(borc).toBeVisible();
  expect(await secimler!.evaluate(dugum => dugum.isConnected), 'seçimler yeniden kurulmadı').toBe(true);
  await expect(sonuc(main)).toHaveCount(0);
  await expect(main.getByRole('region', { name: 'Her seçimin payı' })).toHaveCount(0);
  await expect(main.getByRole('region', { name: 'Sekiz bileşim' })).toHaveCount(0);
  const sifirla = main.getByRole('button', { name: 'Varsayımları sıfırla' });
  await expect(sifirla).toHaveCount(1);

  // Kurallar ve dokunma hedefleri (hata durumu düğmesi ve koşullu borç alanı dahil).
  await kurallar(page);
  const kaba = await page.evaluate(() => matchMedia('(any-pointer: coarse)').matches);
  expect(await touchTargets(page, { root: 'main#admin-content' }), `hata durumunda bütün dokunma hedefleri ≥ ${kaba ? HEDEF_KABA : HEDEF}`).toEqual([]);

  // Klavye odağı: hata düğmesinde ve hatalı alanda tek alt çizgi, halka yok; Enter sıfırlar.
  await enterKeyboardMode(page, browserName);
  await kesinti.focus();
  expect(await focusRing(page), 'hatalı alanda tek alt çizgi').toEqual([]);
  await sifirla.focus();
  expect(await focusRing(page), 'sıfırla düğmesinde tek alt çizgi').toEqual([]);
  await page.keyboard.press('Enter');
  await expect(main.getByRole('alert')).toHaveCount(0);
  await expect(sonuc(main)).toBeVisible();
  await expect(planlamaAyi(main)).toHaveText(AY);
  await expect(main.getByRole('button', { name: 'Varsayımları sıfırla' })).toHaveCount(1);
  expect(await secimler!.evaluate(dugum => dugum.isConnected), 'seçimler sıfırlamada da yeniden kurulmadı').toBe(true);
  expect(google, "Google'a istek").toEqual([]);
});

test.describe('Emeklilik planı › profil durumları', () => {
  test('profil yok: "Profil dosyasını içe aktar" ve yalnız bellekte tutulur metni; sentetik dosya içe aktarılınca sonuç çizilir', async ({ page }) => {
    await googleKapisi(page);
    await page.route(PROFIL_YOLU, route => route.fulfill({ status: 404, contentType: 'text/plain', body: 'yok' }));
    await gotoAdmin(page, '/emeklilik');
    const main = page.locator('main#admin-content');
    await expect(main.getByRole('heading', { level: 1, name: 'Emeklilik planı' })).toBeVisible();
    const iceAktar = main.getByLabel('Profil dosyasını içe aktar');
    await expect(iceAktar).toBeAttached();
    await expect(main.getByText(/yalnız bu sekmenin belleğinde tutulur/)).toBeVisible();
    await iceAktar.setInputFiles({ name: 'profil-sentetik.json', mimeType: 'application/json', buffer: Buffer.from(SENTETIK_PROFIL) });
    await expect(sonuc(main)).toBeVisible();
    await expect(planlamaAyi(main)).toHaveText(AY);
    await expect(main.getByText(/Sentetik profil/)).toBeVisible();
    await kurallar(page);
  });

  test('profil hata: bozuk profil adıyla hata durumu, tutar gösterilmez', async ({ page }) => {
    await googleKapisi(page);
    await page.route(PROFIL_YOLU, route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"surum": 1' }));
    await gotoAdmin(page, '/emeklilik');
    const main = page.locator('main#admin-content');
    const hata = main.getByRole('alert');
    await expect(hata).toContainText(/^Hata:/);
    await expect(main).not.toContainText('₺');
    await expect(main.getByLabel('Profil dosyasını içe aktar')).toBeAttached();
  });
});

test('Emeklilik planı uyarlanır yerleşim: başlık, öneri eylemi ve sorular görünür; geniş profilde iki sütun ve yapışkan sonuç; taşma yok', { tag: '@matrix' }, async ({ page }) => {
  const { main, istekler, profil } = await emeklilikAc(page);
  await expect(main.getByRole('heading', { level: 1, name: 'Emeklilik planı' })).toBeInViewport();
  const bunuSec = main.getByRole('region', { name: 'Öneri' }).getByRole('button', { name: 'Bunu seç' });
  await bunuSec.scrollIntoViewIfNeeded();
  await expect(bunuSec).toBeInViewport();
  const kok = main.locator('[data-emeklilik-yerlesim]');
  if (profil === 'phone') {
    await expect(kok).toHaveAttribute('data-emeklilik-yerlesim', 'telefon');
    expect(istekler.filter(yol => GENIS_ISTEK.test(yol)), 'telefonda geniş/antd/grafik modülü').toEqual([]);
  } else {
    await expect(kok).toHaveAttribute('data-emeklilik-yerlesim', 'genis');
    expect(istekler.some(yol => /EmeklilikGenis\.wide|\/wide-[^/]*\.js/.test(yol)), 'geniş modül istendi').toBe(true);
    const sol = await main.locator('[data-bolum="secimler"]').boundingBox();
    const sag = await sonuc(main).boundingBox();
    expect(sag!.x, 'sonuç sağ sütunda').toBeGreaterThan(sol!.x + sol!.width - 1);
    await expect(sonuc(main).locator('xpath=ancestor-or-self::*[@data-yapiskan]').first()).toHaveCSS('position', 'sticky');
  }
  for (const anahtar of ['askerlik', 'bagkur', 'ihya'] as const) {
    const evet = soru(main, anahtar).getByText('Evet', { exact: true });
    await evet.scrollIntoViewIfNeeded();
    await expect(evet).toBeInViewport();
  }
  const kaba = await page.evaluate(() => matchMedia('(any-pointer: coarse)').matches);
  expect(await touchTargets(page, { root: 'main#admin-content' }), `sayfadaki bütün dokunma hedefleri ≥ ${kaba ? HEDEF_KABA : HEDEF}`).toEqual([]);
  await kurallar(page);
});

// Bağ-Kur borcunun kaynağı: "Profildeki tutar" (profilde kaynaklı tutar varsa varsayılan; sentetik profilde aralık),
// "SGK düzeltilmiş tutarı bilinmiyor" (Codex aracı), "Sade araç tahmini (aralık)" (sentetik profilde tahminiBorc var) ve
// "Tutarı gir" (Türkçe TL). Tutar bilindiğinde mali sıralama yapılır → "Senaryo önerisi"; bilinmiyor seçilince
// → "En erken tarih senaryosu". Seçim sonucu, öneriyi ve bileşim tablosunu anında günceller; aralık "alt – üst" yazılır;
// sıfırla varsayılana döner.
// Telefon (chromium 320×568, webkit 390×844) ve masaüstü (chromium-desktop); @matrix ile dar/kısa/yatay/tablet de.
const ARALIK_FARK = /[+−]?₺\d{1,3}(?:\.\d{3})*,\d{2} – [+−]?₺\d{1,3}(?:\.\d{3})*,\d{2}/;
const KAYNAK_GRUBU = 'Bağ-Kur borcunun kaynağı';

test('Bağ-Kur borcunun kaynağı: varsayılan profildeki tutar senaryo önerisi; bilinmiyor en erken tarih senaryosu; sade araç aralığı ve girilen tutar; sonuç, öneri ve bileşimler anında; sıfırla varsayılana döner', { tag: '@matrix' }, async ({ page, browserName }) => {
  const { main, istekler, google, profil } = await emeklilikAc(page);
  const oneri = main.getByRole('region', { name: 'Öneri' });
  const bilesimler = main.getByRole('region', { name: 'Sekiz bileşim' });
  const donemFarki = sonuc(main).getByText(/^Ortak dönem sonunda fark/).locator('xpath=following-sibling::dd[1]');
  const bagkurAciklamasi = soru(main, 'bagkur').locator('.aile-em-soru__aciklama');

  // 1. Varsayılan: profildeki tutar (aralık) → mali sıralama yapılır, "Senaryo önerisi"; sonuçta "Bilinmiyor" yok.
  await expect(oneri).toContainText('Senaryo önerisi');
  await expect(donemFarki).toHaveText(ARALIK_FARK);
  await expect(bagkurAciklamasi).toHaveText('600 gün · ₺300.000,00 – ₺450.000,00');
  await expect(bilesimler).not.toContainText('Bilinmiyor');
  await expect(sonuc(main)).not.toContainText('Bilinmiyor');

  // 2. "Gün ve tutarları düzenle" içinde yerel radyo grubu; dört seçenek, varsayılan seçili; select yok.
  const duzenle = main.getByRole('button', { name: 'Gün ve tutarları düzenle' });
  await duzenle.scrollIntoViewIfNeeded();
  await duzenle.click();
  const grup = main.getByRole('radiogroup', { name: KAYNAK_GRUBU });
  await expect(grup.getByRole('radio')).toHaveCount(4);
  const profilTutari = grup.getByRole('radio', { name: 'Profildeki tutar' });
  const bilinmiyor = grup.getByRole('radio', { name: 'SGK düzeltilmiş tutarı bilinmiyor' });
  const tahmin = grup.getByRole('radio', { name: 'Sade araç tahmini (aralık)' });
  const elle = grup.getByRole('radio', { name: 'Tutarı gir' });
  await expect(profilTutari).toBeChecked();
  await expect(main.locator('select')).toHaveCount(0);
  await expect(main.getByLabel('Düzeltilmiş Bağ-Kur borcu')).toHaveCount(0);
  await grup.scrollIntoViewIfNeeded();
  const kaba = await page.evaluate(() => matchMedia('(any-pointer: coarse)').matches);
  // Dokunma hedefi: radyo + etiket satırı ≥ 44 px; kaba girişte ≥ 48 px (ortak dedektör etiketi hedefe katar).
  expect(await touchTargets(page, { root: '.aile-em-kaynak' }), `kaynak seçenekleri ≥ ${kaba ? HEDEF_KABA : HEDEF}`).toEqual([]);
  for (const satir of await grup.locator('label').all()) {
    expect((await satir.boundingBox())!.height, 'seçenek satırının yüksekliği').toBeGreaterThanOrEqual(kaba ? HEDEF_KABA : HEDEF);
  }

  // 3a. "SGK düzeltilmiş tutarı bilinmiyor": tutar uydurulmaz; mali sıralama yok, "En erken tarih senaryosu".
  await bilinmiyor.click();
  await expect(bilinmiyor).toBeChecked();
  await expect(oneri).toContainText('En erken tarih senaryosu');
  await expect(donemFarki).toContainText('Bilinmiyor');
  await expect(bagkurAciklamasi).toHaveText(/^600 gün · Bilinmiyor · SGK düzeltilmiş tutarı bilinmiyor$/);
  await expect(bilesimler).toContainText('SGK düzeltilmiş tutarı bilinmiyor');

  // 3b. Sade araç tahmini: aralık "₺alt – ₺üst"; öneri senaryo önerisine döner; fark aralık olur.
  await expect(grup.getByText(/^₺280\.000,00 – ₺420\.000,00 · /)).toBeVisible();
  await tahmin.click();
  await expect(tahmin).toBeChecked();
  await expect(oneri).toContainText('Senaryo önerisi');
  await expect(bagkurAciklamasi).toHaveText('600 gün · ₺280.000,00 – ₺420.000,00');
  await expect(donemFarki).toHaveText(ARALIK_FARK);
  await expect(bilesimler).not.toContainText('SGK düzeltilmiş tutarı bilinmiyor');
  await expect(bilesimler).toContainText(ARALIK_FARK);

  // 4. Tutarı gir: alan Türkçe tutarı ayrıştırır; tek tutarla fark tek değer olur.
  await elle.click();
  await expect(elle).toBeChecked();
  const tutar = main.getByLabel('Düzeltilmiş Bağ-Kur borcu');
  await expect(tutar).toBeVisible();
  await tutar.fill('350.000,00');
  await tutar.blur();
  await expect(tutar).not.toHaveAttribute('aria-invalid', 'true');
  await expect(bagkurAciklamasi).toHaveText('600 gün · ₺350.000,00');
  await expect(oneri).toContainText('Senaryo önerisi');
  await expect(donemFarki).toHaveText(/^[+−]?₺\d{1,3}(?:\.\d{3})*,\d{2}$/);
  await tutar.fill('');
  await tutar.blur();
  await expect(tutar).toHaveAttribute('aria-invalid', 'true');
  await expect(main.getByText(/^Hata: Tutarı girin; bilinmiyorsa/)).toBeVisible();

  // 5. Kurallar seçenekler ve alan açıkken: taşma yok, metin ≥ 14 px, kavisli vurgu kenarı yok; axe (WCAG A/AA, kısmi
  //    otomatik kanıt) kaynak grubunda ve hatalı tutar alanında ihlal bulmaz.
  await kurallar(page);
  const axe = await new AxeBuilder({ page }).include('.aile-em-kaynak').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(axe.violations.map(ihlal => `${ihlal.id}: ${ihlal.nodes.map(n => n.target.join(' ')).join(', ')}`), 'axe ihlali').toEqual([]);

  // 6. Sıfırla: varsayılan kaynağa (profildeki tutar) ve senaryo önerisine döner; alan kalkar.
  const sifirla = main.getByRole('button', { name: 'Varsayımları sıfırla' });
  await sifirla.scrollIntoViewIfNeeded();
  await sifirla.click();
  await expect(profilTutari).toBeChecked();
  await expect(main.getByLabel('Düzeltilmiş Bağ-Kur borcu')).toHaveCount(0);
  await expect(oneri).toContainText('Senaryo önerisi');
  await expect(bagkurAciklamasi).toHaveText('600 gün · ₺300.000,00 – ₺450.000,00');

  // 7. Klavye: odak kaynak grubunda tek alt çizgi; ok tuşu sonraki seçeneği seçer ve sonucu günceller.
  await enterKeyboardMode(page, browserName);
  await profilTutari.focus();
  expect(await focusRing(page), 'kaynak seçeneğinde tek alt çizgi, halka yok').toEqual([]);
  await page.keyboard.press('ArrowDown');
  await expect(bilinmiyor).toBeFocused();
  await expect(bilinmiyor).toBeChecked();
  await expect(oneri).toContainText('En erken tarih senaryosu');
  expect(await focusRing(page), 'okla seçimden sonra tek alt çizgi').toEqual([]);

  if (profil === 'phone') expect(istekler.filter(yol => GENIS_ISTEK.test(yol)), 'telefonda geniş/antd/grafik modülü').toEqual([]);
  expect(google, "Google'a istek").toEqual([]);
});
