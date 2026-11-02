import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { importsOf } from '../adaptive/sourceRules';
import { Icon, ICON_NAMES, ICON_SIZE, preloadIcons, type IconName } from './icons';

// Tasarım README › İkonografi: Aile.Icon adları + P0b ekleri (calendar, undo, compare). Phosphor, regular, 20 px.
// Simgeler tek tek (dist/csr/<Ad>) içe aktarılır; paket barrel'ı (3000+ simge) ve antd/@ant-design hiç yoktur. Telefon
// statik kapanışı yalnız ilk rotanın (Genel durum) çizdiği çekirdek simgeleri taşır (icons.tsx); kalanlar icons.extra.tsx
// parçasındadır ve ilk gerektiğinde (ya da rota yükleyicisiyle sayfa parçasına paralel) iner.
const designNames: readonly IconName[] = [
  'menu', 'close', 'search', 'filter', 'refresh', 'chevronDown', 'chevronRight', 'back', 'check', 'plus', 'download',
  'more', 'alert', 'info', 'imageOff', 'sheet', 'settings', 'external', 'sort', 'edit', 'calendar', 'undo', 'compare',
];

const source = readFileSync(resolve(__dirname, 'icons.tsx'), 'utf8');
const extraSource = readFileSync(resolve(__dirname, 'icons.extra.tsx'), 'utf8');
/** Telefon ilk rotasının (Genel durum: sayfa, akordeon, durum satırı, hata) çizdiği simgeler. */
const coreNames: readonly IconName[] = ['refresh', 'chevronDown', 'chevronRight', 'check', 'alert', 'sheet'];

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
    // Çekirdek (icons.tsx) + çekirdek dışı (icons.extra.tsx) birlikte tasarımdaki 23 simgeyi taşır; her biri tek tek ve statik.
    const values = [source, extraSource].flatMap(text => importsOf(text).filter(ref => ref.specifier.startsWith('@phosphor-icons/') && !ref.typeOnly));
    expect(values).toHaveLength(designNames.length);
    expect(new Set(values.map(ref => ref.specifier)).size).toBe(designNames.length);
    for (const ref of values) {
      expect(ref.kind).toBe('static');
      expect(ref.specifier).toMatch(/^@phosphor-icons\/react\/dist\/csr\/[A-Z][A-Za-z]*$/);
    }
    for (const text of [source, extraSource]) {
      expect(importsOf(text).map(ref => ref.specifier)).not.toContain('@phosphor-icons/react');
      expect(text).not.toMatch(/from\s+['"]@phosphor-icons\/react['"]/);
    }
  });

  it('phone delivery: icons.tsx statically carries only the first-route (core) glyphs; the rest load via one dynamic import', () => {
    const coreImports = importsOf(source).filter(ref => ref.specifier.startsWith('@phosphor-icons/') && !ref.typeOnly);
    expect(coreImports).toHaveLength(coreNames.length);
    const local = importsOf(source).filter(ref => ref.specifier === './icons.extra');
    expect(local.filter(ref => ref.kind === 'static' && !ref.typeOnly)).toEqual([]);
    expect(local.filter(ref => ref.kind === 'dynamic')).toHaveLength(1);
  });

  it.each(coreNames)('core %s renders its glyph synchronously (no placeholder on the first route)', name => {
    const markup = renderToStaticMarkup(<Icon name={name} />);
    expect(markup).toMatch(/<svg[^>]*data-icon="[A-Za-z]+"[^>]*>.+<\/svg>$/);
  });

  it('a non-core icon keeps the same box and accessible name before its chunk arrives, then fills in', async () => {
    const { container } = render(<Icon name="close" label="Kapat" size={24} />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('width', '24');
    expect(svg).toHaveAttribute('height', '24');
    expect(svg).toHaveAttribute('viewBox', '0 0 256 256');
    expect(svg).toHaveAttribute('fill', 'currentColor');
    expect(svg).toHaveAttribute('data-icon', 'close');
    expect(screen.getByRole('img', { name: 'Kapat' })).toBe(svg);
    await preloadIcons();
    await screen.findByRole('img', { name: 'Kapat' });
    await vi.waitFor(() => expect(container.querySelector('svg')!.childElementCount).toBeGreaterThan(0));
    const loaded = container.querySelector('svg')!;
    expect(loaded).toHaveAttribute('width', '24');
    expect(loaded).toHaveAttribute('data-icon', 'close');
    // Parça geldikten sonra aynı simge eşzamanlı (boşluksuz) çizilir.
    expect(renderToStaticMarkup(<Icon name="close" />)).toMatch(/<path /);
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
