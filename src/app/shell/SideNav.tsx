import { NavLink, Stack, Text, Divider } from '@mantine/core';
import { GearSixIcon } from '@phosphor-icons/react';
import { Link, useLocation } from 'wouter';
import { MODULES } from '../../routes';
import { MODULE_ICONS } from './moduleIcons';

/** ≥768 px: sol gezinme. Alt sekmelerle aynı modül listesi ve ikonlar. */
export function SideNav() {
  const [location] = useLocation();
  const isActive = (path: string) => location === path || location.startsWith(`${path}/`);
  return (
    <Stack gap={4} h="100%" data-testid="side-nav">
      <Text fw={700} size="lg" px="sm" py={4}>aile</Text>
      <nav aria-label="Modüller">
        {MODULES.map((m) => {
          const Icon = MODULE_ICONS[m.key];
          const active = isActive(m.path);
          return (
            <NavLink
              key={m.key}
              component={Link}
              href={m.path}
              label={m.label}
              active={active}
              aria-current={active ? 'page' : undefined}
              leftSection={<Icon size={22} weight={active ? 'fill' : 'regular'} aria-hidden />}
              data-testid={`nav-${m.key}`}
            />
          );
        })}
      </nav>
      <Divider my="xs" />
      <NavLink component={Link} href="/ayarlar" label="Ayarlar" active={location.startsWith('/ayarlar')} leftSection={<GearSixIcon size={22} aria-hidden />} data-testid="nav-ayarlar" />
    </Stack>
  );
}
