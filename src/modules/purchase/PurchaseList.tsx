import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActionIcon, Box, Button, CloseButton, Divider, EmptyState, Group, Indicator, Paper, SimpleGrid, TextInput, Skeleton, SegmentedControl } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { ArrowCounterClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowCounterClockwise';
import { FunnelSimpleIcon } from '@phosphor-icons/react/dist/csr/FunnelSimple';
import { GearSixIcon } from '@phosphor-icons/react/dist/csr/GearSix';
import { MagnifyingGlassIcon } from '@phosphor-icons/react/dist/csr/MagnifyingGlass';
import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus';
import { ShoppingCartIcon } from '@phosphor-icons/react/dist/csr/ShoppingCart';
import { useDebouncedValue, useLocalStorage } from '@mantine/hooks';
import { Link, Route, useLocation } from 'wouter';
import type { Item } from '@shared/schema';
import { getState, subscribe, useAppStore } from '@/sync/store';
import { upsert } from '@/sync/controller';
import { toDate, todayIso } from '@/lib/dates';
import {
  CLOSED_DURUM, DONE_DURUM, DEFAULT_FILTERS, activeFilterCount, countWith, filterPurchases, normalizeFilters, optionCounts, sortItems, totalsOf,
  type FacetField, type PurchaseFilters, type SortKey,
} from '@/data/selectors';
import { SourceNote } from '@/components/Info';
import { FilterChip } from '@/components/filter/FilterChip';
import { FilterRail } from '@/components/filter/FilterRail';
import { FilterSheet } from '@/components/filter/FilterSheet';
import { SortControl } from '@/components/filter/SortControl';
import { facetLabel } from '@/components/filter/FacetChips';
import { DURUM_COLOR } from '@/components/badges';
import { ItemCard } from './ItemCard';
import { TotalsBar } from './TotalsBar';
import { ItemDetail, type NewItemDefaults } from './ItemDetail';
import { PurchaseFilterSections, QuickChips, clearedFilters } from './PurchaseFilterSections';
import { Fab } from '@/app/shell/Fab';
import { tokens } from '@/dashboard/tokens';
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

type PurchaseView = 'pending' | 'done' | 'all';
interface CompletionAction { token: symbol; id: string; name: string; previous: Item['durum']; next: 'teslim' | 'karar'; valid: boolean; keyboard: boolean }
const PURCHASE_VIEWS = [
  { value: 'pending', label: 'Alınacaklar' },
  { value: 'done', label: 'Aldıklarımız' },
  { value: 'all', label: 'Tüm kalemler' },
] as const;
const inView = (durum: string | undefined, view: PurchaseView) => view === 'all' || (view === 'done' ? DONE_DURUM.has(durum ?? '') : !CLOSED_DURUM.has(durum ?? ''));
const viewFilters = (filters: PurchaseFilters, view: PurchaseView): PurchaseFilters => ({ ...filters, hideDone: false, durum: filters.durum.filter(durum => inView(durum, view)) });

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
  const [view, setView] = useState<PurchaseView>('pending');
  const viewRef = useRef<HTMLDivElement>(null);
  const [completion, setCompletion] = useState<CompletionAction | null>(null);
  const completionRef = useRef<CompletionAction | null>(null);
  const undoButtonRef = useRef<HTMLButtonElement>(null);
  const completionPanelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let lastItems = getState().items;
    const unsubscribe = subscribe(() => {
      const items = getState().items;
      if (items === lastItems) return;
      lastItems = items;
      const action = completionRef.current;
      if (!action?.valid) return;
      const current = items.find(item => item.id === action.id && !item.deleted_at);
      // Observe every store transition, including multiple updates inside one React render batch.
      if (!current || current.durum !== action.next) {
        completionRef.current = { ...action, valid: false };
        setCompletion(completionRef.current);
      }
    });
    return () => { unsubscribe(); completionRef.current = null; };
  }, []);
  useEffect(() => {
    if (completion?.keyboard) undoButtonRef.current?.focus();
  }, [completion?.token, completion?.keyboard]);
  const todayKey = todayIso(new Date());
  const now = useMemo(() => toDate(todayKey), [todayKey]);

  // Arama kalıcı değil (bayat terim "kalemlerim nereye gitti?"nin en sık nedeni); depoda q her zaman boştur.
  const f: PurchaseFilters = useMemo(() => viewFilters({ ...normalizeFilters(stored), q: dq }, view), [stored, dq, view]);
  // Şerit/faz değişince liste başa döner (yapışkan araç çubuğu); sayfa açıkken (liste yanda görünür) kaydırma yok.
  const setFilters = useCallback((nf: PurchaseFilters, opts: { scroll?: boolean } = {}) => {
    setStored({ ...nf, q: '' });
    if (opts.scroll !== false && typeof window !== 'undefined' && window.scrollY > 0) window.scrollTo({ top: 0 });
  }, [setStored]);
  const setFromSheet = useCallback((nf: PurchaseFilters) => setFilters(nf, { scroll: false }), [setFilters]);

  const chooseView = (next: PurchaseView) => {
    setView(next);
    setFilters(viewFilters(f, next));
  };
  const viewItems = useMemo(() => items.filter(item => inView(item.durum, view)), [items, view]);
  const viewCounts = useMemo(() => Object.fromEntries(PURCHASE_VIEWS.map(({ value }) => [value,
    filterPurchases(items.filter(item => inView(item.durum, value)), viewFilters(f, value), now).length,
  ])) as Record<PurchaseView, number>, [items, f, now]);
  const list = useMemo(() => sortItems(filterPurchases(viewItems, f, now), sort), [viewItems, f, now, sort]);
  const totals = useMemo(() => totalsOf(list, now), [list, now]);
  const baseCount = useMemo(() => filterPurchases(viewItems, { ...DEFAULT_FILTERS, faz: f.faz }, now).length, [viewItems, f.faz, now]);
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
      const counts = optionCounts(viewItems, f, field, now);
      for (const v of vals) out.push({ field, value: v, count: counts.get(v) ?? 0 });
    }
    return out;
  }, [viewItems, f, now]);
  const removeFacet = (field: FacetField, value: string) => setFilters({ ...f, [field]: f[field].filter((x) => x !== value) });

  const firstClosed = useMemo(() => (view !== 'all' || f.durum.length ? -1 : list.findIndex((i) => CLOSED_DURUM.has(i.durum ?? ''))), [list, view, f.durum.length]);
  const hiddenMevcut = f.mevcutDahil ? 0 : countWith(viewItems, f, { mevcutDahil: true }, now) - list.length;

  const toggleDone = (item: Item, done: boolean) => {
    const current = getState().items.find(candidate => candidate.id === item.id && !candidate.deleted_at);
    if (!current || current.durum === 'iptal') return;
    const action: CompletionAction = { token: Symbol(item.id), id: item.id, name: current.ad, previous: current.durum,
      next: done ? 'teslim' : 'karar', valid: true, keyboard: document.documentElement.dataset.keyboard === 'true' };
    completionRef.current = action;
    upsert('kalemler', item.id, { durum: action.next });
    setCompletion(completionRef.current);
  };
  const closeCompletion = (action: CompletionAction) => {
    if (completionRef.current?.token !== action.token) return;
    const returnFocus = document.documentElement.dataset.keyboard === 'true' && completionPanelRef.current?.contains(document.activeElement);
    completionRef.current = null;
    setCompletion(null);
    if (returnFocus) setFocusAfterShow(action.id);
  };
  const undoCompletion = (action: CompletionAction) => {
    const active = completionRef.current;
    if (active?.token !== action.token || !active.valid) return;
    const current = getState().items.find(item => item.id === action.id && !item.deleted_at);
    if (!current || current.durum !== action.next) return;
    completionRef.current = null;
    setCompletion(null);
    // Only status is restored. The latest price, note and other fields remain untouched.
    upsert('kalemler', action.id, { durum: action.previous ?? null });
    setFocusAfterShow(action.id);
  };

  // Yeni kalem kullanıcının baktığı yere eklenir: etkin faz ve tek seçili oda/kategori ön değer olur.
  const newDefaults = useMemo<NewItemDefaults>(() => ({
    faz: f.faz === 'hepsi' ? undefined : f.faz, oda: f.oda.length === 1 && f.oda[0] ? f.oda[0] : undefined, kategori: f.kategori.length === 1 && f.kategori[0] ? f.kategori[0] : undefined,
  }), [f.faz, f.oda, f.kategori]);
  // Kayıt sonrası görünürlük kararı listenin işidir: kalem etkin filtrede görünmüyorsa bildirim bunu söyler ve Göster gizleyen filtreyi kaldırır.
  // Göster bildirimi kaldırınca odak gövdeye düşmesin: liste yeniden çizildikten sonra görünen kayda, yoksa kalan filtre kontrolüne geçer.
  const listRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLButtonElement>(null);
  const [focusAfterShow, setFocusAfterShow] = useState<string | null>(null);
  useEffect(() => {
    if (!focusAfterShow) return;
    const card = listRef.current?.querySelector<HTMLElement>(`[data-item-id="${CSS.escape(focusAfterShow)}"] [role="link"]`);
    // Arama temizlendi ama gecikmeli terim henüz yetişmediyse liste eski; yeniden çizilince tekrar denenir.
    if (!card && q !== dq) return;
    (card ?? viewRef.current?.querySelector<HTMLInputElement>('input:checked') ?? filterRef.current)?.focus();
    // WebKit can focus an offscreen restored record without revealing it after a pointer Undo.
    card?.scrollIntoView?.({ block: 'center' });
    setFocusAfterShow(null);
  }, [focusAfterShow, list, q, dq]);
  const afterSave = (saved: Item, isNew: boolean) => {
    const base = isNew ? 'Kalem eklendi' : 'Kaydedildi';
    if (inView(saved.durum, view) && filterPurchases([saved], f, now).length > 0) { notifications.show({ message: base, color: 'green', autoClose: 1500 }); return; }
    const nid = `saved-${saved.id}`;
    const show = () => {
      setView(DONE_DURUM.has(saved.durum ?? '') ? 'done' : saved.durum === 'iptal' ? 'all' : 'pending');
      setQ('');
      setFilters({ ...DEFAULT_FILTERS, faz: f.faz === 'hepsi' || f.faz === saved.faz ? f.faz : (saved.faz ?? 'hepsi'), mevcutDahil: !!saved.mevcut });
      notifications.hide(nid);
      setFocusAfterShow(saved.id);
    };
    notifications.show({
      id: nid, autoClose: 8000, color: 'teal', withCloseButton: true, closeButtonProps: { size: 'xl', 'aria-label': 'Kapat' },
      message: (
        <Group justify="space-between" wrap="nowrap" gap="xs">
          {/* Dar bildirimde eylem etiketi küçülmez (kırpılmaz); mesaj metni sarılır. */}
          <span style={{ minWidth: 0 }}>{base} · bu filtrede görünmüyor</span>
          <Button size="sm" h={tokens.targetMin} variant="subtle" color="ember" style={{ flexShrink: 0 }} onClick={show}>Göster</Button>
        </Group>
      ),
    });
  };

  const emptyAllDone = hasAny && list.length === 0 && view === 'pending' && viewCounts.done > 0 && nActive === 0 && !dq;
  const emptyByFaz = hasAny && list.length === 0 && nActive === 0 && !dq && f.faz !== 'hepsi';

  return (
    <Box pb={96}>
      {hasAny && <div ref={viewRef} className={classes.views}>
        <SegmentedControl fullWidth value={view} onChange={value => chooseView(value as PurchaseView)} aria-label="Alım listesi"
          data={PURCHASE_VIEWS.map(({ value, label }) => ({ value, label: <span className={classes.viewLabel}><span>{label}</span> <span className="tabular">{viewCounts[value]}</span></span> }))} />
      </div>}
      {completion && <div ref={completionPanelRef} role="region" aria-label="Son alım işlemi" className={classes.completion}>
        <strong>Son alım işlemi</strong>
        <CloseButton size="xl" aria-label="Kapat" onClick={() => closeCompletion(completion)} />
        <p role="status" className={classes.completionMessage}>
          {completion.name} {completion.next === 'teslim' ? 'alındı olarak işaretlendi.' : 'için Alındı işareti kaldırıldı.'}
          {!completion.valid && <> Kayıt değişti; bu işlem artık geri alınamaz.</>}
        </p>
        <Button ref={undoButtonRef} size="sm" h={tokens.targetMin} variant="subtle" color="ember" aria-disabled={!completion.valid}
          className={classes.undoButton} leftSection={<ArrowCounterClockwiseIcon size={16} aria-hidden />} onClick={() => undoCompletion(completion)}>Geri al</Button>
      </div>}
      <TotalsBar faz={f.faz} onFaz={(faz) => setFilters({ ...f, faz })} totals={totals} count={list.length} total={baseCount} filtered={filtered} />
      {hasAny && (
        <Paper className={`${classes.toolbar} ${completion ? classes.toolbarWithCompletion : ''}`} px="sm" pt={4} pb={6} radius={0} data-testid="filter-toolbar">
          <Group gap={6} wrap="nowrap">
            <TextInput
              style={{ flex: 1, minWidth: 0 }} placeholder="Ara" value={q} onChange={(e) => setQ(e.currentTarget.value)} aria-label="Kalem ara"
              leftSection={<MagnifyingGlassIcon size={18} aria-hidden />} type="search" enterKeyHint="search"
              rightSection={q ? <CloseButton size="xl" aria-label="Aramayı temizle" onClick={() => setQ('')} /> : undefined} rightSectionWidth={q ? 44 : undefined} rightSectionPointerEvents="all"
            />
            <SortControl value={sort} options={SORT_OPTIONS} onChange={setSort} defaultValue="oncelik" hint={view === 'all' ? "Alınan ve iptal edilenler her sıralamada en altta." : undefined} />
            <Indicator disabled={nActive === 0} label={nActive} size={22} offset={4} color="ember" autoContrast>
              <ActionIcon ref={filterRef} variant={nActive ? 'light' : 'subtle'} color={nActive ? 'ember' : 'gray'} aria-label={nActive ? `Filtrele, ${nActive} etkin` : 'Filtrele'}
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
              <QuickChips items={viewItems} filters={f} onChange={setFilters} now={now} />
              {nActive > 0 && (
                <Button variant="subtle" color="ember" size="compact-sm" onClick={() => setFilters(clearedFilters(f))} style={{ flexShrink: 0 }}>Temizle</Button>
              )}
            </FilterRail>
          </Box>
        </Paper>
      )}
      <SimpleGrid ref={listRef} cols={{ base: 1, sm: 2, lg: 3 }} spacing="xs" p="sm" data-testid="item-list">
        {loading ? (
          <>
            <Skeleton h={72} radius="md" /><Skeleton h={72} radius="md" /><Skeleton h={72} radius="md" />
          </>
        ) : list.length === 0 ? (
          <EmptyState
            style={{ gridColumn: '1 / -1' }}
            icon={<ShoppingCartIcon size={40} aria-hidden />}
            title={emptyAllDone ? 'Alınacak kalem kalmadı' : emptyByFaz ? 'Bu fazda kalem yok' : hasAny && !filtered && view === 'done' ? 'Henüz alınmış kalem yok' : hasAny ? 'Filtreye uyan kalem yok' : 'Henüz kalem yok'}
            description={emptyAllDone ? `${viewCounts.done} kalem Aldıklarımız listesinde. Yanlış işaretlenen kalemin Alındı seçimini oradan kaldırabilirsiniz.` : emptyByFaz ? 'Başka fazlarda kalem var.' : hasAny && !filtered && view === 'done' ? 'Alındı olarak işaretlediğiniz kalemler burada görünecek.' : hasAny ? 'Filtreyi gevşetin ya da aramayı temizleyin.' : status === 'unconfigured' ? 'Sheets bağlantısını Ayarlar\'dan kurun ya da + ile kalem ekleyin.' : 'İlk kalemi + ile ekleyin.'}
            data-testid="empty-state"
          >
            <EmptyState.Actions>
              {emptyAllDone && <Button onClick={() => chooseView('done')}>Aldıklarımızı göster</Button>}
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
                <Divider className={classes.divider} label={`Alınan ve iptal edilenler · ${list.length - idx}`} labelPosition="left" data-testid="closed-divider" />
              )}
              <ItemCard item={item} onToggleDone={toggleDone} />
            </Box>
          ))
        )}
      </SimpleGrid>
      <Box px="sm" id="purchase-total-scope"><SourceNote label="Toplamın kapsamı">Mevcut eşyalar ve iptal edilenler hariç kayıtlı ve tahmini bedellerdir; yapılmış ödeme toplamı değildir.</SourceNote></Box>
      <FilterSheet opened={sheet} onClose={() => setSheet(false)} resultCount={list.length} activeCount={nActive} onClear={() => setFilters(clearedFilters(f))}>
        <PurchaseFilterSections items={viewItems} filters={f} onChange={setFromSheet} now={now} />
      </FilterSheet>
      {hasAny && <Fab onClick={() => navigate('~/satinalma/yeni')} label="Kalem ekle" />}
      <Route path="/:id">{(params) => <ItemDetail key={params.id} id={params.id} defaults={newDefaults} onSaved={afterSave} />}</Route>
      <Route path="/:id/fiyat">{(params) => <ItemDetail key={`${params.id}/fiyat`} id={params.id} section="fiyat" defaults={newDefaults} onSaved={afterSave} />}</Route>
    </Box>
  );
}
