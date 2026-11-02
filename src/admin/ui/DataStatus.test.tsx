import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataStatus, type DataStatusProps } from './DataStatus';
import type { DataStatusProps as ContractProps } from '../shell/contracts';

// Tasarım: components/DataStatus/README.md + envanter.md satırı + bundle.js DataStatus. Sayfa başlığının altındaki tazelik
// satırı: tek role="status" satırı, şerit yok; metinler README'den birebir. Saat tr-TR, Europe/Istanbul; başka güne ait
// okuma tarihiyle yazılır (contracts: "gösterim 28.10.2026 14:05"). Seçiciler role/label ile.
const SIMDI = new Date('2026-10-28T12:00:00Z'); // İstanbul 15:00
const OKUMA = '2026-10-28T11:32:00Z'; // İstanbul 14:32
const SON_IYI = '2026-10-28T06:10:00Z'; // İstanbul 09:10
const ONCEKI_GUN = '2026-10-27T11:32:00Z'; // İstanbul 27.10.2026 14:32
const NESIL = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';

beforeEach(() => {
  vi.useFakeTimers({ now: SIMDI, toFake: ['Date'] });
});
afterEach(() => {
  vi.useRealTimers();
});

const status = () => screen.getByRole('status');

describe('DataStatus', () => {
  it('fresh: "Son okuma 14:32 · Nesil a1b2c3 · Yenile" in one status line, Yenile calls onRefresh', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onRefresh = vi.fn();
    render(<DataStatus state="fresh" lastReadAt={OKUMA} generationId={NESIL} onRefresh={onRefresh} />);
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(status()).toHaveTextContent('Son okuma 14:32 · Nesil a1b2c3 · Yenile');
    expect(status()).toHaveAttribute('data-state', 'fresh');
    expect(status()).toHaveAttribute('data-tone', 'notr');
    const refresh = screen.getByRole('button', { name: 'Yenile' });
    expect(refresh).toBeEnabled();
    expect(refresh.querySelector('svg[data-icon="refresh"]')).toHaveAttribute('aria-hidden', 'true');
    await user.click(refresh);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Karşılaştır' })).toBeNull();
  });

  it('checking: "Okunuyor… · Son okuma 14:32 · Yenile" with Yenile disabled while reading', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onRefresh = vi.fn();
    render(<DataStatus state="checking" lastReadAt={OKUMA} generationId={NESIL} onRefresh={onRefresh} />);
    expect(status()).toHaveTextContent('Okunuyor… · Son okuma 14:32 · Yenile');
    expect(status()).toHaveAttribute('data-tone', 'notr');
    const refresh = screen.getByRole('button', { name: 'Yenile' });
    expect(refresh).toBeDisabled();
    await user.click(refresh);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('checking without a previous read says so by name', () => {
    render(<DataStatus state="checking" onRefresh={() => {}} />);
    expect(status()).toHaveTextContent('Okunuyor… · Son okuma henüz yok · Yenile');
  });

  it('stale: "Son başarılı nesil 09:10 · yenilenemedi · Yeniden dene" in the uyari tone with a decorative glyph', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onRefresh = vi.fn();
    render(<DataStatus state="stale" lastReadAt={OKUMA} lastGoodAt={SON_IYI} generationId={NESIL} onRefresh={onRefresh} />);
    expect(status()).toHaveTextContent('Son başarılı nesil 09:10 · yenilenemedi · Yeniden dene');
    expect(status()).toHaveAttribute('data-tone', 'uyari');
    const glyph = status().querySelector('svg[data-icon="alert"]');
    expect(glyph).toHaveAttribute('aria-hidden', 'true');
    await user.click(screen.getByRole('button', { name: 'Yeniden dene' }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Yenile' })).toBeNull();
  });

  it('error: starts with "Hata:" exactly once, keeps the last good generation and offers "Yeniden dene"', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onRefresh = vi.fn();
    const { unmount } = render(<DataStatus state="error" lastReadAt={OKUMA} lastGoodAt={SON_IYI} onRefresh={onRefresh} />);
    expect(status()).toHaveTextContent('Hata: Okuma başarısız 14:32 · Son başarılı nesil 09:10 · Yeniden dene');
    expect(status()).toHaveAttribute('data-tone', 'hata');
    expect(status().querySelector('svg[data-icon="alert"]')).toHaveAttribute('aria-hidden', 'true');
    await user.click(screen.getByRole('button', { name: 'Yeniden dene' }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    unmount();

    render(<DataStatus state="error" message="E-tabloya ulaşılamadı." />);
    expect(status()).toHaveTextContent('Hata: E-tabloya ulaşılamadı.');
    expect(status().textContent).not.toMatch(/Hata: Hata:/);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('conflict: "Çakışma: bu kayıt başka yerde değişti · iki sürüm var · Karşılaştır" calls onCompare, no Yenile', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onCompare = vi.fn();
    const onRefresh = vi.fn();
    render(<DataStatus state="conflict" lastReadAt={OKUMA} onRefresh={onRefresh} onCompare={onCompare} />);
    expect(status()).toHaveTextContent('Çakışma: bu kayıt başka yerde değişti · iki sürüm var · Karşılaştır');
    expect(status()).toHaveAttribute('data-tone', 'uyari');
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Karşılaştır' }));
    expect(onCompare).toHaveBeenCalledTimes(1);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('writes a read from another day with its date (28.10.2026 biçimi)', () => {
    render(<DataStatus state="fresh" lastReadAt={ONCEKI_GUN} generationId={NESIL} />);
    expect(status()).toHaveTextContent('Son okuma 27.10.2026 14:32 · Nesil a1b2c3');
  });

  it('names missing time and generation instead of hiding them, and draws no button without a handler', () => {
    render(<DataStatus state="fresh" />);
    expect(status()).toHaveTextContent('Son okuma bilinmiyor · Nesil bilinmiyor');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows the short generation id but keeps the full id on the element for tooling', () => {
    render(<DataStatus state="fresh" lastReadAt={OKUMA} generationId={NESIL} />);
    const nesil = screen.getByText('Nesil a1b2c3');
    expect(nesil).toHaveAttribute('data-generation-id', NESIL);
  });

  it('hides the separators from assistive technology; the words carry the meaning', () => {
    render(<DataStatus state="fresh" lastReadAt={OKUMA} generationId={NESIL} onRefresh={() => {}} />);
    const seps = status().querySelectorAll('[aria-hidden="true"]:not(svg)');
    expect(seps.length).toBeGreaterThan(0);
    for (const sep of seps) expect(sep.textContent?.trim()).toBe('·');
  });

  it('matches the shared contract props exactly', () => {
    expectTypeOf<DataStatusProps>().toEqualTypeOf<ContractProps>();
  });

  it('styles only through --aile-* tokens: no literal colours, pixels, outline, shadow or stripe; no stub left', () => {
    const source = readFileSync(resolve(__dirname, 'DataStatus.tsx'), 'utf8');
    expect(source).not.toContain('data-stub');
    expect(source).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    const css = readFileSync(resolve(__dirname, 'DataStatus.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).toContain('var(--aile-');
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/rgba?\(/);
    expect(css).not.toMatch(/[1-9][0-9]*(\.[0-9]+)?px/);
    expect(css).not.toMatch(/outline|box-shadow|border-left|border-right|border-top|border-bottom/);
    expect(css).toContain('var(--aile-uyari)');
    expect(css).toContain('var(--aile-hata)');
  });
});
