// Nesil indeksleri: saf TS, React/antd yok. Girdi doğrulanmış JSON neslinin koleksiyonlarıdır (types.ts);
// çıktı kabuğun RecordRow/StatusLabel sözleşmesidir (shell/contracts.ts). Biçimleme (₺, tarih) burada yapılmaz.
import type { BaseRecord, MediaReference, PurchaseNeedRecord, Relation, Room, StateAxis, Term, UUID, Vocabulary } from './types';
import type { Money, RecordRow, StatusLabel, Tone } from '../shell/contracts';

export interface GenerationCollections {
  [collection: string]: readonly BaseRecord[] | undefined;
  purchase_needs?: readonly PurchaseNeedRecord[];
  lighting_specs?: readonly PurchaseNeedRecord[];
  work_orders?: readonly PurchaseNeedRecord[];
  layout_items?: readonly PurchaseNeedRecord[];
  inspections?: readonly PurchaseNeedRecord[];
  automation_scenes?: readonly PurchaseNeedRecord[];
  milestones?: readonly PurchaseNeedRecord[];
  rooms?: readonly Room[];
  terms?: readonly Term[];
  vocabularies?: readonly Vocabulary[];
  relations?: readonly Relation[];
  media_references?: readonly MediaReference[];
}

// --- Terim ağacı ---------------------------------------------------------------------------------
export type TermTreeRejectReason = 'cycle' | 'self_parent' | 'missing_parent' | 'cross_vocabulary';
/** Kesilen üst bağ: terim kök sayılır, bağ raporlanır; ağaç hiçbir zaman sonsuz döngüye girmez. */
export interface TermTreeRejection { term_id: UUID; parent_id: UUID; reason: TermTreeRejectReason }

export interface TermTree {
  /** Sözlüğün (vocabulary_id) üst terimi olmayan terimleri. */
  roots(vocabularyId: UUID): readonly Term[];
  children(termId: UUID): readonly Term[];
  parent(termId: UUID): Term | null;
  /** Yakından uzağa: [üst, üstün üstü, …]. */
  ancestors(termId: UUID): readonly Term[];
  /** Çocuklar ve torunlar (genişlik öncelikli). */
  descendants(termId: UUID): readonly Term[];
  /** "Parent kapsar": termId === ancestorId ya da ancestorId atalar arasındadır. */
  covers(ancestorId: UUID, termId: UUID): boolean;
  readonly rejected: readonly TermTreeRejection[];
}

export function buildTermTree(terms: readonly Term[]): TermTree {
  const byId = new Map<UUID, Term>();
  for (const t of terms) byId.set(t.id, t);

  // Etkin üst bağ: önce yapısal reddler, sonra döngü kesme. Kayıt sırası deterministiktir (girdi sırası).
  const parentOf = new Map<UUID, UUID | null>();
  const rejected: TermTreeRejection[] = [];
  for (const t of terms) {
    const pid = t.parent_id;
    if (pid === null || pid === undefined) { parentOf.set(t.id, null); continue; }
    if (pid === t.id) { rejected.push({ term_id: t.id, parent_id: pid, reason: 'self_parent' }); parentOf.set(t.id, null); continue; }
    const p = byId.get(pid);
    if (!p) { rejected.push({ term_id: t.id, parent_id: pid, reason: 'missing_parent' }); parentOf.set(t.id, null); continue; }
    if (p.vocabulary_id !== t.vocabulary_id) { rejected.push({ term_id: t.id, parent_id: pid, reason: 'cross_vocabulary' }); parentOf.set(t.id, null); continue; }
    parentOf.set(t.id, pid);
  }

  // Döngü reddi: üst zincirini yürü; zincir kendine dönerse döngüyü kapatan kenarı kes.
  const safe = new Set<UUID>();
  for (const t of terms) {
    if (safe.has(t.id)) continue;
    const chain: UUID[] = [];
    const onChain = new Set<UUID>();
    let cur: UUID | null = t.id;
    while (cur !== null && !safe.has(cur)) {
      if (onChain.has(cur)) {
        // cur zincirde ikinci kez görüldü: son eklenen terimin üst bağı döngüyü kapatıyor.
        const closer = chain[chain.length - 1];
        rejected.push({ term_id: closer, parent_id: cur, reason: 'cycle' });
        parentOf.set(closer, null);
        break;
      }
      onChain.add(cur);
      chain.push(cur);
      cur = parentOf.get(cur) ?? null;
    }
    for (const id of chain) safe.add(id);
  }

  const childrenOf = new Map<UUID, Term[]>();
  const rootsOf = new Map<UUID, Term[]>();
  for (const t of terms) {
    const pid = parentOf.get(t.id) ?? null;
    if (pid === null) push(rootsOf, t.vocabulary_id, t);
    else push(childrenOf, pid, t);
  }

  const none: readonly Term[] = [];
  const parent = (id: UUID): Term | null => {
    const pid = parentOf.get(id);
    return pid ? (byId.get(pid) ?? null) : null;
  };
  const ancestors = (id: UUID): readonly Term[] => {
    const out: Term[] = [];
    const seen = new Set<UUID>([id]);
    let p = parent(id);
    while (p && !seen.has(p.id)) { out.push(p); seen.add(p.id); p = parent(p.id); }
    return out;
  };
  const descendants = (id: UUID): readonly Term[] => {
    const out: Term[] = [];
    const seen = new Set<UUID>([id]);
    const queue = [...(childrenOf.get(id) ?? none)];
    while (queue.length) {
      const t = queue.shift() as Term;
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      out.push(t);
      queue.push(...(childrenOf.get(t.id) ?? none));
    }
    return out;
  };
  return {
    roots: (vocabularyId) => rootsOf.get(vocabularyId) ?? none,
    children: (id) => childrenOf.get(id) ?? none,
    parent,
    ancestors,
    descendants,
    covers: (ancestorId, termId) => ancestorId === termId || ancestors(termId).some((t) => t.id === ancestorId),
    rejected,
  };
}

// --- Nesil indeksleri -----------------------------------------------------------------------------
export interface GenerationIndexes {
  byId: ReadonlyMap<UUID, BaseRecord>;
  relationsBySource: ReadonlyMap<UUID, readonly Relation[]>;
  relationsByTarget: ReadonlyMap<UUID, readonly Relation[]>;
  roomsById: ReadonlyMap<UUID, Room>;
  termsById: ReadonlyMap<UUID, Term>;
  vocabulariesByKey: ReadonlyMap<string, Vocabulary>;
  /** Sözlük key ('category', 'payment_state', …) → terim code → Term. */
  termsByVocabulary: ReadonlyMap<string, ReadonlyMap<string, Term>>;
  mediaByEntity: ReadonlyMap<UUID, readonly MediaReference[]>;
  termTree: TermTree;
}

export function buildIndexes(collections: GenerationCollections): GenerationIndexes {
  const byId = new Map<UUID, BaseRecord>();
  for (const records of Object.values(collections)) {
    if (!records) continue;
    for (const r of records) byId.set(r.id, r);
  }

  const relationsBySource = new Map<UUID, Relation[]>();
  const relationsByTarget = new Map<UUID, Relation[]>();
  for (const rel of collections.relations ?? []) {
    push(relationsBySource, rel.source_id, rel);
    push(relationsByTarget, rel.target_id, rel);
  }

  const roomsById = new Map<UUID, Room>();
  for (const room of collections.rooms ?? []) roomsById.set(room.id, room);

  const terms = collections.terms ?? [];
  const termsById = new Map<UUID, Term>();
  for (const t of terms) termsById.set(t.id, t);

  const vocabulariesByKey = new Map<string, Vocabulary>();
  const vocabularyKeyById = new Map<UUID, string>();
  const termsByVocabulary = new Map<string, Map<string, Term>>();
  for (const v of collections.vocabularies ?? []) {
    vocabulariesByKey.set(v.key, v);
    vocabularyKeyById.set(v.id, v.key);
    termsByVocabulary.set(v.key, new Map());
  }
  for (const t of terms) {
    const key = vocabularyKeyById.get(t.vocabulary_id);
    if (key === undefined) continue; // sözlüğü yüklenmemiş terim: byId/termsById'de kalır, key eşlemesi yok
    termsByVocabulary.get(key)?.set(t.code, t);
  }

  const mediaByEntity = new Map<UUID, MediaReference[]>();
  for (const m of collections.media_references ?? []) push(mediaByEntity, m.entity_id, m);

  return { byId, relationsBySource, relationsByTarget, roomsById, termsById, vocabulariesByKey, termsByVocabulary, mediaByEntity, termTree: buildTermTree(terms) };
}

// --- Durum etiketi ------------------------------------------------------------------------------
/** Terim koduna göre ton; renk tek işaret değildir, etiket her zaman yanında gider. */
const TONE_BY_CODE: Readonly<Record<string, Tone>> = {
  // olumlu: teslim / kuruldu / ödendi / tamamlandı / karar verildi / anlaşıldı
  delivered: 'olumlu', installed: 'olumlu', paid: 'olumlu', completed: 'olumlu', done: 'olumlu', decided: 'olumlu',
  contracted: 'olumlu', selected: 'olumlu', teslim: 'olumlu', kuruldu: 'olumlu',
  // hata: iptal / gecikti / geri alındı / engelli
  cancelled: 'hata', reversed: 'hata', blocked: 'hata', iptal: 'hata', late: 'hata', overdue: 'hata', delayed: 'hata', gecikti: 'hata',
  // uyari: bekleyen / kısmen
  pending: 'uyari', partially_paid: 'uyari', bekliyor: 'uyari',
  // bilgi: sürüyor / sipariş edildi / araştırılıyor
  ordered: 'bilgi', in_progress: 'bilgi', researching: 'bilgi', searching: 'bilgi', shortlisted: 'bilgi', siparis: 'bilgi', arastirma: 'bilgi',
};
export function toneForCode(code: string): Tone {
  return TONE_BY_CODE[code] ?? 'notr';
}

const UNKNOWN: StatusLabel = { label: 'Bilinmiyor', tone: 'notr' };
/** Birincil durum: iptal kararı her şeyi örter; sonra teslimat, karar, kontrol. Ödeme ayrı eksendir (paymentLabel). */
const PRIMARY_AXES: readonly StateAxis[] = ['fulfillment', 'decision', 'inspection'];

function axisLabel(record: PurchaseNeedRecord, ctx: Pick<GenerationIndexes, 'termsById'>, axis: StateAxis): StatusLabel | undefined {
  const termId = record.state_term_ids?.[axis] ?? null;
  const code = record.state_snapshot?.[axis] ?? null;
  const term = termId ? ctx.termsById.get(termId) : undefined;
  if (term) return { label: term.label, tone: toneForCode(term.code) };
  if (code) return { label: code, tone: toneForCode(code) };
  return undefined;
}

export function stateLabel(record: PurchaseNeedRecord, ctx: Pick<GenerationIndexes, 'termsById'>, axis?: StateAxis): StatusLabel {
  if (axis) return axisLabel(record, ctx, axis) ?? UNKNOWN;
  const decision = axisLabel(record, ctx, 'decision');
  if (decision && decision.tone === 'hata') return decision;
  for (const a of PRIMARY_AXES) {
    const found = axisLabel(record, ctx, a);
    if (found) return found;
  }
  return UNKNOWN;
}

export function paymentLabel(record: PurchaseNeedRecord, ctx: Pick<GenerationIndexes, 'termsById'>): StatusLabel | undefined {
  return axisLabel(record, ctx, 'payment');
}

// --- RecordRow ------------------------------------------------------------------------------------
export type RecordRowContext = Pick<GenerationIndexes, 'termsById' | 'roomsById' | 'mediaByEntity' | 'relationsBySource'>;

const OWNER_KEYS = ['sahip', 'sorumlu', 'owner'] as const;

function money(value: unknown): Money | null {
  if (!value || typeof value !== 'object') return null;
  const { amount, currency } = value as { amount?: unknown; currency?: unknown };
  if (typeof amount !== 'string' || amount === '' || typeof currency !== 'string' || currency === '') return null;
  return { amount, currency };
}

function roomName(record: PurchaseNeedRecord, ctx: RecordRowContext): string | undefined {
  const direct = record.room_id ? ctx.roomsById.get(record.room_id) : undefined;
  if (direct) return direct.label ?? direct.code;
  for (const rel of ctx.relationsBySource.get(record.id) ?? []) {
    if (rel.kind !== 'located_in') continue;
    const room = ctx.roomsById.get(rel.target_id);
    if (room) return room.label ?? room.code;
  }
  return undefined;
}

function ownerName(record: PurchaseNeedRecord): string | undefined {
  for (const bag of [record.attributes, record.source_attributes]) {
    if (!bag) continue;
    for (const key of OWNER_KEYS) {
      const v = bag[key];
      if (typeof v === 'string' && v.trim() !== '') return v.trim();
    }
  }
  return undefined;
}

/** Yalnız verification === 'verified' görsel; aksi null ("Fotoğraf yok"). */
function verifiedPhoto(record: PurchaseNeedRecord, ctx: RecordRowContext): RecordRow['photo'] {
  const media = ctx.mediaByEntity.get(record.id) ?? [];
  const hit = media.find((m) => m.verification === 'verified' && m.kind === 'image_candidate' && typeof m.url === 'string' && m.url !== '');
  return hit ? { url: hit.url, verified: true } : null;
}

function rowDates(record: PurchaseNeedRecord): RecordRow['dates'] {
  const d = record.dates ?? {};
  const out: NonNullable<RecordRow['dates']> = {};
  if (d.planned_on) out.planned = d.planned_on;
  if (d.order_due_on) out.ordered = d.order_due_on;
  if (d.delivered_on) out.delivered = d.delivered_on;
  if (d.payment_on) out.paid = d.payment_on;
  return Object.keys(out).length ? out : undefined;
}

export function toRecordRow(record: PurchaseNeedRecord, ctx: RecordRowContext): RecordRow {
  const label = record.label ?? stringAttr(record.attributes, 'ad') ?? stringAttr(record.source_attributes, 'ad') ?? 'Bilinmiyor';
  const category = record.category_term_id ? ctx.termsById.get(record.category_term_id)?.label : undefined;
  const amounts = record.amounts ?? {};
  const row: RecordRow = {
    id: record.id,
    code: record.source_record_id ?? record.id,
    label,
    kind: record.kind,
    status: stateLabel(record, ctx),
    // Plan ve gerçek ayrı alanlardır; biri eksikse diğerinden türetilmez.
    planned: money(amounts.planned),
    actual: money(amounts.actual),
    photo: verifiedPhoto(record, ctx),
  };
  const room = roomName(record, ctx);
  if (room !== undefined) row.room = room;
  if (category !== undefined) row.category = category;
  const owner = ownerName(record);
  if (owner !== undefined) row.owner = owner;
  const payment = paymentLabel(record, ctx);
  if (payment) row.payment = payment;
  const dates = rowDates(record);
  if (dates) row.dates = dates;
  return row;
}

// --- yardımcılar ----------------------------------------------------------------------------------
function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function stringAttr(bag: Record<string, unknown> | undefined, key: string): string | undefined {
  const v = bag?.[key];
  return typeof v === 'string' && v !== '' ? v : undefined;
}
