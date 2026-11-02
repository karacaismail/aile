import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentType } from 'react';
import type { IconProps } from './icons';

// Çekirdek dışı simgelerin tembel parçası (icons.extra.tsx) gerçek bekleme ve hata durumlarıyla (p-fix m5, m3). Parça
// sözü elle tutulur: önceki testlerin ön yüklemesi bu dosyada yoktur, her senaryo taze modül grafiğiyle başlar
// (vi.resetModules + dinamik import). Beklenen:
//  - Parça gelmeden simge aynı kutu ve aynı adla BOŞ çizilir (yol yok); parça gelince aynı öğe dolar.
//  - Parça düşerse (bir otomatik yeniden denemeden sonra) simge boş kalır; bağlantı gelince ('online') ya da kullanıcının
//    bir sonraki etkileşiminde bir kez yeniden denenir ve dolar. Yalnız yeniden çizim (montaj) yeni deneme başlatmaz.
//  - Çevrim içiyken parça yükleme hatası eski sürümdür: useIconsStatus 'stale-build' verir (rota "Yeni sürüm var · Yenile").

const extra = vi.hoisted(() => ({ attempts: 0, fail: null as Error | null, gate: null as Promise<void> | null, release: () => {} }));

type IconsModule = typeof import('./icons');
/** Taze modül grafiği: başarılı sahte parça önbelleğe alındığından her senaryo sahteyi yeniden kaydeder (doMock). */
async function freshIcons(): Promise<IconsModule> {
  vi.resetModules();
  vi.doMock('./icons.extra', async (importOriginal: () => Promise<Record<string, unknown>>) => {
    extra.attempts += 1;
    if (extra.gate) await extra.gate;
    if (extra.fail) throw extra.fail;
    return importOriginal();
  });
  return import('./icons');
}

beforeEach(() => {
  extra.attempts = 0;
  extra.fail = null;
  extra.gate = null;
});
afterEach(() => { extra.release(); });

const svgOf = (container: HTMLElement) => container.querySelector('svg')!;

describe('Icon › çekirdek dışı parça', () => {
  it('before the chunk arrives the glyph is an empty svg with the same box and name; the same element fills in', async () => {
    extra.gate = new Promise<void>(resolve => { extra.release = () => { extra.gate = null; resolve(); }; });
    const { Icon } = await freshIcons();
    const Glyph = Icon as ComponentType<IconProps>;
    const { container } = render(<Glyph name="close" label="Kapat" size={24} />);
    const empty = svgOf(container);
    expect(empty.childElementCount).toBe(0);
    expect(empty).toHaveAttribute('width', '24');
    expect(empty).toHaveAttribute('height', '24');
    expect(empty).toHaveAttribute('viewBox', '0 0 256 256');
    expect(empty).toHaveAttribute('fill', 'currentColor');
    expect(empty).toHaveAttribute('data-icon', 'close');
    expect(screen.getByRole('img', { name: 'Kapat' })).toBe(empty);
    await vi.waitFor(() => expect(extra.attempts).toBe(1));
    expect(svgOf(container).childElementCount).toBe(0);

    await act(async () => { extra.release(); });
    await vi.waitFor(() => expect(svgOf(container).childElementCount).toBeGreaterThan(0));
    const filled = svgOf(container);
    expect(filled).toHaveAttribute('width', '24');
    expect(filled).toHaveAttribute('height', '24');
    expect(filled).toHaveAttribute('viewBox', '0 0 256 256');
    expect(filled).toHaveAttribute('data-icon', 'close');
    expect(screen.getByRole('img', { name: 'Kapat' })).toBe(filled);
  });

  it.each([
    ['the connection comes back (online)', () => { window.dispatchEvent(new Event('online')); }],
    ['the next user interaction (pointerdown)', () => { fireEvent.pointerDown(document.body); }],
    ['the next user interaction (keydown)', () => { fireEvent.keyDown(document.body, { key: 'Tab' }); }],
  ] as const)('a failed chunk is retried once when %s; re-rendering alone does not retry', async (_name, recover) => {
    extra.fail = new Error('ağ hatası (sınama)');
    const { Icon, useIconsStatus } = await freshIcons();
    const Glyph = Icon as ComponentType<IconProps>;
    let status = '';
    function Probe() { status = useIconsStatus(); return null; }
    const view = render(<><Glyph name="download" label="İndir" /><Probe /></>);
    await vi.waitFor(() => expect(status).toBe('error'), { timeout: 3000 });
    expect(extra.attempts).toBe(2);
    expect(svgOf(view.container).childElementCount).toBe(0);
    expect(screen.getByRole('img', { name: 'İndir' })).toBeInTheDocument();

    // Yeniden çizim ve yeni simge montajı deneme başlatmaz (her montajda istek yok).
    view.rerender(<><Glyph name="download" label="İndir" /><Glyph name="plus" /><Probe /></>);
    await new Promise(resolve => { setTimeout(resolve, 50); });
    expect(extra.attempts).toBe(2);

    extra.fail = null;
    await act(async () => { recover(); });
    await vi.waitFor(() => expect(svgOf(view.container).childElementCount).toBeGreaterThan(0));
    expect(extra.attempts).toBe(3);
    expect(status).toBe('ready');
    expect(screen.getByRole('img', { name: 'İndir' })).toBeInTheDocument();
  });

  it('a chunk-load error while online is a stale build (route offers "Yeni sürüm var · Yenile")', async () => {
    extra.fail = new TypeError('Failed to fetch dynamically imported module: http://127.0.0.1/aile/assets/icons.extra-AbCd.js');
    const { Icon, useIconsStatus } = await freshIcons();
    const Glyph = Icon as ComponentType<IconProps>;
    let status = '';
    function Probe() { status = useIconsStatus(); return null; }
    render(<><Glyph name="close" label="Kapat" /><Probe /></>);
    await vi.waitFor(() => expect(status).toBe('stale-build'), { timeout: 3000 });
    expect(screen.getByRole('img', { name: 'Kapat' }).childElementCount).toBe(0);
  });

  it('preloadIcons() re-requests a failed chunk (page navigation is an explicit request)', async () => {
    extra.fail = new Error('ağ hatası (sınama)');
    const { preloadIcons } = await freshIcons();
    // vi.mock fabrikasının hatası vitest sarmalayıcısıyla gelir; asıl neden cause'tadır.
    await expect(preloadIcons()).rejects.toMatchObject({ cause: expect.objectContaining({ message: 'ağ hatası (sınama)' }) });
    expect(extra.attempts).toBe(2);
    extra.fail = null;
    const icons = await preloadIcons();
    expect(Object.keys(icons)).toContain('close');
    expect(extra.attempts).toBe(3);
  });
});
