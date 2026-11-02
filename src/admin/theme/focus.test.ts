import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { designTokens } from '../../design/tokens.ts';
import { aileTema } from './antdTheme';

// Odak sözleşmesi (AGENT.md "çevreleyen odak halkası yasaktır" + tasarim-sistemi/README.md):
// çevreleyen halka yok (outline / box-shadow), tek 3 px alt çizgi ::after ile kontrolün 4 px altında,
// nav üzerinde acik-mavi, forced-colors'ta tek dar istisna, reduced-motion'da anlık. admin.css kaynak metni
// olarak okunur; antd iç sınıflarına değil kendi sözleşme seçicilerimize bakılır.
// AILE_FOCUS_CSS yalnız mutasyon kontrolü içindir (stub CSS ile test FAIL vermeli); üretimde admin.css okunur.
const cssPath = process.env.AILE_FOCUS_CSS ?? resolve(__dirname, '../admin.css');
const raw = readFileSync(cssPath, 'utf8');
const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

type Rule = { selector: string; body: string; media: string | null };

/** Düz CSS ayrıştırıcı: @media bloklarını açar, her kuralı {selector, body, media} olarak verir. */
function parseRules(source: string, media: string | null = null): Rule[] {
  const rules: Rule[] = [];
  let i = 0;
  while (i < source.length) {
    const open = source.indexOf('{', i);
    if (open === -1) break;
    const selector = squash(source.slice(i, open));
    let depth = 1;
    let j = open + 1;
    while (j < source.length && depth > 0) {
      if (source[j] === '{') depth += 1;
      else if (source[j] === '}') depth -= 1;
      j += 1;
    }
    const body = source.slice(open + 1, j - 1);
    if (selector.startsWith('@media')) rules.push(...parseRules(body, selector));
    else rules.push({ selector, body: squash(body), media });
    i = j;
  }
  return rules;
}

const rules = parseRules(css);
const decl = (body: string, prop: string) => {
  const match = body.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`));
  return match ? match[1].trim() : null;
};
const scoped = (rule: Rule) => rule.selector.includes('.aile-admin');
const topLevel = rules.filter((r) => r.media === null);

describe('admin.css focus contract', () => {
  it('declares :root fallback variables for the focus line and motion from designTokens', () => {
    const root = topLevel.find((r) => r.selector === ':root');
    expect(root).toBeDefined();
    const body = root!.body;
    expect(decl(body, '--aile-odak')).toBe(designTokens.odak);
    expect(decl(body, '--aile-odak-nav')).toBe(designTokens.odakNav);
    expect(decl(body, '--aile-odak-kalinlik')).toBe(`${designTokens.odakKalinlik}px`);
    expect(decl(body, '--aile-odak-aralik')).toBe(`${designTokens.odakAralik}px`);
    expect(decl(body, '--aile-sure')).toBe(`${designTokens.sure}ms`);
    expect(decl(body, '--aile-egri')).toBe(designTokens.egri);
  });

  it('removes outline and box-shadow on :focus and :focus-visible inside the admin root', () => {
    const reset = topLevel.filter(
      (r) => scoped(r) && /:focus-visible/.test(r.selector) && decl(r.body, 'outline') === 'none',
    );
    expect(reset.length).toBeGreaterThan(0);
    const [rule] = reset;
    expect(rule.selector).toMatch(/:focus(?![-\w])/);
    expect(decl(rule.body, 'box-shadow')).toBe('none');
    // antd'nin body'ye portalladığı katmanlar da aynı sıfırlamayı alır.
    for (const layer of ['.ant-drawer', '.ant-modal', '.ant-dropdown', '.ant-select-dropdown']) {
      expect(rule.selector).toContain(layer);
    }
  });

  it('draws the focus indicator as a single ::after line of odak-kalinlik, odak-aralik below the control', () => {
    const lines = topLevel.filter(
      (r) => scoped(r) && /:focus-visible::after/.test(r.selector) && decl(r.body, 'content') !== null,
    );
    expect(lines.length).toBeGreaterThan(0);
    const [line] = lines;
    // Çizgi yalnız klavye modunda (installKeyboardMode) görünür.
    expect(line.selector).toMatch(/html\[data-keyboard=['"]true['"]\]/);
    expect(decl(line.body, 'content')).toMatch(/^(""|'')$/);
    expect(decl(line.body, 'position')).toBe('absolute');
    expect(decl(line.body, 'left')).toBe('0');
    expect(decl(line.body, 'right')).toBe('0');
    expect(decl(line.body, 'height')).toBe('var(--aile-odak-kalinlik)');
    expect(squash(decl(line.body, 'bottom') ?? '')).toBe(
      'calc(-1 * (var(--aile-odak-aralik) + var(--aile-odak-kalinlik)))',
    );
    expect(decl(line.body, 'background')).toBe('var(--aile-odak)');
    expect(decl(line.body, 'pointer-events')).toBe('none');
    // Çizgi kontrol genişliğinde olur: taşıyıcılar konumlanır ve overflow'u göstermeye izin verir.
    const carriers = topLevel.filter(
      (r) => scoped(r) && !/::after/.test(r.selector) && decl(r.body, 'position') === 'relative' && decl(r.body, 'overflow') === 'visible',
    );
    expect(carriers.length).toBeGreaterThan(0);
  });

  it('colours the focus line acik-mavi (odak-nav) over the navigation', () => {
    const navLines = topLevel.filter(
      (r) =>
        scoped(r) &&
        /:focus-visible::after/.test(r.selector) &&
        /\.aile-admin-nav|\.ant-layout-sider|\.ant-menu-dark/.test(r.selector) &&
        decl(r.body, 'background') === 'var(--aile-odak-nav)',
    );
    expect(navLines.length).toBeGreaterThan(0);
    expect(navLines[0].selector).toMatch(/html\[data-keyboard=['"]true['"]\]/);
  });

  it('keeps the only outline in the forced-colors keyboard-mode exception', () => {
    const forced = rules.filter((r) => r.media !== null && /forced-colors:\s*active/.test(r.media!));
    expect(forced.length).toBeGreaterThan(0);
    const exception = forced.find((r) => /:focus-visible/.test(r.selector) && decl(r.body, 'outline') !== null);
    expect(exception).toBeDefined();
    expect(exception!.selector).toMatch(/html\[data-keyboard=['"]true['"]\]/);
    expect(squash(decl(exception!.body, 'outline')!)).toBe('2px solid CanvasText');
    // forced-colors dışında hiçbir kural görünür outline çizmez.
    const otherOutlines = rules.filter(
      (r) => !(r.media !== null && /forced-colors/.test(r.media!)) && decl(r.body, 'outline') !== null && decl(r.body, 'outline') !== 'none',
    );
    expect(otherOutlines.map((r) => r.selector)).toEqual([]);
    expect(css).not.toMatch(/outline-offset/);
  });

  it('turns motion off instantly under prefers-reduced-motion', () => {
    const reduced = rules.filter((r) => r.media !== null && /prefers-reduced-motion:\s*reduce/.test(r.media!));
    expect(reduced.length).toBeGreaterThan(0);
    const shell = reduced.find((r) => scoped(r));
    expect(shell).toBeDefined();
    expect(shell!.selector).toContain('.aile-admin *');
    expect(decl(shell!.body, 'transition-duration')).toBe('0s !important');
    expect(decl(shell!.body, 'animation')).toBe('none !important');
    // Portallanan antd katmanları da kapsanır.
    expect(shell!.selector).toContain('.ant-drawer');
    expect(shell!.selector).toContain('.ant-modal');
  });

  it('never draws a surrounding ring with box-shadow anywhere in the file', () => {
    const shadows = rules
      .map((r) => decl(r.body, 'box-shadow'))
      .filter((v): v is string => v !== null && v !== 'none');
    for (const value of shadows) {
      // Halka deseni: 0 0 0 Npx <renk>, inset dahil.
      expect(value).not.toMatch(/(^|,|inset)\s*0\s+0\s+0\s+\d/);
    }
    expect(css).not.toMatch(/box-shadow\s*:[^;]*\b0\s+0\s+0\s+\d+px/);
  });
});

describe('aileTema focus and emphasis tokens', () => {
  it('disables the Tabs ink bar and the base shadow', () => {
    expect(aileTema.components?.Tabs?.inkBarColor).toBe('transparent');
    expect(aileTema.token?.boxShadow).toBe('none');
  });

  it('removes antd focus rings at the token level', () => {
    expect(aileTema.token?.controlOutline).toBe('transparent');
    expect(aileTema.token?.controlOutlineWidth).toBe(0);
    expect(aileTema.token?.lineWidthFocus).toBe(0);
    expect(aileTema.components?.Menu?.activeBarWidth).toBe(0);
    expect(aileTema.components?.Menu?.activeBarBorderWidth).toBe(0);
  });
});
