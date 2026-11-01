import { Component, Suspense, useCallback, useEffect, useState, type ReactNode } from 'react';

function ChartReady({ onReady }: { onReady: () => void }) {
  useEffect(onReady, [onReady]);
  return null;
}

class ChartBoundary extends Component<{ children: ReactNode; onError: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError(); }
  render() { return this.state.failed ? null : this.props.children; }
}

/** The live region sits outside the boundary subtree React remounts after an error. */
export function OptionalCharts({ children, loading, error }: { children: ReactNode; loading: string; error: string }) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const onReady = useCallback(() => setState('ready'), []), onError = useCallback(() => setState('error'), []);
  return <><div role="status">{state === 'error' ? error : state === 'loading' ? loading : ''}</div><ChartBoundary onError={onError}><Suspense fallback={null}>{children}<ChartReady onReady={onReady} /></Suspense></ChartBoundary></>;
}
