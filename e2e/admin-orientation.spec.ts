import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, type Locator, type Page, type Request } from '@playwright/test';
import { adaptiveTokens, designTokens } from '../src/design/tokens';
import { horizontalOverflow, openAdmin } from './admin-helpers';
import { overflow, selfCheckDetectors } from './admin-detectors';

// Yön değişimi ve profil sürekliliği kapısı (f07). Kaynak: W0 sözleşmesi (src/admin/adaptive/profile.ts, loader.ts,
// AdaptiveRoot.tsx; vite.config.ts WIDE_MODULE) ve kullanıcının kalıcı kuralı: kısa kenarı 480'den küçük yatay telefon
// telefon profilinde kalır (tasarım README'sindeki "yatay telefon tablet kurallarını alır" bu projede geçersizdir).
//
// Kapsam:
//  - Profil: html[data-profile] (ve AdaptiveRoot kökü) 320×568, 320×480, 844×390 → phone; 820×1180 → tablet;
//    1440×900 → desktop. @matrix testi aynı sözleşmeyi her matris projesinin kendi görünümünde sınar.
//  - Telefon profilinde wide grubundan hiçbir parça istenmez. Kanıt Playwright'ın istek başlatma olayıdır
//    (page.on('request')): dev'de src altında *.wide.* ya da `wide/` klasörü, üretimde assets/wide-*.
//  - 320×568 → 568×320: filtre formu (seçili kutu + yazılmış ama henüz gönderilmemiş tutar) ve odak korunur, ana eylem
//    erişilir ve çalışır, profil phone kalır, wide istenmez, başlatma tekrarlanmaz (belge yeniden yüklenmez, nesil yeniden
//    indirilmez, main/diyalog/odaklı alan yeniden kurulmaz, yükleme iskeleti dönmez).
//  - 390×844 → 1440×900 → 390×844: profil desktop olur, filtre seçimi ve seçili kayıt korunur; telefona dönünce telefon
//    sunumu gelir, masaüstü arayüzü kalmaz; wide parçaları en çok bir kez istenir ve telefona dönünce yenisi istenmez.
//  - Geç gelen wide: masaüstünde wide istekleri tutulur, telefona dönülür, sonra bırakılır; bitmiş yükleme telefona dönmüş
//    ekrana geniş arayüz getirmez (stale guard) ve tekrar masaüstüne geçişte yeni istek olmadan kullanılır.
//  - Öz denetim: istek sınıflayıcısı, profil kahini, süreklilik/stale sondası ve paylaşılan dedektörler bilinçli ihlali
//    yakalar (aksi hâlde yukarıdaki boş listeler anlamsız olurdu).
//
// Sabit bekleme yok: hazır sinyali openAdmin; görünüm değişimi innerWidth/innerHeight + iki animasyon karesi; ağ
// sakinliği "bekleyen istek kalmadı" sinyali. Veri yalnız sentetik nesil (webServer AILE_GENERATION_DIR); Google
// alanlarına giden her istek kesilir ve kaydedilir.

// --- Sözleşme eşikleri ve profil kahini ------------------------------------------------------------------------------
type Profil = 'phone' | 'tablet' | 'desktop';
interface Boyut { width: number; height: number }

/** profile.ts'den bağımsız kahin: aynı tokenlardan (600 / 1024 / kısa kenar 480) okunur, aynı kararı yeniden kurar. */
function beklenenProfil({ width, height }: Boyut): Profil {
  if (width < designTokens.kirilimTablet || Math.min(width, height) < adaptiveTokens.kirilimKisaKenar) return 'phone';
  return width >= designTokens.kirilimGenis ? 'desktop' : 'tablet';
}

const DIKEY: Boyut = { width: 320, height: 568 };
const YATAY: Boyut = { width: 568, height: 320 };
const TELEFON_390: Boyut = { width: 390, height: 844 };
const MASAUSTU: Boyut = { width: 1440, height: 900 };
const PROFIL_BOYUTLARI: readonly (Boyut & { profil: Profil })[] = [
  { width: 320, height: 568, profil: 'phone' },
  { width: 320, height: 480, profil: 'phone' },
  { width: 844, height: 390, profil: 'phone' },
  { width: 820, height: 1180, profil: 'tablet' },
  { width: 1440, height: 900, profil: 'desktop' },
];

// --- Wide isteği sınıflayıcısı -------------------------------------------------------------------------------------
// vite.config.ts WIDE_MODULE ile aynı kural, URL yoluna uygulanır: src altında *.wide.{js,jsx,ts,tsx,mjs,cjs,css} ya da
// tam adı `wide` olan klasör segmenti; node_modules hariç. Üretim çıktısında tek grup assets/wide-*.{js,css}.
const WIDE_KAYNAK = /\/src\/(?:[^?#]*\/)?(?:wide\/[^?#]+|[^/?#]+\.wide\.(?:[cm]?[jt]sx?|css))$/;
const WIDE_CIKTI = /\/assets\/wide-[^/]+\.(?:js|css)$/;

function genisIstekMi(url: string): boolean {
  let yol: string;
  try {
    yol = decodeURIComponent(new URL(url).pathname);
  } catch {
    return false;
  }
  if (/\/node_modules\//.test(yol)) return false;
  return WIDE_KAYNAK.test(yol) || WIDE_CIKTI.test(yol);
}

// --- Sentetik nesil (yalnız seçim için etiket ve kimlik) -----------------------------------------------------------
const FIXTURE_ROOT = fileURLToPath(new URL('../fixtures/generation-synthetic/', import.meta.url));
const GENERATION_ID = readdirSync(FIXTURE_ROOT).find(name => /^[a-f0-9]{64}$/.test(name) && statSync(path.join(FIXTURE_ROOT, name)).isDirectory())!;
const GENERATION_DIR = path.join(FIXTURE_ROOT, GENERATION_ID);
interface Purchase { id: string; label: string; room_id: string | null; deleted_at: string | null }
interface Room { id: string; label: string }
const records = <T>(rel: string): T[] => (JSON.parse(readFileSync(path.join(GENERATION_DIR, rel), 'utf8')) as { records: T[] }).records;
const ODA = 'Örnek oda 1';
const ODA_ID = records<Room>('data/rooms/household/00000.json').find(room => room.label === ODA)!.id;
/** Odadaki canlı kayıtlardan tr-TR sırasında ilki; satır ve ayrıntı bu adla bulunur. */
const KAYIT = records<Purchase>('data/purchase_needs/household/00000.json')
  .filter(record => record.room_id === ODA_ID && !record.deleted_at)
  .sort((a, b) => a.label.localeCompare(b.label, 'tr-TR'))[0]!;
const kacis = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// --- Ağ kaydı ------------------------------------------------------------------------------------------------------
interface AgKaydi {
  /** Wide grubuna giden isteklerin URL'leri (başlatma sırasıyla, tekrarlar dahil). */
  genis: string[];
  /** /__aile/generation/* istek sayısı (nesil yeniden indirilirse artar). */
  nesil: number;
  /** Ana çerçeve belge (gezinme) isteği sayısı; sayfa yeniden yüklenirse artar. */
  belge: number;
  /** Google alanlarına giden (kesilen) istekler. */
  google: string[];
  /** Başlamış, henüz bitmemiş istekler. */
  bekleyen: Set<Request>;
}

const GOOGLE = /^https?:\/\/(?:[^/]*\.)?(?:google|googleapis|gstatic)\.com(?:[:/]|$)/;

/** Gezinmeden ÖNCE kurulur; istek başlatma olaylarını sayar. Google'a giden istekler kesilir. */
async function agKaydi(page: Page): Promise<AgKaydi> {
  const ag: AgKaydi = { genis: [], nesil: 0, belge: 0, google: [], bekleyen: new Set() };
  await page.route(GOOGLE, route => route.abort('blockedbyclient'));
  page.on('request', request => {
    const url = request.url();
    ag.bekleyen.add(request);
    if (genisIstekMi(url)) ag.genis.push(url);
    if (url.includes('/__aile/generation/')) ag.nesil += 1;
    if (GOOGLE.test(url)) ag.google.push(url);
    let anaBelge = false;
    try {
      anaBelge = request.isNavigationRequest() && request.frame() === page.mainFrame();
    } catch {
      anaBelge = false; // service worker isteğinin çerçevesi yok
    }
    if (anaBelge) {
      ag.belge += 1;
      // Yeni ana belge: önceki belgenin yarım kalan istekleri (ör. soğuk Vite'nin yeniden yüklemesi) artık bitiş olayı
      // vermeyebilir; bekleyen kümesi yeni belgeden başlar. Belge sayacı yeniden yüklemeyi zaten ayrıca kaydeder.
      for (const eski of ag.bekleyen) if (eski !== request) ag.bekleyen.delete(eski);
    }
  });
  const bitti = (request: Request) => { ag.bekleyen.delete(request); };
  page.on('requestfinished', bitti);
  page.on('requestfailed', bitti);
  return ag;
}

/** Her wide URL'si en çok bir kez istenmiş olmalı; tekrarlananların listesi. */
const tekrarlanan = (urls: readonly string[]) => [...new Set(urls.filter((url, i) => urls.indexOf(url) !== i))];

const ikiKare = (page: Page) => page.evaluate(() => new Promise<void>(resolve => {
  requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
}));

/**
 * Ağ sakin: bekleyen istek yok, iki kare sonra da yok (efektlerin başlattığı tembel istekler dahil). Süre bir kabul
 * eşiği değil, bekleme sınırıdır: aynı makinede ~50 koşu varken soğuk Vite'nin ilk dönüşümleri 5 sn'yi aşabiliyor.
 * Hata iletisi bekleyen isteklerin listesidir.
 */
const SAKIN_SURE = 20_000;
async function sakinlestir(page: Page, ag: AgKaydi) {
  const bekleyen = () => [...ag.bekleyen].map(request => `${request.method()} ${request.resourceType()} ${request.url()}`).sort();
  await expect.poll(bekleyen, { message: 'bekleyen ağ isteği kalmamalı', timeout: SAKIN_SURE }).toEqual([]);
  await ikiKare(page);
  await expect.poll(bekleyen, { message: 'bekleyen ağ isteği kalmamalı (iki kare sonra)', timeout: SAKIN_SURE }).toEqual([]);
}

/** Görünümü değiştirir; sayfa yeni boyutu görene ve iki kare (profil izleyicisinin rAF'i + çizim) geçene kadar bekler. */
async function boyutla(page: Page, boyut: Boyut) {
  await page.setViewportSize(boyut);
  await page.waitForFunction(([w, h]) => window.innerWidth === w && window.innerHeight === h, [boyut.width, boyut.height] as const);
  await ikiKare(page);
}

async function profilBekle(page: Page, profil: Profil) {
  await expect(page.locator('html'), `html[data-profile] = ${profil}`).toHaveAttribute('data-profile', profil);
  await expect(page.locator('#admin-root > [data-profile]'), `AdaptiveRoot kökü data-profile = ${profil}`).toHaveAttribute('data-profile', profil);
}

// --- Sunum işaretleri (rol/ad; antd iç sınıfı yok) -------------------------------------------------------------------
// Telefon ve tablet: üst barda "Sayfalar" düğmesi, kalıcı gezinme yok. Masaüstü: kalıcı "Sayfalar" gezinmesi, düğme yok.
const sayfalarDugmesi = (page: Page) => page.getByRole('button', { name: 'Sayfalar', exact: true });
const kaliciGezinme = (page: Page) => page.getByRole('navigation', { name: 'Sayfalar', exact: true });

async function telefonKabugu(page: Page) {
  await expect(sayfalarDugmesi(page), 'dar kabukta "Sayfalar" düğmesi').toBeVisible();
  await expect(kaliciGezinme(page), 'dar kabukta kalıcı gezinme yok').toBeHidden();
}
async function masaustuKabugu(page: Page) {
  await expect(kaliciGezinme(page), 'masaüstünde kalıcı gezinme').toBeVisible();
  await expect(sayfalarDugmesi(page), 'masaüstünde "Sayfalar" düğmesi yok').toBeHidden();
}

const sorgu = (page: Page) => page.getByRole('search', { name: 'Sorgu' });
const sonuclar = (page: Page) => page.getByRole('region', { name: 'Sonuçlar' });
const filtreCekmecesi = (page: Page) => page.getByRole('dialog', { name: /^Filtreler/ });
/**
 * Filtre alt sayfasının ana eylemi (shell/FilterDrawer): "Uygula" kapatır, seçim zaten anında uygulanmıştır; açıklaması
 * altlıktaki canlı sonuç sayısıdır ("28 sonuç"). Eski "N sonucu göster" adı FilterDrawer sözleşmesinde yok.
 */
const birincilEylem = (scope: Locator) => scope.getByRole('button', { name: 'Uygula', exact: true });
const SONUC_SAYISI = /^[\d.]+ sonuç$/;

/** Filtre boyutu (Disclosure); kapalıysa açılır, bölgesi döner. */
async function boyutAc(scope: Locator, ad: string): Promise<Locator> {
  const dugme = scope.getByRole('button', { name: new RegExp(`^${kacis(ad)}`) });
  if ((await dugme.getAttribute('aria-expanded')) !== 'true') await dugme.click();
  const bolge = scope.getByRole('region', { name: new RegExp(`^${kacis(ad)}`) });
  await expect(bolge).toBeVisible();
  return bolge;
}

// --- Süreklilik ve stale sondası (sayfa içi MutationObserver) ------------------------------------------------------
// Her DOM değişiminde: izlenen öğeler (main, açık diyalog, odaklı öğe) belgeden düştüyse yeniden kurulmuştur; yeni
// [aria-busy="true"] yükleme iskeletinin döndüğünü gösterir; html[data-profile]="phone" iken görünür kalıcı "Sayfalar"
// gezinmesi telefona sızmış (stale) geniş arayüzdür. Sayfa yeniden yüklenirse sonda kaybolur ve bu da ihlaldir.
interface SondaSecenek { kimlik: boolean; mesgul: boolean }

async function sondaKur(page: Page, secenek: SondaSecenek) {
  await page.evaluate(({ kimlik, mesgul }) => {
    type Sonda = { ihlaller: string[]; dur(): void };
    const w = window as unknown as { __f07Sonda?: Sonda };
    w.__f07Sonda?.dur();
    const ihlaller: string[] = [];
    const ekle = (metin: string) => { if (!ihlaller.includes(metin)) ihlaller.push(metin); };
    const gorunur = (el: Element) => {
      const probe = el as Element & { checkVisibility?: (o?: Record<string, boolean>) => boolean };
      return typeof probe.checkVisibility === 'function'
        ? probe.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
        : el.getClientRects().length > 0;
    };
    const izlenen: [string, Element][] = [];
    if (kimlik) {
      const main = document.querySelector('main#admin-content');
      if (main) izlenen.push(['main#admin-content', main]);
      const diyalog = Array.from(document.querySelectorAll('[role="dialog"]')).find(gorunur);
      if (diyalog) izlenen.push(['açık diyalog', diyalog]);
      const odak = document.activeElement;
      if (odak && odak !== document.body && odak !== document.documentElement) izlenen.push(['odaklı öğe', odak]);
    }
    const kontrol = () => {
      for (const [ad, el] of izlenen) if (!el.isConnected) ekle(`${ad} yeniden kuruldu`);
      if (mesgul && document.querySelector('[aria-busy="true"]')) ekle('yükleme iskeleti (aria-busy) yeniden göründü');
      if (document.documentElement.getAttribute('data-profile') === 'phone') {
        const sizinti = Array.from(document.querySelectorAll('nav[aria-label="Sayfalar"]'))
          .some(nav => !nav.closest('[role="dialog"]') && gorunur(nav));
        if (sizinti) ekle('telefon profilinde kalıcı "Sayfalar" gezinmesi görünür (stale geniş arayüz)');
      }
    };
    const gozlemci = new MutationObserver(kontrol);
    gozlemci.observe(document.documentElement, {
      subtree: true, childList: true, attributes: true, attributeFilter: ['aria-busy', 'data-profile', 'hidden', 'class', 'style'],
    });
    w.__f07Sonda = { ihlaller, dur: () => gozlemci.disconnect() };
  }, secenek);
}

async function sondaIhlalleri(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const w = window as unknown as { __f07Sonda?: { ihlaller: string[] } };
    return w.__f07Sonda ? [...w.__f07Sonda.ihlaller] : ['sonda kayboldu: sayfa yeniden yüklendi'];
  });
}

/** Öğenin merkezine yapılan isabet kendisine (ya da içine) düşer: başka katman örtmüyor. */
async function isabetAliyor(locator: Locator): Promise<boolean> {
  return locator.evaluate(el => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return Boolean(hit && (hit === el || el.contains(hit)));
  });
}

// --- Wide kapısı: wide isteklerini bırakılana kadar tutar ---------------------------------------------------------
interface GenisKapisi { tutulan(): number; birak(): void }

async function genisKapisi(page: Page): Promise<GenisKapisi> {
  let birak!: () => void;
  const serbest = new Promise<void>(resolve => { birak = resolve; });
  let tutulan = 0;
  await page.route(url => genisIstekMi(url.href), async route => {
    tutulan += 1;
    await serbest;
    await route.fallback();
  });
  return { tutulan: () => tutulan, birak };
}

// =====================================================================================================================
test.describe('Profil sözleşmesi (html[data-profile])', () => {
  for (const boyut of PROFIL_BOYUTLARI) {
    test(`${boyut.width}×${boyut.height} → ${boyut.profil}; telefonda wide parçası istenmez`, async ({ page }) => {
      expect(beklenenProfil(boyut), 'kahin sözleşme tablosuyla aynı').toBe(boyut.profil);
      const ag = await agKaydi(page);
      await page.setViewportSize(boyut);
      await openAdmin(page, '/alimlar');
      await profilBekle(page, boyut.profil);
      if (boyut.profil === 'desktop') await masaustuKabugu(page);
      else await telefonKabugu(page);
      await sakinlestir(page, ag);
      if (boyut.profil === 'phone') expect(ag.genis, 'telefon profilinde wide isteği başlatılmaz').toEqual([]);
      expect(tekrarlanan(ag.genis), 'wide parçası en çok bir kez istenir').toEqual([]);
      expect(ag.google, 'Google alanlarına istek yok').toEqual([]);
    });
  }

  test('proje görünümünde profil kahinle aynı; telefonda wide parçası istenmez', { tag: '@matrix' }, async ({ page }) => {
    const boyut = page.viewportSize()!;
    const profil = beklenenProfil(boyut);
    const ag = await agKaydi(page);
    await openAdmin(page, '/alimlar');
    await profilBekle(page, profil);
    if (profil === 'desktop') await masaustuKabugu(page);
    else await telefonKabugu(page);
    await sakinlestir(page, ag);
    if (profil === 'phone') expect(ag.genis, `${boyut.width}×${boyut.height} telefon: wide isteği başlatılmaz`).toEqual([]);
    expect(tekrarlanan(ag.genis), 'wide parçası en çok bir kez istenir').toEqual([]);
    expect(ag.google, 'Google alanlarına istek yok').toEqual([]);
  });
});

test.describe('Yön ve profil değişiminde durum sürekliliği', () => {
  test('320×568 → 568×320: filtre formu, seçili değer ve odak korunur; ana eylem erişilir; profil phone; wide yok; başlatma tekrarlanmaz', async ({ page }) => {
    const ag = await agKaydi(page);
    await page.setViewportSize(DIKEY);
    await openAdmin(page, '/alimlar');
    await profilBekle(page, 'phone');

    // Form: telefonda tam ekran filtre çekmecesi. Seçili değer (Oda kutusu) + yazılmış, henüz gönderilmemiş tutar
    // (RangeField taslağı yerel durumdur; alan yeniden kurulursa kaybolur) + odak o alanda.
    await sorgu(page).getByRole('button', { name: /^Filtreler \(/ }).click();
    const cekmece = filtreCekmecesi(page);
    await expect(cekmece).toBeVisible();
    const oda = await boyutAc(cekmece, 'Oda');
    const kutu = oda.getByRole('checkbox', { name: ODA, exact: true });
    await kutu.click();
    await expect(kutu).toBeChecked();
    const tutar = await boyutAc(cekmece, 'Tutar aralığı');
    const enAz = tutar.getByRole('textbox', { name: /^En az/ });
    await enAz.fill('1500');
    await expect(enAz).toBeFocused();
    await expect(enAz).toHaveValue('1500');

    await sakinlestir(page, ag);
    // Taban ölçü açılıştan sonra alınır (soğuk Vite'nin bağımlılık iyileştirme yeniden yüklemesi tabana girer).
    const once = { nesil: ag.nesil, belge: ag.belge };
    expect(once.belge, 'en az bir belge yüklemesi').toBeGreaterThanOrEqual(1);
    await sondaKur(page, { kimlik: true, mesgul: true });
    const odakOnce = await page.evaluateHandle(() => document.activeElement);

    await boyutla(page, YATAY);
    await profilBekle(page, 'phone');
    expect(await sondaIhlalleri(page), 'döndürmede yeniden kurulum / yükleme / stale').toEqual([]);

    // Girilen veri, seçili değer, açık panel ve odak.
    await expect(cekmece, 'filtre çekmecesi açık kalır').toBeVisible();
    await expect(kutu, 'seçili değer korunur').toBeChecked();
    await expect(enAz, 'girilen veri korunur').toHaveValue('1500');
    await expect(enAz, 'odak aynı alanda').toBeFocused();
    expect(await page.evaluate(el => el === document.activeElement, odakOnce), 'odaklı öğe aynı DOM düğümü').toBe(true);

    // Ana eylem erişilir: görünüme getirilebilir, tamamı görünümde, başka katman örtmüyor, dokunma hedefi ≥ 44.
    const birincil = birincilEylem(cekmece);
    await birincil.scrollIntoViewIfNeeded();
    await expect(birincil).toBeEnabled();
    await expect(birincil, 'ana eylemin açıklaması canlı sonuç sayısı').toHaveAccessibleDescription(SONUC_SAYISI);
    await expect(birincil, 'ana eylem görünümde').toBeInViewport({ ratio: 1 });
    expect(await isabetAliyor(birincil), 'ana eylemin üstünü başka katman örtmüyor').toBe(true);
    const kutuBoyu = (await birincil.boundingBox())!;
    expect(kutuBoyu.height, 'ana eylem dokunma hedefi yüksekliği').toBeGreaterThanOrEqual(designTokens.hedefAsgari);
    expect(await horizontalOverflow(page), '568×320 belge yatay taşmaz').toEqual([]);
    // Kök: rol/adla bulunan açık filtre diyaloğu; testin kendi işaretiyle seçilir (sınıf adına bağlanmaz).
    await cekmece.evaluate(el => el.setAttribute('data-f07-kok', ''));
    expect(await overflow(page, { root: '[data-f07-kok]' }), '568×320 çekmecede taşma / kesilen etiket').toEqual([]);

    // Başlatma tekrarlanmadı; wide istenmedi.
    await sakinlestir(page, ag);
    expect(ag.belge, 'belge yeniden yüklenmedi').toBe(once.belge);
    expect(ag.nesil, 'nesil yeniden indirilmedi').toBe(once.nesil);
    expect(ag.genis, 'telefon profilinde wide isteği başlatılmaz').toEqual([]);
    expect(await sondaIhlalleri(page)).toEqual([]);

    // Ana eylem yatayda çalışır: çekmece kapanır, seçim uygulanmış kalır.
    await birincil.click();
    await expect(cekmece).toBeHidden();
    await expect(sorgu(page).getByText(`Oda: ${ODA}`, { exact: true }), 'seçim etkin filtre olarak kalır').toBeVisible();

    // Geri dikey: profil phone, seçim korunur, yine wide yok ve yeniden başlatma yok.
    await boyutla(page, DIKEY);
    await profilBekle(page, 'phone');
    await expect(sorgu(page).getByText(`Oda: ${ODA}`, { exact: true })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`[?&]room=${ODA_ID}(?:&|$)`));
    await sakinlestir(page, ag);
    expect(ag.belge).toBe(once.belge);
    expect(ag.nesil).toBe(once.nesil);
    expect(ag.genis).toEqual([]);
  });

  test('390×844 → 1440×900 → 390×844: desktop olur; filtre seçimi ve seçili kayıt korunur; telefona dönünce telefon sunumu, geniş arayüz kalmaz', async ({ page }) => {
    const ag = await agKaydi(page);
    await page.setViewportSize(TELEFON_390);
    await openAdmin(page, '/alimlar');
    await profilBekle(page, 'phone');
    await telefonKabugu(page);

    // Filtre seçimi (çekmece) ve kayıt seçimi (ayrıntı).
    await sorgu(page).getByRole('button', { name: /^Filtreler \(/ }).click();
    const cekmece = filtreCekmecesi(page);
    const oda = await boyutAc(cekmece, 'Oda');
    await oda.getByRole('checkbox', { name: ODA, exact: true }).click();
    await expect(birincilEylem(cekmece)).toHaveAccessibleDescription(SONUC_SAYISI);
    await birincilEylem(cekmece).click();
    await expect(cekmece).toBeHidden();
    const etiket = sorgu(page).getByText(`Oda: ${ODA}`, { exact: true });
    await expect(etiket).toBeVisible();
    const sonucMetni = (await sorgu(page).getByText(/^[\d.]+ sonuç$/).innerText()).trim();

    await sonuclar(page).getByRole('button', { name: new RegExp(kacis(KAYIT.label)) }).click();
    const ayrinti = page.getByRole('dialog', { name: KAYIT.label });
    await expect(ayrinti).toBeVisible();
    await expect(ayrinti.getByRole('button', { name: 'Listeye dön' }), 'telefonda ayrıntı tam sayfa').toBeVisible();
    const secimUrl = new RegExp(`/alimlar/${KAYIT.id}\\?(?:.*&)?room=${ODA_ID}(?:&|$)`);
    await expect(page).toHaveURL(secimUrl);
    await sakinlestir(page, ag);
    expect(ag.genis, 'telefon profilinde wide isteği başlatılmaz').toEqual([]);
    const belge = ag.belge;

    // → masaüstü: profil, kabuk, seçim ve filtre.
    await boyutla(page, MASAUSTU);
    await profilBekle(page, 'desktop');
    await masaustuKabugu(page);
    await expect(page).toHaveURL(secimUrl);
    await expect(ayrinti, 'seçili kayıt masaüstünde açık kalır').toBeVisible();
    await expect(ayrinti.getByRole('button', { name: 'Kapat' }), 'masaüstünde ayrıntı sağ panel').toBeVisible();
    const filtreler = page.getByRole('region', { name: 'Filtreler', exact: true }).first();
    await expect(filtreler, 'Liste modunda filtre paneli açık').toBeVisible();
    await expect(filtreler.getByRole('checkbox', { name: ODA, exact: true }), 'filtre seçimi korunur').toBeChecked();
    await expect(etiket).toBeVisible();
    await expect(sorgu(page).getByText(sonucMetni, { exact: true }), 'sonuç sayısı aynı').toBeVisible();
    await sakinlestir(page, ag);
    expect(tekrarlanan(ag.genis), 'wide parçası en çok bir kez istenir').toEqual([]);
    const genisMasaustu = ag.genis.length;

    // → telefon: telefon sunumu döner, masaüstü arayüzü (stale) kalmaz, yeni wide isteği yok.
    await sondaKur(page, { kimlik: false, mesgul: false });
    await boyutla(page, TELEFON_390);
    await profilBekle(page, 'phone');
    await telefonKabugu(page);
    await expect(ayrinti.getByRole('button', { name: 'Listeye dön' }), 'telefonda ayrıntı yine tam sayfa').toBeVisible();
    await expect(page).toHaveURL(secimUrl);
    await sakinlestir(page, ag);
    expect(await sondaIhlalleri(page), 'telefona dönüşte stale geniş arayüz').toEqual([]);
    expect(ag.genis.length, 'telefona dönünce yeni wide isteği başlatılmaz').toBe(genisMasaustu);
    expect(ag.belge, 'profil değişimi sayfayı yeniden yüklemez').toBe(belge);

    await ayrinti.getByRole('button', { name: 'Listeye dön' }).click();
    await expect(ayrinti).toBeHidden();
    await expect(sorgu(page).getByRole('button', { name: 'Filtreler (1)' }), 'telefonda filtre düğmesi etkin sayıyla').toBeVisible();
    await expect(etiket).toBeVisible();
    await expect(sorgu(page).getByText(sonucMetni, { exact: true })).toBeVisible();
  });

  test('masaüstünde wide bir kez yüklenir; telefona dönüldükten sonra biten yükleme geniş arayüzü geri getirmez', async ({ page }) => {
    const ag = await agKaydi(page);
    const kapi = await genisKapisi(page);
    await page.setViewportSize(TELEFON_390);
    await openAdmin(page, '/alimlar');
    await profilBekle(page, 'phone');
    await sakinlestir(page, ag);
    expect(ag.genis, 'telefon profilinde wide isteği başlatılmaz').toEqual([]);
    const belge = ag.belge;
    await sondaKur(page, { kimlik: false, mesgul: false });

    // Masaüstüne geç: wide grubu istenir ama yanıtları tutulur.
    await boyutla(page, MASAUSTU);
    await profilBekle(page, 'desktop');
    await expect.poll(() => kapi.tutulan(), { message: 'masaüstü profilinde wide grubu istenmeli (lazyWide/wideResource)' }).toBeGreaterThan(0);

    // Yükleme bitmeden telefona dön, sonra yanıtları bırak.
    await boyutla(page, TELEFON_390);
    await profilBekle(page, 'phone');
    await telefonKabugu(page);
    kapi.birak();
    await sakinlestir(page, ag);
    await profilBekle(page, 'phone');
    await telefonKabugu(page);
    expect(await sondaIhlalleri(page), 'geç biten wide yüklemesi telefona geniş arayüz getirmez').toEqual([]);
    await expect(page.getByText('Geniş görünüm yüklenemedi', { exact: false }), 'telefonda wide hata bildirimi yok').toHaveCount(0);
    const istenen = ag.genis.length;
    expect(tekrarlanan(ag.genis), 'wide parçası en çok bir kez istenir').toEqual([]);

    // Tekrar masaüstü: yüklenmiş modüller yeniden istenmez. İlk geçişte zincir kapıda tutulduğu için yalnız ilk
    // geniş arayüzün içinde çizilen başka tembel parçalar (ör. geniş sayfanın kendi lazyWide bileşenleri) ilk kez
    // şimdi istenebilir; bu meşrudur. Sözleşme "her parça bir kez"dir.
    const ilkGecis = new Set(ag.genis.slice(0, istenen));
    await boyutla(page, MASAUSTU);
    await profilBekle(page, 'desktop');
    await masaustuKabugu(page);
    await sakinlestir(page, ag);
    expect(ag.genis.slice(istenen).filter(url => ilkGecis.has(url)), 'ikinci masaüstü geçişinde yüklenmiş wide parçası yeniden istenmez').toEqual([]);
    expect(tekrarlanan(ag.genis), 'wide parçası en çok bir kez istenir').toEqual([]);
    const masaustuToplam = ag.genis.length;

    await boyutla(page, TELEFON_390);
    await profilBekle(page, 'phone');
    await telefonKabugu(page);
    await sakinlestir(page, ag);
    expect(await sondaIhlalleri(page)).toEqual([]);
    expect(ag.genis.length, 'telefona dönünce yeni wide isteği başlatılmaz').toBe(masaustuToplam);
    expect(ag.belge, 'profil değişimleri sayfayı yeniden yüklemez').toBe(belge);
  });
});

// =====================================================================================================================
test.describe('Öz denetim: bu spec\'in dedektörleri kör değil', () => {
  test('profil kahini ve wide sınıflayıcısı sözleşme örneklerini doğru ayırır', () => {
    const ornek: [number, number, Profil][] = [
      [320, 568, 'phone'], [568, 320, 'phone'], [667, 375, 'phone'], [844, 390, 'phone'], [932, 430, 'phone'],
      [500, 900, 'phone'], [599, 1000, 'phone'], [600, 480, 'tablet'], [820, 1180, 'tablet'], [1023, 800, 'tablet'],
      [1180, 820, 'desktop'], [1024, 600, 'desktop'], [1440, 900, 'desktop'], [1024, 479, 'phone'],
    ];
    for (const [width, height, profil] of ornek) expect(beklenenProfil({ width, height }), `${width}×${height}`).toBe(profil);

    const kok = 'http://127.0.0.1:5490/aile';
    const genis = [
      `${kok}/src/admin/ui/wide/Select.wide.tsx`,
      `${kok}/src/admin/ui/wide/Select.wide.css?direct`,
      `${kok}/src/admin/pages/AlimlarPage.wide.tsx?t=1730000000000`,
      `${kok}/src/admin/shell/wide/DesktopNav.tsx`,
      `${kok}/src/admin/shell/wide/nav.css?import`,
      `${kok}/src/admin/ui/wide/Kanban.wide.mjs`,
      `${kok}/assets/wide-Ab12_cd.js`,
      `${kok}/assets/wide-Ab12_cd.css`,
    ];
    const dar = [
      `${kok}/src/admin/ui/Select.tsx`,
      `${kok}/src/admin/adaptive/WideProviders.tsx`,
      `${kok}/src/admin/widescreen/Panel.tsx`,
      `${kok}/src/admin/ui/Select.widest.tsx`,
      `${kok}/node_modules/.vite/deps/antd.js?v=1a2b`,
      `${kok}/node_modules/some-lib/wide/index.js`,
      `${kok}/assets/antd-Ab12.js`,
      `${kok}/assets/admin-wide.js`,
      `${kok}/__aile/generation/_meta`,
    ];
    for (const url of genis) expect(genisIstekMi(url), url).toBe(true);
    for (const url of dar) expect(genisIstekMi(url), url).toBe(false);
    expect(tekrarlanan(['a', 'b', 'a', 'c', 'b', 'a'])).toEqual(['a', 'b']);
  });

  test('istek kaydı, wide kapısı, süreklilik/stale sondası ve paylaşılan dedektörler ihlali yakalar', async ({ page }) => {
    const ag = await agKaydi(page);
    await page.setViewportSize(DIKEY);
    await openAdmin(page, '/alimlar');
    await profilBekle(page, 'phone');
    await sakinlestir(page, ag);
    expect(await selfCheckDetectors(page), 'ihlali yakalamayan paylaşılan dedektör').toEqual([]);
    expect(ag.genis).toEqual([]);

    // 1) İstek başlatma olayı: telefonda bilinçli wide isteği kayda düşer; wide olmayan düşmez.
    const DENETIM_GENIS = '/aile/src/admin/ui/wide/__f07-oz-denetim.wide.tsx';
    const DENETIM_DAR = '/aile/src/admin/ui/__f07-oz-denetim.tsx';
    await page.route(url => url.pathname === DENETIM_GENIS || url.pathname === DENETIM_DAR, route =>
      route.fulfill({ status: 200, contentType: 'text/javascript', body: 'export default 0;\n' }));
    await page.evaluate(async ([a, b]) => { await Promise.all([fetch(a), fetch(b)]); }, [DENETIM_GENIS, DENETIM_DAR] as const);
    expect(ag.genis.map(url => new URL(url).pathname), 'bilinçli wide isteği yakalanır, wide olmayan yakalanmaz').toEqual([DENETIM_GENIS]);

    // 2) Wide kapısı: tutulan modül yanıtı bırakılana kadar gelmez, bırakılınca gelir. Playwright en son kaydedilen
    //    route'u önce çalıştırır: kapı, yanıtı veren route'tan SONRA kurulur ki istek önce kapıya düşsün (testteki gibi).
    const GECIKEN = '/aile/src/admin/ui/wide/__f07-geciken.wide.js';
    await page.route(url => url.pathname === GECIKEN, route =>
      route.fulfill({ status: 200, contentType: 'text/javascript', body: 'export default 42;\n' }));
    const kapi = await genisKapisi(page);
    // `void`: evaluate sözü beklemesin (yanıt tutulurken beklemek kilitlenirdi); import sayfada arka planda sürer.
    await page.evaluate(`void import(${JSON.stringify(GECIKEN)}).then(m => { window.__f07Geciken = m.default; })`);
    await expect.poll(() => kapi.tutulan(), { message: 'wide kapısı isteği tutmalı' }).toBe(1);
    expect(await page.evaluate('window.__f07Geciken ?? null'), 'tutulan modül henüz çözülmedi').toBeNull();
    kapi.birak();
    await expect.poll(() => page.evaluate('window.__f07Geciken ?? null'), { message: 'bırakılan modül çözülür' }).toBe(42);

    // 3) Süreklilik/stale sondası: bilinçli ihlaller (yükleme iskeleti, telefonda kalıcı gezinme, main yeniden kurulumu).
    await sondaKur(page, { kimlik: true, mesgul: true });
    expect(await sondaIhlalleri(page), 'temiz başlangıç').toEqual([]);
    await page.evaluate(() => {
      const mesgul = document.createElement('div');
      mesgul.setAttribute('aria-busy', 'true');
      mesgul.textContent = 'öz denetim';
      document.body.append(mesgul);
      const nav = document.createElement('nav');
      nav.setAttribute('aria-label', 'Sayfalar');
      nav.textContent = 'öz denetim gezinmesi';
      document.body.append(nav);
      const main = document.querySelector('main#admin-content')!;
      main.replaceWith(main.cloneNode(true));
    });
    const ihlaller = await sondaIhlalleri(page);
    expect(ihlaller.some(m => /aria-busy/.test(m)), `yükleme iskeleti yakalanır: ${ihlaller.join(' | ')}`).toBe(true);
    expect(ihlaller.some(m => /stale/.test(m)), `telefonda kalıcı gezinme yakalanır: ${ihlaller.join(' | ')}`).toBe(true);
    expect(ihlaller.some(m => /main#admin-content yeniden kuruldu/.test(m)), `main yeniden kurulumu yakalanır: ${ihlaller.join(' | ')}`).toBe(true);

    // 4) Yeniden başlatma: belge yeniden yüklenince belge sayacı artar ve sonda kaybolur.
    const belge = ag.belge;
    await page.reload();
    await page.getByRole('main').waitFor();
    expect(ag.belge, 'yeniden yükleme belge sayacına düşer').toBe(belge + 1);
    expect(await sondaIhlalleri(page)).toEqual(['sonda kayboldu: sayfa yeniden yüklendi']);
  });
});
