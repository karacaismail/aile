import { createHash } from 'node:crypto';
import type { Cell } from '../dashboard/data';
import { dailyHeaders, monthlyHeaders } from './contract';
import type { FinanceSource } from './data';

/** Invented values only. Never copy the connected household workbook here. */
export function syntheticFinance(): FinanceSource {
  const events: Cell[][] = [
    ['2098-01-01', 'Sentetik dönem başlangıcı', 'Başlangıç', 0, -50, 0, 50, 2, 200, 5, 300, 7, 100, 512, 0, 'Koşullu hesap', 'Sentetik kaynak; banka oranı teyitsiz', 'synthetic-opening'],
    ['2098-01-31', 'Sentetik ay sonu', 'Kontrol', 550, 500, 500, 0, 0, 50, 2, 100, 3, 20, 155, 0, 'Koşullu hesap', 'Sentetik ay sonu', 'synthetic-january-close'],
    ['2098-02-01', 'Sentetik iç aktarım', 'İç aktarım', 1000, 1500, 1500, 0, 0, 50, 2, 100, 3, 20, 155, 0, 'Teyitli plan', 'Sentetik aktarım; gelir değildir', 'synthetic-transfer'],
    ['2098-02-28', 'Sentetik ay sonu', 'Kontrol', -100, 1400, 1400, 0, 0, 100, 2, 200, 3, 200, 305, 0, 'Koşullu hesap', 'Sentetik ay sonu', 'synthetic-february-close'],
  ];
  return {
    metadata: { labels: [''], rows: [['Finansman'], ['Koşullu hesap; banka oranı ve geçmiş faiz teyitsiz.'], ['TRUE'], ['4'], ['2'], ['finance-v1'], ['a'.repeat(64)], ['Harcanabilir nakit ayrılan bütçeler sonrasıdır; banka bakiyesi değildir.'], ['Geçmiş tahakkuk ve gelecekteki banka oranları teyit bekliyor.']] as Cell[][] },
    monthly: { labels: [...monthlyHeaders], rows: [
      ['2098-01', 500, 0, 0, 155, 20, 600, 945, 0],
      ['2098-02', 1400, 0, 0, 305, 200, 600, 1695, 0],
    ] as Cell[][] },
    daily: { labels: [...dailyHeaders], rows: events },
  };
}

/** A longer neutral ledger for pagination and progressive rendering checks. */
export function syntheticLongFinance(): FinanceSource {
  const source = syntheticFinance();
  source.daily.rows = [];
  source.monthly.rows = [];
  for (let month = 1; month <= 6; month += 1) {
    const period = `2098-${String(month).padStart(2, '0')}`;
    for (let day = 1; day <= 28; day += 1) {
      const number = source.daily.rows.length + 1;
      source.daily.rows.push([`${period}-${String(day).padStart(2, '0')}`, `Örnek adım ${number}`, number === 1 ? 'Başlangıç' : 'Kontrol', 0, 654321, 654321, 0, 0, 200, 5, 300, 7, 100, 512, 0, 'Koşullu hesap', 'Sentetik uzun kaynak', `synthetic-long-${number}`]);
    }
    source.monthly.rows.push([period, 654321, 0, 0, 512, 100, 0, 653809, 0]);
  }
  source.metadata.rows[3] = [String(source.daily.rows.length)];
  source.metadata.rows[4] = ['6'];
  return source;
}

/** Test-only transport encoder; its digest is independent of the browser decoder. */
export function syntheticFinanceWire(source = syntheticFinance()) {
  const labels = ['kind', 'index', ...Array.from({ length: 18 }, (_, i) => `c${i + 1}`)];
  const canonical = JSON.stringify(['finance-wire-v1', 'finance-v1', source.metadata.rows.map(row => row[0]), source.monthly.labels, source.monthly.rows, source.daily.labels, source.daily.rows]);
  const digest = createHash('sha256').update(canonical, 'utf8').digest('hex');
  const cell = (value: Cell) => value === null ? 'z:' : typeof value === 'number' ? `n:${value}` : `s:${value}`;
  const row = (kind: string, index: number, values: Cell[]) => [kind, `i:${index}`, ...Array.from({ length: 18 }, (_, i) => cell(i < values.length ? values[i] : null))];
  return { labels, rows: [row('manifest', 0, ['finance-wire-v1', digest]), ...source.metadata.rows.map((values, i) => row('meta', i, values)), row('monthly-header', 0, source.monthly.labels), ...source.monthly.rows.map((values, i) => row('monthly', i, values)), row('daily-header', 0, source.daily.labels), ...source.daily.rows.map((values, i) => row('daily', i, values))] };
}

/** The same two-range helper is shared by every browser mock. */
export function financeWireResponseTable(url: string, source = syntheticFinance()) {
  const params = new URL(url).searchParams;
  if (params.get('sheet') !== '_Web verisi' || params.get('headers') !== '1') throw new Error('Unexpected finance transport');
  const table = syntheticFinanceWire(source);
  if (params.get('range') === 'A1:T6000') return table;
  if (params.get('range') === 'A1:T11') return { ...table, rows: table.rows.slice(0, 10) };
  throw new Error('Unexpected finance range');
}

/**
 * The six reading cases of the payment journey, invented values only: opening snapshot, reserve transfer that first
 * repays the overdraft, cash subscription, generic card charge (school meal), hand-paid weekly tutoring, card instalment.
 * The whole ledger is invented and derived step by step from its own opening; it mirrors no household state:
 * opening KMH 1.200, cards 900 + 600 with 800 future instalments; transfer 5.000 = KMH 1.200 + cash 3.800;
 * cash 95 and 140; card charge 70; a 1.800 card purchase in 6 instalments of 300 (first one billed, 1.500 future).
 */
export function syntheticJourneyFinance(): FinanceSource {
  const source = syntheticFinance();
  const cards = (deniz: number, isbank: number, future: number) => [deniz, 0, isbank, 0, future, deniz + isbank];
  source.daily.rows = [
    ['2098-11-01', 'Dönem başlangıcı', 'Başlangıç', 0, -1200, 0, 1200, 0, ...cards(900, 600, 800), 0, 'Koşullu hesap · Teyitli açılış durumu', 'Teyitli nakit, mevcut rezerv, KMH ve kart açılış borçları', 'opening-finance'],
    ['2098-11-01', 'Birikimden aktarım', 'Birikimden aktarım', 5000, 3800, 3800, 0, 0, ...cards(900, 600, 800), 0, 'Teyitli kaynak · aktarım planı', 'Birikimden aktarım planı', 'transfer-2098-11'],
    ['2098-11-03', 'Örnek abonelik', 'Alışveriş · Taşınma öncesi', -95, 3705, 3705, 0, 0, ...cards(900, 600, 800), 0, 'Koşullu hesap · planlanan hesap günü', 'Nakit · Nakit · Planlanan alım.', 'purchase-subscription'],
    ['2098-11-05', 'İşbank · Okul yemeği', 'Kart alışverişi', 0, 3705, 3705, 0, 0, ...cards(900, 670, 800), 0, 'Koşullu hesap · planlanan hesap günü', 'Finansman motoru · Okul yemek kartı', 'bill-school-meal'],
    ['2098-11-07', 'Etüt (Abla)', 'Nakit hareketi', -140, 3565, 3565, 0, 0, ...cards(900, 670, 800), 0, 'Kullanıcı teyidi', 'Kullanıcı teyidi · her cuma akşamı', 'week-0-etut-1'],
    ['2098-11-10', 'Salon koltuk takımı', 'Alışveriş · Taşınma öncesi', 0, 3565, 3565, 0, 0, ...cards(2700, 670, 2300), 0, 'Koşullu hesap · planlanan hesap günü', 'Kredi kartı · Denizbank · Planlanan alım. Taksit: 6', 'purchase-sofa'],
    ['2098-11-30', 'Ay sonu', 'Ay sonu', 0, 3565, 3565, 0, 0, ...cards(2700, 670, 2300), 0, 'Koşullu hesap', 'Ay sonu kontrolü', 'month-end-2098-11-30'],
  ];
  source.monthly.rows = [['2098-11', 3565, 0, 0, 3370, 2300, 0, 3565 - 3370, 0]];
  source.metadata.rows[3] = [String(source.daily.rows.length)];
  source.metadata.rows[4] = ['1'];
  return source;
}
