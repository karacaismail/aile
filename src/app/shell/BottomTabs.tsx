import { UnstyledButton, Text, Box } from '@mantine/core';
import { Link, useLocation } from 'wouter';
import { ShoppingCartIcon, LightbulbIcon, PaintRollerIcon, BlueprintIcon } from '@phosphor-icons/react';
import { MODULES } from '../../routes';
import classes from './BottomTabs.module.css';

const ICONS = {
  satinalma: ShoppingCartIcon,
  aydinlatma: LightbulbIcon,
  tadilat: PaintRollerIcon,
  yerlesim: BlueprintIcon,
} as const;

export function BottomTabs() {
  const [location] = useLocation();
  return (
    <Box component="nav" aria-label="Modüller" className={classes.bar}>
      {MODULES.map((m) => {
        const Icon = ICONS[m.key];
        const active = location === m.path || location.startsWith(`${m.path}/`);
        return (
          <UnstyledButton
            key={m.key}
            component={Link}
            href={m.path}
            className={classes.tab}
            data-active={active || undefined}
            aria-current={active ? 'page' : undefined}
            data-testid={`tab-${m.key}`}
          >
            <Icon size={24} weight={active ? 'fill' : 'regular'} aria-hidden />
            <Text className={classes.label}>{m.label}</Text>
          </UnstyledButton>
        );
      })}
    </Box>
  );
}
