import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState, type ComponentType, type ReactNode } from 'react';
import { ProfileContext } from './context';
import { Adaptive, WIDE_RETRY_DELAY_MS, WideOnly, isChunkLoadError, lazyWide, wideManifest, wideResource } from './loader';
import { reloadPage } from './reload';
import type { Profile } from './profile';

vi.mock('./reload', () => ({ reloadPage: vi.fn() }));

// Her test kendi anahtarını kullanır: kayıt defteri modül düzeyindedir (aynı anahtar = aynı kaynak).
let seq = 0;
const key = (name: string) => `${name}-${(seq += 1)}`;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

interface WideProps { label: string }
function WideView({ label }: WideProps) { return <p>Geniş görünüm: {label}</p>; }
type WideModule = { default: ComponentType<WideProps> };
const wideModule: WideModule = { default: WideView };
const chunkError = () => new TypeError('Failed to fetch dynamically imported module: http://127.0.0.1:5310/aile/assets/Tablo.wide-a1b2c3.js');

function AtProfile({ profile, children }: { profile: Profile; children: ReactNode }) {
  return <ProfileContext.Provider value={profile}>{children}</ProfileContext.Provider>;
}

function PhoneView() {
  const [note, setNote] = useState('');
  return (
    <label>
      Telefon notu
      <input value={note} onChange={event => setNote(event.target.value)} />
    </label>
  );
}

describe('wideResource', () => {
  it('deduplicates the in-flight load for the same key (second importer never runs)', async () => {
    const pending = deferred<WideModule>();
    const first = vi.fn(() => pending.promise);
    const second = vi.fn(() => Promise.resolve(wideModule));
    const name = key('dedupe');
    const a = wideResource(name, first);
    const b = wideResource(name, second);
    expect(b).toBe(a);
    const loads = [a.load(), a.load(), b.load()];
    expect(a.getState().status).toBe('loading');
    pending.resolve(wideModule);
    const modules = await Promise.all(loads);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    expect(new Set(modules)).toEqual(new Set([wideModule]));
    expect(a.getState()).toEqual({ status: 'ready', module: wideModule });
    await a.load();
    expect(first).toHaveBeenCalledTimes(1);
  });

  it('retries once after a backoff, then succeeds', async () => {
    vi.useFakeTimers();
    try {
      const importer = vi.fn<() => Promise<WideModule>>()
        .mockRejectedValueOnce(new TypeError('Failed to fetch dynamically imported module: x.js'))
        .mockResolvedValueOnce(wideModule);
      const resource = wideResource(key('retry'), importer);
      const loading = resource.load();
      await vi.advanceTimersByTimeAsync(WIDE_RETRY_DELAY_MS - 1);
      expect(importer).toHaveBeenCalledTimes(1);
      expect(resource.getState().status).toBe('loading');
      await vi.advanceTimersByTimeAsync(1);
      await expect(loading).resolves.toBe(wideModule);
      expect(importer).toHaveBeenCalledTimes(2);
      expect(resource.getState().status).toBe('ready');
    } finally {
      vi.useRealTimers();
    }
  });

  it('ends in a recoverable error after the retry fails; retry() loads again', async () => {
    const importer = vi.fn<() => Promise<WideModule>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new Error('boom again'))
      .mockResolvedValueOnce(wideModule);
    const resource = wideResource(key('error'), importer, { retryDelayMs: 0 });
    await expect(resource.load()).rejects.toThrow('boom again');
    expect(resource.getState()).toMatchObject({ status: 'error' });
    expect(importer).toHaveBeenCalledTimes(2);
    // Hata durumunda load() kendiliğinden döngüye girmez.
    await expect(resource.load()).rejects.toThrow('boom again');
    expect(importer).toHaveBeenCalledTimes(2);
    await expect(resource.retry()).resolves.toBe(wideModule);
    expect(resource.getState().status).toBe('ready');
  });

  it('classifies a chunk that is gone after the retry as version skew (stale-build)', async () => {
    const importer = vi.fn(() => Promise.reject(chunkError()));
    const resource = wideResource(key('skew'), importer, { retryDelayMs: 0 });
    await expect(resource.load()).rejects.toThrow(/dynamically imported module/);
    expect(resource.getState().status).toBe('stale-build');
    expect(importer).toHaveBeenCalledTimes(2);
  });

  it('does not claim a new version while the browser is offline', async () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    try {
      const resource = wideResource(key('offline'), () => Promise.reject(chunkError()), { retryDelayMs: 0 });
      await expect(resource.load()).rejects.toThrow();
      expect(resource.getState().status).toBe('error');
    } finally {
      online.mockRestore();
    }
  });

  it('lists every registered resource in the manifest', async () => {
    const name = key('manifest');
    const resource = wideResource(name, () => Promise.resolve(wideModule));
    expect(wideManifest()).toContainEqual({ key: name, status: 'idle' });
    await resource.load();
    expect(wideManifest()).toContainEqual({ key: name, status: 'ready' });
  });
});

describe('isChunkLoadError', () => {
  it.each([
    ['Chromium', new TypeError('Failed to fetch dynamically imported module: https://x/aile/assets/a-1.js')],
    ['WebKit', new TypeError('Importing a module script failed.')],
    ['Gecko', new TypeError('error loading dynamically imported module: https://x/a.js')],
    ['Vite CSS preload', new Error('Unable to preload CSS for /aile/assets/a-1.css')],
    ['HTML served for a missing chunk', new TypeError('Failed to load module script: Expected a JavaScript module script but the server responded with a MIME type of "text/html".')],
    ['webpack-style', Object.assign(new Error('Loading chunk 7 failed.'), { name: 'ChunkLoadError' })],
  ])('recognises %s', (_name, error) => {
    expect(isChunkLoadError(error)).toBe(true);
  });

  it.each([[new Error('boom')], [new TypeError('x is not a function')], ['Failed to fetch dynamically imported module'], [null], [undefined]])(
    'ignores %s', error => { expect(isChunkLoadError(error)).toBe(false); },
  );
});

describe('<Adaptive>', () => {
  it('on the phone profile renders the phone presentation and never downloads the wide module', () => {
    const importer = vi.fn(() => Promise.resolve(wideModule));
    const Wide = lazyWide(key('phone'), importer);
    render(<AtProfile profile="phone"><Adaptive phone={<PhoneView />} wide={<Wide label="Tablo" />} /></AtProfile>);
    expect(screen.getByLabelText('Telefon notu')).toBeInTheDocument();
    expect(importer).not.toHaveBeenCalled();
  });

  it('keeps the phone presentation usable while the wide module loads, then swaps it in', async () => {
    const pending = deferred<WideModule>();
    const importer = vi.fn(() => pending.promise);
    const Wide = lazyWide(key('waiting'), importer);
    render(<AtProfile profile="tablet"><Adaptive phone={<PhoneView />} wide={<Wide label="Tablo" />} /></AtProfile>);
    const input = screen.getByLabelText('Telefon notu');
    fireEvent.change(input, { target: { value: 'kiler rafı' } });
    expect(input).toHaveValue('kiler rafı');
    expect(importer).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve(wideModule); });
    expect(screen.getByText('Geniş görünüm: Tablo')).toBeInTheDocument();
    expect(screen.queryByLabelText('Telefon notu')).toBeNull();
  });

  it('does not remount the phone presentation when the profile widens while loading', () => {
    const Wide = lazyWide(key('continuity'), () => new Promise<WideModule>(() => {}));
    const tree = (profile: Profile) => <AtProfile profile={profile}><Adaptive phone={<PhoneView />} wide={<Wide label="Tablo" />} /></AtProfile>;
    const { rerender } = render(tree('phone'));
    fireEvent.change(screen.getByLabelText('Telefon notu'), { target: { value: 'balkon' } });
    rerender(tree('tablet'));
    expect(screen.getByLabelText('Telefon notu')).toHaveValue('balkon');
  });

  it('stale guard: a load that finishes after the profile went back to phone does not bring the wide UI back', async () => {
    const pending = deferred<WideModule>();
    const importer = vi.fn(() => pending.promise);
    const Wide = lazyWide(key('stale'), importer);
    const tree = (profile: Profile) => <AtProfile profile={profile}><Adaptive phone={<PhoneView />} wide={<Wide label="Tablo" />} /></AtProfile>;
    const { rerender } = render(tree('tablet'));
    rerender(tree('phone'));
    await act(async () => { pending.resolve(wideModule); });
    expect(screen.getByLabelText('Telefon notu')).toBeInTheDocument();
    expect(screen.queryByText(/Geniş görünüm/)).toBeNull();
    // Geri genişleyince modül hazırdır; yeniden indirilmez.
    rerender(tree('desktop'));
    expect(screen.getByText('Geniş görünüm: Tablo')).toBeInTheDocument();
    expect(importer).toHaveBeenCalledTimes(1);
  });

  it('after a failed retry shows a recoverable "Yeniden dene" above the phone presentation', async () => {
    const importer = vi.fn<() => Promise<WideModule>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new Error('boom again'))
      .mockResolvedValueOnce(wideModule);
    const Wide = lazyWide(key('recover'), importer, { retryDelayMs: 0 });
    render(<AtProfile profile="desktop"><Adaptive phone={<PhoneView />} wide={<Wide label="Tablo" />} /></AtProfile>);
    const retry = await screen.findByRole('button', { name: 'Yeniden dene' });
    expect(screen.getByRole('status')).toHaveTextContent('Geniş görünüm yüklenemedi');
    expect(screen.getByLabelText('Telefon notu')).toBeInTheDocument();
    fireEvent.click(retry);
    expect(await screen.findByText('Geniş görünüm: Tablo')).toBeInTheDocument();
    expect(importer).toHaveBeenCalledTimes(3);
  });

  it('on version skew offers "Yeni sürüm var · Yenile" and reloads the page on request', async () => {
    const Wide = lazyWide(key('reload'), (): Promise<WideModule> => Promise.reject(chunkError()), { retryDelayMs: 0 });
    render(<AtProfile profile="tablet"><Adaptive phone={<PhoneView />} wide={<Wide label="Tablo" />} /></AtProfile>);
    const reload = await screen.findByRole('button', { name: 'Yenile' });
    expect(screen.getByRole('status')).toHaveTextContent('Yeni sürüm var');
    expect(screen.getByLabelText('Telefon notu')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Yeniden dene' })).toBeNull();
    fireEvent.click(reload);
    expect(reloadPage).toHaveBeenCalledTimes(1);
  });

  it('switches plain (non-lazy) wide content by profile', () => {
    const tree = (profile: Profile) => <AtProfile profile={profile}><Adaptive phone={<p>Kısa liste</p>} wide={<p>Tam tablo</p>} /></AtProfile>;
    const { rerender } = render(tree('phone'));
    expect(screen.getByText('Kısa liste')).toBeInTheDocument();
    rerender(tree('tablet'));
    expect(screen.getByText('Tam tablo')).toBeInTheDocument();
    expect(screen.queryByText('Kısa liste')).toBeNull();
  });
});

describe('<WideOnly> and a standalone lazy component', () => {
  it('renders nothing (or the fallback) on the phone profile and never downloads', () => {
    const importer = vi.fn(() => Promise.resolve(wideModule));
    const Wide = lazyWide(key('only-phone'), importer);
    const { rerender } = render(<AtProfile profile="phone"><WideOnly><Wide label="Pivot" /></WideOnly></AtProfile>);
    expect(screen.queryByText(/Geniş görünüm/)).toBeNull();
    rerender(<AtProfile profile="phone"><WideOnly fallback={<p>Pivot geniş ekranda</p>}><Wide label="Pivot" /></WideOnly></AtProfile>);
    expect(screen.getByText('Pivot geniş ekranda')).toBeInTheDocument();
    expect(importer).not.toHaveBeenCalled();
  });

  it('loads and renders its lazy children on a wide profile', async () => {
    const Wide = lazyWide(key('only-wide'), () => Promise.resolve(wideModule));
    render(<AtProfile profile="desktop"><WideOnly><Wide label="Pivot" /></WideOnly></AtProfile>);
    expect(await screen.findByText('Geniş görünüm: Pivot')).toBeInTheDocument();
  });

  it('a lazy component rendered on the phone profile shows only its own fallback (stale guard)', async () => {
    const importer = vi.fn(() => Promise.resolve(wideModule));
    const Wide = lazyWide(key('standalone'), importer);
    await Wide.preload();
    render(<AtProfile profile="phone"><Wide label="Pivot" wideFallback={<p>Temel görünüm</p>} /></AtProfile>);
    expect(screen.getByText('Temel görünüm')).toBeInTheDocument();
    expect(screen.queryByText(/Geniş görünüm/)).toBeNull();
    expect(Wide.resource.getState().status).toBe('ready');
  });
});
