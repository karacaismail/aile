import { ActionIcon, Badge, Button, Drawer, Group, Indicator, Stack, Text, Alert, Code } from '@mantine/core';
import { CloudCheckIcon, CloudArrowUpIcon, CloudSlashIcon, WarningCircleIcon, PlugsIcon, ArrowsClockwiseIcon } from '@phosphor-icons/react';
import { useDisclosure } from '@mantine/hooks';
import { Link } from 'wouter';
import { useAppStore } from '@/sync/store';
import { refresh } from '@/sync/controller';
import { formatTrDateTime } from '@/lib/dates';

const selectSync = (s: { status: string; outbox: unknown[]; lastSync?: string; lastError?: string; conflicts: unknown[] }) =>
  ({ status: s.status, pending: s.outbox.length, lastSync: s.lastSync, lastError: s.lastError, conflicts: s.conflicts.length });

export function SyncStatus() {
  const st = useAppStore(selectSync);
  const [opened, { open, close }] = useDisclosure(false);
  const icon = st.status === 'unconfigured' ? <PlugsIcon size={22} aria-hidden />
    : st.status === 'offline' ? <CloudSlashIcon size={22} aria-hidden />
    : st.status === 'error' ? <WarningCircleIcon size={22} aria-hidden />
    : st.status === 'syncing' || st.status === 'loading' || st.pending > 0 ? <CloudArrowUpIcon size={22} aria-hidden />
    : <CloudCheckIcon size={22} aria-hidden />;
  const color = st.status === 'error' ? 'red' : st.status === 'offline' || st.status === 'unconfigured' ? 'yellow' : 'gray';
  const text: Record<string, string> = {
    idle: 'Hazır', loading: 'Yükleniyor', syncing: 'Eşitleniyor', synced: 'Eşitlendi', offline: 'Çevrimdışı',
    error: 'Hata', unconfigured: 'Sheets bağlantısı ayarlanmadı',
  };
  return (
    <>
      <Indicator disabled={st.pending === 0 && st.conflicts === 0} label={st.pending + st.conflicts} size={16} color={st.conflicts ? 'red' : 'ember'} offset={6}>
        <ActionIcon aria-label={`Senkron: ${text[st.status] ?? st.status}`} color={color} onClick={open} data-testid="sync-status">
          {icon}
        </ActionIcon>
      </Indicator>
      <Drawer opened={opened} onClose={close} position="bottom" size="auto" title="Senkron durumu" padding="md" closeButtonProps={{ size: 'xl', 'aria-label': 'Kapat' }}>
        <Stack gap="sm">
          <Group justify="space-between">
            <Text fw={600}>{text[st.status] ?? st.status}</Text>
            <Badge variant="light" color={st.pending ? 'ember' : 'gray'}>{st.pending} bekleyen</Badge>
          </Group>
          <Text size="sm" c="dimmed">Son eşitleme: {st.lastSync ? formatTrDateTime(st.lastSync) : 'henüz yok'}</Text>
          {st.lastError && <Alert color="red" variant="light" title="Son hata"><Code block>{st.lastError}</Code></Alert>}
          {st.conflicts > 0 && <Alert color="orange" variant="light">{st.conflicts} kalemde çakışma var; kalem detayında çözün.</Alert>}
          <Group grow>
            <Button variant="light" leftSection={<ArrowsClockwiseIcon size={18} aria-hidden />} onClick={() => { void refresh(); }}>Şimdi eşitle</Button>
            <Button component={Link} href="/ayarlar" variant="default" onClick={close}>Ayarlar</Button>
          </Group>
        </Stack>
      </Drawer>
    </>
  );
}
