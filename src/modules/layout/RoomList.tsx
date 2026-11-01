import { useMemo } from 'react';
import { Box, Card, Group, SimpleGrid, Skeleton, Stack, Text } from '@mantine/core';
import { CaretRightIcon } from '@phosphor-icons/react/dist/csr/CaretRight';
import { WarningIcon } from '@phosphor-icons/react/dist/csr/Warning';
import { Link } from 'wouter';
import type { Item, Oda, Setting } from '@shared/schema';
import { label } from '@shared/schema';
import { useAppStore, type AppState } from '@/sync/store';
import { FactList } from '@/components/Info';
import { DogAccessBadge } from '@/components/DogAccessBadge';
import { ROOMS, formatDims, parseRoomSetting, roomItems, wallLabel, wallSummary, type RoomDims } from './rules';
import classes from './layout.module.css';

const selectState = (s: AppState) => ({ items: s.items, settings: s.settings, hydrated: s.hydrated, status: s.status });

export function roomSetting(settings: readonly Setting[], oda: string): Setting | undefined {
  return settings.find((x) => !x.deleted_at && x.tip === 'oda' && x.anahtar === oda);
}

function RoomCard({ oda, dims, items }: { oda: Oda; dims: RoomDims; items: Item[] }) {
  const size = formatDims({ en_cm: dims.en_cm, boy_cm: dims.boy_cm }, ' × ');
  const walls = wallSummary(dims, items);
  const over = walls.filter((w) => w.remaining !== undefined && w.remaining < 0);
  return (
    <Card component={Link} href={`~/yerlesim/${oda}`} radius="md" p="md" className={classes.card} data-testid="room-card">
      <Group justify="space-between" wrap="nowrap" gap="xs">
        <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
          <Text component="h2" fw={700} className={classes.title}>{label('oda', oda)}</Text>
          <FactList label={`${label('oda', oda)} oda özeti`} items={[
            { label: 'Oda ölçüsü', value: size || 'ölçü gir' },
            { label: 'Yerleşim', value: `${items.length} kalem` },
          ]} />
          {dims.kopek_erisim && <div><DogAccessBadge value={dims.kopek_erisim} /></div>}
          {over.length > 0 && (
            <ul className="record-attention">
              {over.map((w) => <li key={w.wall} data-tone="danger"><WarningIcon size={18} aria-hidden /><span>{wallLabel(w.wall)} duvarı {-w.remaining!} cm taşıyor</span></li>)}
            </ul>
          )}
          {size && (
            <p className="record-meta tabular">
              <span className="record-scope">Duvarda kalan (cm)</span>
              {walls.map((w) => <span key={w.wall} className="record-scope">{w.remaining !== undefined && w.remaining < 0 ? `${w.wall} −${-w.remaining}` : `${w.wall} ${w.remaining ?? '?'}`}</span>)}
            </p>
          )}
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
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="xs" p="sm" data-testid="room-list">
        {rooms.map((r) => <RoomCard key={r.oda} oda={r.oda} dims={r.dims} items={r.items} />)}
      </SimpleGrid>
    </Box>
  );
}
