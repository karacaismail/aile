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

// ---------------------------------------------------------------------------------------------------------------
// Yerel (antd'siz) bileşenler için tek odak sözleşmesi, anlamsal kaskadla: admin.css kuralları jsdom'daki gerçek
// öğelere seçici eşleşmesiyle uygulanır. jsdom'da odak durumu ve sözde öğe yoktur; :focus-visible / :focus test
// özniteliğine çevrilir, ::after ayrı sorgulanır. Özgüllük (a,b,c) ve kaynak sırası CSS kaskadı gibi çözülür.
// Telefon katmanları body'ye portallanabilir: .aile-admin dışındaki [data-aile-katman], dialog, [role=dialog],
// [role=alertdialog], [role=menu], [role=listbox] kökleri aynı sözleşmeyi alır.

/** Seçici listesini üst düzey virgüllerden böler (parantez içi korunur). */
function splitList(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of list) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { parts.push(current.trim()); current = ''; } else current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}
const staticSelector = (selector: string) => selector
  .replace(/::(after|before)\b/g, '')
  .replace(/:focus-visible/g, '[data-t-fv]')
  .replace(/:focus(?![-\w])/g, '[data-t-focus]');
type Spec = [number, number, number];
const addSpec = (x: Spec, y: Spec): Spec => [x[0] + y[0], x[1] + y[1], x[2] + y[2]];
const cmpSpec = (x: Spec, y: Spec) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
/** Seçici özgüllüğü: :is/:not/:has en yüksek argüman, :where 0, öznitelik/sınıf/sözde sınıf b, tür ve sözde öğe c. */
function specificity(selector: string): Spec {
  let result: Spec = [0, 0, 0];
  let i = 0;
  const ident = (from: number) => { let j = from; while (j < selector.length && /[\w-]/.test(selector[j])) j += 1; return j; };
  while (i < selector.length) {
    const ch = selector[i];
    if (ch === '#') { result = addSpec(result, [1, 0, 0]); i = ident(i + 1); }
    else if (ch === '.') { result = addSpec(result, [0, 1, 0]); i = ident(i + 1); }
    else if (ch === '[') { result = addSpec(result, [0, 1, 0]); i = selector.indexOf(']', i) + 1; }
    else if (ch === ':' && selector[i + 1] === ':') { result = addSpec(result, [0, 0, 1]); i = ident(i + 2); }
    else if (ch === ':') {
      const end = ident(i + 1);
      const name = selector.slice(i + 1, end);
      if (selector[end] === '(') {
        let depth = 1;
        let j = end + 1;
        while (depth > 0) { if (selector[j] === '(') depth += 1; else if (selector[j] === ')') depth -= 1; j += 1; }
        const inner = selector.slice(end + 1, j - 1);
        if (name === 'is' || name === 'not' || name === 'has') {
          result = addSpec(result, splitList(inner).map(specificity).sort(cmpSpec).at(-1) ?? [0, 0, 0]);
        } else if (name !== 'where') result = addSpec(result, [0, 1, 0]);
        i = j;
      } else { result = addSpec(result, [0, 1, 0]); i = end; }
    } else if (/[a-zA-Z]/.test(ch)) { result = addSpec(result, [0, 0, 1]); i = ident(i); }
    else i += 1;
  }
  return result;
}

type Media = { forced?: boolean; reduced?: boolean };
const mediaMatches = (media: string | null, env: Media) => {
  if (media === null) return true;
  if (/forced-colors:\s*active/.test(media)) return Boolean(env.forced);
  if (/prefers-reduced-motion:\s*reduce/.test(media)) return Boolean(env.reduced);
  return false;
};
const declarationsOf = (body: string) => body.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
  const colon = part.indexOf(':');
  const raw = part.slice(colon + 1).trim();
  return { prop: part.slice(0, colon).trim(), value: raw.replace(/\s*!important$/, ''), important: /!important$/.test(raw) };
});

/** Öğenin (ya da ::after'ının) bir özellikteki kazanan admin.css değeri; eşleşen kural yoksa null. */
function cascade(el: Element, prop: string, opts: { after?: boolean } & Media = {}): string | null {
  let best: { important: boolean; spec: Spec; order: number; value: string } | null = null;
  rules.forEach((rule, order) => {
    if (!mediaMatches(rule.media, opts)) return;
    const decl = declarationsOf(rule.body).filter((d) => d.prop === prop).at(-1);
    if (!decl) return;
    for (const part of splitList(rule.selector)) {
      if (/::after\b/.test(part) !== Boolean(opts.after) || /::before\b/.test(part)) continue;
      let matched = false;
      try { matched = el.matches(staticSelector(part)); } catch { matched = false; }
      if (!matched) continue;
      const candidate = { important: decl.important, spec: specificity(staticSelector(part)), order, value: decl.value };
      if (!best || (candidate.important !== best.important ? candidate.important : cmpSpec(candidate.spec, best.spec) > 0 || (cmpSpec(candidate.spec, best.spec) === 0 && candidate.order >= best.order))) best = candidate;
    }
  });
  return best ? squash((best as { value: string }).value) : null;
}

const FIXTURE = `
  <div class="aile-admin" data-profile="phone">
    <button id="yerel" type="button" data-focus-line>Kaydet</button>
    <span id="sarmal" data-focus-line><input id="alan" aria-label="Ad"></span>
    <details><summary id="ozet">Daha fazla</summary></details>
    <div role="listbox" aria-label="Seçenekler"><div id="secenek" role="option" tabindex="-1" aria-selected="false">A</div></div>
    <div role="menu" aria-label="Diğer"><div id="radyo" role="menuitemradio" tabindex="-1" aria-checked="false">B</div></div>
    <nav class="aile-admin-nav"><a id="nav" href="#/genel">Genel durum</a><a id="navSecili" href="#/butce" aria-current="page">Bütçe ve nakit</a></nav>
  </div>
  <div id="sayfa" role="dialog" aria-modal="true" aria-label="Filtreler" tabindex="-1">
    <button id="sayfaDugme" type="button" data-focus-line>Uygula</button>
    <div data-odak-zemin="nav"><a id="cekmeceNav" href="#/odemeler">Ödemeler</a><a id="cekmeceSecili" href="#/genel" aria-current="page">Genel durum</a></div>
  </div>
  <div id="katman" data-aile-katman><button id="katmanDugme" type="button" data-focus-line>Kapat</button></div>
  <dialog id="yerelDiyalog"><button id="diyalogDugme" type="button" data-focus-line>Tamam</button></dialog>
  <div role="alertdialog" aria-label="Uyarı"><button id="uyariDugme" type="button" data-focus-line>Anladım</button></div>
  <div role="listbox" aria-label="Portal liste"><div id="portalSecenek" role="option" tabindex="-1" aria-selected="true">C</div></div>
`;
const NATIVE_TARGETS = ['yerel', 'ozet', 'secenek', 'radyo', 'sayfaDugme', 'katmanDugme', 'diyalogDugme', 'uyariDugme', 'portalSecenek'];
const LINE = {
  content: '""',
  position: 'absolute',
  left: '0',
  right: '0',
  height: 'var(--aile-odak-kalinlik)',
  bottom: 'calc(-1 * (var(--aile-odak-aralik) + var(--aile-odak-kalinlik)))',
  'pointer-events': 'none',
};

describe('native component focus contract (semantic cascade)', () => {
  const byId = (id: string) => document.getElementById(id)!;
  const focusOn = (id: string) => {
    for (const el of document.querySelectorAll('[data-t-fv], [data-t-focus]')) { el.removeAttribute('data-t-fv'); el.removeAttribute('data-t-focus'); }
    byId(id).setAttribute('data-t-focus', '');
    byId(id).setAttribute('data-t-fv', '');
  };
  const line = (el: Element, env: Media = {}) =>
    Object.fromEntries(Object.keys(LINE).map((prop) => [prop, cascade(el, prop, { after: true, ...env })]));
  beforeEach(() => {
    document.body.innerHTML = FIXTURE;
    document.documentElement.setAttribute('data-keyboard', 'true');
  });
  afterEach(() => {
    document.body.innerHTML = '';
    document.documentElement.removeAttribute('data-keyboard');
  });

  it('draws one odak line 4 px under every focused native control, in the admin root and in portalled layers', () => {
    for (const id of NATIVE_TARGETS) {
      focusOn(id);
      expect(line(byId(id)), id).toEqual(LINE);
      expect(cascade(byId(id), 'background', { after: true }), id).toBe('var(--aile-odak)');
      // Çizgi kontrol genişliğindedir: taşıyıcı konumlanır.
      expect(cascade(byId(id), 'position'), id).toBe('relative');
    }
  });

  it('puts the line on the [data-focus-line] wrapper of an input that cannot carry ::after', () => {
    focusOn('alan');
    expect(line(byId('sarmal'))).toEqual(LINE);
    expect(cascade(byId('sarmal'), 'position')).toBe('relative');
  });

  it('removes outline and box-shadow from every focused native control and layer root', () => {
    for (const id of [...NATIVE_TARGETS, 'alan', 'sayfa', 'katman', 'yerelDiyalog']) {
      focusOn(id);
      expect(cascade(byId(id), 'outline'), id).toBe('none');
      expect(cascade(byId(id), 'box-shadow'), id).toBe('none');
    }
  });

  it('shows nothing in pointer mode: no line without html[data-keyboard=true]', () => {
    document.documentElement.setAttribute('data-keyboard', 'false');
    for (const id of NATIVE_TARGETS) {
      focusOn(id);
      expect(cascade(byId(id), 'content', { after: true }), id).toBeNull();
    }
    focusOn('alan');
    expect(cascade(byId('sarmal'), 'content', { after: true })).toBeNull();
  });

  it('shows nothing on a control that is not focus-visible', () => {
    for (const id of NATIVE_TARGETS) {
      byId(id).setAttribute('data-t-focus', '');
      expect(cascade(byId(id), 'content', { after: true }), id).toBeNull();
      byId(id).removeAttribute('data-t-focus');
    }
  });

  it('colours the line odak-nav on nav surfaces, also in a portalled [data-odak-zemin=nav] layer; selected item odak', () => {
    for (const id of ['nav', 'cekmeceNav']) {
      focusOn(id);
      expect(cascade(byId(id), 'background', { after: true }), id).toBe('var(--aile-odak-nav)');
    }
    for (const id of ['navSecili', 'cekmeceSecili']) {
      focusOn(id);
      expect(cascade(byId(id), 'background', { after: true }), id).toBe('var(--aile-odak)');
    }
  });

  it('forced-colors: keyboard mode + :focus-visible gets 2px solid CanvasText on the control itself, pointer mode none', () => {
    for (const id of [...NATIVE_TARGETS, 'alan']) {
      focusOn(id);
      expect(cascade(byId(id), 'outline', { forced: true }), id).toBe('2px solid CanvasText');
    }
    document.documentElement.setAttribute('data-keyboard', 'false');
    for (const id of [...NATIVE_TARGETS, 'alan']) {
      focusOn(id);
      expect(cascade(byId(id), 'outline', { forced: true }), id).toBe('none');
    }
  });

  it('reduced motion is instant in portalled native layers too', () => {
    for (const id of ['yerel', 'sayfaDugme', 'katmanDugme', 'diyalogDugme', 'uyariDugme', 'portalSecenek']) {
      expect(cascade(byId(id), 'transition-duration', { reduced: true }), id).toBe('0s');
      expect(cascade(byId(id), 'animation', { reduced: true }), id).toBe('none');
      expect(cascade(byId(id), 'transition-duration', { after: true, reduced: true }), id).toBe('0s');
    }
  });

  it('every rule that draws a focus line is gated by keyboard mode and a focus state', () => {
    const drawing = rules.filter((r) => /::after/.test(r.selector) && decl(r.body, 'content') !== null && /focus/.test(r.selector));
    expect(drawing.length).toBeGreaterThan(0);
    for (const rule of drawing) {
      for (const part of splitList(rule.selector)) {
        expect(part, rule.selector).toMatch(/^html\[data-keyboard=['"]true['"]\]\s/);
        expect(part, rule.selector).toMatch(/:focus-visible|-focused|:focus\b/);
      }
    }
  });
});
