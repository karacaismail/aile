import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, type Locator, type Page, type Request } from '@playwright/test';
import { ADMIN_MAIN, enterKeyboardMode, gotoAdmin, horizontalOverflow, openAdmin, tabKey } from './admin-helpers';
import { accentEdges, focusRing, smallText } from './admin-detectors';

// Ev ve odalar — sayfa yolculuğu (c06-ev). Tasarım: tasarim-sistemi/README.md › Sayfa iskeleti + Uyarlanır teslim,
// components/SayfaOdalar(Dar) ve bundle.js Aile.Pages.Odalar. Veri: dev sunucusu yalnız sentetik nesli servis eder
// (playwright.admin.config.ts → AILE_GENERATION_DIR); beklenen değerler fixture'dan hesaplanır, sabit sayı yazılmaz.
//
// Projeler: chromium 320×568 dokunmatik (telefon), webkit 390×844 dokunmatik (telefon), chromium-desktop 1440×900.
// @matrix etiketli testler entegrasyonda ek projelerde de koşar (360/375/320×480/568×320 telefon, 820 tablet, 1440
// WebKit masaüstü); dallar sayfanın kendi bildirdiği profile (html[data-profile]) göre ayrılır, viewport adına göre değil.
// Emülasyon gerçek cihaz değildir. Seçiciler role/ad ile; ui iç sınıflarına bağlı seçici yok.

// --- Sentetik nesil ------------------------------------------------------------------------------------------------
const FIXTURE_ROOT = fileURLToPath(new URL('../fixtures/generation-synthetic/', import.meta.url));
const GENERATION_ID = readdirSync(FIXTURE_ROOT).find(name => /^[a-f0-9]{64}$/.test(name) && statSync(path.join(FIXTURE_ROOT, name)).isDirectory())!;
const GENERATION_DIR = path.join(FIXTURE_ROOT, GENERATION_ID);

interface Money { amount: string; currency: string }
interface Kayit {
  id: string;
  label: string;
  room_id: string | null;
  deleted_at: string | null;
  amounts: { planned?: Money | null; actual?: Money | null };
  state_snapshot?: { decision?: string | null; fulfillment?: string | null } | null;
}
interface Oda { id: string; label: string; code: string; deleted_at: string | null }

const records = <T>(rel: string): T[] => (JSON.parse(readFileSync(path.join(GENERATION_DIR, rel), 'utf8')) as { records: T[] }).records;
const ODALAR = records<Oda>('data/rooms/household/00000.json').filter(oda => !oda.deleted_at);
const ALIMLAR = records<Kayit>('data/purchase_needs/household/00000.json').filter(kayit => !kayit.deleted_at);
const ISLER = records<Kayit>('data/work_orders/household/00000.json').filter(kayit => !kayit.deleted_at);
const ESYALAR = records<Kayit>('data/layout_items/household/00000.json').filter(kayit => !kayit.deleted_at);
const ARMATURLER = records<Kayit>('data/lighting_specs/household/00000.json').filter(kayit => !kayit.deleted_at);

const ODA_ADLARI = ODALAR.map(oda => oda.label).sort((a, b) => a.localeCompare(b, 'tr-TR'));
const ODA_BILINMIYOR = 'Oda bilinmiyor';
const ODASIZ = ALIMLAR.filter(kayit => !kayit.room_id || !ODALAR.some(oda => oda.id === kayit.room_id));
const LISTE_SATIRI = ODALAR.length + (ODASIZ.length > 0 ? 1 : 0);

/** Örnek oda: alımı, işi, eşyası ve armatürü olan, en az bir gerçekleşen tutarı bulunan ilk oda (ad sırasıyla). */
const ORNEK = ODALAR.filter(oda => ALIMLAR.some(k => k.room_id === oda.id && k.amounts.actual) && ISLER.some(k => k.room_id === oda.id)
  && ESYALAR.some(k => k.room_id === oda.id) && ARMATURLER.some(k => k.room_id === oda.id))
  .sort((a, b) => a.label.localeCompare(b.label, 'tr-TR'))[0]!;
const ornekAlim = ALIMLAR.filter(k => k.room_id === ORNEK.id);
const ornekIs = ISLER.filter(k => k.room_id === ORNEK.id);
const ornekEsya = ESYALAR.filter(k => k.room_id === ORNEK.id);
const ornekArmatur = ARMATURLER.filter(k => k.room_id === ORNEK.id);

/** Kuruş tam sayı toplamı → "₺8.500,00"; panelin Money bileşeninden bağımsız hesap. Değer yoksa null. */
function toplamTl(values: readonly (Money | null | undefined)[]): string | null {
  let kurus = 0n;
  let sayi = 0;
  for (const value of values) {
    if (!value) continue;
    const [lira, ondalik = ''] = value.amount.split('.');
    kurus += BigInt(lira!) * 100n + BigInt(`${ondalik}00`.slice(0, 2));
    sayi += 1;
  }
  if (sayi === 0) return null;
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .format(`${kurus / 100n}.${String(kurus % 100n).padStart(2, '0')}` as `${number}`);
}
const ORNEK_PLAN = toplamTl(ornekAlim.map(k => k.amounts.planned))!;
const ORNEK_GERCEK = toplamTl(ornekAlim.map(k => k.amounts.actual))!;

const AMAC = 'Her odanın alımlarını, görevlerini ve plan ile gerçek tutarını oda oda izleyin.';
const sirayla = (labels: readonly string[]) => [...labels].sort((a, b) => a.localeCompare(b, 'tr-TR'));

// --- Yardımcılar ---------------------------------------------------------------------------------------------------
type Profil = 'phone' | 'tablet' | 'desktop';
const profil = async (page: Page): Promise<Profil> => (await page.locator('html').getAttribute('data-profile')) as Profil;

/** Sayfa yüklenirken istenen kaynak yolları (dev sunucusu kaynak yolunu olduğu gibi verir). */
function istekKaydi(page: Page): string[] {
  const yollar: string[] = [];
  page.on('request', (request: Request) => yollar.push(new URL(request.url()).pathname));
  return yollar;
}
const genisIstekleri = (yollar: readonly string[]) => yollar.filter(yol => /\.wide(\.|$)|\/wide\//.test(yol));
const EV_GENIS = /\/pages\/ev\/[^/]*\.wide\.tsx$/;

async function hedefAlti(locator: Locator): Promise<number> {
  const box = await locator.boundingBox();
  return box ? Math.min(box.width, box.height) : 0;
}
async function asgariHedef(page: Page): Promise<number> {
  return (await page.locator('html').getAttribute('data-input-coarse')) !== null ? 48 : 44;
}

const main = (page: Page) => page.locator(ADMIN_MAIN);
const odaListesi = (page: Page) => main(page).getByRole('region', { name: 'Odalar' });
const ayrinti = (page: Page, ad: string) => main(page).getByRole('region', { name: ad });
const secici = (page: Page) => page.getByRole('dialog', { name: 'Oda seç' });

/** Alttan açılan sayfa açılış hareketi bittikten sonra görünüm alanının içinde durur (üst ve alt kenar). */
async function sigdi(page: Page, sayfa: Locator) {
  const yukseklik = page.viewportSize()!.height;
  await expect.poll(async () => {
    const kutu = await sayfa.boundingBox();
    return kutu !== null && kutu.y >= -1 && kutu.y + kutu.height <= yukseklik + 1;
  }, { message: 'Oda seç sayfası görünüm alanına sığmalı' }).toBe(true);
}

/**
 * Öğenin atalarında, kendisinde ya da içinde süren sonlu geçiş/animasyonlar bitene dek bekler (süre tahmini yok: tarayıcının
 * Animation.finished sözleri). Akordeonun açık gövdesi açılırken (ilk açık satır yüklemeden hemen sonra, @starting-style
 * 0fr → 1fr, 240 ms) iç kap overflow:hidden ile kırpar: tıklama öncesi kaydırma (scrollIntoView) sayfayı değil bu iç kabı
 * kaydırır (WebKit), geçiş ilerledikçe kaydırma sıfıra kırpılır ve düğme ölçülen yerden aşağı kayar; dokunuş düğmeyi
 * ıskalar (entegrasyon koşusu, webkit: tıklama y 820, düğme hareket bitince ≈ 843). Gövdedeki düğmeye hareket bitince
 * dokunulur; kullanıcı da açılan içeriğe ancak göründükten sonra dokunur.
 */
async function hareketBitsin(locator: Locator) {
  await locator.evaluate(async el => {
    const running = document.getAnimations().filter(animation => {
      const target = (animation.effect as KeyframeEffect | null)?.target;
      const finite = animation.effect?.getComputedTiming().iterations !== Infinity;
      return finite && target instanceof Element && (target.contains(el) || el.contains(target));
    });
    await Promise.all(running.map(animation => animation.finished.catch(() => undefined)));
  });
}

async function temizDuzen(page: Page, adim: string) {
  expect(await horizontalOverflow(page), `${adim}: sayfa düzeyinde yatay taşma`).toEqual([]);
  expect(await smallText(page, { root: ADMIN_MAIN }), `${adim}: 14 px altı metin`).toEqual([]);
  expect(await accentEdges(page, { root: ADMIN_MAIN }), `${adim}: kavisli vurgu kenarı`).toEqual([]);
}

// --- Telefon yolculuğu (320×568 Chromium, 390×844 WebKit) --------------------------------------------------------
test.describe('Ev ve odalar › telefon yolculuğu', () => {
  test('başlık, amaç ve "Oda seç" ilk ekranda; odalar akordeon (ilk açık), tablo yok, geniş modül indirilmez', async ({ page }) => {
    const yollar = istekKaydi(page);
    await openAdmin(page, '/ev');
    test.skip(await profil(page) !== 'phone', 'telefon profili yolculuğu');

    await expect(main(page).getByRole('heading', { level: 1, name: 'Ev ve odalar' })).toBeInViewport();
    await expect(main(page).getByText(AMAC)).toBeInViewport();
    const odaSec = main(page).getByRole('button', { name: 'Oda seç' });
    await expect(odaSec).toBeInViewport();
    expect(await hedefAlti(odaSec)).toBeGreaterThanOrEqual(44);

    const liste = odaListesi(page);
    await expect(liste).toBeVisible();
    await expect(main(page).getByRole('table')).toHaveCount(0);
    const basliklar = liste.locator('button[aria-expanded]');
    await expect(basliklar).toHaveCount(LISTE_SATIRI);
    await expect(basliklar.first()).toHaveAttribute('aria-expanded', 'true');
    for (const ad of [...ODA_ADLARI, ODA_BILINMIYOR]) await expect(liste.getByRole('button', { name: new RegExp(`^${ad}`) })).toHaveCount(1);
    // İlk açık satır plan ve gerçeği ayrı etiketle yazar.
    const ilkGovde = liste.locator(`#${await basliklar.first().getAttribute('aria-controls')}`);
    await expect(ilkGovde.getByText('Planlanan', { exact: true })).toBeVisible();
    await expect(ilkGovde.getByText('Gerçekleşen', { exact: true })).toBeVisible();
    await expect(ilkGovde.getByRole('button', { name: 'Odayı aç' })).toBeVisible();

    await temizDuzen(page, 'oda listesi');
    expect(genisIstekleri(yollar), 'telefon geniş modül istememeli').toEqual([]);
  });

  test('Oda seç alt sayfası → oda ayrıntısı (plan | gerçek ayrı, alımlar ve işler) → Listeye dön odağı satıra getirir', async ({ page }) => {
    const yollar = istekKaydi(page);
    await openAdmin(page, '/ev');
    test.skip(await profil(page) !== 'phone', 'telefon profili yolculuğu');

    await main(page).getByRole('button', { name: 'Oda seç' }).click();
    const sayfa = secici(page);
    await expect(sayfa).toBeVisible();
    await sigdi(page, sayfa);
    for (const ad of [...ODA_ADLARI, ODA_BILINMIYOR]) await expect(sayfa.getByRole('button', { name: ad, exact: true })).toHaveCount(1);
    const secenek = sayfa.getByRole('button', { name: ORNEK.label, exact: true });
    expect(await hedefAlti(secenek)).toBeGreaterThanOrEqual(await asgariHedef(page));
    expect(await horizontalOverflow(page), 'alt sayfa açıkken yatay taşma').toEqual([]);
    await secenek.click();
    await expect(sayfa).toBeHidden();

    const oda = ayrinti(page, ORNEK.label);
    const baslik = oda.getByRole('heading', { level: 2, name: ORNEK.label });
    await expect(baslik).toBeVisible();
    await expect(baslik).toBeFocused();
    await expect(odaListesi(page)).toHaveCount(0);
    await expect(oda.getByRole('button', { name: 'Listeye dön' })).toBeVisible();
    await expect(oda.getByRole('img', { name: 'Fotoğraf yok' })).toBeVisible();

    // Plan ve gerçek iki ayrı değer; tek sayıda birleşmez.
    const tutarlar = oda.getByRole('group', { name: 'Tutarlar' });
    await expect(tutarlar.getByText('Planlanan', { exact: true })).toBeVisible();
    await expect(tutarlar.getByText(ORNEK_PLAN, { exact: true })).toBeVisible();
    await expect(tutarlar.getByText('Gerçekleşen', { exact: true })).toBeVisible();
    await expect(tutarlar.getByText(ORNEK_GERCEK, { exact: true })).toBeVisible();

    // Alımlar sekmesi varsayılan: odanın canlı alımları akordeonda, ilk satır açık.
    await expect(oda.getByRole('tab', { name: 'Alımlar' })).toHaveAttribute('aria-selected', 'true');
    const alimlar = oda.getByRole('region', { name: 'Alımlar' });
    for (const ad of sirayla(ornekAlim.map(k => k.label))) await expect(alimlar.getByRole('button', { name: new RegExp(`^${ad}`) })).toHaveCount(1);
    await expect(alimlar.locator('button[aria-expanded]').first()).toHaveAttribute('aria-expanded', 'true');
    await expect(main(page).getByRole('table')).toHaveCount(0);

    await oda.getByRole('tab', { name: 'İşler' }).click();
    const isler = oda.getByRole('region', { name: 'İşler' });
    for (const ad of ornekIs.map(k => k.label)) await expect(isler.getByRole('button', { name: new RegExp(`^${ad}`) })).toHaveCount(1);
    await expect(oda.getByRole('region', { name: 'Alımlar' })).toHaveCount(0);

    await oda.getByRole('tab', { name: 'Eşyalar' }).click();
    for (const ad of ornekEsya.map(k => k.label)) await expect(oda.getByRole('region', { name: 'Eşyalar' }).getByRole('button', { name: new RegExp(`^${ad}`) })).toHaveCount(1);
    await oda.getByRole('tab', { name: 'Aydınlatma' }).click();
    for (const ad of ornekArmatur.map(k => k.label)) await expect(oda.getByRole('region', { name: 'Aydınlatma' }).getByRole('button', { name: new RegExp(`^${ad}`) })).toHaveCount(1);

    await temizDuzen(page, 'oda ayrıntısı');

    await oda.getByRole('button', { name: 'Listeye dön' }).click();
    const liste = odaListesi(page);
    await expect(liste).toBeVisible();
    const satir = liste.getByRole('button', { name: new RegExp(`^${ORNEK.label}`) });
    await expect(satir).toBeFocused();
    await expect(satir).toHaveAttribute('aria-expanded', 'true');
    expect(genisIstekleri(yollar), 'telefon geniş modül istememeli').toEqual([]);
  });

  test('kaba girişte (dokunma) ana eylem "Oda seç" en az 48 px hedeftir', async ({ page }) => {
    await openAdmin(page, '/ev');
    test.skip(await profil(page) !== 'phone', 'telefon profili yolculuğu');
    test.skip((await page.locator('html').getAttribute('data-input-coarse')) === null, 'kaba giriş katmanı kapalı');
    expect(await hedefAlti(main(page).getByRole('button', { name: 'Oda seç' }))).toBeGreaterThanOrEqual(48);
  });

  test('klavye: Oda seç alt sayfası odağı içeri alır, Escape kapatır ve odak düğmeye döner; çevreleyen halka yok', async ({ page, browserName }) => {
    await openAdmin(page, '/ev');
    test.skip(await profil(page) !== 'phone', 'telefon profili yolculuğu');
    const odaSec = main(page).getByRole('button', { name: 'Oda seç' });
    await enterKeyboardMode(page, browserName);
    for (let i = 0; i < 40 && !(await odaSec.evaluate(el => el === document.activeElement)); i += 1) await page.keyboard.press(tabKey(browserName));
    await expect(odaSec).toBeFocused();
    expect(await focusRing(page), 'Oda seç odak göstergesi').toEqual([]);

    await page.keyboard.press('Enter');
    const sayfa = secici(page);
    await expect(sayfa).toBeVisible();
    await expect.poll(() => sayfa.evaluate(el => el.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(sayfa).toBeHidden();
    await expect(odaSec).toBeFocused();
  });
});

// --- Matris: kısa yükseklik, 360/375/390, yatay telefon (telefon profili) ve geniş profiller --------------------
test.describe('Ev ve odalar › matris', () => {
  test('telefon profili: taşma yok, alt sayfa görünüm alanına sığar ve son oda seçilebilir', { tag: '@matrix' }, async ({ page }) => {
    await openAdmin(page, '/ev');
    test.skip(await profil(page) !== 'phone', 'yalnız telefon profili');
    await expect(main(page).getByRole('table')).toHaveCount(0);
    await expect(odaListesi(page)).toBeVisible();
    await temizDuzen(page, 'liste');

    const odaSec = main(page).getByRole('button', { name: 'Oda seç' });
    await odaSec.scrollIntoViewIfNeeded();
    await expect(odaSec).toBeInViewport();
    await odaSec.click();
    const sayfa = secici(page);
    await expect(sayfa).toBeVisible();
    await sigdi(page, sayfa);
    const son = sayfa.getByRole('button', { name: ODA_BILINMIYOR, exact: true });
    await son.scrollIntoViewIfNeeded();
    await expect(son).toBeInViewport();
    await son.click();
    await expect(ayrinti(page, ODA_BILINMIYOR).getByRole('heading', { level: 2, name: ODA_BILINMIYOR })).toBeFocused();
    const alimlar = ayrinti(page, ODA_BILINMIYOR).getByRole('region', { name: 'Alımlar' });
    for (const ad of sirayla(ODASIZ.map(k => k.label))) await expect(alimlar.getByRole('button', { name: new RegExp(`^${ad}`) })).toHaveCount(1);
    await temizDuzen(page, 'odasız ayrıntı');
  });

  test('geniş profil: masaüstünde oda tablosu ve 384 px yan ayrıntı (iki bölme), tablette sığmayan tablo akordeon ve tam sayfa ayrıntı; geniş modül yalnız burada', { tag: '@matrix' }, async ({ page }) => {
    const yollar = istekKaydi(page);
    await openAdmin(page, '/ev');
    const p = await profil(page);
    test.skip(p === 'phone', 'yalnız geniş profil');

    await expect(main(page).getByRole('button', { name: 'Oda seç' })).toHaveCount(0);
    const liste = odaListesiVeyaTablo(page);
    await expect(liste).toBeVisible();
    await expect.poll(() => yollar.some(yol => EV_GENIS.test(yol)), { message: 'geniş profil ev geniş modülünü yükler' }).toBe(true);
    for (const ad of [...ODA_ADLARI, ODA_BILINMIYOR]) await expect(liste.getByText(ad, { exact: true })).toBeVisible();
    await temizDuzen(page, 'geniş liste');

    const tablo = main(page).getByRole('table', { name: 'Odalar' });
    // Masaüstünde oda tablosu her zaman sığar; tablette ResponsiveTable alan dar ise akordeona geçer (README: sığıyorsa tablo).
    if (p === 'desktop') await expect(tablo).toBeVisible();
    if (await tablo.count()) {
      await tablo.getByText(ORNEK.label, { exact: true }).click();
    } else {
      const satir = odaListesi(page).getByRole('button', { name: new RegExp(`^${ORNEK.label}`) });
      if ((await satir.getAttribute('aria-expanded')) === 'false') await satir.click();
      const odayiAc = odaListesi(page).locator(`#${await satir.getAttribute('aria-controls')}`).getByRole('button', { name: 'Odayı aç' });
      await hareketBitsin(odayiAc);
      await odayiAc.click();
    }
    const oda = ayrinti(page, ORNEK.label);
    await expect(oda.getByRole('heading', { level: 2, name: ORNEK.label })).toBeVisible();
    const tutarlar = oda.getByRole('group', { name: 'Tutarlar' });
    await expect(tutarlar.getByText(ORNEK_PLAN, { exact: true })).toBeVisible();
    await expect(tutarlar.getByText(ORNEK_GERCEK, { exact: true })).toBeVisible();
    await temizDuzen(page, 'geniş ayrıntı');

    if (await tablo.isVisible()) {
      // İki bölme: liste solda kalır, ayrıntı sağda ayrinti-genislik (384 px).
      const panel = (await oda.boundingBox())!;
      const solda = (await tablo.boundingBox())!;
      expect(Math.round(panel.width)).toBe(384);
      expect(panel.x).toBeGreaterThanOrEqual(solda.x + solda.width);
      await oda.getByRole('button', { name: 'Ayrıntıyı kapat' }).click();
      await expect(oda).toHaveCount(0);
      await expect(tablo).toBeVisible();
      await expect(tablo.locator('tr', { hasText: ORNEK.label })).toBeFocused();
    } else {
      expect(p, 'masaüstünde (geniş alan) iki bölme beklenir').toBe('tablet');
      await expect(oda.getByRole('heading', { level: 2, name: ORNEK.label })).toBeFocused();
      await oda.getByRole('button', { name: 'Listeye dön' }).click();
      await expect(odaListesiVeyaTablo(page)).toBeVisible();
    }
    await temizDuzen(page, 'geniş ayrıntı sonrası');
  });
});

// --- Veri durumları (yükleniyor, hata, boş, eski veri) ---------------------------------------------------------------
test.describe('Ev ve odalar › veri durumları', () => {
  test('yükleniyor: aynı yerde iskelet (aria-busy), sonra odalar', async ({ page }) => {
    let birak!: () => void;
    const kapi = new Promise<void>(resolve => { birak = resolve; });
    await page.route('**/__aile/generation/**', async route => { await kapi; await route.fallback(); });
    await gotoAdmin(page, '/ev');
    await expect(main(page).getByRole('heading', { level: 1, name: 'Ev ve odalar' })).toBeVisible();
    await expect(main(page).locator('[aria-busy="true"]').first()).toBeVisible();
    await expect(main(page).getByText(ORNEK_PLAN, { exact: true })).toHaveCount(0);
    birak();
    await expect(main(page).locator('[aria-busy="true"]')).toHaveCount(0);
    await expect(main(page).getByText(ORNEK.label, { exact: true }).first()).toBeVisible();
  });

  test('hata: "Hata:" ile başlayan uyarı ve Yeniden dene; tutar gösterilmez', async ({ page }) => {
    await page.route('**/__aile/generation/**', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Nesil yok"}' }));
    await gotoAdmin(page, '/ev');
    const uyari = main(page).getByRole('alert');
    await expect(uyari).toBeVisible();
    await expect(uyari).toContainText(/^Hata: /);
    await expect(uyari.getByRole('button', { name: 'Yeniden dene' })).toBeVisible();
    await expect(main(page).getByText('₺', { exact: false })).toHaveCount(0);
    expect(await horizontalOverflow(page)).toEqual([]);
  });

  test('boş: nesilde oda yoksa "Kaynakta oda kaydı yok" ve odasız alım sayısı adıyla', async ({ page }) => {
    await page.route('**/__aile/generation/manifest.json', async route => {
      const manifest = JSON.parse(readFileSync(path.join(GENERATION_DIR, 'manifest.json'), 'utf8')) as { counts: Record<string, number>; files: { collection?: string }[] };
      delete manifest.counts.rooms;
      manifest.files = manifest.files.filter(file => file.collection !== 'rooms');
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(manifest) });
    });
    await openAdmin(page, '/ev');
    const bos = main(page).getByRole('status').filter({ has: page.getByRole('heading', { level: 2, name: 'Kaynakta oda kaydı yok' }) });
    await expect(bos).toBeVisible();
    await expect(bos).toContainText(`${ALIMLAR.length} alım`);
    await expect(main(page).getByRole('table')).toHaveCount(0);
    await expect(main(page).getByRole('button', { name: 'Oda seç' })).toHaveCount(0);
  });

  test('eski veri: yenileme başarısızsa son başarılı nesil kalır ve tazelik satırı "yenilenemedi" der', async ({ page }) => {
    let bozuk = false;
    await page.route('**/__aile/generation/**', route => (bozuk
      ? route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Nesil yok"}' })
      : route.fallback()));
    await openAdmin(page, '/ev');
    await expect(odaListesiVeyaTablo(page)).toBeVisible();
    bozuk = true;
    await main(page).getByRole('button', { name: 'Yenile' }).click();
    await expect(main(page).getByText('yenilenemedi')).toBeVisible();
    await expect(main(page).getByRole('button', { name: 'Yeniden dene' })).toBeVisible();
    await expect(odaListesiVeyaTablo(page)).toBeVisible();
    await expect(main(page).getByText(ORNEK.label, { exact: true }).first()).toBeVisible();
    await expect(main(page).getByRole('alert')).toHaveCount(0);
  });
});

function odaListesiVeyaTablo(page: Page): Locator {
  return odaListesi(page).or(main(page).getByRole('table', { name: 'Odalar' }));
}

// --- Telefon teslimi: antd / echarts istenmez (W0 sözleşmesi) ---------------------------------------------------
test('telefon profili antd, @ant-design ve echarts paketlerini istemez', async ({ page }) => {
  const yollar = istekKaydi(page);
  await openAdmin(page, '/ev');
  test.skip(await profil(page) !== 'phone', 'yalnız telefon profili');
  const odayiAc = main(page).getByRole('button', { name: 'Odayı aç' }).first();
  await hareketBitsin(odayiAc);
  await odayiAc.click();
  await expect(main(page).getByRole('button', { name: 'Listeye dön' })).toBeVisible();
  const yasak = yollar.filter(yol => /\/deps\/(antd|@ant-design|@rc-component|rc-[a-z-]+|echarts|zrender)[^/]*\.js$/.test(yol));
  expect(yasak, 'telefon yolunda yasak paket istekleri').toEqual([]);
});
