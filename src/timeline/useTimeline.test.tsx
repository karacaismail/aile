import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { buildTimeline, fetchTimeline } from './data';
import { syntheticTimeline } from './fixtures';
import { useTimeline } from './useTimeline';
vi.mock('./data', async original => ({ ...await original<typeof import('./data')>(), fetchTimeline: vi.fn() }));
afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });

it('keeps the last validated ledger through errors and recovers on refresh', async () => {
  const data = buildTimeline(syntheticTimeline());
  vi.mocked(fetchTimeline).mockResolvedValueOnce(data).mockRejectedValueOnce(new Error('Mutabakat hatası')).mockResolvedValueOnce(data);
  const { result, unmount } = renderHook(() => useTimeline());
  await waitFor(() => expect(result.current.data).toBe(data));
  act(() => result.current.refresh());
  await waitFor(() => expect(result.current.error).toBe('Mutabakat hatası'));
  expect(result.current.data).toBe(data);
  act(() => result.current.refresh());
  await waitFor(() => expect(result.current.error).toBeNull());
  unmount();
});
it('refreshes each visible minute, avoids overlapping reads, and aborts when unmounted', async () => {
  vi.useFakeTimers();
  const data = buildTimeline(syntheticTimeline());
  let signal: AbortSignal | undefined;
  vi.mocked(fetchTimeline).mockResolvedValueOnce(data).mockImplementation(s => { signal = s; return new Promise(() => {}); });
  const { result, unmount } = renderHook(() => useTimeline());
  await act(async () => {});
  await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
  expect(fetchTimeline).toHaveBeenCalledTimes(2);
  act(() => { result.current.refresh(); window.dispatchEvent(new Event('focus')); });
  expect(fetchTimeline).toHaveBeenCalledTimes(2);
  unmount();
  expect(signal?.aborted).toBe(true);
});
