import { Alert, Button, Group, Stack, Text } from '@mantine/core';
import { WarningCircleIcon } from '@phosphor-icons/react/dist/csr/WarningCircle';
import { label } from '@shared/schema';
import { useAppStore, dismissConflict } from '@/sync/store';
import { upsert } from '@/sync/controller';

export const FIELD_LABELS: Record<string, string> = {
  ad: 'Ad', oda: 'Oda', kategori: 'Kategori', faz: 'Faz', durum: 'Durum', karar_bekliyor: 'Karar bekliyor', oncelik: 'Öncelik', adet: 'Adet', birim: 'Birim',
  tahmini_tl_min: 'Tahmini (min)', tahmini_tl_max: 'Tahmini (max)', gercek_tl: 'Gerçek', fiyat_guven: 'Güven', nereden: 'Nereden',
  siparis_son_tarih: 'Sipariş son tarih', teslim_suresi_gun: 'Teslim süresi (gün)', teslim_tarihi: 'Teslim tarihi', linkler: 'Bağlantılar', not: 'Not', mevcut: 'Elimizde var',
};

/** The same words the form shows: option labels, never storage keys or enum codes; empty stays "boş", not zero. */
export const fieldValue = (k: string, v: unknown) => (v == null || v === '' ? 'boş' : Array.isArray(v) ? (v.length ? v.join(', ') : 'boş') : typeof v === 'boolean' ? (v ? 'evet' : 'hayır') : label(k, String(v)));

export function ConflictBanner({ id }: { id: string }) {
  const conflict = useAppStore((s) => s.conflicts.find((c) => c.id === id));
  if (!conflict) return null;
  const fmt = fieldValue;
  return (
    <Alert color="orange" variant="light" icon={<WarningCircleIcon size={20} aria-hidden />} title="Bu kalem bu arada başka yerde değişti" data-testid="conflict-banner">
      <Stack gap="sm">
        <Text size="sm">{conflict.updatedBy ? `${conflict.updatedBy} değiştirdi.` : 'Sheets\'te değişti.'} Hangi değer kalsın?</Text>
        {conflict.keys.map((k) => (
          <Text key={k} size="sm"><b>{FIELD_LABELS[k] ?? k}</b>: benimki <i>{fmt(k, conflict.myValues[k])}</i> · Sheets'teki <i>{fmt(k, conflict.serverValues[k])}</i></Text>
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
