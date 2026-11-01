import { fetchBudget, type Budget } from './data';
import { BudgetIntegrityError } from './integrity';

type BudgetState = { data: Budget | null; error: string | null; loading: boolean; updatedAt: Date | null };
const freshnessMs = 60_000;
let state: BudgetState = { data: null, error: null, loading: true, updatedAt: null };
const subscribers = new Set<() => void>();
let request: { controller: AbortController; timeout: number } | null = null;
let interval: number | undefined;

// Only fetchBudget's validated result is retained, in this tab's memory.
const publish = (next: BudgetState) => {
  state = next;
  subscribers.forEach(notify => notify());
};
const refresh = (force = false) => {
  const fresh = state.data !== null && state.error === null && state.updatedAt !== null && Date.now() - state.updatedAt.getTime() < freshnessMs;
  if (!subscribers.size || request || (!force && fresh)) return;
  const current = { controller: new AbortController(), timeout: 0 };
  request = current;
  publish({ ...state, loading: true });
  const finish = (next: BudgetState) => {
    if (request !== current) return;
    request = null;
    window.clearTimeout(current.timeout);
    publish(next);
  };
  const fail = (error: unknown) => finish({
    ...state,
    ...(error instanceof BudgetIntegrityError ? { data: null, updatedAt: null } : {}),
    loading: false,
    error: error instanceof Error && error.name !== 'AbortError' ? error.message : 'Bağlantı zaman aşımına uğradı.',
  });
  current.timeout = window.setTimeout(() => {
    if (request !== current) return;
    current.controller.abort();
    fail(null);
  }, 20_000);
  void fetchBudget(current.controller.signal).then(
    data => finish({ data, error: null, loading: false, updatedAt: new Date() }),
    fail,
  );
};
const visibleRefresh = () => { if (document.visibilityState === 'visible') refresh(); };

export const budgetStore = {
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
      if (subscribers.size) return;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', visibleRefresh);
      window.removeEventListener('focus', visibleRefresh);
      window.removeEventListener('online', visibleRefresh);
      if (!request) return;
      const abandoned = request;
      request = null;
      window.clearTimeout(abandoned.timeout);
      abandoned.controller.abort();
      publish({ ...state, loading: false });
    };
  },
};
