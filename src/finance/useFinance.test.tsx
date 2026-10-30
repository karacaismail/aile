import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { fetchFinance } from './data';
import { useFinance } from './useFinance';
import { createFinanceStore } from './financeStore';

vi.mock('./data', () => ({ fetchFinance: vi.fn() }));
afterEach(() => { vi.resetAllMocks(); vi.useRealTimers(); });

it('removes previously displayed amounts when the native guard becomes stale, then recovers', async () => {
  const verified = { status: 'Sentetik doğrulanmış hesap', notes: [], fingerprint: 'a'.repeat(64), months: [], events: [] };
  vi.mocked(fetchFinance).mockResolvedValueOnce(verified).mockRejectedValueOnce(new Error('Kaynak değişti; hesap yenilenmeli.')).mockResolvedValueOnce(verified);
  const store = createFinanceStore();
  const hook = renderHook(() => useFinance(store));
  await waitFor(() => expect(hook.result.current.data).toBe(verified));
  act(() => hook.result.current.refresh());
  await waitFor(() => expect(hook.result.current.error).toMatch(/yenilenmeli/));
  expect(hook.result.current.data).toBeNull();
  act(() => hook.result.current.refresh());
  await waitFor(() => expect(hook.result.current.data).toBe(verified));
  expect(hook.result.current.error).toBeNull();
  hook.unmount();
});

it('aborts the route request and ignores a late response after leaving', async () => {
  let signal: AbortSignal | undefined;
  vi.mocked(fetchFinance).mockImplementation(s => { signal = s; return new Promise(() => {}); });
  const store = createFinanceStore();
  const hook = renderHook(() => useFinance(store));
  expect(fetchFinance).toHaveBeenCalledTimes(1);
  hook.unmount();
  expect(signal?.aborted).toBe(true);
});

it('refreshes the visible route each minute without overlapping requests', async () => {
  vi.useFakeTimers();
  const verified = { status: 'Sentetik hesap', notes: [], fingerprint: 'a'.repeat(64), months: [], events: [] };
  vi.mocked(fetchFinance).mockResolvedValueOnce(verified).mockImplementation(() => new Promise(() => {}));
  const store = createFinanceStore();
  const hook = renderHook(() => useFinance(store));
  await act(async () => {});
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(fetchFinance).toHaveBeenCalledTimes(2);
  act(() => hook.result.current.refresh());
  expect(fetchFinance).toHaveBeenCalledTimes(2);
  hook.unmount();
});

it('ends a stalled connection and never displays unverifiable values', async () => {
  vi.useFakeTimers();
  let signal: AbortSignal | undefined;
  vi.mocked(fetchFinance).mockImplementation(s => { signal = s; return new Promise(() => {}); });
  const store = createFinanceStore();
  const hook = renderHook(() => useFinance(store));
  await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
  expect(signal?.aborted).toBe(true);
  expect(hook.result.current.loading).toBe(false);
  expect(hook.result.current.error).toMatch(/zaman aşımı/);
  expect(hook.result.current.data).toBeNull();
  hook.unmount();
});
