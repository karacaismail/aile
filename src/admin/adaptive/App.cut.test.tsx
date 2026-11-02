import { act, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { installViewport } from './testing';

// Geçiş kesimi (plan D8) App.tsx bağlantısı: telefon profili WideProviders modülünü (antd ConfigProvider + tr_TR + aile
// teması) hiç içe aktarmaz; tablet/masaüstünde wideResource('wide-providers', …) ile tembel yüklenir ve yapışkan
// kalır. Nesil sağlayıcısı ve yönlendirici sağlayıcı geçidinin üstündedir: sağlayıcı bağlanınca yalnız çalışma alanı bir
// kez yeniden bağlanır, nesil kaynağı/deposu (Veri sayfasında seçilen klasör dahil) korunur.
// Ağır modüller (veri katmanı, kabuk, rotalar) işaretli taslaklarla değiştirilir; sınanan yalnız App.tsx + AdaptiveRoot.
const counts = vi.hoisted(() => ({ providerModuleLoads: 0, dataMounts: 0, workspaceMounts: 0 }));

function MarkerProviders({ children }: { children: ReactNode }) {
  return <div data-testid="wide-providers">{children}</div>;
}

vi.mock('../data', async () => {
  const { useEffect } = await import('react');
  function GenerationProvider({ children }: { children: ReactNode }) {
    useEffect(() => { counts.dataMounts += 1; }, []);
    return <>{children}</>;
  }
  return { GenerationProvider };
});

vi.mock('../shell/WorkspaceShell', async () => {
  const { useEffect } = await import('react');
  function WorkspaceShell({ children }: { children: ReactNode }) {
    useEffect(() => { counts.workspaceMounts += 1; }, []);
    return <main id="admin-content">{children}</main>;
  }
  return { WorkspaceShell };
});

vi.mock('../routes', () => ({ AdminRoutes: () => <h1>Genel durum</h1> }));

async function renderApp() {
  vi.resetModules();
  // Her testte taze sahte modül: fabrika yalnız modül gerçekten içe aktarılınca (tembel import) çalışır ve sayılır.
  vi.doMock('./WideProviders', () => {
    counts.providerModuleLoads += 1;
    return { default: MarkerProviders, WideProviders: MarkerProviders };
  });
  const { App } = await import('../App');
  const view = render(<App />);
  return { ...view, root: view.container.querySelector('.aile-admin') as HTMLElement };
}

beforeEach(() => {
  counts.providerModuleLoads = 0;
  counts.dataMounts = 0;
  counts.workspaceMounts = 0;
});

describe('App · antd sağlayıcı kesimi', () => {
  it('phone 320×568: renders the workspace without antd providers and never imports the WideProviders module', async () => {
    installViewport({ width: 320, height: 568, coarse: true });
    const { root } = await renderApp();
    expect(root).toHaveAttribute('data-profile', 'phone');
    expect(screen.getByRole('heading', { name: 'Genel durum' })).toBeInTheDocument();
    expect(screen.queryByTestId('wide-providers')).toBeNull();
    expect(root).not.toHaveAttribute('aria-busy');
    // Dinamik importu tetikleyebilecek bir mikro görev turu: telefon yine de modülü istemez.
    await act(async () => { await Promise.resolve(); });
    expect(counts.providerModuleLoads).toBe(0);
  });

  it('landscape phone 568×320 stays on the phone profile and imports no providers', async () => {
    installViewport({ width: 568, height: 320, coarse: true });
    const { root } = await renderApp();
    expect(root).toHaveAttribute('data-profile', 'phone');
    await act(async () => { await Promise.resolve(); });
    expect(counts.providerModuleLoads).toBe(0);
    expect(screen.queryByTestId('wide-providers')).toBeNull();
  });

  it('desktop 1440×900: loads WideProviders lazily, busy until attached, then wraps the workspace', async () => {
    installViewport({ width: 1440, height: 900, fine: true, hover: true });
    const { root } = await renderApp();
    expect(root).toHaveAttribute('data-profile', 'desktop');
    expect(root).toHaveAttribute('aria-busy', 'true');
    const providers = await screen.findByTestId('wide-providers');
    expect(providers).toContainElement(screen.getByRole('heading', { name: 'Genel durum' }));
    expect(root).not.toHaveAttribute('aria-busy');
    expect(counts.providerModuleLoads).toBe(1);
    expect(counts.dataMounts).toBe(1);
  });

  it('phone → tablet → phone: providers attach once and stay; the data provider is never remounted', async () => {
    const viewport = installViewport({ width: 375, height: 667, coarse: true });
    await renderApp();
    expect(screen.queryByTestId('wide-providers')).toBeNull();
    expect(counts.workspaceMounts).toBe(1);

    act(() => viewport.set({ width: 820, height: 1180, coarse: true }));
    expect(await screen.findByTestId('wide-providers')).toContainElement(screen.getByRole('main'));
    expect(counts.providerModuleLoads).toBe(1);
    // Bilinen tek seferlik bedel: çalışma alanı sağlayıcının altına bir kez yeniden bağlanır; veri sağlayıcısı bağlanmaz.
    expect(counts.workspaceMounts).toBe(2);
    expect(counts.dataMounts).toBe(1);

    act(() => viewport.set({ width: 375, height: 667, coarse: true }));
    expect(screen.getByTestId('wide-providers')).toContainElement(screen.getByRole('main'));
    expect(counts.workspaceMounts).toBe(2);
    expect(counts.dataMounts).toBe(1);
    expect(counts.providerModuleLoads).toBe(1);
  });
});
