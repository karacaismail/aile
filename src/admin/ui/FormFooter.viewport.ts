import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

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

/** En yakın dikey kaydırma kabı (yapışkan konumun sınırı); belge kaydırıcısına yapışıyorsa null. */
function scrollContainerOf(element: Element, win: Window): Element | null {
  const { body, documentElement } = win.document;
  for (let node = element.parentElement; node && node !== body && node !== documentElement; node = node.parentElement) {
    if (/(auto|scroll|overlay|hidden)/.test(win.getComputedStyle(node).overflowY)) return node;
  }
  return null;
}

/** Yapışkan konumun sınırı: en yakın kaydırma kabının alt kenarı; kap yoksa düzen görünüm alanının altı. */
function stickyLimit(element: Element, win: Window): number {
  const container = scrollContainerOf(element, win);
  return container ? container.getBoundingClientRect().bottom : win.document.documentElement.clientHeight;
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

// --- Yapışkan altlığın belge kaydırma payı ------------------------------------------------------------------------
// Belgenin altına yapışan altlık, odağa kaydırılan alanın üstüne binmemeli (WCAG 2.4.11). Her yapışkan altlık ölçülen
// yüksekliğini kaydeder; kökte en yüksek değer --aile-ff-yukseklik olur ve FormFooter.css bunu (odak çizgisi payıyla)
// scroll-padding-bottom yapar. Kaydırma kabı içindeki altlık kabına yapışır, belge payı istemez. Altlık kalkınca pay düşer.

const RESERVE_VAR = '--aile-ff-yukseklik';
const reserved = new Map<Element, number>();

function writeReserve(doc: Document) {
  const tallest = Math.max(0, ...reserved.values());
  if (tallest > 0) doc.documentElement.style.setProperty(RESERVE_VAR, `${tallest}px`);
  else doc.documentElement.style.removeProperty(RESERVE_VAR);
}

/** Yapışkan altlığın yüksekliğini belge kaydırma payına yazar; etkin değilken ya da kaldırılınca payı geri alır. */
export function useStickyReserve(ref: RefObject<Element | null>, enabled: boolean): void {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!enabled || !element) return undefined;
    const doc = element.ownerDocument;
    const win = doc.defaultView ?? window;
    const measure = () => {
      if (scrollContainerOf(element, win)) reserved.delete(element);
      else reserved.set(element, Math.ceil(element.getBoundingClientRect().height));
      writeReserve(doc);
    };
    measure();
    const observer = typeof win.ResizeObserver === 'function' ? new win.ResizeObserver(measure) : null;
    observer?.observe(element, { box: 'border-box' });
    return () => {
      observer?.disconnect();
      reserved.delete(element);
      writeReserve(doc);
    };
  }, [ref, enabled]);
}
