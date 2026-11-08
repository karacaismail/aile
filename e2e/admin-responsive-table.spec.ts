import { test, expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { accentEdges, focusRing, overflow, selfCheckDetectors, smallText } from './admin-detectors';
import { horizontalOverflow, openAdmin, tabKey } from './admin-helpers';

// Duyarlı tablo (ResponsiveTable → Table / AccordionList) cihaz sözleşmesi; kalite hattı f04-table.
// Kaynak: aile-tasarim › tasarim-sistemi/README.md (Liste satırı ve tablo; cihaz tablosu), components/Table,
// ResponsiveTable ve AccordionList README'leri; kullanıcının kalıcı tablo kuralları (CLAUDE.md "Akışkan tablolar").
//   - Masaüstü (≥ 1024: 1440 ve 1024): tablo; ilk sütun yapışkan (ikinci değil); belge değil yalnız tablo kapsayıcısı
//     yatay kayar. Kaydırma dokunma, fare (yatay tekerlek / iz paneli) ve klavyeyle (Tab ile tabloya gir, sağ ok)
//     çalışır; kaydırınca ilk sütun yerinde kalır, belge (window.scrollX) kaymaz.
//   - Tablet (768): sığma kuralı. Gerekli genişlik = sütun minWidth toplamı + sütun başına 32 px; alan küçükse akordeon.
//   - Telefon (320 · 360 · 375 · 390, yatay telefon dahil; @matrix): akordeon, ilk satır açık, ok kutusu 32 px, açık /
//     kapalı ok kutusu dolgusu farklı, "ayrıntı için satıra dokunun" ipucu, geciken ("Gecikenler" / "Tarihi geçenler")
//     grup üstte; klavye modunda satır başlığında etiket genişliğinde tek alt çizgi.
//   - Her genişlikte: kelime ortasından bölünme yok (yalnız boşluk ve tire / eğik çizgi sonrasında sarılır), ilk sütunda
//     word-break: break-all / break-word, overflow-wrap: anywhere, line-break: anywhere yok; sayfa düzeyinde yatay
//     taşma yok; tablo alanında 14 px altı metin ve radiuslu kutuda kenar şeridi yok.
// Veri: yalnız sentetik nesil (fixtures/generation-synthetic). Alımlar'da 12 kaydın adı gerçekçi uzun sentetik ürün
// adıyla değiştirilir (parça yeniden yazılır, manifest sha256/bytes ve generation_id yeniden hesaplanır; panel bütünlük
// denetimi bu yüzden geçer). 127.0.0.1 dışındaki her istek kesilir: Google (GViz, Sheets, Apps Script) dahil ağa çıkılmaz.
// Saat sabit (2027-02-18): Ödemeler (tahmin olayları) grupları Tarihi geçenler · Bu hafta · aylar.
// Ortak kurallar admin-detectors.ts'ten (sahibi f09). Tabloya özgü dedektörler ve etkileşim adımları aşağıdaki bölgede;
// tarayıcıda locator.evaluate ile çalışırlar, bu yüzden her biri kendi içinde kapalıdır (dış değişken yok). Her biri
// "dedektör öz denetimi" bölümünde bilinçli ihlal enjekte edilerek kör olmadığı her motorda kanıtlanır.
// Dokunma: Chromium'da gerçek dokunma jesti (CDP Input.synthesizeScrollGesture, gestureSourceType touch). Playwright
// WebKit'te dokunmatik sürükleme API'si yoktur; orada dokunma sözleşmesi denetlenir (dokunulan noktada kaydırıcı,
// yol boyunca touch-action pan-x'e izin verir, touchstart/touchmove varsayılanı engellenmez).
// Klavye: Tab erişimi her iki motorda gerçek. Sağ okla gerçek yatay kaydırma Chromium'da ölçülür; Playwright WebKit odaklı
// kaydırıcıyı okla yalnız dikey kaydırır, yatay hiç kaydırmaz (belgeyi bile). WebKit'te klavye sözleşmesi denetlenir: odak
// taşan kaydırıcının içinde ve gerçek ArrowRight basışının varsayılanı engellenmiyor. Emülasyon gerçek cihaz değildir;
// gerçek iOS Safari / macOS Safari / Android bu dosyada koşmaz.
// Seçiciler role / erişilebilir ad ve bileşenin kendi data-layout / aria-* öznitelikleri; antd iç sınıfı kullanılmaz.

const SABIT_AN = new Date('2027-02-18T09:00:00+03:00');
const RTABLE = ':is([data-layout="table"], [data-layout="accordion"], [data-layout="list"])';
const IPUCU = 'ayrıntı için satıra dokunun';
const OK_KUTUSU_PX = 32;
const SUTUN_DOLGUSU = 32;

/** Gerçekçi uzun sentetik ürün adları (marka yok): uzun Türkçe sözcükler ve tiresiz model kodları. */
const UZUN_ADLAR = [
  'Ankastre Bulaşık Makinesi 60 cm Tam Entegre Sessiz Çalışma Modeli BMX6047TR',
  'Alttan Donduruculu No Frost Buzdolabı Çift Kapılı Gümüş RB38C7B6AS',
  'Akıllı Termostatik Banyo Bataryası Gömme Ankastre Set Krom Kaplama',
  'Blackout Karartma Perde Seti Çocuk Odası İçin Yanmaz Kumaş 280 cm',
  'Çalışma Masası Elektrikli Yükseklik Ayarlı Bellekli Kontrol Paneli 160x80',
  'Duvara Monte Katlanabilir Çamaşır Kurutmalık Paslanmaz Çelik 120 cm',
  'Ergonomik Ofis Koltuğu Bel Destekli Ayarlanabilir Kolçaklı Fileli Sırtlık',
  'Gömme Rezervuarlı Asma Klozet Takımı Yavaş Kapanan Kapaklı Kanalsız',
  'Hava Temizleme Cihazı HEPA H13 Filtreli 60 m² Kapasiteli Sessiz Mod',
  'Kablosuz Dikey Süpürge Değiştirilebilir Bataryalı Yerden Isıtma Uyumlu',
  'LED Şerit Aydınlatma Mutfak Tezgâh Altı Hareket Sensörlü 3000K 2 m',
  'Masif Meşe Yemek Masası Uzayabilir Altı Kişilik Doğal Yağ Kaplamalı',
] as const;
/** Ada göre (A–Z) varsayılan sıralamada ilk satır. */
const ILK_UZUN_AD = [...UZUN_ADLAR].sort((a, b) => a.localeCompare(b, 'tr-TR'))[0]!;

interface TabloSayfasi {
  ad: string;
  rota: string;
  baslik: string;
  /** Tablonun erişilebilir adı (görsel gizli caption). */
  tablo: string;
  ilkSutun: string;
  /** Masaüstü sütunlarının minWidth değerleri (sayfa kaynağıyla aynı sırada; sığma kuralı için). */
  sutunlar: readonly number[];
  uzunAdlar: boolean;
}

const ALIMLAR: TabloSayfasi = {
  ad: 'Alımlar',
  // Tablo modunun kanonik derin bağlantısı (buildAlimlarHash: "#/alimlar/?mod=table").
  rota: '/alimlar/?mod=table',
  baslik: 'Alımlar ve eşyalar',
  tablo: 'Alımlar ve eşyalar',
  ilkSutun: 'Alım',
  // Alım · Kimlik · Planlanan · Gerçekleşen · Durum · Oda · Ödeme durumu · Sorumlu · Kategori
  sutunlar: [200, 120, 136, 152, 160, 136, 152, 128, 192],
  uzunAdlar: true,
};

const ODEMELER: TabloSayfasi = {
  ad: 'Ödemeler',
  rota: '/odemeler',
  baslik: 'Ödemeler',
  tablo: 'Tahmini ödemeler',
  ilkSutun: 'Tarih',
  // Tarih · Ödeme · Planlanan · Gerçekleşen · Durum
  sutunlar: [112, 220, 128, 128, 160],
  uzunAdlar: false,
};

const BUTCE: TabloSayfasi = {
  ad: 'Bütçe',
  rota: '/butce',
  baslik: 'Bütçe ve nakit',
  tablo: 'Bütçe kalemleri',
  ilkSutun: 'Kalem',
  // Kalem · Planlanan · Gerçekleşen · Fark · Durum · Tür
  sutunlar: [200, 128, 136, 120, 136, 120],
  uzunAdlar: false,
};

const SAYFALAR: readonly TabloSayfasi[] = [ALIMLAR, ODEMELER, BUTCE];
const gerekliGenislik = (sayfa: TabloSayfasi) => sayfa.sutunlar.reduce((toplam, en) => toplam + en + SUTUN_DOLGUSU, 0);
/** W0 profil kuralı: genişlik < 600 ya da kısa kenar < 480 → telefon. */
const telefonMu = (boyut: { width: number; height: number } | null) => !!boyut && (boyut.width < 600 || Math.min(boyut.width, boyut.height) < 480);
const dokunmatik = (testInfo: TestInfo) => testInfo.project.use.hasTouch === true;

// --- Sentetik nesil (uzun adlı) ----------------------------------------------------------------------------------

const FIXTURE_KOKU = fileURLToPath(new URL('../fixtures/generation-synthetic/', import.meta.url));
const NESIL_ADI = /^[a-f0-9]{64}$/;
const sha256 = (metin: string) => createHash('sha256').update(metin, 'utf8').digest('hex');

interface ManifestDosyasi { path: string; sha256: string; bytes?: number; kind?: string; collection?: string }
interface Manifest { generation_id: string; files: ManifestDosyasi[] }
interface AlimKaydi { label?: string; deleted_at?: string | null; attributes?: Record<string, unknown> | null }
interface HazirNesil { dizin: string; kimlik: string; ozel: ReadonlyMap<string, string> }

let nesilSozu: Promise<HazirNesil> | null = null;

/** Sentetik nesli okur; purchase_needs parçasında 12 silinmemiş kaydın adını UZUN_ADLAR ile değiştirir. */
async function uzunAdliNesil(): Promise<HazirNesil> {
  const girdiler = await readdir(FIXTURE_KOKU, { withFileTypes: true });
  const ad = girdiler.find(girdi => girdi.isDirectory() && NESIL_ADI.test(girdi.name))?.name;
  if (!ad) throw new Error('fixtures/generation-synthetic altında nesil klasörü yok (node scripts/synthetic-generation.mjs)');
  const dizin = path.join(FIXTURE_KOKU, ad);
  const manifest = JSON.parse(await readFile(path.join(dizin, 'manifest.json'), 'utf8')) as Manifest;
  const parcalar = manifest.files.filter(dosya => dosya.kind === 'partition' && dosya.collection === 'purchase_needs');
  if (parcalar.length === 0) throw new Error('sentetik manifestte purchase_needs parçası yok');
  const ozel = new Map<string, string>();
  const kalan: string[] = [...UZUN_ADLAR];
  for (const dosya of parcalar) {
    const zarf = JSON.parse(await readFile(path.join(dizin, dosya.path), 'utf8')) as { records: AlimKaydi[] };
    for (const kayit of zarf.records) {
      if (kalan.length === 0) break;
      if (kayit.deleted_at) continue;
      const yeni = kalan.shift()!;
      kayit.label = yeni;
      if (kayit.attributes && typeof kayit.attributes.ad === 'string') kayit.attributes.ad = yeni;
    }
    const govde = `${JSON.stringify(zarf)}\n`;
    dosya.sha256 = sha256(govde);
    if (typeof dosya.bytes === 'number') dosya.bytes = Buffer.byteLength(govde, 'utf8');
    ozel.set(dosya.path, govde);
  }
  if (kalan.length > 0) throw new Error(`uzun adlar için yeterli silinmemiş alım kaydı yok (${kalan.length} ad kaldı)`);
  const kimlik = sha256(`f04-uzun-adlar:${manifest.generation_id}`);
  manifest.generation_id = kimlik;
  ozel.set('manifest.json', `${JSON.stringify(manifest)}\n`);
  return { dizin, kimlik, ozel };
}

/** /__aile/generation/* isteklerini uzun adlı sentetik nesilden yanıtlar; yerel olmayan her isteği keser. */
async function sentetikNesliSun(page: Page) {
  const { dizin, kimlik, ozel } = await (nesilSozu ??= uzunAdliNesil());
  await page.context().route(url => url.hostname !== '127.0.0.1' && url.hostname !== 'localhost', route => route.abort('blockedbyclient'));
  await page.route('**/__aile/generation/**', async route => {
    const json = (status: number, govde: unknown) =>
      route.fulfill({ status, contentType: 'application/json; charset=utf-8', headers: { 'cache-control': 'no-store' }, body: `${JSON.stringify(govde)}\n` });
    const yol = new URL(route.request().url()).pathname;
    let goreli: string;
    try {
      goreli = decodeURIComponent(yol.slice(yol.indexOf('/__aile/generation/') + '/__aile/generation/'.length));
    } catch {
      return json(400, { error: 'Geçersiz yol' });
    }
    if (goreli === '_meta') return json(200, { generation_id: kimlik, selectedAt: SABIT_AN.toISOString() });
    const bolutler = goreli.split('/');
    if (!goreli.endsWith('.json') || goreli.includes('\\') || bolutler.some(b => b === '' || b === '.' || b === '..')) return json(400, { error: 'Geçersiz yol' });
    const hazir = ozel.get(goreli);
    if (hazir !== undefined) {
      return route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', headers: { 'cache-control': 'no-store' }, body: hazir });
    }
    const hedef = path.resolve(dizin, goreli);
    if (!hedef.startsWith(`${dizin}${path.sep}`)) return json(400, { error: 'Geçersiz yol' });
    let govde: string;
    try {
      govde = await readFile(hedef, 'utf8');
    } catch {
      return json(404, { error: 'Bulunamadı' });
    }
    return route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', headers: { 'cache-control': 'no-store' }, body: govde });
  });
}

/** Sayfayı tam yükleme ve gerçek hazır sinyaliyle (openAdmin) açar; tek tablo alanını döndürür. */
async function tabloyuAc(page: Page, sayfa: TabloSayfasi): Promise<Locator> {
  await page.clock.setFixedTime(SABIT_AN);
  await sentetikNesliSun(page);
  const main = await openAdmin(page, sayfa.rota);
  await expect(main.getByRole('heading', { level: 1 })).toHaveText(sayfa.baslik);
  const alan = main.locator(RTABLE);
  await expect(alan, `${sayfa.ad}: tek tablo alanı (data-layout) bekleniyor`).toHaveCount(1);
  return alan;
}

// #region dedektorler
// Tarayıcıda (locator.evaluate) çalışır: dış kapsam yok, yalnız DOM API.

interface KaydirmaRaporu {
  ihlaller: string[];
  /** Tablo alandan geniş ve bir kapsayıcı kendi içinde kayıyor. */
  tasiyor: boolean;
}

interface AkordeonSecenekleri {
  ipucu: string;
  okKutusu: number;
}

interface KaydiriciOlcumu {
  var: boolean;
  scrollLeft: number;
  maxLeft: number;
  /** Kaydırıcının görünür kısmında, gövde satırları üstünde bir nokta (görünüm alanı koordinatı). */
  x: number;
  y: number;
}

/** Masaüstü tablosu: her başlık ve gövde satırında ilk hücre position: sticky, ikinci hücre değil. */
function detectStickyFirstColumn(root: Element): string[] {
  const ihlaller: string[] = [];
  let baslik = 0;
  let govde = 0;
  for (const satir of Array.from(root.querySelectorAll('tr'))) {
    if (satir.closest('[aria-hidden="true"]')) continue; // ölçüm satırı vb.
    const hucreler = Array.from(satir.children).filter(h => h.tagName === 'TD' || h.tagName === 'TH');
    if (hucreler.length < 2) continue; // boş durum (colspan) satırı
    const baslikSatiri = hucreler[0]!.tagName === 'TH';
    const ad = baslikSatiri ? `başlık satırı ${++baslik}` : `gövde satırı ${++govde}`;
    const ilk = getComputedStyle(hucreler[0]!).position;
    if (ilk !== 'sticky') ihlaller.push(`${ad}: ilk hücre yapışkan değil (position ${ilk})`);
    if (getComputedStyle(hucreler[1]!).position === 'sticky') ihlaller.push(`${ad}: ikinci hücre de yapışkan`);
  }
  if (baslik === 0) ihlaller.push('başlık satırı yok');
  if (govde === 0) ihlaller.push('gövde satırı yok');
  return ihlaller.slice(0, 8);
}

/** Belge yatay taşmaz; tablo alanı görünür alanda kalır; tablo alandan genişse taşma bir kapsayıcının içinde kayar. */
function detectScrollContainment(root: Element): KaydirmaRaporu {
  const ihlaller: string[] = [];
  const belge = document.documentElement;
  if (belge.scrollWidth > belge.clientWidth + 1) ihlaller.push(`belge yatay taşıyor: ${belge.scrollWidth}>${belge.clientWidth}`);
  const kaydirir = (el: Element) => ['auto', 'scroll'].includes(getComputedStyle(el).overflowX);
  const kaydiricilar = [root, ...Array.from(root.querySelectorAll('*'))].filter(kaydirir) as HTMLElement[];
  if (kaydiricilar.length === 0) ihlaller.push('tablo kapsayıcısı kaydırılamaz: overflow-x auto/scroll yok');
  const alan = root.getBoundingClientRect();
  if (alan.right > window.innerWidth + 1) ihlaller.push(`tablo alanı görünür alanı aşıyor: right=${Math.round(alan.right)}`);
  const tablolar = Array.from(root.querySelectorAll('table'));
  const enGenisTablo = Math.max(0, ...tablolar.map(t => t.getBoundingClientRect().width));
  const tasiyor = kaydiricilar.some(el => el.scrollWidth > el.clientWidth + 1);
  if (enGenisTablo > alan.width + 1 && !tasiyor) {
    // Tanı: en geniş tablodan alana kadar her ata (genişlik / scrollWidth / clientWidth, overflow-x).
    const zincir: string[] = [];
    let el: Element | null = tablolar.find(t => t.getBoundingClientRect().width === enGenisTablo) ?? null;
    for (; el && el !== root.parentElement; el = el.parentElement) {
      const sinif = typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/)[0]}` : '';
      zincir.push(`${el.tagName.toLowerCase()}${sinif} ${Math.round(el.getBoundingClientRect().width)}/${el.scrollWidth}/${el.clientWidth} ${getComputedStyle(el).overflowX}`);
    }
    ihlaller.push(`tablo (${Math.round(enGenisTablo)} px) alandan (${Math.round(alan.width)} px) geniş ama hiçbir kapsayıcı kaymıyor; zincir (en/scroll/client overflow-x): ${zincir.join(' › ')}`);
  }
  return { ihlaller: ihlaller.slice(0, 8), tasiyor };
}

/**
 * Yapışkan başlık gövdeyle hizalı: başlık satırının her hücresi ilk gövde satırındaki aynı sıradaki hücreyle aynı sol ve
 * sağ kenarda (±1.5 px). Başlık ayrı tabloda çizildiğinde (yapışkan başlık) sütunların kaymasını yakalar. Sondaki boş,
 * dar (< 24 px) başlık hücresi kaydırma çubuğu payıdır, sayılmaz.
 */
function detectColumnAlignment(root: Element): string[] {
  const hucreler = (tr: Element) => Array.from(tr.children).filter(h => h.tagName === 'TD' || h.tagName === 'TH');
  const satirlar = Array.from(root.querySelectorAll('tr')).filter(tr => !tr.closest('[aria-hidden="true"]'));
  const baslikSatiri = satirlar.find(tr => tr.querySelector('th') && !tr.querySelector('td'));
  const govdeSatiri = satirlar.find(tr => !tr.querySelector('th') && hucreler(tr).length > 1);
  if (!baslikSatiri || !govdeSatiri) return [];
  const baslik = hucreler(baslikSatiri);
  while (baslik.length > 0) {
    const son = baslik[baslik.length - 1]!;
    if ((son.textContent ?? '').trim() === '' && son.getBoundingClientRect().width < 24) baslik.pop();
    else break;
  }
  const govde = hucreler(govdeSatiri);
  if (baslik.length !== govde.length) return [`başlıkta ${baslik.length}, gövdede ${govde.length} hücre`];
  const ihlaller: string[] = [];
  baslik.forEach((hucre, i) => {
    const b = hucre.getBoundingClientRect();
    const g = govde[i]!.getBoundingClientRect();
    if (Math.abs(b.left - g.left) > 1.5 || Math.abs(b.right - g.right) > 1.5) {
      ihlaller.push(`sütun ${i + 1} (${(hucre.textContent ?? '').trim()}): başlık ${Math.round(b.left)}–${Math.round(b.right)}, gövde ${Math.round(g.left)}–${Math.round(g.right)}`);
    }
  });
  return ihlaller.slice(0, 8);
}

/** Kapsayıcı kaydırıldıktan sonra: ilk hücre kaydırıcının sol kenarında kalır, ikinci hücre altından kayar. */
function detectFirstColumnStaysVisible(root: Element): string[] {
  const ihlaller: string[] = [];
  const kirpar = (el: Element) => ['auto', 'scroll', 'hidden', 'clip'].includes(getComputedStyle(el).overflowX);
  let denetlenen = 0;
  for (const satir of Array.from(root.querySelectorAll('tr'))) {
    if (denetlenen >= 4) break;
    if (satir.closest('[aria-hidden="true"]')) continue;
    const hucreler = Array.from(satir.children).filter(h => h.tagName === 'TD' || h.tagName === 'TH');
    if (hucreler.length < 2) continue;
    denetlenen += 1;
    let kaydirici: Element | null = satir.parentElement;
    while (kaydirici && root.contains(kaydirici) && !kirpar(kaydirici)) kaydirici = kaydirici.parentElement;
    if (!kaydirici || !root.contains(kaydirici)) {
      ihlaller.push(`satır ${denetlenen}: tablo alanında kaydırıcı yok`);
      continue;
    }
    if ((kaydirici as HTMLElement).scrollLeft < 1) {
      ihlaller.push(`satır ${denetlenen}: kapsayıcı kaydırılmamış (scrollLeft 0)`);
      continue;
    }
    const kap = kaydirici.getBoundingClientRect();
    const ilk = hucreler[0]!.getBoundingClientRect();
    const ikinci = hucreler[1]!.getBoundingClientRect();
    if (Math.abs(ilk.left - kap.left) > 1.5) {
      ihlaller.push(`satır ${denetlenen}: ilk hücre kaydırıcıyla kaydı (sol ${Math.round(ilk.left)}, kapsayıcı ${Math.round(kap.left)})`);
    }
    if (ikinci.left >= ilk.right - 1) ihlaller.push(`satır ${denetlenen}: içerik kaymadı (ikinci hücre ilk hücrenin altına girmedi)`);
  }
  if (denetlenen === 0) ihlaller.push('denetlenecek satır yok');
  return ihlaller.slice(0, 8);
}

/**
 * Kelime ortası bölünme: alandaki her görünür metin düğümünde boşlukla ayrılan her sözcük tek satırda olmalı. Tire ve
 * eğik çizgi sonrası doğal kırılma noktasıdır (parçalar ayrı denetlenir). 16+ hane onaltılık kimlik ve URL sözcük
 * sayılmaz. Ölçü: sözcük aralığının (Range) satır kutuları; birden çok satıra düşen sözcük ihlaldir.
 */
function detectMidWordBreaks(root: Element): string[] {
  const ihlaller: string[] = [];
  const ayirici = /[-‐‑–—/]/;
  const kimlikMi = (s: string) => /^[0-9a-f]{16,}$/i.test(s) || /^https?:\/\//i.test(s);
  const aralik = document.createRange();
  const yuruyucu = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let dugum = yuruyucu.nextNode(); dugum; dugum = yuruyucu.nextNode()) {
    const ebeveyn = dugum.parentElement;
    if (!ebeveyn || ebeveyn.closest('[aria-hidden="true"], [hidden]')) continue;
    const metin = dugum.textContent ?? '';
    const sozcukler = /\S+/g;
    for (let eslesme = sozcukler.exec(metin); eslesme; eslesme = sozcukler.exec(metin)) {
      const sozcuk = eslesme[0];
      if (kimlikMi(sozcuk)) continue;
      const parcalar: Array<[number, number]> = [];
      let bas = eslesme.index;
      for (let i = 0; i < sozcuk.length - 1; i++) {
        if (ayirici.test(sozcuk[i]!)) {
          parcalar.push([bas, eslesme.index + i + 1]);
          bas = eslesme.index + i + 1;
        }
      }
      parcalar.push([bas, eslesme.index + sozcuk.length]);
      for (const [baslangic, bitis] of parcalar) {
        if (bitis - baslangic < 2) continue;
        aralik.setStart(dugum, baslangic);
        aralik.setEnd(dugum, bitis);
        const ustler = Array.from(aralik.getClientRects())
          .filter(kutu => kutu.width > 0.5 && kutu.height > 0.5)
          .map(kutu => kutu.top)
          .sort((a, b) => a - b);
        let satir = ustler.length > 0 ? 1 : 0;
        for (let i = 1; i < ustler.length; i++) if (ustler[i]! - ustler[i - 1]! > 4) satir += 1;
        if (satir > 1) ihlaller.push(`"${metin.slice(baslangic, bitis)}" ${satir} satıra bölünmüş (${ebeveyn.tagName.toLowerCase()})`);
      }
    }
  }
  return Array.from(new Set(ihlaller)).slice(0, 12);
}

/**
 * İlk sütunda zorlayıcı kırma yok: tablo satırlarının ilk hücresi (başlık dahil) ve akordeonda satır başlığı (kapalıyken
 * görünen ad) ile tüm alt öğelerinde word-break break-all / break-word, overflow-wrap anywhere, line-break anywhere yasak.
 */
function detectForcedBreaks(root: Element): string[] {
  const ihlaller: string[] = [];
  const hedefler: Element[] = [];
  for (const satir of Array.from(root.querySelectorAll('tr'))) {
    if (satir.closest('[aria-hidden="true"]')) continue;
    const ilk = Array.from(satir.children).find(h => h.tagName === 'TD' || h.tagName === 'TH');
    if (ilk) hedefler.push(ilk);
  }
  // Akordeon / düz liste: her satırın başlığı (açılır düğme ya da satırın ilk öğesi).
  hedefler.push(...Array.from(root.querySelectorAll('button[aria-expanded], li > :first-child')));
  if (hedefler.length === 0) return ['ilk sütun / satır başlığı bulunamadı'];
  for (const hedef of Array.from(new Set(hedefler))) {
    for (const el of [hedef, ...Array.from(hedef.querySelectorAll('*'))]) {
      const stil = getComputedStyle(el);
      const ad = `${el.tagName.toLowerCase()}[${(hedef.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 24)}]`;
      if (stil.wordBreak === 'break-all' || stil.wordBreak === 'break-word') ihlaller.push(`${ad}: word-break ${stil.wordBreak}`);
      if (stil.overflowWrap === 'anywhere') ihlaller.push(`${ad}: overflow-wrap anywhere`);
      if (stil.lineBreak === 'anywhere') ihlaller.push(`${ad}: line-break anywhere`);
    }
  }
  return Array.from(new Set(ihlaller)).slice(0, 10);
}

/** Telefon akordeonu: ilk satır açık, aria-controls bağlı, ok kutusu ölçüsü, açık/kapalı dolgu farkı, ipucu, geciken grup üstte. */
function detectAccordion(root: Element, secenek: AkordeonSecenekleri): string[] {
  const ihlaller: string[] = [];
  const basliklar = Array.from(root.querySelectorAll('button[aria-expanded]'));
  if (basliklar.length === 0) return ['açılır satır yok (button[aria-expanded])'];
  const gizli = (el: Element) => (el as HTMLElement).hidden || getComputedStyle(el).display === 'none';

  if (basliklar[0]!.getAttribute('aria-expanded') !== 'true') ihlaller.push('ilk satır kapalı (aria-expanded true değil)');
  basliklar.forEach((baslik, i) => {
    const kimlik = baslik.getAttribute('aria-controls');
    const panel = kimlik ? document.getElementById(kimlik) : null;
    if (!panel) {
      ihlaller.push(`satır ${i + 1}: aria-controls paneli yok`);
      return;
    }
    const acik = baslik.getAttribute('aria-expanded') === 'true';
    if (acik === gizli(panel)) ihlaller.push(`satır ${i + 1}: aria-expanded ${acik} ama panel ${acik ? 'gizli' : 'görünür'}`);
  });

  // Ok kutusu: satır düğmesinin sondaki doğrudan çocuğu olan aria-hidden süsleyici (svg değil, svg taşıyan).
  const okKutusu = (baslik: Element) =>
    Array.from(baslik.children)
      .reverse()
      .find(el => el.getAttribute('aria-hidden') === 'true' && el.tagName.toLowerCase() !== 'svg' && el.querySelector('svg') !== null) ?? null;
  const dolgular = new Map<boolean, string>();
  basliklar.forEach((baslik, i) => {
    const kutu = okKutusu(baslik);
    if (!kutu) {
      ihlaller.push(`satır ${i + 1}: ok kutusu yok`);
      return;
    }
    const { width, height } = kutu.getBoundingClientRect();
    if (Math.abs(width - secenek.okKutusu) > 0.5 || Math.abs(height - secenek.okKutusu) > 0.5) {
      ihlaller.push(`satır ${i + 1}: ok kutusu ${Math.round(width)}x${Math.round(height)} px, beklenen ${secenek.okKutusu}`);
    }
    const acik = baslik.getAttribute('aria-expanded') === 'true';
    if (!dolgular.has(acik)) dolgular.set(acik, getComputedStyle(kutu).backgroundColor);
  });
  if (dolgular.has(true) && dolgular.has(false) && dolgular.get(true) === dolgular.get(false)) {
    ihlaller.push(`açık ve kapalı ok kutusu aynı dolgu (${dolgular.get(true)}): açık hâl yalnız ok yönüyle anlatılıyor`);
  }

  const metin = (root.textContent ?? '').replace(/\s+/g, ' ');
  if (!metin.includes(secenek.ipucu)) ihlaller.push(`açılabilirlik ipucu yok ("${secenek.ipucu}")`);

  // Geciken grup: "Gecikenler" ya da ödeme gerçeği bilinmeyen tahmin olaylarının "Tarihi geçenler"i. Grup başlığı h2–h6.
  const gruplar = Array.from(root.querySelectorAll('section > :is(h2, h3, h4, h5, h6)')).map(h => (h.firstChild?.textContent ?? '').trim());
  const geciken = gruplar.findIndex(ad => /gecik|tarihi geç/.test(ad.toLocaleLowerCase('tr-TR')));
  if (geciken > 0) ihlaller.push(`geciken grup üstte değil (sıra: ${gruplar.join(' · ')})`);
  return ihlaller.slice(0, 10);
}

/** Alandaki ilk taşan yatay kaydırıcının durumu ve gövde satırları üstünde görünür bir hedef nokta. */
function kaydiriciOlcumu(root: Element): KaydiriciOlcumu {
  const adaylar = [root, ...Array.from(root.querySelectorAll('*'))] as HTMLElement[];
  const s = adaylar.find(el => ['auto', 'scroll'].includes(getComputedStyle(el).overflowX) && el.scrollWidth > el.clientWidth + 1);
  if (!s) return { var: false, scrollLeft: 0, maxLeft: 0, x: 0, y: 0 };
  const kutu = s.getBoundingClientRect();
  return {
    var: true,
    scrollLeft: s.scrollLeft,
    maxLeft: s.scrollWidth - s.clientWidth,
    x: Math.round(kutu.left + kutu.width * 0.6),
    y: Math.round(Math.min(Math.max(kutu.top, 0) + 48, window.innerHeight - 8)),
  };
}

/** Belgeyi dikeyde kaydırıp taşan kaydırıcının üst kenarını görünüm alanının 160 px altına getirir (hazırlık adımı). */
function kaydiriciyiGetir(root: Element): void {
  const adaylar = [root, ...Array.from(root.querySelectorAll('*'))] as HTMLElement[];
  const s = adaylar.find(el => ['auto', 'scroll'].includes(getComputedStyle(el).overflowX) && el.scrollWidth > el.clientWidth + 1);
  if (!s) return;
  window.scrollTo(0, Math.max(0, window.scrollY + s.getBoundingClientRect().top - 160));
}

/**
 * Dokunma sözleşmesi (iki motorda; WebKit'te gerçek jestin yerine): dokunulan noktada taşan kaydırıcı var; noktadan
 * kaydırıcıya kadar touch-action yatay kaydırmaya (pan-x) izin veriyor; touchstart / touchmove varsayılanı sayfa betiğince
 * engellenmiyor (engellenirse tarayıcı yerel kaydırmayı başlatmaz).
 */
function dokunmaSozlesmesi(root: Element): string[] {
  const ihlaller: string[] = [];
  const adaylar = [root, ...Array.from(root.querySelectorAll('*'))] as HTMLElement[];
  const s = adaylar.find(el => ['auto', 'scroll'].includes(getComputedStyle(el).overflowX) && el.scrollWidth > el.clientWidth + 1);
  if (!s) return ['taşan yatay kaydırıcı yok'];
  const kutu = s.getBoundingClientRect();
  const x = kutu.left + kutu.width * 0.6;
  const y = Math.min(Math.max(kutu.top, 0) + 48, window.innerHeight - 8);
  const hedef = document.elementFromPoint(x, y);
  if (!hedef || !s.contains(hedef)) return [`dokunma noktasında kaydırıcı değil ${hedef ? hedef.tagName.toLowerCase() : 'hiçbir öğe'} var`];
  for (let el: Element | null = hedef; el; el = el.parentElement) {
    const deger = getComputedStyle(el).touchAction;
    if (!(deger === 'auto' || deger === 'manipulation' || /pan-x/.test(deger))) {
      ihlaller.push(`${el.tagName.toLowerCase()}: touch-action ${deger} yatay kaydırmaya izin vermiyor`);
    }
    if (el === s) break;
  }
  for (const tur of ['touchstart', 'touchmove']) {
    const olay = typeof TouchEvent === 'function'
      ? new TouchEvent(tur, { bubbles: true, cancelable: true, composed: true })
      : new Event(tur, { bubbles: true, cancelable: true, composed: true });
    hedef.dispatchEvent(olay);
    if (olay.defaultPrevented) ihlaller.push(`${tur} varsayılanı engelleniyor: dokunmayla yerel kaydırma başlamaz`);
  }
  return ihlaller;
}

/** Tablo alanından hemen önceki sekme durağına (belge sırasıyla) programla odaklanır; Tab bu noktadan ilerletilir. */
function oncekiSekmeDuraginaOdaklan(root: Element): string | null {
  const sekmeli = (el: Element) => {
    const h = el as HTMLElement & { disabled?: boolean };
    return h.tabIndex >= 0 && !h.disabled && !h.closest('[inert]') && h.getClientRects().length > 0 && getComputedStyle(h).visibility !== 'hidden';
  };
  const oncekiler = Array.from(document.querySelectorAll('*')).filter(
    el => sekmeli(el) && !el.contains(root) && !root.contains(el) && (el.compareDocumentPosition(root) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
  );
  const onceki = oncekiler[oncekiler.length - 1] as HTMLElement | undefined;
  if (!onceki) return null;
  onceki.focus();
  if (document.activeElement !== onceki) return null;
  return `${onceki.tagName.toLowerCase()}[${(onceki.getAttribute('aria-label') ?? onceki.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 32)}]`;
}

/**
 * Gerçek tuş basışlarının keydown olaylarını pencerenin yakalama evresinde saklar (sayfa betiğinden önce). Olay nesnesi
 * dağıtım bittikten sonra okunur: sayfa betiği varsayılanı engellediyse defaultPrevented true kalır.
 */
function tusKaydediciKur(): void {
  // Her çağrıda yeni dinleyici ve yeni dizi: setContent (document.open) pencere dinleyicilerini siler ama pencere
  // özelliğini bırakır; eski diziye bakmak kaydı kör ederdi.
  const w = window as Window & { __f04Tuslar?: KeyboardEvent[] };
  const kayit: KeyboardEvent[] = [];
  w.__f04Tuslar = kayit;
  window.addEventListener('keydown', olay => kayit.push(olay), { capture: true });
}

/**
 * Klavye sözleşmesi (WebKit'te gerçek yatay ok kaydırmasının yerine; Playwright WebKit odaklı kaydırıcıyı okla yalnız
 * dikey kaydırır, yatay hiç kaydırmaz): odak taşan yatay kaydırıcının kendisinde ya da içinde (tarayıcının klavye kaydırma
 * hedefi odağın en yakın kaydırılabilir atasıdır); kaydedilen ArrowRight basışlarının varsayılanı sayfa betiğince
 * engellenmedi.
 */
function klavyeSozlesmesi(root: Element): string[] {
  const ihlaller: string[] = [];
  const adaylar = [root, ...Array.from(root.querySelectorAll('*'))] as HTMLElement[];
  const s = adaylar.find(el => ['auto', 'scroll'].includes(getComputedStyle(el).overflowX) && el.scrollWidth > el.clientWidth + 1);
  if (!s) return ['taşan yatay kaydırıcı yok'];
  const odak = document.activeElement;
  if (!odak || !s.contains(odak)) ihlaller.push(`odak taşan kaydırıcıda değil (${odak ? odak.tagName.toLowerCase() : 'yok'})`);
  const kayit = (window as Window & { __f04Tuslar?: KeyboardEvent[] }).__f04Tuslar ?? [];
  const saglar = kayit.filter(olay => olay.key === 'ArrowRight');
  if (saglar.length === 0) ihlaller.push('ArrowRight olayı kaydedilmedi');
  else if (saglar.some(olay => olay.defaultPrevented)) ihlaller.push('ArrowRight varsayılanı engelleniyor: ok tuşu tabloyu kaydırmaz');
  return ihlaller;
}

/** Odak alanın içinde mi; değilse nerede. */
function odakNerede(root: Element): { icinde: boolean; odak: string } {
  const a = document.activeElement;
  if (!a) return { icinde: false, odak: 'yok' };
  const ad = (a.getAttribute('aria-label') ?? a.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 32);
  return { icinde: root.contains(a), odak: `${a.tagName.toLowerCase()}[${ad}]` };
}

interface TabloOrnegi {
  yapiskan?: boolean;
  kapsayici?: boolean;
}

/** Öz denetim örneği: yapışkan ilk sütunlu, kendi kapsayıcısında kayan (ya da kaymayan) tablo. */
function tabloOrnegi({ yapiskan = true, kapsayici = true }: TabloOrnegi = {}): string {
  const ilk = yapiskan ? 'position:sticky;left:0;background:#fff;' : '';
  const genislik = kapsayici ? 900 : 3000;
  const satir = (i: number) =>
    `<tr><td style="${ilk}width:160px">Satır ${i}</td><td style="width:240px">B${i}</td><td style="width:240px">C${i}</td><td>D${i}</td></tr>`;
  const tablo =
    `<table aria-label="Örnek" style="width:${genislik}px;border-collapse:collapse;table-layout:fixed">` +
    `<thead><tr><th style="${ilk}width:160px">Ad</th><th style="width:240px">B</th><th style="width:240px">C</th><th>D</th></tr></thead>` +
    `<tbody><tr aria-hidden="true"><td></td><td></td><td></td><td></td></tr>${[1, 2, 3].map(satir).join('')}</tbody></table>`;
  const ic = kapsayici ? `<div style="overflow-x:auto;width:400px">${tablo}</div>` : tablo;
  return `<div data-layout="table" style="width:400px">${ic}</div>`;
}

/** Öz denetim örneği: başlık ve gövde ayrı tablolarda (yapışkan başlık düzeni); kayik ise sütun kenarları uyuşmaz. */
function hizaOrnegi(kayik: boolean): string {
  const [ilk, ikinci] = kayik ? [200, 200] : [160, 240];
  const tablo = (ic: string) => `<table style="border-collapse:collapse;table-layout:fixed;width:400px">${ic}</table>`;
  return (
    '<div data-layout="table" style="width:400px;font:16px/24px sans-serif">' +
    tablo(`<thead><tr><th style="width:${ilk}px;padding:0">Ad</th><th style="width:${ikinci}px;padding:0">Tutar</th></tr></thead>`) +
    tablo('<tbody><tr><td style="width:160px;padding:0">Satır</td><td style="width:240px;padding:0">₺8.500,00</td></tr></tbody>') +
    '</div>'
  );
}

interface AkordeonOrnegi {
  ilkAcik?: boolean;
  okKutusu?: number;
  gecikenUstte?: boolean;
  /** Geciken grubun adı (Gecikenler ya da tahmin olaylarının "Tarihi geçenler"i). */
  gecikenAdi?: string;
  ipucu?: boolean;
  ayniDolgu?: boolean;
}

/** Öz denetim örneği: iki gruplu akordeon (geciken grup · Sonra). */
function akordeonOrnegi({ ilkAcik = true, okKutusu = 32, gecikenUstte = true, gecikenAdi = 'Gecikenler', ipucu = true, ayniDolgu = false }: AkordeonOrnegi = {}): string {
  const kutu = (acik: boolean) => {
    const dolgu = acik && !ayniDolgu ? 'rgb(0, 82, 204)' : 'rgb(255, 255, 255)';
    return `<span aria-hidden="true" style="display:grid;width:${okKutusu}px;height:${okKutusu}px;background-color:${dolgu}"><svg aria-hidden="true" width="20" height="20"></svg></span>`;
  };
  const satir = (kimlik: string, ad: string, acik: boolean) =>
    `<li><button type="button" aria-expanded="${acik}" aria-controls="${kimlik}"><span>${ad}</span>${kutu(acik)}</button>` +
    `<div id="${kimlik}"${acik ? '' : ' hidden'}><dl><dt>Gerçekleşen</dt><dd>Henüz yok</dd></dl></div></li>`;
  const grup = (ad: string, kimlik: string, acik: boolean) =>
    `<section aria-label="${ad}"><h3>${ad}<span>1</span></h3><ul>${satir(kimlik, `${ad} satırı`, acik)}</ul></section>`;
  const geciken = grup(gecikenAdi, 'ornek-geciken', gecikenUstte && ilkAcik);
  const sonra = grup('Sonra', 'ornek-sonra', !gecikenUstte && ilkAcik);
  const ust = `<div><p>2 kayıt${ipucu ? ' · ayrıntı için satıra dokunun' : ''}</p><button type="button">Tümünü aç</button></div>`;
  return `<div data-layout="accordion">${ust}${gecikenUstte ? geciken + sonra : sonra + geciken}</div>`;
}

/** Öz denetim örneği: dar sütunlu tablo; ilk sütunun kırma kuralı ve genişliği seçilebilir. */
function kelimeOrnegi(ilkSutunStili: string): string {
  return (
    '<div data-layout="table" style="width:320px;font:16px/24px sans-serif"><table style="border-collapse:collapse;table-layout:fixed;width:300px">' +
    `<thead><tr><th style="width:96px;${ilkSutunStili}">Değiştirilebilir</th><th>Tutar</th></tr></thead>` +
    `<tbody><tr><td style="width:96px;${ilkSutunStili}">Kablosuz Dikey Süpürge</td><td>₺8.500,00</td></tr></tbody></table></div>`
  );
}

interface KaydirmaOrnegi {
  /** Kaydırıcı sekme durağı (tabindex 0). */
  odaklanir?: boolean;
  /** overflow-x: false ise hidden (kullanıcı kaydıramaz). */
  kayar?: boolean;
  /** Kaydırıcının touch-action değeri. */
  dokunma?: string;
}

/** Öz denetim örneği: önce / sonra düğmeleri arasında yapışkan ilk sütunlu, kendi içinde kayan 1200 px tablo. */
function kaydirmaOrnegi({ odaklanir = true, kayar = true, dokunma = 'auto' }: KaydirmaOrnegi = {}): string {
  const ilk = 'position:sticky;left:0;background:#fff;';
  const satir = (i: number) =>
    `<tr><td style="${ilk}width:160px;height:40px">Satır ${i}</td><td style="width:340px">B${i}</td><td style="width:340px">C${i}</td><td>D${i}</td></tr>`;
  const tablo =
    '<table style="width:1200px;border-collapse:collapse;table-layout:fixed">' +
    `<thead><tr><th style="${ilk}width:160px">Ad</th><th style="width:340px">B</th><th style="width:340px">C</th><th>D</th></tr></thead>` +
    `<tbody>${[1, 2, 3, 4, 5, 6].map(satir).join('')}</tbody></table>`;
  const sekme = odaklanir ? ' tabindex="0"' : '';
  return (
    '<main style="padding:24px;font:16px/24px sans-serif"><button type="button">önce</button>' +
    `<div data-layout="table" style="width:420px;margin:16px 0"><div${sekme} style="overflow-x:${kayar ? 'auto' : 'hidden'};touch-action:${dokunma};width:420px">${tablo}</div></div>` +
    '<button type="button">sonra</button><div style="height:1200px"></div></main>'
  );
}
/**
 * Akordeon satır başlığının etiket odak çizgisi (klavye modu, odaklı başlık = document.activeElement): odaklı öğe ve
 * içinde tam bir görünür 3 px ::after çizgisi; çizgi konağının (etiket) kutusu genişliğinde, etiket metninin bütün
 * satırlarını kaplar ve son satırın altında durur. Satıra sarılan satır içi (inline) konakta ::after'ın kapsayıcı bloğu
 * ilk ve son satır parçasından kurulur: çizgi metinden dar kalır (Chromium) ya da 0 px olur (WebKit, blok içerik).
 */
function detectLabelFocusLine(root: Element): string[] {
  const odak = document.activeElement;
  if (!odak || odak === document.body || !root.contains(odak)) return ['odak alanın içinde değil'];
  const px = (deger: string) => { const n = parseFloat(deger); return Number.isFinite(n) ? n : 0; };
  const kalinlik = px(getComputedStyle(odak).getPropertyValue('--aile-odak-kalinlik')) || 3;
  const saydam = (renk: string) => !renk || renk === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(renk);
  const cizgiler = [odak, ...Array.from(odak.querySelectorAll('*'))].filter(el => {
    const ps = getComputedStyle(el, '::after');
    if (!ps.content || ps.content === 'none' || ps.content === 'normal') return false;
    if (ps.display === 'none' || ps.visibility === 'hidden') return false;
    if (Math.abs(px(ps.height) - kalinlik) > 0.5 || saydam(ps.backgroundColor)) return false;
    return Number(ps.opacity) >= 0.5;
  });
  const ad = (odak.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 32);
  if (cizgiler.length !== 1) return [`"${ad}": görünür odak çizgisi ${cizgiler.length} (beklenen 1)`];
  const konak = cizgiler[0]!;
  const ps = getComputedStyle(konak, '::after');
  const cizgi = px(ps.width);
  const kutu = konak.getBoundingClientRect();
  const aralik = document.createRange();
  aralik.selectNodeContents(konak);
  const satirlar = Array.from(aralik.getClientRects()).filter(r => r.width > 0 && r.height > 0);
  const ihlaller: string[] = [];
  const yuvarla = (n: number) => Math.round(n * 10) / 10;
  if (Math.abs(cizgi - kutu.width) > 1) ihlaller.push(`"${ad}": çizgi ${yuvarla(cizgi)} px, etiket kutusu ${yuvarla(kutu.width)} px`);
  if (satirlar.length > 0) {
    const metin = Math.max(...satirlar.map(r => r.right)) - Math.min(...satirlar.map(r => r.left));
    if (cizgi + 1 < metin) ihlaller.push(`"${ad}": çizgi ${yuvarla(cizgi)} px, etiket metni ${yuvarla(metin)} px (${new Set(satirlar.map(r => Math.round(r.top))).size} satır)`);
    const cizgiUst = kutu.bottom - px(ps.bottom) - px(ps.height);
    const metinAlt = Math.max(...satirlar.map(r => r.bottom));
    if (cizgiUst + 0.5 < metinAlt) ihlaller.push(`"${ad}": çizgi metnin üstünde (çizgi üstü ${yuvarla(cizgiUst)}, metin altı ${yuvarla(metinAlt)})`);
  }
  return ihlaller;
}

/** Öz denetim örneği: odaklanabilir satır başlığında etiket çizgili, 120 px'te üç satıra sarılan ad. */
function etiketCizgisiOrnegi(gosterim: 'inline' | 'block'): string {
  return (
    '<style>.ornek-ul{position:relative}.ornek-ul::after{content:"";position:absolute;left:0;right:0;bottom:-4px;height:3px;background:rgb(0,82,204)}</style>' +
    '<div data-layout="accordion" style="width:120px;font:16px/24px sans-serif"><ul style="list-style:none;margin:0;padding:0"><li>' +
    '<button type="button" aria-expanded="true" style="display:block;width:120px;margin:0;padding:0 0 8px;border:0;background:none;font:inherit;text-align:left">' +
    `<span style="display:block"><span class="ornek-ul" style="display:${gosterim}">Karartma perde seti çocuk odası a</span></span>` +
    '</button></li></ul></div>'
  );
}
// #endregion dedektorler

// --- Etkileşim adımları (gerçek giriş; sonuç ayrı doğrulanır) ----------------------------------------------------

/** Fare / iz paneli: kaydırıcının görünür gövdesi üstünde yatay tekerlek (deltaX). */
async function fareIleKaydir(page: Page, alan: Locator) {
  await alan.evaluate(kaydiriciyiGetir);
  const olcu = await alan.evaluate(kaydiriciOlcumu);
  expect(olcu.var, 'taşan yatay kaydırıcı bekleniyor').toBe(true);
  await page.mouse.move(olcu.x, olcu.y);
  await page.mouse.wheel(240, 0);
}

/** Dokunma (Chromium): gerçek dokunmatik kaydırma jesti; parmak sola 220 px sürüklenir. */
async function dokunarakKaydir(page: Page, alan: Locator) {
  await alan.evaluate(kaydiriciyiGetir);
  const olcu = await alan.evaluate(kaydiriciOlcumu);
  expect(olcu.var, 'taşan yatay kaydırıcı bekleniyor').toBe(true);
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('Input.synthesizeScrollGesture', {
      x: olcu.x, y: olcu.y, xDistance: -220, yDistance: 0, gestureSourceType: 'touch', speed: 1200, preventFling: true,
    });
  } finally {
    await cdp.detach();
  }
}

/** Klavye: alandan önceki sekme durağından Tab (WebKit: Alt+Tab); döner: odak alanın içine girdi mi. */
async function klavyeyleAlanaGir(page: Page, alan: Locator, browserName: string) {
  await alan.evaluate(kaydiriciyiGetir);
  const onceki = await alan.evaluate(oncekiSekmeDuraginaOdaklan);
  expect(onceki, 'tablo alanından önce sekme durağı bekleniyor').not.toBeNull();
  await page.keyboard.press(tabKey(browserName));
  return { onceki, ...(await alan.evaluate(odakNerede)) };
}

/** Sağ ok üç kez (her basış varsayılan kaydırma adımı); keydown olayları kaydedilir (klavye sözleşmesi için). */
async function sagOk(page: Page) {
  await page.evaluate(tusKaydediciKur);
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
}

/** Gerçek yatay ok kaydırması yalnız Chromium'da; WebKit'te klavye sözleşmesi (bkz. klavyeSozlesmesi). */
const gercekOkKaydirmasi = (browserName: string) => browserName === 'chromium';

/** Kaydırıcı sağa kaydı mı (poll; zaman aşımı ihlaldir). */
async function kaydiginiBekle(alan: Locator, timeout = 5000) {
  await expect
    .poll(async () => (await alan.evaluate(kaydiriciOlcumu)).scrollLeft, { message: 'tablo kapsayıcısı yatay kaymadı', timeout })
    .toBeGreaterThan(0);
}

/** Kaydırma sonrası: belge yatay kaymadı ve taşmıyor; ilk sütun yerinde, içerik altından kaydı. */
async function kaydirmaSonrasi(page: Page, alan: Locator) {
  expect(await page.evaluate(() => window.scrollX), 'belge yatay kaydı (window.scrollX)').toBe(0);
  expect(await horizontalOverflow(page), 'belge düzeyinde yatay taşma').toEqual([]);
  await expect.poll(() => alan.evaluate(detectFirstColumnStaysVisible), { message: 'kaydırınca ilk sütun yerinde kalmalı' }).toEqual([]);
  await expect.poll(() => alan.evaluate(detectColumnAlignment), { message: 'kaydırınca başlık gövdeyle hizalı kalmalı' }).toEqual([]);
}

/** Ortak kurallar: sayfa taşmaz, tablo alanında metin kesilmez; 14 px alt sınır; radiuslu kutuda kenar şeridi yok. */
async function ortakKurallar(page: Page) {
  expect(await horizontalOverflow(page), 'belge düzeyinde yatay taşma').toEqual([]);
  expect(await overflow(page, { root: RTABLE }), 'taşma ve kesilen metin').toEqual([]);
  expect(await smallText(page, { root: RTABLE }), '14 px alt sınır').toEqual([]);
  expect(await accentEdges(page, { root: RTABLE }), 'radiuslu kutuda kenar şeridi').toEqual([]);
}

/** Kelime kuralları: hiçbir sözcük ortasından bölünmez; ilk sütunda zorlayıcı kırma yok. yumusak: tarama devam etsin. */
async function kelimeKurallari(alan: Locator, yumusak = false) {
  const beklenti = yumusak ? expect.soft : expect;
  beklenti(await alan.evaluate(detectMidWordBreaks), 'kelime ortasından bölünme').toEqual([]);
  beklenti(await alan.evaluate(detectForcedBreaks), 'ilk sütunda zorlayıcı kırma (break-all / anywhere)').toEqual([]);
}

const AKORDEON: AkordeonSecenekleri = { ipucu: IPUCU, okKutusu: OK_KUTUSU_PX };

/** Telefon / dar akordeon sözleşmesi (yükleme sonrası ilk hâl). */
async function akordeonKurallari(page: Page, alan: Locator, sayfa: TabloSayfasi) {
  await expect(alan).toHaveAttribute('data-layout', 'accordion');
  await expect(page.getByRole('table', { name: sayfa.tablo })).toHaveCount(0);
  await expect(alan.getByText(new RegExp(`· ${IPUCU}$`))).toBeVisible();
  const basliklar = alan.locator('button[aria-expanded]');
  await expect(basliklar.first()).toHaveAttribute('aria-expanded', 'true');
  await expect(alan.locator('button[aria-expanded="true"]'), 'yalnız ilk satır açık başlar').toHaveCount(1);
  const panelKimligi = await basliklar.first().getAttribute('aria-controls');
  expect(panelKimligi, 'ilk satır aria-controls').toBeTruthy();
  await expect(page.locator(`[id="${panelKimligi}"]`)).toBeVisible();
  if (sayfa.uzunAdlar) await expect(basliklar.first()).toContainText(ILK_UZUN_AD);
  expect(await alan.evaluate(detectAccordion, AKORDEON)).toEqual([]);
  await kelimeKurallari(alan);
  await ortakKurallar(page);
}

// --- Öz denetim: dedektörler ve etkileşim adımları enjekte edilen ihlali yakalar --------------------------------------

test.describe('dedektör öz denetimi', () => {
  test('ortak dedektörler bu motorda ihlali yakalar', async ({ page }) => {
    await page.setContent('<main><p>öz denetim</p></main>');
    expect(await selfCheckDetectors(page)).toEqual([]);
  });

  test('yapışkan ilk sütun: doğru örnek temiz, yapışkan olmayan ilk sütun yakalanır', async ({ page }) => {
    await page.setContent(tabloOrnegi());
    expect(await page.locator(RTABLE).evaluate(detectStickyFirstColumn)).toEqual([]);
    await page.setContent(tabloOrnegi({ yapiskan: false }));
    expect(await page.locator(RTABLE).evaluate(detectStickyFirstColumn)).toContainEqual(expect.stringContaining('ilk hücre yapışkan değil'));
  });

  test('kaydırma kapsamı: kapsayıcıda kayan tablo temiz, belgeyi taşıran tablo yakalanır', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.setContent(tabloOrnegi());
    expect(await page.locator(RTABLE).evaluate(detectScrollContainment)).toEqual({ ihlaller: [], tasiyor: true });
    await page.setContent(tabloOrnegi({ kapsayici: false }));
    const kirli = await page.locator(RTABLE).evaluate(detectScrollContainment);
    expect(kirli.ihlaller).toContainEqual(expect.stringContaining('belge yatay taşıyor'));
    expect(kirli.ihlaller).toContainEqual(expect.stringContaining('overflow-x auto/scroll yok'));
  });

  test('başlık–gövde hizası: tek tablo ve hizalı ayrı başlık temiz, kayık başlık yakalanır', async ({ page }) => {
    await page.setContent(tabloOrnegi());
    expect(await page.locator(RTABLE).evaluate(detectColumnAlignment)).toEqual([]);
    await page.setContent(hizaOrnegi(false));
    expect(await page.locator(RTABLE).evaluate(detectColumnAlignment)).toEqual([]);
    await page.setContent(hizaOrnegi(true));
    expect(await page.locator(RTABLE).evaluate(detectColumnAlignment)).toContainEqual(expect.stringContaining('sütun 1 (Ad)'));
  });

  test('kaydırma sonrası ilk sütun yerinde kalır; yapışkan olmayan sütun yakalanır', async ({ page }) => {
    const kaydir = () => page.locator(RTABLE).evaluate(kok => {
      const s = [kok, ...Array.from(kok.querySelectorAll('*'))].find(el => getComputedStyle(el).overflowX === 'auto') as HTMLElement;
      s.scrollLeft = 160;
    });
    await page.setContent(tabloOrnegi());
    await kaydir();
    await expect.poll(() => page.locator(RTABLE).evaluate(detectFirstColumnStaysVisible)).toEqual([]);
    await page.setContent(tabloOrnegi({ yapiskan: false }));
    await kaydir();
    expect(await page.locator(RTABLE).evaluate(detectFirstColumnStaysVisible)).toContainEqual(expect.stringContaining('ilk hücre kaydırıcıyla kaydı'));
  });

  test('kelime ortası bölünme ve ilk sütunda zorlayıcı kırma: doğal sarma temiz, break-all / anywhere yakalanır', async ({ page }) => {
    await page.setContent(kelimeOrnegi(''));
    expect(await page.locator(RTABLE).evaluate(detectMidWordBreaks)).toEqual([]);
    expect(await page.locator(RTABLE).evaluate(detectForcedBreaks)).toEqual([]);
    await page.setContent(kelimeOrnegi('word-break:break-all'));
    expect(await page.locator(RTABLE).evaluate(detectMidWordBreaks)).toContainEqual(expect.stringContaining('satıra bölünmüş'));
    expect(await page.locator(RTABLE).evaluate(detectForcedBreaks)).toContainEqual(expect.stringContaining('word-break break-all'));
    await page.setContent(kelimeOrnegi('overflow-wrap:anywhere'));
    expect(await page.locator(RTABLE).evaluate(detectMidWordBreaks)).toContainEqual(expect.stringContaining('Değiştirilebilir'));
    expect(await page.locator(RTABLE).evaluate(detectForcedBreaks)).toContainEqual(expect.stringContaining('overflow-wrap anywhere'));
  });

  test('akordeon: doğru örnek temiz, her enjekte ihlal yakalanır', async ({ page }) => {
    const dene = async (ornek: AkordeonOrnegi) => {
      await page.setContent(akordeonOrnegi(ornek));
      return page.locator(RTABLE).evaluate(detectAccordion, AKORDEON);
    };
    expect(await dene({})).toEqual([]);
    expect(await dene({ ilkAcik: false })).toContainEqual(expect.stringContaining('ilk satır kapalı'));
    expect(await dene({ okKutusu: 28 })).toContainEqual(expect.stringContaining('ok kutusu'));
    expect(await dene({ gecikenUstte: false })).toContainEqual(expect.stringContaining('geciken grup üstte değil'));
    expect(await dene({ gecikenAdi: 'Tarihi geçenler' })).toEqual([]);
    expect(await dene({ gecikenAdi: 'Tarihi geçenler', gecikenUstte: false })).toContainEqual(expect.stringContaining('geciken grup üstte değil'));
    expect(await dene({ ipucu: false })).toContainEqual(expect.stringContaining('ipucu'));
    expect(await dene({ ayniDolgu: true })).toContainEqual(expect.stringContaining('aynı dolgu'));
  });

  test('etiket odak çizgisi: blok konakta çizgi sarılan adın genişliğinde; satır içi konakta dar ya da 0 px çizgi yakalanır', async ({ page }) => {
    const dene = async (gosterim: 'inline' | 'block') => {
      await page.setContent(etiketCizgisiOrnegi(gosterim));
      await page.locator('button[aria-expanded]').focus();
      return page.locator(RTABLE).evaluate(detectLabelFocusLine);
    };
    expect(await dene('block')).toEqual([]);
    expect(await dene('inline')).toContainEqual(expect.stringMatching(/çizgi [\d.]+ px, etiket (kutusu|metni)/));
    await page.setContent(etiketCizgisiOrnegi('block'));
    expect(await page.locator(RTABLE).evaluate(detectLabelFocusLine)).toEqual(['odak alanın içinde değil']);
  });

  test('fare: yatay tekerlek kapsayıcıyı kaydırır; tekerleği engelleyen betik yakalanır', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    const alan = page.locator(RTABLE);
    await page.setContent(kaydirmaOrnegi());
    await fareIleKaydir(page, alan);
    await kaydiginiBekle(alan);
    await kaydirmaSonrasi(page, alan);
    await page.setContent(kaydirmaOrnegi());
    await page.evaluate(() => document.addEventListener('wheel', olay => olay.preventDefault(), { passive: false }));
    await fareIleKaydir(page, alan);
    await expect(kaydiginiBekle(alan, 1500)).rejects.toThrow('tablo kapsayıcısı yatay kaymadı');
  });

  test('klavye: sekme durağı olan kaydırıcıya Tab ile girilir ve sağ ok kaydırır; ulaşılamayan ve oku yutan yakalanır', async ({ page, browserName }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    const alan = page.locator(RTABLE);
    await page.setContent(kaydirmaOrnegi());
    expect(await klavyeyleAlanaGir(page, alan, browserName)).toMatchObject({ icinde: true });
    await sagOk(page);
    expect(await alan.evaluate(klavyeSozlesmesi), 'temiz örnekte klavye sözleşmesi').toEqual([]);
    if (gercekOkKaydirmasi(browserName)) {
      await kaydiginiBekle(alan);
      await kaydirmaSonrasi(page, alan);
    }
    // Kullanıcı kaydıramayan (overflow hidden) ve sekme durağı olmayan alan: Tab alanı atlar.
    await page.setContent(kaydirmaOrnegi({ odaklanir: false, kayar: false }));
    expect(await klavyeyleAlanaGir(page, alan, browserName)).toMatchObject({ icinde: false, odak: 'button[sonra]' });
    // Ulaşılan ama ok tuşunu yutan alan: sözleşme (her motorda) ve gerçek kaydırma (Chromium) düşer.
    await page.setContent(kaydirmaOrnegi());
    await page.evaluate(() => document.addEventListener('keydown', olay => olay.key === 'ArrowRight' && olay.preventDefault()));
    expect(await klavyeyleAlanaGir(page, alan, browserName)).toMatchObject({ icinde: true });
    await sagOk(page);
    expect(await alan.evaluate(klavyeSozlesmesi)).toContainEqual(expect.stringContaining('ArrowRight varsayılanı engelleniyor'));
    if (gercekOkKaydirmasi(browserName)) await expect(kaydiginiBekle(alan, 1500)).rejects.toThrow('tablo kapsayıcısı yatay kaymadı');
    // Odak alanın dışında (önceki düğmede) iken ok: sözleşme odağın kaydırıcıda olmadığını yakalar.
    await page.setContent(kaydirmaOrnegi());
    await page.getByRole('button', { name: 'önce' }).focus();
    await sagOk(page);
    expect(await alan.evaluate(klavyeSozlesmesi)).toContainEqual(expect.stringContaining('odak taşan kaydırıcıda değil'));
  });

  test('dokunma sözleşmesi: serbest kaydırıcı temiz; pan-y ve varsayılanı engelleyen dokunma yakalanır', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    const alan = page.locator(RTABLE);
    await page.setContent(kaydirmaOrnegi());
    expect(await alan.evaluate(dokunmaSozlesmesi)).toEqual([]);
    await page.setContent(kaydirmaOrnegi({ dokunma: 'pan-y' }));
    expect(await alan.evaluate(dokunmaSozlesmesi)).toContainEqual(expect.stringContaining('touch-action pan-y'));
    await page.setContent(kaydirmaOrnegi());
    await page.evaluate(() => document.addEventListener('touchmove', olay => olay.preventDefault(), { passive: false }));
    expect(await alan.evaluate(dokunmaSozlesmesi)).toContainEqual(expect.stringContaining('touchmove varsayılanı engelleniyor'));
  });

  test('dokunma jesti (Chromium): serbest kaydırıcı kayar, touch-action pan-y kaydırıcı kaymaz', async ({ page, browserName }, testInfo) => {
    test.skip(browserName !== 'chromium' || !dokunmatik(testInfo), 'gerçek dokunma jesti yalnız dokunmatik Chromium projesinde (CDP)');
    await page.setViewportSize({ width: 1024, height: 768 });
    const alan = page.locator(RTABLE);
    await page.setContent(kaydirmaOrnegi());
    await dokunarakKaydir(page, alan);
    await kaydiginiBekle(alan);
    await kaydirmaSonrasi(page, alan);
    await page.setContent(kaydirmaOrnegi({ dokunma: 'pan-y' }));
    await dokunarakKaydir(page, alan);
    await expect(kaydiginiBekle(alan, 1500)).rejects.toThrow('tablo kapsayıcısı yatay kaymadı');
  });
});

// --- Geniş: masaüstü 1440 ve 1024 -----------------------------------------------------------------------------------

test.describe('geniş tablo', () => {
  for (const genislik of [1440, 1024]) {
    for (const sayfa of SAYFALAR) {
      test(`${sayfa.ad} ${genislik}: tablo, ilk sütun (${sayfa.ilkSutun}) yapışkan, kelime ortası bölünmez, belge taşmaz`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width: genislik, height: 900 });
        const alan = await tabloyuAc(page, sayfa);
        await expect(alan).toHaveAttribute('data-layout', 'table');
        await expect(page.getByRole('table', { name: sayfa.tablo })).toHaveCount(1);
        await expect(page.getByRole('columnheader', { name: sayfa.ilkSutun, exact: true }).first()).toBeVisible();
        const ilkler = await alan.evaluate(kok => {
          const satirlar = Array.from(kok.querySelectorAll('tr')).filter(tr => !tr.closest('[aria-hidden="true"]'));
          const metin = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
          return {
            baslik: metin(satirlar.find(tr => tr.querySelector('th'))?.querySelector('th')),
            govde: metin(satirlar.find(tr => tr.querySelector('td') && !tr.querySelector('th'))?.querySelector('td')),
          };
        });
        expect(ilkler.baslik, 'ilk başlık hücresi (yapışkan sütun)').toBe(sayfa.ilkSutun);
        if (sayfa.uzunAdlar) {
          expect(ilkler.govde, 'Ada göre (A–Z) ilk satır uzun sentetik ad').toBe(ILK_UZUN_AD);
          for (const ad of UZUN_ADLAR) await expect(alan.getByText(ad, { exact: true })).toHaveCount(1);
        }
        expect(await alan.evaluate(detectStickyFirstColumn)).toEqual([]);
        expect(await alan.evaluate(detectColumnAlignment), 'yapışkan başlık gövdeyle hizalı').toEqual([]);
        const rapor = await alan.evaluate(detectScrollContainment);
        expect(rapor.ihlaller).toEqual([]);
        if (sayfa.uzunAdlar) expect(rapor.tasiyor, `${sayfa.ad} tablosu uzun adlarla alandan geniş olmalı (gerekli ≥ ${gerekliGenislik(sayfa)} px)`).toBe(true);
        // Bilgi: yapışkan ilk sütunun görünür kaydırma alanındaki payı (eşik yok; rapora yazılır).
        const pay = await alan.evaluate(kok => {
          const s = [kok, ...Array.from(kok.querySelectorAll('*'))].find(el => ['auto', 'scroll'].includes(getComputedStyle(el).overflowX)) as HTMLElement | undefined;
          const hucre = Array.from(kok.querySelectorAll('tr')).find(tr => !tr.closest('[aria-hidden="true"]') && tr.querySelector('td'))?.querySelector('td');
          return s && hucre ? Math.round((hucre.getBoundingClientRect().width / s.clientWidth) * 100) : null;
        });
        testInfo.annotations.push({ type: 'ilk sütun payı', description: `${sayfa.ad} ${genislik}: yapışkan ilk sütun görünür alanın %${pay}` });
        await kelimeKurallari(alan);
        await ortakKurallar(page);
      });
    }
  }
});

// --- Geniş: kapsayıcı içi yatay kaydırma (dokunma, fare, klavye) ----------------------------------------------------

const KAYDIRMA_DURUMLARI: ReadonlyArray<{ sayfa: TabloSayfasi; genislik: number }> = [
  { sayfa: ALIMLAR, genislik: 1440 },
  { sayfa: ALIMLAR, genislik: 1024 },
  { sayfa: ODEMELER, genislik: 1024 },
  { sayfa: BUTCE, genislik: 1024 },
];

test.describe('geniş tablo yatay kaydırma', () => {
  for (const { sayfa, genislik } of KAYDIRMA_DURUMLARI) {
    test(`${sayfa.ad} ${genislik} fare: yatay tekerlek yalnız tabloyu kaydırır, ilk sütun yerinde`, async ({ page }) => {
      await page.setViewportSize({ width: genislik, height: 900 });
      const alan = await tabloyuAc(page, sayfa);
      await expect(alan).toHaveAttribute('data-layout', 'table');
      await fareIleKaydir(page, alan);
      await kaydiginiBekle(alan);
      await kaydirmaSonrasi(page, alan);
    });

    test(`${sayfa.ad} ${genislik} dokunma: parmakla yatay sürükleme yalnız tabloyu kaydırır`, async ({ page, browserName }, testInfo) => {
      test.skip(!dokunmatik(testInfo), 'dokunma: projede hasTouch yok');
      await page.setViewportSize({ width: genislik, height: 900 });
      const alan = await tabloyuAc(page, sayfa);
      await expect(alan).toHaveAttribute('data-layout', 'table');
      await alan.evaluate(kaydiriciyiGetir);
      expect(await alan.evaluate(dokunmaSozlesmesi), 'dokunma sözleşmesi').toEqual([]);
      if (browserName === 'chromium') {
        await dokunarakKaydir(page, alan);
        await kaydiginiBekle(alan);
        await kaydirmaSonrasi(page, alan);
      } else {
        testInfo.annotations.push({ type: 'dokunma', description: `${browserName}: Playwright'ta dokunmatik sürükleme yok; yalnız dokunma sözleşmesi denetlendi` });
      }
    });

    test(`${sayfa.ad} ${genislik} klavye: Tab ile tabloya girilir, sağ ok tabloyu kaydırır, odak göstergesi halka değil`, async ({ page, browserName }, testInfo) => {
      await page.setViewportSize({ width: genislik, height: 900 });
      const alan = await tabloyuAc(page, sayfa);
      await expect(alan).toHaveAttribute('data-layout', 'table');
      const giris = await klavyeyleAlanaGir(page, alan, browserName);
      expect(giris, `Tab, "${giris.onceki}" sonrasında tablo alanına girmeli (odak: ${giris.odak})`).toMatchObject({ icinde: true });
      expect.soft(await focusRing(page), 'tablodaki klavye odağı: çevreleyen halka yok, tek alt çizgi').toEqual([]);
      await sagOk(page);
      expect(await alan.evaluate(klavyeSozlesmesi), 'klavye sözleşmesi (odak kaydırıcıda, ok engellenmiyor)').toEqual([]);
      if (gercekOkKaydirmasi(browserName)) {
        await kaydiginiBekle(alan);
        await kaydirmaSonrasi(page, alan);
      } else {
        testInfo.annotations.push({ type: 'klavye', description: `${browserName}: Playwright WebKit yatay ok kaydırması üretmez; Tab erişimi ve klavye sözleşmesi denetlendi` });
      }
    });
  }
});

// --- Tablet 768: sığma kuralı ------------------------------------------------------------------------------------

test.describe('tablet sığma kuralı', () => {
  for (const sayfa of SAYFALAR) {
    test(`${sayfa.ad} 768: alan ≥ ${gerekliGenislik(sayfa)} px ise tablo, değilse ilk satırı açık akordeon`, async ({ page }) => {
      await page.setViewportSize({ width: 768, height: 1024 });
      const alan = await tabloyuAc(page, sayfa);
      const gerekli = gerekliGenislik(sayfa);
      // Ölçüm (ResizeObserver) gelene kadar tablet tabloyla başlar; kural ölçümden sonra tutmalı.
      await expect
        .poll(async () => {
          const { yerlesim, en } = await alan.evaluate(kok => ({ yerlesim: kok.getAttribute('data-layout'), en: kok.getBoundingClientRect().width }));
          const beklenen = en >= gerekli ? 'table' : 'accordion';
          return yerlesim === beklenen ? 'uyumlu' : `${yerlesim} (alan ${Math.round(en)} px, gerekli ${gerekli} px)`;
        })
        .toBe('uyumlu');
      if ((await alan.getAttribute('data-layout')) === 'table') {
        await expect(page.getByRole('table', { name: sayfa.tablo })).toHaveCount(1);
        expect(await alan.evaluate(detectScrollContainment)).toEqual({ ihlaller: [], tasiyor: false });
        await kelimeKurallari(alan);
        await ortakKurallar(page);
      } else {
        await akordeonKurallari(page, alan, sayfa);
      }
    });
  }
});

// --- Telefon: akordeon (projenin kendi görünümü; @matrix) ---------------------------------------------------------

test.describe('telefon akordeon', { tag: '@matrix' }, () => {
  test.beforeEach(({ page }) => {
    test.skip(!telefonMu(page.viewportSize()), 'telefon profili değil (genişlik ≥ 600 ve kısa kenar ≥ 480)');
  });

  for (const sayfa of SAYFALAR) {
    test(`${sayfa.ad}: akordeon, ilk satır açık, ikinci satır dokunuşla açılır, kelime ortası bölünmez`, async ({ page }, testInfo) => {
      const alan = await tabloyuAc(page, sayfa);
      await akordeonKurallari(page, alan, sayfa);
      if (sayfa === ODEMELER) {
        // Tahmin olayı ödeme değildir: geciken grup "Tarihi geçenler" (ödenip ödenmediği bilinmez), sonra "Bu hafta" ve
        // tarih sırasıyla aylar; telefonda ilk sayfa 10 satır (sentetik nesil, saat 2027-02-18).
        const gruplar = await alan.getByRole('heading', { level: 3 }).evaluateAll(basliklar => basliklar.map(b => b.firstChild?.textContent?.trim() ?? ''));
        expect(gruplar, 'tarihi geçen grup üstte, sonra bu hafta ve aylar tarih sırasıyla').toEqual([
          'Tarihi geçenler', 'Bu hafta', 'Mart 2027', 'Mayıs 2027', 'Haziran 2027', 'Temmuz 2027', 'Ağustos 2027', 'Eylül 2027',
        ]);
        const gecenler = alan.getByRole('region', { name: 'Tarihi geçenler' }).locator('button[aria-expanded]');
        await expect(gecenler.first()).toHaveAttribute('aria-expanded', 'true');
        await expect(gecenler.first()).toContainText(/Tarihi geçti · \d+ gün/);
        await expect(alan, 'tahmin olayı ödeme gibi görünmez').not.toContainText(/Gecikti|Ödendi/);
      }
      // İkinci satır dokunuşla (dokunmatik projede tap) açılır; ilk açık kalır; kural yine tutar.
      const basliklar = alan.locator('button[aria-expanded]');
      const ikinci = basliklar.nth(1);
      if (dokunmatik(testInfo)) await ikinci.tap();
      else await ikinci.click();
      await expect(ikinci).toHaveAttribute('aria-expanded', 'true');
      await expect(basliklar.first()).toHaveAttribute('aria-expanded', 'true');
      expect(await alan.evaluate(detectAccordion, AKORDEON)).toEqual([]);
      await kelimeKurallari(alan);
      await ortakKurallar(page);
    });
  }
});

// --- Telefon: akordeon satır başlığında klavye odağı (tek alt çizgi, etiket genişliğinde; @matrix) -------------------

test.describe('telefon akordeon klavye odağı', { tag: '@matrix' }, () => {
  test.beforeEach(({ page }) => {
    test.skip(!telefonMu(page.viewportSize()), 'telefon profili değil (genişlik ≥ 600 ve kısa kenar ≥ 480)');
  });

  for (const sayfa of SAYFALAR) {
    test(`${sayfa.ad}: satır başlığında tek odak çizgisi, sarılan adın tam genişliğinde ve altında`, async ({ page, browserName }) => {
      const alan = await tabloyuAc(page, sayfa);
      await expect(alan).toHaveAttribute('data-layout', 'accordion');
      // Görünür odak modu yalnız Tab ile açılır; mod açıkken programatik odak göstergeyi korur.
      await page.keyboard.press(tabKey(browserName));
      await expect(page.locator('html')).toHaveAttribute('data-keyboard', 'true');
      const basliklar = alan.locator('button[aria-expanded]');
      const adet = Math.min(3, await basliklar.count());
      for (let i = 0; i < adet; i++) {
        await basliklar.nth(i).focus();
        await expect(basliklar.nth(i)).toBeFocused();
        // Çizgi opaklığı 240 ms geçişle gelir; ölçüm geçiş bitene kadar yinelenir.
        await expect.poll(() => alan.evaluate(detectLabelFocusLine), { message: `${sayfa.ad} satır ${i + 1}: etiket odak çizgisi` }).toEqual([]);
      }
      // Gösterge etiket çizgisidir (yukarıda); paylaşılan dedektörden yalnız çevreleyen gösterge bulguları alınır.
      const cevreleyen = (await focusRing(page)).filter(bulgu => /halka|outline|çerçeve/.test(bulgu));
      expect(cevreleyen, 'akordeon başlığında çevreleyen halka yok').toEqual([]);
    });
  }
});

// --- Diğer tablo sayfaları: 1440 ve 320'de aynı tablo kuralları (sayfadaki her görünür ResponsiveTable) -----------------

// Taraflar (Adaylar) ve Sözlükler (sekme içi tablolar) sentetik nesilde açılışta görünür tablo alanı göstermez; bu
// taramada denetlenemez (kör test olmasın diye listede yok).
const DIGER_TABLO_SAYFALARI = ['/hesaplar', '/ev', '/projeler', '/raporlar', '/veri'] as const;

/** Görünür tablo alanlarının sayısı (kapalı panel / sekme içindekiler sayılmaz). */
async function gorunurAlanlar(page: Page): Promise<Locator[]> {
  const hepsi = page.locator(`main ${RTABLE}`);
  const gorunur: Locator[] = [];
  for (let i = 0; i < (await hepsi.count()); i++) if (await hepsi.nth(i).isVisible()) gorunur.push(hepsi.nth(i));
  return gorunur;
}

test.describe('diğer tablo sayfaları', () => {
  for (const rota of DIGER_TABLO_SAYFALARI) {
    test(`${rota}: 1440'ta tablo kuralları (yapışkan ilk sütun, kapsam, bölünme), 320'de tablo yok ve akordeon ilk satırı açık`, async ({ page }, testInfo) => {
      await page.clock.setFixedTime(SABIT_AN);
      await sentetikNesliSun(page);

      await page.setViewportSize({ width: 1440, height: 900 });
      await openAdmin(page, rota);
      // Masaüstü tablosu geniş sunumdadır (lazyWide, *.wide.tsx). openAdmin'in hazır sinyali geniş modülü beklemez; modül
      // veriden sonra istenir (izde /ev: EvIkiBolme.wide.tsx hazır sinyalinden ~640 ms sonra) ve o ana kadar telefon
      // sunumu yedek olarak görünür. Tarama, sayılmadan önce geniş sunumun tablosunun gelmesini bekler.
      await expect(page.locator('main [data-layout="table"]').first(), `${rota}: 1440'ta geniş sunumun tablosu`).toBeVisible();
      const genis = await gorunurAlanlar(page);
      for (const [i, alan] of genis.entries()) {
        await test.step(`1440 · alan ${i + 1} (${await alan.getAttribute('data-layout')})`, async () => {
          // Tarama: bir alandaki ihlal diğer alanların ve 320 denetiminin raporunu kesmesin (expect.soft).
          await expect.soft(alan).toHaveAttribute('data-layout', 'table');
          expect.soft(await alan.evaluate(detectStickyFirstColumn), 'yapışkan ilk sütun').toEqual([]);
          expect.soft(await alan.evaluate(detectColumnAlignment), 'yapışkan başlık gövdeyle hizalı').toEqual([]);
          expect.soft((await alan.evaluate(detectScrollContainment)).ihlaller, 'kaydırma kapsamı').toEqual([]);
          await kelimeKurallari(alan, true);
        });
      }
      expect.soft(await horizontalOverflow(page), '1440 belge düzeyinde yatay taşma').toEqual([]);

      await page.setViewportSize({ width: 320, height: 568 });
      await openAdmin(page, rota);
      // Telefon sunumu akordeonu ResponsiveTable'sız da kurabilir (ör. /ev: AccordionList); sayfa düzeyinde tablo yoktur.
      await expect.soft(page.locator('main table'), '320: telefonda sayfada tablo yok (akordeon ya da liste)').toHaveCount(0);
      const dar = await gorunurAlanlar(page);
      for (const [i, alan] of dar.entries()) {
        await test.step(`320 · alan ${i + 1} (${await alan.getAttribute('data-layout')})`, async () => {
          expect.soft(await alan.getAttribute('data-layout'), 'telefonda tablo yerine akordeon ya da düz liste').toMatch(/^(accordion|list)$/);
          await expect.soft(alan.locator('table')).toHaveCount(0);
          const acilir = alan.locator('button[aria-expanded]');
          if ((await acilir.count()) > 0) await expect.soft(acilir.first(), 'ilk satır açık').toHaveAttribute('aria-expanded', 'true');
          await kelimeKurallari(alan, true);
        });
      }
      expect.soft(await horizontalOverflow(page), '320 belge düzeyinde yatay taşma').toEqual([]);
      testInfo.annotations.push({ type: 'tablo alanları', description: `${rota}: 1440'ta ${genis.length}, 320'de ${dar.length} görünür alan` });
      expect(genis.length + dar.length, `${rota}: sentetik veriyle en az bir tablo alanı görünmeli`).toBeGreaterThan(0);
    });
  }
});

// --- Telefon taraması: 320×568 · 320×480 · 360 · 375 · 390 · yatay 568×320 (görev koşusunda kanıt; matris projeleri
// @matrix'i ayrıca kendi boyutlarında koşar) --------------------------------------------------------------------------

test.describe('telefon genişlik taraması', () => {
  const GENISLIKLER = [
    { width: 320, height: 568 },
    { width: 320, height: 480 },
    { width: 360, height: 640 },
    { width: 375, height: 667 },
    { width: 390, height: 844 },
    // Yatay telefon: kısa kenar < 480 olduğu için telefon profili kalır (W0 profil kuralı).
    { width: 568, height: 320 },
  ];
  for (const sayfa of SAYFALAR) {
    test(`${sayfa.ad}: 320×568 · 320×480 · 360 · 375 · 390 · yatay 568×320 telefonda akordeon, ilk satır açık, taşma ve bölünme yok`, async ({ page }) => {
      await page.setViewportSize(GENISLIKLER[0]!);
      const alan = await tabloyuAc(page, sayfa);
      for (const boyut of GENISLIKLER) {
        await test.step(`${boyut.width}×${boyut.height}`, async () => {
          await page.setViewportSize(boyut);
          await expect(page.locator('html')).toHaveAttribute('data-profile', 'phone');
          await akordeonKurallari(page, alan, sayfa);
        });
      }
    });
  }
});
