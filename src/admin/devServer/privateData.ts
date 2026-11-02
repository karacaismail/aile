// Vite dev middleware: AILE_GENERATION_DIR altındaki en yeni geçerli nesli (manifest.json taşıyan klasör) salt
// okunur servis eder. Yalnız `serve` aşamasında çalışır; build çıktısına hiçbir dosya veya kod eklemez. Gerçek nesil
// Git dışındadır; yol bilgisi hiçbir yanıta yazılmaz.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';

export const PRIVATE_DATA_PREFIX = '/__aile/generation';
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

/** Kökün kendisi, doğrudan alt klasörleri ve `generations/` altı adaydır; en yeni manifest.json kazanır. */
export async function selectGeneration(configuredRoot: string): Promise<SelectedGeneration | null> {
  let root: string;
  try {
    root = await realpath(configuredRoot);
  } catch {
    return null;
  }
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
  let best: { directory: string; mtime: number } | null = null;
  for (const directory of candidates) {
    const mtime = await manifestMtime(directory);
    if (mtime !== null && (best === null || mtime > best.mtime)) best = { directory, mtime };
  }
  if (!best) return null;
  let generationId: string | null = null;
  try {
    const manifest = JSON.parse(await readFile(path.join(best.directory, 'manifest.json'), 'utf8')) as { generation_id?: unknown };
    if (typeof manifest.generation_id === 'string' && generationName.test(manifest.generation_id)) generationId = manifest.generation_id;
  } catch {
    return null;
  }
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

/** Connect tarzı middleware; `env` okuyucusu testte enjekte edilir, üretimde process.env'dir. */
export function createPrivateDataHandler(readEnv: () => { AILE_GENERATION_DIR?: string } = () => process.env): Handler {
  return (req, res, next) => {
    // Ham yol: WHATWG URL '..' ve '//' parçalarını çözerdi; buradaki kaçış denemeleri 400 ile görünür kalmalı.
    const pathname = (req.url ?? '/').split(/[?#]/, 1)[0];
    if (pathname !== PRIVATE_DATA_PREFIX && !pathname.startsWith(`${PRIVATE_DATA_PREFIX}/`)) {
      next();
      return;
    }
    void handle(pathname, req, res, readEnv).catch(error => {
      sendJson(res, 500, { error: `Hata: ${error instanceof Error ? error.message : 'bilinmeyen'}` });
    });
  };
}

async function handle(pathname: string, req: IncomingMessage, res: ServerResponse, readEnv: () => { AILE_GENERATION_DIR?: string }) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { error: 'Yalnız GET ve HEAD' }, { Allow: 'GET, HEAD' });
    return;
  }
  const rest = pathname.slice(PRIVATE_DATA_PREFIX.length).replace(/^\//, '');
  const relative = relativeGenerationPath(rest);
  if (relative === null) {
    sendJson(res, 400, { error: 'Geçersiz yol' });
    return;
  }
  if (relative !== '_meta' && !relative.endsWith('.json')) {
    sendJson(res, 404, { error: 'Yalnız .json dosyaları servis edilir' });
    return;
  }
  const configured = readEnv().AILE_GENERATION_DIR?.trim();
  if (!configured) {
    sendJson(res, 404, { error: 'AILE_GENERATION_DIR tanımlı değil' });
    return;
  }
  const selected = await selectGeneration(configured);
  if (!selected) {
    sendJson(res, 404, { error: 'AILE_GENERATION_DIR altında manifest.json taşıyan geçerli nesil yok' });
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

export function privateDataPlugin(): Plugin {
  return {
    name: 'aile-private-data',
    apply: 'serve',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(createPrivateDataHandler());
    },
  };
}
