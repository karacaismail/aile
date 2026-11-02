import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { installViewport } from './testing';

// App.tsx bağlantısı (geçiş kesimi, plan D8 + t3-root): uygulama ağacı hiçbir profilde antd sağlayıcısıyla sarılmaz.
// Ağaç yapısı profil değişiminde sabittir: main düğümü, odak ve URL'de olmayan taslaklar telefon ↔ geniş geçişinde
// korunur. WideProviders modülü (antd ConfigProvider + tr_TR + aile teması) hiçbir profilde içe aktarılmaz; antd
// gerektiren bir geniş ada olursa sağlayıcı yalnız o adayı sarar (lazyWide(…, { antd: true })).
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

// Kontrolsüz alan: değeri yalnız DOM düğümünde yaşar (URL'de değil); düğüm yeniden kurulursa taslak kaybolur.
vi.mock('../routes', () => ({
  AdminRoutes: () => (
    <>
      <h1>Genel durum</h1>
      <label>Taslak not<input defaultValue="" /></label>
    </>
  ),
}));

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

/** Dinamik importu tetikleyebilecek mikro görev turları: istenmeyen modül yine de içe aktarılmamalı. */
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

beforeEach(() => {
  counts.providerModuleLoads = 0;
  counts.dataMounts = 0;
  counts.workspaceMounts = 0;
});

describe('App · antd sağlayıcısız uygulama ağacı', () => {
  it('phone 320×568: renders the workspace without antd providers and never imports the WideProviders module', async () => {
    installViewport({ width: 320, height: 568, coarse: true });
    const { root } = await renderApp();
    expect(root).toHaveAttribute('data-profile', 'phone');
    expect(screen.getByRole('heading', { name: 'Genel durum' })).toBeInTheDocument();
    expect(screen.queryByTestId('wide-providers')).toBeNull();
    expect(root).not.toHaveAttribute('aria-busy');
    await flush();
    expect(counts.providerModuleLoads).toBe(0);
  });

  it('landscape phone 568×320 stays on the phone profile and imports no providers', async () => {
    installViewport({ width: 568, height: 320, coarse: true });
    const { root } = await renderApp();
    expect(root).toHaveAttribute('data-profile', 'phone');
    await flush();
    expect(counts.providerModuleLoads).toBe(0);
    expect(screen.queryByTestId('wide-providers')).toBeNull();
  });

  it('desktop 1440×900: the workspace is a direct child of the root, never busy, and WideProviders is never imported', async () => {
    installViewport({ width: 1440, height: 900, fine: true, hover: true });
    const { root } = await renderApp();
    expect(root).toHaveAttribute('data-profile', 'desktop');
    expect(root).not.toHaveAttribute('aria-busy');
    expect(root.firstElementChild).toBe(screen.getByRole('main'));
    await flush();
    expect(counts.providerModuleLoads).toBe(0);
    expect(screen.queryByTestId('wide-providers')).toBeNull();
    expect(root).not.toHaveAttribute('aria-busy');
    expect(counts.workspaceMounts).toBe(1);
  });

  it('phone → desktop → tablet → phone: the same main node, focus and an unsaved draft survive; nothing remounts', async () => {
    const viewport = installViewport({ width: 320, height: 568, coarse: true });
    const { root } = await renderApp();
    const main = screen.getByRole('main');
    const draft = screen.getByRole('textbox', { name: 'Taslak not' });
    fireEvent.change(draft, { target: { value: 'salon perdesi ölçüsü' } });
    draft.focus();
    expect(counts.workspaceMounts).toBe(1);

    for (const next of [
      { width: 1440, height: 900, coarse: false, fine: true, hover: true },
      { width: 820, height: 1180, coarse: true, fine: false, hover: false },
      { width: 320, height: 568, coarse: true, fine: false, hover: false },
    ]) {
      act(() => viewport.set(next));
      await flush();
      expect(screen.getByRole('main'), `${next.width}×${next.height}: main yeniden bağlandı`).toBe(main);
      expect(screen.getByRole('textbox', { name: 'Taslak not' })).toBe(draft);
      expect(draft).toHaveValue('salon perdesi ölçüsü');
      expect(draft).toHaveFocus();
    }
    expect(root).toHaveAttribute('data-profile', 'phone');
    expect(counts.workspaceMounts).toBe(1);
    expect(counts.dataMounts).toBe(1);
    expect(counts.providerModuleLoads).toBe(0);
    expect(screen.queryByTestId('wide-providers')).toBeNull();
  });
});
