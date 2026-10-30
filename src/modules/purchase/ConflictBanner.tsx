import { Alert, Button, Group, Stack, Text } from '@mantine/core';
import { WarningCircleIcon } from '@phosphor-icons/react/dist/csr/WarningCircle';
import { label } from '@shared/schema';
import { useAppStore, dismissConflict } from '@/sync/store';
import { upsert } from '@/sync/controller';

export function ConflictBanner({ id }: { id: string }) {
  const conflict = useAppStore((s) => s.conflicts.find((c) => c.id === id));
  if (!conflict) return null;
  const fmt = (v: unknown) => (v == null || v === '' ? '—' : Array.isArray(v) ? v.join(', ') : String(v));
  return (
    <Alert color="orange" variant="light" icon={<WarningCircleIcon size={20} aria-hidden />} title="Bu kalem bu arada başka yerde değişti" data-testid="conflict-banner">
      <Stack gap={6}>
        <Text size="sm">{conflict.updatedBy ? `${conflict.updatedBy} değiştirdi.` : 'Sheets\'te değişti.'} Hangi değer kalsın?</Text>
        {conflict.keys.map((k) => (
          <Text key={k} size="sm"><b>{k}</b>: benimki <i>{fmt(conflict.myValues[k])}</i> · Sheets'teki <i>{fmt(conflict.serverValues[k])}</i></Text>
        ))}
        <Group gap="xs">
          <Button size="xs" variant="filled" onClick={() => { upsert(conflict.table, id, conflict.myValues); dismissConflict(id); }}>Benimki kalsın</Button>
          <Button size="xs" variant="default" onClick={() => dismissConflict(id)}>Sheets'teki kalsın</Button>
        </Group>
        <Text size="xs" c="dimmed">{label('tip', 'satinalma')} · sürüm {conflict.updatedAt ? conflict.updatedAt.slice(0, 16).replace('T', ' ') : ''}</Text>
      </Stack>
    </Alert>
  );
}
