import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Tone } from '../shell/contracts';
import { Tag } from './Tag';

// Tasarım: components/Tag/README.md + index.d.ts TagProps. Durum etiketi sözcükle (5 ton), seçilebilir (aria-pressed),
// kaldırılabilir (44 px kaldır düğmesi). Seçiciler role/label ile; antd iç sınıfı yok.
const tones: readonly Tone[] = ['notr', 'bilgi', 'olumlu', 'uyari', 'hata'];

describe('Tag — durum etiketi', () => {
  it('metni gösterir ve ton verilmezse notr işaretler', () => {
    render(<Tag>Ödendi</Tag>);
    const root = screen.getByText('Ödendi').closest('[data-tone]');
    expect(root).toHaveAttribute('data-tone', 'notr');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it.each(tones)('tone=%s data-tone olarak çıkar', tone => {
    const { unmount } = render(<Tag tone={tone}>Durum</Tag>);
    expect(screen.getByText('Durum').closest('[data-tone]')).toHaveAttribute('data-tone', tone);
    unmount();
  });

  it('simgeyi süsleyici olarak metnin yanına koyar', () => {
    const { container } = render(<Tag icon="check">Teslim alındı</Tag>);
    const svg = container.querySelector('svg[data-icon="check"]');
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('Teslim alındı')).toBeInTheDocument();
  });
});

describe('Tag — seçilebilir (interactive)', () => {
  it('aria-pressed taşıyan bir düğmedir ve tıklamada onClick çağırır', async () => {
    const onClick = vi.fn();
    render(<Tag interactive onClick={onClick}>Mutfak</Tag>);
    const button = screen.getByRole('button', { name: 'Mutfak', pressed: false });
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('selected iken pressed=true olur', () => {
    render(<Tag interactive selected>Mutfak</Tag>);
    expect(screen.getByRole('button', { name: 'Mutfak', pressed: true })).toBeInTheDocument();
  });

  it('klavyede Enter ve Space ile seçilir', async () => {
    const onClick = vi.fn();
    render(<Tag interactive onClick={onClick}>Mutfak</Tag>);
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Mutfak' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard(' ');
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('disabled iken tıklama onClick çağırmaz ve aria-disabled taşır', async () => {
    const onClick = vi.fn();
    render(<Tag interactive disabled onClick={onClick}>Mutfak</Tag>);
    const button = screen.getByRole('button', { name: 'Mutfak' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('Tag — kaldırılabilir (removable)', () => {
  it('kaldır düğmesi "{metin} filtresini kaldır" diye adlanır ve tıklamada onRemove çağırır', async () => {
    const onRemove = vi.fn();
    render(<Tag removable onRemove={onRemove}>Mutfak</Tag>);
    await userEvent.click(screen.getByRole('button', { name: 'Mutfak filtresini kaldır' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
    // Görünürlük üst bileşenin kararıdır; etiket kendi kendini gizlemez.
    expect(screen.getByText('Mutfak')).toBeInTheDocument();
  });

  it('kaldır düğmesi klavyeden Enter ile çalışır', async () => {
    const onRemove = vi.fn();
    render(<Tag removable onRemove={onRemove}>Mutfak</Tag>);
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Mutfak filtresini kaldır' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('metin olmayan children için label ile adlanır', () => {
    render(<Tag removable label="Oda: Mutfak"><strong>Oda:</strong> Mutfak</Tag>);
    expect(screen.getByRole('button', { name: 'Oda: Mutfak filtresini kaldır' })).toBeInTheDocument();
  });

  it('disabled iken kaldırma çalışmaz', async () => {
    const onRemove = vi.fn();
    render(<Tag removable disabled onRemove={onRemove}>Mutfak</Tag>);
    const button = screen.getByRole('button', { name: 'Mutfak filtresini kaldır' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(button);
    expect(onRemove).not.toHaveBeenCalled();
  });
});

describe('Tag — eksik bilgi', () => {
  it('boş durum etiketi rengiyle anlam taşımaz: "Bilinmiyor" yazar ve nötr tona döner', () => {
    const { rerender } = render(<Tag tone="olumlu">{'   '}</Tag>);
    expect(screen.getByText('Bilinmiyor').closest('[data-tone]')).toHaveAttribute('data-tone', 'notr');
    rerender(<Tag tone="hata">{null}</Tag>);
    expect(screen.getByText('Bilinmiyor').closest('[data-tone]')).toHaveAttribute('data-tone', 'notr');
  });
});

describe('Tag — yerel düğme, klavye ve dokunma', () => {
  it('seçilebilir etiket yerel <button type="button"> ve ortak odak çizgisi kancasını taşır', () => {
    render(<Tag interactive>Mutfak</Tag>);
    const button = screen.getByRole('button', { name: 'Mutfak', pressed: false });
    expect(button.tagName).toBe('BUTTON');
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveAttribute('data-focus-line');
  });

  it('devre dışı seçilebilir etiket yerel olarak devre dışıdır (sekme sırasından çıkar)', async () => {
    render(<><Tag interactive disabled>Mutfak</Tag><button type="button">Sonraki</button></>);
    expect(screen.getByRole('button', { name: 'Mutfak' })).toBeDisabled();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Sonraki' })).toHaveFocus();
  });

  it('Tab / Shift+Tab seçilebilir etiketler arasında gezinir; basılı tutulan Enter yalnız bir kez değiştirir', async () => {
    const onClick = vi.fn();
    render(<><Tag interactive onClick={onClick}>Mutfak</Tag><Tag interactive>Salon</Tag></>);
    const user = userEvent.setup();
    await user.tab();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Salon' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Mutfak' })).toHaveFocus();
    await user.keyboard('{Enter>4/}');
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('Escape seçimi değiştirmez', async () => {
    const onClick = vi.fn();
    render(<Tag interactive onClick={onClick}>Mutfak</Tag>);
    await userEvent.tab();
    await userEvent.keyboard('{Escape}');
    expect(onClick).not.toHaveBeenCalled();
  });

  it('dokunma iptal edilince (pointercancel) seçim değişmez; tamamlanan dokunma bir kez değiştirir', async () => {
    const onClick = vi.fn();
    render(<Tag interactive onClick={onClick}>Mutfak</Tag>);
    const button = screen.getByRole('button', { name: 'Mutfak' });
    fireEvent.pointerDown(button, { pointerType: 'touch', isPrimary: true });
    fireEvent.pointerCancel(button, { pointerType: 'touch', isPrimary: true });
    expect(onClick).not.toHaveBeenCalled();
    await userEvent.setup().pointer({ keys: '[TouchA]', target: button });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('kaldır düğmesi yerel <button type="button">; dokunma iptali kaldırmaz', async () => {
    const onRemove = vi.fn();
    render(<Tag removable onRemove={onRemove}>Mutfak</Tag>);
    const remove = screen.getByRole('button', { name: 'Mutfak filtresini kaldır' });
    expect(remove.tagName).toBe('BUTTON');
    expect(remove).toHaveAttribute('type', 'button');
    expect(remove).toHaveAttribute('data-focus-line');
    fireEvent.pointerDown(remove, { pointerType: 'touch', isPrimary: true });
    fireEvent.pointerCancel(remove, { pointerType: 'touch', isPrimary: true });
    expect(onRemove).not.toHaveBeenCalled();
    await userEvent.setup().pointer({ keys: '[TouchA]', target: remove });
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('kaldır düğmesi Space ile de çalışır, devre dışıyken yerel olarak devre dışıdır', async () => {
    const onRemove = vi.fn();
    const { rerender } = render(<Tag removable onRemove={onRemove}>Mutfak</Tag>);
    await userEvent.tab();
    await userEvent.keyboard(' ');
    expect(onRemove).toHaveBeenCalledTimes(1);
    rerender(<Tag removable disabled onRemove={onRemove}>Mutfak</Tag>);
    expect(screen.getByRole('button', { name: 'Mutfak filtresini kaldır' })).toBeDisabled();
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

describe('Tag — kaynak kuralları', () => {
  const read = (name: string) => readFileSync(resolve(__dirname, name), 'utf8');

  it('telefon sunumu antd içermez: statik kapanışta antd, @ant-design/* ya da ui/antd.ts yok; simge yalnız ./icons', () => {
    const { files, packages } = staticClosure(resolve(__dirname, 'Tag.tsx'));
    expect(packages.filter(spec => ANTD.test(spec))).toEqual([]);
    expect(files).not.toContain(resolve(__dirname, 'antd.ts'));
    expect(files.filter(file => /\.wide\.|[\\/]wide[\\/]/.test(file))).toEqual([]);
    expect(packages).not.toContain('echarts');
    const tsx = read('Tag.tsx');
    expect(tsx).not.toContain('@phosphor-icons');
    expect(tsx).toMatch(/from ['"]\.\/icons['"]/);
  });

  it('bileşen içinde sabit renk yoktur; renk ve ölçüler --aile tokenlarından gelir', () => {
    const tsx = read('Tag.tsx');
    const css = read('Tag.css');
    expect(tsx).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/rgba?\(/);
    expect(css).toContain('var(--aile-dokunma-hedefi)');
    expect(css).toContain('var(--aile-kose-kontrol)');
    expect(css).toContain('var(--aile-sure)');
    expect(css).toContain('var(--aile-egri)');
    for (const tone of ['bilgi', 'olumlu', 'uyari', 'hata']) {
      expect(css, tone).toContain(`[data-tone='${tone}']`);
      expect(css, tone).toContain(`var(--aile-${tone}-yuzey)`);
    }
  });

  // Hedef tek kaynaktan gelir: --aile-dokunma-hedefi (admin.css / tokens.ts targetTokens: 44, data-input-coarse
  // katmanında 48); bileşen coarse değerini kendisi türetmez.
  it('dokunma hedefi tek tokendan: seçilebilir etiket, kaldırılabilir etiket ve kare kaldır düğmesi 44, coarse girişte 48 px', () => {
    const css = read('Tag.css').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).toMatch(/\.aile-tag--btn\s*\{[^}]*min-height:\s*var\(--aile-dokunma-hedefi\)/);
    expect(css).toMatch(/\.aile-tag--removable\s*\{[^}]*min-height:\s*var\(--aile-dokunma-hedefi\)/);
    expect(css).toMatch(/\.aile-tag-kaldir\s*\{[^}]*width:\s*var\(--aile-dokunma-hedefi\)/);
    expect(css).toMatch(/\.aile-tag-kaldir\s*\{[^}]*height:\s*var\(--aile-dokunma-hedefi\)/);
    expect(css).not.toMatch(/\[data-input-coarse\]/);
    expect(css).not.toContain('var(--aile-hedef-asgari) + var(--aile-bosluk-1)');
  });

  it('metin 14 CSS px altına inmez; odak için halka/outline/box-shadow yoktur; reduced-motion geçişi kapatır', () => {
    const css = read('Tag.css');
    const sizes = [...css.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map(m => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(0);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(14);
    expect(css).not.toMatch(/outline\s*:(?!\s*none)/);
    expect(css).not.toMatch(/box-shadow\s*:(?!\s*none)/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*transition-duration:\s*0s/);
  });
});
