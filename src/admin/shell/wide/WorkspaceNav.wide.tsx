import type { MouseEvent } from 'react';
import { ShellNavList, isPlainClick, type ShellNavItem } from '../MobileNavDrawer';
import { adminPages, settingsLink, sheetLink } from '../navigation';
import './WorkspaceNav.wide.css';

// Geniş-özel: masaüstü (≥1024) kalıcı yan gezinme. Tasarım: tasarim-sistemi/README.md › Kabuk (solda 272 px lacivert
// nav: küçük harf "aile" → 11 sayfa → ayırıcı → Ayarlar · E-tabloyu aç, yeni sekme). WorkspaceShell bunu yalnız
// lazyWide('shell-nav', …) ile yükler; telefon profili hiç indirmez. Bağlantı listesi çekmeceyle ortaktır
// (MobileNavDrawer › ShellNavList, yerel <ul>/<a>; menü rolü yok). Odak çizgisini admin.css çizer: bağlantılar satır
// taşıyıcısıdır (data-focus-line="row", çizgi bağlantının alt kenarında); data-odak-zemin="nav" yüzeyinde odak-nav, seçili
// öğede secili yüzeyin üzerinde odak.

export interface WorkspaceNavProps {
  location: string;
  /** Hash bağlantısı seçildi (gezinme başlıyor); kabuk yeni sayfanın başına kaydırır. */
  onNavigate?(path: string): void;
}

// Kimlik yalnız ortam değişkeninden gelir; kaynakta yazılmaz. Yoksa öğe kullanılamaz ve nedeni yazılır.
const sheetId: string = import.meta.env.VITE_BUDGET_SHEET_ID ?? '';

const pageItems: readonly ShellNavItem[] = adminPages.map(item => ({ path: item.path, label: item.label, href: `#${item.path}` }));
const helperItems: readonly ShellNavItem[] = [
  { path: settingsLink.path, label: settingsLink.label, href: `#${settingsLink.path}`, icon: 'settings' },
  { path: 'e-tablo', label: sheetLink.label, href: sheetId ? sheetLink.href : undefined, icon: 'sheet', external: true },
];

export default function WorkspaceNav({ location, onNavigate }: WorkspaceNavProps) {
  const select = (item: ShellNavItem, event: MouseEvent<HTMLAnchorElement>) => {
    if (item.external || !isPlainClick(event)) return;
    onNavigate?.(item.path);
  };
  return (
    <aside className="aile-shell-yan" data-shell-region="nav" data-odak-zemin="nav">
      <div className="aile-shell-yan__icerik">
        <p className="aile-admin-brand aile-shell-yan__marka">aile</p>
        <nav aria-label="Sayfalar">
          <ShellNavList items={pageItems} location={location} onSelect={select} />
        </nav>
        <div className="aile-shell-yan__alt">
          <ShellNavList items={helperItems} location={location} onSelect={select} label="Yardımcı" />
          {!sheetId && <p className="aile-shell-yan__not">E-tablo bağlantısı yok</p>}
        </div>
      </div>
    </aside>
  );
}
