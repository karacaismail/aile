import { useId, type RefObject } from 'react';
import { useDevice } from '../device';
import { BottomSheet, Button, Drawer } from '../ui';
import type { FilterPanelProps } from './contracts';
import { FilterPanel, facetSelectedCount } from './FilterPanel';
import './FilterDrawer.css';

// Dar düzende filtre yüzeyi. Tasarım: README › Sayfa iskeleti 4 ve Uyarlanır teslim tablosu; bu projenin telefon kuralı
// (seçim, menü, diyalog ve filtre telefonda ALT SAYFA) gereği telefon profilinde ui/BottomSheet (alttan, en çok %85,
// gövde kendi içinde kayar, alt güvenli alan), tablet ve (yine de açılırsa) masaüstünde ui/Drawer sağdan 384.
// Profil değişince yüzey değişir ama durum çağırandadır: filtreler onToggle ile ANINDA uygulanır, çekmece taslak tutmaz;
// bu yüzden profil ya da görünüm modu değişiminde seçimler kaybolmaz (bekleyen aralık metnini FilterPanel sökülürken
// bildirir). Başlık "Filtreler · N etkin" (N = gerçek seçimler; tarih türü sayılmaz). Altlık: sonuç sayısı canlı durum
// metni ("28 sonuç", tr-TR) + yan yana "Temizle" (onClear; açık kalır, kullanıcı yeniden seçebilir) ve "Uygula"
// (kapatır; açıklaması sonuç sayısıdır). Eylemler 44 px, kaba girişte 48 px (FilterDrawer.css). Çekmece davranışı
// (görünür "Kapat", Escape, odak içeri/geri, odak tuzağı) ui/BottomSheet ve ui/Drawer'dadır.
export interface FilterDrawerProps extends Omit<FilterPanelProps, 'bare'> {
  open: boolean;
  onClose(): void;
  /** Etkin filtrelerle eşleşen kayıt sayısı; altlıkta "{N} sonuç" durum metni. */
  resultCount: number;
  /** Kapanınca odağın döneceği öğe (genelde sorgu çubuğundaki Filtreler düğmesi); verilmezse açan öğeye döner. */
  returnFocusTo?: RefObject<HTMLElement | null>;
  /** Portal yerine yerinde çizim (önizleme ve yalıtık test). */
  inline?: boolean;
}

const BASLIK = 'Filtreler';
const UYGULA = 'Uygula';
const TEMIZLE = 'Temizle';
const sayi = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });

/** Etkin filtre sayısı: boyutların gerçek seçimleri (FilterPanel meta'sı ile aynı kural). Tetik ve başlık bunu yazar. */
export function activeFilterCount(facets: FilterPanelProps['facets']): number {
  return facets.reduce((total, facet) => total + facetSelectedCount(facet), 0);
}

export function FilterDrawer({ open, onClose, resultCount, returnFocusTo, inline, facets, onToggle, onClear, openKeys }: FilterDrawerProps) {
  const phone = useDevice() === 'phone';
  const statusId = `${useId()}-sonuc`;
  const active = activeFilterCount(facets);
  const title = active ? `${BASLIK} · ${sayi.format(active)} etkin` : BASLIK;

  const footer = (
    <div className="aile-filtre-altlik">
      <p id={statusId} role="status" className="aile-filtre-altlik-sonuc aile-kucuk aile-ikincil">{`${sayi.format(resultCount)} sonuç`}</p>
      <div className="aile-filtre-altlik-eylemler">
        <Button variant="secondary" onClick={() => onClear()} className="aile-filtre-altlik-dugme">{TEMIZLE}</Button>
        <Button variant="primary" onClick={() => onClose()} aria-describedby={statusId} className="aile-filtre-altlik-dugme">{UYGULA}</Button>
      </div>
    </div>
  );
  const body = (
    <div className="aile-filtre-cekmece-icerik" data-yuzey={phone ? 'alt-sayfa' : 'cekmece'}>
      <FilterPanel bare facets={facets} onToggle={onToggle} onClear={onClear} openKeys={openKeys} />
    </div>
  );

  if (phone) {
    return (
      <BottomSheet title={title} open={open} onClose={onClose} inline={inline} returnFocusTo={returnFocusTo} className="aile-filtre-cekmece" footer={footer}>
        {body}
      </BottomSheet>
    );
  }
  return (
    <Drawer title={title} open={open} onClose={onClose} side="right" inline={inline} returnFocusTo={returnFocusTo} className="aile-filtre-cekmece" footer={footer}>
      {body}
    </Drawer>
  );
}
