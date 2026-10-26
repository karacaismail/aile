import { Group, Title, ActionIcon } from '@mantine/core';
import { GearSixIcon } from '@phosphor-icons/react';
import { Link, useLocation } from 'wouter';
import { MODULES } from '../../routes';
import type { ReactNode } from 'react';

export function TopBar({ right }: { right?: ReactNode }) {
  const [location] = useLocation();
  const current = MODULES.find((m) => location === m.path || location.startsWith(`${m.path}/`));
  const title = location.startsWith('/ayarlar') ? 'Ayarlar' : (current?.label ?? 'aile');
  return (
    <Group h="100%" px="sm" justify="space-between" wrap="nowrap" gap="xs">
      <Title order={1} size="h4" lineClamp={1} data-testid="topbar-title">
        {title}
      </Title>
      <Group gap={4} wrap="nowrap">
        {right}
        <ActionIcon component={Link} href="/ayarlar" aria-label="Ayarlar" variant="subtle" color="gray">
          <GearSixIcon size={22} aria-hidden />
        </ActionIcon>
      </Group>
    </Group>
  );
}
