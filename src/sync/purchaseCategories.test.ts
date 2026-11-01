import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { BatchRequest, ReadRequest } from '@shared/api';
import { ITEM_COLUMNS, ITEM_HEADERS, SETTING_COLUMNS, SETTING_HEADERS } from '@shared/schema';
import { applyBatch, createTableState, readState } from '../../gas/src/core';
import { configureController, refresh, stopSync, upsert } from './controller';
import { setApiUrl } from './config';
import { getState, resetStore, setState } from './store';
import * as cache from './cache';

const NOW = '2099-01-01T12:00:00.000Z';
beforeEach(() => {
  resetStore();
  setState({ hydrated: true });
  setApiUrl('');
  vi.spyOn(cache, 'saveOutbox').mockResolvedValue(true);
  vi.spyOn(cache, 'saveCache').mockResolvedValue(undefined);
});
afterEach(() => { stopSync(); configureController({}); vi.restoreAllMocks(); });

it('elle seçilen alt kategori gerçek controller kuyruğu, JSON API, GAS doğrulama/yazım/okuma turunda korunur', async () => {
  const st = { kalemler: createTableState(ITEM_COLUMNS, [...ITEM_HEADERS], []), ayarlar: createTableState(SETTING_COLUMNS, [...SETTING_HEADERS], []) };
  applyBatch(st, { action: 'batch', actor: 'setup', ops: [{ op: 'upsert', table: 'kalemler', id: 'SYNTH-WC', opId: 'setup', patch: { tip: 'satinalma', ad: 'WC fırçası ve çöp sepeti', kategori: 'kopek', not: 'Korunan not', gercek_tl: 321 } }] }, NOW);
  const requests: Array<BatchRequest | ReadRequest> = [];
  configureController({ now: () => NOW, fetchImpl: vi.fn(async (_url, init) => {
    const request = JSON.parse(String(init?.body)) as BatchRequest | ReadRequest;
    requests.push(request);
    const response = request.action === 'batch' ? applyBatch(st, request, NOW) : readState(st, request.fingerprint, NOW);
    return new Response(JSON.stringify(response), { status: 200 });
  }) });
  setApiUrl('https://script.google.com/macros/s/test/exec');
  await refresh();
  setApiUrl(''); // Henüz bağlantı yapılandırılmadan yapılan seçim mevcut çevrimdışı kuyruğunda kalır.
  upsert('kalemler', 'SYNTH-WC', { kategori: 'banyo_wc' });
  expect(getState().outbox).toHaveLength(1);
  expect(getState().items[0]).toMatchObject({ kategori: 'banyo_wc', not: 'Korunan not', gercek_tl: 321 });
  const queued = JSON.parse(JSON.stringify(getState().outbox));
  expect(queued[0].op.patch).toEqual({ kategori: 'banyo_wc' });
  setApiUrl('https://script.google.com/macros/s/test/exec');
  await refresh();
  await vi.waitFor(() => expect(getState().outbox).toEqual([]));
  expect(getState().rejected).toEqual([]);
  expect(requests.find(r => r.action === 'batch')).toMatchObject({ ops: [expect.objectContaining({ patch: { kategori: 'banyo_wc' } })] });
  expect(st.kalemler.rows[0]).toMatchObject({ kategori: 'banyo_wc', not: 'Korunan not', gercek_tl: 321 });
  setState({ fingerprint: undefined });
  await refresh();
  expect(getState().items[0]).toMatchObject({ kategori: 'banyo_wc', ad: 'WC fırçası ve çöp sepeti', not: 'Korunan not', gercek_tl: 321 });
});
