import { renderHook, act, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useBudget } from './useBudget';
import { buildBudget, fetchBudget } from './data';
import { syntheticSheets } from './fixtures';
import { buildCurrentBudget } from './current';
import { syntheticCurrentSheets } from './currentFixtures';
vi.mock('./data', async original => ({ ...await original<typeof import('./data')>(), fetchBudget: vi.fn() }));
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
it('does not fetch unrelated budget feeds while the timeline route is active', () => {
  const { unmount } = renderHook(() => useBudget(false));
  expect(fetchBudget).not.toHaveBeenCalled();
  window.dispatchEvent(new Event('focus'));
  expect(fetchBudget).not.toHaveBeenCalled();
  unmount();
});
it('refreshes values, preserves the last good snapshot on failure and recovers', async () => {
  const first = buildBudget(syntheticSheets());
  vi.mocked(fetchBudget).mockResolvedValueOnce(first).mockRejectedValueOnce(new Error('Bağlantı kesildi')).mockResolvedValueOnce({ ...first, months: [] });
  const { result, unmount } = renderHook(() => useBudget());
  await waitFor(() => expect(result.current.data).toBe(first));
  act(() => result.current.refresh());
  await waitFor(() => expect(result.current.error).toContain('Bağlantı kesildi'));
  expect(result.current.data).toBe(first);
  act(() => result.current.refresh());
  await waitFor(() => expect(result.current.data?.months).toEqual([]));
  expect(result.current.error).toBeNull();
  unmount();
});
it('polls without overlapping requests and cancels on unmount', async () => {
  vi.useFakeTimers();
  let signal: AbortSignal | undefined;
  vi.mocked(fetchBudget).mockImplementation(s => { signal = s; return new Promise(() => {}); });
  const { result, unmount } = renderHook(() => useBudget());
  act(() => { result.current.refresh(); window.dispatchEvent(new Event('focus')); });
  expect(fetchBudget).toHaveBeenCalledTimes(1);
  unmount();
  expect(signal?.aborted).toBe(true);
});
it('removes every previous amount when refreshed native totals fail integrity checks, then recovers', async () => {
  const first = buildCurrentBudget(syntheticCurrentSheets());
  const raw = syntheticCurrentSheets();
  raw.summary[0][4] = 3000;
  let invalid: unknown;
  try { buildCurrentBudget(raw); } catch (error) { invalid = error; }
  vi.mocked(fetchBudget).mockResolvedValueOnce(first).mockRejectedValueOnce(invalid).mockResolvedValueOnce(first);
  const { result, unmount } = renderHook(() => useBudget());
  await waitFor(() => expect(result.current.data).toBe(first));
  expect(result.current.updatedAt).not.toBeNull();
  act(() => result.current.refresh());
  await waitFor(() => expect(result.current.error).toContain('tutarlı'));
  expect(result.current.data).toBeNull();
  expect(result.current.updatedAt).toBeNull();
  act(() => result.current.refresh());
  await waitFor(() => expect(result.current.data).toBe(first));
  expect(result.current.error).toBeNull();
  unmount();
});
