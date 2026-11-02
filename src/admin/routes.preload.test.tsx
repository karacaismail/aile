import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { reloadPage } from './adaptive/reload';
import { loadContract } from './data/store';
import { DeviceContext } from './device';
import { AdminRoutes } from './routes';

// Uygulamanın rota yükleyicilerindeki ön yüklemeler (p-fix n1, m1, m3):
//  - Genel dışındaki sayfalar çekirdek dışı simge parçasını sayfa parçasıyla paralel ister ama BEKLEMEZ: takılan simge
//    isteği sayfayı iskelette tutmaz (simgeler sonradan dolar).
//  - Veri ve Ayarlar sayfaları doğrulama modülünü (store.loadContract) önden ister: klasör içe aktarımı ağ ya da yeni
//    sürüm yüzünden düşmesin; Genel ve diğer sayfalar istemez (telefon ilk rotası zod indirmez).
//  - Simge parçası eski sürümse (çevrim içi parça hatası) rota alanında "Yeni sürüm var · Yenile" çıkar.
// Sayfa modülleri ince taslaklardır; gerçek sayfalar routes.test.tsx'te.

const icons = vi.hoisted(() => ({ status: 'idle' as string, preloads: 0 }));
vi.mock('./ui/icons', async (importOriginal: () => Promise<Record<string, unknown>>) => ({
  ...(await importOriginal()),
  // Asla gelmeyen simge isteği.
  preloadIcons: vi.fn(() => { icons.preloads += 1; return new Promise(() => {}); }),
  useIconsStatus: () => icons.status,
}));
vi.mock('./data/store', async (importOriginal: () => Promise<Record<string, unknown>>) => ({
  ...(await importOriginal()),
  loadContract: vi.fn(() => Promise.resolve({})),
}));
vi.mock('./adaptive/reload', () => ({ reloadPage: vi.fn() }));
vi.mock('./pages/GenelPage', () => ({ GenelPage: () => <p>Genel taslağı</p> }));
vi.mock('./pages/ButcePage', () => ({ ButcePage: () => <p>Bütçe taslağı</p> }));
vi.mock('./pages/VeriPage', () => ({ VeriPage: () => <p>Veri taslağı</p> }));
vi.mock('./pages/AyarlarPage', () => ({ AyarlarPage: () => <p>Ayarlar taslağı</p> }));


function renderAt(path: string) {
  const memory = memoryLocation({ path, record: true });
  const view = render(
    <DeviceContext.Provider value="phone">
      <Router hook={memory.hook}>
        <main id="admin-content" tabIndex={-1}>
          <AdminRoutes />
        </main>
      </Router>
    </DeviceContext.Provider>,
  );
  return { ...view, memory };
}

beforeEach(() => {
  icons.status = 'idle';
  icons.preloads = 0;
  vi.mocked(loadContract).mockClear();
});

describe('AdminRoutes › ön yüklemeler', () => {
  it('Genel neither waits for nor requests icons or the contract; another page opens although its icon request never settles', async () => {
    const { memory } = renderAt('/genel');
    expect(await screen.findByText('Genel taslağı')).toBeInTheDocument();
    expect(icons.preloads).toBe(0);
    expect(loadContract).not.toHaveBeenCalled();

    act(() => memory.navigate('/butce'));
    expect(await screen.findByText('Bütçe taslağı', {}, { timeout: 2000 })).toBeInTheDocument();
    expect(icons.preloads).toBe(1);
    expect(loadContract).not.toHaveBeenCalled();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it.each([
    ['/veri', 'Veri taslağı'],
    ['/ayarlar', 'Ayarlar taslağı'],
  ])('%s preloads the contract module alongside its chunk', async (path, text) => {
    renderAt(path);
    expect(await screen.findByText(text, {}, { timeout: 2000 })).toBeInTheDocument();
    expect(loadContract).toHaveBeenCalledTimes(1);
    expect(icons.preloads).toBe(1);
  });

  it('a stale icon chunk shows "Yeni sürüm var · Yenile" above the page; the page stays usable', async () => {
    const user = userEvent.setup();
    icons.status = 'stale-build';
    renderAt('/butce');
    expect(await screen.findByText('Bütçe taslağı', {}, { timeout: 2000 })).toBeInTheDocument();
    const main = screen.getByRole('main');
    const notice = within(main).getByRole('status');
    expect(notice).toHaveAttribute('data-kind', 'stale-build');
    expect(notice).toHaveTextContent('Yeni sürüm var');
    expect(notice.compareDocumentPosition(screen.getByText('Bütçe taslağı')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await user.click(within(notice).getByRole('button', { name: 'Yenile' }));
    expect(reloadPage).toHaveBeenCalledTimes(1);
  });
});
