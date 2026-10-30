import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureController, startSync, stopSync } from './controller';
import { setApiUrl } from './config';
import { resetStore, getState } from './store';
import * as cache from './cache';

beforeEach(() => {
  stopSync(); resetStore();
  setApiUrl('https://script.google.com/macros/s/test/exec');
  vi.spyOn(cache, 'loadCache').mockResolvedValue(undefined);
  vi.spyOn(cache, 'loadOutbox').mockResolvedValue([]);
});
afterEach(() => { stopSync(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('planner route sync lifetime', () => {
  it('leaving while cache hydrates does not start a request on the next page', async () => {
    let release!: () => void;
    vi.mocked(cache.loadCache).mockImplementation(() => new Promise(resolve => { release = () => resolve(undefined); }));
    const fetchImpl = vi.fn();
    configureController({ fetchImpl });
    const stop = startSync(); stop(); release();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('a failed pending request cannot restart polling after the planner closes', async () => {
    vi.useFakeTimers();
    let reject!: (reason: Error) => void;
    const fetchImpl = vi.fn(() => new Promise<Response>((_, fail) => { reject = fail; }));
    configureController({ fetchImpl });
    const stop = startSync();
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    stop(); reject(new Error('Network disconnected'));
    await vi.waitFor(() => expect(getState().status).toBe('offline'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
