import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, type Locator, type Page, type Route } from '@playwright/test';
import { createPrivateDataHandler, PRIVATE_DATA_PREFIX } from '../src/admin/devServer/privateData';
import { ADMIN_MAIN, enterKeyboardMode, gotoAdmin, horizontalOverflow, openAdmin } from './admin-helpers';
import { focusRing, overflow, selfCheckDetectors, smallText } from './admin-detectors';

// Yönetim paneli veri durumları — her sayfada (README › Veri durumları; DataStatus, ErrorState, Empty, Loading README'leri):
//   - Yükleniyor      → başlık (h1) yerinde, aynı yerleşimde iskelet: aria-busy="true", rakamsız etiket; DataStatus
//                       "Okunuyor…" ve "Yenile" devre dışı; tutar yok. Yanıt gelince aria-busy kalkar, DataStatus taze.
//   - Boş             → kayıtsız nesil: eksik bilgi adıyla ("Kaynakta … yok", "Henüz …"); uydurma tutar (₺0,00) yok.
//   - Hata            → ErrorState: "Hata: …" başlığı, sunucunun nedeni, "Yeniden dene"; tutar yok; DataStatus hata tonu.
//                       "Yeniden dene" kaynak düzelince veriyi gerçekten geri getirir.
//   - Eski/çevrimdışı → son iyi veri yerinde ve değişmeden; DataStatus "Son başarılı nesil <son okuma> · yenilenemedi ·
//                       Yeniden dene" uyarı tonunda; ErrorState yok. Ağ dönünce taze.
//   - Nesil 404       → AILE_GENERATION_DIR yokken: geliştirme middleware'inin GERÇEK yanıtı (createPrivateDataHandler,
//                       boş ortam) servis edilir; ErrorState nedeni anlaşılır yazar (ham JSON değil), tutar gösterilmez.
// Ağ yalnız page.route ile simüle edilir: nesil sentetik fixture'dan (fixtures/generation-synthetic); Google'a giden her
// istek (canlı GViz) kesilir, hiçbir istek internete çıkmaz. Sabit bekleme yok: hazır sinyali openAdmin, yükleme ve hata
// gözlemi gotoAdmin + web-first beklemeler. Matris genişlik testleri @matrix etiketlidir (entegrasyonda ek projelerde
// koşar). En altta öz denetim: dedektörler ve bu dosyanın durum yardımcıları bilinçli ihlali yakalamalı.

// --- Sentetik nesil ---------------------------------------------------------------------------------------------
const FIXTURE_ROOT = fileURLToPath(new URL('../fixtures/generation-synthetic/', import.meta.url));

/** fixtures/generation-synthetic altında manifest.json taşıyan (tek) nesil klasörü. */
function syntheticGenerationDir(): string {
  for (const name of readdirSync(FIXTURE_ROOT).sort()) {
    const dir = path.join(FIXTURE_ROOT, name);
    if (statSync(dir).isDirectory() && existsSync(path.join(dir, 'manifest.json'))) return dir;
  }
  throw new Error(`Hata: ${FIXTURE_ROOT} altında sentetik nesil yok`);
}

const GENERATION_DIR = syntheticGenerationDir();
const MANIFEST_TEXT = readFileSync(path.join(GENERATION_DIR, 'manifest.json'), 'utf8');

interface ManifestFileEntry { path: string; sha256: string; kind?: string; collection?: string }
interface ManifestShape { generation_id: string; files: ManifestFileEntry[]; counts: Record<string, number> }
const MANIFEST = JSON.parse(MANIFEST_TEXT) as ManifestShape;

const PURCHASE_PATH = (() => {
  const entry = MANIFEST.files.find(file => file.kind === 'partition' && file.collection === 'purchase_needs');
  if (!entry) throw new Error('Hata: sentetik manifestte purchase_needs parçası yok');
  return entry.path;
})();

interface PartitionShape { records: Array<{ label?: string }> }
const PURCHASE = JSON.parse(readFileSync(path.join(GENERATION_DIR, PURCHASE_PATH), 'utf8')) as PartitionShape;
/** Sentetik fixture'daki ilk alımın adı ("Örnek …"); listede/tabloda görünürlüğü veri yüklendi demektir. */
const FIRST_LABEL = PURCHASE.records[0]?.label ?? '';
/** Bozuk parçaya yazılan ad; yayınlanırsa bütünlük doğrulaması delinmiş demektir. */
const TAMPERED_LABEL = 'Bozuk kayıt e2e';

const derivedGenerationId = (salt: string) => createHash('sha256').update(`${MANIFEST.generation_id}:${salt}`).digest('hex');

/** Yeni nesil kimliği (64 hex) + manifest hash'i değişmeden bozulan purchase_needs parçası. */
const TAMPERED_MANIFEST = JSON.stringify({ ...MANIFEST, generation_id: derivedGenerationId('bozuk') });
const TAMPERED_PURCHASE = JSON.stringify({
  ...PURCHASE,
  records: PURCHASE.records.map((record, index) => (index === 0 ? { ...record, label: TAMPERED_LABEL } : record)),
});

/** Geçerli ama kayıtsız nesil: hiçbir parça yok, bütün sayımlar sıfır (yeni kurulan hane). */
const EMPTY_MANIFEST = JSON.stringify({
  ...MANIFEST,
  generation_id: derivedGenerationId('bos'),
  files: MANIFEST.files.filter(file => file.kind !== 'partition'),
  counts: Object.fromEntries(Object.keys(MANIFEST.counts).map(name => [name, 0])),
});

/** 500 yanıtının nedeni; ErrorState bunu kullanıcıya yazmalı. */
const SERVER_CAUSE = 'Nesil deposu geçici olarak yanıt vermiyor (e2e)';

// --- Geliştirme middleware'inin gerçek 404 yanıtı (AILE_GENERATION_DIR yok) ------------------------------------
interface CapturedResponse { status: number; contentType: string; body: string }

/** createPrivateDataHandler'ı boş ortamla Node'da çalıştırır; tarayıcıya aynen bu yanıt verilir (tahmin değil). */
async function middlewareResponse(relativePath: string, env: { AILE_GENERATION_DIR?: string }): Promise<CapturedResponse> {
  const handler = createPrivateDataHandler(() => env);
  return new Promise<CapturedResponse>((resolve, reject) => {
    const headers: Record<string, string> = {};
    const res = {
      statusCode: 200,
      setHeader(name: string, value: string | number) {
        headers[name.toLowerCase()] = String(value);
      },
      end(chunk?: string | Uint8Array) {
        const body = chunk === undefined ? '' : typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
        resolve({ status: res.statusCode, contentType: headers['content-type'] ?? 'application/json', body });
      },
    };
    const req = { url: `${PRIVATE_DATA_PREFIX}/${relativePath}`, method: 'GET' } as IncomingMessage;
    handler(req, res as unknown as ServerResponse, error => reject(error ?? new Error(`middleware ${relativePath} için next() çağırdı`)));
  });
}

let noDirResponse: Promise<CapturedResponse> | undefined;
const generationDirMissing = () => (noDirResponse ??= middlewareResponse('manifest.json', {}));

// --- Ağ simülasyonu ------------------------------------------------------------------------------------------------
type GenerationMode = 'ok' | 'hold' | 'empty' | 'server-error' | 'offline' | 'no-dir' | 'tampered' | 'partition-error';

interface GenerationRoute {
  mode: GenerationMode;
  /** İstenen göreli yollar (manifest.json, data/…); sırayla. */
  readonly hits: string[];
  /** 'hold' modunda bekleyen yanıtları bırakır ve modu 'ok' yapar. */
  release(): void;
}

/** /__aile/generation/** isteklerini sentetik nesilden yanıtlar; mod çalışırken değiştirilebilir. */
async function routeGeneration(page: Page, mode: GenerationMode = 'ok'): Promise<GenerationRoute> {
  let open: () => void = () => undefined;
  const gate = new Promise<void>(resolve => {
    open = resolve;
  });
  const state: GenerationRoute = {
    mode,
    hits: [],
    release() {
      state.mode = 'ok';
      open();
    },
  };
  const prefix = `${PRIVATE_DATA_PREFIX}/`;
  await page.route(`**${prefix}**`, async (route: Route) => {
    const { pathname } = new URL(route.request().url());
    const at = pathname.indexOf(prefix);
    const rel = at >= 0 ? decodeURIComponent(pathname.slice(at + prefix.length)) : '';
    state.hits.push(rel);
    if (state.mode === 'hold') await gate;
    const notFound = () => route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Dosya yok' }) });
    if (!rel || rel.split('/').some(segment => segment === '' || segment === '.' || segment === '..')) return notFound();
    switch (state.mode) {
      case 'offline':
        return route.abort('internetdisconnected');
      case 'server-error':
        return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: SERVER_CAUSE }) });
      case 'no-dir': {
        const real = await generationDirMissing();
        return route.fulfill({ status: real.status, contentType: real.contentType, body: real.body });
      }
      case 'empty':
        return rel === 'manifest.json' ? route.fulfill({ contentType: 'application/json', body: EMPTY_MANIFEST }) : notFound();
      case 'partition-error':
        if (rel === PURCHASE_PATH) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: SERVER_CAUSE }) });
        break;
      case 'tampered':
        if (rel === 'manifest.json') return route.fulfill({ contentType: 'application/json', body: TAMPERED_MANIFEST });
        if (rel === PURCHASE_PATH) return route.fulfill({ contentType: 'application/json', body: TAMPERED_PURCHASE });
        break;
      default:
        break;
    }
    const file = path.join(GENERATION_DIR, ...rel.split('/'));
    if (!file.startsWith(GENERATION_DIR + path.sep) || !existsSync(file)) return notFound();
    return route.fulfill({ contentType: 'application/json', body: readFileSync(file) });
  });
  return state;
}

/** Canlı GViz ve diğer Google uçları: hiçbir istek internete çıkmaz (fetch stub = kesilen istek). */
async function blockGoogle(page: Page): Promise<string[]> {
  const blocked: string[] = [];
  const stop = async (route: Route) => {
    blocked.push(new URL(route.request().url()).hostname);
    await route.abort('blockedbyclient');
  };
  for (const pattern of ['https://docs.google.com/**', 'https://*.googleapis.com/**', 'https://*.google.com/**', 'https://*.gstatic.com/**']) {
    await page.route(pattern, stop);
  }
  return blocked;
}

test.beforeEach(async ({ page }) => {
  await blockGoogle(page);
});

// --- Sayfalar ------------------------------------------------------------------------------------------------------
// h1 metinleri shell/navigation.ts etiketleridir (o modül Vite ortamı istediği için burada içe aktarılmaz).
const PAGES: ReadonlyArray<{ path: string; h1: string }> = [
  { path: '/genel', h1: 'Genel durum' },
  { path: '/butce', h1: 'Bütçe ve nakit' },
  { path: '/odemeler', h1: 'Ödemeler' },
  { path: '/hesaplar', h1: 'Hesaplar ve borçlar' },
  { path: '/alimlar', h1: 'Alımlar ve eşyalar' },
  { path: '/ev', h1: 'Ev ve odalar' },
  { path: '/projeler', h1: 'Projeler ve görevler' },
  { path: '/taraflar', h1: 'Taraflar ve teklifler' },
  { path: '/raporlar', h1: 'Raporlar' },
  { path: '/sozlukler', h1: 'Sözlükler ve iş akışları' },
  { path: '/veri', h1: 'Veri kalitesi ve içe aktarma' },
  { path: '/ayarlar', h1: 'Ayarlar' },
];

// --- Konumlayıcılar ve durum yardımcıları --------------------------------------------------------------------------
const main = (page: Page) => page.locator(ADMIN_MAIN);
/** Sayfa başlığındaki tazelik satırı (DataStatus: role=status + data-state); Bütçe'nin canlı satırı başlık dışındadır. */
const headerStatus = (page: Page) => main(page).locator('header').filter({ has: page.locator('h1') }).locator('[role="status"][data-state]').first();
const errorStates = (page: Page) => main(page).getByRole('alert').filter({ has: page.getByRole('heading', { name: /^Hata: / }) });
const busy = (page: Page) => page.locator('[aria-busy="true"]');
const emptyState = (page: Page) => page.getByRole('status').filter({ has: page.getByRole('heading', { name: 'Bu filtrelerle kayıt yok' }) });

/** tr-TR para ("₺8.500,00") ya da iki ondalıklı tutar; hata/boş/yükleniyor durumunda hiçbiri görünmemeli. */
const AMOUNT_SOURCE = String.raw`₺\s?\d[\d.]*(?:,\d+)?|\d[\d.]*(?:,\d+)?\s?₺|\d{1,3}(?:\.\d{3})*,\d{2}(?!\d)`;
/** Eksik bilginin adıyla yazılması: "Kaynakta alım kaydı yok", "Henüz kayıt yok", "Henüz yok". */
const NAMED_MISSING = /\b(?:Kaynakta|Henüz)\b[^.!?\n]{0,60}?\byok\b/i;
/** DataStatus saati: bugünse "14:32", başka günse "27.10.2026 14:32". */
const CLOCK = String.raw`(?:\d{2}\.\d{2}\.\d{4} )?\d{2}:\d{2}`;

/** Kök (varsayılan main) içindeki tutar görünümleri; boş liste = tutar yok. */
async function amountsIn(page: Page, root: string = ADMIN_MAIN): Promise<string[]> {
  return page.evaluate(([selector, source]) => {
    const el = document.querySelector(selector);
    if (!el) return [`kök yok: ${selector}`];
    return Array.from((el as HTMLElement).innerText.matchAll(new RegExp(source, 'g')), match => match[0]);
  }, [root, AMOUNT_SOURCE] as const);
}

/**
 * main'in görünen metni (innerText: bloklar satırla ayrılır), `exclude` seçicisine uyan öğeler hariç. Hariç öğeler aynı
 * eşzamanlı çağrıda geçici olarak display:none yapılır ve hemen eski satır içi stillerine döner (arada çizim yok).
 */
async function visibleTextWithout(page: Page, exclude: string): Promise<string> {
  return page.evaluate(([selector, skip]) => {
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) return '';
    const hidden = Array.from(el.querySelectorAll<HTMLElement>(skip)).map(node => ({
      node,
      value: node.style.getPropertyValue('display'),
      priority: node.style.getPropertyPriority('display'),
    }));
    for (const { node } of hidden) node.style.setProperty('display', 'none', 'important');
    try {
      return el.innerText.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
    } finally {
      for (const { node, value, priority } of hidden) {
        if (value) node.style.setProperty('display', value, priority);
        else node.style.removeProperty('display');
      }
    }
  }, [ADMIN_MAIN, exclude] as const);
}

/**
 * Eski veri karşılaştırması için içerik: canlı durum bölgeleri (role=status: tazelik satırları, "Grafik hazırlanıyor"
 * gibi bekleme metinleri) hariç. Kayıtlar, tutarlar ve özet bu metindedir; yenileme başarısız olunca değişmemeli.
 */
const contentText = (page: Page) => visibleTextWithout(page, '[role="status"]');
/** İçerik alanının söylediği: sayfa başlığı (header) hariç main metni. */
const bodyText = (page: Page) => visibleTextWithout(page, 'header');

/**
 * Yerleşmiş içerik metni (eski veri karşılaştırmasının tabanı). openAdmin'in hazır sinyali geniş profilde geç gelen
 * parçaları beklemez: lazyWide önce telefon sunumunu yedek olarak çizer, geniş modül (ör. Bütçe trendi, Genel tablo
 * görünümü, Hesaplar projeksiyon tablosu) gelince yerini alır. Taban o ana kadar alınırsa yenilemeden bağımsız bu
 * değişim "son iyi veri değişti" diye okunur. Ağ sessizleşir (bekleyen modül/veri isteği yok) ve içerik ardışık iki
 * okumada (en az 300 ms arayla) aynı kalınca döner; sabit bekleme yok.
 */
async function settledContent(page: Page): Promise<string> {
  await page.waitForLoadState('networkidle');
  let previous: string | null = null;
  let current = '';
  await expect.poll(async () => {
    current = await contentText(page);
    const same = current === previous;
    previous = current;
    return same;
  }, { message: 'içerik yerleşmedi (geç gelen geniş parça ya da veri)', intervals: [300, 500, 1000] }).toBe(true);
  return current;
}

/** Konumlayıcıya geçici, testlik bir seçici verir; dedektör seçeneği string kök/hedef alır. */
async function mark(locator: Locator, id: string): Promise<string> {
  await locator.evaluate((el, value) => el.setAttribute('data-e2e-dedektor', value), id);
  return `[data-e2e-dedektor="${id}"]`;
}

const isChromium = (projectName: string) => projectName.startsWith('chromium');

/** Dokunma hedefi: 44 px; kaba işaretçi katmanı açıkken (html[data-input-coarse]) 48 px. */
async function targetViolations(page: Page, locator: Locator, name: string): Promise<string[]> {
  const coarse = await page.evaluate(() => document.documentElement.hasAttribute('data-input-coarse'));
  const min = coarse ? 48 : 44;
  const box = await locator.boundingBox();
  if (!box) return [`${name}: kutu yok`];
  return box.width + 0.5 < min || box.height + 0.5 < min ? [`${name}: ${Math.round(box.width)}×${Math.round(box.height)} < ${min}`] : [];
}

// --- 1. Her sayfada beş veri durumu -------------------------------------------------------------------------------
for (const { path: route, h1 } of PAGES) {
  test.describe(`${route} veri durumları`, () => {
    test(`${route} yükleniyor: başlık yerinde, aria-busy iskelet, DataStatus "Okunuyor…", tutar yok; yanıtla taze`, async ({ page }) => {
      const generation = await routeGeneration(page, 'hold');
      await gotoAdmin(page, route);
      await expect.poll(() => generation.hits.length, { message: 'nesil isteği beklemede' }).toBeGreaterThan(0);

      await expect(main(page).locator('h1')).toHaveText(h1);
      const status = headerStatus(page);
      await expect(status, 'sayfa bileşeni kendi tazelik satırıyla çizildi').toHaveAttribute('data-state', 'checking');
      await expect(status).toContainText('Okunuyor');
      await expect(status.getByRole('button', { name: 'Yenile' })).toBeDisabled();

      const shell = main(page).locator('[aria-busy="true"]').first();
      await expect(shell).toBeVisible();
      await expect(shell.locator('[data-part="row"]').first(), 'iskelet satırı').toBeVisible();
      expect(await shell.innerText(), 'yükleme etiketi rakam/yüzde içermez').not.toMatch(/\d|%/);
      expect(await amountsIn(page), 'yüklenirken tutar').toEqual([]);
      await expect(errorStates(page)).toHaveCount(0);

      generation.release();
      await expect(busy(page)).toHaveCount(0);
      await expect(status).toHaveAttribute('data-state', 'fresh');
      await expect(status).toContainText(new RegExp(`Son okuma ${CLOCK}`));
      await expect(main(page).locator('h1')).toHaveText(h1);
    });

    test(`${route} boş: kayıtsız nesilde eksik bilgi adıyla, uydurma tutar yok`, async ({ page }) => {
      await routeGeneration(page, 'empty');
      await openAdmin(page, route);

      await expect(main(page).locator('h1')).toHaveText(h1);
      await expect(headerStatus(page)).toHaveAttribute('data-state', 'fresh');
      await expect(errorStates(page)).toHaveCount(0);
      expect(await bodyText(page), 'içerik alanı boşluğu adıyla söyler ("Kaynakta … yok" / "Henüz …")').toMatch(NAMED_MISSING);
      expect(await amountsIn(page), 'kayıtsız nesilde tutar uydurulmaz').toEqual([]);
    });

    test(`${route} hata: ErrorState nedeni ve "Yeniden dene", tutar yok; yeniden dene veriyi getirir`, async ({ page }) => {
      const generation = await routeGeneration(page, 'server-error');
      await gotoAdmin(page, route);

      const alert = errorStates(page).first();
      await expect(alert).toBeVisible();
      await expect(alert).toContainText(SERVER_CAUSE);
      const retry = alert.getByRole('button', { name: 'Yeniden dene' });
      await expect(retry).toBeVisible();
      await expect(busy(page)).toHaveCount(0);
      expect(await amountsIn(page), 'hata durumunda tutar').toEqual([]);

      const status = headerStatus(page);
      await expect(status).toHaveAttribute('data-state', 'error');
      await expect(status).toHaveAttribute('data-tone', 'hata');
      await expect(status).toContainText('Hata:');

      generation.mode = 'ok';
      const before = generation.hits.filter(hit => hit === 'manifest.json').length;
      await retry.click();
      await expect.poll(() => generation.hits.filter(hit => hit === 'manifest.json').length, { message: 'manifest yeniden istendi' }).toBeGreaterThan(before);
      await expect(status).toHaveAttribute('data-state', 'fresh');
      await expect(errorStates(page), 'kaynak düzelince ErrorState kalkar').toHaveCount(0);
      await expect(busy(page)).toHaveCount(0);
    });

    test(`${route} eski veri/çevrimdışı: son iyi veri değişmeden kalır, DataStatus son okuma saatiyle "yenilenemedi"`, async ({ page }) => {
      const generation = await routeGeneration(page, 'ok');
      await openAdmin(page, route);

      const status = headerStatus(page);
      await expect(status).toHaveAttribute('data-state', 'fresh');
      const fresh = (await status.innerText()).match(new RegExp(`Son okuma (${CLOCK})`));
      expect(fresh, 'taze satırda son okuma saati').not.toBeNull();
      const lastRead = fresh![1];
      const before = await settledContent(page);

      generation.mode = 'offline';
      await status.getByRole('button', { name: 'Yenile' }).click();
      await expect(status).toHaveAttribute('data-state', 'stale');
      await expect(status).toHaveAttribute('data-tone', 'uyari');
      await expect(status).toContainText(`Son başarılı nesil ${lastRead}`);
      await expect(status).toContainText('yenilenemedi');
      const retry = status.getByRole('button', { name: 'Yeniden dene' });
      await expect(retry).toBeVisible();

      await expect(errorStates(page), 'eski veri ErrorState değildir').toHaveCount(0);
      await expect(busy(page)).toHaveCount(0);
      expect(await contentText(page), 'son iyi veri aynen yerinde').toBe(before);

      generation.mode = 'ok';
      await retry.click();
      await expect(status).toHaveAttribute('data-state', 'fresh');
      await expect(status).toContainText(new RegExp(`Son okuma ${CLOCK}`));
    });

    test(`${route} nesil 404 (AILE_GENERATION_DIR yok): anlaşılır neden, tutar yok, Yeniden dene`, async ({ page }) => {
      const real = await generationDirMissing();
      expect(real.status, 'middleware AILE_GENERATION_DIR yokken 404 döner').toBe(404);
      const cause = (JSON.parse(real.body) as { error: string }).error;
      expect(cause).toContain('AILE_GENERATION_DIR');

      await routeGeneration(page, 'no-dir');
      await gotoAdmin(page, route);

      const alert = errorStates(page).first();
      await expect(alert).toBeVisible();
      await expect(alert, 'ErrorState neden olarak middleware açıklamasını yazar').toContainText(cause);
      expect(await alert.innerText(), 'ham JSON gösterilmez').not.toMatch(/[{}]|"error"/);
      await expect(alert.getByRole('button', { name: 'Yeniden dene' })).toBeVisible();
      await expect(busy(page)).toHaveCount(0);
      expect(await amountsIn(page), 'nesil yokken tutar').toEqual([]);

      const status = headerStatus(page);
      await expect(status).toHaveAttribute('data-state', 'error');
      await expect(status).toHaveAttribute('data-tone', 'hata');

      expect(await smallText(page, { root: await mark(alert, 'hata'), min: 14 }), 'ErrorState metin boyutu').toEqual([]);
      expect(await smallText(page, { root: await mark(status, 'durum'), min: 14 }), 'DataStatus metin boyutu').toEqual([]);
    });
  });
}

// --- 2. Parça okunamıyor (manifest sağlam) ---------------------------------------------------------------------
test('parça okunamıyor: Alımlar ErrorState nedeni yazar, tutar yok; Yeniden dene kaydı getirir', async ({ page }) => {
  expect(FIRST_LABEL, 'sentetik fixture ilk alım adı').not.toBe('');
  const generation = await routeGeneration(page, 'partition-error');
  await gotoAdmin(page, '/alimlar');

  const alert = errorStates(page).first();
  await expect(alert).toBeVisible();
  await expect(alert).toContainText(SERVER_CAUSE);
  await expect(busy(page)).toHaveCount(0);
  expect(await amountsIn(page), 'kısmi veriyle tutar').toEqual([]);

  generation.mode = 'ok';
  await alert.getByRole('button', { name: 'Yeniden dene' }).click();
  await expect(page.getByText(FIRST_LABEL, { exact: true }).first()).toBeVisible();
  await expect(errorStates(page)).toHaveCount(0);
});

// --- 2b. Bütçe: canlı Sheet (GViz) ulaşılamıyor ----------------------------------------------------------------
test('/butce canlı Sheet ulaşılamıyor: istek kesilir, Türkçe neden ve "Yeniden dene"; ham tarayıcı hatası yok', async ({ page }) => {
  const google: string[] = [];
  await page.route('https://docs.google.com/**', async route => {
    google.push(new URL(route.request().url()).pathname);
    await route.abort('internetdisconnected');
  });
  await routeGeneration(page, 'ok');
  await openAdmin(page, '/butce');

  const live = main(page).getByRole('region', { name: 'Canlı Sheet' }).locator('[role="status"][data-state]');
  await expect(live).toHaveAttribute('data-state', 'error');
  expect(google.length, 'canlı okuma yalnız kesilen sahte uca gitti (internete çıkmadı)').toBeGreaterThan(0);
  await expect(live).toHaveAttribute('data-tone', 'hata');
  const text = await live.innerText();
  expect(text).toMatch(/Hata: \S/);
  expect(text, 'motorun ham İngilizce hata metni neden olarak gösterilmez').not.toMatch(/Failed to fetch|Load failed|NetworkError|TypeError/i);
  const retry = live.getByRole('button', { name: 'Yeniden dene' });
  await expect(retry).toBeVisible();
  // Canlı satırın hatası nesil tazeliğini bozmaz; nesil verisi yerinde.
  await expect(headerStatus(page)).toHaveAttribute('data-state', 'fresh');
  await expect(errorStates(page)).toHaveCount(0);

  const before = google.length;
  await retry.click();
  await expect.poll(() => google.length, { message: 'Yeniden dene canlı okumayı tekrarlar' }).toBeGreaterThan(before);
  await expect(live).toHaveAttribute('data-state', 'error');
});

// --- 3. Yenilemede bozuk hash ---------------------------------------------------------------------------------
test('bozuk hash yenilemede: son iyi veri korunur, DataStatus "yenilenemedi" uyarı tonunda', async ({ page }) => {
  expect(FIRST_LABEL, 'sentetik fixture ilk alım adı').not.toBe('');
  const generation = await routeGeneration(page, 'ok');
  await openAdmin(page, '/alimlar');

  // Önce başarılı yükleme: taze nesil ve sentetik kayıt görünür.
  const status = headerStatus(page);
  await expect(status).toHaveAttribute('data-state', 'fresh');
  await expect(page.getByText(FIRST_LABEL, { exact: true }).first()).toBeVisible();

  // Sonra yenileme: yeni nesil kimliği, ama purchase_needs parçası manifest hash'iyle uyuşmuyor.
  generation.mode = 'tampered';
  const purchaseReads = () => generation.hits.filter(hit => hit === PURCHASE_PATH).length;
  const readsBefore = purchaseReads();
  await status.getByRole('button', { name: 'Yenile' }).click();
  await expect.poll(purchaseReads, { message: 'bozuk parça yenilemede yeniden istendi' }).toBeGreaterThan(readsBefore);

  // DataStatus "eski": "Son başarılı nesil … · yenilenemedi · Yeniden dene", uyarı metni (şerit değil).
  await expect(status).toHaveAttribute('data-state', 'stale');
  await expect(status).toHaveAttribute('data-tone', 'uyari');
  await expect(status).toContainText('Son başarılı nesil');
  await expect(status).toContainText('yenilenemedi');
  await expect(status.getByRole('button', { name: 'Yeniden dene' })).toBeVisible();

  // Son iyi veri yerinde; bozuk içerik yayınlanmadı; sayfa ErrorState'e düşmedi (eski veri ErrorState değildir).
  await expect(page.getByText(FIRST_LABEL, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(TAMPERED_LABEL)).toHaveCount(0);
  await expect(errorStates(page)).toHaveCount(0);
  expect(await smallText(page, { root: await mark(status, 'durum'), min: 14 }), 'DataStatus metin boyutu').toEqual([]);
});

// --- 4. Filtreyle boş sonuç ------------------------------------------------------------------------------------
test('boş sonuç: EmptyState etkin filtreleri yazar, "Filtreleri temizle" kayıtları geri getirir', async ({ page }, testInfo) => {
  const search = 'zzqx-eslesmeyen';
  await routeGeneration(page, 'ok');
  await gotoAdmin(page, `/alimlar/?ara=${search}`);

  const empty = emptyState(page);
  await expect(empty).toBeVisible();
  await expect(empty.getByRole('list')).toContainText(`Arama: ${search}`);
  await expect(page.getByText(FIRST_LABEL, { exact: true })).toHaveCount(0);
  expect(await smallText(page, { root: await mark(empty, 'bos'), min: 14 }), 'EmptyState metin boyutu').toEqual([]);
  if (isChromium(testInfo.project.name)) expect(await horizontalOverflow(page), 'belge düzeyinde yatay taşma').toEqual([]);

  await empty.getByRole('button', { name: 'Filtreleri temizle' }).click();
  await expect(emptyState(page)).toHaveCount(0);
  await expect(page.getByText(FIRST_LABEL, { exact: true }).first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.location.hash)).not.toContain('ara=');
});

// --- 5. Klasör içe aktarma desteği -----------------------------------------------------------------------------
test.describe('Klasörden içe aktar', () => {
  const reason = 'Bu tarayıcı klasör içe aktarmayı desteklemiyor; nesil geliştirme sunucusundan okunur.';

  // Özellik algılama (pages/veri/klasor.ts): showDirectoryPicker (Chromium) → <input type="file" webkitdirectory> yedeği
  // (Safari/WebKit) → yok. "Desteklenmeyen" ikisinin de olmamasıdır; yalnız seçiciyi silmek WebKit yolunu açık bırakır.
  test('ne seçici ne webkitdirectory olan tarayıcıda düğme devre dışı ve nedeni yanında yazar', async ({ page }) => {
    await page.addInitScript(() => {
      const host = window as unknown as Record<string, unknown>;
      try {
        delete (Window.prototype as unknown as Record<string, unknown>).showDirectoryPicker;
      } catch {
        /* prototipte yok */
      }
      Object.defineProperty(host, 'showDirectoryPicker', { value: undefined, configurable: true, writable: true });
      try {
        delete (HTMLInputElement.prototype as unknown as Record<string, unknown>).webkitdirectory;
      } catch {
        /* silinemez */
      }
    });
    await routeGeneration(page, 'ok');
    await gotoAdmin(page, '/veri');

    const button = page.getByRole('button', { name: 'Klasörden içe aktar' });
    await expect(button).toBeVisible();
    await expect(button).toBeDisabled();
    await expect(button).toHaveAccessibleDescription(reason);
    await expect(page.getByText(reason)).toBeVisible();
  });

  test('düğme durumu motorun gerçek desteğini izler (Chromium seçici, WebKit webkitdirectory yedeği: etkin; ikisi yoksa devre dışı + neden)', async ({ page }) => {
    await routeGeneration(page, 'ok');
    await gotoAdmin(page, '/veri');
    const supported = await page.evaluate(() =>
      typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function'
      || 'webkitdirectory' in document.createElement('input'));
    const button = page.getByRole('button', { name: 'Klasörden içe aktar' });
    if (supported) {
      await expect(button).toBeEnabled();
      await expect(page.getByText(reason)).toHaveCount(0);
    } else {
      await expect(button).toBeDisabled();
      await expect(button).toHaveAccessibleDescription(reason);
    }
  });
});

// --- 6. Matris: durum yüzeyleri her genişlikte okunur, taşmaz, dokunulur ------------------------------------------
test.describe('Durum yüzeyleri matris genişliklerinde', () => {
  test('Alımlar: nesil 404 ve eski veri yüzeyleri taşmaz, metin ≥14 px, odak halkasız, hedef ≥44/48 px', { tag: '@matrix' }, async ({ page, browserName }) => {
    const generation = await routeGeneration(page, 'no-dir');
    await gotoAdmin(page, '/alimlar');
    const alert = errorStates(page).first();
    await expect(alert).toBeVisible();
    const hata = await mark(alert, 'matris-hata');
    expect.soft(await overflow(page, { root: hata }), 'ErrorState taşma/kesilme').toEqual([]);
    expect.soft(await smallText(page, { root: hata, min: 14 }), 'ErrorState metin boyutu').toEqual([]);
    const retry = alert.getByRole('button', { name: 'Yeniden dene' });
    expect.soft(await targetViolations(page, retry, 'ErrorState Yeniden dene'), 'dokunma hedefi').toEqual([]);
    await enterKeyboardMode(page, browserName);
    await retry.focus();
    expect.soft(await focusRing(page, { target: await mark(retry, 'matris-yeniden'), keyboard: true }), 'Yeniden dene odağı').toEqual([]);

    generation.mode = 'ok';
    await openAdmin(page, '/alimlar');
    const status = headerStatus(page);
    generation.mode = 'offline';
    await status.getByRole('button', { name: 'Yenile' }).click();
    await expect(status).toHaveAttribute('data-state', 'stale');
    const durum = await mark(status, 'matris-durum');
    expect.soft(await overflow(page, { root: durum }), 'DataStatus taşma/kesilme').toEqual([]);
    expect.soft(await smallText(page, { root: durum, min: 14 }), 'DataStatus metin boyutu').toEqual([]);
    expect.soft(await targetViolations(page, status.getByRole('button', { name: 'Yeniden dene' }), 'DataStatus Yeniden dene'), 'dokunma hedefi').toEqual([]);
  });

  test('Alımlar: yükleniyor ve kayıtsız nesil yüzeyleri taşmaz, metin ≥14 px', { tag: '@matrix' }, async ({ page }) => {
    const generation = await routeGeneration(page, 'hold');
    await gotoAdmin(page, '/alimlar');
    // Sayfanın kendi iskeleti ("Alımlar yükleniyor"). İlk [aria-busy] rota yedeği (routes.tsx RouteFallback, "Yükleniyor")
    // olabilir; sayfa parçası gelince o düğüm yerini sayfanınkine bırakır ve üzerine konan işaret kaybolur. Geniş profilde
    // sağlayıcı geçidi (AdaptiveRoot kökü aria-busy) bağlanınca çalışma alanı bir kez yeniden kurulur; işaret ondan sonra.
    await expect(page.locator('[aria-busy="true"]:not(main *)'), 'sağlayıcı geçidi bağlandı').toHaveCount(0);
    const shell = main(page).locator('[aria-busy="true"]').filter({ hasText: 'Alımlar yükleniyor' });
    await expect(shell).toBeVisible();
    const iskelet = await mark(shell, 'matris-iskelet');
    expect.soft(await overflow(page, { root: iskelet }), 'iskelet taşma').toEqual([]);
    expect.soft(await smallText(page, { root: iskelet, min: 14 }), 'iskelet etiketi metin boyutu').toEqual([]);
    generation.release();
    await expect(busy(page)).toHaveCount(0);

    generation.mode = 'empty';
    await openAdmin(page, '/alimlar');
    const named = main(page).getByText(NAMED_MISSING).first();
    await expect(named).toBeVisible();
    const bos = await mark(named, 'matris-bos');
    expect.soft(await overflow(page, { root: bos }), 'boş durum taşma/kesilme').toEqual([]);
    expect.soft(await smallText(page, { root: bos, min: 14 }), 'boş durum metin boyutu').toEqual([]);
  });
});

// --- 7. Öz denetim: dedektörler ve durum yardımcıları bilinçli ihlali yakalar -----------------------------------
test.describe('Öz denetim', () => {
  test('14 px altı metin, çevreleyen odak halkası ve yatay taşma yakalanır', async ({ page, browserName }) => {
    await routeGeneration(page, 'no-dir');
    await gotoAdmin(page, '/alimlar');
    await expect(errorStates(page).first()).toBeVisible();

    await page.evaluate(() => {
      const host = document.querySelector('main')!;
      const small = document.createElement('div');
      small.setAttribute('data-e2e-ihlal', 'kucuk');
      const smallText = document.createElement('span');
      smallText.style.setProperty('font-size', '12px', 'important');
      smallText.textContent = 'Küçük metin ihlali';
      small.append(smallText);
      const ring = document.createElement('button');
      ring.type = 'button';
      ring.setAttribute('data-e2e-ihlal', 'halka');
      ring.style.setProperty('outline', '2px solid rgb(0, 0, 255)', 'important');
      ring.style.setProperty('outline-offset', '2px', 'important');
      ring.textContent = 'Halkalı düğme';
      const wide = document.createElement('div');
      wide.setAttribute('data-e2e-ihlal', 'tasma');
      wide.style.width = '4000px';
      wide.textContent = 'Taşan blok';
      host.append(small, ring);
      document.body.append(wide);
    });

    expect((await smallText(page, { root: '[data-e2e-ihlal="kucuk"]', min: 14 })).join('\n'), 'küçük metin yakalanmalı').toMatch(/Küçük metin ihlali/);

    await enterKeyboardMode(page, browserName);
    await page.locator('[data-e2e-ihlal="halka"]').focus();
    expect((await focusRing(page, { target: '[data-e2e-ihlal="halka"]', keyboard: true })).join('\n'), 'odak halkası yakalanmalı').toMatch(/outline/);

    expect(await horizontalOverflow(page), 'yatay taşma yakalanmalı').not.toEqual([]);
    expect(await overflow(page, { root: '[data-e2e-ihlal="tasma"]', truncation: false }), 'taşma dedektörü yakalamalı').not.toEqual([]);

    // Modülün kendi öz denetimi (beş kural, CSSOM ile enjekte): yakalamayan dedektör adı dönmemeli.
    expect(await selfCheckDetectors(page), 'ihlali yakalamayan dedektörler').toEqual([]);
  });

  test('durum yardımcıları kör değil: tutar, aria-busy, adsız boşluk, içerik değişimi ve küçük hedef yakalanır', async ({ page }) => {
    await routeGeneration(page, 'no-dir');
    await gotoAdmin(page, '/alimlar');
    const alert = errorStates(page).first();
    await expect(alert).toBeVisible();
    expect(await amountsIn(page), 'enjeksiyon öncesi temiz').toEqual([]);
    const before = await contentText(page);

    // Tutar: tr-TR para ve iki ondalıklı biçim ayrı ayrı yakalanmalı.
    await page.evaluate(() => {
      const p = document.createElement('p');
      p.setAttribute('data-e2e-ihlal', 'tutar');
      p.textContent = 'Toplam ₺8.500,00 · kalan 1.250,50';
      document.querySelector('main [role="alert"]')!.append(p);
    });
    expect(await amountsIn(page), 'tutar yakalanmalı').toEqual(['₺8.500,00', '1.250,50']);
    expect(await contentText(page), 'içerik değişimi yakalanmalı').not.toBe(before);

    // Tazelik satırı değişimi içerik sayılmaz (DataStatus hariç tutulur).
    await page.evaluate(() => document.querySelector('[data-e2e-ihlal="tutar"]')!.remove());
    await page.evaluate(() => {
      const status = document.querySelector('main header [role="status"][data-state]')!;
      status.append(document.createTextNode(' 99:99'));
    });
    expect(await contentText(page), 'DataStatus metni içerik karşılaştırmasına girmez').toBe(before);

    // aria-busy: yükleme bitmiş sayfada enjekte edilen meşgul öğe sayılmalı.
    await page.evaluate(() => {
      const el = document.createElement('div');
      el.setAttribute('aria-busy', 'true');
      el.textContent = 'meşgul';
      document.querySelector('main')!.append(el);
    });
    await expect(busy(page)).toHaveCount(1);

    // Adıyla boşluk: genel "Boş" metni yetmez; "Kaynakta … yok" yakalanır.
    expect('Boş').not.toMatch(NAMED_MISSING);
    expect('Kaynakta alım kaydı yok').toMatch(NAMED_MISSING);
    expect('Henüz kayıt yok').toMatch(NAMED_MISSING);

    // Dokunma hedefi: 20 px düğme ihlal sayılmalı.
    await page.evaluate(() => {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('data-e2e-ihlal', 'hedef');
      button.style.cssText = 'width:20px;height:20px;padding:0;font-size:14px';
      button.textContent = 'x';
      document.querySelector('main')!.append(button);
    });
    expect(await targetViolations(page, page.locator('[data-e2e-ihlal="hedef"]'), 'küçük hedef'), 'küçük hedef yakalanmalı').not.toEqual([]);
  });
});
