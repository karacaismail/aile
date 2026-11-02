import { render, screen } from '@testing-library/react';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { LoadingShell } from './LoadingShell';

// Tasarım › Loading: aynı yerleşimde iskelet + üstte tek ince şerit; döner simge ve tam sayfa örtü yok.
// Seçiciler role/metin ve bileşenin kendi data-part sözleşmesi üzerinden; antd iç sınıfı yok.
const readCss = () => readFileSync(resolve(__dirname, 'LoadingShell.css'), 'utf8');

describe('LoadingShell', () => {
  it('announces loading politely and marks the region busy', () => {
    render(<LoadingShell />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(status).toHaveTextContent('Yükleniyor');
    expect(status.querySelector('[data-stub]')).toBeNull();
  });

  it('announces the given label instead of the default', () => {
    render(<LoadingShell label="Alımlar okunuyor" />);
    expect(screen.getByRole('status')).toHaveTextContent('Alımlar okunuyor');
    expect(screen.queryByText('Yükleniyor')).toBeNull();
  });

  it('renders three placeholder rows by default, all hidden from assistive technology', () => {
    render(<LoadingShell />);
    const status = screen.getByRole('status');
    const rows = status.querySelectorAll('[data-part="row"]');
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('renders the requested number of rows', () => {
    render(<LoadingShell rows={5} />);
    expect(screen.getByRole('status').querySelectorAll('[data-part="row"]')).toHaveLength(5);
  });

  it('falls back to three rows when rows is not a positive count', () => {
    const { rerender } = render(<LoadingShell rows={0} />);
    expect(screen.getByRole('status').querySelectorAll('[data-part="row"]')).toHaveLength(3);
    rerender(<LoadingShell rows={-2} />);
    expect(screen.getByRole('status').querySelectorAll('[data-part="row"]')).toHaveLength(3);
  });

  it('shows exactly one decorative strip above the rows', () => {
    render(<LoadingShell />);
    const status = screen.getByRole('status');
    const strips = status.querySelectorAll('[data-part="strip"]');
    expect(strips).toHaveLength(1);
    expect(strips[0]).toHaveAttribute('aria-hidden', 'true');
    const rows = status.querySelector('[data-part="rows"]');
    expect(rows).not.toBeNull();
    expect(strips[0].compareDocumentPosition(rows!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('shows no digits, spinner or image while loading', () => {
    render(<LoadingShell rows={4} />);
    const status = screen.getByRole('status');
    expect(status.textContent).not.toMatch(/\d/);
    expect(status.querySelector('img, svg')).toBeNull();
    expect(status.querySelectorAll('[aria-hidden="true"] *').length).toBeGreaterThan(0);
  });

  it('switches between the wide and narrow row layouts', () => {
    const { rerender } = render(<LoadingShell />);
    expect(screen.getByRole('status')).toHaveAttribute('data-layout', 'wide');
    rerender(<LoadingShell narrow />);
    expect(screen.getByRole('status')).toHaveAttribute('data-layout', 'narrow');
  });

  it('keeps a photo slot and text blocks in every row for both layouts', () => {
    const { rerender } = render(<LoadingShell rows={1} />);
    let row = screen.getByRole('status').querySelector('[data-part="row"]')!;
    expect(row.querySelectorAll('[data-part="photo"]')).toHaveLength(1);
    expect(row.querySelectorAll('[data-part="block"]').length).toBeGreaterThanOrEqual(2);
    rerender(<LoadingShell rows={1} narrow />);
    row = screen.getByRole('status').querySelector('[data-part="row"]')!;
    expect(row.querySelectorAll('[data-part="photo"]')).toHaveLength(1);
    expect(row.querySelectorAll('[data-part="block"]').length).toBeGreaterThanOrEqual(2);
  });

  describe('stylesheet', () => {
    it('keeps the strip still under reduced motion', () => {
      const css = readCss();
      expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
      expect(css).toMatch(/animation:\s*none/);
    });

    it('takes colour, radius and easing only from --aile tokens', () => {
      const css = readCss();
      expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(css).not.toMatch(/\brgba?\(/);
      expect(css).toMatch(/var\(--aile-liste-zemin\)/);
      expect(css).toMatch(/var\(--aile-eylem\)/);
      expect(css).toMatch(/var\(--aile-egri\)/);
      expect(css).toMatch(/var\(--aile-kose-kart\)/);
    });

    it('draws no ring, outline or shadow', () => {
      const css = readCss();
      expect(css).not.toMatch(/outline|box-shadow/);
    });
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

describe('LoadingShell — phone delivery and narrow containers', () => {
  const css = () => readCss().replace(/\/\*[\s\S]*?\*\//g, '');

  it('phone presentation has no antd: no antd, @ant-design/* or ui/antd.ts in its static import closure', () => {
    const { files, packages } = staticClosure(resolve(__dirname, 'LoadingShell.tsx'));
    expect(packages.filter(spec => ANTD.test(spec))).toEqual([]);
    expect(files).not.toContain(resolve(__dirname, 'antd.ts'));
    expect(files.filter(file => /\.wide\.|[\\/]wide[\\/]/.test(file))).toEqual([]);
  });

  it('a wide skeleton in a phone-width container collapses to photo + text (container query), so it never clips or overflows', () => {
    const sheet = css();
    expect(sheet).toMatch(/\.aile-loading\s*\{[^}]*container-type:\s*inline-size/);
    const query = sheet.match(/@container\s*\(max-width:\s*(\d+)px\)\s*\{([\s\S]*?)\n\}/);
    expect(query).not.toBeNull();
    expect(Number(query![1])).toBeGreaterThanOrEqual(428);
    expect(query![2]).toMatch(/\.aile-loading-satir\s*\{[^}]*grid-template-columns:\s*var\(--aile-fotograf-liste\) minmax\(0, 1fr\)/);
    expect(query![2]).toMatch(/\.aile-loading-blok--tutar,\s*\.aile-loading-ok\s*\{[^}]*display:\s*none/);
  });

  it('the strip is the one declared motion exception (indeterminate loop, not a state change); nothing else opts out', () => {
    render(<LoadingShell rows={2} />);
    const status = screen.getByRole('status');
    const exempt = status.querySelectorAll('[data-allow-motion]');
    expect(exempt).toHaveLength(1);
    expect(exempt[0]).toHaveAttribute('data-part', 'strip');
    // Döngü süresi merkezi süre tokenından, eğri tek eğri tokenından türetilir.
    expect(css()).toMatch(/--aile-loading-sure:\s*calc\(var\(--aile-sure\) \* \d+\)/);
    expect(css()).toMatch(/animation:\s*aile-loading-ilerle var\(--aile-loading-sure\) var\(--aile-egri\) infinite/);
  });

  it('only the single strip moves; skeleton blocks never shimmer', () => {
    const sheet = css();
    const animated = [...sheet.matchAll(/([^{}]+)\{[^}]*\banimation(?:-name)?:(?!\s*none\b)[^;}]+/g)].map(([, selector]) => selector.trim());
    expect(animated).toEqual(['.aile-loading-serit > span']);
  });

  it('stays busy while the strip is still under reduced motion: aria-busy remains, only the movement stops', () => {
    render(<LoadingShell narrow />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    expect(css()).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.aile-loading-serit > span\s*\{[^}]*animation:\s*none/);
  });
});

