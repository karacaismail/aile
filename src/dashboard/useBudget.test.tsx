import { renderHook, act, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
let useBudget: typeof import('./useBudget').useBudget;
import { buildBudget, fetchBudget } from './data';
import { syntheticSheets } from './fixtures';
let buildCurrentBudget: typeof import('./current').buildCurrentBudget;
import { syntheticCurrentSheets } from './currentFixtures';
vi.mock('./data', async original => ({ ...await original<typeof import('./data')>(), fetchBudget: vi.fn() }));
beforeEach(async () => {
  vi.resetAllMocks();
  vi.resetModules();
  ({ useBudget } = await import('./useBudget'));
  ({ buildCurrentBudget } = await import('./current'));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
const settle = async () => { await act(async () => {}); };
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
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


it('reuses the validated snapshot immediately after a route remount within 60 seconds', async () => {
  vi.useFakeTimers();
  const verified = buildBudget(syntheticSheets());
  vi.mocked(fetchBudget).mockResolvedValue(verified);
  const first = renderHook(() => useBudget());
  await settle();
  const updatedAt = first.result.current.updatedAt;
  first.unmount();
  await act(async () => { await vi.advanceTimersByTimeAsync(59_999); });
  const next = renderHook(() => useBudget());
  expect(next.result.current.data).toBe(verified);
  expect(next.result.current.updatedAt).toBe(updatedAt);
  expect(next.result.current.loading).toBe(false);
  expect(fetchBudget).toHaveBeenCalledTimes(1);
});

it('does not reread on enabled route handoffs or visible focus/online events while fresh', async () => {
  vi.mocked(fetchBudget).mockResolvedValue(buildBudget(syntheticSheets()));
  const hook = renderHook(({ enabled }) => useBudget(enabled), { initialProps: { enabled: true } });
  await settle();
  hook.rerender({ enabled: false });
  act(() => { hook.result.current.refresh(); window.dispatchEvent(new Event('online')); });
  expect(fetchBudget).toHaveBeenCalledTimes(1);
  hook.rerender({ enabled: true });
  act(() => {
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('online'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(fetchBudget).toHaveBeenCalledTimes(1);
  expect(hook.result.current.loading).toBe(false);
});

it('manual refresh forces a new read even when the current successful snapshot is fresh', async () => {
  const verified = buildBudget(syntheticSheets());
  const pending = deferred<typeof verified>();
  vi.mocked(fetchBudget).mockResolvedValueOnce(verified).mockReturnValueOnce(pending.promise);
  const hook = renderHook(() => useBudget());
  await settle();
  act(() => hook.result.current.refresh());
  expect(fetchBudget).toHaveBeenCalledTimes(2);
  expect(hook.result.current.loading).toBe(true);
  expect(hook.result.current.data).toBe(verified);
  pending.resolve({ ...verified, months: [] });
  await settle();
  expect(hook.result.current.data?.months).toEqual([]);
});

it('expires exactly 60 seconds after a successful read and retains the existing visible polling', async () => {
  vi.useFakeTimers();
  const verified = buildBudget(syntheticSheets());
  vi.mocked(fetchBudget).mockResolvedValue(verified);
  const hook = renderHook(() => useBudget());
  await settle();
  await act(async () => { await vi.advanceTimersByTimeAsync(59_999); });
  expect(fetchBudget).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(fetchBudget).toHaveBeenCalledTimes(2);
  hook.unmount();
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(fetchBudget).toHaveBeenCalledTimes(2);
  renderHook(() => useBudget());
  expect(fetchBudget).toHaveBeenCalledTimes(3);
});

it('starts freshness at successful completion, not at the beginning of a slow request', async () => {
  vi.useFakeTimers();
  const verified = buildBudget(syntheticSheets());
  const pending = deferred<typeof verified>();
  vi.mocked(fetchBudget).mockReturnValueOnce(pending.promise).mockResolvedValue(verified);
  const hook = renderHook(() => useBudget());
  await act(async () => { await vi.advanceTimersByTimeAsync(19_000); });
  pending.resolve(verified);
  await settle();
  await act(async () => { await vi.advanceTimersByTimeAsync(41_000); });
  expect(fetchBudget).toHaveBeenCalledTimes(1);
  act(() => window.dispatchEvent(new Event('focus')));
  expect(fetchBudget).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(19_000); });
  act(() => window.dispatchEvent(new Event('focus')));
  expect(fetchBudget).toHaveBeenCalledTimes(2);
  hook.unmount();
});

it('retries immediately after a network error instead of treating the failed attempt as fresh', async () => {
  const verified = buildBudget(syntheticSheets());
  vi.mocked(fetchBudget).mockResolvedValueOnce(verified).mockRejectedValueOnce(new Error('Çevrimdışı')).mockResolvedValueOnce(verified);
  const hook = renderHook(() => useBudget());
  await settle();
  act(() => hook.result.current.refresh());
  await settle();
  expect(hook.result.current.data).toBe(verified);
  expect(hook.result.current.error).toBe('Çevrimdışı');
  act(() => window.dispatchEvent(new Event('online')));
  await settle();
  expect(fetchBudget).toHaveBeenCalledTimes(3);
  expect(hook.result.current.error).toBeNull();
});

it('shares one request across active consumers and only the last release aborts it', async () => {
  vi.useFakeTimers();
  const verified = buildBudget(syntheticSheets());
  const pending = deferred<typeof verified>();
  let signal: AbortSignal | undefined;
  vi.mocked(fetchBudget).mockImplementation(s => { signal = s; return pending.promise; });
  const first = renderHook(() => useBudget());
  const second = renderHook(() => useBudget());
  expect(fetchBudget).toHaveBeenCalledTimes(1);
  first.unmount();
  expect(signal?.aborted).toBe(false);
  pending.resolve(verified);
  await settle();
  expect(second.result.current.data).toBe(verified);
  expect(second.result.current.loading).toBe(false);
  second.unmount();
  expect(vi.getTimerCount()).toBe(0);
  act(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')); });
  expect(fetchBudget).toHaveBeenCalledTimes(1);
});

it('ignores abandoned results after the last consumer leaves and a new consumer starts', async () => {
  const verified = buildBudget(syntheticSheets());
  const abandoned = deferred<typeof verified>();
  const active = deferred<typeof verified>();
  const signals: AbortSignal[] = [];
  vi.mocked(fetchBudget).mockImplementationOnce(s => { signals.push(s); return abandoned.promise; })
    .mockImplementationOnce(s => { signals.push(s); return active.promise; });
  const first = renderHook(() => useBudget());
  first.unmount();
  expect(signals[0].aborted).toBe(true);
  const next = renderHook(() => useBudget());
  const latest = { ...verified, months: [] };
  active.resolve(latest);
  await settle();
  abandoned.resolve(verified);
  await settle();
  expect(next.result.current.data).toBe(latest);
  expect(next.result.current.loading).toBe(false);
  next.unmount();
  const revisit = renderHook(() => useBudget());
  expect(revisit.result.current.data).toBe(latest);
  expect(fetchBudget).toHaveBeenCalledTimes(2);
});

it('clears an invalid snapshot for every consumer and retries on revisit immediately', async () => {
  const verified = buildCurrentBudget(syntheticCurrentSheets());
  const raw = syntheticCurrentSheets();
  raw.summary[0][4] = 3000;
  let invalid: unknown;
  try { buildCurrentBudget(raw); } catch (error) { invalid = error; }
  vi.mocked(fetchBudget).mockResolvedValueOnce(verified).mockRejectedValueOnce(invalid).mockResolvedValueOnce(verified);
  const first = renderHook(() => useBudget());
  const second = renderHook(() => useBudget());
  await settle();
  act(() => first.result.current.refresh());
  await settle();
  for (const hook of [first, second]) {
    expect(hook.result.current.data).toBeNull();
    expect(hook.result.current.updatedAt).toBeNull();
    expect(hook.result.current.error).toContain('tutarlı');
    hook.unmount();
  }
  const revisit = renderHook(() => useBudget());
  await settle();
  expect(revisit.result.current.data).toBe(verified);
  expect(revisit.result.current.error).toBeNull();
  expect(fetchBudget).toHaveBeenCalledTimes(3);
});

it('ends a stalled refresh, preserves the last good data and ignores its late completion after recovery', async () => {
  vi.useFakeTimers();
  const verified = buildBudget(syntheticSheets());
  const stalled = deferred<typeof verified>();
  let signal: AbortSignal | undefined;
  vi.mocked(fetchBudget).mockResolvedValueOnce(verified).mockImplementationOnce(s => { signal = s; return stalled.promise; }).mockResolvedValueOnce(verified);
  const hook = renderHook(() => useBudget());
  await settle();
  act(() => hook.result.current.refresh());
  await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
  expect(signal?.aborted).toBe(true);
  expect(hook.result.current.loading).toBe(false);
  expect(hook.result.current.data).toBe(verified);
  expect(hook.result.current.error).toMatch(/zaman aşımı/);
  act(() => window.dispatchEvent(new Event('online')));
  await settle();
  expect(fetchBudget).toHaveBeenCalledTimes(3);
  stalled.resolve({ ...verified, months: [] });
  await settle();
  expect(hook.result.current.data).toBe(verified);
  expect(hook.result.current.error).toBeNull();
});
