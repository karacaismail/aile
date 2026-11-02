// Bütçe "Gerçekleşen" anlamının tek kaynağı. Saf TS: React/antd yok; sayfalar (Genel, Bütçe, Raporlar) ve ui/Overview
// gerçekleşen tutarı, oranı ve "harcandı" metnini yalnız buradan alır.
//
// Veri gerçeği (data-platform/normalize.mjs, postgres-mapping.json): budget_observations hücre gözlemidir; ödeme ya da
// muhasebe kaydı değildir. basis 'planned' Plan sekmesinden, 'recorded_aggregate' Gerçekleşen sekmesinden gelir;
// payment_evidence üreticide her zaman false'tur. Gerçekleşen sekmesi gelecek aylarda bile plan değerlerini taşıyabilir.
// Bu yüzden:
//   - İçinde bulunulan aydan (Europe/Istanbul) sonraki dönemin Gerçekleşen kaydı gösterilmez: "Henüz yok".
//   - Oran ve "harcandı" metni yalnız payment_evidence === true iken üretilir; aksi halde "Kaynakta yazılı" (oran yok).
//   - Gerçekleşen aylık toplamları kaynak gözlemi olarak kalır, ödeme olayına çevrilmez.
//   - 'unclassified' ve bilinmeyen basis hiçbir sayıya katılmaz (data/views.sums.ts ve views.pivotMeasures ile aynı kural); silinmiş kayıt da.
//   - Plan ve gerçek asla tek sayıda birleşmez; toplamlar basis başına ayrıdır.
// Para veri platformunun Money zarfıdır (metin ondalık + ISO 4217). Aritmetik bigint ile kesindir (kayan nokta yok,
// yuvarlama yok); farklı para birimleri toplanmaz. Ara toplam/yaprak sahipliği nesilde yoktur: toplamı hangi satırlar
// üzerinden alacağına çağıran karar verir.
import type { BudgetObservation, Money } from './types';

export const BUDGET_TIME_ZONE = 'Europe/Istanbul';
/** Bütçe kaynağı TL çalışma kitabıdır; hücre biçimi para birimini işaretlemediyse (currency null) birim budur. */
export const BUDGET_DEFAULT_CURRENCY = 'TRY';

/** Gelecek ay ya da Gerçekleşen kaydı yok. */
export const RECORDED_NOT_YET_TEXT = 'Henüz yok';
/** Gerçekleşen sekmesinde yazılı, ödeme kanıtı yok: oran ve "harcandı" üretilmez. */
export const RECORDED_IN_SOURCE_TEXT = 'Kaynakta yazılı';
/** Ödeme kanıtı var ama oran hesaplanamıyor (plan yok/sıfır, birim farklı, tutar okunamadı). */
export const SPENT_TEXT = 'Harcandı';
/** mirrorsPlan true iken UI notu. */
export const MIRRORS_PLAN_NOTE = 'Gerçekleşen sekmesi bu ay plan değerlerini taşıyor; ödeme kanıtı yok.';
/** sumMoney birden çok para birimi gördüğünde (money null, currencies.length > 1). */
export const MIXED_CURRENCY_TEXT = 'Birden çok para birimi';

/** Bir Gerçekleşen gözleminin anlamı. money null → değer okunamadı (UI "Bilinmiyor"). */
export type RecordedValue =
  | { kind: 'not_yet' }
  | { kind: 'recorded'; money: Money; evidence: boolean };

/** Tek para biriminde kesin toplam. money null: hiç değer yok ya da birimler karışık (currencies.length > 1). */
export interface MoneyTotal {
  money: Money;
  /** Toplamaya giren değer sayısı. */
  counted: number;
  /** null ya da bozuk ondalık; toplamaya girmedi. */
  missing: number;
  /** Görülen para birimleri, alfabetik. */
  currencies: readonly string[];
}

/** Dönemin Gerçekleşen toplamı; evidence yalnız dönemdeki her Gerçekleşen kaydında kanıt varsa true. */
export type RecordedTotal =
  | { kind: 'not_yet' }
  | { kind: 'recorded'; money: Money; evidence: boolean; total: MoneyTotal };

export type SpendLabel =
  | { kind: 'not_yet'; percent: null; text: string }
  | { kind: 'in_source'; percent: null; text: string }
  | { kind: 'spent'; percent: number | null; text: string };

// --- Dönem (Europe/Istanbul) --------------------------------------------------------------------------------
const PERIOD_RE = /^[0-9]{4}-(0[1-9]|1[0-2])$/;
const periodFormat = new Intl.DateTimeFormat('en-CA', { timeZone: BUDGET_TIME_ZONE, year: 'numeric', month: '2-digit' });

/** 'YYYY-MM': `today` anının İstanbul takvimindeki ayı (31 Ekim 23:30 UTC → '2026-11'). Geçersiz tarih RangeError. */
export function currentPeriod(today: Date): string {
  if (!(today instanceof Date) || Number.isNaN(today.getTime())) throw new RangeError('Hata: geçerli bir tarih gerekiyor; dönem uydurulmaz.');
  const parts = periodFormat.formatToParts(today);
  const year = parts.find(part => part.type === 'year')?.value;
  const month = parts.find(part => part.type === 'month')?.value;
  const period = `${year ?? ''}-${month ?? ''}`;
  if (!PERIOD_RE.test(period)) throw new RangeError(`Hata: dönem okunamadı (${period}).`);
  return period;
}

/** 'YYYY-MM' dönemi içinde bulunulan aydan sonra mı (İstanbul). */
export function isFuturePeriod(period: string, today: Date): boolean {
  return period > currentPeriod(today);
}

// --- Kesin ondalık (bigint) ---------------------------------------------------------------------------------
const DECIMAL_RE = /^(-?)([0-9]+)(?:\.([0-9]+))?$/;
const MIN_SCALE = 2;
interface Fixed { units: bigint; scale: number }

function parseDecimal(text: string): Fixed | null {
  const match = DECIMAL_RE.exec(text.trim());
  if (!match) return null;
  const [, sign, whole, fraction = ''] = match;
  const units = BigInt(`${whole}${fraction}`);
  return { units: sign ? -units : units, scale: fraction.length };
}
const rescale = (value: Fixed, scale: number): bigint => value.units * 10n ** BigInt(scale - value.scale);
function formatFixed({ units, scale }: Fixed): string {
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString().padStart(scale + 1, '0');
  const whole = digits.slice(0, digits.length - scale);
  const fraction = digits.slice(digits.length - scale);
  return `${negative ? '-' : ''}${whole}${scale > 0 ? `.${fraction}` : ''}`;
}
const currencyOf = (money: NonNullable<Money>): string => money.currency.trim().toUpperCase();

/** Aynı para birimi ve sayısal olarak eşit ("8500" = "8500.00"). */
function sameMoney(a: Money, b: Money): boolean {
  if (!a || !b || currencyOf(a) !== currencyOf(b)) return false;
  const x = parseDecimal(a.amount);
  const y = parseDecimal(b.amount);
  if (!x || !y) return false;
  const scale = Math.max(x.scale, y.scale);
  return rescale(x, scale) === rescale(y, scale);
}

// --- Gözlem okuyucular --------------------------------------------------------------------------------------
/** Gözlemin para zarfı; değer yoksa ya da ondalık bozuksa null (sıfır değil). */
export function observationMoney(observation: BudgetObservation): Money {
  const decimal = observation.value?.decimal;
  if (typeof decimal !== 'string' || !parseDecimal(decimal)) return null;
  const currency = observation.value.currency?.trim().toUpperCase();
  return { amount: decimal.trim(), currency: currency || BUDGET_DEFAULT_CURRENCY };
}

const isLive = (observation: BudgetObservation): boolean => !observation.deleted_at;
const isRecorded = (observation: BudgetObservation): boolean =>
  isLive(observation) && observation.basis === 'recorded_aggregate' && PERIOD_RE.test(observation.period);
const hasEvidence = (observation: BudgetObservation): boolean => observation.payment_evidence === true;

/**
 * Gerçekleşen gözleminin anlamı. Silinmiş, basis'i 'recorded_aggregate' olmayan (planned, unclassified, bilinmeyen)
 * ya da dönemi YYYY-MM olmayan kayıt Gerçekleşen değildir: null.
 */
export function recordedFor(observation: BudgetObservation, today: Date): RecordedValue | null {
  if (!isRecorded(observation)) return null;
  if (isFuturePeriod(observation.period, today)) return { kind: 'not_yet' };
  return { kind: 'recorded', money: observationMoney(observation), evidence: hasEvidence(observation) };
}

// --- Oran ve etiket -----------------------------------------------------------------------------------------
const percentFormat = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });

/** round(gerçek / plan × 100), yarım sıfırdan uzağa; plan yok/≤0, birim farklı ya da tutar okunamazsa null. */
function spentPercent(planned: Money | undefined, actual: Money): number | null {
  if (!planned || !actual || currencyOf(planned) !== currencyOf(actual)) return null;
  const plan = parseDecimal(planned.amount);
  const real = parseDecimal(actual.amount);
  if (!plan || !real) return null;
  const scale = Math.max(plan.scale, real.scale);
  const p = rescale(plan, scale);
  const r = rescale(real, scale);
  if (p <= 0n) return null;
  return Number((r * 200n + (r < 0n ? -p : p)) / (2n * p));
}

/**
 * Plan ile Gerçekleşen arasındaki etiket. Oran ve "%N harcandı" yalnız evidence true iken; kanıtsız yazılı değer
 * "Kaynakta yazılı" (oran yok); gelecek ay ya da kayıt yoksa "Henüz yok". RecordedTotal da kabul edilir.
 */
export function spendLabel(planned: Money | undefined, recorded: RecordedValue | null | undefined): SpendLabel {
  if (!recorded || recorded.kind === 'not_yet') return { kind: 'not_yet', percent: null, text: RECORDED_NOT_YET_TEXT };
  if (recorded.evidence !== true) return { kind: 'in_source', percent: null, text: RECORDED_IN_SOURCE_TEXT };
  const percent = spentPercent(planned, recorded.money);
  if (percent === null) return { kind: 'spent', percent: null, text: SPENT_TEXT };
  return { kind: 'spent', percent, text: `%${percentFormat.format(percent)} harcandı` };
}

// --- Plan aynası --------------------------------------------------------------------------------------------
const labelKey = (observation: BudgetObservation): string => `${observation.period}\u0000${observation.label.trim()}`;

/**
 * Gerçekleşen değerleri planın kopyası mı: her Gerçekleşen kaydı aynı dönem + etiketteki bir plan değerine (aynı para
 * birimi, sayısal eşit) birebir eşlenir ve hiçbirinde ödeme kanıtı yoksa true. Aynı etiketli satırlar çoklu küme
 * olarak eşlenir. Gerçekleşen kaydı yoksa, planı olmayan etiket ya da okunamayan değer varsa false. Plandaki fazla
 * etiketler aynayı bozmaz. Silinmiş, unclassified ve bilinmeyen basis karşılaştırmaya girmez.
 */
export function mirrorsPlan(periodObservations: readonly BudgetObservation[]): boolean {
  const plans = new Map<string, Money[]>();
  const recorded: BudgetObservation[] = [];
  for (const observation of periodObservations) {
    if (!isLive(observation)) continue;
    if (observation.basis === 'planned') {
      const key = labelKey(observation);
      const list = plans.get(key) ?? [];
      list.push(observationMoney(observation));
      plans.set(key, list);
    } else if (observation.basis === 'recorded_aggregate') {
      recorded.push(observation);
    }
  }
  if (recorded.length === 0) return false;
  for (const observation of recorded) {
    if (hasEvidence(observation)) return false;
    const money = observationMoney(observation);
    const candidates = plans.get(labelKey(observation));
    if (!money || !candidates) return false;
    const index = candidates.findIndex(candidate => sameMoney(candidate, money));
    if (index < 0) return false;
    candidates.splice(index, 1);
  }
  return true;
}

// --- Toplamlar ----------------------------------------------------------------------------------------------
/** Para birimi başına kesin toplam; tek birim varsa money, aksi halde null. Sonuç en az iki ondalık taşır. */
export function sumMoney(values: readonly (Money | undefined)[]): MoneyTotal {
  const byCurrency = new Map<string, Fixed>();
  let counted = 0;
  let missing = 0;
  for (const value of values) {
    const parsed = value ? parseDecimal(value.amount) : null;
    const currency = value ? currencyOf(value) : '';
    if (!parsed || !currency) {
      missing += 1;
      continue;
    }
    counted += 1;
    const acc = byCurrency.get(currency) ?? { units: 0n, scale: MIN_SCALE };
    const scale = Math.max(acc.scale, parsed.scale);
    byCurrency.set(currency, { units: rescale(acc, scale) + rescale(parsed, scale), scale });
  }
  const currencies = [...byCurrency.keys()].sort();
  if (currencies.length !== 1) return { money: null, counted, missing, currencies };
  const currency = currencies[0]!;
  return { money: { amount: formatFixed(byCurrency.get(currency)!), currency }, counted, missing, currencies };
}

/** Dönemin plan toplamı: yalnız silinmemiş basis 'planned' kayıtlar. */
export function plannedTotal(observations: readonly BudgetObservation[], period: string): MoneyTotal {
  return sumMoney(
    observations.filter(o => isLive(o) && o.basis === 'planned' && o.period === period).map(observationMoney),
  );
}

/** Dönemin Gerçekleşen toplamı: gelecek dönem "Henüz yok"; aksi halde yalnız silinmemiş 'recorded_aggregate' kayıtlar. */
export function recordedTotal(observations: readonly BudgetObservation[], period: string, today: Date): RecordedTotal {
  if (isFuturePeriod(period, today)) return { kind: 'not_yet' };
  const rows = observations.filter(o => isRecorded(o) && o.period === period);
  const total = sumMoney(rows.map(observationMoney));
  return { kind: 'recorded', money: total.money, evidence: rows.length > 0 && rows.every(hasEvidence), total };
}
