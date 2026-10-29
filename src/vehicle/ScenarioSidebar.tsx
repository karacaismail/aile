import { useState, type ReactNode } from 'react';
import { Collapse } from '@mantine/core';
import { useMediaQuery, useReducedMotion } from '@mantine/hooks';
import { tokens } from '../dashboard/tokens';

/** One form tree: a permanent desktop rail, a disclosed settings panel on small screens. */
export function ScenarioSidebar({ children, open, onOpenChange, onResult }: {
  children: ReactNode; open: boolean; onOpenChange: (open: boolean) => void; onResult: () => void;
}) {
  const desktop = useMediaQuery('(min-width: 64em)');
  const reduced = useReducedMotion();
  // Remember interaction on desktop so resizing never hides a focused form control.
  const [engaged, setEngaged] = useState(false);
  const expanded = desktop || open || engaged;
  const close = () => { setEngaged(false); onOpenChange(false); };
  return <aside className="scenario-sidebar" aria-label="Senaryo ayarları">
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
