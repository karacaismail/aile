import { useEffect, useId, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { useFocusTrap, useMediaQuery, useMergedRef } from '@mantine/hooks';
import { sheetUrl } from '../../dashboard/data';
import { currentDirectoryLink, directoryGroups, familySection, settingsLink } from './navigation';

/** Global page navigation; view switches and filters belong to the page itself. */
export function FamilyFrame({ location, children }: { location: string; children: ReactNode }) {
  const desktop = useMediaQuery('(min-width: 64em)', undefined, { getInitialValueInEffect: false });
  const section = familySection(location);
  const [expandedAt, setExpandedAt] = useState<string | null>(null);
  const [initialFocus, setInitialFocus] = useState('close');
  const expanded = expandedAt === location;
  const mobileExpanded = !desktop && expanded;
  const visible = desktop || mobileExpanded;
  const sidebarId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const returnFocus = useRef(false);
  const navigationFocus = useRef<string | null>(null);
  const trapRef = useFocusTrap(mobileExpanded);
  const mergedRef = useMergedRef(sidebarRef, trapRef);
  const previousDesktop = useRef(desktop);
  const current = currentDirectoryLink(location);

  useEffect(() => { setExpandedAt(null); }, [location]);
  // The document title names the current page first, then the service (WCAG 2.4.2 for single-page views).
  useEffect(() => { document.title = `${current.label} · aile`; }, [current.label]);
  useLayoutEffect(() => {
    const wasDesktop = previousDesktop.current;
    previousDesktop.current = desktop;
    if (wasDesktop === desktop) return;
    const active = document.activeElement;
    if (!desktop && navigationFocus.current) {
      setInitialFocus(navigationFocus.current);
      setExpandedAt(location);
    } else if (desktop) {
      setExpandedAt(null);
      // The hidden mobile close button can lose native focus before this layout effect.
      if (active === closeRef.current || navigationFocus.current === 'close' || (expanded && initialFocus === 'close')) {
        sidebarRef.current?.querySelector<HTMLElement>('[aria-current="page"]')?.focus({ preventScroll: true });
      }
    }
  }, [desktop, location, expanded, initialFocus]);
  useLayoutEffect(() => {
    if (mobileExpanded && initialFocus === 'close') closeRef.current?.focus({ preventScroll: true });
    if (!mobileExpanded && returnFocus.current) {
      returnFocus.current = false;
      triggerRef.current?.focus({ preventScroll: true });
    }
  }, [mobileExpanded, initialFocus]);
  useEffect(() => {
    if (!mobileExpanded) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [mobileExpanded]);

  const closeNavigation = () => {
    returnFocus.current = true;
    setExpandedAt(null);
  };
  const selectDestination = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    setExpandedAt(null);
    requestAnimationFrame(() => {
      document.getElementById('budget-content')?.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: 'instant' });
    });
  };

  return <div className={['aile-app', section === 'timeline' ? 'timeline-shell' : section === 'vehicle' ? 'vehicle-shell' : ''].join(' ')}>
    <a className="skip-link" href="#budget-content" inert={mobileExpanded} aria-hidden={mobileExpanded ? true : undefined}
      onClick={event => { event.preventDefault(); document.getElementById('budget-content')?.focus(); }}>İçeriğe geç</a>
    <div className="family-scrim" data-open={mobileExpanded} aria-hidden="true" onPointerDown={closeNavigation} />
    <aside ref={mergedRef} id={sidebarId} className="family-sidebar" data-open={mobileExpanded}
      role={desktop ? undefined : 'dialog'} aria-label={desktop ? undefined : 'Sayfalar'} aria-modal={mobileExpanded ? true : undefined}
      aria-hidden={!visible} inert={!visible}
      onFocusCapture={event => {
        if (event.target instanceof HTMLElement) {
          const key = event.target.dataset.navKey ?? null;
          navigationFocus.current = key;
          // Mantine schedules autofocus: keep its target aligned with any intervening user focus.
          if (key) setInitialFocus(key);
        }
      }}
      onBlurCapture={event => {
        if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) navigationFocus.current = null;
      }} onKeyDown={event => {
        if (mobileExpanded && event.key === 'Escape') { event.preventDefault(); closeNavigation(); }
      }}>
      <div className="family-sidebar-heading">
        <a className="family-wordmark" href="#/pano" data-nav-key="brand" data-autofocus={initialFocus === 'brand' || undefined} onClick={selectDestination}>aile<span>birlikte planla</span></a>
        <button ref={closeRef} type="button" className="family-nav-close" aria-label="Sayfaları kapat" data-nav-key="close" data-autofocus={initialFocus === 'close' || undefined} onClick={closeNavigation}>Kapat</button>
      </div>
      <nav className="family-page-navigation" aria-label="Sayfalar">
        {directoryGroups.map(group => <section key={group.title} className="family-nav-group" aria-label={group.title}>
          <h2>{group.title}</h2>
          <ul>{group.links.map(link => <li key={link.path} className={link.nested ? 'family-nav-nested' : undefined}>
            <a href={'#' + link.path} data-nav-key={link.path} data-autofocus={initialFocus === link.path || undefined}
              aria-current={current.path === link.path ? 'page' : undefined} onClick={selectDestination}>{link.label}</a>
          </li>)}</ul>
        </section>)}
        <div className="family-nav-utilities">
          <a href={'#' + settingsLink.path} data-nav-key={settingsLink.path} data-autofocus={initialFocus === settingsLink.path || undefined}
            aria-current={current.path === settingsLink.path ? 'page' : undefined} onClick={selectDestination}>{settingsLink.label}</a>
          <a href={sheetUrl} data-nav-key="sheet" data-autofocus={initialFocus === 'sheet' || undefined} target="_blank" rel="noreferrer">E-tabloyu aç</a>
        </div>
      </nav>
    </aside>
    <div className="family-content" inert={mobileExpanded} aria-hidden={mobileExpanded ? true : undefined}>
      <header className="family-mobile-header">
        <div className="family-mobile-location"><span className="family-mobile-brand">aile</span><span className="family-mobile-current">{current.label}</span></div>
        <button ref={triggerRef} type="button" className="family-nav-trigger" aria-haspopup="dialog" aria-expanded={mobileExpanded} aria-controls={sidebarId}
          onClick={() => { setInitialFocus('close'); setExpandedAt(location); }}>Sayfalar</button>
      </header>
      <main id="budget-content" className="family-main" tabIndex={-1}>{children}</main>
      <footer className="family-footer"><span>aile · birlikte planla</span><a href={sheetUrl} target="_blank" rel="noreferrer">E-tabloyu aç</a></footer>
    </div>
  </div>;
}
