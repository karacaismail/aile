import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { installViewport } from '../adaptive/testing';
import { WorkspaceShell } from './WorkspaceShell';

// Sayfalar çekmecesi (MobileNavDrawer) tembel bir sınırdır: telefon ilk boyaması onu indirmez (kapalıyken çizmez); ilk
// niyette (düğmeye basma/odak) istenir. Yüklenirken düğme aria-expanded + aria-busy taşır, çekmece gelince açılır.
// İndirilemezse (bir yeniden deneme sonrası) içerik alanında "Sayfalar yüklenemedi · Yeniden dene" bildirimi çıkar;
// arka plan inert kalmaz, main yerinde kalır; yeniden deneme çekmeceyi açar. Kaynak kalıcı tekil olduğundan (anahtar
// 'shell-sayfalar') bu yol ayrı dosyada sınanır.

const drawerModule = vi.hoisted(() => ({ fail: true, attempts: 0 }));
vi.mock('./MobileNavDrawer', async (importOriginal: () => Promise<Record<string, unknown>>) => {
  drawerModule.attempts += 1;
  if (drawerModule.fail) throw new Error('ağ hatası (sınama)');
  return importOriginal();
});

const PHONE = { width: 320, height: 568, coarse: true };

afterEach(() => { document.title = ''; });

describe('WorkspaceShell · Sayfalar çekmecesi tembel yüklenir', () => {
  it('is not requested on first paint; a failed load shows a recoverable notice and retry opens the drawer', async () => {
    const user = userEvent.setup();
    installViewport(PHONE);
    render(<WorkspaceShell location="/genel"><p>Genel içeriği</p></WorkspaceShell>);
    const main = screen.getByRole('main');
    const button = screen.getByRole('button', { name: 'Sayfalar' });

    // İlk boyama: üst çubuk ve düğme var, çekmece modülü istenmedi.
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).not.toHaveAttribute('aria-busy');
    expect(drawerModule.attempts).toBe(0);

    // Seçim: yüklenirken istenen durum ve meşgul işareti; ilk deneme + tek yeniden deneme (800 ms) başarısız.
    await user.click(button);
    expect(drawerModule.attempts).toBeGreaterThanOrEqual(1);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).not.toHaveAttribute('aria-controls');
    expect(main).not.toHaveAttribute('inert');

    const notice = await within(main).findByRole('status', {}, { timeout: 4000 });
    expect(notice).toHaveTextContent('Sayfalar yüklenemedi.');
    expect(drawerModule.attempts).toBe(2);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).not.toHaveAttribute('aria-busy');
    expect(main).not.toHaveAttribute('inert');
    expect(within(main).getByText('Genel içeriği')).toBeInTheDocument();

    // Yeniden dene: modül gelir, çekmece açılır (modal, odak içeride); bildirim kalkar; main yeniden bağlanmaz.
    drawerModule.fail = false;
    await act(async () => { await user.click(within(notice).getByRole('button', { name: 'Yeniden dene' })); });
    const dialog = await screen.findByRole('dialog', { name: 'Sayfalar' });
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(button).toHaveAttribute('aria-controls', dialog.id);
    expect(button).not.toHaveAttribute('aria-busy');
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    expect(main).toHaveAttribute('inert');
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('main')).toBe(main);

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });
});
