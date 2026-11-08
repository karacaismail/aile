import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRef } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IconButton } from './IconButton';

// Tasarım: components/IconButton/README.md — yalnız simgeli kare düğme, label zorunlu ve ekran okuyucuya söylenir,
// variant quiet (varsayılan) | secondary, selected, disabled, onNav; 44 × 44; tooltip'e güvenme.
// Seçiciler role/label ile; antd iç sınıflarına bağlı seçici yok. Yerel <button>; taban görünüm Button.css (.aile-dugme).
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
    expect(button).toHaveClass('aile-dugme', 'aile-iconbtn', 'aile-iconbtn--quiet');
    expect(button).toHaveAttribute('data-variant', 'quiet');
    expect(button).not.toHaveClass('aile-iconbtn--secondary', 'aile-iconbtn--onnav');
    expect(button).not.toHaveAttribute('data-nav');

    rerender(<IconButton icon="close" label="Kapat" variant="secondary" onNav className="ek" />);
    // Yerel düğme: varyant değişince öğe yeniden bağlanmaz (antd Wave sarmalayıcısı yok).
    expect(screen.getByRole('button', { name: 'Kapat' })).toBe(button);
    expect(button).toHaveClass('aile-dugme', 'aile-iconbtn', 'aile-iconbtn--secondary', 'aile-iconbtn--onnav', 'ek');
    expect(button).toHaveAttribute('data-variant', 'secondary');
    expect(button).toHaveAttribute('data-nav');
    expect(button).not.toHaveClass('aile-iconbtn--quiet');
    // Button'a özgü sınıf yok: .aile-btn hedefleyen kabuk kuralları (ör. dar sorgu satırında esneme) kareyi bozamaz.
    expect(button).not.toHaveClass('aile-btn');
  });

  it('forwards ref to the button element (focus return after a drawer closes)', () => {
    const ref = createRef<HTMLButtonElement>();
    render(<IconButton ref={ref} icon="menu" label="Sayfalar" />);
    expect(ref.current).toBe(screen.getByRole('button', { name: 'Sayfalar' }));
  });
});

describe('IconButton — yerel düğme ve zorunlu erişilebilir ad', () => {
  it('renders a bare native <button> without antd classes or wrappers', () => {
    const { container } = render(<IconButton icon="close" label="Kapat" variant="secondary" />);
    const button = screen.getByRole('button', { name: 'Kapat' });
    expect(container.firstElementChild).toBe(button);
    const classes = [button, ...button.querySelectorAll('*')].flatMap(el => Array.from(el.getAttribute('class')?.split(/\s+/) ?? []));
    expect(classes.filter(name => name.startsWith('ant-'))).toEqual([]);
    expect(button).toHaveAttribute('data-focus-line', '');
  });

  it('refuses a blank label: an icon-only button without a name never renders', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => render(<IconButton icon="close" label="  " />)).toThrow(/erişilebilir ad/);
    } finally {
      error.mockRestore();
    }
  });

  it('has no static import of antd, @ant-design/* or ui/antd in its relative import closure', () => {
    const files: string[] = [];
    const specifiers: string[] = [];
    const pending = [resolve(__dirname, 'IconButton.tsx')];
    const pattern = /(?:^|\n)\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\sfrom\s*)?['"]([^'"]+)['"]/g;
    while (pending.length) {
      const file = pending.pop()!;
      if (files.includes(file)) continue;
      files.push(file);
      const source = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      for (const match of source.matchAll(pattern)) {
        specifiers.push(match[1]);
        if (!match[1].startsWith('.')) continue;
        const base = resolve(dirname(file), match[1]);
        const next = [base, `${base}.ts`, `${base}.tsx`].find(path => /\.tsx?$/.test(path) && existsSync(path));
        if (next) pending.push(next);
      }
    }
    expect(specifiers.filter(s => /^(?:antd(?:\/|$)|@ant-design\/)|(?:^|\/)antd(?:\.ts)?$/.test(s))).toEqual([]);
    expect(specifiers).toEqual(expect.arrayContaining(['./Button.css', './IconButton.css']));
  });
});

describe('IconButton — durumlar, klavye ve dokunma', () => {
  it('passes the popup/description ARIA attributes through', () => {
    render(<IconButton icon="more" label="Diğer eylemler" aria-haspopup="menu" aria-expanded={false} aria-controls="m1" aria-describedby="n1" />);
    const button = screen.getByRole('button', { name: 'Diğer eylemler' });
    expect(button).toHaveAttribute('aria-haspopup', 'menu');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveAttribute('aria-controls', 'm1');
    expect(button).toHaveAttribute('aria-describedby', 'n1');
  });

  it('writes the disabled reason as visible text and links it with aria-describedby', () => {
    render(<IconButton icon="download" label="Dışa aktar" disabled disabledReason="Önce veri yüklenmeli." />);
    const button = screen.getByRole('button', { name: 'Dışa aktar' });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription('Önce veri yüklenmeli.');
    expect(screen.getByText('Önce veri yüklenmeli.')).toHaveClass('aile-btn-neden');
  });

  it('is busy (aria-busy + aria-disabled, still focusable, name kept) while loading or while its promise is pending', async () => {
    const user = userEvent.setup();
    let finish!: () => void;
    const onClick = vi.fn(() => new Promise<void>(done => { finish = done; }));
    const { rerender } = render(<IconButton icon="refresh" label="Yenile" onClick={onClick} />);
    const button = screen.getByRole('button', { name: 'Yenile' });
    await user.dblClick(button);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    await act(async () => { finish(); });
    expect(button).not.toHaveAttribute('aria-busy');

    rerender(<IconButton icon="refresh" label="Yenile" onClick={onClick} loading />);
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).not.toHaveAttribute('disabled');
    button.focus();
    await user.keyboard('{Enter} ');
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(button).toHaveAccessibleName('Yenile');
  });

  it('activates on Enter, Space and a touch press; not on arrows, Escape or a cancelled pointer', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<IconButton icon="close" label="Kapat" onClick={onClick} />);
    const button = screen.getByRole('button', { name: 'Kapat' });
    button.focus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    await user.keyboard('{ArrowDown}{ArrowRight}{Escape}');
    expect(onClick).toHaveBeenCalledTimes(2);
    await user.pointer([{ keys: '[TouchA>]', target: button }, { keys: '[/TouchA]', target: button }]);
    expect(onClick).toHaveBeenCalledTimes(3);
    fireEvent.pointerDown(button, { pointerType: 'touch' });
    fireEvent.pointerCancel(button, { pointerType: 'touch' });
    expect(onClick).toHaveBeenCalledTimes(3);
  });
});

// 44 × 44, token renkleri ve odak kuralı jsdom'da ölçülemez (vitest css: false); kaynak sözleşmesi metin olarak korunur.
// Taban (odak çizgisi, kaba girişte 48 px etkin alan, hover medyası, hareket) Button.css .aile-dugme'dedir.
describe('IconButton.css (statik)', () => {
  const css = readFileSync(resolve(__dirname, 'IconButton.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const base = readFileSync(resolve(__dirname, 'Button.css'), 'utf8');
  const tsx = readFileSync(resolve(__dirname, 'IconButton.tsx'), 'utf8');

  it('is a square of --aile-dokunma-hedefi (44, 48 on coarse input; b04) that never stretches, on the shared .aile-dugme base', () => {
    expect(tsx).toContain("import './Button.css'");
    expect(tsx).toContain("import './IconButton.css'");
    expect(css).toMatch(/\.aile-iconbtn\s*\{[^}]*\bwidth:\s*var\(--aile-dokunma-hedefi\)/);
    expect(css).toMatch(/\.aile-iconbtn\s*\{[^}]*\bheight:\s*var\(--aile-dokunma-hedefi\)/);
    expect(css).toMatch(/\.aile-iconbtn\s*\{[^}]*\bpadding:\s*0;/);
    expect(css).toMatch(/\.aile-iconbtn\s*\{[^}]*\bflex:\s*none;/);
    expect(css).not.toMatch(/--aile-hedef-asgari/);
    expect(base).toMatch(/min-height:\s*var\(--aile-dokunma-hedefi\)/);
    expect(base).toMatch(/--aile-odak-nav/);
  });

  it('uses no literal colors, px, outline, ring, hover or transition of its own', () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/\b(?:rgba?|hsla?)\(/);
    expect(css).not.toMatch(/\d(?:\.\d+)?px\b/);
    expect(css).not.toMatch(/outline\s*:/);
    expect(css).not.toMatch(/box-shadow\s*:/);
    expect(css).not.toMatch(/:hover/);
    expect(css).not.toMatch(/transition/);
  });
});
