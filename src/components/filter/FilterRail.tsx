import { Group } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import type { ReactNode } from 'react';
import classes from './filter.module.css';

/**
 * Hızlı filtre şeridi. 320 tabanı: tek satır, yatay kaydırma (kesilen son çip kaydırma ipucu, sağda solma).
 * ≥48em: çipler sarar. İki ayrı kod yolu (medya sorgusuyla gizleme yok).
 */
export function FilterRail({ children, 'aria-label': ariaLabel = 'Hızlı filtreler' }: { children: ReactNode; 'aria-label'?: string }) {
  const wide = useMediaQuery('(min-width: 48em)', false, { getInitialValueInEffect: false });
  if (wide) {
    return (
      <Group gap={6} wrap="wrap" role="group" aria-label={ariaLabel} data-testid="filter-rail" className={classes.railWide}>
        {children}
      </Group>
    );
  }
  return (
    <div className={classes.rail} role="group" aria-label={ariaLabel} data-testid="filter-rail">
      <Group gap={6} wrap="nowrap" className={classes.railInner}>{children}</Group>
    </div>
  );
}
