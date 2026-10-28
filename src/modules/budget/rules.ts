// Bütçe modülünün saf kuralları: ay özeti (plan × günlük), kalem listesi, son kullanılan kalemler.
import type { BudgetPlan, CashEntry } from '@shared/schema';

export const MONTHS_TR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'] as const;

/** Ay anahtarı: 'YYYY-MM'. */
export type MonthKey = string;
export const monthOf = (iso: string): MonthKey => iso.slice(0, 7);
export function shiftMonth(key: MonthKey, delta: number): MonthKey {
  const [y, m] = key.split('-').map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}
export function monthLabel(key: MonthKey): string {
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS_TR[m - 1]} ${y}`;
}

/** Bütçe satırı adlarını karşılaştırma için sadeleştirir (Sheets'teki sondaki boşluklar, çift boşluk). */
export const normKalem = (s: string): string => s.replace(/\s+/g, ' ').trim();

export interface SummaryRow { label: string; plan: number; actual: number; count: number }
export interface SummaryGroup { name: string; rows: SummaryRow[]; plan: number; actual: number }
export interface MonthSummary {
  /** Plan bu ay için var mı (plan yılı ile ay yılı eşleşiyor). */
  hasPlan: boolean;
  groups: SummaryGroup[];
  plan: number;
  actual: number;
  entries: CashEntry[];
}

export const OTHER_GROUP = 'Planda olmayan';

/** Ay özeti: planı olan ya da kaydı olan satırlar; planda olmayan kalemler ayrı grupta. Kayıtlar yeniden eskiye. */
export function monthSummary(plan: BudgetPlan | undefined, cash: readonly CashEntry[], key: MonthKey): MonthSummary {
  const [y, m] = key.split('-').map(Number);
  const hasPlan = !!plan && (plan.year === undefined || plan.year === y);
  const entries = cash.filter((c) => !c.deleted_at && monthOf(c.tarih ?? '') === key)
    .sort((a, b) => (b.tarih ?? '').localeCompare(a.tarih ?? '') || (b.created_at ?? '').localeCompare(a.created_at ?? ''));
  const byKalem = new Map<string, { sum: number; count: number }>();
  for (const e of entries) {
    const k = normKalem(e.kalem ?? '');
    const cur = byKalem.get(k) ?? { sum: 0, count: 0 };
    cur.sum += Number(e.tutar) || 0; cur.count++;
    byKalem.set(k, cur);
  }
  const used = new Set<string>();
  const groups: SummaryGroup[] = [];
  for (const g of plan?.groups ?? []) {
    const rows: SummaryRow[] = [];
    for (const r of g.rows) {
      const k = normKalem(r.label);
      if (used.has(k)) continue;
      used.add(k);
      const a = byKalem.get(k);
      const p = hasPlan ? (r.plan[m - 1] ?? 0) : 0;
      if (p > 0 || a) rows.push({ label: k, plan: p, actual: a?.sum ?? 0, count: a?.count ?? 0 });
    }
    if (rows.length) groups.push(sumGroup(g.name, rows));
  }
  const other = [...byKalem.entries()].filter(([k]) => !used.has(k)).map(([k, a]) => ({ label: k, plan: 0, actual: a.sum, count: a.count }));
  if (other.length) groups.push(sumGroup(OTHER_GROUP, other));
  return { hasPlan, groups, plan: groups.reduce((s, g) => s + g.plan, 0), actual: groups.reduce((s, g) => s + g.actual, 0), entries };
}

function sumGroup(name: string, rows: SummaryRow[]): SummaryGroup {
  return { name, rows, plan: rows.reduce((s, r) => s + r.plan, 0), actual: rows.reduce((s, r) => s + r.actual, 0) };
}

export interface KalemOption { group: string; label: string }

/** Formda seçilebilecek kalemler: plan satırları (grup sırasıyla) + günlükte geçen ama planda olmayanlar. */
export function kalemOptions(plan: BudgetPlan | undefined, cash: readonly CashEntry[]): KalemOption[] {
  const seen = new Set<string>();
  const out: KalemOption[] = [];
  for (const g of plan?.groups ?? []) for (const r of g.rows) {
    const k = normKalem(r.label);
    if (k && !seen.has(k)) { seen.add(k); out.push({ group: g.name, label: k }); }
  }
  for (const c of cash) {
    const k = normKalem(c.kalem ?? '');
    if (k && !c.deleted_at && !seen.has(k)) { seen.add(k); out.push({ group: OTHER_GROUP, label: k }); }
  }
  return out;
}

/** Son kullanılan kalemler (en yeni kayıttan geriye, tekrarsız). Hiç kayıt yoksa boş. */
export function recentKalems(cash: readonly CashEntry[], limit = 6): string[] {
  const sorted = cash.filter((c) => !c.deleted_at && c.kalem)
    .sort((a, b) => (b.created_at ?? b.tarih ?? '').localeCompare(a.created_at ?? a.tarih ?? ''));
  const out: string[] = [];
  for (const c of sorted) {
    const k = normKalem(c.kalem);
    if (!out.includes(k)) out.push(k);
    if (out.length >= limit) break;
  }
  return out;
}

/** Hızlı seçim çipleri: önce son kullanılanlar, sonra planın en büyük satırları; seçili değer her zaman görünür. */
export function quickKalems(plan: BudgetPlan | undefined, cash: readonly CashEntry[], selected: string | undefined, month: number, limit = 6): string[] {
  const out = recentKalems(cash, limit);
  const byPlan = (plan?.groups ?? []).flatMap((g) => g.rows).filter((r) => (r.plan[month - 1] ?? 0) > 0)
    .sort((a, b) => (b.plan[month - 1] ?? 0) - (a.plan[month - 1] ?? 0));
  for (const r of byPlan) {
    if (out.length >= limit) break;
    const k = normKalem(r.label);
    if (!out.includes(k)) out.push(k);
  }
  return selected && !out.includes(selected) ? [selected, ...out].slice(0, limit) : out;
}
