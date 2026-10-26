import { useMemo } from 'react';
import { Badge, Box, Card, Group, Skeleton, Stack, Text } from '@mantine/core';
import { CaretRightIcon } from '@phosphor-icons/react';
import { Link } from 'wouter';
import type { Item, Oda, Setting } from '@shared/schema';
import { label } from '@shared/schema';
import { useAppStore, type AppState } from '@/sync/store';
import { WarnBadge } from '@/components/badges';
import { DogAccessBadge } from '@/components/DogAccessBadge';
import { ROOMS, formatDims, parseRoomSetting, roomItems, wallSummary, type RoomDims } from './rules';
import classes from './layout.module.css';

const selectState = (s: AppState) => ({ items: s.items, settings: s.settings, hydrated: s.hydrated, status: s.status });

export function roomSetting(settings: readonly Setting[], oda: string): Setting | undefined {
  return settings.find((x) => !x.deleted_at && x.tip === 'oda' && x.anahtar === oda);
}

function RoomCard({ oda, dims, items }: { oda: Oda; dims: RoomDims; items: Item[] }) {
  const size = formatDims({ en_cm: dims.en_cm, boy_cm: dims.boy_cm }, ' × ');
  const walls = wallSummary(dims, items);
  return (
    <Card component={Link} href={`~/yerlesim/${oda}`} withBorder radius="md" p="sm" className={classes.card} data-testid="room-card">
      <Group justify="space-between" wrap="nowrap" gap="xs">
        <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
          <Text fw={600} className={classes.title}>{label('oda', oda)}</Text>
          <Group gap={6} wrap="nowrap">
            <Text size="sm" c={size ? undefined : 'dimmed'} className="tabular">{size || 'ölçü gir'}</Text>
            <Text size="sm" c="dimmed" aria-hidden>·</Text>
            <Text size="sm" c="dimmed">{items.length} kalem</Text>
          </Group>
          <Group gap={4} wrap="wrap">
            <DogAccessBadge value={dims.kopek_erisim} />
            {size && walls.map((w) => (
              w.remaining !== undefined && w.remaining < 0
                ? <WarnBadge key={w.wall} tone="danger" className="tabular">{w.wall} −{-w.remaining}</WarnBadge>
                : <Badge key={w.wall} size="xs" variant="default" className="tabular">{w.wall} {w.remaining ?? '?'}</Badge>
            ))}
          </Group>
        </Stack>
        <CaretRightIcon size={18} aria-hidden style={{ flexShrink: 0, color: 'var(--mantine-color-dimmed)' }} />
      </Group>
    </Card>
  );
}

export function RoomList() {
  const { items, settings, hydrated, status } = useAppStore(selectState);
  const rooms = useMemo(() => ROOMS.map((oda) => ({ oda, dims: parseRoomSetting(roomSetting(settings, oda)?.deger), items: roomItems(items, oda) })), [items, settings]);
  if (!hydrated && status !== 'unconfigured') {
    return (
      <Stack gap="xs" p="sm" data-testid="room-list-skeleton">
        <Skeleton h={88} radius="md" /><Skeleton h={88} radius="md" /><Skeleton h={88} radius="md" />
      </Stack>
    );
  }
  return (
    <Box pb={24}>
      <Text size="sm" c="dimmed" px="sm" pt="sm">Duvar başına yerleşim, priz ve kanal ihtiyacı. Oda kartına dokunun.</Text>
      <Stack gap="xs" p="sm" data-testid="room-list">
        {rooms.map((r) => <RoomCard key={r.oda} oda={r.oda} dims={r.dims} items={r.items} />)}
      </Stack>
    </Box>
  );
}
