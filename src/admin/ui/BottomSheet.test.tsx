import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState, type ReactNode } from 'react';
import { BottomSheet, type BottomSheetProps } from './BottomSheet';

// Tasarım: components/BottomSheet/README.md — tutamaç, başlık, görünür "Kapat"; Escape kapatır; odak içeri girer,
// kapanınca açan düğmeye döner; en çok %85, iç kaydırma, safe-area-inset-bottom. Referans davranış bundle.js
// BottomSheet/useModal (örtü tıklaması da kapatır). Seçiciler role/label; antd iç sınıfı yok, yalnız kendi sınıflarımız.

const title = 'Oda seç';
const body = 'Mutfak, Salon, Yatak odası';

type HarnessProps = Partial<Omit<BottomSheetProps, 'title' | 'open' | 'onClose' | 'returnFocusTo'>> & {
  /** true: ikinci düğme ("Hedef") returnFocusTo olur. */
  returnToTarget?: boolean;
  children?: ReactNode;
};

function Harness({ returnToTarget, children, ...rest }: HarnessProps) {
  const [open, setOpen] = useState(false);
  const target = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Odayı seç</button>
      <button type="button" ref={target}>Hedef</button>
      <BottomSheet title={title} open={open} onClose={() => setOpen(false)} returnFocusTo={returnToTarget ? target : undefined} {...rest}>
        {children ?? <p>{body}</p>}
      </BottomSheet>
    </>
  );
}

describe('BottomSheet', () => {
  it('open=false iken hiçbir şey çizmez', () => {
    render(<BottomSheet title={title} open={false}><p>Gizli</p></BottomSheet>);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('Gizli')).toBeNull();
  });

  it('başlığıyla adlandırılan modal diyalog: h2, gövde, altlık ve görünür Kapat', () => {
    render(
      <BottomSheet title={title} footer={<button type="button">Uygula</button>}>
        <p>{body}</p>
      </BottomSheet>,
    );
    const dialog = screen.getByRole('dialog', { name: title });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('heading', { level: 2, name: title })).toBeInTheDocument();
    expect(screen.getByText(body)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Uygula' })).toBeInTheDocument();
    const close = screen.getByRole('button', { name: 'Kapat' });
    expect(close).toBeVisible();
    expect(close).toHaveTextContent('Kapat');
    // Yalnız bizim düğmeler: antd'nin kendi X kapatıcısı çizilmez.
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('tutamaç süsleyicidir: aria-hidden, metinsiz, diyaloğun içinde', () => {
    render(<BottomSheet title={title}><p>{body}</p></BottomSheet>);
    const dialog = screen.getByRole('dialog', { name: title });
    const grip = dialog.querySelector('.aile-sheet-tutamac');
    expect(grip).not.toBeNull();
    expect(grip).toHaveAttribute('aria-hidden', 'true');
    expect(grip).toHaveTextContent('');
  });

  it('Kapat düğmesi onClose çağırır', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<BottomSheet title={title} onClose={onClose}><p>{body}</p></BottomSheet>);
    await user.click(screen.getByRole('button', { name: 'Kapat' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape onClose çağırır', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<BottomSheet title={title} onClose={onClose}><p>{body}</p></BottomSheet>);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('örtüye tıklama onClose çağırır (referans scrim)', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<BottomSheet title={title} onClose={onClose}><p>{body}</p></BottomSheet>);
    const mask = document.querySelector('.aile-sheet-ortu');
    expect(mask).not.toBeNull();
    await user.click(mask as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('açılışta odak sayfaya girer; Tab önce Kapat, sonra altlık düğmesine ulaşır', async () => {
    const user = userEvent.setup();
    render(<Harness footer={<button type="button">Uygula</button>} />);
    const opener = screen.getByRole('button', { name: 'Odayı seç' });
    await user.click(opener);
    const dialog = await screen.findByRole('dialog', { name: title });
    await waitFor(() => expect(document.activeElement).not.toBe(opener));
    const active = document.activeElement as HTMLElement;
    expect(active).not.toBe(document.body);
    expect(active.contains(opener)).toBe(false);
    expect(active.contains(dialog) || dialog.contains(active)).toBe(true);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Kapat' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Uygula' })).toHaveFocus();
  });

  it('kapanınca odak açan düğmeye döner', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Odayı seç' });
    await user.click(opener);
    await screen.findByRole('dialog', { name: title });
    await user.click(screen.getByRole('button', { name: 'Kapat' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it('returnFocusTo verilirse odak oraya döner', async () => {
    const user = userEvent.setup();
    render(<Harness returnToTarget />);
    await user.click(screen.getByRole('button', { name: 'Odayı seç' }));
    await screen.findByRole('dialog', { name: title });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Hedef' })).toHaveFocus());
  });

  it('odak içeri girmeden Escape ile kapatılsa da dönüş returnFocusTo hedefine yapılır', async () => {
    // Odak girişi bir sonraki karede olur; o kareden önce gelen Escape'te açan öğe hâlâ odaklıdır ve React commit sonunda
    // odağı ona geri vermeye çalışır. Dönüş yine hedefe gitmelidir.
    // "Kare henüz gelmedi" durumu duvar saatine bırakılmaz: jsdom kareleri 16 ms'lik gerçek aralıkla çalıştırır ve soğuk
    // ilk açılış (antd stil enjeksiyonu) bundan uzun sürünce kare user.click sırasında gelip odağı panele taşıyordu.
    // Bu yüzden Escape'e kadar istenen kareler tutulur, Escape'ten sonra iptal edilmeyenler gerçek kareye bırakılır.
    const held = new Map<number, FrameRequestCallback>();
    let heldId = 1_000_000;
    const realRequest = window.requestAnimationFrame.bind(window);
    const realCancel = window.cancelAnimationFrame.bind(window);
    const request = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      heldId += 1;
      held.set(heldId, callback);
      return heldId;
    });
    const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      if (!held.delete(id)) realCancel(id);
    });
    const release = () => {
      request.mockRestore();
      cancel.mockRestore();
      const pending = [...held.values()];
      held.clear();
      pending.forEach((callback) => realRequest(callback));
    };
    try {
      const user = userEvent.setup({ delay: null });
      render(<Harness returnToTarget />);
      const opener = screen.getByRole('button', { name: 'Odayı seç' });
      await user.click(opener);
      expect(screen.getByRole('dialog', { name: title })).toBeInTheDocument();
      // Odak girişi kareye ertelendi ve o kare henüz gelmedi.
      expect(request).toHaveBeenCalled();
      expect(opener).toHaveFocus();
      await user.keyboard('{Escape}');
      release();
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      await waitFor(() => expect(screen.getByRole('button', { name: 'Hedef' })).toHaveFocus());
    } finally {
      release();
    }
  });

  it('alttan açılır: yükseklik içeriğe göre (auto), full ise tam ekran (100%)', () => {
    const { unmount } = render(<BottomSheet title={title}><p>{body}</p></BottomSheet>);
    const root = () => screen.getByRole('dialog').closest('.aile-sheet') as HTMLElement;
    const wrapper = () => document.querySelector('.aile-sheet-sarmal') as HTMLElement;
    expect(root()).not.toBeNull();
    expect(root()).not.toHaveClass('aile-sheet--full');
    expect(wrapper().style.height).toBe('auto');
    expect(wrapper().style.width).toBe('');
    unmount();

    render(<BottomSheet title={title} full><p>{body}</p></BottomSheet>);
    expect(root()).toHaveClass('aile-sheet--full');
    expect(wrapper().style.height).toBe('100%');
  });

  it('inline verilirse portal yerine yerinde çizer', () => {
    const { container } = render(<BottomSheet title={title} inline><p>{body}</p></BottomSheet>);
    expect(container.contains(screen.getByRole('dialog'))).toBe(true);
  });

  it('CSS sözleşmesi: en çok %85, alt güvenli alan, yalnız --aile tokenları, odak halkası yok', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const css = readFileSync(resolve(__dirname, 'BottomSheet.css'), 'utf8');
    expect(css).toMatch(/max-height:\s*85d?vh/);
    expect(css).toContain('env(safe-area-inset-bottom');
    // Yorumlar dışında sabit renk yok (hex / rgb).
    const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(code).not.toMatch(/rgba?\(/);
    expect(code).not.toMatch(/outline\s*:(?!\s*none)/);
  });

  it('ham antd / phosphor paketini değil ui/antd ve ui/icons yüzeylerini kullanır', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve(__dirname, 'BottomSheet.tsx'), 'utf8');
    expect(source).not.toMatch(/from ['"]antd['"]/);
    expect(source).not.toContain('@ant-design/');
    expect(source).not.toContain('@phosphor-icons/');
    expect(source).toContain("from './antd'");
  });
});
