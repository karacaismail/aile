import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { installViewport } from '../adaptive/testing';
import { MobileNavDrawer } from './MobileNavDrawer';
import { adminGroups, settingsLink } from './navigation';

// Tasarım: tasarim-sistemi/README.md "Kabuk" (< 1024: Sayfalar düğmesi modal çekmece açar; Kapat, Escape, odak dönüşü,
// odak içeride kalır) + Uyarlanır teslim (telefonda tam ekran, tablette 384; güvenli alan). Yerel HTML + ARIA APG modal
// diyalog kalıbı; antd yok. Seçiciler role/label; yalnız bizim kök sınıfımız (.aile-mobile-nav) ve data-* sözleşmesi.

function Harness({ location = '/alimlar', withTarget }: { location?: string; withTarget?: boolean }) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button type="button" ref={opener} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>Sayfalar</button>
      <MobileNavDrawer open={open} onClose={() => setOpen(false)} location={location} returnFocusTo={withTarget ? opener : undefined} />
    </>
  );
}

const allLabels = [...adminGroups.flatMap(group => group.links.map(link => link.label)), settingsLink.label];

afterEach(() => { window.location.hash = ''; });

describe('MobileNavDrawer', () => {
  beforeEach(() => { installViewport({ width: 320, height: 568, coarse: true }); });

  it('renders nothing while closed', () => {
    render(<MobileNavDrawer open={false} onClose={() => {}} location="/alimlar" />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(document.documentElement).not.toHaveAttribute('data-shell-kilit');
  });

  it('is a native modal dialog titled Sayfalar holding a Sayfalar navigation with every admin link and Ayarlar', async () => {
    const view = render(<MobileNavDrawer open onClose={() => {}} location="/alimlar" />);
    const dialog = await screen.findByRole('dialog', { name: 'Sayfalar' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByRole('heading', { level: 2, name: 'Sayfalar' })).toBeInTheDocument();
    const nav = within(dialog).getByRole('navigation', { name: 'Sayfalar' });
    for (const label of allLabels) expect(within(nav).getByRole('link', { name: label })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Alımlar ve eşyalar' })).toHaveAttribute('href', '#/alimlar');
    expect(within(nav).getByRole('link', { name: 'Ayarlar' })).toHaveAttribute('href', '#/ayarlar');
    expect(within(nav).getAllByRole('link')).toHaveLength(allLabels.length);
    // Yerel işaretleme: antd Drawer/Menu sınıfı ve portal yok; çekmece kabuğun içinde çizilir.
    expect(document.querySelector('[class*="ant-"]')).toBeNull();
    expect(view.container.querySelector('.aile-mobile-nav')).toContainElement(dialog);
  });

  // WAI-ARIA APG: site gezinmesi menü değildir (role="menu" uygulama komutları içindir). Tasarım paketindeki Menu
  // variant="nav" de düz bağlantı listesidir; her bağlantı doğal Tab sırasındadır (roving tabindex yok). Masaüstü yan
  // gezinmesi aynı ShellNavList'i kullanır; e2e/admin-ui-a06-menu.spec.ts gerçek tarayıcıda aynı sözleşmeyi ölçer.
  it('is a plain link list (APG site navigation): no menu roles, every link is a Tab stop, one aria-current', async () => {
    render(<MobileNavDrawer open onClose={() => {}} location="/alimlar" />);
    const nav = within(await screen.findByRole('dialog', { name: 'Sayfalar' })).getByRole('navigation', { name: 'Sayfalar' });
    expect(within(nav).queryAllByRole('menu')).toHaveLength(0);
    expect(within(nav).queryAllByRole('menuitem')).toHaveLength(0);
    const links = within(nav).getAllByRole('link');
    expect(links.filter(link => link.tabIndex < 0).map(link => link.textContent)).toEqual([]);
    expect(nav.querySelectorAll('[aria-current]')).toHaveLength(1);
  });

  // b04 odak sözleşmesi: yerel nav yüzeyi data-odak-zemin="nav" ile işaretlenir (çizgi odak-nav, seçili öğede odak);
  // eski iskelet sınıfı .aile-admin-nav (admin.css'te hover koşulsuz, dolgu farklı) yerel alt sayfaya taşınmaz.
  it('marks the drawer panel as a nav focus surface (data-odak-zemin="nav") without the legacy skeleton class', async () => {
    render(<MobileNavDrawer open onClose={() => {}} location="/alimlar" />);
    const dialog = await screen.findByRole('dialog', { name: 'Sayfalar' });
    expect(dialog).toHaveAttribute('data-odak-zemin', 'nav');
    expect(dialog).not.toHaveClass('aile-admin-nav');
  });

  it('marks only the current page (including nested paths) with aria-current="page"', async () => {
    render(<MobileNavDrawer open onClose={() => {}} location="/alimlar/abc-123" />);
    const nav = await screen.findByRole('navigation', { name: 'Sayfalar' });
    expect(within(nav).getByRole('link', { name: 'Alımlar ve eşyalar' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getAllByRole('link').filter(link => link.getAttribute('aria-current') === 'page')).toHaveLength(1);
  });

  it('marks Ayarlar as current on the settings route', async () => {
    render(<MobileNavDrawer open onClose={() => {}} location="/ayarlar" />);
    const nav = await screen.findByRole('navigation', { name: 'Sayfalar' });
    expect(within(nav).getByRole('link', { name: 'Ayarlar' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Alımlar ve eşyalar' })).not.toHaveAttribute('aria-current');
  });

  it('is full width on a phone and uses the 384 px detail width on a tablet (size contract)', async () => {
    const viewport = installViewport({ width: 320, height: 568, coarse: true });
    const view = render(<MobileNavDrawer open onClose={() => {}} location="/alimlar" />);
    const root = () => view.container.querySelector('.aile-mobile-nav') as HTMLElement;
    await screen.findByRole('dialog', { name: 'Sayfalar' });
    expect(root()).toHaveAttribute('data-size', 'tam');
    act(() => viewport.set({ width: 820, height: 1180 }));
    await waitFor(() => expect(root()).toHaveAttribute('data-size', 'ayrinti'));
  });

  it('calls onClose from the visible Kapat button', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<MobileNavDrawer open onClose={onClose} location="/alimlar" />);
    const close = await screen.findByRole('button', { name: 'Kapat' });
    expect(close).toBeVisible();
    await user.click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose on Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<MobileNavDrawer open onClose={onClose} location="/alimlar" />);
    await screen.findByRole('dialog', { name: 'Sayfalar' });
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when the backdrop is tapped', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const view = render(<MobileNavDrawer open onClose={onClose} location="/alimlar" />);
    await screen.findByRole('dialog', { name: 'Sayfalar' });
    const backdrop = view.container.querySelector('[data-shell-ortu]') as HTMLElement;
    expect(backdrop).toHaveAttribute('aria-hidden', 'true');
    await user.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when a page link is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<MobileNavDrawer open onClose={onClose} location="/alimlar" />);
    const nav = await screen.findByRole('navigation', { name: 'Sayfalar' });
    await user.click(within(nav).getByRole('link', { name: 'Ev ve odalar' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('locks background scroll while open and releases it on close', async () => {
    const user = userEvent.setup();
    render(<Harness withTarget />);
    await user.click(screen.getByRole('button', { name: 'Sayfalar' }));
    await screen.findByRole('dialog', { name: 'Sayfalar' });
    expect(document.documentElement).toHaveAttribute('data-shell-kilit');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.documentElement).not.toHaveAttribute('data-shell-kilit');
  });

  it('moves focus into the dialog on open and returns it to the opener on close', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Sayfalar' });
    await user.click(opener);
    const dialog = await screen.findByRole('dialog', { name: 'Sayfalar' });
    await waitFor(() => expect(dialog).toHaveFocus());
    await user.click(screen.getByRole('button', { name: 'Kapat' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(opener).toHaveFocus();
  });

  it('returns focus to returnFocusTo after Escape, at once (before any closing motion)', async () => {
    const user = userEvent.setup();
    render(<Harness withTarget />);
    const opener = screen.getByRole('button', { name: 'Sayfalar' });
    await user.click(opener);
    const dialog = await screen.findByRole('dialog', { name: 'Sayfalar' });
    await waitFor(() => expect(dialog).toHaveFocus());
    await user.keyboard('{Escape}');
    expect(opener).toHaveFocus();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  // Tarayıcıda son öğeden Tab odağı belgeden (adres çubuğuna) çıkarır. Tuzak, sınırda Tab'ı keser ve odağı karşı uca taşır.
  it('traps Tab at the edges: Tab on the last link wraps to Kapat, Shift+Tab on Kapat wraps to the last link', async () => {
    render(<MobileNavDrawer open onClose={() => {}} location="/alimlar" />);
    const dialog = await screen.findByRole('dialog', { name: 'Sayfalar' });
    const close = within(dialog).getByRole('button', { name: 'Kapat' });
    const links = within(dialog).getAllByRole('link');
    const last = links[links.length - 1];

    last.focus();
    expect(fireEvent.keyDown(last, { key: 'Tab' }), 'Tab on the last link is intercepted').toBe(false);
    expect(close).toHaveFocus();

    expect(fireEvent.keyDown(close, { key: 'Tab', shiftKey: true }), 'Shift+Tab on Kapat is intercepted').toBe(false);
    expect(last).toHaveFocus();

    // Panelin kendisi (açılış odağı) ilk durak sayılır: Shift+Tab son bağlantıya gider.
    dialog.focus();
    expect(fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })).toBe(false);
    expect(last).toHaveFocus();

    // Aradaki duraklarda tarayıcının sırası korunur.
    links[0].focus();
    expect(fireEvent.keyDown(links[0], { key: 'Tab' })).toBe(true);
  });

  it('returns focus to returnFocusTo after Escape when motion is reduced', async () => {
    installViewport({ width: 320, height: 568, coarse: true, reducedMotion: true });
    const user = userEvent.setup();
    render(<Harness withTarget />);
    const opener = screen.getByRole('button', { name: 'Sayfalar' });
    await user.click(opener);
    const dialog = await screen.findByRole('dialog', { name: 'Sayfalar' });
    await waitFor(() => expect(dialog).toHaveFocus());
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });

  it('does not pull focus back to the opener when a link navigates to another page (the shell focuses main)', async () => {
    const user = userEvent.setup();
    render(<Harness withTarget />);
    const opener = screen.getByRole('button', { name: 'Sayfalar' });
    await user.click(opener);
    const nav = await screen.findByRole('navigation', { name: 'Sayfalar' });
    await user.click(within(nav).getByRole('link', { name: 'Ev ve odalar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(opener).not.toHaveFocus();
  });

  it('returns focus to the opener when the chosen link is the current page (no navigation happens)', async () => {
    const user = userEvent.setup();
    render(<Harness withTarget />);
    const opener = screen.getByRole('button', { name: 'Sayfalar' });
    await user.click(opener);
    const nav = await screen.findByRole('navigation', { name: 'Sayfalar' });
    await user.click(within(nav).getByRole('link', { name: 'Alımlar ve eşyalar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(opener).toHaveFocus();
  });

  it('does not pull focus back when focus already moved outside (route change focuses main)', async () => {
    const user = userEvent.setup();
    function Moved() {
      const [open, setOpen] = useState(false);
      const opener = useRef<HTMLButtonElement>(null);
      const main = useRef<HTMLElement>(null);
      return (
        <>
          <button type="button" ref={opener} onClick={() => setOpen(true)}>Sayfalar</button>
          <main ref={main} tabIndex={-1}>İçerik</main>
          <MobileNavDrawer open={open} location="/alimlar" returnFocusTo={opener}
            onClose={() => { setOpen(false); queueMicrotask(() => main.current?.focus()); }} />
        </>
      );
    }
    render(<Moved />);
    await user.click(screen.getByRole('button', { name: 'Sayfalar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Sayfalar' });
    await waitFor(() => expect(dialog).toHaveFocus());
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(screen.getByRole('main')).toHaveFocus());
  });
});
