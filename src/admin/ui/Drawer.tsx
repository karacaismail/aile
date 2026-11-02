import { useCallback, useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { designTokens } from '../../design/tokens.ts';
import { AntButton, AntDrawer } from './antd';
import { Icon } from './icons';
import './Drawer.css';

// Tasarım: aile-tasarim/tasarim-sistemi/components/Drawer/README.md + index.d.ts DrawerProps; referans davranış
// bundle.js Drawer/useModal (odak içeri, Escape kapatır, kapanınca açan düğmeye döner). Kenardan açılan modal katman:
// dar ekranda gezinme (tone "nav", side "left") ve filtreler (full), gerektiğinde form (footer = FormFooter).
// antd Drawer: closeIcon yerine metinli, her zaman görünür "Kapat"; örtü tıklaması ve Escape kapatır (keyboard, maskClosable);
// odak tuzağı antd'de (focusable.trap). Odak girişi ve dönüşü burada, referans useModal gibi: antd'nin autoFocus'u portal
// kabı belgeye eklenmeden önce çalışıp boşa düşebilir, dönüşü ise kapanış hareketinin sonunu bekler ve hareket bitmeden
// kapatılınca (destroyOnHidden) hiç çalışmaz. Bu yüzden açılınca odak bir sonraki karede role="dialog" paneline girer,
// open false olduğu anda returnFocusTo'ya ya da açıldığı anda odaklı olan öğeye döner.
// Görsel kurallar Drawer.css (yalnız --aile tokenları): iç köşeler kose-panel, gölge golge-yukseltilmis, arkada ortu,
// kenar yalnız cizgi ayırıcı; odak çizgisini admin.css çizer, nav üzerinde rengi Drawer.css acik-mavi yapar.
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
  /** Portal yerine yerinde çizim (önizleme ve yalıtık test). */
  inline?: boolean;
  /** Görünür kapatma düğmesinin metni. */
  closeLabel?: string;
  /** Kapanınca odağın döneceği öğe; verilmezse açıldığı anda odaklı olan öğeye döner. */
  returnFocusTo?: RefObject<HTMLElement | null>;
  className?: string;
}

const nextFrame = (callback: () => void): (() => void) => {
  if (typeof window.requestAnimationFrame === 'function') {
    const frame = window.requestAnimationFrame(callback);
    return () => window.cancelAnimationFrame(frame);
  }
  const timer = window.setTimeout(callback, 0);
  return () => window.clearTimeout(timer);
};

export function Drawer({
  title, children, footer, open = true, onClose, side = 'right', full, tone, width = designTokens.ayrintiGenislik,
  inline, closeLabel = 'Kapat', returnFocusTo, className,
}: DrawerProps) {
  const nav = tone === 'nav';
  const rootClass = ['aile-drawer', `aile-drawer--${side}`, full && 'aile-drawer--full', nav && 'aile-drawer--nav', className]
    .filter(Boolean).join(' ');
  const close = () => onClose?.();

  // role="dialog" paneli (antd panelRef). Odaklanabilmesi için tabIndex -1 burada yazılır; React bu özniteliği yönetmez.
  const panel = useRef<HTMLDivElement | null>(null);
  const panelRef = useCallback((element: HTMLDivElement | null) => {
    panel.current = element;
    if (element) element.tabIndex = -1;
  }, []);

  // Odak dönüşü: açılırken (antd henüz odağı taşımadan, layout aşamasında) odaklı öğe saklanır; open false olunca ya da
  // açıkken sökülünce odak returnFocusTo'ya, yoksa o öğeye döner. Odak bu arada çekmece dışına taşındıysa dokunulmaz.
  const returnTarget = useRef(returnFocusTo);
  returnTarget.current = returnFocusTo;
  useLayoutEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      const active = document.activeElement;
      const current = panel.current;
      const outside = active && active !== document.body && active !== document.documentElement
        && !(current && (active.contains(current) || current.contains(active)));
      if (outside) return;
      const target = returnTarget.current?.current ?? opener;
      if (target?.isConnected) target.focus({ preventScroll: true });
    };
  }, [open]);

  // Odak girişi: panel portal kabıyla birlikte belgeye eklendikten sonra, bir sonraki karede.
  useEffect(() => {
    if (!open) return;
    return nextFrame(() => panel.current?.focus({ preventScroll: true }));
  }, [open]);

  return (
    <AntDrawer
      open={open}
      onClose={close}
      placement={side}
      size={full ? '100%' : width}
      destroyOnHidden
      getContainer={inline ? false : undefined}
      panelRef={panelRef}
      // Dönüş burada yapılır; antd'nin hareket sonundaki dönüşü returnFocusTo'yu ezmesin.
      focusable={{ focusTriggerAfterClose: false }}
      closable={false}
      title={<h2 className="aile-drawer-title">{title}</h2>}
      extra={
        <AntButton
          htmlType="button"
          variant="text"
          color="primary"
          icon={<Icon name="close" />}
          onClick={close}
          className="aile-drawer-close"
        >
          {closeLabel}
        </AntButton>
      }
      footer={footer}
      rootClassName={rootClass}
      classNames={{
        mask: 'aile-drawer-mask', wrapper: 'aile-drawer-wrapper', section: 'aile-drawer-section',
        header: 'aile-drawer-header', body: 'aile-drawer-body', footer: 'aile-drawer-footer',
      }}
    >
      {children}
    </AntDrawer>
  );
}
