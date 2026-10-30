import { parseTable, sheetId, sheetUrl, type Cell } from '../dashboard/data';
import { dailyHeaders, financeRanges, financeSchemaVersion, monthlyHeaders } from './contract';

type Table = ReturnType<typeof parseTable>;
export type FinanceSource = { metadata: Table; monthly: Table; daily: Table };
export type FinanceMonth = { month: string; cash: number; kmhPrincipal: number; kmhCost: number; cardDebt: number; futureInstalments: number; reserve: number; knownNetAssets: number; fundingGap: number };
export type FinanceEvent = { date: string; title: string; type: string; cashChange: number; requiredBalance: number; cash: number; kmhPrincipal: number; kmhCost: number; denizPrincipal: number; denizCost: number; isPrincipal: number; isCost: number; futureInstalments: number; cardDebt: number; fundingGap: number; certainty: string; source: string; id: string };
export type FinanceLedger = { status: string; notes: string[]; fingerprint: string; months: FinanceMonth[]; events: FinanceEvent[] };
export const financeSheetUrl = `${sheetUrl}?range=${encodeURIComponent("'Finansman'!A1")}`;
const invalid = (reason: string): never => { throw new Error(`Finansman verisi doğrulanamadı: ${reason}. Tutarlar gösterilmiyor.`); };
const stale = (): never => { throw new Error('E-tablo kaynağı değişti; finansman hesabı yenilenmeli. Finansman sayfasındaki kaynak kontrolü tamamlanana kadar tutarlar gösterilmiyor.'); };
const text = (value: Cell | undefined, label: string) => typeof value === 'string' && value.trim() ? value.trim() : invalid(`${label} eksik`);
const number = (value: Cell | undefined) => typeof value === 'number' && Number.isFinite(value) ? value : invalid('tutar eksik veya geçersiz');
const nonnegative = (value: Cell | undefined) => { const n = number(value); return n >= 0 ? n : invalid('borç veya kullanılabilir tutar negatif'); };
const moneyEpsilon = .000001;
const close = (left: number, right: number) => Math.abs(left - right) <= moneyEpsilon;
const isEmpty = (row: Cell[]) => row.every(value => value === null || value === '');
function metadata(table: Table) {
  if (table.rows[2]?.[0] === 'FALSE') stale();
  if (table.rows[2]?.[0] !== 'TRUE') invalid('kaynak güncelliği teyit edilemedi');
  if (table.rows[5]?.[0] !== financeSchemaVersion) invalid('sözleşme sürümü değişmiş');
  const count = (row: number, maximum: number) => {
    const value = text(table.rows[row]?.[0], 'kayıt sayısı');
    return /^[1-9]\d*$/.test(value) && Number(value) <= maximum ? Number(value) : invalid('kayıt sayısı geçersiz');
  };
  const fingerprint = text(table.rows[6]?.[0], 'kaynak sürümü');
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) invalid('kaynak sürümü geçersiz');
  return { status: text(table.rows[1]?.[0], 'hesap durumu'), notes: [text(table.rows[7]?.[0], 'hesap kapsamı'), text(table.rows[8]?.[0], 'hesap koşulları')], eventCount: count(3, 5957), monthCount: count(4, 26), fingerprint };
}
function rows(table: Table, headers: readonly string[], expectedCount: number) {
  if (table.labels.length !== headers.length || table.labels.some((label, index) => label !== headers[index])) invalid('sütun başlıkları değişmiş');
  const records = table.rows.filter(row => !isEmpty(row));
  if (records.length !== expectedCount || records.some(row => row.length > headers.length && !isEmpty(row.slice(headers.length)))) invalid('kayıt sayısı tutarsız');
  return records;
}
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

/** Validate the native result, never calculate a replacement financing plan. */
export function buildFinance(source: FinanceSource): FinanceLedger {
  const meta = metadata(source.metadata);
  const ids = new Set<string>();
  const events: FinanceEvent[] = rows(source.daily, dailyHeaders, meta.eventCount).map((row, index, all) => {
    const date = text(row[0], 'tarih');
    if (!validDate(date) || (index > 0 && date < String(all[index - 1][0]))) invalid('tarih veya kronolojik sıra geçersiz');
    const id = text(row[17], 'işlem kimliği');
    if (ids.has(id)) invalid('işlem kimliği yinelenmiş');
    ids.add(id);
    const event = { date, title: text(row[1], 'adım'), type: text(row[2], 'tür'), cashChange: number(row[3]), requiredBalance: number(row[4]), cash: nonnegative(row[5]), kmhPrincipal: nonnegative(row[6]), kmhCost: nonnegative(row[7]), denizPrincipal: nonnegative(row[8]), denizCost: nonnegative(row[9]), isPrincipal: nonnegative(row[10]), isCost: nonnegative(row[11]), futureInstalments: nonnegative(row[12]), cardDebt: nonnegative(row[13]), fundingGap: nonnegative(row[14]), certainty: text(row[15], 'kesinlik'), source: text(row[16], 'kaynak'), id };
    if (!close(event.cardDebt, event.denizPrincipal + event.denizCost + event.isPrincipal + event.isCost)) invalid('kart borcu mutabakatı tutarsız');
    if (event.futureInstalments > event.denizPrincipal + event.isPrincipal + moneyEpsilon) invalid('gelecek taksit anaparadan fazla');
    if (!close(event.cash, Math.max(0, event.requiredBalance))) invalid('harcanabilir nakit net bakiyeyle tutarsız');
    const negativeBalance = Math.max(0, -event.requiredBalance);
    if (event.kmhPrincipal > negativeBalance + moneyEpsilon) invalid('KMH anaparası net bakiyeyle tutarsız');
    const uncoveredPrincipal = negativeBalance - event.kmhPrincipal;
    if (event.fundingGap + moneyEpsilon < uncoveredPrincipal || event.fundingGap > uncoveredPrincipal + event.kmhCost + moneyEpsilon) invalid('fon eksiği nakit ve KMH ile tutarsız');
    if (index > 0 && !close(number(all[index - 1][4]) + event.cashChange, event.requiredBalance)) invalid('nakit bakiye zinciri tutarsız');
    return event;
  });
  const months: FinanceMonth[] = rows(source.monthly, monthlyHeaders, meta.monthCount).map((row, index, all) => {
    const month = text(row[0], 'ay');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || (index > 0 && month <= String(all[index - 1][0]))) invalid('ay sırası geçersiz');
    return { month, cash: nonnegative(row[1]), kmhPrincipal: nonnegative(row[2]), kmhCost: nonnegative(row[3]), cardDebt: nonnegative(row[4]), futureInstalments: nonnegative(row[5]), reserve: nonnegative(row[6]), knownNetAssets: number(row[7]), fundingGap: nonnegative(row[8]) };
  });
  const dailyMonths = [...new Set(events.map(event => event.date.slice(0, 7)))];
  if (dailyMonths.length !== months.length || dailyMonths.some((month, index) => month !== months[index].month)) invalid('aylık ve günlük kapsam farklı');
  for (const month of months) {
    const last = events.findLast(event => event.date.startsWith(month.month))!;
    if (!(['cash', 'kmhPrincipal', 'kmhCost', 'cardDebt', 'futureInstalments', 'fundingGap'] as const).every(key => close(month[key], last[key]))) invalid('ay sonu bakiyeleri tutarsız');
    if (!close(month.knownNetAssets, last.requiredBalance + month.reserve - last.kmhCost - last.cardDebt)) invalid('net nakit ve borç mutabakatı tutarsız');
  }
  return { status: meta.status, notes: meta.notes, fingerprint: meta.fingerprint, months, events };
}

export async function fetchFinance(signal: AbortSignal): Promise<FinanceLedger> {
  if (!sheetId) invalid('e-tablo bağlantısı tanımlı değil');
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const read = async (range: string, headers: number) => {
    const url = new URL(`https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq`);
    url.searchParams.set('sheet', 'Finansman'); url.searchParams.set('range', range);
    url.searchParams.set('headers', String(headers)); url.searchParams.set('tqx', 'out:json');
    // The same sheet has an A:F cost report below the daily ledger. Only R
    // identifies payment events; metadata still rejects missing or extra IDs.
    if (range === financeRanges.daily) url.searchParams.set('tq', 'select * where R is not null');
    const response = await fetch(url, { signal: controller.signal, cache: 'no-store', credentials: 'omit' });
    if (!response.ok) throw new Error(`Finansman bağlantısı alınamadı (${response.status}).`);
    return parseTable(await response.text());
  };
  try {
    // Establish the generation before requesting amounts. Otherwise a data
    // response may predate the first guard while both guard reads see the new
    // generation. Typed amount blocks then share one parallel network phase.
    const before = await read(financeRanges.metadata, 0);
    metadata(before);
    const [monthly, daily] = await Promise.all([read(financeRanges.monthly, 1), read(financeRanges.daily, 1)]);
    const after = await read(financeRanges.metadata, 0);
    if (JSON.stringify(metadata(before)) !== JSON.stringify(metadata(after))) stale();
    return buildFinance({ metadata: after, monthly, daily });
  } finally { controller.abort(); signal.removeEventListener('abort', abort); }
}
