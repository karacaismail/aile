import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gviz } from '../dashboard/fixtures';
import { buildFinance, fetchFinance } from './data';
import { syntheticFinance, syntheticFinanceWire } from './fixtures';

vi.mock('../dashboard/data', async original => ({ ...await original<typeof import('../dashboard/data')>(), sheetId: 'synthetic-budget-sheet-2098' }));
beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => vi.unstubAllGlobals());

describe('native finance contract', () => {
  it('keeps bank fees, KMH and future instalments separate without double-counting card debt', () => {
    const data = buildFinance(syntheticFinance());
    expect(data.events[0]).toMatchObject({ cardDebt: 512, futureInstalments: 100, kmhPrincipal: 50, kmhCost: 2, cash: 0 });
    expect(data.months[0]).toMatchObject({ month: '2098-01', cash: 500, cardDebt: 155, knownNetAssets: 945 });
    expect(data.status).toMatch(/teyitsiz/);
    expect(data).toMatchObject({ notes: ['Harcanabilir nakit ayrılan bütçeler sonrasıdır; banka bakiyesi değildir.', 'Geçmiş tahakkuk ve gelecekteki banka oranları teyit bekliyor.'] });
    expect(data.events[2].type).toBe('İç aktarım');
  });

  it.each([
    ['changed headings', (v: ReturnType<typeof syntheticFinance>) => { v.daily.labels[13] = 'Toplam borç'; }],
    ['unknown amount', (v: ReturnType<typeof syntheticFinance>) => { v.daily.rows[0][7] = null; }],
    ['nonfinite amount', (v: ReturnType<typeof syntheticFinance>) => { v.daily.rows[0][7] = Infinity; }],
    ['duplicate ID', (v: ReturnType<typeof syntheticFinance>) => { v.daily.rows[1][17] = v.daily.rows[0][17]; }],
    ['reverse chronology', (v: ReturnType<typeof syntheticFinance>) => { v.daily.rows.reverse(); }],
    ['invalid date', (v: ReturnType<typeof syntheticFinance>) => { v.daily.rows[0][0] = '2098-02-31'; }],
    ['missing event', (v: ReturnType<typeof syntheticFinance>) => { v.daily.rows.pop(); }],
    ['missing month', (v: ReturnType<typeof syntheticFinance>) => { v.monthly.rows.pop(); }],
    ['card total mismatch', (v: ReturnType<typeof syntheticFinance>) => { v.daily.rows[0][13] = 612; }],
    ['one-cent card mismatch', (v: ReturnType<typeof syntheticFinance>) => { v.daily.rows[0][13] = Number(v.daily.rows[0][13]) + .01; }],
    ['inflated intermediate available cash', (v: ReturnType<typeof syntheticFinance>) => { v.daily.rows[0][5] = Number(v.daily.rows[0][5]) + 100000; }],
    ['one-cent monthly mismatch', (v: ReturnType<typeof syntheticFinance>) => { v.monthly.rows[0][1] = Number(v.monthly.rows[0][1]) + .01; }],
    ['KMH above borrowed cash', (v: ReturnType<typeof syntheticFinance>) => { v.daily.rows[0][6] = 50.01; }],
    ['uncovered principal without funding gap', (v: ReturnType<typeof syntheticFinance>) => { v.daily.rows[0][6] = 49; }],
    ['funding gap above principal and costs', (v: ReturnType<typeof syntheticFinance>) => { v.daily.rows[0][14] = 3; }],
    ['monthly balance mismatch', (v: ReturnType<typeof syntheticFinance>) => { v.monthly.rows[0][1] = 1; }],
    ['unknown schema', (v: ReturnType<typeof syntheticFinance>) => { v.metadata.rows[5][0] = 'finance-v0'; }],
  ])('rejects %s instead of hiding missing data as zero', (_, mutate) => {
    const source = syntheticFinance(); mutate(source);
    expect(() => buildFinance(source)).toThrow();
  });

  it('shows a meaningful stale error before parsing deliberately blank native amounts', () => {
    const source = syntheticFinance(); source.metadata.rows[2][0] = 'FALSE'; source.daily.rows = [];
    expect(() => buildFinance(source)).toThrow(/kaynak.*değiş|yenilenmeli/i);
  });
});

describe('two-phase coherent transport', () => {
  const sourceFetch = (after?: ReturnType<typeof syntheticFinanceWire>) => {
    const full = syntheticFinanceWire();
    const fetcher = vi.fn(async (input: URL, options: RequestInit) => {
      expect(options.cache).toBe('no-store'); expect(options.credentials).toBe('omit');
      expect(input.searchParams.get('sheet')).toBe('_Finans web');
      expect(input.searchParams.get('headers')).toBe('1');
      const range = input.searchParams.get('range');
      expect(['A1:T6000', 'A1:T11']).toContain(range);
      const table = range === 'A1:T6000' ? full : after ?? full;
      return new Response(gviz(range === 'A1:T11' ? table.rows.slice(0, 10) : table.rows, table.labels));
    });
    vi.stubGlobal('fetch', fetcher); return fetcher;
  };

  it('reads the bound payload then one metadata check, with exactly two requests', async () => {
    const fetcher = sourceFetch();
    expect((await fetchFinance(new AbortController().signal)).events).toHaveLength(4);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.map(([url]) => url.searchParams.get('range'))).toEqual(['A1:T6000', 'A1:T11']);
  });

  it('does not start the final check before the complete payload is verified', async () => {
    const source = sourceFetch();
    let release!: () => void;
    const ready = new Promise<void>(resolve => { release = resolve; });
    const ranges: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: URL, options: RequestInit) => {
      ranges.push(url.searchParams.get('range')!);
      if (ranges.length === 1) await ready;
      return source(url, options);
    }));
    const pending = fetchFinance(new AbortController().signal);
    await vi.waitFor(() => expect(ranges).toEqual(['A1:T6000']));
    release(); await pending;
    expect(ranges).toEqual(['A1:T6000', 'A1:T11']);
  });

  it.each(['guard', 'source hash', 'payload hash', 'count', 'scope', 'title'] as const)('rejects changed final %s', async change => {
    const after = syntheticFinanceWire();
    if (change === 'guard') after.rows[3][2] = 's:FALSE';
    if (change === 'source hash') after.rows[7][2] = `s:${'b'.repeat(64)}`;
    if (change === 'payload hash') after.rows[0][3] = `s:${'b'.repeat(64)}`;
    if (change === 'count') after.rows[4][2] = 's:5';
    if (change === 'scope') after.rows[9][2] = 's:Koşullar değişti.';
    if (change === 'title') after.rows[1][2] = 's:Başka kaynak';
    sourceFetch(after);
    await expect(fetchFinance(new AbortController().signal)).rejects.toThrow(/değiş|yenilenmeli/i);
  });

  it('does not publish or recheck when aborted while the digest is pending', async () => {
    const fetcher = sourceFetch(), abort = new AbortController();
    let finish!: (value: ArrayBuffer) => void;
    let bytes: Uint8Array | undefined;
    vi.stubGlobal('crypto', { subtle: { digest: vi.fn((_name: string, data: Uint8Array) => { bytes = data; return new Promise<ArrayBuffer>(resolve => { finish = resolve; }); }) } });
    const pending = fetchFinance(abort.signal);
    await vi.waitFor(() => expect(bytes).toBeDefined());
    abort.abort();
    finish(await webcrypto.subtle.digest('SHA-256', bytes!));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('ignores no trailing data: additional report rows are rejected', async () => {
    const wire = syntheticFinanceWire(); wire.rows.push(['cost-report', 'i:0', ...Array(18).fill('s:report')]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(gviz(wire.rows, wire.labels))));
    await expect(fetchFinance(new AbortController().signal)).rejects.toThrow(/kayıt|sıra/);
  });

  it('never starts final validation when the payload was modified in transit', async () => {
    const wire = syntheticFinanceWire();
    wire.rows.find(row => row[0] === 'daily')![5] = 'n:0.001';
    const fetcher = vi.fn().mockResolvedValue(new Response(gviz(wire.rows, wire.labels)));
    vi.stubGlobal('fetch', fetcher);
    await expect(fetchFinance(new AbortController().signal)).rejects.toThrow(/içerik özeti/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
