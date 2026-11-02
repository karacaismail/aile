import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from './Button';

// Kaynak: aile-tasarim/tasarim-sistemi/components/Button/README.md + index.d.ts ButtonProps + bundle.js Button.
// Seçiciler role/label ile; antd iç sınıflarına bağlı seçici yok. Bizim sınıflarımız aile-btn*, data-variant.

describe('Button', () => {
  it('renders the label as an accessible button with type="button" by default', () => {
    render(<Button>Alım ekle</Button>);
    const button = screen.getByRole('button', { name: 'Alım ekle' });
    expect(button.tagName).toBe('BUTTON');
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveClass('aile-btn');
  });

  it('passes type="submit" through for form footers', () => {
    render(<Button type="submit">Kaydet</Button>);
    expect(screen.getByRole('button', { name: 'Kaydet' })).toHaveAttribute('type', 'submit');
  });

  it('defaults to the secondary variant', () => {
    render(<Button>Vazgeç</Button>);
    const button = screen.getByRole('button', { name: 'Vazgeç' });
    expect(button).toHaveAttribute('data-variant', 'secondary');
    expect(button).toHaveClass('aile-btn--secondary');
  });

  it.each(['primary', 'secondary', 'quiet', 'danger'] as const)('marks the %s variant with a class and attribute', variant => {
    render(<Button variant={variant}>Etiket</Button>);
    const button = screen.getByRole('button', { name: 'Etiket' });
    expect(button).toHaveAttribute('data-variant', variant);
    expect(button).toHaveClass(`aile-btn--${variant}`);
    for (const other of ['primary', 'secondary', 'quiet', 'danger'].filter(name => name !== variant)) {
      expect(button).not.toHaveClass(`aile-btn--${other}`);
    }
  });

  it('exposes a toggle only when selected is given (aria-pressed + secili class)', () => {
    const { rerender } = render(<Button>Liste</Button>);
    const button = screen.getByRole('button', { name: 'Liste' });
    expect(button).not.toHaveAttribute('aria-pressed');
    expect(button).not.toHaveClass('aile-btn--secili');

    rerender(<Button selected={false}>Liste</Button>);
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button).not.toHaveClass('aile-btn--secili');

    rerender(<Button selected>Liste</Button>);
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button).toHaveClass('aile-btn--secili');
  });

  it('calls onClick once per click', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Yenile</Button>);
    await user.click(screen.getByRole('button', { name: 'Yenile' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('is disabled with the native attribute and never fires onClick', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>Sil</Button>);
    const button = screen.getByRole('button', { name: 'Sil' });
    expect(button).toBeDisabled();
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('renders decorative Phosphor icons before and after the label in order', () => {
    render(<Button icon="plus" iconEnd="chevronDown">Alım ekle</Button>);
    const button = screen.getByRole('button', { name: 'Alım ekle' });
    const icons = button.querySelectorAll('svg[data-icon]');
    expect(Array.from(icons, icon => icon.getAttribute('data-icon'))).toEqual(['plus', 'chevronDown']);
    for (const icon of icons) {
      expect(icon).toHaveAttribute('aria-hidden', 'true');
      expect(icon).toHaveAttribute('width', '20');
    }
    const label = button.querySelector('.aile-btn-metin');
    expect(label).toHaveTextContent('Alım ekle');
    expect(icons[0].compareDocumentPosition(label!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(label!.compareDocumentPosition(icons[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders no icon wrapper when no icon is given', () => {
    render(<Button>Düz</Button>);
    expect(screen.getByRole('button', { name: 'Düz' }).querySelector('svg')).toBeNull();
  });

  it('marks block and onNav tones with classes', () => {
    render(
      <>
        <Button block>Tam genişlik</Button>
        <Button onNav variant="quiet">Sayfalar</Button>
      </>,
    );
    expect(screen.getByRole('button', { name: 'Tam genişlik' })).toHaveClass('aile-btn--blok');
    const nav = screen.getByRole('button', { name: 'Sayfalar' });
    expect(nav).toHaveClass('aile-btn--nav');
    expect(screen.getByRole('button', { name: 'Tam genişlik' })).not.toHaveClass('aile-btn--nav');
  });

  it('forwards ref, id and the allowed aria attributes to the button element', () => {
    const ref = createRef<HTMLButtonElement>();
    render(
      <Button ref={ref} id="diger" aria-haspopup="menu" aria-expanded={false} aria-controls="diger-menu" aria-describedby="neden">
        Diğer
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Diğer' });
    expect(ref.current).toBe(button);
    expect(button).toHaveAttribute('id', 'diger');
    expect(button).toHaveAttribute('aria-haspopup', 'menu');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveAttribute('aria-controls', 'diger-menu');
    expect(button).toHaveAttribute('aria-describedby', 'neden');
  });

  it('merges a caller className without dropping its own', () => {
    render(<Button className="sayfa-eylem">Dışa aktar</Button>);
    const button = screen.getByRole('button', { name: 'Dışa aktar' });
    expect(button).toHaveClass('sayfa-eylem');
    expect(button).toHaveClass('aile-btn');
  });
});

describe('Button.css (tasarım kuralları, statik)', () => {
  const css = readFileSync(resolve(__dirname, 'Button.css'), 'utf8');
  const source = readFileSync(resolve(__dirname, 'Button.tsx'), 'utf8');

  it('is imported by the component', () => {
    expect(source).toContain("import './Button.css'");
  });

  it('uses only --aile-* tokens: no raw colors, no focus ring, no shadow', () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/\brgba?\(/);
    expect(css).not.toMatch(/outline\s*:/);
    expect(css).not.toMatch(/box-shadow\s*:/);
    expect(css).toContain('var(--aile-');
    // Ölçüler yalnız token (--aile-bosluk-*, --aile-hedef-asgari, --aile-kose-kontrol); sabit px yok.
    expect(css).not.toMatch(/\d(?:\.\d+)?px\b/);
  });

  it('styles every variant, the selected, nav and disabled states', () => {
    for (const selector of ['.aile-btn--primary', '.aile-btn--secondary', '.aile-btn--quiet', '.aile-btn--danger', '.aile-btn--secili', '.aile-btn--nav', ':disabled']) {
      expect(css, selector).toContain(selector);
    }
    expect(css).toContain('var(--aile-secili)');
    expect(css).toContain('var(--aile-liste-zemin)');
    expect(css).toContain('var(--aile-hedef-asgari)');
    expect(css).toContain('white-space: nowrap');
    expect(css).toContain('font-weight: 600');
  });
});
