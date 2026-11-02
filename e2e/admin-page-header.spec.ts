import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { gotoAdmin, horizontalOverflow } from './admin-helpers';

// Sayfa başlığı sözleşmesi (tasarim-sistemi/README.md › "Sayfa iskeleti (sıra sabit)" 1–2, components/PageHeader/README.md,
// envanter.md PageHeader satırı, bundle.js PageHeader/Page). Her rotada:
//   - tek h1 = menüdeki etiket (aria-current="page" bağlantının adı) ve document.title = "{h1} · aile";
//   - h1'in hemen üstünde küçük bölüm adı (caption), altında tek cümlelik amaç;
//   - başlıkta tek tazelik satırı: DataStatus, role="status" + aria-live="polite";
//   - özet en çok 3 ölçü; breadcrumb yok; görünen her ₺ tutarı "₺8.500,00" biçiminde ve tabular-nums.
// Bölüm adı hem 1440'ta hem 320'de görünürdür: tasarım teslimi (bundle.js Page → PageHeader narrow'da da section verir;
// .ai-ph--dar section'ı gizlemez) böyle; tasarım tek görsel kaynaktır.
// Veri: sentetik nesil (fixtures/generation-synthetic) /__aile/generation/* isteğine page.route ile verilir; gerçek nesil
// ve dış ağ (Google) kullanılmaz. Dedektörler bu dosyadadır (admin-detectors.ts henüz yok); öz-denetim testleri ihlali
// enjekte edip yakalandığını, geçerli örneği yakalamadığını kanıtlar.

interface RouteContract { path: string; label: string; section: string; purpose: string }

/** navigation.ts › adminPages + Ayarlar; metinler tasarım bundle.js Aile.Pages section/title/purpose ile aynı. */
export const ROUTE_CONTRACTS: readonly RouteContract[] = [
  { path: '/genel', label: 'Genel durum', section: 'Genel', purpose: 'Bu ayın nakdini, yaklaşan ödemeleri ve dikkat isteyen kayıtları tek yerde görün.' },
  { path: '/butce', label: 'Bütçe ve nakit', section: 'Para', purpose: 'Ayın gelirini, planlanan giderlerini ve kalan nakdi kalem kalem izleyin.' },
  { path: '/odemeler', label: 'Ödemeler', section: 'Para', purpose: 'Planlanan, yapılan ve geciken ödemeleri tarihleriyle izleyin.' },
  { path: '/hesaplar', label: 'Hesaplar ve borçlar', section: 'Para', purpose: 'Hesap bakiyelerini ve kalan borçları, taksit planıyla birlikte görün.' },
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
/** DataStatus metinleri (components/DataStatus/README.md): her durum sözcükle başlar. */
const DATA_STATUS_TEXT = /^(Son okuma|Okunuyor…|Son başarılı nesil|Hata: |Çakışma)/;

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
 * Başlık iskeletinin sırası: bölüm adı → h1 → amaç → tazelik → özet (README "Sayfa iskeleti (sıra sabit)").
 * h1'in başlık bloğundaki kardeşlerinden okur; sınıf adına bağlı değildir. Dönüş: sıra ihlalleri.
 */
export function detectHeaderOrder(scopeSelector: string): string[] {
  const scope = document.querySelector(scopeSelector);
  if (!scope) return [`kapsam yok: ${scopeSelector}`];
  const h1s = scope.querySelectorAll('h1');
  if (h1s.length !== 1) return [`h1 sayısı ${h1s.length}, beklenen 1`];
  const h1 = h1s[0];
  const header = h1.closest('header');
  if (!header) return ['h1 bir <header> içinde değil'];
  const caption = h1.previousElementSibling;
  const purpose = h1.nextElementSibling;
  const status = header.querySelector('[role="status"]');
  const summary = header.querySelector('[aria-label="Özet"]');
  const out: string[] = [];
  if (!caption || !(caption.textContent ?? '').trim()) out.push('h1 üstünde bölüm adı yok');
  if (!purpose || !(purpose.textContent ?? '').trim()) out.push('h1 altında amaç cümlesi yok');
  const before = (a: Element | null, b: Element | null) => !a || !b || Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  if (!before(purpose ?? h1, status)) out.push('tazelik satırı amaçtan önce');
  if (!before(status, summary)) out.push('özet tazelik satırından önce');
  return out;
}

// --- Sentetik nesil ---------------------------------------------------------------------------------------------------

const GENERATION_ID = /^[a-f0-9]{64}$/;

async function syntheticGenerationDir(): Promise<{ dir: string; id: string }> {
  const FIXTURE_ROOT = fileURLToPath(new URL('../fixtures/generation-synthetic/', import.meta.url));
  const entries = await readdir(FIXTURE_ROOT, { withFileTypes: true });
  const match = entries.find(entry => entry.isDirectory() && GENERATION_ID.test(entry.name));
  if (!match) throw new Error('fixtures/generation-synthetic altında nesil klasörü yok');
  return { dir: path.join(FIXTURE_ROOT, match.name), id: match.name };
}

/** /__aile/generation/* → sentetik nesil (salt okunur, yalnız .json ve _meta); Google istekleri kesilir. */
async function serveSyntheticGeneration(page: Page) {
  const { dir, id } = await syntheticGenerationDir();
  const json = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
  await page.route('**/__aile/generation/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    const relative = decodeURIComponent(pathname.replace(/^.*\/__aile\/generation\/?/, ''));
    if (relative === '_meta') {
      await route.fulfill({ status: 200, headers: json, body: JSON.stringify({ generation_id: id, selectedAt: new Date().toISOString() }) });
      return;
    }
    const segments = relative.split('/');
    if (!relative.endsWith('.json') || segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
      await route.fulfill({ status: 404, headers: json, body: JSON.stringify({ error: 'Dosya yok' }) });
      return;
    }
    try {
      const body = await readFile(path.join(dir, ...segments));
      await route.fulfill({ status: 200, headers: json, body });
    } catch {
      await route.fulfill({ status: 404, headers: json, body: JSON.stringify({ error: 'Dosya yok' }) });
    }
  });
  await page.route(/^https:\/\/(docs|sheets|script)\.google(usercontent)?\.com\//, route => route.abort());
}

// --- Ortak denetimler ------------------------------------------------------------------------------------------------

const MAIN = 'main#admin-content';

/** Sayfa başlığı: tek h1'i taşıyan <header> (sınıf adına bağlı değil). */
function pageHeader(page: Page): Locator {
  return page.getByRole('heading', { level: 1 }).locator('xpath=ancestor::header[1]');
}

/** h1'in hemen önündeki kardeş = bölüm adı (caption). */
function sectionCaption(page: Page): Locator {
  return page.getByRole('heading', { level: 1 }).locator('xpath=preceding-sibling::*[1]');
}

async function openRoute(page: Page, route: RouteContract) {
  await gotoAdmin(page, route.path);
  const header = pageHeader(page);
  // Lazy parça + nesil okuması bitene kadar bekle: tazelik satırı "Okunuyor…" olmaktan çıkmalı.
  await expect(header.getByRole('status')).toHaveCount(1);
  await expect(header.getByRole('status')).not.toContainText('Okunuyor', { timeout: 15_000 });
}

/** Menüde seçili (aria-current="page") bağlantının adı. Dar ekranda Sayfalar çekmecesi açılıp kapanır. */
async function currentMenuLabel(page: Page, narrow: boolean): Promise<string> {
  if (!narrow) {
    // Masaüstü nav: antd Sider → <aside> (complementary). İçerikteki olası aria-current bağlantıları sayılmaz.
    const current = page.getByRole('complementary').locator('a[aria-current="page"]');
    await expect(current).toHaveCount(1);
    return ((await current.textContent()) ?? '').trim();
  }
  const opener = page.getByRole('button', { name: 'Sayfalar', exact: true });
  await opener.click();
  const drawer = page.getByRole('dialog', { name: 'Sayfalar' });
  await expect(drawer).toBeVisible();
  const current = drawer.locator('a[aria-current="page"]');
  await expect(current).toHaveCount(1);
  const label = ((await current.textContent()) ?? '').trim();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  return label;
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
});

// --- Rota sözleşmesi (her proje/viewport) -----------------------------------------------------------------------------

test.describe('sayfa başlığı sözleşmesi', () => {
  test.beforeEach(async ({ page }) => {
    await serveSyntheticGeneration(page);
  });

  for (const route of ROUTE_CONTRACTS) {
    test(`${route.path}: h1 = menü etiketi = document.title, amaç, tek tazelik satırı, ≤3 özet, breadcrumb yok, ₺ biçimi`, async ({ page }) => {
      await openRoute(page, route);
      const narrow = (page.viewportSize()?.width ?? 1440) < 1024;

      const h1 = page.getByRole('heading', { level: 1 });
      await expect(h1).toHaveCount(1);
      await expect(h1).toHaveText(route.label);
      await expect(page).toHaveTitle(`${route.label} · aile`);
      expect(await currentMenuLabel(page, narrow), 'menüde seçili etiket h1 ile aynı').toBe(route.label);
      expect(`${(await h1.textContent())?.trim()} · aile`).toBe(await page.title());

      const header = pageHeader(page);
      await expect(sectionCaption(page)).toHaveText(route.section);
      const purpose = h1.locator('xpath=following-sibling::*[1]');
      await expect(purpose).toHaveText(route.purpose);
      await expect(purpose).toBeVisible();

      const status = header.getByRole('status');
      await expect(status).toHaveCount(1);
      await expect(status).toBeVisible();
      await expect(status).toHaveAttribute('aria-live', 'polite');
      expect(((await status.textContent()) ?? '').trim()).toMatch(DATA_STATUS_TEXT);

      const summary = header.getByRole('list', { name: 'Özet' });
      const summaryCount = (await summary.count()) === 0 ? 0 : await summary.getByRole('listitem').count();
      expect(summaryCount, 'özet en çok 3 ölçü').toBeLessThanOrEqual(SUMMARY_LIMIT);

      expect(await page.evaluate(detectHeaderOrder, MAIN), 'başlık iskeleti sırası').toEqual([]);
      await expect(page.getByRole('navigation', { name: /breadcrumb|kırıntı|yol/i })).toHaveCount(0);
      expect(await page.evaluate(detectBreadcrumbs, 'body'), 'breadcrumb izi').toEqual([]);

      expect(await page.evaluate(detectMoneyViolations, MAIN), 'başlık ve içerikte ₺ biçimi + tabular-nums').toEqual([]);
    });
  }
});

// --- Bölüm adı: 1440 ve 320 -------------------------------------------------------------------------------------------

test.describe('bölüm adı 1440', () => {
  test.skip(({ viewport }) => viewport?.width !== 1440, 'yalnız 1440 masaüstü projesi');
  test.beforeEach(async ({ page }) => {
    await serveSyntheticGeneration(page);
  });

  for (const route of ROUTE_CONTRACTS) {
    test(`${route.path}: bölüm adı h1 üstünde görünür ve ikincil ölçüde`, async ({ page }) => {
      await openRoute(page, route);
      const caption = sectionCaption(page);
      await expect(caption).toBeVisible();
      await expect(caption).toHaveText(route.section);
      const size = await caption.evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize));
      expect(size, 'bölüm adı ≥ 14 px').toBeGreaterThanOrEqual(14);
      const h1Size = await page.getByRole('heading', { level: 1 }).evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize));
      expect(size, 'bölüm adı h1 ölçüsünden küçük').toBeLessThan(h1Size);
    });
  }
});

test.describe('bölüm adı 320', () => {
  test.skip(({ viewport }) => viewport?.width !== 320, 'yalnız 320 telefon projeleri');
  test.beforeEach(async ({ page }) => {
    await serveSyntheticGeneration(page);
  });

  for (const route of ROUTE_CONTRACTS) {
    test(`${route.path}: bölüm adı 320'de de görünür, kesilmez, yatay taşma yok`, async ({ page }) => {
      await openRoute(page, route);
      const caption = sectionCaption(page);
      await expect(caption).toBeVisible();
      await expect(caption).toHaveText(route.section);
      const clipped = await caption.evaluate(element => element.scrollWidth > element.clientWidth + 1);
      expect(clipped, 'bölüm adı kesilmemeli').toBe(false);
      const size = await caption.evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize));
      expect(size, 'bölüm adı ≥ 14 px').toBeGreaterThanOrEqual(14);
      expect(await horizontalOverflow(page), 'belge düzeyinde yatay taşma').toEqual([]);
    });
  }
});
