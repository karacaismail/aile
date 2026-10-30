import type { Cell } from '../dashboard/data';
import type { FinanceSource } from './data';
import { financeSchemaVersion, financeWire } from './contract';

type WireTable = { labels: string[]; rows: Cell[][] };
export type FinanceWireMetadata = { payloadHash: string; values: string[]; eventCount: number; monthCount: number };
const invalid = (reason: string): never => { throw new Error(`Finansman verisi doğrulanamadı: ${reason}. Tutarlar gösterilmiyor.`); };
const stale = (): never => { throw new Error('E-tablo kaynağı değişti; finansman hesabı yenilenmeli. Tutarlar gösterilmiyor.'); };
const digestPattern = /^[a-f0-9]{64}$/;

function rowValues(row: Cell[] | undefined, kind: string, index: number, width: number): Cell[] {
  if (!row || row.length !== 20 || row.some(value => typeof value !== 'string') || row[0] !== kind || row[1] !== `i:${index}`) return invalid('aktarım kayıt türü, sırası veya sütunları tutarsız');
  if (row.slice(width + 2).some(value => value !== 'z:')) invalid('aktarımda beklenmeyen sütun var');
  return row.slice(2, width + 2).map(value => {
    const token = value as string;
    if (token === 'z:') return null;
    if (token.startsWith('s:')) return token.slice(2);
    if (/^n:-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(token)) {
      const number = Number(token.slice(2));
      if (Number.isFinite(number)) return number;
    }
    return invalid('aktarım hücresi eksik veya sayı biçimi geçersiz');
  });
}
const strings = (values: Cell[]) => values.map(value => typeof value === 'string' ? value : invalid('aktarım metni eksik'));

/** The second read is deliberately small and must contain no data rows. */
export function readFinanceWireMetadata(table: WireTable, exact = true): FinanceWireMetadata {
  if (table.labels.length !== 20 || table.labels.some((label, index) => label !== financeWire.headers[index])) invalid('aktarım başlıkları değişmiş');
  if (table.rows.length < 10 || (exact && table.rows.length !== 10)) invalid('kaynak kontrolü kayıt sayısı tutarsız');
  const manifest = strings(rowValues(table.rows[0], 'manifest', 0, 2));
  if (manifest[0] !== financeWire.version || !digestPattern.test(manifest[1])) invalid('aktarım sürümü veya içerik özeti geçersiz');
  const values = Array.from({ length: 9 }, (_, index) => strings(rowValues(table.rows[index + 1], 'meta', index, 1))[0]);
  if (values[2] === 'FALSE') stale();
  if (values[2] !== 'TRUE') invalid('kaynak güncelliği teyit edilemedi');
  if (values[5] !== financeSchemaVersion || !digestPattern.test(values[6])) invalid('kaynak sözleşmesi veya sürümü geçersiz');
  if (values.some(value => !value.trim())) invalid('kaynak kontrolü eksik');
  const count = (index: number, maximum: number) => /^[1-9]\d*$/.test(values[index]) && Number(values[index]) <= maximum ? Number(values[index]) : invalid('kayıt sayısı geçersiz');
  return { payloadHash: manifest[1], values, eventCount: count(3, 5957), monthCount: count(4, 26) };
}

/** The producer binds this exact typed sequence; no formatting, sorting or rounding. */
export function financeCanonicalPayload(source: FinanceSource): string {
  return JSON.stringify([financeWire.version, financeSchemaVersion, source.metadata.rows.map(row => row[0]), source.monthly.labels, source.monthly.rows, source.daily.labels, source.daily.rows]);
}

export async function decodeFinanceWire(table: WireTable): Promise<{ source: FinanceSource; metadata: FinanceWireMetadata }> {
  const metadata = readFinanceWireMetadata(table, false);
  if (table.rows.length !== 12 + metadata.monthCount + metadata.eventCount) invalid('aktarım kayıt sayısı tutarsız');
  let next = 10;
  const monthly = { labels: strings(rowValues(table.rows[next++], 'monthly-header', 0, 9)), rows: Array.from({ length: metadata.monthCount }, (_, index) => rowValues(table.rows[next++], 'monthly', index, 9)) };
  const daily = { labels: strings(rowValues(table.rows[next++], 'daily-header', 0, 18)), rows: Array.from({ length: metadata.eventCount }, (_, index) => rowValues(table.rows[next++], 'daily', index, 18)) };
  const source: FinanceSource = { metadata: { labels: [''], rows: metadata.values.map(value => [value]) }, monthly, daily };
  if (!globalThis.crypto?.subtle) invalid('güvenli SHA-256 doğrulaması bu ortamda kullanılamıyor');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(financeCanonicalPayload(source)));
  const actualHash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  if (actualHash !== metadata.payloadHash) invalid('içerik özeti kaynak üretimiyle uyuşmuyor');
  return { source, metadata };
}
