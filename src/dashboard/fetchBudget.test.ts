import { afterEach, expect, it, vi } from 'vitest';
import { gviz, syntheticSheets } from './fixtures';
import { syntheticCurrentSheets } from './currentFixtures';
import { syntheticBridgeMetadata, syntheticBridgeInflows, syntheticBridgeResponse } from './bridgeFixtures';
import { BudgetIntegrityError } from './integrity';
import { applyBudgetBridge, readBudgetMetadata } from './bridge';
import { buildCurrentBudget } from './current';
import type { Cell } from './data';

vi.hoisted(() => vi.stubEnv('VITE_BUDGET_SHEET_ID', 'synthetic-budget-sheet-2098'));
import { fetchBudget } from './data';
afterEach(() => vi.unstubAllGlobals());

function mockSource(change?: (rows: string[][]) => void, staleFirst = false) {
  const source = syntheticCurrentSheets(); let metaReads = 0;
  const map = { Pano: 'summary', Plan: 'plan', 'Gerçekleşen': 'actual', Kasa: 'cash', 'Arızi Giderler': 'irregular' } as const;
  const fetcher = vi.fn(async (input: URL, options: RequestInit) => {
    expect(options.cache).toBe('no-store'); expect(options.credentials).toBe('omit');
    const sheet = input.searchParams.get('sheet')!;
    if (sheet === '_Finans aylık') {
      if (input.searchParams.get('range') === 'A10:C36') {
        const inflows = syntheticBridgeInflows();
        return new Response(gviz(inflows.rows, inflows.labels));
      }
      const metadata = syntheticBridgeMetadata(); metaReads++;
      if (change && (staleFirst || metaReads > 1)) change(metadata);
      return new Response(gviz(metadata));
    }
    const key = map[sheet as keyof typeof map];
    if (!key) throw new Error('Unexpected source');
    return new Response(key === 'irregular' ? gviz(source.irregular.slice(1), source.irregular[0].map(String)) : gviz(source[key]));
  });
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

it('requires unchanged native generation and both guards around all budget reads', async () => {
  const fetcher = mockSource();
  const result = await fetchBudget(new AbortController().signal);
  expect(result.months).toHaveLength(3);
  const sheets = fetcher.mock.calls.map(([url]) => url.searchParams.get('sheet'));
  expect(sheets[0]).toBe('_Finans aylık');
  expect(sheets.at(-1)).toBe('_Finans aylık');
});

it('waits for the first guard, then starts all six data reads in one parallel phase', async () => {
  const immediate = mockSource();
  let releaseMetadata!: () => void; let releasePlan!: () => void;
  const metadataReady = new Promise<void>(resolve => { releaseMetadata = resolve; });
  const planReady = new Promise<void>(resolve => { releasePlan = resolve; });
  const seen: string[] = [];
  const fetcher = vi.fn(async (url: URL, options: RequestInit) => {
    const key = `${url.searchParams.get('sheet')}!${url.searchParams.get('range')}`;
    seen.push(key);
    if (key === '_Finans aylık!A1:A7' && seen.length === 1) await metadataReady;
    if (url.searchParams.get('sheet') === 'Plan') await planReady;
    return immediate(url, options);
  });
  vi.stubGlobal('fetch', fetcher);
  const result = fetchBudget(new AbortController().signal);
  await vi.waitFor(() => expect(seen).toEqual(['_Finans aylık!A1:A7']));
  releaseMetadata();
  await vi.waitFor(() => expect(seen).toHaveLength(7));
  expect(seen.slice(1).map(key => key.split('!')[0]).sort()).toEqual(['Arızi Giderler', 'Gerçekleşen', 'Kasa', 'Pano', 'Plan', '_Finans aylık'].sort());
  releasePlan();
  await result;
  expect(seen).toHaveLength(8);
  expect(seen.at(-1)).toBe('_Finans aylık!A1:A7');
});

it('excludes debt and reserve transfers from vehicle capacity without altering monthly cash movement', async () => {
  mockSource();
  const result = await fetchBudget(new AbortController().signal);
  expect(result.months[0].free).toEqual({ plan: 4000, current: 4000 });
  expect(result.months[0]).toHaveProperty('selfFundedCashFlow', { plan: 3500, current: 3300 });
});

it.each([1, 2])('rejects guard row %i immediately even when old numbers remain valid', async row => {
  const fetcher = mockSource(meta => { meta[row][0] = 'FALSE'; }, true);
  await expect(fetchBudget(new AbortController().signal)).rejects.toBeInstanceOf(BudgetIntegrityError);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it.each([1, 2, 3, 4, 5, 6])('rejects a changed metadata field %i during the read', async row => {
  mockSource(meta => { meta[row][0] = row === 1 || row === 2 ? 'FALSE' : row === 3 ? 'b'.repeat(64) : row === 6 ? '4' : 'Değişen koşul'; });
  await expect(fetchBudget(new AbortController().signal)).rejects.toBeInstanceOf(BudgetIntegrityError);
});

it('rejects an unknown bridge schema instead of silently accepting the old totals', async () => {
  mockSource(meta => { meta[0][0] = 'finance-bridge-v0'; }, true);
  await expect(fetchBudget(new AbortController().signal)).rejects.toBeInstanceOf(BudgetIntegrityError);
});

it.each(['missing month', 'missing amount', 'negative inflow', 'extra month', 'duplicate month', 'wrong header'])('rejects %s in the capacity source', issue => {
  const table: { labels: string[]; rows: Cell[][] } = syntheticBridgeInflows();
  if (issue === 'missing month') table.rows.shift();
  if (issue === 'missing amount') table.rows[0][2] = null;
  if (issue === 'negative inflow') table.rows[0][2] = -1;
  if (issue === 'extra month') table.rows.push(['2099-02', 0, 0]);
  if (issue === 'duplicate month') table.rows[1][0] = table.rows[0][0];
  if (issue === 'wrong header') table.labels[1] = 'Gelir';
  const metadata = readBudgetMetadata({ labels: [], rows: syntheticBridgeMetadata() });
  expect(() => applyBudgetBridge(buildCurrentBudget(syntheticCurrentSheets()), table, metadata)).toThrow(BudgetIntegrityError);
});

it('prioritizes a known integrity failure over another required feed network failure', async () => {
  const immediate = mockSource();
  vi.stubGlobal('fetch', vi.fn(async (url: URL, options: RequestInit) => {
    if (url.searchParams.get('sheet') === 'Pano') return new Response('Unavailable', { status: 503 });
    if (url.searchParams.get('sheet') === 'Gerçekleşen') return new Response('Invalid native response');
    return immediate(url, options);
  }));
  await expect(fetchBudget(new AbortController().signal)).rejects.toBeInstanceOf(BudgetIntegrityError);
});

it('ignores integrity failures only in modern ranges that the legacy branch does not consume', async () => {
  const raw = syntheticSheets();
  const map = { Pano: 'summary', Plan: 'plan', 'Gerçekleşen': 'actual', 'Düzensiz giderler': 'irregular' } as const;
  vi.stubGlobal('fetch', vi.fn(async (url: URL) => {
    const bridge = syntheticBridgeResponse(url.toString());
    if (bridge) return new Response(bridge);
    const sheet = url.searchParams.get('sheet')!;
    if (sheet === 'Kasa' || sheet === 'Arızi Giderler' || (sheet === 'Gerçekleşen' && url.searchParams.get('range') === 'B2:P79')) return new Response('Unused modern schema');
    const key = map[sheet as keyof typeof map];
    const labels = key === 'plan' || key === 'actual' ? ['Kalem', ...raw.summary.map(row => String(row[0]))] : undefined;
    const rows = key === 'plan' || key === 'actual' ? raw[key].map(row => row.slice(0, 4)) : raw[key];
    return new Response(gviz(rows, labels));
  }));
  const data = await fetchBudget(new AbortController().signal);
  expect(data.months).toHaveLength(3);
  expect(data.months[0].selfFundedCashFlow?.current).toBe(3300);
});

it('prioritizes a legacy required integrity failure over a concurrent legacy network failure', async () => {
  const raw = syntheticSheets();
  vi.stubGlobal('fetch', vi.fn(async (url: URL) => {
    const bridge = syntheticBridgeResponse(url.toString());
    if (bridge) return new Response(bridge);
    const sheet = url.searchParams.get('sheet'), range = url.searchParams.get('range');
    if (sheet === 'Plan' && range === 'B2:P79') return new Response(gviz(raw.plan));
    if (sheet === 'Pano') return new Response(gviz(raw.summary));
    if (sheet === 'Plan') return new Response('Unavailable', { status: 503 });
    if (sheet === 'Gerçekleşen' && range === 'B7:P74') {
      await new Promise(resolve => setTimeout(resolve, 10));
      return new Response('Invalid required legacy response');
    }
    return new Response(gviz([]));
  }));
  await expect(fetchBudget(new AbortController().signal)).rejects.toBeInstanceOf(BudgetIntegrityError);
});
