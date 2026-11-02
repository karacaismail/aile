import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkspaceShell } from './WorkspaceShell';

// Kaynak: tasarim-sistemi/README.md › Kabuk, components/AppShell/README.md, bundle.js AppShell.
// Üç cihaz matchMedia ile taklit edilir (device.ts: tablet ≥600, desktop ≥1024). Seçiciler role/label; antd iç sınıfı yok.

type Listener = (event: { matches: boolean; media: string }) => void;
interface FakeQuery { matches: boolean; media: string; listeners: Set<Listener> }

function installMatchMedia(width: number) {
  const queries: FakeQuery[] = [];
  const evaluate = (media: string) => {
    const match = media.match(/min-width:\s*(\d+)px/);
    return match ? width >= Number(match[1]) : false;
  };
  window.matchMedia = vi.fn().mockImplementation((media: string) => {
    const query: FakeQuery = { matches: evaluate(media), media, listeners: new Set() };
    queries.push(query);
    return {
      get matches() { return query.matches; },
      media,
      onchange: null,
      addEventListener: (_type: string, listener: Listener) => { query.listeners.add(listener); },
      removeEventListener: (_type: string, listener: Listener) => { query.listeners.delete(listener); },
      addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    };
  }) as unknown as typeof window.matchMedia;
}

/** antd Menu (rc-menu) yol kayıtlarını bir animasyon karesi sonra yeniler; o kare act içinde beklenir. */
async function renderShell(location: string, content = 'Sayfa içeriği') {
  const result = render(<WorkspaceShell location={location}><p>{content}</p></WorkspaceShell>);
  await act(async () => { await new Promise<void>(resolve => { requestAnimationFrame(() => resolve()); }); });
  return result;
}

const PAGES = [
  'Genel durum', 'Bütçe ve nakit', 'Ödemeler', 'Hesaplar ve borçlar', 'Alımlar ve eşyalar', 'Ev ve odalar',
  'Projeler ve görevler', 'Taraflar ve teklifler', 'Raporlar', 'Sözlükler ve iş akışları', 'Veri kalitesi ve içe aktarma',
];

afterEach(() => { document.title = ''; window.location.hash = ''; });

describe('WorkspaceShell · masaüstü (≥1024)', () => {
  beforeEach(() => installMatchMedia(1440));

  it('renders the brand, the Sayfalar navigation with all pages as hash links and the selected page', async () => {
    await renderShell('/alimlar/123');
    expect(screen.getByText('aile')).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Sayfalar' });
    for (const label of PAGES) expect(within(nav).getByRole('link', { name: label })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Genel durum' })).toHaveAttribute('href', '#/genel');
    expect(within(nav).getByRole('link', { name: 'Alımlar ve eşyalar' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Genel durum' })).not.toHaveAttribute('aria-current');
    // Masaüstünde üst bar ve Sayfalar düğmesi yok.
    expect(screen.queryByRole('button', { name: 'Sayfalar' })).toBeNull();
  });

  it('offers Ayarlar and E-tabloyu aç below the pages; the sheet link opens in a new tab or is honestly disabled', async () => {
    await renderShell('/alimlar');
    expect(screen.getByRole('link', { name: 'Ayarlar' })).toHaveAttribute('href', '#/ayarlar');
    // Kimlik yalnız ortamdan gelir (VITE_BUDGET_SHEET_ID); yoksa öğe devre dışıdır ve nedeni yanında yazılıdır.
    const item = screen.getByRole('menuitem', { name: /E-tabloyu aç/ });
    if (import.meta.env.VITE_BUDGET_SHEET_ID) {
      const sheet = within(item).getByRole('link', { name: 'E-tabloyu aç (yeni sekmede açılır)' });
      expect(sheet).toHaveAttribute('target', '_blank');
      expect(sheet).toHaveAttribute('rel', 'noopener');
      expect(sheet.getAttribute('href')).toMatch(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/.+\/edit$/);
      expect(screen.queryByText('E-tablo bağlantısı yok')).toBeNull();
    } else {
      expect(item).toHaveAttribute('aria-disabled', 'true');
      expect(within(item).queryByRole('link')).toBeNull();
      expect(screen.getByText('E-tablo bağlantısı yok')).toBeInTheDocument();
    }
  });

  it('has a single focusable main landmark with the page content and sets document.title', async () => {
    await renderShell('/butce', 'Bütçe içeriği');
    const mains = screen.getAllByRole('main');
    expect(mains).toHaveLength(1);
    expect(mains[0]).toHaveAttribute('id', 'admin-content');
    expect(mains[0]).toHaveAttribute('tabindex', '-1');
    expect(within(mains[0]).getByText('Bütçe içeriği')).toBeInTheDocument();
    expect(document.title).toBe('Bütçe ve nakit · aile');
  });

  it('skip link focuses main without touching the hash route', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/butce';
    await renderShell('/butce');
    const skip = screen.getByRole('link', { name: 'İçeriğe geç' });
    await user.click(skip);
    expect(screen.getByRole('main')).toHaveFocus();
    expect(window.location.hash).toBe('#/butce');
  });
});

describe.each([['tablet', 768], ['telefon', 320]])('WorkspaceShell · %s (%i px)', (_name, width) => {
  beforeEach(() => installMatchMedia(width));

  it('shows the top bar "aile · {label}" with a Sayfalar button that opens a dialog drawer', async () => {
    const user = userEvent.setup();
    await renderShell('/ev');
    const banner = screen.getByRole('banner');
    expect(banner).toHaveTextContent(/^aile\s*·\s*Ev ve odalar/);
    const button = within(banner).getByRole('button', { name: 'Sayfalar' });
    expect(button).toHaveAttribute('aria-haspopup', 'dialog');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    // Gezinme yalnız çekmecededir; kapalıyken sayfada nav landmark'ı yok.
    expect(screen.queryByRole('navigation', { name: 'Sayfalar' })).toBeNull();
    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(document.title).toBe('Ev ve odalar · aile');
    expect(screen.getByRole('main')).toHaveAttribute('id', 'admin-content');
  });

  it('closes the drawer, updates the title and moves focus to main when the route changes', async () => {
    const user = userEvent.setup();
    const view = await renderShell('/ev');
    const button = screen.getByRole('button', { name: 'Sayfalar' });
    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    view.rerender(<WorkspaceShell location="/projeler"><p>Projeler</p></WorkspaceShell>);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('banner')).toHaveTextContent('Projeler ve görevler');
    expect(document.title).toBe('Projeler ve görevler · aile');
    expect(screen.getByRole('main')).toHaveFocus();
  });
});
