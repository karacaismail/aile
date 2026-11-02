import {
  useEffect, useId, useLayoutEffect, useRef, useState,
  type FocusEvent, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode, type RefObject,
} from 'react';
import { useProfile } from '../device';
import { BottomSheet } from './BottomSheet';
import { Button } from './Button';
import { Icon, type IconName } from './icons';
import './Menu.css';

// Tasarım: components/Menu/README.md + index.d.ts MenuProps/MenuItem; davranış bundle.js Menu (href → <a>, external →
// target=_blank + rel=noopener + gizli "yeni sekmede açılır", seçili → aria-current="page", devre dışı tıklamaz).
// Yerel uygulama (antd yok); tek kod bütün profillere hizmet eder, geniş-özel dosya yoktur. İki kullanım:
//  1. Liste (varsayılan): dikey gezinme ya da eylem listesi. WAI-ARIA APG "Menu": role="menu", tek sekme durağı
//     (roving tabindex: seçili, yoksa ilk etkin öğe), oklar sarmalı dolaşır, Home/End uçlara, yazılan harf (tr-TR)
//     o harfle başlayan sonraki öğeye gider; Enter/Space seçer. Devre dışı öğe ve ayırıcı atlanır.
//  2. Menü düğmesi (`trigger` verilince): APG "Menu Button". Düğme aria-haspopup + aria-expanded; tıklama, Enter, Space
//     ve ArrowDown ilk öğeye, ArrowUp son öğeye odakla açar; Escape kapatır ve odağı düğmeye döndürür; Tab kapatır ve
//     odağı doğal sıraya bırakır; seçim kapatır, odağı düğmeye döndürür, sonra onSelect çağırır. Telefon profilinde liste
//     alttan açılan sayfadır (BottomSheet, aria-haspopup="dialog"); tablet ve masaüstünde düğmenin altında açılır panel
//     (Popover API varsa üst katman: taşma kırpmaz; konum görünüm alanına sığdırılır, sığmazsa yukarı açılır).
// Seçili durum vurgu kenarıyla değil yüzey tonu (secili) + 600 ağırlıkla; odak seçimden ayrıdır. Tehlikeli öğeler
// (danger) listenin sonunda ayırıcıdan sonra kendi grubundadır. Dokunma: Pointer Events ile basılı yüzey (data-pressed);
// pointercancel (kaydırma) basılı durumu siler, seçim yapılmaz. Görsel kurallar Menu.css (yalnız --aile tokenları).

export interface MenuItem {
  key: string;
  /** Cümle düzeni ("Alım ekle"); kesilmez, gerekirse sarılır. */
  label: string;
  /** Etiketin önünde Phosphor simgesi (20 px, süsleyici). */
  icon?: IconName;
  /** Etiketin ardında simge; `external` verilince varsayılan "external". */
  iconEnd?: IconName;
  /** Sayım (tr-TR, tabular-nums). Verilmezse gösterilmez. */
  count?: number;
  /** Verilirse öğe bağlantıdır (hash yol: "#/alimlar" ya da tam URL). */
  href?: string;
  /** Yeni sekmede açılır: target=_blank, rel=noopener, dış simge ve görsel gizli "yeni sekmede açılır" notu. */
  external?: boolean;
  /** Devre dışı: aria-disabled, href düşer, onSelect çağrılmaz, oklarla atlanır. */
  disabled?: boolean;
  /** Yalnız ayırıcı (cizgi); diğer alanlar yok sayılır. */
  divider?: boolean;
  /** Tehlikeli eylem (Sil): listenin sonunda, ayırıcıdan sonra "Tehlikeli eylemler" grubunda, hata renginde. */
  danger?: boolean;
}

export interface MenuProps {
  items: readonly MenuItem[];
  /** Seçili öğe: secili yüzey + 600 ağırlık + aria-current="page". Seçim odaktan ayrıdır. */
  selectedKey?: string;
  /** Tıklama, Enter ya da Space ile; devre dışı öğede çağrılmaz. Bağlantılı öğede tarayıcı gezinmesi de olur. */
  onSelect?(key: string): void;
  /** "nav": lacivert panel (nav-metin, nav-hover, odak çizgisi odak-nav). Varsayılan açık yüzey. */
  variant?: 'nav';
  /** Menünün erişilebilir adı; çevreleyen <nav aria-label> varsa gerekmez. Menü düğmesinde alt sayfa başlığıdır
   *  (varsayılan `trigger`). */
  label?: string;
  /** Listede <ul>'a, menü düğmesinde sarmalayıcıya eklenir. */
  className?: string;
  /** Verilirse menü düğmesi kalıbı: bu metinli düğme menüyü açar (telefonda alt sayfa, genişte açılır panel). */
  trigger?: string;
  /** Düğme metninin önündeki simge; verilmezse metnin ardında chevronDown. */
  triggerIcon?: IconName;
  /** Düğme görünümü; varsayılan secondary. */
  triggerVariant?: 'secondary' | 'quiet';
  /** Açık başlar (önizleme); odak taşınmaz. */
  defaultOpen?: boolean;
  /** Portal/üst katman yerine yerinde çizim (önizleme ve yalıtık test). */
  inline?: boolean;
  /** Açılır panelin düğmeye hizası; varsayılan start (sol kenar), end sağ kenar. */
  align?: 'start' | 'end';
  /** Açılır panele eklenecek sınıf. */
  popupClassName?: string;
}

/** Tasarım bundle.css .ai-pop: "min-width: 240px". tokens.json'da karşılığı yok; tek kaynak bu sabittir. */
export const MENU_POPUP_MIN_WIDTH = 240;
/** Tehlikeli öğelerin grubunun erişilebilir adı. */
export const DANGER_GROUP_LABEL = 'Tehlikeli eylemler';

const NEW_TAB_NOTE = 'yeni sekmede açılır';
/** APG typeahead: bu süre içinde basılan harfler tek arama dizesi olur. */
const TYPEAHEAD_RESET_MS = 500;
/** Açılışta odağın verileceği öğeyi arayan kare sayısı (alt sayfa portalı bir kare sonra bağlanabilir). */
const FOCUS_FRAMES = 10;
const TARGET_SELECTOR = '[data-menu-target]';
const countFormat = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });
const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');
const fold = (text: string) => text.toLocaleLowerCase('tr-TR');

/** Etkin odak hedefleri (bağlantı öğesinde <a>, eylem öğesinde menuitem), DOM sırasıyla. */
function focusTargets(list: HTMLElement): HTMLElement[] {
  return Array.from(list.querySelectorAll<HTMLElement>(TARGET_SELECTOR));
}

function splitItems(items: readonly MenuItem[]) {
  const regular = items.filter(item => item.divider || !item.danger);
  const danger = items.filter(item => !item.divider && item.danger);
  if (danger.length > 0) while (regular.length > 0 && regular[regular.length - 1]!.divider) regular.pop();
  return { regular, danger };
}

const enabled = (item: MenuItem) => !item.divider && !item.disabled;

function ItemBody({ item }: { item: MenuItem }) {
  const iconEnd = item.iconEnd ?? (item.external ? 'external' : undefined);
  // Parçalar arasındaki {' '} metin düğümleri erişilebilir adı ayırır ("E-tabloyu aç (yeni sekmede açılır)",
  // "Alımlar ve eşyalar 1.250"); flex satırında yalnız boşluk olan metin çizilmez.
  return (
    <>
      {item.icon && <Icon name={item.icon} />}
      <span className="aile-menu-label">{item.label}</span>
      {item.external && <>{' '}<span className="aile-menu-sr">({NEW_TAB_NOTE})</span></>}
      {item.count !== undefined && <>{' '}<span className="aile-menu-count">{countFormat.format(item.count)}</span></>}
      {iconEnd && <Icon name={iconEnd} />}
    </>
  );
}

// Basılı yüzey Pointer Events ile: birincil düğme ya da dokunuş/kalem basınca açılır; bırakma, ayrılma ve iptal
// (dokunmada kaydırma başlayınca tarayıcı pointercancel yayar ve click üretmez) kapatır. Öznitelik DOM'a doğrudan
// yazılır; React'in yönettiği bir prop değildir, yeniden çizim gerekmez.
const press = (event: PointerEvent<HTMLElement>) => {
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  if (event.currentTarget.getAttribute('aria-disabled') === 'true') return;
  event.currentTarget.setAttribute('data-pressed', '');
};
const release = (event: PointerEvent<HTMLElement>) => { event.currentTarget.removeAttribute('data-pressed'); };

interface MenuListProps {
  items: readonly MenuItem[];
  selectedKey?: string;
  variant?: 'nav';
  label?: string;
  id?: string;
  className?: string;
  /** list: tek sekme durağı (roving tabindex). popup: hepsi -1; odağı açan taraf verir. */
  mode: 'list' | 'popup';
  onActivate(item: MenuItem): void;
  /** Ok/typeahead dışındaki tuşlar için (Escape, Tab) önce çağrılır; preventDefault ederse liste işlemez. */
  onKeyDown?(event: KeyboardEvent<HTMLUListElement>): void;
  listRef?: RefObject<HTMLUListElement | null>;
}

/**
 * Roving tabindex (liste kipi): tek sekme durağı. Öncelik: odaklı öğe → son odaklanan öğe → seçili öğe → ilk etkin öğe.
 * DOM'a doğrudan yazılır (React tüm hedefleri -1 çizer ve bu değeri bir daha değiştirmez): odak taşındığı anda, bir
 * sonraki tuş vuruşundan önce durak doğrudur; yeniden çizim beklenmez.
 */
function syncTabStop(list: HTMLElement | null, remembered: string | null, selectedKey: string | undefined) {
  if (!list) return;
  const targets = focusTargets(list);
  const active = document.activeElement;
  const stop = targets.find(target => target === active)
    ?? targets.find(target => target.getAttribute('data-key') === remembered)
    ?? targets.find(target => selectedKey !== undefined && target.getAttribute('data-key') === selectedKey)
    ?? targets[0];
  for (const target of targets) target.tabIndex = target === stop ? 0 : -1;
}

function MenuList({ items, selectedKey, variant, label, id, className, mode, onActivate, onKeyDown, listRef }: MenuListProps) {
  const { regular, danger } = splitItems(items);
  const ordered = [...regular, ...danger];
  const ownRef = useRef<HTMLUListElement | null>(null);
  const ref = listRef ?? ownRef;
  // Son odaklanan öğe sekme durağı kalır (APG roving tabindex); seçim değişince (gezinme) durak seçili öğeye döner.
  const remembered = useRef<string | null>(null);
  const lastSelected = useRef(selectedKey);
  useLayoutEffect(() => {
    if (lastSelected.current !== selectedKey) {
      lastSelected.current = selectedKey;
      remembered.current = null;
    }
    if (mode === 'list') syncTabStop(ref.current, remembered.current, selectedKey);
  });
  const search = useRef({ text: '', at: 0 });

  const byKey = (key: string | null | undefined) => ordered.find(item => item.key === key && enabled(item));

  const onFocus = (event: FocusEvent<HTMLUListElement>) => {
    const key = (event.target as HTMLElement).closest(TARGET_SELECTOR)?.getAttribute('data-key');
    if (!key) return;
    remembered.current = key;
    syncTabStop(event.currentTarget, key, selectedKey);
  };

  const typeahead = (char: string, targets: HTMLElement[], current: number) => {
    const now = Date.now();
    const state = search.current;
    state.text = now - state.at > TYPEAHEAD_RESET_MS ? char : state.text + char;
    state.at = now;
    const text = fold(state.text);
    const repeated = text.length > 1 && [...text].every(letter => letter === text[0]);
    const needle = repeated ? text[0]! : text;
    // Tek harf (ya da aynı harfin tekrarı) odaklı öğeden sonrasını arar; çok harfli dize odaklı öğeden başlar.
    const start = text.length === 1 || repeated ? current + 1 : Math.max(current, 0);
    for (let offset = 0; offset < targets.length; offset += 1) {
      const target = targets[(start + offset) % targets.length]!;
      const item = byKey(target.getAttribute('data-key'));
      if (item && fold(item.label).startsWith(needle)) return target;
    }
    return null;
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const targets = focusTargets(event.currentTarget);
    if (targets.length === 0) return;
    const active = document.activeElement;
    const current = targets.findIndex(target => target === active || target.contains(active));
    const focus = (index: number) => {
      event.preventDefault();
      targets[(index + targets.length) % targets.length]!.focus();
    };
    switch (event.key) {
      case 'ArrowDown': focus(current < 0 ? 0 : current + 1); return;
      case 'ArrowUp': focus(current < 0 ? targets.length - 1 : current - 1); return;
      case 'Home': focus(0); return;
      case 'End': focus(targets.length - 1); return;
      case 'Enter':
      case ' ': {
        const target = targets[current];
        if (!target) return;
        // Bağlantıda Enter'ı tarayıcı tıklamaya çevirir; Space'i biz çeviririz (sayfa kaymaz).
        if (target instanceof HTMLAnchorElement) {
          if (event.key === ' ') { event.preventDefault(); target.click(); }
          return;
        }
        event.preventDefault();
        const item = byKey(target.getAttribute('data-key'));
        if (item) onActivate(item);
        return;
      }
      default: {
        if (event.key.length !== 1 || event.key === ' ') return;
        const match = typeahead(event.key, targets, current);
        if (match) { event.preventDefault(); match.focus(); }
      }
    }
  };

  const renderItem = (item: MenuItem, index: number) => {
    if (item.divider) return <li key={item.key || `ayirici-${index}`} role="separator" className="aile-menu-divider" />;
    const selected = item.key === selectedKey;
    const isEnabled = enabled(item);
    const isAction = !item.href;
    // Hepsi -1 çizilir; liste kipinde tek durağı syncTabStop verir, açılır kipte odağı açan taraf verir.
    const target = isEnabled ? { 'data-menu-target': '', 'data-key': item.key, tabIndex: -1 } : {};
    const onClick = (event: MouseEvent<HTMLLIElement>) => {
      if (!isEnabled) { event.preventDefault(); return; }
      onActivate(item);
    };
    let content: ReactNode;
    if (isAction) content = <span className="aile-menu-link"><ItemBody item={item} /></span>;
    else if (item.disabled) content = <a className="aile-menu-link" aria-disabled="true"><ItemBody item={item} /></a>;
    else {
      content = (
        <a
          className="aile-menu-link"
          href={item.href}
          target={item.external ? '_blank' : undefined}
          rel={item.external ? 'noopener' : undefined}
          aria-current={selected ? 'page' : undefined}
          {...target}
        >
          <ItemBody item={item} />
        </a>
      );
    }
    return (
      <li
        key={item.key}
        role="menuitem"
        className={cx('aile-menu-item', item.danger && 'aile-menu-item--tehlike')}
        aria-current={selected ? 'page' : undefined}
        aria-disabled={item.disabled ? 'true' : undefined}
        {...(isAction ? target : {})}
        onClick={onClick}
        onPointerDown={press}
        onPointerUp={release}
        onPointerCancel={release}
        onPointerLeave={release}
      >
        {content}
      </li>
    );
  };

  return (
    <ul
      ref={ref}
      id={id}
      role="menu"
      aria-label={label}
      className={cx('aile-menu', className)}
      data-variant={variant}
      onKeyDown={handleKeyDown}
      onFocus={mode === 'list' ? onFocus : undefined}
    >
      {regular.map(renderItem)}
      {danger.length > 0 && (
        <>
          {regular.length > 0 && <li role="separator" className="aile-menu-divider" />}
          <li role="none" className="aile-menu-grup-kap">
            <ul role="group" aria-label={DANGER_GROUP_LABEL} className="aile-menu-grup">{danger.map(renderItem)}</ul>
          </li>
        </>
      )}
    </ul>
  );
}

export function Menu(props: MenuProps) {
  if (props.trigger !== undefined) return <MenuButton {...props} trigger={props.trigger} />;
  const { items, selectedKey, onSelect, variant, label, className } = props;
  return (
    <MenuList
      mode="list"
      items={items}
      selectedKey={selectedKey}
      variant={variant}
      label={label}
      className={className}
      onActivate={item => onSelect?.(item.key)}
    />
  );
}

// --- Menü düğmesi ---------------------------------------------------------------------------------------------------

type FocusIntent = 'first' | 'last' | null;

function MenuButton({
  items, selectedKey, onSelect, variant, label, className, trigger, triggerIcon, triggerVariant = 'secondary',
  defaultOpen = false, inline = false, align = 'start', popupClassName,
}: MenuProps & { trigger: string }) {
  const phone = useProfile() === 'phone';
  const name = label ?? trigger;
  const menuId = `aile-menu${useId()}`;
  const rootRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(defaultOpen);
  const intent = useRef<FocusIntent>(null);
  /** Açılır panelde Tab/Shift+Tab basıldı: odak tarayıcının sırasıyla taşındıktan sonra (blur) menü kapanır. */
  const tabbing = useRef(false);

  const show = (where: Exclude<FocusIntent, null>) => {
    intent.current = where;
    tabbing.current = false;
    setOpen(true);
  };
  const hide = (returnFocus: boolean) => {
    intent.current = null;
    tabbing.current = false;
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus({ preventScroll: true });
  };
  const activate = (item: MenuItem) => {
    hide(true);
    onSelect?.(item.key);
  };

  // Açılış odağı: panel (layout) ya da alt sayfa (portal) bağlandıktan sonra ilk/son etkin öğe. Alt sayfa içeriği bir
  // kare sonra odaklanabilir olabilir; birkaç kare denenir. Odağı alan öğe olunca BottomSheet paneli odağı çalmaz.
  useEffect(() => {
    if (!open || intent.current === null) return;
    const where = intent.current;
    let frame = 0;
    let tries = 0;
    const attempt = () => {
      const list = listRef.current;
      const targets = list ? focusTargets(list) : [];
      const target = where === 'last' ? targets[targets.length - 1] : targets[0];
      if (target) {
        target.focus({ preventScroll: true });
        if (document.activeElement === target) { intent.current = null; return; }
      }
      tries += 1;
      if (tries < FOCUS_FRAMES) frame = window.requestAnimationFrame(attempt);
    };
    attempt();
    return () => window.cancelAnimationFrame(frame);
  }, [open, phone]);

  // Açılır panelde dışarıya pointerdown (fare, dokunma, kalem) kapatır; odak kullanıcının bastığı yere gider.
  useEffect(() => {
    if (!open || phone) return;
    const onPointerDown = (event: globalThis.PointerEvent) => {
      const root = rootRef.current;
      if (root && event.target instanceof Node && !root.contains(event.target)) hide(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open, phone]);

  // Profil açıkken değişirse (ör. pencere daralır) sunum değişir; menü kapanır, odak kaybolmasın diye düğmeye döner.
  const lastPhone = useRef(phone);
  useEffect(() => {
    if (lastPhone.current === phone) return;
    lastPhone.current = phone;
    if (!open) return;
    const active = document.activeElement;
    const lost = !active || active === document.body || !active.isConnected || !!rootRef.current?.contains(active);
    hide(lost);
  }, [phone]);

  const onRootKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (event.target !== triggerRef.current) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      show(event.key === 'ArrowDown' ? 'first' : 'last');
    }
  };
  // Odak açılır paneli ve düğmeyi bırakıp başka bir öğeye geçerse menü kapanır (pencere odağı kaybı sayılmaz). Tab ile
  // ayrılışta (Shift+Tab düğmeye dönse de) odak tarayıcının doğal sırasıyla taşındıktan sonra kapanır: kapanış odaklı
  // öğeyi önceden söküp inert yapsaydı tarayıcının sıradaki öğeyi bulacağı nokta kaybolurdu.
  const onRootBlur = (event: FocusEvent<HTMLSpanElement>) => {
    if (!open || phone) return;
    const next = event.relatedTarget;
    const panel = listRef.current;
    if (tabbing.current && !(next instanceof Node && panel?.contains(next))) hide(false);
    else if (next instanceof Node && !event.currentTarget.contains(next)) hide(false);
  };
  const onPopupKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if (phone) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      hide(true);
    } else if (event.key === 'Tab') {
      tabbing.current = true;
    }
  };

  const list = (
    <MenuList
      mode="popup"
      listRef={listRef}
      id={menuId}
      items={items}
      selectedKey={selectedKey}
      variant={variant}
      label={name}
      onActivate={activate}
      onKeyDown={onPopupKeyDown}
    />
  );

  return (
    <span
      ref={rootRef}
      className={cx('aile-menu-dugme', className)}
      data-open={open ? '' : undefined}
      onKeyDown={onRootKeyDown}
      onBlur={onRootBlur}
    >
      <Button
        ref={triggerRef}
        variant={triggerVariant}
        icon={triggerIcon}
        iconEnd={triggerIcon ? undefined : 'chevronDown'}
        aria-haspopup={phone ? 'dialog' : 'menu'}
        aria-expanded={open}
        aria-controls={!phone && open ? menuId : undefined}
        onClick={() => (open ? hide(true) : show('first'))}
      >
        {trigger}
      </Button>
      {phone ? (
        <BottomSheet title={name} open={open} onClose={() => hide(true)} inline={inline} returnFocusTo={triggerRef}>
          {list}
        </BottomSheet>
      ) : (
        <MenuPopover open={open} anchorRef={triggerRef} inline={inline} align={align} variant={variant} className={popupClassName}>
          {list}
        </MenuPopover>
      )}
    </span>
  );
}

// --- Açılır panel (tablet ve masaüstü) -----------------------------------------------------------------------------

const supportsPopover = () => typeof HTMLElement !== 'undefined' && typeof HTMLElement.prototype.showPopover === 'function';

/** CSS uzunluğu (px) olarak çözülen değişken; çözülemezse 0 (jsdom). */
const cssPx = (style: CSSStyleDeclaration, name: string) => Number.parseFloat(style.getPropertyValue(name)) || 0;

/** En uzun geçiş süresi (ms); hesaplanamıyorsa 0. */
function transitionMs(element: HTMLElement): number {
  const durations = (window.getComputedStyle(element).transitionDuration || '').split(',');
  return Math.max(0, ...durations.map(value => {
    const number = Number.parseFloat(value);
    if (!Number.isFinite(number)) return 0;
    return /ms\s*$/.test(value) ? number : number * 1000;
  }));
}

/**
 * Paneli düğmeye göre sabit (fixed) koordinatlara yerleştirir: altta yer yoksa ve üstte daha çok yer varsa yukarı açılır;
 * yükseklik kalan alana sınırlanır (içerik kendi içinde kayar); yatayda görünüm alanı içinde tutulur. Boşluklar
 * tokenlardan: düğmeyle arası bosluk-3 (düğmenin odak çizgisi görünür kalır), görünüm kenarına bosluk-2.
 */
function place(panel: HTMLElement, anchor: HTMLElement | null, align: 'start' | 'end') {
  if (!anchor) return;
  const style = window.getComputedStyle(panel);
  const gap = cssPx(style, '--aile-bosluk-3');
  const margin = cssPx(style, '--aile-bosluk-2');
  const box = anchor.getBoundingClientRect();
  const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
  const viewportHeight = window.innerHeight;
  panel.style.maxHeight = '';
  const natural = panel.scrollHeight;
  const below = viewportHeight - box.bottom - gap - margin;
  const above = box.top - gap - margin;
  const up = natural > below && above > below;
  panel.style.maxHeight = `${Math.max(0, Math.floor(up ? above : below))}px`;
  const { width, height } = panel.getBoundingClientRect();
  const top = up ? box.top - gap - Math.min(height, Math.max(0, above)) : box.bottom + gap;
  const preferred = align === 'end' ? box.right - width : box.left;
  const left = Math.min(Math.max(preferred, margin), Math.max(margin, viewportWidth - margin - width));
  panel.style.top = `${Math.round(top)}px`;
  panel.style.left = `${Math.round(left)}px`;
  panel.dataset.side = up ? 'top' : 'bottom';
}

interface MenuPopoverProps {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  inline: boolean;
  align: 'start' | 'end';
  variant?: 'nav';
  className?: string;
  children: ReactNode;
}

// Hareket: açılış ve kapanış aynı 240 ms tek eğri (opacity + transform, CSS geçişi). Durum (aria-expanded, odak) anında
// değişir; kapanırken panel inert + aria-hidden olur ve geçiş bitince sökülür. Geçiş yoksa (reduced-motion, 0 s) hemen
// sökülür. Kapanış bitmeden yeniden açılırsa aynı panel kaldığı yerden geri döner.
function MenuPopover({ open, anchorRef, inline, align, variant, className, children }: MenuPopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [present, setPresent] = useState(open);
  if (open && !present) setPresent(true);
  const openRef = useRef(open);
  openRef.current = open;
  const topLayer = !inline && supportsPopover();

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    if (open) {
      panel.removeAttribute('inert');
      panel.removeAttribute('aria-hidden');
      if (topLayer && !panel.matches(':popover-open')) panel.showPopover();
      if (!inline) place(panel, anchorRef.current, align);
      if (panel.dataset.state !== 'open') {
        panel.getBoundingClientRect();
        panel.dataset.state = 'open';
      }
      return;
    }
    panel.dataset.state = 'closed';
    panel.setAttribute('inert', '');
    panel.setAttribute('aria-hidden', 'true');
    if (transitionMs(panel) === 0) setPresent(false);
  }, [open, present, inline, topLayer, align, anchorRef]);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel || open) return;
    const finish = (event: Event) => {
      if (event.target !== panel || openRef.current) return;
      if ((event as TransitionEvent).propertyName !== undefined && (event as TransitionEvent).propertyName !== 'opacity') return;
      setPresent(false);
    };
    panel.addEventListener('transitionend', finish);
    panel.addEventListener('transitioncancel', finish);
    return () => {
      panel.removeEventListener('transitionend', finish);
      panel.removeEventListener('transitioncancel', finish);
    };
  }, [open, present]);

  // Açıkken kaydırma ve yeniden boyutlandırmada konum bir karede güncellenir.
  useEffect(() => {
    if (!open || inline) return;
    let frame = 0;
    const update = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const panel = panelRef.current;
        if (panel) place(panel, anchorRef.current, align);
      });
    };
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, inline, align, anchorRef]);

  if (!present) return null;
  return (
    <div
      ref={panelRef}
      className={cx('aile-menu-panel', className)}
      popover={topLayer ? 'manual' : undefined}
      data-inline={inline ? '' : undefined}
      data-align={align}
      data-variant={variant}
      style={{ minWidth: MENU_POPUP_MIN_WIDTH }}
      // Öğeler arası boşluğa ya da devre dışı öğeye basmak odağı panelden düşürmesin (odak olduğu öğede kalır).
      onMouseDown={event => {
        if (!(event.target as Element).closest(TARGET_SELECTOR)) event.preventDefault();
      }}
    >
      {children}
    </div>
  );
}
