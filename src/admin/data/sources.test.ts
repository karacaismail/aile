import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DirectoryFileListSource,
  DirectoryGenerationSource,
  FixtureGenerationSource,
  HttpGenerationSource,
  SourceUnavailableError,
  UnselectedGenerationSource,
  defaultGenerationSource,
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

describe('HttpGenerationSource › iptal ve nesil sabitleme', () => {
  const GEN = 'b'.repeat(64);

  it("generationId verilince ?generation= ile sabitler ve signal'i fetch'e iletir", async () => {
    const fetchImpl = vi.fn(async () => okResponse(roomsText));
    const controller = new AbortController();
    const source = new HttpGenerationSource('/__aile/generation', fetchImpl);
    await source.readText('data/rooms/household/00000.json', { generationId: GEN, signal: controller.signal });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/__aile/generation/data/rooms/household/00000.json?generation=${GEN}`);
    expect(init.signal).toBe(controller.signal);
  });

  it('64 hex olmayan generationId URL\'ye yazılmaz', async () => {
    const fetchImpl = vi.fn(async () => okResponse(roomsText));
    await new HttpGenerationSource('/__aile/generation', fetchImpl).readText('manifest.json', { generationId: '../x' });
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe('/__aile/generation/manifest.json');
  });

  it('iptal edilen istek SourceUnavailableError değil AbortError olarak döner', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
      }),
    );
    const reading = new HttpGenerationSource('/__aile/generation', fetchImpl).readText('manifest.json', { signal: controller.signal });
    controller.abort();
    const error = await reading.catch(e => e);
    expect(error).not.toBeInstanceOf(SourceUnavailableError);
    expect((error as Error).name).toBe('AbortError');
  });
});

// --- FileList (input webkitdirectory) — Safari/WebKit klasör yolu -----------------------------------------
function folderFile(relativePath: string, text: string): File {
  const file = new File([text], relativePath.split('/').pop()!, { type: 'application/json' });
  Object.defineProperty(file, 'webkitRelativePath', { value: relativePath, configurable: true });
  return file;
}

describe('DirectoryFileListSource', () => {
  const files = () => [
    folderFile('nesil-2026-11/manifest.json', manifestText),
    folderFile('nesil-2026-11/data/rooms/household/00000.json', roomsText),
    folderFile('nesil-2026-11/raw/kaynak.json', '{"gizli":true}'),
    folderFile('nesil-2026-11/notlar.txt', 'metin'),
  ];

  it('webkitRelativePath kökünü atar; manifest.json ve data/** okunur, etiket seçilen klasör adıdır', async () => {
    const source = DirectoryFileListSource.fromFiles(files());
    expect(source.kind).toBe('directory');
    expect(source.label).toBe('nesil-2026-11');
    expect(await source.readText('manifest.json')).toBe(manifestText);
    expect(await source.readText('data/rooms/household/00000.json')).toBe(roomsText);
  });

  it('raw/** ve .json dışı dosyalar okunmaz; eksik dosya SourceUnavailableError', async () => {
    const source = DirectoryFileListSource.fromFiles(files());
    for (const path of ['raw/kaynak.json', 'notlar.txt', 'data/rooms/household/00009.json', '../manifest.json']) {
      const error = await source.readText(path).catch(e => e);
      expect(error, path).toBeInstanceOf(SourceUnavailableError);
      expect((error as SourceUnavailableError).source).toBe('directory');
    }
  });

  it('boş seçim ya da kökünde manifest.json olmayan klasör açıklamalı hatayla reddedilir', () => {
    expect(() => DirectoryFileListSource.fromFiles([])).toThrow(SourceUnavailableError);
    expect(() => DirectoryFileListSource.fromFiles(null)).toThrow(SourceUnavailableError);
    const nested = [folderFile('generations/abc/manifest.json', manifestText)];
    const error = (() => {
      try {
        DirectoryFileListSource.fromFiles(nested);
        return null;
      } catch (caught) {
        return caught as Error;
      }
    })();
    expect(error).toBeInstanceOf(SourceUnavailableError);
    expect(error!.message).toContain('manifest.json');
  });

  it('FileList benzeri (length + item) girdiyi kabul eder', async () => {
    const list = files();
    const fileList = { length: list.length, item: (index: number) => list[index] ?? null, [Symbol.iterator]: () => list[Symbol.iterator]() } as unknown as FileList;
    const source = DirectoryFileListSource.fromFiles(fileList);
    expect(await source.readText('manifest.json')).toBe(manifestText);
  });

  it('isSupported: input webkitdirectory özelliği varsa true', () => {
    const proto = HTMLInputElement.prototype as unknown as Record<string, unknown>;
    const had = Object.prototype.hasOwnProperty.call(proto, 'webkitdirectory');
    if (!had) Object.defineProperty(proto, 'webkitdirectory', { value: false, configurable: true, writable: true });
    try {
      expect(DirectoryFileListSource.isSupported()).toBe(true);
    } finally {
      if (!had) delete proto.webkitdirectory;
    }
    if (!had) expect(DirectoryFileListSource.isSupported()).toBe(false);
  });
});

describe('defaultGenerationSource (üretimde dev yolu yok)', () => {
  it('geliştirmede HttpGenerationSource(/__aile/generation) döner', () => {
    const source = defaultGenerationSource({ DEV: true });
    expect(source).toBeInstanceOf(HttpGenerationSource);
    expect(source.label).toBe('/__aile/generation');
  });

  it('üretimde (DEV false) seçilmemiş klasör kaynağı döner: tür klasör, etiket "Klasör seçilmedi"', () => {
    const source = defaultGenerationSource({ DEV: false });
    expect(source).toBeInstanceOf(UnselectedGenerationSource);
    expect(source.kind).toBe('directory');
    expect(source.label).toBe('Klasör seçilmedi');
  });

  it('üretimde VITE_AILE_GENERATION_URL açıkça verilirse o adresten HTTP ile okunur (yerel önizleme)', () => {
    const source = defaultGenerationSource({ DEV: false, VITE_AILE_GENERATION_URL: ' /yerel/nesil/ ' });
    expect(source).toBeInstanceOf(HttpGenerationSource);
    expect(source.label).toBe('/yerel/nesil');
    expect(defaultGenerationSource({ DEV: false, VITE_AILE_GENERATION_URL: '   ' })).toBeInstanceOf(UnselectedGenerationSource);
  });

  it('seçilmemiş kaynak hiçbir ağ isteği atmaz; okuma "Klasörden içe aktar" yönlendirmesiyle reddedilir', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const source = new UnselectedGenerationSource();
      const failure = await source.readText('manifest.json').catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(SourceUnavailableError);
      expect((failure as SourceUnavailableError).source).toBe('directory');
      expect((failure as Error).message).toContain('Nesil klasörü seçilmedi');
      expect((failure as Error).message).toContain('Klasörden içe aktar');
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
