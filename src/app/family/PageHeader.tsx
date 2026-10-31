import type { ReactNode } from 'react';
import { currentDirectoryLink, directoryGroups } from './navigation';

/** The group a page belongs to, shown as a caption above the heading (flat hierarchy: no breadcrumbs). */
export function sectionCaption(location: string): string | undefined {
  const { path } = currentDirectoryLink(location);
  return directoryGroups.find(group => group.links.some(link => link.path === path))?.title;
}

/**
 * One page heading for every family page. The h1 is the navigation label of the
 * current location, so the link just used, the heading and the document title agree.
 * `lead` is the one-line purpose; `actions` are page-level controls; `children` is
 * extra context that belongs with the heading (selected scenario, plan notes).
 */
export function PageHeader({ location, lead, actions, children }: { location: string; lead?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  const caption = sectionCaption(location);
  return <header className="page-header">
    <div className="page-header-text">
      {caption && <p className="page-header-caption">{caption}</p>}
      <h1>{currentDirectoryLink(location).label}</h1>
      {lead && <p className="page-header-lead">{lead}</p>}
    </div>
    {actions && <div className="page-header-actions">{actions}</div>}
    {children}
  </header>;
}
