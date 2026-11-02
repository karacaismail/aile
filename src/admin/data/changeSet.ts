// Yerel değişiklik kümesi (D4). Panel kaynağa (Sheets) yazmaz; kullanıcı değişiklikleri tarayıcıda (idb-keyval) sıralı,
// idempotent op listesi olarak birikir. apply() doğrulanmış nesil kayıtlarının üstüne bu opları yazıp görünümü üretir,
// undo() telafi op ekler (silmez), toBatch() Apps Script batch biçimine YALNIZ dönüştürür; hiçbir yerde ağ çağrısı yok.
// Saf TS: React/antd yok. Para/tarih alanlarına dokunmaz; plan ve gerçek burada da birleşmez.
import { ulid } from 'ulid';
import { get, set } from 'idb-keyval';
import type { UpsertOp } from '@shared/api';
import type { StateAxis, StateSnapshot, StateTermIds, UUID } from './types';

export const CHANGE_SET_KEY = 'aile:admin:changeset:v1';

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
  /** ISO zaman. */
  at: string;
  actor: 'local';
  /** Telafi opuysa geri aldığı opId. */
  undoes?: string;
}
export interface StateChangeOp extends OpBase { kind: 'state_change'; before: StateValue; after: StateValue }
export interface NoteOp extends OpBase { kind: 'note'; before: NoteValue; after: NoteValue }
export type ChangeOp = StateChangeOp | NoteOp;
export type ChangeInput =
  | { recordId: UUID; kind: 'state_change'; before: StateValue; after: StateValue }
  | { recordId: UUID; kind: 'note'; before: NoteValue; after: NoteValue };

// --- Saklama -------------------------------------------------------------------------------------------
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

// --- Görünüm ve dönüştürme sözleşmeleri ---------------------------------------------------------------
/** apply/toBatch'in kayıttan beklediği asgari biçim; PurchaseNeedRecord ve komşu türler buna uyar. */
export interface OverlayRecord {
  id: UUID;
  tenant_id?: UUID;
  state_snapshot?: StateSnapshot;
  state_term_ids?: StateTermIds;
  attributes?: Record<string, unknown>;
  /** Sheets satır kimliği (ör. kalem-027); yoksa kaynağa yazılamaz. */
  source_record_id?: string;
}
export type UndoResult = { ok: true; op: ChangeOp } | { ok: false; reason: string };
export interface SkippedOp { opId: string; recordId: UUID; reason: string }
/** toBatch sonucu: gönderilebilir UpsertOp listesi ve nedeniyle atlananlar. Gönderme bu modülün işi değildir. */
export interface BatchConversion { ops: UpsertOp[]; skipped: SkippedOp[] }
export interface ChangeSetOptions {
  storage?: ChangeSetStorage;
  /** ISO zaman üreticisi (test için enjekte edilir). */
  now?: () => string;
  /** opId üreticisi; varsayılan ulid(). */
  newId?: () => string;
}

const EMPTY_SNAPSHOT: StateSnapshot = { decision: null, fulfillment: null, inspection: null, payment: null };
const EMPTY_TERM_IDS: StateTermIds = { decision: null, fulfillment: null, inspection: null, payment: null };

// data-platform/normalize.mjs'nin ters eşlemesi: durum eksen kodu → app_kalemler.durum (shared/schema DURUM).
const LEGACY_DURUM: Record<string, string> = {
  idea: 'fikir', researching: 'arastirma', decided: 'karar', cancelled: 'iptal',
  ordered: 'siparis', delivered: 'teslim', installed: 'kuruldu',
};

function isChangeOp(value: unknown): value is ChangeOp {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.opId === 'string' && typeof v.recordId === 'string' && (v.kind === 'state_change' || v.kind === 'note');
}

/** Durum opunu app_kalemler sütunlarına çevirir; yazılamıyorsa neden metni döner. */
function legacyPatch(after: StateValue): { patch: Record<string, unknown> } | { reason: string } {
  const { axis, code } = after;
  if (axis === 'payment') return { reason: 'Kaynak sütunu yok: payment' };
  if (axis === 'inspection') {
    if (code === 'completed') return { patch: { tamam: true } };
    if (code === 'pending' || code === null) return { patch: { tamam: false } };
    return { reason: `Bilinmeyen durum kodu: ${code}` };
  }
  if (code === null) return { reason: 'Boş durum kaynağa yazılamaz' };
  if (axis === 'decision' && code === 'pending') return { patch: { karar_bekliyor: true } };
  const durum = LEGACY_DURUM[code];
  return durum ? { patch: { durum } } : { reason: `Bilinmeyen durum kodu: ${code}` };
}

export class ChangeSet {
  #ops: ChangeOp[];
  #persistence: 'ok' | 'unavailable';
  readonly #storage: ChangeSetStorage;
  readonly #now: () => string;
  readonly #newId: () => string;

  private constructor(ops: ChangeOp[], persistence: 'ok' | 'unavailable', options: ChangeSetOptions) {
    this.#ops = ops;
    this.#persistence = persistence;
    this.#storage = options.storage ?? createIdbStorage();
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#newId = options.newId ?? ulid;
  }

  /** Saklamadan yükler. Okunamazsa boş kümeyle başlar ve persistence 'unavailable' olur; bozuk içerik boş sayılır. */
  static async load(options: ChangeSetOptions = {}): Promise<ChangeSet> {
    const storage = options.storage ?? createIdbStorage();
    let ops: ChangeOp[] = [];
    let persistence: 'ok' | 'unavailable' = 'ok';
    try {
      const stored = await storage.get(CHANGE_SET_KEY);
      ops = Array.isArray(stored) ? stored.filter(isChangeOp) : [];
    } catch {
      persistence = 'unavailable';
    }
    return new ChangeSet(ops, persistence, { ...options, storage });
  }

  /** Tüm oplar, telafiler dahil, ekleme sırasıyla. */
  get ops(): readonly ChangeOp[] { return this.#ops; }
  /** Etkin (geri alınmamış, telafi olmayan) op sayısı. */
  get pending(): number { return this.effective().length; }
  /** Son saklama denemesinin sonucu; 'unavailable' ise değişiklikler yalnız bellekte. */
  get persistence(): 'ok' | 'unavailable' { return this.#persistence; }

  pendingFor(recordId: UUID): readonly ChangeOp[] {
    return this.effective().filter((op) => op.recordId === recordId);
  }

  async add(input: ChangeInput): Promise<ChangeOp> {
    const op = { ...input, opId: this.#newId(), at: this.#now(), actor: 'local' } as ChangeOp;
    await this.append(op);
    return op;
  }

  /** Telafi op ekler (before/after ters). Aynı kayıtta sonraki etkin op varsa reddeder. */
  async undo(opId: string): Promise<UndoResult> {
    const target = this.#ops.find((op) => op.opId === opId);
    if (!target) return { ok: false, reason: 'Değişiklik bulunamadı' };
    if (target.undoes) return { ok: false, reason: 'Geri alma işlemi geri alınamaz' };
    if (this.#ops.some((op) => op.undoes === opId)) return { ok: false, reason: 'Zaten geri alındı' };
    const forRecord = this.effective().filter((op) => op.recordId === target.recordId);
    if (forRecord[forRecord.length - 1]?.opId !== opId) return { ok: false, reason: 'Sonraki değişiklik var' };
    const op = {
      ...target,
      before: target.after,
      after: target.before,
      opId: this.#newId(),
      at: this.#now(),
      actor: 'local',
      undoes: opId,
    } as ChangeOp;
    await this.append(op);
    return { ok: true, op };
  }

  /** Etkin opları kayıtların üstüne yazar; kaynak dizi ve nesneler değişmez, dokunulmayan satır aynı referansla döner. */
  apply<T extends OverlayRecord>(rows: readonly T[]): T[] {
    const byRecord = new Map<UUID, ChangeOp[]>();
    for (const op of this.effective()) {
      const list = byRecord.get(op.recordId);
      if (list) list.push(op); else byRecord.set(op.recordId, [op]);
    }
    if (byRecord.size === 0) return [...rows];
    return rows.map((row) => {
      const ops = byRecord.get(row.id);
      if (!ops) return row;
      let next: T = { ...row };
      for (const op of ops) {
        if (op.kind === 'state_change') {
          const { axis, code, term_id } = op.after;
          next = {
            ...next,
            state_snapshot: { ...(next.state_snapshot ?? EMPTY_SNAPSHOT), [axis]: code },
            state_term_ids: { ...(next.state_term_ids ?? EMPTY_TERM_IDS), [axis]: term_id },
          };
        } else {
          next = { ...next, attributes: { ...(next.attributes ?? {}), not: op.after.note } };
        }
      }
      return next;
    });
  }

  /**
   * Etkin opları Apps Script batch UpsertOp listesine çevirir (tablo kalemler, id = source_record_id, opId korunur).
   * Yalnız dönüştürür; gönderme, kuyruk ve birleştirme bu dilimde yok. Yazılamayanlar nedeniyle `skipped`a düşer.
   */
  toBatch(records: readonly OverlayRecord[]): BatchConversion {
    const byId = new Map(records.map((r) => [r.id, r] as const));
    const ops: UpsertOp[] = [];
    const skipped: SkippedOp[] = [];
    for (const op of this.effective()) {
      const skip = (reason: string) => skipped.push({ opId: op.opId, recordId: op.recordId, reason });
      const record = byId.get(op.recordId);
      if (!record) { skip('Kayıt bulunamadı'); continue; }
      if (!record.source_record_id) { skip('Kaynak kimliği yok'); continue; }
      let patch: Record<string, unknown>;
      if (op.kind === 'note') {
        patch = { not: op.after.note ?? '' };
      } else {
        const converted = legacyPatch(op.after);
        if ('reason' in converted) { skip(converted.reason); continue; }
        patch = converted.patch;
      }
      ops.push({ op: 'upsert', table: 'kalemler', id: record.source_record_id, opId: op.opId, patch });
    }
    return { ops, skipped };
  }

  /** Geri alınmış oplar ve telafileri çıkarılmış sıralı liste. */
  private effective(): ChangeOp[] {
    const undone = new Set<string>();
    for (const op of this.#ops) if (op.undoes) undone.add(op.undoes);
    return this.#ops.filter((op) => !op.undoes && !undone.has(op.opId));
  }

  private async append(op: ChangeOp): Promise<void> {
    this.#ops = [...this.#ops, op];
    try {
      await this.#storage.set(CHANGE_SET_KEY, this.#ops);
      this.#persistence = 'ok';
    } catch {
      this.#persistence = 'unavailable';
    }
  }
}
