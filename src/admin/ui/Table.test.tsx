import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RecordRow, ResponsiveColumn } from '../shell/contracts';
import { Table } from './Table';

// Tasarım: components/Table/README.md — başlık yapışkan 14/600, sütun minWidth, tutar sağa, satır tıklanır ve
// Enter ile açılır, seçili satır `secili`, caption görsel gizli. Seçiciler role/label; antd iç sınıfı yok.
const money = (amount: string) => ({ amount, currency: 'TRY' });
const rows: RecordRow[] = [
  { id: 'r1', code: 'AL-001', label: 'Mutfak dolabı', status: { label: 'Sipariş verildi', tone: 'bilgi' }, planned: money('8500.00'), actual: null, kind: 'purchase_need' },
  { id: 'r2', code: 'AL-002', label: 'Salon halısı', status: { label: 'Teslim edildi', tone: 'olumlu' }, planned: money('3200.00'), actual: money('3150.00'), kind: 'purchase_need' },
];
const columns: ResponsiveColumn<RecordRow>[] = [
  { key: 'code', title: 'Kimlik', minWidth: 112, m: 'meta' },
  { key: 'label', title: 'Ad', minWidth: 240, m: 'title' },
  { key: 'planned', title: 'Plan', align: 'right', minWidth: 128, render: row => row.planned ? row.planned.amount : 'Fiyat yok' },
  { key: 'actual', title: 'Gerçek', align: 'right', minWidth: 128, render: row => row.actual ? row.actual.amount : 'Henüz yok' },
  { key: 'status', title: 'Durum', minWidth: 160, render: row => row.status.label },
];

const rowOf = (text: string) => screen.getByText(text).closest('tr') as HTMLTableRowElement;

describe('Table', () => {
  it('renders every column title as a column header and names the table with the caption', () => {
    render(<Table columns={columns} rows={rows} caption="Alımlar" />);
    expect(screen.getByRole('table', { name: 'Alımlar' })).toBeInTheDocument();
    const headers = screen.getAllByRole('columnheader').map(th => th.textContent);
    expect(headers).toEqual(['Kimlik', 'Ad', 'Plan', 'Gerçek', 'Durum']);
    expect(screen.getByText('Mutfak dolabı')).toBeInTheDocument();
    expect(screen.getByText('AL-002')).toBeInTheDocument();
  });

  it('keeps each column at its minimum width through the header cell', () => {
    render(<Table columns={columns} rows={rows} caption="Alımlar" />);
    expect(screen.getByRole('columnheader', { name: 'Ad' })).toHaveStyle({ minWidth: '240px' });
    expect(screen.getByRole('columnheader', { name: 'Kimlik' })).toHaveStyle({ minWidth: '112px' });
  });

  it('aligns amount columns to the right and marks their cells as tutar', () => {
    render(<Table columns={columns} rows={rows} caption="Alımlar" />);
    expect(screen.getByRole('columnheader', { name: 'Plan' })).toHaveStyle({ textAlign: 'right' });
    expect(screen.getByRole('columnheader', { name: 'Ad' })).not.toHaveStyle({ textAlign: 'right' });
    const planned = screen.getByText('8500.00').closest('td') as HTMLTableCellElement;
    expect(planned).toHaveClass('aile-tutar');
    expect(screen.getByText('Henüz yok').closest('td')).toHaveClass('aile-tutar');
    expect(screen.getByText('Mutfak dolabı').closest('td')).not.toHaveClass('aile-tutar');
  });

  it('opens a row on click and on Enter, not on other keys', async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    render(<Table columns={columns} rows={rows} caption="Alımlar" onRowClick={onRowClick} />);
    const row = rowOf('Salon halısı');
    expect(row).toHaveAttribute('tabindex', '0');

    await user.click(within(row).getByText('Salon halısı'));
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick).toHaveBeenLastCalledWith(rows[1]);

    row.focus();
    expect(row).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(onRowClick).toHaveBeenCalledTimes(1);
    await user.keyboard('{Enter}');
    expect(onRowClick).toHaveBeenCalledTimes(2);
    expect(onRowClick).toHaveBeenLastCalledWith(rows[1]);
  });

  it('does not open the row when a control inside a cell is used', async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    const withAction: ResponsiveColumn<RecordRow>[] = [
      ...columns,
      { key: 'edit', title: 'Eylem', minWidth: 96, render: () => <button type="button">Düzenle</button> },
    ];
    render(<Table columns={withAction} rows={rows} caption="Alımlar" onRowClick={onRowClick} />);
    await user.click(within(rowOf('Mutfak dolabı')).getByRole('button', { name: 'Düzenle' }));
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('leaves rows out of the tab order when nothing opens on click', () => {
    render(<Table columns={columns} rows={rows} caption="Alımlar" />);
    expect(rowOf('Mutfak dolabı')).not.toHaveAttribute('tabindex');
  });

  it('marks only the selected row with aria-selected, keyed by id', () => {
    render(<Table columns={columns} rows={rows} caption="Alımlar" selectedKey="r2" onRowClick={() => {}} />);
    expect(rowOf('Salon halısı')).toHaveAttribute('aria-selected', 'true');
    expect(rowOf('Mutfak dolabı')).not.toHaveAttribute('aria-selected');
  });

  it('accepts another row key', () => {
    render(<Table columns={columns} rows={rows} caption="Alımlar" selectedKey="AL-001" rowKey={row => row.code} />);
    expect(rowOf('Mutfak dolabı')).toHaveAttribute('aria-selected', 'true');
    expect(rowOf('Salon halısı')).not.toHaveAttribute('aria-selected');
  });

  it('names the empty state instead of showing a bare table', () => {
    render(<Table columns={columns} rows={[]} caption="Alımlar" />);
    expect(screen.getByText('Henüz yok')).toBeInTheDocument();
    expect(screen.queryByRole('row', { name: /AL-/ })).toBeNull();
  });
});
