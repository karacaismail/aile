import type { ReactNode } from 'react';
import './info.css';

export type Fact = { label: string; value: ReactNode; detail?: ReactNode; tone?: 'positive' | 'negative'; emphasis?: boolean };
/** Presentation only: a missing value must never become a zero or a financial total. */
export function FactList({ label, items, tone = 'plain', className = '' }: { label: string; items: readonly Fact[]; tone?: 'plain' | 'subtle' | 'strong'; className?: string }) {
  return <div className={`info-facts ${className}`} data-tone={tone} role="group" aria-label={label}>
    <dl>{items.map(item => <div key={item.label} data-emphasis={item.emphasis || undefined}>
      <dt>{item.label}</dt><dd data-tone={item.tone}>
        {item.value == null || item.value === '' ? 'Belirtilmedi' : item.value}
        {item.detail && <span className="info-fact-detail">{item.detail}</span>}
      </dd>
    </div>)}</dl>
  </div>;
}
export function SectionHeading({ title, description, actions, level = 2 }: { title: string; description?: ReactNode; actions?: ReactNode; level?: 2 | 3 | 4 }) {
  const Heading = `h${level}` as const;
  return <div className="info-heading"><div><Heading>{title}</Heading>{description && <p>{description}</p>}</div>{actions && <div className="info-actions">{actions}</div>}</div>;
}
export function SourceNote({ label = 'Kaynak ve kapsam', children }: { label?: string; children: ReactNode }) {
  return <div className="info-source">{label && <strong>{label}</strong>}<div>{children}</div></div>;
}
/** Page links are navigation, not tabs or local filters. No record matching is inferred. */
export function JourneyLinks({ label = 'İlgili adımlar', items }: { label?: string; items: readonly { href: string; label: string }[] }) {
  return <nav className="info-journey" aria-label={label}><span>{label}</span><ul>{items.map(item => <li key={item.href}><a href={item.href}>{item.label}<span aria-hidden="true"> →</span></a></li>)}</ul></nav>;
}
