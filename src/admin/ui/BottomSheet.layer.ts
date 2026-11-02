import {
  useCallback, useEffect, useInsertionEffect, useLayoutEffect, useRef, useState,
  type KeyboardEvent as ReactKeyboardEvent, type RefObject,
} from 'react';

// Kipli katman çekirdeği: BottomSheet (telefon, alttan) ve Drawer (kenardan) aynı davranışı paylaşır. Yerel; antd yok
// (telefon profili antd istemez, W0 teslim kuralı). ARIA APG "Dialog (Modal)" kalıbı:
//  - Odak tek sahiplidir. Giriş açılış commit'inin layout aşamasında, React'in commit sonundaki odak geri yüklemesinden
//    (restoreSelection) sonra yapılır; içerik kendi öğesini odakladıysa dokunulmaz. Dönüş kapanış commit'inin layout
//    aşamasında returnFocusTo'ya, yoksa açıldığı anda odaklı olan öğeye yapılır; odak bu arada bilinçli olarak dışarı
//    taşındıysa ezilmez. Kare (rAF), zamanlayıcı ya da üçüncü taraf odak kilidi yoktur: sonuç deterministiktir.
//  - Kipli (portal) katmanda arka plan inert ve sayfa kaydırması kilitli; Tab sınırda karşı uca sarar; Escape yalnız en
//    üstteki katmanı kapatır. Katmandan sonra dışarıda açılan bir açılır katmanda (odak orada) Tab ve Escape onundur. Kapatma isteğinde (Kapat, Escape, örtü, sürükleme) arka plan onClose'dan ÖNCE serbest kalır:
//    çağıran odağı dışarı taşıyabilir (rota değişimi main'e odaklar). Çağıran açık bırakırsa arka plan yeniden inert olur.
//  - Inline katman kipsizdir (yerinde çizim; önizleme ya da akıştaki yan panel): inert, kilit, tuzak yok; Escape yalnız
//    odak içerideyken.
//  - Hareket yalnız sunumdur (UX hareket sözleşmesi): durum, ARIA, inert ve odak anında değişir. Kapanırken kök hemen
//    aria-hidden + inert olur, kapanış geçişi sürer, sarmalın kendi transitionend'i (ya da süre + pay) sonunda sökülür.
//    Hesaplanmış süre 0 ise (reduced-motion ya da CSS yok) aynı commit içinde sökülür. Kapanırken yeniden açılırsa aynı
//    düğüm bulunduğu yerden geri döner (CSS geçişi tersine yönelir).
//  - Sanal klavye: visualViewport ile katman görünür alana sığdırılır (--katman-ust, --katman-alt; kök top/bottom).

/** Görsel aşama. 'yok': çizilmez; 'giris': kapalı konumda çizildi (geçiş başlangıcı); 'acik'; 'cikis': kapanış geçişi. */
export type LayerStage = 'yok' | 'giris' | 'acik' | 'cikis';

export interface LayerOptions {
  open: boolean;
  /** Portal + kip: arka plan inert, kaydırma kilidi, Tab tuzağı, belge düzeyinde Escape, sanal klavye uyumu. */
  modal: boolean;
  onClose?: () => void;
  returnFocusTo?: RefObject<HTMLElement | null>;
}

export interface Layer {
  stage: LayerStage;
  /** Durum anında: kapanış hareketi sürerken bile false. */
  open: boolean;
  /** Portal hedefi: yönetim kökü (.aile-admin; tokenlar, tipografi, odak çizgisi ve reduced-motion kuralları orada), yoksa body. */
  container: HTMLElement | null;
  rootRef: (element: HTMLDivElement | null) => void;
  /** role="dialog" öğesi (tabIndex -1): odak girişi ve Tab tuzağı sınırı. */
  panelRef: (element: HTMLDivElement | null) => void;
  /** Kapanış geçişi bu öğenin kendi transitionend'iyle biter (sarmal). */
  motionRef: (element: HTMLDivElement | null) => void;
  motion: RefObject<HTMLDivElement | null>;
  /** Kapatma isteği: arka planı bırakır, onClose çağırır; açık kalırsa arka planı yeniden kilitler. */
  requestClose: () => void;
  /** Inline (kipsiz) katmanda Escape. */
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
}

/** Kapanış süresi bitiminde transitionend gelmezse (sekme arka planda, geçiş başlamadı) sökme payı. */
const EXIT_SLACK_MS = 50;
const SKIP_INERT = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'TEMPLATE', 'NOSCRIPT']);
const TABBABLE = 'a[href], area[href], button, input:not([type="hidden"]), select, textarea, iframe, summary, [contenteditable=""], [contenteditable="true"], [tabindex]';

export function layerContainer(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  return document.querySelector<HTMLElement>('.aile-admin') ?? document.body;
}

// --- Ortak durum (belge başına tek): katman yığını, inert sayımı, kaydırma kilidi -------------------------------------
const stack: symbol[] = [];
const inertCount = new Map<Element, number>();
let scrollLocks = 0;
let savedScroll: { overflow: string; paddingRight: string } | null = null;

function inertOthers(layer: HTMLElement): () => void {
  const touched: Element[] = [];
  let node: Element = layer;
  while (node.parentElement && node !== document.body) {
    const parent: HTMLElement = node.parentElement;
    for (const sibling of Array.from(parent.children)) {
      if (sibling === node || SKIP_INERT.has(sibling.tagName)) continue;
      const count = inertCount.get(sibling) ?? 0;
      // Başkasının koyduğu inert'e dokunulmaz (sayım yoksa ve öznitelik varsa sahibi biz değiliz).
      if (count === 0 && sibling.hasAttribute('inert')) continue;
      inertCount.set(sibling, count + 1);
      if (count === 0) sibling.setAttribute('inert', '');
      touched.push(sibling);
    }
    node = parent;
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const element of touched) {
      const count = (inertCount.get(element) ?? 1) - 1;
      if (count > 0) { inertCount.set(element, count); continue; }
      inertCount.delete(element);
      element.removeAttribute('inert');
    }
  };
}

function lockScroll(): () => void {
  const body = document.body;
  if (scrollLocks === 0) {
    savedScroll = { overflow: body.style.overflow, paddingRight: body.style.paddingRight };
    // Kaydırma çubuğu kalkınca yerleşim kaymasın: genişliği kadar sağ boşluk.
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    body.style.overflow = 'hidden';
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;
  }
  scrollLocks += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    scrollLocks -= 1;
    if (scrollLocks > 0 || !savedScroll) return;
    body.style.overflow = savedScroll.overflow;
    body.style.paddingRight = savedScroll.paddingRight;
    savedScroll = null;
  };
}

function isTabbable(element: HTMLElement): boolean {
  if (element.tabIndex < 0) return false;
  if ((element as HTMLButtonElement).disabled) return false;
  if (element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  const check = (element as HTMLElement & { checkVisibility?: () => boolean }).checkVisibility;
  return typeof check === 'function' ? check.call(element) : true;
}

function tabbables(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(TABBABLE)).filter(isTabbable);
}

/** Hesaplanmış en uzun geçiş (süre + gecikme, ms). Liste değerleri dizinle eşlenir (kısa liste yinelenir). */
function longestTransitionMs(element: Element): number {
  const style = window.getComputedStyle(element);
  if (style.transitionProperty === 'none') return 0;
  const ms = (value: string) => {
    const number = Number.parseFloat(value);
    if (!Number.isFinite(number)) return 0;
    return value.trim().endsWith('ms') ? number : number * 1000;
  };
  const durations = (style.transitionDuration || '').split(',').map(ms);
  const delays = (style.transitionDelay || '').split(',').map(ms);
  let longest = 0;
  durations.forEach((duration, index) => {
    if (duration > 0) longest = Math.max(longest, duration + (delays[index % delays.length] ?? 0));
  });
  return longest;
}

/** Sanal klavye ve görünür alan: katman kökünü görünür alanın dikey sınırlarına oturtur. İki parmak yakınlaştırmada kapalı. */
function fitVisualViewport(root: HTMLElement): () => void {
  const viewport = window.visualViewport;
  const write = (top: number, bottom: number) => {
    root.style.setProperty('--katman-ust', `${top}px`);
    root.style.setProperty('--katman-alt', `${bottom}px`);
  };
  if (!viewport) return () => {};
  const update = () => {
    if (Math.abs((viewport.scale ?? 1) - 1) > 0.01) { write(0, 0); return; }
    const top = Math.max(0, Math.round(viewport.offsetTop));
    const bottom = Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop));
    write(top, bottom);
  };
  update();
  viewport.addEventListener('resize', update);
  viewport.addEventListener('scroll', update);
  return () => {
    viewport.removeEventListener('resize', update);
    viewport.removeEventListener('scroll', update);
  };
}

export function useModalLayer({ open, modal, onClose, returnFocusTo }: LayerOptions): Layer {
  // --- Görsel aşama (render sırasında türetilir; React önceki render'dan türetilen durum kalıbı) -------------------
  const [stage, setStage] = useState<LayerStage>(open ? 'giris' : 'yok');
  let current = stage;
  if (open && (stage === 'yok' || stage === 'cikis')) current = stage === 'yok' ? 'giris' : 'acik';
  else if (!open && (stage === 'giris' || stage === 'acik')) current = 'cikis';
  if (current !== stage) setStage(current);

  // Portal hedefi layout aşamasında çözülür: katman uygulamayla birlikte (kapalı) bağlandığında ilk render'da yönetim kökü
  // henüz belgede değildir; layout aşamasında her zaman oradadır. Hedef yokken kipli katman çizilmez (bir sonraki eşzamanlı
  // render'da, boyamadan önce gelir).
  const [container, setContainer] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!modal) return;
    if (!container || !container.isConnected) setContainer(layerContainer());
  }, [modal, container, open]);
  const ready = !modal || !!container;
  const root = useRef<HTMLDivElement | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);
  const motion = useRef<HTMLDivElement | null>(null);
  const rootRef = useCallback((element: HTMLDivElement | null) => { root.current = element; }, []);
  const panelRef = useCallback((element: HTMLDivElement | null) => { panel.current = element; }, []);
  const motionRef = useCallback((element: HTMLDivElement | null) => { motion.current = element; }, []);

  const onCloseRef = useRef(onClose);
  const returnTarget = useRef(returnFocusTo);
  const openRef = useRef(open);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
    returnTarget.current = returnFocusTo;
    openRef.current = open;
  });

  // Açan öğe: içerik (ref/autoFocus) odağı layout aşamasında alabildiği için ondan önce, mutasyon aşamasında saklanır.
  const opener = useRef<HTMLElement | null>(null);
  useInsertionEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
  }, [open]);

  const wasOpen = useRef(false);
  /** Son açılışın kök öğesi (ref sökülünce de kalır): gerçek sökülmeyi StrictMode'un sanal sökülmesinden ayırır. */
  const layerElement = useRef<HTMLElement | null>(null);
  const restoreFocus = useCallback(() => {
    const active = document.activeElement;
    const layer = layerElement.current;
    const from = opener.current;
    const target = returnTarget.current?.current ?? from;
    opener.current = null;
    const lost = !active || active === document.body || active === document.documentElement || !active.isConnected;
    const inside = !!layer && !!active && layer.contains(active);
    // Odak bilinçli olarak dışarı taşındıysa (ör. rota değişimi main'e) ezilmez; açan öğe "dışarı" sayılmaz.
    if (!lost && !inside && active !== from && active !== target) return;
    if (target?.isConnected && !target.closest('[inert]')) target.focus({ preventScroll: true });
  }, []);

  // --- Kip: inert, kilit, yığın, Escape/Tab ve sanal klavye ---------------------------------------------------------
  const hold = useRef<{ inert: (() => void) | null; layer: HTMLElement } | null>(null);
  const requestClose = useCallback(() => {
    if (!openRef.current) return;
    const held = hold.current;
    held?.inert?.();
    if (held) held.inert = null;
    onCloseRef.current?.();
    queueMicrotask(() => {
      // Çağıran kapatmadıysa (ya da sonra kapatacaksa) arka plan yeniden inert.
      const still = hold.current;
      if (openRef.current && still && still === held && !still.inert) still.inert = inertOthers(still.layer);
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      if (wasOpen.current) {
        wasOpen.current = false;
        restoreFocus();
      }
      return;
    }
    wasOpen.current = true;
    const layer = root.current;
    const dialog = panel.current;
    layerElement.current = layer;
    const id = Symbol('katman');
    const cleanups: Array<() => void> = [];
    if (modal && layer) {
      const held = { inert: inertOthers(layer) as (() => void) | null, layer };
      hold.current = held;
      cleanups.push(() => {
        held.inert?.();
        held.inert = null;
        if (hold.current === held) hold.current = null;
      });
      cleanups.push(lockScroll());
      cleanups.push(fitVisualViewport(layer));
      stack.push(id);
      cleanups.push(() => {
        const index = stack.indexOf(id);
        if (index >= 0) stack.splice(index, 1);
      });
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.defaultPrevented || stack[stack.length - 1] !== id) return;
        // Katmandan sonra açılan ve kendi klavye düzenini yöneten dış katman (geniş profilde body'ye portallanan açılır
        // liste ya da diyalog): arka plan inert olduğu için odaklı, katman dışı ve inert olmayan bir öğe yalnız o olabilir.
        // Tab ve Escape onundur; boşluğa (body) ya da katmanın atasına düşen odak yine tuzağa girer.
        const target = event.target;
        if (target instanceof Element && !target.contains(layer) && !layer.contains(target) && !target.closest('[inert]')) return;
        if (event.key === 'Escape' && !event.isComposing) {
          event.preventDefault();
          requestClose();
          return;
        }
        if (event.key !== 'Tab' || event.ctrlKey || event.metaKey || !dialog) return;
        const stops = tabbables(dialog);
        const active = document.activeElement;
        const inside = active instanceof HTMLElement && dialog.contains(active);
        if (stops.length === 0) {
          event.preventDefault();
          dialog.focus({ preventScroll: true });
          return;
        }
        const first = stops[0];
        const last = stops[stops.length - 1];
        if (event.shiftKey ? (!inside || active === dialog || active === first) : (!inside || active === last)) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        }
      };
      document.addEventListener('keydown', onKeyDown);
      cleanups.push(() => document.removeEventListener('keydown', onKeyDown));
      // Odak kaybı: odak gerçek bir öğeye değil boşluğa (body) düşerse panele geri alınır. Örnek: katmanı mousedown'da
      // açan tetikleyici (antd Select) sonrasında tarayıcının varsayılan odaklaması artık inert olan hedefi bulamaz ve
      // odağı body'ye bırakır; içerikte odaklı öğe sökülünce de aynısı olur. Başka bir öğeye geçiş (ör. katmandan sonra
      // açılan açılır liste) serbesttir.
      const onFocusOut = (event: FocusEvent) => {
        if (event.relatedTarget) return;
        queueMicrotask(() => {
          if (!openRef.current || stack[stack.length - 1] !== id || !dialog?.isConnected) return;
          const active = document.activeElement;
          if (!active || active === document.body || active === document.documentElement) dialog.focus({ preventScroll: true });
        });
      };
      layer.addEventListener('focusout', onFocusOut);
      cleanups.push(() => layer.removeEventListener('focusout', onFocusOut));
    }
    if (dialog && !dialog.contains(document.activeElement)) dialog.focus({ preventScroll: true });
    return () => { for (const cleanup of cleanups.reverse()) cleanup(); };
  }, [open, modal, container, requestClose, restoreFocus]);

  // Açıkken sökülme: kip temizliği (layout) arka planı bıraktıktan ve katman belgeden çıktıktan sonra, passive temizlikte
  // odak döner; diğer bileşenlerin yeni passive effect'lerinden (ör. rota değişiminde main odağı) önce çalışır. Katman hâlâ
  // belgedeyse bu StrictMode'un sanal sökülmesidir (effect'ler yeniden bağlanır): dokunulmaz.
  useEffect(() => () => {
    const element = layerElement.current;
    if (!wasOpen.current || !element || element.isConnected) return;
    wasOpen.current = false;
    restoreFocus();
  }, [restoreFocus]);

  // --- Hareket aşamaları -------------------------------------------------------------------------------------------
  useLayoutEffect(() => {
    if (stage !== 'giris' || !ready) return;
    // Kapalı konumun stili hesaplansın ki 'acik' geçişle gelsin (aynı kare, boyamadan önce).
    motion.current?.getBoundingClientRect();
    setStage('acik');
  }, [stage, ready]);

  useLayoutEffect(() => {
    if (stage !== 'cikis') return;
    const element = motion.current;
    const total = element ? longestTransitionMs(element) : 0;
    if (!element || total <= 0) {
      setStage('yok');
      return;
    }
    const done = () => setStage(previous => (previous === 'cikis' ? 'yok' : previous));
    const onEnd = (event: Event) => { if (event.target === element) done(); };
    element.addEventListener('transitionend', onEnd);
    const timer = window.setTimeout(done, total + EXIT_SLACK_MS);
    return () => {
      element.removeEventListener('transitionend', onEnd);
      window.clearTimeout(timer);
    };
  }, [stage]);

  const onKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || event.defaultPrevented || event.nativeEvent.isComposing) return;
    event.preventDefault();
    requestClose();
  }, [requestClose]);

  return { stage: ready ? current : 'yok', open, container, rootRef, panelRef, motionRef, motion, requestClose, onKeyDown };
}
