import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, type Locator, type Page, type Route } from '@playwright/test';
import { enterKeyboardMode, gotoAdmin, horizontalOverflow } from './admin-helpers';
import { focusRing, selfCheckDetectors, smallText } from './admin-detectors';

// Yönetim paneli veri durumları (README › Durumlar; DataStatus, ErrorState, EmptyState README'leri):
//   - Nesil manifesti okunamıyor (404)   → ErrorState "Hata: …" + DataStatus hata tonu; hiçbir tutar gösterilmez.
//   - Yenilemede bozuk hash (bütünlük)    → son iyi veri korunur; DataStatus "eski": "Son başarılı nesil … · yenilenemedi".
//   - Filtreyle boş sonuç                 → EmptyState etkin filtreleri yazar, "Filtreleri temizle" geri getirir.
//   - Klasör içe aktarma desteklenmiyor   → düğme devre dışı, nedeni erişilebilir açıklama olarak yanında.
// Nesil yalnız sentetik fixture'dan (fixtures/generation-synthetic) page.route ile servis edilir; gerçek nesil, dev
// middleware'i ya da AILE_GENERATION_DIR kullanılmaz. Dedektörler e2e/admin-detectors.ts'ten; en altta ihlal enjekte
// edilerek bu sayfada yakalandıkları doğrulanır (self-check).

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
interface ManifestShape { generation_id: string; files: ManifestFileEntry[] }
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

/** Yeni nesil kimliği (64 hex) + manifest hash'i değişmeden bozulan purchase_needs parçası. */
const TAMPERED_MANIFEST = JSON.stringify({
  ...MANIFEST,
  generation_id: createHash('sha256').update(`${MANIFEST.generation_id}:bozuk`).digest('hex'),
});
const TAMPERED_PURCHASE = JSON.stringify({
  ...PURCHASE,
  records: PURCHASE.records.map((record, index) => (index === 0 ? { ...record, label: TAMPERED_LABEL } : record)),
});

type GenerationMode = 'ok' | 'missing-manifest' | 'tampered';

interface GenerationRoute {
  mode: GenerationMode;
  /** İstenen göreli yollar (manifest.json, data/…); sırayla. */
  readonly hits: string[];
}

const PREFIX = '/__aile/generation/';

/** /__aile/generation/** isteklerini sentetik nesilden yanıtlar; mod çalışırken değiştirilebilir. */
async function routeGeneration(page: Page, mode: GenerationMode = 'ok'): Promise<GenerationRoute> {
  const state: GenerationRoute = { mode, hits: [] };
  await page.route(`**${PREFIX}**`, async (route: Route) => {
    const { pathname } = new URL(route.request().url());
    const at = pathname.indexOf(PREFIX);
    const rel = at >= 0 ? decodeURIComponent(pathname.slice(at + PREFIX.length)) : '';
    state.hits.push(rel);
    const notFound = () =>
      route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'nesil bulunamadı' }) });
    if (!rel || rel.split('/').some(segment => segment === '' || segment === '.' || segment === '..')) return notFound();
    if (state.mode === 'missing-manifest') return notFound();
    if (state.mode === 'tampered' && rel === 'manifest.json') return route.fulfill({ contentType: 'application/json', body: TAMPERED_MANIFEST });
    if (state.mode === 'tampered' && rel === PURCHASE_PATH) return route.fulfill({ contentType: 'application/json', body: TAMPERED_PURCHASE });
    const file = path.join(GENERATION_DIR, ...rel.split('/'));
    if (!file.startsWith(GENERATION_DIR + path.sep) || !existsSync(file)) return notFound();
    return route.fulfill({ contentType: 'application/json', body: readFileSync(file) });
  });
  return state;
}

// --- Dedektörler -------------------------------------------------------------------------------------------------
// e2e/admin-detectors.ts: saf DOM işlevleri, runDetector ile page.evaluate'e kaynak metin olarak verilir (seçici kök/hedef).

/** Konumlayıcıya geçici, testlik bir seçici verir; dedektör seçeneği string kök/hedef alır. */
async function mark(locator: Locator, id: string): Promise<string> {
  await locator.evaluate((el, value) => el.setAttribute('data-e2e-dedektor', value), id);
  return `[data-e2e-dedektor="${id}"]`;
}

const isChromium = (projectName: string) => projectName.startsWith('chromium');

// --- Konumlayıcılar --------------------------------------------------------------------------------------------
/** DataStatus: sayfa başlığının altındaki tek tazelik satırı (role=status + data-state). */
const dataStatus = (page: Page) => page.locator('[role="status"][data-state]');
const errorState = (page: Page) => page.getByRole('alert').filter({ has: page.getByRole('heading', { name: /^Hata: / }) });
const emptyState = (page: Page) => page.getByRole('status').filter({ has: page.getByRole('heading', { name: 'Bu filtrelerle kayıt yok' }) });
/** tr-TR para ("₺8.500,00") ya da iki ondalıklı tutar; hata durumunda hiçbiri görünmemeli. */
const AMOUNT = /₺|\d{1,3}(?:\.\d{3})*,\d{2}(?!\d)/;

// --- 1. Manifest 404 ---------------------------------------------------------------------------------------------
test.describe('Nesil manifesti okunamıyor (404)', () => {
  for (const hash of ['/alimlar', '/genel']) {
    test(`${hash}: ErrorState "Hata: …", DataStatus hata tonu, tutar yok, Yeniden dene manifesti yeniden ister`, async ({ page, browserName }, testInfo) => {
      const generation = await routeGeneration(page, 'missing-manifest');
      await gotoAdmin(page, hash);

      const alert = errorState(page);
      await expect(alert).toBeVisible();
      await expect(alert.getByRole('heading', { level: 2 })).toHaveText(/^Hata: /);
      const retry = alert.getByRole('button', { name: 'Yeniden dene' });
      await expect(retry).toBeVisible();

      const status = dataStatus(page);
      await expect(status).toHaveAttribute('data-state', 'error');
      await expect(status).toHaveAttribute('data-tone', 'hata');
      await expect(status).toContainText('Hata:');

      // Eski ya da kısmi tutar yanıltır: sayfa ana alanında hiçbir tutar yok (README › ErrorState).
      await expect(page.getByRole('main')).not.toContainText(AMOUNT);

      // Dedektörler: hata yüzeyinde 14 px altı metin yok; klavye odağı halka değil, tek alt çizgi.
      expect(await smallText(page, { root: await mark(alert, 'hata'), min: 14 }), 'ErrorState metin boyutu').toEqual([]);
      expect(await smallText(page, { root: await mark(status, 'durum'), min: 14 }), 'DataStatus metin boyutu').toEqual([]);
      await enterKeyboardMode(page, browserName);
      await retry.focus();
      expect(await focusRing(page, { target: await mark(retry, 'yeniden'), keyboard: true }), 'Yeniden dene odağı').toEqual([]);
      if (isChromium(testInfo.project.name)) expect(await horizontalOverflow(page), 'belge düzeyinde yatay taşma').toEqual([]);

      const before = generation.hits.filter(hit => hit === 'manifest.json').length;
      await retry.click();
      await expect.poll(() => generation.hits.filter(hit => hit === 'manifest.json').length).toBeGreaterThan(before);
      await expect(errorState(page)).toBeVisible();
      await expect(page.getByRole('main')).not.toContainText(AMOUNT);
    });
  }
});

// --- 2. Yenilemede bozuk hash ---------------------------------------------------------------------------------
test('bozuk hash yenilemede: son iyi veri korunur, DataStatus "yenilenemedi" uyarı tonunda', async ({ page }) => {
  expect(FIRST_LABEL, 'sentetik fixture ilk alım adı').not.toBe('');
  const generation = await routeGeneration(page, 'ok');
  await gotoAdmin(page, '/alimlar');

  // Önce başarılı yükleme: taze nesil ve sentetik kayıt görünür.
  const status = dataStatus(page);
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
  await expect(errorState(page)).toHaveCount(0);
  expect(await smallText(page, { root: await mark(status, 'durum'), min: 14 }), 'DataStatus metin boyutu').toEqual([]);
});

// --- 3. Filtreyle boş sonuç ------------------------------------------------------------------------------------
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

// --- 4. Klasör içe aktarma desteği -----------------------------------------------------------------------------
test.describe('Klasörden içe aktar', () => {
  test('desteklenmeyen tarayıcıda düğme devre dışı ve nedeni yanında yazar', async ({ page }) => {
    await page.addInitScript(() => {
      const host = window as unknown as Record<string, unknown>;
      try {
        delete (Window.prototype as unknown as Record<string, unknown>).showDirectoryPicker;
      } catch {
        /* prototipte yok */
      }
      Object.defineProperty(host, 'showDirectoryPicker', { value: undefined, configurable: true, writable: true });
    });
    await routeGeneration(page, 'ok');
    await gotoAdmin(page, '/veri');

    const reason = 'Bu tarayıcı klasör içe aktarmayı desteklemiyor; nesil geliştirme sunucusundan okunur.';
    const button = page.getByRole('button', { name: 'Klasörden içe aktar' });
    await expect(button).toBeVisible();
    await expect(button).toBeDisabled();
    await expect(button).toHaveAccessibleDescription(reason);
    await expect(page.getByText(reason)).toBeVisible();
  });

  test('destekleyen tarayıcıda düğme etkin ve açıklama yok', async ({ page }) => {
    await routeGeneration(page, 'ok');
    await gotoAdmin(page, '/veri');
    const supported = await page.evaluate(() => typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function');
    test.skip(!supported, 'Bu motor File System Access API sunmuyor (WebKit); desteklenmeyen durum ayrı testte.');
    await expect(page.getByRole('button', { name: 'Klasörden içe aktar' })).toBeEnabled();
    await expect(page.getByText('Bu tarayıcı klasör içe aktarmayı desteklemiyor', { exact: false })).toHaveCount(0);
  });
});

// --- 5. Dedektör self-check: ihlal enjekte edilir, yakalanmalı -------------------------------------------------
test.describe('Dedektör self-check', () => {
  test('14 px altı metin, çevreleyen odak halkası ve yatay taşma yakalanır', async ({ page, browserName }) => {
    await routeGeneration(page, 'missing-manifest');
    await gotoAdmin(page, '/alimlar');
    await expect(errorState(page)).toBeVisible();

    await page.evaluate(() => {
      const main = document.querySelector('main')!;
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
      main.append(small, ring);
      document.body.append(wide);
    });

    expect((await smallText(page, { root: '[data-e2e-ihlal="kucuk"]', min: 14 })).join('\n'), 'küçük metin yakalanmalı').toMatch(/Küçük metin ihlali/);

    await enterKeyboardMode(page, browserName);
    await page.locator('[data-e2e-ihlal="halka"]').focus();
    expect((await focusRing(page, { target: '[data-e2e-ihlal="halka"]', keyboard: true })).join('\n'), 'odak halkası yakalanmalı').toMatch(/outline/);

    expect(await horizontalOverflow(page), 'yatay taşma yakalanmalı').not.toEqual([]);

    // Modülün kendi öz denetimi (beş kural, CSSOM ile enjekte): yakalamayan dedektör adı dönmemeli.
    expect(await selfCheckDetectors(page), 'ihlali yakalamayan dedektörler').toEqual([]);
  });
});
