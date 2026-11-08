import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataStatus, type DataStatusProps } from './DataStatus';
import type { DataStatusProps as ContractProps } from '../shell/contracts';
import { targetTokens } from '../../design/tokens';

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

  it('separators belong to the part before them, so a wrapped line never starts with "·"', () => {
    render(<DataStatus state="fresh" lastReadAt={OKUMA} generationId={NESIL} onRefresh={() => {}} />);
    const seps = [...status().querySelectorAll('[aria-hidden="true"]:not(svg)')];
    expect(seps).toHaveLength(2);
    for (const sep of seps) {
      expect(sep.parentElement).not.toBe(status());
      expect(sep.previousSibling?.textContent?.trim()).not.toBe('');
    }
  });
});

describe('DataStatus — native button, keyboard, touch and focus return', () => {
  const user = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  const dropFocusToPage = () => act(() => {
    const sink = document.createElement('input');
    document.body.append(sink);
    sink.focus();
    sink.remove();
  });

  it('Yenile is a native <button type="button"> carrying the shared focus-line hook', () => {
    render(<DataStatus state="fresh" lastReadAt={OKUMA} generationId={NESIL} onRefresh={() => {}} />);
    const refresh = screen.getByRole('button', { name: 'Yenile' });
    expect(refresh.tagName).toBe('BUTTON');
    expect(refresh).toHaveAttribute('type', 'button');
    expect(refresh).toHaveAttribute('data-focus-line');
  });

  it('Tab reaches Yenile; Enter and Space refresh; Escape does nothing', async () => {
    const onRefresh = vi.fn();
    render(<DataStatus state="fresh" lastReadAt={OKUMA} generationId={NESIL} onRefresh={onRefresh} />);
    const u = user();
    await u.tab();
    expect(screen.getByRole('button', { name: 'Yenile' })).toHaveFocus();
    await u.keyboard('{Escape}');
    expect(onRefresh).not.toHaveBeenCalled();
    await u.keyboard('{Enter}');
    await u.keyboard(' ');
    expect(onRefresh).toHaveBeenCalledTimes(2);
  });

  it('a cancelled touch (pointercancel) does not refresh; a completed tap refreshes once', async () => {
    const onRefresh = vi.fn();
    render(<DataStatus state="fresh" lastReadAt={OKUMA} generationId={NESIL} onRefresh={onRefresh} />);
    const refresh = screen.getByRole('button', { name: 'Yenile' });
    fireEvent.pointerDown(refresh, { pointerType: 'touch', isPrimary: true });
    fireEvent.pointerCancel(refresh, { pointerType: 'touch', isPrimary: true });
    expect(onRefresh).not.toHaveBeenCalled();
    await user().pointer({ keys: '[TouchA]', target: refresh });
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('returns focus to the action after the read finishes when disabling it dropped focus to the page', async () => {
    const onRefresh = vi.fn();
    const { rerender } = render(<DataStatus state="fresh" lastReadAt={OKUMA} generationId={NESIL} onRefresh={onRefresh} />);
    const u = user();
    await u.tab();
    await u.keyboard('{Enter}');
    rerender(<DataStatus state="checking" lastReadAt={OKUMA} generationId={NESIL} onRefresh={onRefresh} />);
    const button = screen.getByRole('button', { name: 'Yenile' });
    expect(button).toBeDisabled();
    // Tarayıcı odak düzeltmesi: devre dışı kalan odaklı düğme odağı belgeye bırakır. jsdom bunu yapmaz ve devre dışı
    // öğede blur() çalışmaz; aynı sonucu geçici bir öğeye odaklanıp onu kaldırarak üretiriz (odak <body>'ye düşer).
    dropFocusToPage();
    expect(document.body).toHaveFocus();
    rerender(<DataStatus state="stale" lastReadAt={OKUMA} lastGoodAt={SON_IYI} generationId={NESIL} onRefresh={onRefresh} />);
    const retry = screen.getByRole('button', { name: 'Yeniden dene' });
    expect(retry).toBe(button);
    expect(retry).toHaveFocus();
  });

  it('does not steal focus back when the user moved on during the read', async () => {
    const { rerender } = render(
      <>
        <DataStatus state="fresh" lastReadAt={OKUMA} generationId={NESIL} onRefresh={() => {}} />
        <button type="button">Başka</button>
      </>,
    );
    const u = user();
    await u.tab();
    await u.keyboard('{Enter}');
    rerender(
      <>
        <DataStatus state="checking" lastReadAt={OKUMA} generationId={NESIL} onRefresh={() => {}} />
        <button type="button">Başka</button>
      </>,
    );
    dropFocusToPage();
    act(() => screen.getByRole('button', { name: 'Başka' }).focus());
    rerender(
      <>
        <DataStatus state="fresh" lastReadAt={OKUMA} generationId={NESIL} onRefresh={() => {}} />
        <button type="button">Başka</button>
      </>,
    );
    expect(screen.getByRole('button', { name: 'Başka' })).toHaveFocus();
  });

  it('does not take focus on its own when the action was never focused', () => {
    const { rerender } = render(<DataStatus state="checking" onRefresh={() => {}} />);
    rerender(<DataStatus state="fresh" lastReadAt={OKUMA} generationId={NESIL} onRefresh={() => {}} />);
    expect(document.body).toHaveFocus();
  });
});

// --- Telefon teslimi: bileşenin statik import kapanışı (tür importu ve dinamik import() hariç) ---------------------
const ANTD = /^(?:antd(?:\/|$)|@ant-design\/)/;
function staticClosure(entry: string): { files: string[]; packages: string[] } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const visit = (file: string) => {
    if (files.has(file)) return;
    files.add(file);
    if (!/\.[jt]sx?$/.test(file)) return;
    const source = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const [, spec] of source.matchAll(/^\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\bfrom\s*)?['"]([^'"]+)['"]/gm)) {
      if (!spec.startsWith('.')) { packages.add(spec); continue; }
      const base = resolve(dirname(file), spec);
      const hit = ['', '.tsx', '.ts', '/index.tsx', '/index.ts'].map(ext => base + ext).find(p => existsSync(p) && statSync(p).isFile());
      if (!hit) throw new Error(`çözülemedi: ${spec} (${file})`);
      visit(hit);
    }
  };
  visit(entry);
  return { files: [...files], packages: [...packages] };
}

describe('DataStatus — phone delivery and stylesheet', () => {
  const css = () => readFileSync(resolve(__dirname, 'DataStatus.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  it('phone presentation has no antd: no antd, @ant-design/* or ui/antd.ts in its static import closure', () => {
    const { files, packages } = staticClosure(resolve(__dirname, 'DataStatus.tsx'));
    expect(packages.filter(spec => ANTD.test(spec))).toEqual([]);
    expect(files).not.toContain(resolve(__dirname, 'antd.ts'));
    expect(files.filter(file => /\.wide\.|[\\/]wide[\\/]/.test(file))).toEqual([]);
    expect(packages).not.toContain('echarts');
  });

  // f05 bulgusu: coarse girişte "Yeniden dene" 129×44 ölçüldü. Hedef tek kaynaktan gelir: --aile-dokunma-hedefi
  // (admin.css / tokens.ts targetTokens: 44, data-input-coarse katmanında 48); bileşen coarse değerini kendisi türetmez.
  it('the action takes its height from the single touch-target token: 44 px, 48 px under coarse input', () => {
    const sheet = css();
    expect(sheet).toMatch(/\.aile-ds__btn\s*\{[^}]*min-height:\s*var\(--aile-dokunma-hedefi\)/);
    expect(sheet).not.toMatch(/\[data-input-coarse\]/);
    expect(sheet).not.toContain('var(--aile-hedef-asgari) + var(--aile-bosluk-1)');
    expect(targetTokens.dokunmaHedefi).toBe(44);
    expect(targetTokens.dokunmaHedefiCoarse).toBe(48);
  });

  it('never pulls the action outside its line with a negative margin (no overflow when it wraps at 320 px)', () => {
    expect(css()).not.toMatch(/margin[a-z-]*:\s*calc\(\s*-/);
    expect(css()).not.toMatch(/margin[a-z-]*:\s*-/);
  });

  it('colour changes are instant semantic updates; hover feedback only where hover exists; reduced motion is honoured', () => {
    const sheet = css();
    expect(sheet).toMatch(/@media \(hover: hover\)/);
    expect(sheet).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*transition-duration:\s*0s/);
  });
});

