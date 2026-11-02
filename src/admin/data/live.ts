// Canlı Google Sheets adaptörleri. Saf TS; React/antd yok. Yalnız okur: Sheets'e ya da Apps Script'e yazma yok.
// - liveBudget: mevcut GViz okuyucu (src/dashboard/data.ts fetchBudget) → panelin Bütçe görünüm modeli.
//   Plan ve gerçek ayrı alanlarda kalır; ay anahtarı period (YYYY-MM); tutarlar veri platformu Money zarfı
//   (ondalık metin + ISO 4217). Sayı yuvarlanmaz: data-platform decimal() kuralıyla (String(number) + üs açılımı) tam
//   ondalık metne çevrilir, en az iki ondalığa sıfırla tamamlanır (liveAmount); yuvarlama yalnız görüntülemededir
//   (formatMoney). Böylece nesildeki tutarla karşılaştırma ("Nesil ile N fark") yalnız gerçek farkı sayar.
//   Okuma sağlamlaştırılmıştır:
//   · Her deneme zaman aşımıyla (varsayılan 10 sn) kesilir; okuyucu sinyali dinlemese de bırakılır.
//   · Yalnız geçici hatalar (ağ, zaman aşımı, HTTP 408/425/429/5xx) sınırlı sayıda, üstel ve eşit jitter'lı
//     geri çekilmeyle yeniden denenir (varsayılan 3 deneme, 400 ms → 800 ms, en çok 3 sn bekleme).
//   · Hata sınıfları karışmaz: network "Sheets'e ulaşılamadı" ≠ empty "Veri yok" ≠ integrity "Biçim değişti"
//     (+ config, aborted). Metin "Hata: <sınıf>. <ayrıntı>" biçimindedir; ayrıntı BudgetIntegrityError metnidir.
//   · Son iyi okuma saklanır; hata sonucu onu `lastGood` olarak (okuma zamanı readAt ile) taşır ama başarı saymaz:
//     arayüz "eski" der, taze göstermez. Kalıcı saklama (IndexedDB, idb-keyval, LIVE_BUDGET_CACHE_KEY) store.ts
//     persistentCacheAllowed() ile aynı bayrağa bağlıdır: üretim derlemesinde VITE_AILE_PARTITION_CACHE=idb|on yoksa
//     son iyi okuma yalnız sekme belleğinde durur (fail-closed). clearLiveBudgetCache ikisini de siler.
//   · Eşzamanlı çağrılar aynı okuyucu için tek okumayı paylaşır; her çağıranın AbortSignal'i yalnız kendisini
//     iptal eder, ortak okuma son çağıran ayrılınca (aynı görevde yeniden katılan yoksa) iptal edilir.
// - parseTurkishDecimal / parseTurkishMoney: "8.500,00", "₺8.500,00", "(1.250,50)" gibi Türkçe biçimleri kesin
//   ondalık metne çevirir; belirsiz biçim ("1.5", "1,234.56") null döner, tahmin edilmez.
// - liveAppRecords: Apps Script read ucu (src/sync/api.ts callApi) → items/settings/cash + sürüm bilgisi.
// - diffLiveRecords: canlı kayıtları nesildeki purchase_need'lerle source_record_id üzerinden eşler ve yalnız
//   değişen alanları listeler ("canlı sürüm farkı"). Panel bu farkı yazmaz; Sheets'e yazma bu dilimde yok.
import { del as idbDel, get as idbGet, set as idbSet } from 'idb-keyval';
import type { Budget, Category, Irregular, Month } from '../../dashboard/data';
import { fetchBudget, sheetId } from '../../dashboard/data';
import { BudgetIntegrityError } from '../../dashboard/integrity';
import { sheetMonthKey } from '../../dashboard/current';
import { ApiError, callApi } from '../../sync/api';
import type { ReadFull, ReadResponse } from '@shared/api';
import type { CashEntry, Item, Setting } from '@shared/schema';
import { persistentCacheAllowed } from './store';
import type { Decimal, Money, PurchaseNeedRecord } from './types';

/** Eksik yapılandırma (API adresi, APP_KEY, Sheet kimliği). Ağa çıkılmadan atılır. */
export class ConfigError extends Error {
  name = 'ConfigError';
}

const PREFIX = 'Hata: ';
const CURRENCY = 'TRY';
const withPrefix = (text: string) => (text.startsWith(PREFIX) ? text : `${PREFIX}${text}`);

/** Herhangi bir hatayı kullanıcıya gösterilecek "Hata: …" metnine çevirir. */
export function describeLiveError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return withPrefix(error.message.trim());
  if (typeof error === 'string' && error.trim()) return withPrefix(error.trim());
  return `${PREFIX}Bilinmeyen hata.`;
}

// --- Bütçe görünüm modeli ---------------------------------------------------------------------------
/** YYYY-MM */
export type Period = string;
export interface BudgetTotals { income: Money; expense: Money; saving: Money; free: Money; balance: Money }
/** Bir ayın plan ve gerçek toplamları; iki taraf hiçbir yerde tek sayıda birleşmez. */
export interface BudgetMonthView { period: Period; label: string; source: string; planned: BudgetTotals; actual: BudgetTotals }
export interface BudgetLineView {
  id: string;
  label: string;
  group: string;
  kind: Category['kind'];
  planned: Record<Period, Money>;
  actual: Record<Period, Money>;
}
export interface BudgetIrregularView {
  id: string;
  label: string;
  type: string;
  status: string;
  room: string;
  note: string;
  manual: boolean;
  /** Ay etiketi periyoda çevrilemezse null; tutar yoksa null ("Fiyat yok"), sıfır değil. */
  planned: { period: Period | null; amount: Money };
  actual: { period: Period | null; amount: Money };
}
export interface BudgetViewModel {
  periods: Period[];
  months: BudgetMonthView[];
  categories: BudgetLineView[];
  groups: BudgetLineView[];
  irregular: BudgetIrregularView[];
  /** Okuma zamanı (ISO). */
  readAt: string;
}

/**
 * network: Sheets'e ulaşılamadı (ağ, zaman aşımı, HTTP hatası, erişim reddi) · empty: Sheets yanıt verdi ama okunacak
 * veri yok · integrity: yanıt ya da tablo beklenen biçimde değil (BudgetIntegrityError) · config: bağlantı tanımlanmamış
 * · aborted: çağıran iptal etti.
 */
export type LiveFailureKind = 'network' | 'empty' | 'integrity' | 'config' | 'aborted';
/** Kullanıcıya gösterilen sınıf adı; her sınıfın adı ayrıdır. */
export const LIVE_FAILURE_TITLE: Readonly<Record<LiveFailureKind, string>> = Object.freeze({
  network: "Sheets'e ulaşılamadı",
  empty: 'Veri yok',
  integrity: 'Biçim değişti',
  config: 'Bağlantı tanımlanmamış',
  aborted: 'Okuma iptal edildi',
});
export interface LiveFailure {
  ok: false;
  kind: LiveFailureKind;
  /** "Hata: <sınıf>. <ayrıntı>[ N kez denendi.]" */
  message: string;
  /** LIVE_FAILURE_TITLE[kind]. */
  title?: string;
  /** Hata geçici sayıldı mı (yeniden denendi ya da denenebilir). */
  retryable?: boolean;
  /** Yapılan deneme sayısı. */
  attempts?: number;
  /**
   * Son iyi okuma (IndexedDB); yoksa null. Hata sonucunda taşınır ama taze değildir: arayüz DataStatus "eski"
   * (lastGoodAt = lastGood.readAt) gösterir. aborted sonucunda bulunmaz.
   */
  lastGood?: BudgetViewModel | null;
}
export type LiveBudgetResult = { ok: true; budget: BudgetViewModel; attempts?: number } | LiveFailure;
export interface LiveRetryOptions {
  /** Toplam deneme (ilk dahil); 1…5 aralığına çekilir. Varsayılan 3. */
  attempts?: number;
  /** İlk bekleme üst sınırı; her denemede iki katına çıkar. Varsayılan 400 ms. */
  baseDelayMs?: number;
  /** Tek bekleme üst sınırı. Varsayılan 3000 ms. */
  maxDelayMs?: number;
}
/** Son iyi okumanın saklandığı yer; varsayılan idb-keyval. Hata hiçbir zaman okumayı bozmaz. */
export interface LiveBudgetCache {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}
export interface LiveBudgetOptions {
  signal?: AbortSignal;
  /** Test ve bağımlılık enjeksiyonu; varsayılan src/dashboard/data.ts fetchBudget. Tekilleştirme anahtarıdır. */
  fetchBudgetImpl?: (signal: AbortSignal) => Promise<Budget>;
  now?: () => Date;
  /** Tek denemenin zaman aşımı; varsayılan 10 000 ms. */
  timeoutMs?: number;
  retry?: LiveRetryOptions;
  /** Jitter kaynağı [0, 1]; varsayılan Math.random. */
  random?: () => number;
  /**
   * undefined → kalıcı saklama izinliyse (persistentCacheAllowed) IndexedDB varken idb-keyval, yoksa önbellek yok;
   * izin yoksa (üretim varsayılanı) yalnız sekme belleği. null → önbellek yok.
   */
  cache?: LiveBudgetCache | null;
}
/*
 * Eşzamanlı çağrılar ortak okumayı paylaşır: politika (now, timeoutMs, retry, random, cache) okumayı başlatan
 * çağrınınkidir; sonradan katılan yalnız sonucu alır.
 */

/**
 * Sheets sayısını veri platformu ondalık metnine çevirir: data-platform/core.mjs decimal() ile aynı kural (String(number)
 * + üs açılımı; kayan nokta yuvarlaması yok: 8333.333333333334 → "8333.333333333334", 1e21 → "1000000000000000000000"),
 * ardından en az iki ondalığa sıfırla tamamlar ("8500" → "8500.00"; sumMoney ile aynı yazım). Sonlu değilse null.
 */
export function liveAmount(value: number): Decimal | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const text = String(value);
  let plain: string;
  if (!/[eE]/.test(text)) {
    plain = text.replace(/^(-?)0+(?=\d)/, '$1');
  } else {
    const [coefficient, exponent] = text.toLowerCase().split('e');
    const negative = coefficient!.startsWith('-');
    const [whole, fraction = ''] = coefficient!.replace(/^-/, '').split('.');
    const digits = whole! + fraction;
    const place = whole!.length + Number(exponent);
    const body = place <= 0
      ? `0.${'0'.repeat(-place)}${digits}`
      : place >= digits.length ? digits + '0'.repeat(place - digits.length) : `${digits.slice(0, place)}.${digits.slice(place)}`;
    plain = `${negative ? '-' : ''}${body}`;
  }
  const negative = plain.startsWith('-');
  const [whole, fraction = ''] = plain.replace(/^-/, '').split('.');
  return `${negative ? '-' : ''}${whole}.${fraction.padEnd(2, '0')}`;
}

const toMoney = (value: number | null | undefined): Money => {
  const amount = typeof value === 'number' ? liveAmount(value) : null;
  return amount === null ? null : { amount, currency: CURRENCY };
};

const totals = (month: Month, side: 'plan' | 'current'): BudgetTotals => ({
  income: toMoney(month.income[side]),
  expense: toMoney(month.expense[side]),
  saving: toMoney(month.saving[side]),
  free: toMoney(month.free[side]),
  balance: toMoney(month.balance[side]),
});

const byPeriod = (periods: readonly Period[], values: readonly (number | null)[]): Record<Period, Money> =>
  Object.fromEntries(periods.map((period, i) => [period, toMoney(values[i] ?? null)]));

const line = (periods: readonly Period[], category: Category): BudgetLineView => ({
  id: category.id,
  label: category.label,
  group: category.group,
  kind: category.kind,
  planned: byPeriod(periods, category.plan),
  actual: byPeriod(periods, category.current),
});

function periodOf(label: string, labels: ReadonlyMap<string, Period>): Period | null {
  const text = label.trim();
  if (!text) return null;
  const known = labels.get(text.toLocaleLowerCase('tr'));
  if (known) return known;
  const iso = /^(\d{4})-(0[1-9]|1[0-2])(?:-\d{2})?$/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}`;
  // Bütçe penceresi dışındaki Türkçe ay etiketi ("Mart 2099"): eski panoyla aynı ayrıştırıcı.
  try {
    return sheetMonthKey(text);
  } catch (error) {
    if (error instanceof BudgetIntegrityError) return null;
    throw error;
  }
}

const irregularView = (row: Irregular, labels: ReadonlyMap<string, Period>): BudgetIrregularView => ({
  id: row.id,
  label: row.label,
  type: row.type,
  status: row.status,
  room: row.room,
  note: row.note,
  manual: row.manual,
  planned: { period: periodOf(row.planMonth, labels), amount: toMoney(row.plan) },
  actual: { period: periodOf(row.month, labels), amount: toMoney(row.current) },
});

/** fetchBudget sonucunu panelin Bütçe görünüm modeline çevirir. Sayı yuvarlanmaz (liveAmount); en az 2 ondalık metin. */
export function toBudgetViewModel(budget: Budget, readAt: string): BudgetViewModel {
  const periods = budget.months.map(month => month.key);
  const labels = new Map(budget.months.map(month => [month.label.toLocaleLowerCase('tr'), month.key] as const));
  return {
    periods,
    months: budget.months.map(month => ({ period: month.key, label: month.label, source: month.source, planned: totals(month, 'plan'), actual: totals(month, 'current') })),
    categories: budget.categories.map(category => line(periods, category)),
    groups: budget.groups.map(group => line(periods, group)),
    irregular: budget.irregular.map(row => irregularView(row, labels)),
    readAt,
  };
}

// --- Okuma politikası: zaman aşımı, sınıflama, yeniden deneme -------------------------------------------
/** Tek denemenin varsayılan zaman aşımı. */
export const LIVE_TIMEOUT_MS = 10_000;
/** Varsayılan yeniden deneme politikası (toplam deneme, ilk bekleme, bekleme üst sınırı). */
export const LIVE_RETRY: Readonly<Required<LiveRetryOptions>> = Object.freeze({ attempts: 3, baseDelayMs: 400, maxDelayMs: 3_000 });
const MAX_ATTEMPTS = 5;
/** Yanıt vermeyen IndexedDB son iyi okumayı en çok bu kadar bekletir. */
const CACHE_READ_TIMEOUT_MS = 1_500;
/** Bu metinli BudgetIntegrityError "biçim" değil "veri yok"tur (src/dashboard/current.ts: ay başlıkları boş). */
const EMPTY_SOURCE_DETAILS: ReadonlySet<string> = new Set(['Bütçe ayları eksik.']);

type BudgetReader = (signal: AbortSignal) => Promise<Budget>;
type FailureClass = Exclude<LiveFailureKind, 'aborted'>;
interface Classified { kind: FailureClass; detail: string; retryable: boolean }
interface ReadPolicy { attempts: number; baseDelayMs: number; maxDelayMs: number; timeoutMs: number }

const nonNegative = (value: number | undefined, fallback: number) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback);

function readPolicy(options: LiveBudgetOptions): ReadPolicy {
  const attempts = options.retry?.attempts;
  return {
    attempts: typeof attempts === 'number' && Number.isFinite(attempts) ? Math.min(MAX_ATTEMPTS, Math.max(1, Math.trunc(attempts))) : LIVE_RETRY.attempts,
    baseDelayMs: nonNegative(options.retry?.baseDelayMs, LIVE_RETRY.baseDelayMs),
    maxDelayMs: nonNegative(options.retry?.maxDelayMs, LIVE_RETRY.maxDelayMs),
    timeoutMs: typeof options.timeoutMs === 'number' && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : LIVE_TIMEOUT_MS,
  };
}

/**
 * attempt. başarısız denemeden sonraki bekleme: üst sınır min(maxDelayMs, baseDelayMs·2^(attempt−1)), eşit jitter
 * ile [üst sınır/2, üst sınır] aralığında. random() 1 → üst sınır, 0 → yarısı.
 */
export function retryDelay(attempt: number, policy: { baseDelayMs: number; maxDelayMs: number }, random: () => number = Math.random): number {
  const ceiling = Math.min(Math.max(0, policy.maxDelayMs), Math.max(0, policy.baseDelayMs) * 2 ** Math.max(0, attempt - 1));
  const draw = random();
  const share = Number.isFinite(draw) ? Math.min(1, Math.max(0, draw)) : 1;
  return Math.round(ceiling / 2 + (share * ceiling) / 2);
}

const secondsText = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });
const durationText = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : `${secondsText.format(ms / 1000)} sn`);
const sentence = (text: string) => (/[.!?…]$/.test(text) ? text : `${text}.`);

function detailOf(error: unknown): string {
  const text = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const trimmed = text.trim().replace(/^Hata:\s*/, '');
  return trimmed ? sentence(trimmed) : '';
}

const isAbort = (error: unknown) =>
  (error instanceof DOMException && error.name === 'AbortError') || (error instanceof Error && error.name === 'AbortError');

/** fetchBudget "Google Sheets bağlantısı başarısız (503)." atar; özel okuyucu `status` alanı verebilir. */
function httpStatusOf(error: unknown): number | null {
  if (typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number') return error.status;
  if (!(error instanceof Error)) return null;
  const match = /başarısız \((\d{3})\)/.exec(error.message);
  return match ? Number(match[1]) : null;
}

function classifyStatus(status: number, error: unknown): Classified {
  if (status === 404 || status === 410) return { kind: 'empty', detail: `Sheets'te bu tablo bulunamadı (${status}).`, retryable: false };
  if (status === 401 || status === 403) return { kind: 'network', detail: `Erişim reddedildi (${status}). Paylaşım ayarını kontrol edin.`, retryable: false };
  if (status === 400) return { kind: 'integrity', detail: 'Sheets isteği reddetti (400); sekme ya da aralık değişmiş olabilir.', retryable: false };
  const retryable = status === 408 || status === 425 || status === 429 || status >= 500;
  return { kind: 'network', detail: detailOf(error) || `Google Sheets bağlantısı başarısız (${status}).`, retryable };
}

/** Çağıranın iptali burada değil, okuma döngüsünde ayrılır; buraya yalnız okumanın kendi hatası gelir. */
function classify(error: unknown, timedOut: boolean, timeoutMs: number): Classified {
  if (timedOut) return { kind: 'network', detail: `${durationText(timeoutMs)} içinde yanıt gelmedi.`, retryable: true };
  if (error instanceof BudgetIntegrityError) {
    const detail = detailOf(error);
    return { kind: EMPTY_SOURCE_DETAILS.has(detail) ? 'empty' : 'integrity', detail, retryable: false };
  }
  if (error instanceof ConfigError || (error instanceof Error && /henüz tanımlanmamış/.test(error.message))) return { kind: 'config', detail: detailOf(error), retryable: false };
  const status = httpStatusOf(error);
  if (status !== null) return classifyStatus(status, error);
  // Tarayıcının kendi metni ("Failed to fetch", "Load failed") İngilizcedir; kullanıcıya Türkçe ayrıntı yazılır.
  if (error instanceof TypeError) return { kind: 'network', detail: 'Bağlantı kurulamadı.', retryable: true };
  // Okuyucu kendi kendine iptal edildi (çağıran değil): bağlantı kesildi sayılır, iptal sayılmaz.
  if (isAbort(error)) return { kind: 'network', detail: 'Bağlantı kesildi.', retryable: true };
  return { kind: 'network', detail: detailOf(error) || 'Bilinmeyen hata.', retryable: false };
}

function failureMessage(kind: LiveFailureKind, detail: string, attempts: number): string {
  const parts = [`${PREFIX}${LIVE_FAILURE_TITLE[kind]}.`];
  if (detail) parts.push(detail);
  if (attempts > 1) parts.push(`${attempts} kez denendi.`);
  return parts.join(' ');
}

const abortedFailure = (): LiveFailure => ({
  ok: false,
  kind: 'aborted',
  title: LIVE_FAILURE_TITLE.aborted,
  message: failureMessage('aborted', '', 1),
  retryable: false,
});

/** İş bitmeden sinyal iptal edilirse hemen reddeder; sinyali dinlemeyen okuyucu da böylece bırakılır. */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  work.catch(() => {}); // İptalden sonra gelen geç ret işlenmemiş kalmasın.
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new DOMException('İptal edildi', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      value => { signal.removeEventListener('abort', onAbort); resolve(value); },
      error => { signal.removeEventListener('abort', onAbort); reject(error); },
    );
  });
}

type AttemptOutcome = { ok: true; budget: Budget } | { ok: false; error: unknown; timedOut: boolean };

/** Tek deneme: dış sinyal ve zaman aşımı aynı iç AbortController'a bağlanır. */
async function attemptRead(read: BudgetReader, outer: AbortSignal, timeoutMs: number): Promise<AttemptOutcome> {
  if (outer.aborted) return { ok: false, error: outer.reason, timedOut: false };
  const controller = new AbortController();
  let timedOut = false;
  const forward = () => controller.abort(outer.reason);
  outer.addEventListener('abort', forward, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException('Zaman aşımı', 'TimeoutError'));
  }, timeoutMs);
  try {
    const budget = await untilAborted(Promise.resolve().then(() => read(controller.signal)), controller.signal);
    return { ok: true, budget };
  } catch (error) {
    return { ok: false, error, timedOut };
  } finally {
    clearTimeout(timer);
    outer.removeEventListener('abort', forward);
  }
}

/** ms bekler; iptal edilirse beklemeyi keser ve false döner. */
function sleep(ms: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise(resolve => {
    const finish = (completed: boolean) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve(completed);
    };
    const onAbort = () => finish(false);
    const timer = setTimeout(() => finish(true), ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function viewOf(budget: Budget, now: () => Date): { view: BudgetViewModel } | { failure: Classified } {
  if (!Array.isArray(budget?.months) || budget.months.length === 0) return { failure: { kind: 'empty', detail: "Sheets'te okunacak bütçe ayı yok.", retryable: false } };
  try {
    return { view: toBudgetViewModel(budget, now().toISOString()) };
  } catch {
    return { failure: { kind: 'integrity', detail: 'Bütçe görünümü kurulamadı.', retryable: false } };
  }
}

async function runRead(read: BudgetReader, options: LiveBudgetOptions, signal: AbortSignal): Promise<LiveBudgetResult> {
  const policy = readPolicy(options);
  const now = options.now ?? (() => new Date());
  const random = options.random ?? Math.random;
  const cache = resolveCache(options.cache);
  let attempts = 0;
  let failure: Classified;
  for (;;) {
    attempts++;
    const outcome = await attemptRead(read, signal, policy.timeoutMs);
    if (signal.aborted) return abortedFailure();
    if (outcome.ok) {
      const built = viewOf(outcome.budget, now);
      if ('view' in built) {
        saveLastGood(cache, built.view);
        return { ok: true, budget: built.view, attempts };
      }
      failure = built.failure;
    } else {
      failure = classify(outcome.error, outcome.timedOut, policy.timeoutMs);
    }
    if (!failure.retryable || attempts >= policy.attempts) break;
    if (!(await sleep(retryDelay(attempts, policy, random), signal))) return abortedFailure();
  }
  const lastGood = await readLastGood(cache);
  if (signal.aborted) return abortedFailure();
  return {
    ok: false,
    kind: failure.kind,
    title: LIVE_FAILURE_TITLE[failure.kind],
    message: failureMessage(failure.kind, failure.detail, attempts),
    retryable: failure.retryable,
    attempts,
    lastGood,
  };
}

// --- Eşzamanlı isteklerin tekilleştirilmesi ------------------------------------------------------------------
interface Flight { result: Promise<LiveBudgetResult>; controller: AbortController; members: number; settled: boolean }
const flights = new Map<BudgetReader, Flight>();

function startFlight(read: BudgetReader, options: LiveBudgetOptions): Flight {
  const controller = new AbortController();
  const flight: Flight = { controller, members: 0, settled: false, result: Promise.resolve(abortedFailure()) };
  flight.result = runRead(read, options, controller.signal)
    .catch((error: unknown): LiveBudgetResult => {
      const detail = detailOf(error) || 'Bilinmeyen hata.';
      return { ok: false, kind: 'network', title: LIVE_FAILURE_TITLE.network, message: failureMessage('network', detail, 1), retryable: false, attempts: 1, lastGood: null };
    })
    .finally(() => {
      flight.settled = true;
      if (flights.get(read) === flight) flights.delete(read);
    });
  return flight;
}

function joinFlight(read: BudgetReader, flight: Flight, signal: AbortSignal | undefined): Promise<LiveBudgetResult> {
  flight.members++;
  return new Promise(resolve => {
    let left = false;
    const leave = () => {
      left = true;
      signal?.removeEventListener('abort', onAbort);
      flight.members--;
    };
    const onAbort = () => {
      if (left) return;
      leave();
      resolve(abortedFailure());
      if (flight.members > 0) return;
      // Aynı görevde yeniden katılan (React StrictMode: temizle → yeniden bağla) ortak okumayı sürdürür.
      queueMicrotask(() => {
        if (flight.members > 0 || flight.settled) return;
        if (flights.get(read) === flight) flights.delete(read);
        flight.controller.abort(new DOMException('Okuma iptal edildi', 'AbortError'));
      });
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    void flight.result.then(result => {
      if (left) return;
      leave();
      resolve(result);
    });
  });
}

/**
 * Canlı bütçeyi okur. Reddetmez; sonuç {ok:true,budget,attempts} ya da "Hata: <sınıf>. …" metinli LiveFailure.
 * Aynı okuyucuya eşzamanlı çağrılar tek okumayı paylaşır; signal yalnız bu çağrıyı iptal eder.
 */
export function liveBudget(options: LiveBudgetOptions = {}): Promise<LiveBudgetResult> {
  if (options.signal?.aborted) return Promise.resolve(abortedFailure());
  const read = options.fetchBudgetImpl ?? fetchBudget;
  let flight = flights.get(read);
  if (!flight) {
    flight = startFlight(read, options);
    flights.set(read, flight);
  }
  return joinFlight(read, flight, options.signal);
}

// --- Son iyi okuma önbelleği ------------------------------------------------------------------------------------
/** idb-keyval anahtarı; değer {v:1, sheet, budget}. Başka Sheet'in ya da sürümün kaydı kullanılmaz. */
export const LIVE_BUDGET_CACHE_KEY = 'aile:admin:live-budget:v1';
interface LastGoodEntry { v: 1; sheet: string; budget: BudgetViewModel }

let idbCache: LiveBudgetCache | null = null;
/** Kalıcı saklama kapalıyken (üretim varsayılanı) son iyi okuma yalnız bu sekmenin belleğindedir. */
let sessionCache: LiveBudgetCache | null = null;

/** idb-keyval varsayılan deposu üzerinde önbellek (changeSet ile aynı depo, ayrı anahtar). */
export function createIdbLiveBudgetCache(): LiveBudgetCache {
  return {
    get: key => idbGet<unknown>(key),
    set: (key, value) => idbSet(key, value),
  };
}

/** Testler ve saklamasız kullanım için bellek önbelleği. */
export function createMemoryLiveBudgetCache(): LiveBudgetCache {
  const entries = new Map<string, unknown>();
  return {
    get: async key => entries.get(key),
    set: async (key, value) => { entries.set(key, value); },
  };
}

function resolveCache(cache: LiveBudgetCache | null | undefined): LiveBudgetCache | null {
  if (cache !== undefined) return cache;
  if (!persistentCacheAllowed()) return (sessionCache ??= createMemoryLiveBudgetCache());
  if (typeof indexedDB === 'undefined') return null;
  return (idbCache ??= createIdbLiveBudgetCache());
}

/**
 * Son iyi canlı okumayı bu cihazdan siler: sekme belleğindeki kopya ve (IndexedDB varsa) idb-keyval kaydı. Ayarlar'daki
 * "Bu cihazdaki tüm panel verisini sil" bunu çağırır. IndexedDB hatası yutulmaz; çağıran "Hata: …" yazar.
 */
export async function clearLiveBudgetCache(): Promise<void> {
  sessionCache = null;
  if (typeof indexedDB === 'undefined') return;
  await idbDel(LIVE_BUDGET_CACHE_KEY);
}

/** Yazma beklenmez ve hatası yutulur: önbellek okumayı hiçbir zaman bozmaz. */
function saveLastGood(cache: LiveBudgetCache | null, budget: BudgetViewModel): void {
  if (!cache) return;
  const entry: LastGoodEntry = { v: 1, sheet: sheetId, budget };
  void Promise.resolve().then(() => cache.set(LIVE_BUDGET_CACHE_KEY, entry)).catch(() => {});
}

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function lastGoodOf(value: unknown): BudgetViewModel | null {
  if (!isRecord(value) || value.v !== 1 || value.sheet !== sheetId) return null;
  const budget = value.budget;
  if (!isRecord(budget) || typeof budget.readAt !== 'string' || Number.isNaN(Date.parse(budget.readAt))) return null;
  if (!Array.isArray(budget.periods) || !budget.periods.every(period => typeof period === 'string' && PERIOD_RE.test(period))) return null;
  if (!['months', 'categories', 'groups', 'irregular'].every(field => Array.isArray(budget[field]))) return null;
  return budget as unknown as BudgetViewModel;
}

async function readLastGood(cache: LiveBudgetCache | null): Promise<BudgetViewModel | null> {
  if (!cache) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      Promise.resolve().then(() => cache.get(LIVE_BUDGET_CACHE_KEY)),
      new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), CACHE_READ_TIMEOUT_MS); }),
    ]);
    return lastGoodOf(value);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Saklanan son iyi okuma (sayfa açılışında "eski" olarak gösterilebilir); yoksa null. Ağa çıkmaz. */
export function lastGoodBudget(options: { cache?: LiveBudgetCache | null } = {}): Promise<BudgetViewModel | null> {
  return readLastGood(resolveCache(options.cache));
}

/** "Son okuma" zamanı (ISO): başarıda okuma zamanı, hatada son iyi okumanın zamanı; ikisi de yoksa null. */
export function lastReadAtOf(result: LiveBudgetResult | null | undefined): string | null {
  if (!result) return null;
  return result.ok ? result.budget.readAt : (result.lastGood?.readAt ?? null);
}

// --- Türkçe sayı ve para biçimleri -----------------------------------------------------------------------------
const CURRENCY_ALIASES: Readonly<Record<string, string>> = { '₺': 'TRY', TL: 'TRY', TRY: 'TRY', $: 'USD', USD: 'USD', '€': 'EUR', EUR: 'EUR', '£': 'GBP', GBP: 'GBP' };
const SIGN = '[-+\\u2212]';
const CURRENCY_TOKEN = '₺|\\$|€|£|[A-Za-z]{2,3}';
const AMOUNT_RE = new RegExp(`^(${SIGN})?\\s*(?:(${CURRENCY_TOKEN})\\s*)?(${SIGN})?\\s*([0-9][0-9. ]*?(?:,[0-9]+)?)\\s*(${CURRENCY_TOKEN})?$`, 'u');
const PLAIN_INT = /^[0-9]+$/;
const DOT_GROUPED = /^[0-9]{1,3}(?:\.[0-9]{3})+$/;
const SPACE_GROUPED = /^[0-9]{1,3}(?: [0-9]{3})+$/;

interface ParsedAmount { decimal: string; currency: string | null }

function parseAmount(input: string): ParsedAmount | null {
  if (typeof input !== 'string') return null;
  let text = input.replace(/[   ]/g, ' ').trim();
  const parenthesized = /^\((.*)\)$/.exec(text);
  if (parenthesized) text = parenthesized[1].trim();
  const match = AMOUNT_RE.exec(text);
  if (!match) return null;
  const [, leadSign, leadCurrency, innerSign, number, trailCurrency] = match;
  if ((leadSign && innerSign) || (leadCurrency && trailCurrency)) return null;
  const sign = leadSign ?? innerSign;
  if (parenthesized && sign) return null;
  const token = leadCurrency ?? trailCurrency;
  const currency = token ? CURRENCY_ALIASES[/^[A-Za-z]+$/.test(token) ? token.toUpperCase() : token] : null;
  if (token && !currency) return null;
  const [integerPart, fraction] = number.trim().split(',');
  if (!PLAIN_INT.test(integerPart) && !DOT_GROUPED.test(integerPart) && !SPACE_GROUPED.test(integerPart)) return null;
  const integer = integerPart.replace(/[. ]/g, '').replace(/^0+(?=\d)/, '');
  const zero = /^0+$/.test(integer + (fraction ?? ''));
  const negative = !zero && (Boolean(parenthesized) || sign === '-' || sign === '−');
  return { decimal: `${negative ? '-' : ''}${integer}${fraction !== undefined ? `.${fraction}` : ''}`, currency };
}

/**
 * Türkçe sayıyı ("8.500,00", "−1.250", "(1.250,50)", "8 500,5") veri platformu ondalık metnine ("8500.00") çevirir;
 * kayan nokta kullanılmaz, ondalık basamaklar korunur. Para birimi işareti, belirsiz ("1.5") ya da Türkçe olmayan
 * ("1,234.56") biçim null döner.
 */
export function parseTurkishDecimal(text: string): Decimal | null {
  const parsed = parseAmount(text);
  return parsed && parsed.currency === null ? parsed.decimal : null;
}

/**
 * Türkçe tutarı ("₺8.500,00", "8.500 TL", "12,50 €") Money zarfına çevirir; tutar en az 2 ondalıklıdır. İşaret yoksa
 * fallbackCurrency kullanılır. Tanınmayan ya da iki para birimi, belirsiz sayı null ("Bilinmiyor") döner.
 */
export function parseTurkishMoney(text: string, fallbackCurrency = CURRENCY): Money {
  const parsed = parseAmount(text);
  if (!parsed) return null;
  const currency = parsed.currency ?? fallbackCurrency;
  if (!/^[A-Z]{3}$/.test(currency)) return null;
  const [integer, fraction = ''] = parsed.decimal.split('.');
  return { amount: `${integer}.${fraction.padEnd(2, '0')}`, currency };
}

// --- Canlı uygulama kayıtları ----------------------------------------------------------------------
export interface LiveVersion { fingerprint: string; serverTime: string; schemaVersion: number }
export interface LiveAppRecords {
  version: LiveVersion;
  items: Item[];
  settings: Setting[];
  /** Sunucu harcama günlüğünü desteklemiyorsa boş liste; cashSupported=false. */
  cash: CashEntry[];
  cashSupported: boolean;
}
export interface LiveAppOptions { fetchImpl?: typeof fetch; signal?: AbortSignal }

const isFull = (response: ReadResponse): response is ReadFull => response.notModified !== true;

/** Apps Script read ucundan canlı kayıtları okur. Anahtar ya da adres yoksa ağa çıkmadan ConfigError atar. */
export async function liveAppRecords(apiUrl: string, key: string | undefined, options: LiveAppOptions = {}): Promise<LiveAppRecords> {
  const url = apiUrl.trim();
  const appKey = key?.trim();
  if (!url) throw new ConfigError('API adresi ayarlanmamış.');
  if (!appKey) throw new ConfigError('Uygulama anahtarı (APP_KEY) ayarlanmamış.');
  const response = await callApi<ReadResponse>(url, { action: 'read', key: appKey }, { fetchImpl: options.fetchImpl, signal: options.signal });
  if (!isFull(response)) throw new Error(`${PREFIX}Sunucu "değişmedi" yanıtı döndü; tam okuma bekleniyordu.`);
  return {
    version: { fingerprint: response.fingerprint, serverTime: response.serverTime, schemaVersion: response.schemaVersion },
    items: response.items ?? [],
    settings: response.settings ?? [],
    cash: response.cash ?? [],
    cashSupported: Array.isArray(response.cash),
  };
}

// --- Canlı sürüm farkı -------------------------------------------------------------------------------
export interface FieldChange { field: string; generation: string | null; live: string | null }
export type LiveDiffStatus = 'changed' | 'live_only' | 'generation_only';
export interface LiveDiffEntry {
  sourceRecordId: string;
  /** Nesildeki kayıt kimliği (UUIDv5); yalnız canlıda varsa null. */
  recordId: string | null;
  label: string;
  status: LiveDiffStatus;
  liveVersion: number | null;
  liveUpdatedAt: string | null;
  changes: FieldChange[];
}
export interface LiveDiff {
  /** İki tarafta da bulunan kayıt sayısı. */
  matched: number;
  /** Eşleşen ve alanı değişmeyen kayıt sayısı (listeye girmez). */
  unchanged: number;
  entries: LiveDiffEntry[];
}

/** Sürüm/iz alanları: içerik farkı değildir. */
const META_FIELDS = new Set(['id', 'created_at', 'updated_at', 'updated_by', 'version', 'son_op_id', 'son_degisen_alanlar']);
/** Kaynak satırda bulunmayan para alanları için nesildeki amounts karşılığı. */
const MONEY_FIELDS: Record<string, keyof PurchaseNeedRecord['amounts']> = {
  gercek_tl: 'actual',
  tahmini_tl_min: 'estimated_min',
  tahmini_tl_max: 'estimated_max',
  teklif_tl: 'quote',
};

function normalize(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.trim() === '' ? null : value.trim();
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return value.length ? JSON.stringify(value) : null;
  return JSON.stringify(value);
}

const sameValue = (a: string | null, b: string | null) => {
  if (a === b) return true;
  if (a === null || b === null) return false;
  const na = Number(a), nb = Number(b);
  return a.trim() !== '' && b.trim() !== '' && Number.isFinite(na) && Number.isFinite(nb) && na === nb;
};

const isMoneyField = (field: string) => Object.hasOwn(MONEY_FIELDS, field);

/** "8500.00" → "8500", "-0.50" → "-0.5", "-0" → "0": aynı tutarın tek yazımı. */
function canonicalDecimal(value: string): string {
  const match = /^(-?)([0-9]+)(?:\.([0-9]+))?$/.exec(value);
  if (!match) return value;
  const integer = match[2].replace(/^0+(?=\d)/, '');
  const fraction = (match[3] ?? '').replace(/0+$/, '');
  const body = fraction ? `${integer}.${fraction}` : integer;
  return body === '0' ? '0' : `${match[1]}${body}`;
}

/** Para alanı metninin olası tutar okumaları: veri platformu biçimi ("8500.00") ve Türkçe TL biçimi ("8.500,00", "₺8.500"). */
function amountReadings(value: string): Set<string> {
  const readings = new Set<string>();
  if (/^-?[0-9]+(\.[0-9]+)?$/.test(value)) readings.add(canonicalDecimal(value));
  const turkish = parseTurkishMoney(value);
  if (turkish?.currency === CURRENCY) readings.add(canonicalDecimal(turkish.amount));
  return readings;
}

/** TL alanlarında Sheets'e metin olarak yazılmış Türkçe tutar, nesildeki ondalık tutarla aynıysa fark değildir. */
function sameAmount(a: string | null, b: string | null): boolean {
  if (sameValue(a, b)) return true;
  if (a === null || b === null) return false;
  const readings = amountReadings(b);
  return [...amountReadings(a)].some(reading => readings.has(reading));
}

function generationValue(need: PurchaseNeedRecord, field: string): unknown {
  if (field === 'deleted_at') return need.deleted_at ?? need.source_attributes?.deleted_at ?? null;
  const source = need.source_attributes ?? {};
  if (field in source) return source[field];
  if (isMoneyField(field)) return need.amounts?.[MONEY_FIELDS[field]]?.amount ?? null;
  return undefined;
}

function fieldChanges(item: Item, need: PurchaseNeedRecord): FieldChange[] {
  const fields = new Set<string>([...Object.keys(item), ...Object.keys(need.source_attributes ?? {}), 'deleted_at']);
  const changes: FieldChange[] = [];
  for (const field of [...fields].sort()) {
    if (META_FIELDS.has(field)) continue;
    const live = normalize((item as unknown as Record<string, unknown>)[field]);
    const generation = normalize(generationValue(need, field));
    const same = isMoneyField(field) ? sameAmount(live, generation) : sameValue(live, generation);
    if (!same) changes.push({ field, generation, live });
  }
  return changes;
}

/** Canlı kayıtları nesille eşler; değişen, yalnız canlıda ve yalnız nesilde olan kayıtları listeler. */
export function diffLiveRecords(items: readonly Item[], needs: readonly PurchaseNeedRecord[]): LiveDiff {
  const needsById = new Map<string, PurchaseNeedRecord>();
  for (const need of needs) if (need.source_record_id && !needsById.has(need.source_record_id)) needsById.set(need.source_record_id, need);
  const seen = new Set<string>();
  const entries: LiveDiffEntry[] = [];
  let matched = 0, unchanged = 0;
  for (const item of items) {
    const need = needsById.get(item.id);
    const liveVersion = typeof item.version === 'number' ? item.version : null;
    const liveUpdatedAt = item.updated_at ?? null;
    if (!need) {
      entries.push({ sourceRecordId: item.id, recordId: null, label: item.ad || item.id, status: 'live_only', liveVersion, liveUpdatedAt, changes: [] });
      continue;
    }
    seen.add(item.id);
    matched++;
    const changes = fieldChanges(item, need);
    if (!changes.length) { unchanged++; continue; }
    entries.push({ sourceRecordId: item.id, recordId: need.id, label: need.label ?? item.ad ?? item.id, status: 'changed', liveVersion, liveUpdatedAt, changes });
  }
  for (const [sourceRecordId, need] of needsById) {
    if (seen.has(sourceRecordId)) continue;
    entries.push({ sourceRecordId, recordId: need.id, label: need.label ?? sourceRecordId, status: 'generation_only', liveVersion: null, liveUpdatedAt: null, changes: [] });
  }
  return { matched, unchanged, entries };
}

export { ApiError };
