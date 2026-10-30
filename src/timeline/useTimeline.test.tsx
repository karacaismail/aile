import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { buildTimeline, fetchTimeline } from './data';
import { syntheticTimeline } from './fixtures';
import { useTimeline } from './useTimeline';
import { createTimelineStore } from './timelineStore';
vi.mock('./data', async original => ({ ...await original<typeof import('./data')>(), fetchTimeline: vi.fn() }));
let store: ReturnType<typeof createTimelineStore>;
beforeEach(() => { store = createTimelineStore(); });
afterEach(() => { vi.resetAllMocks(); vi.useRealTimers(); });

it('keeps the last validated ledger through errors and recovers on refresh', async () => {
  const data = buildTimeline(syntheticTimeline());
  vi.mocked(fetchTimeline).mockResolvedValueOnce(data).mockRejectedValueOnce(new Error('Mutabakat hatası')).mockResolvedValueOnce(data);
  const { result, unmount } = renderHook(() => useTimeline(store));
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
  const { result, unmount } = renderHook(() => useTimeline(store));
  await act(async () => {});
  await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
  expect(fetchTimeline).toHaveBeenCalledTimes(2);
  act(() => { result.current.refresh(); window.dispatchEvent(new Event('focus')); });
  expect(fetchTimeline).toHaveBeenCalledTimes(2);
  unmount();
  expect(signal?.aborted).toBe(true);
});

it('reuses a verified ledger synchronously on a fresh route revisit without another read', async () => {
  const data = buildTimeline(syntheticTimeline());
  vi.mocked(fetchTimeline).mockResolvedValue(data);
  const first = renderHook(() => useTimeline(store));
  await waitFor(() => expect(first.result.current.data).toBe(data));
  const verifiedAt = first.result.current.updatedAt;
  first.unmount();
  const next = renderHook(() => useTimeline(store));
  expect(next.result.current.data).toBe(data);
  expect(next.result.current.loading).toBe(false);
  expect(next.result.current.updatedAt).toBe(verifiedAt);
  expect(fetchTimeline).toHaveBeenCalledTimes(1);
  next.unmount();
});

it('shares one request across consumers and only aborts when the last leaves', () => {
  let signal: AbortSignal | undefined;
  vi.mocked(fetchTimeline).mockImplementation(s => { signal = s; return new Promise(() => {}); });
  const first = renderHook(() => useTimeline(store));
  const second = renderHook(() => useTimeline(store));
  expect(fetchTimeline).toHaveBeenCalledTimes(1);
  first.unmount();
  expect(signal?.aborted).toBe(false);
  second.unmount();
  expect(signal?.aborted).toBe(true);
});

it('does not refetch on focus and online bursts while fresh but manual refresh always reads', async () => {
  const data = buildTimeline(syntheticTimeline());
  vi.mocked(fetchTimeline).mockResolvedValue(data);
  const { result, unmount } = renderHook(() => useTimeline(store));
  await waitFor(() => expect(result.current.data).toBe(data));
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  await act(async () => { window.dispatchEvent(new Event('online')); });
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  expect(fetchTimeline).toHaveBeenCalledTimes(1);
  act(() => result.current.refresh());
  await waitFor(() => expect(fetchTimeline).toHaveBeenCalledTimes(2));
  unmount();
});

it.each(['online', 'focus', 'visibilitychange'])('retries an initial failure immediately when %s returns', async event => {
  vi.useFakeTimers();
  const data = buildTimeline(syntheticTimeline());
  vi.mocked(fetchTimeline).mockRejectedValueOnce(new Error('Çevrimdışı')).mockResolvedValueOnce(data);
  const hook = renderHook(() => useTimeline(store));
  try {
    await act(async () => {});
    expect(hook.result.current.error).toBe('Çevrimdışı');
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    await act(async () => { (event === 'visibilitychange' ? document : window).dispatchEvent(new Event(event)); });
    expect(hook.result.current.data).toBe(data);
    expect(hook.result.current.error).toBeNull();
    expect(fetchTimeline).toHaveBeenCalledTimes(2);
  } finally { hook.unmount(); }
});

it('retries a failed refresh on reconnect even when the retained ledger is recent', async () => {
  vi.useFakeTimers();
  const previous = buildTimeline(syntheticTimeline());
  const current = buildTimeline(syntheticTimeline());
  vi.mocked(fetchTimeline).mockResolvedValueOnce(previous).mockRejectedValueOnce(new Error('Çevrimdışı')).mockResolvedValueOnce(current);
  const hook = renderHook(() => useTimeline(store));
  try {
    await act(async () => {});
    await act(async () => { hook.result.current.refresh(); });
    expect(hook.result.current.data).toBe(previous);
    expect(hook.result.current.error).toBe('Çevrimdışı');
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); window.dispatchEvent(new Event('online')); });
    expect(hook.result.current.data).toBe(current);
    expect(hook.result.current.error).toBeNull();
    expect(fetchTimeline).toHaveBeenCalledTimes(3);
  } finally { hook.unmount(); }
});

it('clears an initial failure during retry without presenting an error and loading together', async () => {
  vi.mocked(fetchTimeline).mockRejectedValueOnce(new Error('Kaynak hatası')).mockImplementation(() => new Promise(() => {}));
  const { result, unmount } = renderHook(() => useTimeline(store));
  await waitFor(() => expect(result.current.error).toBe('Kaynak hatası'));
  act(() => result.current.refresh());
  expect(result.current.loading).toBe(true);
  expect(result.current.error).toBeNull();
  unmount();
});

it('joins the selected route prefetch and releases it only after every owner leaves', async () => {
  let signal: AbortSignal | undefined;
  let resolve!: (data: ReturnType<typeof buildTimeline>) => void;
  vi.mocked(fetchTimeline).mockImplementation(s => { signal = s; return new Promise(done => { resolve = done; }); });
  const release = store.prefetch();
  const hook = renderHook(() => useTimeline(store));
  expect(fetchTimeline).toHaveBeenCalledTimes(1);
  hook.unmount();
  expect(signal?.aborted).toBe(false);
  const data = buildTimeline(syntheticTimeline());
  await act(async () => { resolve(data); });
  release();
  release();
  const next = renderHook(() => useTimeline(store));
  expect(next.result.current.data).toBe(data);
  expect(fetchTimeline).toHaveBeenCalledTimes(1);
  next.unmount();
});

it('does not let an abandoned request replace a newer verified ledger', async () => {
  let oldResolve!: (data: ReturnType<typeof buildTimeline>) => void;
  let oldSignal: AbortSignal | undefined;
  const oldData = buildTimeline(syntheticTimeline());
  const currentData = buildTimeline(syntheticTimeline());
  vi.mocked(fetchTimeline).mockImplementationOnce(s => { oldSignal = s; return new Promise(done => { oldResolve = done; }); }).mockResolvedValueOnce(currentData);
  const first = renderHook(() => useTimeline(store));
  first.unmount();
  expect(oldSignal?.aborted).toBe(true);
  const next = renderHook(() => useTimeline(store));
  await waitFor(() => expect(next.result.current.data).toBe(currentData));
  await act(async () => { oldResolve(oldData); });
  expect(next.result.current.data).toBe(currentData);
  expect(fetchTimeline).toHaveBeenCalledTimes(2);
  next.unmount();
});

it('shows stale verified data immediately while a route revisit revalidates it', async () => {
  vi.useFakeTimers();
  const data = buildTimeline(syntheticTimeline());
  vi.mocked(fetchTimeline).mockResolvedValueOnce(data).mockImplementation(() => new Promise(() => {}));
  const first = renderHook(() => useTimeline(store));
  await act(async () => {});
  first.unmount();
  await act(async () => { await vi.advanceTimersByTimeAsync(60_001); });
  const next = renderHook(() => useTimeline(store));
  expect(next.result.current.data).toBe(data);
  expect(next.result.current.loading).toBe(true);
  expect(fetchTimeline).toHaveBeenCalledTimes(2);
  next.unmount();
});

it('times out a stuck request, preserves verified data, and allows a manual retry', async () => {
  vi.useFakeTimers();
  const data = buildTimeline(syntheticTimeline());
  vi.mocked(fetchTimeline).mockResolvedValueOnce(data).mockImplementationOnce(() => new Promise(() => {})).mockResolvedValueOnce(data);
  const hook = renderHook(() => useTimeline(store));
  await act(async () => {});
  act(() => hook.result.current.refresh());
  await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
  expect(hook.result.current.data).toBe(data);
  expect(hook.result.current.error).toMatch(/zaman aşımı/);
  expect(hook.result.current.loading).toBe(false);
  await act(async () => { hook.result.current.refresh(); });
  expect(hook.result.current.error).toBeNull();
  expect(fetchTimeline).toHaveBeenCalledTimes(3);
  hook.unmount();
});
