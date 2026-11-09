import type { Budget, Irregular } from '../dashboard/data';

/** A Sheet row belongs here when its "Yer / Bölüm" cell says so; the page holds no list of payments of its own. */
const SECTION = 'emeklilik';
const reserveLabel = /ba[ğg]\s*-?\s*kur|\bsgk\b/i;

export type RetirementReserve = { id: string; label: string; total: number | null; count: number; first: string; last: string; gaps: number };
export type RetirementPlan = { payments: Irregular[]; total: number | null; missing: number; months: string[]; reserves: RetirementReserve[] };

export const paymentMonth = (row: Irregular) => row.month || row.planMonth;
const inSection = (room: string) => room.trim().toLocaleLowerCase('tr-TR') === SECTION;

export function retirementPlan(data: Budget): RetirementPlan {
  const payments = data.irregular.filter(row => inSection(row.room) && row.status !== 'İptal');
  const order = data.months.map(month => month.label);
  const position = (label: string) => { const index = order.indexOf(label); return index < 0 ? order.length : index; };
  // Reserves come from Plan, the sheet the user edits. Only expenses count: a pension income is not money set aside.
  const reserves = data.categories.filter(category => category.kind === 'expense' && reserveLabel.test(category.label)).flatMap((category): RetirementReserve[] => {
    const known = category.plan.flatMap((value, index) => value ? [{ value, index }] : []);
    if (!known.length) return category.plan.length > 0 && category.plan.every(value => value === null)
      ? [{ id: category.id, label: category.label, total: null, count: 0, first: '', last: '', gaps: 0 }] : [];
    const start = known[0].index, end = known.at(-1)!.index;
    return [{
      id: category.id, label: category.label, total: known.reduce((sum, item) => sum + item.value, 0), count: known.length,
      first: order[start], last: order[end], gaps: category.plan.slice(start, end + 1).filter(value => value === null).length,
    }];
  });
  // A missing amount stays missing: it is counted apart, and with no known amount there is no total to show.
  const known = payments.flatMap(row => row.current === null ? [] : [row.current]);
  return {
    payments,
    total: known.length ? known.reduce((sum, value) => sum + value, 0) : null,
    missing: payments.length - known.length,
    months: [...new Set(payments.map(paymentMonth).filter(Boolean))].sort((a, b) => position(a) - position(b)),
    reserves,
  };
}
