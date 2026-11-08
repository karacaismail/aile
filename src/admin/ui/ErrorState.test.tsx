import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ErrorState, type ErrorStateProps } from './ErrorState';

// Tasarım: components/ErrorState/README.md + bundle.js ErrorState. Neden + tek çözüm yolu ("Yeniden dene");
// eski tutar gösterilmez; role="alert"; hata metni "Hata:" ile başlar (README › Dil).
const VARSAYILAN_BASLIK = 'Hata: Veri okunamadı';
const VARSAYILAN_ILETI = 'E-tabloya ulaşılamadı. Tutarlar, yanıltmaması için gösterilmiyor.';

describe('ErrorState', () => {
  it('renders an alert with the default title and message', () => {
    render(<ErrorState />);
    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: VARSAYILAN_BASLIK })).toBeInTheDocument();
    expect(screen.getByText(VARSAYILAN_ILETI)).toBeInTheDocument();
  });

  it('prefixes a custom title with "Hata:" exactly once', () => {
    const { unmount } = render(<ErrorState title="Nesil bulunamadı" message="Doğrulanmış JSON nesli yok." />);
    expect(screen.getByRole('heading', { name: 'Hata: Nesil bulunamadı' })).toBeInTheDocument();
    expect(screen.getByText('Doğrulanmış JSON nesli yok.')).toBeInTheDocument();
    unmount();

    render(<ErrorState title="Hata: Zaten önekli" />);
    expect(screen.getByRole('heading', { name: 'Hata: Zaten önekli' })).toBeInTheDocument();
    expect(screen.queryByText(/Hata: Hata:/)).toBeNull();
  });

  it('marks the alert glyph as decorative; the heading carries the meaning', () => {
    render(<ErrorState />);
    const glyph = screen.getByRole('alert').querySelector('svg[data-icon="alert"]');
    expect(glyph).not.toBeNull();
    expect(glyph).toHaveAttribute('aria-hidden', 'true');
  });

  it('shows the detail as small secondary text only when given', () => {
    const { unmount } = render(<ErrorState detail="28.10.2026 14:05 · kod 503" />);
    const detail = screen.getByText('28.10.2026 14:05 · kod 503');
    expect(detail).toHaveClass('aile-kucuk', 'aile-ikincil');
    unmount();

    render(<ErrorState />);
    expect(screen.queryByText(/kod 503/)).toBeNull();
  });

  it('"Yeniden dene" is the single action and calls onRetry', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<ErrorState onRetry={onRetry} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    const retry = screen.getByRole('button', { name: 'Yeniden dene' });
    expect(retry.querySelector('svg[data-icon="refresh"]')).toHaveAttribute('aria-hidden', 'true');
    await user.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('omits the retry button when no onRetry handler exists', () => {
    render(<ErrorState />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('accepts only title, message, detail and onRetry (no amounts, no children)', () => {
    expectTypeOf<keyof ErrorStateProps>().toEqualTypeOf<'title' | 'message' | 'detail' | 'onRetry'>();
    render(<ErrorState title="Bütçe okunamadı" detail="Son başarılı nesil 09:10" onRetry={() => {}} />);
    expect(screen.getByRole('alert').textContent).not.toMatch(/₺/);
  });

  it('keeps styling on tokens: no literal colors, no focus ring, no stub left', () => {
    const source = readFileSync(resolve(__dirname, 'ErrorState.tsx'), 'utf8');
    expect(source).not.toContain('data-stub');
    expect(source).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    const css = readFileSync(resolve(__dirname, 'ErrorState.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/outline|box-shadow/);
    expect(css).toContain('var(--aile-hata)');
  });
});

describe('ErrorState — native button, keyboard and touch', () => {
  it('"Yeniden dene" is a native <button type="button"> carrying the shared focus-line hook', () => {
    render(<ErrorState onRetry={() => {}} />);
    const retry = screen.getByRole('button', { name: 'Yeniden dene' });
    expect(retry.tagName).toBe('BUTTON');
    expect(retry).toHaveAttribute('type', 'button');
    expect(retry).toHaveAttribute('data-focus-line');
  });

  it('Tab reaches "Yeniden dene", Shift+Tab leaves it; Enter and Space retry; Escape does nothing', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<><button type="button">Önce</button><ErrorState onRetry={onRetry} /></>);
    await user.tab();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Yeniden dene' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(onRetry).not.toHaveBeenCalled();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onRetry).toHaveBeenCalledTimes(2);
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Önce' })).toHaveFocus();
  });

  it('a cancelled touch (pointercancel) does not retry; a completed tap retries once', async () => {
    const onRetry = vi.fn();
    render(<ErrorState onRetry={onRetry} />);
    const retry = screen.getByRole('button', { name: 'Yeniden dene' });
    fireEvent.pointerDown(retry, { pointerType: 'touch', isPrimary: true });
    fireEvent.pointerCancel(retry, { pointerType: 'touch', isPrimary: true });
    expect(onRetry).not.toHaveBeenCalled();
    await userEvent.setup().pointer({ keys: '[TouchA]', target: retry });
    expect(onRetry).toHaveBeenCalledTimes(1);
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

describe('ErrorState — phone delivery and stylesheet', () => {
  const css = () => readFileSync(resolve(__dirname, 'ErrorState.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  it('phone presentation has no antd: no antd, @ant-design/* or ui/antd.ts in its static import closure', () => {
    const { files, packages } = staticClosure(resolve(__dirname, 'ErrorState.tsx'));
    expect(packages.filter(spec => ANTD.test(spec))).toEqual([]);
    expect(files).not.toContain(resolve(__dirname, 'antd.ts'));
    expect(files.filter(file => /\.wide\.|[\\/]wide[\\/]/.test(file))).toEqual([]);
    expect(packages).not.toContain('echarts');
  });

  // f05 bulgusu: coarse girişte "Yeniden dene" 156×44 ölçüldü. Hedef tek kaynaktan gelir: --aile-dokunma-hedefi
  // (admin.css / tokens.ts targetTokens: 44, data-input-coarse katmanında 48); bileşen coarse değerini kendisi türetmez.
  it('"Yeniden dene" is the primary action: eylem fill, height from the touch-target token (44 px, 48 px coarse)', () => {
    const sheet = css();
    expect(sheet).toMatch(/\.aile-error-state__retry\s*\{[^}]*min-height:\s*var\(--aile-dokunma-hedefi\)/);
    expect(sheet).toMatch(/\.aile-error-state__retry\s*\{[^}]*min-width:\s*var\(--aile-dokunma-hedefi\)/);
    expect(sheet).toMatch(/\.aile-error-state__retry\s*\{[^}]*background:\s*var\(--aile-eylem\)/);
    expect(sheet).not.toMatch(/\[data-input-coarse\]/);
    expect(sheet).not.toContain('var(--aile-hedef-asgari) + var(--aile-bosluk-1)');
  });

  it('text stays at or above 14 px and motion follows the single curve, off under reduced motion', () => {
    const sheet = css();
    const sizes = [...sheet.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map(m => Number(m[1]));
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(14);
    expect(sheet).toContain('var(--aile-sure) var(--aile-egri)');
    expect(sheet).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*transition-duration:\s*0s/);
  });
});

