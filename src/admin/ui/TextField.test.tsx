import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { useState } from 'react';
import { TextField, maskDateInput, moneyDisplay, revealInVisualViewport } from './TextField';

// Tasarım: components/TextField/README.md — etiket üstte ve her zaman var, yardım/hata altta 14 px,
// hata "Hata: …" ile başlar, placeholder etiket yerine geçmez. Seçiciler role/label ile; antd iç sınıfı yok.
// Telefon sunumu antd'siz: yerel <input>/<textarea>; odak çizgisini admin.css [data-focus-line] ile çizer.
describe('TextField', () => {
  it('links the visible label to the input', () => {
    render(<TextField label="Alım adı" />);
    const input = screen.getByLabelText('Alım adı');
    expect(input).toBeInstanceOf(HTMLInputElement);
    expect(input).toHaveAttribute('type', 'text');
    expect(screen.getByText('Alım adı').tagName).toBe('LABEL');
  });

  it('keeps the label accessible when it is visually hidden', () => {
    render(<TextField label="Seçeneklerde ara" hideLabel icon="search" placeholder="Ara" />);
    const input = screen.getByRole('textbox', { name: 'Seçeneklerde ara' });
    expect(input).toHaveAttribute('placeholder', 'Ara');
    expect(screen.getByText('Seçeneklerde ara')).toHaveClass('aile-gorsel-gizli');
    const icon = document.querySelector('svg[data-icon="search"]');
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });

  it('describes the input with the help text', () => {
    render(<TextField label="Not" help="En fazla 80 karakter" />);
    const input = screen.getByLabelText('Not');
    expect(input).toHaveAccessibleDescription('En fazla 80 karakter');
    expect(input).not.toHaveAttribute('aria-invalid');
  });

  it('marks the error, prefixes it with "Hata:" and describes the input with it', () => {
    render(<TextField label="Alım adı" help="En fazla 80 karakter" error="Ad boş olamaz" />);
    const input = screen.getByLabelText('Alım adı');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Hata: Ad boş olamaz');
    expect(screen.queryByText('En fazla 80 karakter')).toBeNull();
    expect(screen.getByText('Hata: Ad boş olamaz').closest('[data-invalid="true"]')).not.toBeNull();
  });

  it('does not double an error that already starts with "Hata:"', () => {
    render(<TextField label="Tutar" error="Hata: Fiyat yok" />);
    expect(screen.getByLabelText('Tutar')).toHaveAccessibleDescription('Hata: Fiyat yok');
  });

  it('reports the typed value as a string', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TextField label="Alım adı" onChange={onChange} />);
    await user.type(screen.getByLabelText('Alım adı'), 'Koltuk');
    expect(onChange).toHaveBeenCalledTimes(6);
    expect(onChange).toHaveBeenLastCalledWith('Koltuk');
    for (const [value] of onChange.mock.calls) expect(typeof value).toBe('string');
  });

  it('forwards inputMode and shows the suffix', () => {
    render(<TextField label="Planlanan tutar" inputMode="decimal" suffix="₺" placeholder="8.500,00" />);
    const input = screen.getByLabelText('Planlanan tutar');
    expect(input).toHaveAttribute('inputmode', 'decimal');
    expect(screen.getByText('₺')).toBeInTheDocument();
  });

  it('disables the input when asked', () => {
    render(<TextField label="Oda" value="Salon" disabled />);
    const input = screen.getByLabelText('Oda');
    expect(input).toBeDisabled();
    expect(input).toHaveValue('Salon');
  });

  it('keeps a controlled value until the owner changes it', async () => {
    const user = userEvent.setup();
    function Owner() {
      const [value, setValue] = useState('Salon');
      return <TextField label="Oda" value={value} onChange={(next) => setValue(next.toLocaleUpperCase('tr-TR'))} />;
    }
    render(<Owner />);
    const input = screen.getByLabelText('Oda');
    await user.type(input, 'i');
    expect(input).toHaveValue('SALONİ');
  });
});

describe('TextField — yerel sunum (antd yok)', () => {
  it('renders a native input inside a focus-line box that holds only that input', () => {
    render(<TextField label="Ara" type="search" icon="search" suffix="₺" defaultValue="koltuk" />);
    const input = screen.getByRole('searchbox', { name: 'Ara' });
    expect(input.className).not.toMatch(/\bant-/);
    expect(document.querySelector('[class*="ant-"]')).toBeNull();
    const box = input.closest('[data-focus-line]');
    expect(box).not.toBeNull();
    // Kutuda tek odaklanabilir öğe: odak çizgisi yalnız girdiye aittir; temizle düğmesi kutunun kardeşidir.
    expect(box!.querySelectorAll('input, textarea, button, [tabindex]')).toHaveLength(1);
    const clear = screen.getByRole('button', { name: 'Aramayı temizle' });
    expect(box!.contains(clear)).toBe(false);
    expect(clear).toHaveAttribute('data-focus-line');
  });

  it('multiline renders a labelled textarea with the same note contract', () => {
    render(<TextField label="Açıklama" multiline rows={4} help="Satıcı notu" />);
    const area = screen.getByRole('textbox', { name: 'Açıklama' });
    expect(area).toBeInstanceOf(HTMLTextAreaElement);
    expect(area).toHaveAttribute('rows', '4');
    expect(area).toHaveAccessibleDescription('Satıcı notu');
    expect(area.closest('[data-focus-line]')).not.toBeNull();
  });

  it('has no static antd import in the component or anything it imports', () => {
    const visited = new Set<string>();
    const offenders: string[] = [];
    const resolveLocal = (from: string, spec: string) => {
      const base = resolve(dirname(from), spec);
      return [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find((path) => existsSync(path) && !path.endsWith('/'));
    };
    const walk = (file: string) => {
      if (visited.has(file) || !/\.(t|j)sx?$/.test(file)) return;
      visited.add(file);
      const source = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      const statements = source.match(/(?:^|\n)\s*(?:import|export)\s[^;]*?from\s*['"][^'"]+['"]|(?:^|\n)\s*import\s*['"][^'"]+['"]/g) ?? [];
      for (const statement of statements) {
        if (/^\s*(?:import|export)\s+type\s/.test(statement.trim())) continue;
        const spec = /['"]([^'"]+)['"]\s*$/.exec(statement)![1];
        if (/^(antd|@ant-design\/)/.test(spec) || spec === 'antd') offenders.push(`${file}: ${spec}`);
        if (spec.startsWith('.')) {
          const target = resolveLocal(file, spec);
          if (target && /[\\/]ui[\\/]antd\.ts$/.test(target)) offenders.push(`${file}: ${spec}`);
          else if (target) walk(target);
        }
      }
    };
    walk(resolve(__dirname, 'TextField.tsx'));
    expect(visited.size).toBeGreaterThan(1);
    expect(offenders).toEqual([]);
  });
});

describe('TextField — temizle düğmesi', () => {
  it('shows a named clear button only while there is text (search default) and clears with focus back on the input', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TextField label="Ara" type="search" onChange={onChange} />);
    const input = screen.getByRole('searchbox', { name: 'Ara' });
    expect(screen.queryByRole('button', { name: 'Aramayı temizle' })).toBeNull();

    await user.type(input, 'koltuk');
    const clear = screen.getByRole('button', { name: 'Aramayı temizle' });
    expect(clear).toHaveAttribute('type', 'button');

    await user.click(clear);
    expect(onChange).toHaveBeenLastCalledWith('');
    expect(input).toHaveValue('');
    expect(input).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Aramayı temizle' })).toBeNull();
  });

  it('is opt-in for other fields and named after the label', () => {
    const { rerender } = render(<TextField label="Terim adı" defaultValue="Bahçe" />);
    expect(screen.queryByRole('button')).toBeNull();
    rerender(<TextField label="Terim adı" defaultValue="Bahçe" clearable />);
    expect(screen.getByRole('button', { name: 'Terim adı alanını temizle' })).toBeInTheDocument();
    rerender(<TextField label="Terim adı" defaultValue="Bahçe" clearable clearLabel="Adı sil" />);
    expect(screen.getByRole('button', { name: 'Adı sil' })).toBeInTheDocument();
  });

  it('offers no clear button on a disabled field', () => {
    render(<TextField label="Ara" type="search" value="koltuk" disabled />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('keyboard: Tab reaches the input then the clear button, Shift+Tab returns, Enter and Space clear', async () => {
    const user = userEvent.setup();
    render(<TextField label="Ara" type="search" defaultValue="koltuk" />);
    const input = screen.getByRole('searchbox', { name: 'Ara' });

    await user.tab();
    expect(input).toHaveFocus();
    await user.keyboard('{ArrowLeft}{ArrowRight}{ArrowUp}{ArrowDown}');
    expect(input).toHaveFocus();
    expect(input).toHaveValue('koltuk');

    await user.tab();
    expect(screen.getByRole('button', { name: 'Aramayı temizle' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(input).toHaveFocus();

    await user.tab();
    await user.keyboard('{Enter}');
    expect(input).toHaveValue('');
    expect(input).toHaveFocus();

    await user.type(input, 'masa');
    await user.tab();
    expect(screen.getByRole('button', { name: 'Aramayı temizle' })).toHaveFocus();
    await user.keyboard(' ');
    expect(input).toHaveValue('');
    expect(input).toHaveFocus();
  });

  it('does not swallow Escape: a surrounding dialog still receives it unhandled', async () => {
    const user = userEvent.setup();
    const seen: { key: string; prevented: boolean }[] = [];
    render(
      <div onKeyDown={(event) => seen.push({ key: event.key, prevented: event.defaultPrevented })}>
        <TextField label="Terim adı" defaultValue="Bahçe" clearable />
      </div>,
    );
    await user.click(screen.getByRole('textbox', { name: 'Terim adı' }));
    await user.keyboard('{Escape}');
    expect(seen).toContainEqual({ key: 'Escape', prevented: false });
    expect(screen.getByRole('textbox', { name: 'Terim adı' })).toHaveValue('Bahçe');
  });

  it('pointer: a cancelled touch (pointercancel) does not clear; a completed tap does', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TextField label="Ara" type="search" defaultValue="koltuk" onChange={onChange} />);
    const clear = screen.getByRole('button', { name: 'Aramayı temizle' });

    fireEvent.pointerDown(clear, { pointerType: 'touch', pointerId: 7, isPrimary: true });
    fireEvent.pointerCancel(clear, { pointerType: 'touch', pointerId: 7, isPrimary: true });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('searchbox', { name: 'Ara' })).toHaveValue('koltuk');

    await user.pointer({ keys: '[TouchA]', target: clear });
    expect(onChange).toHaveBeenLastCalledWith('');
    expect(screen.getByRole('searchbox', { name: 'Ara' })).toHaveValue('');
    expect(screen.getByRole('searchbox', { name: 'Ara' })).toHaveFocus();
  });
});

describe('TextField — para alanı (format="money")', () => {
  it('opens the decimal keyboard and shows ₺8.500,00 after leaving; the value model stays the typed text', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TextField label="Planlanan tutar" format="money" onChange={onChange} />);
    const input = screen.getByRole('textbox', { name: 'Planlanan tutar' });
    expect(input).toHaveAttribute('inputmode', 'decimal');

    await user.type(input, '8500');
    expect(input).toHaveValue('8500');
    await user.tab();
    expect(input).toHaveValue('₺8.500,00');
    expect(onChange).toHaveBeenCalledTimes(4);
    expect(onChange).toHaveBeenLastCalledWith('8500');

    await user.click(input);
    expect(input).toHaveValue('8500');
  });

  it('formats a controlled value when not focused and leaves unparseable text untouched', () => {
    const { rerender } = render(<TextField label="Tutar" format="money" value="8.500,5" />);
    expect(screen.getByLabelText('Tutar')).toHaveValue('₺8.500,50');
    rerender(<TextField label="Tutar" format="money" value="12a" />);
    expect(screen.getByLabelText('Tutar')).toHaveValue('12a');
    rerender(<TextField label="Tutar" format="money" value="" />);
    expect(screen.getByLabelText('Tutar')).toHaveValue('');
  });

  it('moneyDisplay uses the shared tr-TR parser: ambiguous input is not guessed', () => {
    expect(moneyDisplay('8500')).toBe('₺8.500,00');
    expect(moneyDisplay('8.500,00')).toBe('₺8.500,00');
    expect(moneyDisplay('-1250,5')).toBe('-₺1.250,50');
    expect(moneyDisplay('8500.50')).toBe('8500.50');
    expect(moneyDisplay('  ')).toBe('  ');
  });
});

describe('TextField — tarih alanı (format="date")', () => {
  it('numeric keyboard, gg.aa.yyyy hint and dots inserted while typing digits', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TextField label="Başlangıç" format="date" onChange={onChange} />);
    const input = screen.getByRole('textbox', { name: 'Başlangıç' });
    expect(input).toHaveAttribute('inputmode', 'numeric');
    expect(input).toHaveAttribute('placeholder', 'gg.aa.yyyy');
    expect(input).toHaveAttribute('maxlength', '10');
    expect(input).toHaveAttribute('type', 'text');

    await user.type(input, '28102026');
    expect(input).toHaveValue('28.10.2026');
    expect(onChange).toHaveBeenLastCalledWith('28.10.2026');

    await user.type(input, '9');
    expect(input).toHaveValue('28.10.2026');
  });

  it('deleting is not re-masked so Backspace works', async () => {
    const user = userEvent.setup();
    render(<TextField label="Bitiş" format="date" />);
    const input = screen.getByRole('textbox', { name: 'Bitiş' });
    await user.type(input, '28');
    expect(input).toHaveValue('28.');
    await user.keyboard('{Backspace}');
    expect(input).toHaveValue('28');
    await user.keyboard('{Backspace}');
    expect(input).toHaveValue('2');
  });

  it('maskDateInput honours typed separators and converts pasted ISO dates', () => {
    expect(maskDateInput('1.1.2026')).toBe('1.1.2026');
    expect(maskDateInput('1/1/2026')).toBe('1.1.2026');
    expect(maskDateInput('28..')).toBe('28.');
    expect(maskDateInput('2810')).toBe('28.10.');
    expect(maskDateInput('281020261')).toBe('28.10.2026');
    expect(maskDateInput('2026-10-28')).toBe('28.10.2026');
    expect(maskDateInput('')).toBe('');
  });
});

describe('TextField — sanal klavye (visualViewport)', () => {
  type FakeViewport = EventTarget & { height: number; width: number; offsetTop: number; offsetLeft: number; scale: number };
  let removeViewport: (() => void) | null = null;

  function installVisualViewport(height: number): FakeViewport {
    const viewport = Object.assign(new EventTarget(), { height, width: 320, offsetTop: 0, offsetLeft: 0, scale: 1 });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
    removeViewport = () => { delete (window as { visualViewport?: unknown }).visualViewport; };
    return viewport;
  }

  /** Kaydırılabilir kap: scrollTop gerçek gibi 0…(scrollHeight-clientHeight) aralığında kalır. */
  function scroller(element: HTMLElement, scrollHeight: number, clientHeight: number) {
    let top = 0;
    Object.defineProperty(element, 'scrollHeight', { configurable: true, value: scrollHeight });
    Object.defineProperty(element, 'clientHeight', { configurable: true, value: clientHeight });
    Object.defineProperty(element, 'scrollTop', {
      configurable: true,
      get: () => top,
      set: (next: number) => { top = Math.max(0, Math.min(scrollHeight - clientHeight, next)); },
    });
    return () => top;
  }

  function placeAt(element: Element, top: number, height: number, scrolled: () => number) {
    element.getBoundingClientRect = () => {
      const y = top - scrolled();
      return { x: 0, y, top: y, left: 0, right: 300, bottom: y + height, width: 300, height, toJSON: () => ({}) } as DOMRect;
    };
  }

  afterEach(() => {
    removeViewport?.();
    removeViewport = null;
  });

  it('scrolls the focused field above the keyboard when the visual viewport shrinks, and stops listening on blur', async () => {
    const viewport = installVisualViewport(568);
    render(
      <div data-testid="kap" style={{ overflowY: 'auto' }}>
        <TextField label="Uygulama anahtarı" help="Yalnız bu tarayıcıda saklanır." />
      </div>,
    );
    const container = screen.getByTestId('kap');
    const scrolled = scroller(container, 1200, 568);
    const input = screen.getByLabelText('Uygulama anahtarı');
    const field = input.closest('.aile-textfield')!;
    placeAt(field, 400, 100, scrolled);

    act(() => input.focus());
    expect(scrolled()).toBe(0);

    viewport.height = 300;
    act(() => { viewport.dispatchEvent(new Event('resize')); });
    // Alanın altı (500) görünür alanın altına (300 - 16 boşluk) gelir: 500 - 284 = 216.
    expect(scrolled()).toBe(216);
    expect(field.getBoundingClientRect().bottom).toBeLessThanOrEqual(viewport.height);

    act(() => input.blur());
    viewport.height = 200;
    act(() => { viewport.dispatchEvent(new Event('resize')); });
    expect(scrolled()).toBe(216);
  });

  it('revealInVisualViewport leaves a visible field alone and copes without a visual viewport', () => {
    const element = document.createElement('div');
    document.body.append(element);
    placeAt(element, 100, 60, () => 0);
    expect(revealInVisualViewport(element, { height: 568, offsetTop: 0 }, 16)).toBe(0);
    expect(() => render(<TextField label="Ad" />)).not.toThrow();
    act(() => screen.getByLabelText('Ad').focus());
    element.remove();
  });

  it('inside a fixed layer (dialog, bottom sheet) it scrolls the layer but never the page behind it', () => {
    const page = document.scrollingElement ?? document.documentElement;
    const pageTop = scroller(page as HTMLElement, 3000, 568);
    const layer = document.createElement('div');
    layer.style.position = 'fixed';
    const body = document.createElement('div');
    body.style.overflowY = 'auto';
    const element = document.createElement('div');
    body.append(element);
    layer.append(body);
    document.body.append(layer);
    const bodyTop = scroller(body, 700, 500);
    placeAt(element, 480, 60, bodyTop);
    try {
      // 540 alt kenar → görünür alt 300 - 16 = 284: 256 px gerekir; katman yalnız 200 kayabilir, kalan sayfaya gitmez.
      expect(revealInVisualViewport(element, { height: 300, offsetTop: 0 }, 16)).toBe(200);
      expect(bodyTop()).toBe(200);
      expect(pageTop()).toBe(0);
    } finally {
      layer.remove();
      for (const key of ['scrollTop', 'scrollHeight', 'clientHeight']) delete (page as unknown as Record<string, unknown>)[key];
    }
  });
});

describe('TextField.css — token ve hedef sözleşmesi', () => {
  const css = readFileSync(resolve(__dirname, 'TextField.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const squash = (text: string) => text.replace(/\s+/g, ' ');

  it('uses only --aile-* tokens: no hex/rgb colours and no antd selectors', () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/\brgba?\(/i);
    expect(css).not.toMatch(/\.ant-/);
  });

  it('44 px target by default, 48 px on coarse input, for the box and the clear button (central --aile-dokunma-hedefi)', () => {
    // Tek kaynak: admin.css / tokens.ts › targetTokens; kaba katman (data-input-coarse) 48'e çıkarır. Yerel hesap yok.
    const flat = squash(css);
    expect(flat).toMatch(/\.aile-textfield-kutu \{[^}]*min-height: var\(--aile-dokunma-hedefi\)/);
    expect(flat).toMatch(/\.aile-textfield-temizle \{[^}]*min-width: var\(--aile-dokunma-hedefi\)[^}]*min-height: var\(--aile-dokunma-hedefi\)/);
    expect(flat).toMatch(/\.aile-textfield-alan\[data-temizle\] \.aile-textfield-kutu \{[^}]*padding-inline-end: var\(--aile-dokunma-hedefi\)/);
    expect(flat).not.toMatch(/--aile-textfield-hedef/);
  });

  it('coarse input never computes below 16 px (iOS zoom) and no declared text is below 14 px', () => {
    expect(squash(css)).toMatch(/\[data-input-coarse\] \.aile-textfield-girdi \{[^}]*font-size: max\(16px, 1em\)/);
    for (const [, size] of css.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)) expect(Number(size)).toBeGreaterThanOrEqual(14);
  });

  it('no surrounding focus ring: outline only none, except 2px CanvasText under forced-colors', () => {
    const outlines = [...css.matchAll(/outline\s*:\s*([^;]+);/g)].map(([, value]) => value.trim());
    expect(outlines.length).toBeGreaterThan(0);
    for (const value of outlines) expect(['none', '2px solid CanvasText']).toContain(value);
    expect(squash(css)).toMatch(/@media \(forced-colors: active\) \{[^@]*html\[data-keyboard='true'\][^{]*:focus-visible \{ outline: 2px solid CanvasText; \}/);
    expect(css).not.toMatch(/box-shadow\s*:\s*(?!none)/);
  });

  it('motion: one duration and curve from tokens; reduced-motion makes state changes instant', () => {
    const transitions = [...css.matchAll(/transition\s*:\s*([^;]+);/g)].map(([, value]) => value);
    expect(transitions.length).toBeGreaterThan(0);
    for (const value of transitions) {
      for (const part of value.split(',')) expect(part.trim()).toMatch(/^[a-z-]+ var\(--aile-sure\) var\(--aile-egri\)$/);
    }
    expect(squash(css)).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[^@]*transition-duration: 0s/);
  });
});
