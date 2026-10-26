import { useCallback, useMemo, useState } from 'react';
import { ActionIcon, Box, Button, CloseButton, Divider, EmptyState, Group, Indicator, Paper, SimpleGrid, TextInput, Skeleton } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { ArrowCounterClockwiseIcon, FunnelSimpleIcon, GearSixIcon, MagnifyingGlassIcon, PlusIcon, ShoppingCartIcon } from '@phosphor-icons/react';
import { useDebouncedValue, useLocalStorage } from '@mantine/hooks';
import { Link, Route, useLocation } from 'wouter';
import type { Item } from '@shared/schema';
import { useAppStore } from '@/sync/store';
import { upsert } from '@/sync/controller';
import { toDate, todayIso } from '@/lib/dates';
import {
  CLOSED_DURUM, DEFAULT_FILTERS, activeFilterCount, countWith, filterPurchases, normalizeFilters, optionCounts, sortItems, totalsOf,
  type FacetField, type PurchaseFilters, type SortKey,
} from '@/data/selectors';
import { FilterChip } from '@/components/filter/FilterChip';
import { FilterRail } from '@/components/filter/FilterRail';
import { FilterSheet } from '@/components/filter/FilterSheet';
import { SortControl } from '@/components/filter/SortControl';
import { facetLabel } from '@/components/filter/FacetChips';
import { DURUM_COLOR } from '@/components/badges';
import { ItemCard } from './ItemCard';
import { TotalsBar } from './TotalsBar';
import { ItemDetail } from './ItemDetail';
import { PurchaseFilterSections, QuickChips, clearedFilters } from './PurchaseFilterSections';
import { Fab } from '@/app/shell/Fab';
import classes from './PurchaseList.module.css';

const selectItems = (s: { items: Item[]; hydrated: boolean; status: string }) => ({ items: s.items, hydrated: s.hydrated, status: s.status });

const SORT_OPTIONS: ReadonlyArray<{ value: SortKey; label: string; description?: string }> = [
  { value: 'oncelik', label: 'Öncelik', description: '1 → 3, sonra ad' },
  { value: 'ad', label: 'Ad (A → Z)' },
  { value: 'fiyat', label: 'Fiyat (yüksekten düşüğe)' },
  { value: 'siparis', label: 'Sipariş son tarihi (en yakın önce)' },
  { value: 'guncelleme', label: 'Son güncellenen' },
];
const SORT_KEYS = new Set<string>(SORT_OPTIONS.map((o) => o.value));

function readStored(v: string | undefined): PurchaseFilters {
  try { return normalizeFilters(v ? JSON.parse(v) : undefined); } catch { return { ...DEFAULT_FILTERS }; }
}

export function PurchaseList() {
  const { items, hydrated, status } = useAppStore(selectItems);
  const [, navigate] = useLocation();
  const [stored, setStored] = useLocalStorage<PurchaseFilters>({
    key: 'aile:purchase:filters', defaultValue: DEFAULT_FILTERS, getInitialValueInEffect: false, deserialize: readStored,
  });
  const [sortRaw, setSort] = useLocalStorage<SortKey>({ key: 'aile:purchase:sort', defaultValue: 'oncelik', getInitialValueInEffect: false });
  const sort: SortKey = SORT_KEYS.has(sortRaw) ? sortRaw : 'oncelik';
  const [q, setQ] = useState('');
  const [dq] = useDebouncedValue(q, 200);
  const [sheet, setSheet] = useState(false);
  const todayKey = todayIso(new Date());
  const now = useMemo(() => toDate(todayKey), [todayKey]);

  // Arama kalıcı değil (bayat terim "kalemlerim nereye gitti?"nin en sık nedeni); depoda q her zaman boştur.
  const f: PurchaseFilters = useMemo(() => ({ ...normalizeFilters(stored), q: dq }), [stored, dq]);
  // Şerit/faz değişince liste başa döner (yapışkan araç çubuğu); sayfa açıkken (liste yanda görünür) kaydırma yok.
  const setFilters = useCallback((nf: PurchaseFilters, opts: { scroll?: boolean } = {}) => {
    setStored({ ...nf, q: '' });
    if (opts.scroll !== false && typeof window !== 'undefined' && window.scrollY > 0) window.scrollTo({ top: 0 });
  }, [setStored]);
  const setFromSheet = useCallback((nf: PurchaseFilters) => setFilters(nf, { scroll: false }), [setFilters]);

  const list = useMemo(() => sortItems(filterPurchases(items, f, now), sort), [items, f, now, sort]);
  const totals = useMemo(() => totalsOf(list, now), [list, now]);
  const baseCount = useMemo(() => filterPurchases(items, { ...DEFAULT_FILTERS, faz: f.faz }, now).length, [items, f.faz, now]);
  const nActive = activeFilterCount(f);
  const filtered = nActive > 0 || dq.trim() !== '';
  const hasAny = useMemo(() => items.some((i) => i.tip === 'satinalma' && !i.deleted_at), [items]);
  const loading = !hydrated && status !== 'unconfigured';

  // Şeritte görünen aktif facet değerleri (Sipariş sabit çipte olduğundan burada yok) ve sayımları
  const activeFacets = useMemo(() => {
    const out: Array<{ field: FacetField; value: string; count: number }> = [];
    for (const field of ['oda', 'kategori', 'durum'] as const) {
      const vals = f[field].filter((v) => !(field === 'durum' && v === 'siparis'));
      if (!vals.length) continue;
      const counts = optionCounts(items, field === 'durum' ? { ...f, hideDone: false } : f, field, now);
      for (const v of vals) out.push({ field, value: v, count: counts.get(v) ?? 0 });
    }
    return out;
  }, [items, f, now]);
  const removeFacet = (field: FacetField, value: string) => setFilters({ ...f, [field]: f[field].filter((x) => x !== value) });

  const firstClosed = useMemo(() => (f.hideDone || f.durum.length ? -1 : list.findIndex((i) => CLOSED_DURUM.has(i.durum ?? ''))), [list, f.hideDone, f.durum.length]);
  const hiddenDone = !f.hideDone ? 0 : countWith(items, f, { hideDone: false }, now) - list.length;
  const hiddenMevcut = f.mevcutDahil ? 0 : countWith(items, f, { mevcutDahil: true }, now) - list.length;

  const toggleDone = (item: Item, done: boolean) => {
    const prev = item.durum;
    upsert('kalemler', item.id, { durum: done ? 'teslim' : 'karar' });
    if (done && f.hideDone) {
      notifications.show({
        id: `done-${item.id}`, autoClose: 5000, color: 'teal', withCloseButton: true, closeButtonProps: { size: 'xl', 'aria-label': 'Kapat' },
        message: (
          <Group justify="space-between" wrap="nowrap" gap="xs">
            <span>Alındı olarak işaretlendi</span>
            <Button size="compact-sm" variant="subtle" color="ember" leftSection={<ArrowCounterClockwiseIcon size={16} aria-hidden />}
              onClick={() => { upsert('kalemler', item.id, { durum: prev ?? 'karar' }); notifications.hide(`done-${item.id}`); }}>
              Geri al
            </Button>
          </Group>
        ),
      });
    }
  };

  const emptyAllDone = hasAny && list.length === 0 && f.hideDone && hiddenDone > 0 && nActive === 1 && !dq;
  const emptyByFaz = hasAny && list.length === 0 && nActive === 0 && !dq && f.faz !== 'hepsi';

  return (
    <Box pb={96}>
      <TotalsBar faz={f.faz} onFaz={(faz) => setFilters({ ...f, faz })} totals={totals} count={list.length} total={baseCount} filtered={filtered} />
      {hasAny && (
        <Paper className={classes.toolbar} px="sm" pt={4} pb={6} radius={0} data-testid="filter-toolbar">
          <Group gap={6} wrap="nowrap">
            <TextInput
              style={{ flex: 1, minWidth: 0 }} placeholder="Ara" value={q} onChange={(e) => setQ(e.currentTarget.value)} aria-label="Kalem ara"
              leftSection={<MagnifyingGlassIcon size={18} aria-hidden />} type="search" enterKeyHint="search"
              rightSection={q ? <CloseButton size="xl" aria-label="Aramayı temizle" onClick={() => setQ('')} /> : undefined} rightSectionWidth={q ? 44 : undefined} rightSectionPointerEvents="all"
            />
            <SortControl value={sort} options={SORT_OPTIONS} onChange={setSort} defaultValue="oncelik" hint="Alınan ve iptal edilenler her sıralamada en altta." />
            <Indicator disabled={nActive === 0} label={nActive} size={22} offset={4} color="ember" autoContrast>
              <ActionIcon variant={nActive ? 'light' : 'subtle'} color={nActive ? 'ember' : 'gray'} aria-label={nActive ? `Filtrele, ${nActive} etkin` : 'Filtrele'}
                aria-haspopup="dialog" aria-expanded={sheet} onClick={() => setSheet(true)} data-testid="filter-button">
                <FunnelSimpleIcon size={22} aria-hidden />
              </ActionIcon>
            </Indicator>
          </Group>
          <Box mt={6}>
            <FilterRail>
              {activeFacets.map((a) => (
                <FilterChip key={`${a.field}:${a.value}`} label={facetLabel(a.field, a.value, true)} count={a.count} checked icon="x"
                  dot={a.field === 'durum' ? DURUM_COLOR[a.value] : undefined} onChange={() => removeFacet(a.field, a.value)}
                  data-testid={`active-chip-${a.field}-${a.value || 'belirsiz'}`} />
              ))}
              {f.mevcutDahil && (
                <FilterChip label="Mevcut dahil" checked icon="x" onChange={() => setFilters({ ...f, mevcutDahil: false })} data-testid="active-chip-mevcut" />
              )}
              {(activeFacets.length > 0 || f.mevcutDahil) && <Divider orientation="vertical" h={28} style={{ alignSelf: 'center', flexShrink: 0 }} />}
              <QuickChips items={items} filters={f} onChange={setFilters} now={now} />
              {nActive > 0 && (
                <Button variant="subtle" color="ember" size="compact-sm" onClick={() => setFilters(clearedFilters(f))} style={{ flexShrink: 0 }}>Temizle</Button>
              )}
            </FilterRail>
          </Box>
        </Paper>
      )}
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="xs" p="sm" data-testid="item-list">
        {loading ? (
          <>
            <Skeleton h={72} radius="md" /><Skeleton h={72} radius="md" /><Skeleton h={72} radius="md" />
          </>
        ) : list.length === 0 ? (
          <EmptyState
            style={{ gridColumn: '1 / -1' }}
            icon={<ShoppingCartIcon size={40} aria-hidden />}
            title={emptyAllDone ? 'Bu kapsamda hepsi alındı' : emptyByFaz ? 'Bu fazda kalem yok' : hasAny ? 'Filtreye uyan kalem yok' : 'Henüz kalem yok'}
            description={emptyAllDone ? `${hiddenDone} kalem alındı ya da kapandı.` : emptyByFaz ? 'Başka fazlarda kalem var.' : hasAny ? 'Filtreyi gevşetin ya da aramayı temizleyin.' : status === 'unconfigured' ? 'Sheets bağlantısını Ayarlar\'dan kurun ya da + ile kalem ekleyin.' : 'İlk kalemi + ile ekleyin.'}
            data-testid="empty-state"
          >
            <EmptyState.Actions>
              {emptyAllDone && <Button onClick={() => setFilters({ ...f, hideDone: false })}>Alınanları göster</Button>}
              {emptyByFaz && <Button onClick={() => setFilters({ ...f, faz: 'hepsi' })}>Tüm fazları göster</Button>}
              {!emptyAllDone && nActive > 0 && <Button onClick={() => setFilters(clearedFilters(f))}>Filtreleri temizle</Button>}
              {dq && <Button variant="default" onClick={() => setQ('')}>Aramayı temizle</Button>}
              {!emptyAllDone && hasAny && nActive === 0 && !dq && hiddenMevcut > 0 && (
                <Button variant="default" onClick={() => setFilters({ ...f, mevcutDahil: true })}>Mevcut eşyaları göster ({hiddenMevcut})</Button>
              )}
              <Button variant={hasAny ? 'default' : 'filled'} leftSection={<PlusIcon size={18} aria-hidden />} onClick={() => navigate('~/satinalma/yeni')}>Kalem ekle</Button>
              {status === 'unconfigured' && <Button variant="default" component={Link} href="~/ayarlar" leftSection={<GearSixIcon size={18} aria-hidden />}>Ayarlar</Button>}
            </EmptyState.Actions>
          </EmptyState>
        ) : (
          list.map((item, idx) => (
            <Box key={item.id} display="contents">
              {idx === firstClosed && idx > 0 && (
                <Divider className={classes.divider} label={`Alınan ve bitenler · ${list.length - idx}`} labelPosition="left" data-testid="closed-divider" />
              )}
              <ItemCard item={item} onToggleDone={toggleDone} />
            </Box>
          ))
        )}
      </SimpleGrid>
      <FilterSheet opened={sheet} onClose={() => setSheet(false)} resultCount={list.length} activeCount={nActive} onClear={() => setFilters(clearedFilters(f))}>
        <PurchaseFilterSections items={items} filters={f} onChange={setFromSheet} now={now} />
      </FilterSheet>
      {hasAny && <Fab onClick={() => navigate('~/satinalma/yeni')} label="Kalem ekle" />}
      <Route path="/:id">{(params) => <ItemDetail key={params.id} id={params.id} />}</Route>
    </Box>
  );
}
