import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Collapse } from '@mantine/core';
import { useReducedMotion } from '@mantine/hooks';
import { tokens } from '../dashboard/tokens';

/** One form tree: a permanent desktop rail, a disclosed settings panel on small screens. */
export function ScenarioSidebar({ children, open, onOpenChange, onResult }: {
  children: ReactNode; open: boolean; onOpenChange: (open: boolean) => void; onResult: () => void;
}) {
  const aside = useRef<HTMLElement>(null);
  const [desktop, setDesktop] = useState(false);
  useLayoutEffect(() => {
    const element = aside.current;
    const container = element?.closest('.vehicle-page');
    if (!element || !container) return;
    // Read the same container-query decision as CSS, including enlarged user text.
    const update = () => setDesktop(getComputedStyle(element).getPropertyValue('--vehicle-wide').trim() === '1');
    const observer = new ResizeObserver(update);
    observer.observe(container);
    update();
    return () => observer.disconnect();
  }, []);
  const reduced = useReducedMotion();
  // Remember interaction on desktop so resizing never hides a focused form control.
  const [engaged, setEngaged] = useState(false);
  const expanded = desktop || open || engaged;
  const close = () => { setEngaged(false); onOpenChange(false); };
  return <aside ref={aside} className="scenario-sidebar" aria-label="Senaryo ayarları">
    <button className="settings-toggle" aria-expanded={expanded} aria-controls="scenario-settings"
      onClick={() => { if (expanded) close(); else onOpenChange(true); }}>
      <span>Ayarları düzenle</span><span aria-hidden="true">{expanded ? '−' : '+'}</span>
    </button>
    <Collapse id="scenario-settings" expanded={expanded} keepMounted aria-hidden={!expanded} inert={!expanded}
      transitionDuration={reduced ? 0 : tokens.duration} transitionTimingFunction={tokens.ease} animateOpacity={false}>
      <div className="sidebar-scroll" onFocusCapture={() => setEngaged(true)}>{children}</div>
      <button className="settings-done" onClick={() => { close(); onResult(); }}>Sonuçları göster</button>
    </Collapse>
  </aside>;
}
