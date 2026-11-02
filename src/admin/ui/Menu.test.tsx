import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { importsOf } from '../adaptive/sourceRules';
import { DeviceContext } from '../device';
import type { Device } from '../shell/contracts';
import { DANGER_GROUP_LABEL, Menu, MENU_POPUP_MIN_WIDTH, type MenuItem } from './Menu';

// Kaynak: aile-tasarim/tasarim-sistemi/components/Menu/README.md + index.d.ts MenuProps/MenuItem + bundle.js Menu;
// klavye sözleşmesi WAI-ARIA APG "Menu" ve "Menu Button" kalıpları. Seçiciler role/label ile; bizim sınıflarımız
// aile-menu*, data-variant, data-pressed, data-state.
//
// Telefonda menü düğmesi listeyi BottomSheet içinde açar. BottomSheet ayrı görevde (a05) yazılır; burada yalnız
// sözleşmesi (README + index.d.ts: role dialog, başlık adı, görünür "Kapat", Escape kapatır, open=false çizmez) taklit
// edilir ki Menu'nün devri BottomSheet'in uygulamasından bağımsız doğrulansın.
vi.mock('./BottomSheet', () => ({
  BottomSheet: (p: { title: string; children?: ReactNode; onClose?: () => void; open?: boolean; inline?: boolean }) =>
    p.open === false ? null : (
      <div
        role="dialog"
        aria-modal="true"
        aria-label={p.title}
        data-testid="alt-sayfa"
        data-inline={String(p.inline)}
        onKeyDown={event => { if (event.key === 'Escape') p.onClose?.(); }}
      >
        <button type="button" onClick={p.onClose}>Kapat</button>
        {p.children}
      </div>
    ),
}));

const nav: readonly MenuItem[] = [
  { key: 'genel', label: 'Genel durum', href: '#/genel' },
  { key: 'alimlar', label: 'Alımlar ve eşyalar', href: '#/alimlar', count: 1250 },
  { key: 'veri', label: 'Veri kalitesi ve içe aktarma', href: '#/veri', disabled: true },
  { key: 'd1', label: '', divider: true },
  { key: 'ayarlar', label: 'Ayarlar', icon: 'settings', href: '#/ayarlar' },
  { key: 'etablo', label: 'E-tabloyu aç', icon: 'sheet', href: 'https://example.invalid/sheet', external: true },
];

const actions: readonly MenuItem[] = [
  { key: 'duzenle', label: 'Düzenle', icon: 'edit' },
  { key: 'indir', label: 'CSV indir', icon: 'download' },
  { key: 'sil', label: 'Sil', disabled: true },
];

/** Typeahead: tr-TR küçük harf (İ → i, Ç → ç). */
const typeahead: readonly MenuItem[] = [
  { key: 'duzenle', label: 'Düzenle' },
  { key: 'disa', label: 'Dışa aktar' },
  { key: 'csv', label: 'CSV indir' },
  { key: 'ice', label: 'İçe aktar' },
  { key: 'cogalt', label: 'Çoğalt' },
];

const withDanger: readonly MenuItem[] = [
  { key: 'duzenle', label: 'Düzenle', icon: 'edit' },
  { key: 'sil', label: 'Sil', danger: true },
  { key: 'indir', label: 'CSV indir', icon: 'download' },
];

const onDevice = (device: Device) => ({ children }: { children: ReactNode }) =>
  <DeviceContext.Provider value={device}>{children}</DeviceContext.Provider>;

const UI_DIR = __dirname;
const REPO = resolve(UI_DIR, '../../..');
const read = (name: string) => readFileSync(resolve(UI_DIR, name), 'utf8');
/** Yorumsuz CSS; kural gövdeleri seçiciyle birlikte düz metin. */
const css = () => read('Menu.css').replace(/\/\*[\s\S]*?\*\//g, '');
const rule = (source: string, selector: RegExp) => {
  const found: string[] = [];
  for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) if (selector.test(match[1].trim())) found.push(match[2]);
  return found.join(';');
};

/** Göreli statik importları izleyerek dosyanın statik kapanışında antd yüzeyine giden yolları döndürür. */
function antdPaths(entry: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const resolveLocal = (from: string, specifier: string) => {
    const base = resolve(dirname(from), specifier);
    return [base, `${base}.tsx`, `${base}.ts`, resolve(base, 'index.tsx'), resolve(base, 'index.ts')]
      .find(candidate => /\.tsx?$/.test(candidate) && existsSync(candidate)) ?? null;
  };
  const visit = (file: string, trail: string[]) => {
    if (seen.has(file)) return;
    seen.add(file);
    const here = [...trail, relative(REPO, file)];
    for (const ref of importsOf(readFileSync(file, 'utf8'))) {
      if (ref.kind !== 'static' || ref.typeOnly) continue;
      if (/^(antd|@ant-design)(\/|$)/.test(ref.specifier) || /^\.{1,2}\/(.*\/)?antd$/.test(ref.specifier)) {
        out.push(`${here.join(' > ')} > ${ref.specifier}`);
        continue;
      }
      if (!ref.specifier.startsWith('.')) continue;
      const next = resolveLocal(file, ref.specifier);
      if (next) visit(next, here);
    }
  };
  visit(resolve(UI_DIR, entry), []);
  return out;
}

describe('Menu › liste (gezinme ve eylem listesi)', () => {
  it('renders href items as links inside an accessible menu', () => {
    render(<Menu items={nav} label="Sayfalar" />);
    const menu = screen.getByRole('menu', { name: 'Sayfalar' });
    expect(within(menu).getByRole('link', { name: 'Genel durum' })).toHaveAttribute('href', '#/genel');
    expect(within(menu).getByRole('link', { name: /Alımlar ve eşyalar/ })).toHaveAttribute('href', '#/alimlar');
    expect(within(menu).getByRole('link', { name: 'Ayarlar' })).toHaveAttribute('href', '#/ayarlar');
  });

  it('marks only the selected item with aria-current="page"', () => {
    render(<Menu items={nav} selectedKey="alimlar" />);
    const selected = screen.getByRole('link', { name: /Alımlar ve eşyalar/ });
    expect(selected).toHaveAttribute('aria-current', 'page');
    expect(selected.closest('[role="menuitem"]')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Genel durum' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Ayarlar' })).not.toHaveAttribute('aria-current');
    expect(screen.getAllByRole('menuitem').filter(item => item.getAttribute('aria-current') === 'page')).toHaveLength(1);
  });

  it('opens external links in a new tab with the hidden note and the external icon', () => {
    render(<Menu items={nav} />);
    const link = screen.getByRole('link', { name: 'E-tabloyu aç (yeni sekmede açılır)' });
    expect(link).toHaveAttribute('href', 'https://example.invalid/sheet');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')?.split(/\s+/)).toContain('noopener');
    expect(link.querySelector('[data-icon="external"]')).not.toBeNull();
    expect(link.querySelector('[data-icon="sheet"]')).not.toBeNull();
  });

  it('keeps internal links in the same tab', () => {
    render(<Menu items={nav} />);
    const link = screen.getByRole('link', { name: 'Genel durum' });
    expect(link).not.toHaveAttribute('target');
    expect(link).not.toHaveAttribute('rel');
    expect(link).toHaveAccessibleName('Genel durum');
  });

  it('shows the count as a tr-TR number next to the label without cutting the label', () => {
    render(<Menu items={nav} />);
    const link = screen.getByRole('link', { name: /Alımlar ve eşyalar/ });
    expect(link).toHaveTextContent('Alımlar ve eşyalar');
    expect(link).toHaveTextContent('1.250');
    expect(screen.getByRole('link', { name: 'Genel durum' })).not.toHaveTextContent(/\d/);
  });

  it('renders a divider as a separator', () => {
    render(<Menu items={nav} />);
    expect(screen.getAllByRole('separator')).toHaveLength(1);
  });

  it('disables an item with aria-disabled and drops its href', () => {
    render(<Menu items={nav} />);
    const item = screen.getByRole('menuitem', { name: 'Veri kalitesi ve içe aktarma' });
    expect(item).toHaveAttribute('aria-disabled', 'true');
    expect(within(item).queryByRole('link')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Veri kalitesi ve içe aktarma' })).toBeNull();
  });

  it('calls onSelect with the key when an action item is clicked, not for disabled items', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Menu items={actions} onSelect={onSelect} />);
    await user.click(screen.getByRole('menuitem', { name: 'CSV indir' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('indir');
    await user.click(screen.getByRole('menuitem', { name: 'Sil' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('calls onSelect when a link item is clicked', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Menu items={nav} onSelect={onSelect} />);
    await user.click(screen.getByRole('link', { name: 'Ayarlar' }));
    expect(onSelect).toHaveBeenCalledWith('ayarlar');
  });

  it('APG: the menu is one tab stop (the selected item); the list itself is not focusable; Tab leaves the menu', async () => {
    const user = userEvent.setup();
    render(<><Menu items={nav} selectedKey="ayarlar" /><button type="button">Sonraki</button></>);
    expect(screen.getByRole('menu')).not.toHaveAttribute('tabindex');
    const stops = screen.getAllByRole('link').filter(link => link.getAttribute('tabindex') === '0');
    expect(stops.map(link => link.textContent)).toEqual(['Ayarlar']);
    await user.tab();
    expect(screen.getByRole('link', { name: 'Ayarlar' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Sonraki' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('link', { name: 'Ayarlar' })).toHaveFocus();
  });

  it('APG: without a selection the first enabled item is the tab stop; disabled items never are', async () => {
    const user = userEvent.setup();
    render(<Menu items={actions} />);
    await user.tab();
    expect(screen.getByRole('menuitem', { name: 'Düzenle' })).toHaveFocus();
    expect(screen.getByRole('menuitem', { name: 'Sil' })).not.toHaveAttribute('tabindex', '0');
  });

  it('APG: arrows move focus between enabled items (wrapping), skipping disabled items and dividers; Home/End go to the ends', async () => {
    const user = userEvent.setup();
    render(<Menu items={nav} />);
    await user.tab();
    const link = (name: string | RegExp) => screen.getByRole('link', { name });
    expect(link('Genel durum')).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(link(/Alımlar ve eşyalar/)).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(link('Ayarlar')).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(link(/E-tabloyu aç/)).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(link('Genel durum')).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(link(/E-tabloyu aç/)).toHaveFocus();
    await user.keyboard('{Home}');
    expect(link('Genel durum')).toHaveFocus();
    await user.keyboard('{End}');
    expect(link(/E-tabloyu aç/)).toHaveFocus();
    // Roving tabindex: sekme durağı odağı izler.
    expect(link(/E-tabloyu aç/)).toHaveAttribute('tabindex', '0');
    expect(link('Genel durum')).toHaveAttribute('tabindex', '-1');
  });

  it('APG typeahead: a printable character moves to the next item starting with it (tr-TR case), repeats cycle, quick strings match prefixes', async () => {
    const user = userEvent.setup();
    let now = 10_000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      render(<Menu items={typeahead} />);
      const item = (name: string) => screen.getByRole('menuitem', { name });
      await user.tab();
      expect(item('Düzenle')).toHaveFocus();
      await user.keyboard('d');
      expect(item('Dışa aktar')).toHaveFocus();
      now += 100;
      await user.keyboard('d');
      expect(item('Düzenle')).toHaveFocus();
      now += 1000;
      await user.keyboard('i');
      expect(item('İçe aktar')).toHaveFocus();
      now += 1000;
      await user.keyboard('ç');
      expect(item('Çoğalt')).toHaveFocus();
      now += 1000;
      await user.keyboard('c');
      expect(item('CSV indir')).toHaveFocus();
      now += 1000;
      await user.keyboard('D');
      now += 100;
      await user.keyboard('ü');
      expect(item('Düzenle')).toHaveFocus();
      // Eşleşme yoksa odak yerinde kalır.
      now += 1000;
      await user.keyboard('x');
      expect(item('Düzenle')).toHaveFocus();
    } finally {
      clock.mockRestore();
    }
  });

  it('Enter and Space activate an action item; Space does not scroll the page; disabled items do nothing', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Menu items={actions} onSelect={onSelect} />);
    await user.tab();
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenLastCalledWith('duzenle');
    await user.keyboard('{ArrowDown}');
    const csv = screen.getByRole('menuitem', { name: 'CSV indir' });
    expect(csv).toHaveFocus();
    expect(fireEvent.keyDown(csv, { key: ' ', code: 'Space' })).toBe(false);
    expect(onSelect).toHaveBeenLastCalledWith('indir');
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it('Space on a link item follows the link (click) and calls onSelect', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Menu items={nav} onSelect={onSelect} selectedKey="ayarlar" />);
    await user.tab();
    const ayarlar = screen.getByRole('link', { name: 'Ayarlar' });
    const clicked = vi.fn((event: MouseEvent) => event.preventDefault());
    ayarlar.addEventListener('click', clicked);
    expect(fireEvent.keyDown(ayarlar, { key: ' ', code: 'Space' })).toBe(false);
    expect(clicked).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('ayarlar');
  });

  it('Pointer Events: pointerdown shows the pressed surface, pointercancel (scroll) clears it without selecting; pointerup clears it', () => {
    const onSelect = vi.fn();
    render(<Menu items={actions} onSelect={onSelect} />);
    const item = screen.getByRole('menuitem', { name: 'Düzenle' });
    fireEvent.pointerDown(item, { pointerType: 'touch', button: 0, isPrimary: true });
    expect(item).toHaveAttribute('data-pressed');
    fireEvent.pointerCancel(item, { pointerType: 'touch' });
    expect(item).not.toHaveAttribute('data-pressed');
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.pointerDown(item, { pointerType: 'mouse', button: 0, isPrimary: true });
    expect(item).toHaveAttribute('data-pressed');
    fireEvent.pointerUp(item, { pointerType: 'mouse', button: 0 });
    expect(item).not.toHaveAttribute('data-pressed');
    // İkincil fare düğmesi ve devre dışı öğe basılı görünmez.
    fireEvent.pointerDown(item, { pointerType: 'mouse', button: 2 });
    expect(item).not.toHaveAttribute('data-pressed');
    const sil = screen.getByRole('menuitem', { name: 'Sil' });
    fireEvent.pointerDown(sil, { pointerType: 'touch', button: 0 });
    expect(sil).not.toHaveAttribute('data-pressed');
  });

  it('marks the nav variant on the root for the lacivert surface', () => {
    render(<Menu items={nav} variant="nav" label="Sayfalar" />);
    const menu = screen.getByRole('menu', { name: 'Sayfalar' });
    expect(menu).toHaveClass('aile-menu');
    expect(menu).toHaveAttribute('data-variant', 'nav');
  });

  it('has no variant attribute on the light surface', () => {
    render(<Menu items={actions} className="deneme" />);
    const menu = screen.getByRole('menu');
    expect(menu).not.toHaveAttribute('data-variant');
    expect(menu).toHaveClass('aile-menu', 'deneme');
  });

  it('puts danger items in their own labelled group after a separator', () => {
    render(<Menu items={withDanger} label="Eylemler" />);
    const menu = screen.getByRole('menu', { name: 'Eylemler' });
    expect(within(menu).getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Düzenle', 'CSV indir', 'Sil']);
    const group = within(menu).getByRole('group', { name: DANGER_GROUP_LABEL });
    expect(within(group).getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Sil']);
    expect(within(menu).getAllByRole('separator')).toHaveLength(1);
    expect(within(group).getByRole('menuitem', { name: 'Sil' })).toHaveClass('aile-menu-item--tehlike');
  });
});

describe('Menu › görsel sözleşme (Menu.css)', () => {
  it('selected state is a surface tone plus weight 600, never an accent edge', () => {
    const source = css();
    const selected = rule(source, /^\.aile-menu-item\[aria-current='page'\]$/);
    expect(selected).toMatch(/background:\s*var\(--aile-secili\)/);
    expect(selected).toMatch(/font-weight:\s*600/);
    // Vurgu kenarı (kenarlık şeridi, iç gölge çubuğu, pseudo şerit) yok.
    expect(source).not.toMatch(/border-(left|right|top|bottom|inline|block)[^:]*:/);
    expect(source).not.toMatch(/inset\s+[-\d]/);
    expect(source).not.toMatch(/::before/);
  });

  it('targets are 44 px and 48 px on coarse input; every font-size is at least 14 px', () => {
    const source = css();
    expect(rule(source, /^\.aile-menu-item$/)).toMatch(/min-height:\s*var\(--aile-hedef-asgari\)/);
    expect(rule(source, /\[data-input-coarse\]\s+\.aile-menu-item$/))
      .toMatch(/min-height:\s*calc\(var\(--aile-hedef-asgari\)\s*\+\s*var\(--aile-bosluk-1\)\)/);
    const sizes = [...source.matchAll(/font-size:\s*([\d.]+)px/g)].map(match => Number(match[1]));
    expect(sizes.length).toBeGreaterThan(0);
    for (const size of sizes) expect(size).toBeGreaterThanOrEqual(14);
  });

  it('motion uses the central duration and curve; reduced-motion turns it off', () => {
    const source = css();
    const transitions = [...source.matchAll(/transition:\s*([^;]+);/g)].map(match => match[1]);
    expect(transitions.length).toBeGreaterThan(0);
    for (const value of transitions) {
      for (const part of value.split(',')) expect(part.trim()).toMatch(/^[a-z-]+ var\(--aile-sure\) var\(--aile-egri\)$/);
    }
    const raw = read('Menu.css');
    const reduced = raw.slice(raw.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toMatch(/\.aile-menu-item/);
    expect(reduced).toMatch(/\.aile-menu-panel/);
    expect(reduced).toMatch(/transition-duration:\s*0s/);
  });

  it('uses only design tokens: no hex colour, no outline, no focus ring; the only shadow is golge-yukseltilmis', () => {
    const source = read('Menu.tsx');
    const style = css();
    expect(source).not.toContain('@ant-design/icons');
    expect(source).not.toContain('@phosphor-icons');
    expect(source).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(style).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(style).not.toMatch(/rgba?\(/);
    expect(style).not.toMatch(/\boutline\s*:/);
    for (const match of style.matchAll(/box-shadow:\s*([^;]+);/g)) expect(match[1].trim()).toBe('var(--aile-golge-yukseltilmis)');
  });
});

describe('Menu › antd kapısı (telefon sunumu antd istemez)', () => {
  it('Menu.tsx and OverflowActions.tsx import no antd surface themselves', () => {
    for (const file of ['Menu.tsx', 'OverflowActions.tsx']) {
      const own = importsOf(read(file)).filter(ref => ref.kind === 'static')
        .map(ref => ref.specifier)
        .filter(specifier => /^(antd|@ant-design)(\/|$)/.test(specifier) || /(^|\/)antd$/.test(specifier) || /antdTheme$/.test(specifier));
      expect(own, file).toEqual([]);
    }
  });

  // Button (a01) ve BottomSheet (a05) kendi görevlerinde antd'siz yazılır; o işler birleşince yeşile döner.
  it('the static import closure of Menu.tsx and OverflowActions.tsx reaches no antd surface', () => {
    expect([...antdPaths('Menu.tsx'), ...antdPaths('OverflowActions.tsx')]).toEqual([]);
  });
});

describe('Menu › menü düğmesi (APG menu button), geniş profil: açılır panel', () => {
  const wrapper = onDevice('desktop');

  it('renders a text button with aria-haspopup=menu, closed by default; click opens the menu and focuses the first item', async () => {
    const user = userEvent.setup();
    render(<Menu trigger="Sırala" items={actions} />, { wrapper });
    const button = screen.getByRole('button', { name: 'Sırala' });
    expect(button).toHaveAttribute('aria-haspopup', 'menu');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).not.toHaveAttribute('aria-controls');
    expect(button.querySelector('[data-icon="chevronDown"]')).not.toBeNull();
    expect(screen.queryByRole('menu')).toBeNull();
    await user.click(button);
    const menu = screen.getByRole('menu', { name: 'Sırala' });
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(button).toHaveAttribute('aria-controls', menu.id);
    await waitFor(() => expect(within(menu).getByRole('menuitem', { name: 'Düzenle' })).toHaveFocus());
    // Açılır menüde öğeler sekme sırasında değildir (odak programla verilir).
    for (const item of within(menu).getAllByRole('menuitem')) expect(item).not.toHaveAttribute('tabindex', '0');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(menu.closest('.aile-menu-panel')).toHaveStyle({ minWidth: `${MENU_POPUP_MIN_WIDTH}px` });
  });

  it('the menu name comes from label when given', async () => {
    const user = userEvent.setup();
    render(<Menu trigger="Sırala" label="Sıralama ölçütü" items={actions} />, { wrapper });
    await user.click(screen.getByRole('button', { name: 'Sırala' }));
    expect(screen.getByRole('menu', { name: 'Sıralama ölçütü' })).toBeInTheDocument();
  });

  it('keyboard on the button: Enter and Space open on the first item, ArrowDown on the first, ArrowUp on the last', async () => {
    const user = userEvent.setup();
    render(<Menu trigger="Sırala" items={typeahead} />, { wrapper });
    const button = screen.getByRole('button', { name: 'Sırala' });
    const item = (name: string) => screen.getByRole('menuitem', { name });

    button.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(item('Düzenle')).toHaveFocus());
    await user.keyboard('{Escape}');
    expect(button).toHaveFocus();

    await user.keyboard(' ');
    await waitFor(() => expect(item('Düzenle')).toHaveFocus());
    await user.keyboard('{Escape}');

    await user.keyboard('{ArrowDown}');
    await waitFor(() => expect(item('Düzenle')).toHaveFocus());
    await user.keyboard('{Escape}');

    await user.keyboard('{ArrowUp}');
    await waitFor(() => expect(item('Çoğalt')).toHaveFocus());
    expect(button).toHaveAttribute('aria-expanded', 'true');
  });

  it('inside the menu: arrows wrap, Home/End, typeahead; Enter selects, closes, returns focus, then calls onSelect', async () => {
    const user = userEvent.setup();
    const order: string[] = [];
    const onSelect = vi.fn((key: string) => {
      order.push(`select:${key}:${document.activeElement?.textContent ?? ''}`);
    });
    render(<Menu trigger="Sırala" items={typeahead} onSelect={onSelect} />, { wrapper });
    const button = screen.getByRole('button', { name: 'Sırala' });
    const item = (name: string) => screen.getByRole('menuitem', { name });
    await user.click(button);
    await waitFor(() => expect(item('Düzenle')).toHaveFocus());
    await user.keyboard('{ArrowUp}');
    expect(item('Çoğalt')).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(item('Düzenle')).toHaveFocus();
    await user.keyboard('{End}');
    expect(item('Çoğalt')).toHaveFocus();
    await user.keyboard('{Home}');
    expect(item('Düzenle')).toHaveFocus();
    await user.keyboard('i');
    expect(item('İçe aktar')).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['select:ice:Sırala']);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveFocus();
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('Escape closes without selecting, returns focus to the button and does not reach an outer layer', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const outer = vi.fn();
    render(<div onKeyDown={event => { if (event.key === 'Escape') outer(); }}><Menu trigger="Sırala" items={actions} onSelect={onSelect} /></div>, { wrapper });
    const button = screen.getByRole('button', { name: 'Sırala' });
    await user.click(button);
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Düzenle' })).toHaveFocus());
    await user.keyboard('{Escape}');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveFocus();
    expect(onSelect).not.toHaveBeenCalled();
    expect(outer).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('Tab closes the menu and leaves focus in the natural order (not back on the button)', async () => {
    const user = userEvent.setup();
    render(<><Menu trigger="Sırala" items={actions} /><button type="button">Sonraki</button></>, { wrapper });
    const button = screen.getByRole('button', { name: 'Sırala' });
    await user.click(button);
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Düzenle' })).toHaveFocus());
    await user.tab();
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: 'Sonraki' })).toHaveFocus();
  });

  it('a pointerdown outside closes the menu and does not move focus to the button', async () => {
    const user = userEvent.setup();
    render(<><Menu trigger="Sırala" items={actions} /><p>Dışarı</p></>, { wrapper });
    const button = screen.getByRole('button', { name: 'Sırala' });
    await user.click(button);
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Düzenle' })).toHaveFocus());
    fireEvent.pointerDown(screen.getByText('Dışarı'), { pointerType: 'touch' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).not.toHaveFocus();
    // İçeride pointerdown kapatmaz.
    await user.click(button);
    fireEvent.pointerDown(screen.getByRole('menuitem', { name: 'CSV indir' }), { pointerType: 'touch' });
    expect(button).toHaveAttribute('aria-expanded', 'true');
  });

  it('clicking the open button closes the menu', async () => {
    const user = userEvent.setup();
    render(<Menu trigger="Sırala" items={actions} />, { wrapper });
    const button = screen.getByRole('button', { name: 'Sırala' });
    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveFocus();
  });

  it('motion: the panel enters with data-state=open; on close aria-expanded flips at once and a zero-duration panel leaves at once', async () => {
    const user = userEvent.setup();
    render(<Menu trigger="Sırala" items={actions} />, { wrapper });
    const button = screen.getByRole('button', { name: 'Sırala' });
    await user.click(button);
    const panel = screen.getByRole('menu').closest('.aile-menu-panel') as HTMLElement;
    expect(panel).toHaveAttribute('data-state', 'open');
    await user.keyboard('{Escape}');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(panel.isConnected).toBe(false);
  });

  it('motion: with a running transition the closing panel stays (inert, hidden from AT) until transitionend', async () => {
    const user = userEvent.setup();
    // jsdom CSS yüklemez (css: false); panelde süren bir geçişi hesaplanmış stil üzerinden taklit ederiz.
    const original = window.getComputedStyle;
    const style = vi.spyOn(window, 'getComputedStyle').mockImplementation(((element: Element, pseudo?: string | null) => {
      const real = original(element, pseudo);
      if (!(element instanceof HTMLElement && element.classList.contains('aile-menu-panel'))) return real;
      return new Proxy(real, {
        get(target, property) {
          if (property === 'transitionDuration') return '0.24s, 0.24s';
          const value = Reflect.get(target, property) as unknown;
          return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
        },
      });
    }) as typeof window.getComputedStyle);
    try {
      render(<Menu trigger="Sırala" items={actions} />, { wrapper });
      const button = screen.getByRole('button', { name: 'Sırala' });
      await user.click(button);
      const panel = document.querySelector('.aile-menu-panel') as HTMLElement;
      await user.keyboard('{Escape}');
      expect(button).toHaveAttribute('aria-expanded', 'false');
      expect(button).toHaveFocus();
      expect(panel.isConnected).toBe(true);
      expect(panel).toHaveAttribute('data-state', 'closed');
      expect(panel).toHaveAttribute('inert');
      expect(panel).toHaveAttribute('aria-hidden', 'true');
      expect(screen.queryByRole('menu')).toBeNull();
      // Hareket bitmeden yeniden açılırsa aynı panel geri döner (kesintisiz yön değişimi).
      await user.click(button);
      expect(document.querySelector('.aile-menu-panel')).toBe(panel);
      expect(panel).toHaveAttribute('data-state', 'open');
      expect(panel).not.toHaveAttribute('inert');
      await user.keyboard('{Escape}');
      act(() => { panel.dispatchEvent(Object.assign(new Event('transitionend'), { propertyName: 'opacity' })); });
      expect(panel.isConnected).toBe(false);
    } finally {
      style.mockRestore();
    }
  });

  it('places the panel above a button near the bottom edge and keeps it inside the viewport', async () => {
    const user = userEvent.setup();
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
    Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 1200 });
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const box = (left: number, top: number, width: number, height: number) =>
        ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
      if (this.classList.contains('aile-menu-panel')) return box(0, 0, 260, 300);
      if (this.matches('button')) return box(1100, 700, 90, 44);
      return box(0, 0, 0, 0);
    });
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('aile-menu-panel') ? 300 : 0;
    });
    try {
      render(<Menu trigger="Sırala" items={actions} align="end" />, { wrapper });
      await user.click(screen.getByRole('button', { name: 'Sırala' }));
      const panel = document.querySelector('.aile-menu-panel') as HTMLElement;
      expect(panel).toHaveAttribute('data-side', 'top');
      expect(parseFloat(panel.style.top)).toBeLessThan(700);
      expect(parseFloat(panel.style.top)).toBeGreaterThanOrEqual(0);
      // Sağ hizalı: panel sağ kenarı düğmenin sağ kenarıyla aynı, görünüm alanında kalır.
      expect(parseFloat(panel.style.left) + 260).toBeLessThanOrEqual(1200);
      expect(parseFloat(panel.style.left)).toBe(1190 - 260);
    } finally {
      rect.mockRestore();
      scroll.mockRestore();
      Reflect.deleteProperty(window, 'innerHeight');
      Reflect.deleteProperty(document.documentElement, 'clientWidth');
    }
  });

  it('tablet uses the popover as well', async () => {
    const user = userEvent.setup();
    render(<Menu trigger="Sırala" items={actions} />, { wrapper: onDevice('tablet') });
    const button = screen.getByRole('button', { name: 'Sırala' });
    expect(button).toHaveAttribute('aria-haspopup', 'menu');
    await user.click(button);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('defaultOpen + inline renders the open panel in place without stealing focus', () => {
    const { container } = render(<Menu trigger="Sırala" items={actions} defaultOpen inline />, { wrapper });
    const menu = screen.getByRole('menu');
    expect(container.contains(menu)).toBe(true);
    expect(menu.closest('.aile-menu-panel')).toHaveAttribute('data-inline');
    expect(document.body).toHaveFocus();
  });
});

describe('Menu › menü düğmesi, telefon profili: alt sayfa', () => {
  const wrapper = onDevice('phone');

  it('aria-haspopup=dialog; the sheet is titled by label (or trigger) and holds the menu; focus goes to the first item', async () => {
    const user = userEvent.setup();
    render(<Menu trigger="Sırala" items={actions} />, { wrapper });
    const button = screen.getByRole('button', { name: 'Sırala' });
    expect(button).toHaveAttribute('aria-haspopup', 'dialog');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(button);
    const sheet = screen.getByRole('dialog', { name: 'Sırala' });
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(button).not.toHaveAttribute('aria-controls');
    const menu = within(sheet).getByRole('menu', { name: 'Sırala' });
    await waitFor(() => expect(within(menu).getByRole('menuitem', { name: 'Düzenle' })).toHaveFocus());
    expect(document.querySelector('.aile-menu-panel')).toBeNull();
  });

  it('arrows and typeahead work in the sheet; selecting closes it, returns focus and calls onSelect', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Menu trigger="Sırala" items={typeahead} onSelect={onSelect} />, { wrapper });
    const button = screen.getByRole('button', { name: 'Sırala' });
    await user.click(button);
    const item = (name: string) => screen.getByRole('menuitem', { name });
    await waitFor(() => expect(item('Düzenle')).toHaveFocus());
    await user.keyboard('{ArrowDown}');
    expect(item('Dışa aktar')).toHaveFocus();
    await user.keyboard('{End}');
    expect(item('Çoğalt')).toHaveFocus();
    await user.keyboard('c');
    expect(item('CSV indir')).toHaveFocus();
    await user.keyboard(' ');
    expect(onSelect).toHaveBeenCalledWith('csv');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveFocus();
  });

  it('Escape (the sheet onClose) closes and returns focus to the button', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Menu trigger="Sırala" items={actions} onSelect={onSelect} inline />, { wrapper });
    const button = screen.getByRole('button', { name: 'Sırala' });
    await user.click(button);
    expect(screen.getByTestId('alt-sayfa')).toHaveAttribute('data-inline', 'true');
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Düzenle' })).toHaveFocus());
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button).toHaveFocus();
    expect(onSelect).not.toHaveBeenCalled();
  });
});
