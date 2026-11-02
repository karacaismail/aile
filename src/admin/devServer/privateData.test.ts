// Vite dev middleware: AILE_GENERATION_DIR altındaki en yeni geçerli nesli salt okunur servis eder: yalnız manifest.json,
// data/**/*.json parçaları ve _meta; yalnız aynı kökenden (başka localhost kökeni 403). AILE_GENERATION_DIR yalnız süreç
// ortamından okunur (.env / .env.local okunmaz). Yalnız `serve` aşamasında çalışır; build çıktısına hiçbir şey eklemez.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, utimes, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createPrivateDataHandler, privateDataPlugin, selectGeneration } from './privateData';

interface Response { status: number; headers: Headers; body: string }

let server: Server;
let baseUrl: string;
let env: { AILE_GENERATION_DIR?: string } = {};
let scratch: string;

// fetch yol normalizasyonu yapar ('..' istemcide çözülür); ham yolun sunucuya ulaşması için node:http kullanılır.
function request(method: string, pathname: string, headers: Record<string, string> = {}): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(`${baseUrl}`, { method, path: pathname, headers }, res => {
      const chunks: Buffer[] = [];
      res.on('data', chunk => chunks.push(chunk as Buffer));
      res.on('end', () => {
        const headers = new Headers();
        for (const [name, value] of Object.entries(res.headers)) if (typeof value === 'string') headers.set(name, value);
        resolve({ status: res.statusCode ?? 0, headers, body: Buffer.concat(chunks).toString('utf8') });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function writeGeneration(root: string, name: string, manifest: Record<string, unknown>, ageSeconds: number) {
  const directory = path.join(root, name);
  await mkdir(path.join(directory, 'data', 'rooms', 'household'), { recursive: true });
  await writeFile(path.join(directory, 'manifest.json'), `${JSON.stringify(manifest)}\n`);
  await writeFile(path.join(directory, 'data', 'rooms', 'household', '00000.json'), `${JSON.stringify({ schemaVersion: 1, collection: 'rooms', records: [] })}\n`);
  await writeFile(path.join(directory, 'notes.txt'), 'json degil');
  // Panelin okumadığı nesil dosyaları (ham döküm, şema, sözleşme): sunucu bunları hiç servis etmemeli.
  for (const folder of ['raw', 'schemas', 'contracts']) {
    await mkdir(path.join(directory, folder), { recursive: true });
    await writeFile(path.join(directory, folder, 'dokum.json'), `${JSON.stringify({ ham: 'sentetik gizli hücre' })}\n`);
  }
  await writeFile(path.join(directory, 'data', 'kok.json'), `${JSON.stringify({ ham: true })}\n`);
  const time = new Date(Date.now() - ageSeconds * 1000);
  await utimes(path.join(directory, 'manifest.json'), time, time);
  return directory;
}

beforeAll(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), 'aile-private-data-'));
  const handler = createPrivateDataHandler(() => env);
  server = createServer((req, res) => {
    handler(req, res, () => {
      res.statusCode = 404;
      res.end('fallthrough');
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Sunucu adresi yok');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(() => {
  env = {};
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
  await rm(scratch, { recursive: true, force: true });
});

describe('privateDataPlugin', () => {
  it('yalnız serve aşamasında uygulanır ve adı sabittir', () => {
    const plugin = privateDataPlugin();
    expect(plugin.name).toBe('aile-private-data');
    expect(plugin.apply).toBe('serve');
    expect(typeof plugin.configureServer).toBe('function');
  });
});

describe('GET /__aile/generation/*', () => {
  it('env tanımlı değilse 404 ve açıklayıcı JSON', async () => {
    const response = await request('GET', '/__aile/generation/manifest.json');
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(JSON.parse(response.body)).toEqual({ error: 'AILE_GENERATION_DIR tanımlı değil' });
  });

  it('başka yollar middleware dışına düşer', async () => {
    const response = await request('GET', '/baska/yol.json');
    expect(response.body).toBe('fallthrough');
  });

  it('en yeni manifest.json taşıyan klasörü seçer ve .json dosyalarını no-store servis eder', async () => {
    const root = path.join(scratch, 'secim');
    await writeGeneration(root, 'a'.repeat(64), { schemaVersion: 1, generation_id: 'a'.repeat(64) }, 3600);
    await writeGeneration(root, 'b'.repeat(64), { schemaVersion: 1, generation_id: 'b'.repeat(64) }, 60);
    await mkdir(path.join(root, 'manifestsiz'), { recursive: true });
    env = { AILE_GENERATION_DIR: root };

    const selected = await selectGeneration(root);
    expect(selected?.generationId).toBe('b'.repeat(64));

    const manifest = await request('GET', '/__aile/generation/manifest.json');
    expect(manifest.status).toBe(200);
    expect(manifest.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(manifest.headers.get('cache-control')).toBe('no-store');
    expect(JSON.parse(manifest.body).generation_id).toBe('b'.repeat(64));

    const partition = await request('GET', '/__aile/generation/data/rooms/household/00000.json');
    expect(partition.status).toBe(200);
    expect(JSON.parse(partition.body)).toEqual({ schemaVersion: 1, collection: 'rooms', records: [] });

    const meta = await request('GET', '/__aile/generation/_meta');
    expect(meta.status).toBe(200);
    const body = JSON.parse(meta.body) as Record<string, unknown>;
    expect(body.generation_id).toBe('b'.repeat(64));
    expect(typeof body.selectedAt).toBe('string');
    expect(body).not.toHaveProperty('path');
    expect(JSON.stringify(body)).not.toContain(root);
  });

  it("'..' ve mutlak yol 400 ile reddedilir", async () => {
    const root = path.join(scratch, 'red');
    await writeGeneration(root, 'c'.repeat(64), { schemaVersion: 1, generation_id: 'c'.repeat(64) }, 10);
    env = { AILE_GENERATION_DIR: root };
    for (const pathname of ['/__aile/generation/../manifest.json', '/__aile/generation/data/../../manifest.json', '/__aile/generation/%2e%2e/manifest.json', '/__aile/generation//etc/passwd.json', '/__aile/generation/%2fetc%2fpasswd.json', '/__aile/generation/data/./rooms/household/00000.json']) {
      const response = await request('GET', pathname);
      expect(response.status, pathname).toBe(400);
      expect(JSON.parse(response.body)).toHaveProperty('error');
    }
  });

  it('yalnız .json servis edilir; başka uzantı ve eksik dosya 404', async () => {
    const root = path.join(scratch, 'uzanti');
    await writeGeneration(root, 'd'.repeat(64), { schemaVersion: 1, generation_id: 'd'.repeat(64) }, 10);
    env = { AILE_GENERATION_DIR: root };
    const text = await request('GET', '/__aile/generation/notes.txt');
    expect(text.status).toBe(404);
    expect(JSON.parse(text.body)).toHaveProperty('error');
    const missing = await request('GET', '/__aile/generation/data/yok.json');
    expect(missing.status).toBe(404);
  });

  it('env klasöründe geçerli nesil yoksa 404', async () => {
    const root = path.join(scratch, 'bos');
    await mkdir(root, { recursive: true });
    env = { AILE_GENERATION_DIR: root };
    const response = await request('GET', '/__aile/generation/manifest.json');
    expect(response.status).toBe(404);
    expect(JSON.parse(response.body)).toHaveProperty('error');
  });

  it('POST 405 ve Allow başlığı', async () => {
    env = { AILE_GENERATION_DIR: scratch };
    const response = await request('POST', '/__aile/generation/manifest.json');
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, HEAD');
  });
});

describe('Yalnız panelin okuduğu yollar: manifest.json, data/<koleksiyon>/**/<parça>.json ve _meta', () => {
  it('raw/, schemas/, contracts/ ve data/ kökündeki .json servis edilmez (404, içerik ve yol yazılmaz)', async () => {
    const root = path.join(scratch, 'yollar');
    await writeGeneration(root, '4'.repeat(64), { schemaVersion: 1, generation_id: '4'.repeat(64) }, 10);
    env = { AILE_GENERATION_DIR: root };
    for (const pathname of ['/__aile/generation/raw/dokum.json', '/__aile/generation/schemas/dokum.json', '/__aile/generation/contracts/dokum.json', '/__aile/generation/data/kok.json', '/__aile/generation/baska.json']) {
      const response = await request('GET', pathname);
      expect(response.status, pathname).toBe(404);
      expect(response.body, pathname).not.toContain('sentetik gizli hücre');
      expect(response.body, pathname).not.toContain(root);
      expect(JSON.parse(response.body), pathname).toHaveProperty('error');
    }
    for (const pathname of ['/__aile/generation/manifest.json', '/__aile/generation/data/rooms/household/00000.json', '/__aile/generation/_meta']) {
      expect((await request('GET', pathname)).status, pathname).toBe(200);
    }
  });
});

describe('Yalnız aynı köken (başka localhost uygulaması nesli okuyamaz)', () => {
  async function prepare() {
    const root = path.join(scratch, 'koken');
    await writeGeneration(root, '5'.repeat(64), { schemaVersion: 1, generation_id: '5'.repeat(64) }, 10);
    env = { AILE_GENERATION_DIR: root };
    return new URL(baseUrl).host;
  }

  it('başka kökenin Origin başlığı ya da Sec-Fetch-Site same-site/cross-site → 403, gövdede veri yok', async () => {
    const host = await prepare();
    const port = host.split(':')[1];
    const cases: Record<string, string>[] = [
      { Origin: `http://localhost:${Number(port) + 1}` },
      { Origin: `http://127.0.0.1:${Number(port) + 1}` },
      { Origin: 'http://evil.test' },
      { Origin: 'null' },
      { 'Sec-Fetch-Site': 'same-site' },
      { 'Sec-Fetch-Site': 'cross-site' },
      { 'Sec-Fetch-Site': 'same-origin', Origin: `http://localhost:${Number(port) + 1}` },
    ];
    for (const headers of cases) {
      for (const pathname of ['/__aile/generation/manifest.json', '/__aile/generation/_meta', '/__aile/generation/data/rooms/household/00000.json']) {
        const response = await request('GET', pathname, headers);
        expect(response.status, `${pathname} ${JSON.stringify(headers)}`).toBe(403);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(JSON.parse(response.body)).toEqual({ error: 'Yalnız aynı kökenden okunur' });
      }
    }
  });

  it('aynı köken (Origin = Host), Sec-Fetch-Site same-origin/none ve başlıksız istek (curl) okunur', async () => {
    const host = await prepare();
    const cases: Record<string, string>[] = [
      {},
      { 'Sec-Fetch-Site': 'same-origin' },
      { 'Sec-Fetch-Site': 'none' },
      { Origin: `http://${host}`, 'Sec-Fetch-Site': 'same-origin' },
    ];
    for (const headers of cases) {
      const response = await request('GET', '/__aile/generation/manifest.json', headers);
      expect(response.status, JSON.stringify(headers)).toBe(200);
      expect(JSON.parse(response.body).generation_id).toBe('5'.repeat(64));
    }
  });
});

describe('Yanıtlarda yol bilgisi yok', () => {
  it('beklenmeyen sunucu hatası (500) mutlak yolu veya hata ayrıntısını yanıta yazmaz', async () => {
    const secret = path.join(scratch, 'gizli-kok', 'nesil');
    env = new Proxy({} as { AILE_GENERATION_DIR?: string }, {
      get() {
        throw new Error(`EACCES: permission denied, open '${secret}/manifest.json'`);
      },
    });
    const response = await request('GET', '/__aile/generation/manifest.json');
    expect(response.status).toBe(500);
    expect(response.headers.get('content-type')).toContain('application/json');
    const body = JSON.parse(response.body) as { error: string };
    expect(body.error).toMatch(/^Hata: /);
    expect(response.body).not.toContain(scratch);
    expect(response.body).not.toContain('gizli-kok');
    expect(response.body).not.toMatch(/\/(Users|home|private|tmp|var)\//);
  });
});

describe('?generation= ile nesil sabitleme', () => {
  async function twoGenerations(name: string) {
    const root = path.join(scratch, name);
    const oldId = 'e'.repeat(64);
    const newId = 'f'.repeat(64);
    const oldDir = await writeGeneration(root, oldId, { schemaVersion: 1, generation_id: oldId }, 3600);
    await writeGeneration(root, newId, { schemaVersion: 1, generation_id: newId }, 60);
    await writeFile(path.join(oldDir, 'data', 'rooms', 'household', '00000.json'), `${JSON.stringify({ schemaVersion: 1, collection: 'rooms', records: [], eski: true })}\n`);
    env = { AILE_GENERATION_DIR: root };
    return { root, oldId, newId };
  }

  it('istenen nesil diskte durdukça daha yeni nesil olsa da ondan servis edilir', async () => {
    const { oldId, newId } = await twoGenerations('sabit');
    const latest = await request('GET', '/__aile/generation/data/rooms/household/00000.json');
    expect(JSON.parse(latest.body)).not.toHaveProperty('eski');
    const pinned = await request('GET', `/__aile/generation/data/rooms/household/00000.json?generation=${oldId}`);
    expect(pinned.status).toBe(200);
    expect(JSON.parse(pinned.body)).toHaveProperty('eski', true);
    const manifest = await request('GET', `/__aile/generation/manifest.json?generation=${newId}`);
    expect(JSON.parse(manifest.body).generation_id).toBe(newId);
  });

  it('diskte olmayan nesil 410 döner ve yol yazmaz; biçimi bozuk kimlik 400', async () => {
    const { root } = await twoGenerations('yok');
    const gone = await request('GET', `/__aile/generation/data/rooms/household/00000.json?generation=${'0'.repeat(64)}`);
    expect(gone.status).toBe(410);
    expect(JSON.parse(gone.body)).toHaveProperty('error');
    expect(gone.body).not.toContain(root);
    const bad = await request('GET', '/__aile/generation/manifest.json?generation=..%2F..');
    expect(bad.status).toBe(400);
  });
});

describe('privateDataPlugin › AILE_GENERATION_DIR yalnız süreç ortamından (.env / .env.local okunmaz)', () => {
  type Middleware = (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, next: () => void) => void;

  /** Eklentiyi Vite'sız çalıştırır: (varsa) configResolved → configureServer, yakalanan ara katmanı geçici sunucuda dinler. */
  async function servePlugin(envDir: string | false, mode = 'development') {
    const plugin = privateDataPlugin();
    const configResolved = plugin.configResolved as unknown as ((config: { mode: string; envDir: string | false }) => void) | undefined;
    const configureServer = plugin.configureServer as unknown as (server: { middlewares: { use(handler: Middleware): void } }) => void;
    configResolved?.({ mode, envDir });
    let middleware: Middleware | null = null;
    configureServer({ middlewares: { use: handler => { middleware = handler; } } });
    if (!middleware) throw new Error('ara katman kaydedilmedi');
    const handler: Middleware = middleware;
    const local = createServer((req, res) => handler(req, res, () => { res.statusCode = 404; res.end('fallthrough'); }));
    await new Promise<void>(resolve => local.listen(0, '127.0.0.1', resolve));
    const address = local.address();
    if (!address || typeof address === 'string') throw new Error('Sunucu adresi yok');
    const get = (pathname: string) =>
      new Promise<{ status: number; body: string }>((resolve, reject) => {
        const req = httpRequest(`http://127.0.0.1:${address.port}`, { method: 'GET', path: pathname }, res => {
          const chunks: Buffer[] = [];
          res.on('data', chunk => chunks.push(chunk as Buffer));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
        });
        req.on('error', reject);
        req.end();
      });
    const close = () => new Promise<void>((resolve, reject) => local.close(error => (error ? reject(error) : resolve())));
    return { get, close };
  }

  const saved = process.env.AILE_GENERATION_DIR;
  afterEach(() => {
    if (saved === undefined) delete process.env.AILE_GENERATION_DIR;
    else process.env.AILE_GENERATION_DIR = saved;
  });

  it("process.env'de AILE_GENERATION_DIR yoksa envDir/.env.local'daki değer OKUNMAZ: 404 \"tanımlı değil\", yol yazılmaz", async () => {
    delete process.env.AILE_GENERATION_DIR;
    const root = path.join(scratch, 'env-local-kok');
    const id = '1'.repeat(64);
    await writeGeneration(root, id, { schemaVersion: 1, generation_id: id }, 60);
    const envDir = path.join(scratch, 'env-local-dizin');
    await mkdir(envDir, { recursive: true });
    await writeFile(path.join(envDir, '.env.local'), `AILE_GENERATION_DIR=${root}\nVITE_BASKA=1\n`);
    await writeFile(path.join(envDir, '.env'), `AILE_GENERATION_DIR=${root}\n`);
    await writeFile(path.join(envDir, '.env.development.local'), `AILE_GENERATION_DIR=${root}\n`);
    const served = await servePlugin(envDir);
    try {
      const meta = await served.get('/__aile/generation/_meta');
      expect(meta.status).toBe(404);
      expect(JSON.parse(meta.body)).toEqual({ error: 'AILE_GENERATION_DIR tanımlı değil' });
      expect(meta.body).not.toContain(root);
      expect(meta.body).not.toContain(id);
    } finally {
      await served.close();
    }
  });

  it('süreç ortamındaki değer (açık komut: AILE_GENERATION_DIR=… vite) okunur; .env.local onu değiştirmez', async () => {
    const fileRoot = path.join(scratch, 'env-dosya-kok');
    const fileId = '2'.repeat(64);
    await writeGeneration(fileRoot, fileId, { schemaVersion: 1, generation_id: fileId }, 60);
    const processRoot = path.join(scratch, 'env-surec-kok');
    const processId = '3'.repeat(64);
    await writeGeneration(processRoot, processId, { schemaVersion: 1, generation_id: processId }, 60);
    const envDir = path.join(scratch, 'env-oncelik-dizin');
    await mkdir(envDir, { recursive: true });
    await writeFile(path.join(envDir, '.env.local'), `AILE_GENERATION_DIR=${fileRoot}\n`);
    process.env.AILE_GENERATION_DIR = processRoot;
    const served = await servePlugin(envDir);
    try {
      expect(JSON.parse((await served.get('/__aile/generation/_meta')).body).generation_id).toBe(processId);
    } finally {
      await served.close();
    }
  });

  it('envDir false ya da .env dosyası yoksa ve process.env boşsa 404 "tanımlı değil"', async () => {
    delete process.env.AILE_GENERATION_DIR;
    for (const envDir of [false, path.join(scratch, 'olmayan-env-dizini')] as const) {
      const served = await servePlugin(envDir);
      try {
        const response = await served.get('/__aile/generation/_meta');
        expect(response.status, String(envDir)).toBe(404);
        expect(JSON.parse(response.body).error).toContain('tanımlı değil');
      } finally {
        await served.close();
      }
    }
  });

  it("kaynak kapısı: eklenti loadEnv/.env okumaz (gizlilik belgeleri ve runbook'la tutarlı)", async () => {
    const source = await readFile(path.join(__dirname, 'privateData.ts'), 'utf8');
    expect(source).not.toMatch(/\bloadEnv\b/);
    expect(source).not.toMatch(/\.env\.local['"`]/);
  });
});
