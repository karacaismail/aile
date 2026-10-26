import { useEffect } from 'react';
import { Router } from 'wouter';
import { useHashLocation } from 'wouter/use-hash-location';
import { AppShellLayout } from './app/shell/AppShellLayout';
import { AppRoutes } from './routes';
import { startSync } from './sync/controller';

export function App() {
  useEffect(() => startSync(), []);
  return (
    <Router hook={useHashLocation}>
      <AppShellLayout>
        <AppRoutes />
      </AppShellLayout>
    </Router>
  );
}
