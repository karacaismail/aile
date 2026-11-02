import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { StatusText } from './StatusText';
import type { Tone } from '../shell/contracts';

// Tasarım README › İçerik ilkeleri: "Durum her zaman sözcükle yazılır; renk yalnız destekler." Durum metni =
// süsleyici nokta (aria-hidden) + sözcük; ton yalnız rengi değiştirir, sözcük anlamı taşır.
const tones: readonly Tone[] = ['notr', 'bilgi', 'olumlu', 'uyari', 'hata'];

describe('StatusText', () => {
  it('writes the status word and exposes only the word to assistive technology', () => {
    const { container } = render(<StatusText label="Teslim alındı" tone="olumlu" />);
    const word = screen.getByText('Teslim alındı');
    expect(word).toBeInTheDocument();
    const root = container.firstElementChild as HTMLElement;
    expect(root.textContent).toBe('Teslim alındı');
    // Nokta süsleyicidir: aria-hidden, metin yok, anlam yok.
    const dot = root.querySelector('[aria-hidden="true"]');
    expect(dot).not.toBeNull();
    expect(dot).toHaveTextContent('');
    expect(dot).not.toHaveAttribute('role');
    // Durum metni canlı bölge değildir (satır başına bir durum; role="status" gürültü olur).
    expect(container.querySelector('[role]')).toBeNull();
  });

  it.each(tones)('carries tone %s on the root and keeps the dot before the word', tone => {
    const { container, unmount } = render(<StatusText label="Ödeme gecikti" tone={tone} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveAttribute('data-tone', tone);
    expect(root.className).toContain('aile-status');
    expect(root.firstElementChild).toHaveAttribute('aria-hidden', 'true');
    expect(root.lastElementChild).toHaveTextContent('Ödeme gecikti');
    unmount();
  });

  it('defaults to the neutral tone', () => {
    const { container } = render(<StatusText label="Henüz yok" />);
    expect(container.firstElementChild).toHaveAttribute('data-tone', 'notr');
  });

  it('names a missing status "Bilinmiyor" in the neutral tone instead of hiding it', () => {
    const { container } = render(<StatusText label="   " tone="olumlu" />);
    expect(screen.getByText('Bilinmiyor')).toBeInTheDocument();
    expect(container.firstElementChild).toHaveAttribute('data-tone', 'notr');
  });

  it('accepts the shared StatusLabel shape, an id and extra class names', () => {
    const status = { label: 'Ödendi', tone: 'olumlu' as Tone };
    const { container } = render(<StatusText {...status} id="durum-1" className="ek" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveAttribute('id', 'durum-1');
    expect(root.className.split(' ')).toContain('ek');
    expect(root.className).toContain('aile-status');
    expect(screen.getByText('Ödendi')).toBeInTheDocument();
  });

  it('styles only through --aile-* tokens: no literal colours or pixel sizes in its CSS', () => {
    const css = readFileSync(resolve(__dirname, 'StatusText.css'), 'utf8');
    expect(css).toContain('var(--aile-');
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/rgba?\(/);
    expect(css).not.toMatch(/[1-9][0-9]*(\.[0-9]+)?px/);
    expect(css).not.toMatch(/outline|box-shadow/);
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

describe('StatusText — phone delivery and tones', () => {
  it('phone presentation has no antd: no antd, @ant-design/* or ui/antd.ts in its static import closure', () => {
    const { files, packages } = staticClosure(resolve(__dirname, 'StatusText.tsx'));
    expect(packages.filter(spec => ANTD.test(spec))).toEqual([]);
    expect(files).not.toContain(resolve(__dirname, 'antd.ts'));
    expect(files.filter(file => /\.wide\.|[\\/]wide[\\/]/.test(file))).toEqual([]);
  });

  it('every non-neutral tone colours both the dot and the word from its --aile token; the word is always present', () => {
    const css = readFileSync(resolve(__dirname, 'StatusText.css'), 'utf8');
    const token: Record<Exclude<Tone, 'notr'>, string> = { bilgi: 'eylem', olumlu: 'olumlu', uyari: 'uyari', hata: 'hata' };
    for (const [tone, name] of Object.entries(token)) {
      expect(css, tone).toMatch(new RegExp(`\\.aile-status--${tone}\\s*\\{[^}]*--aile-status-ton:\\s*var\\(--aile-${name}\\)[^}]*color:\\s*var\\(--aile-${name}\\)`));
      const { unmount } = render(<StatusText label="Durum" tone={tone as Tone} />);
      expect(screen.getByText('Durum')).toBeInTheDocument();
      unmount();
    }
  });

  it('a tone change is an instant semantic update: no transition or animation in its stylesheet', () => {
    const css = readFileSync(resolve(__dirname, 'StatusText.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).not.toMatch(/transition|animation/);
  });
});

