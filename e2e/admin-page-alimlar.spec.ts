import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { gotoAdmin, horizontalOverflow, openAdmin } from './admin-helpers';
import { smallText } from './admin-detectors';

// Alımlar ve eşyalar — telefon önce kritik yolculuk (c05). Tasarım: README › Sayfa iskeleti ve Uyarlanır teslim,
// ekranlar.md (EkranListeDar, EkranAyrintiDar, SayfaAlimlarDar). Veri: webServer'ın servis ettiği sentetik nesil
// (fixtures/generation-synthetic; AILE_GENERATION_DIR); burada page.route yok, Google'a ağ çağrısı yok.
// Projeler: chromium 320×568 ve webkit 390×844 (dokunmatik telefon) görev koşusunda; @matrix etiketli testler
// entegrasyonda chromium-360/375, chromium-short 320×480, chromium-landscape 568×320 (telefon profili kalır),
// webkit-tablet 820×1180 ve webkit-desktop 1440×900'de de koşar. Dallanma genişliğe göre değil, AdaptiveRoot'un
// <html data-profile> değerine göredir. Emülasyon gerçek cihaz değildir.

const FIXTURE_ROOT = fileURLToPath(new URL('../fixtures/generation-synthetic/', import.meta.url));
const GENERATION_ID = readdirSync(FIXTURE_ROOT).find(name => /^[a-f0-9]{64}$/.test(name) && statSync(path.join(FIXTURE_ROOT, name)).isDirectory())!;
const GENERATION_DIR = path.join(FIXTURE_ROOT, GENERATION_ID);
const records = <T>(rel: string): T[] => (JSON.parse(readFileSync(path.join(GENERATION_DIR, rel), 'utf8')) as { records: T[] }).records;

interface Purchase { id: string; label: string; room_id: string | null }
interface Room { id: string; label: string }
const PURCHASES = records<Purchase>('data/purchase_needs/household/00000.json');
const ROOMS = records<Room>('data/rooms/household/00000.json');
const ODA_1 = 'Örnek oda 1';
const ODA_1_KAYITLARI = PURCHASES.filter(record => record.room_id === ROOMS.find(room => room.label === ODA_1)!.id).map(record => record.label);
const KASE = 'Örnek kase';
const sayi = (n: number) => new Intl.NumberFormat('tr-TR').format(n);

type Profil = 'phone' | 'tablet' | 'desktop';
const profil = async (page: Page): Promise<Profil> => (await page.evaluate(() => document.documentElement.dataset.profile)) as Profil;

const sorgu = (page: Page) => page.getByRole('search', { name: 'Sorgu' });
const sonuclar = (page: Page) => page.getByRole('region', { name: 'Sonuçlar' });
const satir = (page: Page, label: string) => sonuclar(page).getByRole('button', { name: new RegExp(label) });
const sonucBekle = (page: Page, n: number) => expect(sorgu(page).getByText(`${sayi(n)} sonuç`, { exact: true })).toBeVisible();

/**
 * Öğe görünüm alanında VE üstünde başka bir şey yok (yapışkan üst bar, örtü): merkezindeki nokta öğenin kendisine ya da
 * içine düşer. toBeInViewport örtüyü görmez; tam sayfa ayrıntının başlığı üst barın altında kalırsa bu yakalar.
 */
async function gercektenGorunur(locator: Locator, ad: string) {
  await expect(locator, `${ad} görünür`).toBeVisible();
  const sonuc = await locator.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const x = Math.min(Math.max(rect.left + rect.width / 2, 0), window.innerWidth - 1);
    const y = Math.min(Math.max(rect.top + Math.min(rect.height / 2, 12), 0), window.innerHeight - 1);
    const hit = document.elementFromPoint(x, y);
    return {
      inViewport: rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth,
      covered: !hit || !(element === hit || element.contains(hit)),
      hit: hit ? `${hit.tagName.toLowerCase()}.${String((hit as HTMLElement).className || '').split(' ')[0]}` : 'yok',
      top: Math.round(rect.top),
      viewport: window.innerHeight,
    };
  });
  expect(sonuc.inViewport, `${ad} görünüm alanında değil (top=${sonuc.top}, yükseklik=${sonuc.viewport})`).toBe(true);
  expect(sonuc.covered, `${ad} örtülü: noktada ${sonuc.hit}`).toBe(false);
}

/** Yolculuk boyunca istenen yollar (dev sunucusu modülleri tek tek servis eder; ağ kanıtı). */
function istekleriTopla(page: Page): string[] {
  const list: string[] = [];
  page.on('request', request => list.push(new URL(request.url()).pathname));
  return list;
}
const GENIS_MODUL = /\.wide(\.[a-z]+)?$|\/wide-[^/]*\.(js|css)$/;
const GRAFIK = /\/echarts|\/zrender/;
const ANTD = /\/(antd|@ant-design|antd_|@ant-design_)/;

test.describe('Alımlar telefon yolculuğu', () => {
  test('başlık, amaç ve ana eylem ilk ekranda; arama ve filtre alt sayfası aynı kümeyi verir', { tag: '@matrix' }, async ({ page }) => {
    await openAdmin(page, '/alimlar');
    const p = await profil(page);
    test.skip(p === 'desktop', 'masaüstü yerleşimi ayrı testte (filtre paneli açık, ayrıntı sağda)');

    await gercektenGorunur(page.getByRole('heading', { level: 1, name: 'Alımlar ve eşyalar' }), 'h1');
    await gercektenGorunur(page.getByText('Ev için alınacak ve alınmış her şeyi plan ve gerçek tutarıyla izleyin.'), 'amaç cümlesi');
    await gercektenGorunur(page.getByRole('button', { name: 'Alım ekle' }), 'ana eylem');
    expect(await horizontalOverflow(page), 'sayfa düzeyinde yatay taşma').toEqual([]);

    // Toplam ekrandan okunur: silinmiş (deleted_at) kayıtların sayılıp sayılmaması veri katmanının kararıdır (istek d04).
    const toplam = Number(((await sorgu(page).getByText(/^[\d.]+ sonuç$/).textContent()) ?? '').replace(/\D/g, ''));
    expect(toplam).toBeGreaterThan(ODA_1_KAYITLARI.length);

    // Arama: ad ile tek kayıt; temizlenince tam küme.
    const ara = sorgu(page).getByRole('searchbox', { name: 'Ara' });
    await ara.fill('kase');
    await sonucBekle(page, 1);
    await expect(satir(page, KASE)).toBeVisible();
    await ara.fill('');
    await sonucBekle(page, toplam);

    // Filtre: telefonda tam genişlik alt sayfa (tablette sağdan 384); seçim anında uygulanır. Altlıkta canlı sonuç sayısı
    // ("N sonuç") ve birincil "Uygula" (açıklaması bu sayı, kapatır) görünür ve örtüsüzdür (shell/FilterDrawer).
    const filtreDugmesi = sorgu(page).getByRole('button', { name: 'Filtreler (0)' });
    await filtreDugmesi.click();
    const cekmece = page.getByRole('dialog', { name: /^Filtreler/ });
    await expect(cekmece).toBeVisible();
    const kutu = (await cekmece.boundingBox())!;
    const genislik = page.viewportSize()!.width;
    if (p === 'phone') expect(kutu.width, 'telefonda filtre tam genişlik').toBeGreaterThanOrEqual(genislik - 1);
    else expect(Math.abs(kutu.width - 384), 'tablette filtre 384').toBeLessThanOrEqual(24);
    const oda = cekmece.getByRole('checkbox', { name: ODA_1, exact: true });
    await oda.scrollIntoViewIfNeeded();
    await oda.click();
    await expect(oda).toBeChecked();
    const sonucDurumu = cekmece.getByRole('status').filter({ hasText: / sonuç$/ });
    await expect(sonucDurumu).toHaveText(`${sayi(ODA_1_KAYITLARI.length)} sonuç`);
    await gercektenGorunur(sonucDurumu, 'filtre sonuç sayısı');
    const uygula = cekmece.getByRole('button', { name: 'Uygula', exact: true });
    await expect(uygula).toHaveAccessibleDescription(`${sayi(ODA_1_KAYITLARI.length)} sonuç`);
    await gercektenGorunur(uygula, 'filtre birincil eylemi');
    await uygula.click();
    await expect(cekmece).toBeHidden();
    await expect(sorgu(page).getByRole('button', { name: 'Filtreler (1)' })).toBeFocused();
    await sonucBekle(page, ODA_1_KAYITLARI.length);
    await expect(sorgu(page).getByText(`Oda: ${ODA_1}`, { exact: true })).toBeVisible();
    await sorgu(page).getByRole('button', { name: `Oda: ${ODA_1} filtresini kaldır` }).click();
    await sonucBekle(page, toplam);
    expect(await horizontalOverflow(page), 'filtre sonrası yatay taşma').toEqual([]);
  });

  test('ayrıntı tam ekran üstten açılır; durum alt sayfadan değişir, bildirim görünür, geri al çevirir; dönüşte odak satırda', { tag: '@matrix' }, async ({ page }) => {
    await openAdmin(page, '/alimlar');
    const p = await profil(page);
    test.skip(p === 'desktop', 'masaüstünde ayrıntı sağ panelde (ayrı test)');

    const kaseSatiri = satir(page, KASE);
    await expect(kaseSatiri).toContainText('Araştırılıyor');
    await kaseSatiri.scrollIntoViewIfNeeded();
    await kaseSatiri.click();

    // Tam sayfa ayrıntı: listenin kaydırma konumu taşınmaz; başlık ve "Listeye dön" ilk ekranda ve örtüsüz.
    const ayrinti = page.getByRole('dialog', { name: KASE });
    await expect(ayrinti).toBeVisible();
    await expect(sorgu(page)).toBeHidden();
    await gercektenGorunur(ayrinti.getByRole('button', { name: 'Listeye dön' }), '"Listeye dön"');
    await gercektenGorunur(ayrinti.getByRole('heading', { level: 2, name: KASE }), 'ayrıntı başlığı');
    expect(await horizontalOverflow(page), 'ayrıntıda yatay taşma').toEqual([]);

    // Durumu değiştir: yalnız iş akışı geçişleri; telefonda seçim alttan açılan sayfada.
    const durum = ayrinti.getByRole('combobox', { name: 'Durumu değiştir' });
    await durum.scrollIntoViewIfNeeded();
    await durum.click();
    const liste = page.getByRole('listbox').filter({ has: page.getByRole('option', { name: 'Karar bekliyor', exact: true }) });
    await expect(liste).toBeVisible();
    await expect(liste.getByRole('option')).toHaveText(['Araştırılıyor', 'Karar bekliyor', 'İptal']);
    if (p === 'phone') {
      const sayfa = page.getByRole('dialog', { name: 'Durumu değiştir' });
      await expect(sayfa).toBeVisible();
      // Alt sayfa alttan kayarak (240 ms) gelir; ölçü hareket bitince alınır (ara kare alta yaslı değildir).
      const altBosluk = async () => {
        const kutu = (await sayfa.boundingBox())!;
        return Math.abs(kutu.y + kutu.height - page.viewportSize()!.height);
      };
      await expect.poll(altBosluk, { message: 'alt sayfa alta yaslı' }).toBeLessThanOrEqual(2);
    }
    await liste.getByRole('option', { name: 'Karar bekliyor', exact: true }).click();
    // Seçim alt sayfayı kapatır; kapanma hareketi bitmeden alttaki bildirim örtülü sayılır.
    if (p === 'phone') await expect(page.getByRole('dialog', { name: 'Durumu değiştir' })).toBeHidden();

    // Onay bildirimi kullanıcının baktığı yerde görünür (sayfa başında kalan bildirim görünmez).
    const bildirim = page.getByRole('status').filter({ hasText: 'Araştırılıyor → Karar bekliyor' });
    await expect(bildirim).toContainText('kaynağa yazılmadı');
    await gercektenGorunur(bildirim, 'durum bildirimi');
    // Seçili durum ayrıntıda görünür. Combobox'ın kendi metni uygulamaya bağlıdır (antd: değer kardeş öğede, girdi boş);
    // görünen ayrıntı metni ölçülür (yolculuk testiyle aynı).
    await expect(ayrinti).toContainText('Karar bekliyor');

    const geriAl = ayrinti.getByRole('button', { name: 'Geri al' });
    await gercektenGorunur(geriAl, '"Geri al"');
    await geriAl.click();
    const geriAlindi = page.getByRole('status').filter({ hasText: 'Değişiklik geri alındı.' });
    await gercektenGorunur(geriAlindi, 'geri alma bildirimi');
    await expect(ayrinti.getByRole('button', { name: 'Geri al' })).toHaveCount(0);
    await expect(ayrinti).toContainText('Araştırılıyor');
    expect(await smallText(page, { root: '#admin-content', min: 14 }), 'metin ≥ 14 CSS px').toEqual([]);

    // Listeye dönüş: odak açan satırda ve satır ekranda; ayrıntıdaki değişiklik geri alındığı için etiket eski hâlinde.
    await ayrinti.getByRole('button', { name: 'Listeye dön' }).click();
    await expect(ayrinti).toBeHidden();
    await expect(kaseSatiri).toBeFocused();
    await gercektenGorunur(kaseSatiri, 'açan satır');
    await expect(kaseSatiri).toContainText('Araştırılıyor');
  });

  test('telefon profili geniş modül ve grafik kodu indirmez', { tag: '@matrix' }, async ({ page }) => {
    const istekler = istekleriTopla(page);
    await openAdmin(page, '/alimlar');
    test.skip((await profil(page)) !== 'phone', 'yalnız telefon profilinin teslim kuralı');
    await satir(page, KASE).click();
    await expect(page.getByRole('dialog', { name: KASE })).toBeVisible();
    await page.getByRole('dialog', { name: KASE }).getByRole('button', { name: 'Listeye dön' }).click();
    expect(istekler.filter(yol => GENIS_MODUL.test(yol)), 'telefonda *.wide modülü istendi').toEqual([]);
    expect(istekler.filter(yol => GRAFIK.test(yol)), 'telefonda echarts istendi').toEqual([]);
  });

  // W0 sözleşmesi: telefon profili antd/@ant-design istemez. Kabuk ve ui/ sarmalayıcıları paralel görevlerde antd'siz
  // yeniden yazılıyor ve PHONE_WITHOUT_ANTD bayrağı entegrasyonda açılıyor; o zamana kadar bu test kırmızıdır.
  test('telefon profili antd ve @ant-design istemez', { tag: '@matrix' }, async ({ page }) => {
    const istekler = istekleriTopla(page);
    await openAdmin(page, '/alimlar');
    test.skip((await profil(page)) !== 'phone', 'yalnız telefon profilinin teslim kuralı');
    expect(istekler.filter(yol => ANTD.test(yol)), 'telefonda antd istendi').toEqual([]);
  });
});

test.describe('Alımlar geniş yerleşim', () => {
  // Geniş profilde antd sağlayıcı geçidi (adaptive/AdaptiveRoot) tembel bağlanır ve bağlanınca çalışma alanını bir kez
  // yeniden kurar; yavaş ağda kullanıcı o arada bir kaydı açmış olabilir. Yeni sayfa örneği seçimi hash'ten alır ama açan
  // satırı bilmez: kapanınca odak yine o kaydın satırına dönmeli (body'de kalmamalı). Geçidin modülü ayrıntı açılana
  // kadar tutulur (sabit bekleme yok); telefon profili sağlayıcı istemez.
  test('sağlayıcı geçidi ayrıntı açıkken bağlanırsa kapanınca odak açılan kaydın satırına döner', { tag: '@matrix' }, async ({ page }) => {
    let birak!: () => void;
    const serbest = new Promise<void>(resolve => { birak = resolve; });
    let tutulan = 0;
    await page.route(url => /\/adaptive\/WideProviders\.tsx$/.test(url.pathname), async route => {
      tutulan += 1;
      await serbest;
      await route.fallback();
    });
    await gotoAdmin(page, '/alimlar');
    await expect(page.getByRole('heading', { level: 1, name: 'Alımlar ve eşyalar' })).toBeVisible();
    const p = await profil(page);
    test.skip(p === 'phone', 'telefon profili sağlayıcı geçidini istemez');
    await expect.poll(() => tutulan, { message: 'geniş profilde sağlayıcı modülü istenmeli' }).toBeGreaterThan(0);

    const kaseSatiri = satir(page, KASE);
    await kaseSatiri.click();
    const ayrinti = page.getByRole('dialog', { name: KASE });
    await expect(ayrinti).toBeVisible();
    await expect(page.locator('[aria-busy="true"]:not(main *)'), 'geçit henüz bağlanmadı').toHaveCount(1);

    birak();
    await expect(page.locator('[aria-busy="true"]'), 'geçit bağlandı, yükleme bitti').toHaveCount(0);
    await expect(ayrinti, 'seçim hash ile yeniden kurulumdan sağ çıkar').toBeVisible();
    await ayrinti.getByRole('button', { name: p === 'desktop' ? 'Kapat' : 'Listeye dön', exact: true }).click();
    await expect(ayrinti).toBeHidden();
    await expect(kaseSatiri).toBeFocused();
  });

  test('masaüstü: geniş yerleşim lazyWide ile gelir; ayrıntı sağda 384; görünüm değişiminde seçim, filtre ve odak korunur', { tag: '@matrix' }, async ({ page }) => {
    const istekler = istekleriTopla(page);
    await openAdmin(page, '/alimlar');
    test.skip((await profil(page)) !== 'desktop', 'yalnız masaüstü profili');
    expect(istekler.some(yol => /\/pages\/alimlar\/AlimlarGenis\.wide\.tsx$/.test(yol)), 'geniş yerleşim modülü yüklenmeli').toBe(true);

    // Filtre paneli solda açık (Liste); bir oda seçilir.
    const panel = page.getByRole('region', { name: 'Filtreler', exact: true }).first();
    await expect(panel).toBeVisible();
    await panel.getByRole('checkbox', { name: ODA_1, exact: true }).check();
    await sonucBekle(page, ODA_1_KAYITLARI.length);

    const ilk = [...ODA_1_KAYITLARI].sort((a, b) => a.localeCompare(b, 'tr-TR'))[0]!;
    await satir(page, ilk).click();
    const ayrinti = page.getByRole('dialog', { name: ilk });
    await expect(ayrinti).toBeVisible();
    const ayrintiKutusu = (await ayrinti.boundingBox())!;
    const sonucKutusu = (await sonuclar(page).boundingBox())!;
    expect(ayrintiKutusu.x, 'ayrıntı sonuçların sağında').toBeGreaterThanOrEqual(sonucKutusu.x + sonucKutusu.width - 1);
    expect(Math.abs(ayrintiKutusu.width - 384), 'ayrıntı 384').toBeLessThanOrEqual(24);

    // Tablo: filtre 56 px şeritle başlar; seçim, filtre ve odak korunur. Mod klavyeyle değişir (APG radyo grubu: ok
    // seçer ve odağı taşır): WebKit/Safari fare tıklamasında odağı denetime taşımadığından odak iddiası klavye yolunda.
    const grup = sorgu(page).getByRole('radiogroup', { name: 'Görünüm modu' });
    const tablo = grup.getByRole('radio', { name: 'Tablo', exact: true });
    await grup.getByRole('radio', { name: 'Liste', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(tablo).toBeChecked();
    await expect(tablo).toBeFocused();
    const serit = page.getByRole('button', { name: /^Filtreleri göster/ });
    await expect(serit).toBeVisible();
    expect(Math.abs((await serit.boundingBox())!.width - 56), 'filtre şeridi 56').toBeLessThanOrEqual(4);
    await sonucBekle(page, ODA_1_KAYITLARI.length);
    await expect(sorgu(page).getByText(`Oda: ${ODA_1}`, { exact: true })).toBeVisible();
    await expect(ayrinti).toBeVisible();
    await expect(sonuclar(page).getByRole('row', { name: new RegExp(`^${ilk} `) })).toHaveAttribute('aria-selected', 'true');
    expect(await horizontalOverflow(page), 'masaüstünde yatay taşma').toEqual([]);
  });
});
