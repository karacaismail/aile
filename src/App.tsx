import { lazy, Suspense } from 'react';
import { MantineProvider } from '@mantine/core';
import { theme, cssVariablesResolver } from './theme';
import { FamilyFrame } from './app/family/FamilyFrame';
import { isPlannerRoute } from './app/family/navigation';
import { useKeyboardMode } from './dashboard/keyboard';
import './app/family/family.css';
import { useHashLocation } from 'wouter/use-hash-location';
import Dashboard from './dashboard/Dashboard';
import { UpdateNotice } from './app/UpdateNotice';
const LegacyApp = lazy(() => import('./LegacyApp').then(m => ({ default: m.App })));

export function App() {
  const [location] = useHashLocation();
  useKeyboardMode();
  return <MantineProvider theme={theme} cssVariablesResolver={cssVariablesResolver} forceColorScheme="light">
    <FamilyFrame location={location}><UpdateNotice />{isPlannerRoute(location)
      ? <Suspense fallback={<p className="family-loading" role="status">Ev planı ve kayıtlar yükleniyor…</p>}><LegacyApp /></Suspense>
      : <Dashboard />}</FamilyFrame>
  </MantineProvider>;
}
