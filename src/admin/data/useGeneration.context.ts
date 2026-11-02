// Nesil bağlamı (GenerationProvider değeri), sayfa hook'ları (useGeneration, useGenerationImport, useCollection,
// useChangeSet) ve kayıt türü → koleksiyon eşlemesi. Sağlayıcı (useGeneration.provider.tsx) ve satır/sorgu katmanı
// (useGeneration.rows.tsx) bağlamı buradan alır; hiçbiri diğerini çalışma zamanında döngüsel içe aktarmaz. Telefon girişi
// (App → GenerationProvider) indeks ve sorgu katmanını statik çekmez; sayfa parçaları ortak modülleri girişi bölmeden
// paylaşır. useGeneration.tsx ve barrel ('../data') buradaki genel adları aynen yeniden dışa verir; davranış önceki tek
// dosyadaki tanımla aynıdır.
import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { BatchConversion, ChangeInput, ChangeOp, ChangeSet, OverlayRecord, UndoResult } from './changeSet';
import type { DirectoryFiles } from './sources';
import type { GenerationStore } from './store';
import type {
  BaseRecord,
  BudgetObservation,
  CollectionName,
  Forecast,
  ForecastEvent,
  ForecastMonth,
  Issue,
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
import type { CollectionLoader, GenerationHandle, GenerationImportHandle } from './useGeneration.provider';

const EMPTY: readonly never[] = Object.freeze([]);

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

// --- Koleksiyon anlık görüntüsü -------------------------------------------------------------------------
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

// --- Bağlam ---------------------------------------------------------------------------------------------
/** Sağlayıcının bağlam değeri (iç yüzey; sayfalar useGeneration / useCollection / useChangeSet kullanır). */
export interface GenerationContextValue extends GenerationHandle {
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

export const GenerationContext = createContext<GenerationContextValue | null>(null);

export function useGenerationContext(): GenerationContextValue {
  const value = useContext(GenerationContext);
  if (!value) throw new Error('Hata: useGeneration yalnız GenerationProvider içinde kullanılabilir');
  return value;
}

// --- Hook'lar --------------------------------------------------------------------------------------------
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

/**
 * Değişiklik kümesi örneği ve sürümü: kayıt katmanı (useRows/useQuery) bunu satırlara uygular. Sayfalar değişiklik
 * kümesine useChangeSet ile erişir.
 */
export function useChangeOverlay(): { changeSet: ChangeSet | null; changeVersion: number } {
  const { changeSet, changeVersion } = useGenerationContext();
  return { changeSet, changeVersion };
}

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
