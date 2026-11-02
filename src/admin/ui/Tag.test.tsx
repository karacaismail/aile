import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

describe('Tag — kaynak kuralları', () => {
  const read = (name: string) => readFileSync(resolve(__dirname, name), 'utf8');

  it('antd yalnız ./antd üzerinden, simge yalnız ./icons üzerinden gelir', () => {
    const tsx = read('Tag.tsx');
    expect(tsx).toMatch(/from ['"]\.\/antd['"]/);
    expect(tsx).not.toMatch(/from ['"]antd['"]/);
    expect(tsx).not.toContain('@ant-design/icons');
    expect(tsx).not.toContain('@phosphor-icons');
  });

  it('bileşen içinde sabit renk yoktur; renk ve ölçüler --aile tokenlarından gelir', () => {
    const tsx = read('Tag.tsx');
    const css = read('Tag.css');
    expect(tsx).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).toContain('var(--aile-hedef-asgari)');
    expect(css).toContain('var(--aile-kose-kontrol)');
    expect(css).toContain('var(--aile-sure)');
    expect(css).toContain('var(--aile-egri)');
  });

  it('metin 14 CSS px altına inmez; odak için halka/outline/box-shadow yoktur', () => {
    const css = read('Tag.css');
    const sizes = [...css.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map(m => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(0);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(14);
    expect(css).not.toMatch(/outline\s*:(?!\s*none)/);
    expect(css).not.toMatch(/box-shadow\s*:(?!\s*none)/);
  });
});
