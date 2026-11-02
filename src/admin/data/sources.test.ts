import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DirectoryGenerationSource,
  FixtureGenerationSource,
  HttpGenerationSource,
  SourceUnavailableError,
  type GenerationSource,
} from './sources';

const manifestText = JSON.stringify({ schemaVersion: 1, generation_id: 'a'.repeat(64), tenant_id: 'tenant', files: [], counts: {}, sources: [] });
const roomsText = JSON.stringify({ schemaVersion: 1, collection: 'rooms', records: [] });

// --- FileSystemDirectoryHandle sahtesi (yalnız okuma API'si) ----------------------------------------
type Tree = { [name: string]: string | Tree };

function notFound(name: string): DOMException {
  return new DOMException(`A requested file or directory could not be found: ${name}`, 'NotFoundError');
}

function fakeDirectory(name: string, tree: Tree, calls: string[]): FileSystemDirectoryHandle {
  const handle = {
    kind: 'directory' as const,
    name,
    async getDirectoryHandle(child: string, options?: FileSystemGetDirectoryOptions) {
      calls.push(`dir:${child}:${options?.create ? 'create' : 'read'}`);
      const entry = tree[child];
      if (entry === undefined || typeof entry === 'string') throw notFound(child);
      return fakeDirectory(child, entry, calls);
    },
    async getFileHandle(child: string, options?: FileSystemGetFileOptions) {
      calls.push(`file:${child}:${options?.create ? 'create' : 'read'}`);
      const entry = tree[child];
      if (entry === undefined || typeof entry !== 'string') throw notFound(child);
      return {
        kind: 'file' as const,
        name: child,
        async getFile() {
          return new File([entry], child, { type: 'application/json' });
        },
      } as unknown as FileSystemFileHandle;
    },
    async removeEntry() {
      throw new Error('removeEntry çağrılmamalı');
    },
  };
  return handle as unknown as FileSystemDirectoryHandle;
}

function okResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as unknown as Record<string, unknown>).showDirectoryPicker;
});

describe('GenerationSource ortak arayüz', () => {
  it('üç kaynak da aynı arayüzü sunar: kind, label, readText', async () => {
    const calls: string[] = [];
    const sources: GenerationSource[] = [
      new HttpGenerationSource('/__aile/generation', vi.fn(async () => okResponse(manifestText))),
      new DirectoryGenerationSource(fakeDirectory('nesil-klasoru', { 'manifest.json': manifestText }, calls)),
      new FixtureGenerationSource({ 'manifest.json': manifestText }),
    ];
    expect(sources.map(source => source.kind)).toEqual(['http', 'directory', 'fixture']);
    for (const source of sources) {
      expect(typeof source.label).toBe('string');
      expect(source.label.length).toBeGreaterThan(0);
      expect(await source.readText('manifest.json')).toBe(manifestText);
    }
  });

  it("'..', mutlak yol ve boş yol hiçbir kaynakta okunmaz", async () => {
    const fetchImpl = vi.fn(async () => okResponse(manifestText));
    const calls: string[] = [];
    const sources: GenerationSource[] = [
      new HttpGenerationSource('/__aile/generation', fetchImpl),
      new DirectoryGenerationSource(fakeDirectory('d', { 'manifest.json': manifestText }, calls)),
      new FixtureGenerationSource({ 'manifest.json': manifestText }),
    ];
    for (const source of sources) {
      await expect(source.readText('../manifest.json')).rejects.toBeInstanceOf(SourceUnavailableError);
      await expect(source.readText('/etc/passwd')).rejects.toBeInstanceOf(SourceUnavailableError);
      await expect(source.readText('')).rejects.toBeInstanceOf(SourceUnavailableError);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });
});

describe('FixtureGenerationSource', () => {
  it('verilen metni döndürür, eksik yolda SourceUnavailableError fırlatır', async () => {
    const source = new FixtureGenerationSource({ 'manifest.json': manifestText, 'data/rooms/household/00000.json': roomsText }, 'sentetik');
    expect(source.label).toBe('sentetik');
    expect(await source.readText('data/rooms/household/00000.json')).toBe(roomsText);
    const error = await source.readText('data/rooms/household/00001.json').catch(e => e);
    expect(error).toBeInstanceOf(SourceUnavailableError);
    expect((error as SourceUnavailableError).path).toBe('data/rooms/household/00001.json');
    expect((error as Error).message).toContain('data/rooms/household/00001.json');
  });
});

describe('HttpGenerationSource', () => {
  it('varsayılan taban /__aile/generation ve cache no-store ile okur', async () => {
    const fetchImpl = vi.fn(async () => okResponse(roomsText));
    const source = new HttpGenerationSource(undefined, fetchImpl);
    expect(await source.readText('data/rooms/household/00000.json')).toBe(roomsText);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/__aile/generation/data/rooms/household/00000.json');
    expect(init.cache).toBe('no-store');
    expect(source.label).toContain('/__aile/generation');
  });

  it('taban URL sonundaki / normalize edilir', async () => {
    const fetchImpl = vi.fn(async () => okResponse(manifestText));
    await new HttpGenerationSource('http://127.0.0.1:5173/__aile/generation/', fetchImpl).readText('manifest.json');
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe('http://127.0.0.1:5173/__aile/generation/manifest.json');
  });

  it("404'te sunucunun açıklamasını taşıyan SourceUnavailableError fırlatır", async () => {
    const fetchImpl = vi.fn(async () => okResponse(JSON.stringify({ error: 'AILE_GENERATION_DIR tanımlı değil' }), 404));
    const source = new HttpGenerationSource('/__aile/generation', fetchImpl);
    const error = await source.readText('manifest.json').catch(e => e);
    expect(error).toBeInstanceOf(SourceUnavailableError);
    const unavailable = error as SourceUnavailableError;
    expect(unavailable.status).toBe(404);
    expect(unavailable.path).toBe('manifest.json');
    expect(unavailable.source).toBe('http');
    expect(unavailable.message).toContain('404');
    expect(unavailable.message).toContain('AILE_GENERATION_DIR tanımlı değil');
  });

  it('JSON olmayan hata gövdesi ve ağ hatası da SourceUnavailableError olur', async () => {
    const html = vi.fn(async () => new Response('<html>Not found</html>', { status: 404, headers: { 'content-type': 'text/html' } }));
    const htmlError = await new HttpGenerationSource('/__aile/generation', html).readText('manifest.json').catch(e => e);
    expect(htmlError).toBeInstanceOf(SourceUnavailableError);
    expect((htmlError as SourceUnavailableError).status).toBe(404);

    const failing = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    const networkError = await new HttpGenerationSource('/__aile/generation', failing).readText('manifest.json').catch(e => e);
    expect(networkError).toBeInstanceOf(SourceUnavailableError);
    expect((networkError as SourceUnavailableError).status).toBeUndefined();
    expect((networkError as SourceUnavailableError).cause).toBeInstanceOf(TypeError);
  });
});

describe('DirectoryGenerationSource', () => {
  const tree: Tree = {
    'manifest.json': manifestText,
    data: { rooms: { household: { '00000.json': roomsText } } },
    raw: { 'kaynak.json': '{"gizli":true}' },
  };

  it('manifest.json ve data/** dosyalarını yalnız okuma seçenekleriyle okur; etiket klasör adıdır', async () => {
    const calls: string[] = [];
    const source = new DirectoryGenerationSource(fakeDirectory('nesil-2026-10-28', tree, calls));
    expect(source.label).toBe('nesil-2026-10-28');
    expect(await source.readText('manifest.json')).toBe(manifestText);
    expect(await source.readText('data/rooms/household/00000.json')).toBe(roomsText);
    expect(calls).toEqual([
      'file:manifest.json:read',
      'dir:data:read',
      'dir:rooms:read',
      'dir:household:read',
      'file:00000.json:read',
    ]);
    expect(calls.some(call => call.endsWith(':create'))).toBe(false);
  });

  it('eksik dosyada NotFoundError SourceUnavailableError olarak sarılır', async () => {
    const source = new DirectoryGenerationSource(fakeDirectory('d', tree, []));
    const error = await source.readText('data/rooms/household/00009.json').catch(e => e);
    expect(error).toBeInstanceOf(SourceUnavailableError);
    expect((error as SourceUnavailableError).path).toBe('data/rooms/household/00009.json');
    expect((error as SourceUnavailableError).source).toBe('directory');
    expect((error as SourceUnavailableError).cause).toBeInstanceOf(DOMException);
  });

  it('manifest.json ve data/** dışındaki yollar (ör. raw/**) okunmaz', async () => {
    const calls: string[] = [];
    const source = new DirectoryGenerationSource(fakeDirectory('d', tree, calls));
    await expect(source.readText('raw/kaynak.json')).rejects.toBeInstanceOf(SourceUnavailableError);
    await expect(source.readText('data/rooms/household/00000.txt')).rejects.toBeInstanceOf(SourceUnavailableError);
    expect(calls).toEqual([]);
  });

  it('showDirectoryPicker yoksa desteklenmez ve pick() açıklamalı hata verir', async () => {
    expect(DirectoryGenerationSource.isSupported()).toBe(false);
    const error = await DirectoryGenerationSource.pick().catch(e => e);
    expect(error).toBeInstanceOf(SourceUnavailableError);
    expect((error as Error).message).toContain('klasör');
  });

  it('showDirectoryPicker varsa salt okunur modda açar ve kaynağı döndürür', async () => {
    const calls: string[] = [];
    const picker = vi.fn(async () => fakeDirectory('secilen', tree, calls));
    (window as unknown as Record<string, unknown>).showDirectoryPicker = picker;
    expect(DirectoryGenerationSource.isSupported()).toBe(true);
    const source = await DirectoryGenerationSource.pick();
    expect(source.kind).toBe('directory');
    expect(source.label).toBe('secilen');
    expect(picker).toHaveBeenCalledWith(expect.objectContaining({ mode: 'read' }));
    expect(await source.readText('manifest.json')).toBe(manifestText);
  });

  it('kullanıcı seçimi iptal ederse AbortError SourceUnavailableError olur', async () => {
    (window as unknown as Record<string, unknown>).showDirectoryPicker = vi.fn(async () => {
      throw new DOMException('The user aborted a request.', 'AbortError');
    });
    const error = await DirectoryGenerationSource.pick().catch(e => e);
    expect(error).toBeInstanceOf(SourceUnavailableError);
    expect((error as SourceUnavailableError).cause).toBeInstanceOf(DOMException);
  });
});
