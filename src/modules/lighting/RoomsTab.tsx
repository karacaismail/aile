import { useMemo, useState } from 'react';
import { Button, EmptyState, SimpleGrid, Skeleton, Stack } from '@mantine/core';
import { LightbulbIcon } from '@phosphor-icons/react/dist/csr/Lightbulb';
import { StackIcon } from '@phosphor-icons/react/dist/csr/Stack';
import type { Item, Oda } from '@shared/schema';
import { useAppStore } from '@/sync/store';
import { EnumSelect } from '@/components/EnumSelect';
import { ROOMS, selectHydration, selectLayers } from './data';
import { createCoreLayers } from './actions';
import { EmptyRoomRow, RoomCard } from './RoomCard';
import classes from './lighting.module.css';

/** Rooms with layers are cards; rooms without any are one group of compact rows, so the empty state is said once. */
export function RoomsTab() {
  const layers = useAppStore(selectLayers);
  const { hydrated, status } = useAppStore(selectHydration);
  const [oda, setOda] = useState<Oda>('salon');
  const byRoom = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const l of layers) { const key = l.oda ?? ''; const arr = m.get(key) ?? []; arr.push(l); m.set(key, arr); }
    return m;
  }, [layers]);
  if (!hydrated && status !== 'unconfigured') {
    return <Stack gap="xs" p="sm"><Skeleton h={76} radius="md" /><Skeleton h={76} radius="md" /><Skeleton h={76} radius="md" /></Stack>;
  }
  const planned = ROOMS.filter((o) => byRoom.has(o));
  const empty = ROOMS.filter((o) => !byRoom.has(o));
  return (
    <Stack gap={0} p="sm" data-testid="room-list">
      {layers.length === 0 && (
        <EmptyState icon={<LightbulbIcon size={40} aria-hidden />} title="Henüz hiçbir odada katman yok" description="Bir oda seçin; ana, görev ve gece katmanları boş spec ile oluşturulur." data-testid="empty-state">
          <EmptyState.Actions>
            <Stack gap="xs" w="100%">
              <EnumSelect aria-label="Oda" field="oda" options={ROOMS} value={oda} onChange={(v) => setOda((v as Oda | undefined) ?? 'salon')} allowEmpty={false} />
              <Button leftSection={<StackIcon size={18} aria-hidden />} onClick={() => createCoreLayers(oda, layers)}>Oda katmanlarını oluştur</Button>
            </Stack>
          </EmptyState.Actions>
        </EmptyState>
      )}
      {planned.length > 0 && (
        <section aria-labelledby="lighting-planned">
          <div className="record-group-heading"><h2 id="lighting-planned">Katmanı olan odalar</h2><p>{planned.length} oda</p></div>
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="xs">
            {planned.map((o) => <RoomCard key={o} oda={o} layers={byRoom.get(o)!} />)}
          </SimpleGrid>
        </section>
      )}
      {empty.length > 0 && (
        <section aria-labelledby="lighting-empty">
          <div className="record-group-heading"><h2 id="lighting-empty">Henüz katman yok</h2><p>{empty.length} oda · ana, görev ve gece katmanları eksik</p></div>
          <ul className={classes.emptyRooms}>
            {empty.map((o) => <EmptyRoomRow key={o} oda={o} />)}
          </ul>
        </section>
      )}
    </Stack>
  );
}
