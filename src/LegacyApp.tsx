import '@mantine/dates/styles.css';
import '@mantine/notifications/styles.css';
import './styles.css';
import 'dayjs/locale/tr';
import { useEffect } from 'react';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { ModalsProvider } from '@mantine/modals';
import { DatesProvider } from '@mantine/dates';
import { Router } from 'wouter';
import { useHashLocation } from 'wouter/use-hash-location';
import { AppShellLayout } from './app/shell/AppShellLayout';
import { AppRoutes } from './routes';
import { startSync } from './sync/controller';
import { theme, cssVariablesResolver } from './theme';
import { cssTokens } from './dashboard/tokens';
import { useKeyboardMode } from './dashboard/keyboard';
export function App() {
  useEffect(() => startSync(), []);
  useKeyboardMode();
  return <MantineProvider theme={theme} defaultColorScheme="auto" cssVariablesResolver={cssVariablesResolver}><DatesProvider settings={{locale:'tr',firstDayOfWeek:1}}><ModalsProvider><Notifications position="top-center" limit={3}/><Router hook={useHashLocation}>
    <AppShellLayout>
      <nav className="planner-links" style={cssTokens} aria-label="Yeni aile araçları"><a href="#/pano">Canlı bütçe panosu</a><a href="#/arac">Araç ve finansman simülasyonu</a></nav>
      <AppRoutes />
    </AppShellLayout>
  </Router></ModalsProvider></DatesProvider></MantineProvider>;
}
