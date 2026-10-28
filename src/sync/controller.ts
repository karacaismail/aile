// Senkron denetleyicisi: önbellek → canlı okuma → kuyruk boşaltma; görünürlük/online olaylarıyla tazeleme.
import { ulid } from '@shared/ids';
import type { Op, ReadResponse, BatchRequest, BatchResponse } from '@shared/api';
import type { Rec } from '@shared/convert';
import { SCHEMA_VERSION } from '@shared/schema';
import { ApiError, callApi } from './api';
import { getActor, getApiUrl, getAppKey, isApiConfigured } from './config';
import { loadCache, loadOutbox, saveCache, saveOutbox } from './cache';
import { backoffMs, flushOutbox, MAX_OUTBOX } from './queue';
import { applyLocalOp, applyRead, applyServerResult, getState, setState } from './store';

let refreshing: Promise<void> | null = null;
let flushing: Promise<void> | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let started = false;
const listeners: Array<{ type: string; fn: () => void; target: 'document' | 'window' }> = [];

export interface ControllerDeps { fetchImpl?: typeof fetch; now?: () => string }
let deps: ControllerDeps = {};
export function configureController(d: ControllerDeps) { deps = d; }
const now = () => (deps.now ? deps.now() : new Date().toISOString());

async function persistOutbox() { await saveOutbox(getState().outbox); }
async function persistCache() {
  const s = getState();
  await saveCache({ items: s.items, settings: s.settings, cash: s.cashSupported ? s.cash : undefined, plan: s.plan, fingerprint: s.fingerprint, savedAt: now(), schemaVersion: SCHEMA_VERSION });
}

export async function hydrate(): Promise<void> {
  const [cache, outbox] = await Promise.all([loadCache(), loadOutbox()]);
  setState({ outbox });
  if (cache && cache.schemaVersion === SCHEMA_VERSION) {
    applyRead({ ok: true, fingerprint: cache.fingerprint ?? '', serverTime: cache.savedAt, schemaVersion: cache.schemaVersion, items: cache.items, settings: cache.settings, cash: cache.cash, plan: cache.plan });
    setState({ lastSync: cache.savedAt });
  } else {
    setState({ hydrated: true });
  }
  if (!isApiConfigured()) setState({ status: 'unconfigured' });
}

export async function refresh(): Promise<void> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    if (!isApiConfigured()) { setState({ status: 'unconfigured' }); return; }
    setState((s) => ({ status: s.outbox.length ? 'syncing' : 'loading' }));
    try {
      const res = await callApi<ReadResponse>(getApiUrl(), { action: 'read', key: getAppKey(), fingerprint: getState().fingerprint }, { fetchImpl: deps.fetchImpl });
      if (!res.notModified) { applyRead(res); await persistCache(); }
      setState({ status: 'synced', lastSync: res.serverTime, lastError: undefined });
      await flush();
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError('network', String(e), true);
      setState({ status: err.code === 'network' ? 'offline' : err.code === 'config' ? 'unconfigured' : 'error', lastError: err.message });
      if (err.retryable) scheduleRetry(1);
    }
  })().finally(() => { refreshing = null; });
  return refreshing;
}

function scheduleRetry(attempts: number) {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => { retryTimer = null; void refresh(); }, backoffMs(attempts));
}

export async function flush(opts: { keepalive?: boolean } = {}): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    // Gönderim sürerken kuyruğa yeni işlem girebilir (ör. art arda iki upsert). Anlık görüntü dışında kalanlar
    // korunur ve aynı turda gönderilir; aksi halde `outbox: remaining` onları sessizce düşürürdü.
    for (;;) {
      const s = getState();
      if (!s.outbox.length || !isApiConfigured()) return;
      setState({ status: 'syncing' });
      const url = getApiUrl();
      const outcome = await flushOutbox(s.outbox, {
        actor: getActor(),
        key: getAppKey(),
        send: (req: BatchRequest) => callApi<BatchResponse>(url, req, { fetchImpl: deps.fetchImpl, keepalive: opts.keepalive }),
        onResult: (op, r) => applyServerResult(op, r),
        onDrop: (op, err) => { setState({ lastError: `${op.op} ${op.id}: ${err.message}` }); },
      });
      const sent = new Set(s.outbox.map((q) => q.op.opId));
      const added = getState().outbox.filter((q) => !sent.has(q.op.opId));
      setState({ outbox: [...outcome.remaining, ...added], status: outcome.error ? (outcome.error.code === 'network' ? 'offline' : 'error') : 'synced', lastError: outcome.error?.message });
      await persistOutbox();
      await persistCache();
      if (outcome.error) {
        if (outcome.error.retryable) scheduleRetry(Math.max(1, ...outcome.remaining.map((q) => q.attempts)));
        return;
      }
      if (!added.length) return;
    }
  })().finally(() => { flushing = null; });
  return flushing;
}

export function enqueue(op: Op): void {
  const ts = now();
  applyLocalOp(op, ts);
  setState((s) => {
    const outbox = [...s.outbox, { op, ts, attempts: 0 }];
    if (outbox.length > MAX_OUTBOX) outbox.splice(0, outbox.length - MAX_OUTBOX);
    return { outbox };
  });
  void persistOutbox();
  void persistCache();
  void flush();
}

export function upsert(table: Op['table'], id: string | undefined, patch: Rec): string {
  const rid = id ?? ulid();
  const s = getState();
  const list: Array<{ id: string; version?: number }> = table === 'kalemler' ? s.items : table === 'ayarlar' ? s.settings : s.cash;
  const base = list.find((i) => i.id === rid);
  enqueue({ op: 'upsert', table, id: rid, opId: ulid(), baseVersion: base?.version, patch });
  return rid;
}
export function remove(table: Op['table'], id: string): void { enqueue({ op: 'delete', table, id, opId: ulid() }); }
export function restore(table: Op['table'], id: string): void { enqueue({ op: 'restore', table, id, opId: ulid() }); }

export function startSync(): () => void {
  if (started) return stopSync;
  started = true;
  void hydrate().then(() => refresh());
  const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); else void flush({ keepalive: true }); };
  const onOnline = () => { void refresh(); };
  const onHide = () => { void flush({ keepalive: true }); };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('online', onOnline);
  window.addEventListener('pagehide', onHide);
  listeners.push({ type: 'visibilitychange', fn: onVisible, target: 'document' }, { type: 'online', fn: onOnline, target: 'window' }, { type: 'pagehide', fn: onHide, target: 'window' });
  timer = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 60_000);
  return stopSync;
}

export function stopSync(): void {
  started = false;
  if (timer) clearInterval(timer);
  if (retryTimer) clearTimeout(retryTimer);
  timer = null; retryTimer = null;
  for (const l of listeners) (l.target === 'document' ? document : window).removeEventListener(l.type, l.fn);
  listeners.length = 0;
}
