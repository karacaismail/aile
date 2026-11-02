import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EmptyState } from './EmptyState';

// Tasarım: components/Empty/README.md + bundle.js Empty. Filtre varsa etkin filtreler kaldırılabilir etiket olarak
// + "Filtreleri temizle"; filtre yoksa "Henüz kayıt yok" + title/message/action. Büyük çizim ya da renkli şerit yok.
const makeFilters = () => [
  { id: 'oda:salon', label: 'Oda: Salon', onRemove: vi.fn() },
  { id: 'durum:siparis', label: 'Durum: Sipariş verildi', onRemove: vi.fn() },
];

describe('EmptyState', () => {
  describe('filtresiz boşluk', () => {
    it('says "Henüz kayıt yok" in a status region and offers the given action', async () => {
      const onAdd = vi.fn();
      render(<EmptyState action={<button type="button" onClick={onAdd}>Alım ekle</button>} />);
      const status = screen.getByRole('status');
      expect(within(status).getByRole('heading', { level: 2, name: 'Henüz kayıt yok' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Filtreleri temizle' })).toBeNull();
      expect(screen.queryByText('Etkin filtreler:')).toBeNull();
      await userEvent.setup().click(within(status).getByRole('button', { name: 'Alım ekle' }));
      expect(onAdd).toHaveBeenCalledTimes(1);
    });

    it('renders a custom title and message, and no paragraph when no message is given', () => {
      const { rerender } = render(<EmptyState title="Ödeme kaydı yok" message="Kaynakta kayıt yok." />);
      expect(screen.getByRole('heading', { level: 2, name: 'Ödeme kaydı yok' })).toBeInTheDocument();
      expect(screen.getByText('Kaynakta kayıt yok.')).toBeInTheDocument();
      rerender(<EmptyState />);
      expect(screen.getByRole('heading', { level: 2, name: 'Henüz kayıt yok' })).toBeInTheDocument();
      expect(screen.getByRole('status').querySelectorAll('p')).toHaveLength(0);
    });

    it('treats an empty filters array as no filters', () => {
      render(<EmptyState filters={[]} onClear={() => {}} />);
      expect(screen.getByRole('heading', { level: 2, name: 'Henüz kayıt yok' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Filtreleri temizle' })).toBeNull();
    });
  });

  describe('etkin filtrelerle boşluk', () => {
    it('lists the active filters with removal buttons and a clear action that replaces the action slot', async () => {
      const user = userEvent.setup();
      const filters = makeFilters();
      const onClear = vi.fn();
      render(<EmptyState filters={filters} onClear={onClear} message="Gizlenir" action={<button type="button">Alım ekle</button>} />);
      expect(screen.getByRole('heading', { level: 2, name: 'Bu filtrelerle kayıt yok' })).toBeInTheDocument();
      const list = screen.getByRole('list', { name: 'Etkin filtreler:' });
      expect(within(list).getAllByRole('listitem').map(li => li.textContent)).toEqual(['Oda: Salon', 'Durum: Sipariş verildi']);
      await user.click(screen.getByRole('button', { name: 'Filtreyi kaldır: Oda: Salon' }));
      expect(filters[0].onRemove).toHaveBeenCalledTimes(1);
      expect(filters[1].onRemove).not.toHaveBeenCalled();
      await user.click(screen.getByRole('button', { name: 'Filtreleri temizle' }));
      expect(onClear).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('button', { name: 'Alım ekle' })).toBeNull();
      expect(screen.queryByText('Gizlenir')).toBeNull();
    });

    it('keeps a custom title over the filter default', () => {
      render(<EmptyState filters={makeFilters()} onClear={() => {}} title="Bu odada alım yok" />);
      expect(screen.getByRole('heading', { level: 2, name: 'Bu odada alım yok' })).toBeInTheDocument();
    });

    it('accepts plain label strings (design filters[]) without removal buttons', () => {
      render(<EmptyState filters={['Oda: Salon', 'Kategori: Aydınlatma']} onClear={() => {}} />);
      expect(within(screen.getByRole('list')).getAllByRole('listitem').map(li => li.textContent)).toEqual(['Oda: Salon', 'Kategori: Aydınlatma']);
      expect(screen.queryByRole('button', { name: /Filtreyi kaldır/ })).toBeNull();
      expect(screen.getByRole('button', { name: 'Filtreleri temizle' })).toBeInTheDocument();
    });

    it('removal buttons carry the shared focus-line hook and a decorative close icon', () => {
      render(<EmptyState filters={makeFilters()} onClear={() => {}} />);
      const remove = screen.getByRole('button', { name: 'Filtreyi kaldır: Oda: Salon' });
      expect(remove).toHaveAttribute('type', 'button');
      expect(remove).toHaveAttribute('data-focus-line');
      const svg = remove.querySelector('svg');
      expect(svg).toHaveAttribute('aria-hidden', 'true');
      expect(svg).toHaveAttribute('data-icon', 'close');
    });
  });

  it('draws no illustration: no antd Empty, no images, only decorative Phosphor icons', () => {
    render(<EmptyState filters={makeFilters()} onClear={() => {}} />);
    const status = screen.getByRole('status');
    expect(status.querySelector('img')).toBeNull();
    for (const svg of status.querySelectorAll('svg')) expect(svg).toHaveAttribute('data-icon');
    const source = readFileSync(resolve(__dirname, 'EmptyState.tsx'), 'utf8');
    expect(source).not.toMatch(/import\s*\{[^}]*\bEmpty\b[^}]*\}\s*from\s*['"]\.\/antd['"]/);
    expect(source).not.toMatch(/from\s+['"](antd|@ant-design\/)/);
  });
});

describe('EmptyState — native buttons, keyboard, touch and focus return', () => {
  /** Üst bileşen gibi davranır: kaldır/temizle filtre listesini gerçekten günceller, EmptyState yerinde kalır. */
  function Harness({ labels, removable = true }: { labels: readonly string[]; removable?: boolean }) {
    const [active, setActive] = useState(labels);
    const filters = active.map(label => (removable ? { id: label, label, onRemove: () => setActive(prev => prev.filter(item => item !== label)) } : label));
    return (
      <>
        <button type="button">Önce</button>
        <EmptyState filters={filters} onClear={() => setActive([])} />
      </>
    );
  }

  it('"Filtreleri temizle" is a native <button type="button"> carrying the shared focus-line hook', () => {
    render(<EmptyState filters={makeFilters()} onClear={() => {}} />);
    const clear = screen.getByRole('button', { name: 'Filtreleri temizle' });
    expect(clear.tagName).toBe('BUTTON');
    expect(clear).toHaveAttribute('type', 'button');
    expect(clear).toHaveAttribute('data-focus-line');
  });

  it('Tab / Shift+Tab walk the removal buttons then the clear action; Enter removes, Space clears, Escape does nothing', async () => {
    const user = userEvent.setup();
    const filters = makeFilters();
    const onClear = vi.fn();
    render(<EmptyState filters={filters} onClear={onClear} />);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Filtreyi kaldır: Oda: Salon' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Filtreyi kaldır: Durum: Sipariş verildi' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Filtreleri temizle' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Filtreyi kaldır: Durum: Sipariş verildi' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(filters[1].onRemove).not.toHaveBeenCalled();
    await user.keyboard('{Enter}');
    expect(filters[1].onRemove).toHaveBeenCalledTimes(1);
    await user.tab();
    await user.keyboard(' ');
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('a cancelled touch (pointercancel) neither removes nor clears; completed taps do', async () => {
    const filters = makeFilters();
    const onClear = vi.fn();
    render(<EmptyState filters={filters} onClear={onClear} />);
    const remove = screen.getByRole('button', { name: 'Filtreyi kaldır: Oda: Salon' });
    const clear = screen.getByRole('button', { name: 'Filtreleri temizle' });
    for (const target of [remove, clear]) {
      fireEvent.pointerDown(target, { pointerType: 'touch', isPrimary: true });
      fireEvent.pointerCancel(target, { pointerType: 'touch', isPrimary: true });
    }
    expect(filters[0].onRemove).not.toHaveBeenCalled();
    expect(onClear).not.toHaveBeenCalled();
    const user = userEvent.setup();
    await user.pointer({ keys: '[TouchA]', target: remove });
    await user.pointer({ keys: '[TouchA]', target: clear });
    expect(filters[0].onRemove).toHaveBeenCalledTimes(1);
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('after a removal focus moves to the next removal button, then the previous one, never to the page', async () => {
    const user = userEvent.setup();
    render(<Harness labels={['Oda: Salon', 'Oda: Mutfak', 'Durum: Teslim alındı']} />);
    await user.click(screen.getByRole('button', { name: 'Filtreyi kaldır: Oda: Mutfak' }));
    expect(screen.getByRole('button', { name: 'Filtreyi kaldır: Durum: Teslim alındı' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: 'Filtreyi kaldır: Oda: Salon' })).toHaveFocus();
  });

  it('after the last removal or "Filtreleri temizle" focus lands on the heading that says why the list is empty', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Harness labels={['Oda: Salon']} />);
    await user.click(screen.getByRole('button', { name: 'Filtreyi kaldır: Oda: Salon' }));
    const heading = screen.getByRole('heading', { level: 2, name: 'Henüz kayıt yok' });
    expect(heading).toHaveFocus();
    expect(heading).toHaveAttribute('tabindex', '-1');
    expect(heading).toHaveAttribute('data-focus-line');
    unmount();

    render(<Harness labels={['Oda: Salon', 'Oda: Mutfak']} />);
    await user.click(screen.getByRole('button', { name: 'Filtreleri temizle' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Henüz kayıt yok' })).toHaveFocus();
  });

  it('with text-only filters left after a removal, focus goes to "Filtreleri temizle"', async () => {
    function Mixed() {
      const [gone, setGone] = useState(false);
      const filters = gone ? ['Arama: lamba'] : [{ id: 'oda', label: 'Oda: Salon', onRemove: () => setGone(true) }, 'Arama: lamba'];
      return <EmptyState filters={filters} onClear={() => {}} />;
    }
    const user = userEvent.setup();
    render(<Mixed />);
    await user.click(screen.getByRole('button', { name: 'Filtreyi kaldır: Oda: Salon' }));
    expect(screen.getByRole('button', { name: 'Filtreleri temizle' })).toHaveFocus();
  });

  it('does not move focus when a filter is removed somewhere else (for example the query bar)', async () => {
    function Outside() {
      const [active, setActive] = useState(['Oda: Salon', 'Oda: Mutfak']);
      return (
        <>
          <button type="button" onClick={() => setActive(prev => prev.slice(1))}>Dışarıdan kaldır</button>
          <EmptyState filters={active.map(label => ({ id: label, label, onRemove: () => {} }))} onClear={() => {}} />
        </>
      );
    }
    const user = userEvent.setup();
    render(<Outside />);
    await user.click(screen.getByRole('button', { name: 'Dışarıdan kaldır' }));
    expect(screen.getByRole('button', { name: 'Dışarıdan kaldır' })).toHaveFocus();
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

describe('EmptyState — phone delivery and stylesheet', () => {
  const css = () => readFileSync(resolve(__dirname, 'EmptyState.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  it('phone presentation has no antd: no antd, @ant-design/* or ui/antd.ts in its static import closure', () => {
    const { files, packages } = staticClosure(resolve(__dirname, 'EmptyState.tsx'));
    expect(packages.filter(spec => ANTD.test(spec))).toEqual([]);
    expect(files).not.toContain(resolve(__dirname, 'antd.ts'));
    expect(files.filter(file => /\.wide\.|[\\/]wide[\\/]/.test(file))).toEqual([]);
    expect(packages).not.toContain('echarts');
  });

  // Hedef tek kaynaktan gelir: --aile-dokunma-hedefi (admin.css / tokens.ts targetTokens: 44, data-input-coarse
  // katmanında 48); bileşen coarse değerini kendisi türetmez.
  it('removal and clear buttons take their size from the touch-target token (44 px, 48 px under coarse input)', () => {
    const sheet = css();
    expect(sheet).toMatch(/\.aile-empty-state__clear\s*\{[^}]*min-height:\s*var\(--aile-dokunma-hedefi\)/);
    expect(sheet).toMatch(/\.aile-empty-state__remove\s*\{[^}]*min-height:\s*var\(--aile-dokunma-hedefi\)/);
    expect(sheet).toMatch(/\.aile-empty-state__remove\s*\{[^}]*min-width:\s*var\(--aile-dokunma-hedefi\)/);
    expect(sheet).toMatch(/\.aile-empty-state__filter\s*\{[^}]*min-height:\s*var\(--aile-dokunma-hedefi\)/);
    expect(sheet).not.toMatch(/\[data-input-coarse\]/);
    expect(sheet).not.toContain('var(--aile-hedef-asgari) + var(--aile-bosluk-1)');
  });

  it('text stays at or above 14 px, no ring/outline/shadow, colours only from tokens, reduced motion honoured', () => {
    const sheet = css();
    const sizes = [...sheet.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map(m => Number(m[1]));
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(14);
    expect(sheet).not.toMatch(/outline|box-shadow/);
    expect(sheet).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(sheet).not.toMatch(/rgba?\(/);
    expect(sheet).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*transition-duration:\s*0s/);
  });
});

