import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { MediaReference, PartitionEnvelope, PurchaseNeedRecord, Term } from './types';
import {
  FACETS,
  UNKNOWN,
  createQueryContext,
  evaluate,
  facetCounts,
  runQuery,
  sortRows,
  toQueryRow,
  type QueryAst,
  type QueryContext,
  type QueryRow,
} from './query';

// --- Sentetik satırlar (gerçek veri yok) ---------------------------------------------------------
// Kategori ağacı: mobilya ─┬─ oturma
//                          └─ depolama ── depolama_raf
const TERMS: Pick<Term, 'id' | 'parent_id'>[] = [
  { id: 'cat:mobilya', parent_id: null },
  { id: 'cat:oturma', parent_id: 'cat:mobilya' },
  { id: 'cat:depolama', parent_id: 'cat:mobilya' },
  { id: 'cat:depolama_raf', parent_id: 'cat:depolama' },
  { id: 'cat:tekstil', parent_id: null },
];

const ctx: QueryContext = createQueryContext({ terms: TERMS });

const base: QueryRow = {
  id: 'r0',
  label: 'Temel',
  code: 'kalem-000',
  category: null,
  room: null,
  phase: null,
  context: [],
  procurement: null,
  payment: null,
  funding: null,
  owner: null,
  confidence: null,
  planned: null,
  actual: null,
  dates: {},
  hasPhoto: false,
};
const row = (patch: Partial<QueryRow> & { id: string }): QueryRow => ({ ...base, ...patch });

const ROWS: QueryRow[] = [
  row({ id: 'koltuk', label: 'İstanbul koltuk', code: 'kalem-001', category: 'cat:oturma', room: 'oda:salon', phase: 'faz:once', context: ['ctx:bebek'], procurement: 'ful:ordered', payment: 'pay:planned', planned: { amount: '8500.00', currency: 'TRY' }, actual: null, dates: { planned_on: '2026-10-28' }, hasPhoto: true }),
  row({ id: 'raf', label: 'Kitaplık rafı', code: 'kalem-002', category: 'cat:depolama_raf', room: 'oda:salon', phase: 'faz:sonra', context: [], procurement: 'ful:delivered', payment: 'pay:paid', planned: { amount: '1200.00', currency: 'TRY' }, actual: { amount: '1150.00', currency: 'TRY' }, dates: { planned_on: '2026-11-05', delivered_on: '2026-11-20' } }),
  row({ id: 'dolap', label: 'Dolap', code: 'kalem-003', category: 'cat:depolama', room: 'oda:yatak', phase: 'faz:once', context: ['ctx:bebek', 'ctx:kopek'], procurement: null, payment: null, planned: null, actual: null, dates: {} }),
  row({ id: 'perde', label: 'Perde ışıklı', code: 'kalem-004', category: 'cat:tekstil', room: null, phase: 'faz:once', context: [], procurement: 'ful:ordered', payment: 'pay:planned', planned: { amount: '300.00', currency: 'TRY' }, actual: null, dates: { planned_on: '2026-09-01' }, hasPhoto: true }),
  row({ id: 'bilinmez', label: 'Kategorisiz şey', code: 'kalem-005', category: null, room: 'oda:salon', phase: null, context: [], procurement: null, payment: 'pay:paid', planned: { amount: '45.50', currency: 'TRY' }, actual: { amount: '45.50', currency: 'TRY' }, dates: { planned_on: '2026-10-01' } }),
];

const ids = (set: ReadonlySet<string>) => [...set].sort();
const ast = (patch: Partial<QueryAst> = {}): QueryAst => ({ facets: {}, ...patch });

describe('FACETS', () => {
  it('12 boyutu tasarım sırasıyla tanımlar; kategori ağaçtır', () => {
    expect(FACETS.map(f => f.id)).toEqual(['category', 'room', 'phase', 'context', 'procurement', 'payment', 'funding', 'owner', 'date', 'amount', 'confidence', 'missing']);
    expect(FACETS.find(f => f.id === 'category')?.kind).toBe('tree');
    expect(FACETS.find(f => f.id === 'date')?.kind).toBe('date');
    expect(FACETS.find(f => f.id === 'amount')?.kind).toBe('amount');
    expect(FACETS.find(f => f.id === 'missing')?.label).toBe('Eksik bilgi');
  });
});

describe('evaluate', () => {
  it('filtre yokken tüm satırları döndürür', () => {
    expect(ids(evaluate(ROWS, ast(), ctx))).toEqual(['bilinmez', 'dolap', 'koltuk', 'perde', 'raf']);
  });

  it('aynı boyutta OR', () => {
    expect(ids(evaluate(ROWS, ast({ facets: { room: ['oda:salon', 'oda:yatak'] } }), ctx))).toEqual(['bilinmez', 'dolap', 'koltuk', 'raf']);
  });

  it('boyutlar arası AND', () => {
    expect(ids(evaluate(ROWS, ast({ facets: { room: ['oda:salon'], payment: ['pay:paid'] } }), ctx))).toEqual(['bilinmez', 'raf']);
  });

  it('kategori ebeveyni alt dalları kapsar (iki seviye)', () => {
    expect(ids(evaluate(ROWS, ast({ facets: { category: ['cat:mobilya'] } }), ctx))).toEqual(['dolap', 'koltuk', 'raf']);
    expect(ids(evaluate(ROWS, ast({ facets: { category: ['cat:depolama'] } }), ctx))).toEqual(['dolap', 'raf']);
    expect(ids(evaluate(ROWS, ast({ facets: { category: ['cat:depolama_raf'] } }), ctx))).toEqual(['raf']);
  });

  it("'unknown' değeri eksik alanı eşler", () => {
    expect(ids(evaluate(ROWS, ast({ facets: { category: [UNKNOWN] } }), ctx))).toEqual(['bilinmez']);
    expect(ids(evaluate(ROWS, ast({ facets: { room: [UNKNOWN] } }), ctx))).toEqual(['perde']);
    expect(ids(evaluate(ROWS, ast({ facets: { context: [UNKNOWN] } }), ctx))).toEqual(['bilinmez', 'perde', 'raf']);
    // Bilinmiyor ile gerçek değer aynı boyutta OR
    expect(ids(evaluate(ROWS, ast({ facets: { category: [UNKNOWN, 'cat:tekstil'] } }), ctx))).toEqual(['bilinmez', 'perde']);
  });

  it('çok değerli bağlam boyutunda herhangi biri eşleşir', () => {
    expect(ids(evaluate(ROWS, ast({ facets: { context: ['ctx:kopek'] } }), ctx))).toEqual(['dolap']);
    expect(ids(evaluate(ROWS, ast({ facets: { context: ['ctx:bebek'] } }), ctx))).toEqual(['dolap', 'koltuk']);
  });

  it('eksik bilgi: fiyat yok / fotoğraf yok', () => {
    expect(ids(evaluate(ROWS, ast({ facets: { missing: ['price'] } }), ctx))).toEqual(['dolap']);
    expect(ids(evaluate(ROWS, ast({ facets: { missing: ['photo'] } }), ctx))).toEqual(['bilinmez', 'dolap', 'raf']);
  });

  it('tarih aralığı yalnız seçilen alanda, uçlar dâhil, tarihsizler dışarıda', () => {
    expect(ids(evaluate(ROWS, ast({ dateField: 'planned_on', dateRange: { from: '2026-10-01', to: '2026-10-28' } }), ctx))).toEqual(['bilinmez', 'koltuk']);
    expect(ids(evaluate(ROWS, ast({ dateField: 'delivered_on', dateRange: { from: '2026-01-01' } }), ctx))).toEqual(['raf']);
  });

  it('tutar aralığı plan ve gerçeği birleştirmez; tutarsızlar dışarıda', () => {
    expect(ids(evaluate(ROWS, ast({ amountField: 'planned', amountRange: { min: '1000', max: '9000' } }), ctx))).toEqual(['koltuk', 'raf']);
    expect(ids(evaluate(ROWS, ast({ amountField: 'actual', amountRange: { min: '1000' } }), ctx))).toEqual(['raf']);
    // alan verilmezse plan kullanılır
    expect(ids(evaluate(ROWS, ast({ amountRange: { max: '100' } }), ctx))).toEqual(['bilinmez']);
  });

  it('metin arama tr-TR küçük harf: İstanbul / istanbul / İSTANBUL aynı; etiket ve kod aranır', () => {
    expect(ids(evaluate(ROWS, ast({ text: 'istanbul' }), ctx))).toEqual(['koltuk']);
    expect(ids(evaluate(ROWS, ast({ text: 'İstanbul' }), ctx))).toEqual(['koltuk']);
    expect(ids(evaluate(ROWS, ast({ text: 'İSTANBUL' }), ctx))).toEqual(['koltuk']);
    // Noktalı büyük I → noktasız ı: "IŞIKLI" ışıklı'yı bulur
    expect(ids(evaluate(ROWS, ast({ text: 'IŞIKLI' }), ctx))).toEqual(['perde']);
    expect(ids(evaluate(ROWS, ast({ text: 'kalem-003' }), ctx))).toEqual(['dolap']);
    // Birden çok kelime: hepsi geçmeli
    expect(ids(evaluate(ROWS, ast({ text: 'koltuk istanbul' }), ctx))).toEqual(['koltuk']);
    expect(ids(evaluate(ROWS, ast({ text: '   ' }), ctx))).toHaveLength(5);
  });

  it('metin + facet birlikte AND', () => {
    // 'ol' → koltuk ve dolap; salon filtresi dolap'ı düşürür
    expect(ids(evaluate(ROWS, ast({ text: 'ol' }), ctx))).toEqual(['dolap', 'koltuk']);
    expect(ids(evaluate(ROWS, ast({ text: 'ol', facets: { room: ['oda:salon'] } }), ctx))).toEqual(['koltuk']);
  });
});

describe('facetCounts', () => {
  it('filtre yokken ham sayımlar; ağaçta ebeveyn alt dalları toplar; Bilinmiyor ayrı değer', () => {
    const counts = facetCounts(ROWS, ast(), ctx);
    expect(counts.room).toEqual({ 'oda:salon': 3, 'oda:yatak': 1, [UNKNOWN]: 1 });
    expect(counts.category).toEqual({ 'cat:mobilya': 3, 'cat:oturma': 1, 'cat:depolama': 2, 'cat:depolama_raf': 1, 'cat:tekstil': 1, [UNKNOWN]: 1 });
    expect(counts.context).toEqual({ 'ctx:bebek': 2, 'ctx:kopek': 1, [UNKNOWN]: 3 });
    expect(counts.missing).toEqual({ price: 1, photo: 3 });
    expect(counts.owner).toEqual({ [UNKNOWN]: 5 });
  });

  it('her boyutun sayımı diğer boyutların etkin filtreleriyle, kendi seçimi hariç hesaplanır', () => {
    const counts = facetCounts(ROWS, ast({ facets: { room: ['oda:salon'], payment: ['pay:paid'] } }), ctx);
    // room sayımı: yalnız payment=paid etkin → raf (salon), bilinmez (salon)
    expect(counts.room).toEqual({ 'oda:salon': 2 });
    // payment sayımı: yalnız room=salon etkin → koltuk planned, raf paid, bilinmez paid
    expect(counts.payment).toEqual({ 'pay:planned': 1, 'pay:paid': 2 });
    // üçüncü boyut her iki filtreyle: raf + bilinmez
    expect(counts.category).toEqual({ 'cat:mobilya': 1, 'cat:depolama': 1, 'cat:depolama_raf': 1, [UNKNOWN]: 1 });
  });

  it('seçili değer sıfır sayımda da görünür', () => {
    const counts = facetCounts(ROWS, ast({ facets: { room: ['oda:yatak'], payment: ['pay:paid'] } }), ctx);
    expect(counts.room).toEqual({ 'oda:salon': 2, 'oda:yatak': 0 });
    expect(counts.payment).toEqual({ [UNKNOWN]: 1, 'pay:paid': 0 });
  });

  it('metin araması tüm sayımları daraltır', () => {
    const counts = facetCounts(ROWS, ast({ text: 'istanbul' }), ctx);
    expect(counts.room).toEqual({ 'oda:salon': 1 });
  });
});

describe('sortRows / runQuery', () => {
  it('tutar sıralaması sayısaldır, tutarsızlar sonda', () => {
    expect(sortRows(ROWS, { field: 'planned', dir: 'asc' }).map(r => r.id)).toEqual(['bilinmez', 'perde', 'raf', 'koltuk', 'dolap']);
    expect(sortRows(ROWS, { field: 'planned', dir: 'desc' }).map(r => r.id)).toEqual(['koltuk', 'raf', 'perde', 'bilinmez', 'dolap']);
    expect(sortRows(ROWS, { field: 'actual', dir: 'desc' }).map(r => r.id)).toEqual(['raf', 'bilinmez', 'dolap', 'koltuk', 'perde']);
  });

  it('tarih sıralaması, tarihsizler sonda', () => {
    expect(sortRows(ROWS, { field: 'planned_on', dir: 'asc' }).map(r => r.id)).toEqual(['perde', 'bilinmez', 'koltuk', 'raf', 'dolap']);
  });

  it('etiket sıralaması tr-TR (İ, Ç, Ş doğru yerde)', () => {
    const rows = [row({ id: 'a', label: 'Şemsiye' }), row({ id: 'b', label: 'İskemle' }), row({ id: 'c', label: 'Çanta' }), row({ id: 'd', label: 'Isıtıcı' }), row({ id: 'e', label: 'Zil' })];
    expect(sortRows(rows, { field: 'label', dir: 'asc' }).map(r => r.label)).toEqual(['Çanta', 'Isıtıcı', 'İskemle', 'Şemsiye', 'Zil']);
  });

  it('runQuery filtreler ve sıralar; girdi dizisini değiştirmez', () => {
    const before = ROWS.map(r => r.id);
    const out = runQuery(ROWS, ast({ facets: { category: ['cat:mobilya'] }, sort: { field: 'planned', dir: 'desc' } }), ctx);
    expect(out.map(r => r.id)).toEqual(['koltuk', 'raf', 'dolap']);
    expect(ROWS.map(r => r.id)).toEqual(before);
  });
});

describe('toQueryRow (sentetik nesil)', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = join(here, '../../../fixtures/generation-synthetic');
  const generation = join(root, readdirSync(root)[0]!);
  const read = <T,>(rel: string) => JSON.parse(readFileSync(join(generation, rel), 'utf8')) as PartitionEnvelope<T>;
  const needs = read<PurchaseNeedRecord>('data/purchase_needs/household/00000.json');
  const terms = read<Term>('data/terms/global/00000.json');
  const media = read<MediaReference>('data/media_references/household/00000.json');
  const fixtureCtx = createQueryContext({ terms: terms.records, media: media.records });
  const rows = needs.records.map(r => toQueryRow(r, fixtureCtx));

  it('kayıt çekirdeğini satıra aktarır; eksikler null, fotoğraf yalnız doğrulanmışsa', () => {
    expect(rows).toHaveLength(needs.records.length);
    const first = rows[0]!;
    const rec = needs.records[0]!;
    expect(first.id).toBe(rec.id);
    expect(first.label).toBe(rec.label);
    expect(first.code).toBe(rec.source_record_id);
    expect(first.category).toBe(rec.category_term_id);
    expect(first.room).toBe(rec.room_id);
    expect(first.planned).toEqual(rec.amounts.planned ?? null);
    expect(first.actual).toBeNull();
    // owner / funding / confidence bu nesilde yok → null (Bilinmiyor); uydurulmaz
    expect(rows.every(r => r.owner === null && r.funding === null && r.confidence === null)).toBe(true);
    const verified = new Set(media.records.filter(m => m.verification === 'verified').map(m => m.entity_id));
    for (const r of rows) expect(r.hasPhoto).toBe(verified.has(r.id));
  });

  it('kategori grubu seçildiğinde alt terimli kayıtlar gelir', () => {
    const mutfak = terms.records.find(t => t.code === 'group:mutfak')!;
    const children = new Set(terms.records.filter(t => t.parent_id === mutfak.id || terms.records.some(p => p.parent_id === mutfak.id && t.parent_id === p.id)).map(t => t.id));
    const expected = rows.filter(r => r.category !== null && (r.category === mutfak.id || children.has(r.category))).map(r => r.id).sort();
    expect(expected.length).toBeGreaterThan(0);
    expect(ids(evaluate(rows, ast({ facets: { category: [mutfak.id] } }), fixtureCtx))).toEqual(expected);
  });
});
