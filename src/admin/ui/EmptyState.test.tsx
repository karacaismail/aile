import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EmptyState } from './EmptyState';

// Tasarım: components/Empty/README.md + bundle.js Empty. Filtre varsa etkin filtreler kaldırılabilir etiket olarak
// + "Filtreleri temizle"; filtre yoksa "Henüz kayıt yok" + title/message/action. Büyük çizim ya da renkli şerit yok.
const makeFilters = () => [
  { id: 'oda:salon', label: 'Oda: Salon', onRemove: vi.fn() },
  { id: 'durum:siparis', label: 'Durum: Sipariş verildi', onRemove: vi.fn() },
];

describe('EmptyState', () => {
  describe('filtresiz boşluk', () => {
    it('says "Henüz kayıt yok" in a status region and offers the given action', async () => {
      const onAdd = vi.fn();
      render(<EmptyState action={<button type="button" onClick={onAdd}>Alım ekle</button>} />);
      const status = screen.getByRole('status');
      expect(within(status).getByRole('heading', { level: 2, name: 'Henüz kayıt yok' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Filtreleri temizle' })).toBeNull();
      expect(screen.queryByText('Etkin filtreler:')).toBeNull();
      await userEvent.setup().click(within(status).getByRole('button', { name: 'Alım ekle' }));
      expect(onAdd).toHaveBeenCalledTimes(1);
    });

    it('renders a custom title and message, and no paragraph when no message is given', () => {
      const { rerender } = render(<EmptyState title="Ödeme kaydı yok" message="Kaynakta kayıt yok." />);
      expect(screen.getByRole('heading', { level: 2, name: 'Ödeme kaydı yok' })).toBeInTheDocument();
      expect(screen.getByText('Kaynakta kayıt yok.')).toBeInTheDocument();
      rerender(<EmptyState />);
      expect(screen.getByRole('heading', { level: 2, name: 'Henüz kayıt yok' })).toBeInTheDocument();
      expect(screen.getByRole('status').querySelectorAll('p')).toHaveLength(0);
    });

    it('treats an empty filters array as no filters', () => {
      render(<EmptyState filters={[]} onClear={() => {}} />);
      expect(screen.getByRole('heading', { level: 2, name: 'Henüz kayıt yok' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Filtreleri temizle' })).toBeNull();
    });
  });

  describe('etkin filtrelerle boşluk', () => {
    it('lists the active filters with removal buttons and a clear action that replaces the action slot', async () => {
      const user = userEvent.setup();
      const filters = makeFilters();
      const onClear = vi.fn();
      render(<EmptyState filters={filters} onClear={onClear} message="Gizlenir" action={<button type="button">Alım ekle</button>} />);
      expect(screen.getByRole('heading', { level: 2, name: 'Bu filtrelerle kayıt yok' })).toBeInTheDocument();
      const list = screen.getByRole('list', { name: 'Etkin filtreler:' });
      expect(within(list).getAllByRole('listitem').map(li => li.textContent)).toEqual(['Oda: Salon', 'Durum: Sipariş verildi']);
      await user.click(screen.getByRole('button', { name: 'Filtreyi kaldır: Oda: Salon' }));
      expect(filters[0].onRemove).toHaveBeenCalledTimes(1);
      expect(filters[1].onRemove).not.toHaveBeenCalled();
      await user.click(screen.getByRole('button', { name: 'Filtreleri temizle' }));
      expect(onClear).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('button', { name: 'Alım ekle' })).toBeNull();
      expect(screen.queryByText('Gizlenir')).toBeNull();
    });

    it('keeps a custom title over the filter default', () => {
      render(<EmptyState filters={makeFilters()} onClear={() => {}} title="Bu odada alım yok" />);
      expect(screen.getByRole('heading', { level: 2, name: 'Bu odada alım yok' })).toBeInTheDocument();
    });

    it('accepts plain label strings (design filters[]) without removal buttons', () => {
      render(<EmptyState filters={['Oda: Salon', 'Kategori: Aydınlatma']} onClear={() => {}} />);
      expect(within(screen.getByRole('list')).getAllByRole('listitem').map(li => li.textContent)).toEqual(['Oda: Salon', 'Kategori: Aydınlatma']);
      expect(screen.queryByRole('button', { name: /Filtreyi kaldır/ })).toBeNull();
      expect(screen.getByRole('button', { name: 'Filtreleri temizle' })).toBeInTheDocument();
    });

    it('removal buttons carry the shared focus-line hook and a decorative close icon', () => {
      render(<EmptyState filters={makeFilters()} onClear={() => {}} />);
      const remove = screen.getByRole('button', { name: 'Filtreyi kaldır: Oda: Salon' });
      expect(remove).toHaveAttribute('type', 'button');
      expect(remove).toHaveAttribute('data-focus-line');
      const svg = remove.querySelector('svg');
      expect(svg).toHaveAttribute('aria-hidden', 'true');
      expect(svg).toHaveAttribute('data-icon', 'close');
    });
  });

  it('draws no illustration: no antd Empty, no images, only decorative Phosphor icons', () => {
    render(<EmptyState filters={makeFilters()} onClear={() => {}} />);
    const status = screen.getByRole('status');
    expect(status.querySelector('img')).toBeNull();
    for (const svg of status.querySelectorAll('svg')) expect(svg).toHaveAttribute('data-icon');
    const source = readFileSync(resolve(__dirname, 'EmptyState.tsx'), 'utf8');
    expect(source).not.toMatch(/import\s*\{[^}]*\bEmpty\b[^}]*\}\s*from\s*['"]\.\/antd['"]/);
    expect(source).not.toMatch(/from\s+['"](antd|@ant-design\/)/);
  });
});
