import { Button, Drawer, Group, Paper, Stack } from '@mantine/core';
import { useMediaQuery, useReducedMotion } from '@mantine/hooks';
import type { ReactNode } from 'react';
import { tokens } from '@/dashboard/tokens';
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
  /** Purchase filters use the same left edge at every narrow width. Other callers keep the existing layout. */
  side?: 'left';
  initialFocusKey?: string | null;
}

/** Stable mount ref: changing filters must not reattach Mantine's active focus trap. */
function initializeContentFocus(node: HTMLDivElement | null) {
  const initialKey = node?.dataset.initialFocusKey;
  if (!node || !initialKey) return;
  const key = CSS.escape(initialKey);
  const target = node.querySelector(`[data-filter-key="${key}"], [data-testid="${key}"] input, [data-testid="${key}"] button`);
  if (!target) return;
  node.querySelectorAll('[data-autofocus]').forEach(element => element.removeAttribute('data-autofocus'));
  target.setAttribute('data-autofocus', 'true');
}

/**
 * Filtre sayfası: 320'de alttan tam yükseklik, ≥48em sağdan 360 px panel. Gövde kayar, alt çubuk sabittir.
 * Filtreler anında uygulanır; "N kalemi göster" yalnız kapatır (işlevsiz "Uygula" yok).
 */
export function FilterSheet({ opened, onClose, title = 'Filtrele', resultCount, activeCount, onClear, children, side, initialFocusKey }: FilterSheetProps) {
  const wide = useMediaQuery('(min-width: 48em)', false, { getInitialValueInEffect: false });
  const reduced = useReducedMotion();
  const none = resultCount === 0;
  return (
    <Drawer.Root
      opened={opened} onClose={onClose} position={side ?? (wide ? 'right' : 'bottom')} size={side ? `min(100%, ${tokens.purchaseDrawerWidth})` : wide ? 360 : 'calc(100dvh - 24px)'}
      radius={side || wide ? 0 : 'lg'} trapFocus returnFocus classNames={{ content: classes.sheetContent, body: classes.sheetBody, header: classes.sheetHeader }}
      transitionProps={{ duration: reduced ? 0 : tokens.duration, timingFunction: tokens.ease }}
    >
      <Drawer.Overlay backgroundOpacity={0.55} />
      <Drawer.Content data-purchase-filters={side === 'left' || undefined} inert={!opened} aria-hidden={!opened} data-initial-focus-key={initialFocusKey ?? undefined} ref={initializeContentFocus}>
        <Drawer.Header>
          <Drawer.Title component="h2" className={classes.sheetTitle}>{title}</Drawer.Title>
          <Drawer.CloseButton size="xl" aria-label="Kapat" />
        </Drawer.Header>
        <Drawer.Body>
          <Stack gap="md" px="sm" py="sm" data-testid="filter-drawer">{children}</Stack>
        </Drawer.Body>
        <Paper component="footer" radius={0} px="sm" py="sm" className={classes.sheetFooter}>
          <Group gap="sm" wrap="nowrap">
            <Button variant={none && activeCount > 0 ? 'filled' : 'default'} disabled={activeCount === 0} onClick={onClear} data-testid="filter-clear" data-filter-key="clear:all" style={{ flexShrink: 0 }}>
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
