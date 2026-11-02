import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
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
