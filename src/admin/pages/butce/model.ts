import type { Tone } from '../../shell/contracts';
import {
  RECORDED_IN_SOURCE_TEXT, RECORDED_NOT_YET_TEXT, currentPeriod, mirrorsPlan, observationMoney, recordedFor, spendLabel, sumMoney,
  type BudgetObservation, type BudgetViewModel, type Money as MoneyValue, type RecordedValue, type SpendLabel,
} from '../../data';

// Bütçe ve nakit sayfasının saf mantığı (React yok, ui yok): telefon temel sunumu ve geniş eğilim modülü (ButceTrend.wide)
// birlikte kullanır. Veri: budget_observations hücre gözlemleridir; muhasebe kaydı ya da toplanabilir toplam DEĞİLDİR.
//   - Plan (basis planned) ve gerçek (recorded_aggregate) ayrı alanlardır; asla tek sayıda birleşmez.
//   - Gerçekleşen anlamı yalnız data/actuals.ts'ten: recordedFor (içinde bulunulan aydan — Europe/Istanbul — sonraki dönem
//     "Henüz yok"; kayıt ödeme olayı değil kaynak gözlemidir), spendLabel (oran ve "harcandı" yalnız payment_evidence true
//     iken; kanıtsız "Kaynakta yazılı"), mirrorsPlan (Gerçekleşen sekmesi planın aynası mı). Sayfa oran hesaplamaz.
//   - Fark = Planlanan − Gerçekleşen, yalnız Gerçekleşen ödeme kanıtı taşırken (recorded.evidence true; ürün kararı r4)
//     ve iki taraf da bilinen (gelecek değil, okunabilir), aynı para biriminde iken; kesin ondalık (sumMoney, bigint).
//     Kanıtsız ("Kaynakta yazılı") değer harcama sayılmaz: Fark "Hesaplanmadı", "aşıldı" yorumu yok. Yinelenen gözlem
//     (aynı etiket + dönem + basis) toplanmaz: değer "Bilinmiyor".
//   - Durum: "Tamamlandı" / "Aşıldı" / "Sınıra yakın" / "Planda" yalnız kanıtlı Gerçekleşende; kanıtsızken "Kaynakta yazılı".
//   - Sahiplik (ara toplam / kalem) nesilde yoktur; yalnız canlı Sheet eşlemesinden (groups / categories) gelir.

export type Ownership = 'leaf' | 'subtotal' | 'unknown';

export interface BudgetRow {
  /** Satır anahtarı (ResponsiveTable `key`): etiket. */
  key: string;
  label: string;
  period: string;
  planned: MoneyValue;
  /** Gösterilen Gerçekleşen tutarı: yalnız kayıt gelecek dönemde değilse ve okunabiliyorsa; aksi null. */
  actual: MoneyValue;
  /** actuals.ts anlamı: null = Gerçekleşen kaydı yok (ya da yinelenen); not_yet = gelecek dönem; recorded = kaynakta yazılı. */
  recorded: RecordedValue | null;
  /**
   * Kaynaktaki Gerçekleşen değeri (gelecek dönem dahil). Yalnız nesil ile canlı Sheet karşılaştırması içindir; ekranda
   * gösterilmez, toplanmaz.
   */
  sourceActual: MoneyValue;
  /**
   * planned − actual; yalnız Gerçekleşen ödeme kanıtı taşırken. Kanıtsızsa, biri bilinmiyorsa, gelecek dönemse ya da para
   * birimi farklıysa null ("Hesaplanmadı").
   */
  difference: MoneyValue;
  /** Aynı etiket/dönem/basis için birden çok gözlem: toplanmaz, değer bilinmiyor. */
  plannedAmbiguous: boolean;
  actualAmbiguous: boolean;
  /** Plan gözlemi var ama değeri okunamıyor (null ya da bozuk ondalık): "Fiyat yok" değil "Bilinmiyor". */
  plannedUnreadable: boolean;
  /** basis 'unclassified' gözlem sayısı (ne plan ne gerçek sayılır). */
  unclassified: number;
  ownership: Ownership;
  /** Ara toplam satırının etiketi (canlı eşlemeden); yoksa null. */
  parent: string | null;
  status: { label: string; tone: Tone };
  /** spendLabel: "%N harcandı" / "Harcandı" yalnız kanıtlı Gerçekleşende; aksi "Kaynakta yazılı" ya da "Henüz yok". */
  spend: SpendLabel;
}

/** Geniş eğilim modülünün (butce/ButceTrend.wide.tsx) girdisi; tür burada durur ki sayfa geniş modülü statik içe aktarmasın. */
export interface ButceTrendProps {
  observations: readonly BudgetObservation[];
  periods: readonly string[];
  label: string;
  today: Date;
}

export interface TrendPoint {
  period: string;
  /** Yinelenen ya da okunamayan plan gözleminde null (plannedUnknown true). */
  planned: MoneyValue;
  /** Plan gözlemi var ama değer bilinmiyor (yinelenen ya da okunamayan): "Bilinmiyor". */
  plannedUnknown: boolean;
  /** Gerçekleşen anlamı (BudgetRow.recorded ile aynı); yinelenen gözlemde null ve actualUnknown true. */
  recorded: RecordedValue | null;
  actualUnknown: boolean;
}

/** Gerçekleşen planın bu oranına (spendLabel yüzdesi) ulaştıysa "Sınıra yakın" (bundle.js Butce). */
const NEAR_LIMIT_PERCENT = 90;
export const BILINMIYOR = 'Bilinmiyor';
export const HESAPLANMADI = 'Hesaplanmadı';

const ayBicimi = new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const kisaAyBicimi = new Intl.DateTimeFormat('tr-TR', { month: 'short', year: 'numeric', timeZone: 'UTC' });

const PERIOD_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
function periodDate(period: string): Date | null {
  const match = PERIOD_RE.exec(period);
  return match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1, 12)) : null;
}

/** "2026-11" → "Kasım 2026"; biçimsiz dönem olduğu gibi döner. */
export function periodLabel(period: string): string {
  const date = periodDate(period);
  return date ? ayBicimi.format(date) : period;
}
/** "2026-11" → "Kas 2026" (grafik ekseni). */
export function shortPeriodLabel(period: string): string {
  const date = periodDate(period);
  return date ? kisaAyBicimi.format(date) : period;
}

/**
 * İçinde bulunulan ay (Europe/Istanbul, actuals.currentPeriod) varsa o; yoksa bugünden önceki son dönem; hiçbiri yoksa ilk
 * dönem; dönem yoksa null.
 */
export function defaultPeriod(periods: readonly string[], now: Date): string | null {
  if (!periods.length) return null;
  const sorted = [...periods].sort();
  const current = currentPeriod(now);
  if (sorted.includes(current)) return current;
  const past = sorted.filter(period => period < current);
  return past.length ? past[past.length - 1]! : sorted[0]!;
}

// --- Fark (kesin ondalık: actuals.sumMoney) --------------------------------------------------------------------
const negate = (money: NonNullable<MoneyValue>): NonNullable<MoneyValue> => {
  const amount = money.amount.trim();
  return { amount: amount.startsWith('-') ? amount.slice(1) : `-${amount}`, currency: money.currency };
};

/** planned − actual; iki değer de okunabilir ve aynı para biriminde değilse null. */
function difference(planned: MoneyValue, actual: MoneyValue): MoneyValue {
  if (!planned || !actual) return null;
  const total = sumMoney([planned, negate(actual)]);
  return total.missing === 0 && total.counted === 2 ? total.money : null;
}

const isNegative = (money: NonNullable<MoneyValue>) => /^-/.test(money.amount) && !/^-0+(\.0+)?$/.test(money.amount);
const isZero = (money: NonNullable<MoneyValue>) => /^-?0+(\.0+)?$/.test(money.amount);

function statusOf(row: Pick<BudgetRow, 'planned' | 'recorded' | 'difference' | 'spend'>, ambiguous: boolean): BudgetRow['status'] {
  const { planned, recorded, difference: diff, spend } = row;
  if (ambiguous) return { label: BILINMIYOR, tone: 'uyari' };
  if (!recorded || recorded.kind === 'not_yet') return { label: RECORDED_NOT_YET_TEXT, tone: 'notr' };
  if (!recorded.money) return { label: BILINMIYOR, tone: 'uyari' };
  if (!recorded.evidence) return { label: RECORDED_IN_SOURCE_TEXT, tone: 'bilgi' };
  if (!planned) return { label: 'Plan yok', tone: 'uyari' };
  if (!diff) return { label: BILINMIYOR, tone: 'uyari' };
  if (isNegative(diff)) return { label: 'Aşıldı', tone: 'hata' };
  if (isZero(diff)) return { label: 'Tamamlandı', tone: 'olumlu' };
  if (spend.percent !== null && spend.percent >= NEAR_LIMIT_PERCENT) return { label: 'Sınıra yakın', tone: 'uyari' };
  return { label: 'Planda', tone: 'notr' };
}

// --- Sahiplik eşlemesi (canlı Sheet) ----------------------------------------------------------------------
interface OwnershipMap { subtotals: Set<string>; parents: Map<string, string> }
const fold = (text: string) => text.trim().toLocaleLowerCase('tr-TR');
const collator = new Intl.Collator('tr-TR', { numeric: true, sensitivity: 'base' });
function ownershipMap(live: BudgetViewModel | null): OwnershipMap | null {
  if (!live) return null;
  const subtotals = new Set(live.groups.map(group => fold(group.label)));
  const parents = new Map(live.categories.map(category => [fold(category.label), category.group] as const));
  return { subtotals, parents };
}

interface Side { observation: BudgetObservation | null; count: number }
const EMPTY_SIDE: Side = { observation: null, count: 0 };
const addSide = (side: Side, observation: BudgetObservation): Side => ({ observation: side.count === 0 ? observation : null, count: side.count + 1 });

/**
 * Dönemin gözlemlerini etiket satırlarına çevirir; plan ve gerçek ayrı, yinelenen toplanmaz, ağaç sırası sahiplikten.
 * `today` Gerçekleşen anlamı içindir (gelecek dönem "Henüz yok"); verilmezse şimdiki an.
 */
export function budgetRowsFor(observations: readonly BudgetObservation[], period: string, live: BudgetViewModel | null, today: Date = new Date()): BudgetRow[] {
  const map = ownershipMap(live);
  const byLabel = new Map<string, { planned: Side; actual: Side; unclassified: number }>();
  for (const observation of observations) {
    if (observation.period !== period || observation.deleted_at) continue;
    const label = observation.label.trim();
    if (!label) continue;
    const entry = byLabel.get(label) ?? { planned: EMPTY_SIDE, actual: EMPTY_SIDE, unclassified: 0 };
    if (observation.basis === 'planned') entry.planned = addSide(entry.planned, observation);
    else if (observation.basis === 'recorded_aggregate') entry.actual = addSide(entry.actual, observation);
    else entry.unclassified += 1;
    byLabel.set(label, entry);
  }

  const rows: BudgetRow[] = [];
  for (const [label, entry] of byLabel) {
    const plannedAmbiguous = entry.planned.count > 1;
    const actualAmbiguous = entry.actual.count > 1;
    const planned = entry.planned.observation ? observationMoney(entry.planned.observation) : null;
    const plannedUnreadable = Boolean(entry.planned.observation) && planned === null;
    const recorded = entry.actual.observation ? recordedFor(entry.actual.observation, today) : null;
    const sourceActual = entry.actual.observation ? observationMoney(entry.actual.observation) : null;
    const actual = recorded?.kind === 'recorded' ? recorded.money : null;
    // Fark yalnız ödeme kanıtıyla: kaynakta yazılı değer harcama değildir; ondan "kalem aşıldı" sonucu çıkarılmaz.
    const evidenced = recorded?.kind === 'recorded' && recorded.evidence;
    const diff = plannedAmbiguous || actualAmbiguous || !evidenced ? null : difference(planned, actual);
    const spend = spendLabel(planned ?? undefined, recorded);
    const key = fold(label);
    let ownership: Ownership = 'unknown';
    let parent: string | null = null;
    if (map) {
      if (map.subtotals.has(key)) ownership = 'subtotal';
      else if (map.parents.has(key)) {
        ownership = 'leaf';
        const group = map.parents.get(key)!.trim();
        parent = group || null;
      }
    }
    const row = {
      key: label, label, period, planned, actual, recorded, sourceActual, difference: diff,
      plannedAmbiguous, actualAmbiguous, plannedUnreadable, unclassified: entry.unclassified, ownership, parent, spend,
    };
    rows.push({ ...row, status: statusOf(row, plannedAmbiguous || actualAmbiguous) });
  }

  // Kararlı sıra: etiket (tr-TR, sayı duyarlı); kaynak sırası hücre kimliğine göre olduğu için anlamsızdır.
  rows.sort((a, b) => collator.compare(a.label, b.label));
  if (!map) return rows;
  // Ağaç sırası: ara toplam satırı, hemen ardından çocukları (kaynak sırası korunur); ebeveynsiz satırlar yerinde kalır.
  const byFold = new Map(rows.map(row => [fold(row.label), row] as const));
  const placed = new Set<string>();
  const ordered: BudgetRow[] = [];
  for (const row of rows) {
    if (placed.has(row.key)) continue;
    if (row.parent && byFold.has(fold(row.parent)) && !placed.has(byFold.get(fold(row.parent))!.key)) continue; // ebeveyn gelince
    ordered.push(row);
    placed.add(row.key);
    if (row.ownership === 'subtotal') {
      for (const child of rows) {
        if (!placed.has(child.key) && child.parent && fold(child.parent) === fold(row.label)) { ordered.push(child); placed.add(child.key); }
      }
    }
  }
  for (const row of rows) if (!placed.has(row.key)) { ordered.push(row); placed.add(row.key); }
  return ordered;
}

/** Dönemin Gerçekleşen değerleri planın aynası mı (actuals.mirrorsPlan; yalnız o dönemin gözlemleri). */
export function periodMirrorsPlan(observations: readonly BudgetObservation[], period: string): boolean {
  return mirrorsPlan(observations.filter(observation => observation.period === period));
}

const sameMoney = (a: MoneyValue | undefined, b: MoneyValue | undefined): boolean => {
  if (!a && !b) return true;
  if (!a || !b) return false;
  const total = sumMoney([a, negate(b)]);
  return total.missing === 0 && total.counted === 2 && total.money !== null && isZero(total.money);
};

/**
 * Seçili dönemde nesil satırları ile canlı satırlar (categories + groups) arasında tutarı farklı ya da tek tarafta olan
 * etiket sayısı. Kaynak değerleri karşılaştırılır (gelecek dönemin Gerçekleşen değeri de; ekranda "Henüz yok" olsa bile).
 */
export function compareWithLive(rows: readonly BudgetRow[], live: BudgetViewModel | null, period: string): number {
  if (!live) return 0;
  const liveByLabel = new Map<string, { planned: MoneyValue; actual: MoneyValue }>();
  for (const line of [...live.groups, ...live.categories]) {
    liveByLabel.set(fold(line.label), { planned: line.planned[period] ?? null, actual: line.actual[period] ?? null });
  }
  let differing = 0;
  const seen = new Set<string>();
  for (const row of rows) {
    const key = fold(row.label);
    seen.add(key);
    const other = liveByLabel.get(key);
    if (!other) { differing += 1; continue; }
    if (!sameMoney(row.planned, other.planned) || !sameMoney(row.sourceActual, other.actual)) differing += 1;
  }
  for (const key of liveByLabel.keys()) if (!seen.has(key)) differing += 1;
  return differing;
}

/** Bir kalemin dönem dönem plan ve Gerçekleşen anlamı (toplama yok; her nokta o dönemin tek gözlemi). */
export function trendPoints(observations: readonly BudgetObservation[], periods: readonly string[], label: string, today: Date): TrendPoint[] {
  const own = observations.filter(observation => observation.label.trim() === label);
  return periods.map(period => {
    const row = budgetRowsFor(own, period, null, today)[0];
    return {
      period,
      planned: row && !row.plannedAmbiguous ? row.planned : null,
      plannedUnknown: Boolean(row && (row.plannedAmbiguous || row.plannedUnreadable)),
      recorded: row && !row.actualAmbiguous ? row.recorded : null,
      actualUnknown: row?.actualAmbiguous ?? false,
    };
  });
}
