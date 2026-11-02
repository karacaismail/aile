import { act, fireEvent, render, screen } from '@testing-library/react';
import { useContext, useEffect, useState, type ReactNode } from 'react';
import { ConfigProvider } from '../ui/antd';
import { AdaptiveRoot } from './AdaptiveRoot';
import { useInputLayers, useProfile } from './context';
import { PHONE_WITHOUT_ANTD } from './flags';
import { wideResource } from './loader';
import { installViewport } from './testing';
import { WideProviders } from './WideProviders';

// Test sağlayıcısı: antd yerine işaretli bir kap; geçit mantığını antd iç ayrıntısına bağlamadan sınar.
function MarkerProviders({ children }: { children: ReactNode }) {
  return <div data-testid="wide-providers">{children}</div>;
}

let mounts = 0;
function Content() {
  const profile = useProfile();
  const input = useInputLayers();
  const [note, setNote] = useState('');
  useEffect(() => { mounts += 1; }, []);
  return (
    <section>
      <p>Profil: {profile}</p>
      <p>Katmanlar: {Object.entries(input).filter(([, on]) => on).map(([name]) => name).join(' ') || 'yok'}</p>
      <label>Not<input value={note} onChange={event => setNote(event.target.value)} /></label>
    </section>
  );
}

beforeEach(() => { mounts = 0; });

describe('AdaptiveRoot · kök öznitelikleri', () => {
  it('puts data-profile and data-input-* on the root element and mirrors them on <html> until unmount', () => {
    const viewport = installViewport({ width: 390, height: 844, coarse: true });
    const { container, unmount } = render(
      <AdaptiveRoot className="aile-admin" providers={MarkerProviders}><Content /></AdaptiveRoot>,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveClass('aile-admin');
    expect(root).toHaveAttribute('data-profile', 'phone');
    expect(root).toHaveAttribute('data-input-coarse', '');
    expect(root).not.toHaveAttribute('data-input-fine');
    expect(root).not.toHaveAttribute('data-input-hover');
    expect(document.documentElement).toHaveAttribute('data-profile', 'phone');
    expect(screen.getByText('Katmanlar: coarse')).toBeInTheDocument();

    act(() => viewport.set({ width: 1280, height: 800, fine: true, hover: true }));
    expect(root).toHaveAttribute('data-profile', 'desktop');
    expect(root).toHaveAttribute('data-input-fine', '');
    expect(root).toHaveAttribute('data-input-hover', '');
    expect(document.documentElement).toHaveAttribute('data-profile', 'desktop');
    expect(document.documentElement).toHaveAttribute('data-input-coarse', '');

    unmount();
    for (const name of ['data-profile', 'data-input-coarse', 'data-input-fine', 'data-input-hover']) {
      expect(document.documentElement.hasAttribute(name), name).toBe(false);
    }
    expect(viewport.listenerCount()).toBe(0);
  });

  it('chooses the profile synchronously before the first render (no phone→desktop jump)', () => {
    installViewport({ width: 1440, height: 900, fine: true, hover: true });
    const seen: string[] = [];
    function Probe() { seen.push(useProfile()); return null; }
    const { container } = render(<AdaptiveRoot providers={MarkerProviders}><Probe /></AdaptiveRoot>);
    expect(seen).toEqual(['desktop']);
    expect(container.firstElementChild).toHaveAttribute('data-profile', 'desktop');
  });
});

describe('AdaptiveRoot · antd sağlayıcı geçidi', () => {
  it('ships with PHONE_WITHOUT_ANTD = true (geçiş kesimi: telefon antd sağlayıcısı olmadan render eder)', () => {
    expect(PHONE_WITHOUT_ANTD).toBe(true);
  });

  it('default (flag on): no providers on the phone without passing the prop', () => {
    installViewport({ width: 320, height: 568, coarse: true });
    render(<AdaptiveRoot providers={MarkerProviders}><Content /></AdaptiveRoot>);
    expect(screen.queryByTestId('wide-providers')).toBeNull();
    expect(screen.getByText('Profil: phone')).toBeInTheDocument();
  });

  it('flag off (phoneWithoutAntd={false}): the providers wrap the app on every profile, including the phone', () => {
    installViewport({ width: 320, height: 568, coarse: true });
    render(<AdaptiveRoot providers={MarkerProviders} phoneWithoutAntd={false}><Content /></AdaptiveRoot>);
    expect(screen.getByTestId('wide-providers')).toContainElement(screen.getByText('Profil: phone'));
  });

  it('flag on: no providers on the phone; attached on a wide profile and kept (no second remount) back on the phone', () => {
    const viewport = installViewport({ width: 320, height: 568, coarse: true });
    render(<AdaptiveRoot providers={MarkerProviders} phoneWithoutAntd><Content /></AdaptiveRoot>);
    expect(screen.queryByTestId('wide-providers')).toBeNull();
    expect(screen.getByText('Profil: phone')).toBeInTheDocument();
    expect(mounts).toBe(1);

    act(() => viewport.set({ width: 820, height: 1180 }));
    expect(screen.getByTestId('wide-providers')).toContainElement(screen.getByText('Profil: tablet'));
    // İlk geniş geçişte alt ağaç bir kez yeniden bağlanır (sağlayıcı sarmalayıcısı eklenir); bilinen bedel.
    expect(mounts).toBe(2);

    fireEvent.change(screen.getByLabelText('Not'), { target: { value: 'salon perdesi' } });
    act(() => viewport.set({ width: 375, height: 667 }));
    expect(screen.getByTestId('wide-providers')).toContainElement(screen.getByText('Profil: phone'));
    expect(screen.getByLabelText('Not')).toHaveValue('salon perdesi');
    expect(mounts).toBe(2);
  });

  it('flag on with a lazy providers resource: nothing is imported on the phone; a wide profile loads it while the app stays usable', async () => {
    let release!: () => void;
    const importer = vi.fn(() => new Promise<{ default: typeof MarkerProviders }>(resolve => { release = () => resolve({ default: MarkerProviders }); }));
    const providers = wideResource('test-providers-lazy', importer, { retryDelayMs: 0 });
    const viewport = installViewport({ width: 360, height: 640, coarse: true });
    render(<AdaptiveRoot providers={providers} phoneWithoutAntd><Content /></AdaptiveRoot>);
    expect(importer).not.toHaveBeenCalled();

    act(() => viewport.set({ width: 1440, height: 900, fine: true, hover: true }));
    expect(importer).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Profil: desktop')).toBeInTheDocument();
    expect(screen.queryByTestId('wide-providers')).toBeNull();

    await act(async () => { release(); });
    expect(screen.getByTestId('wide-providers')).toContainElement(screen.getByText('Profil: desktop'));
  });

  // Sağlayıcı gelince alt ağaç bir kez yeniden bağlanır (bilinen bedel). O ana kadar kök aria-busy="true" taşır: yardımcı
  // teknoloji ve hazır sinyali (e2e openAdmin: [aria-busy="true"] yok) yeniden bağlanmadan önceki ağacı bitmiş saymaz.
  it('lazy providers on a wide profile: the root is aria-busy until they attach; the phone is never busy', async () => {
    let release!: () => void;
    const importer = vi.fn(() => new Promise<{ default: typeof MarkerProviders }>(resolve => { release = () => resolve({ default: MarkerProviders }); }));
    const providers = wideResource('test-providers-busy', importer, { retryDelayMs: 0 });
    const viewport = installViewport({ width: 320, height: 568, coarse: true });
    const { container } = render(<AdaptiveRoot providers={providers} phoneWithoutAntd><Content /></AdaptiveRoot>);
    const root = container.firstElementChild as HTMLElement;
    expect(root).not.toHaveAttribute('aria-busy');

    act(() => viewport.set({ width: 1440, height: 900, fine: true, hover: true }));
    expect(root).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Profil: desktop')).toBeInTheDocument();

    await act(async () => { release(); });
    expect(screen.getByTestId('wide-providers')).toContainElement(screen.getByText('Profil: desktop'));
    expect(root).not.toHaveAttribute('aria-busy');
  });

  it('lazy providers that fail twice: busy ends, the wide notice offers a retry and the app stays usable', async () => {
    const importer = vi.fn(() => Promise.reject(new Error('ağ yok')));
    const providers = wideResource('test-providers-fail', importer, { retryDelayMs: 0 });
    installViewport({ width: 1440, height: 900, fine: true, hover: true });
    const { container } = render(<AdaptiveRoot providers={providers} phoneWithoutAntd><Content /></AdaptiveRoot>);
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveAttribute('aria-busy', 'true');

    await act(async () => { await providers.load().catch(() => {}); });
    expect(importer).toHaveBeenCalledTimes(2);
    expect(root).not.toHaveAttribute('aria-busy');
    expect(screen.getByRole('button', { name: 'Yeniden dene' })).toBeInTheDocument();
    expect(screen.getByText('Profil: desktop')).toBeInTheDocument();
    expect(screen.queryByTestId('wide-providers')).toBeNull();
  });

  it('a static providers component never makes the root busy', () => {
    installViewport({ width: 1440, height: 900, fine: true, hover: true });
    const { container } = render(<AdaptiveRoot providers={MarkerProviders} phoneWithoutAntd><Content /></AdaptiveRoot>);
    expect(container.firstElementChild).not.toHaveAttribute('aria-busy');
    expect(screen.getByTestId('wide-providers')).toBeInTheDocument();
  });
});

describe('WideProviders', () => {
  function ConfigProbe() {
    const config = useContext(ConfigProvider.ConfigContext);
    const theme = config.theme as { token?: { motion?: boolean; fontFamily?: string } } | undefined;
    return <p>{`locale=${config.locale?.locale ?? 'yok'} motion=${String(theme?.token?.motion)} font=${theme?.token?.fontFamily ?? 'yok'}`}</p>;
  }

  it('provides the Turkish locale and the aile theme', () => {
    installViewport({ width: 1440, height: 900 });
    render(<WideProviders><ConfigProbe /></WideProviders>);
    expect(screen.getByText('locale=tr motion=true font=Outfit, system-ui, sans-serif')).toBeInTheDocument();
  });

  it('turns antd motion off under prefers-reduced-motion', () => {
    installViewport({ width: 1440, height: 900, reducedMotion: true });
    render(<WideProviders><ConfigProbe /></WideProviders>);
    expect(screen.getByText(/motion=false/)).toBeInTheDocument();
  });
});
