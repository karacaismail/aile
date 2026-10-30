import { afterEach, describe, expect, it, vi } from 'vitest';
import { gviz } from '../dashboard/fixtures';
import { fetchTimeline } from './data';
import { syntheticTimeline } from './fixtures';

vi.mock('../dashboard/data', async importOriginal => ({
  ...await importOriginal<typeof import('../dashboard/data')>(),
  sheetId: 'synthetic-budget-sheet-2098',
}));
afterEach(() => vi.unstubAllGlobals());

describe('Unfiltered Timeline feed', () => {
  it('reads every step independently of filters and intro rows in the editable view', async () => {
    const table = syntheticTimeline();
    const signal = new AbortController().signal;
    const fetcher = vi.fn(async (input: URL, options: RequestInit) => {
      expect(options.signal).toBe(signal);
      expect(options.cache).toBe('no-store');
      expect(options.credentials).toBe('omit');
      expect(input.searchParams.get('sheet')).toBe('_Timeline web');
      expect(input.searchParams.get('range')).toBe('A1:Q1600');
      expect(input.searchParams.get('headers')).toBe('1');
      return new Response(gviz(table.rows, table.labels));
    });
    vi.stubGlobal('fetch', fetcher);
    const timeline = await fetchTimeline(signal);
    expect(timeline.events).toHaveLength(8);
    expect(timeline.events[0].type).toBe('Başlangıç');
    expect(timeline.events.at(-1)?.type).toBe('Kontrol');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects changed column names in the mirror', async () => {
    const table = syntheticTimeline(); table.labels[9] = 'Changed';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(gviz(table.rows, table.labels))));
    await expect(fetchTimeline(new AbortController().signal)).rejects.toThrow(/sütun başlıkları/);
  });

  it('rejects an incomplete mirror instead of showing a partial balance', async () => {
    const table = syntheticTimeline(); table.rows.pop();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(gviz(table.rows, table.labels))));
    await expect(fetchTimeline(new AbortController().signal)).rejects.toThrow(/ay sonu kontrolü/);
  });

  it('surfaces failed feed requests', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })));
    await expect(fetchTimeline(new AbortController().signal)).rejects.toThrow(/503/);
  });
});
