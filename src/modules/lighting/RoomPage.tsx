import { useMemo } from 'react';
import { ActionIcon, Alert, Box, Button, EmptyState, Group, Paper, SimpleGrid, Skeleton, Stack, Text, Title } from '@mantine/core';
import { ArrowLeftIcon, LightbulbIcon, PlusIcon, StackIcon } from '@phosphor-icons/react';
import { Link, useLocation } from 'wouter';
import { label } from '@shared/schema';
import { useAppStore } from '@/sync/store';
import { DogAccessBadge } from '@/components/DogAccessBadge';
import { Fab } from '@/app/shell/Fab';
import { isRoom, selectHydration, selectLayers, selectPurchases, useRoomSetting } from './data';
import { createCoreLayers } from './actions';
import { layersOfRoom, linkedPurchases, roomBadges } from './rules';
import { LayerCard } from './LayerCard';
import { LayerForm } from './LayerForm';
import classes from './lighting.module.css';

export function RoomPage({ oda, layerId }: { oda: string; layerId?: string }) {
  const [, navigate] = useLocation();
  const layers = useAppStore(selectLayers);
  const purchases = useAppStore(selectPurchases);
  const { hydrated, status } = useAppStore(selectHydration);
  const room = useRoomSetting(oda);
  const roomLayers = useMemo(() => layersOfRoom(layers, oda), [layers, oda]);
  const missing = useMemo(() => roomBadges(roomLayers).missing, [roomLayers]);

  if (!isRoom(oda)) {
    return (
      <Stack p="sm" gap="sm">
        <Alert color="yellow" title="Oda bulunamadı"><Text size="sm">"{oda}" tanımlı bir oda değil.</Text></Alert>
        <Button component={Link} href="~/aydinlatma" variant="default" leftSection={<ArrowLeftIcon size={18} aria-hidden />}>Odalara dön</Button>
      </Stack>
    );
  }
  const name = label('oda', oda);
  const addLayer = () => navigate(`~/aydinlatma/${oda}/yeni`);
  return (
    <Box pb={96}>
      <Paper className={classes.sticky} px="sm" py={6} radius={0} data-testid="room-header">
        <Group gap="xs" wrap="nowrap">
          <ActionIcon aria-label="Geri" color="gray" onClick={() => navigate('~/aydinlatma')}><ArrowLeftIcon size={22} aria-hidden /></ActionIcon>
          <Title order={2} size="h4" lineClamp={1} className={classes.grow} data-allow-clamp>{name}</Title>
          <DogAccessBadge value={room.kopek_erisim} prefix unsetLabel="ayarlanmadı" data-testid="dog-badge" />
        </Group>
        {!room.kopek_erisim && (
          <Text size="xs" c="dimmed" mt={2}>Köpek erişimi ayarlanmadı · <Link href="~/ayarlar" data-inline-link>Ayarlar</Link></Text>
        )}
      </Paper>
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="xs" p="sm" data-testid="layer-list">
        {!hydrated && status !== 'unconfigured' ? (
          <><Skeleton h={96} radius="md" /><Skeleton h={96} radius="md" /><Skeleton h={96} radius="md" /></>
        ) : roomLayers.length === 0 ? (
          <EmptyState icon={<LightbulbIcon size={40} aria-hidden />} title="Bu odada katman yok" description="Ana, görev ve gece katmanlarıyla başlayın; spec'leri sonra doldurun." data-testid="empty-state" style={{ gridColumn: '1 / -1' }}>
            <EmptyState.Actions>
              <Button leftSection={<StackIcon size={18} aria-hidden />} onClick={() => createCoreLayers(oda, layers)}>Oda katmanlarını oluştur</Button>
              <Button variant="default" leftSection={<PlusIcon size={18} aria-hidden />} onClick={addLayer}>Katman ekle</Button>
            </EmptyState.Actions>
          </EmptyState>
        ) : (
          <>
            {roomLayers.map((l) => <LayerCard key={l.id} layer={l} room={room} linkedCount={linkedPurchases(l, purchases).length} />)}
            {missing.length > 0 && (
              <Button variant="default" leftSection={<StackIcon size={18} aria-hidden />} onClick={() => createCoreLayers(oda, layers)} style={{ gridColumn: '1 / -1' }}>
                Eksik temel katmanları oluştur ({missing.map((m) => label('katman_tur', m).toLocaleLowerCase('tr')).join(', ')})
              </Button>
            )}
          </>
        )}
      </SimpleGrid>
      <Fab onClick={addLayer} label="Katman ekle" />
      {layerId && <LayerForm key={layerId} oda={oda} id={layerId} />}
    </Box>
  );
}
