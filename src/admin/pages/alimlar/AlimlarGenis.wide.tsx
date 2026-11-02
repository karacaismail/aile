import { useMemo, type ReactNode } from 'react';
import { defaultFilterOpen } from '../../data';
import type { FilterFacet, ViewMode } from '../../shell/contracts';
import { FilterPanel } from '../../shell/FilterPanel';
import { DetailPanel } from '../../ui/DetailPanel';
import { FilterArea } from '../../ui/FilterArea';
import type { DetailPanelProps } from '../../ui/DetailPanel';
import './AlimlarGenis.wide.css';

// Alımlar masaüstü yerleşimi (yalnız masaüstü profili; telefon ve tablet bunu indirmez). README › Sayfa iskeleti 4–5 ve
// Uyarlanır teslim tablosu: solda açık filtre paneli (filtre-genislik 272) — Tablo, Kanban, Pivot ve Gantt'ta 56 px
// şeritle başlar —, ortada sonuçlar, ayrıntı sağda ayrinti-genislik 384 sütunda (liste o sırada sıkı satıra geçer).
// Başlık, sorgu çubuğu ve bildirim sayfada (AlimlarPage) kalır: bu modül geldiğinde onlar yeniden kurulmaz, arama
// alanındaki girdi ve odak korunur. Mod değişince filtre alanı moda göre yeniden kurulur (key); ayrıntı dışarıda kalır.

export interface AlimlarGenisProps {
  /** Etkin görünüm modu; filtre alanının açık/şerit başlangıcı buna göre. */
  mode: ViewMode;
  facets: readonly FilterFacet[];
  onToggle(facetId: string, value: string): void;
  onClear(): void;
  openKeys: readonly string[];
  /** Etkin filtre sayısı (şerit rozeti). */
  filtreSayisi: number;
  /** Sonuç bölgesi (liste, tablo, kanban, zaman çizelgesi, pivot). */
  sonuclar: ReactNode;
  /** Açık ayrıntının props'u; null → ayrıntı kapalı. */
  detay: DetailPanelProps | null;
}

export default function AlimlarGenis({ mode, facets, onToggle, onClear, openKeys, filtreSayisi, sonuclar, detay }: AlimlarGenisProps) {
  const panel = useMemo(
    () => <FilterPanel bare facets={facets} onToggle={onToggle} onClear={onClear} openKeys={openKeys} />,
    [facets, onToggle, onClear, openKeys],
  );
  return (
    <div className="aile-alimlar-yerlesim" data-ayrinti={detay ? 'acik' : 'kapali'}>
      <FilterArea key={mode} panel={panel} defaultOpen={defaultFilterOpen(mode)} count={filtreSayisi}>
        {sonuclar}
      </FilterArea>
      {detay ? (
        <div className="aile-alimlar-ayrinti">
          <DetailPanel key={detay.row.id} {...detay} inline />
        </div>
      ) : null}
    </div>
  );
}
