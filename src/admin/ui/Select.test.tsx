import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, type ReactNode } from 'react';
import { DeviceContext } from '../device';
import type { Device } from '../shell/contracts';
import { Select, UNKNOWN_VALUE, type SelectOption } from './Select';

// BottomSheet komşu görevde gerçek bileşen olur (şu an stub). Burada yalnız sözleşmesi taklit edilir
// (title, open, onClose, children; index.d.ts › BottomSheetProps) ki Select'in telefonda listeyi alttan
// açtığı, BottomSheet'in kendi uygulamasından bağımsız doğrulansın.
vi.mock('./BottomSheet', async () => {
  const React = await import('react');
  return {
    BottomSheet: (props: { title: string; open?: boolean; onClose?(): void; children?: ReactNode }) =>
      props.open === false
        ? null
        : React.createElement(
            'div',
            { role: 'dialog', 'aria-modal': 'true', 'aria-label': props.title },
            React.createElement('button', { type: 'button', onClick: props.onClose }, 'Kapat'),
            props.children,
          ),
  };
});

const onDevice = (device: Device) => ({ children }: { children: ReactNode }) =>
  createElement(DeviceContext.Provider, { value: device }, children);

const odalar: readonly SelectOption[] = [
  { value: 'mutfak', label: 'Mutfak' },
  { value: 'salon', label: 'Salon' },
  { value: 'yatak', label: 'Yatak odası', disabled: true, note: 'Önce teslim gerekir' },
];
// 9 seçenek: 8 eşiğinin üstü → arama açılır.
const uzunListe: readonly SelectOption[] = Array.from({ length: 9 }, (_, i) => ({ value: `oda-${i + 1}`, label: `Oda ${i + 1}` }));

describe('Select › masaüstü', () => {
  const wrapper = onDevice('desktop');

  it('etiketiyle adlandırılan bir combobox sunar; native select yoktur', () => {
    const { container } = render(<Select label="Oda" options={odalar} />, { wrapper });
    expect(screen.getByRole('combobox', { name: 'Oda' })).toBeInTheDocument();
    expect(container.querySelector('select')).toBeNull();
    expect(screen.getByText('Seçin')).toBeInTheDocument();
  });

  it('seçenekleri listeler, seçili olanı işaretler ve seçim onChange verir', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Select label="Oda" options={odalar} value="salon" onChange={onChange} />, { wrapper });
    await user.click(screen.getByRole('combobox', { name: 'Oda' }));
    const list = await screen.findByRole('listbox');
    expect(within(list).getByRole('option', { name: 'Salon' })).toHaveAttribute('aria-selected', 'true');
    expect(within(list).getByRole('option', { name: 'Mutfak' })).toHaveAttribute('aria-selected', 'false');
    await user.click(within(list).getByRole('option', { name: 'Mutfak' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('mutfak');
  });

  it('devre dışı seçenek nedenini note ile söyler ve seçilemez', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Select label="Oda" options={odalar} onChange={onChange} />, { wrapper });
    await user.click(screen.getByRole('combobox', { name: 'Oda' }));
    const option = await screen.findByRole('option', { name: 'Yatak odası' });
    expect(option).toHaveAttribute('aria-disabled', 'true');
    expect(within(option).getByText('Önce teslim gerekir')).toBeInTheDocument();
    await user.click(option);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('includeUnknown ile "Bilinmiyor" bir seçenek olarak gelir', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Select label="Oda" options={odalar} includeUnknown onChange={onChange} />, { wrapper });
    await user.click(screen.getByRole('combobox', { name: 'Oda' }));
    await user.click(await screen.findByRole('option', { name: 'Bilinmiyor' }));
    expect(onChange).toHaveBeenCalledWith(UNKNOWN_VALUE);
  });

  it('8 ve daha az seçenekte yazılamaz; 9+ seçenekte arama açılır ve listeyi süzer', async () => {
    const user = userEvent.setup();
    const kisa = render(<Select label="Oda" options={odalar} />, { wrapper });
    expect(screen.getByRole('combobox', { name: 'Oda' })).toHaveAttribute('readonly');
    kisa.unmount();

    render(<Select label="Oda" options={uzunListe} />, { wrapper });
    const combobox = screen.getByRole('combobox', { name: 'Oda' });
    expect(combobox).not.toHaveAttribute('readonly');
    await user.click(combobox);
    await user.keyboard('9');
    const list = await screen.findByRole('listbox');
    expect(within(list).getAllByRole('option')).toHaveLength(1);
    expect(within(list).getByRole('option', { name: 'Oda 9' })).toBeInTheDocument();
  });

  it('yardım ve hata metnini alana bağlar; hata "Hata:" ile başlar', () => {
    const { rerender } = render(<Select label="Oda" options={odalar} help="Teslim adresi için" />, { wrapper });
    const combobox = screen.getByRole('combobox', { name: 'Oda' });
    expect(combobox).toHaveAccessibleDescription('Teslim adresi için');
    expect(combobox).not.toHaveAttribute('aria-invalid');

    rerender(<Select label="Oda" options={odalar} help="Teslim adresi için" error="Oda seçilmedi" />);
    expect(combobox).toHaveAccessibleDescription('Hata: Oda seçilmedi');
    expect(combobox).toHaveAttribute('aria-invalid', 'true');
  });

  it('Escape listeyi kapatır', async () => {
    const user = userEvent.setup();
    render(<Select label="Oda" options={odalar} />, { wrapper });
    const combobox = screen.getByRole('combobox', { name: 'Oda' });
    await user.click(combobox);
    await screen.findByRole('listbox');
    expect(combobox).toHaveAttribute('aria-expanded', 'true');
    // rc-select Escape'i event.which (27) ile tanır; user-event 14 which/keyCode göndermez (tarayıcı gönderir),
    // bu yüzden tuş fireEvent ile verilir. Kapanış bir macrotask (MessageChannel) sonra uygulanır.
    fireEvent.keyDown(combobox, { key: 'Escape', code: 'Escape', keyCode: 27, which: 27 });
    await waitFor(() => expect(combobox).toHaveAttribute('aria-expanded', 'false'));
  });

  it('hideLabel etiketi gizler ama erişilebilir adı korur', () => {
    render(<Select label="Oda" options={odalar} hideLabel />, { wrapper });
    expect(screen.getByRole('combobox', { name: 'Oda' })).toBeInTheDocument();
    expect(screen.getByText('Oda')).toBeInTheDocument();
  });

  it('devre dışı alan açılmaz', async () => {
    const user = userEvent.setup();
    render(<Select label="Oda" options={odalar} disabled />, { wrapper });
    const combobox = screen.getByRole('combobox', { name: 'Oda' });
    expect(combobox).toBeDisabled();
    await user.click(combobox);
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

describe('Select › telefon', () => {
  const wrapper = onDevice('phone');

  it('listeyi alttan açılan diyalogda sunar; seçim onChange verir ve diyaloğu kapatır', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = render(<Select label="Oda" options={odalar} value="salon" onChange={onChange} />, { wrapper });
    expect(container.querySelector('select')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.click(screen.getByRole('combobox', { name: 'Oda' }));
    const dialog = await screen.findByRole('dialog', { name: 'Oda' });
    const list = within(dialog).getByRole('listbox');
    expect(within(list).getByRole('option', { name: 'Salon' })).toHaveAttribute('aria-selected', 'true');
    const disabledOption = within(list).getByRole('option', { name: 'Yatak odası' });
    expect(disabledOption).toHaveAttribute('aria-disabled', 'true');
    expect(within(disabledOption).getByText('Önce teslim gerekir')).toBeInTheDocument();

    await user.click(disabledOption);
    expect(onChange).not.toHaveBeenCalled();

    await user.click(within(list).getByRole('option', { name: 'Mutfak' }));
    expect(onChange).toHaveBeenCalledWith('mutfak');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('9+ seçenekte diyaloğun üstünde arama alanı vardır ve listeyi süzer', async () => {
    const user = userEvent.setup();
    render(<Select label="Oda" options={uzunListe} />, { wrapper });
    await user.click(screen.getByRole('combobox', { name: 'Oda' }));
    const dialog = await screen.findByRole('dialog', { name: 'Oda' });
    expect(within(dialog).getAllByRole('option')).toHaveLength(9);
    await user.type(within(dialog).getByRole('searchbox', { name: 'Seçeneklerde ara' }), '9');
    expect(within(dialog).getAllByRole('option')).toHaveLength(1);
    expect(within(dialog).getByRole('option', { name: 'Oda 9' })).toBeInTheDocument();
  });

  it('8 ve daha az seçenekte diyalogda arama yoktur; "Kapat" seçim yapmadan kapatır', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Select label="Oda" options={odalar} onChange={onChange} />, { wrapper });
    await user.click(screen.getByRole('combobox', { name: 'Oda' }));
    const dialog = await screen.findByRole('dialog', { name: 'Oda' });
    expect(within(dialog).queryByRole('searchbox')).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Kapat' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('ok tuşları listede gezer, Enter seçer', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Select label="Oda" options={odalar} onChange={onChange} />, { wrapper });
    await user.click(screen.getByRole('combobox', { name: 'Oda' }));
    const dialog = await screen.findByRole('dialog', { name: 'Oda' });
    const first = within(dialog).getByRole('option', { name: 'Mutfak' });
    first.focus();
    await user.keyboard('{ArrowDown}');
    expect(within(dialog).getByRole('option', { name: 'Salon' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith('salon');
  });
});
