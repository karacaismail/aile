import {
  useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState,
  type FocusEvent, type KeyboardEvent, type ReactNode, type RefObject, type SyntheticEvent,
} from 'react';
import { useReducedMotion } from '../adaptive/useReducedMotion';
import { useDevice } from '../device';
import { Icon, type IconName } from './icons';
import './Select.css';

// Tasarım: components/Select/README.md + bundle.js › Select. Tek değer; native select ve antd yok (tek yerel uygulama,
// her profil; geniş dosya gerekmez). Tetik 44 px (coarse girişte 48), sağda ok; açık listede seçili seçenek secili +
// 600 + onay simgesi. Devre dışı seçenek note ile nedenini söyler. "Bilinmiyor" bir seçenek olarak sunulur.
//  - Geniş (tablet/masaüstü): APG select-only combobox. Odak hep tetikte; etkin seçenek aria-activedescendant ile
//    gösterilir. Liste tetiğe bağlı yerel popover (top layer; kesilmez). Oklar/Home/End/PageUp/PageDown gezer,
//    Enter/Space/Alt+↑ seçer, Escape kapatır (olay üst katmana taşmaz), Tab seçmeden kapatır (yanlışlıkla durum
//    değiştirmesin), dışarıya basmak kapatır. Yazarak arama (typeahead) etiket önekine gider.
//  - Telefon: alttan açılan yerel modal <dialog> (showModal: arka plan inert, top layer). İçinde APG listbox, dolaşan
//    tabindex; seçili seçenek odak alır. 8'den fazla seçenekte üstte süzme alanı. Escape, Kapat ve örtü kapatır;
//    odak tetiğe döner.
// Hareket iki yönlü (giriş + çıkış, tek süre/eğri tokenı); semantik durum (aria-expanded, seçim, odak) hemen güncellenir,
// katman çıkış geçişi bitince kaldırılır. reduced-motion'da geçiş yok. Seçim ve açık durum profil değişiminde korunur.
// Odak göstergesi admin.css [data-focus-line] alt çizgisidir (yalnız klavye modu); burada halka yazılmaz.

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  /** Seçeneğin altında 14 px not; devre dışı seçenekte neden ("Önce teslim gerekir"). */
  note?: string;
}

export interface SelectProps {
  label: string;
  options: readonly SelectOption[];
  value?: string;
  onChange?(value: string): void;
  /** Varsayılan "Seçin". */
  placeholder?: string;
  help?: string;
  /** Alan hatası; "Hata: " önekini bileşen ekler. */
  error?: string;
  disabled?: boolean;
  icon?: IconName;
  /** Etiket görsel olarak gizli, erişilebilir ad korunur. */
  hideLabel?: boolean;
  /** Listenin sonuna "Bilinmiyor" ekler; boş bırakmanın yerine geçer. */
  includeUnknown?: boolean;
  /** Liste açık başlar (önizleme). Yalnız ilk değer okunur. */
  open?: boolean;
  id?: string;
  className?: string;
}

export const UNKNOWN_VALUE = 'bilinmiyor';
export const UNKNOWN_LABEL = 'Bilinmiyor';
/** Bu sayının üstünde telefonda süzme alanı açılır (tasarım README: "8'den fazla seçenekte"). */
export const SEARCH_THRESHOLD = 8;
const SEARCH_LABEL = 'Seçeneklerde ara';
const SEARCH_PLACEHOLDER = 'Ara';
const EMPTY_TEXT = 'Eşleşen seçenek yok';
const DEFAULT_PLACEHOLDER = 'Seçin';
const CLOSE_LABEL = 'Kapat';
/** Yazarak aramada tuşlar arası bu süreyi aşan boşluk yeni aramayı başlatır (APG). */
const TYPEAHEAD_MS = 500;
const PAGE_STEP = 10;
/** transitionend gelmezse (arka plan sekmesi vb.) çıkışı yine bitiren pay. Yalnız sunumdur; durum beklemez. */
const EXIT_SAFETY_MS = 50;

type Phase = 'giris' | 'acik' | 'cikis';

const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(' ');
const fold = (text: string) => text.toLocaleLowerCase('tr-TR');
const includesQuery = (option: SelectOption, query: string) => fold(option.label).includes(fold(query.trim()));
const isPrintable = (event: KeyboardEvent) => event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;

const nextFrame = (callback: () => void): (() => void) => {
  if (typeof window.requestAnimationFrame === 'function') {
    const frame = window.requestAnimationFrame(callback);
    return () => window.cancelAnimationFrame(frame);
  }
  const timer = window.setTimeout(callback, 0);
  return () => window.clearTimeout(timer);
};

const parseTimes = (value: string | undefined) => (value ?? '').split(',').map(part => {
  const text = part.trim();
  const amount = Number.parseFloat(text);
  if (!Number.isFinite(amount)) return 0;
  return text.endsWith('ms') ? amount : amount * 1000;
});

/** Öğenin en uzun geçişi (ms): süre + gecikme. Hesaplanmış stil yoksa (jsdom) ya da reduced-motion'da 0. */
function transitionMs(element: HTMLElement | null): number {
  if (!element) return 0;
  const style = window.getComputedStyle(element);
  const durations = parseTimes(style.transitionDuration);
  const delays = parseTimes(style.transitionDelay);
  return durations.reduce((longest, duration, index) => Math.max(longest, duration + (delays[index % delays.length] ?? 0)), 0);
}

/** Popover API (top layer). Yoksa (eski tarayıcı, jsdom) öznitelik yazılmaz: katman sabit konumlu ve görünür kalır. */
const supportsPopover = () => typeof HTMLElement !== 'undefined' && typeof HTMLElement.prototype.showPopover === 'function';

const isPopoverOpen = (element: HTMLElement) => {
  try { return element.matches(':popover-open'); } catch { return false; }
};

/** Etkin seçeneği kaydırma kabında görünür tutar (offset tabanlı: giriş hareketindeki transform kaydırmayı bozmaz). */
function keepVisible(container: HTMLElement | null, element: HTMLElement | null) {
  if (!container || !element || container.clientHeight === 0) return;
  const gap = Number.parseFloat(window.getComputedStyle(element.parentElement ?? element).rowGap) || 0;
  const top = element.offsetTop - gap;
  const bottom = element.offsetTop + element.offsetHeight + gap;
  if (top < container.scrollTop) container.scrollTop = Math.max(0, top);
  else if (bottom > container.scrollTop + container.clientHeight) container.scrollTop = bottom - container.clientHeight;
}

/**
 * Katman varlığı: open hemen değişir (semantik); katman açılırken bir kare 'giris' (başlangıç stili) sonra 'acik',
 * kapanırken 'cikis' ve geçiş bitince (exited) DOM'dan çıkar. Çıkış sırasında yeniden açılırsa aynı katman 'acik'a
 * döner; geçiş mevcut konumdan yeniden yönelir. reduced-motion'da giriş karesi atlanır.
 */
function usePresence(open: boolean, reduced: boolean) {
  const [present, setPresent] = useState(open);
  const [phase, setPhase] = useState<Phase>('acik');
  if (open && !present) {
    setPresent(true);
    setPhase(reduced ? 'acik' : 'giris');
  } else if (open && phase === 'cikis') {
    setPhase('acik');
  } else if (!open && present && phase !== 'cikis') {
    setPhase('cikis');
  }
  useEffect(() => {
    if (phase !== 'giris') return;
    return nextFrame(() => setPhase(current => (current === 'giris' ? 'acik' : current)));
  }, [phase]);
  const exited = useCallback(() => setPresent(false), []);
  return { present, phase, exited };
}

/** 'cikis' evresinde geçiş taşıyan öğenin transitionend'ini bekler; geçiş yoksa hemen bitirir. */
function useExitTransition(closing: boolean, ref: RefObject<HTMLElement | null>, onExited: () => void) {
  useEffect(() => {
    if (!closing) return;
    const element = ref.current;
    const ms = transitionMs(element);
    if (!element || ms <= 0) {
      onExited();
      return;
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      onExited();
    };
    const onEnd = (event: TransitionEvent) => { if (event.target === element) finish(); };
    element.addEventListener('transitionend', onEnd);
    const timer = window.setTimeout(finish, ms + EXIT_SAFETY_MS);
    return () => {
      done = true;
      element.removeEventListener('transitionend', onEnd);
      window.clearTimeout(timer);
    };
  }, [closing, ref, onExited]);
}

interface TypeaheadState { text: string; at: number }

/** APG yazarak arama: aynı harfin tekrarı eşleşenler arasında döner; birden çok harf öneki birleştirir. */
function typeaheadIndex(state: TypeaheadState, char: string, options: readonly SelectOption[], from: number): number {
  const now = Date.now();
  state.text = now - state.at > TYPEAHEAD_MS ? char : state.text + char;
  state.at = now;
  const text = fold(state.text);
  const needle = [...text].every(letter => letter === text[0]) ? text[0]! : text;
  const start = needle.length === 1 ? from + 1 : Math.max(from, 0);
  for (let step = 0; step < options.length; step += 1) {
    const index = (start + step) % options.length;
    if (fold(options[index]!.label).startsWith(needle)) return index;
  }
  return -1;
}

interface OptionItemProps {
  option: SelectOption;
  optionId: string;
  selected: boolean;
  active: boolean;
  /** Dolaşan tabindex (telefon): 0 / -1. Geniş profilde seçenek odak almaz (undefined). */
  tabIndex?: number;
  pressed: boolean;
  onPick(option: SelectOption): void;
  onPress(value: string | null): void;
  onFocusOption?(value: string): void;
  register(value: string, element: HTMLLIElement | null): void;
}

function OptionItem({ option, optionId, selected, active, tabIndex, pressed, onPick, onPress, onFocusOption, register }: OptionItemProps) {
  const roving = tabIndex !== undefined;
  return (
    <li
      ref={element => register(option.value, element)}
      id={optionId}
      role="option"
      aria-selected={selected}
      aria-disabled={option.disabled || undefined}
      aria-labelledby={`${optionId}-etiket`}
      aria-describedby={option.note ? `${optionId}-not` : undefined}
      tabIndex={tabIndex}
      data-focus-line={roving ? '' : undefined}
      className={cx('aile-select-secenek', selected && 'is-secili', option.disabled && 'is-devre-disi', active && 'is-etkin', pressed && 'is-basili')}
      // Basılı görünüm Pointer Events ile; seçim click'te (dokunmada pointerup'ta kapanmak alttaki öğeye hayalet
      // tıklama bırakır). Kaydırma hareketi tarayıcıda pointercancel üretir: basılı görünüm kalkar, click gelmez.
      onPointerDown={() => { if (!option.disabled) onPress(option.value); }}
      onPointerUp={() => onPress(null)}
      onPointerCancel={() => onPress(null)}
      onPointerLeave={() => onPress(null)}
      onClick={() => { if (!option.disabled) onPick(option); }}
      onFocus={onFocusOption ? () => onFocusOption(option.value) : undefined}
    >
      <span className="aile-select-secenek-metin">
        <span id={`${optionId}-etiket`} className="aile-select-secenek-etiket">{option.label}</span>
        {option.note && <span id={`${optionId}-not`} className="aile-select-secenek-not">{option.note}</span>}
      </span>
      {selected && <Icon name="check" className="aile-select-secenek-onay" />}
    </li>
  );
}

interface LayerProps {
  phase: Phase;
  onExited(): void;
  children: ReactNode;
}

interface PopoverLayerProps extends LayerProps {
  triggerRef: RefObject<HTMLDivElement | null>;
  containerRef: RefObject<HTMLDivElement | null>;
}

/** Geniş: tetiğe bağlı popover="manual" (top layer; ata taşma/yığın bağlamı kesmez). Konum görünüm alanına göre. */
function PopoverLayer({ phase, onExited, triggerRef, containerRef, children }: PopoverLayerProps) {
  const closing = phase === 'cikis';

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element || closing) return;
    if (element.hasAttribute('popover') && !isPopoverOpen(element)) {
      try { element.showPopover(); } catch { /* popover desteklenmiyor: sabit konumlu katman olarak kalır */ }
    }
    const place = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      const below = viewportHeight - rect.bottom;
      const above = rect.top;
      const up = below < Math.min(element.scrollHeight, above) && above > below;
      element.dataset.yon = up ? 'ust' : 'alt';
      element.style.minWidth = `${rect.width}px`;
      element.style.top = up ? 'auto' : `${rect.bottom}px`;
      element.style.bottom = up ? `${viewportHeight - rect.top}px` : 'auto';
      element.style.setProperty('--aile-select-alan', `${up ? above : below}px`);
      const gutter = Number.parseFloat(window.getComputedStyle(element).getPropertyValue('--aile-bosluk-4')) || 0;
      // Tetiğin solundan başlar; sağa taşacaksa sola kayar, ama görünüm alanından (ve kenar boşluğundan) dışarı çıkmaz.
      const minLeft = Math.max(0, Math.min(gutter, rect.left));
      const maxLeft = viewportWidth - element.offsetWidth - gutter;
      element.style.left = `${Math.max(minLeft, Math.min(rect.left, maxLeft))}px`;
    };
    place();
    let cancel = () => {};
    const schedule = (event?: Event) => {
      if (event && event.target === element) return;
      cancel();
      cancel = nextFrame(place);
    };
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    if (phase === 'giris') void element.getBoundingClientRect();
    return () => {
      cancel();
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
    };
    // phase yalnız giriş karesini zorlamak için okunur; konum dinleyicileri kapanış değişince kurulur.
  }, [closing, containerRef, triggerRef]);

  useLayoutEffect(() => () => {
    const element = containerRef.current;
    if (element && isPopoverOpen(element)) element.hidePopover();
  }, [containerRef]);

  useExitTransition(closing, containerRef, onExited);

  return (
    <div
      ref={containerRef}
      popover={supportsPopover() ? 'manual' : undefined}
      className="aile-select-acilir"
      data-state={phase}
      aria-hidden={closing || undefined}
      inert={closing || undefined}
      // Odak tetikte kalır (activedescendant): seçeneğe ya da kaydırma çubuğuna basmak tetiği bulandırmaz.
      onMouseDown={event => event.preventDefault()}
    >
      {children}
    </div>
  );
}

interface SheetLayerProps extends LayerProps {
  id: string;
  title: string;
  titleId: string;
  triggerRef: RefObject<HTMLDivElement | null>;
  bodyRef: RefObject<HTMLDivElement | null>;
  /** Açılınca (ve çıkıştan geri dönünce) etkin seçeneğe odak. */
  focusInitial(): void;
  onDismiss(): void;
  search?: ReactNode;
}

/**
 * Telefon: alttan açılan modal <dialog>. showModal arka planı inert yapar ve katmanı top layer'a alır (açan çekmecenin
 * içinden açılsa da üstte). Kapanışta önce modal bırakılır (tetik inert'ten çıkar), odak tetiğe döner; çıkış hareketi
 * süresince öğe popover olarak top layer'da kalır (inert, aria-hidden), geçiş bitince kaldırılır.
 */
function SheetLayer({ id, title, titleId, phase, onExited, triggerRef, bodyRef, focusInitial, onDismiss, search, children }: SheetLayerProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closing = phase === 'cikis';
  const focusRef = useRef(focusInitial);
  focusRef.current = focusInitial;

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!closing) {
      if (isPopoverOpen(dialog)) dialog.hidePopover();
      if (!dialog.hasAttribute('open')) {
        if (typeof dialog.showModal === 'function') dialog.showModal();
        else dialog.setAttribute('open', '');
      }
      focusRef.current();
      if (phase === 'giris') void panelRef.current?.getBoundingClientRect();
      return;
    }
    const active = document.activeElement;
    const focusInside = !active || active === document.body || dialog.contains(active);
    if (dialog.hasAttribute('open')) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    }
    if (dialog.hasAttribute('popover')) {
      try { dialog.showPopover(); } catch { /* top layer dışı çıkış: sabit konumlu kalır */ }
    }
    if (focusInside) triggerRef.current?.focus({ preventScroll: true });
    // phase yalnız giriş karesini zorlamak için okunur; modal/odak geçişi yalnız kapanış değişince.
  }, [closing, triggerRef]);

  useLayoutEffect(() => () => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (dialog.hasAttribute('open') && typeof dialog.close === 'function') dialog.close();
    if (isPopoverOpen(dialog)) dialog.hidePopover();
  }, []);

  useExitTransition(closing, panelRef, onExited);

  const onKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== 'Escape') return;
    // Tarayıcının cancel'ı ve üst katmanların (çekmece) Escape'i çalışmasın: yalnız bu liste kapanır.
    event.preventDefault();
    event.stopPropagation();
    onDismiss();
  };
  const onCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    event.preventDefault();
    onDismiss();
  };

  return (
    <dialog
      ref={dialogRef}
      id={id}
      popover={supportsPopover() ? 'manual' : undefined}
      className="aile-select-sayfa"
      aria-labelledby={titleId}
      data-state={phase}
      aria-hidden={closing || undefined}
      inert={closing || undefined}
      onKeyDown={onKeyDown}
      onCancel={onCancel}
    >
      <div className="aile-select-sayfa-ortu" aria-hidden="true" onClick={onDismiss} />
      <div ref={panelRef} className="aile-select-sayfa-panel">
        <div className="aile-select-sayfa-ust">
          <span className="aile-select-sayfa-tutamac" aria-hidden="true" />
          <h2 id={titleId} className="aile-select-sayfa-baslik">{title}</h2>
          <button type="button" className="aile-select-kapat" data-focus-line onClick={onDismiss}>
            <Icon name="close" />
            <span>{CLOSE_LABEL}</span>
          </button>
        </div>
        <div ref={bodyRef} className="aile-select-sayfa-govde">
          {search}
          {children}
        </div>
      </div>
    </dialog>
  );
}

export function Select({
  label, options, value, onChange, placeholder = DEFAULT_PLACEHOLDER, help, error, disabled, icon, hideLabel,
  includeUnknown, open: initialOpen = false, id: givenId, className,
}: SelectProps) {
  const autoId = useId();
  const id = givenId ?? `aile-select${autoId}`;
  const labelId = `${id}-etiket`;
  const noteId = `${id}-not`;
  const listboxId = `${id}-liste`;
  const sheetId = `${id}-sayfa`;
  const sheetTitleId = `${id}-sayfa-baslik`;
  const phone = useDevice() === 'phone';
  const reduced = useReducedMotion();

  const [inner, setInner] = useState(value);
  const current = value !== undefined ? value : inner;
  const [open, setOpen] = useState(Boolean(initialOpen) && !disabled);
  // Açıkken devre dışı kalan alan kapanır (seçim yapılamaz).
  if (disabled && open) setOpen(false);
  const [activeValue, setActiveValue] = useState<string | undefined>(undefined);
  const [query, setQuery] = useState('');
  const [pressed, setPressed] = useState<string | null>(null);
  const { present, phase, exited } = usePresence(open, reduced);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const sheetBodyRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const optionElements = useRef(new Map<string, HTMLLIElement>());
  const typeahead = useRef<TypeaheadState>({ text: '', at: 0 });

  const allOptions = useMemo<readonly SelectOption[]>(() => {
    if (!includeUnknown || options.some(option => option.value === UNKNOWN_VALUE)) return options;
    return [...options, { value: UNKNOWN_VALUE, label: UNKNOWN_LABEL }];
  }, [options, includeUnknown]);
  const indexOf = useMemo(() => new Map(allOptions.map((option, index) => [option.value, index])), [allOptions]);
  const searchable = allOptions.length > SEARCH_THRESHOLD;
  const visible = useMemo(
    () => (phone && query.trim() ? allOptions.filter(option => includesQuery(option, query)) : allOptions),
    [allOptions, phone, query],
  );
  const selected = allOptions.find(option => option.value === current);
  const activeIndex = visible.findIndex(option => option.value === activeValue);
  const rovingValue = activeIndex >= 0 ? activeValue : visible[0]?.value;
  const optionId = (option: SelectOption) => `${id}-secenek-${indexOf.get(option.value) ?? 0}`;
  const activeOption = activeIndex >= 0 ? visible[activeIndex] : undefined;

  const register = useCallback((key: string, element: HTMLLIElement | null) => {
    if (element) optionElements.current.set(key, element);
    else optionElements.current.delete(key);
  }, []);

  const openList = (focusValue?: string) => {
    if (disabled) return;
    setActiveValue(focusValue ?? (selected ? selected.value : allOptions[0]?.value));
    setQuery('');
    setOpen(true);
  };
  const closeList = () => {
    setOpen(false);
    setQuery('');
    setPressed(null);
  };
  const pick = (option: SelectOption) => {
    if (option.disabled) return;
    closeList();
    if (option.value === current) return;
    setInner(option.value);
    onChange?.(option.value);
  };

  // Profil değişimi açıkken: telefondan genişe geçince diyalog kalkar, odak tetiğe taşınır (popover odak almaz).
  const lastPhone = useRef(phone);
  useLayoutEffect(() => {
    if (lastPhone.current === phone) return;
    lastPhone.current = phone;
    if (open && !phone) triggerRef.current?.focus({ preventScroll: true });
  }, [phone, open]);

  // Geniş: etkin seçenek görünür kalır; dışarıya basmak kapatır (odak çalınmaz).
  useEffect(() => {
    if (!open || phone || !activeValue) return;
    keepVisible(popoverRef.current, optionElements.current.get(activeValue) ?? null);
  }, [open, phone, activeValue, present]);
  useEffect(() => {
    if (!open || phone) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && event.target instanceof Node && rootRef.current.contains(event.target)) return;
      closeList();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open, phone]);

  const move = (list: readonly SelectOption[], to: number, focus: boolean) => {
    if (list.length === 0) return;
    const next = list[Math.max(0, Math.min(list.length - 1, to))]!;
    setActiveValue(next.value);
    if (focus) optionElements.current.get(next.value)?.focus({ preventScroll: true });
    if (focus) keepVisible(sheetBodyRef.current, optionElements.current.get(next.value) ?? null);
  };
  const typeaheadActive = () => Date.now() - typeahead.current.at <= TYPEAHEAD_MS && typeahead.current.text.length > 0;

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const { key } = event;
    if (!open) {
      if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter' || key === ' ') {
        event.preventDefault();
        openList();
      } else if (key === 'Home' || key === 'End') {
        event.preventDefault();
        openList(key === 'Home' ? allOptions[0]?.value : allOptions[allOptions.length - 1]?.value);
      } else if (isPrintable(event)) {
        event.preventDefault();
        const match = typeaheadIndex(typeahead.current, key, allOptions, selected ? (indexOf.get(selected.value) ?? -1) : -1);
        openList(match >= 0 ? allOptions[match]!.value : undefined);
      }
      return;
    }
    if (phone) return;
    const index = activeIndex;
    switch (key) {
      case 'ArrowDown':
        event.preventDefault();
        move(visible, index + 1, false);
        return;
      case 'ArrowUp':
        event.preventDefault();
        if (event.altKey) { if (activeOption) pick(activeOption); return; }
        move(visible, index < 0 ? 0 : index - 1, false);
        return;
      case 'Home':
      case 'End':
        event.preventDefault();
        move(visible, key === 'Home' ? 0 : visible.length - 1, false);
        return;
      case 'PageDown':
      case 'PageUp':
        event.preventDefault();
        move(visible, index + (key === 'PageDown' ? PAGE_STEP : -PAGE_STEP), false);
        return;
      case 'Enter':
        event.preventDefault();
        if (activeOption) pick(activeOption);
        return;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        closeList();
        return;
      case 'Tab':
        closeList();
        return;
      default:
        break;
    }
    if (key === ' ' && !typeaheadActive()) {
      event.preventDefault();
      if (activeOption) pick(activeOption);
      return;
    }
    if (isPrintable(event)) {
      event.preventDefault();
      const match = typeaheadIndex(typeahead.current, key, visible, index);
      if (match >= 0) move(visible, match, false);
    }
  };

  const onTriggerBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!open || phone) return;
    const next = event.relatedTarget;
    if (next instanceof Node && rootRef.current?.contains(next)) return;
    if (next === null && typeof document.hasFocus === 'function' && !document.hasFocus()) return;
    closeList();
  };

  const onListKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const index = visible.findIndex(option => option.value === rovingValue);
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        move(visible, index + 1, true);
        return;
      case 'ArrowUp':
        event.preventDefault();
        if (index <= 0 && searchRef.current) { searchRef.current.focus(); return; }
        move(visible, index - 1, true);
        return;
      case 'Home':
      case 'End':
        event.preventDefault();
        move(visible, event.key === 'Home' ? 0 : visible.length - 1, true);
        return;
      case 'PageDown':
      case 'PageUp':
        event.preventDefault();
        move(visible, index + (event.key === 'PageDown' ? PAGE_STEP : -PAGE_STEP), true);
        return;
      case 'Enter': {
        event.preventDefault();
        const option = visible[index];
        if (option) pick(option);
        return;
      }
      default:
        break;
    }
    if (event.key === ' ' && !typeaheadActive()) {
      event.preventDefault();
      const option = visible[index];
      if (option) pick(option);
      return;
    }
    if (isPrintable(event)) {
      event.preventDefault();
      const match = typeaheadIndex(typeahead.current, event.key, visible, index);
      if (match >= 0) move(visible, match, true);
    }
  };

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && visible.length > 0) {
      event.preventDefault();
      move(visible, 0, true);
    } else if (event.key === 'Enter') {
      event.preventDefault();
    }
  };

  const focusInitial = () => {
    const target = rovingValue ? optionElements.current.get(rovingValue) : undefined;
    if (target) {
      target.focus({ preventScroll: true });
      keepVisible(sheetBodyRef.current, target);
    } else {
      searchRef.current?.focus({ preventScroll: true });
    }
  };

  const describedBy = error || help ? noteId : undefined;
  const renderOptions = (roving: boolean) => (
    visible.length > 0 ? (
      <ul
        id={listboxId}
        role="listbox"
        aria-labelledby={roving ? sheetTitleId : labelId}
        className="aile-select-liste"
        onKeyDown={roving ? onListKeyDown : undefined}
      >
        {visible.map(option => (
          <OptionItem
            key={option.value}
            option={option}
            optionId={optionId(option)}
            selected={option.value === current}
            active={roving ? false : option.value === activeValue}
            tabIndex={roving ? (option.value === rovingValue ? 0 : -1) : undefined}
            pressed={pressed === option.value}
            onPick={pick}
            onPress={setPressed}
            onFocusOption={roving ? setActiveValue : undefined}
            register={register}
          />
        ))}
      </ul>
    ) : (
      <p role="status" className="aile-select-bos">{EMPTY_TEXT}</p>
    )
  );

  const search = phone && searchable ? (
    <div className="aile-select-ara" data-focus-line>
      <Icon name="search" />
      <input
        ref={searchRef}
        type="search"
        className="aile-select-ara-girdi"
        aria-label={SEARCH_LABEL}
        aria-controls={visible.length > 0 ? listboxId : undefined}
        placeholder={SEARCH_PLACEHOLDER}
        autoComplete="off"
        enterKeyHint="search"
        value={query}
        onChange={event => {
          setQuery(event.target.value);
          setActiveValue(undefined);
        }}
        onKeyDown={onSearchKeyDown}
      />
    </div>
  ) : null;

  return (
    <div ref={rootRef} className={cx('aile-select', className)}>
      <span
        id={labelId}
        className={cx('aile-select-etiket', hideLabel && 'aile-select-etiket--gizli')}
        onClick={() => { if (!disabled) triggerRef.current?.focus(); }}
      >
        {label}
      </span>
      <div
        ref={triggerRef}
        id={id}
        role="combobox"
        tabIndex={disabled ? undefined : 0}
        aria-labelledby={labelId}
        aria-haspopup={phone ? 'dialog' : 'listbox'}
        aria-expanded={open}
        aria-controls={open ? (phone ? sheetId : listboxId) : undefined}
        aria-activedescendant={open && !phone && activeOption ? optionId(activeOption) : undefined}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        aria-disabled={disabled || undefined}
        data-focus-line
        className={cx('aile-select-tetik', open && 'is-acik', error && 'is-hatali', disabled && 'is-devre-disi')}
        onClick={() => {
          if (disabled) return;
          if (open) closeList();
          else openList();
        }}
        onKeyDown={onTriggerKeyDown}
        onBlur={onTriggerBlur}
      >
        {icon && <Icon name={icon} className="aile-select-on-simge" />}
        <span className={cx('aile-select-deger', !selected && 'is-yer-tutucu')}>{selected ? selected.label : placeholder}</span>
        <Icon name="chevronDown" className="aile-select-ok" />
      </div>
      {present && !phone && (
        <PopoverLayer phase={phase} onExited={exited} triggerRef={triggerRef} containerRef={popoverRef}>
          {renderOptions(false)}
        </PopoverLayer>
      )}
      {error ? (
        <p id={noteId} className="aile-select-hata"><Icon name="alert" /><span>Hata: {error}</span></p>
      ) : help ? (
        <p id={noteId} className="aile-select-yardim">{help}</p>
      ) : null}
      {present && phone && (
        <SheetLayer
          id={sheetId}
          title={label}
          titleId={sheetTitleId}
          phase={phase}
          onExited={exited}
          triggerRef={triggerRef}
          bodyRef={sheetBodyRef}
          focusInitial={focusInitial}
          onDismiss={closeList}
          search={search}
        >
          {renderOptions(true)}
        </SheetLayer>
      )}
    </div>
  );
}
