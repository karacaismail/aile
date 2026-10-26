import type { Item, Faz } from '@shared/schema';
import { DURUM, FAZ, KATEGORI, ODA } from '@shared/schema';
import { daysUntil } from '@/lib/dates';
import type { AppState } from '@/sync/store';

/** İlk veri henüz yok: önbellek okunmadı ya da ilk sunucu okuması sürüyor. Detay formları bu bitmeden "bulunamadı" demez ve form kurulmaz. */
export const selectFirstLoad = (s: AppState): boolean => !s.hydrated || s.status === 'idle' || s.status === 'loading';

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

/** Sipariş son tarihi yaklaşan (≤ DUE_SOON_DAYS gün) ya da geçmiş, hâlâ açık ve sipariş verilmemiş kalem. */
export const DUE_SOON_DAYS = 7;
export function isDueSoon(i: Item, now: Date = new Date()): boolean {
  if (!i.siparis_son_tarih || CLOSED_DURUM.has(i.durum ?? '') || i.durum === 'siparis') return false;
  return daysUntil(i.siparis_son_tarih, now) <= DUE_SOON_DAYS;
}

/** Verilen kümenin toplamları: ne görünüyorsa o toplanır (mevcut eşya ve iptal toplam dışı). */
export function totalsOf(list: readonly Item[], now: Date = new Date()): Totals {
  const t: Totals = { count: 0, priced: 0, unpriced: 0, sumMin: 0, sumMax: 0, sumActual: 0, doneCount: 0, pendingDecision: 0, dueSoon: 0 };
  for (const i of list) {
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
    if (isDueSoon(i, now)) t.dueSoon++;
  }
  return t;
}

/** Faz bazlı toplam (filtrelerden bağımsız). */
export function totalsFor(items: readonly Item[], faz: Faz | 'hepsi', now: Date = new Date()): Totals {
  return totalsOf(items.filter((i) => !i.deleted_at && i.tip === 'satinalma' && (faz === 'hepsi' || i.faz === faz)), now);
}

export type SortKey = 'ad' | 'fiyat' | 'guncelleme' | 'siparis' | 'oncelik';

function compareBy(key: SortKey, coll: Intl.Collator): (a: Item, b: Item) => number {
  switch (key) {
    case 'ad': return (a, b) => coll.compare(a.ad, b.ad);
    case 'fiyat': return (a, b) => (estimateOf(b) ?? -1) - (estimateOf(a) ?? -1);
    case 'guncelleme': return (a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? ''));
    case 'siparis': return (a, b) => String(a.siparis_son_tarih ?? '9999').localeCompare(String(b.siparis_son_tarih ?? '9999'));
    case 'oncelik': return (a, b) => (a.oncelik ?? 9) - (b.oncelik ?? 9) || coll.compare(a.ad, b.ad);
    default: return () => 0;
  }
}

/** Sıralama: kapananlar (teslim, kuruldu, iptal) hangi anahtar seçilirse seçilsin en altta; her iki grup kendi içinde sıralanır. */
export function sortItems(items: Item[], key: SortKey): Item[] {
  const coll = new Intl.Collator('tr');
  const cmp = compareBy(key, coll);
  const open = items.filter((i) => !CLOSED_DURUM.has(i.durum ?? '')).sort(cmp);
  const closed = items.filter((i) => CLOSED_DURUM.has(i.durum ?? '')).sort(cmp);
  return [...open, ...closed];
}

export interface PurchaseFilters {
  faz: Faz | 'hepsi';
  durum: string[];
  oda: string[];
  kategori: string[];
  /** Hızlı filtreler (liste ekranındaki şerit). */
  fiyatsiz: boolean;
  kararBekliyor: boolean;
  siparisYakin: boolean;
  hideDone: boolean;
  mevcutDahil: boolean;
  q: string;
}

export const DEFAULT_FILTERS: PurchaseFilters = {
  faz: 'hepsi', durum: [], oda: [], kategori: [], fiyatsiz: false, kararBekliyor: false, siparisYakin: false, hideDone: false, mevcutDahil: false, q: '',
};

export type QuickKey = 'fiyatsiz' | 'kararBekliyor' | 'siparisYakin' | 'hideDone' | 'mevcutDahil';
export const QUICK_KEYS: readonly QuickKey[] = ['fiyatsiz', 'kararBekliyor', 'siparisYakin', 'hideDone', 'mevcutDahil'];
export type FacetField = 'durum' | 'oda' | 'kategori';
export const FACET_FIELDS: readonly FacetField[] = ['durum', 'oda', 'kategori'];
const FACET_OPTIONS: Record<FacetField, readonly string[]> = { durum: DURUM, oda: ODA, kategori: KATEGORI };

/** Boş değer anahtarı: alanı boş kalemler ("Belirsiz") facet olarak seçilebilir. */
export const UNSET = '';

function stringList(v: unknown, allowed: readonly string[]): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string' && (x === UNSET || allowed.includes(x)));
}

/** localStorage'dan gelen (eski şemalı ya da bozuk) değer varsayılanla güvenle birleşir; bilinmeyen anahtar ve değerler atılır. */
export function normalizeFilters(raw: unknown): PurchaseFilters {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_FILTERS };
  const r = raw as Record<string, unknown>;
  const faz = typeof r.faz === 'string' && (r.faz === 'hepsi' || (FAZ as readonly string[]).includes(r.faz)) ? (r.faz as Faz | 'hepsi') : 'hepsi';
  return {
    faz,
    durum: stringList(r.durum, DURUM),
    oda: stringList(r.oda, ODA),
    kategori: stringList(r.kategori, KATEGORI),
    fiyatsiz: !!r.fiyatsiz,
    kararBekliyor: !!r.kararBekliyor,
    siparisYakin: !!r.siparisYakin,
    hideDone: !!r.hideDone,
    mevcutDahil: !!r.mevcutDahil,
    q: typeof r.q === 'string' ? r.q : '',
  };
}

/** Faz ve arama dışındaki aktif filtre sayısı (huni rozeti). */
export function activeFilterCount(f: PurchaseFilters): number {
  return f.durum.length + f.oda.length + f.kategori.length + QUICK_KEYS.reduce((n, k) => n + (f[k] ? 1 : 0), 0);
}

export function filterPurchases(items: readonly Item[], f: PurchaseFilters, now: Date = new Date()): Item[] {
  const q = f.q.trim().toLocaleLowerCase('tr');
  return items.filter((i) => {
    if (i.deleted_at || i.tip !== 'satinalma') return false;
    if (!f.mevcutDahil && i.mevcut) return false;
    if (f.faz !== 'hepsi' && i.faz !== f.faz) return false;
    // Alınacaklar açıkken kapananlar gizli; ama kullanıcı sayfadan açıkça bir kapalı durumu seçtiyse o görünür.
    if (f.hideDone && CLOSED_DURUM.has(i.durum ?? '') && !f.durum.includes(i.durum ?? '')) return false;
    if (f.durum.length && !f.durum.includes(i.durum ?? '')) return false;
    if (f.oda.length && !f.oda.includes(i.oda ?? '')) return false;
    if (f.kategori.length && !f.kategori.includes(i.kategori ?? '')) return false;
    if (f.fiyatsiz && (i.tahmini_tl_min != null || i.tahmini_tl_max != null || i.gercek_tl != null)) return false;
    if (f.kararBekliyor && !i.karar_bekliyor) return false;
    if (f.siparisYakin && !isDueSoon(i, now)) return false;
    if (q && !`${i.ad} ${i.not ?? ''} ${i.nereden ?? ''}`.toLocaleLowerCase('tr').includes(q)) return false;
    return true;
  });
}

/**
 * Çekmece seçenek sayımları: alanın KENDİ seçimi yok sayılır, diğer tüm filtreler uygulanır
 * (klasik facet davranışı: "bunu seçersem kaç kalem"). Sıfır olanlar haritada yoktur → gizlenir.
 */
export function optionCounts(items: readonly Item[], f: PurchaseFilters, field: FacetField, now: Date = new Date()): Map<string, number> {
  const base = filterPurchases(items, { ...f, [field]: [] }, now);
  const m = new Map<string, number>();
  for (const i of base) {
    const v = i[field] ?? UNSET;
    m.set(v, (m.get(v) ?? 0) + 1);
  }
  // Şema sırasıyla (etiket sırası sabit kalsın); alanı boş kalemler en sonda "Belirsiz"
  const ordered: Array<[string, number]> = FACET_OPTIONS[field].filter((o) => m.has(o)).map((o) => [o, m.get(o)!]);
  if (m.has(UNSET)) ordered.push([UNSET, m.get(UNSET)!]);
  return new Map(ordered);
}

/** "Şu filtre değişirse kaç kalem": tek yerden sayım (şerit ve sayfa aynı sayıyı gösterir). */
export function countWith(items: readonly Item[], f: PurchaseFilters, patch: Partial<PurchaseFilters>, now: Date = new Date()): number {
  return filterPurchases(items, { ...f, ...patch }, now).length;
}

/** Hızlı filtre sayımları: her anahtar için "açıkken (ya da açılırsa) kaç kalem". */
export function quickCounts(items: readonly Item[], f: PurchaseFilters, now: Date = new Date()): Record<QuickKey, number> {
  const out = {} as Record<QuickKey, number>;
  for (const k of QUICK_KEYS) out[k] = filterPurchases(items, { ...f, [k]: true }, now).length;
  return out;
}
