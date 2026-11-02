// Veri platformu sözleşmesinin çalışma zamanı doğrulaması (Zod). Kaynaklar (salt okunur): data-platform/schemas/
// partition.schema.json ve manifest.schema.json, data-platform/postgres-mapping.json (alan/null/tip ve kontroller),
// data-platform/validate.mjs (üreticinin nesli yazmadan önceki kapısı) ve normalize/finance/taxonomy çıktısı.
// contract.drift.test.ts bu kaynaklarla kaymayı sınar: Zod hiçbir yerde JSON Şemasından gevşek değildir; daha sıkı olduğu
// yerler orada gerekçesiyle listelenir.
//
// Kurallar:
//  - Panel yalnız doğrulanmış JSON neslini okur; hatalı veri ZodError ile reddedilir.
//  - Bilinmeyen alanlar kaybolmaz: kayıt ve alt nesneler açık (loose) nesnedir. Şemanın kapalı tuttuğu iki yer (zarf ve para
//    zarfı, additionalProperties:false) bilinmeyen alanı sessizce düşürmez, reddeder.
//  - Yalnız schemaVersion 1 kabul edilir (manifest ve zarf).
//  - Para ve ölçüler metin ondalıktır; hiçbir değer sayıya çevrilmez, boş metin sıfıra dönmez, sayı tipindeki tutar reddedilir.
//  - Plan ve gerçek ayrı alanlardır; tahmin kaydı gerçek işlem iddia edemez; bütçe gözlemi ödeme kanıtı taşımaz.
// Saf TS: React/antd yok.
import { z } from 'zod';
import type { CollectionName } from './types';

// --- Skaler yapı taşları ----------------------------------------------------------------------------
/** "^-?[0-9]+(\.[0-9]+)?$" — "1,5", "", "1.", "1e3", " 1" ve sayı tipi reddedilir. */
export const Decimal = z.string().regex(/^-?[0-9]+(\.[0-9]+)?$/, 'Ondalık metin bekleniyor (ör. "8500.00")');
export const Currency = z.string().regex(/^[A-Z]{3}$/, 'ISO 4217 para birimi bekleniyor (ör. "TRY")');
/** Para zarfı; alan dışı anahtar kabul edilmez (şema additionalProperties: false). */
export const Money = z.strictObject({ amount: Decimal, currency: Currency });
export const NullableMoney = Money.nullable();
/** ISO gün (YYYY-MM-DD); takvim geçerliliği denetlenir, saatli ISO reddedilir. */
export const IsoDate = z.iso.date();
export const NullableIsoDate = IsoDate.nullable();
/** ISO zaman damgası; saat dilimi zorunludur (Z veya ±hh:mm). Saat dilimsiz değer yerel saat sayılmaz, reddedilir. */
export const Timestamp = z.iso.datetime({ offset: true });
/** Bütçe dönemi YYYY-MM. */
export const Period = z.string().regex(/^[0-9]{4}-(0[1-9]|1[0-2])$/, 'Dönem YYYY-MM bekleniyor');
export const Uuid = z.uuid();
export const NullableUuid = Uuid.nullable();
/** İçerik özeti: 64 küçük onaltılık (nesil kimliği ve dosya özeti). */
export const Sha256 = z.string().regex(/^[a-f0-9]{64}$/, 'sha256 (64 küçük onaltılık karakter) bekleniyor');
/** Koleksiyon adı (zarf deseni). */
export const CollectionKey = z.string().regex(/^[a-z_]+$/, 'Koleksiyon adı ^[a-z_]+$ olmalı');
const NonEmpty = z.string().min(1);
/** jsonb NOT NULL: herhangi bir JSON değeri; eksik ve null reddedilir. */
const Present = z.custom<NonNullable<unknown>>((value) => value !== undefined && value !== null, 'Değer zorunlu; null olamaz');
const JsonRecord = z.record(z.string(), z.unknown());

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
export const ManifestFile = z
  .looseObject({
    path: z.string(),
    kind: z.enum(['partition', 'raw', 'schema', 'contract']),
    sha256: Sha256,
    bytes: z.int().min(0),
    collection: z.string().optional(),
    count: z.int().min(0).optional(),
  })
  .superRefine((file, ctx) => {
    // validate.mjs: parça dosyası zarfla aynı koleksiyon adını ve kayıt sayısını taşır. Adı olmayan parça panelde sessizce
    // kaybolurdu (depo parçaları koleksiyon adıyla süzer); burada reddedilir.
    if (file.kind !== 'partition') return;
    if (!CollectionKey.safeParse(file.collection).success) ctx.addIssue({ code: 'custom', path: ['collection'], message: 'Parça dosyası koleksiyon adı taşımalı' });
    if (file.count === undefined) ctx.addIssue({ code: 'custom', path: ['count'], message: 'Parça dosyası kayıt sayısı taşımalı' });
  });

export const Manifest = z.looseObject({
  schemaVersion: z.literal(1),
  generation_id: Sha256,
  tenant_id: Uuid,
  storage_policy: z.literal('private_only'),
  files: z.array(ManifestFile),
  counts: z.record(z.string(), z.int().min(0)),
  sources: z.array(z.looseObject({})),
  consistency: z.literal('snapshot_capture_not_transaction').optional(),
});

// --- Kayıt çekirdeği ---------------------------------------------------------------------------------
const StateAxisKeys = ['decision', 'fulfillment', 'inspection', 'payment'] as const;
type StateAxisKey = (typeof StateAxisKeys)[number];
/** Dört eksen zorunlu (string|null); ek eksenler korunur. */
export const StateSnapshot = z.looseObject(
  Object.fromEntries(StateAxisKeys.map((k) => [k, z.string().nullable()])) as Record<StateAxisKey, z.ZodNullable<z.ZodString>>,
);
/** Dört eksen zorunlu; şema additionalProperties ile her ek eksen de uuid|null olmalı (korunur). */
export const StateTermIds = z
  .object(Object.fromEntries(StateAxisKeys.map((k) => [k, NullableUuid])) as Record<StateAxisKey, typeof NullableUuid>)
  .catchall(NullableUuid);

/** Plan ve gerçek ayrı alanlardır; panel bunları tek sayıda birleştirmez. validate.mjs: her değer para (veya null) olmalı. */
export const Amounts = z
  .object({
    planned: NullableMoney.optional(),
    actual: NullableMoney.optional(),
    estimated_min: NullableMoney.optional(),
    estimated_max: NullableMoney.optional(),
    recorded_price: NullableMoney.optional(),
    quote: NullableMoney.optional(),
  })
  .catchall(NullableMoney);
/** validate.mjs: dates içindeki her değer ISO gün veya null olmalı. */
export const Dates = z
  .object({
    planned_on: NullableIsoDate.optional(),
    order_due_on: NullableIsoDate.optional(),
    delivered_on: NullableIsoDate.optional(),
    payment_on: NullableIsoDate.optional(),
    end_on: NullableIsoDate.optional(),
  })
  .catchall(NullableIsoDate);
/** Ölçü adı → para (veya null). */
export const Measures = z.record(z.string(), NullableMoney);

/**
 * Her koleksiyondaki her kayda uygulanan çekirdek. partition.schema.json `record` tanımındaki alanlar (amount, occurred_on,
 * provenance, source_attributes, attributes, state_snapshot, amounts, state_term_ids) ve validate.mjs recordShape kuralları
 * (dates, measures, cash_change) koleksiyondan bağımsız olarak burada doğrulanır; alan yoksa sorun değildir.
 */
export const BaseRecord = z.looseObject({
  id: Uuid,
  tenant_id: Uuid,
  kind: z.string().optional(),
  label: z.string().optional(),
  source_id: Uuid.optional(),
  source_record_id: z.string().optional(),
  source_attributes: JsonRecord.optional(),
  attributes: JsonRecord.optional(),
  provenance: Provenance.nullable().optional(),
  deleted_at: Timestamp.nullable().optional(),
  amount: NullableMoney.optional(),
  occurred_on: NullableIsoDate.optional(),
  state_snapshot: StateSnapshot.optional(),
  amounts: Amounts.optional(),
  state_term_ids: StateTermIds.optional(),
  dates: Dates.nullable().optional(),
  measures: Measures.nullable().optional(),
  cash_change: NullableMoney.optional(),
});

/** postgres-mapping `app_record`: ayar, oda ve kalem satırları (normalize.mjs base()). */
const AppAttributes = z.looseObject({
  created_at: Timestamp.nullable().optional(),
  updated_at: Timestamp.nullable().optional(),
  version: Decimal.nullable().optional(),
});
const AppRecord = BaseRecord.extend({
  kind: NonEmpty,
  label: z.string(),
  source_id: Uuid,
  source_record_id: z.string(),
  source_attributes: JsonRecord,
  attributes: AppAttributes,
});

const ItemBody = {
  category_term_id: NullableUuid,
  phase_term_id: NullableUuid,
  context_term_ids: z.array(Uuid),
  legacy_status_term_id: NullableUuid.optional(),
  state_snapshot: StateSnapshot,
  state_term_ids: StateTermIds,
  amounts: Amounts,
  dates: Dates,
  room_id: NullableUuid,
};

/** app_kalemler satırı: kalem türlerinin ortak gövdesi (tür adı serbest). Koleksiyonlar türü aşağıda ayrıca sabitler. */
export const PurchaseNeed = AppRecord.extend({ ...ItemBody, kind: NonEmpty });
/** postgres-mapping: her kalem koleksiyonu yalnız kendi türünü taşır (ör. purchase_needs → kind = 'purchase_need'). */
export const itemRecord = <K extends string>(kind: K) => AppRecord.extend({ ...ItemBody, kind: z.literal(kind) });

// --- Sözlük -----------------------------------------------------------------------------------------
export const Vocabulary = BaseRecord.extend({ key: NonEmpty, managed: z.boolean() });
export const Term = BaseRecord.extend({
  vocabulary_id: Uuid,
  code: NonEmpty,
  label: z.string(),
  /** Üst terim (ağaç); kök terimde null. Eski adı parent_term_id yalnız korunur. */
  parent_id: NullableUuid,
  parent_term_id: NullableUuid.optional(),
  legacy: z.boolean(),
  order: z.int().optional(),
  active: z.boolean().optional(),
});

// --- Mekân -------------------------------------------------------------------------------------------
export const Room = AppRecord.extend({ kind: z.literal('room'), setting_id: Uuid, code: NonEmpty });
export const Setting = AppRecord.extend({ kind: z.enum(['setting', 'room']) });

// --- İlişki, medya ------------------------------------------------------------------------------------
/** postgres-mapping typed_relation_rules; validate.mjs başka türü reddeder. */
export const RELATION_KINDS = ['payment_for', 'located_in', 'associated_with', 'depends_on'] as const;
export const Relation = BaseRecord.extend({ kind: z.enum(RELATION_KINDS), source_id: Uuid, target_id: Uuid });

export const MediaReference = BaseRecord.extend({
  entity_id: Uuid,
  /** Yalnız http/https (eşleme: "Allow only http/https references"); javascript:, data:, file: reddedilir. */
  url: z.url({ protocol: /^https?$/ }),
  kind: z.string(),
  /** Yalnız 'verified' gösterilir; aksi "Fotoğraf yok". */
  verification: z.string(),
  rights_status: z.string(),
  license: z.string().nullable().optional(),
});

// --- Bütçe ve tahmin ----------------------------------------------------------------------------------
/**
 * Bütçe gözlemi kaynak hücredir; ödeme olayı değildir. value.decimal NOT NULL (validate.mjs + eşleme), para birimi
 * yerel biçim TRY demiyorsa null kalır. Eşleme kontrolü "payment_evidence = false": gözlem ödeme kanıtı taşıyamaz.
 */
export const BudgetObservation = BaseRecord.extend({
  kind: z.literal('budget_observation'),
  label: z.string(),
  period: Period,
  value: z.looseObject({ decimal: Decimal, currency: Currency.nullable() }),
  basis: z.string(),
  payment_evidence: z.literal(false),
});

/** Tahmin kayıtları gerçek işlem iddia edemez (validate.mjs + eşleme: record_basis = 'forecast'). */
const ForecastRecord = BaseRecord.extend({ record_basis: z.literal('forecast'), source_id: Uuid });
export const Forecast = ForecastRecord.extend({
  kind: z.literal('forecast'),
  fingerprint: z.string(),
  payload_hash: z.string(),
  status: z.string().nullable().optional(),
  notes: z.unknown().optional(),
});
export const ForecastEvent = ForecastRecord.extend({
  kind: NonEmpty,
  forecast_id: Uuid,
  source_record_id: z.string(),
  label: z.string(),
  /** Eşleme: date NOT NULL. Tahmin tarihi ödeme kanıtı değildir. */
  occurred_on: IsoDate,
  event_type: z.string().nullable().optional(),
  certainty: z.string().nullable().optional(),
  source_note: z.string().nullable().optional(),
  cash_change: NullableMoney.optional(),
  measures: Measures.nullable().optional(),
});
export const ForecastMonth = ForecastRecord.extend({
  kind: NonEmpty,
  forecast_id: Uuid,
  period: Period,
  measures: Measures.nullable().optional(),
});

// --- Kalite ve tanımlar -------------------------------------------------------------------------------
export const Issue = BaseRecord.extend({ code: NonEmpty, severity: z.string(), detail: Present });

/** Eşleme: key yalnız bu altı görünüm; status = 'proposed_template' (kayıt, kurulu bir görünüm anlamına gelmez). */
export const VIEW_KEYS = ['listing', 'gantt_chart', 'table', 'pivot', 'kanban', 'timeline'] as const;
export const ViewDefinition = BaseRecord.extend({
  key: z.enum(VIEW_KEYS),
  label: z.string(),
  version: z.int(),
  status: z.literal('proposed_template'),
  capabilities: z.array(z.string()).optional(),
  supported_kinds: z.array(z.string()).optional(),
  required_fields: z.array(z.string()).optional(),
  sort_fields: z.array(z.string()).optional(),
  primary_field_by_kind: z.record(z.string(), z.string()).optional(),
  date_field_by_kind: z.record(z.string(), z.string()).optional(),
  date_basis_by_kind: z.record(z.string(), z.string()).optional(),
  /** kanban: kind → eksen adları (ör. purchase_need → ["decision","fulfillment"]). */
  state_axes: z.record(z.string(), z.array(z.string())).optional(),
  missing_data_policy: z.string().nullable().optional(),
  aggregation: z.looseObject({}).nullable().optional(),
});

/** validate.mjs: geçişin iki ucu da iş akışının sözlüğündeki terimlerdir. */
export const WorkflowTransition = z.looseObject({
  from_term_id: Uuid,
  to_term_id: Uuid,
  requires_evidence: z.boolean(),
});
/** status bu dışa aktarımda 'proposed_template'; eşleme bunu değişmez saymaz ("for this export"), panel durumu gösterir. */
export const WorkflowDefinition = BaseRecord.extend({
  key: NonEmpty,
  version: z.int(),
  status: z.string(),
  vocabulary_id: Uuid,
  transitions: z.array(WorkflowTransition),
});

/** Görev şablonu gerçek görev durumu iddia edemez (validate.mjs + eşleme: status = 'proposed_template'). */
export const TaskTemplate = BaseRecord.extend({
  key: NonEmpty,
  kind: z.literal('task_template'),
  version: z.int(),
  status: z.literal('proposed_template'),
  title: z.string(),
  workflow_key: z.string(),
  workflow_id: Uuid,
  applies_when: z.string(),
  dependencies: z.array(z.string()),
  dependency_template_ids: z.array(Uuid),
  required_data: Present,
  guards: Present,
  acceptance_criteria: Present,
  instantiation_policy: z.string(),
  dependency_policy: z.string(),
  guard_policy: z.string(),
});

// --- Kaynak katmanı -----------------------------------------------------------------------------------
export const SourceRecord = BaseRecord.extend({
  key: NonEmpty,
  spreadsheet_id: z.string(),
  metadata_hash: z.string().nullable().optional(),
});
export const SheetRecord = BaseRecord.extend({
  source_id: Uuid,
  properties: z.looseObject({ sheetId: z.int(), title: z.string() }),
  nonempty_cell_count: z.int().min(0),
  nonempty_row_count: z.int().min(0),
});
export const Supplement = BaseRecord.extend({
  key: NonEmpty,
  /** Kaynağın verdiği sınıf aynen korunur; enum değildir. */
  classification: z.string(),
  source_url: z.string().nullable().optional(),
  payload: Present,
});

// --- Zarf --------------------------------------------------------------------------------------------
/** Belirli bir kayıt şemasına bağlı parça zarfı; şemadaki gibi kapalıdır (bilinmeyen alan reddedilir). */
export function partitionEnvelope<R extends z.ZodType>(records: R) {
  return z.strictObject({ schemaVersion: z.literal(1), collection: CollectionKey, records: z.array(records) });
}
/** Koleksiyondan bağımsız zarf (yalnız çekirdek alanlar). */
export const PartitionEnvelope = partitionEnvelope(BaseRecord);

/** Panelin indirdiği her koleksiyonun kayıt şeması. payments / providers / unclassified_items ve ağır kaynak hücreleri yok. */
export const collectionSchemas = {
  purchase_needs: itemRecord('purchase_need'),
  lighting_specs: itemRecord('lighting_spec'),
  work_orders: itemRecord('work_order'),
  layout_items: itemRecord('layout_item'),
  inspections: itemRecord('inspection'),
  automation_scenes: itemRecord('automation_scene'),
  milestones: itemRecord('milestone'),
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
  const envelope = z.strictObject({ schemaVersion: z.literal(1), collection: z.literal(collection), records: z.array(schema) });
  return envelope.parse(input) as ParsedPartition<K>;
}
