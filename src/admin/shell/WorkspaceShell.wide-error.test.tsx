import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { wideManifest } from '../adaptive';
import { installViewport } from '../adaptive/testing';
import { WorkspaceShell } from './WorkspaceShell';

// Masaüstü yan gezinmesi (shell/wide/WorkspaceNav.wide.tsx) indirilemezse: W0 yükleyicisi bir kez yeniden dener, sonra
// "Geniş görünüm yüklenemedi" bildirimi ve "Yeniden dene" düğmesi çıkar. Kabuk bu sürede ve sonrasında telefon temelini
// (üst çubuk + Sayfalar alt sayfası) kullanılabilir tutar; main ve içerik yerinde kalır. Modül kalıcı tekil olduğundan
// (anahtar 'shell-nav') hata yolu ayrı dosyada sınanır.

const failure = vi.hoisted(() => ({ fail: true, attempts: 0 }));
vi.mock('./wide/WorkspaceNav.wide', async (importOriginal: () => Promise<Record<string, unknown>>) => {
  failure.attempts += 1;
  if (failure.fail) throw new Error('ağ hatası (sınama)');
  return importOriginal();
});

const DESKTOP = { width: 1440, height: 900, fine: true, hover: true };

afterEach(() => { document.title = ''; });

describe('WorkspaceShell · geniş gezinme yüklenemezse', () => {
  it('keeps the native top bar and Sayfalar drawer usable, shows the recoverable notice, and recovers on retry', async () => {
    const user = userEvent.setup();
    installViewport(DESKTOP);
    render(<WorkspaceShell location="/odemeler"><p>Ödemeler içeriği</p></WorkspaceShell>);
    const main = screen.getByRole('main');

    // İlk deneme + tek yeniden deneme (800 ms) başarısız: bildirim, temel gezinme yerinde.
    const notice = await screen.findByRole('status', {}, { timeout: 4000 });
    expect(notice).toHaveTextContent('Geniş görünüm yüklenemedi');
    expect(wideManifest().find(entry => entry.key === 'shell-nav')?.status).toBe('error');
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(screen.getByRole('banner')).toHaveTextContent(/^aile\s*·\s*Ödemeler/);
    expect(screen.getByRole('main')).toBe(main);
    expect(within(main).getByText('Ödemeler içeriği')).toBeInTheDocument();

    // Sayfalar alt sayfası masaüstünde de çalışır (yan gezinme yokken tek gezinme yolu).
    await user.click(screen.getByRole('button', { name: 'Sayfalar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Sayfalar' });
    expect(within(dialog).getByRole('link', { name: 'Ödemeler' })).toHaveAttribute('aria-current', 'page');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('button', { name: 'Sayfalar' })).toHaveFocus();

    // Yeniden dene: modül gelir, yan gezinme üst çubuğun yerini alır; main yeniden bağlanmaz.
    failure.fail = false;
    await act(async () => { await user.click(within(notice).getByRole('button', { name: 'Yeniden dene' })); });
    const aside = await screen.findByRole('complementary');
    expect(within(aside).getByRole('link', { name: 'Ödemeler' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('banner')).toBeNull();
    expect(screen.getByRole('main')).toBe(main);
    expect(failure.attempts).toBeGreaterThanOrEqual(3);
  });
});
