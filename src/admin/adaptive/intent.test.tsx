import { act, fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { chunkFailureStatus, isChunkLoadError, retryOnRecovery } from './chunkError';
import { useIntentLoad } from './intent';
import { isChunkLoadError as loaderIsChunkLoadError, lazyResource, type WideResource } from './loader';

// Niyet/önyükleme/iptal kalıbı (adaptive/intent.ts): tembel bir modül (lazyResource) ilk niyette (işaretçi basma, odak)
// yalnız önyüklenir; açık etkinleştirme (tıklama, "Yeniden dene") hatayı sıfırlayıp yükler ve isteği kurar. Düşmüş
// yükleme isteği kapatır; bekleyen istek Escape ya da çapa (açan denetim) dışındaki etkileşimle iptal edilir; iptalden ya
// da düşüşten sonra gelen modül hiçbir şeyi kendiliğinden açmaz. retryOnRecovery düşmüş kaynağı bağlantı gelince ya da
// bir sonraki etkileşimde bir kez yeniden dener.

let seq = 0;
const key = (name: string) => `intent-${name}-${(seq += 1)}`;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

type Module = { label: string };

/** Her çağrıda yeni bir ertelenmiş söz veren içe aktarıcı; testler sırayla çözer ya da reddeder. */
function controlledImporter() {
  const calls: ReturnType<typeof deferred<Module>>[] = [];
  const importer = vi.fn(() => {
    const call = deferred<Module>();
    calls.push(call);
    return call.promise;
  });
  return { importer, calls, last: () => calls[calls.length - 1]! };
}

function Harness({ resource }: { resource: WideResource<Module> }) {
  const anchor = useRef<HTMLButtonElement | null>(null);
  const intent = useIntentLoad(resource, anchor);
  const open = intent.phase === 'requested' && intent.state.status === 'ready';
  return (
    <div>
      <button ref={anchor} type="button" onPointerDown={intent.preload} onFocus={intent.preload} onClick={intent.request}>Aç</button>
      <button type="button">Başka</button>
      <p data-testid="phase">{intent.phase}</p>
      {open ? <p role="dialog" aria-label="Açık">açık</p> : null}
      {intent.phase === 'failed' ? <button type="button" onClick={intent.request}>Yeniden dene</button> : null}
      <button type="button" onClick={intent.cancel}>Kapat</button>
    </div>
  );
}

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

describe('useIntentLoad', () => {
  it('intent (focus, pointerdown) only preloads: nothing is requested and a ready module opens nothing', async () => {
    const { importer, last } = controlledImporter();
    const resource = lazyResource<Module>(key('preload'), importer, { retryDelayMs: 0 });
    render(<Harness resource={resource} />);
    const button = screen.getByRole('button', { name: 'Aç' });
    act(() => button.focus());
    expect(importer).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(button);
    expect(importer).toHaveBeenCalledTimes(1);
    await act(async () => { last().resolve({ label: 'modül' }); });
    expect(resource.getState().status).toBe('ready');
    expect(screen.getByTestId('phase')).toHaveTextContent('idle');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a failed request becomes "failed"; a later intent never restarts it and never opens (WCAG 3.2.1)', async () => {
    const { importer, calls } = controlledImporter();
    const resource = lazyResource<Module>(key('failed'), importer, { retryDelayMs: 0 });
    render(<Harness resource={resource} />);
    const button = screen.getByRole('button', { name: 'Aç' });
    fireEvent.click(button);
    expect(screen.getByTestId('phase')).toHaveTextContent('requested');
    await act(async () => { calls[0]!.reject(new Error('ağ')); });
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    await act(async () => { calls[1]!.reject(new Error('ağ')); });
    expect(resource.getState().status).toBe('error');
    expect(screen.getByTestId('phase')).toHaveTextContent('failed');

    // Bağlantı geldi; kullanıcı yalnız odaklanır ya da basar: yeniden deneme yok, hiçbir şey açılmaz.
    act(() => { button.blur(); button.focus(); });
    fireEvent.pointerDown(button);
    await flush();
    expect(importer).toHaveBeenCalledTimes(2);
    expect(resource.getState().status).toBe('error');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('phase')).toHaveTextContent('failed');

    // Açık etkinleştirme yeniden dener ve açar.
    fireEvent.click(screen.getByRole('button', { name: 'Yeniden dene' }));
    expect(importer).toHaveBeenCalledTimes(3);
    await act(async () => { calls[2]!.resolve({ label: 'modül' }); });
    expect(screen.getByRole('dialog', { name: 'Açık' })).toBeInTheDocument();
  });

  it.each([
    ['Escape', (other: HTMLElement) => { void other; fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' }); }],
    ['pointerdown elsewhere', (other: HTMLElement) => { fireEvent.pointerDown(other); }],
    ['focus elsewhere', (other: HTMLElement) => { act(() => other.focus()); }],
  ] as const)('%s cancels the pending request; the late module opens nothing', async (_name, interact) => {
    const { importer, last } = controlledImporter();
    const resource = lazyResource<Module>(key('cancel'), importer, { retryDelayMs: 0 });
    render(<Harness resource={resource} />);
    const button = screen.getByRole('button', { name: 'Aç' });
    act(() => button.focus());
    fireEvent.click(button);
    expect(screen.getByTestId('phase')).toHaveTextContent('requested');

    // Açan denetimin kendisindeki etkileşim iptal etmez (ikinci basış, Enter).
    fireEvent.pointerDown(button);
    fireEvent.keyDown(button, { key: 'Enter' });
    expect(screen.getByTestId('phase')).toHaveTextContent('requested');

    interact(screen.getByRole('button', { name: 'Başka' }));
    expect(screen.getByTestId('phase')).toHaveTextContent('idle');
    await act(async () => { last().resolve({ label: 'geç' }); });
    expect(resource.getState().status).toBe('ready');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('interaction after the module is ready does not cancel the open request (the opened layer owns it)', async () => {
    const { importer, last } = controlledImporter();
    const resource = lazyResource<Module>(key('open'), importer, { retryDelayMs: 0 });
    render(<Harness resource={resource} />);
    fireEvent.click(screen.getByRole('button', { name: 'Aç' }));
    await act(async () => { last().resolve({ label: 'modül' }); });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Başka' }));
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Kapat' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('phase')).toHaveTextContent('idle');
  });
});

describe('retryOnRecovery', () => {
  const failing = async (name: string) => {
    const { importer, calls } = controlledImporter();
    const resource = lazyResource<Module>(key(name), importer, { retryDelayMs: 0 });
    const load = resource.load().catch(() => null);
    calls[0]!.reject(new Error('ağ'));
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    calls[1]!.reject(new Error('ağ'));
    await load;
    expect(resource.getState().status).toBe('error');
    return { resource, importer, calls };
  };

  it.each([
    ['online', () => window.dispatchEvent(new Event('online'))],
    ['pointerdown', () => fireEvent.pointerDown(document.body)],
    ['keydown', () => fireEvent.keyDown(document.body, { key: 'a' })],
  ] as const)('retries a failed resource once on the next %s', async (_name, trigger) => {
    const { resource, importer, calls } = await failing('recover');
    retryOnRecovery(resource);
    retryOnRecovery(resource); // tekil: iki kez kurulsa da bir deneme
    expect(importer).toHaveBeenCalledTimes(2);
    trigger();
    expect(importer).toHaveBeenCalledTimes(3);
    calls[2]!.resolve({ label: 'geldi' });
    await vi.waitFor(() => expect(resource.getState().status).toBe('ready'));
    trigger();
    expect(importer).toHaveBeenCalledTimes(3);
  });
});

describe('chunkError', () => {
  it('is the single chunk-load classifier: loader re-exports it; offline chunk errors are plain errors', () => {
    expect(loaderIsChunkLoadError).toBe(isChunkLoadError);
    const chunk = new TypeError('Failed to fetch dynamically imported module: http://127.0.0.1/aile/assets/contract-AbCd.js');
    expect(isChunkLoadError(chunk)).toBe(true);
    expect(isChunkLoadError(new Error('ağ'))).toBe(false);
    // Saran hata (ör. ContractLoadError, test çatısının mock sarmalayıcısı) nedeniyle sınıflanır; döngüsel neden sonsuz değil.
    expect(isChunkLoadError(new Error('sarmalayıcı', { cause: chunk }))).toBe(true);
    expect(isChunkLoadError(new Error('sarmalayıcı', { cause: new Error('ağ') }))).toBe(false);
    const loop = new Error('döngü') as Error & { cause?: unknown };
    loop.cause = loop;
    expect(isChunkLoadError(loop)).toBe(false);
    expect(chunkFailureStatus(chunk)).toBe('stale-build');
    expect(chunkFailureStatus(new Error('ağ'))).toBe('error');
    const online = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    try {
      expect(chunkFailureStatus(chunk)).toBe('error');
    } finally {
      online.mockRestore();
    }
  });
});
