import { readFileSync } from 'node:fs';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { enterKeyboardMode, gotoAdmin, horizontalOverflow, openAdmin, tabKey } from './admin-helpers';
import { accentEdges, focusRing, overflow, smallText, touchTargets } from './admin-detectors';

// Emeklilik planı (#/emeklilik) — kritik kullanıcı yolculuğu, önce telefon (chromium 320×568 dokunmatik; webkit 390×844
// dokunmatik aynı yolculuğu koşar). @matrix etiketli test entegrasyonda 320×480, 360, 375, 568×320 (telefon profili),
// 820×1180 tablet ve 1440 masaüstünde de koşar. Belge: docs/EMEKLILIK-PLANI.md; katmanlar src/admin/emeklilik/contract.ts.
// Yolculuk: başlık + amaç + öneri ve "Bunu seç" ilk ekranda → üç bağımsız Evet/Hayır sorusu (yerel radyo grubu, 44/48 px)
// → sonuç özeti anında değişir (planlama ayı, yaş, ödeme, aylık + model adı, kesinti) → öneriye dönüş → sekiz bileşim
// telefonda akordeon (ilk satır açık) → "Gün ve tutarları düzenle" içinde aralık dışı gün hatası alanın yanında.
// Durumlar: profil yok (üretim varsayılanı: dosya içe aktarma, yalnız bellekte) ve hata, adlarıyla.
// Veri: yalnız sentetik profil (fixtures/emeklilik/profil-sentetik.json) /__aile/emeklilik/profil.json yolundan
// page.route ile verilir; kişisel profil ve geliştirme ortam değişkeni kullanılmaz. Google'a istek gitmez (kesilir).
// Hesap doğruluğu model birim testlerinin işidir; burada değerler biçim ve değişim olarak doğrulanır (ay adı + yıl,
// ₺8.500,00 biçimi, seçim değişince ay değişir). Emülasyon gerçek cihaz değildir. Firefox koşulmaz.

const PROFIL_YOLU = '**/__aile/emeklilik/profil.json';
const SENTETIK_PROFIL = readFileSync(new URL('../fixtures/emeklilik/profil-sentetik.json', import.meta.url), 'utf8');
const AMAC = 'Üç seçimin emeklilik ayını, ödemeyi ve aylığı nasıl değiştirdiğini görün.';
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
    const alanKutusu = await gun.boundingBox();
    const hataKutusu = await hata.boundingBox();
    expect(hataKutusu!.y, 'hata alanın altında').toBeGreaterThan(alanKutusu!.y);
    expect(hataKutusu!.y - (alanKutusu!.y + alanKutusu!.height), 'hata alana bitişik').toBeLessThan(48);
    await gun.fill('0');
    await gun.blur();
    await expect(gun).not.toHaveAttribute('aria-invalid', 'true');

    // 8. Kurallar ve teslim: geniş/antd/grafik modülü istenmez, Google'a istek yok.
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
  expect(await touchTargets(page, { root: '[data-bolum="secimler"]' }), `dokunma hedefi ≥ ${kaba ? HEDEF_KABA : HEDEF}`).toEqual([]);
  await kurallar(page);
});
