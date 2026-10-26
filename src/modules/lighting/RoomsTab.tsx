import { useMemo, useState } from 'react';
import { Button, EmptyState, Skeleton, Stack } from '@mantine/core';
import { LightbulbIcon, StackIcon } from '@phosphor-icons/react';
import type { Item, Oda } from '@shared/schema';
import { useAppStore } from '@/sync/store';
import { EnumSelect } from '@/components/EnumSelect';
import { ROOMS, selectHydration, selectLayers } from './data';
import { createCoreLayers } from './actions';
import { RoomCard } from './RoomCard';

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
  return (
    <Stack gap="xs" p="sm" data-testid="room-list">
      {layers.length === 0 && (
        <EmptyState icon={<LightbulbIcon size={40} aria-hidden />} title="Henüz katman yok" description="Bir oda seçin; ana, görev ve gece katmanları boş spec ile oluşturulur." data-testid="empty-state">
          <EmptyState.Actions>
            <Stack gap="xs" w="100%">
              <EnumSelect aria-label="Oda" field="oda" options={ROOMS} value={oda} onChange={(v) => setOda((v as Oda | undefined) ?? 'salon')} allowEmpty={false} />
              <Button leftSection={<StackIcon size={18} aria-hidden />} onClick={() => createCoreLayers(oda, layers)}>Oda katmanlarını oluştur</Button>
            </Stack>
          </EmptyState.Actions>
        </EmptyState>
      )}
      {ROOMS.map((o) => <RoomCard key={o} oda={o} layers={byRoom.get(o) ?? []} />)}
    </Stack>
  );
}
