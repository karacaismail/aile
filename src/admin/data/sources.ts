// Nesil kaynakları: panel doğrulanmış JSON neslini (manifest.json + data/**) üç yoldan okur ve hepsi aynı
// GenerationSource arayüzünü sunar. Saf TS; React/antd yok. Yalnız okuma: hiçbir kaynak yazma/silme yapmaz.
//   - HttpGenerationSource      → dev'de Vite middleware /__aile/generation/* (src/admin/devServer/privateData.ts)
//   - DirectoryGenerationSource → tarayıcıda klasör içe aktarma (File System Access API, mode:'read')
//   - FixtureGenerationSource   → testler ve sentetik fixture (yol → metin sözlüğü)
// Yol politikası ortaktır: göreli, '..' ve mutlak yol yok. Klasör kaynağı ek olarak yalnız manifest.json ve
// data/**/*.json okur (raw/, schemas/ vb. panelin işi değildir).

export type GenerationSourceKind = 'http' | 'directory' | 'fixture';

export interface GenerationSource {
  readonly kind: GenerationSourceKind;
  /** Kullanıcıya gösterilecek kısa ad (URL tabanı, klasör adı, fixture adı). */
  readonly label: string;
  /** Nesil kökünden göreli yolun ham metnini döndürür; bulunamazsa SourceUnavailableError. */
  readText(path: string): Promise<string>;
}

export interface SourceUnavailableInit {
  source: GenerationSourceKind;
  path: string;
  /** HTTP durum kodu; ağ hatası veya HTTP dışı kaynakta yok. */
  status?: number;
  cause?: unknown;
}

/** Kaynak okunamadı: 404/ağ hatası, eksik dosya, reddedilen yol veya desteklenmeyen tarayıcı. */
export class SourceUnavailableError extends Error {
  readonly source: GenerationSourceKind;
  readonly path: string;
  readonly status?: number;

  constructor(message: string, init: SourceUnavailableInit) {
    super(message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = 'SourceUnavailableError';
    this.source = init.source;
    this.path = init.path;
    if (init.status !== undefined) this.status = init.status;
  }
}

// --- Yol politikası ---------------------------------------------------------------------------------

/** Göreli, bölütleri dolu, '.'/'..' ve ters bölü içermeyen yol; aksi hâlde null. */
function safeSegments(path: string): string[] | null {
  if (typeof path !== 'string' || path.length === 0) return null;
  if (path.startsWith('/') || path.includes('\\') || /^[a-z][a-z0-9+.-]*:/i.test(path)) return null;
  const segments = path.split('/');
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') return null;
  }
  return segments;
}

function rejectPath(source: GenerationSourceKind, path: string): SourceUnavailableError {
  return new SourceUnavailableError(`Nesil yolu reddedildi (göreli ve '..' içermeyen yol gerekir): ${path}`, { source, path });
}

/** Klasör kaynağının izin verdiği yollar: manifest.json ve data/**\/*.json. */
function isPanelReadablePath(segments: string[]): boolean {
  if (segments.length === 1) return segments[0] === 'manifest.json';
  return segments[0] === 'data' && segments.length >= 3 && segments[segments.length - 1].endsWith('.json');
}

// --- HTTP ---------------------------------------------------------------------------------------------

export const DEFAULT_GENERATION_BASE_URL = '/__aile/generation';

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Sunucunun açıklayıcı gövdesini ({error:'…'}) metne çevirir; JSON değilse kısa ham metin. */
async function describeFailure(response: Response): Promise<string> {
  let body = '';
  try {
    body = await response.text();
  } catch {
    return response.statusText;
  }
  try {
    const parsed = JSON.parse(body) as unknown;
    if (parsed && typeof parsed === 'object' && typeof (parsed as { error?: unknown }).error === 'string') {
      return (parsed as { error: string }).error;
    }
  } catch {
    // JSON değil; aşağıda ham metin kullanılır.
  }
  const trimmed = body.replace(/\s+/g, ' ').trim();
  return trimmed.length > 0 ? trimmed.slice(0, 200) : response.statusText;
}

export class HttpGenerationSource implements GenerationSource {
  readonly kind = 'http' as const;
  readonly label: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike | undefined;

  constructor(baseUrl: string = DEFAULT_GENERATION_BASE_URL, fetchImpl?: FetchLike) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.fetchImpl = fetchImpl;
    this.label = this.baseUrl;
  }

  async readText(path: string): Promise<string> {
    const segments = safeSegments(path);
    if (!segments) throw rejectPath(this.kind, path);
    const fetchImpl = this.fetchImpl ?? (typeof fetch === 'function' ? (fetch as FetchLike) : undefined);
    if (!fetchImpl) {
      throw new SourceUnavailableError('Bu ortamda fetch yok; nesil HTTP üzerinden okunamaz', { source: this.kind, path });
    }
    const url = `${this.baseUrl}/${segments.map(encodeURIComponent).join('/')}`;
    let response: Response;
    try {
      response = await fetchImpl(url, { method: 'GET', cache: 'no-store', credentials: 'same-origin', headers: { accept: 'application/json' } });
    } catch (cause) {
      throw new SourceUnavailableError(`Nesil kaynağına ulaşılamadı (${this.baseUrl}): ${path}`, { source: this.kind, path, cause });
    }
    if (!response.ok) {
      const detail = await describeFailure(response);
      const explanation = detail ? `: ${detail}` : '';
      throw new SourceUnavailableError(`Nesil kaynağı ${response.status} döndürdü (${path})${explanation}`, {
        source: this.kind,
        path,
        status: response.status,
      });
    }
    return response.text();
  }
}

// --- Klasör (File System Access API) --------------------------------------------------------------------

interface DirectoryPickerOptions { id?: string; mode?: 'read' | 'readwrite'; startIn?: unknown }
type DirectoryPicker = (options?: DirectoryPickerOptions) => Promise<FileSystemDirectoryHandle>;

function directoryPicker(): DirectoryPicker | undefined {
  if (typeof window === 'undefined') return undefined;
  const candidate = (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker;
  return typeof candidate === 'function' ? (candidate as DirectoryPicker) : undefined;
}

export class DirectoryGenerationSource implements GenerationSource {
  readonly kind = 'directory' as const;
  readonly label: string;
  private readonly root: FileSystemDirectoryHandle;

  constructor(handle: FileSystemDirectoryHandle) {
    this.root = handle;
    this.label = handle.name || 'Seçilen klasör';
  }

  /** Tarayıcı window.showDirectoryPicker sunuyor mu (Chromium ailesi; Safari/Firefox'ta yok). */
  static isSupported(): boolean {
    return directoryPicker() !== undefined;
  }

  /** Kullanıcıdan salt okunur klasör seçimi ister; desteklenmiyorsa veya iptal edilirse SourceUnavailableError. */
  static async pick(): Promise<DirectoryGenerationSource> {
    const picker = directoryPicker();
    if (!picker) {
      throw new SourceUnavailableError('Bu tarayıcı klasör içe aktarmayı desteklemiyor (showDirectoryPicker yok)', {
        source: 'directory',
        path: '',
      });
    }
    try {
      const handle = await picker({ id: 'aile-generation', mode: 'read' });
      return new DirectoryGenerationSource(handle);
    } catch (cause) {
      const aborted = cause instanceof DOMException && cause.name === 'AbortError';
      throw new SourceUnavailableError(aborted ? 'Klasör seçimi iptal edildi' : 'Klasör seçilemedi', { source: 'directory', path: '', cause });
    }
  }

  async readText(path: string): Promise<string> {
    const segments = safeSegments(path);
    if (!segments) throw rejectPath(this.kind, path);
    if (!isPanelReadablePath(segments)) {
      throw new SourceUnavailableError(`Klasör kaynağı yalnız manifest.json ve data/**/*.json okur: ${path}`, { source: this.kind, path });
    }
    try {
      let directory = this.root;
      for (const segment of segments.slice(0, -1)) {
        directory = await directory.getDirectoryHandle(segment);
      }
      const fileHandle = await directory.getFileHandle(segments[segments.length - 1]);
      const file = await fileHandle.getFile();
      return await file.text();
    } catch (cause) {
      throw new SourceUnavailableError(`Klasörde dosya okunamadı (${this.label}): ${path}`, { source: this.kind, path, cause });
    }
  }
}

// --- Fixture --------------------------------------------------------------------------------------------

export class FixtureGenerationSource implements GenerationSource {
  readonly kind = 'fixture' as const;
  readonly label: string;
  private readonly files: ReadonlyMap<string, string>;

  constructor(files: Record<string, string>, label = 'fixture') {
    this.files = new Map(Object.entries(files));
    this.label = label;
  }

  async readText(path: string): Promise<string> {
    const segments = safeSegments(path);
    if (!segments) throw rejectPath(this.kind, path);
    const text = this.files.get(segments.join('/'));
    if (text === undefined) {
      throw new SourceUnavailableError(`Fixture'da dosya yok (${this.label}): ${path}`, { source: this.kind, path });
    }
    return text;
  }
}
