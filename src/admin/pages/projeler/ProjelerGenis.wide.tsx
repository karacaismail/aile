import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useProfile } from '../../adaptive';
import type { ActiveFilter, FilterFacet, SortOption, StatusLabel, ViewMode } from '../../shell/contracts';
import { FilterDrawer } from '../../shell/FilterDrawer';
import { FilterPanel } from '../../shell/FilterPanel';
import { QueryBar } from '../../shell/QueryBar';
import { EmptyState } from '../../ui/EmptyState';
import { FilterArea } from '../../ui/FilterArea';
import { Kanban } from '../../ui/Kanban';
import { ResponsiveTable } from '../../ui/ResponsiveTable';
import { SIRALAMALAR, aramaEslesir, ganttGirdileri, ganttPlan, projeGruplari, sayi, tariheGoreSirala, type GorevSatiri } from './model';
import { GOREV_SUTUNLARI_GENIS, gorevGrubu } from './sutunlar';
import { Gantt } from './wide/Gantt';

// Geniş (tablet ve masaüstü) görev çalışma alanı; telefon bu modülü indirmez (lazyWide 'projeler-genis'). Telefonun
// proje listesine alan eklenir: bütün görevler tek yerde, sorgu çubuğu (arama, sıralama, görünüm modu), filtreler
// (Proje, Tür, Durum; masaüstünde 56 px şeritle başlayan panel, tablette sağdan çekmece) ve üç görünüm: Tablo (ilk
// sütun yapışkan), Kanban (teslimat iş akışı sırası), Gantt (proje satırı + görevleri). Liste, Zaman çizelgesi ve Pivot
// devre dışıdır, gerekçesi yazılır. Yazma yok: tarih ve durum kaynakta değişir.

const SUPPORTED: readonly ViewMode[] = ['table', 'kanban', 'gantt_chart'];
const UNSUPPORTED: Partial<Record<ViewMode, string>> = {
  listing: 'görevlerin fotoğraflı liste satırı yok; tablo aynı bilgiyi verir',
  timeline: 'görevlerin olay akışı yok',
  pivot: 'görevlerde toplanacak tutar alanı yok',
};
const GOREVLER = 'Görevler';
const KANBAN_ETIKET = 'Duruma göre görevler';
const ACIK_FACETLER = ['proje', 'tur', 'durum'] as const;

export interface ProjelerGenisProps {
  gorevler: readonly GorevSatiri[];
  /** Teslimat iş akışının sütunları; yoksa Kanban kayıtlardan türetir. */
  kanbanSutunlari?: readonly StatusLabel[];
  /** "Bugün" (Gantt'ta "Bu hafta"). */
  now: Date;
}

type FacetId = (typeof ACIK_FACETLER)[number];
const DEGER: Record<FacetId, (row: GorevSatiri) => string> = { proje: row => row.projeAdi, tur: row => row.tur, durum: row => row.status.label };
const ETIKET: Record<FacetId, string> = { proje: 'Proje', tur: 'Tür', durum: 'Durum' };
const BOS_SECIM: Record<FacetId, readonly string[]> = { proje: [], tur: [], durum: [] };
const isFacet = (id: string): id is FacetId => (ACIK_FACETLER as readonly string[]).includes(id);

export default function ProjelerGenis({ gorevler, kanbanSutunlari, now }: ProjelerGenisProps) {
  const profile = useProfile();
  const narrow = profile !== 'desktop';

  const [mode, setMode] = useState<ViewMode>('table');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortOption>(SIRALAMALAR[0]!);
  const [secim, setSecim] = useState<Record<FacetId, readonly string[]>>(BOS_SECIM);
  const [filtreAcik, setFiltreAcik] = useState(false);

  const facets = useMemo<FilterFacet[]>(() => {
    const say = (pick: (row: GorevSatiri) => string, order?: readonly string[]) => {
      const map = new Map<string, number>((order ?? []).map(value => [value, 0] as const));
      for (const row of gorevler) map.set(pick(row), (map.get(pick(row)) ?? 0) + 1);
      return [...map.entries()].map(([value, count]) => ({ value, label: value, count }));
    };
    // Projeler kendi sırasıyla (en erken başlangıç); "Bilinmiyor" ayrı değer ve sayımı var.
    const projeSirasi = projeGruplari(gorevler).map(proje => proje.ad);
    return [
      { id: 'proje', label: ETIKET.proje, kind: 'checkbox', options: say(DEGER.proje, projeSirasi), selected: secim.proje },
      { id: 'tur', label: ETIKET.tur, kind: 'checkbox', options: say(DEGER.tur), selected: secim.tur },
      { id: 'durum', label: ETIKET.durum, kind: 'checkbox', options: say(DEGER.durum), selected: secim.durum },
    ];
  }, [gorevler, secim]);

  const toggle = useCallback((facetId: string, value: string) => {
    if (!isFacet(facetId)) return;
    setSecim(prev => ({ ...prev, [facetId]: prev[facetId].includes(value) ? prev[facetId].filter(item => item !== value) : [...prev[facetId], value] }));
  }, []);
  const temizle = useCallback(() => {
    setSecim(BOS_SECIM);
    setSearch('');
  }, []);

  const activeFilters = useMemo<ActiveFilter[]>(() => {
    const list: ActiveFilter[] = [];
    if (search.trim()) list.push({ id: 'ara', label: `Arama: ${search.trim()}`, onRemove: () => setSearch('') });
    for (const id of ACIK_FACETLER) {
      for (const value of secim[id]) list.push({ id: `${id}:${value}`, label: `${ETIKET[id]}: ${value}`, onRemove: () => toggle(id, value) });
    }
    return list;
  }, [search, secim, toggle]);

  const sonuc = useMemo(() => {
    const filtered = gorevler.filter(row =>
      aramaEslesir(row, search) && ACIK_FACETLER.every(id => secim[id].length === 0 || secim[id].includes(DEGER[id](row))));
    return tariheGoreSirala(filtered, sort);
  }, [gorevler, search, secim, sort]);

  const gantt = useMemo(() => ganttPlan(ganttGirdileri(sonuc), now), [sonuc, now]);

  // Ağır görünümler (tablo, Kanban, Gantt) yalnız kendi verisi değişince yeniden çizilir.
  const gorunum = useMemo<ReactNode>(() => {
    if (sonuc.length === 0) return <EmptyState filters={activeFilters} onClear={temizle} />;
    if (mode === 'kanban') return <Kanban items={sonuc} columns={kanbanSutunlari} label={KANBAN_ETIKET} />;
    if (mode === 'gantt_chart') return <Gantt plan={gantt} narrow={narrow} />;
    return (
      <ResponsiveTable<GorevSatiri>
        columns={GOREV_SUTUNLARI_GENIS}
        rows={sonuc}
        caption={GOREVLER}
        mobileCaption={`${sayi.format(sonuc.length)} görev`}
        groupBy={gorevGrubu}
      />
    );
  }, [mode, sonuc, kanbanSutunlari, gantt, narrow, activeFilters, temizle]);

  const sorgu = (
    <QueryBar
      mode={mode}
      onModeChange={setMode}
      supported={SUPPORTED}
      unsupportedReason={UNSUPPORTED}
      search={search}
      onSearchChange={setSearch}
      sort={sort}
      sortOptions={SIRALAMALAR}
      onSort={setSort}
      activeFilters={activeFilters}
      onOpenFilters={() => setFiltreAcik(true)}
      resultCount={sonuc.length}
    />
  );

  if (narrow) {
    // Tablet: filtreler sağdan çekmecede (FilterDrawer), sonuç tam genişlikte.
    return (
      <div className="aile-projeler-genis" data-narrow="true">
        {sorgu}
        {gorunum}
        <FilterDrawer
          open={filtreAcik}
          onClose={() => setFiltreAcik(false)}
          resultCount={sonuc.length}
          facets={facets}
          onToggle={toggle}
          onClear={temizle}
          openKeys={ACIK_FACETLER}
        />
      </div>
    );
  }
  return (
    <div className="aile-projeler-genis" data-narrow="false">
      {sorgu}
      {/* Tablo, Kanban ve Gantt: masaüstünde filtre 56 px şeritle başlar (README › Uyarlanır teslim); mod değişince yeniden kurulur. */}
      <FilterArea key={mode} panel={<FilterPanel bare facets={facets} onToggle={toggle} onClear={temizle} openKeys={ACIK_FACETLER} />} defaultOpen={false} count={activeFilters.length}>
        {gorunum}
      </FilterArea>
    </div>
  );
}
