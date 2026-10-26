import { AppShell } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import type { ReactNode } from 'react';
import { BottomTabs } from './BottomTabs';
import { TopBar } from './TopBar';
import { SideNav } from './SideNav';
import { SyncStatus } from './SyncStatus';

/**
 * Kabuk, 320 px tabandan yukarı doğru zenginleşir:
 * - taban: üst çubuk + alt sekmeler (başparmak erişimi)
 * - ≥768 (tablet): sol gezinme çubuğu, alt sekmeler kalkar
 * - ≥1024/1280: daha geniş gezinme ve ortalanmış içerik sütunu (styles.css .aile-content)
 */
export function AppShellLayout({ children }: { children: ReactNode }) {
  const wide = useMediaQuery('(min-width: 48em)', false, { getInitialValueInEffect: false });
  return (
    <AppShell
      header={{ height: 52 }}
      navbar={{ width: { sm: 220, md: 240, lg: 264 }, breakpoint: 'sm', collapsed: { mobile: true, desktop: false } }}
      footer={{ height: 'calc(60px + var(--aile-safe-bottom))', collapsed: wide }}
      padding={0}
    >
      <AppShell.Header>
        <TopBar right={<SyncStatus />} />
      </AppShell.Header>
      <AppShell.Navbar p="sm" visibleFrom="sm">
        <SideNav />
      </AppShell.Navbar>
      <AppShell.Main>
        <div className="aile-content">{children}</div>
      </AppShell.Main>
      <AppShell.Footer withBorder={false} hiddenFrom="sm">
        <BottomTabs />
      </AppShell.Footer>
    </AppShell>
  );
}
