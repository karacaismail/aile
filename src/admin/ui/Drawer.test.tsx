import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { useRef, useState, type ReactNode } from 'react';
import { installViewport } from '../adaptive/testing';
import { Drawer, type DrawerProps } from './Drawer';

// Tasarım: components/Drawer/README.md — görünür "Kapat", Escape kapatır, açılınca odak çekmeceye girer,
// kapanınca açan düğmeye (ya da returnFocusTo) döner. Seçiciler role/label; antd iç sınıfı yok.
// Yerel uygulama tüm profillere hizmet eder (antd gerekmez, .wide dosyası yok): kenardan açılan modal katman,
// arka plan inert, Tab tuzağı, hareket 240 ms proje eğrisi ve reduced-motion'da anlık; durum her zaman anında.

type HarnessProps = Partial<Omit<DrawerProps, 'title' | 'open' | 'onClose' | 'returnFocusTo'>> & {
  /** true: ikinci düğme ("Hedef") returnFocusTo olur. */
  returnToTarget?: boolean;
  children?: ReactNode;
};

function Harness({ returnToTarget, children, ...rest }: HarnessProps) {
  const [open, setOpen] = useState(false);
  const target = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Filtreleri aç</button>
      <button type="button" ref={target}>Hedef</button>
      <Drawer title="Filtreler" open={open} onClose={() => setOpen(false)} returnFocusTo={returnToTarget ? target : undefined} {...rest}>
        {children ?? <p>Oda ve kategori süzgeçleri</p>}
      </Drawer>
    </>
  );
}

const drawerRoot = () => document.querySelector<HTMLElement>('.aile-drawer');
const wrapper = () => document.querySelector<HTMLElement>('.aile-drawer-wrapper') as HTMLElement;
const css = () => readFileSync(resolve(__dirname, 'Drawer.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Statik import kapanışı (import type ve dinamik import hariç): göreli modüller izlenir, paket adları toplanır. */
function staticClosure(entry: string): { files: string[]; packages: string[] } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const resolveRelative = (from: string, spec: string) => {
    const base = resolve(dirname(from), spec);
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, resolve(base, 'index.ts'), resolve(base, 'index.tsx')]) {
      if (existsSync(candidate)) {
        try { readFileSync(candidate, 'utf8'); return candidate; } catch { /* dizin */ }
      }
    }
    throw new Error(`${from}: ${spec} çözülemedi`);
  };
  const visit = (file: string) => {
    if (files.has(file)) return;
    files.add(file);
    if (/\.css$/.test(file)) return;
    const code = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const statements = code.match(/^\s*(?:import|export)\s[^;]*?from\s+['"][^'"]+['"]|^\s*import\s+['"][^'"]+['"]/gm) ?? [];
    for (const statement of statements) {
      if (/^\s*(?:import|export)\s+type\s/.test(statement)) continue;
      const spec = /['"]([^'"]+)['"]\s*$/.exec(statement)![1];
      if (spec.startsWith('.')) visit(resolveRelative(file, spec));
      else packages.add(spec);
    }
  };
  visit(resolve(__dirname, entry));
  return { files: [...files].map(file => file.slice(resolve(__dirname, '../../..').length + 1)), packages: [...packages] };
}

afterEach(() => {
  document.body.style.overflow = '';
  document.body.style.paddingRight = '';
});

describe('Drawer', () => {
  it('renders nothing while closed', () => {
    render(<Drawer title="Filtreler" open={false}><p>Gizli</p></Drawer>);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('Gizli')).toBeNull();
  });

  it('is a modal dialog named by its heading, with content, footer and a visible Kapat button', () => {
    render(
      <Drawer title="Filtreler" footer={<button type="button">Uygula</button>}>
        <p>Oda ve kategori süzgeçleri</p>
      </Drawer>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Filtreler' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('heading', { level: 2, name: 'Filtreler' })).toBeInTheDocument();
    expect(screen.getByText('Oda ve kategori süzgeçleri')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Uygula' })).toBeInTheDocument();
    const close = screen.getByRole('button', { name: 'Kapat' });
    expect(close).toBeVisible();
    expect(close).toHaveTextContent('Kapat');
    expect(close).toHaveAttribute('type', 'button');
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('focus scope: the root carries data-aile-katman even when portalled to body; the nav tone marks its surface', () => {
    // b04 focus contract (admin.css): the focus line, ring reset and reduced-motion hang off .aile-admin or a native layer
    // root ([data-aile-katman]); the root is not role="dialog" (the section is), so it carries the marker itself. On the
    // nav tone the line turns odak-nav through [data-odak-zemin="nav"], not through a local copy of the rule.
    const { unmount } = render(<Drawer title="Sayfalar" tone="nav" side="left"><a href="#/genel">Genel durum</a></Drawer>);
    expect(drawerRoot()?.parentElement).toBe(document.body);
    expect(drawerRoot()).toHaveAttribute('data-aile-katman');
    expect(screen.getByRole('dialog', { name: 'Sayfalar' })).toHaveAttribute('data-odak-zemin', 'nav');
    expect(screen.getByRole('button', { name: 'Kapat' })).toHaveAttribute('data-focus-line');
    unmount();
    render(<Drawer title="Filtreler" inline><p>Süzgeçler</p></Drawer>);
    expect(drawerRoot()).toHaveAttribute('data-aile-katman');
    expect(screen.getByRole('dialog', { name: 'Filtreler' })).not.toHaveAttribute('data-odak-zemin');
  });

  it('lets the caller rename the close button', () => {
    render(<Drawer title="Sayfalar" closeLabel="Menüyü kapat" />);
    expect(screen.getByRole('button', { name: 'Menüyü kapat' })).toBeInTheDocument();
  });

  it('calls onClose from the Kapat button', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Drawer title="Filtreler" onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: 'Kapat' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose on Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Drawer title="Filtreler" onClose={onClose} />);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keyboard: Kapat works with Enter and Space; arrow keys are not swallowed (body scroll, content widgets)', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Drawer title="Filtreler" onClose={onClose}><p>Süzgeçler</p></Drawer>);
    const dialog = screen.getByRole('dialog', { name: 'Filtreler' });
    for (const key of ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'PageDown', 'Home', 'End']) {
      expect(fireEvent.keyDown(dialog, { key }), key).toBe(true);
    }
    expect(onClose).not.toHaveBeenCalled();
    const close = screen.getByRole('button', { name: 'Kapat' });
    close.focus();
    await user.keyboard('{Enter}');
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.keyboard(' ');
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('calls onClose when the mask is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Drawer title="Filtreler" onClose={onClose} />);
    const mask = document.querySelector('.aile-drawer-mask');
    expect(mask).not.toBeNull();
    expect(mask).toHaveAttribute('aria-hidden', 'true');
    await user.click(mask as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('moves focus to the dialog on open in the same commit; Tab reaches Kapat first, then the content', async () => {
    const user = userEvent.setup();
    render(<Harness><button type="button">Uygula</button></Harness>);
    await user.click(screen.getByRole('button', { name: 'Filtreleri aç' }));
    const dialog = screen.getByRole('dialog', { name: 'Filtreler' });
    expect(dialog).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Kapat' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Uygula' })).toHaveFocus();
  });

  it('returns focus to the opener after closing', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Filtreleri aç' });
    await user.click(opener);
    expect(screen.getByRole('dialog', { name: 'Filtreler' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Kapat' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });

  it('returns focus to returnFocusTo when given', async () => {
    const user = userEvent.setup();
    render(<Harness returnToTarget />);
    await user.click(screen.getByRole('button', { name: 'Filtreleri aç' }));
    expect(screen.getByRole('dialog', { name: 'Filtreler' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Hedef' })).toHaveFocus();
  });

  it('uses 384 px on the right by default; side, full and tone map to root classes', () => {
    const root = () => screen.getByRole('dialog').closest('.aile-drawer') as HTMLElement;
    const first = render(<Drawer title="Filtreler" />);
    expect(root()).toHaveClass('aile-drawer--right');
    expect(root()).not.toHaveClass('aile-drawer--nav');
    expect(wrapper().style.width).toBe('384px');
    first.unmount();

    const second = render(<Drawer title="Sayfalar" side="left" tone="nav" width={272} />);
    expect(root()).toHaveClass('aile-drawer--left');
    expect(root()).toHaveClass('aile-drawer--nav');
    expect(wrapper().style.width).toBe('272px');
    second.unmount();

    render(<Drawer title="Filtreler" full />);
    expect(root()).toHaveClass('aile-drawer--full');
    expect(wrapper().style.width).toBe('100%');
  });

  it('renders inline (no portal) when asked, non-modal: no aria-modal, background stays interactive', () => {
    const { container } = render(
      <>
        <button type="button">Liste</button>
        <Drawer title="Filtreler" inline />
      </>,
    );
    const dialog = screen.getByRole('dialog');
    expect(container.contains(dialog)).toBe(true);
    expect(dialog).not.toHaveAttribute('aria-modal');
    expect(drawerRoot()).toHaveClass('aile-drawer--inline');
    expect(screen.getByRole('button', { name: 'Liste' }).closest('[inert]')).toBeNull();
    expect(document.body.style.overflow).toBe('');
  });

  it('portals into the admin root (.aile-admin) so its tokens, type and focus-line rules reach the layer', () => {
    const app = document.createElement('div');
    app.className = 'aile-admin';
    document.body.appendChild(app);
    try {
      render(<Drawer title="Filtreler" />);
      expect(drawerRoot()?.parentElement).toBe(app);
    } finally {
      app.remove();
    }
  });

  it('opens inside the admin root even when mounted closed before that root reached the document', () => {
    function App() {
      const [open, setOpen] = useState(false);
      return (
        <div className="aile-admin" data-testid="root">
          <button type="button" onClick={() => setOpen(true)}>Sayfalar</button>
          <Drawer title="Sayfalar" open={open} onClose={() => setOpen(false)} />
        </div>
      );
    }
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Sayfalar' }));
    expect(drawerRoot()?.parentElement).toBe(screen.getByTestId('root'));
  });

  describe('modal contract', () => {
    it('makes the background inert and locks page scroll while open; both are released in the closing commit', () => {
      render(<Harness />);
      const opener = screen.getByRole('button', { name: 'Filtreleri aç' });
      fireEvent.click(opener);
      expect(opener.closest('[inert]')).not.toBeNull();
      expect(drawerRoot()!.closest('[inert]')).toBeNull();
      expect(document.body.style.overflow).toBe('hidden');
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
      expect(document.querySelectorAll('[inert]')).toHaveLength(0);
      expect(document.body.style.overflow).toBe('');
    });

    it('releases the background before onClose so the caller may move focus outside (route change focuses main)', () => {
      let inertDuringClose: boolean | null = null;
      function Moved() {
        const [open, setOpen] = useState(false);
        const main = useRef<HTMLElement>(null);
        return (
          <>
            <button type="button" onClick={() => setOpen(true)}>Sayfalar</button>
            <main ref={main} tabIndex={-1}>İçerik</main>
            <Drawer title="Sayfalar" open={open} onClose={() => {
              inertDuringClose = !!main.current?.closest('[inert]');
              main.current?.focus();
              setOpen(false);
            }} />
          </>
        );
      }
      render(<Moved />);
      fireEvent.click(screen.getByRole('button', { name: 'Sayfalar' }));
      fireEvent.click(screen.getByRole('button', { name: 'Kapat' }));
      expect(inertDuringClose).toBe(false);
      expect(screen.getByRole('main')).toHaveFocus();
    });

    it('traps Tab at the edges and leaves the middle stops to the browser', () => {
      render(
        <Drawer title="Sayfalar" tone="nav" side="left">
          <nav aria-label="Sayfalar"><a href="#/genel">Genel durum</a><a href="#/ayarlar">Ayarlar</a></nav>
        </Drawer>,
      );
      const dialog = screen.getByRole('dialog');
      const close = screen.getByRole('button', { name: 'Kapat' });
      const [first, last] = screen.getAllByRole('link');
      last.focus();
      expect(fireEvent.keyDown(last, { key: 'Tab' })).toBe(false);
      expect(close).toHaveFocus();
      expect(fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })).toBe(false);
      expect(last).toHaveFocus();
      dialog.focus();
      expect(fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })).toBe(false);
      expect(last).toHaveFocus();
      first.focus();
      expect(fireEvent.keyDown(first, { key: 'Tab' })).toBe(true);
    });

    it('leaves Tab and Escape to a popup opened later outside the layer (e.g. a wide dropdown or dialog)', () => {
      const onClose = vi.fn();
      render(<Drawer title="Ayrıntı" onClose={onClose}><button type="button">Durumu değiştir</button></Drawer>);
      const popup = document.createElement('div');
      popup.innerHTML = '<button type="button">Seçenek</button>';
      document.body.appendChild(popup);
      try {
        const option = popup.querySelector('button')!;
        option.focus();
        expect(fireEvent.keyDown(option, { key: 'Tab' })).toBe(true);
        expect(option).toHaveFocus();
        expect(fireEvent.keyDown(option, { key: 'Escape' })).toBe(true);
        expect(onClose).not.toHaveBeenCalled();
      } finally {
        popup.remove();
      }
    });

    it('keeps the root in place for the exit motion while it is already closed for assistive tech and input', () => {
      const style = document.createElement('style');
      style.textContent = '.aile-drawer-wrapper { transition-property: transform; transition-duration: 240ms; }';
      document.head.appendChild(style);
      try {
        render(<Harness />);
        const opener = screen.getByRole('button', { name: 'Filtreleri aç' });
        opener.focus();
        fireEvent.click(opener);
        expect(drawerRoot()).toHaveAttribute('data-durum', 'acik');
        fireEvent.click(screen.getByRole('button', { name: 'Kapat' }));
        expect(drawerRoot()).toHaveAttribute('data-durum', 'kapali');
        expect(drawerRoot()).toHaveAttribute('aria-hidden', 'true');
        expect(drawerRoot()).toHaveAttribute('inert');
        expect(opener).toHaveFocus();
        act(() => { wrapper().dispatchEvent(new Event('transitionend', { bubbles: true })); });
        expect(drawerRoot()).toBeNull();
      } finally {
        style.remove();
      }
    });

    it('unmounts in the closing commit when motion is off (duration 0)', () => {
      render(<Harness />);
      fireEvent.click(screen.getByRole('button', { name: 'Filtreleri aç' }));
      fireEvent.click(screen.getByRole('button', { name: 'Kapat' }));
      expect(drawerRoot()).toBeNull();
    });

    it('fits the visual viewport above a virtual keyboard', () => {
      const savedMatchMedia = window.matchMedia;
      installViewport({ width: 320, height: 568, coarse: true });
      const vv = Object.assign(new EventTarget(), { width: 320, height: 568, offsetTop: 0, offsetLeft: 0, scale: 1 });
      Object.defineProperty(window, 'visualViewport', { configurable: true, value: vv });
      try {
        render(<Drawer title="Filtreler" full><input aria-label="Ara" /></Drawer>);
        vv.height = 300;
        act(() => { vv.dispatchEvent(new Event('resize')); });
        expect(drawerRoot()!.style.getPropertyValue('--katman-alt')).toBe('268px');
      } finally {
        delete (window as { visualViewport?: unknown }).visualViewport;
        window.matchMedia = savedMatchMedia;
      }
    });
  });

  describe('source contract', () => {
    it('stays off antd on every profile: no antd, @ant-design, ui/antd, echarts or .wide in the static import closure', () => {
      const { files, packages } = staticClosure('Drawer.tsx');
      expect(packages.filter(name => /^(antd|@ant-design\/|echarts|zrender)/.test(name))).toEqual([]);
      expect(files.filter(file => /ui\/antd\.ts$|\.wide\.|\/wide\//.test(file))).toEqual([]);
      // Phosphor comes per icon from its sub-path (ui/icons, dist/csr/<Name>); the icons chunk group is @ant-design/icons only.
      expect(packages.filter(name => !/^(react|react-dom|react\/jsx-runtime|@phosphor-icons\/react(\/dist\/csr\/[A-Za-z]+)?)$/.test(name))).toEqual([]);
    });

    it('CSS uses only --aile tokens, no focus ring, elevation only on the wrapper', () => {
      const code = css();
      expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(code).not.toMatch(/rgba?\(/);
      expect(code).not.toMatch(/outline\s*:(?!\s*none)/);
      expect(code).not.toMatch(/box-shadow\s*:(?!\s*(none|var\(--aile-golge-yukseltilmis\)))/);
      expect(code).toContain('env(safe-area-inset-bottom');
    });

    it('CSS focus: no local copy; the central admin.css draws the single underline (and odak-nav on the nav surface)', () => {
      const code = css();
      expect(code).not.toMatch(/:focus(-visible|-within)?::after/);
      expect(code).not.toMatch(/(^|[;{\s])content\s*:/);
      expect(code).not.toMatch(/data-keyboard/);
      expect(code).not.toMatch(/--aile-odak(-nav)?\b/);
      expect(code).not.toMatch(/\.ant-/);
    });

    it('CSS motion: 240 ms project curve via tokens, explicit properties, none under reduced-motion', () => {
      const code = css();
      const transitions = [...code.matchAll(/transition\s*:\s*([^;]+);/g)].map(match => match[1].trim());
      expect(transitions.length).toBeGreaterThan(0);
      for (const value of transitions) {
        if (value === 'none') continue;
        for (const part of value.split(/,(?![^(]*\))/)) {
          expect(part.trim(), value).toMatch(/^[a-z-]+ var\(--aile-sure\) var\(--aile-egri\)$/);
        }
      }
      const reduced = /@media \(prefers-reduced-motion: reduce\)\s*{([\s\S]*?)\n}/.exec(code);
      expect(reduced).not.toBeNull();
      for (const part of ['.aile-drawer-wrapper', '.aile-drawer-mask', '.aile-drawer-close']) expect(reduced![1]).toContain(part);
      expect(reduced![1]).toMatch(/transition:\s*none/);
    });

    it('CSS targets: Kapat 44 px, 48 px with a coarse pointer; no text below 14 px', () => {
      const code = css();
      // One central adaptive token: --aile-dokunma-hedefi is 44, 48 under data-input-coarse (admin.css, b04).
      expect(code).toMatch(/\.aile-drawer-close\s*{[^}]*min-height:\s*var\(--aile-dokunma-hedefi, var\(--aile-hedef-asgari\)\)/);
      expect(code).toMatch(/\.aile-drawer-close\s*{[^}]*min-width:\s*var\(--aile-dokunma-hedefi, var\(--aile-hedef-asgari\)\)/);
      expect(code).not.toMatch(/data-input-coarse/);
      const sizes = [...code.matchAll(/font-size:\s*([^;]+);/g)].map(match => match[1].trim());
      expect(sizes.length).toBeGreaterThan(0);
      for (const size of sizes) {
        const px = /^(\d+(?:\.\d+)?)px$/.exec(size);
        expect(px, size).not.toBeNull();
        expect(Number(px![1])).toBeGreaterThanOrEqual(14);
      }
    });
  });
});
