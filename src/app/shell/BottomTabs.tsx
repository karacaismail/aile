import { UnstyledButton, Box } from '@mantine/core';
import { Link, useLocation } from 'wouter';
import { MODULES } from '../../routes';
import { MODULE_ICONS, MODULE_SHORT_LABELS } from './moduleIcons';
import classes from './BottomTabs.module.css';

export function BottomTabs() {
  const [location] = useLocation();
  return (
    <Box component="nav" aria-label="Modüller" className={classes.bar}>
      {MODULES.map((m) => {
        const Icon = MODULE_ICONS[m.key];
        const active = location === m.path || location.startsWith(`${m.path}/`);
        return (
          <UnstyledButton
            key={m.key}
            component={Link}
            href={m.path}
            className={classes.tab}
            data-active={active || undefined}
            aria-current={active ? 'page' : undefined}
            aria-label={m.label}
            data-testid={`tab-${m.key}`}
          >
            <Icon size={24} weight={active ? 'fill' : 'regular'} aria-hidden />
            <span className={classes.label}>
              <span className={classes.short}>{MODULE_SHORT_LABELS[m.key]}</span>
              <span className={classes.long}>{m.label}</span>
            </span>
          </UnstyledButton>
        );
      })}
    </Box>
  );
}
