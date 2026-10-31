import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureController, startSync, stopSync } from './controller';
import { setApiUrl } from './config';
import { resetStore, getState } from './store';
import { upsert } from './controller';
import * as cache from './cache';

beforeEach(() => {
  stopSync(); resetStore();
  setApiUrl('https://script.google.com/macros/s/test/exec');
  vi.spyOn(cache, 'loadCache').mockResolvedValue(undefined);
  vi.spyOn(cache, 'loadOutbox').mockResolvedValue([]);
});
afterEach(() => { stopSync(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('planner route sync lifetime', () => {
  it('leaving while cache hydrates does not start a request on the next page', async () => {
    let release!: () => void;
    vi.mocked(cache.loadCache).mockImplementation(() => new Promise(resolve => { release = () => resolve(undefined); }));
    const fetchImpl = vi.fn();
    configureController({ fetchImpl });
    const stop = startSync(); stop(); release();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('a batch rejected after the planner closes keeps the rejection but starts no follow-up read', async () => {
    let answer!: () => void;
    const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((resolve) => {
      const body = JSON.parse(String(init?.body)) as { action: string; ops?: Array<{ id: string }> };
      if (body.action === 'read') { resolve(new Response(JSON.stringify({ ok: true, fingerprint: 'f1', serverTime: 't', schemaVersion: 2, items: [], settings: [], cash: [] }), { status: 200 })); return; }
      answer = () => resolve(new Response(JSON.stringify({ ok: false, doneCount: 0, fingerprint: 'f1', serverTime: 't', error: 'not_found', message: 'Kayıt bulunamadı', results: [{ ok: false, id: body.ops![0].id, error: 'not_found', message: 'Kayıt bulunamadı' }] }), { status: 200 }));
    }));
    configureController({ fetchImpl });
    const stop = startSync();
    await vi.waitFor(() => expect(getState().fingerprint).toBe('f1'));
    upsert('kalemler', 'A', { adet: 2 }); // batch yola çıktı, yanıt bekleniyor
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    stop(); answer();
    await vi.waitFor(() => expect(getState().rejected).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchImpl).toHaveBeenCalledTimes(2); // kapanıştan sonra tam okuma başlatılmaz
    expect(getState().fingerprint).toBeUndefined(); // sonraki açılış tam okur
  });

  it('a rejection inside the refresh-owned flush after the planner closes does not start the reconciling read', async () => {
    // Açılışta kuyrukta bekleyen işlem var: refresh → okuma → kendi flush'ı (batch yolda) → kullanıcı sayfadan çıkar → red gelir.
    vi.mocked(cache.loadOutbox).mockResolvedValue([{ op: { op: 'upsert', opId: 'queued-A', table: 'kalemler', id: 'A', patch: { adet: 2 }, baseVersion: 1 }, ts: 't', attempts: 0 }]);
    let answer!: () => void;
    const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((resolve) => {
      const body = JSON.parse(String(init?.body)) as { action: string; ops?: Array<{ id: string }> };
      if (body.action === 'read') { resolve(new Response(JSON.stringify({ ok: true, fingerprint: 'f1', serverTime: 't', schemaVersion: 2, items: [], settings: [], cash: [] }), { status: 200 })); return; }
      answer = () => resolve(new Response(JSON.stringify({ ok: false, doneCount: 0, fingerprint: 'f1', serverTime: 't', error: 'not_found', message: 'Kayıt bulunamadı', results: [{ ok: false, id: body.ops![0].id, error: 'not_found', message: 'Kayıt bulunamadı' }] }), { status: 200 }));
    }));
    configureController({ fetchImpl });
    const stop = startSync();
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2)); // read + batch
    stop(); answer();
    await vi.waitFor(() => expect(getState().rejected).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fetchImpl.mock.calls.map(([, init]) => (JSON.parse(String(init?.body)) as { action: string }).action)).toEqual(['read', 'batch']);
    expect(getState().rejected[0].op.opId).toBe('queued-A'); // red kaydı durur
    expect(getState().fingerprint).toBeUndefined(); // sonraki açılış tam okur
  });

  it('leaving and re-entering before the rejected batch answers still reconciles the list with one full read', async () => {
    vi.mocked(cache.loadOutbox).mockResolvedValue([{ op: { op: 'upsert', opId: 'queued-A', table: 'kalemler', id: 'A', patch: { adet: 2 }, baseVersion: 1 }, ts: 't', attempts: 0 }]);
    let answer!: () => void;
    const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((resolve) => {
      const body = JSON.parse(String(init?.body)) as { action: string; fingerprint?: string; ops?: Array<{ id: string }> };
      if (body.action === 'read') { resolve(new Response(JSON.stringify({ ok: true, fingerprint: 'f1', serverTime: 't', schemaVersion: 2, items: [], settings: [], cash: [] }), { status: 200 })); return; }
      answer = () => resolve(new Response(JSON.stringify({ ok: false, doneCount: 0, fingerprint: 'f1', serverTime: 't', error: 'not_found', message: 'Kayıt bulunamadı', results: [{ ok: false, id: body.ops![0].id, error: 'not_found', message: 'Kayıt bulunamadı' }] }), { status: 200 }));
    }));
    configureController({ fetchImpl });
    const stop = startSync();
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2)); // read + batch (yolda)
    stop();
    startSync(); // kullanıcı hemen geri döner; yeni yenileme uçuştaki eskiye katılır
    await new Promise((resolve) => setTimeout(resolve, 0)); // katılımı sabitler: yeni oturumun hydrate→refresh zinciri yanıt gelmeden tamamlanır
    answer();
    await vi.waitFor(() => expect(getState().rejected).toHaveLength(1));
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(3));
    const calls = fetchImpl.mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as { action: string; fingerprint?: string });
    expect(calls.map((c) => c.action)).toEqual(['read', 'batch', 'read']);
    expect(calls[2].fingerprint).toBeUndefined(); // planlayıcı açık: iyimser değer sunucu gerçeğine döner
  });

  it('re-entering while the rejected answer lands before the warm hydrate does not revive the op as pending or restore the stale fingerprint', async () => {
    const queued = { op: { op: 'upsert' as const, opId: 'queued-A', table: 'kalemler' as const, id: 'A', patch: { adet: 2 }, baseVersion: 1 }, ts: 't', attempts: 0 };
    let releaseHydrate!: () => void;
    const held = new Promise<typeof queued[]>((resolve) => { releaseHydrate = () => resolve([queued]); });
    vi.mocked(cache.loadOutbox).mockResolvedValueOnce([queued]).mockImplementationOnce(() => held); // ikinci (sıcak) hydrate IDB'yi geç okur
    vi.mocked(cache.loadCache).mockResolvedValueOnce(undefined).mockResolvedValueOnce({ items: [{ id: 'A', tip: 'satinalma', ad: 'Perde', adet: 2 }], settings: [], fingerprint: 'f1', savedAt: 't', schemaVersion: 2 });
    let answer!: () => void;
    const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((resolve) => {
      const body = JSON.parse(String(init?.body)) as { action: string; ops?: Array<{ id: string }> };
      if (body.action === 'read') { resolve(new Response(JSON.stringify({ ok: true, fingerprint: 'f1', serverTime: 't', schemaVersion: 2, items: [], settings: [], cash: [] }), { status: 200 })); return; }
      answer = () => resolve(new Response(JSON.stringify({ ok: false, doneCount: 0, fingerprint: 'f1', serverTime: 't', error: 'not_found', message: 'Kayıt bulunamadı', results: [{ ok: false, id: body.ops![0].id, error: 'not_found', message: 'Kayıt bulunamadı' }] }), { status: 200 }));
    }));
    configureController({ fetchImpl });
    const stop = startSync();
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    stop();
    startSync();
    answer(); // red, sıcak hydrate'in IDB okuması bitmeden gelir
    await vi.waitFor(() => expect(getState().rejected).toHaveLength(1));
    releaseHydrate();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(getState().rejected.map((q) => q.op.opId)).toEqual(['queued-A']); // bellekteki red kaydı eski kuyruk kopyasıyla ezilmez
    expect(getState().outbox).toEqual([]);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(3));
    const calls = fetchImpl.mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as { action: string; fingerprint?: string });
    expect(calls.map((c) => c.action)).toEqual(['read', 'batch', 'read']);
    expect(calls[2].fingerprint).toBeUndefined(); // eski kopyanın parmak izi geri gelmez; tam okuma
  });

  it('a failed pending request cannot restart polling after the planner closes', async () => {
    vi.useFakeTimers();
    let reject!: (reason: Error) => void;
    const fetchImpl = vi.fn(() => new Promise<Response>((_, fail) => { reject = fail; }));
    configureController({ fetchImpl });
    const stop = startSync();
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    stop(); reject(new Error('Network disconnected'));
    await vi.waitFor(() => expect(getState().status).toBe('offline'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
