import { useMemo, useState } from 'react';
import { ActionIcon, Alert, Badge, Box, Button, Card, Group, NumberInput, Paper, SimpleGrid, Stack, Table, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { ArrowLeftIcon } from '@phosphor-icons/react/dist/csr/ArrowLeft';
import { FloppyDiskIcon } from '@phosphor-icons/react/dist/csr/FloppyDisk';
import { HouseIcon } from '@phosphor-icons/react/dist/csr/House';
import { LightbulbIcon } from '@phosphor-icons/react/dist/csr/Lightbulb';
import { PlugIcon } from '@phosphor-icons/react/dist/csr/Plug';
import { RulerIcon } from '@phosphor-icons/react/dist/csr/Ruler';
import { ShoppingCartIcon } from '@phosphor-icons/react/dist/csr/ShoppingCart';
import { WallIcon } from '@phosphor-icons/react/dist/csr/Wall';
import { Link, Route, useLocation } from 'wouter';
import type { Item, Oda, Setting } from '@shared/schema';
import { KOPEK_ERISIM, label } from '@shared/schema';
import { useAppStore, type AppState } from '@/sync/store';
import { upsert } from '@/sync/controller';
import { EnumSelect } from '@/components/EnumSelect';
import { WarnBadge } from '@/components/badges';
import { DogAccessBadge } from '@/components/DogAccessBadge';
import { Fab } from '@/app/shell/Fab';
import {
  ROOMS, WALL_KEYS, fmtM, formatDims, needsMap, needsTotal, parseRoomSetting, remaining, roomItems, serializeRoomSetting, suggestionPatches,
  wallItems, wallLabel, wallLength, type KopekErisim, type NeedsMap, type RoomDims, type WallKey,
} from './rules';
import { ItemForm } from './ItemForm';
import { roomSetting } from './RoomList';
import classes from './layout.module.css';

const selectState = (s: AppState) => ({ items: s.items, settings: s.settings });

function numOrNull(v: number | string): number | undefined { return v === '' || v === null || v === undefined ? undefined : Number(v); }

/** Oda ölçü formu: en/boy/yükseklik + köpek erişimi → `tip='oda'` ayar satırı upsert. */
function RoomDimsForm({ oda, setting }: { oda: Oda; setting?: Setting }) {
  const [dims, setDims] = useState<RoomDims>(() => parseRoomSetting(setting?.deger));
  const set = <K extends keyof RoomDims>(k: K, v: RoomDims[K]) => setDims((d) => ({ ...d, [k]: v }));
  const save = () => {
    upsert('ayarlar', setting?.id, { tip: 'oda', anahtar: oda, deger: serializeRoomSetting(dims) });
    notifications.show({ message: 'Oda ölçüleri kaydedildi', color: 'green', autoClose: 1500 });
  };
  return (
    <Card withBorder radius="md" p="sm">
      <form onSubmit={(e) => { e.preventDefault(); save(); }} noValidate data-testid="room-dims-form">
        <Stack gap="xs">
          <Group gap={6} wrap="nowrap">
            <RulerIcon size={18} aria-hidden />
            <Text fw={600}>Oda ölçüleri</Text>
          </Group>
          <SimpleGrid cols={2} spacing="xs">
            <NumberInput label="En (cm)" min={0} max={9999} inputMode="numeric" hideControls value={dims.en_cm ?? ''} onChange={(v) => set('en_cm', numOrNull(v))} />
            <NumberInput label="Boy (cm)" min={0} max={9999} inputMode="numeric" hideControls value={dims.boy_cm ?? ''} onChange={(v) => set('boy_cm', numOrNull(v))} />
            <NumberInput label="Yükseklik (cm)" min={0} max={9999} inputMode="numeric" hideControls value={dims.yuk_cm ?? ''} onChange={(v) => set('yuk_cm', numOrNull(v))} />
            <EnumSelect label="Köpek erişimi" field="kopek_erisim" options={KOPEK_ERISIM} value={dims.kopek_erisim} onChange={(v) => set('kopek_erisim', v as KopekErisim | undefined)} />
          </SimpleGrid>
          <Text size="xs" c="dimmed">Kuzey/Güney duvarı = en, Doğu/Batı duvarı = boy.</Text>
          <Button type="submit" variant="default" fullWidth leftSection={<FloppyDiskIcon size={18} aria-hidden />}>Ölçüleri kaydet</Button>
        </Stack>
      </form>
    </Card>
  );
}

function LayoutItemCard({ oda, item }: { oda: Oda; item: Item }) {
  const dims = formatDims(item);
  const isik = (item.isik_ihtiyaci ?? '').trim();
  return (
    <Card component={Link} href={`~/yerlesim/${oda}/${item.id}`} withBorder radius="md" p="sm" className={classes.card} data-testid="layout-item-card">
      <Stack gap={4}>
        <Group justify="space-between" wrap="nowrap" gap="xs" align="flex-start">
          <Text fw={600} lineClamp={2} className={classes.title} data-allow-clamp>{item.ad}</Text>
          {dims && <Text size="sm" c="dimmed" className="tabular" style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>{dims}</Text>}
        </Group>
        <Group gap={4} wrap="wrap">
          {item.mevcut && <WarnBadge tone="ok" leftSection={<HouseIcon size={10} aria-hidden />}>elimizde</WarnBadge>}
          {item.priz_ihtiyaci ? <Badge size="xs" variant="default" leftSection={<PlugIcon size={10} aria-hidden />}>{item.priz_ihtiyaci} priz</Badge> : null}
          {item.kanal_m ? <Badge size="xs" variant="default" className="tabular">{fmtM(item.kanal_m)} m kanal</Badge> : null}
          {isik && (
            <Group gap={4} wrap="nowrap" style={{ minWidth: 0, maxWidth: '100%' }}>
              <LightbulbIcon size={14} aria-hidden style={{ flexShrink: 0 }} />
              <Text size="xs" lineClamp={1} data-allow-clamp>{isik}</Text>
            </Group>
          )}
        </Group>
      </Stack>
    </Card>
  );
}

function WallGroup({ oda, wall, dims, items }: { oda: Oda; wall: WallKey; dims: RoomDims; items: Item[] }) {
  const len = wallLength(dims, wall);
  const rem = remaining(dims, wall, items);
  const list = wallItems(items, wall);
  return (
    <Stack gap={4} data-testid={`wall-${wall}`}>
      <Group justify="space-between" wrap="nowrap" gap="xs">
        <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
          <WallIcon size={16} aria-hidden style={{ flexShrink: 0 }} />
          <Text fw={600}>{wall === 'orta' ? 'Orta' : `${wallLabel(wall)} duvarı`}</Text>
          {len !== undefined && <Text size="xs" c="dimmed" className="tabular">· {len} cm</Text>}
        </Group>
        {wall === 'orta'
          ? <Badge size="xs" variant="default">{list.length} kalem</Badge>
          : rem === undefined
            ? <Text size="xs" c="dimmed">ölçü yok</Text>
            : rem < 0
              ? <WarnBadge tone="danger" className="tabular">{-rem} cm taşıyor</WarnBadge>
              : <Badge size="xs" variant="default" className="tabular">kalan {rem} cm</Badge>}
      </Group>
      {list.length ? list.map((i) => <LayoutItemCard key={i.id} oda={oda} item={i} />) : <Text size="sm" c="dimmed" pl={22}>Kalem yok</Text>}
    </Stack>
  );
}

function NeedsCard({ map, onSuggest }: { map: NeedsMap; onSuggest: () => void }) {
  const total = needsTotal(map);
  const rows = WALL_KEYS.filter((w) => map[w].priz > 0 || map[w].kanal_m > 0 || map[w].isik.length > 0);
  const empty = rows.length === 0;
  return (
    <Card withBorder radius="md" p="sm" data-testid="needs-map">
      <Stack gap="xs">
        <Group gap={6} wrap="nowrap">
          <PlugIcon size={18} aria-hidden />
          <Text fw={600}>İhtiyaç haritası</Text>
        </Group>
        {empty ? (
          <Text size="sm" c="dimmed">Kalemlerde priz, ışık ya da kanal ihtiyacı girilmemiş.</Text>
        ) : (
          <Table fz="sm" verticalSpacing={4} horizontalSpacing={6} className="tabular">
            <Table.Thead>
              <Table.Tr><Table.Th>Duvar</Table.Th><Table.Th ta="right">Priz</Table.Th><Table.Th ta="right">Kanal (m)</Table.Th></Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((w) => (
                <Table.Tr key={w}>
                  <Table.Td>{wallLabel(w)}</Table.Td>
                  <Table.Td ta="right">{map[w].priz}</Table.Td>
                  <Table.Td ta="right">{fmtM(map[w].kanal_m)}</Table.Td>
                </Table.Tr>
              ))}
              <Table.Tr fw={700}>
                <Table.Td>Toplam</Table.Td>
                <Table.Td ta="right" data-testid="needs-total-priz">{total.priz}</Table.Td>
                <Table.Td ta="right" data-testid="needs-total-kanal">{fmtM(total.kanal_m)}</Table.Td>
              </Table.Tr>
            </Table.Tbody>
          </Table>
        )}
        {total.isik.length > 0 && (
          <Stack gap={2}>
            <Group gap={6} wrap="nowrap"><LightbulbIcon size={14} aria-hidden /><Text size="sm" fw={600}>Işık notları</Text></Group>
            {WALL_KEYS.flatMap((w) => map[w].isik.map((s, i) => (
              <Text key={`${w}-${i}`} size="sm" lineClamp={2} data-allow-clamp><Text component="span" c="dimmed">{wallLabel(w)}: </Text>{s}</Text>
            )))}
          </Stack>
        )}
        <Button variant="default" fullWidth leftSection={<ShoppingCartIcon size={18} aria-hidden />} onClick={onSuggest} data-testid="suggest-button">
          Satınalma satırı öner
        </Button>
        <Text size="xs" c="dimmed">Toplam priz için 1 "Panjurlu priz" ve toplam kanal metresi için 1 "Kablo kanalı" satırı; var olan satır güncellenir.</Text>
      </Stack>
    </Card>
  );
}

export function RoomPage({ oda }: { oda: string }) {
  const [, navigate] = useLocation();
  const { items, settings } = useAppStore(selectState);
  const valid = (ROOMS as readonly string[]).includes(oda);
  const setting = useMemo(() => roomSetting(settings, oda), [settings, oda]);
  const dims = useMemo(() => parseRoomSetting(setting?.deger), [setting]);
  const list = useMemo(() => roomItems(items, oda), [items, oda]);
  const purchases = useMemo(() => items.filter((i) => !i.deleted_at && i.tip === 'satinalma'), [items]);
  const map = useMemo(() => needsMap(list), [list]);

  if (!valid) {
    return (
      <Stack p="sm" gap="sm">
        <Alert color="yellow" title="Oda bulunamadı">Bu oda kodu tanımlı değil.</Alert>
        <Button component={Link} href="~/yerlesim" variant="default" leftSection={<ArrowLeftIcon size={18} aria-hidden />}>Odalara dön</Button>
      </Stack>
    );
  }
  const room = oda as Oda;

  const suggest = () => {
    const total = needsTotal(map);
    if (total.priz === 0 && total.kanal_m === 0) {
      notifications.show({ message: 'Priz ya da kanal ihtiyacı girilmemiş; öneri yok', color: 'gray', autoClose: 2500 });
      return;
    }
    const patches = suggestionPatches(room, items, purchases);
    if (!patches.length) {
      notifications.show({ message: 'Satınalma satırları zaten güncel', color: 'gray', autoClose: 2000 });
      return;
    }
    for (const p of patches) upsert('kalemler', p.id, p.patch);
    notifications.show({ message: `${patches.length} satınalma satırı yazıldı`, color: 'green', autoClose: 2000 });
  };

  return (
    <Box pb={96}>
      <Paper className={classes.bar} px="sm" py={4} radius={0}>
        <Group wrap="nowrap" gap="xs">
          <ActionIcon component={Link} href="~/yerlesim" aria-label="Odalara dön" color="gray">
            <ArrowLeftIcon size={22} aria-hidden />
          </ActionIcon>
          <Title order={2} size="h4" lineClamp={1} data-allow-clamp style={{ flex: 1, minWidth: 0 }}>{label('oda', room)}</Title>
          <DogAccessBadge value={dims.kopek_erisim} />
          <Badge size="xs" variant="default">{list.length} kalem</Badge>
        </Group>
      </Paper>
      <Box p="sm" className={classes.roomGrid}>
        <div className={classes.dims}><RoomDimsForm key={`${setting?.id ?? 'yok'}:${setting?.deger ?? ''}`} oda={room} setting={setting} /></div>
        <Stack gap="md" className={classes.walls}>
          {WALL_KEYS.map((wall) => <WallGroup key={wall} oda={room} wall={wall} dims={dims} items={list} />)}
        </Stack>
        <div className={classes.needs}><NeedsCard map={map} onSuggest={suggest} /></div>
      </Box>
      <Fab onClick={() => navigate(`~/yerlesim/${room}/yeni`)} label="Kalem ekle" />
      <Route path="/:id">{(params) => <ItemForm key={params.id} oda={room} id={params.id} />}</Route>
    </Box>
  );
}
