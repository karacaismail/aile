import { afterEach, describe, expect, it, vi } from 'vitest';
import { gviz } from '../dashboard/fixtures';
import { buildFinance, fetchFinance } from './data';
import { financeRanges } from './contract';
import { syntheticFinance } from './fixtures';

vi.mock('../dashboard/data', async original => ({ ...await original<typeof import('../dashboard/data')>(), sheetId: 'synthetic-budget-sheet-2098' }));
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

describe('coherent read-only source', () => {
  function sourceFetch(metadataAfter?: ReturnType<typeof syntheticFinance>['metadata']) {
    const source = syntheticFinance(); let metadataReads = 0;
    const fetcher = vi.fn(async (input: URL, options: RequestInit) => {
      expect(options.cache).toBe('no-store'); expect(options.credentials).toBe('omit');
      expect(input.searchParams.get('sheet')).toBe('Finansman');
      const range = input.searchParams.get('range');
      const key = Object.entries(financeRanges).find(([, value]) => value === range)?.[0] as keyof typeof source;
      if (!key) throw new Error('Unexpected range');
      const table = key === 'metadata' && ++metadataReads > 1 && metadataAfter ? metadataAfter : source[key];
      return new Response(gviz(table.rows, table.labels));
    });
    vi.stubGlobal('fetch', fetcher);
    return fetcher;
  }
  it('reads typed ranges and validates the native guard again after all values arrive', async () => {
    const fetcher = sourceFetch();
    const data = await fetchFinance(new AbortController().signal);
    expect(data.events).toHaveLength(4); expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it('does not read amounts before the initial generation is known, then fetches both typed blocks together', async () => {
    const immediate = sourceFetch();
    let releaseMetadata!: () => void; let releaseMonthly!: () => void;
    const metadataReady = new Promise<void>(resolve => { releaseMetadata = resolve; });
    const monthlyReady = new Promise<void>(resolve => { releaseMonthly = resolve; });
    const ranges: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: URL, options: RequestInit) => {
      const range = url.searchParams.get('range')!;
      ranges.push(range);
      if (range === financeRanges.metadata && ranges.length === 1) await metadataReady;
      if (range === financeRanges.monthly) await monthlyReady;
      return immediate(url, options);
    }));
    const pending = fetchFinance(new AbortController().signal);
    await vi.waitFor(() => expect(ranges).toEqual([financeRanges.metadata]));
    releaseMetadata();
    await vi.waitFor(() => expect(ranges).toHaveLength(3));
    expect(ranges.slice(1).sort()).toEqual([financeRanges.monthly, financeRanges.daily].sort());
    releaseMonthly();
    await pending;
    expect(ranges).toEqual([financeRanges.metadata, financeRanges.monthly, financeRanges.daily, financeRanges.metadata]);
  });
  it.each(['FALSE', 'fingerprint'])('rejects a %s change while ranges are in flight', async change => {
    const after = syntheticFinance().metadata;
    if (change === 'FALSE') after.rows[2][0] = 'FALSE'; else after.rows[6][0] = 'b'.repeat(64);
    sourceFetch(after);
    await expect(fetchFinance(new AbortController().signal)).rejects.toThrow(/değiş|yenilenmeli/i);
  });
  it('rejects changed calculation conditions even if the source fingerprint is unchanged', async () => {
    const after = syntheticFinance().metadata; after.rows[8][0] = 'Koşullar değişti.';
    sourceFetch(after);
    await expect(fetchFinance(new AbortController().signal)).rejects.toThrow(/değiş/i);
  });
});

describe('daily ledger selection within a sheet that also contains a cost report', () => {
  function reportFetch(change: 'none' | 'missing ID' | 'extra ID') {
    const source = syntheticFinance();
    if (change === 'missing ID') source.daily.rows[1][17] = null;
    if (change === 'extra ID') source.daily.rows.push([...source.daily.rows.at(-1)!.slice(0, 17), 'unexpected-extra-event']);
    // The real native layout has a separate A:F cost report below the daily
    // ledger. Its R column is empty; it is not another payment event.
    source.daily.rows.push([], ['Maliyet ayrıntıları', null, null, null, null, null], ['2098-02', 'Sentetik ücret', 1, 2, 3, 4]);
    const fetcher = vi.fn(async (input: URL) => {
      const key = Object.entries(financeRanges).find(([, value]) => value === input.searchParams.get('range'))?.[0] as keyof typeof source;
      const table = source[key];
      const rows = key === 'daily' && input.searchParams.get('tq') === 'select * where R is not null' ? table.rows.filter(row => row[17] !== null && row[17] !== undefined && row[17] !== '') : table.rows;
      return new Response(gviz(rows, table.labels));
    });
    vi.stubGlobal('fetch', fetcher); return fetcher;
  }
  it('selects ID-bearing daily records without including the trailing cost block', async () => {
    const fetcher = reportFetch('none');
    const data = await fetchFinance(new AbortController().signal);
    expect(data.events).toHaveLength(4);
    expect(fetcher).toHaveBeenCalledTimes(4);
    const daily = fetcher.mock.calls.find(([url]) => url.searchParams.get('range') === financeRanges.daily)![0];
    expect(daily.searchParams.get('tq')).toBe('select * where R is not null');
    expect(daily.searchParams.get('headers')).toBe('1');
  });
  it.each(['missing ID', 'extra ID'] as const)('rejects %s rather than silently truncating the expected event count', async change => {
    reportFetch(change);
    await expect(fetchFinance(new AbortController().signal)).rejects.toThrow(/kayıt sayısı tutarsız/);
  });
});
