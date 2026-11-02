import type { ReactNode } from 'react';

// Kabuğun yerel çizgi simgeleri (20 px, currentColor, süsleyici): üst çubuk (WorkspaceShell), Sayfalar çekmecesi
// (MobileNavDrawer) ve masaüstü yan gezinmesi (ShellNavList) kullanır. Telefon yolu simge paketini (Phosphor) çekmez.
// Ayrı modüldür: üst çubuk ilk boyamada çizilir, çekmece modülü ise ilk niyette iner (WorkspaceShell).
export type ShellIconName = 'menu' | 'close' | 'settings' | 'sheet' | 'external';

const ICONS: Record<ShellIconName, ReactNode> = {
  menu: <path d="M3.5 5.5h13M3.5 10h13M3.5 14.5h13" />,
  close: <path d="M5 5l10 10M15 5L5 15" />,
  settings: <><path d="M3.5 6h6M13.5 6h3M3.5 14h3M10.5 14h6" /><circle cx="11.5" cy="6" r="2" /><circle cx="8.5" cy="14" r="2" /></>,
  sheet: <><rect x="3.5" y="4" width="13" height="12" rx="1.5" /><path d="M3.5 8h13M3.5 12h13M8 8v8" /></>,
  external: <path d="M11 4h5v5M16 4l-7 7M14 11.5V15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3.5" />,
};

export function ShellIcon({ name }: { name: ShellIconName }) {
  return (
    <svg className="aile-shell-icon" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false"
      fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {ICONS[name]}
    </svg>
  );
}
