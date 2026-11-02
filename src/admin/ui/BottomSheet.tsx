import { useId, useLayoutEffect, useRef, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { designTokens } from '../../design/tokens.ts';
import { useModalLayer } from './BottomSheet.layer';
import { Icon } from './icons';
import './BottomSheet.css';

// Tasarım: aile-tasarim/tasarim-sistemi/components/BottomSheet/README.md + index.d.ts BottomSheetProps; referans davranış
// bundle.js BottomSheet/useModal. Telefonda alttan açılan katman: seçim listesi (Select), Diğer eylemler (OverflowActions),
// kısa form (Dialog). Bu bileşenler telefonda bunu kendileri kullanır; sayfa kodu ayrıca çağırmaz.
// Yerel HTML + ARIA APG "Dialog (Modal)": role="dialog" + aria-modal + aria-labelledby (h2). antd yok (telefon profili
// antd istemez); kip, odak, inert, Escape, Tab tuzağı, hareket aşamaları ve sanal klavye BottomSheet.layer.ts'te.
// Sürükleyerek kapatma Pointer Events ile ve yalnız başlık alanından (tutamaç + başlık; CSS touch-action none): gövde kendi
// içinde dikey kayar, iki hareket çatışmaz. setPointerCapture ile işaretçi tutulur; pointercancel / lostpointercapture
// iptaldir (kapatmaz, yerine döner). Sürüklemesiz yollar her zaman var: görünür "Kapat", Escape, örtü.
// Görsel kurallar BottomSheet.css (yalnız --aile tokenları): en çok %85, gövde kendi içinde kayar, safe-area-inset-bottom,
// hareket 240 ms proje eğrisi, reduced-motion'da anlık. Odak çizgisini yalnız merkezi admin.css çizer: kök data-aile-katman
// taşır (body'ye portallansa da odak, halka sıfırlaması ve reduced-motion kapsamı), Kapat data-focus-line.
export interface BottomSheetProps {
  /** h2 başlık; diyaloğun erişilebilir adı. */
  title: string;
  children?: ReactNode;
  /** Genelde FormFooter ya da tek düğme. */
  footer?: ReactNode;
  /** Kapat düğmesi, Escape, örtü ve sürükleyerek kapatma. */
  onClose?: () => void;
  /** Varsayılan açık (referans: open !== false). */
  open?: boolean;
  /** Tam ekran (uzun form); köşe ve %85 sınırı kalkar. */
  full?: boolean;
  /** Portal yerine yerinde, kipsiz çizim (önizleme ve yalıtık test): arka plan inert değil, aria-modal yok. */
  inline?: boolean;
  /** Kapanınca odağın döneceği öğe; verilmezse açıldığı anda odaklı olan öğeye döner. */
  returnFocusTo?: RefObject<HTMLElement | null>;
  className?: string;
}

const CLOSE_LABEL = 'Kapat';
/** Dokunma titremesini sürüklemeden ayıran en küçük dikey hareket (CSS px; davranış eşiği, görsel token değil). */
const DRAG_START_PX = 6;
/** Bırakınca kapatma: sayfa yüksekliğinin dörtte biri, en az bir dokunma hedefi kadar. */
const CLOSE_FRACTION = 0.25;
/** Hızlı fırlatma (px/ms) eşiği; kısa ama kararlı aşağı hareket de kapatır. */
const FLING_PX_PER_MS = 0.5;
/** Sürüklemeyi başlatmayan öğeler: düğme ve bağlantıların kendi tıklaması korunur. */
const INTERACTIVE = 'button, a[href], input, select, textarea, [role="button"], [contenteditable="true"]';

interface Drag { id: number; startY: number; lastY: number; lastTime: number; offset: number; velocity: number; moved: boolean }

export function BottomSheet({ title, children, footer, onClose, open = true, full, inline, returnFocusTo, className }: BottomSheetProps) {
  const titleId = `aile-sheet-baslik${useId()}`;
  const layer = useModalLayer({ open, modal: !inline, onClose, returnFocusTo });
  const drag = useRef<Drag | null>(null);

  const setOffset = (offset: number | null) => {
    const wrapper = layer.motion.current;
    if (!wrapper) return;
    if (offset === null) wrapper.style.removeProperty('--surukleme');
    else wrapper.style.setProperty('--surukleme', `${offset}px`);
  };
  const setDragging = (dragging: boolean) => {
    const wrapper = layer.motion.current;
    if (!wrapper) return;
    if (dragging) wrapper.setAttribute('data-surukleniyor', '');
    else wrapper.removeAttribute('data-surukleniyor');
  };

  // Yeniden açılışta (kapanış hareketi sırasında dahil) önceki sürüklemeden ofset kalmaz.
  useLayoutEffect(() => {
    if (!open) return;
    drag.current = null;
    const wrapper = layer.motion.current;
    wrapper?.style.removeProperty('--surukleme');
    wrapper?.removeAttribute('data-surukleniyor');
  }, [open, layer.motion]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!layer.open || drag.current || !event.isPrimary) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest(INTERACTIVE)) return;
    drag.current = { id: event.pointerId, startY: event.clientY, lastY: event.clientY, lastTime: event.timeStamp, offset: 0, velocity: 0, moved: false };
    try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* işaretçi zaten bırakıldı */ }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || event.pointerId !== current.id) return;
    const elapsed = event.timeStamp - current.lastTime;
    if (elapsed > 0) current.velocity = (event.clientY - current.lastY) / elapsed;
    current.lastY = event.clientY;
    current.lastTime = event.timeStamp;
    current.offset = Math.max(0, event.clientY - current.startY);
    if (!current.moved) {
      if (current.offset < DRAG_START_PX) return;
      current.moved = true;
      setDragging(true);
    }
    setOffset(current.offset);
  };

  const finish = (event: ReactPointerEvent<HTMLDivElement>, commit: boolean) => {
    const current = drag.current;
    if (!current || event.pointerId !== current.id) return;
    drag.current = null;
    const handle = event.currentTarget;
    try { if (handle.hasPointerCapture?.(current.id)) handle.releasePointerCapture(current.id); } catch { /* bırakılmış */ }
    setDragging(false);
    const height = layer.motion.current?.getBoundingClientRect().height ?? 0;
    const distance = Math.max(designTokens.hedefAsgari, height * CLOSE_FRACTION);
    const close = commit && current.moved
      && (current.offset >= distance || (current.velocity >= FLING_PX_PER_MS && current.offset >= designTokens.hedefAsgari / 2));
    if (!close) {
      setOffset(null);
      return;
    }
    // Ofset kalır: kapanış geçişi bulunduğu yerden aşağı sürer. Çağıran açık bırakırsa yerine döner.
    layer.requestClose();
    queueMicrotask(() => { if (layer.motion.current && !layer.motion.current.closest('[data-durum="kapali"]')) setOffset(null); });
  };

  if (layer.stage === 'yok' || (!inline && !layer.container)) return null;
  const closing = !open;
  const rootClass = ['aile-sheet', full && 'aile-sheet--full', inline && 'aile-sheet--inline', className].filter(Boolean).join(' ');

  const sheet = (
    <div
      ref={layer.rootRef}
      className={rootClass}
      data-aile-katman=""
      data-durum={layer.stage === 'acik' ? 'acik' : 'kapali'}
      aria-hidden={closing || undefined}
      inert={closing || undefined}
      onKeyDown={inline ? layer.onKeyDown : undefined}
    >
      <div className="aile-sheet-ortu" aria-hidden="true" onClick={layer.requestClose} />
      <div ref={layer.motionRef} className="aile-sheet-sarmal" style={{ height: full ? '100%' : 'auto' }}>
        <div
          ref={layer.panelRef}
          className="aile-sheet-yuzey"
          role="dialog"
          aria-modal={inline ? undefined : true}
          aria-labelledby={titleId}
          tabIndex={-1}
        >
          <div
            className="aile-sheet-ust"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={event => finish(event, true)}
            onPointerCancel={event => finish(event, false)}
            onLostPointerCapture={event => finish(event, false)}
          >
            <span className="aile-sheet-tutamac" aria-hidden="true" />
            <h2 id={titleId} className="aile-sheet-baslik">{title}</h2>
            <button type="button" className="aile-sheet-kapat" data-focus-line onClick={layer.requestClose}>
              <Icon name="close" />
              <span>{CLOSE_LABEL}</span>
            </button>
          </div>
          <div className="aile-sheet-govde">{children}</div>
          {footer != null && footer !== false ? <div className="aile-sheet-altlik">{footer}</div> : null}
        </div>
      </div>
    </div>
  );

  return inline ? sheet : createPortal(sheet, layer.container as HTMLElement);
}
