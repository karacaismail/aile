import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRef, useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from './Button';

// Kaynak: aile-tasarim/tasarim-sistemi/components/Button/README.md + index.d.ts ButtonProps + bundle.js Button.
// Seçiciler role/label ile; antd iç sınıflarına bağlı seçici yok. Bizim sınıflarımız aile-dugme, aile-btn*, data-variant.
// Telefon sunumu antd'siz: Button yerel <button>; statik import kapanışında antd/@ant-design/ui/antd yok.

/** Bir kaynak dosyanın göreli statik import kapanışı (yalnız .ts/.tsx izlenir) ve kapanıştaki tüm belirteçler. */
function staticImportClosure(entry: string): { files: string[]; specifiers: string[] } {
  const files: string[] = [];
  const specifiers: string[] = [];
  const pending = [entry];
  const pattern = /(?:^|\n)\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\sfrom\s*)?['"]([^'"]+)['"]/g;
  while (pending.length) {
    const file = pending.pop()!;
    if (files.includes(file)) continue;
    files.push(file);
    const source = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      specifiers.push(specifier);
      if (!specifier.startsWith('.')) continue;
      const base = resolve(dirname(file), specifier);
      const next = [base, `${base}.ts`, `${base}.tsx`, resolve(base, 'index.ts')].find(path => /\.tsx?$/.test(path) && existsSync(path));
      if (next) pending.push(next);
    }
  }
  return { files, specifiers };
}

const ANTD = /^(?:antd(?:\/|$)|@ant-design\/)|(?:^|\/)antd(?:\.ts)?$/;

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
    expect(nav).toHaveAttribute('data-nav');
    expect(screen.getByRole('button', { name: 'Tam genişlik' })).not.toHaveClass('aile-btn--nav');
    expect(screen.getByRole('button', { name: 'Tam genişlik' })).not.toHaveAttribute('data-nav');
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

describe('Button — yerel düğme (telefon sunumu antd istemez)', () => {
  it('renders a bare native <button> with the shared base class and no antd classes or wrappers', () => {
    const { container } = render(<Button variant="primary" icon="plus">Alım ekle</Button>);
    const button = screen.getByRole('button', { name: 'Alım ekle' });
    expect(container.firstElementChild).toBe(button);
    expect(button).toHaveClass('aile-dugme');
    const classes = [button, ...button.querySelectorAll('*')].flatMap(el => Array.from(el.classList));
    expect(classes.filter(name => name.startsWith('ant-'))).toEqual([]);
  });

  it('joins the central focus-line contract with data-focus-line (admin.css: nav zemininde odak-nav)', () => {
    render(<Button>Sayfalar</Button>);
    expect(screen.getByRole('button', { name: 'Sayfalar' })).toHaveAttribute('data-focus-line', '');
  });

  it('passes through handlers and attributes injected by trigger wrappers (Dropdown/Popover clone the child)', () => {
    const onKeyDown = vi.fn();
    const onMouseEnter = vi.fn();
    const injected = { onKeyDown, onMouseEnter, 'data-trigger': 'evet' } as Record<string, unknown>;
    render(<Button {...injected}>Diğer</Button>);
    const button = screen.getByRole('button', { name: 'Diğer' });
    fireEvent.keyDown(button, { key: 'ArrowDown' });
    fireEvent.mouseEnter(button);
    expect(onKeyDown).toHaveBeenCalledTimes(1);
    expect(onMouseEnter).toHaveBeenCalledTimes(1);
    expect(button).toHaveAttribute('data-trigger', 'evet');
  });

  it('has no static import of antd, @ant-design/* or ui/antd in its whole relative import closure', () => {
    const { files, specifiers } = staticImportClosure(resolve(__dirname, 'Button.tsx'));
    expect(files.map(file => file.slice(__dirname.length + 1))).toContain('Button.tsx');
    expect(specifiers.filter(specifier => ANTD.test(specifier))).toEqual([]);
    expect(specifiers).toContain('./Button.css');
  });
});

describe('Button — yükleniyor (aria-busy, metin korunur, çift tıklama engeli)', () => {
  it('keeps the label and the accessible name, stays focusable and announces busy + disabled while loading', () => {
    render(<Button variant="primary" icon="check" loading>Kaydet</Button>);
    const button = screen.getByRole('button', { name: 'Kaydet' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).not.toHaveAttribute('disabled');
    expect(button.querySelector('.aile-btn-metin')).toHaveTextContent('Kaydet');
    button.focus();
    expect(button).toHaveFocus();
  });

  it('has no busy attributes when idle', () => {
    render(<Button>Kaydet</Button>);
    const button = screen.getByRole('button', { name: 'Kaydet' });
    expect(button).not.toHaveAttribute('aria-busy');
    expect(button).not.toHaveAttribute('aria-disabled');
  });

  it('ignores pointer and keyboard activation while loading and never submits its form', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const onSubmit = vi.fn((event: { preventDefault(): void }) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Button type="submit" loading onClick={onClick}>Kaydet</Button>
      </form>,
    );
    const button = screen.getByRole('button', { name: 'Kaydet' });
    await user.click(button);
    button.focus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onClick).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('turns busy by itself while a promise returned from onClick is pending and blocks the second click', async () => {
    const user = userEvent.setup();
    let finish!: () => void;
    const onClick = vi.fn(() => new Promise<void>(done => { finish = done; }));
    render(<Button variant="primary" onClick={onClick}>Ödeme kaydet</Button>);
    const button = screen.getByRole('button', { name: 'Ödeme kaydet' });

    await user.dblClick(button);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAccessibleName('Ödeme kaydet');

    await act(async () => { finish(); });
    expect(button).not.toHaveAttribute('aria-busy');
    expect(button).not.toHaveAttribute('aria-disabled');
    await user.click(button);
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('blocks a second synchronous click in the same task before React re-renders', () => {
    const onClick = vi.fn(() => new Promise<void>(() => {}));
    render(<Button onClick={onClick}>Gönder</Button>);
    const button = screen.getByRole('button', { name: 'Gönder' });
    act(() => {
      button.click();
      button.click();
    });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('clears busy when the returned promise rejects and reports the error instead of swallowing it', async () => {
    const reported: unknown[] = [];
    const listener = (event: ErrorEvent) => { reported.push(event.error); event.preventDefault(); };
    window.addEventListener('error', listener);
    try {
      const failure = new Error('Hata: Kayıt yazılamadı.');
      let fail!: () => void;
      const onClick = () => new Promise<void>((_, reject) => { fail = () => reject(failure); });
      render(<Button onClick={onClick}>Kaydet</Button>);
      const button = screen.getByRole('button', { name: 'Kaydet' });
      fireEvent.click(button);
      expect(button).toHaveAttribute('aria-busy', 'true');
      await act(async () => { fail(); });
      expect(button).not.toHaveAttribute('aria-busy');
      expect(reported).toEqual([failure]);
    } finally {
      window.removeEventListener('error', listener);
    }
  });

  it('keeps focus on the button while it becomes busy and idle again (no native disabled, no focus loss)', () => {
    function Saver() {
      const [saving, setSaving] = useState(false);
      return <Button loading={saving} onClick={() => setSaving(true)}>Kaydet</Button>;
    }
    render(<Saver />);
    const button = screen.getByRole('button', { name: 'Kaydet' });
    button.focus();
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveFocus();
  });
});

describe('Button — devre dışı nedeni (aria-describedby)', () => {
  it('writes the reason next to a disabled button and links it with aria-describedby', () => {
    render(<Button variant="primary" disabled disabledReason="Yazma yolu henüz yok.">Alım ekle</Button>);
    const button = screen.getByRole('button', { name: 'Alım ekle' });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription('Yazma yolu henüz yok.');
    const reason = document.getElementById(button.getAttribute('aria-describedby')!);
    expect(reason).not.toBeNull();
    expect(reason).toHaveTextContent('Yazma yolu henüz yok.');
    expect(reason).toHaveClass('aile-btn-neden');
    expect(button.contains(reason)).toBe(false);
  });

  it('keeps the caller description and adds the reason after it', () => {
    render(
      <>
        <p id="genel-not">Kaynak e-tablo salt okunur.</p>
        <Button disabled disabledReason="Önce bir klasör seç." aria-describedby="genel-not">Dışa aktar</Button>
      </>,
    );
    const button = screen.getByRole('button', { name: 'Dışa aktar' });
    const ids = button.getAttribute('aria-describedby')!.split(' ');
    expect(ids[0]).toBe('genel-not');
    expect(ids).toHaveLength(2);
    expect(button).toHaveAccessibleDescription('Kaynak e-tablo salt okunur. Önce bir klasör seç.');
  });

  it('renders no reason and no extra description while enabled; the button element is not remounted', () => {
    const { rerender } = render(<Button disabled disabledReason="Önce bir klasör seç.">Dışa aktar</Button>);
    const button = screen.getByRole('button', { name: 'Dışa aktar' });
    rerender(<Button disabledReason="Önce bir klasör seç.">Dışa aktar</Button>);
    expect(screen.getByRole('button', { name: 'Dışa aktar' })).toBe(button);
    expect(button).not.toBeDisabled();
    expect(button).not.toHaveAttribute('aria-describedby');
    expect(screen.queryByText('Önce bir klasör seç.')).toBeNull();
  });
});

describe('Button — klavye (APG button)', () => {
  it('is reached with Tab and left with Shift+Tab; a disabled button is skipped', async () => {
    const user = userEvent.setup();
    render(
      <>
        <a href="#once">Önce</a>
        <Button disabled disabledReason="Henüz yok">Devre dışı</Button>
        <Button>Etkin</Button>
        <a href="#sonra">Sonra</a>
      </>,
    );
    screen.getByRole('link', { name: 'Önce' }).focus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Etkin' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('link', { name: 'Sonra' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Etkin' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('link', { name: 'Önce' })).toHaveFocus();
  });

  it('activates once on Enter and once on Space; arrows and Escape do not activate', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Yenile</Button>);
    screen.getByRole('button', { name: 'Yenile' }).focus();
    await user.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledTimes(1);
    await user.keyboard(' ');
    expect(onClick).toHaveBeenCalledTimes(2);
    await user.keyboard('{ArrowDown}{ArrowUp}{ArrowLeft}{ArrowRight}{Escape}');
    expect(onClick).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: 'Yenile' })).toHaveFocus();
  });

  it('a toggle flips aria-pressed on Space immediately (state is never deferred to an animation)', async () => {
    const user = userEvent.setup();
    function Toggle() {
      const [on, setOn] = useState(false);
      return <Button selected={on} onClick={() => setOn(value => !value)}>Liste</Button>;
    }
    render(<Toggle />);
    const button = screen.getByRole('button', { name: 'Liste' });
    button.focus();
    await user.keyboard(' ');
    expect(button).toHaveAttribute('aria-pressed', 'true');
    await user.keyboard('{Enter}');
    expect(button).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('Button — dokunma (Pointer Events) ve odak dönüşü', () => {
  it('activates once for a touch press and release', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Sayfalar</Button>);
    const button = screen.getByRole('button', { name: 'Sayfalar' });
    await user.pointer([{ keys: '[TouchA>]', target: button }, { keys: '[/TouchA]', target: button }]);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('never activates on pointerdown alone or after pointercancel (activation is the click, not the press)', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Sayfalar</Button>);
    const button = screen.getByRole('button', { name: 'Sayfalar' });
    fireEvent.pointerDown(button, { pointerType: 'touch', isPrimary: true });
    fireEvent.pointerCancel(button, { pointerType: 'touch', isPrimary: true });
    expect(onClick).not.toHaveBeenCalled();
  });

  it('returns focus to the trigger through the forwarded ref after the opened surface closes', async () => {
    const user = userEvent.setup();
    function Opener() {
      const trigger = createRef<HTMLButtonElement>();
      const [open, setOpen] = useState(false);
      return (
        <>
          <Button ref={trigger} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>Sayfalar</Button>
          {open && (
            <div role="dialog" aria-label="Sayfalar">
              <Button onClick={() => { setOpen(false); trigger.current?.focus(); }}>Kapat</Button>
            </div>
          )}
        </>
      );
    }
    render(<Opener />);
    await user.click(screen.getByRole('button', { name: 'Sayfalar' }));
    screen.getByRole('button', { name: 'Kapat' }).focus();
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Sayfalar' })).toHaveFocus();
  });
});

// jsdom yerleşim ve hesaplanmış stil vermez (vitest css: false); görsel sözleşme kaynak metin olarak korunur, gerçek
// motor ölçümü e2e/admin-ui-a01-button.spec.ts'tedir.
describe('Button.css (tasarım kuralları, statik)', () => {
  const raw = readFileSync(resolve(__dirname, 'Button.css'), 'utf8');
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');
  const source = readFileSync(resolve(__dirname, 'Button.tsx'), 'utf8');
  type Rule = { selector: string; body: string; media: string | null };
  const parse = (text: string, media: string | null = null): Rule[] => {
    const rules: Rule[] = [];
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf('{', i);
      if (open === -1) break;
      const selector = text.slice(i, open).replace(/\s+/g, ' ').trim();
      let depth = 1;
      let j = open + 1;
      while (j < text.length && depth > 0) {
        if (text[j] === '{') depth += 1;
        else if (text[j] === '}') depth -= 1;
        j += 1;
      }
      const body = text.slice(open + 1, j - 1);
      if (selector.startsWith('@media')) rules.push(...parse(body, selector));
      else rules.push({ selector, body: body.replace(/\s+/g, ' ').trim(), media });
      i = j;
    }
    return rules;
  };
  const rules = parse(css);
  const decl = (body: string, prop: string) => body.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`))?.[1].trim() ?? null;
  const forced = (rule: Rule) => rule.media !== null && /forced-colors:\s*active/.test(rule.media);

  it('is imported by the component', () => {
    expect(source).toContain("import './Button.css'");
  });

  it('uses only --aile-* tokens: no raw colors, no shadow, no literal px outside the forced-colors exception', () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/\b(?:rgba?|hsla?)\(/);
    expect(css).not.toMatch(/box-shadow\s*:/);
    expect(css).toContain('var(--aile-');
    for (const rule of rules.filter(r => !forced(r))) expect(rule.body, rule.selector).not.toMatch(/\d(?:\.\d+)?px\b/);
    expect(css).not.toMatch(/transition\s*:\s*all\b/);
  });

  it('removes the native focus outline everywhere and draws no ring; only forced-colors keyboard mode gets 2px CanvasText', () => {
    for (const rule of rules) {
      const outline = decl(rule.body, 'outline');
      if (outline === null) continue;
      if (forced(rule)) {
        expect(rule.selector).toMatch(/^html\[data-keyboard='true'\] .*:focus-visible$/);
        expect(outline).toBe('2px solid CanvasText');
      } else {
        expect(outline, rule.selector).toBe('none');
      }
    }
    const reset = rules.find(r => r.media === null && /\.aile-dugme:focus-visible/.test(r.selector) && decl(r.body, 'outline') === 'none');
    expect(reset).toBeDefined();
    expect(rules.some(r => forced(r) && decl(r.body, 'outline') === '2px solid CanvasText')).toBe(true);
  });

  it('draws the focus indicator as one ::after line odak-aralik below, odak-kalinlik thick, only in keyboard mode', () => {
    const line = rules.find(r => r.media === null && /^html\[data-keyboard='true'\] \.aile-dugme:focus-visible::after$/.test(r.selector));
    expect(line).toBeDefined();
    const body = line!.body;
    expect(decl(body, 'content')).toBe('""');
    expect(decl(body, 'position')).toBe('absolute');
    expect(decl(body, 'left')).toBe('0');
    expect(decl(body, 'right')).toBe('0');
    expect(decl(body, 'height')).toBe('var(--aile-odak-kalinlik)');
    expect(decl(body, 'bottom')).toBe('calc(-1 * (var(--aile-odak-aralik) + var(--aile-odak-kalinlik)))');
    expect(decl(body, 'background')).toBe('var(--aile-odak)');
    expect(decl(body, 'pointer-events')).toBe('none');
    const nav = rules.find(r => /^html\[data-keyboard='true'\] \.aile-dugme\[data-nav\]:focus-visible::after$/.test(r.selector));
    expect(nav && decl(nav.body, 'background')).toBe('var(--aile-odak-nav)');
    // Çizgiyi taşıyan düğme konumlanır; ::after başka hiçbir durumda içerik almaz.
    const base = rules.find(r => r.selector === '.aile-dugme');
    expect(base && decl(base.body, 'position')).toBe('relative');
    expect(rules.filter(r => /::after/.test(r.selector) && decl(r.body, 'content') !== null).map(r => r.selector))
      .toEqual([line!.selector]);
  });

  it('sizes the target from --aile-dokunma-hedefi (44 px, 48 px on coarse input; b04) with no pseudo-element hit area', () => {
    const base = rules.find(r => r.selector === '.aile-dugme')!;
    expect(decl(base.body, 'min-height')).toBe('var(--aile-dokunma-hedefi)');
    expect(decl(base.body, 'min-width')).toBe('var(--aile-dokunma-hedefi)');
    expect(decl(base.body, 'touch-action')).toBe('manipulation');
    // --aile-hedef-asgari sabit 44 kalır ve ölçü için kullanılmaz; ::before süse ayrılmıştır, isabet alanı çizmez.
    expect(css).not.toMatch(/--aile-hedef-asgari/);
    expect(rules.filter(r => /::before/.test(r.selector)).map(r => r.selector)).toEqual([]);
    expect(css).not.toMatch(/data-input-coarse/);
  });

  it('applies hover only under (hover: hover) so touch never keeps a stuck hover tone', () => {
    const hovers = rules.filter(r => /:hover/.test(r.selector));
    expect(hovers.length).toBeGreaterThan(0);
    for (const rule of hovers) expect(rule.media, rule.selector).toMatch(/^@media \(hover: hover\)$/);
  });

  it('animates colors with the single duration and curve and turns motion off under reduced-motion', () => {
    const base = rules.find(r => r.selector === '.aile-dugme')!;
    expect(decl(base.body, 'transition')).toBe(
      'background-color var(--aile-sure) var(--aile-egri), color var(--aile-sure) var(--aile-egri), border-color var(--aile-sure) var(--aile-egri)',
    );
    const reduced = rules.filter(r => r.media === '@media (prefers-reduced-motion: reduce)');
    expect(reduced.map(r => [r.selector, decl(r.body, 'transition')])).toEqual([['.aile-dugme', 'none']]);
  });

  it('styles every variant, selected (from aria-pressed), nav, busy and disabled states with token colors', () => {
    for (const selector of [
      ".aile-dugme[data-variant='primary']", ".aile-dugme[data-variant='secondary']", ".aile-dugme[data-variant='quiet']",
      ".aile-dugme[data-variant='danger']", '.aile-dugme[data-nav]', ".aile-dugme[aria-pressed='true']",
      ".aile-dugme[aria-busy='true']", '.aile-dugme:disabled',
    ]) {
      expect(rules.some(r => r.selector === selector), selector).toBe(true);
    }
    const busy = rules.find(r => r.selector === ".aile-dugme[aria-busy='true']")!;
    expect(decl(busy.body, 'cursor')).toBe('progress');
    const disabled = rules.find(r => r.selector === '.aile-dugme:disabled')!;
    expect(decl(disabled.body, 'cursor')).toBe('not-allowed');
    expect(css).toContain('var(--aile-secili)');
    expect(css).toContain('var(--aile-liste-zemin)');
    const selected = rules.find(r => r.selector === ".aile-dugme[aria-pressed='true']")!;
    expect(decl(selected.body, 'font-weight')).toBe('600');
  });

  it('sets the label typography from the font token at body size (never below 14 px) without truncation', () => {
    const base = rules.find(r => r.selector === '.aile-dugme')!;
    expect(decl(base.body, 'font-family')).toBe('var(--aile-font-sans)');
    expect(decl(base.body, 'font-size')).toBe('1rem');
    expect(decl(base.body, 'font-weight')).toBe('500');
    const button = rules.find(r => r.selector === '.aile-btn')!;
    expect(decl(button.body, 'white-space')).toBe('nowrap');
    expect(css).not.toMatch(/text-overflow\s*:\s*ellipsis/);
    const reason = rules.find(r => r.selector === '.aile-btn-neden')!;
    expect(decl(reason.body, 'font-size')).toBe('0.875rem');
  });
});
