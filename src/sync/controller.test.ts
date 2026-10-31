import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ApiErrorCode, BatchRequest, ReadRequest } from '@shared/api';
import type { Item } from '@shared/schema';
import { configureController, discardRejected, hydrate, refresh, retryRejected, startSync, stopSync, upsert } from './controller';
import { setApiUrl } from './config';
import { getState, resetStore, setState } from './store';
import type { QueuedOp } from './queue';
import * as cache from './cache';

/** Sahte API: ilk batch'i `release()` çağrılana dek bekletir; her upsert'i olduğu gibi kabul eder. */
function fakeApi() {
  const batches: BatchRequest[] = [];
  let release: () => void = () => {};
  const first = new Promise<void>((r) => { release = r; });
  const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const req = JSON.parse(String(init?.body)) as BatchRequest;
    batches.push(req);
    if (batches.length === 1) await first;
    const results = req.ops.map((o) => ({ ok: true, id: o.id, row: { id: o.id, ...(o.op === 'upsert' ? o.patch : {}), version: 1 } }));
    return new Response(JSON.stringify({ ok: true, doneCount: results.length, fingerprint: `f${batches.length}`, serverTime: 't', results }), { status: 200 });
  });
  return { batches, release: () => release(), fetchImpl: fetchImpl as unknown as typeof fetch };
}

type Rejection = { code: ApiErrorCode; message: string };
/**
 * Sahte API (okuma + batch): `reject[id]` tanımlı işlemleri sunucu gibi kalıcı reddeder (sıradaki ilk hatada durur,
 * `doneCount` o ana kadar), diğerlerini kabul eder. Okuma `server` listesini döndürür; `offline` iken her istek ağ hatası.
 */
function rejectingApi(opts: { reject?: Record<string, Rejection>; server?: Item[]; offline?: boolean } = {}) {
  const state = { reject: { ...(opts.reject ?? {}) }, server: [...(opts.server ?? [])], offline: opts.offline ?? false, rev: 1 };
  const reads: ReadRequest[] = [];
  const batches: BatchRequest[] = [];
  const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    if (state.offline) throw new TypeError('Failed to fetch');
    const req = JSON.parse(String(init?.body)) as ReadRequest | BatchRequest;
    if (req.action === 'read') {
      reads.push(req);
      const fp = `srv-${state.rev}`;
      if (req.fingerprint && req.fingerprint === fp) return new Response(JSON.stringify({ ok: true, notModified: true, fingerprint: fp, serverTime: 't', schemaVersion: 2 }), { status: 200 });
      return new Response(JSON.stringify({ ok: true, fingerprint: fp, serverTime: 't', schemaVersion: 2, items: state.server, settings: [], cash: [] }), { status: 200 });
    }
    batches.push(req);
    const results: Array<Record<string, unknown>> = [];
    let doneCount = 0; let error: ApiErrorCode | undefined; let message: string | undefined;
    for (const o of req.ops) {
      const r = state.reject[o.id];
      if (r) { results.push({ ok: false, id: o.id, error: r.code, message: r.message }); error = r.code; message = r.message; break; }
      const row: Record<string, unknown> = { id: o.id, ...(o.op === 'upsert' ? o.patch : {}), version: 1 };
      const i = state.server.findIndex((x) => x.id === o.id);
      if (i >= 0) state.server[i] = { ...state.server[i], ...row } as Item; else state.server.push(row as unknown as Item);
      state.rev++;
      results.push({ ok: true, id: o.id, row });
      doneCount++;
    }
    return new Response(JSON.stringify({ ok: !error, doneCount, fingerprint: `srv-${state.rev}`, serverTime: 't', results, error, message }), { status: 200 });
  });
  return { state, reads, batches, fetchImpl: fetchImpl as unknown as typeof fetch };
}

const NOT_FOUND: Rejection = { code: 'not_found', message: "Kayıt bulunamadı (Sheets'te silinmiş olabilir)" };
const BAD_ENUM: Rejection = { code: 'invalid_enum', message: 'durum: izinli değerler fikir, karar' };

beforeEach(() => {
  resetStore();
  setApiUrl('https://script.google.com/macros/s/test/exec');
  setState({ hydrated: true, status: 'synced' });
  vi.spyOn(cache, 'saveOutbox').mockResolvedValue(undefined);
  vi.spyOn(cache, 'saveCache').mockResolvedValue(undefined);
  vi.spyOn(cache, 'loadCache').mockResolvedValue(undefined);
  vi.spyOn(cache, 'loadOutbox').mockResolvedValue([]);
});
afterEach(() => { stopSync(); vi.restoreAllMocks(); });

describe('flush', () => {
  it('gönderim sürerken kuyruğa giren işlem kaybolmaz; ikinci turda gönderilir', async () => {
    const api = fakeApi();
    configureController({ fetchImpl: api.fetchImpl });
    upsert('kalemler', 'A', { tip: 'satinalma', ad: 'Priz' }); // ilk batch yola çıkar ve bekler
    upsert('kalemler', 'B', { adet: 4 }); // gönderim sırasında eklendi
    expect(getState().outbox.map((q) => q.op.id)).toEqual(['A', 'B']);
    api.release();
    await vi.waitFor(() => expect(api.batches).toHaveLength(2));
    expect(api.batches[0].ops.map((o) => o.id)).toEqual(['A']);
    expect(api.batches[1].ops.map((o) => o.id)).toEqual(['B']);
    await vi.waitFor(() => expect(getState().outbox).toEqual([]));
    expect(getState().status).toBe('synced');
    expect(getState().items.find((i) => i.id === 'B')).toMatchObject({ adet: 4, version: 1 });
  });
});

describe('kalıcı red: sessiz kayıp yok', () => {
  it('sunucunun reddettiği yazım kuyruktan düşmez: patch ve nedeniyle `rejected` listesine geçer, durum sahte başarı değildir', async () => {
    const api = rejectingApi({ reject: { A: BAD_ENUM } });
    configureController({ fetchImpl: api.fetchImpl });
    setState({ items: [{ id: 'A', tip: 'satinalma', ad: 'Perde', version: 2 }] });
    upsert('kalemler', 'A', { durum: 'yanlis' });
    await vi.waitFor(() => expect(api.batches).toHaveLength(1));
    await vi.waitFor(() => expect(getState().outbox).toEqual([]));
    expect(getState().rejected).toHaveLength(1);
    expect(getState().rejected[0]).toMatchObject({
      op: { op: 'upsert', table: 'kalemler', id: 'A', patch: { durum: 'yanlis' }, baseVersion: 2 },
      rejection: { code: 'invalid_enum', message: BAD_ENUM.message, label: 'Perde' },
    });
    expect(getState().rejected[0].rejection?.at).toBeTruthy();
    // Red bir taşıma hatası değildir: `lastError` yalnız ağ/sunucu geneli için.
    expect(getState().lastError).toBeUndefined();
    // Reddedilen işlem de kalıcıdır: kuyruk dosyası bekleyenlerle birlikte red kaydını taşır.
    const saved = vi.mocked(cache.saveOutbox).mock.calls.at(-1)?.[0] as QueuedOp[];
    expect(saved.map((q) => q.op.opId)).toEqual([getState().rejected[0].op.opId]);
    expect(saved[0].rejection?.code).toBe('invalid_enum');
  });

  it('red sonrası liste sunucu gerçeğine döner (tam okuma), red kaydı okumayla silinmez', async () => {
    const api = rejectingApi({ reject: { A: BAD_ENUM }, server: [{ id: 'A', tip: 'satinalma', ad: 'Perde', durum: 'karar', version: 2 }] });
    configureController({ fetchImpl: api.fetchImpl });
    // Gerçek yaşam döngüsü: planlayıcı açık (startSync) — ilk okuma gelir, sonra kullanıcı düzenler.
    startSync();
    await vi.waitFor(() => expect(getState().fingerprint).toBe('srv-1'));
    upsert('kalemler', 'A', { durum: 'yanlis' });
    expect(getState().items[0].durum).toBe('yanlis'); // optimistic
    await vi.waitFor(() => expect(getState().rejected).toHaveLength(1));
    // Parmak izi değişmediği için normal okuma `notModified` dönerdi; red, tam okumayı zorlar ve iyimser değer sunucu değerine döner.
    await vi.waitFor(() => expect(getState().items[0].durum).toBe('karar'));
    expect(api.reads.at(-1)?.fingerprint).toBeUndefined();
    expect(getState().rejected).toHaveLength(1);
    expect(getState().status).toBe('synced');
    // Sonraki rutin okuma da red kaydını silmez.
    await refresh();
    expect(getState().rejected).toHaveLength(1);
  });

  it('sayfa yeniden yüklenince red kaydı kuyruk dosyasından ayrılarak geri gelir ve sonraki yazımda birlikte saklanır', async () => {
    const pending: QueuedOp = { op: { op: 'upsert', table: 'kalemler', id: 'B', opId: 'op-b', patch: { adet: 2 } }, ts: 't', attempts: 0 };
    const rejected: QueuedOp = { op: { op: 'upsert', table: 'kalemler', id: 'A', opId: 'op-a', patch: { durum: 'yanlis' } }, ts: 't', attempts: 0, rejection: { at: 't2', code: 'invalid_enum', message: BAD_ENUM.message, label: 'Perde' } };
    vi.mocked(cache.loadOutbox).mockResolvedValue([pending, rejected]);
    const api = rejectingApi({ offline: true });
    configureController({ fetchImpl: api.fetchImpl });
    setState({ hydrated: false }); // sayfa yeniden yüklendi: soğuk açılış, store boş
    await hydrate();
    expect(getState().outbox.map((q) => q.op.opId)).toEqual(['op-b']);
    expect(getState().rejected.map((q) => q.op.opId)).toEqual(['op-a']);
    upsert('kalemler', 'C', { tip: 'satinalma', ad: 'Yeni' });
    const saved = vi.mocked(cache.saveOutbox).mock.calls.at(-1)?.[0] as QueuedOp[];
    expect(saved.filter((q) => !q.rejection).map((q) => q.op.id)).toEqual(['B', 'C']);
    expect(saved.filter((q) => q.rejection).map((q) => q.op.opId)).toEqual(['op-a']);
  });

  it('yeniden dene: aynı opId kuyruğa döner ve kabul edilirse red kapanır; yeniden reddedilirse tekrar listelenir, otomatik döngü yok', async () => {
    const api = rejectingApi({ reject: { A: NOT_FOUND } });
    configureController({ fetchImpl: api.fetchImpl });
    setState({ items: [{ id: 'A', tip: 'satinalma', ad: 'Perde', version: 2 }] });
    upsert('kalemler', 'A', { adet: 3 });
    await vi.waitFor(() => expect(getState().rejected).toHaveLength(1));
    const opId = getState().rejected[0].op.opId;
    // Neden sürüyor → aynı red, kuyruk boş, başka istek yok.
    const before = api.batches.length;
    await retryRejected(opId);
    await vi.waitFor(() => expect(api.batches.length).toBe(before + 1));
    await vi.waitFor(() => expect(getState().rejected).toHaveLength(1));
    expect(getState().outbox).toEqual([]);
    expect(api.batches.at(-1)?.ops.map((o) => o.opId)).toEqual([opId]);
    await new Promise((r) => setTimeout(r, 20));
    expect(api.batches.length).toBe(before + 1);
    // Neden giderildi (satır Sheets'te geri geldi) → aynı işlem kabul edilir, red kapanır.
    delete api.state.reject.A;
    await retryRejected(opId);
    await vi.waitFor(() => expect(getState().rejected).toEqual([]));
    expect(getState().outbox).toEqual([]);
    expect(api.state.server.find((i) => i.id === 'A')).toMatchObject({ adet: 3 });
  });

  it('vazgeç: yalnız seçilen red silinir ve kuyruk dosyası güncellenir', async () => {
    const api = rejectingApi({ reject: { A: NOT_FOUND, B: BAD_ENUM } });
    configureController({ fetchImpl: api.fetchImpl });
    upsert('kalemler', 'A', { adet: 3 });
    await vi.waitFor(() => expect(getState().rejected).toHaveLength(1));
    upsert('kalemler', 'B', { adet: 4 });
    await vi.waitFor(() => expect(getState().rejected).toHaveLength(2));
    const [a, b] = getState().rejected.map((q) => q.op.opId);
    await discardRejected(a);
    expect(getState().rejected.map((q) => q.op.opId)).toEqual([b]);
    const saved = vi.mocked(cache.saveOutbox).mock.calls.at(-1)?.[0] as QueuedOp[];
    expect(saved.map((q) => q.op.opId)).toEqual([b]);
  });
});

describe('kalıcı red: kuyruğun başını tıkamaz', () => {
  it('reddedilen işlemin ardındaki işlemler aynı turda gönderilir; red her yenilemede yeniden denenmez', async () => {
    const api = rejectingApi({ reject: { A: NOT_FOUND } });
    configureController({ fetchImpl: api.fetchImpl });
    upsert('kalemler', 'A', { adet: 3 });
    upsert('kalemler', 'B', { tip: 'satinalma', ad: 'Arkadaki' });
    await vi.waitFor(() => expect(getState().outbox).toEqual([]));
    expect(getState().rejected.map((q) => q.op.id)).toEqual(['A']);
    expect(api.state.server.find((i) => i.id === 'B')).toMatchObject({ ad: 'Arkadaki' });
    expect(getState().status).toBe('synced');
    const sentBatches = api.batches.length;
    await refresh();
    expect(api.batches.length).toBe(sentBatches); // reddedilen işlem kendiliğinden yeniden gönderilmez
    expect(getState().rejected).toHaveLength(1);
  });
});

describe('kuyruk sınırı', () => {
  it('201 bekleyen işlemde en eski işlem sessizce atılmaz', () => {
    const api = rejectingApi({ offline: true });
    configureController({ fetchImpl: api.fetchImpl });
    for (let i = 0; i < 201; i++) upsert('kalemler', `K${i}`, { tip: 'satinalma', ad: `Kalem ${i}` });
    expect(getState().outbox).toHaveLength(201);
    expect(getState().outbox[0].op.id).toBe('K0');
    expect(getState().items.find((x) => x.id === 'K0')).toMatchObject({ ad: 'Kalem 0' });
  });
});
