import {
  useEffect, useLayoutEffect, useRef, useState,
  type FocusEvent, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode, type RefObject,
} from 'react';
import { BottomSheet } from './BottomSheet';
import { Icon } from './icons';
import {
  DANGER_GROUP_LABEL, MENU_POPUP_MIN_WIDTH, TARGET_SELECTOR, focusTargets, type MenuItem, type MenuPanelProps,
} from './Menu.shared';
import './Menu.css';

// Menu'nün gövdesi: liste (WAI-ARIA APG "Menu"), açılır panel (tablet ve masaüstü) ve telefondaki alt sayfa sarmalı.
// Sözleşme ve tasarım kaynakları Menu.tsx başlığındadır. Bu modül menü düğmesinin (Menu.lazy.tsx) ilk niyette indirdiği
// tembel parçadır: telefon ilk rotası onu, BottomSheet'i ve kipli katmanı istemez (src/admin/phoneEntry.test.ts). Liste
// kipindeki Menu ve eşzamanlı menü düğmesi (Menu.tsx) aynı kodu statik alır.

const NEW_TAB_NOTE = 'yeni sekmede açılır';
/** APG typeahead: bu süre içinde basılan harfler tek arama dizesi olur. */
const TYPEAHEAD_RESET_MS = 500;
const countFormat = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });
const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');
const fold = (text: string) => text.toLocaleLowerCase('tr-TR');

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

export interface MenuListProps {
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

export function MenuList({ items, selectedKey, variant, label, id, className, mode, onActivate, onKeyDown, listRef }: MenuListProps) {
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
    // menuitem öğenin kendisidir: zemin, köşe, basılı/seçili yüzey, aria-current, odak ve sekme durağı onda durur.
    // Hepsi -1 çizilir; liste kipinde tek durağı syncTabStop verir, açılır kipte odağı açan taraf verir.
    const shared = {
      role: 'menuitem',
      className: cx('aile-menu-item', item.danger && 'aile-menu-item--tehlike'),
      'aria-current': selected ? ('page' as const) : undefined,
      'aria-disabled': item.disabled ? ('true' as const) : undefined,
      ...(isEnabled ? { 'data-menu-target': '', 'data-key': item.key, tabIndex: -1 } : {}),
      onClick: (event: MouseEvent<HTMLElement>) => {
        if (!isEnabled) { event.preventDefault(); return; }
        onActivate(item);
      },
      onPointerDown: press,
      onPointerUp: release,
      onPointerCancel: release,
      onPointerLeave: release,
    };
    const body = <span className="aile-menu-link"><ItemBody item={item} /></span>;
    // Eylem öğesi: <li role="menuitem">. Bağlantı öğesi (APG Menu, bağlantılı öğe): <li role="none"><a role="menuitem">;
    // devre dışı bağlantı href'siz kalır (gezinmez, odaklanmaz).
    if (!item.href) return <li key={item.key} {...shared}>{body}</li>;
    return (
      <li key={item.key} role="none" className="aile-menu-satir">
        <a
          {...shared}
          href={isEnabled ? item.href : undefined}
          target={isEnabled && item.external ? '_blank' : undefined}
          rel={isEnabled && item.external ? 'noopener' : undefined}
        >
          {body}
        </a>
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

// --- Menü düğmesinin gövdesi --------------------------------------------------------------------------------------

/**
 * Telefonda liste alttan açılan sayfadadır (BottomSheet: modal diyalog; menü orada tek sekme durağıdır, Tab Kapat ile
 * menü arasında döner); tablet ve masaüstünde düğmenin altında açılır panel (öğeler sekme sırasında değildir, Tab menüyü
 * kapatır). Durum ve odak niyeti düğmededir (Menu.lazy.tsx); gövde yalnız çizer.
 */
export function MenuPanel({
  phone, open, name, menuId, listRef, anchorRef, items, selectedKey, variant, inline, align, popupClassName, onActivate,
  onKeyDown, onClose,
}: MenuPanelProps) {
  const list = (
    <MenuList
      mode={phone ? 'list' : 'popup'}
      listRef={listRef}
      id={menuId}
      items={items}
      selectedKey={selectedKey}
      variant={variant}
      label={name}
      onActivate={onActivate}
      onKeyDown={onKeyDown}
    />
  );
  return phone ? (
    <BottomSheet title={name} open={open} onClose={onClose} inline={inline} returnFocusTo={anchorRef}>
      {list}
    </BottomSheet>
  ) : (
    <MenuPopover open={open} anchorRef={anchorRef} inline={inline} align={align} variant={variant} className={popupClassName}>
      {list}
    </MenuPopover>
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
