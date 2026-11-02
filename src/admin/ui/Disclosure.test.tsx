import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Disclosure } from './Disclosure';

// Tasarım › components/Disclosure/README.md: başlıkla açılıp kapanan bölüm; başlık 44 px / 600, sayım kapalıyken de
// görünür, ok ve içerik 240 ms tek eğriyle. Burada: düğme (aria-expanded/controls) + bölge (hidden+inert kapalıyken),
// defaultOpen/open/onToggle, Enter/Space, disabled, kapanışta odak başlığa döner. antd Collapse yok.
const read = (file: string) => readFileSync(resolve(__dirname, file), 'utf8');
const header = (name = 'Oda') => screen.getByRole('button', { name: new RegExp(`^${name}`) });
const regionOf = (button: HTMLElement) => {
  const id = button.getAttribute('aria-controls');
  expect(id).toBeTruthy();
  const region = document.getElementById(id!);
  expect(region).not.toBeNull();
  return region!;
};

describe('Disclosure', () => {
  it('kapalı başlar: aria-expanded=false, bölge hidden+inert, sayım görünür', () => {
    render(<Disclosure title="Oda" meta="2 seçili"><p>Salon</p></Disclosure>);
    const button = header();
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    const region = regionOf(button);
    expect(region).toHaveAttribute('role', 'region');
    expect(region).toHaveAttribute('aria-labelledby', button.id);
    expect(region).toHaveAttribute('hidden');
    expect(region).toHaveAttribute('inert');
    expect(screen.getByText('2 seçili')).toBeVisible();
    expect(screen.getByText('Salon')).not.toBeVisible();
  });

  it('defaultOpen ile açık başlar: bölge görünür, inert değil', () => {
    render(<Disclosure title="Oda" defaultOpen><p>Salon</p></Disclosure>);
    const button = header();
    expect(button).toHaveAttribute('aria-expanded', 'true');
    const region = regionOf(button);
    expect(region).not.toHaveAttribute('hidden');
    expect(region).not.toHaveAttribute('inert');
    expect(screen.getByText('Salon')).toBeVisible();
  });

  it('tıklama açar ve kapatır; onToggle yeni durumu alır', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<Disclosure title="Oda" onToggle={onToggle}><p>Salon</p></Disclosure>);
    const button = header();
    const region = regionOf(button);

    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(region).not.toHaveAttribute('hidden');
    expect(region).not.toHaveAttribute('inert');
    expect(onToggle).toHaveBeenLastCalledWith(true);

    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(region).toHaveAttribute('hidden');
    expect(region).toHaveAttribute('inert');
    expect(onToggle).toHaveBeenLastCalledWith(false);
    expect(onToggle).toHaveBeenCalledTimes(2);
  });

  it('klavyede Enter açar, Space kapatır', async () => {
    const user = userEvent.setup();
    render(<Disclosure title="Oda"><p>Salon</p></Disclosure>);
    const button = header();
    button.focus();
    await user.keyboard('{Enter}');
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(regionOf(button)).not.toHaveAttribute('hidden');
    await user.keyboard('[Space]');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(regionOf(button)).toHaveAttribute('hidden');
  });

  it('APG disclosure: oklar, Home/End ve Escape durumu değiştirmez; odak başlıkta kalır', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<Disclosure title="Oda" onToggle={onToggle}><p>Salon</p></Disclosure>);
    const button = header();
    button.focus();
    await user.keyboard('{ArrowDown}{ArrowUp}{ArrowRight}{ArrowLeft}{Home}{End}{Escape}');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(regionOf(button)).toHaveAttribute('hidden');
    expect(button).toHaveFocus();
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('open verildiğinde kontrollüdür: tıklama yalnız onToggle çağırır, durum dışarıdan değişir', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const { rerender } = render(<Disclosure title="Oda" open={false} onToggle={onToggle}><p>Salon</p></Disclosure>);
    const button = header();
    await user.click(button);
    expect(onToggle).toHaveBeenCalledWith(true);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(regionOf(button)).toHaveAttribute('hidden');

    rerender(<Disclosure title="Oda" open onToggle={onToggle}><p>Salon</p></Disclosure>);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(regionOf(button)).not.toHaveAttribute('hidden');
    expect(regionOf(button)).not.toHaveAttribute('inert');
  });

  it('disabled: düğme devre dışı, tıklama durumu değiştirmez; sayım yine görünür', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<Disclosure title="Oda" meta="Henüz yok" disabled onToggle={onToggle}><p>Salon</p></Disclosure>);
    const button = header();
    expect(button).toBeDisabled();
    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(onToggle).not.toHaveBeenCalled();
    expect(screen.getByText('Henüz yok')).toBeVisible();
  });

  it('ok simgesi düğmenin içinde ve süsleyicidir; odak çizgisini admin.css çizer (data-focus-line)', () => {
    render(<Disclosure title="Oda"><p>Salon</p></Disclosure>);
    const button = header();
    const chevron = button.querySelector('svg[data-icon="chevronDown"]');
    expect(chevron).not.toBeNull();
    expect(chevron).toHaveAttribute('aria-hidden', 'true');
    expect(button).toHaveAttribute('data-focus-line');
  });

  it('dışarıdan kapatılırken odak içerideyse başlığa döner', () => {
    const { rerender } = render(<Disclosure title="Oda" open><button type="button">Temizle</button></Disclosure>);
    const inner = screen.getByRole('button', { name: 'Temizle' });
    inner.focus();
    expect(inner).toHaveFocus();
    rerender(<Disclosure title="Oda" open={false}><button type="button">Temizle</button></Disclosure>);
    expect(header()).toHaveFocus();
  });

  it('antd Collapse kullanmaz; CSS tokenlardan beslenir, halka/outline yoktur', () => {
    const tsx = read('Disclosure.tsx');
    expect(tsx).not.toMatch(/import[^;]*\bCollapse\b|<Collapse\b/);
    expect(tsx).not.toMatch(/from\s+['"]antd/);
    expect(tsx).toContain("import './Disclosure.css'");

    const css = read('Disclosure.css');
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/^\s*(outline|box-shadow)\s*:/m);
    expect(css).toMatch(/var\(--aile-sure\)/);
    expect(css).toMatch(/var\(--aile-egri\)/);
    expect(css).toMatch(/var\(--aile-dokunma-hedefi\)/);
    expect(css).toMatch(/prefers-reduced-motion: reduce/);
    // Sabit px yok; tek istisna 1 px ayırıcı çizgi (cizgi).
    const fixedPx = (css.match(/\b\d+px\b/g) ?? []).filter(value => value !== '1px');
    expect(fixedPx).toEqual([]);
  });

  it('hover yalnız hover katmanında; başlık hedefi tek merkezi tokenla (--aile-dokunma-hedefi: 44, kaba girişte 48)', () => {
    const css = read('Disclosure.css').replace(/\/\*[\s\S]*?\*\//g, '');
    const hovers = [...css.matchAll(/([^{}]*:hover[^{}]*)\{/g)].map(m => m[1].trim());
    expect(hovers.length).toBeGreaterThan(0);
    for (const selector of hovers) expect(selector).toContain('[data-input-hover]');
    expect(css).toMatch(/\.aile-disc-btn \{[^}]*min-height: var\(--aile-dokunma-hedefi\);/);
    expect(css).not.toContain('--aile-hedef-asgari');
    expect(css).not.toMatch(/\[data-input-coarse\][^{]*\{[^}]*min-height/);
  });

  it('dokunma iptal olursa (pointercancel) durum değişmez; tamamlanan dokunma açar', async () => {
    render(<Disclosure title="Oda"><p>Salon</p></Disclosure>);
    const button = header();
    fireEvent.pointerDown(button, { pointerType: 'touch', isPrimary: true });
    fireEvent.pointerCancel(button, { pointerType: 'touch', isPrimary: true });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await userEvent.pointer([{ keys: '[TouchA>]', target: button }, { keys: '[/TouchA]', target: button }]);
    expect(button).toHaveAttribute('aria-expanded', 'true');
  });

  it('Tab/Shift+Tab başlıklar arasında gezer; kapalı bölgenin içeriği sekme sırasına girmez', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Disclosure title="Oda"><button type="button">Salon</button></Disclosure>
        <Disclosure title="Durum" defaultOpen><button type="button">Teslim alındı</button></Disclosure>
      </>,
    );
    await user.tab();
    expect(header('Oda')).toHaveFocus();
    await user.tab();
    expect(header('Durum')).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Teslim alındı' })).toHaveFocus();
    await user.tab({ shift: true });
    await user.tab({ shift: true });
    expect(header('Oda')).toHaveFocus();
  });
});
