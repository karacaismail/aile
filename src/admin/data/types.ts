// Veri platformu sözleşmesi (data-platform/schemas/*.json, normalize.mjs, taxonomy.mjs). Panel yalnız doğrulanmış
// JSON neslini okur. Bilinmeyen alanlar unknown kalır; gerçek nesil Git dışındadır, burada yalnız tipler var.

export type UUID = string;
/** "^-?[0-9]+(\.[0-9]+)?$" — para ve ölçüler metin ondalıktır; sayıya çevirip yuvarlama panelde yapılmaz. */
export type Decimal = string;
/** ISO tarih (YYYY-MM-DD). */
export type IsoDate = string;
export type Money = { amount: Decimal; currency: string } | null;

export interface Provenance {
  source_key: string;
  source_id: UUID;
  sheet_id: number;
  sheet_title: string;
  row: number;
  column: number | null;
  a1: string;
}

export type ManifestFileKind = 'partition' | 'raw' | 'schema' | 'contract';
export interface ManifestFile {
  path: string;
  kind: ManifestFileKind;
  sha256: string;
  bytes: number;
  collection?: string;
  count?: number;
}
export interface Manifest {
  schemaVersion: 1;
  generation_id: string;
  tenant_id: UUID;
  storage_policy: 'private_only';
  files: ManifestFile[];
  counts: Record<string, number>;
  sources: Record<string, unknown>[];
  consistency?: 'snapshot_capture_not_transaction';
}

export interface PartitionEnvelope<R = BaseRecord> {
  schemaVersion: 1;
  collection: string;
  records: R[];
}

export interface BaseRecord {
  id: UUID;
  tenant_id: UUID;
  kind?: string;
  label?: string;
  source_id?: UUID;
  source_record_id?: string;
  source_attributes?: Record<string, unknown>;
  attributes?: Record<string, unknown>;
  provenance?: Provenance | null;
  deleted_at?: string | null;
}

export type StateAxis = 'decision' | 'fulfillment' | 'inspection' | 'payment';
export type StateSnapshot = Record<StateAxis, string | null>;
export type StateTermIds = Record<StateAxis, UUID | null>;

/** normalize.mjs › app_kalemler satırı (kind purchase_need); lighting_spec/work_order/… aynı gövdeyi paylaşır. */
export interface PurchaseNeedRecord extends BaseRecord {
  kind: 'purchase_need' | 'lighting_spec' | 'work_order' | 'layout_item' | 'inspection' | 'automation_scene' | 'milestone' | 'unclassified_item' | string;
  category_term_id: UUID | null;
  phase_term_id: UUID | null;
  context_term_ids: UUID[];
  legacy_status_term_id?: UUID | null;
  state_snapshot: StateSnapshot;
  state_term_ids: StateTermIds;
  /** Plan ve gerçek ayrı tutulur; panel ikisini tek sayıda birleştirmez. */
  amounts: {
    planned?: Money;
    actual?: Money;
    estimated_min?: Money;
    estimated_max?: Money;
    recorded_price?: Money;
    quote?: Money;
  };
  dates: {
    planned_on?: IsoDate | null;
    order_due_on?: IsoDate | null;
    delivered_on?: IsoDate | null;
    payment_on?: IsoDate | null;
    end_on?: IsoDate | null;
  };
  room_id: UUID | null;
}

export interface Vocabulary extends BaseRecord { key: string; managed: boolean }
export interface Term extends BaseRecord { vocabulary_id: UUID; code: string; label: string; parent_id: UUID | null; legacy: boolean }

export interface Room extends BaseRecord { kind: 'room'; setting_id: UUID; code: string }
export interface SettingRecord extends BaseRecord { kind: 'setting' | 'room' }

export type RelationKind = 'located_in' | 'associated_with' | 'depends_on' | 'payment_for' | string;
export interface Relation extends BaseRecord { kind: RelationKind; source_id: UUID; target_id: UUID }

export interface MediaReference extends BaseRecord {
  entity_id: UUID;
  url: string;
  kind: 'image_candidate' | 'web_reference' | string;
  /** Yalnız 'verified' görsel gösterilir; aksi "Fotoğraf yok". */
  verification: 'not_verified' | 'verified' | string;
  rights_status: 'unknown' | string;
}

export interface BudgetObservation extends BaseRecord {
  kind: 'budget_observation';
  label: string;
  /** YYYY-MM */
  period: string;
  value: { decimal: Decimal | null; currency: string | null };
  basis: 'planned' | 'recorded_aggregate' | 'unclassified' | string;
  payment_evidence: boolean;
}

export interface Forecast extends BaseRecord { [key: string]: unknown }
export interface ForecastEvent extends BaseRecord { occurred_on?: IsoDate | null; amount?: Money; [key: string]: unknown }
export interface ForecastMonth extends BaseRecord { period?: string; [key: string]: unknown }

export interface Issue extends BaseRecord {
  code: string;
  severity: 'review' | string;
  detail?: unknown;
}

export interface ViewDefinition extends BaseRecord {
  key: string;
  version: number;
  status: 'proposed_template' | string;
  [key: string]: unknown;
}

export interface WorkflowTransition { from_term_id: UUID | undefined; to_term_id: UUID | undefined; requires_evidence: boolean }
export interface WorkflowDefinition extends BaseRecord {
  key: string;
  version: number;
  status: 'proposed_template' | string;
  vocabulary_id: UUID;
  transitions: WorkflowTransition[];
}

export interface TaskTemplate extends BaseRecord {
  key: string;
  kind: 'task_template';
  version: number;
  workflow_id: UUID;
  dependency_template_ids: UUID[];
  [key: string]: unknown;
}

export interface SourceRecord extends BaseRecord { key?: string; [key: string]: unknown }
export interface SheetRecord extends BaseRecord { source_id: UUID; properties: Record<string, unknown>; nonempty_cell_count: number; nonempty_row_count: number }

/** Panelin indirdiği koleksiyonlar; source_cells / source_rows ağırdır, indirilmez. */
export type CollectionName =
  | 'purchase_needs' | 'lighting_specs' | 'work_orders' | 'layout_items' | 'inspections' | 'automation_scenes' | 'milestones'
  | 'rooms' | 'settings' | 'relations' | 'media_references' | 'budget_observations' | 'forecasts' | 'forecast_events' | 'forecast_months'
  | 'vocabularies' | 'terms' | 'workflows' | 'view_definitions' | 'task_templates' | 'issues' | 'sources' | 'sheets' | 'supplements';

export type GenerationState = 'idle' | 'checking' | 'ready' | 'stale' | 'error';
