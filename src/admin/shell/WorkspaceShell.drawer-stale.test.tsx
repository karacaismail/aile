import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { reloadPage } from '../adaptive/reload';
import { installViewport } from '../adaptive/testing';
import { WorkspaceShell } from './WorkspaceShell';

// Sayfalar çekmecesinin eski sürüm yolu (p-fix m8): yayından sonra çekmece parçası sunucuda yoksa tarayıcı parça
// yükleme hatası verir (isChunkLoadError'ın tanıdığı biçim). Çevrim içiyken bu sürüm kaymasıdır: tek yeniden denemeden
// sonra içerik alanının başında "Yeni sürüm var · Yenile" çıkar ve sayfayı yeniden yükler; modal açılmaz, arka plan
// inert olmaz. Kaynak tekil olduğundan bu yol ayrı dosyada sınanır.

vi.mock('../adaptive/reload', () => ({ reloadPage: vi.fn() }));
const drawerModule = vi.hoisted(() => ({ attempts: 0 }));
vi.mock('./MobileNavDrawer', () => {
  drawerModule.attempts += 1;
  throw new TypeError('Failed to fetch dynamically imported module: http://127.0.0.1/aile/assets/MobileNavDrawer-AbCd1234.js');
});

describe('WorkspaceShell · Sayfalar çekmecesi eski sürüm', () => {
  it('a chunk-load failure while online offers "Yeni sürüm var · Yenile", which reloads the page', async () => {
    const user = userEvent.setup();
    installViewport({ width: 320, height: 568, coarse: true });
    render(<WorkspaceShell location="/genel"><p>Genel içeriği</p></WorkspaceShell>);
    const main = screen.getByRole('main');
    const button = screen.getByRole('button', { name: 'Sayfalar' });

    await user.click(button);
    const notice = await within(main).findByRole('status', {}, { timeout: 4000 });
    expect(drawerModule.attempts).toBe(2);
    expect(notice).toHaveAttribute('data-kind', 'stale-build');
    expect(notice).toHaveTextContent('Yeni sürüm var');
    expect(within(notice).queryByRole('button', { name: 'Yeniden dene' })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).not.toHaveAttribute('aria-busy');
    expect(main).not.toHaveAttribute('inert');

    await user.click(within(notice).getByRole('button', { name: 'Yenile' }));
    expect(reloadPage).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
