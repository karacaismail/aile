import { lazy, Suspense } from 'react';
import { useHashLocation } from 'wouter/use-hash-location';
import Dashboard from './dashboard/Dashboard';
const LegacyApp = lazy(() => import('./LegacyApp').then(m => ({ default: m.App })));

export function App() {
  const [location] = useHashLocation();
  return /^\/(satinalma|aydinlatma|tadilat|yerlesim|butce|ayarlar)(\/|$)/.test(location)
    ? <Suspense fallback={<p>Planlayıcı yükleniyor…</p>}><LegacyApp /></Suspense>
    : <Dashboard />;
}
