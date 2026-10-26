import { Router } from 'wouter';
import { useHashLocation } from 'wouter/use-hash-location';
import { AppShellLayout } from './app/shell/AppShellLayout';
import { AppRoutes } from './routes';

export function App() {
  return (
    <Router hook={useHashLocation}>
      <AppShellLayout>
        <AppRoutes />
      </AppShellLayout>
    </Router>
  );
}
