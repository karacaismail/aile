// 10 bin kayıtlık bellek içi sentetik yük: sentetik nesildeki sözlük/oda/şablon kayıtlarından deterministik üretilir
// (gerçek veri yok, ağ yok). Test yalnız doğruluk iddia eder: indeksli sorgu, bağımsız yazılmış basit başvuru
// değerlendiricisiyle aynı ID kümesini, sayımları ve sırayı verir; aynı sorgu altı görünüm modunda aynı kümedir.
// Süreler ve bellek yalnız ölçülür, eşik yoktur: bu bir kapasite iddiası değildir. Kayıt için:
//   AILE_QUERY_PERF_RECORD=src/admin/data/query.perf.json pnpm exec vitest run --execArgv=--expose-gc src/admin/data/query.perf.test.ts
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { arch, cpus, loadavg, platform } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { VIEW_MODES, type ViewMode } from '../shell/contracts';
import { parsePartition } from './contract';
import { buildIndexes, buildTermTree, type GenerationCollections } from './indexes';
import {
  UNKNOWN,
  buildQueryIndex,
  createQueryContext,
  toQueryRow,
  type DateField,
  type DiscreteFacetId,
  type FacetCounts,
  type QueryAst,
  type QueryRow,
  type SortField,
} from './query';
import type { MediaReference, PurchaseNeedRecord, Relation, Room, Term, Vocabulary } from './types';

const COUNT = 10_000;
const SEED = 2098;

// --- Sentetik nesil (fixtures/generation-synthetic) -------------------------------------------------------
const FIXTURE_ROOT = join(process.cwd(), 'fixtures', 'generation-synthetic');
const GENERATION_DIR = join(FIXTURE_ROOT, readdirSync(FIXTURE_ROOT).find((d) => /^[0-9a-f]{64}$/.test(d)) ?? '');
const records = <R>(rel: string): R[] => (JSON.parse(readFileSync(join(GENERATION_DIR, rel), 'utf8')) as { records: R[] }).records;
const terms = records<Term>('data/terms/global/00000.json');
const vocabularies = records<Vocabulary>('data/vocabularies/global/00000.json');
const rooms = records<Room>('data/rooms/household/00000.json');
const relations = records<Relation>('data/relations/household/00000.json');
const templates = records<PurchaseNeedRecord>('data/purchase_needs/household/00000.json');

const vocabularyKey = new Map(vocabularies.map((v) => [v.id, v.key] as const));
const termsOf = (key: string) => terms.filter((t) => vocabularyKey.get(t.vocabulary_id) === key);
const CATEGORY = termsOf('category');
const PHASE = termsOf('phase');
const CONTEXT = termsOf('life_context');
const FULFILLMENT = termsOf('fulfillment_state');
const PAYMENT = termsOf('payment_state');
const FUNDING = termsOf('funding_type').map((t) => t.code);
const OWNERS = ['Ayşe', 'Işıl', 'İlker', 'Çağrı', 'Ümit'];
const CONFIDENCE = ['yüksek', 'orta', 'düşük'];
// İ/ı, Ç, Ş, Ö ve büyük harfli Latin adlar sıralama ve aramayı zorlar.
const ADJECTIVES = ['Işıklı', 'İnce', 'ılık', 'Çift', 'Şık', 'Öğle', 'ufak', 'Geniş', 'IKEA', 'iPhone', 'Ahşap', 'Cam'];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const uuid = (n: number, block = 8000) => `00000000-0000-4000-${block}-${n.toString(16).padStart(12, '0')}`;
const DAY = 86_400_000;
const START = Date.UTC(2026, 0, 1);

function synthesize(count: number, seed: number): { needs: PurchaseNeedRecord[]; media: MediaReference[] } {
  const rnd = mulberry32(seed);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
  const maybe = <T,>(p: number, make: () => T): T | null => (rnd() < p ? make() : null);
  const day = () => new Date(START + Math.floor(rnd() * 730) * DAY).toISOString().slice(0, 10);
  const money = () => ({ amount: (Math.floor(rnd() * 5_000_000) / 100).toFixed(2), currency: rnd() < 0.98 ? 'TRY' : 'EUR' });
  const needs: PurchaseNeedRecord[] = [];
  const media: MediaReference[] = [];
  for (let n = 0; n < count; n += 1) {
    const base = templates[n % templates.length]!;
    const noun = (base.label ?? 'kalem').replace(/^Örnek /, '');
    const label = `${pick(ADJECTIVES)} ${noun} ${(n % 97) + 1}`;
    const fulfillment = maybe(0.7, () => pick(FULFILLMENT));
    const payment = maybe(0.8, () => pick(PAYMENT));
    const id = uuid(n + 1);
    needs.push({
      ...base,
      id,
      label,
      source_record_id: `yuk-${String(n + 1).padStart(5, '0')}`,
      category_term_id: maybe(0.95, () => pick(CATEGORY).id),
      phase_term_id: maybe(0.9, () => pick(PHASE).id),
      context_term_ids: CONTEXT.length && rnd() < 0.2 ? [CONTEXT[0]!.id] : [],
      room_id: maybe(0.92, () => pick(rooms).id),
      state_snapshot: { decision: null, fulfillment: fulfillment?.code ?? null, inspection: null, payment: payment?.code ?? null },
      state_term_ids: { decision: null, fulfillment: fulfillment?.id ?? null, inspection: null, payment: payment?.id ?? null },
      amounts: { planned: maybe(0.85, money), actual: maybe(0.3, money) },
      dates: { planned_on: maybe(0.8, day), order_due_on: maybe(0.3, day), delivered_on: maybe(0.2, day), payment_on: maybe(0.2, day), end_on: maybe(0.1, day) },
      attributes: {
        ad: label,
        ...(rnd() < 0.5 ? { sorumlu: pick(OWNERS) } : {}),
        ...(rnd() < 0.4 ? { finansman: pick(FUNDING) } : {}),
        ...(rnd() < 0.6 ? { guven: pick(CONFIDENCE) } : {}),
      },
      provenance: base.provenance ? { ...base.provenance, row: n + 2, a1: `${n + 2}:${n + 2}` } : null,
    });
    if (rnd() < 0.45) {
      media.push({
        id: uuid(n + 1, 9000),
        tenant_id: base.tenant_id,
        kind: 'image_candidate',
        entity_id: id,
        url: `https://example.invalid/sentetik/${n + 1}.jpg`,
        verification: rnd() < 0.66 ? 'verified' : 'not_verified',
        rights_status: 'unknown',
      });
    }
  }
  return { needs, media };
}

// --- Bağımsız başvuru değerlendiricisi (tasarım kuralından yazıldı; query.ts'i kullanmaz) ------------------
const tree = buildTermTree(terms);
const collator = new Intl.Collator('tr', { sensitivity: 'base', numeric: true });
const foldRef = (s: string) => s.toLocaleLowerCase('tr').split('ı').join('i');
const DISCRETE: readonly DiscreteFacetId[] = ['category', 'room', 'phase', 'context', 'procurement', 'payment', 'funding', 'owner', 'confidence', 'missing'];

function refValues(facet: DiscreteFacetId, row: QueryRow): string[] {
  const one = (v: string | null) => [v === null || v === '' ? UNKNOWN : v];
  switch (facet) {
    case 'category': return row.category === null ? [UNKNOWN] : [row.category, ...tree.ancestors(row.category).map((t) => t.id)];
    case 'context': return row.context.length ? [...new Set(row.context)] : [UNKNOWN];
    case 'missing': return [...(row.planned === null && row.actual === null ? ['price'] : []), ...(row.hasPhoto ? [] : ['photo'])];
    default: return one(row[facet]);
  }
}

/** Ondalık metni BigInt ile karşılaştırır (query.ts'ten farklı yöntem: ölçekli tam sayı). */
function refDecimal(a: string, b: string): number {
  const split = (s: string) => { const [i, f = ''] = s.replace('-', '').split('.'); return { neg: s.startsWith('-'), i: i!, f }; };
  const x = split(a), y = split(b);
  const scale = Math.max(x.f.length, y.f.length);
  const big = (v: { neg: boolean; i: string; f: string }) => (v.neg ? -1n : 1n) * BigInt(v.i + v.f.padEnd(scale, '0'));
  const d = big(x) - big(y);
  return d < 0n ? -1 : d > 0n ? 1 : 0;
}
const isDecimal = (s: string | undefined): s is string => typeof s === 'string' && /^-?[0-9]+(\.[0-9]+)?$/.test(s);

function refPasses(row: QueryRow, q: QueryAst, except?: DiscreteFacetId): boolean {
  const words = (q.text ?? '').trim().split(/\s+/).filter(Boolean).map(foldRef);
  if (words.length) {
    const hay = foldRef(`${row.label} ${row.code}`);
    if (!words.every((w) => hay.includes(w))) return false;
  }
  const day = (s: string | undefined) => (s !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined);
  const from = day(q.dateRange?.from);
  const to = day(q.dateRange?.to);
  if (from !== undefined || to !== undefined) {
    const v = row.dates[q.dateField ?? 'planned_on'] ?? null;
    if (!v) return false;
    if (from !== undefined && v < from) return false;
    if (to !== undefined && v > to) return false;
  }
  const min = isDecimal(q.amountRange?.min) ? q.amountRange.min : undefined;
  const max = isDecimal(q.amountRange?.max) ? q.amountRange.max : undefined;
  if (min !== undefined || max !== undefined) {
    const m = row[q.amountField ?? 'planned'];
    if (!m || !isDecimal(m.amount)) return false;
    if (q.amountRange?.currency !== undefined && m.currency !== q.amountRange.currency) return false;
    if (min !== undefined && refDecimal(m.amount, min) < 0) return false;
    if (max !== undefined && refDecimal(m.amount, max) > 0) return false;
  }
  for (const facet of DISCRETE) {
    const selected = q.facets[facet];
    if (facet === except || !selected?.length) continue;
    const values = refValues(facet, row);
    if (!selected.some((s) => values.includes(s))) return false;
  }
  return true;
}

function refCounts(rows: readonly QueryRow[], q: QueryAst): FacetCounts {
  const out = {} as FacetCounts;
  for (const facet of DISCRETE) {
    const counts: Record<string, number> = {};
    for (const s of q.facets[facet] ?? []) counts[s] = 0;
    for (const row of rows) if (refPasses(row, q, facet)) for (const v of refValues(facet, row)) counts[v] = (counts[v] ?? 0) + 1;
    out[facet] = counts;
  }
  return out;
}

function refSortKey(row: QueryRow, field: SortField): string | null {
  if (field === 'label') return row.label === '' ? null : row.label;
  if (field === 'planned' || field === 'actual') return row[field] && isDecimal(row[field]!.amount) ? row[field]!.amount : null;
  return row.dates[field as DateField] || null;
}

function refRun(rows: readonly QueryRow[], q: QueryAst): string[] {
  const hits = rows.map((row, position) => ({ row, position })).filter(({ row }) => refPasses(row, q));
  const sort = q.sort;
  if (!sort) return hits.map((h) => h.row.id);
  const sign = sort.dir === 'desc' ? -1 : 1;
  const cmpKey = (a: string, b: string) => (sort.field === 'planned' || sort.field === 'actual' ? refDecimal(a, b) : sort.field === 'label' ? collator.compare(a, b) : a < b ? -1 : a > b ? 1 : 0);
  return hits
    .sort((a, b) => {
      const ka = refSortKey(a.row, sort.field), kb = refSortKey(b.row, sort.field);
      if (ka !== null && kb === null) return -1;
      if (ka === null && kb !== null) return 1;
      if (ka !== null && kb !== null) { const c = cmpKey(ka, kb); if (c !== 0) return sign * c; }
      return collator.compare(a.row.label, b.row.label) || a.position - b.position;
    })
    .map((h) => h.row.id);
}

// --- Rastgele sorgular ----------------------------------------------------------------------------------
function randomAsts(rows: readonly QueryRow[], count: number, seed: number): QueryAst[] {
  const rnd = mulberry32(seed);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
  const pool = new Map<DiscreteFacetId, string[]>();
  for (const facet of DISCRETE) {
    const seen = new Set<string>();
    for (const row of rows.slice(0, 2000)) for (const v of refValues(facet, row)) seen.add(v);
    pool.set(facet, [...seen]);
  }
  const words = ['ışık', 'IKEA', 'ince', 'ÇİFT', 'lamba', 'yuk-01', 'iphone', 'kase 1'];
  const sorts: SortField[] = ['label', 'planned', 'actual', 'planned_on', 'delivered_on', 'end_on'];
  const out: QueryAst[] = [];
  for (let i = 0; i < count; i += 1) {
    const facets: QueryAst['facets'] = {};
    const n = Math.floor(rnd() * 4);
    for (let k = 0; k < n; k += 1) {
      const facet = pick(DISCRETE);
      const values = pool.get(facet) ?? [];
      if (!values.length) continue;
      facets[facet] = [...new Set(Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => pick(values)))];
    }
    const q: QueryAst = { facets };
    if (rnd() < 0.3) q.text = pick(words);
    if (rnd() < 0.25) { q.dateField = pick(['planned_on', 'delivered_on', 'payment_on'] as const); q.dateRange = { from: '2026-06-01', ...(rnd() < 0.5 ? { to: '2027-03-31' } : {}) }; }
    if (rnd() < 0.25) { q.amountField = rnd() < 0.7 ? 'planned' : 'actual'; q.amountRange = { min: '1000', ...(rnd() < 0.5 ? { max: '25000.50' } : {}), ...(rnd() < 0.2 ? { currency: 'TRY' } : {}) }; }
    if (rnd() < 0.7) q.sort = { field: pick(sorts), dir: rnd() < 0.5 ? 'asc' : 'desc' };
    out.push(q);
  }
  return out;
}

// --- Ölçüm --------------------------------------------------------------------------------------------
const ms = (value: number) => Math.round(value * 100) / 100;
function time<T>(fn: () => T): { value: T; ms: number } {
  const start = performance.now();
  const value = fn();
  return { value, ms: performance.now() - start };
}
function stats(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  return { median: ms(sorted[Math.floor(sorted.length / 2)]!), min: ms(sorted[0]!), max: ms(sorted[sorted.length - 1]!), runs: sorted.length };
}
const gc = (globalThis as { gc?: () => void }).gc;
const heapMb = () => { gc?.(); return process.memoryUsage().heapUsed / 1_048_576; };

const MODE_SORT: Record<ViewMode, QueryAst['sort']> = {
  listing: { field: 'label', dir: 'asc' },
  table: { field: 'label', dir: 'asc' },
  timeline: { field: 'planned_on', dir: 'asc' },
  kanban: { field: 'label', dir: 'asc' },
  gantt_chart: { field: 'end_on', dir: 'asc' },
  pivot: undefined,
};

describe(`sentetik yük: ${COUNT} kayıt (kapasite iddiası değil)`, () => {
  it('parse → normalize → indeks → filtre; indeksli sonuç başvuru değerlendiricisiyle aynı', { timeout: 300_000 }, () => {
    const { needs, media } = synthesize(COUNT, SEED);
    const text = JSON.stringify({ schemaVersion: 1, collection: 'purchase_needs', records: needs });

    const jsonParse = time(() => JSON.parse(text) as unknown);
    const contract = time(() => parsePartition('purchase_needs', jsonParse.value));
    expect(contract.value.records).toHaveLength(COUNT);
    const parsed = contract.value.records as unknown as PurchaseNeedRecord[];

    const ctx = createQueryContext({ terms, media });
    const heapBeforeRows = heapMb();
    const normalize = time(() => parsed.map((r) => toQueryRow(r, ctx)));
    const rows = normalize.value;
    const heapAfterRows = heapMb();
    expect(rows).toHaveLength(COUNT);
    expect(new Set(rows.map((r) => r.id)).size).toBe(COUNT);

    const collections: GenerationCollections = { purchase_needs: parsed, rooms, terms, vocabularies, relations, media_references: media };
    const generationIndexes = stats(Array.from({ length: 3 }, () => time(() => buildIndexes(collections)).ms));
    // Yalnız son indeks tutulur; GC zorlanabiliyorsa fark indeksin kendi belleğidir.
    const heapBeforeIndex = heapMb();
    const queryIndexMs: number[] = [];
    let index = buildQueryIndex(rows, ctx);
    for (let i = 0; i < 3; i += 1) {
      const run = time(() => buildQueryIndex(rows, ctx));
      queryIndexMs.push(run.ms);
      index = run.value;
    }
    const heapAfterIndex = heapMb();

    const fixed: QueryAst[] = [
      { facets: {} },
      { facets: { category: [CATEGORY.find((t) => t.code === 'group:mutfak')!.id] } },
      { facets: { room: [rooms[0]!.id, rooms[1]!.id], payment: [PAYMENT[0]!.id] } },
      { facets: { context: [CONTEXT[0]!.id], phase: [PHASE[0]!.id] } },
      { facets: { missing: ['price', 'photo'], room: [UNKNOWN] } },
      { text: 'ışık', facets: {} },
      { text: 'ikea', facets: { procurement: [UNKNOWN] }, sort: { field: 'planned', dir: 'desc' } },
      { facets: {}, dateField: 'planned_on', dateRange: { from: '2026-09-01', to: '2026-12-31' }, sort: { field: 'planned_on', dir: 'asc' } },
      { facets: { owner: ['Işıl', 'İlker'] }, amountField: 'actual', amountRange: { min: '100', max: '30000' }, sort: { field: 'actual', dir: 'asc' } },
      { facets: {}, sort: { field: 'label', dir: 'asc' } },
    ];
    const asts = [...fixed, ...randomAsts(rows, 40, SEED + 1)];

    // Doğruluk: küme, sayım, sıra; altı modda aynı küme.
    for (const q of asts) {
      const expectedIds = refRun(rows, { ...q, sort: undefined });
      const got = index.evaluate(q);
      expect([...got]).toEqual(expectedIds);
      expect(index.run(q).map((r) => r.id)).toEqual(refRun(rows, q));
      const expectedSet = [...expectedIds].sort();
      for (const mode of VIEW_MODES) {
        const ids = index.run({ ...q, sort: MODE_SORT[mode] }).map((r) => r.id).sort();
        expect(ids).toEqual(expectedSet);
      }
    }
    for (const q of fixed) expect(index.facetCounts(q)).toEqual(refCounts(rows, q));
    expect(index.evaluate(fixed[0]!).size).toBe(COUNT);
    expect(index.run(fixed[9]!).length).toBe(COUNT);

    // Ölçüm (eşik yok).
    const filter = stats(fixed.flatMap((q) => Array.from({ length: 5 }, () => time(() => index.evaluate(q)).ms)));
    const counts = stats(fixed.flatMap((q) => Array.from({ length: 3 }, () => time(() => index.facetCounts(q)).ms)));
    const fresh = buildQueryIndex(rows, ctx);
    const firstSort = time(() => fresh.run({ facets: {}, sort: { field: 'label', dir: 'asc' } })).ms;
    const warmSort = stats(Array.from({ length: 5 }, () => time(() => index.run({ facets: {}, sort: { field: 'label', dir: 'asc' } })).ms));
    const record = {
      schema: 1,
      note: 'Bellek içi sentetik yük (fixtures/generation-synthetic şablonlarından deterministik üretim). Kapasite iddiası değildir; makine paylaşımlıyken ölçüldü, mutlak süreler gürültülüdür.',
      records: COUNT,
      seed: SEED,
      environment: { node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0]?.model ?? 'bilinmiyor', cpus: cpus().length, loadavg_1m: ms(loadavg()[0] ?? 0), gc_forced: Boolean(gc) },
      bytes: { partition_json: Buffer.byteLength(text, 'utf8') },
      ms: {
        json_parse: ms(jsonParse.ms),
        contract_parse: ms(contract.ms),
        normalize_query_rows: ms(normalize.ms),
        generation_indexes: generationIndexes,
        query_index_build: stats(queryIndexMs),
        filter_evaluate: filter,
        facet_counts: counts,
        sort_label_first_incl_rank_build: ms(firstSort),
        sort_label_warm: warmSort,
      },
      memory_mb: {
        query_rows: ms(heapAfterRows - heapBeforeRows),
        query_index: ms(heapAfterIndex - heapBeforeIndex),
        note: gc ? 'heapUsed farkı, her ölçümden önce GC zorlandı (--execArgv=--expose-gc)' : 'GC zorlanmadı; yaklaşık',
      },
      queries: { fixed: fixed.length, random: asts.length - fixed.length },
    };
    const out = process.env.AILE_QUERY_PERF_RECORD;
    if (out) writeFileSync(out, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    expect(record.ms.json_parse).toBeGreaterThanOrEqual(0);
  });
});
