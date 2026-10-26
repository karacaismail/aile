import { useMemo, useState } from 'react';
import { ActionIcon, Box, EmptyState, Group, Indicator, Stack, TextInput, Button, Skeleton } from '@mantine/core';
import { FunnelSimpleIcon, MagnifyingGlassIcon, ShoppingCartIcon, PlusIcon, GearSixIcon } from '@phosphor-icons/react';
import { useDebouncedValue, useLocalStorage } from '@mantine/hooks';
import { Link, Route, useLocation } from 'wouter';
import type { Item } from '@shared/schema';
import { useAppStore } from '@/sync/store';
import { upsert } from '@/sync/controller';
import { DEFAULT_FILTERS, activeFilterCount, filterPurchases, sortItems, totalsFor, type PurchaseFilters, type SortKey } from '@/data/selectors';
import { ItemCard } from './ItemCard';
import { TotalsBar } from './TotalsBar';
import { FilterDrawer } from './FilterDrawer';
import { ItemDetail } from './ItemDetail';
import { Fab } from '@/app/shell/Fab';

const selectItems = (s: { items: Item[]; hydrated: boolean; status: string }) => ({ items: s.items, hydrated: s.hydrated, status: s.status });

export function PurchaseList() {
  const { items, hydrated, status } = useAppStore(selectItems);
  const [, navigate] = useLocation();
  const [filters, setFilters] = useLocalStorage<PurchaseFilters>({ key: 'aile:purchase:filters', defaultValue: DEFAULT_FILTERS, getInitialValueInEffect: false });
  const [sort, setSort] = useLocalStorage<SortKey>({ key: 'aile:purchase:sort', defaultValue: 'oncelik', getInitialValueInEffect: false });
  const [q, setQ] = useState(filters.q ?? '');
  const [dq] = useDebouncedValue(q, 200);
  const [drawer, setDrawer] = useState(false);
  const f: PurchaseFilters = useMemo(() => ({ ...DEFAULT_FILTERS, ...filters, q: dq }), [filters, dq]);
  const list = useMemo(() => sortItems(filterPurchases(items, f), sort), [items, f, sort]);
  const totals = useMemo(() => totalsFor(items, f.faz), [items, f.faz]);
  const nActive = activeFilterCount(f);
  const hasAny = items.some((i) => i.tip === 'satinalma' && !i.deleted_at);

  const toggleDone = (item: Item, done: boolean) => {
    upsert('kalemler', item.id, { durum: done ? 'teslim' : 'karar' });
  };

  return (
    <Box pb={96}>
      <TotalsBar faz={f.faz} onFaz={(faz) => setFilters({ ...filters, faz })} totals={totals} />
      <Group px="sm" pt="xs" gap="xs" wrap="nowrap">
        <TextInput
          style={{ flex: 1 }} placeholder="Ara" value={q} onChange={(e) => setQ(e.currentTarget.value)} aria-label="Kalem ara"
          leftSection={<MagnifyingGlassIcon size={18} aria-hidden />} type="search"
        />
        <Indicator disabled={nActive === 0} label={nActive} size={16} offset={6} color="ember">
          <ActionIcon variant={nActive ? 'light' : 'subtle'} color={nActive ? 'ember' : 'gray'} aria-label="Filtre" onClick={() => setDrawer(true)} data-testid="filter-button">
            <FunnelSimpleIcon size={22} aria-hidden />
          </ActionIcon>
        </Indicator>
      </Group>
      <Stack gap="xs" p="sm" data-testid="item-list">
        {!hydrated && status !== 'unconfigured' ? (
          <>
            <Skeleton h={72} radius="md" /><Skeleton h={72} radius="md" /><Skeleton h={72} radius="md" />
          </>
        ) : list.length === 0 ? (
          <EmptyState
            icon={<ShoppingCartIcon size={40} aria-hidden />}
            title={hasAny ? 'Filtreye uyan kalem yok' : 'Henüz kalem yok'}
            description={hasAny ? 'Filtreyi gevşetin ya da aramayı temizleyin.' : status === 'unconfigured' ? 'Sheets bağlantısını Ayarlar\'dan kurun ya da + ile kalem ekleyin.' : 'İlk kalemi + ile ekleyin.'}
            data-testid="empty-state"
          >
            <EmptyState.Actions>
              <Button leftSection={<PlusIcon size={18} aria-hidden />} onClick={() => navigate('~/satinalma/yeni')}>Kalem ekle</Button>
              {status === 'unconfigured' && <Button variant="default" component={Link} href="~/ayarlar" leftSection={<GearSixIcon size={18} aria-hidden />}>Ayarlar</Button>}
            </EmptyState.Actions>
          </EmptyState>
        ) : (
          list.map((item) => <ItemCard key={item.id} item={item} onToggleDone={toggleDone} />)
        )}
      </Stack>
      <FilterDrawer opened={drawer} onClose={() => setDrawer(false)} filters={f} onChange={(nf) => setFilters({ ...nf, q: '' })} sort={sort} onSort={setSort} />
      {list.length > 0 && <Fab onClick={() => navigate('~/satinalma/yeni')} label="Kalem ekle" />}
      <Route path="/:id">{(params) => <ItemDetail key={params.id} id={params.id} />}</Route>
    </Box>
  );
}
