import { fetchFinance, type FinanceLedger } from './data';

export type FinanceState = { data: FinanceLedger | null; error: string | null; loading: boolean; updatedAt: Date | null };
const freshnessMs = 60_000;
const timeoutMs = 20_000;

// Only validated ledgers live here, in this page's memory. Financial responses
// are never persisted to localStorage, a service worker, or a public fixture.
export function createFinanceStore() {
  let state: FinanceState = { data: null, error: null, loading: true, updatedAt: null };
  const subscribers = new Set<() => void>();
  let leases = 0;
  let lastAttemptAt: number | null = null;
  let request: { controller: AbortController; timeout: number } | null = null;
  let interval: number | undefined;

  const publish = (next: FinanceState) => {
    state = next;
    subscribers.forEach(notify => notify());
  };
  const refresh = (force = false) => {
    // Only a successful, still-current ledger suppresses automatic reads. A
    // failed attempt must be retryable as soon as connectivity/visibility returns.
    const fresh = state.data !== null && state.error === null && lastAttemptAt !== null && Date.now() - lastAttemptAt < freshnessMs;
    if (request || (!force && fresh)) return;
    lastAttemptAt = Date.now();
    const current = { controller: new AbortController(), timeout: 0 };
    request = current;
    publish({ ...state, loading: true, error: null });
    current.timeout = window.setTimeout(() => {
      if (request !== current) return;
      request = null;
      current.controller.abort();
      publish({ data: null, updatedAt: null, loading: false, error: 'Finansman bağlantısında zaman aşımı. Yeniden deneyin.' });
    }, timeoutMs);
    void fetchFinance(current.controller.signal).then(data => {
      if (request === current) publish({ data, error: null, loading: false, updatedAt: new Date() });
    }).catch((error: unknown) => {
      if (request !== current) return;
      publish({ data: null, updatedAt: null, loading: false, error: error instanceof Error && error.name !== 'AbortError' ? error.message : 'Finansman bağlantısında zaman aşımı. Yeniden deneyin.' });
    }).finally(() => {
      window.clearTimeout(current.timeout);
      if (request === current) request = null;
    });
  };
  const visibleRefresh = () => { if (document.visibilityState === 'visible') refresh(); };
  const cancelIfUnused = () => {
    if (subscribers.size || leases || !request) return;
    const abandoned = request;
    request = null;
    window.clearTimeout(abandoned.timeout);
    abandoned.controller.abort();
    // A cancelled attempt is not a successful check and must not suppress the
    // next visit's request. Ignore any late resolution from the abandoned read.
    lastAttemptAt = state.updatedAt?.getTime() ?? null;
    publish({ ...state, loading: false });
  };

  return {
    getSnapshot: () => state,
    refresh: () => refresh(true),
    subscribe: (notify: () => void) => {
      subscribers.add(notify);
      if (subscribers.size === 1) {
        interval = window.setInterval(visibleRefresh, freshnessMs);
        document.addEventListener('visibilitychange', visibleRefresh);
        window.addEventListener('focus', visibleRefresh);
        window.addEventListener('online', visibleRefresh);
      }
      refresh();
      return () => {
        subscribers.delete(notify);
        if (!subscribers.size) {
          window.clearInterval(interval);
          document.removeEventListener('visibilitychange', visibleRefresh);
          window.removeEventListener('focus', visibleRefresh);
          window.removeEventListener('online', visibleRefresh);
        }
        cancelIfUnused();
      };
    },
    // A selected route may fetch while its component chunk is still loading.
    // Its lease prevents a transient subscriber hand-off from cancelling it.
    prefetch: () => {
      leases += 1;
      refresh();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        leases -= 1;
        cancelIfUnused();
      };
    },
  };
}

export const financeStore = createFinanceStore();
