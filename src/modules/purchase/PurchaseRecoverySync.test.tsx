import { afterEach, expect, it, vi } from 'vitest';
import { act, render, screen, userEvent } from '@/test-utils/render';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { notifications } from '@mantine/notifications';
import type { BatchRequest } from '@shared/api';
import { ITEM_COLUMNS, ITEM_HEADERS, SETTING_COLUMNS, SETTING_HEADERS, type Item } from '@shared/schema';
import { applyBatch, createTableState } from '../../../gas/src/core';
import { configureController, flush, stopSync } from '@/sync/controller';
import { setApiUrl } from '@/sync/config';
import { getState, resetStore, setState } from '@/sync/store';
import * as cache from '@/sync/cache';
import { PurchaseList } from './PurchaseList';

vi.mock('@mantine/notifications', () => ({ notifications: { show: vi.fn(), hide: vi.fn() } }));
afterEach(() => { stopSync(); vi.restoreAllMocks(); localStorage.clear(); });
it('roundtrips a missing status through the real offline controller, JSON queue and server patch implementation', async () => {
  resetStore(); localStorage.clear();
  setApiUrl('https://script.google.com/macros/s/test/exec');
  vi.spyOn(cache, 'saveOutbox').mockResolvedValue(true);
  vi.spyOn(cache, 'saveCache').mockResolvedValue(undefined);
  configureController({ fetchImpl: vi.fn(async () => { throw new TypeError('offline'); }) });
  const item: Item = { id: 'missing-status', tip: 'satinalma', ad: 'Durumsuz kalem', version: 1, not: 'Korunacak not' };
  setState({ hydrated: true, status: 'synced', items: [item] });
  const { hook } = memoryLocation({ path: '/satinalma' });
  render(<Router hook={hook}><PurchaseList /></Router>);
  await userEvent.click(screen.getByRole('checkbox', { name: 'Durumsuz kalem alındı' }));
  await act(async () => { await flush(); });
  render(<>{vi.mocked(notifications.show).mock.calls.at(-1)![0].message}</>);
  await userEvent.click(screen.getByRole('button', { name: 'Geri al' }));
  await act(async () => { await flush(); });
  expect(getState().items[0].durum).toBeUndefined();
  expect(getState().outbox.at(-1)?.op).toMatchObject({ patch: { durum: null } });
  expect(JSON.stringify(vi.mocked(cache.saveOutbox).mock.calls.at(-1)?.[0])).toContain('"durum":null');

  const server = {
    kalemler: createTableState(ITEM_COLUMNS, [...ITEM_HEADERS], []),
    ayarlar: createTableState(SETTING_COLUMNS, [...SETTING_HEADERS], []),
  };
  applyBatch(server, { action: 'batch', actor: 'test', ops: [{ op: 'upsert', table: 'kalemler', id: item.id, opId: 'seed', patch: { tip: item.tip, ad: item.ad, not: item.not } }] }, '2026-11-01T08:00:00Z');
  const sent: BatchRequest[] = [];
  configureController({ fetchImpl: vi.fn(async (_url, init) => {
    const request = JSON.parse(String(init?.body)) as BatchRequest;
    sent.push(request);
    return new Response(JSON.stringify(applyBatch(server, request, '2026-11-01T08:01:00Z')), { status: 200 });
  }) });
  await act(async () => { await flush(); });
  expect(sent[0].ops).toHaveLength(1);
  expect(sent[0].ops[0]).toMatchObject({ patch: { durum: null } });
  expect(server.kalemler.rows[0]).not.toHaveProperty('durum');
  expect(getState().items[0]).not.toHaveProperty('durum');
  expect(getState().items[0].not).toBe('Korunacak not');
  expect(getState().outbox).toEqual([]);
});
