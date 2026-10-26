import type { Item, Faz } from '@shared/schema';
import { daysUntil } from '@/lib/dates';

export const DONE_DURUM = new Set(['teslim', 'kuruldu']);
export const CLOSED_DURUM = new Set(['teslim', 'kuruldu', 'iptal']);

export interface Totals {
  count: number;
  priced: number;
  unpriced: number;
  sumMin: number;
  sumMax: number;
  sumActual: number;
  doneCount: number;
  pendingDecision: number;
  dueSoon: number;
}

export function estimateOf(i: Item): number | null {
  const v = i.gercek_tl ?? i.tahmini_tl_min ?? i.tahmini_tl_max;
  return v == null ? null : v * (i.adet && i.adet > 0 ? i.adet : 1);
}

/** Toplama girmeyenler: mevcut eşya, iptal. */
export function countsTowardTotal(i: Item): boolean {
  return !i.deleted_at && !i.mevcut && i.durum !== 'iptal';
}

export function totalsFor(items: readonly Item[], faz: Faz | 'hepsi', now: Date = new Date()): Totals {
  const t: Totals = { count: 0, priced: 0, unpriced: 0, sumMin: 0, sumMax: 0, sumActual: 0, doneCount: 0, pendingDecision: 0, dueSoon: 0 };
  for (const i of items) {
    if (i.deleted_at || i.tip !== 'satinalma') continue;
    if (faz !== 'hepsi' && i.faz !== faz) continue;
    if (!countsTowardTotal(i)) continue;
    t.count++;
    const qty = i.adet && i.adet > 0 ? i.adet : 1;
    const min = i.gercek_tl ?? i.tahmini_tl_min ?? i.tahmini_tl_max;
    const max = i.gercek_tl ?? i.tahmini_tl_max ?? i.tahmini_tl_min;
    if (min == null && max == null) t.unpriced++;
    else { t.priced++; t.sumMin += (min ?? 0) * qty; t.sumMax += (max ?? 0) * qty; }
    if (i.gercek_tl != null) t.sumActual += i.gercek_tl * qty;
    if (i.durum && DONE_DURUM.has(i.durum)) t.doneCount++;
    if (i.karar_bekliyor) t.pendingDecision++;
    if (i.siparis_son_tarih && !CLOSED_DURUM.has(i.durum ?? '') && i.durum !== 'siparis') {
      const d = daysUntil(i.siparis_son_tarih, now);
      if (d <= 7) t.dueSoon++;
    }
  }
  return t;
}

export type SortKey = 'ad' | 'fiyat' | 'guncelleme' | 'siparis' | 'oncelik';

export function sortItems(items: Item[], key: SortKey): Item[] {
  const coll = new Intl.Collator('tr');
  const arr = items.slice();
  switch (key) {
    case 'ad': return arr.sort((a, b) => coll.compare(a.ad, b.ad));
    case 'fiyat': return arr.sort((a, b) => (estimateOf(b) ?? -1) - (estimateOf(a) ?? -1));
    case 'guncelleme': return arr.sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')));
    case 'siparis': return arr.sort((a, b) => String(a.siparis_son_tarih ?? '9999').localeCompare(String(b.siparis_son_tarih ?? '9999')));
    case 'oncelik': return arr.sort((a, b) => (a.oncelik ?? 9) - (b.oncelik ?? 9) || coll.compare(a.ad, b.ad));
    default: return arr;
  }
}

export interface PurchaseFilters {
  faz: Faz | 'hepsi';
  durum: string[];
  oda: string[];
  kategori: string[];
  fiyatsiz: boolean;
  kararBekliyor: boolean;
  mevcutDahil: boolean;
  q: string;
}

export const DEFAULT_FILTERS: PurchaseFilters = { faz: 'hepsi', durum: [], oda: [], kategori: [], fiyatsiz: false, kararBekliyor: false, mevcutDahil: false, q: '' };

export function activeFilterCount(f: PurchaseFilters): number {
  return f.durum.length + f.oda.length + f.kategori.length + (f.fiyatsiz ? 1 : 0) + (f.kararBekliyor ? 1 : 0) + (f.mevcutDahil ? 1 : 0);
}

export function filterPurchases(items: readonly Item[], f: PurchaseFilters): Item[] {
  const q = f.q.trim().toLocaleLowerCase('tr');
  return items.filter((i) => {
    if (i.deleted_at || i.tip !== 'satinalma') return false;
    if (!f.mevcutDahil && i.mevcut) return false;
    if (f.faz !== 'hepsi' && i.faz !== f.faz) return false;
    if (f.durum.length && !f.durum.includes(i.durum ?? '')) return false;
    if (f.oda.length && !f.oda.includes(i.oda ?? '')) return false;
    if (f.kategori.length && !f.kategori.includes(i.kategori ?? '')) return false;
    if (f.fiyatsiz && (i.tahmini_tl_min != null || i.tahmini_tl_max != null || i.gercek_tl != null)) return false;
    if (f.kararBekliyor && !i.karar_bekliyor) return false;
    if (q && !`${i.ad} ${i.not ?? ''} ${i.nereden ?? ''}`.toLocaleLowerCase('tr').includes(q)) return false;
    return true;
  });
}
