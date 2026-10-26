import { Button, Chip, Drawer, Group, Stack, Switch, Text, SegmentedControl } from '@mantine/core';
import { DURUM, ODA, KATEGORI, label } from '@shared/schema';
import type { PurchaseFilters, SortKey } from '@/data/selectors';
import { DEFAULT_FILTERS } from '@/data/selectors';

export function FilterDrawer({ opened, onClose, filters, onChange, sort, onSort }: {
  opened: boolean; onClose: () => void; filters: PurchaseFilters; onChange: (f: PurchaseFilters) => void; sort: SortKey; onSort: (s: SortKey) => void;
}) {
  const chips = (field: 'durum' | 'oda' | 'kategori', options: readonly string[]) => (
    <Chip.Group multiple value={filters[field]} onChange={(v) => onChange({ ...filters, [field]: v })}>
      <Group gap={6}>
        {options.map((o) => <Chip key={o} value={o} size="sm" variant="light">{label(field, o)}</Chip>)}
      </Group>
    </Chip.Group>
  );
  return (
    <Drawer opened={opened} onClose={onClose} position="bottom" size="85%" title="Filtre ve sıralama" padding="md" closeButtonProps={{ size: 'xl', 'aria-label': 'Kapat' }}>
      <Stack gap="md" data-testid="filter-drawer">
        <div>
          <Text size="sm" fw={600} mb={4}>Sıralama</Text>
          <SegmentedControl fullWidth size="xs" value={sort} onChange={(v) => onSort(v as SortKey)}
            data={[{ value: 'oncelik', label: 'Öncelik' }, { value: 'ad', label: 'Ad' }, { value: 'fiyat', label: 'Fiyat' }, { value: 'siparis', label: 'Sipariş' }, { value: 'guncelleme', label: 'Yeni' }]} />
        </div>
        <div><Text size="sm" fw={600} mb={4}>Durum</Text>{chips('durum', DURUM)}</div>
        <div><Text size="sm" fw={600} mb={4}>Oda</Text>{chips('oda', ODA)}</div>
        <div><Text size="sm" fw={600} mb={4}>Kategori</Text>{chips('kategori', KATEGORI)}</div>
        <Stack gap="xs">
          <Switch label="Yalnız fiyatsızlar" checked={filters.fiyatsiz} onChange={(e) => onChange({ ...filters, fiyatsiz: e.currentTarget.checked })} />
          <Switch label="Yalnız karar bekleyenler" checked={filters.kararBekliyor} onChange={(e) => onChange({ ...filters, kararBekliyor: e.currentTarget.checked })} />
          <Switch label="Mevcut eşyaları da göster" checked={filters.mevcutDahil} onChange={(e) => onChange({ ...filters, mevcutDahil: e.currentTarget.checked })} />
        </Stack>
        <Group grow>
          <Button variant="default" onClick={() => onChange({ ...DEFAULT_FILTERS, faz: filters.faz, q: filters.q })}>Temizle</Button>
          <Button onClick={onClose}>Uygula</Button>
        </Group>
      </Stack>
    </Drawer>
  );
}
