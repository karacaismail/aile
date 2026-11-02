// Vite dev middleware: AILE_GENERATION_DIR altındaki en yeni geçerli nesli salt okunur, yalnız .json servis eder.
// Yalnız `serve` aşamasında çalışır; build çıktısına hiçbir şey eklemez.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { mkdtemp, mkdir, writeFile, utimes, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createPrivateDataHandler, privateDataPlugin, selectGeneration } from './privateData';

interface Response { status: number; headers: Headers; body: string }

let server: Server;
let baseUrl: string;
let env: { AILE_GENERATION_DIR?: string } = {};
let scratch: string;

// fetch yol normalizasyonu yapar ('..' istemcide çözülür); ham yolun sunucuya ulaşması için node:http kullanılır.
function request(method: string, pathname: string): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(`${baseUrl}`, { method, path: pathname }, res => {
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
