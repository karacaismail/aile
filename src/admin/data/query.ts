// Sorgu katmanı: saf TS, React/antd bilmez. Sayfalar kayıtları QueryRow'a çevirir (toQueryRow), FilterPanel'in
// seçimlerini QueryAst'e koyar; evaluate id kümesini, facetCounts seçenek sayımlarını, runQuery sıralı satırları verir.
// Kurallar: aynı boyutta OR, boyutlar arası AND; kategori ebeveyni alt dalları kapsar (terim ağacıyla aynı üst bağ
// kuralı: indexes.resolveTermParents); 'unknown' eksik alanı eşler ("Bilinmiyor" etiketi UI'da); plan ve gerçek tutar
// hiçbir yerde tek sayıda birleşmez. Sorgu görünüm modundan bağımsızdır: altı mod aynı AST'den aynı ID kümesini alır,
// sıralama satır düşürmez.
//
// İndeks: boyut değeri → konum listesi, arama metni, tarih/tutar sütunları ve sıralama dereceleri bir satır dizisi +
// bağlam için bir kez kurulur (buildQueryIndex). Modül işlevleri (evaluate, facetCounts, runQuery) indeksi aynı dizi
// ve bağlam nesnesi için önbellekten kullanır; dizi nesil başına sabit (değişmez) kabul edilir, uzunluğu değişirse
// indeks yeniden kurulur. Tutarlar ondalık metinden kesin karşılaştırılır; sayıya çevrilmez.

import type { FilterFacetKind } from '../shell/contracts';
import { recordLabel, resolveTermParents, type TermLink } from './indexes';
import type { Decimal, IsoDate, MediaReference, Money, PurchaseNeedRecord } from './types';

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
  /** Görünen ad (indexes.recordLabel); adı olmayan kayıtta '' (UI "Bilinmiyor"). */
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
  /** facetId → seçili değerler (OR). Boş dizi = filtre yok. Yalnız seçenekli boyutlar okunur. */
  facets: Partial<Record<FacetId, readonly string[]>>;
  /** dateRange hangi alana uygulanır; verilmezse planned_on. */
  dateField?: DateField;
  /** Uçlar dâhil; boş ya da ISO gün olmayan sınır yok sayılır. Tarihi olmayan kayıt etkin aralıkta dışarıda kalır. */
  dateRange?: { from?: IsoDate; to?: IsoDate };
  /** amountRange hangi tutara uygulanır; verilmezse planned. Plan ve gerçek birleştirilmez. */
  amountField?: AmountField;
  /** Sınırlar ondalık metindir ("1234.50"); boş ya da ondalık olmayan sınır yok sayılır. */
  amountRange?: { min?: Decimal; max?: Decimal; currency?: string };
  sort?: { field: SortField; dir: SortDir };
}

export interface QueryContext {
  /** Kategori terimi → etkin ebeveyn terimi (kök: null); reddedilen bağlar (döngü, sözlük dışı) kök sayılır. */
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

const DISCRETE = FACETS.filter((f): f is FacetDef & { id: DiscreteFacetId } => f.kind === 'checkbox' || f.kind === 'tree');
const DISCRETE_IDS = new Set<string>(DISCRETE.map(f => f.id));
const DATE_FIELDS: readonly DateField[] = ['planned_on', 'order_due_on', 'delivered_on', 'payment_on', 'end_on'];
const AMOUNT_FIELDS: readonly AmountField[] = ['planned', 'actual'];

// --- Bağlam ---------------------------------------------------------------------------------------------
export function createQueryContext(input: {
  /** Tam Term ya da id + parent_id (+ vocabulary_id). Üst bağ kuralı terim ağacıyla aynıdır. */
  terms?: readonly TermLink[];
  media?: readonly Pick<MediaReference, 'entity_id' | 'verification'>[];
}): QueryContext {
  const { parentOf } = resolveTermParents(input.terms ?? []);
  const photoEntities = new Set<string>();
  for (const ref of input.media ?? []) if (ref.verification === 'verified') photoEntities.add(ref.entity_id);
  return { parentOf, photoEntities };
}

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value : null);

/** Kayıt → sorgu satırı. Nesilde olmayan alanlar (sorumlu, finansman, güven) attributes'tan okunur, yoksa null. */
export function toQueryRow(record: PurchaseNeedRecord, ctx: QueryContext): QueryRow {
  const attrs = record.attributes ?? {};
  return {
    id: record.id,
    label: recordLabel(record) ?? '',
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

// --- Metin ve ondalık ------------------------------------------------------------------------------------
/**
 * Arama katlaması: Türkçe küçük harf + ı ≡ i. İ, I, ı ve i aynı harfe iner; böylece "ikea" "IKEA"yı, "IŞIK" "ışık"ı
 * bulur; diğer Türkçe harfler (ç, ğ, ö, ş, ü) ayrı kalır, aksan kaldırılmaz. toLocaleLowerCase('tr-TR') ile aynı
 * sonucu verir (Türkçeye özgü eşleme yalnız I/İ'dedir) ama yerel ayarsız toLowerCase kullanır: 10 bin satırda
 * indeks kurulumunun en pahalı adımıydı. Ayrışmış "i + U+0307" de i olur.
 */
const fold = (value: string) => value.normalize('NFC').replace(/[I\u0130]/g, 'i').toLowerCase().replace(/\u0307/g, '').replace(/\u0131/g, 'i');
const tokens = (query: string | undefined) => (query ?? '').trim().split(/\s+/).map(fold).filter(Boolean);

const collator = new Intl.Collator('tr-TR', { sensitivity: 'base', numeric: true });

/** Ondalık metin (types.Decimal: ^-?[0-9]+(\.[0-9]+)?$) işaret + tam kısım + kesir; sayıya çevrilmez. */
interface Dec { sign: -1 | 0 | 1; int: string; frac: string }
const DECIMAL = /^(-?)([0-9]+)(?:\.([0-9]+))?$/;

function parseDecimal(value: unknown): Dec | null {
  if (typeof value !== 'string') return null;
  const match = DECIMAL.exec(value);
  if (!match) return null;
  const int = match[2]!.replace(/^0+/, '');
  const frac = (match[3] ?? '').replace(/0+$/, '');
  if (int === '' && frac === '') return { sign: 0, int, frac };
  return { sign: match[1] ? -1 : 1, int, frac };
}

function compareDecimal(a: Dec, b: Dec): number {
  if (a.sign !== b.sign) return a.sign < b.sign ? -1 : 1;
  if (a.sign === 0) return 0;
  let magnitude: number;
  if (a.int.length !== b.int.length) magnitude = a.int.length < b.int.length ? -1 : 1;
  else if (a.int !== b.int) magnitude = a.int < b.int ? -1 : 1;
  // Sondaki sıfırlar atıldığı için kesir basamak basamak (sözlük sırası) karşılaştırılır: "05" < "5" < "51".
  else if (a.frac !== b.frac) magnitude = a.frac < b.frac ? -1 : 1;
  else return 0;
  return a.sign * magnitude;
}

/** Aralık sınırı ISO gün (YYYY-MM-DD) ise kendisi; boş ya da başka biçimse null (sınır yok sayılır). */
const ISO_DAY = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const isoDay = (value: unknown): string | null => (typeof value === 'string' && ISO_DAY.test(value) ? value : null);

// --- Sütunlar (satır dizisi başına; bağlamdan bağımsız) ---------------------------------------------------
interface Columns {
  readonly n: number;
  readonly ids: readonly string[];
  readonly labels: readonly string[];
  readonly haystacks: readonly string[];
  readonly dates: Readonly<Record<DateField, readonly (string | null)[]>>;
  readonly amounts: Readonly<Record<AmountField, readonly (Dec | null)[]>>;
  readonly currencies: Readonly<Record<AmountField, readonly (string | null)[]>>;
  /** Sıralama dereceleri, ilk kullanımda kurulur; eksik anahtar -1. Eşit anahtar eşit derece alır. */
  readonly ranks: Map<SortField, Int32Array>;
}

function buildColumns(rows: readonly QueryRow[]): Columns {
  const n = rows.length;
  const ids: string[] = new Array(n);
  const labels: string[] = new Array(n);
  const haystacks: string[] = new Array(n);
  const dates = Object.fromEntries(DATE_FIELDS.map(f => [f, new Array<string | null>(n)])) as Record<DateField, (string | null)[]>;
  const amounts = Object.fromEntries(AMOUNT_FIELDS.map(f => [f, new Array<Dec | null>(n)])) as Record<AmountField, (Dec | null)[]>;
  const currencies = Object.fromEntries(AMOUNT_FIELDS.map(f => [f, new Array<string | null>(n)])) as Record<AmountField, (string | null)[]>;
  for (let p = 0; p < n; p += 1) {
    const row = rows[p]!;
    const label = row.label ?? '';
    const code = row.code ?? '';
    ids[p] = row.id;
    labels[p] = label;
    haystacks[p] = fold(`${label} ${code}`);
    const rowDates = row.dates ?? {};
    for (const field of DATE_FIELDS) {
      const value = rowDates[field];
      dates[field][p] = typeof value === 'string' && value !== '' ? value : null;
    }
    for (const field of AMOUNT_FIELDS) {
      const money = row[field];
      amounts[field][p] = money ? parseDecimal(money.amount) : null;
      currencies[field][p] = money ? money.currency : null;
    }
  }
  return { n, ids, labels, haystacks, dates, amounts, currencies, ranks: new Map() };
}

/** Eşit anahtarlar aynı dereceyi alır; böylece eşitlikte etiket, sonra girdi sırası belirler (kararlı). */
function rankBy<K>(n: number, key: (p: number) => K | null, compare: (a: K, b: K) => number): Int32Array {
  const ranks = new Int32Array(n).fill(-1);
  const present: number[] = [];
  for (let p = 0; p < n; p += 1) if (key(p) !== null) present.push(p);
  present.sort((a, b) => compare(key(a)!, key(b)!) || a - b);
  let rank = -1;
  for (let i = 0; i < present.length; i += 1) {
    if (i === 0 || compare(key(present[i - 1]!)!, key(present[i]!)!) !== 0) rank += 1;
    ranks[present[i]!] = rank;
  }
  return ranks;
}

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function ranksFor(cols: Columns, field: SortField): Int32Array {
  const cached = cols.ranks.get(field);
  if (cached) return cached;
  let ranks: Int32Array;
  if (field === 'label') ranks = rankBy(cols.n, p => (cols.labels[p] === '' ? null : cols.labels[p]!), collator.compare);
  else if (field === 'planned' || field === 'actual') ranks = rankBy(cols.n, p => cols.amounts[field][p] ?? null, compareDecimal);
  else ranks = rankBy(cols.n, p => cols.dates[field][p] ?? null, compareText);
  cols.ranks.set(field, ranks);
  return ranks;
}

/** Konumları sıralar: eksik anahtar yönden bağımsız sonda; eşitlikte etiket (tr-TR, artan), sonra girdi sırası. */
function sortPositions(cols: Columns, positions: number[], sort: QueryAst['sort']): number[] {
  if (!sort) return positions;
  const keys = ranksFor(cols, sort.field);
  const labels = ranksFor(cols, 'label');
  const sign = sort.dir === 'desc' ? -1 : 1;
  return positions.sort((a, b) => {
    const ka = keys[a]!;
    const kb = keys[b]!;
    if (ka < 0 || kb < 0) {
      if (ka >= 0) return -1;
      if (kb >= 0) return 1;
    } else if (ka !== kb) {
      return sign * (ka - kb);
    }
    return labels[a]! - labels[b]! || a - b;
  });
}

// --- Sorgu indeksi -----------------------------------------------------------------------------------------
export interface QueryIndex {
  readonly rows: readonly QueryRow[];
  readonly ctx: QueryContext;
  /** İndekslenen satır sayısı. */
  readonly size: number;
  /** AST'ye uyan satırların id kümesi (girdi sırasıyla). */
  evaluate(ast: QueryAst): Set<string>;
  /** Seçenek sayımları; bkz. facetCounts. */
  facetCounts(ast: QueryAst): FacetCounts;
  /** Filtre + sıralama; girdi değişmez. */
  run(ast: QueryAst): QueryRow[];
}

interface FacetColumn {
  /** Satır başına değerler (ağaçta atalar dahil, tekrarsız); aynı içerikli diziler paylaşılır. */
  readonly values: readonly (readonly string[])[];
  /** Değer → artan konumlar. */
  readonly postings: ReadonlyMap<string, Uint32Array>;
}

function buildFacetColumns(rows: readonly QueryRow[], ctx: QueryContext): Record<DiscreteFacetId, FacetColumn> {
  // Terim → [terim, üst, üstün üstü, …] (bağlamın etkin üst bağlarıyla; döngüye karşı korumalı), paylaşılan dizi.
  const lineage = new Map<string, readonly string[]>();
  const withAncestors = (id: string): readonly string[] => {
    let chain = lineage.get(id);
    if (chain) return chain;
    const out = [id];
    const seen = new Set(out);
    let cursor = ctx.parentOf.get(id) ?? null;
    while (cursor !== null && !seen.has(cursor)) {
      out.push(cursor);
      seen.add(cursor);
      cursor = ctx.parentOf.get(cursor) ?? null;
    }
    chain = out;
    lineage.set(id, chain);
    return chain;
  };
  const single = new Map<string, readonly string[]>();
  const one = (value: string) => {
    let list = single.get(value);
    if (!list) single.set(value, (list = [value]));
    return list;
  };

  const out = {} as Record<DiscreteFacetId, FacetColumn>;
  for (const facet of DISCRETE) {
    const values: (readonly string[])[] = new Array(rows.length);
    const lists = new Map<string, number[]>();
    for (let p = 0; p < rows.length; p += 1) {
      const raw = facet.values(rows[p]!);
      let expanded: readonly string[];
      if (facet.kind === 'tree') {
        expanded = raw.length === 1 ? (raw[0] === UNKNOWN ? one(UNKNOWN) : withAncestors(raw[0]!)) : [...new Set(raw.flatMap(v => (v === UNKNOWN ? [v] : withAncestors(v))))];
      } else {
        expanded = raw.length === 0 ? none : raw.length === 1 ? one(raw[0]!) : [...new Set(raw)];
      }
      values[p] = expanded;
      for (const value of expanded) {
        const list = lists.get(value);
        if (list) list.push(p);
        else lists.set(value, [p]);
      }
    }
    const postings = new Map<string, Uint32Array>();
    for (const [value, list] of lists) postings.set(value, Uint32Array.from(list));
    out[facet.id] = { values, postings };
  }
  return out;
}

/** Satır dizisi + bağlam için indeksi kurar (önbelleğe bakmaz; ölçüm ve açık kullanım için). */
export function buildQueryIndex(rows: readonly QueryRow[], ctx: QueryContext): QueryIndex {
  const cols = buildColumns(rows);
  const facets = buildFacetColumns(rows, ctx);
  const n = cols.n;

  /** Metin + tarih + tutar; hiçbiri etkin değilse null (hepsi geçer). */
  const baseMask = (ast: QueryAst): Uint8Array | null => {
    const words = tokens(ast.text);
    const from = isoDay(ast.dateRange?.from);
    const to = isoDay(ast.dateRange?.to);
    const dateActive = from !== null || to !== null;
    const dates = cols.dates[ast.dateField ?? 'planned_on'];
    const min = parseDecimal(ast.amountRange?.min);
    const max = parseDecimal(ast.amountRange?.max);
    const amountActive = min !== null || max !== null;
    const amountField = ast.amountField ?? 'planned';
    const amounts = cols.amounts[amountField];
    const currencies = cols.currencies[amountField];
    const currency = ast.amountRange?.currency;
    if (!words.length && !dateActive && !amountActive) return null;
    const mask = new Uint8Array(n);
    for (let p = 0; p < n; p += 1) {
      if (words.length) {
        const haystack = cols.haystacks[p]!;
        if (!words.every(word => haystack.includes(word))) continue;
      }
      if (dateActive) {
        const value = dates[p];
        if (value === null || value === undefined) continue;
        if (from !== null && value < from) continue;
        if (to !== null && value > to) continue;
      }
      if (amountActive) {
        const amount = amounts[p];
        if (!amount) continue;
        if (currency !== undefined && currencies[p] !== currency) continue;
        if (min !== null && compareDecimal(amount, min) < 0) continue;
        if (max !== null && compareDecimal(amount, max) > 0) continue;
      }
      mask[p] = 1;
    }
    return mask;
  };

  /** Etkin seçenekli boyutlar ve OR maskeleri (seçili değerlerden herhangi biri). */
  const facetMasks = (ast: QueryAst): Map<DiscreteFacetId, Uint8Array> => {
    const masks = new Map<DiscreteFacetId, Uint8Array>();
    for (const [id, selected] of Object.entries(ast.facets) as [FacetId, readonly string[] | undefined][]) {
      if (!selected?.length || !DISCRETE_IDS.has(id)) continue;
      const facetId = id as DiscreteFacetId;
      const mask = new Uint8Array(n);
      for (const value of selected) {
        const positions = facets[facetId].postings.get(value);
        if (positions) for (const p of positions) mask[p] = 1;
      }
      masks.set(facetId, mask);
    }
    return masks;
  };

  const matchPositions = (ast: QueryAst): number[] => {
    const base = baseMask(ast);
    const masks = [...facetMasks(ast).values()];
    const out: number[] = [];
    outer: for (let p = 0; p < n; p += 1) {
      if (base && !base[p]) continue;
      for (const mask of masks) if (!mask[p]) continue outer;
      out.push(p);
    }
    return out;
  };

  return {
    rows,
    ctx,
    size: n,
    evaluate(ast) {
      const out = new Set<string>();
      for (const p of matchPositions(ast)) out.add(cols.ids[p]!);
      return out;
    },
    facetCounts(ast) {
      const base = baseMask(ast);
      const masks = facetMasks(ast);
      const passed = new Uint8Array(n);
      for (const mask of masks.values()) for (let p = 0; p < n; p += 1) passed[p] += mask[p]!;
      const out = {} as FacetCounts;
      for (const facet of DISCRETE) {
        const counts: Record<string, number> = {};
        for (const value of ast.facets[facet.id] ?? []) counts[value] = 0;
        const own = masks.get(facet.id);
        const need = masks.size - (own ? 1 : 0);
        const values = facets[facet.id].values;
        for (let p = 0; p < n; p += 1) {
          if (base && !base[p]) continue;
          if (passed[p]! - (own ? own[p]! : 0) !== need) continue;
          for (const value of values[p]!) counts[value] = (counts[value] ?? 0) + 1;
        }
        out[facet.id] = counts;
      }
      return out;
    },
    run(ast) {
      return sortPositions(cols, matchPositions(ast), ast.sort).map(p => rows[p]!);
    },
  };
}

// Satır dizisi → bağlam → indeks. Diziler nesil başına sabittir (useGeneration useMemo); uzunluk değişirse yeniden kurulur.
const INDEXES = new WeakMap<readonly QueryRow[], WeakMap<QueryContext, QueryIndex>>();

function indexFor(rows: readonly QueryRow[], ctx: QueryContext): QueryIndex {
  let byContext = INDEXES.get(rows);
  const cached = byContext?.get(ctx);
  if (cached && cached.size === rows.length) return cached;
  const index = buildQueryIndex(rows, ctx);
  if (!byContext) INDEXES.set(rows, (byContext = new WeakMap()));
  byContext.set(ctx, index);
  return index;
}

// --- Değerlendirme --------------------------------------------------------------------------------------
/** AST'ye uyan satırların id kümesi. */
export function evaluate(rows: readonly QueryRow[], ast: QueryAst, ctx: QueryContext): Set<string> {
  return indexFor(rows, ctx).evaluate(ast);
}

export type FacetCounts = Record<DiscreteFacetId, Record<string, number>>;

/**
 * Her seçenek için sayım: o boyutun kendi seçimi kaldırılır, diğer boyutlar + metin + aralıklar uygulanır.
 * Ağaçta ebeveyn sayımı alt dalları toplar. Seçili değer sıfır sayımda da anahtar olarak kalır.
 */
export function facetCounts(rows: readonly QueryRow[], ast: QueryAst, ctx: QueryContext): FacetCounts {
  return indexFor(rows, ctx).facetCounts(ast);
}

// --- Sıralama ---------------------------------------------------------------------------------------------
/**
 * Yeni dizi döndürür. Etiket tr-TR (İ/ı, Ç, Ş, Ö doğru yerde; sayılar doğal sırada); tutar ondalık metinden kesin;
 * tarih ISO. Eksik değerler (adı olmayan kayıt dahil) yönden bağımsız sondadır; eşitlikte etiket, sonra girdi sırası.
 */
export function sortRows(rows: readonly QueryRow[], sort: QueryAst['sort']): QueryRow[] {
  if (!sort) return [...rows];
  const cols = buildColumns(rows);
  return sortPositions(cols, Array.from({ length: cols.n }, (_, p) => p), sort).map(p => rows[p]!);
}

/** Filtre + sıralama; girdi değişmez. */
export function runQuery(rows: readonly QueryRow[], ast: QueryAst, ctx: QueryContext): QueryRow[] {
  return indexFor(rows, ctx).run(ast);
}
