import { useLayoutEffect, useRef, useState } from 'react';

/**
 * Focus return for a route modal. The route unmounts the dialog without Mantine's closing transition, so its own
 * returnFocus never runs. Focus goes to the element that opened it; if that left the page (record deleted, filtered
 * out, a drawer that closed), to `fallback()` (the same record in the list, then a page anchor), else the page h1.
 * `isOpen()` reads the URL: StrictMode's trial unmount and a switch to another record keep it open.
 */
function focusTarget(origin: Element | null, fallback: () => HTMLElement | null) {
  const heading = document.querySelector<HTMLElement>('.page-header h1');
  const target = origin instanceof HTMLElement && origin.isConnected && origin !== document.body ? origin : fallback() ?? heading;
  if (!target) return;
  if (target === heading && !heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true });
  target.scrollIntoView?.({ block: 'nearest' });
}

export function useRouteModalFocusReturn(isOpen: () => boolean, fallback: () => HTMLElement | null) {
  // The opener is still focused on the first render, before the modal's focus trap moves focus inside.
  const [origin] = useState(() => (typeof document === 'undefined' ? null : document.activeElement));
  // The latest callbacks are read at close time (they name the current record and route).
  const latest = useRef({ isOpen, fallback });
  latest.current = { isOpen, fallback };
  // Layout cleanup runs in the same commit that removes the dialog, so focus never rests on <body> in between.
  useLayoutEffect(() => () => {
    const { isOpen: stillOpen, fallback: next } = latest.current;
    if (stillOpen()) return;
    focusTarget(origin, next);
    // A target that appears or leaves in the same commit is re-resolved once rendering settles.
    requestAnimationFrame(() => { if (document.activeElement === document.body) focusTarget(origin, next); });
  }, [origin]);
}
