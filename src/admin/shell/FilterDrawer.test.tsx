import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import type { FilterFacet, FilterPanelProps } from './contracts';
import { FilterDrawer, type FilterDrawerProps } from './FilterDrawer';

// Tasarım: README › Sayfa iskeleti 4 (dar ekranda filtre çekmecesi) ve Uyarlanır teslim tablosu (telefon tam ekran,
// tablet sağdan 384); referans bundle.js SayfaAlimlar/PageFrame: Drawer{full: dev==='phone', title "Filtreler · N etkin",
// footer FormFooter narrow "{N} sonucu göster" / "Filtreleri temizle"} içinde FilterPanel bare. Seçiciler role/label.

// FilterPanel ayrı görevde gerçek bileşen olur; burada aldığı props'u görünür kılan düz bir yer tutucu.
vi.mock('./FilterPanel', () => ({
  FilterPanel: ({ facets, bare, openKeys }: FilterPanelProps) => (
    <div data-testid="filter-panel" data-bare={bare ? 'true' : undefined} data-open-keys={openKeys?.join(',')}>
      {facets.map(facet => <p key={facet.id}>{facet.label}</p>)}
    </div>
  ),
}));

const deviceState = vi.hoisted(() => ({ current: 'phone' as 'phone' | 'tablet' | 'desktop' }));
vi.mock('../device', () => ({ useDevice: () => deviceState.current }));

const facets: readonly FilterFacet[] = [
  { id: 'oda', label: 'Oda', kind: 'checkbox', selected: ['mutfak'], options: [{ value: 'mutfak', label: 'Mutfak', count: 12 }, { value: 'salon', label: 'Salon', count: 9 }] },
  { id: 'kategori', label: 'Kategori', kind: 'tree', selected: [], options: [{ value: 'mobilya', label: 'Mobilya', count: 4 }] },
  { id: 'odeme', label: 'Ödeme durumu', kind: 'checkbox', selected: ['odendi'], options: [{ value: 'odendi', label: 'Ödendi', count: 7 }] },
];

const baseProps = (): FilterDrawerProps => ({
  open: true,
  onClose: vi.fn(),
  onClear: vi.fn(),
  onToggle: vi.fn(),
  facets,
  resultCount: 22,
});

function Harness(props: Partial<FilterDrawerProps>) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Filtreler</button>
      <FilterDrawer {...baseProps()} {...props} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

describe('FilterDrawer', () => {
  beforeEach(() => { deviceState.current = 'phone'; });

  it('renders nothing while closed', () => {
    render(<FilterDrawer {...baseProps()} open={false} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByTestId('filter-panel')).toBeNull();
  });

  it('is a dialog named with the active filter count and holds the bare FilterPanel', () => {
    render(<FilterDrawer {...baseProps()} openKeys={['oda']} />);
    expect(screen.getByRole('dialog', { name: 'Filtreler · 2 etkin' })).toBeInTheDocument();
    const panel = screen.getByTestId('filter-panel');
    expect(panel).toHaveAttribute('data-bare', 'true');
    expect(panel).toHaveAttribute('data-open-keys', 'oda');
    expect(screen.getByText('Ödeme durumu')).toBeInTheDocument();
  });

  it('names the dialog plainly when no filter is active', () => {
    const plain = facets.map(facet => ({ ...facet, selected: [] }));
    render(<FilterDrawer {...baseProps()} facets={plain} />);
    expect(screen.getByRole('dialog', { name: 'Filtreler' })).toBeInTheDocument();
  });

  it('phone: full-screen drawer', () => {
    render(<FilterDrawer {...baseProps()} />);
    const root = screen.getByRole('dialog').closest('.aile-drawer') as HTMLElement;
    expect(root).toHaveClass('aile-drawer--full');
    expect((document.querySelector('.aile-drawer-wrapper') as HTMLElement).style.width).toBe('100%');
  });

  it('tablet: 384 px drawer from the right', () => {
    deviceState.current = 'tablet';
    render(<FilterDrawer {...baseProps()} />);
    const root = screen.getByRole('dialog').closest('.aile-drawer') as HTMLElement;
    expect(root).toHaveClass('aile-drawer--right');
    expect(root).not.toHaveClass('aile-drawer--full');
    expect((document.querySelector('.aile-drawer-wrapper') as HTMLElement).style.width).toBe('384px');
  });

  it('footer: "{N} sonucu göster" above "Filtreleri temizle"; primary closes, secondary clears without closing', async () => {
    const user = userEvent.setup();
    const props = baseProps();
    render(<FilterDrawer {...props} />);
    const dialog = screen.getByRole('dialog');
    const buttons = screen.getAllByRole('button').filter(button => dialog.contains(button));
    expect(buttons.map(button => button.textContent)).toEqual(['Kapat', '22 sonucu göster', 'Filtreleri temizle']);

    await user.click(screen.getByRole('button', { name: 'Filtreleri temizle' }));
    expect(props.onClear).toHaveBeenCalledTimes(1);
    expect(props.onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '22 sonucu göster' }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('formats the result count in tr-TR', () => {
    render(<FilterDrawer {...baseProps()} resultCount={1250} />);
    expect(screen.getByRole('button', { name: '1.250 sonucu göster' })).toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    const props = baseProps();
    render(<FilterDrawer {...props} />);
    await user.keyboard('{Escape}');
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('moves focus into the dialog on open and back to the opener on close', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Filtreler' });
    await user.click(opener);
    const dialog = await screen.findByRole('dialog', { name: 'Filtreler · 2 etkin' });
    await waitFor(() => expect(dialog).toHaveFocus());
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(opener).toHaveFocus();
  });
});
