import { act, fireEvent, render, screen } from '@testing-library/react';
import { useContext, useEffect, useState, type ReactNode } from 'react';
import { designTokens } from '../../design/tokens.ts';
import { ConfigProvider } from '../ui/antd';
import { AdaptiveRoot } from './AdaptiveRoot';
import { useInputLayers, useProfile } from './context';
import { PHONE_WITHOUT_ANTD } from './flags';
import { lazyWide, wideResource } from './loader';
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

describe('AdaptiveRoot · profil değişiminde sabit ağaç', () => {
  it('ships with PHONE_WITHOUT_ANTD = true (geçiş kesimi: telefon antd sağlayıcısı olmadan render eder)', () => {
    expect(PHONE_WITHOUT_ANTD).toBe(true);
  });

  // Kök neden (t3-root): sağlayıcı ilk geniş profilde ağacın üstüne eklenince React bütün çalışma alanını yeniden
  // kuruyordu (main, odak, açık katmanlar ve URL'de olmayan taslaklar kayboluyordu). Ağaç biçimi artık profile bağlı değil.
  it('without providers the children render directly in the root and are never remounted across profiles', () => {
    const viewport = installViewport({ width: 320, height: 568, coarse: true });
    const { container } = render(<AdaptiveRoot className="aile-admin"><Content /></AdaptiveRoot>);
    const root = container.firstElementChild as HTMLElement;
    const section = root.firstElementChild;
    expect(section?.tagName).toBe('SECTION');
    const input = screen.getByRole('textbox', { name: 'Not' });
    fireEvent.change(input, { target: { value: 'salon perdesi' } });
    input.focus();

    for (const next of [{ width: 1440, height: 900, fine: true, hover: true }, { width: 820, height: 1180 }, { width: 375, height: 667 }]) {
      act(() => viewport.set(next));
      expect(root.firstElementChild, `${next.width}×${next.height}`).toBe(section);
      expect(screen.getByRole('textbox', { name: 'Not' })).toBe(input);
      expect(input).toHaveValue('salon perdesi');
      expect(input).toHaveFocus();
    }
    expect(mounts).toBe(1);
    expect(root).not.toHaveAttribute('aria-busy');
  });

  it('a static providers component wraps from the first render on every profile; widening and narrowing never remount', () => {
    const viewport = installViewport({ width: 320, height: 568, coarse: true });
    render(<AdaptiveRoot providers={MarkerProviders}><Content /></AdaptiveRoot>);
    expect(screen.getByTestId('wide-providers')).toContainElement(screen.getByText('Profil: phone'));
    const wrapper = screen.getByTestId('wide-providers');
    fireEvent.change(screen.getByLabelText('Not'), { target: { value: 'salon perdesi' } });

    act(() => viewport.set({ width: 820, height: 1180 }));
    expect(screen.getByTestId('wide-providers')).toBe(wrapper);
    expect(wrapper).toContainElement(screen.getByText('Profil: tablet'));
    act(() => viewport.set({ width: 375, height: 667 }));
    expect(screen.getByTestId('wide-providers')).toBe(wrapper);
    expect(screen.getByLabelText('Not')).toHaveValue('salon perdesi');
    expect(mounts).toBe(1);
  });

  it('phoneWithoutAntd is deprecated and has no effect on the tree', () => {
    installViewport({ width: 320, height: 568, coarse: true });
    const { unmount } = render(<AdaptiveRoot providers={MarkerProviders} phoneWithoutAntd><Content /></AdaptiveRoot>);
    expect(screen.getByTestId('wide-providers')).toContainElement(screen.getByText('Profil: phone'));
    unmount();
    const { container } = render(<AdaptiveRoot phoneWithoutAntd={false}><Content /></AdaptiveRoot>);
    expect(screen.queryByTestId('wide-providers')).toBeNull();
    expect(container.firstElementChild).not.toHaveAttribute('phonewithoutantd');
  });
});

// Hazır sinyali: geniş modül (lazyWide/wideResource) yüklenirken kök data-wide-loading taşır; e2e openAdmin ve profil
// değişimi denetimleri bunu bekler. aria-busy değil: bekleme boyunca telefon sunumu kullanılabilir kalır, ağaç değişmez.
describe('AdaptiveRoot · geniş yükleme sinyali (data-wide-loading)', () => {
  interface IslandProps { label: string }
  function IslandView({ label }: IslandProps) { return <p>Geniş ada: {label}</p>; }
  type IslandModule = { default: (props: IslandProps) => ReactNode };
  let seq = 0;
  const key = (name: string) => `adaptive-root-${name}-${(seq += 1)}`;
  function held() {
    let release!: () => void;
    let fail!: (error: unknown) => void;
    const importer = vi.fn(() => new Promise<IslandModule>((resolve, reject) => { release = () => resolve({ default: IslandView }); fail = reject; }));
    return { importer, release: () => release(), fail: (error: unknown) => fail(error) };
  }

  it('is absent on the phone (nothing downloads) and present while a wide island loads, before the browser paints', async () => {
    const load = held();
    const Island = lazyWide(key('island'), load.importer, { retryDelayMs: 0 });
    const viewport = installViewport({ width: 320, height: 568, coarse: true });
    const { container } = render(<AdaptiveRoot><Island label="gezinme" wideFallback={<p>Telefon sunumu</p>} /></AdaptiveRoot>);
    const root = container.firstElementChild as HTMLElement;
    expect(root).not.toHaveAttribute('data-wide-loading');
    expect(load.importer).not.toHaveBeenCalled();

    act(() => viewport.set({ width: 1440, height: 900, fine: true, hover: true }));
    expect(load.importer).toHaveBeenCalledTimes(1);
    expect(root).toHaveAttribute('data-wide-loading', '');
    expect(root).not.toHaveAttribute('aria-busy');
    expect(screen.getByText('Telefon sunumu')).toBeInTheDocument();

    await act(async () => { load.release(); });
    expect(screen.getByText('Geniş ada: gezinme')).toBeInTheDocument();
    expect(root).not.toHaveAttribute('data-wide-loading');
  });

  it('ends after a load that fails twice (the recoverable notice is shown)', async () => {
    const importer = vi.fn((): Promise<IslandModule> => Promise.reject(new Error('ağ yok')));
    const Island = lazyWide(key('fail'), importer, { retryDelayMs: 0 });
    installViewport({ width: 1440, height: 900, fine: true, hover: true });
    const { container } = render(<AdaptiveRoot><Island label="gezinme" wideFallback={<p>Telefon sunumu</p>} /></AdaptiveRoot>);
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveAttribute('data-wide-loading', '');

    await act(async () => { await Island.resource.load().catch(() => {}); });
    expect(importer).toHaveBeenCalledTimes(2);
    expect(root).not.toHaveAttribute('data-wide-loading');
    expect(screen.getByRole('button', { name: 'Yeniden dene' })).toBeInTheDocument();
    expect(screen.getByText('Telefon sunumu')).toBeInTheDocument();
  });

  it('counts every in-flight wide resource, including a preload started outside the tree', async () => {
    let release!: () => void;
    const resource = wideResource(key('preload'), () => new Promise<IslandModule>(resolve => { release = () => resolve({ default: IslandView }); }));
    installViewport({ width: 1440, height: 900, fine: true, hover: true });
    const { container } = render(<AdaptiveRoot><Content /></AdaptiveRoot>);
    const root = container.firstElementChild as HTMLElement;
    expect(root).not.toHaveAttribute('data-wide-loading');

    act(() => { void resource.load(); });
    expect(root).toHaveAttribute('data-wide-loading', '');
    expect(mounts).toBe(1);
    await act(async () => { release(); });
    expect(root).not.toHaveAttribute('data-wide-loading');
    expect(mounts).toBe(1);
  });
});

describe('WideProviders', () => {
  function ConfigProbe() {
    const config = useContext(ConfigProvider.ConfigContext);
    const theme = config.theme as { token?: { motion?: boolean; fontFamily?: string; motionDurationMid?: string } } | undefined;
    return <p>{`locale=${config.locale?.locale ?? 'yok'} motion=${String(theme?.token?.motion)} sure=${theme?.token?.motionDurationMid ?? 'yok'} font=${theme?.token?.fontFamily ?? 'yok'}`}</p>;
  }

  it('provides the Turkish locale and the aile theme', () => {
    installViewport({ width: 1440, height: 900 });
    render(<WideProviders><ConfigProbe /></WideProviders>);
    expect(screen.getByText(`locale=tr motion=true sure=0.24s font=${designTokens.fontSans}`)).toBeInTheDocument();
  });

  // antd MotionWrapper, token.motion ilk kez false olunca alt ağacı MotionProvider ile sarar: ağaç biçimi değişir ve
  // bütün uygulama yeniden kurulur (odak/durum kaybı). Bu yüzden motion hep açık; azaltılmış hareket süre tokenlarıdır.
  it('expresses prefers-reduced-motion with zero duration tokens; antd motion itself stays on', () => {
    installViewport({ width: 1440, height: 900, reducedMotion: true });
    render(<WideProviders><ConfigProbe /></WideProviders>);
    expect(screen.getByText(`locale=tr motion=true sure=0s font=${designTokens.fontSans}`)).toBeInTheDocument();
  });

  it('keeps the app mounted with its state and focus when prefers-reduced-motion changes at runtime', () => {
    const viewport = installViewport({ width: 1440, height: 900, fine: true, hover: true });
    render(<WideProviders><Content /><ConfigProbe /></WideProviders>);
    const input = screen.getByRole('textbox', { name: 'Not' });
    fireEvent.change(input, { target: { value: 'taslak' } });
    input.focus();
    expect(mounts).toBe(1);

    act(() => viewport.set({ reducedMotion: true }));
    expect(mounts, 'alt ağaç yeniden kurulmamalı').toBe(1);
    expect(screen.getByRole('textbox', { name: 'Not' })).toBe(input);
    expect(input).toHaveValue('taslak');
    expect(input).toHaveFocus();
    expect(screen.getByText(/ sure=0s /)).toBeInTheDocument();

    act(() => viewport.set({ reducedMotion: false }));
    expect(screen.getByText(/ sure=0.24s /)).toBeInTheDocument();
    expect(mounts).toBe(1);
    expect(input).toHaveValue('taslak');
    expect(input).toHaveFocus();
  });

  // antd App bileşeni kendi kabını antd özet sınıfıyla çizer; antd'nin genel bağlantı sıfırlaması (a { transition:
  // color … } — eğrisiz, yani tarayıcı varsayılanı ease) bu sınıfın altındaki her <a>'ya, ürünün kendi bağlantılarına
  // (a.aile-admin-skip) da işler. Ürün bileşenleri antd kullanmaz: sağlayıcı DOM öğesi çizmez, yalnız bağlam verir.
  it('renders no wrapper element: the app is a direct child, so antd global link styles cannot reach product anchors', () => {
    installViewport({ width: 1440, height: 900 });
    const { container } = render(<WideProviders><a className="aile-admin-skip" href="#admin-content">İçeriğe geç</a></WideProviders>);
    expect(container.firstElementChild).toBe(screen.getByRole('link', { name: 'İçeriğe geç' }));
    expect(container.querySelector('.ant-app, [class*="css-"]')).toBeNull();
  });
});
