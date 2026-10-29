import { useEffect, useRef, useState } from 'react';
import { fetchTimeline, type Timeline } from './data';

export function useTimeline() {
  const [state, setState] = useState<{ data: Timeline | null; error: string | null; loading: boolean; updatedAt: Date | null }>({ data: null, error: null, loading: true, updatedAt: null });
  const refreshRef = useRef<() => void>(() => {});
  useEffect(() => {
    let active = true, busy = false;
    let controller: AbortController | undefined;
    const refresh = async () => {
      if (busy || !active) return;
      busy = true;
      controller = new AbortController();
      const timeout = window.setTimeout(() => controller?.abort(), 20000);
      setState(previous => ({ ...previous, loading: true }));
      try {
        const data = await fetchTimeline(controller.signal);
        if (active) setState({ data, error: null, loading: false, updatedAt: new Date() });
      } catch (error) {
        if (active) setState(previous => ({ ...previous, loading: false, error: error instanceof Error && error.name !== 'AbortError' ? error.message : 'Timeline bağlantısı zaman aşımına uğradı.' }));
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
