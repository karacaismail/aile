import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { importsOf } from '../adaptive/sourceRules';
import { Icon, ICON_NAMES, ICON_SIZE, type IconName } from './icons';

// Tasarım README › İkonografi: Aile.Icon adları + P0b ekleri (calendar, undo, compare). Phosphor, regular, 20 px.
// Telefon statik kapanışı: icons.tsx her simgeyi tek tek (dist/csr/<Ad>) içe aktarır; paket barrel'ı (3000+ simge) ve
// antd/@ant-design hiç yoktur.
const designNames: readonly IconName[] = [
  'menu', 'close', 'search', 'filter', 'refresh', 'chevronDown', 'chevronRight', 'back', 'check', 'plus', 'download',
  'more', 'alert', 'info', 'imageOff', 'sheet', 'settings', 'external', 'sort', 'edit', 'calendar', 'undo', 'compare',
];

const source = readFileSync(resolve(__dirname, 'icons.tsx'), 'utf8');

describe('Icon', () => {
  it('exposes exactly the design icon names', () => {
    expect([...ICON_NAMES].sort()).toEqual([...designNames].sort());
  });

  it('exports the design icon size (20 px) as the single default size', () => {
    expect(ICON_SIZE).toBe(20);
  });

  it.each(designNames)('renders %s as a decorative 20 px svg', name => {
    const { container, unmount } = render(<Icon name={name} />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).not.toHaveAttribute('role');
    expect(svg).not.toHaveAttribute('aria-label');
    expect(svg).toHaveAttribute('width', String(ICON_SIZE));
    expect(svg).toHaveAttribute('height', String(ICON_SIZE));
    expect(svg).toHaveAttribute('fill', 'currentColor');
    expect(svg).toHaveAttribute('data-icon', name);
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

  it('imports each Phosphor glyph on its own (dist/csr/<Name>), never the package barrel', () => {
    const phosphor = importsOf(source).filter(ref => ref.specifier.startsWith('@phosphor-icons/'));
    const values = phosphor.filter(ref => !ref.typeOnly);
    expect(values).toHaveLength(designNames.length);
    for (const ref of values) {
      expect(ref.kind).toBe('static');
      expect(ref.specifier).toMatch(/^@phosphor-icons\/react\/dist\/csr\/[A-Z][A-Za-z]*$/);
    }
    expect(phosphor.map(ref => ref.specifier)).not.toContain('@phosphor-icons/react');
    expect(source).not.toMatch(/from\s+['"]@phosphor-icons\/react['"]/);
  });

  it('never imports antd, @ant-design/* or ./antd (phone static closure stays antd-free)', () => {
    const refs = importsOf(source).filter(ref => !ref.typeOnly);
    expect(refs.filter(ref => /^(antd|@ant-design)(\/|$)/.test(ref.specifier) || /(^|\/)antd(\.tsx?)?$/.test(ref.specifier))).toEqual([]);
    expect(source).not.toContain('@ant-design/icons');
  });

  // Bilinmeyen ad derleme hatasıdır (IconName birliği):
  // // @ts-expect-error — 'bilinmeyen' IconName değil
  // <Icon name="bilinmeyen" />
});
