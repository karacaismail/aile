// Raporlar saf modeli: dönem seçimi, ay/kalem/oda satırları ve sayımlar. React, antd ve echarts yok; telefon yolu
// bunu doğrudan kullanır. Kurallar (W0 actuals sözleşmesi):
//  - Gerçekleşen yalnız actuals.ts anlamıyla: içinde bulunulan aydan (Europe/Istanbul) sonraki dönem "Henüz yok";
//    "harcandı" metni yalnız spendLabel'dan (kanıtsız yazılı değer "Kaynakta yazılı").
//  - Bütçe gözlemleri toplanmaz: satırlar yaprak gider kalemlerinin yanında gelir, ara toplam ("… toplamı"), genel
//    toplam ("Toplam …") ve adet satırlarını da taşır; nesilde satır düzeyinde yaprak sahipliği haritası yok
//    (views.pivotMeasures yalnız sayım verir). Tutar yerine TOTAL_UNAVAILABLE_TEXT ("Toplam kullanılamaz") ve nedeni
//    (views.sumUnavailableReason) yazılır; oran üretilmez (oran plan ve gerçek toplamı ister). Kayıtlar sayılır.
//  - Plan ve gerçek asla tek sayıda birleşmez: plan ve Gerçekleşen kaydı ayrı sayılır, ayrı metin.
//  - Alımların (purchase_need) sahipliği belirlenmiş ölçüsü yok: oda raporu tutar toplamaz, yalnız sayar.
//  - Silinmiş, 'unclassified' ve bilinmeyen basis hiçbir sayıya katılmaz.
import {
  RECORDED_NOT_YET_TEXT,
  currentPeriod,
  isFuturePeriod,
  mirrorsPlan,
  recordedFor,
  spendLabel,
  type RecordedValue,
  type SpendLabel,
} from '../../data/actuals';
import { toCsv, type CsvRows } from '../../data/csv';
import type { BudgetObservation, Issue } from '../../data/types';
import { TOTAL_UNAVAILABLE_TEXT, type PivotMeasure } from '../../data/views';
import type { RecordRow } from '../../shell/contracts';
import { BILINMIYOR } from '../../ui/Money';

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

// --- Ay satırları -------------------------------------------------------------------------------------------
const isLive = (o: BudgetObservation) => !o.deleted_at;
type Recorded = Extract<RecordedValue, { kind: 'recorded' }>;

/**
 * Gözlemlerin Gerçekleşen durumu tutar toplamadan: seçimde gelecek olmayan dönem yoksa "Henüz yok"; gelecek olmayan
 * dönemde canlı Gerçekleşen kaydı yoksa "Henüz yok"; varsa "Kaynakta yazılı" (kanıtsız) ya da "Harcandı" (her kayıt
 * kanıtlı). Oran yok: oran plan ve gerçek toplamı ister.
 */
function recordedStatus(observations: readonly BudgetObservation[], periods: readonly string[], today: Date): SpendLabel {
  if (periods.length > 0 && periods.every((p) => isFuturePeriod(p, today))) return spendLabel(undefined, { kind: 'not_yet' });
  const set = new Set(periods);
  const values = observations
    .filter((o) => set.has(o.period))
    .map((o) => recordedFor(o, today))
    .filter((v): v is Recorded => v?.kind === 'recorded');
  if (values.length === 0) return spendLabel(undefined, null);
  return spendLabel(undefined, { kind: 'recorded', money: null, evidence: values.every((v) => v.evidence) });
}

export interface MonthRow {
  key: string;
  period: string;
  label: string;
  /** Durum metni (Henüz yok / Kaynakta yazılı / Harcandı); oran yok. */
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
    const live = rows.filter(isLive);
    return {
      key: period,
      period,
      label: periodLabel(period),
      spend: recordedStatus(rows, [period], today),
      planCount: live.filter((o) => o.basis === 'planned').length,
      recordedCount: future ? 0 : live.filter((o) => o.basis === 'recorded_aggregate').length,
      current: period === current,
      future,
      mirrors: !future && mirrorsPlan(rows),
    };
  });
}

/** Ayın Planlanan hücresi: plan kaydı yoksa "Plan yok"; varsa "Toplam kullanılamaz" (satırlar toplanmaz). */
export const monthPlannedText = (row: MonthRow): string => (row.planCount > 0 ? TOTAL_UNAVAILABLE_TEXT : PLAN_YOK);
/** Ayın Gerçekleşen hücresi: gelecek ay ya da kayıt yoksa "Henüz yok"; varsa "Toplam kullanılamaz". */
export const monthRecordedText = (row: MonthRow): string => (row.future || row.recordedCount === 0 ? HENUZ_YOK : TOTAL_UNAVAILABLE_TEXT);

/** Özet "Planlanan": seçimde plan kaydı varsa "Toplam kullanılamaz", yoksa "Plan yok". */
export function summaryPlannedText(observations: readonly BudgetObservation[]): string {
  return observations.some((o) => isLive(o) && o.basis === 'planned') ? TOTAL_UNAVAILABLE_TEXT : PLAN_YOK;
}
/** Özet "Gerçekleşen": seçim yalnız gelecekteyse ya da kayıt yoksa "Henüz yok"; varsa "Toplam kullanılamaz". */
export function summaryRecordedText(observations: readonly BudgetObservation[], periods: readonly string[], today: Date): string {
  return recordedStatus(observations, periods, today).kind === 'not_yet' ? HENUZ_YOK : TOTAL_UNAVAILABLE_TEXT;
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
  /** Grafik için ondalık metin; bütçe gözlemleri toplanmadığından her zaman null (sayım grafiği recordCounts'tan). */
  amount: string | null;
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

const NO_RECORD: MeasureValue = { text: KAYIT_YOK, csv: KAYIT_YOK, amount: null };
const NO_TOTAL: MeasureValue = { text: TOTAL_UNAVAILABLE_TEXT, csv: TOTAL_UNAVAILABLE_TEXT, amount: null };

/**
 * Bir hücrenin (tek dönem) ya da satır toplamının (seçili dönemler) ölçü değeri. count: kayıt sayısı. Toplam ölçüsü
 * (views bugün üretmez) satır düzeyinde yaprak sahipliği olmadan tutar üretmez: "Toplam kullanılamaz".
 */
export function measureValue(measure: PivotMeasure, observations: readonly BudgetObservation[] | undefined, _periods: readonly string[], today: Date): MeasureValue {
  if (!observations || observations.length === 0) return NO_RECORD;
  if (measure.aggregate !== 'count') return NO_TOTAL;
  const { plan, recorded } = recordCounts(observations, today);
  const text = `${plan} plan · ${recorded} gerçekleşen`;
  return { text, csv: text, amount: null };
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
// Ortak yardımcı (data/csv): ';' ayırıcı, CRLF, BOM; formül başlangıcı ("=", "+", "-", "@", TAB, CR) metne çevrilir.
export { toCsv, type CsvRows };

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

/** Aylık raporun CSV'si: tutar yerine eksik toplamın adı, durum ve kayıt sayıları ayrı sütunlarda. */
export function monthCsv(rows: readonly MonthRow[]): CsvRows {
  return [
    ['Ay', 'Planlanan', 'Gerçekleşen', 'Durum', 'Plan kaydı', 'Gerçekleşen kaydı'],
    ...rows.map((row) => [row.label, monthPlannedText(row), monthRecordedText(row), row.spend.text, String(row.planCount), String(row.recordedCount)]),
  ];
}
