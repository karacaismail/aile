import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { designTokens } from '../../design/tokens.ts';
import { themeFor } from '../theme/antdTheme';
import { ConfigProvider } from '../ui/antd';
import { MobileNavDrawer } from './MobileNavDrawer';
import { adminGroups, settingsLink } from './navigation';

// Tasarım: tasarim-sistemi/README.md "Kabuk" (< 1024: Sayfalar düğmesi modal çekmece açar; Kapat, Escape, odak dönüşü)
// + bundle.js AppShell dar dal (Drawer side left tone nav title "Sayfalar" → <nav aria-label="Sayfalar"> → Menu variant nav;
// öğe seçimi çekmeceyi kapatır). Seçiciler role/label; antd iç sınıfı yok, yalnız bizim aile-drawer* kökleri.

type MatchMediaResult = ReturnType<typeof window.matchMedia>;
const mediaMock = (matcher: (query: string) => boolean) => (query: string): MatchMediaResult => ({
  matches: matcher(query),
  media: query,
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
} as unknown as MatchMediaResult);

/** Yerleşim alanı: telefon (hiçbir sorgu eşleşmez) ya da tablet (yalnız kirilim-tablet eşleşir). */
function setDevice(device: 'phone' | 'tablet') {
  vi.mocked(window.matchMedia).mockImplementation(mediaMock(query =>
    device === 'tablet' && query.includes(`${designTokens.kirilimTablet}px`)));
}

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

describe('MobileNavDrawer', () => {
  beforeEach(() => setDevice('phone'));

  it('renders nothing while closed', () => {
    render(<MobileNavDrawer open={false} onClose={() => {}} location="/alimlar" />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('is a modal dialog titled Sayfalar holding a Sayfalar navigation with every admin link and Ayarlar', async () => {
    render(<MobileNavDrawer open onClose={() => {}} location="/alimlar" />);
    const dialog = await screen.findByRole('dialog', { name: 'Sayfalar' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByRole('heading', { level: 2, name: 'Sayfalar' })).toBeInTheDocument();
    const nav = within(dialog).getByRole('navigation', { name: 'Sayfalar' });
    for (const label of allLabels) expect(within(nav).getByRole('link', { name: label })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Alımlar ve eşyalar' })).toHaveAttribute('href', '#/alimlar');
    expect(within(nav).getByRole('link', { name: 'Ayarlar' })).toHaveAttribute('href', '#/ayarlar');
    expect(within(nav).getAllByRole('link')).toHaveLength(allLabels.length);
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

  it('uses the nav tone from the left; full width on a phone', async () => {
    render(<MobileNavDrawer open onClose={() => {}} location="/alimlar" />);
    const dialog = await screen.findByRole('dialog', { name: 'Sayfalar' });
    const root = dialog.closest('.aile-drawer') as HTMLElement;
    expect(root).toHaveClass('aile-drawer--nav');
    expect(root).toHaveClass('aile-drawer--left');
    expect(root).toHaveClass('aile-drawer--full');
    expect((document.querySelector('.aile-drawer-wrapper') as HTMLElement).style.width).toBe('100%');
  });

  it('uses the 384 px detail width on a tablet', async () => {
    setDevice('tablet');
    render(<MobileNavDrawer open onClose={() => {}} location="/alimlar" />);
    const dialog = await screen.findByRole('dialog', { name: 'Sayfalar' });
    const root = dialog.closest('.aile-drawer') as HTMLElement;
    expect(root).toHaveClass('aile-drawer--nav');
    expect(root).not.toHaveClass('aile-drawer--full');
    expect((document.querySelector('.aile-drawer-wrapper') as HTMLElement).style.width).toBe(`${designTokens.ayrintiGenislik}px`);
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

  it('calls onClose when a page link is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<MobileNavDrawer open onClose={onClose} location="/alimlar" />);
    const nav = await screen.findByRole('navigation', { name: 'Sayfalar' });
    await user.click(within(nav).getByRole('link', { name: 'Ev ve odalar' }));
    expect(onClose).toHaveBeenCalledTimes(1);
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

  it('returns focus to returnFocusTo after Escape', async () => {
    const user = userEvent.setup();
    render(<Harness withTarget />);
    const opener = screen.getByRole('button', { name: 'Sayfalar' });
    await user.click(opener);
    const dialog = await screen.findByRole('dialog', { name: 'Sayfalar' });
    await waitFor(() => expect(dialog).toHaveFocus());
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(opener).toHaveFocus();
  });
  // Tarayıcıda son öğeden Tab odağı belgeden (adres çubuğuna) çıkarır; focusin olmadığı için antd'nin focusin tuzağı
  // geri çekemez (e2e admin-layout "Tab 14"). Tuzak, sınırda Tab'ı keser ve odağı karşı uca taşır.
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

  it('returns focus to returnFocusTo after Escape when motion is off (reduced-motion theme)', async () => {
    const user = userEvent.setup();
    render(<ConfigProvider theme={themeFor(true)}><Harness withTarget /></ConfigProvider>);
    const opener = screen.getByRole('button', { name: 'Sayfalar' });
    await user.click(opener);
    const dialog = await screen.findByRole('dialog', { name: 'Sayfalar' });
    await waitFor(() => expect(dialog).toHaveFocus());
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it('does not pull focus back to the opener when focus already moved outside (route change focuses main)', async () => {
    const user = userEvent.setup();
    function Moved() {
      const [open, setOpen] = useState(false);
      const opener = useRef<HTMLButtonElement>(null);
      const main = useRef<HTMLElement>(null);
      return (
        <ConfigProvider theme={themeFor(true)}>
          <button type="button" ref={opener} onClick={() => setOpen(true)}>Sayfalar</button>
          <main ref={main} tabIndex={-1}>İçerik</main>
          <MobileNavDrawer open={open} location="/alimlar" returnFocusTo={opener}
            onClose={() => { main.current?.focus(); setOpen(false); }} />
        </ConfigProvider>
      );
    }
    render(<Moved />);
    await user.click(screen.getByRole('button', { name: 'Sayfalar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Sayfalar' });
    await waitFor(() => expect(dialog).toHaveFocus());
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('main')).toHaveFocus();
  });
});
