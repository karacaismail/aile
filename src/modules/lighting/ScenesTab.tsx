import { useMemo } from 'react';
import { Button, EmptyState, SimpleGrid, Skeleton, Stack } from '@mantine/core';
import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus';
import { SlidersHorizontalIcon } from '@phosphor-icons/react/dist/csr/SlidersHorizontal';
import { useLocation } from 'wouter';
import { useAppStore } from '@/sync/store';
import { byId, selectHydration, selectLayers, selectScenes } from './data';
import { SceneCard } from './SceneCard';

export function ScenesTab() {
  const [, navigate] = useLocation();
  const scenes = useAppStore(selectScenes);
  const layers = useAppStore(selectLayers);
  const { hydrated, status } = useAppStore(selectHydration);
  const layerMap = useMemo(() => byId(layers), [layers]);
  const sorted = useMemo(() => {
    const coll = new Intl.Collator('tr');
    return scenes.slice().sort((a, b) => coll.compare(a.oda ?? '', b.oda ?? '') || coll.compare(a.ad, b.ad));
  }, [scenes]);
  if (!hydrated && status !== 'unconfigured') {
    return <Stack gap="xs" p="sm"><Skeleton h={76} radius="md" /><Skeleton h={76} radius="md" /></Stack>;
  }
  return (
    <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="xs" p="sm" data-testid="scene-list">
      {sorted.length === 0 ? (
        <EmptyState icon={<SlidersHorizontalIcon size={40} aria-hidden />} title="Henüz sahne yok" description="Bir tetik (düğme, sensör, zaman) ile katman seviyelerini tanımlayın." data-testid="empty-state" style={{ gridColumn: '1 / -1' }}>
          <EmptyState.Actions>
            <Button leftSection={<PlusIcon size={18} aria-hidden />} onClick={() => navigate('~/aydinlatma/sahne/yeni')}>Sahne ekle</Button>
          </EmptyState.Actions>
        </EmptyState>
      ) : (
        sorted.map((s) => <SceneCard key={s.id} scene={s} layers={layerMap} />)
      )}
    </SimpleGrid>
  );
}
