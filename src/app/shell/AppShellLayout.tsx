import { AppShell } from '@mantine/core';
import type { ReactNode } from 'react';
import { BottomTabs } from './BottomTabs';
import { TopBar } from './TopBar';

export function AppShellLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell
      header={{ height: 48 }}
      footer={{ height: 'calc(56px + var(--aile-safe-bottom))' }}
      padding={0}
    >
      <AppShell.Header>
        <TopBar />
      </AppShell.Header>
      <AppShell.Main>
        {children}
      </AppShell.Main>
      <AppShell.Footer withBorder={false}>
        <BottomTabs />
      </AppShell.Footer>
    </AppShell>
  );
}
