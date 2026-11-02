// Nesil deposu: doğrulanmış JSON neslini (manifest + parçalar) okur, sha256 ile bütünlüğünü doğrular, bellekte tutar
// ve parça metinlerini generation_id anahtarıyla idb-keyval'de önbellekler. React/antd bilmez; kabuk `subscribe`
// ile durumu izler. Yarım veya bozuk nesil asla son iyi veriyi ezmez: aday nesil tamamlanmadan yayınlanmaz.
//
// Tembel yükleme: koleksiyon yalnız istenince, istenirse yalnız belirli dönemlerin (YYYY-MM bölütlü) parçalarıyla
// okunur. Parça okuması nesil içinde tekilleştirilir ve bellekte tutulur (aynı parçayı isteyen her çağrı aynı okumayı
// bekler); en fazla MAX_CONCURRENT_PARTITION_READS okuma aynı anda sürer. Çağıran AbortSignal verebilir: iptal eden
// tek bekleyen ise okuma da kesilir. Parça okumaları manifestin generation_id'siyle sabitlenir (HTTP: ?generation=).
// Yayını değiştiren iş (ilk manifest, yenileme) tektir ve yayındaki nesilden süren okumaların bitmesini bekler.
import { createStore, del, get, keys, set, type UseStore } from 'idb-keyval';
import { parseManifest, parsePartition } from './contract';
import { abortError, isAbortError, type ReadTextOptions } from './sources';
import type { BaseRecord, CollectionName, GenerationState, Manifest, ManifestFile, PartitionEnvelope } from './types';

/** Hücre/satır dökümleri ağırdır; panel bunları hiçbir koşulda indirmez. */
export const HEAVY_COLLECTIONS: readonly string[] = ['source_cells', 'source_rows'];

/** Aynı anda süren en fazla parça okuması (önbellek + kaynak). */
export const MAX_CONCURRENT_PARTITION_READS = 6;

/**
 * Nesil kökünden göreli yolu ('manifest.json', 'data/<koleksiyon>/<bölüm>/<parça>.json') UTF-8 metin olarak okur.
 * Parça okumalarında depo { signal, generationId } verir; desteklemeyen kaynak yok sayar.
 */
export interface GenerationSource {
  readText(path: string, options?: ReadTextOptions): Promise<string>;
}

export interface CollectionScopeOptions {
  /**
   * YYYY-MM dönemleri. Verilirse koleksiyonun yalnız bu dönemlere ait parçaları ve dönemsiz parçaları okunur; kayıtlar
   * ayrıca süzülmez. Verilmezse bütün koleksiyon. Sıra ve tekrar önemsizdir (aynı küme aynı kapsamdır).
   */
  periods?: readonly string[];
}

export interface LoadCollectionOptions extends CollectionScopeOptions {
  /** İptal: çağrı AbortError ile reddedilir; parçayı bekleyen başka çağıran yoksa okuma da kesilir. Durum hata olmaz. */
  signal?: AbortSignal;
}

/** Parça metni önbelleği; anahtar `<generation_id>/<yol>`. Önbellek hatası yüklemeyi hiçbir zaman durdurmaz. */
export interface PartitionCache {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
}

export interface StoreStatus {
  state: GenerationState;
  /** Yayında olan (son iyi) neslin kimliği. */
  generationId: string | null;
  /** Son başarılı okumanın ISO zamanı. */
  lastReadAt: string | null;
  lastGoodGenerationId: string | null;
  lastGoodAt: string | null;
  /** stale/error'da "Hata: …" ile başlar; ready'de null. */
  message: string | null;
}

export interface GenerationStoreOptions {
  /** null → önbellek yok. Verilmezse idb-keyval (IndexedDB yoksa yine önbellek yok). */
  cache?: PartitionCache | null;
  now?: () => Date;
}

/** Manifest hash'i ile okunan içerik uyuşmuyor; veri yayınlanmaz. */
export class IntegrityError extends Error {
  override readonly name = 'IntegrityError';
  constructor(readonly path: string, readonly expected: string, readonly actual: string) {
    super(`${path} bütünlük doğrulamasını geçmedi (beklenen ${expected.slice(0, 12)}…, okunan ${actual.slice(0, 12)}…)`);
  }
}

/** Manifest ya da parça zarfı veri platformu sözleşmesine uymuyor. */
export class ContractError extends Error {
  override readonly name = 'ContractError';
  constructor(readonly path: string, detail: string) {
    super(`${path} sözleşmeye uymuyor: ${detail}`);
  }
}

export class HeavyCollectionError extends Error {
  override readonly name = 'HeavyCollectionError';
  constructor(readonly collection: string) {
    super(`${collection} panel tarafından indirilmez`);
  }
}

interface Snapshot {
  generationId: string;
  manifest: Manifest;
  /** Kapsam anahtarı (koleksiyon adı ya da "ad@dönemler") → yayınlanan kayıtlar. */
  collections: Map<string, readonly BaseRecord[]>;
  /** Yüklenmiş kapsamlar; yenileme bunları aday nesilden yeniden okur. */
  scopes: Map<string, Scope>;
  /** Parça yolu → okuma (tekilleştirme + bellek önbelleği). Başarısız ya da iptal edilen girdi silinir. */
  partitions: Map<string, PartitionEntry>;
  readAt: string;
}

type Listener = (status: StoreStatus) => void;

// --- Dönem kapsamı --------------------------------------------------------------------------------------

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Parça yolundaki dönem bölütü (data/<koleksiyon>/…/YYYY-MM/…/<parça>.json); dönemsiz parçada null. */
export function partitionPeriod(path: string): string | null {
  const segments = path.split('/');
  for (const segment of segments.slice(2, -1)) if (PERIOD.test(segment)) return segment;
  return null;
}

/** Dönemleri doğrular, tekrarı atar ve sıralar; geçersiz dönemde RangeError. */
export function normalizePeriods(periods: readonly string[]): string[] {
  for (const period of periods) {
    if (typeof period !== 'string' || !PERIOD.test(period)) throw new RangeError(`Geçersiz dönem (YYYY-MM bekleniyor): ${String(period)}`);
  }
  return [...new Set(periods)].sort();
}

/** Koleksiyon kapsamının kararlı anahtarı: bütün koleksiyon için adı, dönem kapsamı için "ad@d1,d2". */
export function collectionScopeKey(name: string, periods?: readonly string[] | null): string {
  return periods ? `${name}@${normalizePeriods(periods).join(',')}` : name;
}

export interface PeriodsBetweenOptions {
  /** IANA saat dilimi (ör. 'Europe/Istanbul'); verilmezse tarayıcının yerel saati. Geçersizse RangeError. */
  timeZone?: string;
}

function yearMonth(date: Date, timeZone: string | undefined): [number, number] {
  if (!timeZone) return [date.getFullYear(), date.getMonth()];
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric' }).formatToParts(date);
  const year = Number(parts.find(part => part.type === 'year')?.value);
  const month = Number(parts.find(part => part.type === 'month')?.value);
  return [year, month - 1];
}

/**
 * İki tarihi (dahil) kapsayan takvim ayları, 'YYYY-MM'. Bitiş başlangıçtan önceyse boş. options.timeZone verilirse aylar
 * o saat diliminde hesaplanır (bütçe dönemleri Europe/Istanbul'dur; ay sınırında yerel saat bir parça kaçırabilir).
 */
export function periodsBetween(from: Date, to: Date, options: PeriodsBetweenOptions = {}): string[] {
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw new RangeError('Geçersiz tarih');
  const out: string[] = [];
  let [year, month] = yearMonth(from, options.timeZone);
  const [endYear, endMonth] = yearMonth(to, options.timeZone);
  while (year < endYear || (year === endYear && month <= endMonth)) {
    out.push(`${year}-${String(month + 1).padStart(2, '0')}`);
    month += 1;
    if (month === 12) {
      month = 0;
      year += 1;
    }
  }
  return out;
}

interface Scope {
  key: string;
  name: CollectionName;
  periods: readonly string[] | null;
}

function makeScope(name: CollectionName, periods: readonly string[] | undefined): Scope {
  const normalized = periods ? normalizePeriods(periods) : null;
  return { key: normalized ? `${name}@${normalized.join(',')}` : name, name, periods: normalized };
}

function scopeFiles(manifest: Manifest, scope: Scope): ManifestFile[] {
  return manifest.files.filter(file => {
    if (file.kind !== 'partition' || file.collection !== scope.name) return false;
    if (!scope.periods) return true;
    const period = partitionPeriod(file.path);
    return period === null || scope.periods.includes(period);
  });
}

// --- Eşzamanlılık yardımcıları ----------------------------------------------------------------------------

/** Söz verilen değeri bekler; signal iptal edilirse hemen AbortError ile reddeder (alttaki iş sürebilir). */
function raceAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    // Alttaki iş sürer; sonradan reddedilirse işlenmemiş ret olarak kalmasın.
    promise.catch(() => undefined);
    return Promise.reject(abortError());
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      value => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

/** Sayaçlı kapı: aynı anda en fazla `limit` iş; sırada bekleyen iptal edilirse sıradan çıkar. */
class ReadGate {
  private active = 0;
  private readonly queue: { resume(): void }[] = [];

  constructor(private readonly limit: number) {}

  acquire(signal: AbortSignal): Promise<() => void> {
    if (signal.aborted) return Promise.reject(abortError());
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve(this.releaser());
    }
    return new Promise((resolve, reject) => {
      const waiter = {
        resume: () => {
          signal.removeEventListener('abort', onAbort);
          this.active += 1;
          resolve(this.releaser());
        },
      };
      const onAbort = () => {
        const at = this.queue.indexOf(waiter);
        if (at >= 0) this.queue.splice(at, 1);
        reject(abortError());
      };
      signal.addEventListener('abort', onAbort, { once: true });
      this.queue.push(waiter);
    });
  }

  private releaser(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
      this.queue.shift()?.resume();
    };
  }
}

interface PartitionEntry {
  readonly promise: Promise<readonly BaseRecord[]>;
  readonly controller: AbortController;
  /** Bu parçayı bekleyen çağrı sayısı; iptalle sıfıra inerse okuma kesilir. */
  waiters: number;
  status: 'pending' | 'ok' | 'failed';
  records?: readonly BaseRecord[];
}

interface Outcome {
  state: GenerationState;
  message: string | null;
}

type JobKind = 'write' | 'read';

const IDB_DATABASE = 'aile-admin';
const IDB_STORE = 'partitions';

export function createIdbPartitionCache(): PartitionCache | null {
  if (typeof indexedDB === 'undefined') return null;
  let store: UseStore | undefined;
  const useStore = () => (store ??= createStore(IDB_DATABASE, IDB_STORE));
  return {
    async get(key) {
      const value = await get<unknown>(key, useStore());
      return typeof value === 'string' ? value : undefined;
    },
    async set(key, value) {
      await set(key, value, useStore());
    },
  };
}

/** Kalıcı parça önbelleği seçimi (import.meta.env alt kümesi). */
export interface PartitionCacheEnv {
  /**
   * Boş, 'idb' ya da 'on' → IndexedDB (aile-admin/partitions). 'off' ya da 'memory' → kalıcı önbellek yok: veri yalnız
   * sekme belleğinde kalır (Pages build'i, ortak köken). Tanınmayan değer gizlilik için kapalı sayılır.
   */
  VITE_AILE_PARTITION_CACHE?: string;
}

function partitionCacheEnv(): PartitionCacheEnv {
  return { VITE_AILE_PARTITION_CACHE: import.meta.env.VITE_AILE_PARTITION_CACHE as string | undefined };
}

/** GenerationProvider'ın önbellek varsayılanı: derleme ortamına göre IndexedDB ya da kalıcı önbellek yok (null). */
export function defaultPartitionCache(env: PartitionCacheEnv = partitionCacheEnv()): PartitionCache | null {
  const mode = (env.VITE_AILE_PARTITION_CACHE ?? '').trim().toLowerCase();
  if (mode === '' || mode === 'idb' || mode === 'on') return createIdbPartitionCache();
  return null;
}

/** Yayındaki nesil dışındaki önbellek girdilerini siler; kabuk yeni nesil ready olduktan sonra çağırabilir. */
export async function pruneIdbPartitionCache(keepGenerationId: string): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const store = createStore(IDB_DATABASE, IDB_STORE);
  const all = await keys<string>(store);
  await Promise.all(all.filter(key => typeof key === 'string' && !key.startsWith(`${keepGenerationId}/`)).map(key => del(key, store)));
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** zod sorununun özette kullanılan alanları (zod 4 sorun biçimleri; bilinmeyen alanlar yok sayılır). */
interface ContractIssue {
  code?: unknown;
  path?: unknown;
  values?: unknown;
  expected?: unknown;
  keys?: unknown;
  minimum?: unknown;
  maximum?: unknown;
  format?: unknown;
}

/** zod tür adları → kullanıcı metni. */
const TYPE_TEXT: Readonly<Record<string, string>> = {
  string: 'metin', number: 'sayı', int: 'tam sayı', boolean: 'doğru/yanlış', object: 'nesne', array: 'liste', null: 'boş değer',
  date: 'tarih', bigint: 'tam sayı', literal: 'sabit değer',
};

/** ["records", 79, "payment_evidence"] → "records[79].payment_evidence"; boş yol "kök". */
function issuePath(path: unknown): string {
  if (!Array.isArray(path) || path.length === 0) return 'kök';
  let out = '';
  for (const part of path) out += typeof part === 'number' ? `[${part}]` : `${out ? '.' : ''}${String(part)}`;
  return out;
}

const valueText = (value: unknown) => (typeof value === 'string' ? `“${value}”` : String(value));

function issueText(issue: ContractIssue): string {
  switch (issue.code) {
    case 'invalid_value':
      return Array.isArray(issue.values) && issue.values.length ? `yalnız ${issue.values.map(valueText).join(' ya da ')}` : 'izin verilmeyen değer';
    case 'invalid_type':
      return typeof issue.expected === 'string' ? `${TYPE_TEXT[issue.expected] ?? issue.expected} bekleniyor` : 'tür uymuyor';
    case 'unrecognized_keys':
      return Array.isArray(issue.keys) && issue.keys.length ? `tanımsız alan ${issue.keys.map(String).join(', ')}` : 'tanımsız alan';
    case 'too_small':
      return issue.minimum !== undefined ? `en az ${String(issue.minimum)}` : 'çok küçük';
    case 'too_big':
      return issue.maximum !== undefined ? `en çok ${String(issue.maximum)}` : 'çok büyük';
    case 'invalid_format':
      return typeof issue.format === 'string' ? `biçim uymuyor (${issue.format})` : 'biçim uymuyor';
    case 'invalid_union':
      return 'tanımlı biçimlerin hiçbirine uymuyor';
    default:
      return 'geçersiz değer';
  }
}

/**
 * Sözleşme hatasının kullanıcıya yazılacak kısa özeti. zod hatasında (name "ZodError", issues dizisi) ham JSON sorun
 * dizisi yerine ilk sorunun yolu ve Türkçe nedeni, varsa kalan sorun sayısı: "records[79].payment_evidence: yalnız
 * false (+2 sorun daha)". Diğer hatalarda iletinin kendisi.
 */
export function contractSummary(error: unknown): string {
  const issues = error instanceof Error && error.name === 'ZodError' ? (error as Error & { issues?: unknown }).issues : undefined;
  if (!Array.isArray(issues) || issues.length === 0) return errorMessage(error);
  const first = (issues[0] ?? {}) as ContractIssue;
  const rest = issues.length > 1 ? ` (+${issues.length - 1} sorun daha)` : '';
  return `${issuePath(first.path)}: ${issueText(first)}${rest}`;
}

export class GenerationStore {
  private readonly cache: PartitionCache | null;
  private readonly now: () => Date;
  private readonly listeners = new Set<Listener>();
  private readonly gate = new ReadGate(MAX_CONCURRENT_PARTITION_READS);
  /** Yayındaki (son iyi) nesil. Yalnız tamamlanmış aday ile değişir. */
  private current: Snapshot | null = null;
  private state: GenerationState = 'idle';
  private message: string | null = null;
  private lastReadAt: string | null = null;
  private lastGoodAt: string | null = null;
  /** Son yenileme reddedildiyse (son iyi nesil yayında) "Hata: …"; yeni yayında null. Uyarı bununla kalıcıdır. */
  private refreshFailure: string | null = null;
  /** Yayını değiştiren tek iş (ilk manifest ya da yenileme). */
  private writer: Promise<void> | null = null;
  /** Yayındaki nesilden okuyan işler; yazıcı bunların bitmesini bekler. */
  private readonly readers = new Set<Promise<unknown>>();
  private active = 0;
  private busy: { before: Outcome; succeeded: boolean; failure: Outcome | null } | null = null;

  constructor(private readonly source: GenerationSource, options: GenerationStoreOptions = {}) {
    this.cache = options.cache === undefined ? createIdbPartitionCache() : options.cache;
    this.now = options.now ?? (() => new Date());
  }

  get status(): StoreStatus {
    return {
      state: this.state,
      generationId: this.current?.generationId ?? null,
      lastReadAt: this.lastReadAt,
      lastGoodGenerationId: this.current?.generationId ?? null,
      lastGoodAt: this.lastGoodAt,
      message: this.message,
    };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Manifesti okur ve doğrular. Yayında nesil yoksa (eşzamanlı çağrılarda tek okumayla) yayınlar; varsa yalnız döner. */
  async loadManifest(): Promise<Manifest> {
    for (;;) {
      if (this.current) return this.current.manifest;
      if (this.writer) {
        await this.writer;
        continue;
      }
      await this.write(async () => {
        this.publish(await this.readManifest());
      });
    }
  }

  /**
   * Koleksiyonu (ya da dönem kapsamını) belleğe alır; aynı kapsam bir kez okunur. Bütün parçalar doğrulanmadan hiçbir
   * kayıt yayınlanmaz. options.periods → yalnız o dönemlerin parçaları; options.signal → iptal (AbortError).
   */
  async loadCollection(name: CollectionName, options: LoadCollectionOptions = {}): Promise<readonly BaseRecord[]> {
    if (HEAVY_COLLECTIONS.includes(name)) throw new HeavyCollectionError(name);
    const scope = makeScope(name, options.periods);
    const { signal } = options;
    if (signal?.aborted) throw abortError();
    await raceAbort(this.loadManifest(), signal);
    // Yayını değiştiren iş sürerken bekle; ardından okuyucu olarak (eşzamanlı) kaydol.
    for (;;) {
      if (this.writer) {
        await raceAbort(this.writer.catch(() => undefined), signal);
        continue;
      }
      if (!this.current) {
        await raceAbort(this.loadManifest(), signal);
        continue;
      }
      break;
    }
    const snapshot = this.current!;
    const existing = snapshot.collections.get(scope.key);
    if (existing) return existing;
    // Manifest beklenirken iptal edildiyse hiçbir parça okuması başlatılmaz.
    if (signal?.aborted) throw abortError();
    const files = scopeFiles(snapshot.manifest, scope);
    // Bütün parçalar bu nesilde zaten bellekteyse okuma yok; durum değişmez.
    const entries = files.map(file => snapshot.partitions.get(file.path));
    if (entries.every(entry => entry?.status === 'ok')) {
      return this.publishScope(snapshot, scope, entries.flatMap(entry => entry!.records!), false);
    }
    const job = this.track(async () => {
      const rows = await this.readScope(snapshot, files, signal);
      return this.publishScope(snapshot, scope, rows, true);
    }, 'read');
    this.readers.add(job);
    const done = () => {
      this.readers.delete(job);
    };
    job.then(done, done);
    return job;
  }

  /** Yayındaki neslin koleksiyonu ya da dönem kapsamı; yüklenmemişse undefined. */
  getCollection(name: CollectionName, options: CollectionScopeOptions = {}): readonly BaseRecord[] | undefined {
    let key: string;
    try {
      key = collectionScopeKey(name, options.periods);
    } catch {
      return undefined;
    }
    return this.current?.collections.get(key);
  }

  /**
   * Manifesti ve yüklü kapsamları yeniden okur; aday nesil eksiksiz doğrulanmadan yayın değişmez. Aday reddedilirse
   * (ağ, bütünlük ya da sözleşme) son iyi nesil yayında kalır ve durum stale olur. Süren yenileme varsa ona katılır.
   */
  refresh(): Promise<void> {
    if (this.writer) return this.writer;
    return this.write(async () => {
      const previous = this.current;
      const candidate = await this.readManifest();
      if (previous) {
        const controller = new AbortController();
        try {
          await Promise.all(
            [...previous.scopes.values()].map(async scope => {
              const rows = await this.readScope(candidate, scopeFiles(candidate.manifest, scope), controller.signal);
              candidate.collections.set(scope.key, rows);
              candidate.scopes.set(scope.key, scope);
            }),
          );
        } catch (error) {
          controller.abort();
          throw error;
        }
      }
      this.publish(candidate);
    });
  }

  // --- iç ---------------------------------------------------------------------------------------

  /** Yayını değiştiren iş: tektir; yayındaki nesilden süren okumaların bitmesini bekler. */
  private write(work: () => Promise<void>): Promise<void> {
    const job = (async () => {
      while (this.readers.size > 0) await Promise.allSettled([...this.readers]);
      await this.track(work, 'write');
    })();
    this.writer = job;
    const clear = () => {
      if (this.writer === job) this.writer = null;
    };
    job.then(clear, clear);
    return job;
  }

  /**
   * Durum geçişleri tek yerden: ilk iş 'checking' yapar, son iş bitince sonuç yayınlanır. İptal hata sayılmaz; yalnız
   * iptal edilen işlerden oluşan dönem önceki duruma döner. Yayındaki nesil varken reddedilen yenileme stale'dir.
   */
  private async track<T>(work: () => Promise<T>, kind: JobKind): Promise<T> {
    if (this.active === 0) {
      this.busy = { before: { state: this.state, message: this.message }, succeeded: false, failure: null };
      this.setState('checking', null);
    }
    this.active += 1;
    try {
      const result = await work();
      this.finish(null, kind);
      return result;
    } catch (error) {
      this.finish(error, kind);
      throw error;
    }
  }

  private finish(error: unknown, kind: JobKind) {
    const busy = this.busy!;
    if (error === null) {
      busy.succeeded = true;
      // Yeni yayın, yayından önceki okuma hatalarını geçersiz kılar.
      if (kind === 'write') busy.failure = null;
    } else if (!isAbortError(error)) {
      const failure = this.classify(error, kind);
      if (!busy.failure || (failure.state === 'error' && busy.failure.state !== 'error')) busy.failure = failure;
    }
    this.active -= 1;
    if (this.active > 0) return;
    this.busy = null;
    if (busy.failure) this.setState(busy.failure.state, busy.failure.message);
    else if (busy.succeeded) this.setState(this.refreshFailure ? 'stale' : 'ready', this.refreshFailure);
    else this.setState(busy.before.state, busy.before.message);
  }

  private classify(error: unknown, kind: JobKind): Outcome {
    const message = `Hata: ${errorMessage(error)}`;
    if (kind === 'write') {
      // Aday reddedildi: yayında son iyi nesil varsa o korunur (stale, uyarıyla); yoksa error.
      if (this.current) {
        this.refreshFailure = message;
        return { state: 'stale', message };
      }
      return { state: 'error', message };
    }
    // Yayındaki nesilden okuma: bütünlük/sözleşme ihlali güvenilmezdir (error); erişilemezlik stale.
    const untrusted = error instanceof IntegrityError || error instanceof ContractError;
    return { state: this.current && !untrusted ? 'stale' : 'error', message };
  }

  private setState(state: GenerationState, message: string | null) {
    this.state = state;
    this.message = message;
    const status = this.status;
    for (const listener of this.listeners) listener(status);
  }

  private publish(snapshot: Snapshot) {
    this.current = snapshot;
    this.refreshFailure = null;
    this.touch();
  }

  /** Kapsamı nesle yazar; aynı kapsamı eşzamanlı yükleyen önce yazdıysa onun dizisi döner (referans kararlı). */
  private publishScope(snapshot: Snapshot, scope: Scope, rows: readonly BaseRecord[], read: boolean): readonly BaseRecord[] {
    const published = snapshot.collections.get(scope.key);
    if (published) return published;
    snapshot.collections.set(scope.key, rows);
    snapshot.scopes.set(scope.key, scope);
    if (read && snapshot === this.current) this.touch();
    return rows;
  }

  private touch() {
    const at = this.now().toISOString();
    this.lastReadAt = at;
    this.lastGoodAt = at;
    if (this.current) this.current.readAt = at;
  }

  /** Parçaları (tekilleştirerek, kapı sınırıyla) okur ve manifest sırasıyla birleştirir. */
  private async readScope(snapshot: Snapshot, files: readonly ManifestFile[], signal?: AbortSignal): Promise<BaseRecord[]> {
    const entries = files.map(file => this.partitionEntry(snapshot, file));
    for (const entry of entries) entry.waiters += 1;
    try {
      const parts = await raceAbort(Promise.all(entries.map(entry => entry.promise)), signal);
      return parts.flat();
    } finally {
      entries.forEach((entry, index) => {
        entry.waiters -= 1;
        if (entry.waiters > 0 || entry.status !== 'pending') return;
        // Bekleyen kalmadı (iptal ya da kardeş parça hatası): okumayı kes, bellekte tutma.
        entry.controller.abort();
        const path = files[index]!.path;
        if (snapshot.partitions.get(path) === entry) snapshot.partitions.delete(path);
      });
    }
  }

  private partitionEntry(snapshot: Snapshot, file: ManifestFile): PartitionEntry {
    const existing = snapshot.partitions.get(file.path);
    if (existing) return existing;
    const controller = new AbortController();
    const collection = file.collection as CollectionName;
    const promise = (async () => {
      const release = await this.gate.acquire(controller.signal);
      try {
        const text = await this.readPartitionText(snapshot.generationId, file, controller.signal);
        if (controller.signal.aborted) throw abortError();
        return this.parsePartition(collection, file.path, text);
      } finally {
        release();
      }
    })();
    const entry: PartitionEntry = { promise, controller, waiters: 0, status: 'pending' };
    promise.then(
      records => {
        entry.status = 'ok';
        entry.records = records;
      },
      () => {
        entry.status = 'failed';
        if (snapshot.partitions.get(file.path) === entry) snapshot.partitions.delete(file.path);
      },
    );
    snapshot.partitions.set(file.path, entry);
    return entry;
  }

  private async readManifest(): Promise<Snapshot> {
    const text = await this.source.readText('manifest.json');
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (error) {
      throw new ContractError('manifest.json', errorMessage(error));
    }
    let manifest: Manifest;
    try {
      manifest = parseManifest(raw) as Manifest;
    } catch (error) {
      throw new ContractError('manifest.json', contractSummary(error));
    }
    // Deponun çalışması için gereken asgari biçim; sözleşme şeması gevşekse bile burada durur.
    if (!manifest || typeof manifest !== 'object' || manifest.schemaVersion !== 1) throw new ContractError('manifest.json', 'schemaVersion 1 değil');
    if (typeof manifest.generation_id !== 'string' || !/^[a-f0-9]{64}$/.test(manifest.generation_id)) throw new ContractError('manifest.json', 'generation_id sha256 değil');
    if (!Array.isArray(manifest.files)) throw new ContractError('manifest.json', 'files dizisi yok');
    for (const file of manifest.files) {
      if (!file || typeof file.path !== 'string' || typeof file.sha256 !== 'string') throw new ContractError('manifest.json', 'files girdisi path/sha256 taşımıyor');
    }
    return {
      generationId: manifest.generation_id,
      manifest,
      collections: new Map(),
      scopes: new Map(),
      partitions: new Map(),
      readAt: this.now().toISOString(),
    };
  }

  /** Önce önbellek (hash yeniden doğrulanır), sonra kaynak; her iki yol da manifest hash'ini geçmek zorundadır. */
  private async readPartitionText(generationId: string, file: ManifestFile, signal: AbortSignal): Promise<string> {
    const key = `${generationId}/${file.path}`;
    const cached = await this.cacheGet(key);
    if (cached !== undefined && (await sha256Hex(cached)) === file.sha256) return cached;
    if (signal.aborted) throw abortError();
    const text = await this.source.readText(file.path, { signal, generationId });
    const actual = await sha256Hex(text);
    if (actual !== file.sha256) throw new IntegrityError(file.path, file.sha256, actual);
    await this.cacheSet(key, text);
    return text;
  }

  private parsePartition(name: CollectionName, path: string, text: string): BaseRecord[] {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (error) {
      throw new ContractError(path, errorMessage(error));
    }
    let envelope: PartitionEnvelope;
    try {
      envelope = parsePartition(name, raw) as PartitionEnvelope;
    } catch (error) {
      throw new ContractError(path, contractSummary(error));
    }
    if (!envelope || envelope.schemaVersion !== 1 || !Array.isArray(envelope.records)) throw new ContractError(path, 'parça zarfı schemaVersion 1 / records değil');
    if (envelope.collection !== name) throw new ContractError(path, `zarf koleksiyonu ${String(envelope.collection)}, beklenen ${name}`);
    return envelope.records;
  }

  private async cacheGet(key: string): Promise<string | undefined> {
    if (!this.cache) return undefined;
    try {
      return await this.cache.get(key);
    } catch {
      return undefined;
    }
  }

  private async cacheSet(key: string, value: string): Promise<void> {
    if (!this.cache) return;
    try {
      await this.cache.set(key, value);
    } catch {
      // Önbellek yardımcıdır; yazılamaması veriyi etkilemez.
    }
  }
}
