import { useMemo, useState } from 'react';
import { Box, Button, EmptyState, Paper, SegmentedControl, SimpleGrid, Skeleton, Text } from '@mantine/core';
import { PlusIcon, UsersThreeIcon } from '@phosphor-icons/react';
import { Route, useLocation } from 'wouter';
import type { Item } from '@shared/schema';
import { MESLEK, label } from '@shared/schema';
import { useAppStore, type AppState } from '@/sync/store';
import { Fab } from '@/app/shell/Fab';
import { VENDOR_TARGET, vendorStats } from './rules';
import { VendorCard } from './VendorCard';
import { VendorDetail } from './VendorDetail';
import classes from './renovation.module.css';

const selectVendors = (s: AppState): Item[] => s.items.filter((i) => !i.deleted_at && i.tip === 'usta');
const selectMeta = (s: AppState) => ({ hydrated: s.hydrated, status: s.status });
const coll = new Intl.Collator('tr');

/** Ustalar: meslek seçici (yatay kaydırılır), aday/teklif sayacı, kartlar, Fab → yeni, /:id detay modalı. */
export function VendorsScreen() {
  const vendors = useAppStore(selectVendors);
  const { hydrated, status } = useAppStore(selectMeta);
  const [, navigate] = useLocation();
  const [meslek, setMeslek] = useState('hepsi');
  const list = useMemo(() => vendors.filter((u) => meslek === 'hepsi' || u.meslek === meslek).sort((a, b) => (b.teklif_tl != null ? 1 : 0) - (a.teklif_tl != null ? 1 : 0) || coll.compare(a.ad, b.ad)), [vendors, meslek]);
  const stats = useMemo(() => vendorStats(vendors, meslek), [vendors, meslek]);
  return (
    <Box pb={96}>
      <Paper px="sm" py={6} radius={0} className={classes.tabs}>
        <div className={classes.scroller}>
          <SegmentedControl size="sm" value={meslek} onChange={setMeslek} aria-label="Meslek"
            data={[{ value: 'hepsi', label: 'Hepsi' }, ...MESLEK.map((m) => ({ value: m, label: label('meslek', m) }))]} />
        </div>
        <Text size="sm" mt={4} className="tabular" data-testid="vendor-stats">
          <Text span fw={700}>{stats.aday} aday</Text> · <Text span fw={700}>{stats.teklif} teklif</Text>
          <Text span c="dimmed"> (hedef: {VENDOR_TARGET.aday} aday → {VENDOR_TARGET.teklif} teklif)</Text>
        </Text>
      </Paper>
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="xs" p="sm" data-testid="vendor-list">
        {!hydrated && status !== 'unconfigured' ? (
          <><Skeleton h={96} radius="md" /><Skeleton h={96} radius="md" /></>
        ) : list.length === 0 ? (
          <EmptyState icon={<UsersThreeIcon size={40} aria-hidden />} title={vendors.length ? 'Bu meslekte aday yok' : 'Henüz usta yok'}
            description={`Hedef: her meslek için ${VENDOR_TARGET.aday} aday, ${VENDOR_TARGET.teklif} teklif.`} data-testid="empty-state" style={{ gridColumn: '1 / -1' }}>
            <EmptyState.Actions>
              <Button leftSection={<PlusIcon size={18} aria-hidden />} onClick={() => navigate('~/tadilat/ustalar/yeni')}>Usta ekle</Button>
            </EmptyState.Actions>
          </EmptyState>
        ) : list.map((u) => <VendorCard key={u.id} vendor={u} />)}
      </SimpleGrid>
      <Fab onClick={() => navigate('~/tadilat/ustalar/yeni')} label="Usta ekle" />
      <Route path="/:id">{(params) => <VendorDetail key={params.id} id={params.id} />}</Route>
    </Box>
  );
}
