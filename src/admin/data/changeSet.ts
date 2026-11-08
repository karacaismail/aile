// Yerel değişiklik kümesi (D4). Panel kaynağa (Sheets) yazmaz; kullanıcı değişiklikleri tarayıcıda (idb-keyval) sürümlü,
// idempotent op listesi olarak birikir. Saf TS: React/antd yok; hiçbir yerde ağ çağrısı yok.
//
//   Sürüm      her op artan `seq` alır (kümenin revizyonu); eski biçim (seq yok) yüklenirken sırayla sürümlenir.
//   İdempotent opId tekil anahtardır: aynı opId ikinci kez eklenmez, birleştirmede bir kez sayılır, dışa aktarımda korunur.
//   Önkoşul    op'un `before` değeri önkoşuldur. Aynı kayıt/alanda önkoşulu tutmayan op çakışmadır: durum değişikliği
//              eklenirken reddedilir (ChangeConflictError); not kaydedilir ama uygulanmaz, conflicts() ile raporlanır,
//              dışa aktarılmaz. Nesil (kaynak) değeri değiştiyse de aynı kural geçerlidir: kaynak sessizce ezilmez.
//   Geri al    telafi op ekler (geçmiş silinmez); kayıtta sonraki etkin op varsa reddeder (bayat Geri al ezmez).
//   Sekmeler   yazma "kilit altında saklamadan oku → birleştir → denetle → yaz" sırasıyla yapılır (Web Locks varsa);
//              yeni oplar BroadcastChannel varsa diğer sekmelere yayılır ve birleştirilir. Okunamayan saklamanın üstüne
//              yazılmaz (diğer sekmenin opları ezilmez).
//   Dışa aktarma  Apps Script batch gövdesi (shared/api BatchRequest) üretir: kayıt başına tek önkoşullu upsert. APP_KEY
//              (`key`) ve izinli sütunlar dışındaki hiçbir değer gövdeye girmez; gönderme bu modülün işi değildir.
import { ulid } from 'ulid';
import { get, set } from 'idb-keyval';
import type { BatchRequest, UpsertOp, UpsertPrecondition } from '@shared/api';
import { cellToValue } from '@shared/convert';
import type { StateAxis, StateSnapshot, StateTermIds, UUID } from './types';

export const CHANGE_SET_KEY = 'aile:admin:changeset:v1';
/** BroadcastChannel ve Web Locks adı (aynı köken içindeki sekmeler). */
export const CHANGE_SET_CHANNEL = 'aile:admin:changeset';
const MESSAGE_TYPE = 'aile:admin:changeset/ops';
const DEFAULT_ACTOR = 'yonetim-paneli';
const ACTOR_MAX = 60;

// --- Op sözleşmesi ------------------------------------------------------------------------------------
export type ChangeKind = 'state_change' | 'note';
/** Bir durum ekseninin değeri: kod (state_snapshot) + terim kimliği (state_term_ids). null = "Henüz yok". */
export interface StateValue { axis: StateAxis; code: string | null; term_id: UUID | null }
/** attributes.not; null = not yok. */
export interface NoteValue { note: string | null }
interface OpBase {
  /** ULID; idempotent anahtar (Apps Script batch opId ile aynı). */
  opId: string;
  recordId: UUID;
  /** Kümenin artan sürümü (1'den başlar); sekmeler arası birleştirmede sıra (seq, opId) ile kurulur. */
  seq: number;
  /** ISO zaman. */
  at: string;
  actor: 'local';
  /** Telafi opuysa geri aldığı opId. */
  undoes?: string;
}
export interface StateChangeOp extends OpBase { kind: 'state_change'; before: StateValue; after: StateValue }
export interface NoteOp extends OpBase { kind: 'note'; before: NoteValue; after: NoteValue }
export type ChangeOp = StateChangeOp | NoteOp;
/** `before` önkoşuldur. `opId` verilirse idempotent anahtar olarak kullanılır (aynı içerikle tekrar eklenmez). */
export type ChangeInput =
  | { recordId: UUID; kind: 'state_change'; before: StateValue; after: StateValue; opId?: string }
  | { recordId: UUID; kind: 'note'; before: NoteValue; after: NoteValue; opId?: string };

// --- Saklama, yayın, kilit -----------------------------------------------------------------------------
export interface ChangeSetStorage {
  get(key: string): Promise<ChangeOp[] | undefined>;
  set(key: string, ops: ChangeOp[]): Promise<void>;
}

/** idb-keyval üzerinde saklama. Hata yutmaz; ChangeSet bellekte devam edip persistence='unavailable' der. */
export function createIdbStorage(): ChangeSetStorage {
  return {
    get: (key) => get<ChangeOp[]>(key),
    set: (key, ops) => set(key, ops),
  };
}

/** Testler ve saklamasız kullanım için bellek saklaması. */
export function createMemoryStorage(): ChangeSetStorage {
  const map = new Map<string, ChangeOp[]>();
  return {
    get: async (key) => map.get(key),
    set: async (key, ops) => { map.set(key, ops); },
  };
}

/** BroadcastChannel'ın kullanılan alt kümesi. */
export interface ChangeSetChannel {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  close(): void;
}

/** Sekmeler arası dışlayıcı çalıştırıcı (varsayılan navigator.locks.request). */
export type ChangeSetLock = <T>(run: () => Promise<T>) => Promise<T>;

function defaultChannel(): ChangeSetChannel | null {
  if (typeof BroadcastChannel !== 'function') return null;
  try {
    return new BroadcastChannel(CHANGE_SET_CHANNEL);
  } catch {
    return null;
  }
}

function defaultLock(): ChangeSetLock | null {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  if (!locks || typeof locks.request !== 'function') return null;
  return async <T>(run: () => Promise<T>): Promise<T> => {
    let started = false;
    let result!: T;
    try {
      await locks.request(CHANGE_SET_CHANNEL, async () => { started = true; result = await run(); });
    } catch (error) {
      if (started) throw error;
      // Kilit alınamadı (ör. güvenlik kısıtı): sekme içi sıra korunur, değişiklik kaybolmasın diye kilitsiz devam edilir.
      return run();
    }
    return result;
  };
}

// --- Görünüm, çakışma ve dönüştürme sözleşmeleri ------------------------------------------------------
/** apply/toBatch'in kayıttan beklediği asgari biçim; PurchaseNeedRecord ve komşu türler buna uyar. */
export interface OverlayRecord {
  id: UUID;
  tenant_id?: UUID;
  state_snapshot?: StateSnapshot;
  state_term_ids?: StateTermIds;
  attributes?: Record<string, unknown>;
  /** Sheets satır kimliği (ör. kalem-027); yoksa kaynağa yazılamaz. */
  source_record_id?: string;
  /** Sheets satırının ham sütun değerleri (nesildeki source_attributes); önkoşul ve sürüm buradan okunur. */
  source_attributes?: Record<string, unknown>;
  provenance?: { sheet_title?: string } | null;
}
export type UndoResult = { ok: true; op: ChangeOp } | { ok: false; reason: string };
export interface SkippedOp { opId: string; recordId: UUID; reason: string }
/**
 * toBatch sonucu: gönderilebilir UpsertOp listesi (kayıt başına bir tane), nedeniyle atlananlar ve her upsert'in hangi
 * yerel opları kapsadığı (`covers[upsert.opId]`). Gönderme bu modülün işi değildir.
 */
export interface BatchConversion { ops: UpsertOp[]; skipped: SkippedOp[]; covers: Record<string, string[]> }
export interface BatchExportOptions {
  /** Apps Script `actor` alanı; varsayılan "yonetim-paneli", en çok 60 karakter. */
  actor?: string;
}
/** Dışa aktarma: Apps Script doPost gövdesi. `key` (APP_KEY) bilerek yoktur; gönderen taraf ekler. */
export interface BatchExport { request: BatchRequest; skipped: SkippedOp[]; json: string }

export type ChangeField = StateAxis | 'note';
export interface ChangeConflict {
  /** Çakışan op; eklenirken reddedilen değişiklikte null. */
  opId: string | null;
  recordId: UUID;
  field: ChangeField;
  /** Op'un önkoşulu (before). */
  expected: string | null;
  /** O anda bulunan değer. */
  actual: string | null;
  /** Bulunan değeri belirleyen: nesil (kaynak) veya önceki yerel değişiklik. */
  against: 'source' | 'change';
  /** against 'change' ise o değişikliğin opId'si. */
  conflictsWith: string | null;
}

export class ChangeConflictError extends Error {
  readonly conflict: ChangeConflict;
  constructor(conflict: ChangeConflict) {
    super('Hata: Kayıt bu arada değişti; güncel durumu görüp yeniden deneyin.');
    this.name = 'ChangeConflictError';
    this.conflict = conflict;
  }
}

export interface ChangeSetOptions {
  /** Varsayılan IndexedDB (idb-keyval). */
  storage?: ChangeSetStorage;
  /** ISO zaman üreticisi (test için enjekte edilir). */
  now?: () => string;
  /** opId üreticisi; varsayılan ulid(). */
  newId?: () => string;
  /** undefined → varsayılan saklamada BroadcastChannel (varsa), özel saklamada yok; null → yayın kapalı. */
  channel?: ChangeSetChannel | null;
  /** undefined → varsayılan saklamada navigator.locks (varsa), özel saklamada yok; null → kilit yok. */
  lock?: ChangeSetLock | null;
}

const EMPTY_SNAPSHOT: StateSnapshot = { decision: null, fulfillment: null, inspection: null, payment: null };
const EMPTY_TERM_IDS: StateTermIds = { decision: null, fulfillment: null, inspection: null, payment: null };
const AXES: readonly StateAxis[] = ['decision', 'fulfillment', 'inspection', 'payment'];

// --- Ayrıştırma (saklama, yayın ve girdi aynı kapıdan geçer; fazladan alan taşınmaz) -----------------
const isRecordObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isNullableString = (value: unknown): value is string | null => value === null || typeof value === 'string';
const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

function parseStateValue(value: unknown): StateValue | null {
  if (!isRecordObject(value)) return null;
  const { axis, code, term_id } = value;
  if (!AXES.includes(axis as StateAxis) || !isNullableString(code) || !isNullableString(term_id ?? null)) return null;
  return { axis: axis as StateAxis, code, term_id: (term_id ?? null) as string | null };
}

function parseNoteValue(value: unknown): NoteValue | null {
  if (!isRecordObject(value) || !isNullableString(value.note)) return null;
  return { note: value.note };
}

type ChangeBody = Pick<StateChangeOp, 'kind' | 'before' | 'after'> | Pick<NoteOp, 'kind' | 'before' | 'after'>;

function parseBody(value: Record<string, unknown>): ChangeBody | null {
  if (value.kind === 'state_change') {
    const before = parseStateValue(value.before);
    const after = parseStateValue(value.after);
    return before && after && before.axis === after.axis ? { kind: 'state_change', before, after } : null;
  }
  if (value.kind === 'note') {
    const before = parseNoteValue(value.before);
    const after = parseNoteValue(value.after);
    return before && after ? { kind: 'note', before, after } : null;
  }
  return null;
}

function makeOp(base: Omit<OpBase, 'undoes'> & { undoes?: string }, body: ChangeBody): ChangeOp {
  const op = { opId: base.opId, recordId: base.recordId, seq: base.seq, at: base.at, actor: 'local' as const, ...body };
  return (base.undoes ? { ...op, undoes: base.undoes } : op) as ChangeOp;
}

/** Saklanmış veya yayınlanmış opu doğrular ve yalnız sözleşme alanlarıyla yeniden kurar. */
function parseOp(value: unknown, fallbackSeq: number | null): ChangeOp | null {
  if (!isRecordObject(value)) return null;
  const { opId, recordId, at, undoes, seq } = value;
  if (!isNonEmptyString(opId) || !isNonEmptyString(recordId) || typeof at !== 'string') return null;
  if (undoes !== undefined && !isNonEmptyString(undoes)) return null;
  const validSeq = typeof seq === 'number' && Number.isSafeInteger(seq) && seq > 0 ? seq : fallbackSeq;
  if (validSeq === null) return null;
  const body = parseBody(value);
  return body ? makeOp({ opId, recordId, seq: validSeq, at, actor: 'local', undoes: undoes as string | undefined }, body) : null;
}

/** add() girdisi: yalnız sözleşme alanları; geçersizse "Hata: " ile reddedilir. */
function parseInput(input: unknown): { recordId: UUID; body: ChangeBody; opId?: string } {
  if (isRecordObject(input)) {
    const body = parseBody(input);
    const { recordId, opId } = input;
    if (body && isNonEmptyString(recordId) && (opId === undefined || isNonEmptyString(opId))) {
      return opId === undefined ? { recordId, body } : { recordId, body, opId };
    }
  }
  throw new Error('Hata: Geçersiz değişiklik');
}

/** Saklama içeriği: dizi değilse boş; seq yoksa (eski biçim) sırayla verilir; aynı opId bir kez. */
function parseStored(stored: unknown): ChangeOp[] {
  if (!Array.isArray(stored)) return [];
  const out: ChangeOp[] = [];
  stored.forEach((value, index) => {
    const op = parseOp(value, index + 1);
    if (op) out.push(op);
  });
  return out;
}

const compareOps = (a: ChangeOp, b: ChangeOp) => a.seq - b.seq || (a.opId < b.opId ? -1 : a.opId > b.opId ? 1 : 0);

function sameValue(a: StateValue | NoteValue, b: StateValue | NoteValue): boolean {
  return valueOf(a) === valueOf(b) && ('axis' in a ? 'axis' in b && a.axis === b.axis : !('axis' in b));
}

function sameContent(op: ChangeOp, recordId: UUID, body: ChangeBody): boolean {
  return op.recordId === recordId && op.kind === body.kind && !op.undoes && sameValue(op.before, body.before) && sameValue(op.after, body.after);
}

// --- Önkoşul yeniden oynatma (apply, conflicts, toBatch ve add aynı kuralı kullanır) ----------------
/** Boş not ile not yok aynıdır (Sheets boş hücreyi saklamaz). */
const normalizeNote = (note: string | null): string | null => (note === null || note.trim() === '' ? null : note);
const fieldOf = (op: Pick<ChangeOp, 'kind' | 'after'>): ChangeField => (op.kind === 'note' ? 'note' : (op.after as StateValue).axis);
const valueOf = (value: StateValue | NoteValue): string | null => ('axis' in value ? value.code : normalizeNote(value.note));

function baseValue(record: OverlayRecord, field: ChangeField): string | null {
  if (field === 'note') {
    const note = record.attributes?.not;
    return typeof note === 'string' ? normalizeNote(note) : null;
  }
  return record.state_snapshot?.[field] ?? null;
}

type Outcome = 'applied' | 'satisfied' | 'conflict';
interface Step {
  op: ChangeOp;
  outcome: Outcome;
  conflict?: ChangeConflict;
  /** Etkisiz op'un sonucunu zaten taşıyan: nesil mi, önceki yerel değişiklik mi. */
  satisfiedBy?: 'source' | 'change';
}
interface FieldState { value: string | null; by: ChangeOp | null }

/**
 * Bir kaydın etkin oplarını sırayla oynatır. Kayıt verilirse taban değer nesildendir; verilmezse yalnız yerel zincir
 * denetlenir. Önkoşul tutarsa op uygulanır; tutmuyor ama sonuç zaten aynıysa etkisizdir; aksi çakışmadır.
 */
function replay(ops: readonly ChangeOp[], record?: OverlayRecord): { steps: Step[]; fields: Map<ChangeField, FieldState> } {
  const fields = new Map<ChangeField, FieldState>();
  const steps: Step[] = [];
  for (const op of ops) {
    const field = fieldOf(op);
    const current = fields.get(field) ?? (record ? { value: baseValue(record, field), by: null } : undefined);
    const before = valueOf(op.before);
    const after = valueOf(op.after);
    if (!current || before === current.value) {
      fields.set(field, { value: after, by: op });
      steps.push({ op, outcome: 'applied' });
    } else if (after === current.value) {
      steps.push({ op, outcome: 'satisfied', satisfiedBy: current.by ? 'change' : 'source' });
    } else {
      steps.push({
        op,
        outcome: 'conflict',
        conflict: {
          opId: op.opId,
          recordId: op.recordId,
          field,
          expected: before,
          actual: current.value,
          against: current.by ? 'change' : 'source',
          conflictsWith: current.by?.opId ?? null,
        },
      });
    }
  }
  return { steps, fields };
}

// --- Apps Script (app_kalemler) eşlemesi ----------------------------------------------------------------
const SOURCE_TABLE = 'app_kalemler';
/** shared/schema ITEM_COLUMNS'taki türler (yalnız yazılan sütunlar ve version); test şemayla karşılaştırır. */
const SOURCE_COLUMN_TYPES = { durum: 'enum', karar_bekliyor: 'bool', tamam: 'bool', not: 'uzunmetin' } as const;
type SourceColumn = keyof typeof SOURCE_COLUMN_TYPES;
type SourceValue = string | boolean | null;

// data-platform/normalize.mjs'nin ters eşlemesi: durum eksen kodu → app_kalemler.durum (shared/schema DURUM).
const LEGACY_DURUM: Record<string, string> = {
  idea: 'fikir', researching: 'arastirma', decided: 'karar', cancelled: 'iptal',
  ordered: 'siparis', delivered: 'teslim', installed: 'kuruldu',
};
/** normalize.mjs: bu durumlar karar eksenini belirler; karar_bekliyor yalnız durum bunlardan biri değilken okunur. */
const DECISION_DURUM = new Set(['fikir', 'arastirma', 'karar', 'iptal']);
/** Karşılama ekseninin tek başına taşıdığı durumlar (karar yazımı bunları silerdi). */
const FULFILLMENT_ONLY_DURUM = new Set(['siparis', 'teslim', 'kuruldu']);

function sourceValue(column: SourceColumn, raw: unknown): SourceValue {
  const value = cellToValue(SOURCE_COLUMN_TYPES[column], raw as Parameters<typeof cellToValue>[1]);
  return value === undefined ? null : (value as string | boolean);
}

/** Sheets yazımından sonraki hücre değeri: boş metin ve null hücreyi siler. */
const writtenValue = (value: unknown): SourceValue => (value === '' || value === null || value === undefined ? null : (value as string | boolean));

/** Durum opunu app_kalemler yamasına çevirir; current, bu kayıt için batch içinde ilerletilmiş kaynak değerleridir. */
function legacyPatch(after: StateValue, current: (column: SourceColumn) => SourceValue): { patch: Partial<Record<SourceColumn, string | boolean>> } | { reason: string } {
  const { axis, code } = after;
  if (axis === 'payment') return { reason: 'Kaynak sütunu yok: payment' };
  if (axis === 'inspection') {
    if (code === 'completed') return { patch: { tamam: true } };
    if (code === 'pending' || code === null) return { patch: { tamam: false } };
    return { reason: `Bilinmeyen durum kodu: ${code}` };
  }
  if (code === null) return { reason: 'Boş durum kaynağa yazılamaz' };
  const durum = current('durum');
  if (axis === 'decision' && code === 'pending') {
    // Durum bir karar durumu taşıyorsa karar_bekliyor okunmaz; hücre boşaltılır.
    return { patch: typeof durum === 'string' && DECISION_DURUM.has(durum) ? { karar_bekliyor: true, durum: '' } : { karar_bekliyor: true } };
  }
  const legacy = LEGACY_DURUM[code];
  if (!legacy) return { reason: `Bilinmeyen durum kodu: ${code}` };
  if (axis === 'decision') {
    if (code !== 'cancelled' && typeof durum === 'string' && FULFILLMENT_ONLY_DURUM.has(durum)) {
      return { reason: 'Kaynakta tek durum sütunu var; karşılama durumu silinirdi' };
    }
    return { patch: current('karar_bekliyor') === true ? { durum: legacy, karar_bekliyor: false } : { durum: legacy } };
  }
  return { patch: { durum: legacy } };
}

/** Kaynak satırın sürümü (Apps Script: boş version 0 sayılır); okunamıyorsa null. */
function sourceVersion(attributes: Record<string, unknown>): number | null {
  const raw = attributes.version;
  if (raw === undefined || raw === null || raw === '') return 0;
  const value = cellToValue('sayi', raw as Parameters<typeof cellToValue>[1]);
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** Bir kaydın batch içindeki birikimli upsert'i. */
interface PendingUpsert {
  id: string;
  version: number;
  initial: Map<SourceColumn, SourceValue>;
  running: Map<SourceColumn, SourceValue>;
  attributes: Record<string, unknown>;
  patch: Record<string, string | boolean>;
  covers: string[];
}

function sanitizeActor(actor: unknown): string {
  return typeof actor === 'string' && actor.trim() ? actor.trim().slice(0, ACTOR_MAX) : DEFAULT_ACTOR;
}

// --- Küme ---------------------------------------------------------------------------------------------
export class ChangeSet {
  #ops: ChangeOp[];
  #persistence: 'ok' | 'unavailable';
  readonly #storage: ChangeSetStorage;
  readonly #now: () => string;
  readonly #newId: () => string;
  readonly #lock: ChangeSetLock | null;
  #channel: ChangeSetChannel | null;
  #tail: Promise<unknown> = Promise.resolve();
  readonly #listeners = new Set<() => void>();
  readonly #onMessage = (event: MessageEvent) => this.#receive(event.data);

  private constructor(ops: ChangeOp[], persistence: 'ok' | 'unavailable', options: ChangeSetOptions, shared: boolean) {
    this.#ops = ops;
    this.#persistence = persistence;
    this.#storage = options.storage ?? createIdbStorage();
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#newId = options.newId ?? ulid;
    this.#lock = options.lock !== undefined ? options.lock : shared ? defaultLock() : null;
    this.#channel = options.channel !== undefined ? options.channel : shared ? defaultChannel() : null;
    this.#channel?.addEventListener('message', this.#onMessage);
  }

  /**
   * Saklamadan yükler. Okunamazsa boş kümeyle başlar ve persistence 'unavailable' olur; bozuk içerik ayıklanır.
   * Varsayılan saklama (IndexedDB) sekmeler arasında ortaktır; bu yüzden yayın ve kilit yalnız onunla kendiliğinden açılır.
   */
  static async load(options: ChangeSetOptions = {}): Promise<ChangeSet> {
    const shared = options.storage === undefined;
    const storage = options.storage ?? createIdbStorage();
    let ops: ChangeOp[] = [];
    let persistence: 'ok' | 'unavailable' = 'ok';
    try {
      ops = mergeOps([], parseStored(await storage.get(CHANGE_SET_KEY)));
    } catch {
      persistence = 'unavailable';
    }
    return new ChangeSet(ops, persistence, { ...options, storage }, shared);
  }

  /** Tüm oplar, telafiler dahil, (seq, opId) sırasıyla. */
  get ops(): readonly ChangeOp[] { return this.#ops; }
  /** Etkin (geri alınmamış, telafi olmayan) op sayısı. */
  get pending(): number { return this.#effective().length; }
  /** Son saklama denemesinin sonucu; 'unavailable' ise değişiklikler yalnız bellekte (ve yayında). */
  get persistence(): 'ok' | 'unavailable' { return this.#persistence; }
  /** Kümenin sürümü: en büyük seq (boşsa 0). */
  get revision(): number { return this.#ops.reduce((max, op) => Math.max(max, op.seq), 0); }

  pendingFor(recordId: UUID): readonly ChangeOp[] {
    return this.#effective().filter((op) => op.recordId === recordId);
  }

  /** Küme değişince (yerel ekleme/geri alma, başka sekmeden gelen op) çağrılır. Aboneliği bırakan fonksiyon döner. */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }

  /** Yayını kapatır ve abonelikleri bırakır; küme bellekte kullanılabilir kalır. */
  close(): void {
    this.#channel?.removeEventListener('message', this.#onMessage);
    try { this.#channel?.close(); } catch { /* zaten kapalı */ }
    this.#channel = null;
    this.#listeners.clear();
  }

  /** Saklamadan yeniden okur ve birleştirir (yayın yoksa veya sekme yeniden görünür olduğunda). Yeni op geldiyse true. */
  sync(): Promise<boolean> {
    return this.#exclusive(async () => (await this.#pull()).changed);
  }

  /**
   * Op ekler. Aynı opId zaten varsa aynı içerikte o op döner, farklıysa reddeder. Aynı alandaki son yerel değişiklikle
   * aynı önkoşul ve hedefi taşıyan çift gönderim yeni op üretmez. Durum değişikliğinin önkoşulu güncel değerle
   * uyuşmazsa ChangeConflictError fırlatır. Güncel değer: `record` (nesildeki, apply öncesi kayıt) verilirse apply ile
   * aynı kuralla kaynak + uygulanabilen yerel oplar; verilmezse yalnız yerel zincir. Not önerisi reddedilmez.
   */
  async add(input: ChangeInput, record?: OverlayRecord): Promise<ChangeOp> {
    const { recordId, body, opId: requestedId } = parseInput(input);
    return this.#exclusive(async () => {
      const { readOk } = await this.#pull();
      if (requestedId !== undefined) {
        const existing = this.#ops.find((op) => op.opId === requestedId);
        if (existing) {
          if (sameContent(existing, recordId, body)) return existing;
          throw new Error('Hata: Bu işlem kimliği başka bir değişiklikte kullanılmış.');
        }
      }
      const field = fieldOf(body);
      const before = valueOf(body.before);
      const forRecord = this.#effective().filter((op) => op.recordId === recordId);
      const local = replay(forRecord).fields.get(field);
      const context = record?.id === recordId ? record : undefined;
      const current = context
        ? replay(forRecord, context).fields.get(field) ?? { value: baseValue(context, field), by: null }
        : local;
      // Çift gönderim: aynı alandaki son değişiklikle aynı önkoşul ve hedef (yerel zincirde veya bağlamda).
      for (const last of [current, local]) {
        if (last?.by && before !== last.value && sameContent(last.by, recordId, body)) return last.by;
      }
      if (body.kind === 'state_change' && current && before !== current.value) {
        throw new ChangeConflictError({
          opId: null,
          recordId,
          field,
          expected: before,
          actual: current.value,
          against: current.by ? 'change' : 'source',
          conflictsWith: current.by?.opId ?? null,
        });
      }
      const opId = requestedId ?? this.#newId();
      if (this.#ops.some((op) => op.opId === opId)) throw new Error('Hata: İşlem kimliği üretilemedi; yeniden deneyin.');
      const op = makeOp({ opId, recordId, seq: this.revision + 1, at: this.#now(), actor: 'local' }, body);
      await this.#commit(op, readOk);
      return op;
    });
  }

  /** Telafi op ekler (before/after ters; geçmiş silinmez). Aynı kayıtta sonraki etkin op varsa (başka sekmede bile) reddeder. */
  undo(opId: string): Promise<UndoResult> {
    return this.#exclusive(async (): Promise<UndoResult> => {
      const { readOk } = await this.#pull();
      const target = this.#ops.find((op) => op.opId === opId);
      if (!target) return { ok: false, reason: 'Değişiklik bulunamadı' };
      if (target.undoes) return { ok: false, reason: 'Geri alma işlemi geri alınamaz' };
      if (this.#ops.some((op) => op.undoes === opId)) return { ok: false, reason: 'Zaten geri alındı' };
      const forRecord = this.pendingFor(target.recordId);
      if (forRecord[forRecord.length - 1]?.opId !== opId) return { ok: false, reason: 'Sonraki değişiklik var' };
      const body = { kind: target.kind, before: target.after, after: target.before } as ChangeBody;
      const op = makeOp({ opId: this.#newId(), recordId: target.recordId, seq: this.revision + 1, at: this.#now(), actor: 'local', undoes: opId }, body);
      await this.#commit(op, readOk);
      return { ok: true, op };
    });
  }

  /**
   * Etkin opları kayıtların üstüne yazar; kaynak dizi ve nesneler değişmez, dokunulmayan satır aynı referansla döner.
   * Önkoşulu tutmayan (çakışan) veya etkisiz op uygulanmaz.
   */
  apply<T extends OverlayRecord>(rows: readonly T[]): T[] {
    const byRecord = this.#byRecord();
    if (byRecord.size === 0) return [...rows];
    return rows.map((row) => {
      const ops = byRecord.get(row.id);
      if (!ops) return row;
      let next: T | null = null;
      for (const step of replay(ops, row).steps) {
        if (step.outcome !== 'applied') continue;
        const { op } = step;
        const base: T = next ?? { ...row };
        if (op.kind === 'state_change') {
          const { axis, code, term_id } = op.after;
          next = {
            ...base,
            state_snapshot: { ...(base.state_snapshot ?? EMPTY_SNAPSHOT), [axis]: code },
            state_term_ids: { ...(base.state_term_ids ?? EMPTY_TERM_IDS), [axis]: term_id },
          };
        } else {
          next = { ...base, attributes: { ...(base.attributes ?? {}), not: op.after.note } };
        }
      }
      return next ?? row;
    });
  }

  /** Önkoşulu tutmayan etkin oplar. Listede olmayan kayıtlar için yalnız yerel zincir denetlenir. */
  conflicts(records: readonly OverlayRecord[]): ChangeConflict[] {
    const byId = new Map(records.map((record) => [record.id, record] as const));
    const out: ChangeConflict[] = [];
    for (const [recordId, ops] of this.#byRecord()) {
      for (const step of replay(ops, byId.get(recordId)).steps) if (step.conflict) out.push(step.conflict);
    }
    return out.sort((a, b) => this.#position(a.opId) - this.#position(b.opId));
  }

  /**
   * Etkin opları Apps Script batch UpsertOp listesine çevirir: tablo kalemler, id = source_record_id, kayıt başına tek
   * upsert (son opId; yeniden gönderim Apps Script'te yinelenen sayılır), önkoşul = nesildeki sürüm + yazılan sütunların
   * nesildeki değerleri. Yalnız dönüştürür; yazılamayanlar nedeniyle `skipped`a düşer.
   */
  toBatch(records: readonly OverlayRecord[]): BatchConversion {
    const byId = new Map(records.map((record) => [record.id, record] as const));
    const effective = this.#effective();
    const outcomes = new Map<string, Step>();
    for (const [recordId, ops] of this.#byRecord(effective)) {
      for (const step of replay(ops, byId.get(recordId)).steps) outcomes.set(step.op.opId, step);
    }
    const upserts = new Map<UUID, PendingUpsert>();
    const order: UUID[] = [];
    const skipped: SkippedOp[] = [];
    for (const op of effective) {
      const skip = (reason: string) => skipped.push({ opId: op.opId, recordId: op.recordId, reason });
      const record = byId.get(op.recordId);
      if (!record) { skip('Kayıt bulunamadı'); continue; }
      if (!record.source_record_id) { skip('Kaynak kimliği yok'); continue; }
      const sheet = record.provenance?.sheet_title;
      if (sheet && sheet !== SOURCE_TABLE) { skip(`Kaynak tablosu yazılamaz: ${sheet}`); continue; }
      if (!isRecordObject(record.source_attributes)) { skip('Kaynak değerleri yok'); continue; }
      const version = sourceVersion(record.source_attributes);
      if (version === null) { skip('Kaynak sürümü okunamadı'); continue; }
      const step = outcomes.get(op.opId);
      if (step?.outcome === 'conflict') {
        skip(step.conflict?.against === 'source' ? 'Çakışma: kaynak değeri farklı' : 'Çakışma: önceki değişiklikle uyuşmuyor');
        continue;
      }
      if (step?.outcome === 'satisfied') {
        skip(step.satisfiedBy === 'change' ? 'Aynı değişiklik zaten var' : 'Kaynakta zaten uygulanmış');
        continue;
      }
      let pending = upserts.get(op.recordId);
      if (!pending) {
        pending = { id: record.source_record_id, version, initial: new Map(), running: new Map(), attributes: record.source_attributes, patch: {}, covers: [] };
      }
      const current = (column: SourceColumn): SourceValue => {
        const target = pending!;
        if (!target.running.has(column)) {
          const value = sourceValue(column, target.attributes[column]);
          target.initial.set(column, value);
          target.running.set(column, value);
        }
        return target.running.get(column)!;
      };
      let patch: Partial<Record<SourceColumn, string | boolean>>;
      if (op.kind === 'note') {
        patch = { not: op.after.note ?? '' };
      } else {
        const converted = legacyPatch(op.after, current);
        if ('reason' in converted) { skip(converted.reason); continue; }
        patch = converted.patch;
      }
      for (const [column, value] of Object.entries(patch) as [SourceColumn, string | boolean][]) {
        current(column);
        pending.running.set(column, writtenValue(value));
        pending.patch[column] = value;
      }
      pending.covers.push(op.opId);
      if (!upserts.has(op.recordId)) {
        upserts.set(op.recordId, pending);
        order.push(op.recordId);
      }
    }
    const ops: UpsertOp[] = [];
    const covers: Record<string, string[]> = {};
    for (const recordId of order) {
      const pending = upserts.get(recordId)!;
      const opId = pending.covers[pending.covers.length - 1];
      const fields: UpsertPrecondition['fields'] = {};
      for (const column of Object.keys(pending.patch) as SourceColumn[]) fields[column] = pending.initial.get(column) ?? null;
      ops.push({ op: 'upsert', table: 'kalemler', id: pending.id, opId, precondition: { version: pending.version, fields }, patch: { ...pending.patch } });
      covers[opId] = [...pending.covers];
    }
    return { ops, skipped, covers };
  }

  /**
   * Apps Script batch gövdesini JSON olarak dışa aktarır (canlı çağrı yok). Gövde yalnız action, actor ve ops taşır;
   * APP_KEY ve kaynak satırının yazılmayan sütunları dahil hiçbir gizli değer girmez.
   */
  exportBatch(records: readonly OverlayRecord[], options: BatchExportOptions = {}): BatchExport {
    const { ops, skipped } = this.toBatch(records);
    const request: BatchRequest = { action: 'batch', actor: sanitizeActor(options.actor), ops };
    return { request, skipped, json: JSON.stringify(request, null, 2) };
  }

  // --- İç işleyiş ---------------------------------------------------------------------------------------
  /** Geri alınmış oplar ve telafileri çıkarılmış sıralı liste. */
  #effective(): ChangeOp[] {
    const undone = new Set<string>();
    for (const op of this.#ops) if (op.undoes) undone.add(op.undoes);
    return this.#ops.filter((op) => !op.undoes && !undone.has(op.opId));
  }

  #byRecord(ops: readonly ChangeOp[] = this.#effective()): Map<UUID, ChangeOp[]> {
    const byRecord = new Map<UUID, ChangeOp[]>();
    for (const op of ops) {
      const list = byRecord.get(op.recordId);
      if (list) list.push(op); else byRecord.set(op.recordId, [op]);
    }
    return byRecord;
  }

  #position(opId: string | null): number {
    return this.#ops.findIndex((op) => op.opId === opId);
  }

  /** Aynı sekmede sıra + sekmeler arası kilit: okuma-denetim-yazma bölünmez. */
  #exclusive<T>(run: () => Promise<T>): Promise<T> {
    const guarded = () => (this.#lock ? this.#lock(run) : run());
    const result = this.#tail.then(guarded, guarded);
    this.#tail = result.catch(() => undefined);
    return result;
  }

  /**
   * Saklamayı okuyup birleştirir; yeni op geldiyse aboneler hemen haberdar olur (ekleme sonra reddedilse bile).
   * Okunamazsa persistence 'unavailable' ve bu turda yazılmaz.
   */
  async #pull(): Promise<{ readOk: boolean; changed: boolean }> {
    let stored: ChangeOp[];
    try {
      stored = parseStored(await this.#storage.get(CHANGE_SET_KEY));
    } catch {
      this.#persistence = 'unavailable';
      return { readOk: false, changed: false };
    }
    const changed = this.#merge(stored);
    if (changed) this.#notify();
    return { readOk: true, changed };
  }

  #merge(incoming: readonly ChangeOp[]): boolean {
    const next = mergeOps(this.#ops, incoming);
    if (next.length === this.#ops.length) return false;
    this.#ops = next;
    return true;
  }

  async #commit(op: ChangeOp, readOk: boolean): Promise<void> {
    this.#ops = mergeOps(this.#ops, [op]);
    if (readOk) {
      try {
        await this.#storage.set(CHANGE_SET_KEY, this.#ops);
        this.#persistence = 'ok';
      } catch {
        this.#persistence = 'unavailable';
      }
    }
    try {
      this.#channel?.postMessage({ type: MESSAGE_TYPE, ops: [op] });
    } catch {
      /* yayın kapalı veya klonlanamadı; saklama yine de birleştirir */
    }
    this.#notify();
  }

  #receive(data: unknown): void {
    if (!isRecordObject(data) || data.type !== MESSAGE_TYPE || !Array.isArray(data.ops)) return;
    const incoming = data.ops.map((value) => parseOp(value, null)).filter((op): op is ChangeOp => op !== null);
    if (this.#merge(incoming)) this.#notify();
  }

  #notify(): void {
    for (const listener of [...this.#listeners]) {
      try { listener(); } catch { /* dinleyici hatası kümeyi bozmaz */ }
    }
  }
}

/** opId birliği (ilk görülen kalır), (seq, opId) sırası; girdiler değişmez. */
function mergeOps(current: readonly ChangeOp[], incoming: readonly ChangeOp[]): ChangeOp[] {
  const known = new Set(current.map((op) => op.opId));
  const fresh: ChangeOp[] = [];
  for (const op of incoming) {
    if (known.has(op.opId)) continue;
    known.add(op.opId);
    fresh.push(op);
  }
  if (fresh.length === 0) return current as ChangeOp[];
  return [...current, ...fresh].sort(compareOps);
}
