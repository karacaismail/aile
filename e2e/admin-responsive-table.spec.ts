import { test, expect, type Locator, type Page } from '@playwright/test';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { accentEdges, overflow, selfCheckDetectors, smallText } from './admin-detectors';
import { gotoAdmin, horizontalOverflow } from './admin-helpers';

// Ödemeler ve Bütçe tablosu (ResponsiveTable) cihaz sözleşmesi. Kaynak: aile-tasarim › components/ResponsiveTable ve
// AccordionList README'leri; bileşen src/admin/ui/ResponsiveTable.tsx + AccordionList.tsx + Table.tsx.
//   - 1440 (masaüstü): tablo; ilk sütun yapışkan (position: sticky), ikinci sütun değil; belge değil yalnız tablo
//     kapsayıcısı kayar. 1024'te tablo alandan geniştir: kapsayıcı kaydırılınca ilk sütun yerinde kalır.
//   - 768 (tablet): sığma kuralı. Gerekli genişlik = sütunların minWidth toplamı + sütun başına 32 px dolgu; alanın
//     gerçek genişliği bundan küçükse akordeon, değilse tablo. Belge yatay taşmaz.
//   - 320 (telefon): akordeon; ilk satır açık, ok kutusu 32 px, açık satırın ok kutusu kapalıdan farklı dolgulu,
//     grup başlıkları sırası (geciken üstte), açılabilirlik ipucu "ayrıntı için satıra dokunun".
// Veri: sentetik nesil (fixtures/generation-synthetic) /__aile/generation/* isteğine page.route ile verilir; gerçek
// aile verisi okunmaz. Canlı GViz isteği kesilir (ağa çıkılmaz). Saat sabittir (2027-02-18): Ödemeler grupları
// Gecikenler (3) · Bu hafta (1) · Sonra (16), Bütçe dönemi 2027-02 (8 kalem).
// Ortak kurallar (sayfa taşması + kesilen metin, 14 px alt sınır, radiuslu kutuda kenar şeridi) admin-detectors.ts'ten.
// Tabloya özgü dedektörler (yapışkan ilk sütun, kaydırma kapsamı, akordeon) ortak modülde olmadığı için aşağıdaki
// bölgededir; tarayıcıda locator.evaluate ile çalışırlar, bu yüzden her biri kendi içinde kapalıdır (dış değişken yok).
// Seçiciler role/label ve bileşenin kendi data-layout / aria-* özniteliklerindendir; antd iç sınıfı kullanılmaz.

const MASAUSTU = 'chromium-desktop';
const TELEFON = new Set(['chromium', 'webkit']);
const SABIT_AN = new Date('2027-02-18T09:00:00+03:00');
const RTABLE = ':is([data-layout="table"], [data-layout="accordion"], [data-layout="list"])';
const IPUCU = 'ayrıntı için satıra dokunun';
const OK_KUTUSU_PX = 32;
const SUTUN_DOLGUSU = 32;

interface SayfaTanimi {
  ad: string;
  hash: string;
  baslik: string;
  /** Tablonun görsel gizli caption'ı (erişilebilir ad). */
  tablo: string;
  ilkSutun: string;
  /** Masaüstü sütunlarının minWidth değerleri (sayfa kaynağıyla aynı sırada). */
  sutunlar: readonly number[];
  /** Telefonda üst satır sayımı. */
  mobilSayim: string;
}

const ODEMELER: SayfaTanimi = {
  ad: 'Ödemeler',
  hash: '/odemeler',
  baslik: 'Ödemeler',
  tablo: 'Tahmini ödemeler',
  ilkSutun: 'Tarih',
  // Tarih · Ödeme · Planlanan · Gerçekleşen · Durum
  sutunlar: [112, 220, 128, 128, 160],
  mobilSayim: '20 tahmini ödeme · 3 geciken',
};

const BUTCE: SayfaTanimi = {
  ad: 'Bütçe',
  hash: '/butce',
  baslik: 'Bütçe ve nakit',
  tablo: 'Bütçe kalemleri',
  ilkSutun: 'Kalem',
  // Kalem · Planlanan · Gerçekleşen · Fark · Durum · Tür
  sutunlar: [200, 128, 136, 120, 136, 120],
  mobilSayim: '8 kalem',
};

const SAYFALAR: readonly SayfaTanimi[] = [ODEMELER, BUTCE];
const gerekliGenislik = (sayfa: SayfaTanimi) => sayfa.sutunlar.reduce((toplam, en) => toplam + en + SUTUN_DOLGUSU, 0);

// --- Sentetik nesil ------------------------------------------------------------------------------------------

const FIXTURE_KOKU = fileURLToPath(new URL('../fixtures/generation-synthetic/', import.meta.url));
const NESIL_ADI = /^[a-f0-9]{64}$/;

async function sentetikNesil(): Promise<{ dizin: string; kimlik: string }> {
  const girdiler = await readdir(FIXTURE_KOKU, { withFileTypes: true });
  const ad = girdiler.find(girdi => girdi.isDirectory() && NESIL_ADI.test(girdi.name))?.name;
  if (!ad) throw new Error('fixtures/generation-synthetic altında nesil klasörü yok (node scripts/synthetic-generation.mjs)');
  return { dizin: path.join(FIXTURE_KOKU, ad), kimlik: ad };
}

/** /__aile/generation/* isteklerini sentetik nesilden yanıtlar (dev middleware ile aynı yol politikası). */
async function sentetikNesliSun(page: Page) {
  const { dizin, kimlik } = await sentetikNesil();
  await page.route('**/__aile/generation/**', async route => {
    const yol = new URL(route.request().url()).pathname;
    const goreli = decodeURIComponent(yol.slice(yol.indexOf('/__aile/generation/') + '/__aile/generation/'.length));
    if (goreli === '_meta') {
      await route.fulfill({ json: { generation_id: kimlik, selectedAt: SABIT_AN.toISOString() } });
      return;
    }
    const bolutler = goreli.split('/');
    if (!goreli.endsWith('.json') || goreli.includes('\\') || bolutler.some(b => b === '' || b === '.' || b === '..')) {
      await route.fulfill({ status: 400, json: { error: 'Geçersiz yol' } });
      return;
    }
    const hedef = path.resolve(dizin, goreli);
    if (!hedef.startsWith(`${dizin}${path.sep}`)) {
      await route.fulfill({ status: 400, json: { error: 'Geçersiz yol' } });
      return;
    }
    let govde: string;
    try {
      govde = await readFile(hedef, 'utf8');
    } catch {
      await route.fulfill({ status: 404, json: { error: 'Bulunamadı' } });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: govde });
  });
  // Bütçe sayfasının canlı GViz okuması ağa çıkmasın; sayfa bunu "Hata: …" diye ikinci durum satırında söyler.
  await page.route(/^https:\/\/docs\.google\.com\//, route => route.abort());
}

async function sayfayiAc(page: Page, sayfa: SayfaTanimi): Promise<Locator> {
  await page.clock.setFixedTime(SABIT_AN);
  await sentetikNesliSun(page);
  await gotoAdmin(page, sayfa.hash);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(sayfa.baslik);
  const alan = page.locator(RTABLE);
  await expect(alan).toHaveCount(1);
  return alan;
}

// #region dedektorler
// Tarayıcıda (locator.evaluate) ve jsdom öz denetiminde aynen çalışır: dış kapsam yok, yalnız DOM API.

interface KaydirmaRaporu {
  ihlaller: string[];
  /** Tablo alandan geniş ve bir kapsayıcı kendi içinde kayıyor. */
  tasiyor: boolean;
}

interface AkordeonSecenekleri {
  ipucu: string;
  okKutusu: number;
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
  const enGenisTablo = Math.max(0, ...Array.from(root.querySelectorAll('table')).map(t => t.getBoundingClientRect().width));
  const tasiyor = kaydiricilar.some(el => el.scrollWidth > el.clientWidth + 1);
  if (enGenisTablo > alan.width + 1 && !tasiyor) ihlaller.push(`tablo (${Math.round(enGenisTablo)} px) alandan geniş ama hiçbir kapsayıcı kaymıyor`);
  return { ihlaller: ihlaller.slice(0, 8), tasiyor };
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

  // Ok kutusu: satır düğmesinin sondaki doğrudan çocuğu olan aria-hidden süsleyici (svg değil, svg taşıyan). Satır
  // içeriğindeki etiket simgeleri sayılmaz.
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

  const gruplar = Array.from(root.querySelectorAll('h3')).map(h => (h.firstChild?.textContent ?? '').trim());
  const geciken = gruplar.findIndex(ad => /gecik/.test(ad.toLocaleLowerCase('tr-TR')));
  if (geciken > 0) ihlaller.push(`geciken grup üstte değil (sıra: ${gruplar.join(' · ')})`);
  return ihlaller.slice(0, 10);
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

interface AkordeonOrnegi {
  ilkAcik?: boolean;
  okKutusu?: number;
  gecikenUstte?: boolean;
  ipucu?: boolean;
  ayniDolgu?: boolean;
}

/** Öz denetim örneği: iki gruplu akordeon (Gecikenler · Sonra). */
function akordeonOrnegi({ ilkAcik = true, okKutusu = 32, gecikenUstte = true, ipucu = true, ayniDolgu = false }: AkordeonOrnegi = {}): string {
  const kutu = (acik: boolean) => {
    const dolgu = acik && !ayniDolgu ? 'rgb(0, 82, 204)' : 'rgb(255, 255, 255)';
    return `<span aria-hidden="true" style="display:grid;width:${okKutusu}px;height:${okKutusu}px;background-color:${dolgu}"><svg aria-hidden="true" width="20" height="20"></svg></span>`;
  };
  const satir = (kimlik: string, ad: string, acik: boolean) =>
    `<li><button type="button" aria-expanded="${acik}" aria-controls="${kimlik}"><span>${ad}</span>${kutu(acik)}</button>` +
    `<div id="${kimlik}"${acik ? '' : ' hidden'}><dl><dt>Gerçekleşen</dt><dd>Henüz yok</dd></dl></div></li>`;
  const grup = (ad: string, kimlik: string, acik: boolean) =>
    `<section aria-label="${ad}"><h3>${ad}<span>1</span></h3><ul>${satir(kimlik, `${ad} satırı`, acik)}</ul></section>`;
  const geciken = grup('Gecikenler', 'ornek-geciken', gecikenUstte && ilkAcik);
  const sonra = grup('Sonra', 'ornek-sonra', !gecikenUstte && ilkAcik);
  const ust = `<div><p>2 kayıt${ipucu ? ' · ayrıntı için satıra dokunun' : ''}</p><button type="button">Tümünü aç</button></div>`;
  return `<div data-layout="accordion">${ust}${gecikenUstte ? geciken + sonra : sonra + geciken}</div>`;
}
// #endregion dedektorler

// --- Öz denetim: dedektörler enjekte edilen ihlali yakalar ------------------------------------------------------

test.describe('dedektör öz denetimi', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== MASAUSTU, 'öz denetim tek projede yeter');
  });

  test('ortak dedektörler bu motorda ihlali yakalar', async ({ page }) => {
    await page.setContent('<main><p>öz denetim</p></main>');
    expect(await selfCheckDetectors(page)).toEqual([]);
  });

  test('yapışkan ilk sütun: doğru örnek temiz, yapışkan olmayan ilk sütun yakalanır', async ({ page }) => {
    await page.setContent(tabloOrnegi());
    expect(await page.locator(RTABLE).evaluate(detectStickyFirstColumn)).toEqual([]);
    await page.setContent(tabloOrnegi({ yapiskan: false }));
    const ihlaller = await page.locator(RTABLE).evaluate(detectStickyFirstColumn);
    expect(ihlaller).toContainEqual(expect.stringContaining('ilk hücre yapışkan değil'));
  });

  test('kaydırma kapsamı: kapsayıcıda kayan tablo temiz, belgeyi taşıran tablo yakalanır', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.setContent(tabloOrnegi());
    const temiz = await page.locator(RTABLE).evaluate(detectScrollContainment);
    expect(temiz).toEqual({ ihlaller: [], tasiyor: true });
    await page.setContent(tabloOrnegi({ kapsayici: false }));
    const kirli = await page.locator(RTABLE).evaluate(detectScrollContainment);
    expect(kirli.ihlaller).toContainEqual(expect.stringContaining('belge yatay taşıyor'));
    expect(kirli.ihlaller).toContainEqual(expect.stringContaining('overflow-x auto/scroll yok'));
  });

  test('kaydırma sonrası ilk sütun yerinde kalır; yapışkan olmayan sütun yakalanır', async ({ page }) => {
    await page.setContent(tabloOrnegi());
    await kapsayiciyiKaydir(page.locator(RTABLE));
    await expect.poll(() => page.locator(RTABLE).evaluate(detectFirstColumnStaysVisible)).toEqual([]);
    await page.setContent(tabloOrnegi({ yapiskan: false }));
    await kapsayiciyiKaydir(page.locator(RTABLE));
    const ihlaller = await page.locator(RTABLE).evaluate(detectFirstColumnStaysVisible);
    expect(ihlaller).toContainEqual(expect.stringContaining('ilk hücre kaydırıcıyla kaydı'));
  });

  test('akordeon: doğru örnek temiz, her enjekte ihlal yakalanır', async ({ page }) => {
    const secenek: AkordeonSecenekleri = { ipucu: IPUCU, okKutusu: OK_KUTUSU_PX };
    const dene = async (ornek: AkordeonOrnegi) => {
      await page.setContent(akordeonOrnegi(ornek));
      return page.locator(RTABLE).evaluate(detectAccordion, secenek);
    };
    expect(await dene({})).toEqual([]);
    expect(await dene({ ilkAcik: false })).toContainEqual(expect.stringContaining('ilk satır kapalı'));
    expect(await dene({ okKutusu: 28 })).toContainEqual(expect.stringContaining('ok kutusu'));
    expect(await dene({ gecikenUstte: false })).toContainEqual(expect.stringContaining('geciken grup üstte değil'));
    expect(await dene({ ipucu: false })).toContainEqual(expect.stringContaining('ipucu'));
    expect(await dene({ ayniDolgu: true })).toContainEqual(expect.stringContaining('aynı dolgu'));
  });
});

/** Ortak kurallar: sayfa taşmaz ve etiket kesilmez; tablo alanında 14 px altı metin ve radiuslu kenar şeridi yok. */
async function ortakKurallar(page: Page) {
  expect(await horizontalOverflow(page), 'belge düzeyinde yatay taşma').toEqual([]);
  expect(await overflow(page), 'taşma ve kesilen metin').toEqual([]);
  expect(await smallText(page, { root: RTABLE }), '14 px alt sınır').toEqual([]);
  expect(await accentEdges(page, { root: RTABLE }), 'radiuslu kutuda kenar şeridi').toEqual([]);
}

/** Alandaki taşan kaydırıcıyı sağa kaydırır (belge değil, yalnız kapsayıcı). */
async function kapsayiciyiKaydir(alan: Locator, miktar = 160) {
  const kaydirildi = await alan.evaluate((kok, px) => {
    const adaylar = [kok, ...Array.from(kok.querySelectorAll('*'))] as HTMLElement[];
    const kaydirici = adaylar.find(el => ['auto', 'scroll'].includes(getComputedStyle(el).overflowX) && el.scrollWidth > el.clientWidth + 1);
    if (!kaydirici) return false;
    kaydirici.scrollLeft = px;
    kaydirici.dispatchEvent(new Event('scroll'));
    return kaydirici.scrollLeft > 0;
  }, miktar);
  expect(kaydirildi, 'taşan tablo kapsayıcısı kaydırılabilmeli').toBe(true);
}

// --- Masaüstü 1440 ve 1024 -------------------------------------------------------------------------------------

test.describe('masaüstü tablo', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== MASAUSTU, 'masaüstü kuralı chromium-desktop (1440) projesinde');
  });

  for (const sayfa of SAYFALAR) {
    test(`${sayfa.ad} 1440: tablo, ilk sütun (${sayfa.ilkSutun}) yapışkan, yalnız tablo kapsayıcısı kayar`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      const alan = await sayfayiAc(page, sayfa);
      await expect(alan).toHaveAttribute('data-layout', 'table');
      await expect(page.getByRole('table', { name: sayfa.tablo })).toHaveCount(1);
      await expect(page.getByRole('columnheader', { name: sayfa.ilkSutun, exact: true }).first()).toBeVisible();
      // İlk başlık hücresinin metni beklenen ilk sütun (sütun sırası değişirse yapışkan sütun yanlış olur).
      const ilkBaslik = await alan.evaluate(kok => {
        const satir = Array.from(kok.querySelectorAll('tr')).find(tr => !tr.closest('[aria-hidden="true"]') && tr.querySelector('th'));
        return satir?.querySelector('th')?.textContent?.trim() ?? null;
      });
      expect(ilkBaslik).toBe(sayfa.ilkSutun);
      expect(await alan.evaluate(detectStickyFirstColumn)).toEqual([]);
      const rapor = await alan.evaluate(detectScrollContainment);
      expect(rapor.ihlaller).toEqual([]);
      await ortakKurallar(page);
    });

    test(`${sayfa.ad} 1024: tablo alandan geniş; kapsayıcı kayar, ilk sütun yerinde kalır, belge kaymaz`, async ({ page }) => {
      await page.setViewportSize({ width: 1024, height: 800 });
      const alan = await sayfayiAc(page, sayfa);
      await expect(alan).toHaveAttribute('data-layout', 'table');
      const rapor = await alan.evaluate(detectScrollContainment);
      expect(rapor.ihlaller).toEqual([]);
      expect(rapor.tasiyor, `${sayfa.ad} tablosu 1024'te alandan geniş olmalı (gerekli ${gerekliGenislik(sayfa)} px)`).toBe(true);
      await kapsayiciyiKaydir(alan);
      await expect.poll(() => alan.evaluate(detectFirstColumnStaysVisible)).toEqual([]);
      expect(await page.evaluate(() => window.scrollX)).toBe(0);
      await ortakKurallar(page);
    });
  }
});

// --- Tablet 768: sığma kuralı -----------------------------------------------------------------------------------

test.describe('tablet sığma kuralı', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== MASAUSTU, 'tablet genişliği chromium-desktop projesinde setViewportSize ile');
  });

  for (const sayfa of SAYFALAR) {
    for (const genislik of [768, 1000]) {
      test(`${sayfa.ad} ${genislik}: alan ≥ ${gerekliGenislik(sayfa)} px ise tablo, değilse akordeon`, async ({ page }) => {
        await page.setViewportSize({ width: genislik, height: 1024 });
        const alan = await sayfayiAc(page, sayfa);
        const gerekli = gerekliGenislik(sayfa);
        // Ölçüm (ResizeObserver) gelene kadar tablet tabloyla başlar; kural ölçümden sonra tutmalı.
        await expect
          .poll(async () => {
            const { yerlesim, en } = await alan.evaluate(kok => ({
              yerlesim: kok.getAttribute('data-layout'),
              en: kok.getBoundingClientRect().width,
            }));
            const beklenen = en >= gerekli ? 'table' : 'accordion';
            return yerlesim === beklenen ? 'uyumlu' : `${yerlesim} (alan ${Math.round(en)} px, gerekli ${gerekli} px)`;
          })
          .toBe('uyumlu');
        const yerlesim = await alan.getAttribute('data-layout');
        if (yerlesim === 'table') {
          await expect(page.getByRole('table', { name: sayfa.tablo })).toHaveCount(1);
          // Sığan tablo kendi kapsayıcısında bile kaymaz.
          expect(await alan.evaluate(detectScrollContainment)).toEqual({ ihlaller: [], tasiyor: false });
        } else {
          await expect(page.getByRole('table', { name: sayfa.tablo })).toHaveCount(0);
          await expect(alan.locator('button[aria-expanded]').first()).toHaveAttribute('aria-expanded', 'true');
        }
        await ortakKurallar(page);
      });
    }
  }
});

// --- Telefon 320: akordeon --------------------------------------------------------------------------------------

test.describe('telefon akordeon', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(!TELEFON.has(testInfo.project.name), 'telefon kuralı chromium (320) ve webkit (390) projelerinde');
  });

  const secenek: AkordeonSecenekleri = { ipucu: IPUCU, okKutusu: OK_KUTUSU_PX };

  test('Ödemeler: ilk satır açık, ok kutusu 32 px, gruplar Gecikenler · Bu hafta · Sonra, ipucu görünür', async ({ page }) => {
    const alan = await sayfayiAc(page, ODEMELER);
    await expect(alan).toHaveAttribute('data-layout', 'accordion');
    await expect(page.getByRole('table', { name: ODEMELER.tablo })).toHaveCount(0);

    // Üst satır: sayım + açılabilirlik ipucu + Tümünü aç.
    await expect(alan.getByText(`${ODEMELER.mobilSayim} · ${IPUCU}`)).toBeVisible();
    await expect(alan.getByRole('button', { name: 'Tümünü aç' })).toBeVisible();

    // Grup başlıkları: geciken üstte, sonra veri sırası.
    const gruplar = await alan.getByRole('heading', { level: 3 }).evaluateAll(basliklar =>
      basliklar.map(baslik => baslik.firstChild?.textContent?.trim() ?? ''),
    );
    expect(gruplar).toEqual(['Gecikenler', 'Bu hafta', 'Sonra']);
    await expect(alan.getByRole('region', { name: 'Gecikenler' }).locator('button[aria-expanded]')).toHaveCount(3);

    // İlk satır açık ve gecikenlerin ilkidir (2026-11-01; 109 gün); diğerleri kapalı.
    const basliklar = alan.locator('button[aria-expanded]');
    await expect(basliklar).toHaveCount(20);
    const ilk = basliklar.first();
    await expect(ilk).toHaveAttribute('aria-expanded', 'true');
    await expect(ilk).toContainText('Gecikti · 109 gün');
    await expect(alan.locator('button[aria-expanded="true"]')).toHaveCount(1);
    const panelKimligi = await ilk.getAttribute('aria-controls');
    expect(panelKimligi).toBeTruthy();
    const panel = page.locator(`[id="${panelKimligi}"]`);
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('Gerçekleşen');
    await expect(panel).toContainText('Henüz yok');

    expect(await alan.evaluate(detectAccordion, secenek)).toEqual([]);

    // İkinci satır dokunuşla açılır; ilk açık kalır (birden çok satır açık olabilir); kural yine tutar.
    await basliklar.nth(1).click();
    await expect(basliklar.nth(1)).toHaveAttribute('aria-expanded', 'true');
    await expect(ilk).toHaveAttribute('aria-expanded', 'true');
    expect(await alan.evaluate(detectAccordion, secenek)).toEqual([]);

    await ortakKurallar(page);
  });

  test('Bütçe: grupsuz akordeon; ilk satır açık, ok kutusu 32 px, ipucu görünür', async ({ page }) => {
    const alan = await sayfayiAc(page, BUTCE);
    await expect(alan).toHaveAttribute('data-layout', 'accordion');
    await expect(page.getByRole('table', { name: BUTCE.tablo })).toHaveCount(0);
    await expect(alan.getByText(`${BUTCE.mobilSayim} · ${IPUCU}`)).toBeVisible();
    // Canlı eşleme yokken grup başlığı üretilmez.
    await expect(alan.getByRole('heading', { level: 3 })).toHaveCount(0);
    const basliklar = alan.locator('button[aria-expanded]');
    await expect(basliklar).toHaveCount(8);
    await expect(basliklar.first()).toHaveAttribute('aria-expanded', 'true');
    await expect(alan.locator('button[aria-expanded="true"]')).toHaveCount(1);
    expect(await alan.evaluate(detectAccordion, secenek)).toEqual([]);
    await ortakKurallar(page);
  });
});
