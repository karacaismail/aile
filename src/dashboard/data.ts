import { z } from 'zod';
import { buildCurrentBudget, isCurrentBudget } from './current';

const cell = z.object({ v: z.union([z.string(), z.number(), z.boolean()]).nullable().optional(), f: z.string().optional() }).nullable();
const responseSchema = z.object({ status: z.literal('ok'), table: z.object({ cols: z.array(z.object({ label: z.string().optional() })), rows: z.array(z.object({ c: z.array(cell) })) }) });
export type Cell = string | number | boolean | null;
export type Grid = Cell[][];
export function parseTable(text: string) {
  const match = text.match(/^\s*(?:\/\*O_o\*\/\s*)?google\.visualization\.Query\.setResponse\(([\s\S]*)\);?\s*$/);
  if (!match) throw new Error('Google Sheets yanıtı okunamadı. Paylaşım erişimini kontrol edin.');
  const result = responseSchema.safeParse(JSON.parse(match[1]));
  if (!result.success) throw new Error('Google Sheets verisi alınamadı.');
  return { labels: result.data.table.cols.map(c => c.label ?? ''), rows: result.data.table.rows.map(r => r.c.map(c => c?.v ?? null)) };
}
export const parseGviz = (text: string): Grid => parseTable(text).rows;
export type Pair = { plan: number; current: number };
export type Month = { label: string; key: string; source: string; income: Pair; expense: Pair; saving: Pair; free: Pair; balance: Pair };
export type Category = { id: string; label: string; group: string; kind: 'income' | 'expense' | 'saving'; plan: (number | null)[]; current: (number | null)[] };
export type Irregular = { id: string; label: string; type: string; planMonth: string; month: string; plan: number | null; current: number | null; status: string; room: string; note: string; manual: boolean };
export type Budget = { months: Month[]; categories: Category[]; groups: Category[]; irregular: Irregular[]; schema?: 'cashflow' };
export type RawBudget = { summary: Grid; plan: Grid; actual: Grid; irregular: Grid; planMonths?: string[]; actualMonths?: string[] };
const trMonths = ['ocak', 'şubat', 'mart', 'nisan', 'mayıs', 'haziran', 'temmuz', 'ağustos', 'eylül', 'ekim', 'kasım', 'aralık'];
const str = (v: Cell | undefined) => v == null ? '' : String(v).trim();
const num = (v: Cell | undefined): number | null => typeof v === 'number' && Number.isFinite(v) ? v : null;
const required = (v: Cell | undefined) => { const n = num(v); if (n === null) throw new Error('Zorunlu aylık toplam eksik; son tutarlı veriler korunuyor.'); return n; };
const lower = (v: Cell | undefined) => str(v).toLocaleLowerCase('tr');
const rowBy = (rows: Grid, pattern: RegExp) => {
  const rowsFound = rows.filter(r => pattern.test(lower(r[0])));
  if (rowsFound.length !== 1) throw new Error('E-tablo şeması değişmiş; toplam satırları doğrulanamadı.');
  return rowsFound[0];
};
function monthKey(label: string) {
  const [name, year] = label.toLocaleLowerCase('tr').split(' ');
  const month = trMonths.indexOf(name);
  if (month < 0 || !/^\d{4}$/.test(year ?? '')) throw new Error('Ay başlıkları doğrulanamadı.');
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}
const groups = [
  { name: 'Gelir', start: /^gelir$/, end: /^toplam gelir$/, kind: 'income' },
  { name: 'Borç ve vergi', start: /^borç ve vergi$/, end: /^borç ve vergi toplamı$/, kind: 'expense' },
  { name: 'Faturalar', start: /^faturalar$/, end: /^faturalar toplamı$/, kind: 'expense' },
  { name: 'Ev', start: /^ev$/, end: /^ev toplamı$/, kind: 'expense' },
  { name: 'Okul', start: /^okul$/, end: /^okul toplamı$/, kind: 'expense' },
  { name: 'Günlük yaşam', start: /^günlük yaşam$/, end: /^günlük yaşam toplamı$/, kind: 'expense' },
  { name: 'Düzensiz giderler', start: /^düzensiz giderler$/, end: /^(tek seferlik \+ taşınma \+ özel gün|düzensiz giderler)$/, kind: 'expense' },
  { name: 'Birikim', start: /^birikim/, end: /^net birikim/, kind: 'saving' },
] as const;

export function buildBudget(raw: RawBudget): Budget {
  const months: Month[] = raw.summary.filter(r => /^\S+ \d{4}$/.test(str(r[0]))).map(r => ({
    label: str(r[0]), key: monthKey(str(r[0])), source: str(r[1]),
    income: { plan: required(r[2]), current: required(r[3]) }, expense: { plan: required(r[4]), current: required(r[5]) },
    saving: { plan: required(r[6]), current: required(r[7]) }, free: { plan: required(r[8]), current: required(r[9]) }, balance: { plan: required(r[10]), current: required(r[11]) },
  }));
  if (!months.length || new Set(months.map(m => m.key)).size !== months.length || months.some((m, i) => i > 0 && m.key <= months[i - 1].key)) throw new Error('Aylık özet doğrulanamadı.');
  for (const headers of [raw.planMonths, raw.actualMonths]) {
    if (headers && (headers.length !== months.length || headers.some((h, i) => h !== months[i].label))) throw new Error('Sekmelerin ay başlıkları tutarlı değil.');
  }
  for (const [field, pattern] of [['income', /^toplam gelir$/], ['expense', /^toplam ödemeler$/], ['saving', /^net birikim/]] as const) {
    const plan = rowBy(raw.plan, pattern), actual = rowBy(raw.actual, pattern);
    months.forEach((m, i) => {
      if (Math.abs(required(plan[i + 1]) - m[field].plan) > .05 || Math.abs(required(actual[i + 1]) - m[field].current) > .05) throw new Error('Sekmeler henüz tutarlı değil. Yeniden kontrol edilecek.');
    });
  }
  const categories: Category[] = [], totals: Category[] = [];
  for (const group of groups) {
    // Income is the first block in B12:P74 and also supported with the GELİR heading in B7:P74.
    let start = raw.plan.findIndex(r => group.start.test(lower(r[0])));
    if (group.kind !== 'income' && start < 0) throw new Error('E-tablo şeması değişmiş; kategori başlığı eksik.');
    const end = raw.plan.findIndex((r, i) => i > start && group.end.test(lower(r[0])));
    if (end < 0) throw new Error('E-tablo şeması değişmiş; kategori toplamı eksik.');
    const pairRow = (r: Cell[]): Category => {
      const actual = raw.actual.find(a => str(a[0]) === str(r[0]));
      if (!actual) throw new Error('Plan ve Gerçekleşen kalemleri tutarlı değil.');
      return { id: `${group.name}/${str(r[0])}`, label: str(r[0]), group: group.name, kind: group.kind,
        plan: months.map((_, i) => num(r[i + 1])), current: months.map((_, i) => num(actual[i + 1])) };
    };
    totals.push({ ...pairRow(raw.plan[end]), label: group.name });
    if (group.name === 'Düzensiz giderler') categories.push(pairRow(raw.plan[end]));
    else raw.plan.slice(start + 1, end).filter(r => str(r[0]) && !/(miktarı|adet)/.test(lower(r[0]))).forEach(r => categories.push(pairRow(r)));
  }
  const irregular = raw.irregular.filter(r => str(r[0])).map((r, i): Irregular => ({
    id: str(r[14]) || `row-${i}`, label: str(r[0]), type: str(r[1]), planMonth: str(r[2]), plan: num(r[3]), current: num(r[4]), month: str(r[5]), status: str(r[6]), room: str(r[8]), note: str(r[12]), manual: Number(r[15]) > 0,
  }));
  const irregularTotal = totals.find(t => t.group === 'Düzensiz giderler')!;
  months.forEach((month, i) => {
    // Mirrors the Sheet SUMIFS on calculated amounts. Cancelled/existing rows
    // already produce zero there; don't re-interpret their status here.
    const plan = irregular.filter(r => r.planMonth === month.label).reduce((sum,r) => sum + (r.plan ?? 0), 0);
    const current = irregular.filter(r => r.month === month.label).reduce((sum,r) => sum + (r.current ?? 0), 0);
    if (irregularTotal.plan[i] === null || irregularTotal.current[i] === null ||
        Math.abs(plan - irregularTotal.plan[i]!) > .05 || Math.abs(current - irregularTotal.current[i]!) > .05) {
      throw new Error('Düzensiz giderler ile aylık toplamlar henüz tutarlı değil. Son başarılı veriler korunuyor.');
    }
  });
  return { months, categories, groups: totals, irregular };
}
const moneyFormatter = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });
export const money = (value: number | null) => value === null ? 'Tutar yok' : `${moneyFormatter.format(value)} ₺`;
export const percentChange = (value: number, before: number) => before === 0 ? null : (value - before) / Math.abs(before) * 100;
export const percent = (value: number | null) => value === null ? '—' : `${value > 0 ? '+' : ''}${new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 }).format(value)}%`;

export const sheetId = import.meta.env.VITE_BUDGET_SHEET_ID ?? '';
export const sheetUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;
export const FEEDS = {
  summary: { sheet: 'Pano', range: 'B49:M63' },
  plan: { sheet: 'Plan', range: 'B7:P74' },
  actual: { sheet: 'Gerçekleşen', range: 'B7:P74' },
  irregular: { sheet: 'Düzensiz giderler', range: 'B9:Q' },
} as const;
export async function fetchBudget(signal: AbortSignal): Promise<Budget> {
  if (!/^[\w-]{20,}$/.test(sheetId)) throw new Error('Google Sheets bağlantısı henüz tanımlanmamış.');
  const read = async (sheet: string, range: string, headers: '0' | '1') => {
    const url = new URL(`https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq`);
    url.search = new URLSearchParams({ sheet, range, headers, tqx: 'out:json', _: String(Date.now()) }).toString();
    const response = await fetch(url, { signal, cache: 'no-store', credentials: 'omit' });
    if (!response.ok) throw new Error(`Google Sheets bağlantısı başarısız (${response.status}).`);
    return parseTable(await response.text());
  };
  const plan = await read('Plan', 'B2:P79', '0');
  if (isCurrentBudget(plan.rows)) {
    const [summary, actual, cash, irregular] = await Promise.all([
      read('Pano', 'B49:M63', '1'), read('Gerçekleşen', 'B2:P79', '0'), read('Kasa', 'B7:P36', '0'), read('Arızi Giderler', 'B4:P344', '1'),
    ]);
    return buildCurrentBudget({ summary: summary.rows, plan: plan.rows, actual: actual.rows, cash: cash.rows, irregular: [irregular.labels, ...irregular.rows] });
  }
  const entries = await Promise.all(Object.entries(FEEDS).map(async ([key, feed]) => {
    return [key, await read(feed.sheet, feed.range, '1')] as const;
  }));
  const tables = Object.fromEntries(entries);
  return buildBudget({ summary: tables.summary.rows, plan: tables.plan.rows, actual: tables.actual.rows, irregular: tables.irregular.rows,
    planMonths: tables.plan.labels.slice(1), actualMonths: tables.actual.labels.slice(1) });
}
