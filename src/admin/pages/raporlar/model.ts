// Raporlar saf modeli: dönem seçimi, ay/kalem/oda satırları ve toplamlar. React, antd ve echarts yok; telefon yolu
// bunu doğrudan kullanır. Kurallar (W0 actuals sözleşmesi):
//  - Gerçekleşen yalnız actuals.ts anlamıyla: içinde bulunulan aydan (Europe/Istanbul) sonraki dönem "Henüz yok";
//    oran ve "harcandı" metni yalnız spendLabel'dan (kanıtsız yazılı değer "Kaynakta yazılı", oran yok).
//  - Para kesin: sumMoney (bigint); kayan nokta yok. Birden çok para birimi toplanmaz: MIXED_CURRENCY_TEXT.
//  - Plan ve gerçek asla tek sayıda birleşmez: ayrı toplam, ayrı metin; fark ya da oran burada üretilmez.
//  - Toplanan ölçüler yalnız katalogdaki sahipliği belirlenmiş ölçülerdir (views.pivotMeasures); alımların
//    (purchase_need) böyle bir ölçüsü yok: oda raporu tutar toplamaz, yalnız sayar.
//  - Silinmiş, 'unclassified' ve bilinmeyen basis hiçbir sayıya katılmaz.
import {
  MIXED_CURRENCY_TEXT,
  RECORDED_NOT_YET_TEXT,
  currentPeriod,
  isFuturePeriod,
  mirrorsPlan,
  observationMoney,
  plannedTotal,
  recordedFor,
  recordedTotal,
  spendLabel,
  sumMoney,
  type MoneyTotal,
  type RecordedTotal,
  type SpendLabel,
} from '../../data/actuals';
import type { BudgetObservation, Issue, Money } from '../../data/types';
import type { PivotMeasure } from '../../data/views';
import type { RecordRow } from '../../shell/contracts';
import { BILINMIYOR, formatMoney } from '../../ui/Money';

export { BILINMIYOR };
export const PLAN_YOK = 'Plan yok';
export const HENUZ_YOK = RECORDED_NOT_YET_TEXT;
export const KAYIT_YOK = 'Kayıt yok';

// --- Dönem --------------------------------------------------------------------------------------------------
export const SON_6 = 'son-6';
export const SON_12 = 'son-12';
export const TUM = 'tum';
export const TUM_DONEMLER = 'Tüm dönemler';
const RELATIVE: Readonly<Record<string, { months: number; label: string }>> = {
  [SON_6]: { months: 6, label: 'Son 6 ay' },
  [SON_12]: { months: 12, label: 'Son 12 ay' },
};
const PERIOD_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const YEAR_RE = /^\d{4}$/;

export interface PeriodOption { value: string; label: string }

/** 'YYYY-MM' + delta ay. */
export function shiftPeriod(period: string, delta: number): string {
  const match = PERIOD_RE.exec(period);
  if (!match) throw new RangeError(`Hata: dönem YYYY-MM olmalı (${period}).`);
  const index = Number(match[1]) * 12 + Number(match[2]) - 1 + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** İçinde bulunulan ay dahil son n ay, eskiden yeniye. */
export function lastMonths(current: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => shiftPeriod(current, i - n + 1));
}

const validPeriods = (periods: readonly string[]): string[] => [...new Set(periods.filter((p) => PERIOD_RE.test(p)))].sort();
const yearsOf = (periods: readonly string[]): string[] => [...new Set(validPeriods(periods).map((p) => p.slice(0, 4)))];

/** Son 6 ay · Son 12 ay · verideki yıllar · Tüm dönemler. */
export function periodOptions(dataPeriods: readonly string[]): PeriodOption[] {
  return [
    ...Object.entries(RELATIVE).map(([value, { label }]) => ({ value, label })),
    ...yearsOf(dataPeriods).map((year) => ({ value: year, label: year })),
    { value: TUM, label: TUM_DONEMLER },
  ];
}

export function choiceLabel(choice: string): string {
  return RELATIVE[choice]?.label ?? (choice === TUM ? TUM_DONEMLER : choice);
}

/** Seçimin kapsadığı verideki dönemler, sıralı. */
export function periodsFor(choice: string, dataPeriods: readonly string[], current: string): string[] {
  const periods = validPeriods(dataPeriods);
  const relative = RELATIVE[choice];
  if (relative) {
    const window = new Set(lastMonths(current, relative.months));
    return periods.filter((p) => window.has(p));
  }
  if (YEAR_RE.test(choice)) return periods.filter((p) => p.startsWith(`${choice}-`));
  return periods;
}

/** Son 6 ayda veri varsa Son 6 ay; yoksa verideki son yıl; veri yoksa Tüm dönemler. */
export function defaultPeriodChoice(dataPeriods: readonly string[], current: string): string {
  if (periodsFor(SON_6, dataPeriods, current).length > 0) return SON_6;
  return yearsOf(dataPeriods).at(-1) ?? TUM;
}

// --- Ay adı ve aralık ---------------------------------------------------------------------------------------
const AY_FORMAT = new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const AY_ADI = new Intl.DateTimeFormat('tr-TR', { month: 'long', timeZone: 'UTC' });
const capital = (text: string) => text.charAt(0).toLocaleUpperCase('tr-TR') + text.slice(1);
const asDate = (period: string) => new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)) - 1, 1, 12));

/** "2026-11" → "Kasım 2026"; dönem biçimi tanınmıyorsa olduğu gibi döner. */
export function periodLabel(period: string): string {
  if (!PERIOD_RE.test(period)) return period;
  return capital(AY_FORMAT.format(asDate(period)));
}
const monthName = (period: string) => capital(AY_ADI.format(asDate(period)));

/** "Haziran – Kasım 2026 · Kasım sürüyor"; yıl farklıysa iki uç tam yazılır. */
export function rangeText(periods: readonly string[], current: string): string {
  const sorted = validPeriods(periods);
  if (sorted.length === 0) return '';
  const first = sorted[0]!;
  const last = sorted.at(-1)!;
  let text = first === last ? periodLabel(first)
    : first.slice(0, 4) === last.slice(0, 4) ? `${monthName(first)} – ${periodLabel(last)}`
    : `${periodLabel(first)} – ${periodLabel(last)}`;
  if (sorted.includes(current)) text += ` · ${monthName(current)} sürüyor`;
  return text;
}

// --- Sahiplik -----------------------------------------------------------------------------------------------
export type SumMeasure = Extract<PivotMeasure, { aggregate: 'sum' }>;
export interface OwnedMeasures {
  planned: SumMeasure | undefined;
  recorded: SumMeasure | undefined;
  count: PivotMeasure | undefined;
}

/** Katalogdaki sahipliği belirlenmiş ölçülerden plan ve gerçek toplamı; yoksa undefined (o tutar gösterilmez). */
export function ownedMeasures(measures: readonly PivotMeasure[]): OwnedMeasures {
  const sum = (basis: string) => measures.find((m): m is SumMeasure => m.aggregate === 'sum' && m.basis === basis);
  return { planned: sum('planned'), recorded: sum('recorded_aggregate'), count: measures.find((m) => m.aggregate === 'count') };
}

// --- Toplamlar ----------------------------------------------------------------------------------------------
const isLive = (o: BudgetObservation) => !o.deleted_at;

/** Seçili dönemlerin plan toplamı (yalnız silinmemiş basis 'planned'). */
export function plannedOver(observations: readonly BudgetObservation[], periods: readonly string[]): MoneyTotal {
  const set = new Set(periods);
  return sumMoney(observations.filter((o) => isLive(o) && o.basis === 'planned' && set.has(o.period)).map(observationMoney));
}

/**
 * Seçili dönemlerin Gerçekleşen toplamı: her gözlem recordedFor ile okunur; gelecek dönem sayılmaz. Seçimde
 * gelecek olmayan dönem yoksa "Henüz yok". evidence yalnız sayılan her kayıtta ödeme kanıtı varsa true.
 */
export function recordedOver(observations: readonly BudgetObservation[], periods: readonly string[], today: Date): RecordedTotal {
  const set = new Set(periods);
  if (periods.length > 0 && periods.every((p) => isFuturePeriod(p, today))) return { kind: 'not_yet' };
  const values = observations
    .filter((o) => set.has(o.period))
    .map((o) => recordedFor(o, today))
    .filter((v): v is Extract<NonNullable<typeof v>, { kind: 'recorded' }> => v?.kind === 'recorded');
  const total = sumMoney(values.map((v) => v.money));
  return { kind: 'recorded', money: total.money, evidence: values.length > 0 && values.every((v) => v.evidence), total };
}

/** Gerçekleşen kaydı hiç yoksa spendLabel'a "kayıt yok" (null) gider: "Kaynakta yazılı" uydurulmaz. */
const forLabel = (recorded: RecordedTotal) =>
  recorded.kind === 'recorded' && recorded.total.counted + recorded.total.missing === 0 ? null : recorded;

export function spendOf(planned: MoneyTotal, recorded: RecordedTotal): SpendLabel {
  return spendLabel(planned.money, forLabel(recorded));
}

/** Toplamın gösterimi: tutar (Money) ya da eksik bilginin adı; kısmen okunamayan değer ayrı not. */
export interface TotalDisplay { money: Money; missing: string; note: string | null }

function display(total: MoneyTotal, empty: string): TotalDisplay {
  if (total.currencies.length > 1) return { money: null, missing: MIXED_CURRENCY_TEXT, note: null };
  if (!total.money) return { money: null, missing: total.missing > 0 ? BILINMIYOR : empty, note: null };
  return { money: total.money, missing: empty, note: total.missing > 0 ? `${total.missing} değer okunamadı` : null };
}
const textOf = (d: TotalDisplay): string => (d.money ? `${formatMoney(d.money)}${d.note ? ` · ${d.note}` : ''}` : d.missing);

/** Plan toplamı: tutar | "Birden çok para birimi" | "Bilinmiyor" | "Plan yok". */
export function plannedDisplay(total: MoneyTotal): TotalDisplay {
  return display(total, PLAN_YOK);
}
/** Gerçekleşen: gelecek ya da kayıt yok "Henüz yok"; aksi hâlde tutar | karışık | "Bilinmiyor". */
export function recordedDisplay(total: RecordedTotal): TotalDisplay {
  return total.kind === 'not_yet' ? { money: null, missing: HENUZ_YOK, note: null } : display(total.total, HENUZ_YOK);
}

/** Plan toplamı metni: "₺8.500,00" | "Birden çok para birimi" | "Bilinmiyor" | "Plan yok". */
export function plannedText(total: MoneyTotal): string {
  return textOf(plannedDisplay(total));
}

/** Gerçekleşen metni: gelecek ya da kayıt yok "Henüz yok"; aksi hâlde tutar / karışık / "Bilinmiyor". */
export function recordedText(total: RecordedTotal): string {
  return textOf(recordedDisplay(total));
}

/** CSV için makine biçimi ("8500.00 TRY") ya da eksik bilginin adı. */
export function plannedCsv(total: MoneyTotal): string {
  return total.money && total.missing === 0 ? `${total.money.amount} ${total.money.currency}` : plannedText(total);
}
export function recordedCsv(total: RecordedTotal): string {
  if (total.kind === 'recorded' && total.money && total.total.missing === 0) return `${total.money.amount} ${total.money.currency}`;
  return recordedText(total);
}

/** Grafik için tutar metni (tek para birimi ve eksiksiz); yoksa null (sıfır çizilmez). */
export function chartAmount(total: MoneyTotal | RecordedTotal): string | null {
  if ('kind' in total) return total.kind === 'recorded' ? chartAmount(total.total) : null;
  return total.money && total.missing === 0 ? total.money.amount : null;
}

// --- Ay satırları -------------------------------------------------------------------------------------------
export interface MonthRow {
  key: string;
  period: string;
  label: string;
  planned: MoneyTotal;
  recorded: RecordedTotal;
  spend: SpendLabel;
  /** Silinmemiş plan / Gerçekleşen kaydı sayısı; gelecek ayda Gerçekleşen kaydı sayılmaz (0). */
  planCount: number;
  recordedCount: number;
  current: boolean;
  future: boolean;
  /** Gerçekleşen sekmesi bu ay planı birebir taşıyor (MIRRORS_PLAN_NOTE). */
  mirrors: boolean;
}

function groupByPeriod(observations: readonly BudgetObservation[], periods: readonly string[]): Map<string, BudgetObservation[]> {
  const groups = new Map<string, BudgetObservation[]>(periods.map((p) => [p, []]));
  for (const o of observations) groups.get(o.period)?.push(o);
  return groups;
}

export function monthRows(observations: readonly BudgetObservation[], periods: readonly string[], today: Date): MonthRow[] {
  const groups = groupByPeriod(observations, periods);
  const current = currentPeriod(today);
  return validPeriods(periods).map((period) => {
    const rows = groups.get(period) ?? [];
    const future = isFuturePeriod(period, today);
    const planned = plannedTotal(rows, period);
    const recorded = recordedTotal(rows, period, today);
    const live = rows.filter(isLive);
    return {
      key: period,
      period,
      label: periodLabel(period),
      planned,
      recorded,
      spend: spendOf(planned, recorded),
      planCount: live.filter((o) => o.basis === 'planned').length,
      recordedCount: future ? 0 : live.filter((o) => o.basis === 'recorded_aggregate').length,
      current: period === current,
      future,
      mirrors: !future && mirrorsPlan(rows),
    };
  });
}

// --- Kalem × dönem ------------------------------------------------------------------------------------------
export interface KalemRow {
  key: string;
  label: string;
  /** Dönem → o kalemin o dönemdeki gözlemleri. */
  cells: ReadonlyMap<string, readonly BudgetObservation[]>;
  /** Kalemin seçili dönemlerdeki tüm gözlemleri. */
  all: readonly BudgetObservation[];
  isTotal?: boolean;
}
export const GENEL_TOPLAM = 'Genel toplam';
const trCompare = new Intl.Collator('tr-TR', { numeric: true }).compare;

export function kalemRows(observations: readonly BudgetObservation[], periods: readonly string[]): KalemRow[] {
  const set = new Set(periods);
  const byLabel = new Map<string, { cells: Map<string, BudgetObservation[]>; all: BudgetObservation[] }>();
  const total = { cells: new Map<string, BudgetObservation[]>(), all: [] as BudgetObservation[] };
  for (const o of observations) {
    if (!isLive(o) || !set.has(o.period)) continue;
    const label = o.label?.trim() || BILINMIYOR;
    let item = byLabel.get(label);
    if (!item) byLabel.set(label, (item = { cells: new Map(), all: [] }));
    for (const target of [item, total]) {
      const list = target.cells.get(o.period) ?? [];
      list.push(o);
      target.cells.set(o.period, list);
      target.all.push(o);
    }
  }
  const rows: KalemRow[] = [...byLabel.entries()]
    .sort(([a], [b]) => trCompare(a, b))
    .map(([label, item]) => ({ key: label, label, cells: item.cells, all: item.all }));
  if (rows.length > 0) rows.push({ key: '__toplam', label: GENEL_TOPLAM, cells: total.cells, all: total.all, isTotal: true });
  return rows;
}

export interface MeasureValue {
  text: string;
  csv: string;
  /** Grafik için ondalık metin; değer yoksa ya da ölçü sayımsa null (plan ve gerçek kayıt sayısı tek sayıda birleşmez). */
  amount: string | null;
  /** Toplam ölçüsünde gösterim; sayımda null. */
  display: TotalDisplay | null;
}

/** Plan ve (gelecek olmayan) Gerçekleşen kayıt sayısı; silinmiş kayıt sayılmaz. */
export function recordCounts(observations: readonly BudgetObservation[], today: Date): { plan: number; recorded: number } {
  let plan = 0;
  let recorded = 0;
  for (const o of observations) {
    if (!isLive(o)) continue;
    if (o.basis === 'planned') plan += 1;
    else if (o.basis === 'recorded_aggregate' && !isFuturePeriod(o.period, today)) recorded += 1;
  }
  return { plan, recorded };
}

const NO_RECORD: MeasureValue = { text: KAYIT_YOK, csv: KAYIT_YOK, amount: null, display: null };

/** Bir hücrenin (tek dönem) ya da toplamın (seçili dönemler) ölçü değeri. count: kayıt sayısı. */
export function measureValue(measure: PivotMeasure, observations: readonly BudgetObservation[] | undefined, periods: readonly string[], today: Date): MeasureValue {
  if (!observations || observations.length === 0) return NO_RECORD;
  if (measure.aggregate === 'count') {
    const { plan, recorded } = recordCounts(observations, today);
    const text = `${plan} plan · ${recorded} gerçekleşen`;
    return { text, csv: text, amount: null, display: null };
  }
  if (measure.basis === 'planned') {
    const total = plannedOver(observations, periods);
    return { text: plannedText(total), csv: plannedCsv(total), amount: chartAmount(total), display: plannedDisplay(total) };
  }
  if (measure.basis === 'recorded_aggregate') {
    const total = recordedOver(observations, periods, today);
    return { text: recordedText(total), csv: recordedCsv(total), amount: chartAmount(total), display: recordedDisplay(total) };
  }
  return { text: BILINMIYOR, csv: BILINMIYOR, amount: null, display: null };
}

// --- Oda (alımlar): yalnız sayım -----------------------------------------------------------------------------
export interface RoomRow { key: string; room: string; count: number; withPlanned: number; withActual: number }

/** Alımları odaya göre sayar; tutarı olan kayıtları ayrıca sayar. Tutar toplanmaz (sahipliği belirlenmiş ölçü yok). */
export function roomRows(rows: readonly RecordRow[]): RoomRow[] {
  const byRoom = new Map<string, RoomRow>();
  for (const row of rows) {
    const room = row.room?.trim() || BILINMIYOR;
    let item = byRoom.get(room);
    if (!item) byRoom.set(room, (item = { key: room, room, count: 0, withPlanned: 0, withActual: 0 }));
    item.count += 1;
    if (row.planned) item.withPlanned += 1;
    if (row.actual) item.withActual += 1;
  }
  return [...byRoom.values()].sort((a, b) => (a.room === BILINMIYOR ? 1 : b.room === BILINMIYOR ? -1 : trCompare(a.room, b.room)));
}

// --- Veri güveni --------------------------------------------------------------------------------------------
export interface IssueRow { key: string; code: string; severity: string; count: number }
const SEVERITY_LABEL: Readonly<Record<string, string>> = { review: 'İnceleme' };

export function issueRows(issues: readonly Issue[]): IssueRow[] {
  const byKey = new Map<string, IssueRow>();
  for (const issue of issues) {
    if (issue.deleted_at) continue;
    const code = issue.code || BILINMIYOR;
    const severity = SEVERITY_LABEL[issue.severity] ?? (issue.severity || BILINMIYOR);
    const key = `${code}|${severity}`;
    let item = byKey.get(key);
    if (!item) byKey.set(key, (item = { key, code, severity, count: 0 }));
    item.count += 1;
  }
  return [...byKey.values()].sort((a, b) => b.count - a.count || trCompare(a.code, b.code));
}

// --- CSV ----------------------------------------------------------------------------------------------------
export type CsvRows = readonly (readonly string[])[];

/** Satırları ';' ile ayırır (tr-TR Excel), gerekirse tırnaklar, CRLF ve UTF-8 BOM ile başlar. */
export function toCsv(rows: CsvRows): string {
  const cell = (value: string) => (/[;"\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  return `﻿${rows.map((row) => row.map(cell).join(';')).join('\r\n')}`;
}

/** Dosya adı parçası: "Aylık plan ve gerçek" → "aylik-plan-ve-gercek". */
export function slug(text: string): string {
  const map: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', İ: 'i', Ç: 'c', Ğ: 'g', Ö: 'o', Ş: 's', Ü: 'u' };
  return text
    .replace(/[çğıöşüİÇĞÖŞÜ]/g, (ch) => map[ch] ?? ch)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Dosya adı damgası: İstanbul takvim günü (YYYYAAGG). */
export function dayStamp(today: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(today);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}${get('month')}${get('day')}`;
}

export function monthCsv(rows: readonly MonthRow[], owned: OwnedMeasures): CsvRows {
  const header = ['Ay', ...(owned.planned ? ['Planlanan'] : []), ...(owned.recorded ? ['Gerçekleşen', 'Durum'] : []), 'Plan kaydı', 'Gerçekleşen kaydı'];
  return [
    header,
    ...rows.map((row) => [
      row.label,
      ...(owned.planned ? [plannedCsv(row.planned)] : []),
      ...(owned.recorded ? [recordedCsv(row.recorded), row.spend.text] : []),
      String(row.planCount),
      String(row.recordedCount),
    ]),
  ];
}
