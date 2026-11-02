import { useId, useLayoutEffect, useRef, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { tokens } from '../../design/tokens.ts';
import { useDevice } from '../device';
import { Icon } from './icons';
import './Dialog.css';

// Tasarım: aile-tasarim/tasarim-sistemi/components/Dialog/README.md (kısa karar ya da küçük form; ortalı, en çok 560 px,
// kose-panel, golge-yukseltilmis, h2) + BottomSheet/README.md (telefonda alttan: tutamaç, görünür "Kapat", en çok %85,
// safe-area) + bundle.js Dialog/BottomSheet/useModal. Uzun form Drawer'a gider.
// Yerel uygulama, antd yok; tek bileşen tüm profillere hizmet eder (geniş-özel dosya gerekmez):
//  - Telefon (useDevice 'phone'): alt sayfa sunumu; tablet/masaüstü: ortalı panel. Profil açıkken değişirse aynı DOM
//    yeniden çizilir (odak korunur), yeniden bağlanmaz.
//  - ARIA APG "Dialog (Modal)" / "Alert Dialog": role dialog|alertdialog, aria-modal, aria-labelledby → h2; alert'te
//    aria-describedby → gövde. İlk odak başlıkta (tabindex -1) ya da initialFocus'ta; onay diyaloğunda tehlikeli eylem
//    hiçbir zaman varsayılan odak değildir. Tab/Shift+Tab içeride döner. Escape yalnız en üstteki diyaloğu kapatır;
//    açık açılır listesi olan combobox/menü düğmesindeyse önce o widget'a bırakılır. Kapanınca odak returnFocusTo'ya,
//    yoksa açıldığı anda odaklı olan öğeye (Safari'de basışla odak almayan düğmede: son basılan öğeye) döner.
//  - Katman: document.body'nin sonuna portal (açılış sırası = yığın sırası). z-index tokens.layerDropdown (antd
//    temasının zIndexPopupBase'i): sonradan açılan iç açılır liste ve alt sayfa üstte kalır. Kök .aile-admin kapsamını taşır: admin.css odak/tipografi kuralları portala ulaşır.
//    Açıkken kökün dışındaki her şey inert, sayfa kaydırması kilitli; kapanınca yalnız bizim eklediklerimiz geri alınır.
//  - Sanal klavye: visualViewport küçülünce (yakınlaştırma değilse) kök görünür alana oturur; panel bütün olarak kayar,
//    altlık (eylemler) altta yapışık ve görünür kalır, odaklı alan altlığın üstüne kaydırılır.
//  - Dokunma: telefonda örtüye dokunuş kapatır (referans: alt sayfa örtüsü). Basış pointerdown ile kaydedilir,
//    pointercancel (kaydırma/jest) iptal eder; kapatma click'te yapılır ki dokunuş arka plana geçmesin. Ortalı panelde
//    örtü kapatıcı değildir (referans Dialog scrim'i onClick taşımaz).
//  - Hareket: açılış ve kapanış aynı 240 ms ve tek eğri (Dialog.css, --aile-sure/--aile-egri). Durum/ARIA/odak anında
//    güncellenir; kapanış sunumu, gerçek diyalog kalktıktan sonra aria-hidden + inert, kimliksiz bir kopyada oynar ve
//    hareket bitince silinir. reduced-motion'da kopya yok.

/** Tasarım README: "En çok 560 px". tokens.json'da karşılığı yok; tek kaynak bu sabittir (CSS --aile-dialog-genislik). */
export const DIALOG_WIDTH = 560;

/** Kök katmanı (CSS --aile-dialog-katman): antd temasının zIndexPopupBase'i ile tek kaynak; içeriden açılan açılır
 *  liste (taban + 50) ve alt sayfa/çekmece (taban, DOM'da sonra) diyaloğun üstünde kalır. */
const DIALOG_LAYER = tokens.layerDropdown;

const CLOSE_LABEL = 'Kapat';

export interface DialogProps {
  /** h2 başlık; diyaloğun erişilebilir adı. */
  title: string;
  children?: ReactNode;
  /** Altlık (genelde FormFooter). Verilmezse altlık yok. */
  footer?: ReactNode;
  /** Kapat düğmesi, Escape ve (telefonda) örtü. */
  onClose?: () => void;
  /** Varsayılan açık (referans: open !== false). */
  open?: boolean;
  /** Geri alınamaz eylem onayı: role="alertdialog", aria-describedby gövde. */
  alert?: boolean;
  /** Portal ve kip davranışı olmadan yerinde çizim (önizleme). */
  inline?: boolean;
  /** Açılınca odaklanacak öğe; verilmezse başlık. Tehlikeli eylemi (ör. "Sil") vermeyin. */
  initialFocus?: RefObject<HTMLElement | null>;
  /** Kapanınca odağın döneceği öğe; verilmezse açıldığı anda odaklı olan öğe. */
  returnFocusTo?: RefObject<HTMLElement | null>;
}

// --- Modül düzeyi kip durumu (birden çok diyalog iç içe açılabilir) -------------------------------------------------

/** Açık kip diyalog kökleri, açılış sırasıyla; Escape ve odak tuzağı yalnız en üsttekinde çalışır. */
const openStack: HTMLElement[] = [];

/** inert'i bizim koyduğumuz öğeler ve kaç açık diyaloğun tuttuğu; başkasının koyduğu inert'e dokunulmaz. */
const inertHolds = new Map<Element, number>();
const NOT_RENDERED = new Set(['SCRIPT', 'STYLE', 'LINK', 'TEMPLATE', 'NOSCRIPT', 'META']);

function holdInert(keep: HTMLElement): () => void {
  const held: Element[] = [];
  for (let node: HTMLElement | null = keep; node && node !== document.body && node.parentElement; node = node.parentElement) {
    for (const sibling of Array.from(node.parentElement.children)) {
      if (sibling === node || NOT_RENDERED.has(sibling.tagName)) continue;
      const count = inertHolds.get(sibling) ?? 0;
      if (count === 0) {
        if (sibling.hasAttribute('inert')) continue;
        sibling.setAttribute('inert', '');
      }
      inertHolds.set(sibling, count + 1);
      held.push(sibling);
    }
  }
  return () => {
    for (const element of held) {
      const count = (inertHolds.get(element) ?? 1) - 1;
      if (count > 0) inertHolds.set(element, count);
      else {
        inertHolds.delete(element);
        element.removeAttribute('inert');
      }
    }
  };
}

let scrollLocks = 0;
let savedBody: { overflow: string; paddingRight: string } | null = null;

/** Sayfa kaydırmasını kilitler; kaydırma çubuğu kalkınca kayma olmasın diye genişliği kadar sağ boşluk verir. */
function lockScroll(): () => void {
  const { body, documentElement } = document;
  if (scrollLocks === 0) {
    const gutter = documentElement.clientWidth > 0 ? window.innerWidth - documentElement.clientWidth : 0;
    savedBody = { overflow: body.style.overflow, paddingRight: body.style.paddingRight };
    body.style.overflow = 'hidden';
    if (gutter > 0) body.style.paddingRight = `${gutter}px`;
  }
  scrollLocks += 1;
  return () => {
    scrollLocks -= 1;
    if (scrollLocks > 0 || !savedBody) return;
    body.style.overflow = savedBody.overflow;
    body.style.paddingRight = savedBody.paddingRight;
    savedBody = null;
  };
}

const TABBABLE = [
  'a[href]', 'area[href]', 'button', 'input:not([type="hidden"])', 'select', 'textarea', 'iframe', 'summary',
  'audio[controls]', 'video[controls]', '[contenteditable]:not([contenteditable="false"])', '[tabindex]',
].join(',');

function rendered(element: HTMLElement): boolean {
  const probe = element as HTMLElement & { checkVisibility?: (options?: Record<string, boolean>) => boolean };
  if (typeof probe.checkVisibility === 'function') return probe.checkVisibility({ checkVisibilityCSS: true, visibilityProperty: true });
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    if (node.hidden) return false;
    const style = window.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
  }
  return true;
}

function tabbables(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(TABBABLE)).filter(element =>
    element.tabIndex >= 0
    && !(element as HTMLButtonElement).disabled
    && !element.closest('[inert]')
    && rendered(element));
}

/** Escape'i kendisi işleyen açık açılır pencere tetikleyicisi (combobox, menü/liste düğmesi). */
function ownsEscape(target: Element | null): boolean {
  if (!target || target.getAttribute('aria-expanded') !== 'true') return false;
  const popup = target.getAttribute('aria-haspopup');
  return target.getAttribute('role') === 'combobox' || (popup !== null && popup !== 'false');
}

// Escape sahipliği olayın başında okunur: tarayıcıda React ayrık güncellemeyi dinleyiciler arasında uygular ve listeyi
// kapatan combobox aria-expanded'ı diyaloğun belge dinleyicisinden önce "false" yapabilir. Yakalama aşamasında açık
// açılır pencereye ait sayılan Escape'ler burada tutulur; aynı tuş basışı diyaloğu da kapatmaz.
const ownedEscapes = new WeakSet<Event>();
if (typeof document !== 'undefined') {
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && ownsEscape(event.target instanceof Element ? event.target : null)) ownedEscapes.add(event);
  }, true);
}

// Safari/WebKit fareyle ya da dokunarak basılan düğmeye odak vermez: açılışta document.activeElement body ya da daha
// önce odaklanmış başka bir öğedir (ör. rota değişiminde odaklanan main). WebKit mousedown'da odağı basılan öğenin en
// yakın odaklanabilir atasına (main#admin-content, tabindex -1) da verir. Açan öğe bu yüzden son birincil basışın
// etkileşimli hedefidir; basıştan sonra odak başka bir öğeye geçerse (basılan öğenin atası değilse) ya da klavye
// kullanılırsa (keydown) kayıt silinir ve odaklı öğe geçerlidir. Dinleyiciler modül yüklenince bir kez, yakalama
// aşamasında kurulur.
const INTERACTIVE = 'button, a[href], input, select, textarea, summary, [role="button"], [role="menuitem"], [role="tab"], [tabindex]:not([tabindex="-1"])';
let lastPress: WeakRef<HTMLElement> | null = null;
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', event => {
    const target = event.isPrimary && event.target instanceof Element ? event.target.closest<HTMLElement>(INTERACTIVE) : null;
    lastPress = target ? new WeakRef(target) : null;
  }, true);
  document.addEventListener('focusin', event => {
    const pressed = lastPress?.deref();
    if (!pressed) return;
    const target = event.target instanceof Node ? event.target : null;
    if (!target || !target.contains(pressed)) lastPress = null;
  }, true);
  document.addEventListener('keydown', () => { lastPress = null; }, true);
}

/** Açılış anındaki açan öğe: geçerli son basış hedefi, yoksa odaklı öğe. */
function currentOpener(): HTMLElement | null {
  const pressed = lastPress?.deref();
  if (pressed?.isConnected) return pressed;
  const active = document.activeElement;
  return active instanceof HTMLElement && active !== document.body ? active : null;
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Kapanış anındaki görsel konum: açılış hareketi sürerken kapanırsa kopya oradan geri döner (sıçramaz). */
interface ExitPose { scrim: string; transform: string; opacity: string }

function captureExitPose(root: HTMLElement): ExitPose | null {
  const scrim = root.querySelector<HTMLElement>('.aile-dialog-ortu');
  const panel = root.querySelector<HTMLElement>('.aile-dialog-panel');
  if (!scrim || !panel) return null;
  const panelStyle = window.getComputedStyle(panel);
  return { scrim: window.getComputedStyle(scrim).opacity, transform: panelStyle.transform, opacity: panelStyle.opacity };
}

/**
 * Kapanış sunumu: gerçek diyalog anlamsal olarak kalktıktan sonra görünümünün kopyası aria-hidden + inert olarak
 * eklenir, kapanış anındaki konumdan "closing" durumuna geçip hareketini oynar ve bitince silinir. Kimlik ve name
 * öznitelikleri silinir (çift kimlik ve radyo grubu çakışması olmasın); girilmiş form değerleri kopyaya taşınır ki
 * kapanırken boş görünmesin. Mikro görevde karar verilir: kök hâlâ belgedeyse (StrictMode'un efekt yeniden
 * çalıştırması) kapanış yoktur. reduced-motion'da ya da Web Animations yoksa kopya oluşturulmaz.
 */
function scheduleExit(root: HTMLElement) {
  if (typeof root.getAnimations !== 'function' || prefersReducedMotion()) return;
  const pose = captureExitPose(root);
  queueMicrotask(() => {
    if (!root.isConnected) playExit(root, pose);
  });
}

function playExit(root: HTMLElement, pose: ExitPose | null) {
  const ghost = root.cloneNode(true) as HTMLElement;
  const sources = root.querySelectorAll<HTMLInputElement>('input, textarea, select');
  const copies = ghost.querySelectorAll<HTMLInputElement>('input, textarea, select');
  sources.forEach((source, index) => {
    const copy = copies[index];
    if (!copy) return;
    if (source.type === 'checkbox' || source.type === 'radio') copy.checked = source.checked;
    else copy.value = source.value;
  });
  for (const element of [ghost, ...Array.from(ghost.querySelectorAll('[id], [name]'))]) {
    element.removeAttribute('id');
    element.removeAttribute('name');
  }
  ghost.setAttribute('aria-hidden', 'true');
  ghost.setAttribute('inert', '');
  ghost.dataset.state = 'open';
  const scrim = ghost.querySelector<HTMLElement>('.aile-dialog-ortu');
  const panel = ghost.querySelector<HTMLElement>('.aile-dialog-panel');
  if (pose && scrim && panel) {
    scrim.style.opacity = pose.scrim;
    panel.style.transform = pose.transform;
    panel.style.opacity = pose.opacity;
  }
  document.body.appendChild(ghost);
  void ghost.offsetHeight;
  for (const element of [scrim, panel]) element?.style.removeProperty('opacity');
  panel?.style.removeProperty('transform');
  ghost.dataset.state = 'closing';
  const animations = ghost.getAnimations({ subtree: true });
  if (animations.length === 0) {
    ghost.remove();
    return;
  }
  void Promise.allSettled(animations.map(animation => animation.finished)).then(() => ghost.remove());
}

/** Sanal klavye açıkken panel bütün olarak kayar ve altlık yapışkandır: odaklı alan altlığın altında kalmasın. */
function revealAboveFooter(panel: HTMLElement, element: HTMLElement) {
  element.scrollIntoView({ block: 'nearest' });
  const footer = panel.querySelector<HTMLElement>(':scope > .aile-dialog-altlik');
  if (!footer || footer.contains(element)) return;
  const overlap = element.getBoundingClientRect().bottom - footer.getBoundingClientRect().top;
  if (overlap > 0) panel.scrollTop += overlap;
}

// --- Bileşen -----------------------------------------------------------------------------------------------------

export function Dialog({ open = true, ...rest }: DialogProps) {
  // Katman yalnız açıkken bağlıdır: kapanış her yolda (open=false ya da üst bileşenin sökmesi) silmedir; temizlik DOM
  // henüz belgedeyken çalışır, odak dönüşü ve kapanış konumu buna dayanır.
  return open ? <DialogLayer {...rest} /> : null;
}

function DialogLayer({ title, children, footer, onClose, alert = false, inline = false, initialFocus, returnFocusTo }: Omit<DialogProps, 'open'>) {
  const sheet = useDevice() === 'phone';
  const id = useId();
  const titleId = `${id}-baslik`;
  const bodyId = `${id}-govde`;
  const modal = !inline;

  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  // Dinleyiciler oturum boyunca bir kez bağlanır; güncel props buradan okunur.
  const latest = useRef({ onClose, initialFocus, returnFocusTo });
  useLayoutEffect(() => {
    latest.current = { onClose, initialFocus, returnFocusTo };
  });
  // Örtüde başlamış birincil basış; pointercancel ve her click sıfırlar.
  const pressed = useRef(false);

  // Kip oturumu: yığın, inert, kaydırma kilidi, açılış hareketi, ilk odak, klavye, sanal klavye; temizlikte geri alınır
  // ve odak döner. Layout aşamasında: ilk boyadan önce arka plan inert olur ve odak taşınır. Kapanış silmedir: temizlik
  // DOM kalkmadan çalışır; odak açan öğeye taşındıktan sonra diyalog DOM'u aynı commit'te kalkar ve React'in seçim geri
  // yüklemesi kalkmış öğeyi yeniden odaklayamaz.
  useLayoutEffect(() => {
    if (!modal) return;
    const root = rootRef.current;
    const panel = panelRef.current;
    const heading = titleRef.current;
    if (!root || !panel || !heading) return;
    const opener = currentOpener();

    openStack.push(root);
    const releaseInert = holdInert(root);
    const releaseScroll = lockScroll();

    root.dataset.state = 'opening';
    void root.offsetHeight;
    root.dataset.state = 'open';
    (latest.current.initialFocus?.current ?? heading).focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (openStack[openStack.length - 1] !== root || event.defaultPrevented) return;
      const target = event.target instanceof Element ? event.target : null;
      const inside = !target || target === document.body || target === document.documentElement || root.contains(target);
      if (!inside) return;
      if (event.key === 'Escape') {
        if (event.isComposing || ownedEscapes.has(event) || ownsEscape(target)) return;
        event.preventDefault();
        latest.current.onClose?.();
        return;
      }
      if (event.key !== 'Tab' || event.ctrlKey || event.metaKey) return;
      const items = tabbables(panel);
      const current = document.activeElement;
      if (items.length === 0) {
        event.preventDefault();
        heading.focus({ preventScroll: true });
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const outside = !(current instanceof HTMLElement) || !panel.contains(current);
      if (event.shiftKey && (outside || current === first || current === heading || current === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (outside || current === last)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);

    // Sanal klavye: düzen görünümünün altını kapatan pay (yakınlaştırma değilse) → kök görünür alana oturur.
    const viewport = window.visualViewport;
    let keyboardInset = 0;
    const syncViewport = (event?: Event) => {
      if (!viewport) return;
      const zoomed = Math.abs(viewport.scale - 1) > 0.01;
      const inset = zoomed ? 0 : Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop));
      if (inset < 1) {
        root.style.removeProperty('--aile-dialog-ust');
        root.style.removeProperty('--aile-dialog-yukseklik');
        delete root.dataset.klavye;
      } else {
        root.style.setProperty('--aile-dialog-ust', `${Math.round(viewport.offsetTop)}px`);
        root.style.setProperty('--aile-dialog-yukseklik', `${Math.round(viewport.height)}px`);
        root.dataset.klavye = 'acik';
        const focused = document.activeElement;
        if (event?.type === 'resize' && inset > keyboardInset && focused instanceof HTMLElement && panel.contains(focused)) {
          revealAboveFooter(panel, focused);
        }
      }
      keyboardInset = inset;
    };
    // Klavye açıkken alanlar arasında gezinince yeni odak altlığın altında kalmasın.
    const onFocusIn = (event: FocusEvent) => {
      if (root.dataset.klavye && event.target instanceof HTMLElement && panel.contains(event.target)) revealAboveFooter(panel, event.target);
    };
    syncViewport();
    viewport?.addEventListener('resize', syncViewport);
    viewport?.addEventListener('scroll', syncViewport);
    panel.addEventListener('focusin', onFocusIn);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      viewport?.removeEventListener('resize', syncViewport);
      viewport?.removeEventListener('scroll', syncViewport);
      panel.removeEventListener('focusin', onFocusIn);
      const index = openStack.lastIndexOf(root);
      if (index >= 0) openStack.splice(index, 1);
      releaseInert();
      releaseScroll();
      scheduleExit(root);
      // Odak dönüşü: odak diyalogdaysa ya da kaybolduysa. Kullanıcı odağı başka bir katmana taşıdıysa dokunulmaz.
      const now = document.activeElement;
      const lost = !now || now === document.body || !now.isConnected || root.contains(now);
      const back = latest.current.returnFocusTo?.current ?? opener;
      if (lost && back?.isConnected) back.focus({ preventScroll: true });
    };
  }, [modal]);

  const rootClass = ['aile-admin', 'aile-dialog', sheet ? 'aile-dialog--sheet' : 'aile-dialog--center', inline && 'aile-dialog--inline']
    .filter(Boolean).join(' ');
  const content = (
    <div ref={rootRef} className={rootClass} data-aile-katman="dialog" style={{ '--aile-dialog-genislik': `${DIALOG_WIDTH}px`, '--aile-dialog-katman': String(DIALOG_LAYER) } as CSSProperties}>
      <div
        className="aile-dialog-ortu"
        aria-hidden="true"
        onPointerDown={event => { pressed.current = event.isPrimary && event.button === 0; }}
        onPointerCancel={() => { pressed.current = false; }}
        onClick={() => {
          const wasPressed = pressed.current;
          pressed.current = false;
          if (wasPressed && sheet) latest.current.onClose?.();
        }}
      />
      <div className="aile-dialog-sarmal">
        <div
          ref={panelRef}
          role={alert ? 'alertdialog' : 'dialog'}
          aria-modal={modal ? true : undefined}
          aria-labelledby={titleId}
          aria-describedby={alert ? bodyId : undefined}
          className="aile-dialog-panel"
        >
          {sheet ? <span className="aile-dialog-tutamac" aria-hidden="true" /> : null}
          <div className="aile-dialog-ust">
            <h2 ref={titleRef} id={titleId} tabIndex={-1} className="aile-dialog-baslik" data-focus-line="">{title}</h2>
            <button
              type="button"
              className="aile-dialog-kapat"
              data-focus-line=""
              aria-label={sheet ? undefined : CLOSE_LABEL}
              onClick={() => latest.current.onClose?.()}
            >
              <Icon name="close" />
              {sheet ? <span className="aile-dialog-kapat-metin">{CLOSE_LABEL}</span> : null}
            </button>
          </div>
          <div id={bodyId} className="aile-dialog-govde">{children}</div>
          {footer ? <div className="aile-dialog-altlik">{footer}</div> : null}
        </div>
      </div>
    </div>
  );
  return inline ? content : createPortal(content, document.body);
}
