import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Menu, type MenuItem } from './Menu';

// Kaynak: aile-tasarim/tasarim-sistemi/components/Menu/README.md + index.d.ts MenuProps/MenuItem + bundle.js Menu.
// Seçiciler role/label ile; antd iç sınıflarına bağlı seçici yok. Bizim sınıflarımız aile-menu*, data-variant.

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

/** antd Menu (rc-menu useKeyRecords) yolları bir animasyon karesi sonra yeniler; o kareyi act içinde bekler. */
async function renderMenu(ui: Parameters<typeof render>[0]) {
  const result = render(ui);
  await act(async () => { await new Promise<void>(resolve => { requestAnimationFrame(() => resolve()); }); });
  return result;
}

describe('Menu', () => {
  it('renders href items as links inside an accessible menu', async () => {
    await renderMenu(<Menu items={nav} label="Sayfalar" />);
    const menu = screen.getByRole('menu', { name: 'Sayfalar' });
    expect(within(menu).getByRole('link', { name: 'Genel durum' })).toHaveAttribute('href', '#/genel');
    expect(within(menu).getByRole('link', { name: /Alımlar ve eşyalar/ })).toHaveAttribute('href', '#/alimlar');
    expect(within(menu).getByRole('link', { name: 'Ayarlar' })).toHaveAttribute('href', '#/ayarlar');
  });

  it('marks only the selected item with aria-current="page"', async () => {
    await renderMenu(<Menu items={nav} selectedKey="alimlar" />);
    const selected = screen.getByRole('link', { name: /Alımlar ve eşyalar/ });
    expect(selected).toHaveAttribute('aria-current', 'page');
    expect(selected.closest('[role="menuitem"]')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Genel durum' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Ayarlar' })).not.toHaveAttribute('aria-current');
    expect(screen.getAllByRole('menuitem').filter(item => item.getAttribute('aria-current') === 'page')).toHaveLength(1);
  });

  it('opens external links in a new tab with the hidden note and the external icon', async () => {
    await renderMenu(<Menu items={nav} />);
    const link = screen.getByRole('link', { name: 'E-tabloyu aç (yeni sekmede açılır)' });
    expect(link).toHaveAttribute('href', 'https://example.invalid/sheet');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')?.split(/\s+/)).toContain('noopener');
    expect(link.querySelector('[data-icon="external"]')).not.toBeNull();
    expect(link.querySelector('[data-icon="sheet"]')).not.toBeNull();
  });

  it('keeps internal links in the same tab', async () => {
    await renderMenu(<Menu items={nav} />);
    const link = screen.getByRole('link', { name: 'Genel durum' });
    expect(link).not.toHaveAttribute('target');
    expect(link).not.toHaveAttribute('rel');
    expect(link).toHaveAccessibleName('Genel durum');
  });

  it('shows the count as a tr-TR number next to the label without cutting the label', async () => {
    await renderMenu(<Menu items={nav} />);
    const link = screen.getByRole('link', { name: /Alımlar ve eşyalar/ });
    expect(link).toHaveTextContent('Alımlar ve eşyalar');
    expect(link).toHaveTextContent('1.250');
    expect(screen.getByRole('link', { name: 'Genel durum' })).not.toHaveTextContent(/\d/);
  });

  it('renders a divider as a separator', async () => {
    await renderMenu(<Menu items={nav} />);
    expect(screen.getAllByRole('separator')).toHaveLength(1);
  });

  it('disables an item with aria-disabled and drops its href', async () => {
    await renderMenu(<Menu items={nav} />);
    const item = screen.getByRole('menuitem', { name: 'Veri kalitesi ve içe aktarma' });
    expect(item).toHaveAttribute('aria-disabled', 'true');
    expect(within(item).queryByRole('link')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Veri kalitesi ve içe aktarma' })).toBeNull();
  });

  it('calls onSelect with the key when an action item is clicked, not for disabled items', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    await renderMenu(<Menu items={actions} onSelect={onSelect} />);
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
    await renderMenu(<Menu items={nav} onSelect={onSelect} />);
    await user.click(screen.getByRole('link', { name: 'Ayarlar' }));
    expect(onSelect).toHaveBeenCalledWith('ayarlar');
  });

  it('is reachable with Tab on the items, not on the list itself, and activates with Enter and Space', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    await renderMenu(<Menu items={actions} onSelect={onSelect} />);
    expect(screen.getByRole('menu')).toHaveAttribute('tabindex', '-1');
    await user.tab();
    const first = screen.getByRole('menuitem', { name: 'Düzenle' });
    expect(first).toHaveFocus();
    // antd Enter'ı keyCode 13 ile tanır (tarayıcılar gönderir); user-event keyCode vermez, bu yüzden doğrudan olay.
    fireEvent.keyDown(first, { key: 'Enter', code: 'Enter', keyCode: 13 });
    expect(onSelect).toHaveBeenLastCalledWith('duzenle');
    await user.tab();
    expect(screen.getByRole('menuitem', { name: 'CSV indir' })).toHaveFocus();
    await user.keyboard(' ');
    expect(onSelect).toHaveBeenLastCalledWith('indir');
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('menuitem', { name: 'Sil' })).not.toHaveAttribute('tabindex', '0');
  });

  it('puts the selected action item in the tab order too', async () => {
    const user = userEvent.setup();
    await renderMenu(<Menu items={actions} selectedKey="indir" />);
    await user.tab();
    expect(screen.getByRole('menuitem', { name: 'Düzenle' })).toHaveFocus();
    await user.tab();
    const selected = screen.getByRole('menuitem', { name: 'CSV indir' });
    expect(selected).toHaveFocus();
    expect(selected).toHaveAttribute('aria-current', 'page');
  });

  it('marks the nav variant on the root for the lacivert surface', async () => {
    await renderMenu(<Menu items={nav} variant="nav" label="Sayfalar" />);
    const menu = screen.getByRole('menu', { name: 'Sayfalar' });
    expect(menu).toHaveClass('aile-menu');
    expect(menu).toHaveAttribute('data-variant', 'nav');
  });

  it('has no variant attribute on the light surface', async () => {
    await renderMenu(<Menu items={actions} className="deneme" />);
    const menu = screen.getByRole('menu');
    expect(menu).not.toHaveAttribute('data-variant');
    expect(menu).toHaveClass('aile-menu', 'deneme');
  });

  it('uses only design tokens in its stylesheet and no icon package other than Phosphor via ./icons', () => {
    const source = readFileSync(resolve(__dirname, 'Menu.tsx'), 'utf8');
    const css = readFileSync(resolve(__dirname, 'Menu.css'), 'utf8');
    expect(source).not.toContain('@ant-design/icons');
    expect(source).not.toContain('@phosphor-icons');
    expect(source).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/\boutline\s*:\s*(?!none)/);
    expect(css).not.toMatch(/box-shadow\s*:/);
  });
});
