// Sorgu katmanı: saf TS, React/antd bilmez. Sayfalar kayıtları QueryRow'a çevirir (toQueryRow), FilterPanel'in
// seçimlerini QueryAst'e koyar; evaluate id kümesini, facetCounts seçenek sayımlarını, runQuery sıralı satırları verir.
// Kurallar: aynı boyutta OR, boyutlar arası AND; kategori ebeveyni alt dalları kapsar; 'unknown' eksik alanı eşler
// ("Bilinmiyor" etiketi UI'da); plan ve gerçek tutar hiçbir yerde tek sayıda birleşmez.

import type { FilterFacetKind } from '../shell/contracts';
import type { Decimal, IsoDate, MediaReference, Money, PurchaseNeedRecord, Term } from './types';

// --- Boyutlar -------------------------------------------------------------------------------------------
export type FacetId =
  | 'category' | 'room' | 'phase' | 'context' | 'procurement' | 'payment' | 'funding' | 'owner'
  | 'date' | 'amount' | 'confidence' | 'missing';
/** Seçenek listesi olan boyutlar; date/amount aralıkla çalışır, sayımı yoktur. */
export type DiscreteFacetId = Exclude<FacetId, 'date' | 'amount'>;

/** Eksik alanı temsil eden seçenek değeri; UI "Bilinmiyor" yazar. */
export const UNKNOWN = 'unknown';
export type MissingValue = 'price' | 'photo';
export const MISSING_LABELS: Record<MissingValue, string> = { price: 'Fiyat yok', photo: 'Fotoğraf yok' };

export type DateField = 'planned_on' | 'order_due_on' | 'delivered_on' | 'payment_on' | 'end_on';
export type AmountField = 'planned' | 'actual';
export type SortField = 'label' | AmountField | DateField;
export type SortDir = 'asc' | 'desc';

/** Sorgunun çalıştığı düz satır. Terim alanları terim id'sidir; null = bilinmiyor. */
export interface QueryRow {
  id: string;
  label: string;
  /** Kaynak kaydın kodu (source_record_id); aramaya dahildir. */
  code: string;
  category: string | null;
  room: string | null;
  phase: string | null;
  context: readonly string[];
  /** Tedarik durumu: state_term_ids.fulfillment (yoksa snapshot kodu). */
  procurement: string | null;
  payment: string | null;
  funding: string | null;
  owner: string | null;
  confidence: string | null;
  planned: Money;
  actual: Money;
  dates: Partial<Record<DateField, IsoDate | null>>;
  /** Yalnız doğrulanmış (verified) görsel sayılır. */
  hasPhoto: boolean;
}

export interface QueryAst {
  text?: string;
  /** facetId → seçili değerler (OR). Boş dizi = filtre yok. */
  facets: Partial<Record<FacetId, readonly string[]>>;
  /** dateRange hangi alana uygulanır; verilmezse planned_on. */
  dateField?: DateField;
  dateRange?: { from?: IsoDate; to?: IsoDate };
  /** amountRange hangi tutara uygulanır; verilmezse planned. Plan ve gerçek birleştirilmez. */
  amountField?: AmountField;
  amountRange?: { min?: Decimal; max?: Decimal; currency?: string };
  sort?: { field: SortField; dir: SortDir };
}

export interface QueryContext {
  /** Kategori terimi → ebeveyn terimi (kök: null). */
  parentOf: ReadonlyMap<string, string | null>;
  /** Doğrulanmış görseli olan kayıt id'leri. */
  photoEntities: ReadonlySet<string>;
}

export interface FacetDef {
  id: FacetId;
  label: string;
  kind: FilterFacetKind;
  /** Satırın bu boyuttaki değerleri; eksikse [UNKNOWN]. Aralık boyutlarında boş. */
  values(row: QueryRow): readonly string[];
}

const scalar = (value: string | null): readonly string[] => (value === null || value === '' ? [UNKNOWN] : [value]);
const none: readonly string[] = [];

export const FACETS: readonly FacetDef[] = [
  { id: 'category', label: 'Kategori', kind: 'tree', values: r => scalar(r.category) },
  { id: 'room', label: 'Oda', kind: 'checkbox', values: r => scalar(r.room) },
  { id: 'phase', label: 'Proje aşaması', kind: 'checkbox', values: r => scalar(r.phase) },
  { id: 'context', label: 'Yaşam bağlamı', kind: 'checkbox', values: r => (r.context.length ? r.context : [UNKNOWN]) },
  { id: 'procurement', label: 'Tedarik durumu', kind: 'checkbox', values: r => scalar(r.procurement) },
  { id: 'payment', label: 'Ödeme durumu', kind: 'checkbox', values: r => scalar(r.payment) },
  { id: 'funding', label: 'Finansman türü', kind: 'checkbox', values: r => scalar(r.funding) },
  { id: 'owner', label: 'Sorumlu', kind: 'checkbox', values: r => scalar(r.owner) },
  { id: 'date', label: 'Tarih', kind: 'date', values: () => none },
  { id: 'amount', label: 'Tutar aralığı', kind: 'amount', values: () => none },
  { id: 'confidence', label: 'Veri güveni', kind: 'checkbox', values: r => scalar(r.confidence) },
  {
    id: 'missing',
    label: 'Eksik bilgi',
    kind: 'checkbox',
    values: r => {
      const out: MissingValue[] = [];
      if (r.planned === null && r.actual === null) out.push('price');
      if (!r.hasPhoto) out.push('photo');
      return out;
    },
  },
];

const FACET_BY_ID = new Map(FACETS.map(f => [f.id, f] as const));
const DISCRETE = FACETS.filter((f): f is FacetDef & { id: DiscreteFacetId } => f.kind === 'checkbox' || f.kind === 'tree');

// --- Bağlam ---------------------------------------------------------------------------------------------
export function createQueryContext(input: {
  terms?: readonly Pick<Term, 'id' | 'parent_id'>[];
  media?: readonly Pick<MediaReference, 'entity_id' | 'verification'>[];
}): QueryContext {
  const parentOf = new Map<string, string | null>();
  for (const term of input.terms ?? []) parentOf.set(term.id, term.parent_id);
  const photoEntities = new Set<string>();
  for (const ref of input.media ?? []) if (ref.verification === 'verified') photoEntities.add(ref.entity_id);
  return { parentOf, photoEntities };
}

/** Terim ve atalarını verir (döngüye karşı korumalı). */
function withAncestors(id: string, ctx: QueryContext): string[] {
  const chain = [id];
  const seen = new Set(chain);
  let cursor = ctx.parentOf.get(id) ?? null;
  while (cursor !== null && !seen.has(cursor)) {
    chain.push(cursor);
    seen.add(cursor);
    cursor = ctx.parentOf.get(cursor) ?? null;
  }
  return chain;
}

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value : null);

/** Kayıt → sorgu satırı. Nesilde olmayan alanlar (sorumlu, finansman, güven) attributes'tan okunur, yoksa null. */
export function toQueryRow(record: PurchaseNeedRecord, ctx: QueryContext): QueryRow {
  const attrs = record.attributes ?? {};
  return {
    id: record.id,
    label: record.label ?? '',
    code: record.source_record_id ?? '',
    category: record.category_term_id ?? null,
    room: record.room_id ?? null,
    phase: record.phase_term_id ?? null,
    context: record.context_term_ids ?? [],
    procurement: record.state_term_ids?.fulfillment ?? record.state_snapshot?.fulfillment ?? null,
    payment: record.state_term_ids?.payment ?? record.state_snapshot?.payment ?? null,
    funding: text(attrs['finansman']),
    owner: text(attrs['sorumlu']),
    confidence: text(attrs['guven']),
    planned: record.amounts?.planned ?? null,
    actual: record.amounts?.actual ?? null,
    dates: record.dates ?? {},
    hasPhoto: ctx.photoEntities.has(record.id),
  };
}

// --- Değerlendirme --------------------------------------------------------------------------------------
const fold = (value: string) => value.toLocaleLowerCase('tr-TR');
const tokens = (query: string | undefined) => (query ?? '').trim().split(/\s+/).map(fold).filter(Boolean);

function matchesText(row: QueryRow, words: readonly string[]): boolean {
  if (!words.length) return true;
  const haystack = fold(`${row.label} ${row.code}`);
  return words.every(word => haystack.includes(word));
}

/** Satırın boyuttaki değerleri; ağaçta atalar da eklenir (ebeveyn seçimi alt dalı kapsar). */
function rowValues(facet: FacetDef, row: QueryRow, ctx: QueryContext): readonly string[] {
  const values = facet.values(row);
  if (facet.kind !== 'tree') return values;
  return values.flatMap(value => (value === UNKNOWN ? [value] : withAncestors(value, ctx)));
}

function matchesFacet(facet: FacetDef, selected: readonly string[], row: QueryRow, ctx: QueryContext): boolean {
  if (!selected.length) return true;
  const values = rowValues(facet, row, ctx);
  return selected.some(value => values.includes(value));
}

function matchesDate(row: QueryRow, ast: QueryAst): boolean {
  const range = ast.dateRange;
  if (!range || (range.from === undefined && range.to === undefined)) return true;
  const value = row.dates[ast.dateField ?? 'planned_on'] ?? null;
  if (value === null) return false;
  if (range.from !== undefined && value < range.from) return false;
  if (range.to !== undefined && value > range.to) return false;
  return true;
}

const num = (value: Decimal) => Number(value);

function matchesAmount(row: QueryRow, ast: QueryAst): boolean {
  const range = ast.amountRange;
  if (!range || (range.min === undefined && range.max === undefined)) return true;
  const money = row[ast.amountField ?? 'planned'];
  if (money === null) return false;
  if (range.currency !== undefined && money.currency !== range.currency) return false;
  const amount = num(money.amount);
  if (Number.isNaN(amount)) return false;
  if (range.min !== undefined && amount < num(range.min)) return false;
  if (range.max !== undefined && amount > num(range.max)) return false;
  return true;
}

function activeFacets(ast: QueryAst, except?: FacetId): [FacetDef, readonly string[]][] {
  const out: [FacetDef, readonly string[]][] = [];
  for (const [id, selected] of Object.entries(ast.facets) as [FacetId, readonly string[] | undefined][]) {
    if (id === except || !selected?.length) continue;
    const facet = FACET_BY_ID.get(id);
    if (facet) out.push([facet, selected]);
  }
  return out;
}

function matches(row: QueryRow, ast: QueryAst, ctx: QueryContext, words: readonly string[], facets: readonly [FacetDef, readonly string[]][]): boolean {
  return matchesText(row, words) && matchesDate(row, ast) && matchesAmount(row, ast) && facets.every(([facet, selected]) => matchesFacet(facet, selected, row, ctx));
}

/** AST'ye uyan satırların id kümesi. */
export function evaluate(rows: readonly QueryRow[], ast: QueryAst, ctx: QueryContext): Set<string> {
  const words = tokens(ast.text);
  const facets = activeFacets(ast);
  const out = new Set<string>();
  for (const row of rows) if (matches(row, ast, ctx, words, facets)) out.add(row.id);
  return out;
}

export type FacetCounts = Record<DiscreteFacetId, Record<string, number>>;

/**
 * Her seçenek için sayım: o boyutun kendi seçimi kaldırılır, diğer boyutlar + metin + aralıklar uygulanır.
 * Ağaçta ebeveyn sayımı alt dalları toplar. Seçili değer sıfır sayımda da anahtar olarak kalır.
 */
export function facetCounts(rows: readonly QueryRow[], ast: QueryAst, ctx: QueryContext): FacetCounts {
  const words = tokens(ast.text);
  const out = {} as FacetCounts;
  for (const facet of DISCRETE) {
    const counts: Record<string, number> = {};
    for (const value of ast.facets[facet.id] ?? []) counts[value] = 0;
    const others = activeFacets(ast, facet.id);
    for (const row of rows) {
      if (!matches(row, ast, ctx, words, others)) continue;
      for (const value of new Set(rowValues(facet, row, ctx))) counts[value] = (counts[value] ?? 0) + 1;
    }
    out[facet.id] = counts;
  }
  return out;
}

// --- Sıralama ---------------------------------------------------------------------------------------------
const collator = new Intl.Collator('tr-TR', { sensitivity: 'base', numeric: true });

const sortKey = (row: QueryRow, field: SortField): number | string | null => {
  if (field === 'label') return row.label;
  if (field === 'planned' || field === 'actual') {
    const money = row[field];
    if (money === null) return null;
    const value = num(money.amount);
    return Number.isNaN(value) ? null : value;
  }
  return row.dates[field] ?? null;
};

/** Yeni dizi döndürür; eksik değerler yönden bağımsız sondadır; eşitlikte etiket tr-TR. */
export function sortRows(rows: readonly QueryRow[], sort: QueryAst['sort']): QueryRow[] {
  const copy = [...rows];
  if (!sort) return copy;
  const sign = sort.dir === 'desc' ? -1 : 1;
  return copy.sort((a, b) => {
    const ka = sortKey(a, sort.field);
    const kb = sortKey(b, sort.field);
    if (ka === null && kb === null) return collator.compare(a.label, b.label);
    if (ka === null) return 1;
    if (kb === null) return -1;
    const cmp = typeof ka === 'number' && typeof kb === 'number' ? ka - kb : collator.compare(String(ka), String(kb));
    return cmp !== 0 ? sign * cmp : collator.compare(a.label, b.label);
  });
}

/** Filtre + sıralama; girdi değişmez. */
export function runQuery(rows: readonly QueryRow[], ast: QueryAst, ctx: QueryContext): QueryRow[] {
  const hit = evaluate(rows, ast, ctx);
  return sortRows(rows.filter(row => hit.has(row.id)), ast.sort);
}
