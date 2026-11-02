import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { designTokens } from '../../design/tokens.ts';
import { useDevice } from '../device';
import { Button, Menu } from '../ui';
import type { MenuItem } from '../ui/Menu';
import { Layout } from '../ui/antd';
import type { WorkspaceShellProps } from './contracts';
import { MobileNavDrawer } from './MobileNavDrawer';
import { adminGroups, currentAdminLink, settingsLink } from './navigation';
import './shell.css';

// Tasarım: tasarim-sistemi/README.md › Kabuk + Uyarlanır teslim, components/AppShell/README.md, bundle.js AppShell.
// Masaüstü (≥1024): solda 272 px lacivert nav (marka "aile" → Sayfalar menüsü → ayırıcı → Ayarlar · E-tabloyu aç),
// içerik ≤1480 ortalı, kenar 32. Tablet/telefon: 60 px yapışkan üst bar "aile · {sayfa} · [Sayfalar]" ve MobileNavDrawer.
// Her cihazda: skip link, tek main#admin-content (tabIndex -1), document.title "{sayfa} · aile"; rota değişince çekmece
// kapanır ve odak main'e geçer.
//
// ProLayout denendi, kullanılmadı: pro-components 3.1.15-9 ProLayout içeriği WrapContent → antd Layout.Content ile sarar;
// Layout.Content <main data-testid="pro-layout-content"> çizer, bu da main#admin-content'i ikinci bir main landmark'ın
// içine yuvalardı (e2e tek main bekler). useBreakpoint (isMobile/collapsed) ve useDocumentTitle da device.ts ve başlık
// sözleşmemizle çakışır. Aynı yapı antd Layout ile kuruldu: Sider → <aside>, Header → <header>, Content → <main>.

const { Sider, Header, Content } = Layout;
const MAIN_ID = 'admin-content';
const sheetId: string = import.meta.env.VITE_BUDGET_SHEET_ID ?? '';
// Gerçek kimlik yalnız ortam değişkeninden gelir; kaynakta yazılmaz.
const sheetUrl = sheetId ? `https://docs.google.com/spreadsheets/d/${sheetId}/edit` : undefined;

const pageItems: readonly MenuItem[] = adminGroups.flatMap(group =>
  group.links.map(link => ({ key: link.path, label: link.label, href: `#${link.path}` })),
);
const helperItems: readonly MenuItem[] = [
  { key: settingsLink.path, label: settingsLink.label, icon: 'settings', href: `#${settingsLink.path}` },
  { key: '/e-tablo', label: 'E-tabloyu aç', icon: 'sheet', href: sheetUrl ?? '#', external: true, disabled: !sheetUrl },
];

export function WorkspaceShell({ location, children }: WorkspaceShellProps) {
  const device = useDevice();
  const narrow = device !== 'desktop';
  const current = currentAdminLink(location);
  const main = useRef<HTMLElement | null>(null);
  const pagesButton = useRef<HTMLButtonElement | null>(null);
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => { document.title = `${current.label} · aile`; }, [current.label]);

  // Rota değişince (ilk çizim hariç) çekmece kapanır ve odak içeriğe geçer; çekmecenin odak dönüşü dışarıdaki odağa dokunmaz.
  const previousLocation = useRef(location);
  useEffect(() => {
    if (previousLocation.current === location) return;
    previousLocation.current = location;
    setNavOpen(false);
    main.current?.focus({ preventScroll: true });
  }, [location]);

  // Skip link: hash yönlendirme "#admin-content"i rota sayardı; bağlantı yalnız odağı taşır.
  const skipToContent = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    main.current?.focus();
  };

  const skipLink = <a className="aile-admin-skip" href={`#${MAIN_ID}`} onClick={skipToContent}>İçeriğe geç</a>;

  if (narrow) {
    return (
      <div className="aile-admin-shell aile-admin-shell--dar" data-device={device}>
        {skipLink}
        <Layout className="aile-admin-layout">
          <Header className="aile-admin-topbar">
            <p className="aile-admin-topbar-title">
              <span className="aile-admin-brand">aile</span>
              <span className="aile-admin-topbar-sep" aria-hidden="true">·</span>
              <span className="aile-admin-topbar-page">{current.label}</span>
            </p>
            <Button
              ref={pagesButton}
              variant="secondary"
              onNav
              icon="menu"
              aria-haspopup="dialog"
              aria-expanded={navOpen}
              onClick={() => setNavOpen(true)}
            >
              Sayfalar
            </Button>
          </Header>
          <Content ref={main} id={MAIN_ID} tabIndex={-1} className="aile-admin-main">
            <div className="aile-admin-main-inner">{children}</div>
          </Content>
        </Layout>
        <MobileNavDrawer open={navOpen} onClose={() => setNavOpen(false)} location={location} returnFocusTo={pagesButton} />
      </div>
    );
  }

  return (
    <div className="aile-admin-shell aile-admin-shell--genis" data-device={device}>
      {skipLink}
      <Layout hasSider className="aile-admin-layout">
        <Sider width={designTokens.navGenislik} theme="dark" className="aile-admin-nav">
          <div className="aile-admin-nav-icerik">
            <p className="aile-admin-brand aile-admin-nav-brand">aile</p>
            <nav aria-label="Sayfalar">
              <Menu variant="nav" items={pageItems} selectedKey={current.path} />
            </nav>
            <div className="aile-admin-nav-foot">
              <Menu variant="nav" items={helperItems} selectedKey={current.path} label="Yardımcı" />
              {!sheetUrl && <p className="aile-admin-nav-note">E-tablo bağlantısı yok</p>}
            </div>
          </div>
        </Sider>
        <Content ref={main} id={MAIN_ID} tabIndex={-1} className="aile-admin-main">
          <div className="aile-admin-main-inner">{children}</div>
        </Content>
      </Layout>
    </div>
  );
}
