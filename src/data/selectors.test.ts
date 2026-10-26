import { describe, it, expect } from 'vitest';
import { totalsFor, totalsOf, filterPurchases, sortItems, DEFAULT_FILTERS, estimateOf, normalizeFilters, activeFilterCount, optionCounts, quickCounts, countWith } from './selectors';
import type { Item } from '@shared/schema';

const NOW = new Date(2026, 9, 26);
const items: Item[] = [
  { id: '1', tip: 'satinalma', ad: 'Koltuk', faz: '1', durum: 'karar', tahmini_tl_min: 1500, tahmini_tl_max: 1500, adet: 1 },
  { id: '2', tip: 'satinalma', ad: 'Masa', faz: '1', durum: 'fikir' },
  { id: '3', tip: 'satinalma', ad: 'Cam masa', faz: '1', mevcut: true },
  { id: '4', tip: 'satinalma', ad: 'Sehpa', faz: '2', durum: 'teslim', tahmini_tl_min: 100, tahmini_tl_max: 200, adet: 2, gercek_tl: 150 },
  { id: '5', tip: 'satinalma', ad: 'İptal şey', faz: '2', durum: 'iptal', tahmini_tl_min: 999 },
  { id: '6', tip: 'satinalma', ad: 'Köprü', faz: '1', durum: 'karar', tahmini_tl_min: 700, siparis_son_tarih: '2026-10-30', karar_bekliyor: true },
  { id: '7', tip: 'aydinlatma', ad: 'Katman', oda: 'salon' },
  { id: '8', tip: 'satinalma', ad: 'Silinmiş', faz: '1', tahmini_tl_min: 5, deleted_at: 'x' },
];

describe('totalsFor', () => {
  it('faz 1: mevcut ve iptal hariç; fiyatsız sayılır; sipariş son tarihi yaklaşan', () => {
    const t = totalsFor(items, '1', NOW);
    expect(t).toMatchObject({ count: 3, priced: 2, unpriced: 1, sumMin: 2200, sumMax: 2200, pendingDecision: 1, dueSoon: 1 });
  });
  it('hepsi: gerçek fiyat ve adet çarpanı', () => {
    const t = totalsFor(items, 'hepsi', NOW);
    expect(t.count).toBe(4);
    expect(t.sumMin).toBe(2200 + 300);
    expect(t.sumActual).toBe(300);
    expect(t.doneCount).toBe(1);
  });
  it('estimateOf gerçek > tahmini', () => {
    expect(estimateOf(items[3])).toBe(300);
    expect(estimateOf(items[1])).toBeNull();
  });
});

describe('filterPurchases / sortItems', () => {
  it('varsayılan filtre mevcut ve silinmişleri gizler, yalnız satinalma', () => {
    expect(filterPurchases(items, DEFAULT_FILTERS).map((i) => i.id)).toEqual(['1', '2', '4', '5', '6']);
  });
  it('arama Türkçe küçük harf duyarsız; fiyatsız filtresi', () => {
    expect(filterPurchases(items, { ...DEFAULT_FILTERS, q: 'KÖPRÜ' }).map((i) => i.id)).toEqual(['6']);
    expect(filterPurchases(items, { ...DEFAULT_FILTERS, fiyatsiz: true }).map((i) => i.id)).toEqual(['2']);
    expect(filterPurchases(items, { ...DEFAULT_FILTERS, mevcutDahil: true, faz: '1' }).map((i) => i.id)).toEqual(['1', '2', '3', '6']);
  });
  it('sıralama', () => {
    const list = filterPurchases(items, DEFAULT_FILTERS);
    expect(sortItems(list, 'fiyat').map((i) => i.id)).toEqual(['1', '6', '2', '5', '4']);
    expect(sortItems(list, 'siparis')[0].id).toBe('6');
    expect(sortItems(list, 'ad')[0].ad).toBe('Koltuk');
  });
});

describe('filtre modeli v2', () => {
  it('normalizeFilters: eski/bozuk localStorage değeri varsayılanla güvenle birleşir', () => {
    expect(normalizeFilters(undefined)).toEqual(DEFAULT_FILTERS);
    expect(normalizeFilters(null)).toEqual(DEFAULT_FILTERS);
    expect(normalizeFilters('bozuk')).toEqual(DEFAULT_FILTERS);
    // Eski şema: yeni anahtarlar yok, bilinmeyen anahtar var, dizi yerine metin
    const old = { faz: '2', durum: 'karar', oda: ['salon', 42, 'yok'], fiyatsiz: 1, eski: true };
    expect(normalizeFilters(old)).toEqual({ ...DEFAULT_FILTERS, faz: '2', oda: ['salon'], fiyatsiz: true });
    expect(normalizeFilters({ faz: '9' }).faz).toBe('hepsi');
  });
  it('hideDone: teslim/kuruldu/iptal gizlenir; sayfadan açıkça seçilen kapalı durum yine görünür', () => {
    expect(filterPurchases(items, { ...DEFAULT_FILTERS, hideDone: true }).map((i) => i.id)).toEqual(['1', '2', '6']);
    expect(filterPurchases(items, { ...DEFAULT_FILTERS, hideDone: true, durum: ['teslim'] }).map((i) => i.id)).toEqual(['4']);
  });
  it('Belirsiz: alanı boş kalemler "" anahtarıyla sayılır ve seçilebilir', () => {
    const withUnset: Item[] = [...items, { id: '9', tip: 'satinalma', ad: 'Odasız', faz: '1', durum: 'fikir' }];
    expect(optionCounts(withUnset, DEFAULT_FILTERS, 'oda', NOW)).toEqual(new Map([['', 6]]));
    expect(filterPurchases(withUnset, { ...DEFAULT_FILTERS, oda: [''] }).map((i) => i.id)).toEqual(['1', '2', '4', '5', '6', '9']);
    expect(normalizeFilters({ oda: ['', 'salon'] }).oda).toEqual(['', 'salon']);
    expect(countWith(withUnset, DEFAULT_FILTERS, { fiyatsiz: true }, NOW)).toBe(2);
  });
  it('siparisYakin: 7 gün içinde ya da geçmiş son tarih, açık kalemler', () => {
    expect(filterPurchases(items, { ...DEFAULT_FILTERS, siparisYakin: true }, NOW).map((i) => i.id)).toEqual(['6']);
    expect(filterPurchases(items, { ...DEFAULT_FILTERS, siparisYakin: true }, new Date(2026, 9, 1)).map((i) => i.id)).toEqual([]);
  });
  it('activeFilterCount yeni bayrakları sayar, faz ve aramayı saymaz', () => {
    expect(activeFilterCount({ ...DEFAULT_FILTERS, faz: '1', q: 'x' })).toBe(0);
    expect(activeFilterCount({ ...DEFAULT_FILTERS, hideDone: true, siparisYakin: true, oda: ['salon', 'mutfak'] })).toBe(4);
  });
  it('sıralama: kapananlar (teslim/kuruldu/iptal) her sıralamada en altta', () => {
    const list = filterPurchases(items, DEFAULT_FILTERS);
    expect(sortItems(list, 'fiyat').map((i) => i.id)).toEqual(['1', '6', '2', '5', '4']);
    expect(sortItems(list, 'ad').map((i) => i.id)).toEqual(['1', '6', '2', '5', '4']);
    expect(sortItems(list, 'oncelik').map((i) => i.id)).toEqual(['1', '6', '2', '5', '4']);
  });
  it('optionCounts: alanın kendi seçimi hariç diğer filtrelerle sayım; sıfırlar yok', () => {
    const f = { ...DEFAULT_FILTERS, oda: ['salon'] };
    const withRooms: Item[] = [
      ...items,
      { id: '9', tip: 'satinalma', ad: 'Lamba', faz: '1', durum: 'fikir', oda: 'salon' },
      { id: '10', tip: 'satinalma', ad: 'Perde', faz: '1', durum: 'karar', oda: 'mutfak' },
    ];
    // oda sayımı kendi seçimini (salon) yok sayar → mutfak da görünür
    expect(optionCounts(withRooms, f, 'oda', NOW)).toEqual(new Map([['salon', 1], ['mutfak', 1], ['', 5]]));
    // durum sayımı oda=salon filtresine uyar
    expect(optionCounts(withRooms, f, 'durum', NOW)).toEqual(new Map([['fikir', 1]]));
  });
  it('quickCounts: her hızlı filtre için "açılırsa kaç kalem" sayısı', () => {
    const qc = quickCounts(items, DEFAULT_FILTERS, NOW);
    expect(qc).toEqual({ fiyatsiz: 1, kararBekliyor: 1, siparisYakin: 1, hideDone: 3, mevcutDahil: 6 });
    // fiyatsız açıkken kendi sayısı mevcut sonuç sayısıdır, diğerleri ona göre daralır
    const qc2 = quickCounts(items, { ...DEFAULT_FILTERS, fiyatsiz: true }, NOW);
    expect(qc2.fiyatsiz).toBe(1);
    expect(qc2.kararBekliyor).toBe(0);
  });
  it('totalsOf: görünen kümenin toplamı (mevcut ve iptal toplam dışı)', () => {
    const t = totalsOf(filterPurchases(items, { ...DEFAULT_FILTERS, mevcutDahil: true }));
    expect(t).toMatchObject({ count: 4, priced: 3, unpriced: 1, sumMin: 2500, sumMax: 2500, sumActual: 300 });
  });
});
