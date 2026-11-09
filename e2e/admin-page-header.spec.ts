import { test, expect, type Locator, type Page } from '@playwright/test';
import { syntheticBridgeResponse } from '../src/dashboard/bridgeFixtures';
import { syntheticCurrentSheets } from '../src/dashboard/currentFixtures';
import { gviz } from '../src/dashboard/fixtures';
import { ADMIN_MAIN, openAdmin } from './admin-helpers';
import { overflow, selfCheckDetectors } from './admin-detectors';
import { feedName } from './webFeed';

// Sayfa başlığı sözleşmesi (tasarim-sistemi/README.md › "Sayfa iskeleti (sıra sabit)" 1–2, components/PageHeader/README.md,
// components/DataStatus/README.md, bundle.js Page → PageHeader). Her rotada ve her genişlikte:
//   - sıra: bölüm adı (h1'in hemen önü) → tek h1 → amaç cümlesi (h1'in hemen ardı) → eylemler → tazelik satırı → özet;
//   - h1 = menüde seçili (aria-current="page") bağlantının adı = belge başlığının "<etiket> · aile" önü;
//   - başlıkta TEK tazelik satırı (DataStatus: role="status", aria-live="polite"; sentetik nesil okununca "Son okuma … ·
//     Nesil xxxxxx"). Gövdede başka bir kaynağa ait bağlantı satırı (Ayarlar "Aile e-tablosu", Bütçe "Canlı Sheet")
//     tasarımda vardır (bundle.js Ayarlar) ve sayfanın tazelik satırı sayılmaz;
//   - özet en çok 3 ölçü; breadcrumb yok; başlıkta görünüm alanından taşan ya da kesilen metin yok;
//   - görünen her ₺ tutarı "₺8.500,00" biçiminde ve tabular-nums (başlık + içerik, ayrı test).
// Bölüm adı her genişlikte görünür (bundle.js Page narrow'da da section verir), ≥14 px ve h1'den küçüktür.
// Görev koşusu: chromium 320×568 + webkit 390×844; rota testleri @matrix etiketli (entegrasyonda 360, 375, 320×480,
// 568×320, tablet 820, masaüstü 1440). Hazır sinyali openAdmin; sabit bekleme yok.
// Veri: sunucu sentetik nesli verir. Dış ağ kapalıdır: Bütçe'nin canlı GViz okuması sentetik e-tablo kimliğiyle
// sentetik GViz yanıtına (src/dashboard/*Fixtures) bağlanır; fikstürdeki ayrılmış ".invalid" görsel adresleri sentetik
// 1×1 PNG alır; başka her dış istek kesilir ve ihlal sayılır.

/** status: sayfanın tazelik satırı nesil yerine kendi kaynağından geliyorsa beklenen metin (varsayılan FRESH_STATUS). */
interface RouteContract { path: string; label: string; section: string; purpose: string; status?: RegExp }

/** navigation.ts › adminPages + Ayarlar; metinler tasarım bundle.js Aile.Pages section/title/purpose ile aynı. */
export const ROUTE_CONTRACTS: readonly RouteContract[] = [
  { path: '/genel', label: 'Genel durum', section: 'Genel', purpose: 'Bu ayın nakdini, yaklaşan ödemeleri ve dikkat isteyen kayıtları tek yerde görün.' },
  { path: '/butce', label: 'Bütçe ve nakit', section: 'Para', purpose: 'Ayın gelirini, planlanan giderlerini ve kalan nakdi kalem kalem izleyin.' },
  { path: '/odemeler', label: 'Ödemeler', section: 'Para', purpose: 'Planlanan, yapılan ve geciken ödemeleri tarihleriyle izleyin.' },
  { path: '/hesaplar', label: 'Hesaplar ve borçlar', section: 'Para', purpose: 'Hesap bakiyelerini ve kalan borçları, taksit planıyla birlikte görün.' },
  // Emeklilik nesil verisi kullanmaz: tazelik satırı profilin kaydı ve kaynağıdır (sentetik profil, geliştirme dosyası).
  { path: '/emeklilik', label: 'Emeklilik planı', section: 'Para', purpose: 'Askerlik, Bağ-Kur ve ihya seçeneklerinin emeklilik tarihine ve maliyetine etkisini karşılaştırın.', status: /^Sentetik profil · Kayıt \d{1,2} \p{L}+ \d{4} · Geliştirme dosyası$/u },
  { path: '/alimlar', label: 'Alımlar ve eşyalar', section: 'Alım ve envanter', purpose: 'Ev için alınacak ve alınmış her şeyi plan ve gerçek tutarıyla izleyin.' },
  { path: '/ev', label: 'Ev ve odalar', section: 'Ev', purpose: 'Her odanın alımlarını, görevlerini ve plan ile gerçek tutarını oda oda izleyin.' },
  { path: '/projeler', label: 'Projeler ve görevler', section: 'İşler', purpose: 'Ev projelerini ve görevlerini kim, ne zaman ve hangi sırayla yapacak, görün.' },
  { path: '/taraflar', label: 'Taraflar ve teklifler', section: 'İşler', purpose: 'Satıcıları, ustaları ve gelen teklifleri tek yerde karşılaştırın.' },
  { path: '/raporlar', label: 'Raporlar', section: 'Rapor', purpose: 'Hazır raporları açın; her rakamın hangi kayıtlardan geldiğini görün.' },
  { path: '/sozlukler', label: 'Sözlükler ve iş akışları', section: 'Yapı', purpose: 'Kategorileri, odaları, durumları ve durumların hangi sırayla değişeceğini tanımlayın.' },
  { path: '/veri', label: 'Veri kalitesi ve içe aktarma', section: 'Yapı', purpose: 'E-tablodan gelen veriyi içe aktarın, eşleşmeyen satırları ve çakışmaları çözün.' },
  { path: '/ayarlar', label: 'Ayarlar', section: 'Uygulama', purpose: 'Aile bilgilerini, biçimleri, e-tablo bağlantısını ve üyeleri yönetin.' },
];

/** README: "en çok üç anlamlı ölçü". */
const SUMMARY_LIMIT = 3;
/** DataStatus taze: "Son okuma 14:32 · Nesil a1b2c3 · Yenile" (başka gün: "27.10.2026 14:32"). */
const FRESH_STATUS = /^Son okuma (?:\d{2}\.\d{2}\.\d{4} )?\d{2}:\d{2} · Nesil [0-9a-f]{6}\b/;
/** Sayfa başlığı: main içindeki, tek h1'i taşıyan <header> (sınıf adına bağlı değil). */
const HEADER = `${ADMIN_MAIN} header:has(h1)`;

// --- Dedektörler (tarayıcıda çalışır; kapanış değişkeni yok, page.evaluate ile serileştirilir) ---------------------------

/**
 * Görünen ₺ tutarlarını denetler: biçim "₺8.500,00" (tr-TR, iki ondalık; eksi "-₺…") ve tabular-nums. Rakamsız simge
 * (para biriminin adı, "Türk lirası (₺)") tutar sayılmaz; yine de ₺ geçen metin tabular-nums ister. Ayrıca rakamın
 * yanında "TL"/"TRY" yazımını yakalar (para simgesi ₺'dir). Dönüş: ihlal açıklamaları; boş dizi = temiz.
 */
export function detectMoneyViolations(scopeSelector: string): string[] {
  const scope = document.querySelector(scopeSelector);
  if (!scope) return [`kapsam yok: ${scopeSelector}`];
  const strict = /^[-−]?₺\d{1,3}(?:\.\d{3})*,\d{2}$/;
  const token = /[-−]?\s*₺\s*[\d.,]*/g;
  const wrongUnit = /\d[\d.,]*\s?(?:TL|TRY)(?![A-Za-zÇĞİÖŞÜçğıöşü])/g;
  const out: string[] = [];
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent ?? '';
    if (!text.includes('₺') && !/\d\s?(?:TL|TRY)/.test(text)) continue;
    const parent = node.parentElement;
    if (!parent || parent.closest('script, style, template, noscript')) continue;
    const visible = typeof parent.checkVisibility === 'function' ? parent.checkVisibility() : true;
    if (!visible) continue;
    const where = parent.tagName.toLowerCase() + (parent.className && typeof parent.className === 'string' ? `.${parent.className.trim().split(/\s+/).join('.')}` : '');
    for (const match of text.matchAll(token)) {
      const value = match[0].replace(/\s+/g, '');
      // Rakamsız "₺" bir tutar değil, para biriminin adıdır ("Türk lirası (₺)"); biçim denetimi tutarlara uygulanır.
      if (!/\d/.test(value)) continue;
      if (!strict.test(value)) out.push(`biçim: "${match[0].trim()}" (${where}) beklenen ₺8.500,00`);
    }
    for (const match of text.matchAll(wrongUnit)) out.push(`birim: "${match[0]}" (${where}) ₺ simgesi kullanılmalı`);
    if (text.includes('₺')) {
      const numeric = getComputedStyle(parent).fontVariantNumeric || '';
      if (!numeric.includes('tabular-nums')) out.push(`tabular-nums yok: "${text.trim()}" (${where}) font-variant-numeric=${numeric || 'boş'}`);
    }
  }
  return out;
}

/** Breadcrumb izleri: adında/etiketinde breadcrumb geçen öğe ya da "yol" bildiren gezinme bölgesi. */
export function detectBreadcrumbs(scopeSelector: string): string[] {
  const scope = document.querySelector(scopeSelector);
  if (!scope) return [`kapsam yok: ${scopeSelector}`];
  const out: string[] = [];
  const named = /breadcrumb|kırıntı|içerik yolu|sayfa yolu|konumunuz/i;
  for (const element of Array.from(scope.querySelectorAll('*'))) {
    const className = typeof element.className === 'string' ? element.className : element.getAttribute('class') ?? '';
    const label = element.getAttribute('aria-label') ?? '';
    const role = element.getAttribute('role') ?? '';
    if (/breadcrumb/i.test(className)) out.push(`sınıf: <${element.tagName.toLowerCase()} class="${className}">`);
    else if (named.test(label)) out.push(`etiket: <${element.tagName.toLowerCase()} aria-label="${label}">`);
    else if (/breadcrumb/i.test(role) || element.hasAttribute('data-breadcrumb')) out.push(`rol: <${element.tagName.toLowerCase()} role="${role}">`);
  }
  return out;
}

/**
 * Başlık iskeletinin sırası: bölüm adı → h1 → amaç → eylemler → tazelik → özet (README "Sayfa iskeleti (sıra sabit)").
 * h1'in başlık bloğundaki kardeşlerinden okur; sınıf adına bağlı değildir. Eylem = başlıktaki denetim (düğme, bağlantı,
 * giriş); tazelik satırının kendi düğmesi ("Yenile"), özet içi ve amaç cümlesi içi bağlantılar eylem sayılmaz. Başlıkta
 * tam bir tazelik satırı (role="status") olmalı. Dönüş: sıra ihlalleri; boş dizi = temiz.
 */
export function detectHeaderOrder(scopeSelector: string): string[] {
  const scope = document.querySelector(scopeSelector);
  if (!scope) return [`kapsam yok: ${scopeSelector}`];
  const h1s = scope.querySelectorAll('h1');
  if (h1s.length !== 1) return [`h1 sayısı ${h1s.length}, beklenen 1`];
  const h1 = h1s[0];
  const header = h1.closest('header');
  if (!header) return ['h1 bir <header> içinde değil'];
  const text = (element: Element | null) => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const caption = h1.previousElementSibling;
  const purpose = h1.nextElementSibling;
  const statuses = Array.from(header.querySelectorAll('[role="status"]'));
  const status = statuses[0] ?? null;
  const summary = header.querySelector('[aria-label="Özet"]');
  /** b, a'dan sonra mı (belge sırası)? */
  const follows = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  const out: string[] = [];
  if (!caption || !text(caption)) out.push('h1 üstünde bölüm adı yok');
  if (!purpose || !text(purpose)) out.push('h1 altında amaç cümlesi yok');
  if (statuses.length !== 1) out.push(`başlıkta ${statuses.length} tazelik satırı, beklenen 1`);
  const anchor = purpose && text(purpose) ? purpose : h1;
  const controls = Array.from(header.querySelectorAll('button, a[href], input, select, textarea, [role="button"], [role="link"], [role="combobox"]'))
    .filter(control => !control.closest('[role="status"]') && !summary?.contains(control) && !anchor.contains(control));
  for (const control of controls) {
    const name = `"${text(control) || control.getAttribute('aria-label') || control.tagName.toLowerCase()}"`;
    if (!follows(anchor, control)) out.push(`eylem amaçtan önce: ${name}`);
    else if (status && !follows(control, status)) out.push(`eylem tazelik satırından sonra: ${name}`);
  }
  if (status && !follows(anchor, status)) out.push('tazelik satırı amaçtan önce');
  if (status && summary && !follows(status, summary)) out.push('özet tazelik satırından önce');
  return out;
}

// --- Ağ yalıtımı (sentetik dış bağımlılıklar) ------------------------------------------------------------------------

const SYNTHETIC_SHEET_ID = 'synthetic-budget-sheet-2098';
const GVIZ_SHEETS = { Pano: 'summary', Plan: 'plan', 'Gerçekleşen': 'actual', Kasa: 'cash', 'Arızi Giderler': 'irregular' } as const;
/** 1×1 saydam PNG: fikstürdeki ayrılmış .invalid görsel adresleri için (gerçek görsel değil). */
const PIXEL_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

/** Sentetik GViz yanıtı (src/dashboard/*Fixtures; gerçek e-tablo değil). Tanınmayan sayfa → undefined. */
function syntheticGviz(url: URL): string | undefined {
  const bridge = syntheticBridgeResponse(url.href);
  if (bridge) return bridge;
  const key = GVIZ_SHEETS[feedName(url) as keyof typeof GVIZ_SHEETS];
  if (!key) return undefined;
  const raw = syntheticCurrentSheets();
  if (key !== 'irregular') return gviz(raw[key]);
  // GViz headers=0 iken sayısal/tarih sütunlarındaki metin başlıklarını siler (budget-dashboard.spec.ts ile aynı).
  const labels = raw.irregular[0].map(String);
  return url.searchParams.get('headers') === '1'
    ? gviz(raw.irregular.slice(1), labels)
    : gviz([[...labels.slice(0, 3), ...labels.slice(3).map(() => null)], ...raw.irregular.slice(1)]);
}

/**
 * Dış ağı kapatır: yerel sunucu dışındaki istekler yönlendirilir. Sentetik e-tablo kimliğiyle GViz → sentetik yanıt;
 * ayrılmış .invalid alan adındaki görsel → 1×1 PNG; başka her istek kesilir ve dönen listeye yazılır (boş = temiz).
 */
async function isolateNetwork(page: Page, origin: string): Promise<string[]> {
  const unexpected: string[] = [];
  const cors = { 'access-control-allow-origin': '*', 'cache-control': 'no-store' };
  await page.route(url => url.origin !== origin && /^https?:$/.test(url.protocol), async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.hostname === 'docs.google.com' && url.pathname === `/spreadsheets/d/${SYNTHETIC_SHEET_ID}/gviz/tq`) {
      const body = syntheticGviz(url);
      if (body !== undefined) return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body });
    }
    if (url.hostname.endsWith('.invalid') && request.resourceType() === 'image') {
      return route.fulfill({ status: 200, contentType: 'image/png', headers: cors, body: PIXEL_PNG });
    }
    unexpected.push(`dış istek: ${request.method()} ${url.origin}${url.pathname}`);
    return route.abort('blockedbyclient');
  });
  return unexpected;
}

// --- Ortak adımlar ----------------------------------------------------------------------------------------------------

function pageHeader(page: Page): Locator {
  return page.locator(HEADER);
}

/** h1'in hemen önündeki kardeş = bölüm adı (caption). */
function sectionCaption(page: Page): Locator {
  return page.getByRole('heading', { level: 1 }).locator('xpath=preceding-sibling::*[1]');
}

/** openAdmin hazır sinyali + başlıktaki tazelik satırının okumayı bitirmesi (koşul beklemesi; sabit süre yok). */
async function openRoute(page: Page, path: string) {
  await openAdmin(page, path);
  await expect(pageHeader(page)).toHaveCount(1);
  await expect(pageHeader(page).getByRole('status').filter({ hasText: 'Okunuyor' })).toHaveCount(0, { timeout: 15_000 });
}

/**
 * Menüde seçili (aria-current="page") bağlantıların adları. Masaüstü profilinde içerik dışındaki görünür gezinme;
 * telefon/tablet profilinde (html[data-profile]) Sayfalar çekmecesi açılır, okunur, Escape ile kapanır.
 */
async function currentMenuLabels(page: Page): Promise<string[]> {
  const profile = await page.locator('html').getAttribute('data-profile');
  if (profile === 'desktop') {
    return page.locator('a[aria-current="page"]').evaluateAll(links => links
      .filter(link => !link.closest('main') && (link as HTMLElement).checkVisibility())
      .map(link => (link.textContent ?? '').trim()));
  }
  await page.getByRole('button', { name: 'Sayfalar', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Sayfalar' });
  await expect(drawer).toBeVisible();
  const labels = (await drawer.locator('a[aria-current="page"]').allTextContents()).map(label => label.trim());
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  return labels;
}

/** Başlık kapsamındaki taşma/kesilme (paylaşılan dedektör). Belge düzeyi taşma duman testinindir, burada süzülür. */
async function headerOverflow(page: Page): Promise<string[]> {
  return (await overflow(page, { root: HEADER })).filter(violation => !violation.startsWith('sayfa yatay taşıyor'));
}

// --- Dedektör öz-denetimi (sunucusuz; ihlal enjekte edilir) -------------------------------------------------------------

test.describe('dedektör öz-denetimi', () => {
  test('tutar dedektörü: TL, kesirsiz, ondalık noktalı ve tabular olmayan tutarı yakalar; geçerliyi geçirir', async ({ page }) => {
    await page.setContent(`
      <main id="m">
        <span id="ok" style="font-variant-numeric: tabular-nums">₺8.500,00</span>
        <span id="ok-neg" style="font-variant-numeric: tabular-nums">-₺1.200,50</span>
        <span id="ok-sentence" style="font-variant-numeric: tabular-nums">Plan ₺12.000,00 · gerçek ₺0,00</span>
        <span id="ok-currency-name" style="font-variant-numeric: tabular-nums">Türk lirası (₺)</span>
      </main>
      <section id="bad">
        <span style="font-variant-numeric: tabular-nums">8500 TL</span>
        <span style="font-variant-numeric: tabular-nums">₺8500</span>
        <span style="font-variant-numeric: tabular-nums">₺8,500.00</span>
        <span style="font-variant-numeric: tabular-nums">₺ 8.500</span>
        <span style="font-variant-numeric: normal">₺8.500,00</span>
        <span style="display:none">₺1</span>
      </section>`);
    expect(await page.evaluate(detectMoneyViolations, '#m')).toEqual([]);
    const found = await page.evaluate(detectMoneyViolations, '#bad');
    expect(found.filter(v => v.startsWith('birim:'))).toHaveLength(1);
    expect(found.filter(v => v.startsWith('biçim:'))).toHaveLength(3);
    expect(found.filter(v => v.startsWith('tabular-nums yok:'))).toHaveLength(1);
    expect(found.join('\n')).not.toContain('₺1"');
  });

  test('breadcrumb dedektörü: sınıf, aria-label ve rol izini yakalar; normal gezinmeyi geçirir', async ({ page }) => {
    await page.setContent(`
      <div id="clean"><nav aria-label="Sayfalar"><a href="#/genel">Genel durum</a></nav></div>
      <div id="dirty">
        <nav aria-label="Breadcrumb"><ol><li><a href="#/">aile</a></li><li>Alımlar</li></ol></nav>
        <div class="ant-breadcrumb"><span>Para</span></div>
        <ol role="breadcrumb"><li>Ev</li></ol>
      </div>`);
    expect(await page.evaluate(detectBreadcrumbs, '#clean')).toEqual([]);
    expect(await page.evaluate(detectBreadcrumbs, '#dirty')).toHaveLength(3);
  });

  test('başlık sırası dedektörü: eksik bölüm adı/amaç ve ters sırayı yakalar; doğru iskeleti geçirir', async ({ page }) => {
    await page.setContent(`
      <main id="ok"><header><div><p>Para</p><h1>Ödemeler</h1><p>Amaç.</p></div>
        <div><div role="status">Son okuma 14:32</div></div><ul aria-label="Özet"><li>a</li></ul></header></main>
      <main id="bare"><header><div><h1>Ödemeler</h1></div><div role="status">Son okuma</div></header></main>
      <main id="reversed"><header><div><p>Para</p><h1>Ödemeler</h1><p>Amaç.</p></div>
        <ul aria-label="Özet"><li>a</li></ul><div role="status">Son okuma</div></header></main>
      <main id="two"><h1>A</h1><h1>B</h1></main>`);
    expect(await page.evaluate(detectHeaderOrder, '#ok')).toEqual([]);
    expect(await page.evaluate(detectHeaderOrder, '#bare')).toEqual(['h1 üstünde bölüm adı yok', 'h1 altında amaç cümlesi yok']);
    expect(await page.evaluate(detectHeaderOrder, '#reversed')).toEqual(['özet tazelik satırından önce']);
    expect(await page.evaluate(detectHeaderOrder, '#two')).toEqual(['h1 sayısı 2, beklenen 1']);
  });

  test('başlık sırası dedektörü: eylemler amaçtan sonra ve tazelik satırından önce; başlıkta tek tazelik satırı', async ({ page }) => {
    await page.setContent(`
      <main id="ok"><header><div><p>Para</p><h1>Ödemeler</h1><p>Amaç <a href="#/raporlar">rapor</a>.</p></div>
        <div><button>Ödeme ekle</button><button>Diğer</button></div>
        <div><div role="status">Son okuma 14:32 · <button>Yenile</button></div></div>
        <ul aria-label="Özet"><li><a href="#/odemeler">a</a></li></ul><p>Not.</p></header></main>
      <main id="after-status"><header><div><p>Para</p><h1>Ödemeler</h1><p>Amaç.</p></div>
        <div><div role="status">Son okuma</div></div><div><button>Ödeme ekle</button></div></header></main>
      <main id="before-title"><header><div><a href="#/x">Ödeme ekle</a></div><div><p>Para</p><h1>Ödemeler</h1><p>Amaç.</p></div>
        <div role="status">Son okuma</div></header></main>
      <main id="no-status"><header><div><p>Para</p><h1>Ödemeler</h1><p>Amaç.</p></div><div><button>Ekle</button></div></header></main>
      <main id="two-status"><header><div><p>Para</p><h1>Ödemeler</h1><p>Amaç.</p></div>
        <div role="status">Son okuma</div><div role="status">Son okuma</div></header></main>`);
    expect(await page.evaluate(detectHeaderOrder, '#ok')).toEqual([]);
    expect(await page.evaluate(detectHeaderOrder, '#after-status')).toEqual(['eylem tazelik satırından sonra: "Ödeme ekle"']);
    expect(await page.evaluate(detectHeaderOrder, '#before-title')).toEqual(['eylem amaçtan önce: "Ödeme ekle"']);
    expect(await page.evaluate(detectHeaderOrder, '#no-status')).toEqual(['başlıkta 0 tazelik satırı, beklenen 1']);
    expect(await page.evaluate(detectHeaderOrder, '#two-status')).toEqual(['başlıkta 2 tazelik satırı, beklenen 1']);
  });

  test('ağ yalıtımı: sentetik GViz ve .invalid görsel yanıtlanır; başka dış istek ve sentetik olmayan e-tablo kimliği kesilip yazılır', async ({ page, baseURL }) => {
    const unexpected = await isolateNetwork(page, new URL(baseURL!).origin);
    await page.goto('icon.svg');
    const results = await page.evaluate(async (sheet) => {
      const gvizUrl = (id: string) => `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?sheet=${encodeURIComponent('_Web verisi')}&range=AN1%3AAN7&headers=0&tqx=out%3Ajson`;
      const read = (url: string) => fetch(url, { cache: 'no-store', credentials: 'omit' }).then(response => `${response.status} ${response.headers.get('content-type')}`, () => 'kesildi');
      return {
        gviz: await read(gvizUrl(sheet)),
        otherSheet: await read(gvizUrl('baska-bir-tablo-kimligi-0000')),
        external: await read('https://example.org/veri.json'),
      };
    }, SYNTHETIC_SHEET_ID);
    expect(results.gviz).toMatch(/^200 application\/json/);
    expect(results.otherSheet).toBe('kesildi');
    expect(results.external).toBe('kesildi');
    expect(unexpected).toEqual([
      'dış istek: GET https://docs.google.com/spreadsheets/d/baska-bir-tablo-kimligi-0000/gviz/tq',
      'dış istek: GET https://example.org/veri.json',
    ]);
  });

  test('gerçek sayfa: başlığa enjekte edilen eylem, ikinci tazelik, breadcrumb, kesik metin ve TL yakalanır; temizlenince geçer', async ({ page, baseURL }) => {
    await isolateNetwork(page, new URL(baseURL!).origin);
    await openRoute(page, '/butce');
    expect(await selfCheckDetectors(page), 'paylaşılan dedektörler bu motorda kör değil').toEqual([]);
    expect(await page.evaluate(detectHeaderOrder, ADMIN_MAIN), 'başlangıçta temiz').toEqual([]);
    expect(await page.evaluate(detectBreadcrumbs, 'body')).toEqual([]);
    expect(await headerOverflow(page)).toEqual([]);

    await page.evaluate((selector) => {
      const header = document.querySelector(selector)!;
      const add = (html: string) => { header.insertAdjacentHTML('beforeend', html); return header.lastElementChild as HTMLElement; };
      add('<button data-f06-enjekte>Enjekte eylem</button>');
      add('<div data-f06-enjekte role="status" aria-live="polite">Son okuma 00:00 · Nesil ffffff</div>');
      add('<nav data-f06-enjekte aria-label="Breadcrumb"><a href="#/genel">Genel</a></nav>');
      const clipped = add('<p data-f06-enjekte>Çok uzun bir başlık metni burada kesilerek gösteriliyor</p>');
      clipped.style.cssText = 'width:60px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-variant-numeric:tabular-nums';
      add('<p data-f06-enjekte style="font-variant-numeric:tabular-nums">8500 TL</p>');
    }, HEADER);
    const order = await page.evaluate(detectHeaderOrder, ADMIN_MAIN);
    expect(order).toContain('eylem tazelik satırından sonra: "Enjekte eylem"');
    expect(order).toContain('başlıkta 2 tazelik satırı, beklenen 1');
    expect(await page.evaluate(detectBreadcrumbs, 'body')).toHaveLength(1);
    expect((await headerOverflow(page)).some(violation => violation.includes('metin kesiliyor'))).toBe(true);
    expect((await page.evaluate(detectMoneyViolations, HEADER)).some(violation => violation.startsWith('birim:'))).toBe(true);

    await page.evaluate(() => { for (const node of Array.from(document.querySelectorAll('[data-f06-enjekte]'))) node.remove(); });
    expect(await page.evaluate(detectHeaderOrder, ADMIN_MAIN), 'enjeksiyon kaldırılınca yine temiz').toEqual([]);
    expect(await headerOverflow(page)).toEqual([]);
  });
});

// --- Rota sözleşmesi (her proje/genişlik) -----------------------------------------------------------------------------

test.describe('sayfa başlığı sözleşmesi', () => {
  for (const route of ROUTE_CONTRACTS) {
    test(`${route.path}: bölüm → h1 → amaç → eylemler → tazelik → özet; h1 = menü = belge başlığı; tek tazelik satırı; breadcrumb yok`, { tag: '@matrix' }, async ({ page, baseURL }) => {
      const unexpected = await isolateNetwork(page, new URL(baseURL!).origin);
      await openRoute(page, route.path);
      const header = pageHeader(page);

      const h1 = page.getByRole('heading', { level: 1 });
      await expect(h1).toHaveCount(1);
      await expect(h1).toHaveText(route.label);
      await expect(page).toHaveTitle(`${route.label} · aile`);

      const caption = sectionCaption(page);
      await expect(caption).toHaveText(route.section);
      await expect(caption).toBeVisible();
      expect(await caption.evaluate(element => element.scrollWidth > element.clientWidth + 1), 'bölüm adı kesilmemeli').toBe(false);
      const captionSize = await caption.evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize));
      const h1Size = await h1.evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize));
      expect(captionSize, 'bölüm adı ≥ 14 px').toBeGreaterThanOrEqual(14);
      expect(captionSize, 'bölüm adı h1 ölçüsünden küçük').toBeLessThan(h1Size);

      const purpose = h1.locator('xpath=following-sibling::*[1]');
      await expect(purpose).toHaveText(route.purpose);
      await expect(purpose).toBeVisible();

      const status = header.getByRole('status');
      await expect(status, 'başlıkta tek tazelik satırı').toHaveCount(1);
      await expect(status).toBeVisible();
      await expect(status).toHaveAttribute('aria-live', 'polite');
      await expect(status, 'sentetik kaynak okundu: taze durum').toHaveText(route.status ?? FRESH_STATUS);

      const summary = header.getByRole('list', { name: 'Özet' });
      const summaryCount = (await summary.count()) === 0 ? 0 : await summary.getByRole('listitem').count();
      expect(summaryCount, 'özet en çok 3 ölçü').toBeLessThanOrEqual(SUMMARY_LIMIT);

      expect(await page.evaluate(detectHeaderOrder, ADMIN_MAIN), 'başlık iskeleti sırası').toEqual([]);
      await expect(page.getByRole('navigation', { name: /breadcrumb|kırıntı|yol/i })).toHaveCount(0);
      expect(await page.evaluate(detectBreadcrumbs, 'body'), 'breadcrumb izi').toEqual([]);
      expect(await headerOverflow(page), 'başlıkta taşan ya da kesilen metin').toEqual([]);

      expect(await currentMenuLabels(page), 'menüde seçili etiket h1 ile aynı').toEqual([route.label]);
      expect(unexpected, 'dış ağ kapalı').toEqual([]);
    });
  }
});

// --- Tutar biçimi (başlık + içerik) -----------------------------------------------------------------------------------

test.describe('₺ biçimi', () => {
  for (const route of ROUTE_CONTRACTS) {
    test(`${route.path}: görünen her ₺ tutarı ₺8.500,00 biçiminde ve tabular-nums`, async ({ page, baseURL }) => {
      const unexpected = await isolateNetwork(page, new URL(baseURL!).origin);
      await openRoute(page, route.path);
      expect(await page.evaluate(detectMoneyViolations, HEADER), 'başlıkta ₺ biçimi').toEqual([]);
      expect(await page.evaluate(detectMoneyViolations, ADMIN_MAIN), 'içerikte ₺ biçimi').toEqual([]);
      expect(unexpected, 'dış ağ kapalı').toEqual([]);
    });
  }
});
