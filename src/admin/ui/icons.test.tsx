import { render, screen } from '@testing-library/react';
import { Icon, ICON_NAMES, type IconName } from './icons';

// Tasarım README › İkonografi: Aile.Icon adları + P0b ekleri (calendar, undo, compare). Phosphor, regular, 20 px.
const designNames: readonly IconName[] = [
  'menu', 'close', 'search', 'filter', 'refresh', 'chevronDown', 'chevronRight', 'back', 'check', 'plus', 'download',
  'more', 'alert', 'info', 'imageOff', 'sheet', 'settings', 'external', 'sort', 'edit', 'calendar', 'undo', 'compare',
];

describe('Icon', () => {
  it('exposes exactly the design icon names', () => {
    expect([...ICON_NAMES].sort()).toEqual([...designNames].sort());
  });

  it.each(designNames)('renders %s as a decorative 20 px svg', name => {
    const { container, unmount } = render(<Icon name={name} />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).not.toHaveAttribute('role');
    expect(svg).toHaveAttribute('width', '20');
    expect(svg).toHaveAttribute('height', '20');
    expect(svg).toHaveAttribute('fill', 'currentColor');
    unmount();
  });

  it('becomes an accessible image only when a label is given', () => {
    render(<Icon name="alert" label="Uyarı" />);
    const svg = screen.getByRole('img', { name: 'Uyarı' });
    expect(svg).not.toHaveAttribute('aria-hidden');
  });

  it('accepts another size without changing the default', () => {
    const { container } = render(<Icon name="plus" size={24} />);
    expect(container.querySelector('svg')).toHaveAttribute('width', '24');
  });

  it('never imports @ant-design/icons', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve(__dirname, 'icons.tsx'), 'utf8');
    expect(source).not.toContain('@ant-design/icons');
    expect(source).toContain('@phosphor-icons/react');
  });

  // Bilinmeyen ad derleme hatasıdır (IconName birliği):
  // // @ts-expect-error — 'bilinmeyen' IconName değil
  // <Icon name="bilinmeyen" />
});
