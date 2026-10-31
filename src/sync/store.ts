// Uygulama durumu: tek kaynak, useSyncExternalStore ile okunur. Optimistic yazım + sunucu satırıyla değiştirme.
import { useSyncExternalStore, useCallback, useRef } from 'react';
import type { BudgetPlan, CashEntry, Item, Setting } from '@shared/schema';
import type { Conflict, Op, OpResult, ReadFull, Table } from '@shared/api';
import type { Rec } from '@shared/convert';
import type { QueuedOp } from './queue';

export type SyncStatus = 'idle' | 'loading' | 'syncing' | 'synced' | 'offline' | 'error' | 'unconfigured';

export interface PendingConflict {
  id: string;
  table: Table;
  keys: string[];
  serverValues: Rec;
  myValues: Rec;
  updatedBy?: string;
  updatedAt?: string;
}

export interface AppState {
  items: Item[];
  settings: Setting[];
  cash: CashEntry[];
  /** Sunucu harcama günlüğünü destekliyor mu (app_nakit sekmesi var mı). Bilinmiyorsa undefined. */
  cashSupported?: boolean;
  plan?: BudgetPlan;
  fingerprint?: string;
  status: SyncStatus;
  lastSync?: string;
  /** Yalnız taşıma/sunucu geneli hatası (ağ, HTML, şema). Tek bir işlemin kalıcı reddi `rejected` içindedir. */
  lastError?: string;
  outbox: QueuedOp[];
  /** Sunucunun kalıcı reddettiği işlemler (`rejection` dolu). Kuyruk dosyasında bekleyenlerle birlikte saklanır; okuma/yenileme silmez. */
  rejected: QueuedOp[];
  conflicts: PendingConflict[];
  hydrated: boolean;
}

const initial: AppState = { items: [], settings: [], cash: [], status: 'idle', outbox: [], rejected: [], conflicts: [], hydrated: false };
let state: AppState = initial;
const listeners = new Set<() => void>();

function emit() { for (const l of listeners) l(); }
export function getState(): AppState { return state; }
export function setState(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)): void {
  const p = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...p };
  emit();
}
export function resetStore(): void { state = initial; emit(); }
export function subscribe(l: () => void): () => void { listeners.add(l); return () => listeners.delete(l); }

function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object); const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  return true;
}

/** Seçici yeni nesne döndürse bile sığ eşitlikle önbelleklenir (useSyncExternalStore döngüsünü önler). */
export function useAppStore<T>(selector: (s: AppState) => T): T {
  const cache = useRef<{ state: AppState; value: T } | null>(null);
  const get = useCallback(() => {
    const c = cache.current;
    if (c && c.state === state) return c.value;
    const next = selector(state);
    if (c && shallowEqual(c.value, next)) { cache.current = { state, value: c.value }; return c.value; }
    cache.current = { state, value: next };
    return next;
  }, [selector]);
  return useSyncExternalStore(subscribe, get, get);
}

type TableName = Table;
const LIST_KEY = { kalemler: 'items', ayarlar: 'settings', nakit: 'cash' } as const;
function listOf(s: AppState, table: TableName): Rec[] { return s[LIST_KEY[table]] as unknown as Rec[]; }
function withList(table: TableName, list: Rec[]): Partial<AppState> {
  return { [LIST_KEY[table]]: list } as Partial<AppState>;
}

/** Bekleyen (gönderilmemiş) patch'leri sunucu verisinin üstüne yeniden uygular. */
export function rebase(list: Rec[], table: TableName, outbox: QueuedOp[]): Rec[] {
  const byId = new Map(list.map((r) => [String(r.id), { ...r }]));
  for (const q of outbox) {
    const op = q.op;
    if (op.table !== table) continue;
    const cur = byId.get(op.id);
    if (op.op === 'upsert') {
      const base = cur ?? { id: op.id };
      const next: Rec = { ...base };
      for (const [k, v] of Object.entries(op.patch)) { if (v === null || v === '') delete next[k]; else next[k] = v; }
      byId.set(op.id, next);
    } else if (op.op === 'delete' && cur) {
      byId.set(op.id, { ...cur, deleted_at: q.ts });
    } else if (op.op === 'restore' && cur) {
      const next = { ...cur }; delete next.deleted_at; byId.set(op.id, next);
    }
  }
  return [...byId.values()];
}

export function applyRead(full: ReadFull): void {
  setState((s) => ({
    items: rebase(full.items as unknown as Rec[], 'kalemler', s.outbox) as unknown as Item[],
    settings: rebase(full.settings as unknown as Rec[], 'ayarlar', s.outbox) as unknown as Setting[],
    cash: rebase((full.cash ?? []) as unknown as Rec[], 'nakit', s.outbox) as unknown as CashEntry[],
    cashSupported: full.cash !== undefined,
    plan: full.plan,
    fingerprint: full.fingerprint,
    lastSync: full.serverTime,
    hydrated: true,
  }));
}

export function applyLocalOp(op: Op, ts: string): void {
  setState((s) => {
    const list = listOf(s, op.table);
    const idx = list.findIndex((r) => String(r.id) === op.id);
    const next = list.slice();
    if (op.op === 'upsert') {
      const base: Rec = idx >= 0 ? { ...next[idx] } : { id: op.id };
      for (const [k, v] of Object.entries(op.patch)) { if (v === null || v === '') delete base[k]; else base[k] = v; }
      if (idx >= 0) next[idx] = base; else next.push(base);
    } else if (idx >= 0) {
      const row = { ...next[idx] };
      if (op.op === 'delete') row.deleted_at = ts; else delete row.deleted_at;
      next[idx] = row;
    }
    return withList(op.table, next);
  });
}

export function applyServerResult(op: Op, result: OpResult): void {
  if (!result.row) return;
  setState((s) => {
    const list = listOf(s, op.table);
    const idx = list.findIndex((r) => String(r.id) === op.id);
    const next = list.slice();
    const row = result.row as Rec;
    if (idx >= 0) next[idx] = row; else next.push(row);
    const conflicts = result.conflict && op.op === 'upsert'
      ? [...s.conflicts.filter((c) => c.id !== op.id), toConflict(op.table, op.id, result.conflict, op.patch)]
      : s.conflicts;
    return { ...withList(op.table, next), conflicts };
  });
}

function toConflict(table: TableName, id: string, c: Conflict, patch: Rec): PendingConflict {
  const myValues: Rec = {};
  for (const k of c.keys) myValues[k] = patch[k];
  return { id, table, keys: c.keys, serverValues: c.serverValues, myValues, updatedBy: c.updatedBy, updatedAt: c.updatedAt };
}

export function dismissConflict(id: string): void {
  setState((s) => ({ conflicts: s.conflicts.filter((c) => c.id !== id) }));
}

// ---- seçiciler ----
export const selectActiveItems = (s: AppState): Item[] => s.items.filter((i) => !i.deleted_at);
export const selectByTip = (tip: Item['tip']) => (s: AppState): Item[] => s.items.filter((i) => !i.deleted_at && i.tip === tip);
export const selectActiveCash = (s: AppState): CashEntry[] => s.cash.filter((c) => !c.deleted_at);
export const selectPendingCount = (s: AppState): number => s.outbox.length;
export const selectRejectedCount = (s: AppState): number => s.rejected.length;
/** Kayıt adı: kalem `ad`, ayar `anahtar`, harcama `kalem`; yoksa kimlik. Red/çakışma listeleri bunu gösterir. */
export function recordLabel(s: AppState, table: Table, id: string, fallback?: Rec): string {
  const row = (listOf(s, table).find((r) => String(r.id) === id) ?? fallback ?? {}) as Rec;
  const v = table === 'kalemler' ? row.ad : table === 'ayarlar' ? row.anahtar : row.kalem;
  return typeof v === 'string' && v.trim() ? v : id;
}
export const selectSetting = (tip: Setting['tip'], anahtar: string) => (s: AppState): Setting | undefined =>
  s.settings.find((x) => !x.deleted_at && x.tip === tip && x.anahtar === anahtar);
