import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type RefObject } from 'react';
import { lazyWide, useProfile, useWideModule } from '../adaptive';
import type { WorkspaceShellProps } from './contracts';
import { MobileNavDrawer, ShellIcon } from './MobileNavDrawer';
import { currentAdminLink } from './navigation';
import './shell.css';

// Tasarım: tasarim-sistemi/README.md › Kabuk + Uyarlanır teslim, components/AppShell/README.md; W0 uyarlamalı teslim.
// Telefon temeli (bu dosya + MobileNavDrawer): yerel HTML, antd/ui sarmalayıcısı/simge paketi yok. 56 px yapışkan üst
// çubuk "aile · {sayfa} · [Sayfalar]" + güvenli alan, Sayfalar alt sayfası, "İçeriğe geç", tek main#admin-content
// (tabIndex -1), document.title "{sayfa} · aile". Tablet aynı kabuğu kullanır (README tablosu); sayfa kenarı her profilde
// b04 yoğunluk tokenından (--aile-yogunluk-kenar + güvenli alan, shell.css).
// Masaüstü (≥1024): 272 px lacivert yan gezinme shell/wide/WorkspaceNav.wide.tsx'te, lazyWide ile; telefon onu hiç
// indirmez, tablet olası masaüstü geçişi için önceden yükler. Yüklenirken ya da yüklenemezse telefon üst çubuğu ve
// alt sayfası kullanılabilir kalır (hata bildirimi loader'dan). İçerik en çok 1480, ortalı.
//
// Profil değişimi: main ve içerik yeniden bağlanmaz (gezinme yuvaları main'den önce, sabit sırada; main hep aynı
// konumda). Gezinmedeki odak karşılığına taşınır (Sayfalar ↔ yan gezinmede geçerli sayfa); kaydırma, son kaydırmada
// görünür alanın üstündeki içerik öğesine (çapa) göre geri kurulur. Rota değişince alt sayfa kapanır; sayfa değiştiyse
// ya da odak kaybolduysa odak main'e geçer; gezinmeden seçilen yeni sayfa başından açılır.

const MAIN_ID = 'admin-content';
const DRAWER_ID = 'aile-sayfalar';
const NAV_REGION = '[data-shell-region="nav"]';

/** Masaüstü yan gezinmesi (geniş-özel). */
const WideNav = lazyWide('shell-nav', () => import('./wide/WorkspaceNav.wide'));

/** Odak kayboldu mu: belge/gövde, sökülmüş öğe ya da inert alt ağaç (kapanan alt sayfa, inert arka plan). */
function focusLost(): boolean {
  const active = document.activeElement;
  return !active || active === document.body || active === document.documentElement || !active.isConnected || !!active.closest('[inert]');
}

interface TopBarProps {
  label: string;
  open: boolean;
  inert: boolean;
  onOpen(): void;
  buttonRef: RefObject<HTMLButtonElement | null>;
  barRef: RefObject<HTMLElement | null>;
}

function TopBar({ label, open, inert, onOpen, buttonRef, barRef }: TopBarProps) {
  return (
    <header ref={barRef} className="aile-admin-topbar" data-shell-region="nav" data-odak-zemin="nav" inert={inert}>
      <p className="aile-admin-topbar-title">
        <span className="aile-admin-brand">aile</span>
        <span className="aile-admin-topbar-sep" aria-hidden="true">·</span>
        <span className="aile-admin-topbar-page">{label}</span>
      </p>
      <button
        ref={buttonRef}
        type="button"
        className="aile-shell-btn"
        data-focus-line=""
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? DRAWER_ID : undefined}
        onClick={onOpen}
      >
        <ShellIcon name="menu" />
        <span>Sayfalar</span>
      </button>
    </header>
  );
}

/** Kökte üst çubuğun ölçülen yüksekliği; shell.css bunu belge kaydırma payı (scroll-padding-top) yapar. */
const TOPBAR_HEIGHT_VAR = '--aile-shell-ust-olcu';

/**
 * Odak üst çubuğun altında kalmaz (WCAG 2.4.11): çubuğun gerçek yüksekliği (sarılan sayfa adı, güvenli alan, kaba
 * işaretçi payı dahil; sabit 56 değil) kökte --aile-shell-ust-olcu olarak tutulur; tarayıcı odağa ya da çapaya
 * kaydırırken bu payı bırakır. Yükseklik değişince (ad, güvenli alan, yön) ResizeObserver günceller; çubuk yokken
 * (masaüstü yan gezinme) değişken kalkar. ResizeObserver yoksa ilk ölçüm kalır.
 */
function useTopBarScrollPadding(bar: RefObject<HTMLElement | null>, shown: boolean) {
  useLayoutEffect(() => {
    const element = bar.current;
    if (!shown || !element) return undefined;
    const root = document.documentElement;
    const write = () => root.style.setProperty(TOPBAR_HEIGHT_VAR, `${Math.ceil(element.getBoundingClientRect().height)}px`);
    write();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(write) : null;
    observer?.observe(element, { box: 'border-box' });
    return () => {
      observer?.disconnect();
      root.style.removeProperty(TOPBAR_HEIGHT_VAR);
    };
  }, [bar, shown]);
}

type Anchor = readonly (readonly [Element, number])[];

/** Görünür alanın üstündeki içerik öğesi ve ataları (main dahil), viewport'a göre üst konumlarıyla. */
function readAnchor(root: HTMLElement | null, shell: HTMLElement | null): Anchor | null {
  if (!root || window.scrollY <= 0) return null;
  const box = root.getBoundingClientRect();
  const bar = shell?.querySelector('.aile-admin-topbar');
  const top = Math.max(box.top, bar ? bar.getBoundingClientRect().bottom : 0, 0) + 1;
  const x = Math.min(Math.max(box.left + box.width / 2, 0), window.innerWidth - 1);
  let node = document.elementFromPoint(x, top);
  if (!node || !root.contains(node)) node = root;
  const chain: (readonly [Element, number])[] = [];
  for (let element: Element | null = node; element && element !== root; element = element.parentElement) {
    chain.push([element, element.getBoundingClientRect().top]);
  }
  chain.push([root, box.top]);
  return chain;
}

/**
 * Profil/gezinme düzeni değişince kaydırmayı korur: son kaydırmada kaydedilen çapanın (hâlâ bağlı ilk öğe) ekrandaki
 * konumu geri kurulur. Böylece hem yeniden boyutlanan içerik hem de üst çubuk ↔ yan gezinme değişimi telafi edilir.
 */
function useScrollAnchor(main: RefObject<HTMLElement | null>, shell: RefObject<HTMLElement | null>, layout: string) {
  const anchor = useRef<Anchor | null>(null);
  useEffect(() => {
    if (typeof document.elementFromPoint !== 'function') return;
    let frame = 0;
    const record = () => {
      frame = 0;
      anchor.current = readAnchor(main.current, shell.current);
    };
    const onScroll = () => { if (!frame) frame = window.requestAnimationFrame(record); };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [main, shell]);

  const previous = useRef(layout);
  useLayoutEffect(() => {
    if (previous.current === layout) return;
    previous.current = layout;
    const saved = anchor.current;
    const root = main.current;
    if (!saved || !root) return;
    const entry = saved.find(([node]) => node.isConnected && root.contains(node));
    if (!entry) return;
    const delta = entry[0].getBoundingClientRect().top - entry[1];
    if (Math.abs(delta) >= 1) window.scrollBy(0, delta);
  }, [layout, main]);
}

export function WorkspaceShell({ location, children }: WorkspaceShellProps) {
  const profile = useProfile();
  const desktop = profile === 'desktop';
  const wide = useWideModule(WideNav.resource, desktop);
  const side = desktop && wide.status === 'ready';
  const current = currentAdminLink(location);
  const shell = useRef<HTMLDivElement | null>(null);
  const main = useRef<HTMLElement | null>(null);
  const pagesButton = useRef<HTMLButtonElement | null>(null);
  const topBar = useRef<HTMLElement | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const drawerOpen = navOpen && !side;
  const layout = `${profile}:${side ? 'yan' : 'ust'}`;

  useEffect(() => { document.title = `${current.label} · aile`; }, [current.label]);

  // Tablet → masaüstü (ör. yatay tablet) geçişi beklemesin; telefon asla yüklemez.
  useEffect(() => {
    if (profile === 'tablet') WideNav.preload().catch(() => {});
  }, [profile]);

  // Yan gezinme gelince açık alt sayfa kapanır (telefona dönünce kendiliğinden yeniden açılmaz).
  useEffect(() => { if (side) setNavOpen(false); }, [side]);

  // Son odak gezinme bölgesinde miydi (üst çubuk, alt sayfa, yan gezinme)? Profil değişiminde karşılığa taşımak için.
  const navFocused = useRef(false);
  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      navFocused.current = event.target instanceof Element && !!event.target.closest(NAV_REGION);
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, []);

  const previousLayout = useRef(layout);
  useLayoutEffect(() => {
    if (previousLayout.current === layout) return;
    previousLayout.current = layout;
    if (!navFocused.current || !focusLost()) return;
    const aside = shell.current?.querySelector('aside');
    const target = side
      ? aside?.querySelector<HTMLElement>('a[aria-current="page"]') ?? aside?.querySelector<HTMLElement>('a[href]')
      : pagesButton.current;
    target?.focus({ preventScroll: true });
  }, [layout, side]);

  useScrollAnchor(main, shell, layout);
  useTopBarScrollPadding(topBar, !side);

  // Rota değişimi: alt sayfa kapanır; sayfa değiştiyse ya da odak kaybolduysa odak main'e (alt sayfa kapandıktan,
  // arka plan inert'ten çıktıktan sonra). Gezinmeden seçilen yeni sayfa başından açılır.
  const previousLocation = useRef(location);
  const focusMain = useRef(false);
  const fromNav = useRef(false);
  useLayoutEffect(() => {
    if (previousLocation.current === location) return;
    const pageChanged = currentAdminLink(previousLocation.current).path !== currentAdminLink(location).path;
    previousLocation.current = location;
    if (fromNav.current && pageChanged && window.scrollY > 0) window.scrollTo(0, 0);
    fromNav.current = false;
    focusMain.current = pageChanged || focusLost();
    setNavOpen(false);
  }, [location]);
  useLayoutEffect(() => {
    if (!focusMain.current || drawerOpen) return;
    focusMain.current = false;
    main.current?.focus({ preventScroll: true });
  }, [location, drawerOpen]);

  const markNavigation = useCallback(() => { fromNav.current = true; }, []);
  const openNav = useCallback(() => setNavOpen(true), []);
  const closeNav = useCallback(() => setNavOpen(false), []);

  // Skip link: hash yönlendirme "#admin-content"i rota sayardı; bağlantı yalnız odağı taşır.
  const skipToContent = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    main.current?.focus();
  };

  return (
    <div ref={shell} className="aile-admin-shell" data-device={profile} data-gezinme={side ? 'yan' : 'ust'}>
      <a className="aile-admin-skip" href={`#${MAIN_ID}`} onClick={skipToContent} inert={drawerOpen}>İçeriğe geç</a>
      {!side && <TopBar label={current.label} open={drawerOpen} inert={drawerOpen} onOpen={openNav} buttonRef={pagesButton} barRef={topBar} />}
      {desktop && <WideNav location={location} onNavigate={markNavigation} />}
      <main ref={main} id={MAIN_ID} tabIndex={-1} className="aile-admin-main" inert={drawerOpen}>
        <div className="aile-admin-main-inner">{children}</div>
      </main>
      <MobileNavDrawer
        id={DRAWER_ID}
        open={drawerOpen}
        onClose={closeNav}
        location={location}
        returnFocusTo={pagesButton}
        onNavigate={markNavigation}
      />
    </div>
  );
}
