export function timelineEntryUrl(pathname: string, base: string): string | null {
  const root = `${base.replace(/\/$/, '')}/`;
  return [`${root}timeline`, `${root}timeline/`, `${root}timeline/index.html`].includes(pathname) ? `${root}#/timeline` : null;
}
