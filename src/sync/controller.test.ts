import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BatchRequest } from '@shared/api';
import { configureController, upsert } from './controller';
import { setApiUrl } from './config';
import { getState, resetStore, setState } from './store';

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

beforeEach(() => {
  resetStore();
  setApiUrl('https://script.google.com/macros/s/test/exec');
  setState({ hydrated: true, status: 'synced' });
});

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
