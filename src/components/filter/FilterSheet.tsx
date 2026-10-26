import { Button, Drawer, Group, Paper, Stack } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import type { ReactNode } from 'react';
import classes from './filter.module.css';

export interface FilterSheetProps {
  opened: boolean;
  onClose: () => void;
  title?: string;
  /** Canlı sonuç sayısı (alt düğme metni). */
  resultCount: number;
  activeCount: number;
  onClear: () => void;
  children: ReactNode;
}

/**
 * Filtre sayfası: 320'de alttan tam yükseklik, ≥48em sağdan 360 px panel. Gövde kayar, alt çubuk sabittir.
 * Filtreler anında uygulanır; "N kalemi göster" yalnız kapatır (işlevsiz "Uygula" yok).
 */
export function FilterSheet({ opened, onClose, title = 'Filtrele', resultCount, activeCount, onClear, children }: FilterSheetProps) {
  const wide = useMediaQuery('(min-width: 48em)', false, { getInitialValueInEffect: false });
  const none = resultCount === 0;
  return (
    <Drawer.Root
      opened={opened} onClose={onClose} position={wide ? 'right' : 'bottom'} size={wide ? 360 : 'calc(100dvh - 24px)'}
      radius={wide ? 0 : 'lg'} trapFocus returnFocus classNames={{ content: classes.sheetContent, body: classes.sheetBody, header: classes.sheetHeader }}
    >
      <Drawer.Overlay backgroundOpacity={0.55} />
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title component="h2" className={classes.sheetTitle}>{title}</Drawer.Title>
          <Drawer.CloseButton size="xl" aria-label="Kapat" />
        </Drawer.Header>
        <Drawer.Body>
          <Stack gap="md" px="sm" py="sm" data-testid="filter-drawer">{children}</Stack>
        </Drawer.Body>
        <Paper component="footer" radius={0} px="sm" py={6} className={classes.sheetFooter}>
          <Group gap={6} wrap="nowrap">
            <Button variant={none && activeCount > 0 ? 'filled' : 'default'} disabled={activeCount === 0} onClick={onClear} data-testid="filter-clear" style={{ flexShrink: 0 }}>
              Temizle{activeCount > 0 ? ` (${activeCount})` : ''}
            </Button>
            <Button variant={none ? 'default' : 'filled'} onClick={onClose} data-testid="filter-apply" className="tabular" style={{ flex: 1, minWidth: 0 }}>
              {none ? 'Kapat · 0 kalem' : `${resultCount} kalemi göster`}
            </Button>
          </Group>
        </Paper>
      </Drawer.Content>
    </Drawer.Root>
  );
}
