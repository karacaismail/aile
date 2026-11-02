import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { ADMIN_MAIN, gotoAdmin, horizontalOverflow, openAdmin } from './admin-helpers';
import { smallText } from './admin-detectors';

// Ödemeler — kritik kullanıcı yolculuğu, telefon önce (W0 uyarlamalı teslim sözleşmesi).
// Tasarım: aile-tasarim › tasarim-sistemi/README.md (Sayfa iskeleti, Veri durumları, Uyarlanır teslim), ekranlar.md
// (SayfaOdemeler · SayfaOdemelerDar), bundle.js Aile.Pages.Odemeler.
// Veri gerçeği: nesilde `payments` koleksiyonu yok (contract.ts: "payments / providers nesilde YOK"). Sayfa bunu adıyla
// söyler ("Kaynakta ödeme kaydı yok") ve bütçe tahmin olaylarını (forecast_events) tahmini ödeme olarak listeler; bir tahmin
// olayı hiçbir yerde ödeme gibi görünmez: "Ödendi" ya da "Gecikti" yazılmaz, gerçekleşen "Ödeme kaydı yok" der.
// Telefon (320×568 önce): başlık + amaç + ana eylem ilk ekranda; tarih gruplu akordeon liste (ilk satır açık), ilk ekranda
// 10 satır ve "daha fazla göster"; filtre alt sayfada; sayfa yatay taşmaz; geniş modül (*.wide) indirilmez.
// Geniş (tablet/masaüstü): tablo ve zaman çizelgesi pages/odemeler/*.wide.tsx içinde lazyWide ile gelir.
// Veri: dev sunucusu sentetik nesli (fixtures/generation-synthetic) sunar; büyük liste, boş kaynak, hata ve eski veri
// durumları page.route ile sentetik olarak türetilir. Saat sabit (02.11.2026): ilk olay 01.11.2026 tarihi geçmiştir.
// Seçiciler role/label; @matrix etiketli test entegrasyonda 360/375/320×480/568×320/tablet/masaüstü projelerinde koşar.

const BUGUN = new Date('2026-11-02T10:00:00+03:00');
const TELEFON = { width: 320, height: 568 } as const;
const MASAUSTU = { width: 1440, height: 900 } as const;
const AMAC = 'Planlanan, yapılan ve geciken ödemeleri tarihleriyle izleyin.';
const KAYNAKTA_ODEME_YOK = 'Kaynakta ödeme kaydı yok';
const LISTE = 'Tahmini ödemeler';
const ILK_SAYFA = 10;
/** Dev sunucusunda geniş modül isteği (…/X.wide.tsx) ya da üretimde wide-*.js parçası. */
const GENIS_MODUL = /\.wide\.tsx(?:[?#]|$)|\/wide-[\w-]+\.js(?:[?#]|$)/;
/** Telefon profilinin istememesi gereken paketler (Vite ön paketleri ya da üretim parçaları). */
const ANTD_ECHARTS = /\/\.vite\/deps\/(?:antd|@ant-design|echarts|zrender)[^/]*\.js|\/assets\/(?:antd|pro|echarts)-[\w-]+\.js/;

// --- Sentetik nesil ----------------------------------------------------------------------------------------------
const FIXTURE_ROOT = fileURLToPath(new URL('../fixtures/generation-synthetic/', import.meta.url));
const GENERATION_ID = readdirSync(FIXTURE_ROOT).find(name => /^[a-f0-9]{64}$/.test(name) && statSync(path.join(FIXTURE_ROOT, name)).isDirectory())!;
const GENERATION_DIR = path.join(FIXTURE_ROOT, GENERATION_ID);
const okuJson = <T>(rel: string): T => JSON.parse(readFileSync(path.join(GENERATION_DIR, rel), 'utf8')) as T;

interface ManifestFile { path: string; kind: string; sha256: string; bytes: number; collection?: string; count?: number }
interface Manifest { files: ManifestFile[]; counts: Record<string, number>; [key: string]: unknown }
interface OlayKaydi { id: string; label: string; occurred_on: string; [key: string]: unknown }

const MANIFEST = okuJson<Manifest>('manifest.json');
const ILK_OLAY = okuJson<{ records: OlayKaydi[] }>('data/forecast_events/budget/2026-11/00000.json').records[0]!;
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/** forecast_events dosyaları düşürülmüş manifest: koleksiyon nesilde yok. */
function manifestTahminsiz(): string {
  const manifest: Manifest = structuredClone(MANIFEST);
  manifest.files = manifest.files.filter(file => file.collection !== 'forecast_events');
  manifest.counts = { ...manifest.counts, forecast_events: 0 };
  return JSON.stringify(manifest);
}

/** `adet` sentetik tahmin olayı (02.10.2026'dan başlayarak her gün bir olay) tek parçada; gerçek veri değildir. */
function genisNesil(adet: number): { manifest: string; parca: string; yol: string } {
  const yol = 'data/forecast_events/budget/sentetik-genis/00000.json';
  const baslangic = Date.UTC(2026, 9, 2);
  const records = Array.from({ length: adet }, (_, i) => {
    const gun = new Date(baslangic + i * 86_400_000).toISOString().slice(0, 10);
    const tutar = `${1000 + ((i * 37) % 90) * 100}.00`;
    return {
      ...ILK_OLAY,
      id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
      label: `Sentetik tahmin ${i + 1}`,
      source_record_id: `sentetik-${i + 1}`,
      occurred_on: gun,
      certainty: i % 3 === 0 ? 'estimated' : 'planned',
      event_type: ['purchase', 'payment', 'fee', 'repayment'][i % 4],
      cash_change: { amount: tutar, currency: 'TRY' },
      measures: { planned: { amount: tutar, currency: 'TRY' } },
    };
  });
  const parca = JSON.stringify({ collection: 'forecast_events', records, schemaVersion: 1 });
  const manifest: Manifest = structuredClone(MANIFEST);
  manifest.files = [
    ...manifest.files.filter(file => file.collection !== 'forecast_events'),
    { path: yol, kind: 'partition', collection: 'forecast_events', count: adet, bytes: Buffer.byteLength(parca), sha256: sha256(parca) },
  ];
  manifest.counts = { ...manifest.counts, forecast_events: adet };
  return { manifest: JSON.stringify(manifest), parca, yol };
}

const MANIFEST_YOLU = '**/__aile/generation/manifest.json';
const jsonYanit = (body: string) => ({ status: 200, contentType: 'application/json; charset=utf-8', body });

// --- Yardımcılar -------------------------------------------------------------------------------------------------

/** Sayfanın yaptığı istekleri biriktirir (ağ kanıtı: telefon geniş modülü ve antd'yi istemez). */
function istekKaydi(page: Page): string[] {
  const urls: string[] = [];
  page.on('request', request => urls.push(request.url()));
  return urls;
}

async function hazirla(page: Page, boyut: { width: number; height: number } | null = TELEFON) {
  await page.clock.setFixedTime(BUGUN);
  if (boyut) await page.setViewportSize(boyut);
  // Ağa çıkılmaz: Google (GViz) istekleri kesilir.
  await page.route(/^https:\/\/(?:docs|sheets)\.google\.com\//, route => route.abort());
}

const liste = (page: Page) => page.getByRole('region', { name: LISTE });
const satirlar = (alan: Locator) => alan.locator('button[aria-expanded]');
/** AccordionList grup başlığının ilk metin düğümü (sayım rozeti hariç). */
const grupAdlari = (alan: Locator) =>
  alan.getByRole('heading', { level: 3 }).evaluateAll(basliklar => basliklar.map(baslik => baslik.firstChild?.textContent?.trim() ?? ''));

/** Öğe ilk ekranda (kaydırmadan) tamamen görünür mü: üst ≥ 0 ve alt ≤ görünüm alanı yüksekliği. */
async function ilkEkranda(page: Page, oge: Locator) {
  await expect(oge).toBeVisible();
  const kutu = await oge.boundingBox();
  const yukseklik = page.viewportSize()!.height;
  expect(kutu, 'kutu ölçülemedi').not.toBeNull();
  expect(kutu!.y, 'öğe görünür alanın üstünde').toBeGreaterThanOrEqual(0);
  expect(kutu!.y + kutu!.height, `öğe ilk ekranın altında (alt ${Math.round(kutu!.y + kutu!.height)} > ${yukseklik})`).toBeLessThanOrEqual(yukseklik + 0.5);
}

/** Görünen ₺ tutarları tutar stilinde mi (README: ₺8.500,00, tabular-nums)? Dönüş: tabular olmayan tutar metinleri. */
const tabularOlmayanTutarlar = (page: Page) =>
  page.locator(ADMIN_MAIN).evaluate(kok => {
    const out: string[] = [];
    const walker = document.createTreeWalker(kok, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const metin = node.textContent ?? '';
      if (!/₺\s?\d/.test(metin)) continue;
      const ust = node.parentElement;
      if (!ust || (typeof ust.checkVisibility === 'function' && !ust.checkVisibility())) continue;
      if (!getComputedStyle(ust).fontVariantNumeric.includes('tabular-nums')) out.push(metin.trim());
    }
    return out;
  });

/** Telefon profili: genişlik < 600 ya da kısa kenar < 480 (src/admin/adaptive/profile.ts). */
const telefonProfili = ({ width, height }: { width: number; height: number }) => width < 600 || Math.min(width, height) < 480;

// --- Telefon 320×568: kritik yolculuk ---------------------------------------------------------------------------

test.describe('Ödemeler telefon 320×568', () => {
  test('başlık, amaç ve ana eylem ilk ekranda; kaynakta ödeme kaydı olmadığı adıyla söylenir; geniş modül indirilmez', async ({ page }) => {
    const istekler = istekKaydi(page);
    await hazirla(page);
    const main = await openAdmin(page, '/odemeler');

    await ilkEkranda(page, main.getByRole('heading', { level: 1, name: 'Ödemeler' }));
    await ilkEkranda(page, main.getByText(AMAC, { exact: true }));
    const birincil = main.getByRole('button', { name: 'Ödeme kaydet' });
    await ilkEkranda(page, birincil);
    // Yazma yolu yok: ana eylem gerekçesiyle devre dışı; gerekçe görünür ve erişilebilir açıklamadır.
    await expect(birincil).toBeDisabled();
    await expect(birincil).toHaveAccessibleDescription(new RegExp(KAYNAKTA_ODEME_YOK));
    await expect(main.getByText(`${KAYNAKTA_ODEME_YOK}.`, { exact: true }).first()).toBeVisible();

    // Özet: plan ve gerçek ayrı ölçüler; yapılan ödeme bilinmiyor.
    const ozet = main.getByRole('list', { name: 'Özet' });
    await expect(ozet.getByRole('listitem')).toHaveCount(3);
    await expect(ozet.getByRole('listitem').nth(0)).toContainText('Tarihi geçen (plan)');
    await expect(ozet.getByRole('listitem').nth(0)).toContainText('₺16.600,00');
    await expect(ozet.getByRole('listitem').nth(1)).toContainText('Sıradaki (plan)');
    await expect(ozet.getByRole('listitem').nth(1)).toContainText('₺15.400,00');
    await expect(ozet.getByRole('listitem').nth(1)).toContainText('08.12.2026');
    await expect(ozet.getByRole('listitem').nth(2)).toContainText('Yapılan (gerçek)');
    await expect(ozet.getByRole('listitem').nth(2)).toContainText('Bilinmiyor');

    // Tahmin olayı ödeme gibi görünmez.
    await expect(liste(page)).toBeVisible();
    await expect(main).not.toContainText('Ödendi');
    await expect(main).not.toContainText('Gecikti');

    expect(await horizontalOverflow(page), 'belge düzeyinde yatay taşma').toEqual([]);
    expect(await smallText(page, { root: ADMIN_MAIN }), '14 px alt sınır').toEqual([]);
    expect(await tabularOlmayanTutarlar(page), 'tutar tabular-nums').toEqual([]);
    expect(istekler.filter(url => GENIS_MODUL.test(url)), 'telefon geniş modül indirdi').toEqual([]);
  });

  test('tarih gruplu liste: tarihi geçen üstte, ilk satır açık, ilk ekranda 10 satır; daha fazla göster odağı yeni satıra taşır', async ({ page }) => {
    await hazirla(page);
    await openAdmin(page, '/odemeler');
    const alan = liste(page);
    await expect(alan.getByRole('heading', { level: 2, name: LISTE })).toBeVisible();

    await expect(satirlar(alan)).toHaveCount(ILK_SAYFA);
    await expect(alan.getByText('Gösterilen 10 / 20')).toBeVisible();
    expect(await grupAdlari(alan)).toEqual([
      'Tarihi geçenler', 'Aralık 2026', 'Ocak 2027', 'Şubat 2027', 'Mart 2027', 'Mayıs 2027', 'Haziran 2027', 'Temmuz 2027',
      'Ağustos 2027', 'Eylül 2027',
    ]);

    const ilk = satirlar(alan).first();
    await expect(ilk).toHaveAttribute('aria-expanded', 'true');
    await expect(ilk).toContainText('Örnek tahmin olayı 1');
    await expect(ilk).toContainText('01.11.2026');
    await expect(ilk).toContainText('Tarihi geçti · 1 gün');
    await expect(alan.locator('button[aria-expanded="true"]')).toHaveCount(1);
    const panel = page.locator(`[id="${await ilk.getAttribute('aria-controls')}"]`);
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('Planlanan');
    await expect(panel).toContainText('₺16.600,00');
    await expect(panel).toContainText('Gerçekleşen');
    await expect(panel).toContainText('Ödeme kaydı yok');

    const dahaFazla = alan.getByRole('button', { name: '10 tahmini ödeme daha göster' });
    await dahaFazla.click();
    await expect(satirlar(alan)).toHaveCount(20);
    await expect(alan.getByText('Gösterilen 20 / 20')).toBeVisible();
    await expect(dahaFazla).toHaveCount(0);
    // Odak yeni gelen ilk satırda (11. satır); düğme kalktığı için odak kaybolmaz.
    await expect(satirlar(alan).nth(ILK_SAYFA)).toBeFocused();
    await expect(satirlar(alan).nth(ILK_SAYFA)).toContainText('Örnek tahmin olayı 11');
    expect(await horizontalOverflow(page)).toEqual([]);
  });

  test('filtre alt sayfada: durum seçimi sonucu daraltır; boş sonuç filtreleri adıyla yazar ve temizler', async ({ page }) => {
    await hazirla(page);
    const main = await openAdmin(page, '/odemeler');

    await main.getByRole('button', { name: /^Filtreler/ }).click();
    const filtre = page.getByRole('dialog', { name: /^Filtreler/ });
    await expect(filtre).toBeVisible();
    await filtre.getByRole('checkbox', { name: /Tarihi geçti/ }).check();
    await filtre.getByRole('button', { name: '1 sonucu göster' }).click();
    await expect(filtre).toBeHidden();

    const alan = liste(page);
    await expect(satirlar(alan)).toHaveCount(1);
    await expect(main.getByRole('button', { name: /Durum: Tarihi geçti/ }).first()).toBeVisible();

    await main.getByRole('searchbox', { name: 'Ara' }).fill('olmayan ödeme');
    const bos = main.getByRole('heading', { level: 2, name: 'Bu filtrelerle kayıt yok' });
    await expect(bos).toBeVisible();
    await expect(liste(page)).toHaveCount(0);
    await main.getByRole('button', { name: 'Filtreleri temizle' }).click();
    await expect(satirlar(liste(page))).toHaveCount(ILK_SAYFA);
    await expect(main.getByRole('searchbox', { name: 'Ara' })).toHaveValue('');
  });

  test('sıralama alt sayfada: tutara göre zaman kovaları içinde büyükten küçüğe', async ({ page }) => {
    await hazirla(page);
    const main = await openAdmin(page, '/odemeler');
    await main.getByRole('combobox', { name: 'Sıralama' }).click();
    await page.getByRole('option', { name: 'Tutara göre' }).click();
    const alan = liste(page);
    await expect.poll(() => grupAdlari(alan)).toEqual(['Tarihi geçenler', 'Sonra']);
    await expect(satirlar(alan).nth(1)).toContainText('Örnek tahmin olayı 7');
    await expect(satirlar(alan).nth(1)).toContainText('₺28.600,00');
  });

  test('büyük liste (300 sentetik olay): ilk ekranda 10 satır, sayfa metni sınırlı; daha fazla göster 10 ekler', async ({ page }) => {
    const nesil = genisNesil(300);
    await page.route(MANIFEST_YOLU, route => route.fulfill(jsonYanit(nesil.manifest)));
    await page.route(`**/__aile/generation/${nesil.yol}`, route => route.fulfill(jsonYanit(nesil.parca)));
    await hazirla(page);
    const main = await openAdmin(page, '/odemeler');
    const alan = liste(page);
    await expect(satirlar(alan)).toHaveCount(ILK_SAYFA);
    await expect(alan.getByText('Gösterilen 10 / 300')).toBeVisible();
    const metin = await main.evaluate(kok => ({ gorunen: (kok as HTMLElement).innerText.length, dom: (kok.textContent ?? '').length }));
    expect(metin.gorunen, `görünen metin ${metin.gorunen} karakter`).toBeLessThan(6000);
    expect(metin.dom, `DOM metni ${metin.dom} karakter`).toBeLessThan(10000);
    await alan.getByRole('button', { name: '10 tahmini ödeme daha göster' }).click();
    await expect(satirlar(alan)).toHaveCount(20);
    await expect(alan.getByText('Gösterilen 20 / 300')).toBeVisible();
  });
});

// --- Veri durumları (telefon) -----------------------------------------------------------------------------------

test.describe('Ödemeler veri durumları', () => {
  test('yükleniyor: başlık ve iskelet; veri gelince liste', async ({ page }) => {
    let birak: () => void = () => {};
    const bekle = new Promise<void>(resolve => { birak = resolve; });
    await page.route(MANIFEST_YOLU, async route => {
      await bekle;
      await route.fallback();
    });
    await hazirla(page);
    await gotoAdmin(page, '/odemeler');
    const main = page.locator(ADMIN_MAIN);
    await expect(main.getByRole('heading', { level: 1, name: 'Ödemeler' })).toBeVisible();
    await expect(main.locator('[aria-busy="true"]').first()).toBeVisible();
    await expect(liste(page)).toHaveCount(0);
    birak();
    await expect(satirlar(liste(page))).toHaveCount(ILK_SAYFA);
  });

  test('kaynak boş: forecast_events yoksa "Kaynakta tahmini ödeme yok"; liste yok; ödeme kaydı yokluğu yine adıyla', async ({ page }) => {
    await page.route(MANIFEST_YOLU, route => route.fulfill(jsonYanit(manifestTahminsiz())));
    await hazirla(page);
    const main = await openAdmin(page, '/odemeler');
    await expect(main.getByRole('heading', { level: 2, name: 'Kaynakta tahmini ödeme yok' })).toBeVisible();
    await expect(liste(page)).toHaveCount(0);
    await expect(main.getByText(`${KAYNAKTA_ODEME_YOK}.`, { exact: true }).first()).toBeVisible();
  });

  test('hata: "Hata: …" ve "Yeniden dene"; tutar gösterilmez', async ({ page }) => {
    await page.route(MANIFEST_YOLU, route => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Sentetik hata"}' }));
    await hazirla(page);
    await gotoAdmin(page, '/odemeler');
    const main = page.locator(ADMIN_MAIN);
    const hata = main.getByRole('alert');
    await expect(hata).toBeVisible();
    await expect(hata.getByRole('heading', { level: 2 })).toHaveText(/^Hata: /);
    await expect(hata.getByRole('button', { name: 'Yeniden dene' })).toBeVisible();
    await expect(main).not.toContainText('₺');
    await expect(liste(page)).toHaveCount(0);
  });

  test('eski veri: yenileme başarısızsa son başarılı liste kalır ve tazelik satırı "yenilenemedi" der', async ({ page }) => {
    await hazirla(page);
    const main = await openAdmin(page, '/odemeler');
    await expect(satirlar(liste(page))).toHaveCount(ILK_SAYFA);
    await page.route(MANIFEST_YOLU, route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Sentetik kesinti"}' }));
    await main.getByRole('button', { name: 'Yenile' }).click();
    await expect(main.getByRole('status').filter({ hasText: 'yenilenemedi' })).toBeVisible();
    await expect(satirlar(liste(page))).toHaveCount(ILK_SAYFA);
    await expect(main.getByRole('button', { name: 'Yeniden dene' }).first()).toBeVisible();
  });
});

// --- Geniş: tablo ve zaman çizelgesi lazyWide ile ----------------------------------------------------------------

test.describe('Ödemeler geniş görünüm', () => {
  test('1440: tablo geniş modülden gelir; tarihi geçen üstte; zaman çizelgesi; telefona daralınca arama korunur', async ({ page }) => {
    const istekler = istekKaydi(page);
    await hazirla(page, MASAUSTU);
    const main = await openAdmin(page, '/odemeler');
    const tablo = main.getByRole('table', { name: LISTE });
    await expect(tablo).toBeVisible();
    expect(istekler.some(url => /pages\/odemeler\/[^/]*\.wide\.tsx/.test(url) || /\/wide-[\w-]+\.js/.test(url)), 'geniş modül istenmedi').toBe(true);

    const basliklar = await main.getByRole('columnheader').allTextContents();
    expect(basliklar.map(metin => metin.trim())).toEqual(expect.arrayContaining(['Tarih', 'Ödeme', 'Planlanan', 'Gerçekleşen', 'Durum']));
    const ilkSatir = main.getByRole('row').filter({ has: page.getByRole('cell') }).first();
    await expect(ilkSatir).toContainText('01.11.2026');
    await expect(ilkSatir).toContainText('Tarihi geçti · 1 gün');
    await expect(ilkSatir).toContainText('Ödeme kaydı yok');
    await expect(main).not.toContainText('Ödendi');
    expect(await tabularOlmayanTutarlar(page), 'tutar tabular-nums (tablo)').toEqual([]);

    await main.getByText('Zaman çizelgesi', { exact: true }).first().click();
    await expect(main.getByRole('region', { name: 'Kasım 2026 1 kayıt' })).toBeVisible();
    await expect(tablo).toHaveCount(0);

    await main.getByRole('searchbox', { name: 'Ara' }).fill('olay-7');
    await page.setViewportSize(TELEFON);
    const alan = liste(page);
    await expect(satirlar(alan)).toHaveCount(1);
    await expect(satirlar(alan).first()).toContainText('Örnek tahmin olayı 7');
    await expect(main.getByRole('searchbox', { name: 'Ara' })).toHaveValue('olay-7');
    expect(await horizontalOverflow(page)).toEqual([]);
  });
});

// --- Matris: proje görünüm alanına göre profil sözleşmesi --------------------------------------------------------

test('Ödemeler görünüm alanı sözleşmesi: başlık ve ana eylem ilk ekranda, taşma yok, profil doğru sunumu seçer', { tag: '@matrix' }, async ({ page }) => {
  const istekler = istekKaydi(page);
  await hazirla(page, null);
  const boyut = page.viewportSize()!;
  const main = await openAdmin(page, '/odemeler');

  await ilkEkranda(page, main.getByRole('heading', { level: 1, name: 'Ödemeler' }));
  await ilkEkranda(page, main.getByText(AMAC, { exact: true }));
  await ilkEkranda(page, main.getByRole('button', { name: 'Ödeme kaydet' }));
  await expect(main.getByText(`${KAYNAKTA_ODEME_YOK}.`, { exact: true }).first()).toBeVisible();

  // Tablonun tek yerleşim kancası her profilde var (telefon: akordeon; tablet: sığmaya göre; masaüstü: tablo).
  await expect(main.locator(':is([data-layout="table"], [data-layout="accordion"])')).toHaveCount(1);
  if (telefonProfili(boyut)) {
    const alan = liste(page);
    await expect(alan.locator('[data-layout="accordion"]')).toHaveCount(1);
    await expect(satirlar(alan)).toHaveCount(ILK_SAYFA);
    await expect(satirlar(alan).first()).toHaveAttribute('aria-expanded', 'true');
    expect(istekler.filter(url => GENIS_MODUL.test(url)), 'telefon geniş modül indirdi').toEqual([]);
  } else {
    expect(istekler.some(url => /pages\/odemeler\/[^/]*\.wide\.tsx/.test(url) || /\/wide-[\w-]+\.js/.test(url)), 'geniş modül istenmedi').toBe(true);
  }
  expect(await horizontalOverflow(page), 'belge düzeyinde yatay taşma').toEqual([]);
  expect(await smallText(page, { root: ADMIN_MAIN }), '14 px alt sınır').toEqual([]);
});

// --- Teslim sözleşmesi: telefon antd/echarts istemez (entegrasyon PHONE_WITHOUT_ANTD + ui görevleri) ---------------

test('telefon profili Ödemeler için antd, @ant-design ve echarts paketlerini istemez', async ({ page }) => {
  const istekler = istekKaydi(page);
  await hazirla(page);
  await openAdmin(page, '/odemeler');
  await expect(satirlar(liste(page))).toHaveCount(ILK_SAYFA);
  expect(istekler.filter(url => ANTD_ECHARTS.test(url)).map(url => new URL(url).pathname)).toEqual([]);
});
