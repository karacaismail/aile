// Clearspace standardı: ham boşluk, köşe ve yazı değerleri yalnız tokens.ts içinde yaşar.
// Bileşenler rol tokenı kullanır; köşe en çok 5 px, yazı en az 14 px.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { designTokens, tokens } from './dashboard/tokens';
import { theme } from './theme';

const SKIP = /node_modules|\.test\.|fixtures?\b|Fixtures?\./;
function walk(dir: string, ext: RegExp, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (SKIP.test(path)) continue;
    if (statSync(path).isDirectory()) walk(path, ext, out);
    else if (ext.test(name)) out.push(path);
  }
  return out;
}
// Yönetim paneli kendi --aile-* tokenlarını kullanır: köşe sınırı aşağıda token düzeyinde denetlenir.
const css = walk('src', /\.css$/).filter(path => !/src\/admin\//.test(path)).map(path => ({ path, text: readFileSync(path, 'utf8') }));
const code = walk('src', /\.tsx?$/).filter(path => !/src\/(theme|design\/tokens|dashboard\/tokens)\.ts$/.test(path)).map(path => ({ path, text: readFileSync(path, 'utf8') }));
const lineOf = (text: string, index: number) => text.slice(0, index).split('\n').length;

/** `16px`, `1rem` ya da `var(--budget-x)` değerini CSS px'e çevirir (kök 16 px). */
function px(value: string): number {
  const token = /^var\(--budget-(\w+)\)$/.exec(value.trim());
  if (token) return px(String(tokens[token[1] as keyof typeof tokens]));
  const clamp = /^clamp\(\s*([^,]+),/.exec(value.trim());
  if (clamp) return px(clamp[1]);
  const match = /^(-?\d*\.?\d+)(px|rem)$/.exec(value.trim());
  return match ? Number(match[1]) * (match[2] === 'rem' ? 16 : 1) : Number.NaN;
}
const SCALE = [4, 8, 12, 16, 24, 32, 40, 48];

describe('clearspace ölçeği', () => {
  it('boşluk tokenları yalnız 4 px tabanlı ölçekten gelir', () => {
    const spacing = Object.entries(tokens).filter(([key]) => /^(space|clear)/.test(key) || key === 'spacing');
    expect(spacing.length).toBeGreaterThan(10);
    expect(spacing.filter(([, value]) => !SCALE.includes(px(String(value)))).map(([key, value]) => `${key}: ${value}`)).toEqual([]);
  });

  it('roller içeriden dışarıya büyür: metin < kontrol < alan < iç boşluk ≤ kartlar arası < bölüm ≤ geniş sayfa kenarı', () => {
    const order = ['clearText', 'clearControl', 'clearField', 'clearInset', 'clearCards', 'clearSection', 'clearPageWide'] as const;
    const values = order.map(key => px(String(tokens[key])));
    expect(values).toEqual([4, 8, 12, 16, 16, 24, 32]);
    expect(px(String(tokens.clearPage))).toBe(16);
    expect(px(String(tokens.clearPageEnd))).toBe(32);
  });

  it('Mantine boşluk ölçeği aynı tokenlardan gelir', () => {
    expect(Object.values(theme.spacing ?? {}).map(value => px(String(value)))).toEqual([4, 8, 16, 24, 32]);
  });
});

describe('köşe', () => {
  it('her radius tokenı en çok 5 px', () => {
    const radii = Object.entries(tokens).filter(([key]) => /radius/i.test(key));
    expect(radii.map(([key]) => key).sort()).toEqual(['radius', 'radiusSmall']);
    expect(px(tokens.radius)).toBe(5);
    expect(px(tokens.radiusSmall)).toBeLessThan(px(tokens.radius));
    expect(Object.values(theme.radius ?? {}).filter(value => !(px(String(value)) <= 5))).toEqual([]);
    expect(px(String(theme.defaultRadius))).toBeLessThanOrEqual(5);
  });

  it('Mantine’in tam yuvarlak bileşenleri tema köşesini alır', () => {
    const components = theme.components as Record<string, { defaultProps?: { radius?: unknown }; styles?: { thumb?: { borderRadius?: unknown } } }>;
    const open = ['Badge', 'Chip', 'Indicator', 'Switch', 'Slider', 'RangeSlider', 'Stepper'].filter(name => components[name]?.defaultProps?.radius !== tokens.radius);
    expect(open).toEqual([]);
    expect(['Slider', 'RangeSlider'].filter(name => components[name]?.styles?.thumb?.borderRadius !== tokens.radius)).toEqual([]);
  });

  it('yönetim paneli köşe tokenları en çok 5 px', () => {
    expect([designTokens.koseKontrol, designTokens.koseKart, designTokens.kosePanel].filter(value => value > 5)).toEqual([]);
  });

  it('CSS köşeleri yalnız radius tokenlarını kullanır', () => {
    const allowed = /^(0|var\(--budget-radius(Small)?\)|var\(--mantine-radius-(xs|sm|md|lg|xl|default)\))$/;
    const hits = css.flatMap(({ path, text }) => [...text.matchAll(/border(?:-[a-z]+)*-radius\s*:\s*([^;}]+)/g)]
      .filter(match => !match[1].trim().split(/\s+/).every(part => allowed.test(part)))
      .map(match => `${path}:${lineOf(text, match.index!)} ${match[0].trim()}`));
    expect(hits).toEqual([]);
  });

  it('bileşen kodunda 5 px üstü köşe yok', () => {
    const hits = code.flatMap(({ path, text }) => [...text.matchAll(/(?:radius=\{(\d+)\}|borderRadius\s*:\s*(\d+))/g)]
      .filter(match => Number(match[1] ?? match[2]) > 5)
      .map(match => `${path}:${lineOf(text, match.index!)} ${match[0]}`));
    expect(hits).toEqual([]);
  });
});

describe('yazı', () => {
  it('yazı tokenları ve Mantine ölçeği en az 14 px', () => {
    const fonts = Object.entries(tokens).filter(([key]) => /^font(?!Family)/.test(key) && key !== 'font');
    expect(fonts.filter(([, value]) => !(px(String(value)) >= 14)).map(([key, value]) => `${key}: ${value}`)).toEqual([]);
    expect(px(tokens.fontCaption)).toBe(14);
    expect(Object.values(theme.fontSizes ?? {}).filter(value => !(px(String(value)) >= 14))).toEqual([]);
  });

  it('CSS ve grafik ayarlarında 14 px altı yazı yok', () => {
    const cssHits = css.flatMap(({ path, text }) => [...text.matchAll(/font-size\s*:\s*([^;}!]+)/g)]
      .filter(match => { const value = match[1].trim(); return !/^(inherit|100%|1em)$/.test(value) && !(px(value) >= 14); })
      .map(match => `${path}:${lineOf(text, match.index!)} ${match[0].trim()}`));
    const codeHits = code.flatMap(({ path, text }) => [...text.matchAll(/fontSize\s*:\s*(\d+)/g)]
      .filter(match => Number(match[1]) < 14)
      .map(match => `${path}:${lineOf(text, match.index!)} ${match[0]}`));
    expect([...cssHits, ...codeHits]).toEqual([]);
  });
});

describe('boşluk değerleri', () => {
  it('CSS padding, margin ve gap ham uzunluk taşımaz', () => {
    const property = /(?<![\w-])((?:padding|margin|scroll-padding)(?:-[a-z]+)*|gap|row-gap|column-gap)\s*:\s*([^;}]+)/g;
    const hits = css.flatMap(({ path, text }) => [...text.matchAll(property)]
      .filter(match => /\d*\.?\d+(px|rem|em)\b/.test(match[2].replace(/(var|env)\([^()]*(\([^()]*\))?[^()]*\)/g, '')))
      .map(match => `${path}:${lineOf(text, match.index!)} ${match[0].trim()}`));
    expect(hits).toEqual([]);
  });

  it('bileşenler sayısal boşluk prop’u ya da satır içi boşluk değeri vermez', () => {
    const props = /\b(?:p|px|py|pt|pb|pl|pr|ps|pe|m|mx|my|mt|mb|ml|mr|ms|me|gap|rowGap|columnGap|spacing|verticalSpacing|horizontalSpacing)=\{(-?\d+)\}/g;
    const inline = /\b(?:padding|margin)(?:Top|Bottom|Left|Right|Inline|Block|InlineStart|InlineEnd|BlockStart|BlockEnd)?\s*:\s*(-?\d+)\b|\bgap\s*:\s*(-?\d+)\b/g;
    const hits = code.flatMap(({ path, text }) => [...text.matchAll(props), ...text.matchAll(inline)]
      .filter(match => Number(match[1] ?? match[2]) !== 0)
      .map(match => `${path}:${lineOf(text, match.index!)} ${match[0]}`));
    expect(hits).toEqual([]);
  });
});

describe('ekran metni', () => {
  const PAGES = ['src/dashboard/Dashboard.tsx', 'src/dashboard/Charts.tsx', 'src/finance/FinancePage.tsx', 'src/finance/FinanceTrends.tsx', 'src/timeline/TimelinePage.tsx', 'src/home/HomePlanPage.tsx'];
  const PROCESS_NOTES = [/her dakika/i, /planı izliyor olabilir/i, /yerine geçmez/i, /e-tabloyu değiştirmez/i, /doğrulandığında/i, /aynı finansman hesabından/i, /Filtreler bütçedeki/i, /anlamına gelmez/i, /yatay kaydırın/i];
  // Yalnız ekranda görünen yazı: ekran okuyucu etiketleri (label=) kapsam dışı.
  const texts = PAGES.flatMap(path => {
    const source = readFileSync(path, 'utf8').replace(/\blabel=(?:"[^"]*"|\{[^}]*\})/g, '');
    return [...source.matchAll(/(?:>|\}|['"`])([^<>'"`{}\n]+)(?=<|['"`]|\{)/g)]
      .map(match => ({ path, text: match[1].trim() }))
      .filter(({ text }) => /[a-zçğıöşü]\s+[a-zçğıöşüA-ZÇĞİÖŞÜ]/.test(text) && !/=>|var\(|=\s|^import\b|^(const|return|if|let)\b/.test(text));
  });

  it('dört sayfada açıklamalar en çok 80 karakter', () => {
    expect(texts.filter(({ text }) => text.length > 80).map(({ path, text }) => `${path}: ${text}`)).toEqual([]);
  });

  it('dört sayfada süreç notu yok', () => {
    expect(texts.filter(({ text }) => PROCESS_NOTES.some(note => note.test(text))).map(({ path, text }) => `${path}: ${text}`)).toEqual([]);
  });

  it('kaynak notu tek kelimelik başlık kullanır', () => {
    expect(readFileSync('src/components/Info.tsx', 'utf8')).toMatch(/SourceNote\(\{ label = 'Kaynak',/);
  });
});
