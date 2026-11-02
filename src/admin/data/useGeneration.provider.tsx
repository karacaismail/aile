// Nesil sağlayıcısı (GenerationProvider) ve koleksiyon yükleyicisi (CollectionLoader). Telefon girişi (App.tsx) bu
// modülü doğrudan içe aktarır (veri barrel'ı ve useGeneration.tsx değil): sağlayıcı ve bağlam (useGeneration.context.ts,
// sayfa hook'ları dahil) ilk boyamada gereklidir; tür satırları ve sorgu (useGeneration.rows.tsx: indexes.ts, query.ts)
// yalnız onları kullanan sayfanın parçasındadır. useGeneration.tsx bu modülün adlarını aynen yeniden dışa verir; davranış
// ve sözleşme useGeneration.tsx başlığındaki gibidir.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChangeSet } from './changeSet';
import { GenerationContext, type CollectionLoadOptions, type CollectionSnapshot, type GenerationContextValue } from './useGeneration.context';
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
import type { BaseRecord, CollectionName, GenerationState, Manifest } from './types';

// --- Yardımcılar -----------------------------------------------------------------------------------------
const EMPTY: readonly never[] = Object.freeze([]);

/** Hata metni her zaman "Hata: " ile başlar; depo zaten böyle üretiyorsa tekrar eklenmez. */
export function failureMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.startsWith('Hata: ') ? text : `Hata: ${text}`;
}

// --- Koleksiyon yükleyici (saf TS) ------------------------------------------------------------------------
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

export interface GenerationProviderProps {
  /**
   * undefined → defaultGenerationSource() (dev: HttpGenerationSource; üretim: seçilmemiş klasör, istek yok);
   * null → seçilmemiş klasör ("Klasör içe aktar" durumu). Kararlı referans verin; yalnız ilk değer kullanılır.
   */
  source?: GenerationSource | null;
  /** undefined → defaultPartitionCache() (geliştirmede IndexedDB; üretimde açık istek yoksa yok); null → önbellek yok. */
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
