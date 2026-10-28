import { useEffect, useRef, useState } from 'react';
import { fetchBudget, type Budget } from './data';

export function useBudget() {
  const [state, setState] = useState<{ data: Budget | null; error: string | null; loading: boolean; updatedAt: Date | null }>({ data: null, error: null, loading: true, updatedAt: null });
  const refreshRef = useRef<() => void>(() => {});
  useEffect(() => {
    let active = true, busy = false;
    let controller: AbortController | undefined;
    const refresh = async () => {
      if (busy || !active) return;
      busy = true;
      controller = new AbortController();
      const timeout = window.setTimeout(() => controller?.abort(), 20000);
      setState(s => ({ ...s, loading: true }));
      try {
        const data = await fetchBudget(controller.signal);
        if (active) setState({ data, error: null, loading: false, updatedAt: new Date() });
      } catch (error) {
        if (active) setState(s => ({ ...s, loading: false, error: error instanceof Error && error.name !== 'AbortError' ? error.message : 'Bağlantı zaman aşımına uğradı.' }));
      } finally { window.clearTimeout(timeout); busy = false; }
    };
    const visibleRefresh = () => { if (document.visibilityState === 'visible') void refresh(); };
    refreshRef.current = () => { void refresh(); };
    void refresh();
    const interval = window.setInterval(visibleRefresh, 60000);
    document.addEventListener('visibilitychange', visibleRefresh);
    window.addEventListener('focus', visibleRefresh);
    window.addEventListener('online', visibleRefresh);
    return () => { active = false; controller?.abort(); window.clearInterval(interval); document.removeEventListener('visibilitychange', visibleRefresh); window.removeEventListener('focus', visibleRefresh); window.removeEventListener('online', visibleRefresh); };
  }, []);
  return { ...state, refresh: () => refreshRef.current() };
}
