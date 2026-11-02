import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import type { ReactNode } from 'react';
import { DeviceContext } from '../device';
import type { Device } from '../shell/contracts';
import { ConflictView, type ConflictField } from './ConflictView';

// Tasarım › components/ConflictView/README.md: aynı kaydın iki sürümü; geniş alanda yan yana, telefonda alan alan.
// Farklı alanlar uyari-yuzey ile işaretlenir; telefonda yalnız farklı alanlar + "N alan farklı · M alan aynı";
// karar düğmeleri telefonda tam genişlik, alt alta. Seçiciler role/label ile; antd iç sınıfı yok.

const fields: ConflictField[] = [
  { label: 'Ad', a: 'Mutfak dolabı', b: 'Mutfak dolabı' },
  { label: 'Planlanan', a: '₺8.500,00', b: '₺9.200,00' },
  { label: 'Oda', a: 'Mutfak', b: 'Salon' },
];
const leftLabel = 'Bu cihazdaki sürüm';
const rightLabel = 'Kaynaktaki sürüm';

function renderView(ui: ReactNode, device: Device = 'desktop') {
  return render(<DeviceContext.Provider value={device}>{ui}</DeviceContext.Provider>);
}

describe('ConflictView', () => {
  it('geniş alanda iki sürüm yan yana: her sürüm adıyla bir grup, bütün alanlar her iki tarafta', () => {
    renderView(<ConflictView fields={fields} leftLabel={leftLabel} rightLabel={rightLabel} />);
    const left = screen.getByRole('group', { name: leftLabel });
    const right = screen.getByRole('group', { name: rightLabel });
    expect(within(left).getAllByRole('term').map(term => term.textContent)).toEqual(['Ad', 'Planlanan', 'Oda']);
    expect(within(right).getAllByRole('term').map(term => term.textContent)).toEqual(['Ad', 'Planlanan', 'Oda']);
    // dd (definition) içerikten ad almaz; değerler metinle bulunur.
    expect(within(left).getByText('Mutfak dolabı')).toBeInTheDocument();
    expect(within(left).getByText('₺8.500,00')).toBeInTheDocument();
    expect(within(right).getByText('₺9.200,00')).toBeInTheDocument();
  });

  it('farklı alanlar işaretlenir (data-fark) ve yalnız renkle değil gizli "Farklı" metniyle de söylenir; aynı alanlar işaretsiz', () => {
    renderView(<ConflictView fields={fields} leftLabel={leftLabel} rightLabel={rightLabel} />);
    const left = screen.getByRole('group', { name: leftLabel });
    const definitions = within(left).getAllByRole('definition');
    expect(definitions).toHaveLength(3);
    expect(definitions[0]).not.toHaveAttribute('data-fark');
    expect(definitions[0]).toHaveTextContent(/^Mutfak dolabı$/);
    expect(definitions[1]).toHaveAttribute('data-fark', 'true');
    expect(definitions[1]).toHaveTextContent(/^Farklı: ₺8\.500,00$/);
    expect(definitions[2]).toHaveAttribute('data-fark', 'true');
    // Sağ taraftaki farklı alan da işaretlidir.
    const right = screen.getByRole('group', { name: rightLabel });
    expect(within(right).getAllByRole('definition')[1]).toHaveAttribute('data-fark', 'true');
  });

  it('özet satırı "N alan farklı · M alan aynı" her iki cihazda da yazılır', () => {
    const { unmount } = renderView(<ConflictView fields={fields} leftLabel={leftLabel} rightLabel={rightLabel} />);
    expect(screen.getByText('2 alan farklı · 1 alan aynı')).toBeInTheDocument();
    unmount();
    renderView(<ConflictView fields={fields} leftLabel={leftLabel} rightLabel={rightLabel} />, 'phone');
    expect(screen.getByText('2 alan farklı · 1 alan aynı')).toBeInTheDocument();
  });

  it('geniş alanda karar düğmeleri kendi sütununda: sol birincil, sağ ikincil; tam genişlik değil', () => {
    renderView(<ConflictView fields={fields} leftLabel={leftLabel} rightLabel={rightLabel} />);
    const left = screen.getByRole('group', { name: leftLabel });
    const right = screen.getByRole('group', { name: rightLabel });
    const keep = within(left).getByRole('button', { name: 'Bunu tut' });
    const take = within(right).getByRole('button', { name: 'Diğerini al' });
    expect(keep).toHaveAttribute('data-variant', 'primary');
    expect(take).toHaveAttribute('data-variant', 'secondary');
    expect(keep).not.toHaveClass('aile-btn--blok');
    expect(take).not.toHaveClass('aile-btn--blok');
  });

  it('telefonda yalnız farklı alanlar listelenir; her alan için iki sürüm adıyla değer', () => {
    renderView(<ConflictView fields={fields} leftLabel={leftLabel} rightLabel={rightLabel} />, 'phone');
    // Aynı olan "Ad" alanı yazılmaz.
    expect(screen.queryByText('Ad')).toBeNull();
    expect(screen.queryByText('Mutfak dolabı')).toBeNull();
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    const first = items[0];
    expect(within(first).getByText('Planlanan')).toBeInTheDocument();
    expect(within(first).getAllByRole('term').map(term => term.textContent)).toEqual([leftLabel, rightLabel]);
    const values = within(first).getAllByRole('definition');
    expect(values[0]).toHaveTextContent('₺8.500,00');
    expect(values[0]).toHaveAttribute('data-fark', 'true');
    expect(values[1]).toHaveTextContent('₺9.200,00');
    expect(values[1]).toHaveAttribute('data-fark', 'true');
    // Yan yana sürüm grupları telefonda çizilmez.
    expect(screen.queryByRole('group', { name: leftLabel })).toBeNull();
  });

  it('telefonda karar düğmeleri listenin altında, tam genişlik, alt alta: sol birincil üstte', () => {
    renderView(<ConflictView fields={fields} leftLabel={leftLabel} rightLabel={rightLabel} />, 'phone');
    const buttons = screen.getAllByRole('button');
    expect(buttons.map(button => button.textContent)).toEqual(['Bunu tut', 'Diğerini al']);
    for (const button of buttons) expect(button).toHaveClass('aile-btn--blok');
    expect(buttons[0]).toHaveAttribute('data-variant', 'primary');
    expect(buttons[1]).toHaveAttribute('data-variant', 'secondary');
    // Liste düğmelerden önce gelir (okuma sırası = odak sırası).
    const list = screen.getByRole('list');
    expect(list.compareDocumentPosition(buttons[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('verilen eylem etiketleri kullanılır ve tıklama kendi geri çağrısını tetikler', async () => {
    const user = userEvent.setup();
    const onLeft = vi.fn();
    const onRight = vi.fn();
    renderView(
      <ConflictView fields={fields} leftLabel={leftLabel} rightLabel={rightLabel} leftAction="Cihazdakini tut" rightAction="Kaynaktakini al" onLeftAction={onLeft} onRightAction={onRight} />,
    );
    await user.click(screen.getByRole('button', { name: 'Cihazdakini tut' }));
    expect(onLeft).toHaveBeenCalledTimes(1);
    expect(onRight).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Kaynaktakini al' }));
    expect(onRight).toHaveBeenCalledTimes(1);
    expect(onLeft).toHaveBeenCalledTimes(1);
  });

  it('boş değer saklanmaz, "Henüz yok" yazılır ve dolu değerle farklı sayılır', () => {
    renderView(<ConflictView fields={[{ label: 'Not', a: '', b: 'Teslimat kapıya' }]} leftLabel={leftLabel} rightLabel={rightLabel} />);
    const left = screen.getByRole('group', { name: leftLabel });
    const empty = within(left).getByRole('definition');
    expect(empty).toHaveTextContent('Henüz yok');
    expect(empty).toHaveAttribute('data-fark', 'true');
    expect(screen.getByText('1 alan farklı · 0 alan aynı')).toBeInTheDocument();
  });

  it('fark yoksa telefonda liste boş kalır, özet bunu söyler ve karar düğmeleri yine vardır', () => {
    const same: ConflictField[] = [{ label: 'Ad', a: 'Halı', b: 'Halı' }];
    renderView(<ConflictView fields={same} leftLabel={leftLabel} rightLabel={rightLabel} />, 'phone');
    expect(screen.getByText('0 alan farklı · 1 alan aynı')).toBeInTheDocument();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('ham antd / phosphor paketini değil ui/Button ve ../device kaynaklarını kullanır', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve(__dirname, 'ConflictView.tsx'), 'utf8');
    expect(source).not.toMatch(/from ['"]antd['"]/);
    expect(source).not.toContain('@ant-design/');
    expect(source).not.toContain('@phosphor-icons/');
    expect(source).toContain("from './Button'");
    expect(source).toContain("from '../device'");
  });
});
