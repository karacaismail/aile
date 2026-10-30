import type { Budget, Cell } from './data';
import { BudgetIntegrityError } from './integrity';

export const budgetBridge = { sheet: '_Finans aylık', metadata: 'A1:A7', inflows: 'A10:C36' } as const;
type Table = { labels: string[]; rows: Cell[][] };
const reject = (reason: string): never => { throw new BudgetIntegrityError(`Bütçe hesabı doğrulanamadı: ${reason}. Hesap yenilenene kadar tutarlar gösterilmiyor.`); };
const empty = (row: Cell[]) => row.every(value => value === null || value === '');

export function readBudgetMetadata(table: Table) {
  if (table.rows.length !== 7 || table.rows.some(row => row.slice(1).some(value => value !== null && value !== ''))) reject('kaynak kontrolü eksik');
  const values = table.rows.map(row => typeof row[0] === 'string' && row[0].trim() ? row[0] : reject('kaynak kontrolü eksik'));
  if (values[0] !== 'finance-bridge-v1') reject('kaynak sözleşmesi değişmiş');
  if (values[1] !== 'TRUE' || values[2] !== 'TRUE') reject('Plan veya Güncel kaynağı değişti');
  if (!/^[a-f0-9]{64}$/.test(values[3])) reject('kaynak sürümü eksik');
  if (!/^[1-9]\d*$/.test(values[6]) || Number(values[6]) > 26) reject('ay sayısı geçersiz');
  return { values, fingerprint: values[3], status: values[4], scope: values[5], monthCount: Number(values[6]) };
}

export function applyBudgetBridge(budget: Budget, table: Table, metadata: ReturnType<typeof readBudgetMetadata>): Budget {
  const headers = ['Ay', 'Plan finansman ve iç aktarım', 'Güncel finansman ve iç aktarım'];
  if (table.labels.length !== headers.length || table.labels.some((label, i) => label !== headers[i])) reject('finansman girişlerinin başlıkları değişmiş');
  const rows = table.rows.filter(row => !empty(row));
  if (rows.length !== metadata.monthCount) reject('finansman girişlerinin ay sayısı tutarsız');
  const inflows = new Map<string, { plan: number; current: number }>();
  rows.forEach((row, i) => {
    const month = typeof row[0] === 'string' ? row[0] : reject('finansman girişlerinin ayı eksik');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || (i > 0 && month <= String(rows[i - 1][0]))) reject('finansman girişlerinin ay sırası tutarsız');
    const amount = (value: Cell | undefined) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : reject('finansman girişi eksik veya hatalı');
    if (!empty(row.slice(3))) reject('finansman girişlerinin sütunları değişmiş');
    inflows.set(month, { plan: amount(row[1]), current: amount(row[2]) });
  });
  return {
    ...budget,
    bridge: { fingerprint: metadata.fingerprint, status: metadata.status, scope: metadata.scope },
    months: budget.months.map(month => {
      const inflow = inflows.get(month.key) ?? reject('bütçe ayının finansman girişi yok');
      return { ...month, selfFundedCashFlow: { plan: month.free.plan - inflow.plan, current: month.free.current - inflow.current } };
    }),
  };
}
