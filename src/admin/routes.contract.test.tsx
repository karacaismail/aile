import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { reloadPage } from './adaptive/reload';
import { ChangeSet, FixtureGenerationSource, GenerationProvider, createMemoryStorage } from './data';
import { CONTRACT_LOAD_FAILED, CONTRACT_STALE_BUILD, ContractLoadError } from './data/store';
import { DeviceContext } from './device';
import { AdminRoutes } from './routes';

// Sözleşme (doğrulama) parçasının eski sürüm yönetimi, gerçek Veri ve Ayarlar sayfalarıyla (p-fix m1). Yayından sonra
// contract parçasının adı değiştiyse klasör içe aktarımı ContractLoadError ile düşer; çevrim içi parça hatası eski
// sürümdür ve sayfa "Yeniden dene" yerine mevcut "Yeni sürüm var · Yenile" kalıbını verir (yeniden deneme silinmiş
// parçaya karşı asla başaramaz). Kapalı başarısızlık korunur: doğrulanmamış veri çizilmez. Çevrim dışı ya da parça dışı
// hata "Yeniden dene" yolunda kalır. Nesil kaynağı aynı hatayı depoya verir (depo durumu ve iletisi gerçek akıştandır).

vi.mock('./adaptive/reload', () => ({ reloadPage: vi.fn() }));

/** Manifest okunurken sözleşme modülü indirilemedi: depo bu hatayla reddeder (store.contract.test.ts gerçek yolu sınar). */
class ContractFailingSource extends FixtureGenerationSource {
  constructor(private readonly failure: ContractLoadError) { super({}, 'sentetik'); }
  override async readText(): Promise<string> { throw this.failure; }
}

const chunkError = () => new TypeError('Failed to fetch dynamically imported module: http://127.0.0.1/aile/assets/contract-AbCd1234.js');

function renderAt(path: string, failure: ContractLoadError) {
  const memory = memoryLocation({ path });
  const changeSet = () => ChangeSet.load({ storage: createMemoryStorage() });
  return render(
    <DeviceContext.Provider value="phone">
      <GenerationProvider source={new ContractFailingSource(failure)} cache={null} changeSet={changeSet}>
        <Router hook={memory.hook}>
          <main id="admin-content" tabIndex={-1}>
            <AdminRoutes />
          </main>
        </Router>
      </GenerationProvider>
    </DeviceContext.Provider>,
  );
}

const staleNotice = () => screen.findByText('Yeni sürüm var', {}, { timeout: 3000 });

beforeEach(() => {
  vi.mocked(reloadPage).mockClear();
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('ağ yok'))));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('Veri › sözleşme parçası eski sürüm', () => {
  it('online chunk failure: "Yeni sürüm var · Yenile" reloads; no retry button for the generation, no data drawn', async () => {
    const user = userEvent.setup();
    const failure = new ContractLoadError(chunkError());
    expect(failure.staleBuild).toBe(true);
    renderAt('/veri', failure);
    const notice = (await staleNotice()).closest<HTMLElement>('[role="status"]')!;
    expect(notice).toHaveAttribute('data-kind', 'stale-build');
    expect(screen.queryByRole('button', { name: 'Yeniden dene' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Çözülecek sorunlar' })).toBeNull();
    expect(screen.queryByText(/Veri okunamadı/)).toBeNull();
    expect(CONTRACT_STALE_BUILD).toMatch(/^Yeni sürüm var/);
    await user.click(within(notice).getByRole('button', { name: 'Yenile' }));
    expect(reloadPage).toHaveBeenCalledTimes(1);
  });

  it('offline (or non-chunk) failure stays on the "Yeniden dene" path', async () => {
    const offline = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    try {
      const failure = new ContractLoadError(chunkError());
      expect(failure.staleBuild).toBe(false);
      expect(failure.message).toBe(CONTRACT_LOAD_FAILED);
      renderAt('/veri', failure);
      expect((await screen.findAllByRole('button', { name: 'Yeniden dene' }, { timeout: 3000 })).length).toBeGreaterThan(0);
      expect(screen.queryByText('Yeni sürüm var')).toBeNull();
    } finally {
      offline.mockRestore();
    }
  });
});

describe('Ayarlar › sözleşme parçası eski sürüm', () => {
  it('the generation row offers "Yeni sürüm var · Yenile" (page reload) instead of a retry that can never succeed', async () => {
    const user = userEvent.setup();
    renderAt('/ayarlar', new ContractLoadError(chunkError()));
    const notice = (await staleNotice()).closest<HTMLElement>('[role="status"]')!;
    expect(notice).toHaveAttribute('data-kind', 'stale-build');
    expect(screen.queryByRole('button', { name: 'Yeniden dene' })).toBeNull();
    await user.click(within(notice).getByRole('button', { name: 'Yenile' }));
    expect(reloadPage).toHaveBeenCalledTimes(1);
  });
});
