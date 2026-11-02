// Canlı Google Sheets adaptörleri. Saf TS; React/antd yok.
// - liveBudget: mevcut GViz okuyucu (src/dashboard/data.ts fetchBudget) → panelin Bütçe görünüm modeli.
//   Plan ve gerçek ayrı alanlarda kalır; ay anahtarı period (YYYY-MM); tutarlar veri platformu Money zarfı
//   (ondalık metin + ISO 4217). Hata metni "Hata: …" ile başlar ve BudgetIntegrityError metnini taşır.
// - liveAppRecords: Apps Script read ucu (src/sync/api.ts callApi) → items/settings/cash + sürüm bilgisi.
// - diffLiveRecords: canlı kayıtları nesildeki purchase_need'lerle source_record_id üzerinden eşler ve yalnız
//   değişen alanları listeler ("canlı sürüm farkı"). Panel bu farkı yazmaz; Sheets'e yazma bu dilimde yok.
import type { Budget, Category, Irregular, Month } from '../../dashboard/data';
import { fetchBudget } from '../../dashboard/data';
import { BudgetIntegrityError } from '../../dashboard/integrity';
import { ApiError, callApi } from '../../sync/api';
import type { ReadFull, ReadResponse } from '@shared/api';
import type { CashEntry, Item, Setting } from '@shared/schema';
import type { Money, PurchaseNeedRecord } from './types';

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

export type LiveFailureKind = 'integrity' | 'config' | 'network' | 'aborted';
export interface LiveFailure { ok: false; kind: LiveFailureKind; message: string }
export type LiveBudgetResult = { ok: true; budget: BudgetViewModel } | LiveFailure;
export interface LiveBudgetOptions {
  signal?: AbortSignal;
  /** Test ve bağımlılık enjeksiyonu; varsayılan src/dashboard/data.ts fetchBudget. */
  fetchBudgetImpl?: (signal: AbortSignal) => Promise<Budget>;
  now?: () => Date;
}

const toMoney = (value: number | null | undefined): Money =>
  typeof value === 'number' && Number.isFinite(value) ? { amount: value.toFixed(2), currency: CURRENCY } : null;

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
  return iso ? `${iso[1]}-${iso[2]}` : null;
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

/** fetchBudget sonucunu panelin Bütçe görünüm modeline çevirir. Sayı yuvarlama yapılmaz; 2 ondalık metin. */
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

const isAbort = (error: unknown) =>
  (error instanceof DOMException && error.name === 'AbortError') || (error instanceof Error && error.name === 'AbortError');

function classifyBudgetError(error: unknown): LiveFailure {
  const message = describeLiveError(error);
  if (error instanceof BudgetIntegrityError) return { ok: false, kind: 'integrity', message };
  if (isAbort(error)) return { ok: false, kind: 'aborted', message };
  if (error instanceof ConfigError || (error instanceof Error && /henüz tanımlanmamış/.test(error.message))) return { ok: false, kind: 'config', message };
  return { ok: false, kind: 'network', message };
}

/** Canlı bütçeyi okur. Reddetmez; sonuç {ok:true,budget} ya da "Hata: …" metinli LiveFailure. */
export async function liveBudget(options: LiveBudgetOptions = {}): Promise<LiveBudgetResult> {
  const read = options.fetchBudgetImpl ?? fetchBudget;
  const signal = options.signal ?? new AbortController().signal;
  const now = options.now ?? (() => new Date());
  try {
    const budget = await read(signal);
    return { ok: true, budget: toBudgetViewModel(budget, now().toISOString()) };
  } catch (error) {
    return classifyBudgetError(error);
  }
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

function generationValue(need: PurchaseNeedRecord, field: string): unknown {
  if (field === 'deleted_at') return need.deleted_at ?? need.source_attributes?.deleted_at ?? null;
  const source = need.source_attributes ?? {};
  if (field in source) return source[field];
  const moneyKey = MONEY_FIELDS[field];
  if (moneyKey) return need.amounts?.[moneyKey]?.amount ?? null;
  return undefined;
}

function fieldChanges(item: Item, need: PurchaseNeedRecord): FieldChange[] {
  const fields = new Set<string>([...Object.keys(item), ...Object.keys(need.source_attributes ?? {}), 'deleted_at']);
  const changes: FieldChange[] = [];
  for (const field of [...fields].sort()) {
    if (META_FIELDS.has(field)) continue;
    const live = normalize((item as unknown as Record<string, unknown>)[field]);
    const generation = normalize(generationValue(need, field));
    if (!sameValue(live, generation)) changes.push({ field, generation, live });
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
