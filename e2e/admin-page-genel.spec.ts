import { test, expect, type Locator, type Page } from '@playwright/test';
import { enterKeyboardMode, horizontalOverflow, openAdmin } from './admin-helpers';
import { accentEdges, focusRing, smallText } from './admin-detectors';

// Genel durum sayfası (#/genel) — kritik kullanıcı yolculuğu, önce telefon (320×568), sonra @matrix genişlikleri.
// Tasarım: README › Sayfa iskeleti (başlık → amaç → tek birincil eylem → tazelik → en çok üç ölçü), components/Overview
// ve W0 uyarlamalı teslim sözleşmesi: telefon profili yerel HTML temel sunumu alır (ECharts ve *.wide modülleri
// indirilmez); tablet/masaüstü GenelPage.wide modülünü lazyWide ile yükler (Overview + aylık tablo).
// Gerçekleşen anlamı data/actuals.ts: kanıtsız değer "Kaynakta yazılı" (yüzde/"harcandı" yok), gelecek ay "Henüz yok".
// Aylık plan ve gerçek toplam üretmez: nesilde satır düzeyinde yaprak sahipliği haritası yok (gelir, "… toplamı",
// "Toplam …" ve adet satırları ayrılamaz); tutar yerine "Toplam kullanılamaz" ve nedeni, kayıtlar sayılır; grafik yok.
// Veri yalnız sentetik nesilden (webServer AILE_GENERATION_DIR); "bugün" sayfa saatinde 05.12.2026 10:00 İstanbul'a
// sabitlenir (yalnız Date; zamanlayıcılar çalışır). Emülasyon gerçek cihaz değildir. Firefox koşulmaz.

const BUGUN = new Date('2026-12-05T10:00:00+03:00');
const AMAC = 'Bu ayın nakdini, yaklaşan ödemeleri ve dikkat isteyen kayıtları tek yerde görün.';
const KAYNAKTA_YAZILI = 'Kaynakta yazılı';
const TOPLAM_KULLANILAMAZ = 'Toplam kullanılamaz';
const TOPLAM_NEDENI = /^Toplam kullanılamaz: bütçe gözlemlerinin satır düzeyinde yaprak sahipliği haritası yok/;
const HEDEF = 44;
const HEDEF_KABA = 48;
/** Geniş-özel ve grafik modülleri: telefon profilinde hiçbiri istenmemeli (dev: kaynak yolu, üretim: wide-* parçası). */
const GENIS_ISTEK = /(?:\.wide(?:\.tsx?)?(?:[?#]|$)|\/wide-[^/]*\.js|echarts|zrender)/;

type Profil = 'phone' | 'tablet' | 'desktop';

async function genelAc(page: Page): Promise<{ main: Locator; istekler: string[]; profil: Profil }> {
  await page.clock.setFixedTime(BUGUN);
  const istekler: string[] = [];
  page.on('request', request => istekler.push(new URL(request.url()).pathname));
  const main = await openAdmin(page, '/genel');
  // Veri gelince bütçe bloğu çizilir (her iki sunumda aynı ad).
  await expect(main.getByRole('region', { name: /^Bütçe · Aralık 2026/ })).toBeVisible();
  const profil = (await page.evaluate(() => document.documentElement.dataset.profile)) as Profil;
  return { main, istekler, profil };
}

const bolge = (main: Locator, ad: string | RegExp) => main.getByRole('region', { name: ad });
const ust = async (locator: Locator) => (await locator.boundingBox())?.y ?? Number.NaN;

test.describe('Genel durum › telefon', () => {
  test('telefon yolculuğu: başlık, amaç ve Aylık rapor ilk ekranda; ödemeler ve dikkat bütçeden önce; bütçe akordeon; kanıtsız gerçekleşen "Kaynakta yazılı"; aylık blok toplam üretmez; geniş modül indirilmez', async ({ page }) => {
    const { main, istekler, profil } = await genelAc(page);
    test.skip(profil !== 'phone', 'Telefon yolculuğu yalnız telefon profilinde');

    // 1. Başlık iskeleti: bölüm → h1 → amaç → tek birincil eylem, hepsi ilk ekranda; üç ölçü.
    await expect(main.getByRole('heading', { level: 1, name: 'Genel durum' })).toBeInViewport();
    await expect(main.getByText(AMAC)).toBeInViewport();
    const rapor = main.getByRole('button', { name: 'Aylık rapor' });
    await expect(rapor).toBeInViewport();
    const ozet = main.getByRole('list', { name: 'Özet' });
    await expect(ozet.getByRole('listitem')).toHaveCount(3);
    await expect(ozet.getByRole('listitem').nth(0)).toContainText('₺300,00');
    await expect(ozet.getByRole('listitem').nth(1)).toContainText('₺15.400,00');

    // 2. Sıra: yaklaşan ödemeler ve dikkat isteyenler bütçeden önce; bekleyen işler ve aylık tablo sonra.
    const odemeler = bolge(main, /^Yaklaşan ödemeler · 7 gün/);
    const dikkat = bolge(main, 'Dikkat isteyenler');
    const butce = bolge(main, /^Bütçe · Aralık 2026/);
    const isler = bolge(main, 'Bekleyen işler');
    const aylik = bolge(main, 'Aylık plan ve gerçek');
    const sira = [await ust(odemeler), await ust(dikkat), await ust(butce), await ust(isler), await ust(aylik)];
    expect(sira, 'blok sırası (üst kenar y)').toEqual([...sira].sort((a, b) => a - b));
    await expect(odemeler.getByRole('listitem')).toHaveCount(1);
    await expect(odemeler).toContainText('Örnek tahmin olayı 2');

    // 3. Bütçe: tablo değil akordeon, ilk satır açık; kanıtsız Gerçekleşen "Kaynakta yazılı", yüzde/"harcandı" yok.
    await expect(butce.getByRole('table')).toHaveCount(0);
    const satirlar = butce.getByRole('button', { name: /Örnek gider satırı/ });
    await expect(satirlar).toHaveCount(8);
    await expect(satirlar.first()).toHaveAttribute('aria-expanded', 'true');
    await expect(satirlar.nth(1)).toHaveAttribute('aria-expanded', 'false');
    await expect(butce).toContainText(KAYNAKTA_YAZILI);
    await expect(butce).not.toContainText(/harcandı/i);
    await satirlar.nth(1).click();
    await expect(satirlar.nth(1)).toHaveAttribute('aria-expanded', 'true');

    // 4. Aylık blok: ay akordeonu, tuval/görsel yok; satırlar tek Planlanan/Gerçekleşen sayısında toplanmaz — tutar yerine
    // "Toplam kullanılamaz", nedeni yazılı; kayıtlar ayrı sayılır.
    await expect(aylik.getByRole('img')).toHaveCount(0);
    await expect(aylik.locator('canvas')).toHaveCount(0);
    const aralik = aylik.getByRole('button', { name: /Ara 2026/ });
    await aralik.scrollIntoViewIfNeeded();
    await expect(aralik).toBeVisible();
    if ((await aralik.getAttribute('aria-expanded')) !== 'true') await aralik.click();
    const aralikGovde = page.locator(`[id="${await aralik.getAttribute('aria-controls')}"]`);
    await expect(aralikGovde).toContainText(`Planlanan${TOPLAM_KULLANILAMAZ}`);
    await expect(aralikGovde).toContainText(`Gerçekleşen${TOPLAM_KULLANILAMAZ}`);
    await expect(aralikGovde).toContainText('8 plan · 8 gerçekleşen');
    await expect(aylik.getByText(TOPLAM_NEDENI)).toBeVisible();
    await expect(aylik).not.toContainText('₺');
    await expect(aylik).not.toContainText(/harcandı/i);

    // 5. Sayfa düzeyinde yatay taşma yok; telefon ECharts ve geniş modül istemedi.
    expect(await horizontalOverflow(page), 'belge düzeyinde yatay taşma').toEqual([]);
    expect(istekler.filter(yol => GENIS_ISTEK.test(yol)), 'telefonda indirilen geniş/grafik modülleri').toEqual([]);
  });

  test('bekleyen işler: satır dokunma hedefi (kaba girişte 48 px), dokununca işaretlenir ve geri alınır; klavye odağı tek alt çizgi', async ({ page, browserName }) => {
    const { main, profil } = await genelAc(page);
    test.skip(profil !== 'phone', 'Telefon temel sunumu');
    const isler = bolge(main, 'Bekleyen işler');
    const gorevAdi = /Örnek tadilat işi 4/;
    const kutu = isler.getByRole('checkbox', { name: gorevAdi });
    await expect(kutu).toBeEnabled();
    const kaba = await page.evaluate(() => document.documentElement.hasAttribute('data-input-coarse'));
    // has: iç konumlayıcı dış öğeye göre çözülür; sayfa kökünden yazılır.
    const satir = isler.locator('label').filter({ has: page.getByRole('checkbox', { name: gorevAdi }) });
    const kutuSiniri = (await satir.boundingBox())!;
    expect(kutuSiniri.height, 'görev satırı yüksekliği').toBeGreaterThanOrEqual(kaba ? HEDEF_KABA : HEDEF);

    await satir.click();
    await expect(kutu).toBeChecked();
    await satir.click();
    await expect(kutu).not.toBeChecked();

    // Klavye modu: odak çevreleyen halka değil, tek alt çizgi (admin.css [data-focus-line]).
    await enterKeyboardMode(page, browserName);
    await kutu.focus();
    expect(await focusRing(page, { keyboard: true }), 'onay kutusu odağı').toEqual([]);
    // README › Odak: liste satırında çizgi satırın alt kenarındadır (ayırıcı çizgiyle çakışır, listede kesilmez).
    const cizgi = await satir.evaluate(el => {
      const after = getComputedStyle(el, '::after');
      const li = el.closest('li')!.getBoundingClientRect();
      return { alt: el.getBoundingClientRect().bottom - parseFloat(after.bottom), satirAlti: li.bottom };
    });
    expect(Math.abs(cizgi.alt - cizgi.satirAlti), 'odak çizgisi satırın alt kenarında').toBeLessThanOrEqual(1);
    const baglanti = bolge(main, 'Dikkat isteyenler').getByRole('link').first();
    await baglanti.focus();
    expect(await focusRing(page, { keyboard: true }), 'dikkat satırı odağı').toEqual([]);
  });
});

test.describe('Genel durum › @matrix genişlikleri', () => {
  test('telefon düzeni (360/375/390, 320×480, 568×320): telefon profili; başlık, amaç ve ana eylem erişilebilir; bloklar sırayla; 14 px altı metin ve yatay taşma yok', { tag: '@matrix' }, async ({ page }) => {
    const { main, istekler, profil } = await genelAc(page);
    test.skip(profil !== 'phone', 'Bu test telefon profilindeki genişlikler içindir');
    const viewport = page.viewportSize()!;
    // Yatay telefon (kısa kenar < 480) telefon profilinde kalır.
    if (viewport.width > viewport.height) expect(profil).toBe('phone');
    await expect(main.getByRole('heading', { level: 1, name: 'Genel durum' })).toBeInViewport();
    await expect(main.getByText(AMAC)).toBeVisible();
    const rapor = main.getByRole('button', { name: 'Aylık rapor' });
    await rapor.scrollIntoViewIfNeeded();
    await expect(rapor).toBeInViewport();
    const kutu = (await rapor.boundingBox())!;
    expect(kutu.height, 'ana eylem yüksekliği').toBeGreaterThanOrEqual(HEDEF);
    const odemeler = await ust(bolge(main, /^Yaklaşan ödemeler/));
    const dikkat = await ust(bolge(main, 'Dikkat isteyenler'));
    const butce = await ust(bolge(main, /^Bütçe · Aralık 2026/));
    expect(odemeler).toBeLessThan(dikkat);
    expect(dikkat).toBeLessThan(butce);
    await expect(bolge(main, /^Bütçe · Aralık 2026/).getByRole('table')).toHaveCount(0);
    expect(await smallText(page, { root: 'main#admin-content', min: 14 }), '14 px altı metin').toEqual([]);
    expect(await accentEdges(page, { root: '.aile-genel-telefon' }), 'radiuslu kutuda renkli kenar şeridi').toEqual([]);
    expect(await horizontalOverflow(page), 'belge düzeyinde yatay taşma').toEqual([]);
    expect(istekler.filter(yol => GENIS_ISTEK.test(yol)), 'telefonda geniş/grafik modülü').toEqual([]);
  });

  test('geniş profil (tablet/masaüstü): GenelPage.wide yüklenir; masaüstünde iki sütun; aylık tablo toplam üretmez, grafik ve ECharts yok', { tag: '@matrix' }, async ({ page }) => {
    const { main, istekler, profil } = await genelAc(page);
    test.skip(profil === 'phone', 'Geniş sunum yalnız tablet ve masaüstünde');
    const overview = main.getByTestId('overview');
    await expect(overview).toBeVisible();
    await expect(overview).toHaveAttribute('data-layout', profil === 'desktop' ? 'genis' : 'dar');
    expect(istekler.some(yol => /GenelPage\.wide|\/wide-[^/]*\.js/.test(yol)), 'geniş modül istendi').toBe(true);
    const aylik = bolge(main, 'Aylık plan ve gerçek');
    // Kullanıcı gibi kaydırılır: grafik olsaydı çalışma zamanı bu noktada isterdi (Chart: IntersectionObserver).
    await aylik.scrollIntoViewIfNeeded();
    const tablo = aylik.getByRole('table');
    const aralik = tablo.getByRole('row', { name: /Ara 2026/ });
    await expect(aralik).toContainText(TOPLAM_KULLANILAMAZ);
    await expect(aralik).toContainText(KAYNAKTA_YAZILI);
    await expect(aralik).toContainText('8 plan · 8 gerçekleşen');
    await expect(aylik.getByText(TOPLAM_NEDENI)).toBeVisible();
    await expect(aylik).not.toContainText('₺');
    // Çizilecek tutar yok: grafik ve grafik motoru yok.
    await expect(aylik.getByRole('img')).toHaveCount(0);
    expect(istekler.filter(yol => /echarts|zrender|Chart\.runtime/.test(yol)), 'grafiksiz Genel ECharts istemez').toEqual([]);
    if (profil === 'desktop') {
      const sol = await bolge(main, /^Yaklaşan ödemeler/).boundingBox();
      const sag = await bolge(main, 'Dikkat isteyenler').boundingBox();
      expect(sag!.x, 'dikkat isteyenler sağ sütunda').toBeGreaterThan(sol!.x + sol!.width - 1);
    }
    expect(await smallText(page, { root: 'main#admin-content', min: 14 }), '14 px altı metin').toEqual([]);
    expect(await horizontalOverflow(page), 'belge düzeyinde yatay taşma').toEqual([]);
  });
});
