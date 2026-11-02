import { readFileSync } from 'node:fs';
import { test, expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { accentEdges, overflow, smallText } from './admin-detectors';
import { gotoAdmin, horizontalOverflow, openAdmin } from './admin-helpers';

// Bütçe ve nakit — kritik telefon yolculuğu (tasarım: ekranlar.md SayfaButceDar, bundle.js Aile.Pages.Butce, README
// "Uyarlanır teslim"). Önce 320×568: başlık + amaç + ana eylem görünür, kalem kalem akordeon (ilk satır açık), Planlanan
// başlıkta, Gerçekleşen ve Fark gövdede ayrı etiketli; Gerçekleşen data/actuals.ts anlamıyla ("Kaynakta yazılı" kanıtsız
// değer, gelecek ay "Henüz yok"); Fark yalnız ödeme kanıtı olan Gerçekleşenle (ürün kararı r4; aksi "Hesaplanmadı"); dönem
// seçimi alttan açılan sayfa; başlık düzeyi atlanmaz; sayfa düzeyinde yatay taşma yok. Telefon aylık eğilimi (geniş-özel
// butce/ButceTrend.wide.tsx + ECharts) ne çizer ne indirir. "Dışa aktar" (telefonda "Diğer" alt sayfası) dosyayı iki
// motorda da indirir (blob bağlantısı indirme başlamadan bırakılmaz).
// @matrix testleri: 320×480, 360×640, 375×667, 390×844, 568×320 (yatay telefon telefon profilinde kalır) ve geniş
// (820×1180 tablet, 1440×900 masaüstü). Görev koşusunda (chromium 320×568, webkit 390×844) her boyut setViewportSize ile
// koşar; entegrasyondaki matris projelerinde her proje yalnız kendi boyutundaki testi koşar (çift koşu yok).
// Veri: dev sunucusu sentetik nesli sunar (AILE_GENERATION_DIR, playwright.admin.config.ts). Saat sabittir:
// 15.11.2026 09:00 İstanbul → içinde bulunulan dönem Kasım 2026; Aralık 2026 gelecektir. Canlı GViz (docs.google.com)
// isteği tarayıcıda kesilir: Google'a ağ çağrısı yok; sayfa bunu ikinci durum satırında "Hata: …" diye yazar.
// Seçiciler role/label ve bileşenlerin kendi data-layout / aria-* öznitelikleridir; antd iç sınıfı yok.

const SABIT_AN = new Date('2026-11-15T09:00:00+03:00');
const BASLIK = 'Bütçe ve nakit';
const AMAC = 'Ayın gelirini, planlanan giderlerini ve kalan nakdi kalem kalem izleyin.';
const BIRINCIL = 'Kalem ekle';
const KALEM_SAYISI = 8;
const BU_AY = 'Kasım 2026';
const GELECEK_AY = 'Aralık 2026';
const ILK_KALEM = 'Örnek gider satırı 1';
const RTABLE = ':is([data-layout="table"], [data-layout="accordion"], [data-layout="list"])';
/** Geniş-özel modül ve grafik motoru: telefon bunları istememeli (dev sunucusunda kaynak yolu / ön paket adı). */
const GENIS_ISTEK = /ButceTrend\.wide|Chart\.runtime|\/echarts|zrender/;

interface Boyut { width: number; height: number }
const TELEFON_MATRISI: readonly (Boyut & { ad: string })[] = [
  { ad: 'kısa yükseklik', width: 320, height: 480 },
  { ad: '360', width: 360, height: 640 },
  { ad: '375', width: 375, height: 667 },
  { ad: '390', width: 390, height: 844 },
  { ad: 'yatay telefon', width: 568, height: 320 },
];
const GENIS_MATRIS: readonly (Boyut & { ad: string; profil: 'tablet' | 'desktop' })[] = [
  { ad: 'tablet', width: 820, height: 1180, profil: 'tablet' },
  { ad: 'masaüstü', width: 1440, height: 900, profil: 'desktop' },
];

// --- Kurulum ---------------------------------------------------------------------------------------------------

/** Matris projesi (yalnız @matrix koşar) kendi görünüm boyutunu taşır; görev projeleri boyutu testte ayarlar. */
const matrisProjesi = (info: TestInfo) => String(info.project.grep).includes('@matrix');

/**
 * Boyutu uygular. Matris projesinde yalnız proje boyutu bu testin boyutuysa koşar (aksi atlanır: o boyut kendi
 * projesinde koşuyor). Görev projelerinde setViewportSize ile her boyut sırayla sınanır.
 */
async function boyutuKur(page: Page, info: TestInfo, boyut: Boyut) {
  if (matrisProjesi(info)) {
    const proje = info.project.use.viewport;
    test.skip(!proje || proje.width !== boyut.width || proje.height !== boyut.height, `bu boyut kendi matris projesinde koşar (${boyut.width}×${boyut.height})`);
    return;
  }
  await page.setViewportSize(boyut);
}

/** Sabit saat, canlı GViz kesintisi ve istek kaydı. Döner: o ana kadar istenen URL'ler (canlı liste). */
async function hazirla(page: Page): Promise<string[]> {
  await page.clock.setFixedTime(SABIT_AN);
  await page.route(/^https:\/\/docs\.google\.com\//, route => route.abort());
  const istekler: string[] = [];
  page.on('request', request => istekler.push(request.url()));
  return istekler;
}

async function butceyiAc(page: Page): Promise<Locator> {
  const main = await openAdmin(page, '/butce');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(BASLIK);
  return main;
}

const sayim = (page: Page, donem: string) => page.getByText(`${KALEM_SAYISI} kalem · ${donem}`, { exact: true });
const akordeon = (page: Page) => page.locator(RTABLE);
const basliklar = (alan: Locator) => alan.locator('button[aria-expanded]');
const govdesi = async (page: Page, baslik: Locator) => page.locator(`[id="${await baslik.getAttribute('aria-controls')}"]`);

/** Ortak sayfa kuralları: belge ve öğe düzeyinde yatay taşma yok, kesilen metin yok, 14 px alt sınır, kavisli şerit yok. */
async function ortakKurallar(page: Page, etiket: string) {
  expect(await horizontalOverflow(page), `${etiket}: yatay taşma`).toEqual([]);
  expect(await overflow(page), `${etiket}: taşma/kesme dedektörü`).toEqual([]);
  expect(await smallText(page), `${etiket}: 14 px alt sınır`).toEqual([]);
  expect(await accentEdges(page), `${etiket}: kavisli vurgu kenarı`).toEqual([]);
}

/** Görsel kanıt: görünüm alanının ekran görüntüsü rapora eklenir (karşılaştırma değil; inceleme içindir). */
async function kanit(page: Page, ad: string) {
  await test.info().attach(ad, { body: await page.screenshot(), contentType: 'image/png' });
}

/** Ana içerikte başlık düzeyleri sırayla iner: h1'den sonra h3 gibi atlama yok. Döner: atlanan geçişler. */
async function baslikAtlamalari(page: Page): Promise<string[]> {
  return page.locator('main').evaluate(main => {
    const levels = [...main.querySelectorAll('h1, h2, h3, h4, h5, h6')]
      .filter(heading => (heading as HTMLElement).offsetParent !== null || heading.getClientRects().length > 0)
      .map(heading => ({ level: Number(heading.tagName.slice(1)), text: (heading.textContent ?? '').trim().slice(0, 40) }));
    const skips: string[] = [];
    for (let i = 1; i < levels.length; i += 1) {
      if (levels[i]!.level - levels[i - 1]!.level > 1) skips.push(`h${levels[i - 1]!.level} "${levels[i - 1]!.text}" → h${levels[i]!.level} "${levels[i]!.text}"`);
    }
    return skips;
  });
}

/** Öğe görünümde ve üstünde başka katman yok (merkez noktası öğenin kendisine ya da içine düşer). */
async function ustuAcik(locator: Locator): Promise<boolean> {
  return locator.evaluate(element => {
    const kutu = element.getBoundingClientRect();
    const hedef = document.elementFromPoint(kutu.left + kutu.width / 2, kutu.top + kutu.height / 2);
    return Boolean(hedef && (hedef === element || element.contains(hedef)));
  });
}

/**
 * Telefon yolculuğu (her telefon boyutunda aynı kabul): başlık, amaç, ana eylem; akordeon; dönem alt sayfası; gelecek
 * ayda "Henüz yok"; taşma yok; geniş modül ve ECharts istenmez.
 */
async function telefonYolculugu(page: Page, istekler: string[], etiket: string) {
  await expect(page.locator('html')).toHaveAttribute('data-profile', 'phone');

  // 1. Başlık + amaç + ana eylem (devre dışı, nedeni yazılı). Kısa ekranda kaydırılarak erişilir, üstü kapalı değil.
  const h1 = page.getByRole('heading', { level: 1, name: BASLIK });
  await expect(h1).toBeInViewport();
  await expect(page.getByText(AMAC, { exact: true })).toBeVisible();
  const birincil = page.getByRole('button', { name: BIRINCIL });
  await expect(birincil).toBeVisible();
  await expect(birincil).toBeDisabled();
  await birincil.scrollIntoViewIfNeeded();
  await expect(birincil).toBeInViewport();
  expect(await ustuAcik(birincil), `${etiket}: ana eylemin üstü kapalı`).toBe(true);
  await expect(page.getByText("Bu dilimde kalem eklenmez; Sheets'e yazma yok.")).toBeVisible();

  // 2. Kalem kalem akordeon: tablo yok, ilk satır açık, Planlanan ve Gerçekleşen ayrı etiketler.
  await expect(sayim(page, BU_AY)).toBeVisible();
  const alan = akordeon(page);
  await expect(alan).toHaveAttribute('data-layout', 'accordion');
  await expect(page.getByRole('table', { name: 'Bütçe kalemleri' })).toHaveCount(0);
  const satirlar = basliklar(alan);
  await expect(satirlar).toHaveCount(KALEM_SAYISI);
  const ilk = satirlar.first();
  await expect(ilk).toHaveAttribute('aria-expanded', 'true');
  await expect(alan.locator('button[aria-expanded="true"]')).toHaveCount(1);
  await expect(ilk).toContainText(ILK_KALEM);
  await expect(ilk).toContainText('Kaynakta yazılı');
  // Kapalı satırda görülen tek tutar Planlanan'dır; plan − gerçek farkı başlıkta durmaz.
  await expect(ilk).toContainText(/Planlanan ₺/);
  await expect(ilk).not.toContainText('Fark');
  const ilkGovde = await govdesi(page, ilk);
  await expect(ilkGovde).not.toContainText('Planlanan');
  await expect(ilkGovde).toContainText('Gerçekleşen');
  await expect(ilkGovde).toContainText('₺');
  await expect(ilkGovde).toContainText('Kaynakta yazılı');
  // Kanıtsız Gerçekleşen harcama sayılmaz: Fark hesaplanmaz, "aşıldı" yorumu yok.
  await expect(ilkGovde).toContainText('FarkHesaplanmadı');
  await expect(ilkGovde).not.toContainText(/harcandı/);
  expect(await baslikAtlamalari(page), `${etiket}: başlık düzeyi atlanmaz`).toEqual([]);
  await ortakKurallar(page, `${etiket} ilk görünüm`);
  await kanit(page, `${etiket} ilk görünüm`);

  // 3. İkinci kalem dokunuşla açılır; ilki açık kalır.
  const ikinci = satirlar.nth(1);
  await ikinci.click();
  await expect(ikinci).toHaveAttribute('aria-expanded', 'true');
  await expect(ilk).toHaveAttribute('aria-expanded', 'true');

  // 4. Dönem seçimi alttan açılan sayfada: diyalog görünümün altına yaslı ve içine sığar; seçim akordeonu çevirir.
  const donem = page.getByRole('combobox', { name: 'Dönem' });
  await donem.scrollIntoViewIfNeeded();
  await donem.click();
  const sayfa = page.getByRole('dialog', { name: 'Dönem' });
  await expect(sayfa).toBeVisible();
  const gorunum = page.viewportSize()!;
  await expect
    .poll(async () => {
      const kutu = await sayfa.boundingBox();
      return kutu ? { alt: Math.round(kutu.y + kutu.height), ust: kutu.y >= -1 } : null;
    }, { message: `${etiket}: dönem sayfası alta yaslı ve görünüme sığar` })
    .toEqual({ alt: gorunum.height, ust: true });
  await expect(sayfa.getByRole('option', { name: BU_AY })).toHaveAttribute('aria-selected', 'true');
  await kanit(page, `${etiket} dönem alt sayfası`);
  await sayfa.getByRole('option', { name: GELECEK_AY }).click();
  await expect(sayfa).toBeHidden();
  await expect(sayim(page, GELECEK_AY)).toBeVisible();

  // 5. Gelecek ay: Gerçekleşen "Henüz yok", fark hesaplanmaz; kaynak değeri ve "Kaynakta yazılı" yazılmaz.
  const yeniIlk = basliklar(akordeon(page)).first();
  await expect(yeniIlk).toHaveAttribute('aria-expanded', 'true');
  await expect(yeniIlk).toContainText(/Planlanan ₺/);
  await expect(yeniIlk).toContainText('Henüz yok');
  const yeniGovde = await govdesi(page, yeniIlk);
  await expect(yeniGovde).toContainText('Gerçekleşen');
  await expect(yeniGovde).toContainText('Henüz yok');
  await expect(yeniGovde).toContainText('FarkHesaplanmadı');
  await expect(akordeon(page)).not.toContainText('Kaynakta yazılı');
  await ortakKurallar(page, `${etiket} gelecek ay`);
  await kanit(page, `${etiket} gelecek ay`);

  // 6. Teslim: telefon geniş-özel eğilimi ve ECharts'ı istemez; aylık eğilim bölgesi yok.
  await expect(page.getByRole('region', { name: 'Aylık eğilim' })).toHaveCount(0);
  expect(istekler.filter(url => GENIS_ISTEK.test(url)), `${etiket}: telefon geniş-özel kod istedi`).toEqual([]);
}

// --- 320×568 kritik yolculuk (görev projeleri) --------------------------------------------------------------------

test.describe('Bütçe telefon yolculuğu', () => {
  test('320×568: başlık + amaç + ana eylem, kalem kalem akordeon, dönem alt sayfası, gelecek ay "Henüz yok"', async ({ page }, testInfo) => {
    test.skip(matrisProjesi(testInfo), 'matris projeleri yalnız @matrix testlerini koşar');
    await page.setViewportSize({ width: 320, height: 568 });
    const istekler = await hazirla(page);
    await butceyiAc(page);
    await telefonYolculugu(page, istekler, '320×568');
    // Canlı Sheet ikinci durum satırı adıyla hata söyler; tutar yazmaz.
    // Neden d01'in sınıflanmış Türkçe metnidir; tarayıcının ham İngilizce hata metni gösterilmez.
    const canli = page.getByRole('region', { name: 'Canlı Sheet' });
    const canliDurum = canli.locator('[role="status"][data-state]');
    await expect(canliDurum).toHaveAttribute('data-state', 'error');
    await expect(canliDurum).toContainText("Hata: Sheets'e ulaşılamadı.");
    await expect(canli).not.toContainText(/Failed to fetch|Load failed|NetworkError|TypeError/);
    await expect(canli).not.toContainText('₺');
    await expect(canli.getByRole('button', { name: 'Yeniden dene' })).toBeVisible();
  });

  test('320×568 "Dışa aktar": "Diğer" alt sayfasından CSV iner (chromium ve webkit); BOM, başlık ve görünen satırlar; Fark kanıtsızda boş', async ({ page }, testInfo) => {
    test.skip(matrisProjesi(testInfo), 'matris projeleri yalnız @matrix testlerini koşar');
    await page.setViewportSize({ width: 320, height: 568 });
    await hazirla(page);
    await butceyiAc(page);
    await expect(sayim(page, BU_AY)).toBeVisible();
    await page.getByRole('button', { name: 'Diğer' }).click();
    const sayfa = page.getByRole('dialog', { name: 'Diğer eylemler' });
    await expect(sayfa).toBeVisible();
    const indirme = page.waitForEvent('download');
    await sayfa.getByRole('menuitem', { name: 'Dışa aktar' }).click();
    const dosya = await indirme;
    expect(dosya.suggestedFilename()).toBe('butce-2026-11.csv');
    // Blob bağlantısı indirme başlamadan bırakılsaydı WebKit dosyayı iptal ederdi: içerik okunabilmeli.
    const icerik = readFileSync((await dosya.path())!, 'utf8');
    expect(icerik.charCodeAt(0)).toBe(0xfeff);
    const satirlar = icerik.slice(1).split('\r\n');
    expect(satirlar[0]).toBe('Kalem;Dönem;Planlanan;Gerçekleşen;Fark;Para birimi;Durum;Tür');
    expect(satirlar).toHaveLength(1 + KALEM_SAYISI);
    const ilk = satirlar.find(satir => satir.startsWith(`${ILK_KALEM};`))!;
    expect(ilk).toMatch(/^Örnek gider satırı 1;2026-11;-?\d+(\.\d+)?;-?\d+(\.\d+)?;;TRY;Kaynakta yazılı;/);
    expect(satirlar.some(satir => /(^|;)"?[=+@]/.test(satir)), 'formül başlangıcı yok').toBe(false);
  });

  test('hata durumu: bütçe gözlemleri okunamazsa "Hata: …" ve "Yeniden dene"; tutar gösterilmez', async ({ page }, testInfo) => {
    test.skip(matrisProjesi(testInfo), 'matris projeleri yalnız @matrix testlerini koşar');
    await page.setViewportSize({ width: 320, height: 568 });
    await hazirla(page);
    await page.route('**/__aile/generation/**/budget_observations/**', route => route.fulfill({ status: 500, json: { error: 'Sunucu hatası' } }));
    await gotoAdmin(page, '/butce');
    const uyari = page.getByRole('alert');
    await expect(uyari).toContainText('Hata:');
    await expect(uyari.getByRole('button', { name: 'Yeniden dene' })).toBeVisible();
    await expect(page.locator('main')).not.toContainText('₺');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(BASLIK);
    expect(await horizontalOverflow(page)).toEqual([]);
  });
});

// --- Telefon matrisi (@matrix) -------------------------------------------------------------------------------------

test.describe('Bütçe telefon matrisi', () => {
  for (const boyut of TELEFON_MATRISI) {
    test(`${boyut.width}×${boyut.height} (${boyut.ad}): telefon profili, akordeon, dönem alt sayfası, taşma yok`, { tag: '@matrix' }, async ({ page }, testInfo) => {
      await boyutuKur(page, testInfo, boyut);
      const istekler = await hazirla(page);
      await butceyiAc(page);
      await telefonYolculugu(page, istekler, `${boyut.width}×${boyut.height}`);
    });
  }
});

// --- Geniş (@matrix): tablet ve masaüstü ek özellik olarak aylık eğilimi lazyWide ile alır -------------------------

test.describe('Bütçe geniş profil', () => {
  for (const boyut of GENIS_MATRIS) {
    test(`${boyut.width}×${boyut.height} (${boyut.ad}): plan ve gerçek ayrı sütunlar, aylık eğilim geniş modülden gelir`, { tag: '@matrix' }, async ({ page }, testInfo) => {
      await boyutuKur(page, testInfo, boyut);
      const istekler = await hazirla(page);
      await butceyiAc(page);
      await expect(page.locator('html')).toHaveAttribute('data-profile', boyut.profil);
      await expect(sayim(page, BU_AY)).toBeVisible();

      const egilim = page.getByRole('region', { name: 'Aylık eğilim' });
      await expect(egilim).toBeVisible();
      await expect(egilim.getByRole('heading', { level: 2 })).toHaveText(`${ILK_KALEM} · aylık eğilim`);
      const tablo = egilim.getByRole('table', { name: `${ILK_KALEM} · aylık plan ve gerçek` });
      await expect(tablo).toBeVisible();
      const aralik = tablo.getByRole('row').filter({ has: page.getByRole('rowheader', { name: GELECEK_AY, exact: true }) });
      await expect(aralik.getByRole('cell').nth(1)).toHaveText('Henüz yok');
      const kasim = tablo.getByRole('row').filter({ has: page.getByRole('rowheader', { name: BU_AY, exact: true }) });
      await expect(kasim.getByRole('cell').nth(1)).toContainText('₺');
      // Chart grafik motorunu yuva görünür alana girince yükler (IntersectionObserver). Bölüm (24 aylık tablo) görünümden
      // uzun olabilir: ortalamak grafiğin yuvasını üstte görünüm dışında bırakır; bölümün başı görünümün başına alınır.
      await egilim.evaluate(element => element.scrollIntoView({ block: 'start' }));
      await expect(egilim.getByRole('img', { name: new RegExp(`"${ILK_KALEM}" kaleminin aylara göre`) })).toBeVisible();
      await expect(egilim.getByText('Grafik hazırlanıyor')).toHaveCount(0);
      expect(istekler.some(url => /ButceTrend\.wide/.test(url)), 'geniş eğilim modülü tembel yüklenmeli').toBe(true);

      // Kalemler: masaüstünde tablo; tablette alan yetmezse akordeon (ResponsiveTable sığma kuralı). İki biçimde de
      // Gerçekleşen "Kaynakta yazılı" ile yazılır.
      const alan = akordeon(page);
      if ((await alan.getAttribute('data-layout')) === 'table') {
        const satir = page.getByRole('row').filter({ hasText: ILK_KALEM }).first();
        await expect(satir).toContainText('Kaynakta yazılı');
      } else {
        await expect(basliklar(alan).first()).toContainText('Kaynakta yazılı');
      }
      expect(await horizontalOverflow(page), 'geniş: yatay taşma').toEqual([]);
      expect(await smallText(page), 'geniş: 14 px alt sınır').toEqual([]);
      await egilim.scrollIntoViewIfNeeded();
      expect(istekler.some(url => /\/echarts|zrender|Chart\.runtime/.test(url)), 'geniş profilde grafik motoru tembel yüklenir').toBe(true);
      await kanit(page, `${boyut.ad} aylık eğilim`);
    });
  }
});
