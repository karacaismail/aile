import { useId, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { designTokens } from '../../design/tokens.ts';
import { useModalLayer } from './BottomSheet.layer';
import { Icon } from './icons';
import './Drawer.css';

// Tasarım: aile-tasarim/tasarim-sistemi/components/Drawer/README.md + index.d.ts DrawerProps; referans davranış
// bundle.js Drawer/useModal (odak içeri, Escape kapatır, kapanınca açan düğmeye döner). Kenardan açılan modal katman:
// dar ekranda gezinme (tone "nav", side "left") ve filtreler (full), geniş ekranda ayrıntı ya da form (footer = FormFooter).
// Yerel HTML + ARIA APG "Dialog (Modal)"; antd gerekmez, bu yüzden tek uygulama tüm profillere hizmet eder (.wide dosyası
// yok). Kip, odak (tek sahip, aynı commit), inert arka plan, kaydırma kilidi, Tab tuzağı, Escape (en üstteki katman),
// hareket aşamaları ve sanal klavye BottomSheet.layer.ts'te. Kapatma her zaman görünür metinli "Kapat", Escape ve örtü.
// Görsel kurallar Drawer.css (yalnız --aile tokenları): iç köşeler kose-panel, gölge golge-yukseltilmis, arkada ortu,
// kenar yalnız cizgi ayırıcı; hareket 240 ms proje eğrisi, reduced-motion'da anlık. Odak çizgisini yalnız merkezi admin.css
// çizer: kök data-aile-katman taşır (body'ye portallansa da kapsam), Kapat data-focus-line; nav tonunda yüzey
// data-odak-zemin="nav" (çizgi odak-nav, seçili öğede odak).
export interface DrawerProps {
  /** h2 başlık; diyaloğun erişilebilir adı. */
  title: string;
  children?: ReactNode;
  /** Genelde FormFooter. */
  footer?: ReactNode;
  /** Varsayılan açık (referans: open !== false). */
  open?: boolean;
  onClose?: () => void;
  side?: 'right' | 'left';
  /** Tam ekran (telefonda filtre çekmecesi). */
  full?: boolean;
  /** Lacivert gezinme çekmecesi: nav zemini, nav-metin, odak çizgisi acik-mavi. */
  tone?: 'nav';
  /** CSS px; varsayılan ayrinti-genislik 384. Viewport'tan genişse yüzde yüze iner. */
  width?: number;
  /** Portal yerine yerinde, kipsiz çizim (önizleme, yalıtık test, akıştaki yan panel): arka plan inert değil, aria-modal yok. */
  inline?: boolean;
  /** Görünür kapatma düğmesinin metni. */
  closeLabel?: string;
  /** Kapanınca odağın döneceği öğe; verilmezse açıldığı anda odaklı olan öğeye döner. */
  returnFocusTo?: RefObject<HTMLElement | null>;
  className?: string;
}

export function Drawer({
  title, children, footer, open = true, onClose, side = 'right', full, tone, width = designTokens.ayrintiGenislik,
  inline, closeLabel = 'Kapat', returnFocusTo, className,
}: DrawerProps) {
  const titleId = `aile-drawer-baslik${useId()}`;
  const layer = useModalLayer({ open, modal: !inline, onClose, returnFocusTo });
  if (layer.stage === 'yok' || (!inline && !layer.container)) return null;

  const closing = !open;
  const rootClass = [
    'aile-drawer', `aile-drawer--${side}`, full && 'aile-drawer--full', tone === 'nav' && 'aile-drawer--nav',
    inline && 'aile-drawer--inline', className,
  ].filter(Boolean).join(' ');

  const drawer = (
    <div
      ref={layer.rootRef}
      className={rootClass}
      data-aile-katman=""
      data-durum={layer.stage === 'acik' ? 'acik' : 'kapali'}
      aria-hidden={closing || undefined}
      inert={closing || undefined}
      onKeyDown={inline ? layer.onKeyDown : undefined}
    >
      <div className="aile-drawer-mask" aria-hidden="true" onClick={layer.requestClose} />
      <div ref={layer.motionRef} className="aile-drawer-wrapper" style={{ width: full ? '100%' : `${width}px` }}>
        <div
          ref={layer.panelRef}
          className="aile-drawer-section"
          role="dialog"
          aria-modal={inline ? undefined : true}
          aria-labelledby={titleId}
          tabIndex={-1}
          data-odak-zemin={tone === 'nav' ? 'nav' : undefined}
        >
          <div className="aile-drawer-header">
            <h2 id={titleId} className="aile-drawer-title">{title}</h2>
            <button type="button" className="aile-drawer-close" data-focus-line onClick={layer.requestClose}>
              <Icon name="close" />
              <span>{closeLabel}</span>
            </button>
          </div>
          <div ref={layer.bodyRef} className="aile-drawer-body">{children}</div>
          {footer != null && footer !== false ? <div className="aile-drawer-footer">{footer}</div> : null}
        </div>
      </div>
    </div>
  );

  return inline ? drawer : createPortal(drawer, layer.container as HTMLElement);
}
