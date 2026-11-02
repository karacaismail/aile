import type { RefObject } from 'react';
import { useDevice } from '../device';
import { Drawer, FormFooter } from '../ui';
import type { FilterPanelProps } from './contracts';
import { FilterPanel } from './FilterPanel';

// Tasarım: README › Sayfa iskeleti 4 ("dar ekranda tam ekran çekmece") ve Uyarlanır teslim tablosu (telefon: filtre tam
// ekran; tablet: sağdan 384 px çekmece). Referans davranış bundle.js SayfaAlimlar/PageFrame: Drawer{full: dev==='phone',
// title "Filtreler · N etkin", footer FormFooter narrow "{N} sonucu göster" / "Filtreleri temizle"} içinde FilterPanel bare.
// Çekmece davranışı (görünür "Kapat", Escape, odak içeri/geri) ui/Drawer'dadır; burada yalnız dar ekran filtre bileşimi.
// Masaüstünde çağıran FilterArea kullanır; yine de açılırsa tablet gibi 384 çizilir (cihaz değişiminde kayıp yok).
// Birincil düğme uygulamaz, yalnız kapatır: filtreler onToggle ile anında uygulanır (referansla aynı), düğme sonuç
// sayısını söyler. İkincil "Filtreleri temizle" onClear çağırır ve çekmeceyi açık tutar; kullanıcı yeni seçim yapabilir.
export interface FilterDrawerProps extends Omit<FilterPanelProps, 'bare'> {
  open: boolean;
  onClose(): void;
  /** Etkin filtrelerle eşleşen kayıt sayısı; birincil düğme "{N} sonucu göster". */
  resultCount: number;
  /** Kapanınca odağın döneceği öğe (genelde sorgu çubuğundaki Filtreler düğmesi); verilmezse açan öğeye döner. */
  returnFocusTo?: RefObject<HTMLElement | null>;
  /** Portal yerine yerinde çizim (önizleme ve yalıtık test). */
  inline?: boolean;
}

const sayi = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });

/** Etkin filtre sayısı: tüm boyutlardaki seçili değerlerin toplamı. */
export function activeFilterCount(facets: FilterPanelProps['facets']): number {
  return facets.reduce((total, facet) => total + facet.selected.length, 0);
}

export function FilterDrawer({ open, onClose, resultCount, returnFocusTo, inline, facets, onToggle, onClear, openKeys }: FilterDrawerProps) {
  const device = useDevice();
  const active = activeFilterCount(facets);
  const title = active ? `Filtreler · ${sayi.format(active)} etkin` : 'Filtreler';
  return (
    <Drawer
      title={title}
      open={open}
      onClose={onClose}
      side="right"
      full={device === 'phone'}
      inline={inline}
      returnFocusTo={returnFocusTo}
      className="aile-filtre-cekmece"
      footer={
        <FormFooter
          narrow
          sticky={false}
          primaryLabel={`${sayi.format(resultCount)} sonucu göster`}
          secondaryLabel="Filtreleri temizle"
          onPrimary={onClose}
          onSecondary={onClear}
        />
      }
    >
      <FilterPanel bare facets={facets} onToggle={onToggle} onClear={onClear} openKeys={openKeys} />
    </Drawer>
  );
}
