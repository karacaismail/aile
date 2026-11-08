// Nesil kaynakları: panel doğrulanmış JSON neslini (manifest.json + data/**) dört yoldan okur ve hepsi aynı
// GenerationSource arayüzünü sunar. Saf TS; React/antd yok. Yalnız okuma: hiçbir kaynak yazma/silme yapmaz.
//   - HttpGenerationSource      → dev'de Vite middleware /__aile/generation/* (src/admin/devServer/privateData.ts)
//   - DirectoryGenerationSource → tarayıcıda klasör içe aktarma (File System Access API, mode:'read'; Chromium)
//   - DirectoryFileListSource   → <input type="file" webkitdirectory> dosya listesi (Safari/WebKit dahil)
//   - FixtureGenerationSource   → testler ve sentetik fixture (yol → metin sözlüğü)
// Yol politikası ortaktır: göreli, '..' ve mutlak yol yok. Klasör kaynakları ek olarak yalnız manifest.json ve
// data/**/*.json okur (raw/, schemas/ vb. panelin işi değildir).

export type GenerationSourceKind = 'http' | 'directory' | 'fixture';

/** Okuma seçenekleri; desteklemeyen kaynak yok sayar. */
export interface ReadTextOptions {
  /** İptal: HTTP kaynağı isteği keser ve AbortError ile reddeder. */
  signal?: AbortSignal;
  /** Parçanın ait olduğu nesil (manifest generation_id). HTTP kaynağı ?generation= ile sunucuda sabitler. */
  generationId?: string;
}

export interface GenerationSource {
  readonly kind: GenerationSourceKind;
  /** Kullanıcıya gösterilecek kısa ad (URL tabanı, klasör adı, fixture adı). */
  readonly label: string;
  /** Nesil kökünden göreli yolun ham metnini döndürür; bulunamazsa SourceUnavailableError, iptalde AbortError. */
  readText(path: string, options?: ReadTextOptions): Promise<string>;
}

/** İptal hatası (DOMException AbortError); kaynaklar ve depo aynı biçimi kullanır. */
export function abortError(): Error {
  return new DOMException('Yükleme iptal edildi', 'AbortError');
}

export function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError';
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
const GENERATION_ID = /^[a-f0-9]{64}$/;

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

  async readText(path: string, options: ReadTextOptions = {}): Promise<string> {
    const segments = safeSegments(path);
    if (!segments) throw rejectPath(this.kind, path);
    const { signal, generationId } = options;
    if (signal?.aborted) throw abortError();
    const fetchImpl = this.fetchImpl ?? (typeof fetch === 'function' ? (fetch as FetchLike) : undefined);
    if (!fetchImpl) {
      throw new SourceUnavailableError('Bu ortamda fetch yok; nesil HTTP üzerinden okunamaz', { source: this.kind, path });
    }
    // Nesil sabitleme: tembel parça okuması manifestten sonra yeni nesil üretilse de aynı nesilden servis edilir.
    const pin = generationId && GENERATION_ID.test(generationId) ? `?generation=${generationId}` : '';
    const url = `${this.baseUrl}/${segments.map(encodeURIComponent).join('/')}${pin}`;
    const init: RequestInit = { method: 'GET', cache: 'no-store', credentials: 'same-origin', headers: { accept: 'application/json' } };
    if (signal) init.signal = signal;
    let response: Response;
    try {
      response = await fetchImpl(url, init);
    } catch (cause) {
      if (signal?.aborted || isAbortError(cause)) throw abortError();
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
    try {
      return await response.text();
    } catch (cause) {
      if (signal?.aborted || isAbortError(cause)) throw abortError();
      throw new SourceUnavailableError(`Nesil kaynağından okuma yarıda kaldı (${this.baseUrl}): ${path}`, { source: this.kind, path, cause });
    }
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

// --- Klasör (input webkitdirectory → FileList) -------------------------------------------------------------

/** FileList ya da File dizisi; <input type="file" webkitdirectory> değişiminde input.files. */
export type DirectoryFiles = FileList | ArrayLike<File> | Iterable<File>;

function filesOf(input: DirectoryFiles | null | undefined): File[] {
  if (!input) return [];
  if (typeof (input as Iterable<File>)[Symbol.iterator] === 'function') return Array.from(input as Iterable<File>);
  return Array.from(input as ArrayLike<File>);
}

/**
 * showDirectoryPicker olmayan tarayıcılar (Safari/WebKit, Firefox) için klasör kaynağı. Kullanıcı nesil klasörünü
 * (kökünde manifest.json olan) <input type="file" webkitdirectory> ile seçer; webkitRelativePath'in ilk bölütü seçilen
 * klasör adıdır ve atılır. Yalnız manifest.json ve data/**\/*.json tutulur ve okunur; diğer dosyalara (raw/ vb.)
 * başvuru saklanmaz. Dosya içeriği okunana kadar belleğe alınmaz (File tembeldir).
 */
export class DirectoryFileListSource implements GenerationSource {
  readonly kind = 'directory' as const;
  readonly label: string;
  private readonly files: ReadonlyMap<string, File>;

  private constructor(files: ReadonlyMap<string, File>, label: string) {
    this.files = files;
    this.label = label;
  }

  /** Tarayıcı klasör seçimli dosya girişini (webkitdirectory) sunuyor mu. Chromium, WebKit ve Firefox'ta var. */
  static isSupported(): boolean {
    if (typeof HTMLInputElement === 'undefined') return false;
    return 'webkitdirectory' in HTMLInputElement.prototype;
  }

  /**
   * Seçilen klasörün dosya listesinden kaynak kurar. Boş seçim ya da kökünde manifest.json olmayan klasör
   * SourceUnavailableError verir; böylece yanlış klasör seçimi yayındaki nesli bozmadan reddedilir.
   */
  static fromFiles(input: DirectoryFiles | null | undefined): DirectoryFileListSource {
    const list = filesOf(input);
    if (list.length === 0) {
      throw new SourceUnavailableError('Klasör seçilmedi ya da seçilen klasör boş', { source: 'directory', path: '' });
    }
    const files = new Map<string, File>();
    let root: string | null = null;
    for (const file of list) {
      const relative = (file.webkitRelativePath || file.name || '').split('/');
      // webkitRelativePath "<seçilen klasör>/<göreli yol>"; tek bölütlü ad (klasörsüz seçim) kök dosyasıdır.
      const [head, ...rest] = relative.length > 1 ? relative : ['', ...relative];
      if (root === null) root = head ?? '';
      if (head !== root) continue;
      const segments = safeSegments(rest.join('/'));
      if (!segments || !isPanelReadablePath(segments)) continue;
      files.set(segments.join('/'), file);
    }
    if (!files.has('manifest.json')) {
      throw new SourceUnavailableError('Seçilen klasörün kökünde manifest.json yok; nesil klasörünü seçin', { source: 'directory', path: 'manifest.json' });
    }
    return new DirectoryFileListSource(files, root || 'Seçilen klasör');
  }

  async readText(path: string, options: ReadTextOptions = {}): Promise<string> {
    const segments = safeSegments(path);
    if (!segments) throw rejectPath(this.kind, path);
    if (!isPanelReadablePath(segments)) {
      throw new SourceUnavailableError(`Klasör kaynağı yalnız manifest.json ve data/**/*.json okur: ${path}`, { source: this.kind, path });
    }
    if (options.signal?.aborted) throw abortError();
    const file = this.files.get(segments.join('/'));
    if (!file) throw new SourceUnavailableError(`Klasörde dosya yok (${this.label}): ${path}`, { source: this.kind, path });
    try {
      return await file.text();
    } catch (cause) {
      throw new SourceUnavailableError(`Klasörde dosya okunamadı (${this.label}): ${path}`, { source: this.kind, path, cause });
    }
  }
}

// --- Seçilmemiş klasör (üretim varsayılanı) ------------------------------------------------------------------

export const UNSELECTED_SOURCE_LABEL = 'Klasör seçilmedi';

/**
 * Üretim build'inin (GitHub Pages) varsayılan kaynağı: dev yolu /__aile/generation orada yoktur ve gerçek veri yalnız
 * klasör içe aktarmayla girer. Hiçbir ağ isteği atmaz; her okuma kullanıcıyı "Klasörden içe aktar"a yönlendiren
 * SourceUnavailableError ile reddedilir. Tür 'directory'dir: panel "Klasör içe aktar" durumunda açılır.
 */
export class UnselectedGenerationSource implements GenerationSource {
  readonly kind = 'directory' as const;
  readonly label = UNSELECTED_SOURCE_LABEL;

  async readText(path: string): Promise<string> {
    throw new SourceUnavailableError('Nesil klasörü seçilmedi. Veri sayfasında «Klasörden içe aktar» ile nesil klasörünü seçin', {
      source: this.kind,
      path,
    });
  }
}

/** Varsayılan kaynağı belirleyen derleme ortamı (import.meta.env alt kümesi). */
export interface GenerationSourceEnv {
  DEV?: boolean;
  /** Üretim build'inde açıkça HTTP nesil kaynağı (ör. gerçek veriyle yalnız yerel önizleme). Boşsa yok sayılır. */
  VITE_AILE_GENERATION_URL?: string;
}

/** Anahtarlar tek tek okunur: Vite yalnız bunları derlemede yerine koyar (bütün import.meta.env nesnesi gömülmez). */
function buildEnv(): GenerationSourceEnv {
  return { DEV: import.meta.env.DEV, VITE_AILE_GENERATION_URL: import.meta.env.VITE_AILE_GENERATION_URL as string | undefined };
}

/**
 * GenerationProvider'ın kaynak verilmediğindeki varsayılanı. Geliştirmede HttpGenerationSource(/__aile/generation);
 * üretimde VITE_AILE_GENERATION_URL verilmediyse UnselectedGenerationSource (istek yok, "Klasör içe aktar" durumu).
 */
export function defaultGenerationSource(env: GenerationSourceEnv = buildEnv()): GenerationSource {
  const explicit = typeof env.VITE_AILE_GENERATION_URL === 'string' ? env.VITE_AILE_GENERATION_URL.trim() : '';
  if (explicit) return new HttpGenerationSource(explicit);
  if (env.DEV === true) return new HttpGenerationSource();
  return new UnselectedGenerationSource();
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
