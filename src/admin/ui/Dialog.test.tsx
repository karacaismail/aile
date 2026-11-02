import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { DeviceContext } from '../device';
import type { Device } from '../shell/contracts';
import { themeFor } from '../theme/antdTheme';
import { ConfigProvider } from './antd';
import { Dialog } from './Dialog';

// Telefonda Dialog alt sayfaya (BottomSheet) devreder. BottomSheet ayrı görevde yazılır; burada yalnız sözleşmesi
// (index.d.ts BottomSheetProps: title, children, footer, onClose, open, full, inline) taklit edilir ve devir test edilir.
vi.mock('./BottomSheet', () => ({
  BottomSheet: (p: { title: string; children?: ReactNode; footer?: ReactNode; onClose?: () => void; open?: boolean; full?: boolean; inline?: boolean }) => (
    <section data-testid="alt-sayfa" aria-label={p.title} data-open={String(p.open)} data-full={p.full ? 'true' : 'false'} data-inline={String(p.inline)}>
      {p.children}
      {p.footer}
      <button type="button" onClick={p.onClose}>Alt sayfayı kapat</button>
    </section>
  ),
}));

const title = 'Alımı sil';
const body = 'Bu alım kaynaktan silinmez; yalnız yerel değişiklik kümesine yazılır.';

function renderDialog(ui: ReactNode, device: Device = 'desktop') {
  return render(<DeviceContext.Provider value={device}>{ui}</DeviceContext.Provider>);
}

describe('Dialog', () => {
  it('masaüstünde ortada 560 px modal: role dialog, h2 başlık, gövde ve Kapat', () => {
    renderDialog(<Dialog title={title}>{body}</Dialog>);
    const dialog = screen.getByRole('dialog', { name: title });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    // Tasarım README: "En çok 560 px". Değer tokens.json'da yok; bileşen sabiti README'den gelir.
    expect(dialog).toHaveStyle({ width: '560px' });
    expect(screen.getByRole('heading', { level: 2, name: title })).toBeInTheDocument();
    expect(screen.getByText(body)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Kapat' })).toBeInTheDocument();
    // footer verilmedi: antd'nin varsayılan OK/Cancel düğmeleri çizilmez.
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  // antd odağı açılış hareketi bitince diyaloğa taşır. jsdom CSS animasyonunu hiç bitirmez (animationend gelmez); bu yüzden
  // odak girişi uygulamanın gerçek reduced-motion teması (themeFor(true): hareket kapalı) ile doğrulanır. Hareketli yol
  // yalnız gerçek tarayıcıda (e2e) görülür.
  it('açılışta odak diyaloğun içine girer (reduced-motion teması)', async () => {
    render(
      <ConfigProvider theme={themeFor(true)}>
        <DeviceContext.Provider value="desktop"><Dialog title={title}>{body}</Dialog></DeviceContext.Provider>
      </ConfigProvider>,
    );
    const dialog = screen.getByRole('dialog', { name: title });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  });

  it('Escape onClose çağırır', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderDialog(<Dialog title={title} onClose={onClose}>{body}</Dialog>);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Kapat düğmesi onClose çağırır; örtüye tıklama kapatmaz', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderDialog(<Dialog title={title} onClose={onClose}>{body}</Dialog>);
    const dialog = screen.getByRole('dialog', { name: title });
    await user.click(dialog.parentElement as HTMLElement);
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Kapat' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('alert varyantı role alertdialog taşır', () => {
    renderDialog(<Dialog title={title} alert>{body}</Dialog>);
    const dialog = screen.getByRole('alertdialog', { name: title });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('footer altlık olarak düğme sırasıyla çizilir; varsayılan antd düğmeleri yok', () => {
    renderDialog(
      <Dialog title={title} footer={<><button type="button">Vazgeç</button><button type="button">Sil</button></>}>{body}</Dialog>,
    );
    const names = screen.getAllByRole('button').map(b => b.getAttribute('aria-label') ?? b.textContent);
    expect(names).toEqual(['Kapat', 'Vazgeç', 'Sil']);
  });

  it('open=false iken hiçbir şey çizmez', () => {
    renderDialog(<Dialog title={title} open={false}>{body}</Dialog>);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText(title)).toBeNull();
  });

  it('tablette de ortada modal kalır', () => {
    renderDialog(<Dialog title={title}>{body}</Dialog>, 'tablet');
    expect(screen.getByRole('dialog', { name: title })).toBeInTheDocument();
    expect(screen.queryByTestId('alt-sayfa')).toBeNull();
  });

  it('telefonda alt sayfaya (BottomSheet) devreder: başlık, gövde, altlık, onClose', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderDialog(
      <Dialog title={title} alert onClose={onClose} footer={<button type="button">Sil</button>}>{body}</Dialog>,
      'phone',
    );
    const sheet = screen.getByTestId('alt-sayfa');
    expect(sheet).toHaveAccessibleName(title);
    expect(sheet).toHaveAttribute('data-open', 'true');
    expect(sheet).toHaveAttribute('data-full', 'false');
    expect(screen.getByText(body)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sil' })).toBeInTheDocument();
    // Orta modal çizilmez: antd dialog/alertdialog ve onun Kapat düğmesi yok.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Kapat' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Alt sayfayı kapat' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('telefonda open=false alt sayfaya da iletilir', () => {
    renderDialog(<Dialog title={title} open={false}>{body}</Dialog>, 'phone');
    expect(screen.getByTestId('alt-sayfa')).toHaveAttribute('data-open', 'false');
  });

  it('ham antd / phosphor paketini değil ui/antd ve ui/icons yüzeylerini kullanır', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve(__dirname, 'Dialog.tsx'), 'utf8');
    expect(source).not.toMatch(/from ['"]antd['"]/);
    expect(source).not.toContain('@ant-design/');
    expect(source).not.toContain('@phosphor-icons/');
    expect(source).toContain("from './antd'");
  });
});
