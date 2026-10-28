import { useId, useState, type ReactNode } from 'react';
import { Collapse } from '@mantine/core';
import { useReducedMotion } from '@mantine/hooks';
import { tokens } from '../dashboard/tokens';

/** Visually animates both directions; hidden content leaves the accessibility tree immediately. */
export function Disclosure({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const reduced = useReducedMotion();
  return <div className="vehicle-disclosure">
    <button type="button" className="disclosure-trigger" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
      <span>{label}</span><span aria-hidden="true">{open ? '−' : '+'}</span>
    </button>
    <Collapse id={id} expanded={open} aria-hidden={!open} inert={!open} keepMounted={false}
      transitionDuration={reduced ? 0 : tokens.duration} transitionTimingFunction={tokens.ease} animateOpacity={false}>
      <div className="disclosure-content">{children}</div>
    </Collapse>
  </div>;
}
