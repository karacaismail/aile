import { test, expect, type BrowserContext } from '@playwright/test';
import { readFile, readdir } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { gotoAdmin } from './admin-helpers';

// Üretim çıktısı kapısı (playwright.admin-production.config.ts, önce `pnpm build`):
//  1. /aile/ soğuk açılışı yönetim parçalarını istemez; sw.js ön belleği ve Cache Storage bunları ve admin.html'i
//     içermez. Yönetim parçası = adıyla sağlayıcı (admin/antd/pro/icons) + ECharts (Chart.tsx'in tembel modülleri ve
//     onların statik import kapanışı) + bunlardan birini statik import eden her parça + yalnız admin.html'den
//     erişilen her parça.
//  2. /aile/admin.html#/alimlar kendi parçalarını (antd) yükler; ana girişin index-* ve yalnız ana uygulamaya ait
//     parçalarını istemez.
//  3. /__aile/generation/* dev-only Vite ara katmanıdır; önizleme/üretimde 404 döner, JSON servis etmez.
// Parça sahipliği dist/ içindeki gerçek import grafiğinden çıkarılır (ad listesi tek kaynak değildir).

// #region dedektörler (saf; aşağıdaki öz-denetim testi ihlal enjekte ederek yakaladıklarını kanıtlar)
type DistSnapshot = { assets: Map<string, string>; entries: Map<string, string> };
type ChunkSets = {
  all: Set<string>; admin: Set<string>; main: Set<string>; adminOnly: Set<string>; mainOnly: Set<string>;
  mainBoot: Set<string>; echarts: Set<string>; vendor: Set<string>; tainted: Set<string>;
};

const ADMIN_ENTRY = 'admin.html';
/** Adıyla yönetime ait sağlayıcı parçaları (vite.config.ts codeSplitting grupları + admin girişi). */
const ADMIN_VENDOR_CHUNK = /^(?:admin|antd|pro|icons)-[^/]+\.(?:js|css)$/;
/** Chart.tsx'in tembel import ettiği ECharts modülleri. Büyük/küçük harf duyarlı: ana uygulamanın Charts-* parçası hariç. */
const ECHARTS_CHUNK = /^(?:core|charts|components|renderers)-[^/]+\.js$/;
/** wouter yönlendirici çekirdeği (vite.config.ts `router` grubu): yalnız tembel LegacyApp ve yönetim kullanır, ön belleğe girmez. */
const ROUTER_CHUNK = /^router-[^/]+\.js$/;
/** Ana girişin eski index parçası; admin.html bunu asla istememeli. */
const LEGACY_ENTRY_CHUNK = /^index-[^/]+\.js$/;
const ASSET_TOKEN = /(?<![A-Za-z0-9_$.-])([A-Za-z0-9_][A-Za-z0-9_.-]*\.(?:js|css))/g;
/** Minify edilmiş statik import: `import"./x.js"` / `from"./x.js"`; `import("./x.js")` ve __vite__mapDeps dizesi değildir. */
const STATIC_IMPORT = /(?<![A-Za-z0-9_$])(?:from|import)\s*["'](?:\.\/|\/aile\/assets\/)([^"'/]+\.js)["']/g;

/** URL'den (sorgu/parça atılmış) assets/ altındaki dosya adı; asset değilse null. */
function assetName(url: string): string | null {
  const path = url.replace(/[?#].*$/, '');
  const match = /(?:^|\/)assets\/([^/]+)$/.exec(path);
  return match ? match[1] : null;
}

/** Bir kaynağın (HTML/JS/CSS) başvurduğu bilinen asset adları (statik, dinamik, preload listesi); daha uzun bir adın parçası sayılmaz. */
function referencedAssets(source: string, known: Set<string>): string[] {
  const found = new Set<string>();
  for (const match of source.matchAll(ASSET_TOKEN)) if (known.has(match[1])) found.add(match[1]);
  return [...found];
}

function staticImports(source: string, known: Set<string>): string[] {
  const found = new Set<string>();
  for (const match of source.matchAll(STATIC_IMPORT)) if (known.has(match[1])) found.add(match[1]);
  return [...found];
}

function closure(roots: Iterable<string>, next: (name: string) => string[]): Set<string> {
  const seen = new Set<string>();
  const queue = [...roots];
  while (queue.length) {
    const name = queue.shift()!;
    if (seen.has(name)) continue;
    seen.add(name);
    for (const child of next(name)) if (!seen.has(child)) queue.push(child);
  }
  return seen;
}

function chunkSets(snapshot: DistSnapshot): ChunkSets {
  const all = new Set(snapshot.assets.keys());
  const source = (name: string) => snapshot.assets.get(name) ?? '';
  const anyRef = (name: string) => referencedAssets(source(name), all);
  const staticRef = (name: string) => staticImports(source(name), all);
  const htmlRefs = (entries: string[]) => entries.flatMap(entry => referencedAssets(snapshot.entries.get(entry) ?? '', all));
  const mainEntries = [...snapshot.entries.keys()].filter(entry => entry !== ADMIN_ENTRY);
  const admin = closure(htmlRefs([ADMIN_ENTRY]), anyRef);
  const main = closure(htmlRefs(mainEntries), anyRef);
  // HTML'in doğrudan yüklediği parçalar ve statik importları: ana uygulamanın her açılışta çalıştırdığı çekirdek.
  const mainBoot = closure(htmlRefs(mainEntries), staticRef);
  const echarts = new Set([...closure([...admin].filter(name => ECHARTS_CHUNK.test(name)), staticRef)].filter(name => !mainBoot.has(name)));
  const vendor = new Set([...all].filter(name => ADMIN_VENDOR_CHUNK.test(name) || echarts.has(name)));
  const tainted = new Set([...all].filter(name => [...closure([name], staticRef)].some(dep => vendor.has(dep))));
  return {
    all, admin, main, mainBoot, echarts, vendor, tainted,
    adminOnly: new Set([...admin].filter(name => !main.has(name))),
    mainOnly: new Set([...main].filter(name => !admin.has(name))),
  };
}

/** Ana uygulamanın soğuk açılışında istenmemesi ve ön belleğe girmemesi gereken parçalar. */
function forbiddenForMain(sets: ChunkSets): Set<string> {
  return new Set([...sets.adminOnly, ...sets.vendor, ...sets.tainted]);
}

/** URL/ad listesinden yasak asset adları (sıralı, tekil). */
function assetViolations(urls: Iterable<string>, forbidden: Set<string>): string[] {
  const hits = new Set<string>();
  for (const url of urls) {
    const name = assetName(url) ?? url;
    if (forbidden.has(name)) hits.add(name);
  }
  return [...hits].sort();
}

/** workbox sw.js içindeki precacheAndRoute girdileri. */
function parsePrecache(swSource: string): string[] {
  return [...swSource.matchAll(/["']?url["']?\s*:\s*["']([^"']+)["']/g)].map(match => match[1]);
}

/** Ön bellekte birden fazla kez geçen URL'ler (sıralı, tekil). */
function duplicateUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const url of urls) (seen.has(url) ? repeated : seen).add(url);
  return [...repeated].sort();
}

/** Ön bellek ihlalleri: yasak parçalar + admin.html. */
function precacheViolations(urls: string[], forbidden: Set<string>): string[] {
  const html = urls.some(url => /(?:^|\/)admin\.html(?:[?#]|$)/.test(url)) ? [ADMIN_ENTRY] : [];
  return [...new Set([...assetViolations(urls, forbidden), ...html])].sort();
}
// #endregion

async function loadDist(root = 'dist'): Promise<DistSnapshot> {
  const assets = new Map<string, string>();
  for (const name of await readdir(join(root, 'assets'))) if (/\.(?:js|css)$/.test(name)) assets.set(name, await readFile(join(root, 'assets', name), 'utf8'));
  const entries = new Map<string, string>();
  for (const relative of await readdir(root, { recursive: true })) if (relative.endsWith('.html')) entries.set(relative.split(sep).join('/'), await readFile(join(root, relative), 'utf8'));
  return { assets, entries };
}

/** Sayfa ve (Chromium'da) service worker isteklerini, başarısız asset yanıtlarıyla birlikte toplar. */
function recordAssets(context: BrowserContext) {
  const requested: string[] = [];
  const failed: string[] = [];
  context.on('request', request => { requested.push(request.url()); });
  context.on('response', response => { if (assetName(response.url()) && response.status() >= 400) failed.push(`${response.status()} ${response.url()}`); });
  context.on('requestfailed', request => { if (assetName(request.url())) failed.push(`failed ${request.url()}`); });
  return { requested, failed };
}

/** Önizleme dışına çıkan her isteği (Sheets, Apps Script) keser; veri ağdan gelmez. */
async function isolateNetwork(context: BrowserContext) {
  await context.route(url => url.host !== '127.0.0.1:5178', route => route.abort('blockedbyclient'));
}

test.beforeEach(async ({}, testInfo) => {
  // playwright.admin.config.ts de admin-*.spec.ts eşler; bu dosya yalnız üretim önizlemesinde anlamlıdır.
  test.skip(!testInfo.config.metadata?.adminProduction, 'Yalnız playwright.admin-production.config.ts ile koşar');
});

test('dedektör öz-denetimi: enjekte edilen yönetim parçası ihlalleri yakalanır', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Saf denetim; tek projede yeterli');
  const snapshot: DistSnapshot = {
    entries: new Map([
      ['index.html', '<script type="module" src="/aile/assets/index-AAAA1111.js"></script><link rel="modulepreload" href="/aile/assets/shared-BBBB2222.js">'],
      ['timeline/index.html', '<p>statik</p>'],
      ['admin.html', '<script type="module" src="/aile/assets/admin-DDDD4444.js"></script><link rel="modulepreload" href="/aile/assets/antd-EEEE5555.js"><link rel="stylesheet" href="/aile/assets/admin-IIII9999.css">'],
    ]),
    assets: new Map([
      // Ana giriş: tembel LegacyApp için preload listesi antd/graphic adlarını taşır; bu, girişi kirletmez.
      ['index-AAAA1111.js', 'import{r}from"./shared-BBBB2222.js";const d=["assets/LegacyApp-CCCC3333.js","assets/antd-EEEE5555.js","assets/graphic-GGGG7777.js"];const l=()=>import("./LegacyApp-CCCC3333.js");const x="xpro-HHHH8888.js";'],
      ['shared-BBBB2222.js', 'export const r=1;'],
      ['LegacyApp-CCCC3333.js', 'import"./shared-BBBB2222.js";import{a}from"./antd-EEEE5555.js";const m=()=>import("./Charts-JJJJ0000.js");'],
      ['Charts-JJJJ0000.js', 'import"./shared-BBBB2222.js";export const c=1;'],
      ['Widget-LLLL2222.js', 'import"./graphic-GGGG7777.js";'],
      ['admin-DDDD4444.js', 'import"./shared-BBBB2222.js";import"./antd-EEEE5555.js";import"./pro-HHHH8888.js";const e=()=>import("./core-FFFF6666.js");'],
      ['admin-IIII9999.css', '.a{}'],
      ['antd-EEEE5555.js', 'export const a=1;'],
      ['pro-HHHH8888.js', 'import"./antd-EEEE5555.js";'],
      ['core-FFFF6666.js', 'import"./shared-BBBB2222.js";import"./graphic-GGGG7777.js";'],
      ['graphic-GGGG7777.js', 'export const g=1;'],
      ['icons-KKKK1234.js', 'export const i=1;'],
    ]),
  };
  const sets = chunkSets(snapshot);
  // Ana uygulama tembel LegacyApp üzerinden antd/graphic'e de erişir: yalnız erişim kümesi yetmez.
  expect([...sets.adminOnly].sort()).toEqual(['admin-DDDD4444.js', 'admin-IIII9999.css', 'core-FFFF6666.js', 'pro-HHHH8888.js']);
  expect([...sets.mainOnly].sort()).toEqual(['Charts-JJJJ0000.js', 'LegacyApp-CCCC3333.js', 'index-AAAA1111.js']);
  expect([...sets.mainBoot].sort()).toEqual(['index-AAAA1111.js', 'shared-BBBB2222.js']);
  // ECharts kapanışı statik importla graphic'i içerir; ana çekirdekteki shared'i içermez.
  expect([...sets.echarts].sort()).toEqual(['core-FFFF6666.js', 'graphic-GGGG7777.js']);
  // antd'yi statik import eden LegacyApp ve graphic'i statik import eden Widget kirlidir; preload listesi taşıyan index değildir.
  expect(sets.tainted.has('LegacyApp-CCCC3333.js') && sets.tainted.has('Widget-LLLL2222.js')).toBe(true);
  expect(sets.tainted.has('index-AAAA1111.js') || sets.tainted.has('shared-BBBB2222.js') || sets.tainted.has('Charts-JJJJ0000.js')).toBe(false);
  const forbidden = forbiddenForMain(sets);
  expect(forbidden.has('icons-KKKK1234.js') && forbidden.has('antd-EEEE5555.js') && forbidden.has('graphic-GGGG7777.js')).toBe(true);
  expect([...forbidden].filter(name => sets.mainBoot.has(name) || name.startsWith('Charts-'))).toEqual([]);

  const cleanPrecache = parsePrecache('s.precacheAndRoute([{url:"index.html",revision:"1"},{url:"assets/index-AAAA1111.js",revision:null},{url:"assets/shared-BBBB2222.js",revision:null},{url:"assets/Charts-JJJJ0000.js",revision:null}])');
  expect(cleanPrecache).toHaveLength(4);
  expect(precacheViolations(cleanPrecache, forbidden)).toEqual([]);
  const injected = [...cleanPrecache, 'assets/antd-EEEE5555.js', 'assets/graphic-GGGG7777.js', 'assets/LegacyApp-CCCC3333.js', 'admin.html'];
  expect(precacheViolations(injected, forbidden)).toEqual(['LegacyApp-CCCC3333.js', 'admin.html', 'antd-EEEE5555.js', 'graphic-GGGG7777.js']);
  expect(duplicateUrls(cleanPrecache)).toEqual([]);
  expect(duplicateUrls(parsePrecache('[{url:"icon.svg",revision:"1"},{url:"index.html",revision:"2"},{url:"icon.svg",revision:"1"}]'))).toEqual(['icon.svg']);

  const origin = 'http://127.0.0.1:5178/aile/assets/';
  expect(assetViolations([`${origin}index-AAAA1111.js`, `${origin}shared-BBBB2222.js`], forbidden)).toEqual([]);
  expect(assetViolations([`${origin}index-AAAA1111.js`, `${origin}pro-HHHH8888.js?v=1`, `${origin}core-FFFF6666.js#x`], forbidden)).toEqual(['core-FFFF6666.js', 'pro-HHHH8888.js']);
  // Cache Storage workbox revizyon sorgusu taşır.
  expect(assetViolations([`${origin}admin-IIII9999.css?__WB_REVISION__=abc`], forbidden)).toEqual(['admin-IIII9999.css']);

  // Ana çekirdek antd'yi statik import etmeye başlarsa çekirdek kirlenir; soğuk açılış testi bunu ayrıca reddeder.
  snapshot.assets.set('index-AAAA1111.js', 'import{r}from"./shared-BBBB2222.js";import{a}from"./antd-EEEE5555.js";');
  const leaked = chunkSets(snapshot);
  expect([...leaked.mainBoot].filter(name => forbiddenForMain(leaked).has(name)).sort()).toEqual(['antd-EEEE5555.js', 'index-AAAA1111.js']);
  // Eski index parçasını isteyen admin yükü yakalanır.
  expect([`${origin}index-AAAA1111.js`].map(url => assetName(url)!).filter(name => LEGACY_ENTRY_CHUNK.test(name))).toEqual(['index-AAAA1111.js']);
});

test('sw.js ön belleği her dosyayı bir kez içerir; wouter yönlendirici çekirdeği ana kabuğa ve ön belleğe girmez', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Yalnız dist/ denetimi; tek projede yeterli');
  const precache = parsePrecache(await readFile('dist/sw.js', 'utf8'));
  expect(precache.length).toBeGreaterThan(0);
  // vite-plugin-pwa includeAssets/manifest simgeleri, globPatterns'in zaten eşlediği public dosyasını ikinci kez ekler.
  expect(duplicateUrls(precache), 'sw.js precache listesinde yinelenen girdiler').toEqual([]);
  // Ana kabuk wouter'dan yalnız use-hash-location kancasını kullanır; Router/Switch/regexparam ayrı `router-*` parçasında kalır.
  const routers = (await readdir(join('dist', 'assets'))).filter(name => ROUTER_CHUNK.test(name));
  expect(routers, 'wouter yönlendirici çekirdeği kendi router-* parçasında olmalı').toHaveLength(1);
  expect(precache.filter(url => ROUTER_CHUNK.test(assetName(url) ?? '')), 'router-* ön belleğe girmemeli').toEqual([]);
});

test('/aile/ soğuk açılışı yönetim parçalarını istemez; sw.js ön belleği ve Cache Storage içermez', async ({ page, context }, testInfo) => {
  const sets = chunkSets(await loadDist());
  const forbidden = forbiddenForMain(sets);
  // Dedektör boş kalmasın: derleme gerçekten yönetim ve ECharts parçaları üretmiş olmalı.
  expect([...sets.admin].some(name => /^antd-.*\.js$/.test(name)), 'admin.html antd parçasına erişmeli').toBe(true);
  expect(sets.echarts.size, 'ECharts parçaları (core/charts/components/renderers) admin grafiğinde bulunmalı').toBeGreaterThan(0);
  expect([...sets.mainBoot].filter(name => forbidden.has(name)), 'ana giriş çekirdeği yönetim parçası import etmemeli').toEqual([]);
  await isolateNetwork(context);
  const { requested, failed } = recordAssets(context);

  await page.goto('/aile/');
  await expect(page.getByRole('main')).toHaveCount(1, { timeout: 15_000 });
  const workerState = await page.evaluate(() => Promise.race([
    navigator.serviceWorker.ready.then(registration => registration.active?.state ?? 'none'),
    new Promise<string>(resolve => setTimeout(() => resolve('timeout'), 15_000)),
  ]));
  expect(workerState, 'service worker kurulmalı (precache tamamlanır)').toMatch(/^activat/);
  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const key of await caches.keys()) for (const request of await (await caches.open(key)).keys()) urls.push(request.url);
    return urls;
  });
  await testInfo.attach('main-cold-open', { body: JSON.stringify({ requested: requested.map(url => assetName(url)).filter(Boolean), cached: cached.map(url => assetName(url) ?? url), forbidden: [...forbidden].sort() }, null, 2), contentType: 'application/json' });

  expect(failed, 'ana uygulama parçaları eksiksiz yüklenmeli').toEqual([]);
  expect(requested.some(url => LEGACY_ENTRY_CHUNK.test(assetName(url) ?? '')), 'ana giriş index-* yüklenmeli').toBe(true);
  expect(assetViolations(requested, forbidden), 'soğuk açılışta istenen yönetim parçaları').toEqual([]);
  expect(cached.length, 'precache Cache Storage içinde görünmeli').toBeGreaterThan(0);
  expect(precacheViolations(cached, forbidden), 'Cache Storage içindeki yönetim parçaları').toEqual([]);

  const served = await page.request.get('/aile/sw.js');
  expect(served.status()).toBe(200);
  const swSource = await served.text();
  expect(swSource, 'önizleme güncel dist/sw.js dosyasını servis etmeli (önce pnpm build)').toBe(await readFile('dist/sw.js', 'utf8'));
  const precache = parsePrecache(swSource);
  expect(precache.length).toBeGreaterThan(0);
  expect(precacheViolations(precache, forbidden), 'sw.js precache listesindeki yönetim parçaları').toEqual([]);
});

test('/aile/admin.html#/alimlar antd parçasını yükler, eski index parçasını istemez', async ({ page, context }, testInfo) => {
  const sets = chunkSets(await loadDist());
  await isolateNetwork(context);
  const { requested, failed } = recordAssets(context);

  await gotoAdmin(page, '/alimlar');
  await expect(page).toHaveURL(/\/aile\/admin\.html#\/alimlar$/);
  const names = requested.map(url => assetName(url)).filter((name): name is string => name !== null);
  await testInfo.attach('admin-alimlar', { body: JSON.stringify({ requested: names, mainOnly: [...sets.mainOnly].sort() }, null, 2), contentType: 'application/json' });

  expect(failed, 'yönetim parçaları eksiksiz yüklenmeli').toEqual([]);
  expect(names.filter(name => /^antd-.*\.js$/.test(name)), 'antd parçası istenmeli').toHaveLength(1);
  expect(names.filter(name => /^admin-.*\.js$/.test(name)), 'admin giriş parçası istenmeli').toHaveLength(1);
  expect(names.filter(name => LEGACY_ENTRY_CHUNK.test(name)), 'eski ana giriş index-* istenmemeli').toEqual([]);
  expect(assetViolations(names, sets.mainOnly), 'yalnız ana uygulamaya ait parçalar istenmemeli').toEqual([]);
  // İstemcinin varsayılan nesil kaynağı üretimde yanıt bulamaz; veri sızmaz.
  expect(await page.evaluate(() => fetch('/__aile/generation/_meta').then(response => response.status))).toBe(404);
});

test('/__aile/generation dev-only ara katmanı üretim önizlemesinde 404 döner', async ({ request }) => {
  for (const path of ['/__aile/generation', '/__aile/generation/_meta', '/__aile/generation/manifest.json', '/__aile/generation/data/purchase_needs/all/0000.json']) {
    for (const accept of ['application/json', '*/*']) {
      for (const method of ['GET', 'HEAD'] as const) {
        const response = await request.fetch(path, { method, headers: { Accept: accept } });
        expect(response.status(), `${method} ${path} (${accept})`).toBe(404);
        expect(response.headers()['content-type'] ?? '', `${method} ${path} JSON servis etmemeli`).not.toContain('application/json');
      }
    }
  }
  // Taban yol altında: JSON istemcisi 404 alır; tarayıcı benzeri istek SPA geri dönüşü alabilir ama asla nesil verisi değil.
  const underBase = '/aile/__aile/generation/_meta';
  expect((await request.get(underBase, { headers: { Accept: 'application/json' } })).status()).toBe(404);
  const browserLike = await request.get(underBase, { headers: { Accept: '*/*' } });
  expect(browserLike.headers()['content-type'] ?? '').not.toContain('application/json');
  expect(await browserLike.text()).not.toContain('generation_id');
});
