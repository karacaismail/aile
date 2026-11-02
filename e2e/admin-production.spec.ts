import { test, expect, type BrowserContext, type Locator, type Page, type Request, type TestInfo } from '@playwright/test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ECHARTS_PACKAGES, FORBIDDEN_PHONE_CLASSES } from '../scripts/check-delivery.mjs';
import { ADMIN_MAIN, adminNotReadyReasons, gotoAdmin, openAdmin } from './admin-helpers';

// Üretim çıktısı kapısı (playwright.admin-production.config.ts; önce `pnpm build`). vite preview AILE_PORT+1 üzerinde
// koşar; her test kendi soğuk tarayıcı bağlamını alır (boş HTTP önbelleği, kayıtlı service worker yok).
//
// Ağ yalıtımı (uyarlamalı teslim sözleşmesi W0):
//  - İstekler başlatıldıkları anda (context 'request') kaydedilir; başarısız ve iptal edilenler dahil. Yalnız yanıt
//    dinlemek denenen isteği kaçırır; önbellekten gelen sıfır bayt "istenmedi" demek değildir.
//  - URL → dosya → grup eşlemesi dosya adından tahmin edilmez: dist/.vite/manifest.json (dosya, css[], assets[]) ve
//    dist/.vite/delivery-graph.json (parça başına codeSplitting grubu ve paket sayıları; echarts = echarts/zrender
//    paketleri) kullanılır. Manifestte karşılığı olmayan assets/ isteği ayrıca hatadır (eski derleme ya da tahmin).
//  - Telefon (chromium 320×568, webkit 390×844): her rota soğuk açılır, sayfa baştan sona kaydırılır; antd, pro,
//    icons, echarts ve wide sınıfından hiçbir dosya istenmez (FORBIDDEN_PHONE_CLASSES, scripts/check-delivery.mjs).
//  - Yatay telefon 568×320: profil telefon kalır; wide istenmez.
//  - Telefondan 1440×900'e büyütme: wide bir kez yüklenir; telefona dönüp yeniden büyütünce tekrar istenmez.
//  - Geniş 1440×900: antd/pro/icons istenmez (antd sağlayıcısı hiçbir profilde yüklenmez); grafiksiz rotalar (Alımlar,
//    Genel) ECharts istemez; katlama altındaki grafik (Bütçe › Aylık eğilim) ECharts'ı yalnız görünür alana girince ister;
//    bir rota açılınca başka hiçbir rota sayfasının parçası istenmez (wide birim başına parçadır).
//  - Admin parçaları ana uygulamanın service worker ön belleğinde (sw.js ve Cache Storage) yoktur; SW denetimindeki
//    admin sekmesi çalışma zamanı önbelleğine (aile-visited-modules) yönetim dosyası yazmaz.
//  - Parça hatası (yayından sonra silinen sayfa ya da wide parçası; route.abort): sayfa kendiliğinden yenilenmez, "Yeni
//    sürüm var · Yenile" görünür, içe aktarılan nesil korunur; yenileme yalnız kullanıcı "Yenile" deyince.
//  - Her senaryo aktarım baytını (yanıt başlığı + kodlanmış gövde) ve çözülmüş boyutu (yanıt gövdesi) ayrı raporlar.
// Veri: üretim derlemesinin varsayılan nesil kaynağı seçilmemiş klasördür (d02: /__aile/generation isteği yok, "Klasör
// seçilmedi"); hiçbir senaryoda nesil isteği olmaz. Veri gerektiren senaryo sentetik nesli (fixtures/generation-synthetic)
// kullanıcı gibi Veri sayfasından "Klasörden içe aktar" ile yükler (<input webkitdirectory>; iki motorda aynı yol) ve rotaya
// uygulama içinde geçer. Önizleme dışına çıkan her istek kesilir; Google'a istek yalnız derlemeye VITE_BUDGET_SHEET_ID
// gömülüyken ve yalnız canlı veri kullanan rotada (Bütçe: salt okunur GViz) izinlidir, başka her yerde ihlaldir.
// Dedektörler saftır; öz-denetim testleri ihlal enjekte ederek
// (iptal edilen istek dahil) kör olmadıklarını kanıtlar. Sabit bekleme yok: hazır sinyali openAdmin ve aynı
// adminNotReadyReasons tanımıyla iki ardışık kare.

// #region derleme grafiği
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = path.join(ROOT, 'dist');
const ADMIN_ENTRY = 'admin.html';
/** Adıyla yönetime ait parçalar (vite.config.ts grupları + admin girişi); manifest/grafik sınıflamasına ek ad kapısı. */
const ADMIN_VENDOR_CHUNK = /^(?:admin|antd|pro|icons|wide)-[^/]+\.(?:js|css)$/;
/** Ön belleğe asla girmeyen sınıflar (W0 PRECACHE); echarts yalnız ana uygulama çekirdeğinde değilse. */
const PRECACHE_FORBIDDEN_CLASSES: readonly string[] = ['antd', 'pro', 'icons', 'wide', 'router', 'echarts'];
/** Telefon profilinin hiç istemediği sınıflar (teslim kapısıyla tek kaynak). */
const PHONE_FORBIDDEN: readonly string[] = FORBIDDEN_PHONE_CLASSES;
/**
 * ECharts çalışma zamanı (a13): Chart.tsx'in tembel import ettiği tek modül. Manifestteki bu dinamik girişin parçası
 * echarts sınıfı sayılır (eski ECHARTS_CHUNK ad deseni core|charts|components|renderers yerine; adla tahmin yok).
 * ECharts/zrender modüllerini taşıyan statik kapanışı (ör. install-*) zaten paket üyeliğinden echarts'tır.
 */
const ECHARTS_RUNTIME_SRC = 'src/admin/ui/Chart.runtime.ts';
const GENERATION_PREFIX = '/__aile/generation/';
const GOOGLE_HOST = /(?:^|\.)(?:google|googleapis|googleusercontent|gstatic)\.com$/i;
/** Canlı Sheets okuyan rotalar: Bütçe (ButcePage → data/live.liveBudget → src/dashboard/data.ts fetchBudget, salt okunur). */
const LIVE_SHEET_ROUTES: readonly string[] = ['/butce'];
/** Geniş profilde grafik çizmeyen rotalar (veriyle de): Alımlar ve Genel (r4-sums: Genel'in aylık bölümü yalnız tablo). */
const CHART_FREE_ROUTES: readonly string[] = ['/alimlar', '/genel'];
/** 1440×900 açılışında katlamanın altında kalan grafik: Bütçe › "Aylık eğilim" (butce/ButceTrend.wide). */
const BELOW_FOLD_CHART_ROUTE = '/butce';
const BELOW_FOLD_CHART_REGION = 'Aylık eğilim';
/** Sözleşmedeki tek izinli Google isteği: e-tablonun GViz okuması (kimlik VITE_BUDGET_SHEET_ID). */
const GVIZ_READ = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/([\w-]{20,})\/gviz\/tq(?:\?|$)/;

interface ManifestChunk {
  file: string; src?: string; name?: string; isEntry?: boolean; isDynamicEntry?: boolean;
  imports?: string[]; dynamicImports?: string[]; css?: string[]; assets?: string[];
}
type ViteManifest = Record<string, ManifestChunk>;
interface GraphChunk { modules: number; groups?: Record<string, number>; packages?: Record<string, number> }
interface DeliveryGraph { schema: number; groups: string[]; chunks: Record<string, GraphChunk> }
interface Build { manifest: ViteManifest; graph: DeliveryGraph }
type FileKind = 'js' | 'css' | 'asset';
/** Dağıtılan bir dosya: sahibi olan manifest anahtarları ve modül üyeliğinden gelen sınıflar. */
interface DeliveryFile { file: string; kind: FileKind; owners: string[]; classes: string[] }
type DeliveryIndex = Map<string, DeliveryFile>;

function loadBuild(dist = DIST): Build {
  const read = <T>(relative: string): T => {
    const file = path.join(dist, '.vite', relative);
    if (!existsSync(file)) throw new Error(`${file} yok: önce pnpm build (vite.config.ts build.manifest + deliveryGraph)`);
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  };
  return { manifest: read<ViteManifest>('manifest.json'), graph: read<DeliveryGraph>('delivery-graph.json') };
}

/** Dosya → sınıflar. JS sınıfı grafikteki grup üyeliğinden (+ echarts/zrender paketi, + manifestteki ECharts çalışma
 *  zamanı girişi); css[]/assets[] sahibinden. */
function deliveryIndex({ manifest, graph }: Build): DeliveryIndex {
  const index: DeliveryIndex = new Map();
  const echartsRuntime = manifest[ECHARTS_RUNTIME_SRC]?.file;
  const classesOf = (file: string): string[] => {
    const info = graph.chunks[file];
    if (!info) throw new Error(`delivery-graph içinde ${file} yok: manifest ve grafik farklı derlemelerden (pnpm build yeniden)`);
    const found = new Set(Object.entries(info.groups ?? {}).filter(([, count]) => count > 0).map(([name]) => name));
    if (ECHARTS_PACKAGES.some(pkg => (info.packages?.[pkg] ?? 0) > 0) || file === echartsRuntime) found.add('echarts');
    return [...found].sort();
  };
  const add = (file: string, kind: FileKind, owner: string, classes: readonly string[]) => {
    const entry = index.get(file) ?? { file, kind, owners: [], classes: [] };
    if (!entry.owners.includes(owner)) entry.owners.push(owner);
    entry.classes = [...new Set([...entry.classes, ...classes])].sort();
    index.set(file, entry);
  };
  for (const [key, chunk] of Object.entries(manifest)) {
    const kind: FileKind = chunk.file.endsWith('.js') ? 'js' : chunk.file.endsWith('.css') ? 'css' : 'asset';
    const classes = kind === 'js' ? classesOf(chunk.file) : [];
    add(chunk.file, kind, key, classes);
    for (const css of chunk.css ?? []) add(css, 'css', key, classes);
    for (const asset of chunk.assets ?? []) add(asset, 'asset', key, classes);
  }
  return index;
}

/** Rapor bölmesi: sınıfların birleşimi ("antd", "echarts", "shared" …); sınıfsız yönetim/uygulama kodu "uygulama". */
const groupOf = (file: DeliveryFile) => file.classes.join('+') || 'uygulama';
const filesWithClass = (index: DeliveryIndex, cls: string, kind?: FileKind) =>
  [...index.values()].filter(file => file.classes.includes(cls) && (!kind || file.kind === kind)).map(file => file.file).sort();

/** Manifest anahtarlarının kapanışı: imports (statik) ve istenirse dynamicImports. */
function reach(manifest: ViteManifest, roots: Iterable<string>, dynamic: boolean): Set<string> {
  const seen = new Set<string>();
  const queue = [...roots];
  while (queue.length) {
    const key = queue.shift()!;
    if (seen.has(key)) continue;
    const chunk = manifest[key];
    if (!chunk) throw new Error(`manifest anahtarı yok: ${key}`);
    seen.add(key);
    for (const next of [...(chunk.imports ?? []), ...(dynamic ? chunk.dynamicImports ?? [] : [])]) if (!seen.has(next)) queue.push(next);
  }
  return seen;
}

/** Anahtarların dağıttığı dosyalar: JS + css[] + assets[]. */
const filesOf = (manifest: ViteManifest, keys: Iterable<string>) =>
  new Set([...keys].flatMap(key => [manifest[key].file, ...(manifest[key].css ?? []), ...(manifest[key].assets ?? [])]));

interface PrecacheScope {
  /** Ana uygulamanın ön belleğine ve soğuk açılışına girmemesi gereken dist yolları. */
  forbidden: Set<string>;
  adminReach: Set<string>; mainBoot: Set<string>; mainOnly: Set<string>; mainEntryFiles: Set<string>;
}

/**
 * Ön bellek kapsamı (manifest grafiği): yalnız admin.html'den erişilen her dosya + yasak sınıflı dosyalar (echarts ana
 * çekirdekte değilse) + adıyla yönetim parçaları + bunlardan birini statik import eden her parça + admin.html.
 */
function precacheScope(build: Build, index: DeliveryIndex): PrecacheScope {
  const { manifest } = build;
  if (!manifest[ADMIN_ENTRY]) throw new Error(`manifestte ${ADMIN_ENTRY} girişi yok`);
  const mainRoots = Object.keys(manifest).filter(key => manifest[key].isEntry && key !== ADMIN_ENTRY);
  if (!mainRoots.length) throw new Error('manifestte ana uygulama girişi yok');
  const adminReach = filesOf(manifest, reach(manifest, [ADMIN_ENTRY], true));
  const mainReach = filesOf(manifest, reach(manifest, mainRoots, true));
  const mainBoot = filesOf(manifest, reach(manifest, mainRoots, false));
  const vendor = new Set([...index.values()].filter(file => {
    const classed = file.classes.filter(cls => PRECACHE_FORBIDDEN_CLASSES.includes(cls) && !(cls === 'echarts' && mainBoot.has(file.file)));
    return classed.length > 0 || ADMIN_VENDOR_CHUNK.test(path.posix.basename(file.file));
  }).map(file => file.file));
  const tainted = new Set<string>();
  for (const key of Object.keys(manifest)) {
    if ([...filesOf(manifest, reach(manifest, [key], false))].some(file => vendor.has(file))) for (const file of filesOf(manifest, [key])) tainted.add(file);
  }
  const adminOnly = [...adminReach].filter(file => !mainReach.has(file));
  return {
    forbidden: new Set([...adminOnly, ...vendor, ...tainted, ADMIN_ENTRY]),
    adminReach,
    mainBoot,
    mainOnly: new Set([...mainReach].filter(file => !adminReach.has(file))),
    mainEntryFiles: new Set(mainRoots.map(key => manifest[key].file)),
  };
}
// #endregion

// #region istek sınıflama (saf)
type Category = 'chunk' | 'unmapped' | 'document' | 'public' | 'data' | 'external';
interface Classified { url: string; category: Category; path: string; classes: string[]; group: string }

/** URL ya da ön bellek girdisini taban yola göreli dist yoluna çevirir (sorgu/parça atılır); taban dışındaysa null. */
function distPath(url: string, base: URL): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url, base);
  } catch {
    return null;
  }
  if (parsed.origin !== base.origin || !parsed.pathname.startsWith(base.pathname)) return null;
  try {
    return decodeURIComponent(parsed.pathname.slice(base.pathname.length));
  } catch {
    return null;
  }
}

function classify(url: string, base: URL, index: DeliveryIndex): Classified {
  let parsed: URL | null = null;
  try {
    parsed = new URL(url);
  } catch {
    parsed = null;
  }
  if (!parsed || parsed.origin !== base.origin) return { url, category: 'external', path: parsed?.host || url, classes: [], group: 'dış' };
  if (parsed.pathname.startsWith(GENERATION_PREFIX) || `${parsed.pathname}/` === GENERATION_PREFIX) return { url, category: 'data', path: parsed.pathname, classes: [], group: 'veri' };
  const rel = distPath(url, base) ?? parsed.pathname;
  if (rel.startsWith('assets/')) {
    const file = index.get(rel);
    return file ? { url, category: 'chunk', path: rel, classes: file.classes, group: groupOf(file) } : { url, category: 'unmapped', path: rel, classes: [], group: 'eşlenmemiş' };
  }
  if (rel === '' || rel.endsWith('.html')) return { url, category: 'document', path: rel || 'index.html', classes: [], group: 'belge' };
  return { url, category: 'public', path: rel, classes: [], group: 'genel dosya' };
}

interface NetRecord {
  seq: number; phase: string; url: string; method: string;
  status: 'pending' | 'finished' | 'failed'; failure: string | null; httpStatus: number | null;
  /** Yanıt başlığı + kodlanmış (sıkıştırılmış) gövde baytı; ölçülemediyse null. */
  transferBytes: number | null;
  /** Çözülmüş yanıt gövdesi baytı; ölçülemediyse null. */
  decodedBytes: number | null;
}

const inPhases = (record: NetRecord, phases?: readonly string[]) => !phases || phases.includes(record.phase);

/** Verilen sınıflardan istenen dosyalar: "sınıf: assets/…" (sıralı, tekil). Durumdan bağımsız: iptal edilen de sayılır. */
function classRequests(records: readonly NetRecord[], base: URL, index: DeliveryIndex, classes: readonly string[], phases?: readonly string[]): string[] {
  const hits = new Set<string>();
  for (const record of records) {
    if (!inPhases(record, phases)) continue;
    const found = classify(record.url, base, index);
    for (const cls of found.classes) if (classes.includes(cls)) hits.add(`${cls}: ${found.path}`);
  }
  return [...hits].sort();
}

/** Sınıftan dosya başına istek sayısı. */
function requestCounts(records: readonly NetRecord[], base: URL, index: DeliveryIndex, cls: string, phases?: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const record of records) {
    if (!inPhases(record, phases)) continue;
    const found = classify(record.url, base, index);
    if (found.classes.includes(cls)) counts.set(found.path, (counts.get(found.path) ?? 0) + 1);
  }
  return counts;
}

/** Birden fazla kez istenen dosyalar: "assets/… ×N". */
const repeatedRequests = (records: readonly NetRecord[], base: URL, index: DeliveryIndex, cls: string) =>
  [...requestCounts(records, base, index, cls)].filter(([, count]) => count > 1).map(([file, count]) => `${file} ×${count}`).sort();

/** Manifestte karşılığı olmayan assets/ istekleri. */
const unmappedRequests = (records: readonly NetRecord[], base: URL, index: DeliveryIndex) =>
  [...new Set(records.map(record => classify(record.url, base, index)).filter(found => found.category === 'unmapped').map(found => found.path))].sort();

/** Başarısız ya da ≥400 dönen önizleme dosyası istekleri (veri ve dış istekler hariç). */
const failedLoads = (records: readonly NetRecord[], base: URL, index: DeliveryIndex) => records
  .filter(record => ['chunk', 'unmapped', 'document', 'public'].includes(classify(record.url, base, index).category))
  .filter(record => record.status === 'failed' || (record.httpStatus ?? 0) >= 400)
  .map(record => `${record.failure ?? record.httpStatus} ${classify(record.url, base, index).path}`).sort();

/** Google alanlarına denenen istekler (kesilmiş olsalar bile). */
const googleRequests = (records: readonly NetRecord[]) => [...new Set(records.flatMap(record => {
  try {
    const host = new URL(record.url).host;
    return GOOGLE_HOST.test(host) ? [host] : [];
  } catch {
    return [];
  }
}))].sort();

/**
 * Google isteği sözleşmesi: Google'a istek yalnız derlemeye VITE_BUDGET_SHEET_ID gömülüyken ve yalnız canlı veri kullanan
 * rotada (`livePhases`: o rotada geçen aşamalar) izinlidir; izinli istek o kimliğin salt okunur GViz okumasıdır (GET
 * docs.google.com/spreadsheets/d/<kimlik>/gviz/tq). Başka her Google isteği ihlaldir: canlı olmayan rota, Apps Script ya
 * da başka uç, yazma yöntemi, derlemede olmayan kimlik. `compiled(kimlik)`: kimlik dist JS'te dize olarak geçiyor mu
 * (Vite VITE_BUDGET_SHEET_ID'yi derlemede yerine koyar; tanımsızken fetchBudget ağa çıkmadan durur). İletide kimlik
 * yazılmaz (gerçek derlemede gizli değer olabilir). Kesilen istek de sayılır.
 */
function googleViolations(records: readonly NetRecord[], livePhases: readonly string[], compiled: (id: string) => boolean): string[] {
  const found = new Set<string>();
  for (const record of records) {
    let url: URL;
    try {
      url = new URL(record.url);
    } catch {
      continue;
    }
    if (!GOOGLE_HOST.test(url.host)) continue;
    const gviz = GVIZ_READ.exec(record.url);
    const reason = !livePhases.includes(record.phase) ? 'canlı veri kullanmayan rota'
      : !gviz ? 'GViz okuması değil'
        : record.method !== 'GET' ? 'salt okunur değil'
          : !compiled(gviz[1]) ? 'kimlik derlemede yok (VITE_BUDGET_SHEET_ID)'
            : null;
    const where = gviz ? '/spreadsheets/d/<kimlik>/gviz/tq' : url.pathname.replace(/[\w-]{20,}/g, '<kimlik>');
    if (reason) found.add(`${record.phase} · ${record.method} ${url.host}${where}: ${reason}`);
  }
  return [...found].sort();
}

/** Kimlik derlemeye gömülü mü: dist/assets JS dosyalarından birinde tırnaklı dize olarak geçer. Dosyalar bir kez okunur. */
function compiledSheetId(dist = DIST): (id: string) => boolean {
  let scripts: string[] | null = null;
  return id => {
    scripts ??= readdirSync(path.join(dist, 'assets')).filter(name => name.endsWith('.js')).map(name => readFileSync(path.join(dist, 'assets', name), 'utf8'));
    const literal = new RegExp(`[\`'"]${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\`'"]`);
    return scripts.some(source => literal.test(source));
  };
}

/** Nesil ara katmanına (/__aile/generation) denenen istekler: üretim derlemesi hiç istemez. */
const dataRequests = (records: readonly NetRecord[], base: URL, index: DeliveryIndex, phases?: readonly string[]) =>
  [...new Set(records.filter(record => inPhases(record, phases)).map(record => classify(record.url, base, index)).filter(found => found.category === 'data').map(found => found.path))].sort();

/** Dist yolları içinden yasak olanlar (sıralı, tekil). */
function forbiddenPaths(urls: Iterable<string>, forbidden: ReadonlySet<string>, base: URL): string[] {
  const hits = new Set<string>();
  for (const url of urls) {
    const rel = distPath(url, base);
    if (rel !== null && forbidden.has(rel)) hits.add(rel);
  }
  return [...hits].sort();
}

/** workbox sw.js içindeki precacheAndRoute girdileri. */
function parsePrecache(swSource: string): string[] {
  return [...swSource.matchAll(/["']?url["']?\s*:\s*["']([^"']+)["']/g)].map(match => match[1]);
}

/** Ön bellekte birden fazla kez geçen URL'ler (sıralı, tekil). */
function duplicateUrls(urls: readonly string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const url of urls) (seen.has(url) ? repeated : seen).add(url);
  return [...repeated].sort();
}

interface ByteTotal { requests: number; transferBytes: number; decodedBytes: number; unmeasured: number }
const emptyTotal = (): ByteTotal => ({ requests: 0, transferBytes: 0, decodedBytes: 0, unmeasured: 0 });

/** Aktarım ve çözülmüş bayt ayrı toplanır: toplam, gruba ve aşamaya göre; ölçülemeyen istek sayısı ayrıca. */
function byteReport(records: readonly NetRecord[], base: URL, index: DeliveryIndex) {
  const totals = emptyTotal();
  const byGroup: Record<string, ByteTotal> = {};
  const byPhase: Record<string, ByteTotal> = {};
  const requests = records.map(record => {
    const found = classify(record.url, base, index);
    for (const bucket of [totals, (byGroup[found.group] ??= emptyTotal()), (byPhase[record.phase] ??= emptyTotal())]) {
      bucket.requests += 1;
      bucket.transferBytes += record.transferBytes ?? 0;
      bucket.decodedBytes += record.decodedBytes ?? 0;
      if (record.transferBytes === null || record.decodedBytes === null) bucket.unmeasured += 1;
    }
    return { seq: record.seq, phase: record.phase, path: found.path, group: found.group, status: record.status, httpStatus: record.httpStatus, failure: record.failure, transferBytes: record.transferBytes, decodedBytes: record.decodedBytes };
  });
  return { totals, byGroup, byPhase, requests };
}

const kib = (bytes: number) => `${(bytes / 1024).toFixed(2)} KiB`;
// #endregion

// #region tarayıcı tarafı
/** Çalıştırmanın taban URL'i (AILE_PORT+1 önizlemesi). */
function baseOf(testInfo: TestInfo): URL {
  const baseURL = testInfo.project.use.baseURL;
  if (!baseURL) throw new Error('baseURL tanımlı değil (playwright.admin-production.config.ts)');
  return new URL(baseURL);
}

/** Önizleme dışına çıkan her isteği (Sheets, Apps Script, örnek görseller) keser; veri ağdan gelmez. */
async function isolateNetwork(context: BrowserContext, testInfo: TestInfo) {
  const host = baseOf(testInfo).host;
  await context.route(url => url.host !== host, route => route.abort('blockedbyclient'));
}

async function measure(request: Request, record: NetRecord) {
  const response = await request.response().catch(() => null);
  record.httpStatus = response?.status() ?? null;
  try {
    const sizes = await request.sizes();
    record.transferBytes = sizes.responseHeadersSize + sizes.responseBodySize;
  } catch {
    record.transferBytes = null;
  }
  try {
    record.decodedBytes = response ? (await response.body()).byteLength : null;
  } catch {
    record.decodedBytes = null;
  }
  record.status = 'finished';
}

/** Bağlamdaki her isteği başlatıldığı anda (aşama etiketiyle) kaydeder; bitince ölçer, başarısız/iptal olunca işaretler. */
function recordNetwork(context: BrowserContext) {
  const records: NetRecord[] = [];
  const byRequest = new Map<Request, NetRecord>();
  const jobs = new Set<Promise<void>>();
  let phase = 'açılış';
  context.on('request', request => {
    const record: NetRecord = { seq: records.length + 1, phase, url: request.url(), method: request.method(), status: 'pending', failure: null, httpStatus: null, transferBytes: null, decodedBytes: null };
    records.push(record);
    byRequest.set(request, record);
  });
  context.on('requestfailed', request => {
    const record = byRequest.get(request);
    if (!record) return;
    record.status = 'failed';
    record.failure = request.failure()?.errorText ?? 'bilinmiyor';
  });
  context.on('requestfinished', request => {
    const record = byRequest.get(request);
    if (!record) return;
    const job: Promise<void> = measure(request, record).finally(() => jobs.delete(job));
    jobs.add(job);
  });
  return {
    records,
    phase(name: string) { phase = name; },
    /** Bitmiş isteklerin ölçümleri tamamlanana kadar bekler. */
    async settle() {
      while (jobs.size) await Promise.allSettled([...jobs]);
    },
  };
}
type NetworkRecorder = ReturnType<typeof recordNetwork>;

/**
 * Yönetim senaryosu için soğuk bağlam: dış ağ kesilir, istekler kaydedilir. Nesil isteği karşılanmaz (üretimde yoktur).
 * showDirectoryPicker kaldırılır: klasör içe aktarma iki motorda da <input webkitdirectory> yolundan gider (WebKit'te
 * seçici zaten yok; Chromium'da yerel iletişim kutusu açılmaz).
 */
async function prepareAdminContext(context: BrowserContext, testInfo: TestInfo): Promise<NetworkRecorder> {
  await isolateNetwork(context, testInfo);
  await context.addInitScript(() => {
    try {
      delete (Window.prototype as unknown as Record<string, unknown>).showDirectoryPicker;
    } catch {
      /* prototipte yok */
    }
    Object.defineProperty(window, 'showDirectoryPicker', { value: undefined, configurable: true, writable: true });
  });
  return recordNetwork(context);
}

const LOAD_COUNTER = 'e2e:belge-yuklemesi';
/** Her belge yüklemesini sessionStorage'da sayar (yenileme aynı sekmede sayacı artırır; yeni bağlam 0'dan başlar). */
async function countDocumentLoads(context: BrowserContext) {
  await context.addInitScript(key => {
    try {
      window.sessionStorage.setItem(key, String(Number(window.sessionStorage.getItem(key) ?? '0') + 1));
    } catch {
      /* depolama yok: sayaç okunamaz, test bunu ayrıca yakalar */
    }
  }, LOAD_COUNTER);
}
const documentLoads = (page: Page) => page.evaluate(key => Number(window.sessionStorage.getItem(key) ?? 'NaN'), LOAD_COUNTER);

/** Manifest anahtarının dist dosyaları (JS + css[]). */
const chunkFiles = (manifest: ViteManifest, key: string) => [manifest[key].file, ...(manifest[key].css ?? [])];
const ROUTE_PAGE = /^src\/admin\/pages\/[^/]+Page\.tsx$/;
/** Yayından sonra silinmiş parça: GitHub Pages gibi HTML 404 (önbelleğe alınmaz). */
const deletedChunk = { status: 404, contentType: 'text/html; charset=utf-8', headers: { 'cache-control': 'no-store' }, body: '<!doctype html><title>404</title>' };

let readyProbe = 0;
/** openAdmin'in hazır tanımı (adminNotReadyReasons) yeniden yüklemeden: iki ardışık karede main + h1 hazır, aria-busy yok. */
async function waitReady(page: Page, timeout = 20_000) {
  const key = `__e02Ready${++readyProbe}`;
  const expression = `(() => { const w = window; const reasons = (${adminNotReadyReasons.toString()})(); `
    + `w[${JSON.stringify(key)}] = reasons.length ? 0 : (w[${JSON.stringify(key)}] || 0) + 1; return w[${JSON.stringify(key)}] >= 2; })()`;
  await page.waitForFunction(expression, undefined, { timeout, polling: 'raf' });
}

/**
 * Uygulama içi gezinme (tam yükleme yok; bellekteki nesil kaynağı korunur): hash değişir, yeni sayfanın başlığı bağlanır,
 * sonra openAdmin ile aynı hazır sinyali (iki ardışık karede main + h1 hazır, aria-busy yok).
 */
async function navigateInApp(page: Page, route: string) {
  const before = await page.locator(`${ADMIN_MAIN} h1`).first().elementHandle();
  await page.evaluate(next => { window.location.hash = `#${next}`; }, route);
  await expect(page).toHaveURL(new RegExp(`#${route.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(?:[/?]|$)`));
  await page.waitForFunction(([selector, old]) => {
    const heading = document.querySelector(selector);
    return Boolean(heading && heading !== old);
  }, [`${ADMIN_MAIN} h1`, before] as const);
  await waitReady(page);
}

/** fixtures/generation-synthetic altında manifest.json taşıyan (tek) nesil klasörü ve kimliği. */
function syntheticGeneration(): { dir: string; id: string } {
  const root = path.join(ROOT, 'fixtures', 'generation-synthetic');
  for (const name of readdirSync(root).sort()) {
    const dir = path.join(root, name);
    const manifest = path.join(dir, 'manifest.json');
    if (statSync(dir).isDirectory() && existsSync(manifest)) return { dir, id: (JSON.parse(readFileSync(manifest, 'utf8')) as { generation_id: string }).generation_id };
  }
  throw new Error(`Hata: ${root} altında sentetik nesil yok`);
}

/**
 * Sentetik nesli kullanıcı gibi içe aktarır: Veri sayfası (uygulama içinde ya da zaten açıksa) → "Klasörden içe aktar" →
 * nesil klasörü. Tek aday doğrudan içe aktarılır; durum satırı taze nesli adıyla gösterene kadar beklenir. Kaynak bellekte
 * durur: sonrası yalnız uygulama içi gezinme (navigateInApp) ile.
 */
async function importSyntheticGeneration(page: Page) {
  const { dir, id } = syntheticGeneration();
  if (!/#\/veri(?:[/?]|$)/.test(page.url())) await navigateInApp(page, '/veri');
  const main = page.locator(ADMIN_MAIN);
  const chooser = page.waitForEvent('filechooser');
  await main.getByRole('button', { name: 'Klasörden içe aktar' }).click();
  await (await chooser).setFiles(dir);
  const status = main.locator('[role="status"][data-state]').first();
  await expect(status, 'içe aktarılan nesil taze olarak görünür').toHaveAttribute('data-state', 'fresh');
  await expect(status).toContainText(`Nesil ${id.slice(0, 6)}`);
  await waitReady(page);
}

/** Pencereyi ve taşan main kabını en üste alır (bir önceki sayfanın kaydırması grafik konumu önkoşulunu bozmasın). */
async function scrollToTop(page: Page) {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.locator(ADMIN_MAIN).evaluate(main => {
    for (let element: Element | null = main; element; element = element.parentElement) element.scrollTop = 0;
  });
  await waitReady(page);
}

/** Sayfayı ekran ekran sonuna kadar kaydırır (her adımda hazır sinyali); taşan main kabı varsa onu da sona taşır. */
async function scrollThrough(page: Page) {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  for (let step = 0; step < 80; step++) {
    const done = await page.evaluate(() => {
      const before = window.scrollY;
      window.scrollTo({ top: before + Math.max(1, Math.floor(window.innerHeight * 0.9)), behavior: 'instant' });
      return window.scrollY === before || window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 1;
    });
    await waitReady(page);
    if (done) break;
  }
  await page.locator(ADMIN_MAIN).evaluate(main => {
    for (let element: Element | null = main; element; element = element.parentElement) {
      if (element.scrollHeight > element.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(element).overflowY)) element.scrollTop = element.scrollHeight;
    }
  });
  await waitReady(page);
}

const profile = (page: Page) => page.locator('html');
/** Grafik bekleme yer tutucusu (Chart README: role=status "Grafik hazırlanıyor") ya da çizilmiş grafik (role=img + açıklama). */
const chartWaiting = (page: Page) => page.locator(ADMIN_MAIN).getByRole('status').filter({ hasText: /^\s*Grafik hazırlanıyor\s*$/ });
const chartDrawn = (page: Page) => page.locator(`${ADMIN_MAIN} [role="img"][aria-describedby]`);
const anyChart = (page: Page): Locator => chartWaiting(page).or(chartDrawn(page)).first();

/**
 * Ana içerikteki en üstteki grafiğin (yer tutucu ya da çizilmiş) görünüm alanına göre üst kenarı; grafik yoksa null.
 * Tek değerlendirmede okunur: yer tutucu çizilmiş grafikle yer değiştirirken locator.boundingBox yarışı (null) olmaz.
 */
async function topChartEdge(page: Page): Promise<number | null> {
  return page.evaluate(selector => {
    const root = document.querySelector(selector);
    if (!root) return null;
    const tops = [...root.querySelectorAll('[role="img"][aria-describedby], [role="status"]')]
      .filter(element => element.getAttribute('role') === 'img' || (element.textContent ?? '').trim() === 'Grafik hazırlanıyor')
      .map(element => element.getBoundingClientRect())
      .filter(box => box.width > 0 && box.height > 0)
      .map(box => box.top);
    return tops.length ? Math.min(...tops) : null;
  }, ADMIN_MAIN);
}

/** Senaryo raporu: aktarım ve çözülmüş bayt ayrı; JSON eki + tek satır özet. */
async function report(page: Page, testInfo: TestInfo, net: NetworkRecorder, scenario: string, base: URL, index: DeliveryIndex) {
  await net.settle();
  const controlled = await page.evaluate(() => (navigator.serviceWorker?.controller ? 'sayfayı denetliyor' : 'yok')).catch(() => 'okunamadı');
  const bytes = byteReport(net.records, base, index);
  const body = {
    scenario, project: testInfo.project.name, viewport: page.viewportSize(),
    cache: 'soğuk bağlam: boş HTTP önbelleği; vite preview Cache-Control no-cache', serviceWorker: controlled,
    measurement: 'transferBytes = yanıt başlığı + kodlanmış gövde (Playwright request.sizes); decodedBytes = çözülmüş gövde (response.body); kesilen/iptal edilen istek unmeasured',
    ...bytes,
  };
  await testInfo.attach(`ag-${scenario.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')}.json`, { body: JSON.stringify(body, null, 2), contentType: 'application/json' });
  const groups = Object.entries(bytes.byGroup).sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([group, total]) => `${group} ${total.requests}× ${total.transferBytes}/${total.decodedBytes} B`).join('; ');
  console.log(`[ağ] ${scenario} · ${testInfo.project.name} ${body.viewport?.width}×${body.viewport?.height}: ${bytes.totals.requests} istek, `
    + `aktarım ${bytes.totals.transferBytes} B (${kib(bytes.totals.transferBytes)}), çözülmüş ${bytes.totals.decodedBytes} B (${kib(bytes.totals.decodedBytes)}), `
    + `ölçülemeyen ${bytes.totals.unmeasured} · ${groups}`);
  return body;
}
// #endregion

test.beforeEach(async ({}, testInfo) => {
  // playwright.admin.config.ts de admin-*.spec.ts eşler; bu dosya yalnız üretim önizlemesinde anlamlıdır.
  test.skip(!testInfo.config.metadata?.adminProduction, 'Yalnız playwright.admin-production.config.ts ile koşar');
});

// #region öz-denetim
test('dedektör öz-denetimi: enjekte edilen sınıf, eşlenmemiş dosya, tekrar ve ön bellek ihlalleri yakalanır', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Saf denetim; tek projede yeterli');
  // Adlar bilerek yanıltıcı: "Table-ZZZZ" wide, "graphic-GGGG" echarts, "pro-NNNN" sınıfsız bir sayfa. Sınıf addan değil grafikten.
  const manifest: ViteManifest = {
    'index.html': { file: 'assets/index-AAAA.js', isEntry: true, imports: ['_shared-BBBB.js'], dynamicImports: ['src/LegacyApp.tsx', 'src/dashboard/Charts.tsx'] },
    '_shared-BBBB.js': { file: 'assets/shared-BBBB.js' },
    'src/LegacyApp.tsx': { file: 'assets/LegacyApp-CCCC.js', isDynamicEntry: true, imports: ['_shared-BBBB.js', '_antd-EEEE.js'] },
    'src/dashboard/Charts.tsx': { file: 'assets/Charts-JJJJ.js', isDynamicEntry: true, imports: ['_shared-BBBB.js', '_graphic-GGGG.js'], css: ['assets/Charts-JJJJ.css'] },
    'admin.html': { file: 'assets/admin-DDDD.js', isEntry: true, imports: ['_shared-BBBB.js', '_antd-EEEE.js', '_router-RRRR.js'], dynamicImports: ['src/admin/pages/ProPage.tsx', 'src/admin/ui/wide/Table.wide.tsx', 'node_modules/echarts/core.js'], css: ['assets/admin-IIII.css'] },
    '_antd-EEEE.js': { file: 'assets/antd-EEEE.js', imports: ['_icons-KKKK.js'] },
    '_icons-KKKK.js': { file: 'assets/icons-KKKK.js' },
    '_router-RRRR.js': { file: 'assets/router-RRRR.js' },
    'src/admin/pages/ProPage.tsx': { file: 'assets/pro-NNNN.js', isDynamicEntry: true, imports: ['_shared-BBBB.js'], css: ['assets/pro-NNNN.css'] },
    'src/admin/ui/wide/Table.wide.tsx': { file: 'assets/Table-ZZZZ.js', isDynamicEntry: true, imports: ['_antd-EEEE.js'], css: ['assets/Table-ZZZZ.css'], assets: ['assets/kenar-ZZZZ.woff2'] },
    'node_modules/echarts/core.js': { file: 'assets/core-FFFF.js', isDynamicEntry: true, imports: ['_graphic-GGGG.js'] },
    '_graphic-GGGG.js': { file: 'assets/graphic-GGGG.js' },
  };
  const graph: DeliveryGraph = {
    schema: 1,
    groups: ['wide', 'tokens', 'pro', 'icons', 'antd', 'router', 'shared'],
    chunks: {
      'assets/index-AAAA.js': { modules: 2, groups: {}, packages: { '.': 2 } },
      'assets/shared-BBBB.js': { modules: 3, groups: { shared: 3 }, packages: { react: 3 } },
      'assets/LegacyApp-CCCC.js': { modules: 4, groups: {}, packages: { '.': 4 } },
      'assets/Charts-JJJJ.js': { modules: 1, groups: {}, packages: { '.': 1 } },
      'assets/admin-DDDD.js': { modules: 5, groups: {}, packages: { '.': 5 } },
      'assets/antd-EEEE.js': { modules: 9, groups: { antd: 9 }, packages: { antd: 9 } },
      'assets/icons-KKKK.js': { modules: 2, groups: { icons: 2 }, packages: { '@ant-design/icons': 2 } },
      'assets/router-RRRR.js': { modules: 2, groups: { router: 2 }, packages: { wouter: 2 } },
      'assets/pro-NNNN.js': { modules: 1, groups: {}, packages: { '.': 1 } },
      'assets/Table-ZZZZ.js': { modules: 3, groups: { wide: 3 }, packages: { '.': 3 } },
      'assets/core-FFFF.js': { modules: 4, groups: {}, packages: { echarts: 4 } },
      'assets/graphic-GGGG.js': { modules: 2, groups: {}, packages: { zrender: 2 } },
    },
  };
  const build: Build = { manifest, graph };
  const index = deliveryIndex(build);
  const classes = (file: string) => index.get(file)?.classes;
  expect(classes('assets/Table-ZZZZ.js')).toEqual(['wide']);
  expect(classes('assets/Table-ZZZZ.css'), 'css sahibinin sınıfını alır').toEqual(['wide']);
  expect(classes('assets/kenar-ZZZZ.woff2'), 'assets[] sahibinin sınıfını alır').toEqual(['wide']);
  expect(classes('assets/core-FFFF.js')).toEqual(['echarts']);
  expect(classes('assets/graphic-GGGG.js'), 'zrender paketi echarts sayılır').toEqual(['echarts']);
  expect(classes('assets/pro-NNNN.js'), 'ad tek başına sınıf vermez').toEqual([]);
  expect(filesWithClass(index, 'wide')).toEqual(['assets/Table-ZZZZ.css', 'assets/Table-ZZZZ.js', 'assets/kenar-ZZZZ.woff2']);
  expect(() => deliveryIndex({ manifest, graph: { ...graph, chunks: { ...graph.chunks, 'assets/core-FFFF.js': undefined as unknown as GraphChunk } } }), 'eski grafik açık hata verir').toThrow(/delivery-graph içinde assets\/core-FFFF\.js yok/);

  const base = new URL('http://127.0.0.1:5471/aile/');
  const at = (rel: string) => new URL(rel, base).href;
  let seq = 0;
  const rec = (url: string, phase = 'açılış', extra: Partial<NetRecord> = {}): NetRecord =>
    ({ seq: ++seq, phase, url, method: 'GET', status: 'finished', failure: null, httpStatus: 200, transferBytes: 100, decodedBytes: 300, ...extra });
  expect(classify(at('assets/Table-ZZZZ.css?v=1#x'), base, index)).toMatchObject({ category: 'chunk', path: 'assets/Table-ZZZZ.css', group: 'wide' });
  expect(classify(at('assets/yok-0000.js'), base, index)).toMatchObject({ category: 'unmapped', path: 'assets/yok-0000.js' });
  expect(classify('http://127.0.0.1:5471/__aile/generation/manifest.json', base, index).category).toBe('data');
  expect(classify(at('admin.html#/alimlar'), base, index).category).toBe('document');
  expect(classify(at('fonts/outfit-regular.ttf'), base, index).category).toBe('public');
  expect(classify('https://script.google.com/macros/s/x/exec', base, index)).toMatchObject({ category: 'external', path: 'script.google.com' });
  expect(classify('http://127.0.0.1:5999/aile/assets/antd-EEEE.js', base, index).category, 'başka port başka köken').toBe('external');

  // Telefon yolculuğu: temiz liste yalnız izinli dosyalar; enjekte edilen ihlaller (iptal edilen dahil) yakalanır.
  const clean = [rec(at('admin.html#/alimlar')), rec(at('assets/admin-DDDD.js')), rec(at('assets/shared-BBBB.js')), rec(at('assets/pro-NNNN.js')), rec(at('assets/admin-IIII.css'))];
  expect(classRequests(clean, base, index, PHONE_FORBIDDEN)).toEqual([]);
  const injected = [
    ...clean,
    rec(at('assets/antd-EEEE.js'), 'kaydırma', { status: 'failed', failure: 'net::ERR_ABORTED', httpStatus: null, transferBytes: null, decodedBytes: null }),
    rec(at('assets/Table-ZZZZ.css?v=2')),
    rec(at('assets/graphic-GGGG.js')),
    rec(at('assets/icons-KKKK.js'), 'kaydırma', { status: 'pending', httpStatus: null, transferBytes: null, decodedBytes: null }),
    rec(at('assets/yok-0000.js'), 'açılış', { httpStatus: 404 }),
    rec('https://script.google.com/macros/s/x/exec', 'açılış', { status: 'failed', failure: 'net::ERR_BLOCKED_BY_CLIENT', httpStatus: null, transferBytes: null, decodedBytes: null }),
  ];
  expect(classRequests(injected, base, index, PHONE_FORBIDDEN)).toEqual(['antd: assets/antd-EEEE.js', 'echarts: assets/graphic-GGGG.js', 'icons: assets/icons-KKKK.js', 'wide: assets/Table-ZZZZ.css']);
  expect(classRequests(injected, base, index, ['wide'], ['kaydırma']), 'aşama süzgeci').toEqual([]);
  expect(classRequests(injected, base, index, ['antd'], ['kaydırma'])).toEqual(['antd: assets/antd-EEEE.js']);
  expect(unmappedRequests(injected, base, index)).toEqual(['assets/yok-0000.js']);
  expect(failedLoads(injected, base, index)).toEqual(['404 assets/yok-0000.js', 'net::ERR_ABORTED assets/antd-EEEE.js']);
  expect(googleRequests(injected)).toEqual(['script.google.com']);
  expect(googleRequests([rec('https://example.invalid/ornek-gorsel-1.jpg')])).toEqual([]);
  // Google sözleşmesi: yalnız canlı rota aşamasında, derlemeye gömülü kimliğin salt okunur GViz okuması izinli.
  const sheet = 'ornek-sentetik-kimlik-0001';
  const gviz = (id: string) => `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?sheet=Plan&tqx=out%3Ajson`;
  const compiled = (id: string) => id === sheet;
  expect(dataRequests(injected, base, index)).toEqual([]);
  expect(dataRequests([rec('http://127.0.0.1:5471/__aile/generation/_meta', 'açılış', { httpStatus: 404 })], base, index)).toEqual(['/__aile/generation/_meta']);
  expect(googleViolations([rec(gviz(sheet), 'veriyle', { status: 'failed', failure: 'net::ERR_BLOCKED_BY_CLIENT', httpStatus: null })], ['veriyle'], compiled), 'canlı rotada gömülü kimliğin GViz okuması izinli (kesilmiş olsa da)').toEqual([]);
  expect(googleViolations([
    rec(gviz(sheet), 'içe aktarma'),
    rec(gviz('baska-bir-kimlik-000000002'), 'veriyle'),
    rec(gviz(sheet), 'veriyle', { method: 'POST' }),
    rec('https://script.google.com/macros/s/AKfycbx-ornek-uc-000000000/exec', 'veriyle'),
  ], ['veriyle'], compiled)).toEqual([
    'içe aktarma · GET docs.google.com/spreadsheets/d/<kimlik>/gviz/tq: canlı veri kullanmayan rota',
    'veriyle · GET docs.google.com/spreadsheets/d/<kimlik>/gviz/tq: kimlik derlemede yok (VITE_BUDGET_SHEET_ID)',
    'veriyle · GET script.google.com/macros/s/<kimlik>/exec: GViz okuması değil',
    'veriyle · POST docs.google.com/spreadsheets/d/<kimlik>/gviz/tq: salt okunur değil',
  ]);
  expect(googleViolations([rec(gviz(sheet), 'açılış')], [], () => true), 'canlı olmayan rotada her Google isteği ihlal').toHaveLength(1);
  // Büyütme: wide bir kez; ikinci istek yakalanır.
  const once = [rec(at('assets/Table-ZZZZ.js'), 'geniş-1'), rec(at('assets/Table-ZZZZ.css'), 'geniş-1')];
  expect(repeatedRequests(once, base, index, 'wide')).toEqual([]);
  expect(repeatedRequests([...once, rec(at('assets/Table-ZZZZ.js?import'), 'geniş-2')], base, index, 'wide')).toEqual(['assets/Table-ZZZZ.js ×2']);
  expect(requestCounts(once, base, index, 'wide', ['telefon']).size).toBe(0);

  // Bayt raporu: aktarım ve çözülmüş ayrı toplanır; ölçülemeyenler sayılır, sıfır sayılmaz.
  const bytes = byteReport(injected, base, index);
  expect(bytes.totals).toEqual({ requests: 11, transferBytes: 800, decodedBytes: 2400, unmeasured: 3 });
  expect(bytes.byGroup.antd).toEqual({ requests: 1, transferBytes: 0, decodedBytes: 0, unmeasured: 1 });
  expect(bytes.byGroup.uygulama).toEqual({ requests: 3, transferBytes: 300, decodedBytes: 900, unmeasured: 0 });
  expect(bytes.byPhase.kaydırma.requests).toBe(2);

  // Ön bellek kapsamı: yalnız admin'den erişilenler, yasak sınıflar (adı ne olursa olsun), onları statik import edenler.
  const scope = precacheScope(build, index);
  // LegacyApp antd'yi, ana uygulamanın tembel Charts'ı ECharts sınıfı graphic'i statik import eder: ikisi de kirlidir
  // (ön belleğe girmez; vite.config.ts PRECACHE_IGNORES ile aynı yön). Ana çekirdek (index, shared) asla yasak değildir.
  expect([...scope.forbidden].sort()).toEqual([
    'admin.html', 'assets/Charts-JJJJ.css', 'assets/Charts-JJJJ.js', 'assets/LegacyApp-CCCC.js', 'assets/Table-ZZZZ.css', 'assets/Table-ZZZZ.js',
    'assets/admin-DDDD.js', 'assets/admin-IIII.css', 'assets/antd-EEEE.js', 'assets/core-FFFF.js', 'assets/graphic-GGGG.js', 'assets/icons-KKKK.js',
    'assets/kenar-ZZZZ.woff2', 'assets/pro-NNNN.css', 'assets/pro-NNNN.js', 'assets/router-RRRR.js',
  ]);
  expect([...scope.mainBoot].sort()).toEqual(['assets/index-AAAA.js', 'assets/shared-BBBB.js']);
  expect([...scope.mainOnly].sort()).toEqual(['assets/Charts-JJJJ.css', 'assets/Charts-JJJJ.js', 'assets/LegacyApp-CCCC.js', 'assets/index-AAAA.js']);
  expect([...scope.mainEntryFiles]).toEqual(['assets/index-AAAA.js']);
  const cleanPrecache = parsePrecache('s.precacheAndRoute([{url:"index.html",revision:"1"},{url:"assets/index-AAAA.js",revision:null},{url:"assets/shared-BBBB.js",revision:null}])');
  expect(cleanPrecache).toEqual(['index.html', 'assets/index-AAAA.js', 'assets/shared-BBBB.js']);
  expect(forbiddenPaths(cleanPrecache, scope.forbidden, base)).toEqual([]);
  expect(forbiddenPaths([...cleanPrecache, 'assets/router-RRRR.js', 'assets/Table-ZZZZ.css', 'admin.html', at('assets/pro-NNNN.js?__WB_REVISION__=1')], scope.forbidden, base))
    .toEqual(['admin.html', 'assets/Table-ZZZZ.css', 'assets/pro-NNNN.js', 'assets/router-RRRR.js']);
  expect(duplicateUrls(parsePrecache('[{url:"icon.svg",revision:"1"},{url:"index.html",revision:"2"},{url:"icon.svg",revision:"1"}]'))).toEqual(['icon.svg']);
  // Ana çekirdek antd'yi statik import etmeye başlarsa çekirdek kirlenir.
  const leaked = precacheScope({ manifest: { ...manifest, 'index.html': { ...manifest['index.html'], imports: ['_shared-BBBB.js', '_antd-EEEE.js'] } }, graph }, index);
  expect([...leaked.mainBoot].filter(file => leaked.forbidden.has(file)).sort()).toEqual(['assets/antd-EEEE.js', 'assets/icons-KKKK.js', 'assets/index-AAAA.js']);
  // Ad kapısı (W0): wide dahil; ana uygulamanın Charts-* ve index-* parçaları değil.
  expect(['admin-1.js', 'antd-2.js', 'pro-3.css', 'icons-4.js', 'wide-5.js', 'wide-5.css'].every(name => ADMIN_VENDOR_CHUNK.test(name))).toBe(true);
  expect(['Charts-1.js', 'index-2.js', 'widen-3.js', 'assets/wide-4.js'].some(name => ADMIN_VENDOR_CHUNK.test(name))).toBe(false);

  // ECharts çalışma zamanı (a13): Chart.tsx'in tembel import('./Chart.runtime') parçası, ECharts modülleri ayrı bir
  // parçada (install-*) dursa bile manifestteki dinamik giriş kaynağından echarts sayılır; ad tahmini yok.
  const runtimeBuild: Build = {
    manifest: {
      'admin.html': { file: 'assets/admin-DDDD.js', isEntry: true, dynamicImports: [ECHARTS_RUNTIME_SRC] },
      [ECHARTS_RUNTIME_SRC]: { file: 'assets/Chart.runtime-UUUU.js', isDynamicEntry: true, imports: ['_install-VVVV.js'] },
      '_install-VVVV.js': { file: 'assets/install-VVVV.js' },
    },
    graph: {
      schema: 1,
      groups: graph.groups,
      chunks: {
        'assets/admin-DDDD.js': { modules: 5, groups: {}, packages: { '.': 5 } },
        'assets/Chart.runtime-UUUU.js': { modules: 1, groups: {}, packages: { '.': 1 } },
        'assets/install-VVVV.js': { modules: 6, groups: {}, packages: { echarts: 4, zrender: 2 } },
      },
    },
  };
  const runtimeIndex = deliveryIndex(runtimeBuild);
  expect(filesWithClass(runtimeIndex, 'echarts')).toEqual(['assets/Chart.runtime-UUUU.js', 'assets/install-VVVV.js']);
  expect(runtimeIndex.get('assets/admin-DDDD.js')?.classes).toEqual([]);
  expect(classRequests([rec(at('assets/Chart.runtime-UUUU.js'), 'kaydırma')], base, runtimeIndex, PHONE_FORBIDDEN)).toEqual(['echarts: assets/Chart.runtime-UUUU.js']);
});

test('dedektör öz-denetimi (canlı): enjekte edilen, iptal edilen ve kesilen istekler kaydedilir, sınıflanır, ölçülür', async ({ page, context }, testInfo) => {
  const build = loadBuild();
  const index = deliveryIndex(build);
  const base = baseOf(testInfo);
  const antd = filesWithClass(index, 'antd', 'js')[0];
  const echarts = filesWithClass(index, 'echarts', 'js')[0];
  expect(antd, 'derleme antd sınıfı parça üretmeli').toBeTruthy();
  expect(echarts, 'derleme ECharts sınıfı parça üretmeli').toBeTruthy();
  // Derlemeye gömülü dize dedektörü gerçek dist üzerinde: bilinen arayüz dizesi bulunur, uydurma kimlik bulunmaz.
  const compiled = compiledSheetId();
  expect(compiled('Klasörden içe aktar'), 'dist JS içindeki dize bulunur').toBe(true);
  expect(compiled('derlemede-olmayan-kimlik-e02-0000'), 'derlemede olmayan kimlik').toBe(false);
  const net = await prepareAdminContext(context, testInfo);
  // ECharts isteği sunucuya ulaşmadan iptal edilir: başlatılmış ama tamamlanmamış istek yine sayılmalı.
  await context.route(url => distPath(url.href, base) === echarts, route => route.abort('aborted'));
  await page.goto(new URL('icon.svg', base).href);
  net.phase('enjeksiyon');
  const urls = [antd, antd, echarts, 'assets/yok-e02-oz-denetim.js'].map(rel => new URL(rel, base).href);
  await page.evaluate(async list => {
    await Promise.allSettled([...list, 'https://script.google.com/macros/s/e02/exec'].map(url => fetch(url, { cache: 'no-store' }).then(response => response.arrayBuffer())));
  }, urls);
  await net.settle();
  expect(classRequests(net.records, base, index, PHONE_FORBIDDEN, ['enjeksiyon'])).toEqual([`antd: ${antd}`, `echarts: ${echarts}`].sort());
  const aborted = net.records.filter(record => distPath(record.url, base) === echarts);
  expect(aborted.map(record => record.status), 'iptal edilen istek başarısız olarak kaydedilir').toEqual(['failed']);
  expect(repeatedRequests(net.records, base, index, 'antd')).toEqual([`${antd} ×2`]);
  expect(unmappedRequests(net.records, base, index)).toEqual(['assets/yok-e02-oz-denetim.js']);
  expect(googleRequests(net.records)).toEqual(['script.google.com']);
  // Ölçüm: çözülmüş gövde diskteki dosyaya eşit; aktarım ayrı ölçülür (önizleme sıkıştırır, ama eşitlik de geçerli olurdu).
  const loaded = net.records.filter(record => distPath(record.url, base) === antd && record.status === 'finished');
  expect(loaded.length).toBe(2);
  for (const record of loaded) {
    expect(record.decodedBytes, 'çözülmüş boyut diskteki dosya boyutu').toBe(statSync(path.join(DIST, antd)).size);
    expect(record.transferBytes ?? 0, 'aktarım baytı ölçülür').toBeGreaterThan(0);
  }
  await report(page, testInfo, net, 'oz-denetim', base, index);
});
// #endregion

// #region ana uygulama ve ön bellek
test('sw.js ön belleği her dosyayı bir kez içerir; yönetim, sınıflı ve wouter yönlendirici parçaları içermez', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Yalnız dist/ denetimi; tek projede yeterli');
  const build = loadBuild();
  const index = deliveryIndex(build);
  const scope = precacheScope(build, index);
  const precache = parsePrecache(readFileSync(path.join(DIST, 'sw.js'), 'utf8'));
  const base = baseOf(testInfo);
  expect(precache.length).toBeGreaterThan(0);
  // vite-plugin-pwa includeAssets/manifest simgeleri, globPatterns'in zaten eşlediği public dosyasını ikinci kez ekler.
  expect(duplicateUrls(precache), 'sw.js precache listesinde yinelenen girdiler').toEqual([]);
  expect(forbiddenPaths(precache, scope.forbidden, base), 'sw.js precache listesindeki yönetim parçaları').toEqual([]);
  // Ana kabuk wouter'dan yalnız use-hash-location kancasını kullanır; Router/Switch/regexparam `router` grubunda kalır.
  const routers = filesWithClass(index, 'router', 'js');
  expect(routers, 'wouter yönlendirici çekirdeği kendi router grubunda olmalı').toHaveLength(1);
  expect(routers.filter(file => scope.mainBoot.has(file)), 'router ana kabuğun statik kapanışına girmemeli').toEqual([]);
  // Dedektör boş kalmasın: yönetim grafiği gerçekten antd ve ECharts sınıfı parçalara erişir.
  expect(filesWithClass(index, 'antd').some(file => scope.adminReach.has(file)), 'admin.html antd sınıfı parçaya erişmeli').toBe(true);
  expect(filesWithClass(index, 'echarts').some(file => scope.adminReach.has(file)), 'admin.html ECharts sınıfı parçaya erişmeli').toBe(true);
  // a13: Chart.tsx'in tembel ECharts çalışma zamanı derlemede dinamik giriştir, admin grafiğindedir ve echarts sayılır.
  const runtime = build.manifest[ECHARTS_RUNTIME_SRC];
  expect(runtime?.isDynamicEntry, `${ECHARTS_RUNTIME_SRC} manifestte tembel giriş olmalı`).toBe(true);
  expect(filesWithClass(index, 'echarts', 'js'), 'ECharts çalışma zamanı parçası echarts sınıfında').toContain(runtime!.file);
  expect(scope.adminReach.has(runtime!.file), 'admin.html ECharts çalışma zamanına (tembel) erişir').toBe(true);
  expect([...scope.mainBoot].filter(file => scope.forbidden.has(file)), 'ana giriş çekirdeği yönetim parçası import etmemeli').toEqual([]);
});

test('/aile/ soğuk açılışı yönetim parçalarını istemez; sw.js ön belleği ve Cache Storage içermez', async ({ page, context }, testInfo) => {
  const build = loadBuild();
  const index = deliveryIndex(build);
  const scope = precacheScope(build, index);
  const base = baseOf(testInfo);
  await isolateNetwork(context, testInfo);
  const net = recordNetwork(context);

  await page.goto(base.href);
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
  await net.settle();
  await testInfo.attach('ana-soguk-acilis.json', {
    body: JSON.stringify({ requested: net.records.map(record => distPath(record.url, base) ?? record.url), cached: cached.map(url => distPath(url, base) ?? url), forbidden: [...scope.forbidden].sort() }, null, 2),
    contentType: 'application/json',
  });
  await report(page, testInfo, net, 'ana-soguk-acilis', base, index);

  expect(failedLoads(net.records, base, index), 'ana uygulama dosyaları eksiksiz yüklenmeli').toEqual([]);
  expect(unmappedRequests(net.records, base, index), 'istenen her assets/ dosyası manifestte olmalı').toEqual([]);
  expect(net.records.some(record => scope.mainEntryFiles.has(distPath(record.url, base) ?? '')), 'ana giriş parçası yüklenmeli').toBe(true);
  expect(forbiddenPaths(net.records.map(record => record.url), scope.forbidden, base), 'soğuk açılışta istenen yönetim parçaları').toEqual([]);
  expect(cached.length, 'precache Cache Storage içinde görünmeli').toBeGreaterThan(0);
  expect(forbiddenPaths(cached, scope.forbidden, base), 'Cache Storage içindeki yönetim parçaları').toEqual([]);

  const served = await page.request.get(new URL('sw.js', base).href);
  expect(served.status()).toBe(200);
  const swSource = await served.text();
  expect(swSource, 'önizleme güncel dist/sw.js dosyasını servis etmeli (önce pnpm build)').toBe(readFileSync(path.join(DIST, 'sw.js'), 'utf8'));
  const precache = parsePrecache(swSource);
  expect(precache.length).toBeGreaterThan(0);
  expect(forbiddenPaths(precache, scope.forbidden, base), 'sw.js precache listesindeki yönetim parçaları').toEqual([]);
});

test('/__aile/generation dev-only ara katmanı üretim önizlemesinde 404 döner', async ({ request }) => {
  for (const route of ['/__aile/generation', '/__aile/generation/_meta', '/__aile/generation/manifest.json', '/__aile/generation/data/purchase_needs/all/0000.json']) {
    for (const accept of ['application/json', '*/*']) {
      for (const method of ['GET', 'HEAD'] as const) {
        const response = await request.fetch(route, { method, headers: { Accept: accept } });
        expect(response.status(), `${method} ${route} (${accept})`).toBe(404);
        expect(response.headers()['content-type'] ?? '', `${method} ${route} JSON servis etmemeli`).not.toContain('application/json');
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
// #endregion

// #region telefon
/** navigation.ts sırası + Ayarlar; her rota önce soğuk açılır (derin bağlantı, veri yok), sonra veriyle yeniden açılır. */
const ADMIN_ROUTES = ['/alimlar', '/genel', '/butce', '/odemeler', '/hesaplar', '/ev', '/projeler', '/taraflar', '/raporlar', '/sozlukler', '/veri', '/ayarlar'] as const;

test.describe('telefon profili soğuk açılış: antd, pro, icons, echarts ve wide istenmez', () => {
  for (const route of ADMIN_ROUTES) {
    test(`telefon ${route}`, async ({ page, context }, testInfo) => {
      const build = loadBuild();
      const index = deliveryIndex(build);
      const base = baseOf(testInfo);
      const net = await prepareAdminContext(context, testInfo);
      // Soğuk derin bağlantı: üretimin varsayılan nesil kaynağı seçilmemiş klasördür (veri yok, nesil isteği yok).
      await openAdmin(page, route);
      expect(new URL(page.url()).hash, `${route} yönlendirilmeden açılmalı`).toMatch(new RegExp(`^#${route}(?:[/?]|$)`));
      await expect(profile(page), 'telefon genişliği telefon profilidir').toHaveAttribute('data-profile', 'phone');
      // Veriyle: sentetik nesil Veri sayfasından içe aktarılır, rota uygulama içinde yeniden açılır ve sonuna kadar
      // kaydırılır. Görünür alana giren her bölge (grafik dahil) telefonda da geniş-özel kod istememeli.
      net.phase('içe aktarma');
      await importSyntheticGeneration(page);
      net.phase('veriyle');
      if (route !== '/veri') await navigateInApp(page, route);
      await expect(profile(page)).toHaveAttribute('data-profile', 'phone');
      await scrollThrough(page);
      await report(page, testInfo, net, `telefon ${route}`, base, index);
      expect(classRequests(net.records, base, index, PHONE_FORBIDDEN), `telefon ${route}: istenen yasak sınıflar (${PHONE_FORBIDDEN.join(', ')})`).toEqual([]);
      expect(unmappedRequests(net.records, base, index), 'istenen her assets/ dosyası manifestte olmalı').toEqual([]);
      expect(failedLoads(net.records, base, index), 'önizleme dosyaları eksiksiz yüklenmeli').toEqual([]);
      expect(dataRequests(net.records, base, index), 'üretim derlemesi nesil ara katmanını istemez').toEqual([]);
      const livePhases = LIVE_SHEET_ROUTES.includes(route) ? ['açılış', 'veriyle'] : [];
      expect(googleViolations(net.records, livePhases, compiledSheetId()), `telefon ${route}: Google isteği yalnız VITE_BUDGET_SHEET_ID gömülüyken ve yalnız canlı veri rotasında (salt okunur GViz)`).toEqual([]);
    });
  }
});

// İnceleme bulgusu (major): üretimde Vite'ın ön yükleme yardımcısı her dinamik importta `vite:preloadError` yayar;
// preloadRecovery ilk parça hatasında olayı iptal edip sayfayı kendiliğinden yeniliyordu (içe aktarılan nesil ve taslaklar
// kayboluyordu, lazyWide yeniden denemesi ve bildirim hiç çalışmıyordu). Dev sunucusunda bu yardımcı yoktur; davranış
// yalnız üretim önizlemesinde sınanabilir.
test('parça hatası (telefon): sayfa parçası indirilemezse "Yeni sürüm var · Yenile"; sayfa kendiliğinden yenilenmez, içe aktarılan nesil korunur', async ({ page, context }, testInfo) => {
  const build = loadBuild();
  const index = deliveryIndex(build);
  const base = baseOf(testInfo);
  const net = await prepareAdminContext(context, testInfo);
  await countDocumentLoads(context);
  // Yayından sonra silinmiş sayfa parçası: Taraflar sayfasının JS dosyası 404 döner.
  const taraflar = build.manifest['src/admin/pages/TaraflarPage.tsx'];
  expect(taraflar, 'Taraflar sayfası manifestte dinamik giriş').toBeDefined();
  let blocked = true;
  await context.route(url => distPath(url.href, base) === taraflar.file, route => (blocked ? route.fulfill(deletedChunk) : route.continue()));
  await openAdmin(page, '/veri');
  await expect(profile(page)).toHaveAttribute('data-profile', 'phone');
  await importSyntheticGeneration(page);
  const { id } = syntheticGeneration();
  expect(await documentLoads(page), 'önkoşul: tek belge yüklemesi').toBe(1);

  net.phase('kırık rota');
  await navigateInApp(page, '/taraflar');
  const main = page.locator(ADMIN_MAIN);
  const notice = main.getByRole('status').filter({ hasText: 'Yeni sürüm var' });
  await expect(notice, 'sürüm kayması bildirimi').toBeVisible({ timeout: 15_000 });
  await expect(main.getByRole('heading', { level: 1 }), 'sayfa başlığı korunur').toHaveText('Taraflar ve teklifler');
  const reload = notice.getByRole('button', { name: 'Yenile', exact: true });
  await expect(reload).toBeVisible();
  expect(await documentLoads(page), 'parça hatası sayfayı kendiliğinden yenilemez').toBe(1);
  expect(net.records.filter(record => distPath(record.url, base) === taraflar.file).length, 'parça istendi (404)').toBeGreaterThan(0);

  // Uygulama içinde başka rotaya dönüş: içe aktarılan nesil bellekte, hâlâ taze.
  net.phase('geri');
  await navigateInApp(page, '/veri');
  const status = main.locator('[role="status"][data-state]').first();
  await expect(status, 'içe aktarılan nesil korunur').toHaveAttribute('data-state', 'fresh');
  await expect(status).toContainText(`Nesil ${id.slice(0, 6)}`);
  expect(await documentLoads(page)).toBe(1);

  // Yenileme kullanıcının seçimidir: "Yenile" tek yeni belge yüklemesi başlatır ve kabuk aynı rotada açılır. Gerçek
  // yayında yeni admin.html yeni parça adlarını getirir; burada derleme aynı olduğundan parçanın yeniden gelip gelmediği
  // tarayıcı önbelleğine kalır (WebKit aynı adresteki başarısız modülü yeniden yüklemede de istemedi), sınanmaz.
  net.phase('yenile');
  await navigateInApp(page, '/taraflar');
  await expect(notice).toBeVisible({ timeout: 15_000 });
  blocked = false;
  await Promise.all([page.waitForEvent('load'), notice.getByRole('button', { name: 'Yenile', exact: true }).click()]);
  await waitReady(page);
  expect(await documentLoads(page), '"Yenile" tek yeni belge yüklemesi').toBe(2);
  await expect(page).toHaveURL(/admin\.html#\/taraflar$/);
  await expect(main.getByRole('heading', { level: 1 })).toHaveText('Taraflar ve teklifler');
  await report(page, testInfo, net, 'parca-hatasi-telefon', base, index);
  expect(dataRequests(net.records, base, index), 'üretim derlemesi nesil ara katmanını istemez').toEqual([]);
});

test.describe('yatay telefon 568×320', () => {
  test.use({ viewport: { width: 568, height: 320 }, hasTouch: true });

  test('yatay telefon: profil telefon kalır, wide istenmez', { tag: '@matrix' }, async ({ page, context }, testInfo) => {
    const build = loadBuild();
    const index = deliveryIndex(build);
    const base = baseOf(testInfo);
    const net = await prepareAdminContext(context, testInfo);
    const routes = ['/alimlar', '/genel', '/raporlar'];
    // Önce soğuk derin bağlantı (veri yok), sonra içe aktarılan sentetik nesille uygulama içinde aynı rotalar.
    for (const route of routes) {
      net.phase(route);
      await openAdmin(page, route);
      await expect(profile(page), `${route}: kısa kenarı 480'den küçük yatay telefon telefon profilidir`).toHaveAttribute('data-profile', 'phone');
      await scrollThrough(page);
    }
    net.phase('içe aktarma');
    await importSyntheticGeneration(page);
    for (const route of routes) {
      net.phase(`${route} veriyle`);
      await navigateInApp(page, route);
      await expect(profile(page), `${route} veriyle: profil telefon kalır`).toHaveAttribute('data-profile', 'phone');
      await scrollThrough(page);
    }
    const body = await report(page, testInfo, net, 'yatay-telefon', base, index);
    await testInfo.attach('yatay-telefon-diger-siniflar.json', {
      body: JSON.stringify({ phoneForbiddenObserved: classRequests(net.records, base, index, PHONE_FORBIDDEN), wideFilesInBuild: filesWithClass(index, 'wide'), totals: body.totals }, null, 2),
      contentType: 'application/json',
    });
    expect(classRequests(net.records, base, index, ['wide']), 'yatay telefonda wide istenmemeli').toEqual([]);
    expect(unmappedRequests(net.records, base, index)).toEqual([]);
    expect(failedLoads(net.records, base, index)).toEqual([]);
    expect(dataRequests(net.records, base, index), 'üretim derlemesi nesil ara katmanını istemez').toEqual([]);
    expect(googleViolations(net.records, [], compiledSheetId()), 'Google isteği canlı veri kullanmayan rotalarda yok').toEqual([]);
  });
});

test('telefondan 1440×900 büyütme: wide bir kez yüklenir, telefona dönüp yeniden büyütünce tekrar istenmez', { tag: '@matrix' }, async ({ page, context }, testInfo) => {
  const build = loadBuild();
  const index = deliveryIndex(build);
  const base = baseOf(testInfo);
  const phone = testInfo.project.use.viewport ?? { width: 320, height: 568 };
  const wide = { width: 1440, height: 900 };
  const net = await prepareAdminContext(context, testInfo);
  net.phase('telefon');
  await openAdmin(page, '/alimlar');
  await expect(profile(page)).toHaveAttribute('data-profile', 'phone');
  // Sentetik nesille: Alımlar tablosu dolu (genişte geniş tablo/pivot bunu çizer).
  await importSyntheticGeneration(page);
  await navigateInApp(page, '/alimlar');
  expect(classRequests(net.records, base, index, ['wide']), 'telefon açılışında wide istenmemeli').toEqual([]);
  const wideFiles = filesWithClass(index, 'wide', 'js');
  expect(wideFiles.length, 'derlemede wide grubu (manifest + delivery-graph) bulunmalı: geniş-özel *.wide.tsx modülleri lazyWide ile yüklenir').toBeGreaterThan(0);

  net.phase('geniş-1');
  await page.setViewportSize(wide);
  await expect(profile(page)).toHaveAttribute('data-profile', 'desktop');
  await expect.poll(() => net.records.filter(record => record.phase === 'geniş-1' && record.status === 'finished' && classify(record.url, base, index).classes.includes('wide')).length,
    { message: '1440 genişlikte wide parçası yüklenmeli', timeout: 20_000 }).toBeGreaterThan(0);
  await waitReady(page);

  net.phase('telefon-2');
  await page.setViewportSize(phone);
  await expect(profile(page)).toHaveAttribute('data-profile', 'phone');
  await waitReady(page);

  net.phase('geniş-2');
  await page.setViewportSize(wide);
  await expect(profile(page)).toHaveAttribute('data-profile', 'desktop');
  await waitReady(page);

  await report(page, testInfo, net, 'buyutme-telefon-1440', base, index);
  expect(repeatedRequests(net.records, base, index, 'wide'), 'her wide dosyası en çok bir kez istenmeli').toEqual([]);
  expect(classRequests(net.records, base, index, ['wide'], ['telefon', 'telefon-2', 'geniş-2']), 'wide yalnız ilk büyütmede istenmeli').toEqual([]);
  expect(failedLoads(net.records, base, index)).toEqual([]);
  expect(dataRequests(net.records, base, index), 'üretim derlemesi nesil ara katmanını istemez').toEqual([]);
  expect(googleViolations(net.records, [], compiledSheetId()), 'Google isteği canlı veri kullanmayan rotalarda yok').toEqual([]);
});
// #endregion

// #region geniş
test.describe('geniş 1440×900', () => {
  test.use({ viewport: { width: 1440, height: 900 }, hasTouch: false });

  test('geniş: ECharts grafiksiz sayfada hiç, katlama altındaki grafikte yalnız görünür alana girince istenir', { tag: '@matrix' }, async ({ page, context }, testInfo) => {
    const build = loadBuild();
    const index = deliveryIndex(build);
    const base = baseOf(testInfo);
    const viewport = page.viewportSize()!;
    const net = await prepareAdminContext(context, testInfo);
    // Veri gerektiren senaryo: sentetik nesil Veri sayfasından içe aktarılır; rotalar uygulama içinde açılır.
    net.phase('içe aktarma');
    await openAdmin(page, '/veri');
    await expect(profile(page)).toHaveAttribute('data-profile', 'desktop');
    await importSyntheticGeneration(page);
    // Grafiksiz rotalar: Alımlar ve Genel (r4-sums: Genel'in "Aylık plan ve gerçek" bölümü yalnız tablodur; yaprak satır
    // sahipliği haritası olmadan dürüst aylık toplam yok). Sonuna kadar kaydırılsa da grafik yuvası belirmez, ECharts
    // istenmez. anyChart aynı testte /butce eğiliminde grafiği bulur (konumlayıcı kör değil).
    net.phase('grafiksiz');
    for (const route of CHART_FREE_ROUTES) {
      await navigateInApp(page, route);
      await scrollThrough(page);
      await expect(anyChart(page), `${route} grafik çizmez (yuva ya da çizim yok)`).toHaveCount(0);
    }
    expect(classRequests(net.records, base, index, ['echarts'], ['içe aktarma', 'grafiksiz']), `/veri ve grafiksiz rotalar (${CHART_FREE_ROUTES.join(', ')}): ECharts istenmemeli`).toEqual([]);
    await scrollToTop(page);

    // Katlama altındaki grafik: Bütçe › "Aylık eğilim" (butce/ButceTrend.wide; seçili kalemin aylık plan ve gerçek
    // çizgisi). 1440×900 açılışında kalem tablosunun altında, katlamanın altında başlar (konum her koşuda ölçülür).
    net.phase('katlama-alti');
    await navigateInApp(page, BELOW_FOLD_CHART_ROUTE);
    const trend = page.locator(ADMIN_MAIN).getByRole('region', { name: BELOW_FOLD_CHART_REGION });
    await expect(trend, `${BELOW_FOLD_CHART_ROUTE} › ${BELOW_FOLD_CHART_REGION} bölgesi`).toBeAttached();
    const chart = anyChart(page);
    await expect(chart, `${BELOW_FOLD_CHART_ROUTE} bir grafik (yuva) içerir`).toBeAttached();
    expect(await trend.evaluate((region, slot) => region.contains(slot), await chart.elementHandle()), 'grafik eğilim bölgesinde').toBe(true);
    expect(await page.evaluate(() => window.scrollY), 'önkoşul: sayfa en üstte').toBe(0);
    const top = await topChartEdge(page);
    expect(top, `${BELOW_FOLD_CHART_ROUTE} grafiğinin konumu okunur`).not.toBeNull();
    testInfo.annotations.push({ type: 'katlama', description: `${BELOW_FOLD_CHART_ROUTE} grafik üst kenarı ${Math.round(top!)} px (görünüm ${viewport.width}×${viewport.height})` });
    expect(top!, `önkoşul: ${BELOW_FOLD_CHART_ROUTE} grafiği ${viewport.width}×${viewport.height} açılışında katlamanın altında (üst kenar ≥ ${viewport.height})`).toBeGreaterThanOrEqual(viewport.height);
    await net.settle();
    expect(classRequests(net.records, base, index, ['echarts'], ['katlama-alti']), 'grafik görünür alana girmeden ECharts istenmemeli').toEqual([]);

    net.phase('gorunur');
    await chart.scrollIntoViewIfNeeded();
    await expect(trend.locator('[role="img"][aria-describedby]').first(), 'görünür alana giren grafik çizilir').toBeVisible({ timeout: 20_000 });
    await report(page, testInfo, net, 'genis-echarts-gorunurluk', base, index);
    expect(classRequests(net.records, base, index, ['echarts'], ['gorunur']).length, 'grafik görünür alana girince ECharts istenir').toBeGreaterThan(0);
    expect(unmappedRequests(net.records, base, index)).toEqual([]);
    expect(failedLoads(net.records, base, index)).toEqual([]);
    expect(dataRequests(net.records, base, index), 'üretim derlemesi nesil ara katmanını istemez').toEqual([]);
    // Bütçe canlı veri rotasıdır: GViz okuması yalnız o rotadaki aşamalarda izinli; grafiksiz rotalarda ihlal.
    expect(googleViolations(net.records, ['katlama-alti', 'gorunur'], compiledSheetId()), 'Google isteği yalnız canlı veri rotasında (salt okunur GViz)').toEqual([]);
  });

  test('geniş: açılışta görünür alandaki grafik ECharts yükler ve çizilir', { tag: '@matrix' }, async ({ page, context }, testInfo) => {
    const build = loadBuild();
    const index = deliveryIndex(build);
    const base = baseOf(testInfo);
    const viewport = page.viewportSize()!;
    const net = await prepareAdminContext(context, testInfo);
    net.phase('içe aktarma');
    await openAdmin(page, '/veri');
    await importSyntheticGeneration(page);
    expect(classRequests(net.records, base, index, ['echarts']), 'grafiksiz Veri sayfası ECharts istemez').toEqual([]);
    net.phase('raporlar');
    await navigateInApp(page, '/raporlar');
    await expect(anyChart(page), '/raporlar bir grafik içerir').toBeAttached();
    const top = await topChartEdge(page);
    expect(top, '/raporlar grafiğinin konumu okunur').not.toBeNull();
    expect(top!, `önkoşul: /raporlar grafiği ${viewport.height} px yüksekliğinde görünür alanda başlar`).toBeLessThan(viewport.height);
    await expect(chartDrawn(page).first(), 'görünür grafik çizilir').toBeVisible({ timeout: 20_000 });
    await report(page, testInfo, net, 'genis-gorunur-grafik', base, index);
    expect(classRequests(net.records, base, index, ['echarts'], ['raporlar']).length, 'görünür grafik ECharts ister').toBeGreaterThan(0);
    expect(failedLoads(net.records, base, index)).toEqual([]);
    expect(dataRequests(net.records, base, index), 'üretim derlemesi nesil ara katmanını istemez').toEqual([]);
    expect(googleViolations(net.records, [], compiledSheetId()), 'Google isteği canlı veri kullanmayan rotalarda yok').toEqual([]);
  });

  test('geniş: admin.html#/alimlar kendi giriş parçasını bir kez yükler, ana girişin parçalarını istemez; veri ara katmanı 404', { tag: '@matrix' }, async ({ page, context }, testInfo) => {
    const build = loadBuild();
    const index = deliveryIndex(build);
    const scope = precacheScope(build, index);
    const base = baseOf(testInfo);
    const net = await prepareAdminContext(context, testInfo);
    await gotoAdmin(page, '/alimlar');
    await expect(page).toHaveURL(/\/aile\/admin\.html#\/alimlar$/);
    await waitReady(page);
    const adminEntry = build.manifest[ADMIN_ENTRY];
    await expect.poll(() => net.records.filter(record => distPath(record.url, base) === adminEntry.file).length, { message: 'admin giriş parçası istenmeli' }).toBe(1);
    // d02: üretimin varsayılan nesil kaynağı seçilmemiş klasördür; açılış nesil ara katmanına hiç istek atmaz ve sayfa
    // "Klasör seçilmedi" durumunda açılır (neden + çözüm: Veri sayfasında «Klasörden içe aktar»).
    expect(dataRequests(net.records, base, index, ['açılış']), 'varsayılan üretim derlemesi /__aile/generation istemez').toEqual([]);
    await expect(page.locator(ADMIN_MAIN).getByText(/Nesil klasörü seçilmedi\. Veri sayfasında «Klasörden içe aktar»/).first(), 'seçilmemiş klasör durumu').toBeVisible();
    // Ara katman önizlemede de yok (doğrudan denenince 404); veri sızmaz.
    net.phase('ara-katman');
    expect(await page.evaluate(() => fetch('/__aile/generation/_meta').then(response => response.status))).toBe(404);
    await report(page, testInfo, net, 'genis-admin-giris', base, index);
    const paths = net.records.map(record => distPath(record.url, base) ?? '');
    for (const css of adminEntry.css ?? []) expect(paths.filter(rel => rel === css), `${css} bir kez istenmeli`).toHaveLength(1);
    expect(repeatedRequests(net.records, base, index, 'antd'), 'antd parçaları en çok bir kez').toEqual([]);
    expect(paths.filter(rel => scope.mainEntryFiles.has(rel)), 'ana giriş parçası istenmemeli').toEqual([]);
    expect(forbiddenPaths(net.records.map(record => record.url), scope.mainOnly, base), 'yalnız ana uygulamaya ait parçalar istenmemeli').toEqual([]);
    expect(unmappedRequests(net.records, base, index)).toEqual([]);
    expect(failedLoads(net.records, base, index), 'yönetim dosyaları eksiksiz yüklenmeli').toEqual([]);
    expect(googleViolations(net.records, [], compiledSheetId()), 'Google isteği canlı veri kullanmayan rotalarda yok').toEqual([]);
  });

  // İnceleme bulgusu (major): tek `wide` parçası dokuz sayfa parçasını statik çekiyordu; masaüstünde ilk rota başka
  // sayfaların JS/CSS'ini indirip çalıştırıyordu (dev testi yanlış yeşildi: dev'de wide modülleri ayrı dosyalar).
  test('geniş: /genel açılınca başka hiçbir rota sayfasının parçası istenmez; antd/pro/icons istenmez', { tag: '@matrix' }, async ({ page, context }, testInfo) => {
    const build = loadBuild();
    const index = deliveryIndex(build);
    const base = baseOf(testInfo);
    const net = await prepareAdminContext(context, testInfo);
    await openAdmin(page, '/genel');
    await expect(profile(page)).toHaveAttribute('data-profile', 'desktop');
    await net.settle();
    const requested = new Set(net.records.map(record => distPath(record.url, base) ?? ''));
    const pages = Object.keys(build.manifest).filter(key => ROUTE_PAGE.test(key));
    expect(pages, 'manifestte 12 rota sayfası').toHaveLength(12);
    const genel = 'src/admin/pages/GenelPage.tsx';
    expect(chunkFiles(build.manifest, genel).filter(file => requested.has(file)).length, 'Genel sayfası parçası istendi').toBeGreaterThan(0);
    expect(classRequests(net.records, base, index, ['wide']).length, 'geniş profil wide parçasını ister').toBeGreaterThan(0);
    await report(page, testInfo, net, 'genis-genel-sayfa-yalitimi', base, index);
    const others = pages.filter(key => key !== genel).flatMap(key => chunkFiles(build.manifest, key).filter(file => requested.has(file)).map(file => `${key}: ${file}`));
    expect(others, 'başka rota sayfalarının istenen parçaları').toEqual([]);
    expect(classRequests(net.records, base, index, ['antd', 'pro', 'icons']), 'geniş profil antd/pro/icons istemez (WideProviders hiçbir profilde yüklenmez)').toEqual([]);
    expect(failedLoads(net.records, base, index)).toEqual([]);
  });

  test('parça hatası (geniş): wide parçası indirilemezse bildirim + telefon sunumu; sayfa kendiliğinden yenilenmez, nesil korunur', { tag: '@matrix' }, async ({ page, context }, testInfo) => {
    const build = loadBuild();
    const index = deliveryIndex(build);
    const base = baseOf(testInfo);
    const net = await prepareAdminContext(context, testInfo);
    await countDocumentLoads(context);
    // Genel sayfasının tembel wide parçaları (lazyWide hedefleri) yayından sonra silinmiş gibi 404 döner.
    const genel = build.manifest['src/admin/pages/GenelPage.tsx'];
    const wideFiles = new Set((genel.dynamicImports ?? []).map(key => build.manifest[key].file).filter(file => index.get(file)?.classes.includes('wide')));
    expect(wideFiles.size, 'Genel sayfası tembel wide parçası').toBeGreaterThan(0);
    await context.route(url => wideFiles.has(distPath(url.href, base) ?? ''), route => route.fulfill(deletedChunk));
    await openAdmin(page, '/veri');
    await expect(profile(page)).toHaveAttribute('data-profile', 'desktop');
    await importSyntheticGeneration(page);
    const { id } = syntheticGeneration();
    expect(await documentLoads(page), 'önkoşul: tek belge yüklemesi').toBe(1);

    net.phase('kırık wide');
    await navigateInApp(page, '/genel');
    const main = page.locator(ADMIN_MAIN);
    const notice = main.getByRole('status').filter({ hasText: 'Yeni sürüm var' });
    await expect(notice, 'geniş görünüm için sürüm kayması bildirimi').toBeVisible({ timeout: 15_000 });
    await expect(notice.getByRole('button', { name: 'Yenile', exact: true })).toBeVisible();
    await expect(main.getByRole('heading', { level: 1 })).toHaveText('Genel durum');
    await expect(main.getByRole('heading', { level: 2 }).first(), 'telefon (temel) sunumu kullanılabilir kalır').toBeVisible();
    expect(await documentLoads(page), 'wide parça hatası sayfayı kendiliğinden yenilemez').toBe(1);
    expect(net.records.filter(record => wideFiles.has(distPath(record.url, base) ?? '')).length, 'wide parçası istendi (404)').toBeGreaterThan(0);

    net.phase('geri');
    await navigateInApp(page, '/veri');
    const status = main.locator('[role="status"][data-state]').first();
    await expect(status, 'içe aktarılan nesil korunur').toHaveAttribute('data-state', 'fresh');
    await expect(status).toContainText(`Nesil ${id.slice(0, 6)}`);
    expect(await documentLoads(page)).toBe(1);
    await report(page, testInfo, net, 'parca-hatasi-genis', base, index);
  });

  // İnceleme bulgusu (minor): ana uygulamanın SW'si (kapsam /aile/) admin sekmesini de denetler; çalışma zamanı önbelleği
  // (CacheFirst, 30 giriş) yönetim parçalarını da yazıp ana uygulamanın ziyaret edilmiş tembel modüllerini çıkarıyordu.
  test('SW denetimindeki admin sekmesi çalışma zamanı önbelleğine yönetim dosyası yazmaz; ana uygulama tembel modülü yazılır', { tag: '@matrix' }, async ({ page, context }, testInfo) => {
    const build = loadBuild();
    const index = deliveryIndex(build);
    const base = baseOf(testInfo);
    const { manifest } = build;
    const mainRoots = Object.keys(manifest).filter(key => manifest[key].isEntry && key !== ADMIN_ENTRY);
    const mainReach = filesOf(manifest, reach(manifest, mainRoots, true));
    const adminOnly = new Set([...filesOf(manifest, reach(manifest, [ADMIN_ENTRY], true))].filter(file => !mainReach.has(file) && /\.(?:js|css)$/.test(file)));
    const precache = new Set(parsePrecache(readFileSync(path.join(DIST, 'sw.js'), 'utf8')));
    const mainLazy = [...mainReach].filter(file => file.endsWith('.js') && !precache.has(file));
    expect(adminOnly.size, 'yönetime ait dosyalar').toBeGreaterThan(20);
    expect(mainLazy.length, 'ana uygulamanın ön bellekte olmayan tembel parçası').toBeGreaterThan(0);
    await isolateNetwork(context, testInfo);
    const net = recordNetwork(context);
    // Ana uygulama service worker'ı kurar (registerType autoUpdate: skipWaiting + clientsClaim).
    await page.goto(base.href);
    const workerState = await page.evaluate(() => Promise.race([
      navigator.serviceWorker.ready.then(registration => registration.active?.state ?? 'none'),
      new Promise<string>(resolve => setTimeout(() => resolve('timeout'), 15_000)),
    ]));
    expect(workerState, 'service worker kurulmalı').toMatch(/^activat/);
    net.phase('admin');
    await openAdmin(page, '/genel');
    expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)), 'önkoşul: admin sekmesi SW denetiminde').toBe(true);
    await navigateInApp(page, '/alimlar');
    await navigateInApp(page, '/raporlar');
    await net.settle();
    expect(classRequests(net.records, base, index, ['wide'], ['admin']).length, 'önkoşul: admin geniş parçaları istendi').toBeGreaterThan(0);
    // Pozitif kontrol: ana uygulamanın tembel parçası (modulepreload, hedef script) çalışma zamanı önbelleğine yazılır.
    const lazyUrl = new URL(mainLazy.sort()[0], base).href;
    await page.evaluate(href => new Promise<void>((resolve, reject) => {
      const link = Object.assign(document.createElement('link'), { rel: 'modulepreload', href });
      link.onload = () => resolve();
      link.onerror = () => reject(new Error(`modulepreload ${href}`));
      document.head.append(link);
    }), lazyUrl);
    const cachedUrls = () => page.evaluate(async () => (await (await caches.open('aile-visited-modules')).keys()).map(request => request.url));
    // Önbelleğe yazım yanıttan sonra SW içinde olur: en son istenen ana uygulama parçası görünene dek beklenir; yönetim
    // istekleri ondan önce bitti, yazılacak olsalardı artık önbellekte olurlardı.
    await expect.poll(async () => (await cachedUrls()).includes(lazyUrl), { message: 'ana uygulamanın tembel modülü çalışma zamanı önbelleğine yazılır', timeout: 10_000 }).toBe(true);
    const cached = (await cachedUrls()).map(url => distPath(url, base) ?? url);
    await testInfo.attach('sw-calisma-zamani-onbellegi.json', { body: JSON.stringify({ cached, adminOnly: [...adminOnly].sort() }, null, 2), contentType: 'application/json' });
    await report(page, testInfo, net, 'sw-calisma-zamani-onbellegi', base, index);
    expect(cached.filter(file => adminOnly.has(file)).sort(), 'çalışma zamanı önbelleğindeki yönetim dosyaları').toEqual([]);
  });
});
// #endregion
