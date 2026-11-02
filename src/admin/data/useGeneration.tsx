// React bağlamı: nesil deposunu (GenerationStore), koleksiyon yükleyicisini, indeks/sorgu katmanını ve yerel
// değişiklik kümesini sayfalara hook olarak sunar. Veri mantığı komşu saf TS dosyalarındadır (store, indexes,
// query, changeSet); burada yalnız React bağlama, abonelik ve memoizasyon vardır. antd yok; ham paket importu yok.
//
//   <GenerationProvider source? cache? changeSet? now?>
//        source: undefined → defaultGenerationSource(): geliştirmede HttpGenerationSource (/__aile/generation), üretimde
//                (VITE_AILE_GENERATION_URL yoksa) UnselectedGenerationSource → istek yok, "Klasör içe aktar" durumu;
//                null → doğrudan "Klasör içe aktar" durumu.
//        cache:  undefined → defaultPartitionCache() (VITE_AILE_PARTITION_CACHE=off → kalıcı önbellek yok); null → yok.
//     useGeneration()        → durum, manifest, tazelik, refresh, pickDirectory (DirectoryGenerationSource), importRequired
//     useGenerationImport()  → klasör içe aktarma: pickDirectory (Chromium) + importFiles(FileList) (Safari/WebKit)
//     useCollection(name, { periods? })
//                            → { rows, loading, error }     (store.loadCollection, kapsam başına bir kez; hata "Hata: …")
//                              periods: yalnız o YYYY-MM dönemlerinin parçaları. Bileşen kalkınca (rota değişimi)
//                              bekleyen yükleme AbortController ile iptal edilir (başka bekleyen yoksa).
//     useRows(kind)          → RecordRow[]                  (changeSet.apply → buildIndexes → toRecordRow)
//     useQuery(kind, ast)    → { ids, rows, counts, total, loading, error }
//     useChangeSet()         → yerel değişiklik kümesi (add / undo / pendingFor / toBatch); Sheets'e yazma yok
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type { RecordRow } from '../shell/contracts';
import { ChangeSet, type BatchConversion, type ChangeInput, type ChangeOp, type OverlayRecord, type UndoResult } from './changeSet';
import { buildIndexes, toRecordRow, type GenerationCollections, type GenerationIndexes } from './indexes';
import { createQueryContext, facetCounts, runQuery, toQueryRow, type FacetCounts, type QueryAst, type QueryContext, type QueryRow } from './query';
import {
  DirectoryFileListSource,
  DirectoryGenerationSource,
  UnselectedGenerationSource,
  defaultGenerationSource,
  isAbortError,
  type DirectoryFiles,
  type GenerationSource,
  type GenerationSourceKind,
} from './sources';
import { GenerationStore, collectionScopeKey, defaultPartitionCache, normalizePeriods, type PartitionCache, type StoreStatus } from './store';
import type {
  BaseRecord,
  BudgetObservation,
  CollectionName,
  Forecast,
  ForecastEvent,
  ForecastMonth,
  GenerationState,
  Issue,
  Manifest,
  MediaReference,
  PurchaseNeedRecord,
  Relation,
  Room,
  SettingRecord,
  SheetRecord,
  SourceRecord,
  TaskTemplate,
  Term,
  ViewDefinition,
  Vocabulary,
  WorkflowDefinition,
} from './types';

// Tembel yükleme yardımcıları (saf TS, store.ts): barrel ('../data') bunları buradan da dışa verir.
export {
  MAX_CONCURRENT_PARTITION_READS,
  collectionScopeKey,
  defaultPartitionCache,
  normalizePeriods,
  partitionPeriod,
  periodsBetween,
  type CollectionScopeOptions,
  type LoadCollectionOptions,
  type PartitionCacheEnv,
  type PeriodsBetweenOptions,
} from './store';

// --- Koleksiyon → kayıt tipi -----------------------------------------------------------------------------
export interface CollectionRecordMap {
  purchase_needs: PurchaseNeedRecord;
  lighting_specs: PurchaseNeedRecord;
  work_orders: PurchaseNeedRecord;
  layout_items: PurchaseNeedRecord;
  inspections: PurchaseNeedRecord;
  automation_scenes: PurchaseNeedRecord;
  milestones: PurchaseNeedRecord;
  rooms: Room;
  settings: SettingRecord;
  relations: Relation;
  media_references: MediaReference;
  budget_observations: BudgetObservation;
  forecasts: Forecast;
  forecast_events: ForecastEvent;
  forecast_months: ForecastMonth;
  vocabularies: Vocabulary;
  terms: Term;
  workflows: WorkflowDefinition;
  view_definitions: ViewDefinition;
  task_templates: TaskTemplate;
  issues: Issue;
  sources: SourceRecord;
  sheets: SheetRecord;
  supplements: BaseRecord;
}
export type CollectionRecord<K extends CollectionName> = CollectionRecordMap[K];

/** app_kalemler gövdesini paylaşan yedi kayıt türü → koleksiyon adı. payments / providers nesilde yok. */
export const KIND_COLLECTIONS = {
  purchase_need: 'purchase_needs',
  lighting_spec: 'lighting_specs',
  work_order: 'work_orders',
  layout_item: 'layout_items',
  inspection: 'inspections',
  automation_scene: 'automation_scenes',
  milestone: 'milestones',
} as const satisfies Record<string, CollectionName>;
export type RecordKind = keyof typeof KIND_COLLECTIONS;

export function collectionForKind(kind: string): (typeof KIND_COLLECTIONS)[RecordKind] {
  const collection = (KIND_COLLECTIONS as Record<string, (typeof KIND_COLLECTIONS)[RecordKind] | undefined>)[kind];
  if (!collection) throw new Error(`Hata: bilinmeyen kayıt türü "${kind}"`);
  return collection;
}

// --- Yardımcılar -----------------------------------------------------------------------------------------
const EMPTY: readonly never[] = Object.freeze([]);

/** Hata metni her zaman "Hata: " ile başlar; depo zaten böyle üretiyorsa tekrar eklenmez. */
export function failureMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.startsWith('Hata: ') ? text : `Hata: ${text}`;
}

// --- Koleksiyon yükleyici (saf TS) ------------------------------------------------------------------------
export interface CollectionSnapshot<R = BaseRecord> {
  rows: readonly R[];
  loading: boolean;
  /** "Hata: …"; yoksa null. */
  error: string | null;
}

/** Koleksiyon kapsamı: verilirse yalnız bu YYYY-MM dönemlerinin parçaları (dönemsiz parçalar her zaman) yüklenir. */
export interface CollectionLoadOptions {
  periods?: readonly string[];
}

export interface EnsureOptions extends CollectionLoadOptions {
  /** İptal: bu bekleyen çekilir; bir mikro görev içinde başka bekleyen katılmazsa depo yüklemesi iptal edilir. */
  signal?: AbortSignal;
}

/** Yükleyicinin depodan beklediği asgari yüzey (GenerationStore bunu sağlar; testte sahte verilebilir). */
export interface CollectionStoreLike {
  loadCollection(name: CollectionName, options?: { periods?: readonly string[]; signal?: AbortSignal }): Promise<readonly BaseRecord[]>;
  getCollection(name: CollectionName, options?: { periods?: readonly string[] }): readonly BaseRecord[] | undefined;
}

const PENDING: CollectionSnapshot = Object.freeze({ rows: EMPTY, loading: true, error: null });

interface LoadJob {
  readonly controller: AbortController;
  /** İptal edilebilir bekleyen sayısı (signal'li ensure). */
  waiters: number;
  /** signal'siz bekleyen var: iş iptal edilmez. */
  pinned: boolean;
  cancelled: boolean;
  promise: Promise<void>;
}

interface LoaderScope {
  name: CollectionName;
  periods: readonly string[] | undefined;
}

/** Kapsam anahtarı; geçersiz dönem kümesi de ayrı bir anahtar alır (yükleme "Hata: …" ile kapanır). */
function loaderKey(name: CollectionName, periods: readonly string[] | undefined): string {
  try {
    return collectionScopeKey(name, periods);
  } catch {
    return `${name}@!${(periods ?? []).join(',')}`;
  }
}

function loaderPeriods(periods: readonly string[] | undefined): readonly string[] | undefined {
  if (!periods) return undefined;
  try {
    return normalizePeriods(periods);
  } catch {
    return periods;
  }
}

/**
 * Kapsam (koleksiyon ya da koleksiyon@dönemler) başına tek yükleme ve referansı kararlı snapshot
 * (useSyncExternalStore için). Depo hatası yüklemeyi "Hata: …" ile kapatır; depoda eski iyi kayıt varsa onu korur.
 * Bekleyenler signal verirse sayılır; hepsi iptal edince (bir mikro görev sonra) depo yüklemesi iptal edilir ve
 * snapshot beklemede kalır, sonraki ensure yeniden başlatır. sync() refresh sonrası yeni kayıtları alır.
 */
export class CollectionLoader {
  private readonly snapshots = new Map<string, CollectionSnapshot>();
  private readonly scopes = new Map<string, LoaderScope>();
  private readonly jobs = new Map<string, LoadJob>();
  private readonly listeners = new Set<() => void>();

  constructor(private readonly store: CollectionStoreLike) {}

  snapshot(name: CollectionName, options: CollectionLoadOptions = {}): CollectionSnapshot {
    return this.snapshots.get(loaderKey(name, options.periods)) ?? PENDING;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Kapsamı bir kez ister; tekrarlanan çağrılar aynı yüklemeyi bekler. Asla fırlatmaz. */
  ensure(name: CollectionName, options: EnsureOptions = {}): Promise<void> {
    const { signal } = options;
    if (signal?.aborted) return Promise.resolve();
    const key = loaderKey(name, options.periods);
    let job = this.jobs.get(key);
    if (!job) {
      const current = this.snapshots.get(key);
      if (current && !current.loading) return Promise.resolve();
      job = this.start(key, { name, periods: loaderPeriods(options.periods) });
    }
    this.attach(key, job, signal);
    return job.promise;
  }

  /**
   * Yenileme sonrası: istenen kapsamları depodaki güncel kayıtlarla eşitler; depo eskiyi koruduysa değişmez. Hata ile
   * kapanmış ve depoda kaydı olmayan kapsam yeniden istenir (ör. manifest okunamadıktan sonra "Yeniden dene").
   */
  sync(): void {
    for (const [key, snapshot] of this.snapshots) {
      if (this.jobs.has(key)) continue;
      const scope = this.scopes.get(key);
      if (!scope) continue;
      const rows = this.store.getCollection(scope.name, scope.periods ? { periods: scope.periods } : undefined);
      if (!rows) {
        if (snapshot.error !== null) this.attach(key, this.start(key, scope), undefined);
        continue;
      }
      if (rows === snapshot.rows && !snapshot.loading && snapshot.error === null) continue;
      this.set(key, { rows, loading: false, error: null });
    }
  }

  private start(key: string, scope: LoaderScope): LoadJob {
    const controller = new AbortController();
    const job: LoadJob = { controller, waiters: 0, pinned: false, cancelled: false, promise: Promise.resolve() };
    this.scopes.set(key, scope);
    this.jobs.set(key, job);
    this.set(key, PENDING);
    const request = scope.periods ? { periods: scope.periods, signal: controller.signal } : { signal: controller.signal };
    job.promise = this.store
      .loadCollection(scope.name, request)
      .then(
        (rows) => {
          if (!job.cancelled) this.set(key, { rows, loading: false, error: null });
        },
        (error: unknown) => {
          // İptal hata değildir: snapshot beklemede kalır, sonraki ensure yeniden başlatır.
          if (job.cancelled || isAbortError(error)) return;
          const kept = this.store.getCollection(scope.name, scope.periods ? { periods: scope.periods } : undefined);
          this.set(key, { rows: kept ?? EMPTY, loading: false, error: failureMessage(error) });
        },
      )
      .finally(() => {
        if (this.jobs.get(key) === job) this.jobs.delete(key);
      });
    return job;
  }

  private attach(key: string, job: LoadJob, signal: AbortSignal | undefined): void {
    if (!signal) {
      job.pinned = true;
      return;
    }
    job.waiters += 1;
    signal.addEventListener(
      'abort',
      () => {
        job.waiters -= 1;
        // Bir mikro görev beklenir: StrictMode'un ikinci efekti ya da yeni rotanın aynı kapsamı bu arada katılabilir.
        queueMicrotask(() => {
          if (job.pinned || job.waiters > 0 || job.cancelled || this.jobs.get(key) !== job) return;
          job.cancelled = true;
          this.jobs.delete(key);
          job.controller.abort();
        });
      },
      { once: true },
    );
  }

  private set(key: string, snapshot: CollectionSnapshot): void {
    if (this.snapshots.get(key) === snapshot) return;
    this.snapshots.set(key, snapshot);
    for (const listener of this.listeners) listener();
  }
}

// --- Bağlam ---------------------------------------------------------------------------------------------
export interface GenerationHandle {
  state: GenerationState;
  manifest: Manifest | null;
  /** Yayındaki neslin kimliği; yoksa null ("Henüz yok"). */
  generationId: string | null;
  lastReadAt: string | null;
  lastGoodAt: string | null;
  /** stale/error'da "Hata: …"; aksi null. */
  message: string | null;
  /** Manifesti ve yüklü koleksiyonları yeniden okur. Fırlatmaz; sonuç state/message'ta görünür. */
  refresh(): Promise<void>;
  /** Kullanıcıdan salt okunur nesil klasörü ister ve kaynağı değiştirir. İptal/destek yoksa false + sourceMessage. */
  pickDirectory(): Promise<boolean>;
  canPickDirectory: boolean;
  source: { kind: GenerationSourceKind; label: string };
  /** Kaynak seçimi hatası ("Hata: …"); aksi null. */
  sourceMessage: string | null;
  /**
   * Nesil klasörü henüz seçilmedi (üretim varsayılanı): veri yok, durum error ve mesaj "Klasörden içe aktar"a
   * yönlendirir. Sayfa bu durumda içe aktarmayı birincil eylem olarak sunabilir. Hook her zaman doldurur.
   */
  importRequired?: boolean;
}

/** Klasör içe aktarma: Chromium'da showDirectoryPicker, Safari/WebKit'te <input type="file" webkitdirectory>. */
export interface GenerationImportHandle {
  /** File System Access API var mı (Chromium ailesi). */
  canPickDirectory: boolean;
  /** Kullanıcıdan salt okunur nesil klasörü ister ve kaynağı değiştirir. İptal/destek yoksa false + sourceMessage. */
  pickDirectory(): Promise<boolean>;
  /** <input type="file" webkitdirectory> var mı (Chromium, WebKit/Safari, Firefox). */
  canImportFiles: boolean;
  /**
   * input.files ile seçilen nesil klasörüne geçer (kökünde manifest.json olmalı). Boş/yanlış seçimde kaynak değişmez,
   * false döner ve sourceMessage "Hata: …" olur.
   */
  importFiles(files: DirectoryFiles | null | undefined): Promise<boolean>;
  source: { kind: GenerationSourceKind; label: string };
  /** Kaynak seçimi hatası ("Hata: …"); aksi null. */
  sourceMessage: string | null;
  /** Nesil klasörü henüz seçilmedi (üretim varsayılanı); içe aktarma birincil eylemdir. */
  importRequired: boolean;
}

interface GenerationContextValue extends GenerationHandle {
  importRequired: boolean;
  importFiles(files: DirectoryFiles | null | undefined): Promise<boolean>;
  canImportFiles: boolean;
  store: GenerationStore;
  loader: CollectionLoader;
  changeSet: ChangeSet | null;
  changeSetMessage: string | null;
  /** add/undo sonrası artar; türetilen satırların yeniden hesaplanmasını tetikler. */
  changeVersion: number;
  bumpChange(): void;
}

const GenerationContext = createContext<GenerationContextValue | null>(null);

export interface GenerationProviderProps {
  /**
   * undefined → defaultGenerationSource() (dev: HttpGenerationSource; üretim: seçilmemiş klasör, istek yok);
   * null → seçilmemiş klasör ("Klasör içe aktar" durumu). Kararlı referans verin; yalnız ilk değer kullanılır.
   */
  source?: GenerationSource | null;
  /** undefined → defaultPartitionCache() (IndexedDB; VITE_AILE_PARTITION_CACHE=off ise yok); null → önbellek yok. */
  cache?: PartitionCache | null;
  /** undefined → ChangeSet.load() (IndexedDB); null → değişiklik kümesi kapalı; fonksiyon → özel yükleyici. */
  changeSet?: (() => Promise<ChangeSet>) | null;
  now?: () => Date;
  children: ReactNode;
}

export function GenerationProvider({ source: initialSource, cache, changeSet: changeSetLoader, now, children }: GenerationProviderProps) {
  const [source, setSource] = useState<GenerationSource>(() =>
    initialSource === undefined ? defaultGenerationSource() : (initialSource ?? new UnselectedGenerationSource()),
  );
  const [sourceMessage, setSourceMessage] = useState<string | null>(null);
  const defaultCacheWanted = cache === undefined;
  const fallbackCache = useMemo(() => (defaultCacheWanted ? defaultPartitionCache() : null), [defaultCacheWanted]);

  const store = useMemo(() => {
    const options: { cache: PartitionCache | null; now?: () => Date } = { cache: cache === undefined ? fallbackCache : cache };
    if (now) options.now = now;
    return new GenerationStore(source, options);
  }, [source, cache, fallbackCache, now]);
  const loader = useMemo(() => new CollectionLoader(store), [store]);

  // Depo durumu: abone ol; depo değişince anlık durumu yeniden oku.
  const [status, setStatus] = useState<StoreStatus>(() => store.status);
  useEffect(() => {
    setStatus(store.status);
    return store.subscribe(setStatus);
  }, [store]);

  // Manifest: depo değişince sıfırla ve yükle (idle → checking → ready | error).
  const [manifest, setManifest] = useState<Manifest | null>(null);
  useEffect(() => {
    let active = true;
    setManifest(null);
    store
      .loadManifest()
      .then((loaded) => {
        if (active) setManifest(loaded);
      })
      .catch(() => {
        /* durum ve "Hata: …" mesajı store.status üzerinden gelir */
      });
    return () => {
      active = false;
    };
  }, [store]);

  // Değişiklik kümesi: tek sefer yüklenir; kapalıysa null kalır.
  const [changeSet, setChangeSet] = useState<ChangeSet | null>(null);
  const [changeSetMessage, setChangeSetMessage] = useState<string | null>(null);
  const [changeVersion, setChangeVersion] = useState(0);
  const bumpChange = useCallback(() => setChangeVersion((version) => version + 1), []);
  useEffect(() => {
    if (changeSetLoader === null) return;
    let active = true;
    const load = changeSetLoader ?? (() => ChangeSet.load());
    load().then(
      (loaded) => {
        if (active) setChangeSet(loaded);
      },
      (error: unknown) => {
        if (active) setChangeSetMessage(failureMessage(error));
      },
    );
    return () => {
      active = false;
    };
  }, [changeSetLoader]);

  const refresh = useCallback(async () => {
    try {
      await store.refresh();
      setManifest(await store.loadManifest());
    } catch {
      /* stale/error durumu ve mesajı store.status'tadır; son iyi nesil korunur */
    } finally {
      loader.sync();
    }
  }, [store, loader]);

  const pickDirectory = useCallback(async () => {
    try {
      const next = await DirectoryGenerationSource.pick();
      setSourceMessage(null);
      setSource(next);
      return true;
    } catch (error) {
      setSourceMessage(failureMessage(error));
      return false;
    }
  }, []);

  const importFiles = useCallback(async (files: DirectoryFiles | null | undefined) => {
    try {
      const next = DirectoryFileListSource.fromFiles(files);
      setSourceMessage(null);
      setSource(next);
      return true;
    } catch (error) {
      setSourceMessage(failureMessage(error));
      return false;
    }
  }, []);

  const value = useMemo<GenerationContextValue>(
    () => ({
      state: status.state,
      manifest,
      generationId: status.generationId,
      lastReadAt: status.lastReadAt,
      lastGoodAt: status.lastGoodAt,
      message: status.message,
      refresh,
      pickDirectory,
      canPickDirectory: DirectoryGenerationSource.isSupported(),
      importFiles,
      canImportFiles: DirectoryFileListSource.isSupported(),
      source: { kind: source.kind, label: source.label },
      sourceMessage,
      importRequired: source instanceof UnselectedGenerationSource,
      store,
      loader,
      changeSet,
      changeSetMessage,
      changeVersion,
      bumpChange,
    }),
    [status, manifest, refresh, pickDirectory, importFiles, source, sourceMessage, store, loader, changeSet, changeSetMessage, changeVersion, bumpChange],
  );

  return <GenerationContext.Provider value={value}>{children}</GenerationContext.Provider>;
}

function useGenerationContext(): GenerationContextValue {
  const value = useContext(GenerationContext);
  if (!value) throw new Error('Hata: useGeneration yalnız GenerationProvider içinde kullanılabilir');
  return value;
}

// --- Hook'lar --------------------------------------------------------------------------------------------
export function useGeneration(): GenerationHandle {
  const { state, manifest, generationId, lastReadAt, lastGoodAt, message, refresh, pickDirectory, canPickDirectory, source, sourceMessage, importRequired } =
    useGenerationContext();
  return useMemo(
    () => ({ state, manifest, generationId, lastReadAt, lastGoodAt, message, refresh, pickDirectory, canPickDirectory, source, sourceMessage, importRequired }),
    [state, manifest, generationId, lastReadAt, lastGoodAt, message, refresh, pickDirectory, canPickDirectory, source, sourceMessage, importRequired],
  );
}

/** Klasör içe aktarma yüzeyi (Veri sayfası): Chromium'da klasör seçici, Safari/WebKit'te dosya listesi. */
export function useGenerationImport(): GenerationImportHandle {
  const { pickDirectory, canPickDirectory, importFiles, canImportFiles, source, sourceMessage, importRequired } = useGenerationContext();
  return useMemo(
    () => ({ pickDirectory, canPickDirectory, importFiles, canImportFiles, source, sourceMessage, importRequired }),
    [pickDirectory, canPickDirectory, importFiles, canImportFiles, source, sourceMessage, importRequired],
  );
}

/**
 * Koleksiyonu (kapsam başına) bir kez yükler; nesilde olmayan koleksiyon boş ve hatasız döner (sayfa "Kaynakta kayıt
 * yok" der). options.periods verilirse yalnız o dönemlerin parçaları okunur; satırlar kapsamın satırlarıdır (koleksiyon
 * boş mu sorusu için manifest.counts[name] kullanın). Dönem dizisi içerikle karşılaştırılır; her render'da yeni dizi
 * vermek güvenlidir. Bileşen kalkınca (rota değişimi) başka bekleyeni olmayan yükleme iptal edilir.
 */
export function useCollection<K extends CollectionName>(name: K, options?: CollectionLoadOptions): CollectionSnapshot<CollectionRecord<K>> {
  const { loader } = useGenerationContext();
  const periodsKey = options?.periods ? JSON.stringify([...options.periods].sort()) : null;
  const periods = useMemo<readonly string[] | undefined>(() => (periodsKey === null ? undefined : (JSON.parse(periodsKey) as string[])), [periodsKey]);
  useEffect(() => {
    const controller = new AbortController();
    void loader.ensure(name, periods ? { periods, signal: controller.signal } : { signal: controller.signal });
    return () => controller.abort();
  }, [loader, name, periods]);
  const subscribe = useCallback((listener: () => void) => loader.subscribe(listener), [loader]);
  const read = useCallback(() => loader.snapshot(name, periods ? { periods } : undefined), [loader, name, periods]);
  return useSyncExternalStore(subscribe, read, read) as CollectionSnapshot<CollectionRecord<K>>;
}

interface KindData {
  /** Değişiklik kümesi uygulanmış kayıtlar. */
  records: readonly PurchaseNeedRecord[];
  indexes: GenerationIndexes;
  queryContext: QueryContext;
  loading: boolean;
  error: string | null;
}

/** Tür koleksiyonu + indeks için gereken yardımcı koleksiyonlar; overlay indeksten önce uygulanır. */
function useKindData(kind: string): KindData {
  const collection = collectionForKind(kind);
  const { changeSet, changeVersion } = useGenerationContext();
  const main = useCollection(collection);
  const rooms = useCollection('rooms');
  const terms = useCollection('terms');
  const relations = useCollection('relations');
  const media = useCollection('media_references');
  const vocabularies = useCollection('vocabularies');
  const parts = [main, rooms, terms, relations, media, vocabularies];
  const loading = parts.some((part) => part.loading);
  const error = parts.find((part) => part.error !== null)?.error ?? null;

  // changeVersion bağımlılığı: add/undo sonrası aynı changeSet nesnesiyle yeniden uygulanır.
  const records = useMemo<readonly PurchaseNeedRecord[]>(
    () => (changeSet ? changeSet.apply(main.rows) : main.rows),
    [changeSet, changeVersion, main.rows],
  );
  const indexes = useMemo(() => {
    const collections: GenerationCollections = {
      [collection]: records,
      rooms: rooms.rows,
      terms: terms.rows,
      relations: relations.rows,
      media_references: media.rows,
      vocabularies: vocabularies.rows,
    };
    return buildIndexes(collections);
  }, [collection, records, rooms.rows, terms.rows, relations.rows, media.rows, vocabularies.rows]);
  const queryContext = useMemo(() => createQueryContext({ terms: terms.rows, media: media.rows }), [terms.rows, media.rows]);

  return useMemo(() => ({ records, indexes, queryContext, loading, error }), [records, indexes, queryContext, loading, error]);
}

/** Tür için liste/tablo/kanban satırları. Yüklenirken boş dizi; yükleme durumu için useCollection(collectionForKind(kind)). */
export function useRows(kind: string): RecordRow[] {
  const { records, indexes } = useKindData(kind);
  return useMemo(() => records.map((record) => toRecordRow(record, indexes)), [records, indexes]);
}

export interface QueryResult {
  /** Eşleşen kayıt kimlikleri; altı görünüm aynı kümeyi kullanır. */
  ids: ReadonlySet<string>;
  /** Eşleşen satırlar, AST sıralamasıyla. */
  rows: RecordRow[];
  /** Boyut sayımları (kendi seçimi hariç, diğer filtrelerle). */
  counts: FacetCounts;
  /** Filtre öncesi kayıt sayısı. */
  total: number;
  loading: boolean;
  error: string | null;
}

/** Sorgu AST'sini türün kayıtlarına uygular. AST içerik olarak karşılaştırılır; her render'da yeni nesne vermek güvenlidir. */
export function useQuery(kind: string, ast: QueryAst): QueryResult {
  const { records, indexes, queryContext, loading, error } = useKindData(kind);
  // AST içerik anahtarıyla sabitlenir: aynı içerikli yeni nesne yeniden hesaplatmaz.
  const astKey = JSON.stringify(ast);
  const stableAst = useMemo(() => ast, [astKey]);

  const queryRows = useMemo<readonly QueryRow[]>(() => records.map((record) => toQueryRow(record, queryContext)), [records, queryContext]);
  const matched = useMemo(() => runQuery(queryRows, stableAst, queryContext), [queryRows, stableAst, queryContext]);
  const ids = useMemo<ReadonlySet<string>>(() => new Set(matched.map((row) => row.id)), [matched]);
  const rows = useMemo(() => {
    const byId = new Map(records.map((record) => [record.id, record] as const));
    const out: RecordRow[] = [];
    for (const match of matched) {
      const record = byId.get(match.id);
      if (record) out.push(toRecordRow(record, indexes));
    }
    return out;
  }, [matched, records, indexes]);
  const counts = useMemo(() => facetCounts(queryRows, stableAst, queryContext), [queryRows, stableAst, queryContext]);

  return useMemo(() => ({ ids, rows, counts, total: queryRows.length, loading, error }), [ids, rows, counts, queryRows.length, loading, error]);
}

export interface ChangeSetHandle {
  /** Küme yüklendi mi (kapalıysa veya yüklenemediyse false). */
  ready: boolean;
  persistence: 'ok' | 'unavailable' | null;
  /** Yükleme hatası "Hata: …"; aksi null. */
  message: string | null;
  ops: readonly ChangeOp[];
  pending: number;
  add(input: ChangeInput): Promise<ChangeOp>;
  undo(opId: string): Promise<UndoResult>;
  pendingFor(recordId: string): readonly ChangeOp[];
  /** Apps Script batch biçimine dönüştürür; göndermez. Küme yoksa null. */
  toBatch(records: readonly OverlayRecord[]): BatchConversion | null;
}

const NOT_READY = 'Hata: değişiklik kümesi henüz hazır değil';

/** Yerel değişiklik kümesi (IndexedDB, idempotent op, undo). Sheets'e yazma bu dilimde yok. */
export function useChangeSet(): ChangeSetHandle {
  const { changeSet, changeSetMessage, changeVersion, bumpChange } = useGenerationContext();
  return useMemo<ChangeSetHandle>(
    () => ({
      ready: changeSet !== null,
      persistence: changeSet?.persistence ?? null,
      message: changeSetMessage,
      ops: changeSet?.ops ?? EMPTY,
      pending: changeSet?.pending ?? 0,
      async add(input) {
        if (!changeSet) throw new Error(NOT_READY);
        const op = await changeSet.add(input);
        bumpChange();
        return op;
      },
      async undo(opId) {
        if (!changeSet) return { ok: false, reason: NOT_READY };
        const result = await changeSet.undo(opId);
        bumpChange();
        return result;
      },
      pendingFor: (recordId) => changeSet?.pendingFor(recordId) ?? EMPTY,
      toBatch: (records) => (changeSet ? changeSet.toBatch(records) : null),
    }),
    // changeVersion bağımlılığı: ops/pending getter'ları aynı nesnede değişir; sürüm artışı yeni handle üretir.
    [changeSet, changeSetMessage, changeVersion, bumpChange],
  );
}
