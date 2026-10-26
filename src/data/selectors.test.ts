import { describe, it, expect } from 'vitest';
import { totalsFor, filterPurchases, sortItems, DEFAULT_FILTERS, estimateOf } from './selectors';
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
    expect(sortItems(list, 'fiyat').map((i) => i.id)).toEqual(['1', '5', '6', '4', '2']);
    expect(sortItems(list, 'siparis')[0].id).toBe('6');
    expect(sortItems(list, 'ad')[0].ad).toBe('İptal şey');
  });
});
