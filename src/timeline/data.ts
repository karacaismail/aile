import { parseTable, sheetId, sheetUrl } from '../dashboard/data';
import { TIMELINE_HEADERS, type TimelineTable } from './contract';
export { TIMELINE_HEADERS, type TimelineTable } from './contract';
export type TimelineEvent = {
  id: string; date: string; order: number; type: string; title: string; source: string;
  cashChange: number; denizChange: number; isChange: number; cash: number;
  denizDebt: number; isDebt: number; totalDebt: number; certainty: string; note: string; month: string;
};
export type Timeline = { events: TimelineEvent[]; months: string[] };
export const timelineSheetUrl = `${sheetUrl}#gid=7302613`;
const eventTypes = ['Başlangıç', 'Gelir', 'Gider', 'Alışveriş', 'Kart ödemesi', 'Faiz', 'Birikim', 'Kontrol', 'Teslimat'];
const dateQualities = ['Teyitli plan', 'Tarih varsayımı', 'Ay sonu kontrolü'];
const equalMoney = (a: number, b: number) => Math.abs(a - b) <= .011;
const invalid = (detail: string): never => { throw new Error(`Timeline verileri doğrulanamadı: ${detail}.`); };
const requiredText = (value: unknown, label: string) => typeof value === 'string' && value.trim() ? value.trim() : invalid(`${label} eksik`);
const requiredNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : invalid('bir tutar veya sıra eksik');
const isoDate = (value: unknown) => {
  const date = requiredText(value, 'tarih');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T12:00:00Z`)) || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date) invalid('geçersiz tarih');
  return date;
};
const isMonthEnd = (date: string) => new Date(Date.parse(`${date}T12:00:00Z`) + 86400000).getUTCDate() === 1;

export function buildTimeline(table: TimelineTable): Timeline {
  if (table.labels.length !== TIMELINE_HEADERS.length || TIMELINE_HEADERS.some((header, i) => table.labels[i] !== header)) invalid('sütun başlıkları değişmiş');
  const seen = new Set<string>();
  const rows = table.rows.filter(row => row.some(value => value !== null && value !== ''));
  if (!rows.length) invalid('takvim boş');
  const events = rows.map((row): TimelineEvent => {
    const id = requiredText(row[0], 'adım kimliği');
    if (seen.has(id)) invalid('yinelenen adım kimliği');
    seen.add(id);
    const date = isoDate(row[1]), order = requiredNumber(row[2]);
    const type = requiredText(row[3], 'adım türü'), certainty = requiredText(row[13], 'tarih niteliği');
    if (!eventTypes.includes(type) || !dateQualities.includes(certainty) || !Number.isInteger(order) || order < 0) invalid('adım türü, tarih niteliği veya sıra');
    const values = row.slice(6, 13).map(requiredNumber);
    if (values.length !== 7) invalid('tutar sütunları eksik');
    const [cashChange, denizChange, isChange, cash, denizDebt, isDebt, totalDebt] = values;
    const month = requiredText(row[16], 'dönem');
    if (month !== date.slice(0, 7)) invalid('tarih ile dönem uyuşmuyor');
    if (!equalMoney(requiredNumber(row[15]), 0)) invalid('aylık mutabakat farkı var');
    if (!equalMoney(totalDebt, denizDebt + isDebt) || denizDebt < -.011 || isDebt < -.011) invalid('kart borçları uyuşmuyor');
    if (row[14] != null && typeof row[14] !== 'string') invalid('açıklama biçimi');
    return { id, date, order, type, title: requiredText(row[4], 'adım'), source: requiredText(row[5], 'kaynak'), cashChange, denizChange, isChange, cash, denizDebt, isDebt, totalDebt, certainty, note: String(row[14] ?? ''), month };
  });
  if (events[0].type !== 'Başlangıç') invalid('açılış bakiyesi eksik');
  events.forEach((event, i) => {
    const previous = events[i - 1];
    if (i > 0 && (event.type === 'Başlangıç' || event.date < previous.date || (event.date === previous.date && event.order <= previous.order))) invalid('adımlar kronolojik sırada değil');
    if (!equalMoney(event.cash, (previous?.cash ?? 0) + event.cashChange) || !equalMoney(event.denizDebt, (previous?.denizDebt ?? 0) + event.denizChange) || !equalMoney(event.isDebt, (previous?.isDebt ?? 0) + event.isChange)) invalid('adım bakiyeleri uyuşmuyor');
  });
  const months = [...new Set(events.map(event => event.month))];
  months.forEach((month, i) => {
    if (i > 0) {
      const [year, number] = months[i - 1].split('-').map(Number);
      const followingMonth = new Date(Date.UTC(year, number, 1)).toISOString().slice(0, 7);
      if (month !== followingMonth) invalid('takvimde ay eksik');
    }
    const monthEvents = events.filter(event => event.month === month);
    const end = monthEvents.at(-1)!;
    if (end.type !== 'Kontrol' || end.certainty !== 'Ay sonu kontrolü' || !isMonthEnd(end.date)) invalid('ay sonu kontrolü eksik');
  });
  return { events, months };
}

export async function fetchTimeline(signal: AbortSignal): Promise<Timeline> {
  if (!/^[\w-]{20,}$/.test(sheetId)) throw new Error('Google Sheets bağlantısı henüz tanımlanmamış.');
  const url = new URL(`https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq`);
  url.search = new URLSearchParams({ sheet: 'Timeline', range: 'A8:Q1600', headers: '1', tqx: 'out:json', _: String(Date.now()) }).toString();
  const response = await fetch(url, { signal, cache: 'no-store', credentials: 'omit' });
  if (!response.ok) throw new Error(`Timeline bağlantısı başarısız (${response.status}).`);
  return buildTimeline(parseTable(await response.text()));
}

const dateFormatter = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const monthFormatter = new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
export const dateLabel = (date: string) => dateFormatter.format(new Date(`${date}T12:00:00Z`));
export const monthLabel = (month: string) => monthFormatter.format(new Date(`${month}-01T12:00:00Z`));
