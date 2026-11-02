import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IconButton } from './IconButton';

// Tasarım: components/IconButton/README.md — yalnız simgeli kare düğme, label zorunlu ve ekran okuyucuya söylenir,
// variant quiet (varsayılan) | secondary, selected, disabled, onNav; 44 × 44; tooltip'e güvenme.
// Seçiciler role/label ile; antd iç sınıflarına bağlı seçici yok.
describe('IconButton', () => {
  it('is a button whose accessible name is the label and which shows no visible text', () => {
    render(<IconButton icon="close" label="Kapat" />);
    const button = screen.getByRole('button', { name: 'Kapat' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveAttribute('aria-label', 'Kapat');
    expect(button).toHaveTextContent('');
  });

  it('renders the icon decoratively (aria-hidden) so the label is the only name', () => {
    render(<IconButton icon="more" label="Diğer eylemler" />);
    const button = screen.getByRole('button', { name: 'Diğer eylemler' });
    const svg = button.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('data-icon', 'more');
    expect(svg).toHaveAttribute('width', '20');
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('calls onClick on activation and not while disabled', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { rerender } = render(<IconButton icon="refresh" label="Yenile" onClick={onClick} />);
    await user.click(screen.getByRole('button', { name: 'Yenile' }));
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(<IconButton icon="refresh" label="Yenile" onClick={onClick} disabled />);
    const disabled = screen.getByRole('button', { name: 'Yenile' });
    expect(disabled).toBeDisabled();
    await user.click(disabled);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('exposes selected as aria-pressed only when the prop is given', () => {
    const { rerender } = render(<IconButton icon="filter" label="Filtreler" />);
    expect(screen.getByRole('button', { name: 'Filtreler' })).not.toHaveAttribute('aria-pressed');

    rerender(<IconButton icon="filter" label="Filtreler" selected />);
    expect(screen.getByRole('button', { name: 'Filtreler', pressed: true })).toBeInTheDocument();

    rerender(<IconButton icon="filter" label="Filtreler" selected={false} />);
    expect(screen.getByRole('button', { name: 'Filtreler', pressed: false })).toBeInTheDocument();
  });

  it('defaults to the quiet variant and marks secondary and onNav with its own classes', () => {
    const { rerender } = render(<IconButton icon="close" label="Kapat" />);
    const button = screen.getByRole('button', { name: 'Kapat' });
    expect(button).toHaveClass('aile-iconbtn', 'aile-iconbtn--quiet');
    expect(button).not.toHaveClass('aile-iconbtn--secondary', 'aile-iconbtn--onnav');

    // antd outlined düğmeyi Wave ile sarar, text'i sarmaz: variant değişince <button> yeniden bağlanır, bu yüzden yeniden sorgula.
    rerender(<IconButton icon="close" label="Kapat" variant="secondary" onNav className="ek" />);
    const secondary = screen.getByRole('button', { name: 'Kapat' });
    expect(secondary).toHaveClass('aile-iconbtn', 'aile-iconbtn--secondary', 'aile-iconbtn--onnav', 'ek');
    expect(secondary).not.toHaveClass('aile-iconbtn--quiet');
  });

  it('forwards ref to the button element (focus return after a drawer closes)', () => {
    const ref = createRef<HTMLButtonElement>();
    render(<IconButton ref={ref} icon="menu" label="Sayfalar" />);
    expect(ref.current).toBe(screen.getByRole('button', { name: 'Sayfalar' }));
  });

  // 44 × 44, token renkleri ve odak kuralı jsdom'da ölçülemez (vitest css: false); kaynak sözleşmesi metin olarak korunur.
  it('styles only through --aile tokens: 44 px target, no literal colors, no outline or focus ring', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const css = readFileSync(resolve(__dirname, 'IconButton.css'), 'utf8');
    const tsx = readFileSync(resolve(__dirname, 'IconButton.tsx'), 'utf8');
    expect(tsx).toContain("import './IconButton.css'");
    expect(css).toMatch(/width:\s*var\(--aile-hedef-asgari\)/);
    expect(css).toMatch(/height:\s*var\(--aile-hedef-asgari\)/);
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/rgba?\(/);
    // (?!\s*none): \s* geri dönüp sıfır boşluk eşleyemesin diye bakış içinde de boşluk var.
    expect(css).not.toMatch(/outline\s*:(?!\s*none)/);
    expect(css).not.toMatch(/box-shadow\s*:(?!\s*none)/);
    expect(css).toMatch(/--aile-odak-nav/);
  });
});
