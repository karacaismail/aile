import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useDevice } from '../device';
import { BottomSheet } from './BottomSheet';
import { Button } from './Button';
import { Icon } from './icons';
import { PRESS_HANDLERS } from './Kanban.press';
import './FilterArea.css';

// Tasarım: aile-tasarim/tasarim-sistemi/components/FilterArea/README.md + index.d.ts FilterAreaProps; referans davranış
// bundle.js FilterArea (defaultOpen !== false açık başlar; şerit düğmesi aria-label "Filtreleri göster, N etkin";
// panelin üstünde quiet "Paneli gizle"), görsel kurallar bundle.css › "Filtre alanı" → FilterArea.css (yalnız --aile tokenları).
// Masaüstünde (useDevice 'desktop') üç sütunlu ızgara: solda filtre paneli (filtre-genislik 272) ya da 56 px şerit
// (Funnel + "Filtre" + etkin sayı), ortada sonuçlar (children), verilirse sağda ayrıntı (ayrinti-genislik 384).
// Liste ve Zaman çizelgesi açık, Tablo/Kanban/Pivot/Gantt şeritle başlar: çağıran defaultOpen'ı moda göre verir ve mod
// değişiminde key ile yeniden kurar (referansla aynı). Tablet ve telefonda (uyarlamalı teslim, W0): panel verilmişse
// sonuçların üstünde etkin filtre sayılı "Filtreler" tetiği; panel alt sayfada (BottomSheet "Filtreler") açılır,
// altlıkta "N sonucu göster" (resultCount yoksa "Sonuçları göster") kapatır; Escape ve "Kapat" da kapatır; odak tetiğe
// döner. panel null ise (sayfa kendi çekmecesini — shell/FilterDrawer — kullanıyorsa) yalnız children çizilir; ayrıntı
// orada tam sayfadadır (kabuk/sayfa yapar). Tek yerel uygulama tüm profillere hizmet eder (antd gerekmez; geniş dosya
// yok). Basılı geri bildirim Pointer Events ile (Kanban.press). Envanterdeki Layout.Sider eşlemesi kullanılmadı: Sider nav
// zemini (siderBg) ve admin.css'in nav odak rengi (.ant-layout-sider → odak-nav) beyaz filtre paneline uymaz.
// Panel bölgesi kapalıyken DOM'da kalır (hidden + inert): FilterPanel durumu korunur, iki düğme de aynı bölgeyi
// aria-controls ile gösterir. Geçişte odak kaybolmaz: şerit → "Paneli gizle", "Paneli gizle" → şerit.
// Odak çizgisini admin.css çizer ([data-focus-line]: yerel Button ve şerit); burada outline/halka yok.
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
  /** Telefon/tablet alt sayfasının altlığında "N sonucu göster"; verilmezse "Sonuçları göster". */
  resultCount?: number;
}

const FILTRELER = 'Filtreler';
const sayi = new Intl.NumberFormat('tr-TR');

type FocusTarget = 'gizle' | 'serit';

export function FilterArea({ panel, children, defaultOpen = true, count, detail, className, resultCount }: FilterAreaProps) {
  const device = useDevice();
  const regionId = `${useId()}-filtreler`;
  const [open, setOpen] = useState(defaultOpen);
  const [sheetOpen, setSheetOpen] = useState(false);
  const hideRef = useRef<HTMLButtonElement>(null);
  const railRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
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

  const active = count && count > 0 ? count : 0;

  if (device !== 'desktop') {
    const narrowClass = ['aile-filtre-alani', 'aile-filtre-alani--dar', className].filter(Boolean).join(' ');
    if (panel == null || panel === false) return <div className={narrowClass}>{children}</div>;
    const closeSheet = () => setSheetOpen(false);
    return (
      <div className={narrowClass}>
        <div className="aile-filtre-alani-arac">
          <button
            ref={triggerRef}
            type="button"
            className="aile-filtre-alani-tetik"
            aria-label={active ? `${FILTRELER}, ${active} etkin` : FILTRELER}
            aria-haspopup="dialog"
            aria-expanded={sheetOpen}
            data-focus-line=""
            onClick={() => setSheetOpen(true)}
            {...PRESS_HANDLERS}
          >
            <Icon name="filter" />
            <span className="aile-filtre-alani-tetik-metin">{FILTRELER}</span>
            {active ? <span className="aile-filtre-alani-sayi aile-kucuk">{active}</span> : null}
          </button>
        </div>
        {children}
        <BottomSheet
          title={FILTRELER}
          open={sheetOpen}
          onClose={closeSheet}
          returnFocusTo={triggerRef}
          footer={(
            <Button variant="primary" block onClick={closeSheet}>
              {resultCount === undefined ? 'Sonuçları göster' : `${sayi.format(resultCount)} sonucu göster`}
            </Button>
          )}
        >
          {panel}
        </BottomSheet>
      </div>
    );
  }

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
              {...PRESS_HANDLERS}
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
