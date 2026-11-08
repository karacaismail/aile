// Vite dev middleware: AILE_GENERATION_DIR altındaki en yeni geçerli nesli (manifest.json taşıyan klasör) salt
// okunur servis eder. Yalnız `serve` aşamasında çalışır; build çıktısına hiçbir dosya veya kod eklemez. Gerçek nesil
// Git dışındadır; yol bilgisi (ne mutlak yol ne de dosya sistemi hata ayrıntısı) hiçbir yanıta yazılmaz.
// ?generation=<sha256> verilirse o nesil (diskte durdukça) servis edilir: panel parçaları tembel okur ve manifestten
// sonra yeni nesil üretilse de aynı nesilden okumayı sürdürür; nesil kalktıysa 410 döner (panel yeniler).
//
// Gizlilik sınırları:
//   - AILE_GENERATION_DIR YALNIZ süreç ortamından okunur; .env / .env.local dosyaları okunmaz. Düz `pnpm dev` gerçek
//     nesli göremez; gerçek veriyle önizleme açık komutla başlar (docs/ADMIN-RUNBOOK.md §4).
//   - Yalnız panelin okuduğu yollar: manifest.json, data/<koleksiyon>/…/<parça>.json ve _meta. raw/, schemas/,
//     contracts/ gibi nesil dosyaları servis edilmez (klasör kaynağının yol kuralıyla aynı: data/sources.ts).
//   - Yalnız aynı köken: Origin başlığı sunucunun kendi kökeni (Host) değilse ya da Sec-Fetch-Site same-origin/none
//     değilse 403. Vite'nin varsayılan CORS'u başka localhost portlarına izin verse de nesil onlara okunmaz. Başlıksız
//     istek (curl, Node) tarayıcı kökeni taşımadığından okunur.
//
// Emeklilik profili (/__aile/emeklilik/profil.json): yalnız AILE_EMEKLILIK_PROFILE (süreç ortamı) değişkeninin gösterdiği
// Git dışı .json dosyası salt okunur servis edilir; aynı köken ve GET/HEAD kuralları nesil yoluyla aynıdır. Başka yol
// servis edilmez; dosya JSON değilse içerik yazılmadan 422 döner. Yanıtlar dosya yolunu ya da hata ayrıntısını taşımaz.
// Profil doğrulaması istemcidedir (src/admin/emeklilik/data). Üretim derlemesinde bu yol yoktur.
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';

export const PRIVATE_DATA_PREFIX = '/__aile/generation';
export const EMEKLILIK_PREFIX = '/__aile/emeklilik';
/** İstemcinin okuduğu tek emeklilik yolu (src/admin/emeklilik/data/yukleyiciler.ts EMEKLILIK_PROFIL_ADRESI). */
export const EMEKLILIK_PROFILE_PATH = `${EMEKLILIK_PREFIX}/profil.json`;

/** Ara katmanın okuduğu süreç ortamı anahtarları. */
export interface PrivateDataEnv {
  AILE_GENERATION_DIR?: string;
  AILE_EMEKLILIK_PROFILE?: string;
}
const generationName = /^[a-f0-9]{64}$/;

export interface SelectedGeneration {
  /** Gerçek (symlink çözülmüş) nesil kökü; yalnız sunucu tarafında kalır. */
  root: string;
  generationId: string;
  selectedAt: string;
}

type Next = (error?: unknown) => void;
type Handler = (req: IncomingMessage, res: ServerResponse, next: Next) => void;

async function manifestMtime(directory: string): Promise<number | null> {
  try {
    const info = await stat(path.join(directory, 'manifest.json'));
    return info.isFile() ? info.mtimeMs : null;
  } catch {
    return null;
  }
}

async function manifestGenerationId(directory: string): Promise<string | null> {
  try {
    const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8')) as { generation_id?: unknown };
    return typeof manifest.generation_id === 'string' && generationName.test(manifest.generation_id) ? manifest.generation_id : null;
  } catch {
    return null;
  }
}

/** Kökün kendisi, doğrudan alt klasörleri ve `generations/` altı aday nesil klasörleridir. */
async function candidateDirectories(root: string): Promise<string[]> {
  const candidates: string[] = [root];
  for (const parent of [root, path.join(root, 'generations')]) {
    let entries;
    try {
      entries = await readdir(parent, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) if (entry.isDirectory()) candidates.push(path.join(parent, entry.name));
  }
  return candidates;
}

export interface SelectGenerationOptions {
  /** Verilirse yalnız bu generation_id'yi taşıyan nesil seçilir (en yeni olması gerekmez). */
  generationId?: string;
}

/**
 * Aday klasörlerden en yeni manifest.json'u taşıyanı seçer; generationId verilirse manifesti o kimliği taşıyan
 * klasörü (adı kimlikle aynı olan önce denenir). Bulunamazsa null.
 */
export async function selectGeneration(configuredRoot: string, options: SelectGenerationOptions = {}): Promise<SelectedGeneration | null> {
  let root: string;
  try {
    root = await realpath(configuredRoot);
  } catch {
    return null;
  }
  const candidates = await candidateDirectories(root);
  const wanted = options.generationId;
  if (wanted !== undefined) {
    if (!generationName.test(wanted)) return null;
    const ordered = [...candidates.filter(directory => path.basename(directory) === wanted), ...candidates.filter(directory => path.basename(directory) !== wanted)];
    for (const directory of ordered) {
      if ((await manifestMtime(directory)) === null) continue;
      if ((await manifestGenerationId(directory)) === wanted) return { root: directory, generationId: wanted, selectedAt: new Date().toISOString() };
    }
    return null;
  }
  let best: { directory: string; mtime: number } | null = null;
  for (const directory of candidates) {
    const mtime = await manifestMtime(directory);
    if (mtime !== null && (best === null || mtime > best.mtime)) best = { directory, mtime };
  }
  if (!best) return null;
  const generationId = await manifestGenerationId(best.directory);
  if (!generationId) return null;
  return { root: best.directory, generationId, selectedAt: new Date().toISOString() };
}

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
  res.end(`${JSON.stringify(body)}\n`);
}

/** İstek yolunu nesil köküne göre güvenli göreli yola çevirir; '..', mutlak yol, ters bölü ve NUL reddedilir. */
export function relativeGenerationPath(rest: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rest);
  } catch {
    return null;
  }
  if (decoded === '' || decoded.includes('\0') || decoded.includes('\\') || decoded.startsWith('/') || path.isAbsolute(decoded)) return null;
  const segments = decoded.split('/');
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) return null;
  return segments.join('/');
}

/** Panelin okuduğu nesil yolları: manifest.json, _meta ve data/<koleksiyon>/…/<parça>.json (en az üç bölüt). */
function isServedPath(relative: string): boolean {
  if (relative === 'manifest.json' || relative === '_meta') return true;
  const segments = relative.split('/');
  return segments[0] === 'data' && segments.length >= 3 && segments[segments.length - 1]!.endsWith('.json');
}

const SAME_ORIGIN_SITES = new Set(['same-origin', 'none']);

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Tarayıcı isteği bu sunucunun kendi kökeninden mi. Sec-Fetch-Site varsa same-origin ya da none (adres çubuğu) olmalı;
 * Origin varsa (CORS, POST) Host ile aynı http(s) kökeni olmalı ("null" köken reddedilir). İkisi de yoksa (curl, Node)
 * istek tarayıcıdaki başka bir kökenden gelmiyordur.
 */
export function isSameOriginRequest(headers: IncomingHttpHeaders | undefined): boolean {
  const site = headerValue(headers?.['sec-fetch-site'])?.trim().toLowerCase();
  if (site !== undefined && !SAME_ORIGIN_SITES.has(site)) return false;
  const origin = headerValue(headers?.origin)?.trim();
  if (origin === undefined) return true;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  const host = headerValue(headers?.host)?.trim().toLowerCase();
  return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && host !== undefined && parsed.host === host;
}

const underPrefix = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

/** Dosya sistemi hata iletileri mutlak yol taşır (ör. "EACCES: …, open '/…'"); yanıta yalnız hata kodu yazılır. */
function safeErrorCode(error: unknown): string {
  const code = typeof (error as { code?: unknown } | null)?.code === 'string' ? (error as { code: string }).code : null;
  return code && /^[A-Z][A-Z0-9_]{1,31}$/.test(code) ? ` (${code})` : '';
}

/** Connect tarzı middleware; `env` okuyucusu testte enjekte edilir, üretimde process.env'dir. Nesil ve emeklilik yolları. */
export function createPrivateDataHandler(readEnv: () => PrivateDataEnv = () => process.env): Handler {
  return (req, res, next) => {
    // Ham yol: WHATWG URL '..' ve '//' parçalarını çözerdi; buradaki kaçış denemeleri 400 ile görünür kalmalı.
    const pathname = (req.url ?? '/').split(/[?#]/, 1)[0];
    const generation = underPrefix(pathname, PRIVATE_DATA_PREFIX);
    if (!generation && !underPrefix(pathname, EMEKLILIK_PREFIX)) {
      next();
      return;
    }
    const work = generation ? handle(pathname, req, res, readEnv) : handleRetirementProfile(pathname, req, res, readEnv);
    void work.catch(error => {
      const message = generation ? 'nesil dosyası okunamadı' : 'emeklilik profili okunamadı';
      if (!res.headersSent) sendJson(res, 500, { error: `Hata: ${message}${safeErrorCode(error)}` });
      else res.end();
    });
  };
}

/** Ortak ön denetim: aynı köken ve GET/HEAD. Yanıt yazıldıysa false. */
function acceptRead(req: IncomingMessage, res: ServerResponse): boolean {
  // Başka bir kökenden (ör. aynı makinedeki başka localhost uygulaması) gelen tarayıcı isteği hiçbir şey öğrenmez.
  if (!isSameOriginRequest(req.headers)) {
    sendJson(res, 403, { error: 'Yalnız aynı kökenden okunur' });
    return false;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { error: 'Yalnız GET ve HEAD' }, { Allow: 'GET, HEAD' });
    return false;
  }
  return true;
}

/** AILE_EMEKLILIK_PROFILE dosyasını salt okunur verir; yalnız EMEKLILIK_PROFILE_PATH, yalnız .json ve geçerli JSON. */
async function handleRetirementProfile(pathname: string, req: IncomingMessage, res: ServerResponse, readEnv: () => PrivateDataEnv) {
  if (!acceptRead(req, res)) return;
  if (pathname !== EMEKLILIK_PROFILE_PATH) {
    sendJson(res, 404, { error: 'Yalnız profil.json servis edilir' });
    return;
  }
  const configured = readEnv().AILE_EMEKLILIK_PROFILE?.trim();
  if (!configured) {
    sendJson(res, 404, { error: 'AILE_EMEKLILIK_PROFILE tanımlı değil' });
    return;
  }
  if (path.extname(configured).toLowerCase() !== '.json') {
    sendJson(res, 404, { error: 'AILE_EMEKLILIK_PROFILE bir .json dosyası olmalı' });
    return;
  }
  let resolved: string;
  try {
    resolved = await realpath(path.resolve(configured));
  } catch {
    sendJson(res, 404, { error: 'AILE_EMEKLILIK_PROFILE dosyası bulunamadı' });
    return;
  }
  if (!(await stat(resolved)).isFile()) {
    sendJson(res, 404, { error: 'AILE_EMEKLILIK_PROFILE dosyası bulunamadı' });
    return;
  }
  const bytes = await readFile(resolved);
  try {
    JSON.parse(bytes.toString('utf8'));
  } catch {
    sendJson(res, 422, { error: 'Emeklilik profili geçerli JSON değil' });
    return;
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Length', String(bytes.byteLength));
  res.end(req.method === 'HEAD' ? undefined : bytes);
}

/** ?generation= değeri: yoksa undefined, biçimi bozuksa null. */
function requestedGeneration(url: string | undefined): string | null | undefined {
  const query = (url ?? '').split('#', 1)[0]!.split('?').slice(1).join('?');
  if (!query) return undefined;
  const value = new URLSearchParams(query).get('generation');
  if (value === null) return undefined;
  return generationName.test(value) ? value : null;
}

async function handle(pathname: string, req: IncomingMessage, res: ServerResponse, readEnv: () => PrivateDataEnv) {
  if (!acceptRead(req, res)) return;
  const pinned = requestedGeneration(req.url);
  if (pinned === null) {
    sendJson(res, 400, { error: 'Geçersiz nesil kimliği' });
    return;
  }
  const rest = pathname.slice(PRIVATE_DATA_PREFIX.length).replace(/^\//, '');
  const relative = relativeGenerationPath(rest);
  if (relative === null) {
    sendJson(res, 400, { error: 'Geçersiz yol' });
    return;
  }
  if (!isServedPath(relative)) {
    sendJson(res, 404, { error: 'Yalnız manifest.json ve data/** parçaları servis edilir' });
    return;
  }
  const configured = readEnv().AILE_GENERATION_DIR?.trim();
  if (!configured) {
    sendJson(res, 404, { error: 'AILE_GENERATION_DIR tanımlı değil' });
    return;
  }
  const selected = await selectGeneration(configured, pinned === undefined ? {} : { generationId: pinned });
  if (!selected) {
    if (pinned !== undefined) sendJson(res, 410, { error: 'İstenen nesil artık sunucuda yok; yenileyin' });
    else sendJson(res, 404, { error: 'AILE_GENERATION_DIR altında manifest.json taşıyan geçerli nesil yok' });
    return;
  }
  if (relative === '_meta') {
    sendJson(res, 200, { generation_id: selected.generationId, selectedAt: selected.selectedAt });
    return;
  }
  const target = path.resolve(selected.root, relative);
  if (!target.startsWith(`${selected.root}${path.sep}`)) {
    sendJson(res, 400, { error: 'Geçersiz yol' });
    return;
  }
  let resolved: string;
  try {
    resolved = await realpath(target);
  } catch {
    sendJson(res, 404, { error: 'Dosya yok' });
    return;
  }
  if (!resolved.startsWith(`${selected.root}${path.sep}`) || !(await stat(resolved)).isFile()) {
    sendJson(res, 404, { error: 'Dosya yok' });
    return;
  }
  const bytes = await readFile(resolved);
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Length', String(bytes.byteLength));
  res.end(req.method === 'HEAD' ? undefined : bytes);
}

/**
 * Dev eklentisi. AILE_GENERATION_DIR ve AILE_EMEKLILIK_PROFILE yalnız süreç ortamından (process.env) okunur; ortam
 * dosyaları bilinçli olarak okunmaz: yanlışlıkla açılan düz bir dev sunucusu (paralel ajanlar, önizleme) gerçek nesli
 * ya da kişisel profili servis etmez. Değerler yalnız sunucu tarafında kalır; istemciye ve yanıtlara yazılmaz. Tek ara
 * katman iki yolu da karşılar.
 */
export function privateDataPlugin(): Plugin {
  return {
    name: 'aile-private-data',
    apply: 'serve',
    configureServer(server: Pick<ViteDevServer, 'middlewares'>) {
      server.middlewares.use(createPrivateDataHandler());
    },
  };
}
