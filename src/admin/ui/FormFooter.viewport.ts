import { useEffect, useRef, useState, type RefObject } from 'react';

// Sanal klavye ve görsel görünüm alanı (window.visualViewport). iOS Safari ve varsayılan Android Chrome klavye açılınca
// düzen görünüm alanını küçültmez; yalnız görsel görünüm alanı daralır. position: fixed/sticky ile alta yapışan öğe
// (FormFooter, telefon ayrıntı katmanı) bu yüzden klavyenin altında kalır. Burada görünür alanın düzen görünüm alanından
// örttüğü pay CSS px olarak ölçülür; bileşen bu payı bir CSS değişkeniyle uygular. Kullanıcı yakınlaştırdıysa (scale ≠ 1)
// pay uygulanmaz: yapışkan öğe yakınlaştırılmış görünür alanı kovalayıp içeriği örtmez. visualViewport yoksa pay 0.
// Ölçüm olay anında yapılır (zamanlayıcı/gecikme yok); değer değişmedikçe yeniden çizim olmaz.

export interface ViewportInsets {
  /** Görünür alanın üstünde kalan düzen payı (görsel görünüm alanı aşağı kaydırıldığında). */
  top: number;
  /** Görünür alanın altında kalan düzen payı (sanal klavye). */
  bottom: number;
}

const NO_INSETS: ViewportInsets = { top: 0, bottom: 0 };
const SCALE_TOLERANCE = 0.01;

function usableViewport(win: Window): VisualViewport | null {
  const viewport = win.visualViewport;
  if (!viewport || Math.abs(viewport.scale - 1) > SCALE_TOLERANCE) return null;
  return viewport;
}

/** Düzen görünüm alanına göre görsel görünüm alanının üst ve alt payı. */
export function visualViewportInsets(win: Window = window): ViewportInsets {
  const viewport = usableViewport(win);
  const layoutHeight = win.document.documentElement.clientHeight;
  if (!viewport || !(layoutHeight > 0)) return NO_INSETS;
  const top = Math.max(0, Math.round(viewport.offsetTop));
  const bottom = Math.max(0, Math.round(layoutHeight - (viewport.offsetTop + viewport.height)));
  return top === 0 && bottom === 0 ? NO_INSETS : { top, bottom };
}

/** Yapışkan konumun sınırı: en yakın kaydırma kabının alt kenarı; kap yoksa düzen görünüm alanının altı. */
function stickyLimit(element: Element, win: Window): number {
  const { body, documentElement } = win.document;
  for (let node = element.parentElement; node && node !== body && node !== documentElement; node = node.parentElement) {
    if (/(auto|scroll|overlay|hidden)/.test(win.getComputedStyle(node).overflowY)) return node.getBoundingClientRect().bottom;
  }
  return documentElement.clientHeight;
}

/** Görsel görünüm alanının (klavyenin) öğenin yapışkan sınırını alttan örttüğü pay. */
export function keyboardOverlap(element: Element, win: Window = window): number {
  const viewport = usableViewport(win);
  if (!viewport) return 0;
  const visibleBottom = viewport.offsetTop + viewport.height;
  return Math.max(0, Math.round(stickyLimit(element, win) - visibleBottom));
}

/** visualViewport resize/scroll olaylarında `measure` çağrılır; etkin değilken ya da API yoksa hiç dinlenmez. */
function useVisualViewportMeasure<T>(enabled: boolean, initial: T, measure: () => T, same: (a: T, b: T) => boolean): T {
  const [value, setValue] = useState<T>(initial);
  const measureRef = useRef(measure);
  measureRef.current = measure;
  useEffect(() => {
    const viewport = enabled ? window.visualViewport : null;
    if (!viewport) {
      setValue(current => (same(current, initial) ? current : initial));
      return;
    }
    const update = () => {
      const next = measureRef.current();
      setValue(current => (same(current, next) ? current : next));
    };
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
    };
    // initial ve same modül sabitleridir; ölçüm measureRef'ten okunur. Yalnız etkinlik değişince yeniden abone olunur.
  }, [enabled]);
  return enabled ? value : initial;
}

const sameInsets = (a: ViewportInsets, b: ViewportInsets) => a.top === b.top && a.bottom === b.bottom;
const sameNumber = (a: number, b: number) => a === b;

/** Tam ekran katman için görünür alan payları (telefon ayrıntısı). */
export function useVisualViewportInsets(enabled: boolean): ViewportInsets {
  return useVisualViewportMeasure(enabled, NO_INSETS, () => visualViewportInsets(), sameInsets);
}

/** Yapışkan öğenin klavye payı; öğe henüz yoksa 0. */
export function useKeyboardOverlap(ref: RefObject<Element | null>, enabled: boolean): number {
  return useVisualViewportMeasure(enabled, 0, () => (ref.current ? keyboardOverlap(ref.current) : 0), sameNumber);
}
