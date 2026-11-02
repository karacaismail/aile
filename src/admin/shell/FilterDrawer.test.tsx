import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useState } from 'react';
import type { FilterFacet, FilterPanelProps } from './contracts';
import { FilterDrawer, activeFilterCount, type FilterDrawerProps } from './FilterDrawer';

// Tasarım: README › Sayfa iskeleti 4 ve Uyarlanır teslim tablosu; bu projede telefon filtreleri ALT SAYFADA açar
// (ui/BottomSheet; görev b03 kararı: seçim/menü/diyalog/filtre telefonda alt sayfa), tablet sağdan 384 (ui/Drawer).
// Başlık "Filtreler · N etkin"; altlıkta sonuç sayısı durum metni + "Temizle" (onClear, açık kalır) ve "Uygula"
// (kapatır; filtreler onToggle ile anında uygulanır, durum çağıranda kalır). Seçiciler role/label.

// FilterPanel ayrı görevde gerçek bileşen olur; burada aldığı props'u görünür kılan düz bir yer tutucu.
vi.mock('./FilterPanel', async importOriginal => ({
  ...(await importOriginal<typeof import('./FilterPanel')>()),
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

  it('phone: alttan açılan sayfa (BottomSheet), tam ekran değil; çekmece değil', () => {
    render(<FilterDrawer {...baseProps()} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.closest('.aile-sheet')).not.toBeNull();
    expect(dialog.closest('.aile-sheet--full')).toBeNull();
    expect(dialog.closest('.aile-drawer')).toBeNull();
    expect(dialog.querySelector('[data-yuzey="alt-sayfa"]')).not.toBeNull();
  });

  it('tablet: 384 px drawer from the right', () => {
    deviceState.current = 'tablet';
    render(<FilterDrawer {...baseProps()} />);
    const root = screen.getByRole('dialog').closest('.aile-drawer') as HTMLElement;
    expect(root).toHaveClass('aile-drawer--right');
    expect(root).not.toHaveClass('aile-drawer--full');
    expect((document.querySelector('.aile-drawer-wrapper') as HTMLElement).style.width).toBe('384px');
    expect(screen.getByRole('dialog').querySelector('[data-yuzey="cekmece"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Uygula' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Temizle' })).toBeInTheDocument();
  });

  it('altlık: sonuç sayısı durum metni, "Temizle" ve "Uygula"; Uygula kapatır, Temizle temizler ve açık kalır', async () => {
    const user = userEvent.setup();
    const props = baseProps();
    render(<FilterDrawer {...props} />);
    const dialog = screen.getByRole('dialog');
    const buttons = screen.getAllByRole('button').filter(button => dialog.contains(button));
    expect(buttons.map(button => button.textContent)).toEqual(['Kapat', 'Temizle', 'Uygula']);
    expect(screen.queryByRole('button', { name: /sonucu göster/ })).toBeNull();
    const status = screen.getAllByRole('status').find(node => dialog.contains(node));
    expect(status).toHaveTextContent('22 sonuç');

    await user.click(screen.getByRole('button', { name: 'Temizle' }));
    expect(props.onClear).toHaveBeenCalledTimes(1);
    expect(props.onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Uygula' }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('formats the result count in tr-TR', () => {
    render(<FilterDrawer {...baseProps()} resultCount={1250} />);
    const dialog = screen.getByRole('dialog');
    expect(screen.getAllByRole('status').find(node => dialog.contains(node))).toHaveTextContent('1.250 sonuç');
  });

  it('etkin sayı yalnız gerçek seçimleri sayar: tarih türü ve boş aralık girdisi sayılmaz', () => {
    const tarihli: readonly FilterFacet[] = [
      ...facets,
      { id: 'tarih', label: 'Tarih', kind: 'date', selected: ['siparis', 'bitis='], options: [{ value: 'teslim', label: 'Planlanan teslim' }, { value: 'siparis', label: 'Sipariş' }] },
      { id: 'tutar', label: 'Tutar aralığı', kind: 'amount', selected: ['enaz=1000'], options: [] },
    ];
    expect(activeFilterCount(tarihli)).toBe(3);
    render(<FilterDrawer {...baseProps()} facets={tarihli} />);
    expect(screen.getByRole('dialog', { name: 'Filtreler · 3 etkin' })).toBeInTheDocument();
  });

  it('CSS: altlık eylemleri yan yana tam genişlik, 44 px hedef, kaba girişte 48 px; yalnız token', () => {
    const css = readFileSync(resolve(__dirname, 'FilterDrawer.css'), 'utf8');
    expect(readFileSync(resolve(__dirname, 'FilterDrawer.tsx'), 'utf8')).toContain("import './FilterDrawer.css'");
    // Merkezi uyarlamalı hedef tokenı (b04, admin.css): 44 px, kaba girişte ([data-input-coarse]) 48 px; yerelde yeniden türetilmez.
    // Üç sınıflı seçici (0,3,0): ui/Button.css tabanı (button.ant-btn.aile-btn, 0,2,1) kaba girişte 48'i ezmesin.
    expect(css).toMatch(/\.aile-filtre-altlik\s+\.aile-filtre-altlik-eylemler\s*>\s*\.aile-filtre-altlik-dugme\s*\{[^}]*min-height:\s*var\(--aile-dokunma-hedefi\)/);
    expect(css).not.toMatch(/data-input-coarse|calc\(var\(--aile-hedef-asgari\)/);
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/^\s*(outline|box-shadow)\s*:/m);
    expect((css.match(/\b\d+px\b/g) ?? []).filter(value => value !== '1px')).toEqual([]);
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
