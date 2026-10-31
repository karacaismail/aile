// Senkron denetleyicisi: önbellek → canlı okuma → kuyruk boşaltma; görünürlük/online olaylarıyla tazeleme.
import { ulid } from '@shared/ids';
import type { Op, ReadResponse, BatchRequest, BatchResponse } from '@shared/api';
import type { Rec } from '@shared/convert';
import { SCHEMA_VERSION } from '@shared/schema';
import { ApiError, callApi } from './api';
import { getActor, getApiUrl, getAppKey, isApiConfigured } from './config';
import { loadCache, loadOutbox, saveCache, saveOutbox } from './cache';
import { backoffMs, flushOutbox, type QueuedOp } from './queue';
import { applyLocalOp, applyRead, applyServerResult, getState, recordLabel, setState } from './store';

let refreshing: Promise<void> | null = null;
let flushing: Promise<void> | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let started = false;
let syncGeneration = 0;
/** Her kalıcı redde artar; yenileme bunu görürse iyimser etkiyi sunucu gerçeğine döndürmek için bir tam okuma daha yapar. */
let rejectionGeneration = 0;
const listeners: Array<{ type: string; fn: () => void; target: 'document' | 'window' }> = [];

export interface ControllerDeps { fetchImpl?: typeof fetch; now?: () => string }
let deps: ControllerDeps = {};
export function configureController(d: ControllerDeps) { deps = d; }
const now = () => (deps.now ? deps.now() : new Date().toISOString());

/** Kuyruk dosyası bekleyenlerle birlikte reddedilenleri de taşır; red kaydı yeniden yüklemede ve okumada kaybolmaz. */
async function persistOutbox() { const s = getState(); await saveOutbox([...s.outbox, ...s.rejected]); }
async function persistCache() {
  const s = getState();
  await saveCache({ items: s.items, settings: s.settings, cash: s.cashSupported ? s.cash : undefined, plan: s.plan, fingerprint: s.fingerprint, savedAt: now(), schemaVersion: SCHEMA_VERSION });
}

export async function hydrate(): Promise<void> {
  // Sıcak yeniden giriş (aynı JS ömründe stopSync → startSync): store sıfırlanmaz ve bellek, diskteki kopyadan daha günceldir;
  // uçuştaki bir gönderimin red kaydı/düşürülmüş parmak izi eski kuyruk ve önbellek kopyasıyla ezilmez. Yalnız soğuk açılış disk okur.
  if (getState().hydrated) { if (!isApiConfigured()) setState({ status: 'unconfigured' }); return; }
  const [cache, saved] = await Promise.all([loadCache(), loadOutbox()]);
  setState({ outbox: saved.filter((q) => !q.rejection), rejected: saved.filter((q) => Boolean(q.rejection)) });
  if (cache && cache.schemaVersion === SCHEMA_VERSION) {
    applyRead({ ok: true, fingerprint: cache.fingerprint ?? '', serverTime: cache.savedAt, schemaVersion: cache.schemaVersion, items: cache.items, settings: cache.settings, cash: cache.cash, plan: cache.plan });
    setState({ lastSync: cache.savedAt });
  } else {
    setState({ hydrated: true });
  }
  if (!isApiConfigured()) setState({ status: 'unconfigured' });
}

async function readOnce(): Promise<void> {
  const res = await callApi<ReadResponse>(getApiUrl(), { action: 'read', key: getAppKey(), fingerprint: getState().fingerprint }, { fetchImpl: deps.fetchImpl });
  if (!res.notModified) { applyRead(res); await persistCache(); }
  // Başarılı okuma okuma hatasını temizler; bekleyen bir gönderimin hatasını (busy/ağ, kuyruk hâlâ dolu) silmez — bu bir
  // uzlaştırma okumasıdır, "Eşitlendi" demek yazımın da gittiğini söylerdi. Gönderim durumu bir sonraki flush sonucuyla güncellenir.
  setState((s) => (s.outbox.length && (s.status === 'error' || s.status === 'offline')
    ? { lastSync: res.serverTime }
    : { status: 'synced', lastSync: res.serverTime, lastError: undefined }));
}

export async function refresh(): Promise<void> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    if (!isApiConfigured()) { setState({ status: 'unconfigured' }); return; }
    setState((s) => ({ status: s.outbox.length ? 'syncing' : 'loading' }));
    const generation = rejectionGeneration;
    try {
      await readOnce();
      await flush();
      // Bu yenileme sırasında bir işlem kalıcı reddedildiyse iyimser değer listede kalmasın: parmak izi düşürüldü, tam oku.
      // Planlayıcı kapalıysa (stopSync) yeni istek yok; red kaydı ve düşürülmüş parmak izi saklandığından sonraki açılış tam okur.
      // Hızlı çıkıp geri dönüldüyse yeni oturumun yenilemesi bu uçuştaki yenilemeye katılmıştır; okuma yine burada yapılır (`started` yeter).
      if (rejectionGeneration !== generation && started) await readOnce();
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError('network', String(e), true);
      setState({ status: err.code === 'network' ? 'offline' : err.code === 'config' ? 'unconfigured' : 'error', lastError: err.message });
      if (err.retryable) scheduleRetry(1);
    }
  })().finally(() => { refreshing = null; });
  return refreshing;
}

function scheduleRetry(attempts: number) {
  if (!started) return;
  const generation = syncGeneration;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => { retryTimer = null; if (started && generation === syncGeneration) void refresh(); }, backoffMs(attempts));
}

export async function flush(opts: { keepalive?: boolean } = {}): Promise<void> {
  if (flushing) return flushing;
  const generation = rejectionGeneration;
  const lifetime = syncGeneration;
  flushing = (async () => {
    // Gönderim sürerken kuyruğa yeni işlem girebilir (ör. art arda iki upsert). Anlık görüntü dışında kalanlar
    // korunur ve aynı turda gönderilir; aksi halde `outbox: remaining` onları sessizce düşürürdü.
    for (;;) {
      const s = getState();
      if (!s.outbox.length || !isApiConfigured()) return;
      setState({ status: 'syncing' });
      const url = getApiUrl();
      const dropped: QueuedOp[] = [];
      const outcome = await flushOutbox(s.outbox, {
        actor: getActor(),
        key: getAppKey(),
        send: (req: BatchRequest) => callApi<BatchResponse>(url, req, { fetchImpl: deps.fetchImpl, keepalive: opts.keepalive }),
        onResult: (op, r) => applyServerResult(op, r),
        // Sunucu bu işlemi kalıcı reddetti: kuyruktan çıkar ama atma. Kayıt adı red anında (iyimser satır hâlâ yerelde) alınır.
        onDrop: (op, err) => {
          const cur = getState();
          const source = s.outbox.find((q) => q.op.opId === op.opId);
          const label = recordLabel(cur, op.table, op.id, op.op === 'upsert' ? op.patch : undefined);
          dropped.push({ op, ts: source?.ts ?? now(), attempts: source?.attempts ?? 0, rejection: { at: now(), code: err.code, message: err.message, label } });
        },
      });
      if (dropped.length) rejectionGeneration += 1;
      const sent = new Set(s.outbox.map((q) => q.op.opId));
      setState((cur) => ({
        outbox: [...outcome.remaining, ...cur.outbox.filter((q) => !sent.has(q.op.opId))],
        rejected: [...cur.rejected, ...dropped],
        status: outcome.error ? (outcome.error.code === 'network' ? 'offline' : 'error') : 'synced',
        lastError: outcome.error?.message,
        // Reddedilen işlemin iyimser etkisi listede "kaydedilmiş" gibi kalmasın: bir sonraki okuma tam okuma olur.
        ...(dropped.length ? { fingerprint: undefined } : {}),
      }));
      await persistOutbox();
      await persistCache();
      if (outcome.error) {
        if (outcome.error.retryable) scheduleRetry(Math.max(1, ...outcome.remaining.map((q) => q.attempts)));
        return;
      }
      if (getState().outbox.length === outcome.remaining.length) return;
    }
  })().finally(() => {
    flushing = null;
    // Kendi başına çağrılan gönderimde (enqueue/yeniden dene) red olduysa listeyi sunucu gerçeğine döndür; yenileme içindeysek o yapar.
    // Planlayıcı kapandıysa (stopSync) yeni istek başlatılmaz; parmak izi düşürülüp saklandığı için sonraki açılış zaten tam okur.
    if (rejectionGeneration !== generation && !refreshing && started && lifetime === syncGeneration) void refresh();
  });
  return flushing;
}

export function enqueue(op: Op): void {
  const ts = now();
  applyLocalOp(op, ts);
  // Kuyruk sınırsızdır: hiçbir bekleyen işlem atılmaz. Olağandan uzun kuyruğu arayüz `OUTBOX_WARN` ile bildirir.
  setState((s) => ({ outbox: [...s.outbox, { op, ts, attempts: 0 }] }));
  void persistOutbox();
  void persistCache();
  void flush();
}

/** Reddedilen işlemi aynı opId ile kuyruğa geri koyar ve gönderir; yeniden reddedilirse yine listelenir (otomatik döngü yok). */
export async function retryRejected(opId: string): Promise<void> {
  const entry = getState().rejected.find((q) => q.op.opId === opId);
  if (!entry) return;
  const { rejection: _rejection, ...queued } = entry;
  setState((s) => ({ rejected: s.rejected.filter((q) => q.op.opId !== opId), outbox: [...s.outbox, { ...queued, attempts: 0 }] }));
  applyLocalOp(entry.op, entry.ts);
  await persistOutbox();
  await persistCache();
  await flush();
}

/** Kullanıcının bilerek vazgeçtiği reddi siler; yalnız onaylı arayüz eyleminden çağrılır. */
export async function discardRejected(opId: string): Promise<void> {
  setState((s) => ({ rejected: s.rejected.filter((q) => q.op.opId !== opId) }));
  await persistOutbox();
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
  const generation = ++syncGeneration;
  void hydrate().then(() => { if (started && generation === syncGeneration) return refresh(); });
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
  syncGeneration += 1;
  if (timer) clearInterval(timer);
  if (retryTimer) clearTimeout(retryTimer);
  timer = null; retryTimer = null;
  for (const l of listeners) (l.target === 'document' ? document : window).removeEventListener(l.type, l.fn);
  listeners.length = 0;
}
