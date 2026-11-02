import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useDevice } from '../device';
import { Button } from './Button';
import { Icon } from './icons';
import './FilterArea.css';

// Tasarım: aile-tasarim/tasarim-sistemi/components/FilterArea/README.md + index.d.ts FilterAreaProps; referans davranış
// bundle.js FilterArea (defaultOpen !== false açık başlar; şerit düğmesi aria-label "Filtreleri göster, N etkin";
// panelin üstünde quiet "Paneli gizle"), görsel kurallar bundle.css › "Filtre alanı" → FilterArea.css (yalnız --aile tokenları).
// Masaüstünde (useDevice 'desktop') üç sütunlu ızgara: solda filtre paneli (filtre-genislik 272) ya da 56 px şerit
// (Funnel + "Filtre" + etkin sayı), ortada sonuçlar (children), verilirse sağda ayrıntı (ayrinti-genislik 384).
// Liste ve Zaman çizelgesi açık, Tablo/Kanban/Pivot/Gantt şeritle başlar: çağıran defaultOpen'ı moda göre verir ve mod
// değişiminde key ile yeniden kurar (referansla aynı). Tablet ve telefonda yalnız children çizilir; filtreler orada
// çekmecede, ayrıntı tam sayfadadır (kabuk/sayfa yapar). Envanterdeki Layout.Sider eşlemesi kullanılmadı: Sider nav
// zemini (siderBg) ve admin.css'in nav odak rengi (.ant-layout-sider → odak-nav) beyaz filtre paneline uymaz.
// Panel bölgesi kapalıyken DOM'da kalır (hidden + inert): FilterPanel durumu korunur, iki düğme de aynı bölgeyi
// aria-controls ile gösterir. Geçişte odak kaybolmaz: şerit → "Paneli gizle", "Paneli gizle" → şerit.
// Odak çizgisini admin.css çizer (Button .ant-btn, şerit [data-focus-line]); burada outline/halka yok.
export interface FilterAreaProps {
  /** Filtre paneli içeriği (FilterPanel bare); yalnız masaüstünde çizilir. */
  panel: ReactNode;
  /** Sonuçlar (liste, tablo, kanban…). */
  children?: ReactNode;
  /** Masaüstünde panel açık başlar mı; Liste/Zaman çizelgesi true, Tablo/Kanban/Pivot/Gantt false. Varsayılan true. */
  defaultOpen?: boolean;
  /** Etkin filtre sayısı; şeritte rozet ve erişilebilir ad ("Filtreleri göster, 2 etkin"). 0 ya da yoksa rozet yok. */
  count?: number;
  /** Sağdaki ayrıntı paneli (384); yalnız masaüstünde çizilir. */
  detail?: ReactNode;
  className?: string;
}

type FocusTarget = 'gizle' | 'serit';

export function FilterArea({ panel, children, defaultOpen = true, count, detail, className }: FilterAreaProps) {
  const device = useDevice();
  const regionId = `${useId()}-filtreler`;
  const [open, setOpen] = useState(defaultOpen);
  const hideRef = useRef<HTMLButtonElement>(null);
  const railRef = useRef<HTMLButtonElement>(null);
  // Yalnız kullanıcı geçişinde odak taşınır; ilk çizimde ve cihaz değişiminde dokunulmaz.
  const pendingFocus = useRef<FocusTarget | null>(null);

  useLayoutEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    (target === 'gizle' ? hideRef : railRef).current?.focus();
  }, [open]);

  const show = () => { pendingFocus.current = 'gizle'; setOpen(true); };
  const hide = () => { pendingFocus.current = 'serit'; setOpen(false); };

  if (device !== 'desktop') {
    return <div className={['aile-filtre-alani', 'aile-filtre-alani--dar', className].filter(Boolean).join(' ')}>{children}</div>;
  }

  const active = count && count > 0 ? count : 0;
  const railLabel = active ? `Filtreleri göster, ${active} etkin` : 'Filtreleri göster';
  const rootClass = [
    'aile-filtre-alani', open ? 'aile-filtre-alani--acik' : 'aile-filtre-alani--serit', detail ? 'aile-filtre-alani--ayrinti' : null, className,
  ].filter(Boolean).join(' ');

  return (
    <div className={rootClass}>
      <div className="aile-filtre-alani-sol">
        {!open && (
          <div className="aile-filtre-alani-serit-kutu">
            <button
              ref={railRef}
              type="button"
              className="aile-filtre-alani-serit"
              aria-label={railLabel}
              aria-expanded={false}
              aria-controls={regionId}
              data-focus-line=""
              onClick={show}
            >
              <Icon name="filter" />
              <span className="aile-filtre-alani-serit-metin aile-kucuk">Filtre</span>
              {active ? <span className="aile-filtre-alani-sayi aile-kucuk">{active}</span> : null}
            </button>
          </div>
        )}
        <div id={regionId} role="region" aria-label="Filtreler" className="aile-filtre-alani-panel" hidden={!open} inert={!open}>
          <div className="aile-filtre-alani-gizle">
            <Button ref={hideRef} variant="quiet" aria-expanded={true} aria-controls={regionId} onClick={hide}>Paneli gizle</Button>
          </div>
          {panel}
        </div>
      </div>
      <div className="aile-filtre-alani-sonuclar">{children}</div>
      {detail ? <div className="aile-filtre-alani-ayrinti" data-detail="">{detail}</div> : null}
    </div>
  );
}
