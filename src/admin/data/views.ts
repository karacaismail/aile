// view_definitions okuyucu. Saf TS: React/antd yok. Girdi, nesildeki view_definitions parçası ya da
// data-platform/dictionaries/views.json ile aynı biçimdeki bildirimsel tanımlardır (taxonomy.mjs ikisini
// aynı gövdeden üretir). Tanımlar yürütülebilir UI içermez; burada yalnız hangi tür hangi modda görünür,
// görünmeyen modun Türkçe gerekçesi ve pivotta hangi ölçünün toplanabildiği türetilir.
import { VIEW_LABELS, VIEW_MODES, type ViewMode } from '../shell/contracts';
import type { ViewDefinition } from './types';

/** Sözlük (views.json) satırı ya da nesil kaydı; panelin okuduğu alanlar dışında kalanlar unknown kalır. */
export interface ViewDefinitionInput {
  key: string;
  version?: number;
  supported_kinds?: readonly string[];
  aggregation?: PivotAggregation | null;
  deleted_at?: string | null;
  [field: string]: unknown;
}

export interface PivotAggregation {
  allowed?: readonly string[];
  sum_measures?: Readonly<Record<string, string>>;
  required_dimensions?: readonly string[];
  ownership_rule?: string;
}

export type PivotMeasure =
  | { id: 'count'; label: string; aggregate: 'count' }
  | { id: string; label: string; aggregate: 'sum'; field: string; basis: string; currencyField: string };

export interface ViewCatalog {
  /** Türün görünebildiği modlar, VIEW_MODES sırasında. */
  supportedModes(kind: string): ViewMode[];
  /** Mod destekleniyorsa null; değilse "<Mod> kullanılamaz: …" biçiminde Türkçe gerekçe. */
  unsupportedReason(kind: string, mode: ViewMode): string | null;
  /** Yalnız sahipliği belirlenmiş ölçüler; plan ve gerçek ayrı ölçülerdir, tahmin toplanmaz. */
  pivotMeasures(kind: string): PivotMeasure[];
  /** Geçerli (en yüksek sürümlü, silinmemiş) tanım; nesilde yoksa undefined. */
  definition(mode: ViewMode): ViewDefinitionInput | undefined;
}

interface PartitionLike { schemaVersion: number; collection: string; records: readonly unknown[] }

/** Nesil parçasını (data/view_definitions/<partition>/<chunk>.json) doğrular, silinmişleri atar. */
export function readViewDefinitions(envelope: PartitionLike): ViewDefinitionInput[] {
  if (envelope.schemaVersion !== 1) throw new Error(`Hata: view_definitions parçası schemaVersion 1 bekler, ${String(envelope.schemaVersion)} geldi.`);
  if (envelope.collection !== 'view_definitions') throw new Error(`Hata: view_definitions bekleniyordu, ${envelope.collection} parçası geldi.`);
  const out: ViewDefinitionInput[] = [];
  for (const record of envelope.records) {
    if (!isViewDefinitionInput(record)) continue;
    if (record.deleted_at) continue;
    out.push(record);
  }
  return out;
}

function isViewDefinitionInput(value: unknown): value is ViewDefinitionInput & Partial<ViewDefinition> {
  return typeof value === 'object' && value !== null && typeof (value as { key?: unknown }).key === 'string';
}

function isViewMode(key: string): key is ViewMode {
  return (VIEW_MODES as readonly string[]).includes(key);
}

// --- Türkçe tür adları (tamlayan hâl: "alımların …") ----------------------------------------------
const KIND_GENITIVE: Readonly<Record<string, string>> = {
  purchase_need: 'alımların',
  lighting_spec: 'aydınlatma özelliklerinin',
  work_order: 'işlerin',
  layout_item: 'yerleşim öğelerinin',
  inspection: 'kontrollerin',
  automation_scene: 'senaryoların',
  milestone: 'kilometre taşlarının',
  unclassified_item: 'sınıflanmamış kayıtların',
  provider: 'tarafların',
  payment: 'ödemelerin',
  budget_observation: 'bütçe gözlemlerinin',
  forecast: 'tahminlerin',
  forecast_event: 'tahmin olaylarının',
  forecast_month: 'tahmin aylarının',
};

function kindGenitive(kind: string): string {
  return KIND_GENITIVE[kind] ?? 'bu kayıtların';
}

/** Modun bu tür için neden anlamsız olduğu; tanımın required_fields / state_axes mantığını Türkçe söyler. */
const MODE_REASON: Readonly<Record<ViewMode, (kind: string) => string>> = {
  listing: (kind) => `${kindGenitive(kind)} liste görünümü tanımlı değil.`,
  table: (kind) => `${kindGenitive(kind)} tablo görünümü tanımlı değil.`,
  timeline: (kind) => `${kindGenitive(kind)} zaman çizelgesine yerleşecek tarih alanı yok.`,
  kanban: (kind) => `${kindGenitive(kind)} sütun olacak tek durum ekseni yok.`,
  gantt_chart: (kind) => `${kindGenitive(kind)} başlangıç ve bitiş tarihi yok.`,
  pivot: (kind) => `${kindGenitive(kind)} sahipliği belirlenmiş toplanabilir ölçüsü yok.`,
};

// --- Pivot sahiplik haritası ------------------------------------------------------------------------
// Sözlükteki aggregation.sum_measures tek başına toplama izni vermez (ownership_rule). Toplanabilir
// ölçü yalnız burada, tür + alan + basis üçlüsüyle açıkça sahiplenilmiş olanlardır. budget_observation
// basis'leri ayrı ölçüdür ("plan ve gerçek asla tek sayıda birleşmez"); 'unclassified' basis'in sahibi
// yok. forecast_* tahmindir, toplanmaz. payment nesilde koleksiyon değildir ve leaf-row haritası yoktur.
interface OwnedSum { field: string; currencyField: string; bases: readonly { basis: string; id: string; label: string }[] }
const OWNED_SUMS: Readonly<Record<string, OwnedSum>> = {
  budget_observation: {
    field: 'value.decimal',
    currencyField: 'value.currency',
    bases: [
      { basis: 'planned', id: 'sum_planned', label: 'Plan toplamı' },
      { basis: 'recorded_aggregate', id: 'sum_recorded', label: 'Gerçekleşen toplamı' },
    ],
  },
};

export function createViewCatalog(definitions: readonly ViewDefinitionInput[]): ViewCatalog {
  // Aynı anahtarın birden çok sürümü varsa en yüksek sürüm geçerlidir; silinmiş tanım sayılmaz.
  const byMode = new Map<ViewMode, ViewDefinitionInput>();
  for (const def of definitions) {
    if (def.deleted_at || !isViewMode(def.key)) continue;
    const current = byMode.get(def.key);
    if (!current || (def.version ?? 0) > (current.version ?? 0)) byMode.set(def.key, def);
  }

  const supports = (mode: ViewMode, kind: string): boolean => {
    const def = byMode.get(mode);
    return Array.isArray(def?.supported_kinds) && def.supported_kinds.includes(kind);
  };

  const supportedModes = (kind: string): ViewMode[] => VIEW_MODES.filter((mode) => supports(mode, kind));

  const unsupportedReason = (kind: string, mode: ViewMode): string | null => {
    if (supports(mode, kind)) return null;
    const label = VIEW_LABELS[mode];
    if (!byMode.has(mode)) return `${label} kullanılamaz: görünüm tanımı nesilde yok.`;
    return `${label} kullanılamaz: ${MODE_REASON[mode](kind)}`;
  };

  const pivotMeasures = (kind: string): PivotMeasure[] => {
    const pivot = byMode.get('pivot');
    const owned = OWNED_SUMS[kind];
    // Sayım dahil hiçbir ölçü, satır sahipliği haritada olmayan tür için üretilmez (payment: nesilde koleksiyon yok).
    if (!pivot || !owned || !supports('pivot', kind)) return [];
    const allowed = pivot.aggregation?.allowed ?? [];
    const measures: PivotMeasure[] = [];
    if (allowed.includes('count')) measures.push({ id: 'count', label: 'Kayıt sayısı', aggregate: 'count' });
    const declaredField = pivot.aggregation?.sum_measures?.[kind];
    // Toplam yalnız tanım izin veriyorsa ve sözlükteki alan sahiplik haritasındaki alanla aynıysa; basis ölçüye gömülüdür.
    if (allowed.includes('sum') && declaredField === owned.field) {
      for (const { basis, id, label } of owned.bases) {
        measures.push({ id, label, aggregate: 'sum', field: owned.field, basis, currencyField: owned.currencyField });
      }
    }
    return measures;
  };

  return { supportedModes, unsupportedReason, pivotMeasures, definition: (mode) => byMode.get(mode) };
}

/** Masaüstünde Liste ve Zaman çizelgesi filtre paneli açık başlar; Tablo, Kanban, Gantt ve Pivot 56 px şerit kullanır. */
export function defaultFilterOpen(mode: ViewMode): boolean {
  return mode === 'listing' || mode === 'timeline';
}
