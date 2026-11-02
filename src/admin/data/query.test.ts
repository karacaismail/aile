import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { VIEW_MODES, type ViewMode } from '../shell/contracts';
import { buildTermTree, toRecordRow } from './indexes';
import type { MediaReference, PartitionEnvelope, PurchaseNeedRecord, Term } from './types';
import {
  FACETS,
  UNKNOWN,
  buildQueryIndex,
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

describe('Türkçe metin ve sıralama', () => {
  it('arama İ/ı farkına takılmaz: büyük harfli Latin adlar küçük harfle bulunur', () => {
    const rows = [row({ id: 'ikea', label: 'IKEA kitaplık' }), row({ id: 'telefon', label: 'iPhone şarj kablosu' }), row({ id: 'isik', label: 'Işıklı ayna' })];
    expect(ids(evaluate(rows, ast({ text: 'ikea' }), ctx))).toEqual(['ikea']);
    expect(ids(evaluate(rows, ast({ text: 'IPHONE' }), ctx))).toEqual(['telefon']);
    // Türkçe büyük/küçük eşlemesi korunur: "IŞIK" ve "ışık" aynı kaydı bulur
    expect(ids(evaluate(rows, ast({ text: 'IŞIK' }), ctx))).toEqual(['isik']);
    expect(ids(evaluate(rows, ast({ text: 'ışık' }), ctx))).toEqual(['isik']);
    // ş ile s ayrı harftir; aksan kaldırma yapılmaz
    expect(ids(evaluate(rows, ast({ text: 'isik' }), ctx))).toEqual([]);
  });

  it('ayrışmış (NFD) İ ve i + U+0307 de aynı harf sayılır', () => {
    const rows = [row({ id: 'nfd', label: 'I\u0307stanbul halısı' }), row({ id: 'nfc', label: 'İzmir kilimi' })];
    expect(ids(evaluate(rows, ast({ text: 'istanbul' }), ctx))).toEqual(['nfd']);
    expect(ids(evaluate(rows, ast({ text: 'i\u0307zmir' }), ctx))).toEqual(['nfc']);
    expect(ids(evaluate(rows, ast({ text: 'İ' }), ctx))).toEqual(['nfc', 'nfd']);
  });

  it('küçük harf ve İ/ı: ı-sözcükleri i-sözcüklerinden önce, sayılar doğal sırada', () => {
    const labels = ['ip', 'İnci', 'ılgın', 'Işık', 'iğde', 'ıhlamur', 'Ölçü', 'oda', 'Kalem 10', 'Kalem 2', 'cam', 'Çay'];
    const rows = labels.map((label, i) => row({ id: `t${i}`, label }));
    expect(sortRows(rows, { field: 'label', dir: 'asc' }).map(r => r.label)).toEqual(['cam', 'Çay', 'ıhlamur', 'ılgın', 'Işık', 'iğde', 'İnci', 'ip', 'Kalem 2', 'Kalem 10', 'oda', 'Ölçü']);
    expect(sortRows(rows, { field: 'label', dir: 'desc' }).map(r => r.label)).toEqual(['Ölçü', 'oda', 'Kalem 10', 'Kalem 2', 'ip', 'İnci', 'iğde', 'Işık', 'ılgın', 'ıhlamur', 'Çay', 'cam']);
  });

  it('kararlı sıralama: eşit anahtarlı kayıtlar her alanda ve iki yönde girdi sırasını korur', () => {
    const rows = [
      row({ id: 'k1', label: 'Ilık', planned: { amount: '100.00', currency: 'TRY' }, dates: { planned_on: '2026-11-01' } }),
      row({ id: 'k2', label: 'ılık', planned: { amount: '100', currency: 'TRY' }, dates: { planned_on: '2026-11-01' } }),
      row({ id: 'k3', label: 'ILIK', planned: { amount: '100.0', currency: 'TRY' }, dates: { planned_on: '2026-11-01' } }),
    ];
    for (const field of ['label', 'planned', 'planned_on'] as const) {
      for (const dir of ['asc', 'desc'] as const) {
        expect(sortRows(rows, { field, dir }).map(r => r.id)).toEqual(['k1', 'k2', 'k3']);
        expect(sortRows([...rows].reverse(), { field, dir }).map(r => r.id)).toEqual(['k3', 'k2', 'k1']);
      }
    }
  });

  it('adı olmayan kayıt etiket sıralamasında yönden bağımsız sondadır', () => {
    const rows = [row({ id: 'adsiz', label: '' }), row({ id: 'b', label: 'Battaniye' }), row({ id: 'a', label: 'Ayna' })];
    expect(sortRows(rows, { field: 'label', dir: 'asc' }).map(r => r.id)).toEqual(['a', 'b', 'adsiz']);
    expect(sortRows(rows, { field: 'label', dir: 'desc' }).map(r => r.id)).toEqual(['b', 'a', 'adsiz']);
  });
});

describe('tutar: ondalık metin kesin karşılaştırılır', () => {
  it('kayan noktada eşit görünen tutarlar doğru sıralanır ve aralığa doğru girer', () => {
    // Number() ile ikisi de 9007199254740992 olur; ondalık metin ise farklıdır.
    const rows = [
      row({ id: 'kucuk', label: 'A', planned: { amount: '9007199254740992.50', currency: 'TRY' } }),
      row({ id: 'buyuk', label: 'B', planned: { amount: '9007199254740993.00', currency: 'TRY' } }),
    ];
    expect(sortRows(rows, { field: 'planned', dir: 'desc' }).map(r => r.id)).toEqual(['buyuk', 'kucuk']);
    expect(ids(evaluate(rows, ast({ amountRange: { min: '9007199254740993' } }), ctx))).toEqual(['buyuk']);
    expect(ids(evaluate(rows, ast({ amountRange: { max: '9007199254740992.5' } }), ctx))).toEqual(['kucuk']);
  });

  it('negatif, sıfır ve sondaki sıfırlar doğru karşılaştırılır', () => {
    const rows = [
      row({ id: 'eksi', label: 'A', planned: { amount: '-5.25', currency: 'TRY' } }),
      row({ id: 'sifir', label: 'B', planned: { amount: '0.00', currency: 'TRY' } }),
      row({ id: 'kesir', label: 'C', planned: { amount: '0.5', currency: 'TRY' } }),
      row({ id: 'tam', label: 'D', planned: { amount: '10', currency: 'TRY' } }),
      row({ id: 'eksi_buyuk', label: 'E', planned: { amount: '-100', currency: 'TRY' } }),
    ];
    expect(sortRows(rows, { field: 'planned', dir: 'asc' }).map(r => r.id)).toEqual(['eksi_buyuk', 'eksi', 'sifir', 'kesir', 'tam']);
    expect(ids(evaluate(rows, ast({ amountRange: { min: '0', max: '0.50' } }), ctx))).toEqual(['kesir', 'sifir']);
    expect(ids(evaluate(rows, ast({ amountRange: { max: '-5.250' } }), ctx))).toEqual(['eksi', 'eksi_buyuk']);
  });

  it('boş ya da ondalık olmayan sınır yok sayılır; sıfıra dönmez', () => {
    expect(ids(evaluate(ROWS, ast({ amountRange: { min: '' } }), ctx))).toEqual(ids(evaluate(ROWS, ast(), ctx)));
    expect(ids(evaluate(ROWS, ast({ amountRange: { min: 'abc', max: '1,5' } }), ctx))).toEqual(ids(evaluate(ROWS, ast(), ctx)));
    // geçerli sınır geçersiz olanla birlikte çalışmaya devam eder
    expect(ids(evaluate(ROWS, ast({ amountRange: { min: 'x', max: '100' } }), ctx))).toEqual(['bilinmez']);
  });
});

describe('tarih aralığı sınırları', () => {
  it('boş ya da ISO gün olmayan sınır yok sayılır; tarihsiz kayıtlar düşmez', () => {
    const all = ids(evaluate(ROWS, ast(), ctx));
    expect(ids(evaluate(ROWS, ast({ dateRange: { from: '', to: '' } }), ctx))).toEqual(all);
    expect(ids(evaluate(ROWS, ast({ dateRange: { to: '28.10.2026' } }), ctx))).toEqual(all);
    // geçerli sınır geçersiz olanla birlikte çalışmaya devam eder
    expect(ids(evaluate(ROWS, ast({ dateRange: { from: 'dün', to: '2026-10-01' } }), ctx))).toEqual(['bilinmez', 'perde']);
  });
});

describe('kayıt adı: liste görünümüyle aynı ad aranır ve sıralanır', () => {
  const record = (patch: Partial<PurchaseNeedRecord>): PurchaseNeedRecord => ({
    id: 'kayit',
    tenant_id: 'tenant',
    kind: 'purchase_need',
    category_term_id: null,
    phase_term_id: null,
    context_term_ids: [],
    state_snapshot: { decision: null, fulfillment: null, inspection: null, payment: null },
    state_term_ids: { decision: null, fulfillment: null, inspection: null, payment: null },
    amounts: {},
    dates: {},
    room_id: null,
    ...patch,
  });
  const rowCtx = { termsById: new Map(), roomsById: new Map(), mediaByEntity: new Map(), relationsBySource: new Map() };

  it('label yoksa attributes.ad, o da yoksa source_attributes.ad kullanılır (toRecordRow ile aynı)', () => {
    const fromAttrs = record({ id: 'a', attributes: { ad: 'Çalışma masası' } });
    const fromSource = record({ id: 'b', source_attributes: { ad: 'Kitaplık' } });
    for (const rec of [fromAttrs, fromSource]) expect(toQueryRow(rec, ctx).label).toBe(toRecordRow(rec, rowCtx).label);
    const rows = [fromAttrs, fromSource].map(rec => toQueryRow(rec, ctx));
    expect(ids(evaluate(rows, ast({ text: 'masa' }), ctx))).toEqual(['a']);
    expect(sortRows(rows, { field: 'label', dir: 'asc' }).map(r => r.id)).toEqual(['a', 'b']);
  });

  it('hiç adı olmayan kayıt boş adla kalır (UI "Bilinmiyor" yazar), uydurulmaz', () => {
    expect(toQueryRow(record({ id: 'c' }), ctx).label).toBe('');
    expect(toRecordRow(record({ id: 'c' }), rowCtx).label).toBe('Bilinmiyor');
  });
});

describe('kategori kapsaması terim ağacıyla aynı kuralı izler', () => {
  const V = '00000000-0000-4000-8000-0000000000a1';
  const OTHER = '00000000-0000-4000-8000-0000000000a2';
  const t = (id: string, parent_id: string | null, vocabulary_id = V): Term => ({ id, tenant_id: 'tenant', vocabulary_id, code: id, label: id, parent_id, legacy: false });
  const terms: Term[] = [
    t('cat:a', 'cat:b'), // döngü a ↔ b: buildTermTree girdi sırasıyla döngüyü kapatan b → a bağını keser → b kök, a b'nin altında
    t('cat:b', 'cat:a'),
    t('cat:oda', null, OTHER),
    t('cat:c', 'cat:oda'), // başka sözlükteki üst terim: bağ kurulmaz
    t('cat:kendi', 'cat:kendi'), // kendi üstü
    t('cat:yetim', 'cat:yok'), // olmayan üst terim
    t('cat:kok', null),
    t('cat:alt', 'cat:kok'),
    t('cat:torun', 'cat:alt'),
  ];
  const tree = buildTermTree(terms);
  const treeCtx = createQueryContext({ terms });
  const rows = terms.map(term => row({ id: `r:${term.id}`, label: term.id, category: term.id }));

  it('her (seçim, kayıt) çifti için kapsama TermTree.covers ile aynıdır', () => {
    for (const selected of terms) {
      const expected = rows.filter(r => tree.covers(selected.id, r.category!)).map(r => r.id).sort();
      expect({ selected: selected.id, ids: ids(evaluate(rows, ast({ facets: { category: [selected.id] } }), treeCtx)) }).toEqual({ selected: selected.id, ids: expected });
    }
  });

  it('döngüde kesilen bağ ters yönde kapsama üretmez; sayım da ağaçla aynıdır', () => {
    expect(ids(evaluate(rows, ast({ facets: { category: ['cat:a'] } }), treeCtx))).toEqual(['r:cat:a']);
    expect(ids(evaluate(rows, ast({ facets: { category: ['cat:b'] } }), treeCtx))).toEqual(['r:cat:a', 'r:cat:b']);
    const counts = facetCounts(rows, ast(), treeCtx).category;
    expect(counts['cat:a']).toBe(1);
    expect(counts['cat:b']).toBe(2);
    expect(counts['cat:oda']).toBe(1);
    expect(counts['cat:kok']).toBe(3);
  });
});

describe('sorgu indeksi: nesil başına bir kez', () => {
  it('buildQueryIndex modül işlevleriyle aynı kümeyi, sayımı ve sırayı verir', () => {
    const index = buildQueryIndex(ROWS, ctx);
    const asts: QueryAst[] = [
      ast(),
      ast({ facets: { room: ['oda:salon', 'oda:yatak'], payment: ['pay:paid'] } }),
      ast({ text: 'ol', facets: { category: ['cat:mobilya'] }, sort: { field: 'planned', dir: 'desc' } }),
      ast({ facets: { missing: ['photo'] }, dateRange: { from: '2026-10-01' }, sort: { field: 'planned_on', dir: 'asc' } }),
    ];
    for (const q of asts) {
      expect(ids(index.evaluate(q))).toEqual(ids(evaluate(ROWS, q, ctx)));
      expect(index.facetCounts(q)).toEqual(facetCounts(ROWS, q, ctx));
      expect(index.run(q).map(r => r.id)).toEqual(runQuery(ROWS, q, ctx).map(r => r.id));
    }
    expect(index.rows).toBe(ROWS);
    expect(index.ctx).toBe(ctx);
  });

  it('aynı satır dizisi ve bağlamla yinelenen sorgular satır alanlarını yeniden taramaz', () => {
    let reads = 0;
    const watched = ROWS.map(r => new Proxy(r, { get(target, key, receiver) { reads += 1; return Reflect.get(target, key, receiver); } }));
    evaluate(watched, ast({ facets: { room: ['oda:salon'] } }), ctx); // ilk çağrı indeksi kurar
    reads = 0;
    evaluate(watched, ast({ text: 'koltuk', facets: { category: ['cat:mobilya'], payment: ['pay:paid', 'pay:planned'] } }), ctx);
    facetCounts(watched, ast({ facets: { room: ['oda:salon'] }, amountRange: { min: '100' } }), ctx);
    runQuery(watched, ast({ facets: { phase: ['faz:once'] }, sort: { field: 'label', dir: 'asc' } }), ctx);
    runQuery(watched, ast({ dateRange: { from: '2026-10-01' }, sort: { field: 'planned', dir: 'desc' } }), ctx);
    expect(reads).toBe(0);
  });

  it('dizi değişirse (uzunluk) indeks yeniden kurulur', () => {
    const rows = [...ROWS];
    expect(evaluate(rows, ast(), ctx).size).toBe(5);
    rows.push(row({ id: 'yeni', label: 'Yeni', room: 'oda:salon' }));
    expect(ids(evaluate(rows, ast({ facets: { room: ['oda:salon'] } }), ctx))).toContain('yeni');
  });
});

describe('aynı sorgu, altı görünüm modu', () => {
  // Modların sıralama alanı view_definitions sort_fields'ten: liste/tablo/kanban etiket, zaman çizelgesi ve Gantt
  // dates.planned_on; pivotta alımlar için sıralama alanı yok. Mod yalnız sunumu değiştirir, kümeyi değil.
  const MODE_SORT: Record<ViewMode, QueryAst['sort']> = {
    listing: { field: 'label', dir: 'asc' },
    table: { field: 'label', dir: 'asc' },
    timeline: { field: 'planned_on', dir: 'asc' },
    kanban: { field: 'label', dir: 'asc' },
    gantt_chart: { field: 'end_on', dir: 'asc' },
    pivot: undefined,
  };
  const asts: QueryAst[] = [
    ast(),
    ast({ facets: { category: ['cat:mobilya'] } }),
    ast({ facets: { room: [UNKNOWN, 'oda:yatak'], context: ['ctx:bebek'] } }),
    ast({ text: 'i', amountRange: { min: '100' } }),
    ast({ dateRange: { to: '2026-10-28' } }),
  ];

  it('her modda aynı ID kümesi; tarihsiz ve tutarsız kayıtlar sıralamada düşmez', () => {
    for (const q of asts) {
      const expected = ids(evaluate(ROWS, q, ctx));
      for (const mode of VIEW_MODES) {
        const got = runQuery(ROWS, { ...q, sort: MODE_SORT[mode] }, ctx).map(r => r.id);
        expect({ mode, ids: [...got].sort() }).toEqual({ mode, ids: expected });
        expect(new Set(got).size).toBe(got.length);
      }
    }
  });

  it("'Bebek' bağlamı ile proje aşaması bağımsız filtrelenir", () => {
    expect(ids(evaluate(ROWS, ast({ facets: { context: ['ctx:bebek'] } }), ctx))).toEqual(['dolap', 'koltuk']);
    expect(ids(evaluate(ROWS, ast({ facets: { phase: ['faz:once'] } }), ctx))).toEqual(['dolap', 'koltuk', 'perde']);
    expect(ids(evaluate(ROWS, ast({ facets: { context: ['ctx:bebek'], phase: ['faz:sonra'] } }), ctx))).toEqual([]);
    expect(ids(evaluate(ROWS, ast({ facets: { context: [UNKNOWN], phase: ['faz:once'] } }), ctx))).toEqual(['perde']);
  });
});
