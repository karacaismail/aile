import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState, type ReactNode } from 'react';
import { Drawer, type DrawerProps } from './Drawer';

// Tasarım: components/Drawer/README.md — görünür "Kapat", Escape kapatır, açılınca odak çekmeceye girer,
// kapanınca açan düğmeye (ya da returnFocusTo) döner. Seçiciler role/label; antd iç sınıfı yok.

type HarnessProps = Partial<Omit<DrawerProps, 'title' | 'open' | 'onClose' | 'returnFocusTo'>> & {
  /** true: ikinci düğme ("Hedef") returnFocusTo olur. */
  returnToTarget?: boolean;
  children?: ReactNode;
};

function Harness({ returnToTarget, children, ...rest }: HarnessProps) {
  const [open, setOpen] = useState(false);
  const target = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Filtreleri aç</button>
      <button type="button" ref={target}>Hedef</button>
      <Drawer title="Filtreler" open={open} onClose={() => setOpen(false)} returnFocusTo={returnToTarget ? target : undefined} {...rest}>
        {children ?? <p>Oda ve kategori süzgeçleri</p>}
      </Drawer>
    </>
  );
}

describe('Drawer', () => {
  it('renders nothing while closed', () => {
    render(<Drawer title="Filtreler" open={false}><p>Gizli</p></Drawer>);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('Gizli')).toBeNull();
  });

  it('is a modal dialog named by its heading, with content, footer and a visible Kapat button', () => {
    render(
      <Drawer title="Filtreler" footer={<button type="button">Uygula</button>}>
        <p>Oda ve kategori süzgeçleri</p>
      </Drawer>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Filtreler' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('heading', { level: 2, name: 'Filtreler' })).toBeInTheDocument();
    expect(screen.getByText('Oda ve kategori süzgeçleri')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Uygula' })).toBeInTheDocument();
    const close = screen.getByRole('button', { name: 'Kapat' });
    expect(close).toBeVisible();
    expect(close).toHaveTextContent('Kapat');
  });

  it('lets the caller rename the close button', () => {
    render(<Drawer title="Sayfalar" closeLabel="Menüyü kapat" />);
    expect(screen.getByRole('button', { name: 'Menüyü kapat' })).toBeInTheDocument();
  });

  it('calls onClose from the Kapat button', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Drawer title="Filtreler" onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: 'Kapat' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose on Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Drawer title="Filtreler" onClose={onClose} />);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when the mask is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Drawer title="Filtreler" onClose={onClose} />);
    const mask = document.querySelector('.aile-drawer-mask');
    expect(mask).not.toBeNull();
    await user.click(mask as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('moves focus to the dialog on open; Tab reaches Kapat first, then the content', async () => {
    const user = userEvent.setup();
    render(<Harness><button type="button">Uygula</button></Harness>);
    await user.click(screen.getByRole('button', { name: 'Filtreleri aç' }));
    const dialog = await screen.findByRole('dialog', { name: 'Filtreler' });
    await waitFor(() => expect(dialog).toHaveFocus());
    await user.tab();
    expect(screen.getByRole('button', { name: 'Kapat' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Uygula' })).toHaveFocus();
  });

  it('returns focus to the opener after closing', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Filtreleri aç' });
    await user.click(opener);
    const dialog = await screen.findByRole('dialog', { name: 'Filtreler' });
    await waitFor(() => expect(dialog).toHaveFocus());
    await user.click(screen.getByRole('button', { name: 'Kapat' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(opener).toHaveFocus();
  });

  it('returns focus to returnFocusTo when given', async () => {
    const user = userEvent.setup();
    render(<Harness returnToTarget />);
    await user.click(screen.getByRole('button', { name: 'Filtreleri aç' }));
    const dialog = await screen.findByRole('dialog', { name: 'Filtreler' });
    await waitFor(() => expect(dialog).toHaveFocus());
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('button', { name: 'Hedef' })).toHaveFocus();
  });

  it('uses 384 px on the right by default; side, full and tone map to root classes', () => {
    const root = () => screen.getByRole('dialog').closest('.aile-drawer') as HTMLElement;
    const wrapper = () => document.querySelector('.aile-drawer-wrapper') as HTMLElement;
    const first = render(<Drawer title="Filtreler" />);
    expect(root()).toHaveClass('aile-drawer--right');
    expect(root()).not.toHaveClass('aile-drawer--nav');
    expect(wrapper().style.width).toBe('384px');
    first.unmount();

    const second = render(<Drawer title="Sayfalar" side="left" tone="nav" width={272} />);
    expect(root()).toHaveClass('aile-drawer--left');
    expect(root()).toHaveClass('aile-drawer--nav');
    expect(wrapper().style.width).toBe('272px');
    second.unmount();

    render(<Drawer title="Filtreler" full />);
    expect(root()).toHaveClass('aile-drawer--full');
    expect(wrapper().style.width).toBe('100%');
  });

  it('renders inline (no portal) when asked', () => {
    const { container } = render(<Drawer title="Filtreler" inline />);
    expect(container.contains(screen.getByRole('dialog'))).toBe(true);
  });
});
