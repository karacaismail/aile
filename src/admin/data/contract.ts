// Veri platformu sözleşmesinin çalışma zamanı doğrulaması (Zod). Kaynak: data-platform/schemas/partition.schema.json,
// manifest.schema.json ve normalize.mjs çıktısı; types.ts ile aynı alan adları. Panel yalnız doğrulanmış JSON neslini okur:
// hatalı veri ZodError ile reddedilir, bilinmeyen alanlar kaybolmaz (loose object). Para ve ölçüler metin ondalıktır; burada
// hiçbir değer sayıya çevrilmez, boş metin sıfıra dönmez. Saf TS: React/antd yok.
import { z } from 'zod';
import type { CollectionName } from './types';

// --- Skaler yapı taşları ----------------------------------------------------------------------------
/** "^-?[0-9]+(\.[0-9]+)?$" — "1,5", "", "1." ve sayı tipi reddedilir. */
export const Decimal = z.string().regex(/^-?[0-9]+(\.[0-9]+)?$/, 'Ondalık metin bekleniyor (ör. "8500.00")');
export const Currency = z.string().regex(/^[A-Z]{3}$/, 'ISO 4217 para birimi bekleniyor (ör. "TRY")');
/** Para zarfı; alan dışı anahtar kabul edilmez (şema additionalProperties: false). */
export const Money = z.strictObject({ amount: Decimal, currency: Currency });
export const NullableMoney = Money.nullable();
/** ISO gün (YYYY-MM-DD); takvim geçerliliği denetlenir, saatli ISO reddedilir. */
export const IsoDate = z.iso.date();
export const NullableIsoDate = IsoDate.nullable();
/** Bütçe dönemi YYYY-MM. */
export const Period = z.string().regex(/^[0-9]{4}-(0[1-9]|1[0-2])$/, 'Dönem YYYY-MM bekleniyor');
export const Uuid = z.uuid();
export const NullableUuid = Uuid.nullable();
const NonEmpty = z.string().min(1);

export const Provenance = z.looseObject({
  source_key: z.string(),
  source_id: Uuid,
  sheet_id: z.int(),
  sheet_title: z.string(),
  row: z.int().min(1),
  column: z.int().min(1).nullable(),
  a1: z.string(),
});

// --- Manifest ---------------------------------------------------------------------------------------
export const ManifestFile = z.looseObject({
  path: z.string(),
  kind: z.enum(['partition', 'raw', 'schema', 'contract']),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  bytes: z.int().min(0),
  collection: z.string().optional(),
  count: z.int().min(0).optional(),
});

export const Manifest = z.looseObject({
  schemaVersion: z.literal(1),
  generation_id: NonEmpty,
  tenant_id: Uuid,
  storage_policy: z.literal('private_only'),
  files: z.array(ManifestFile),
  counts: z.record(z.string(), z.int().min(0)),
  sources: z.array(z.looseObject({})),
  consistency: z.literal('snapshot_capture_not_transaction').optional(),
});

// --- Kayıt çekirdeği ---------------------------------------------------------------------------------
export const BaseRecord = z.looseObject({
  id: Uuid,
  tenant_id: Uuid,
  kind: z.string().optional(),
  label: z.string().optional(),
  source_id: Uuid.optional(),
  source_record_id: z.string().optional(),
  source_attributes: z.record(z.string(), z.unknown()).optional(),
  attributes: z.record(z.string(), z.unknown()).optional(),
  provenance: Provenance.nullable().optional(),
  deleted_at: z.string().nullable().optional(),
});

const StateAxisKeys = ['decision', 'fulfillment', 'inspection', 'payment'] as const;
export const StateSnapshot = z.looseObject(
  Object.fromEntries(StateAxisKeys.map((k) => [k, z.string().nullable()])) as Record<(typeof StateAxisKeys)[number], z.ZodNullable<z.ZodString>>,
);
export const StateTermIds = z.looseObject(
  Object.fromEntries(StateAxisKeys.map((k) => [k, NullableUuid])) as Record<(typeof StateAxisKeys)[number], typeof NullableUuid>,
);

/** app_kalemler satırı: purchase_need; lighting_spec, work_order, layout_item, inspection, automation_scene, milestone aynı gövde. */
export const PurchaseNeed = BaseRecord.extend({
  kind: z.string(),
  category_term_id: NullableUuid,
  phase_term_id: NullableUuid,
  context_term_ids: z.array(Uuid),
  legacy_status_term_id: NullableUuid.optional(),
  state_snapshot: StateSnapshot,
  state_term_ids: StateTermIds,
  /** Plan ve gerçek ayrı alanlardır; panel bunları tek sayıda birleştirmez. */
  amounts: z.looseObject({
    planned: NullableMoney.optional(),
    actual: NullableMoney.optional(),
    estimated_min: NullableMoney.optional(),
    estimated_max: NullableMoney.optional(),
    recorded_price: NullableMoney.optional(),
    quote: NullableMoney.optional(),
  }),
  dates: z.looseObject({
    planned_on: NullableIsoDate.optional(),
    order_due_on: NullableIsoDate.optional(),
    delivered_on: NullableIsoDate.optional(),
    payment_on: NullableIsoDate.optional(),
    end_on: NullableIsoDate.optional(),
  }),
  room_id: NullableUuid,
});

// --- Sözlük -----------------------------------------------------------------------------------------
export const Vocabulary = BaseRecord.extend({ key: NonEmpty, managed: z.boolean() });
export const Term = BaseRecord.extend({
  vocabulary_id: Uuid,
  code: NonEmpty,
  label: z.string(),
  /** Üst terim (ağaç); nesilde parent_id, eski adı parent_term_id. */
  parent_id: NullableUuid.optional(),
  parent_term_id: NullableUuid.optional(),
  legacy: z.boolean().optional(),
  order: z.int().optional(),
  active: z.boolean().optional(),
});

// --- Mekân -------------------------------------------------------------------------------------------
export const Room = BaseRecord.extend({ kind: z.literal('room'), setting_id: Uuid, code: NonEmpty });
export const Setting = BaseRecord.extend({ kind: z.enum(['setting', 'room']) });

// --- İlişki, medya ------------------------------------------------------------------------------------
export const Relation = BaseRecord.extend({ kind: NonEmpty, source_id: Uuid, target_id: Uuid });

export const MediaReference = BaseRecord.extend({
  entity_id: Uuid,
  url: z.url(),
  kind: z.string(),
  /** Yalnız 'verified' gösterilir; aksi "Fotoğraf yok". */
  verification: z.string(),
  rights_status: z.string(),
  license: z.string().nullable().optional(),
});

// --- Bütçe ve tahmin ----------------------------------------------------------------------------------
export const BudgetObservation = BaseRecord.extend({
  kind: z.literal('budget_observation'),
  label: z.string(),
  period: Period,
  value: z.looseObject({ decimal: Decimal.nullable(), currency: Currency.nullable() }),
  basis: z.string(),
  payment_evidence: z.boolean(),
});

const Measures = z.record(z.string(), NullableMoney);
export const Forecast = BaseRecord.extend({ kind: z.literal('forecast').optional(), status: z.string().optional() });
export const ForecastEvent = BaseRecord.extend({
  forecast_id: Uuid.optional(),
  event_type: z.string().optional(),
  occurred_on: NullableIsoDate.optional(),
  amount: NullableMoney.optional(),
  cash_change: NullableMoney.optional(),
  measures: Measures.optional(),
  certainty: z.string().optional(),
});
export const ForecastMonth = BaseRecord.extend({ forecast_id: Uuid.optional(), period: Period.optional(), measures: Measures.optional() });

// --- Kalite ve tanımlar -------------------------------------------------------------------------------
export const Issue = BaseRecord.extend({ code: NonEmpty, severity: z.string(), detail: z.unknown().optional() });

export const ViewDefinition = BaseRecord.extend({
  key: NonEmpty,
  version: z.int(),
  status: z.string(),
  label: z.string().optional(),
  capabilities: z.array(z.string()).optional(),
  supported_kinds: z.array(z.string()).optional(),
  required_fields: z.array(z.string()).optional(),
  sort_fields: z.array(z.string()).optional(),
  primary_field_by_kind: z.record(z.string(), z.string()).optional(),
  date_field_by_kind: z.record(z.string(), z.string()).optional(),
  date_basis_by_kind: z.record(z.string(), z.string()).optional(),
  /** kanban: kind → eksen adları (ör. purchase_need → ["decision","fulfillment"]). */
  state_axes: z.record(z.string(), z.array(z.string())).optional(),
  missing_data_policy: z.unknown().optional(),
  aggregation: z.looseObject({}).nullable().optional(),
});

export const WorkflowTransition = z.looseObject({
  from_term_id: Uuid.optional(),
  to_term_id: Uuid.optional(),
  requires_evidence: z.boolean(),
});
export const WorkflowDefinition = BaseRecord.extend({
  key: NonEmpty,
  version: z.int(),
  status: z.string(),
  vocabulary_id: Uuid,
  transitions: z.array(WorkflowTransition),
});

export const TaskTemplate = BaseRecord.extend({
  key: NonEmpty,
  kind: z.literal('task_template'),
  version: z.int(),
  workflow_id: Uuid,
  dependency_template_ids: z.array(Uuid),
});

// --- Kaynak katmanı -----------------------------------------------------------------------------------
export const SourceRecord = BaseRecord.extend({ key: z.string().optional() });
export const SheetRecord = BaseRecord.extend({
  source_id: Uuid,
  properties: z.record(z.string(), z.unknown()),
  nonempty_cell_count: z.int().min(0),
  nonempty_row_count: z.int().min(0),
});
export const Supplement = BaseRecord.extend({ key: z.string().optional(), classification: z.string().optional() });

// --- Zarf --------------------------------------------------------------------------------------------
const CollectionKey = z.string().regex(/^[a-z_]+$/);

/** Belirli bir kayıt şemasına bağlı partition zarfı. */
export function partitionEnvelope<R extends z.ZodType>(records: R) {
  return z.object({ schemaVersion: z.literal(1), collection: CollectionKey, records: z.array(records) });
}
/** Koleksiyondan bağımsız zarf (yalnız çekirdek alanlar). */
export const PartitionEnvelope = partitionEnvelope(BaseRecord);

/** Panelin indirdiği her koleksiyonun kayıt şeması. payments / providers nesilde YOK; burada da yok. */
export const collectionSchemas = {
  purchase_needs: PurchaseNeed,
  lighting_specs: PurchaseNeed,
  work_orders: PurchaseNeed,
  layout_items: PurchaseNeed,
  inspections: PurchaseNeed,
  automation_scenes: PurchaseNeed,
  milestones: PurchaseNeed,
  rooms: Room,
  settings: Setting,
  relations: Relation,
  media_references: MediaReference,
  budget_observations: BudgetObservation,
  forecasts: Forecast,
  forecast_events: ForecastEvent,
  forecast_months: ForecastMonth,
  vocabularies: Vocabulary,
  terms: Term,
  workflows: WorkflowDefinition,
  view_definitions: ViewDefinition,
  task_templates: TaskTemplate,
  issues: Issue,
  sources: SourceRecord,
  sheets: SheetRecord,
  supplements: Supplement,
} satisfies Record<CollectionName, z.ZodType>;

export type ParsedManifest = z.infer<typeof Manifest>;
export type ParsedRecord<K extends CollectionName> = z.infer<(typeof collectionSchemas)[K]>;
export type ParsedPartition<K extends CollectionName> = { schemaVersion: 1; collection: string; records: ParsedRecord<K>[] };

export function parseManifest(input: unknown): ParsedManifest {
  return Manifest.parse(input);
}

/** Zarfı koleksiyonun kendi şemasıyla doğrular; zarftaki collection adı istenenle eşleşmezse ZodError. */
export function parsePartition<K extends CollectionName>(collection: K, input: unknown): ParsedPartition<K> {
  const schema = (collectionSchemas as Record<string, z.ZodType | undefined>)[collection];
  if (!schema) throw new Error(`Hata: bilinmeyen koleksiyon "${collection}"`);
  const envelope = z.object({ schemaVersion: z.literal(1), collection: z.literal(collection), records: z.array(schema) });
  return envelope.parse(input) as ParsedPartition<K>;
}
