import '@mantine/dates/styles.css';
import '@mantine/notifications/styles.css';
import './styles.css';
import 'dayjs/locale/tr';
import { useEffect } from 'react';
import { Notifications } from '@mantine/notifications';
import { ModalsProvider } from '@mantine/modals';
import { DatesProvider } from '@mantine/dates';
import { Router } from 'wouter';
import { useHashLocation } from 'wouter/use-hash-location';
import { AppRoutes } from './routes';
import { startSync } from './sync/controller';
import { SyncStatus } from './app/shell/SyncStatus';
import { ExpenseHost } from './modules/budget/ExpenseForm';
import { openExpense } from './modules/budget/quick';
import { ReceiptIcon } from '@phosphor-icons/react/dist/csr/Receipt';
import { isRoute, plannerPages } from './app/family/navigation';

export function App() {
  useEffect(() => startSync(), []);
  const [location] = useHashLocation();
  const current = plannerPages.find(page => isRoute(location, page.path)) ?? plannerPages[0];
  return <DatesProvider settings={{ locale: 'tr', firstDayOfWeek: 1 }}><ModalsProvider><Notifications position="top-center" limit={3} /><Router hook={useHashLocation}>
    <section className="aile-planner" aria-label={current.title}>
      <header className="family-page-heading"><h1 data-testid="topbar-title">{current.title}</h1><div className="family-page-actions"><SyncStatus /><button className="quiet-button family-expense" aria-label="Harcama ekle" title="Harcama ekle" onClick={() => openExpense()} data-testid="topbar-expense"><ReceiptIcon size={24} aria-hidden /><span>Harcama ekle</span></button></div><p>{current.description}</p></header>
      <AppRoutes />
    </section>
    <ExpenseHost />
  </Router></ModalsProvider></DatesProvider>;
}
