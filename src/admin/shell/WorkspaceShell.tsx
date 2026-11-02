import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type RefObject } from 'react';
import { lazyWide, useProfile, useWideLoading, useWideModule } from '../adaptive';
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

/** Tutma, geniş yükleme bittikten sonra bu kadar ardışık karede boyut bildirimi gelmezse biter. */
const SETTLE_FRAMES = 2;

/**
 * Profil/gezinme düzeni değişince kaydırmayı korur: son kaydırmada kaydedilen çapanın (hâlâ bağlı ilk öğe) ekrandaki
 * konumu geri kurulur. Böylece hem yeniden boyutlanan içerik hem de üst çubuk ↔ yan gezinme değişimi telafi edilir.
 *
 * Geniş adalar kabuktan bağımsız ve sonra yerleşebilir (ör. Alımlar masaüstü yerleşimi yan gezinmeden ~26 ms sonra
 * gelip içeriğin yüksekliğini değiştirir); kabuk yerleşim anahtarı o an değişmez. WebKit/Safari'de yerel kaydırma çapası
 * (overflow-anchor) olmadığından içerik kayardı. Bu yüzden düzen değişiminden sonra çapa TUTULUR: geniş yükleme
 * (useWideLoading, kökteki data-wide-loading ile aynı sinyal) sürdükçe ve main'in boyutu değiştikçe (ResizeObserver,
 * yerleşimden sonra, boyamadan önce) çapa yeniden kurulur. Yükleme bitip boyut bildirimi SETTLE_FRAMES kare susunca
 * ya da rota değişince tutma biter. Tutma sırasında kabuğun kendi düzeltmesi çapayı değiştirmez; kullanıcının (ya da
 * tarayıcının) kaydırması ise yeni çapa olur: kullanıcıyla yarışılmaz.
 */
function useScrollAnchor(main: RefObject<HTMLElement | null>, shell: RefObject<HTMLElement | null>, layout: string, location: string) {
  const anchor = useRef<Anchor | null>(null);
  /** Tutma etkinken: çapayı yeniden kurar; null = tutma yok. */
  const hold = useRef<{ restore(): void; stop(): void } | null>(null);
  /** Kabuğun son düzeltmesinden sonraki kaydırma konumu (kendi kaydırma olayını kullanıcınınkinden ayırmak için). */
  const ownScrollY = useRef<number | null>(null);
  const wideLoading = useWideLoading();
  const loadingRef = useRef(wideLoading);
  loadingRef.current = wideLoading;

  useEffect(() => {
    if (typeof document.elementFromPoint !== 'function') return;
    let frame = 0;
    const record = () => {
      frame = 0;
      if (hold.current && ownScrollY.current !== null && Math.abs(window.scrollY - ownScrollY.current) < 1) return;
      anchor.current = readAnchor(main.current, shell.current);
    };
    const onScroll = () => { if (!frame) frame = window.requestAnimationFrame(record); };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [main, shell]);

  const restore = useCallback(() => {
    const saved = anchor.current;
    const root = main.current;
    if (!saved || !root) return;
    const entry = saved.find(([node]) => node.isConnected && root.contains(node));
    if (!entry) return;
    const delta = entry[0].getBoundingClientRect().top - entry[1];
    if (Math.abs(delta) < 1) return;
    window.scrollBy(0, delta);
    ownScrollY.current = window.scrollY;
  }, [main]);

  const startHold = useCallback(() => {
    if (hold.current) return;
    const root = main.current;
    if (!root || typeof window.requestAnimationFrame !== 'function') return;
    let quiet = 0;
    let frame = 0;
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { quiet = 0; restore(); }) : null;
    observer?.observe(root);
    if (root.firstElementChild) observer?.observe(root.firstElementChild);
    const stop = () => {
      observer?.disconnect();
      window.cancelAnimationFrame(frame);
      hold.current = null;
      ownScrollY.current = null;
    };
    const tick = () => {
      quiet = loadingRef.current ? 0 : quiet + 1;
      if (quiet > SETTLE_FRAMES) stop();
      else frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    hold.current = { restore, stop };
  }, [main, restore]);

  const previous = useRef(layout);
  useLayoutEffect(() => {
    if (previous.current === layout) return;
    previous.current = layout;
    if (!anchor.current || !main.current) return;
    restore();
    startHold();
  }, [layout, main, restore, startHold]);

  // Geniş ada yerleşti (yükleme sinyali aynı çizimde düşer): içerik değişimi boyamadan önce telafi edilir.
  useLayoutEffect(() => { hold.current?.restore(); }, [wideLoading]);

  // Rota değişince (yeni sayfa başından açılır) ve sökülürken tutma biter.
  const previousLocation = useRef(location);
  useLayoutEffect(() => {
    if (previousLocation.current === location) return;
    previousLocation.current = location;
    hold.current?.stop();
  }, [location]);
  useEffect(() => () => hold.current?.stop(), []);
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

  useScrollAnchor(main, shell, layout, location);
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
