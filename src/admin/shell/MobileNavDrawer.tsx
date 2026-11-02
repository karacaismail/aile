import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { useProfile } from '../adaptive';
import type { MobileNavDrawerProps } from './contracts';
import { adminPages, currentAdminLink, settingsLink } from './navigation';
import { ShellIcon, type ShellIconName } from './ShellIcon';

// Tasarım: tasarim-sistemi/README.md "Kabuk" (< 1024 px: Sayfalar düğmesi modal çekmece açar; Kapat düğmesi, Escape
// kapatır, kapanınca odak Sayfalar düğmesine döner, odak çekmece içinde kalır) + Uyarlanır teslim (telefonda tam ekran
// ve 16 px örtü payı, tablette ayrinti-genislik 384; güvenli alan). Telefon temelidir: yerel HTML + ARIA APG modal
// diyalog kalıbı, antd/ui sarmalayıcısı/simge paketi yok (telefon teslim kapanışı). Çekmece kabuğun içinde çizilir
// (portal yok): --aile-* tokenları ve admin.css odak çizgisi (.aile-admin kapsamı; panel data-odak-zemin="nav" ile
// lacivert yüzeydir) doğrudan geçerlidir; arka plan (üst çubuk, main) kabukta inert olur.
//
// Davranış: açılınca odak diyaloğa (tabIndex -1) girer; Tab sınırda karşı uca sarılır (inert arka planla odak adres
// çubuğuna kaçmasın); Escape, Kapat ve örtü kapatır. Kapanış anında işlevseldir: kök inert olur, odak hemen açana döner,
// hareket (240 ms, tek eğri) yalnız görseldir ve bitince söküm olur; hareket kapalıysa (reduced-motion → süre 0) söküm
// aynı karede. Başka sayfaya giden bağlantı seçilince odak açana dönmez: kabuk rota değişiminde odağı main'e taşır.

// Simgeler üst çubukla paylaşılır: üst çubuk (WorkspaceShell) ilk boyamada çizilir, bu modül ise çekmece ilk istendiğinde
// iner; simgeler bu yüzden kendi modülündedir ve buradan da aynen dışa verilir.
export { ShellIcon, type ShellIconName } from './ShellIcon';

/** Gezinme öğesi: href yoksa öğe kullanılamaz (aria-disabled) ve nedeni yanında yazılır. */
export interface ShellNavItem {
  path: string;
  label: string;
  href?: string;
  icon?: ShellIconName;
  /** Yeni sekmede açılır: target=_blank, rel=noopener noreferrer, görsel gizli "(yeni sekmede açılır)". */
  external?: boolean;
}

export interface ShellNavListProps {
  items: readonly ShellNavItem[];
  /** Geçerli hash yolu; en uzun eşleşen sayfa aria-current="page" alır (iç içe yollar dahil). */
  location: string;
  /** Liste adı (ör. "Yardımcı"); çevreleyen <nav aria-label> varsa gerekmez. */
  label?: string;
  onSelect?(item: ShellNavItem, event: MouseEvent<HTMLAnchorElement>): void;
  className?: string;
}

/**
 * Yerel bağlantı listesi (çekmece ve masaüstü yan gezinmesi ortak): APG gezinme = bağlantı listesi, menü rolü yok.
 * Bağlantı satırı doldurur ve satır odak taşıyıcısıdır (data-focus-line="row", admin.css): çizgi bağlantının kendi alt
 * kenarında; seçili sayfada secili yüzeyin üzerinde odak, diğerlerinde lacivertin üzerinde odak-nav (WCAG 1.4.11 ≥ 3:1).
 */
export function ShellNavList({ items, location, label, onSelect, className }: ShellNavListProps) {
  const current = currentAdminLink(location).path;
  return (
    <ul className={className ? `aile-shell-links ${className}` : 'aile-shell-links'} aria-label={label}>
      {items.map(item => {
        const content = (
          <>
            {item.icon && <ShellIcon name={item.icon} />}
            <span className="aile-shell-link__ad">{item.label}</span>
            {item.external && <span className="aile-shell-sr"> (yeni sekmede açılır)</span>}
            {item.external && <ShellIcon name="external" />}
          </>
        );
        return (
          <li key={item.path}>
            {item.href ? (
              <a
                className="aile-shell-link"
                href={item.href}
                data-focus-line="row"
                aria-current={!item.external && item.path === current ? 'page' : undefined}
                target={item.external ? '_blank' : undefined}
                rel={item.external ? 'noopener noreferrer' : undefined}
                onClick={onSelect ? event => onSelect(item, event) : undefined}
              >
                {content}
              </a>
            ) : (
              <span className="aile-shell-link" aria-disabled="true">{content}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Değiştirici tuşlu ya da birincil olmayan tıklama: tarayıcı yeni sekme/pencere açar, bu sekmede gezinme olmaz. */
export function isPlainClick(event: MouseEvent<HTMLElement>): boolean {
  return !event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

const ROOT_CLASS = 'aile-mobile-nav';
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const pageItems: readonly ShellNavItem[] = adminPages.map(item => ({ path: item.path, label: item.label, href: `#${item.path}` }));
const helperItems: readonly ShellNavItem[] = [
  { path: settingsLink.path, label: settingsLink.label, href: `#${settingsLink.path}`, icon: 'settings' },
];

function focusables(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE))
    .filter(element => element.tabIndex >= 0 && !element.closest('[hidden], [inert], [aria-hidden="true"]'));
}

/** Odak kapanıştan sonra çekmecede mi ya da hiçbir yerde mi (body / sökülmüş öğe)? */
function focusLeftBehind(root: HTMLElement | null): boolean {
  const active = document.activeElement;
  if (!active || active === document.body || active === document.documentElement || !active.isConnected) return true;
  return !!root && root.contains(active);
}

/** Panelin hesaplanmış geçiş süresi (ms, ilk değer + gecikme). Hareket kapalıysa ya da ölçülemezse 0. */
function transitionMs(element: HTMLElement): number {
  const style = getComputedStyle(element);
  const first = (value: string | undefined) => {
    const raw = (value ?? '').split(',')[0]?.trim() ?? '';
    const number = Number.parseFloat(raw);
    if (!Number.isFinite(number)) return 0;
    return raw.endsWith('ms') ? number : number * 1000;
  };
  return Math.max(0, first(style.transitionDuration)) + Math.max(0, first(style.transitionDelay));
}

export interface MobileNavDrawerExtraProps {
  /** Diyalog kimliği (açan düğmenin aria-controls'u). */
  id?: string;
  /** Bağlantı seçildi (gezinme başlıyor); kabuk yeni sayfanın başına kaydırmak için kullanır. */
  onNavigate?(path: string): void;
}

export function MobileNavDrawer({
  open, onClose, location, returnFocusTo, id = 'aile-sayfalar', onNavigate,
}: MobileNavDrawerProps & MobileNavDrawerExtraProps) {
  const profile = useProfile();
  const root = useRef<HTMLDivElement | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);
  const close = useRef(onClose);
  useLayoutEffect(() => { close.current = onClose; });

  // Bağlı mı (kapanış hareketi bitene dek kalır) ve açık görünümde mi (hareketin hedef durumu).
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  if (open && !mounted) setMounted(true);
  if (!open && shown) setShown(false);

  // Açılış: önce kapalı durum çizilir ve stil hesaplatılır, sonra açık duruma geçilir (geçiş iki uçlu çalışır).
  useLayoutEffect(() => {
    if (!open || !mounted || shown) return;
    panel.current?.getBoundingClientRect();
    setShown(true);
  }, [open, mounted, shown]);

  // Açılan (dönüş hedefi), açıldığı konum ve gezinme bayrağı; açılınca odak diyaloğa girer.
  const opener = useRef<HTMLElement | null>(null);
  const openedAt = useRef(location);
  const navigating = useRef(false);
  const wasOpen = useRef(false);
  useLayoutEffect(() => {
    if (open) {
      if (wasOpen.current || !mounted) return;
      wasOpen.current = true;
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      openedAt.current = location;
      navigating.current = false;
      panel.current?.focus({ preventScroll: true });
      return;
    }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    // Başka sayfaya gidiliyor ya da rota değişti: odak kabuğun main'ine gider, açana dönmez.
    const leaving = navigating.current || location !== openedAt.current;
    navigating.current = false;
    if (leaving || !focusLeftBehind(root.current)) return;
    const target = returnFocusTo?.current ?? opener.current;
    if (target?.isConnected) target.focus({ preventScroll: true });
  }, [open, mounted, location, returnFocusTo]);

  // Kapanış hareketi bitince söküm; süre 0 ise (reduced-motion, ölçülemeyen ortam) aynı karede.
  useLayoutEffect(() => {
    if (open || !mounted) return;
    const node = panel.current;
    const duration = node ? transitionMs(node) : 0;
    if (!node || duration <= 0) {
      setMounted(false);
      return;
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      setMounted(false);
    };
    const onEnd = (event: TransitionEvent) => {
      if (event.target === node && event.propertyName === 'transform') finish();
    };
    node.addEventListener('transitionend', onEnd);
    node.addEventListener('transitioncancel', onEnd);
    const timer = window.setTimeout(finish, duration + 100);
    return () => {
      node.removeEventListener('transitionend', onEnd);
      node.removeEventListener('transitioncancel', onEnd);
      window.clearTimeout(timer);
    };
  }, [open, mounted]);

  // Açıkken: Escape kapatır; Tab sınırda sarılır (inert arka plan varken odak belgeden çıkmasın).
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        close.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const dialog = panel.current;
      if (!dialog) return;
      const stops = focusables(dialog);
      if (stops.length === 0) return;
      const first = stops[0];
      const last = stops[stops.length - 1];
      const active = document.activeElement;
      const inside = active instanceof HTMLElement && dialog.contains(active);
      const atStart = !inside || active === dialog || active === first;
      if (event.shiftKey ? atStart : (!inside || active === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  // Arka plan kaydırması kilitli (yalnız açıkken; kapanış başlayınca serbest).
  useEffect(() => {
    if (!open) return;
    const html = document.documentElement;
    html.setAttribute('data-shell-kilit', '');
    return () => html.removeAttribute('data-shell-kilit');
  }, [open]);

  if (!mounted) return null;

  const select = (item: ShellNavItem, event: MouseEvent<HTMLAnchorElement>) => {
    if (!isPlainClick(event)) return;
    if (item.path !== location) navigating.current = true;
    onNavigate?.(item.path);
    close.current();
  };

  const titleId = `${id}-baslik`;
  return (
    <div
      ref={root}
      className={ROOT_CLASS}
      data-state={shown ? 'acik' : 'kapali'}
      data-size={profile === 'phone' ? 'tam' : 'ayrinti'}
      data-shell-region="nav"
      inert={!open}
    >
      <div className="aile-mobile-nav__ortu" data-shell-ortu="" aria-hidden="true" onClick={() => close.current()} />
      <div
        ref={panel}
        id={id}
        className="aile-mobile-nav__panel"
        data-odak-zemin="nav"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="aile-mobile-nav__baslik">
          <h2 id={titleId} className="aile-mobile-nav__ad">Sayfalar</h2>
          <button type="button" className="aile-shell-btn aile-shell-btn--sessiz" data-focus-line="" onClick={() => close.current()}>
            <ShellIcon name="close" />
            <span>Kapat</span>
          </button>
        </div>
        <nav className="aile-mobile-nav__govde" aria-label="Sayfalar">
          <ShellNavList items={pageItems} location={location} onSelect={select} />
          <ShellNavList items={helperItems} location={location} onSelect={select} className="aile-shell-links--alt" />
        </nav>
      </div>
    </div>
  );
}
