import { useId, type ReactNode } from 'react';
import { useProfile } from '../../adaptive';
import type { ActiveFilter, FilterFacet, ResponsiveColumn, SortOption, ViewMode } from '../../shell/contracts';
import { FilterPanel } from '../../shell/FilterPanel';
import { QueryBar } from '../../shell/QueryBar';
import { FilterArea } from '../../ui/FilterArea';
import { ResponsiveTable } from '../../ui/ResponsiveTable';
import { Tag } from '../../ui/Tag';
import { Timeline } from '../../ui/Timeline';
import { grupOf, LISTE_ADI, SIRALAMALAR, toRecordRow, type OdemeRow } from './model';
import { Sayfalama } from './Sayfalama';
import { GerceklesenTutar, PlanTutari } from './Tutar';
import './OdemelerGenis.wide.css';

// Geniş (tablet + masaüstü) sunum; yalnız geniş profilde lazyWide('odemeler-genis') ile yüklenir, telefon indirmez.
// Tasarım: bundle.js Pages.Odemeler — sorgu şeridi (görünüm modu Tablo · Zaman çizelgesi; Gantt devre dışı: "ödemelerin
// tek tarihi var, süresi yok"), masaüstünde FilterArea (Tabloda 56 px şerit, Zaman çizelgesinde açık panel), tablet'te
// Filtreler çekmecesi (sayfa çizer). Liste telefondaki gibi h2 "Tahmini ödemeler" bölgesidir; altındaki gruplar h3
// (tablette sığmayan tablonun akordeon grupları, Zaman çizelgesi ayları): başlık sırası h1 → h2 → h3, atlamaz. Durum
// (yükleniyor, boş, hata) listenin yerini alır; FilterArea yerinde kalır (panel durumu korunur). Tablo: Tarih · Ödeme ·
// Planlanan · Gerçekleşen · Durum (ilk sütun yapışkan Table'da), tablette sığmazsa ResponsiveTable akordeona iner.
// Zaman çizelgesi: ui/Timeline aylık bölgeler. Plan ve gerçek ayrı sütun; gerçekleşen "Ödeme kaydı yok" (tahmin olayı
// ödeme değildir). Satır sayısı sayfa düzeyinde 50'şer açılır.

const DESTEKLENEN: readonly ViewMode[] = ['table', 'timeline'];
const DESTEKLENMEYEN: Partial<Record<ViewMode, string>> = {
  listing: 'tahmini ödemelerin fotoğrafı ve odası yok',
  kanban: 'tahmini ödemelerin durum akışı yok',
  gantt_chart: 'ödemelerin tek tarihi var, süresi yok',
  pivot: 'tahmini ödemelerin kırılım boyutu yok',
};

const SUTUNLAR: readonly ResponsiveColumn<OdemeRow>[] = [
  { key: 'tarih', title: 'Tarih', minWidth: 112, m: 'meta', render: row => row.dateText },
  {
    key: 'ad', title: 'Ödeme', minWidth: 220, m: 'title', only: 'desktop',
    render: row => (
      <>
        <strong className="aile-odemeler-ad">{row.label}</strong>
        <span className="aile-odemeler-alt aile-kucuk aile-ikincil">{`${row.code} · ${row.type}`}</span>
      </>
    ),
  },
  { key: 'ad2', title: 'Ödeme', minWidth: 220, m: 'title', only: 'mobile', render: row => row.label },
  { key: 'tur', title: 'Tür', minWidth: 120, m: 'meta', only: 'mobile', render: row => row.type },
  { key: 'plan', title: 'Planlanan', align: 'right', minWidth: 128, m: 'lead', render: row => <PlanTutari row={row} /> },
  { key: 'gercek', title: 'Gerçekleşen', align: 'right', minWidth: 128, render: row => <GerceklesenTutar row={row} /> },
  { key: 'durum', title: 'Durum', minWidth: 160, m: 'status', render: row => <Tag tone={row.status.tone}>{row.status.label}</Tag> },
  { key: 'kod', title: 'Kimlik', minWidth: 112, only: 'mobile', render: row => row.code },
];

export interface OdemelerGenisProps {
  mod: ViewMode;
  onMod(mode: ViewMode): void;
  arama: string;
  onArama(value: string): void;
  siralama: SortOption;
  onSiralama(sort: SortOption): void;
  etkinFiltreler: readonly ActiveFilter[];
  onFiltreler(): void;
  facets: readonly FilterFacet[];
  onToggle(facetId: string, value: string): void;
  onClear(): void;
  /** Hazır olmayan durumun içeriği (yükleniyor, hata, boş); verilirse tablo yerine çizilir. */
  durum: ReactNode | null;
  satirlar: readonly OdemeRow[];
  toplam: number;
  sayim: string;
  adim: number;
  onDahaFazla(): void;
}

export default function OdemelerGenis({
  mod, onMod, arama, onArama, siralama, onSiralama, etkinFiltreler, onFiltreler, facets, onToggle, onClear,
  durum, satirlar, toplam, sayim, adim, onDahaFazla,
}: OdemelerGenisProps) {
  const masaustu = useProfile() === 'desktop';
  const anahtar = siralama.key === 'tutar' ? 'tutar' : 'tarih';
  const baslikId = useId();

  const icerik = durum ?? (
    <section className="aile-odemeler-genis" aria-labelledby={baslikId}>
      <h2 id={baslikId}>{LISTE_ADI}</h2>
      <p className="aile-odemeler-sayim">{sayim}</p>
      {mod === 'timeline' ? (
        <Timeline items={satirlar.map(toRecordRow)} dateField="paid" />
      ) : (
        <ResponsiveTable<OdemeRow>
          caption={LISTE_ADI}
          mobileCaption={sayim}
          columns={SUTUNLAR}
          rows={satirlar}
          groupBy={row => grupOf(row, anahtar).label}
        />
      )}
      <Sayfalama gosterilen={satirlar.length} toplam={toplam} adim={adim} onDahaFazla={onDahaFazla} />
    </section>
  );

  return (
    <>
      <QueryBar
        mode={mod}
        onModeChange={onMod}
        supported={DESTEKLENEN}
        unsupportedReason={DESTEKLENMEYEN}
        search={arama}
        onSearchChange={onArama}
        sort={siralama}
        sortOptions={SIRALAMALAR}
        onSort={onSiralama}
        activeFilters={etkinFiltreler}
        onOpenFilters={onFiltreler}
        resultCount={toplam}
      />
      {masaustu ? (
        <FilterArea key={mod} defaultOpen={mod === 'timeline'} count={etkinFiltreler.length} panel={<FilterPanel bare facets={facets} onToggle={onToggle} onClear={onClear} />}>
          {icerik}
        </FilterArea>
      ) : icerik}
    </>
  );
}
