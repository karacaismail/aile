import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  tokens, budgetEasing, chartMotion, cssTokens, dropdownTransition, designTokens, aileCssVars, adaptiveTokens,
  densityBands, densityFor, densityCssVars, densityVarNames, targetTokens, targetCssVars, safeAreaCssVars,
} from './tokens';
import * as legacy from '../dashboard/tokens';
import { classifyProfile } from '../admin/adaptive/profile';

describe('design tokens', () => {
  it('legacy dashboard module re-exports the same references', () => {
    expect(legacy.tokens).toBe(tokens);
    expect(legacy.budgetEasing).toBe(budgetEasing);
    expect(legacy.chartMotion).toBe(chartMotion);
    expect(legacy.cssTokens).toBe(cssTokens);
    expect(legacy.dropdownTransition).toBe(dropdownTransition);
  });
  it('keeps shared values', () => {
    expect(tokens.font.startsWith('Outfit')).toBe(true);
    expect(tokens.duration).toBe(240);
    expect(tokens.ease).toBe('cubic-bezier(.65, 0, .35, 1)');
  });
});

// Tasarım teslimi: aile-tasarim/tasarim-sistemi/tokens.json (tek görsel kaynak). Hex değerleri oradan birebir;
// karşılaştırma büyük/küçük harften bağımsızdır çünkü tokens.json küçük, README ve antd eşlemesi büyük harf yazar.
const hex = (value: string) => value.toLowerCase();
const tokensJsonColors: Record<string, string> = {
  metin: '#203a51', metinIkincil: '#52697c', nav: '#1b3e55', eylem: '#326b94', acikMavi: '#a6bed0',
  yuzey: '#ffffff', zemin: '#f5f7fa', listeZemin: '#e1e9ef', cizgi: '#dce4eb', secili: '#c9dbe7', bilgiYuzey: '#eaf1f6',
  olumlu: '#316653', olumluYuzey: '#eff7f3', hata: '#9f4e48', hataYuzey: '#fcf0ee', uyari: '#805c22', uyariYuzey: '#fcf8ee',
};
const tokensJsonAlpha: Record<string, string> = {
  navHover: 'rgba(166, 190, 208, 0.16)', navBasili: 'rgba(166, 190, 208, 0.28)', ortu: 'rgba(27, 62, 85, 0.48)',
};
const designNames = [
  'metin', 'metinIkincil', 'nav', 'eylem', 'acikMavi', 'yuzey', 'zemin', 'listeZemin', 'cizgi', 'secili', 'bilgiYuzey',
  'olumlu', 'olumluYuzey', 'hata', 'hataYuzey', 'uyari', 'uyariYuzey', 'kenarKontrol', 'odak', 'odakNav', 'navMetin',
  'navHover', 'navBasili', 'ortu', 'fontSans',
  'bosluk1', 'bosluk2', 'bosluk3', 'bosluk4', 'bosluk6', 'bosluk8', 'koseKontrol', 'koseKart', 'kosePanel', 'golgeYukseltilmis',
  'navGenislik', 'filtreGenislik', 'ayrintiGenislik', 'icerikAzami', 'kirilimTablet', 'kirilimGenis', 'hedefAsgari',
  'fotografListe', 'odakKalinlik', 'odakAralik', 'sure', 'egri',
] as const;

describe('designTokens (tokens.json eşlemesi)', () => {
  it('has every design name', () => {
    for (const name of designNames) expect(designTokens, name).toHaveProperty(name);
  });
  it('matches tokens.json colors exactly', () => {
    for (const [name, value] of Object.entries(tokensJsonColors)) expect(hex(designTokens[name as keyof typeof designTokens] as string), name).toBe(value);
    for (const [name, value] of Object.entries(tokensJsonAlpha)) expect(designTokens[name as keyof typeof designTokens], name).toBe(value);
  });
  it('derives reference tokens from their sources', () => {
    expect(designTokens.kenarKontrol).toBe(designTokens.metinIkincil);
    expect(designTokens.odak).toBe(designTokens.eylem);
    expect(designTokens.odakNav).toBe(designTokens.acikMavi);
    expect(designTokens.navMetin).toBe(designTokens.yuzey);
  });
  it('keeps measures, breakpoints and motion from tokens.json', () => {
    // Outfit'ten hemen sonra ölçü eşlemeli yedek ('Outfit Yedek', src/admin/fonts.css: yalnız local() Arial ve ölçü
    // uyumlu eşleri, size-adjust/ascent/descent/line-gap-override). Outfit inerken metin bu yüzle çizilir; font geldiğinde
    // satır kırılımı ve kutular neredeyse değişmez (e2e/admin-typography geç font kayması ≤ 0,005). ₺ ve yerel yüzü
    // olmayan sistemde yığın system-ui'ye düşer.
    expect(designTokens.fontSans).toBe("Outfit, 'Outfit Yedek', system-ui, sans-serif");
    expect([designTokens.bosluk1, designTokens.bosluk2, designTokens.bosluk3, designTokens.bosluk4, designTokens.bosluk6, designTokens.bosluk8]).toEqual([4, 8, 12, 16, 24, 32]);
    expect([designTokens.koseKontrol, designTokens.koseKart, designTokens.kosePanel]).toEqual([5, 5, 5]);
    expect(designTokens.golgeYukseltilmis).toBe('0 2px 4px rgba(27, 62, 85, 0.18), 0 8px 20px rgba(27, 62, 85, 0.14)');
    expect(designTokens.navGenislik).toBe(272);
    expect(designTokens.filtreGenislik).toBe(272);
    expect(designTokens.ayrintiGenislik).toBe(384);
    expect(designTokens.icerikAzami).toBe(1480);
    expect(designTokens.kirilimTablet).toBe(600);
    expect(designTokens.kirilimGenis).toBe(1024);
    expect(designTokens.hedefAsgari).toBe(44);
    expect(designTokens.fotografListe).toBe(56);
    expect(designTokens.odakKalinlik).toBe(3);
    expect(designTokens.odakAralik).toBe(4);
    expect(designTokens.sure).toBe(240);
    expect(designTokens.egri).toBe('cubic-bezier(.65,0,.35,1)');
  });
});

describe('aileCssVars', () => {
  it('maps every design token to a --aile-<kebab> custom property with units', () => {
    expect(aileCssVars['--aile-metin']).toBe(designTokens.metin);
    expect(aileCssVars['--aile-metin-ikincil']).toBe(designTokens.metinIkincil);
    expect(aileCssVars['--aile-acik-mavi']).toBe(designTokens.acikMavi);
    expect(aileCssVars['--aile-kenar-kontrol']).toBe(designTokens.kenarKontrol);
    expect(aileCssVars['--aile-odak-nav']).toBe(designTokens.odakNav);
    expect(aileCssVars['--aile-font-sans']).toBe(designTokens.fontSans);
    expect(aileCssVars['--aile-bosluk-1']).toBe('4px');
    expect(aileCssVars['--aile-bosluk-8']).toBe('32px');
    expect(aileCssVars['--aile-kose-panel']).toBe('5px');
    expect(aileCssVars['--aile-golge-yukseltilmis']).toBe(designTokens.golgeYukseltilmis);
    expect(aileCssVars['--aile-nav-genislik']).toBe('272px');
    expect(aileCssVars['--aile-kirilim-tablet']).toBe('600px');
    expect(aileCssVars['--aile-odak-kalinlik']).toBe('3px');
    expect(aileCssVars['--aile-odak-aralik']).toBe('4px');
    expect(aileCssVars['--aile-sure']).toBe('240ms');
    expect(aileCssVars['--aile-egri']).toBe(designTokens.egri);
    expect(Object.keys(aileCssVars)).toHaveLength(designNames.length);
    for (const key of Object.keys(aileCssVars)) expect(key).toMatch(/^--aile-[a-z0-9]+(-[a-z0-9]+)*$/);
  });
  it('admin.css carries the same values as :root fallbacks for portalled antd layers', () => {
    const css = readFileSync(resolve(__dirname, '../admin/admin.css'), 'utf8');
    const root = css.match(/:root\s*\{([^}]*)\}/)?.[1] ?? '';
    for (const [key, value] of Object.entries(aileCssVars)) expect(root, key).toContain(`${key}: ${value};`);
  });
});

// Uyarlamalı yerleşim eşiği: tokens.json'da yok (uygulama kararı, src/admin/adaptive/profile.ts). Tasarım eşlemesine ve
// --aile-* değişkenlerine karışmaz; admin.css :root yedekleri bu yüzden değişmez.
describe('adaptiveTokens (kısa kenar eşiği)', () => {
  it('is 480 CSS px, below the tablet breakpoint', () => {
    expect(adaptiveTokens.kirilimKisaKenar).toBe(480);
    expect(adaptiveTokens.kirilimKisaKenar).toBeLessThan(designTokens.kirilimTablet);
    expect(Object.keys(adaptiveTokens)).toEqual(['kirilimKisaKenar']);
  });
  it('stays out of the tokens.json mapping and the --aile-* custom properties', () => {
    expect(designTokens).not.toHaveProperty('kirilimKisaKenar');
    expect(Object.keys(aileCssVars).filter(key => key.includes('kisa-kenar'))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Uyarlamalı yoğunluk, dokunma hedefi ve güvenli alan (uygulama kararı; tokens.json'da yok). Tek kaynak tokens.ts;
// admin.css aynı değerleri --aile-* değişkeni olarak taşır. Kahin: görev sözleşmesindeki bant tablosu (aşağıda elle
// yazılı); tokens.ts ve admin.css ondan türetilmez, ona karşı doğrulanır.
// Bantlar (kenar / bosluk / yogun, CSS px): 320–359 12/8/4 · 360–374 14/10/6 · 375–389 16/12/6 · 390–599 16/12/8 ·
// 600–1023 20/16/10 · 1024+ 24/20/12. Yatay telefon (kısa kenar < 480) telefon profilinde kalır, telefon bandını alır.
const SPEC_BANDS = [
  { min: 0, profile: 'phone', kenar: 12, bosluk: 8, yogun: 4 },
  { min: 360, profile: 'phone', kenar: 14, bosluk: 10, yogun: 6 },
  { min: 375, profile: 'phone', kenar: 16, bosluk: 12, yogun: 6 },
  { min: 390, profile: 'phone', kenar: 16, bosluk: 12, yogun: 8 },
  { min: 600, profile: 'tablet', kenar: 20, bosluk: 16, yogun: 10 },
  { min: 1024, profile: 'desktop', kenar: 24, bosluk: 20, yogun: 12 },
] as const;
// [genişlik, yükseklik, kenar, bosluk, yogun] — matris görünümleri, bant sınırları ve yatay telefonlar.
const SPEC_VIEWPORTS: ReadonlyArray<readonly [number, number, number, number, number]> = [
  [280, 653, 12, 8, 4], [320, 568, 12, 8, 4], [320, 480, 12, 8, 4], [359, 740, 12, 8, 4],
  [360, 640, 14, 10, 6], [374, 667, 14, 10, 6],
  [375, 667, 16, 12, 6], [389, 844, 16, 12, 6],
  [390, 844, 16, 12, 8], [430, 932, 16, 12, 8], [500, 900, 16, 12, 8], [599, 900, 16, 12, 8],
  [568, 320, 16, 12, 8], [667, 375, 16, 12, 8], [844, 390, 16, 12, 8], [932, 430, 16, 12, 8],
  [600, 800, 20, 16, 10], [820, 1180, 20, 16, 10], [1023, 768, 20, 16, 10],
  [1024, 600, 24, 20, 12], [1180, 820, 24, 20, 12], [1440, 900, 24, 20, 12],
];
const DENSITY_VARS = ['--aile-yogunluk-kenar', '--aile-yogunluk-bosluk', '--aile-yogunluk-yogun'] as const;
const TARGET_VAR = '--aile-dokunma-hedefi';
const SAFE_VARS = {
  '--aile-safe-top': 'env(safe-area-inset-top, 0px)',
  '--aile-safe-right': 'env(safe-area-inset-right, 0px)',
  '--aile-safe-bottom': 'env(safe-area-inset-bottom, 0px)',
  '--aile-safe-left': 'env(safe-area-inset-left, 0px)',
} as const;
const pxVars = (kenar: number, bosluk: number, yogun: number) => ({
  '--aile-yogunluk-kenar': `${kenar}px`, '--aile-yogunluk-bosluk': `${bosluk}px`, '--aile-yogunluk-yogun': `${yogun}px`,
});

describe('density tokens (genişlik bandı)', () => {
  it('lists the six bands of the contract in ascending order', () => {
    expect(densityBands.map(band => ({ ...band }))).toEqual(SPEC_BANDS.map(band => ({ ...band })));
    expect(densityBands[4].min).toBe(designTokens.kirilimTablet);
    expect(densityBands[5].min).toBe(designTokens.kirilimGenis);
    expect(Object.isFrozen(densityBands)).toBe(true);
  });
  it('picks the band from width and profile; a landscape phone keeps the phone band', () => {
    for (const [width, height, kenar, bosluk, yogun] of SPEC_VIEWPORTS) {
      const band = densityFor(width, classifyProfile({ width, height }));
      expect([band.kenar, band.bosluk, band.yogun], `${width}×${height}`).toEqual([kenar, bosluk, yogun]);
    }
  });
  it('maps a band to --aile-yogunluk-* custom properties in px', () => {
    expect(densityVarNames).toEqual({ kenar: DENSITY_VARS[0], bosluk: DENSITY_VARS[1], yogun: DENSITY_VARS[2] });
    expect(densityCssVars(densityBands[0])).toEqual(pxVars(12, 8, 4));
    expect(densityCssVars(densityBands[5])).toEqual(pxVars(24, 20, 12));
  });
});

describe('touch target and safe-area tokens', () => {
  it('keeps 44 px and raises the target to 48 px for coarse input', () => {
    expect(targetTokens).toEqual({ dokunmaHedefi: 44, dokunmaHedefiCoarse: 48 });
    expect(targetTokens.dokunmaHedefi).toBe(designTokens.hedefAsgari);
    expect(targetCssVars(false)).toEqual({ [TARGET_VAR]: '44px' });
    expect(targetCssVars(true)).toEqual({ [TARGET_VAR]: '48px' });
    // Mevcut ad aynı kalır (herkes kullanıyor): --aile-hedef-asgari sabit 44.
    expect(aileCssVars['--aile-hedef-asgari']).toBe('44px');
  });
  it('exposes the four safe-area insets with a 0px fallback', () => {
    expect(safeAreaCssVars).toEqual(SAFE_VARS);
  });
  it('stays out of aileCssVars: App gives aileCssVars inline to .aile-admin and inline would override the bands', () => {
    for (const name of [...DENSITY_VARS, TARGET_VAR, ...Object.keys(SAFE_VARS)]) {
      expect(aileCssVars, name).not.toHaveProperty(name);
      expect(name).toMatch(/^--aile-[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });
});

// admin.css kaynak metni: @media bloklarını açan düz ayrıştırıcı (focus.test.ts ile aynı yaklaşım).
type CssRule = { selector: string; body: string; media: string | null; index: number };
function cssRules(source: string): CssRule[] {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
  const out: CssRule[] = [];
  const walk = (src: string, media: string | null) => {
    let i = 0;
    while (i < src.length) {
      const open = src.indexOf('{', i);
      if (open === -1) break;
      const selector = squash(src.slice(i, open));
      let depth = 1;
      let j = open + 1;
      while (j < src.length && depth > 0) { if (src[j] === '{') depth += 1; else if (src[j] === '}') depth -= 1; j += 1; }
      const body = src.slice(open + 1, j - 1);
      if (selector.startsWith('@media')) walk(body, selector);
      else out.push({ selector, body: squash(body), media, index: out.length });
      i = j;
    }
  };
  walk(text, null);
  return out;
}
const declarations = (body: string) => Object.fromEntries(
  body.split(';').map(part => part.trim()).filter(Boolean).map(part => {
    const colon = part.indexOf(':');
    return [part.slice(0, colon).trim(), part.slice(colon + 1).trim()];
  }),
);
const pick = (decls: Record<string, string>, names: readonly string[]) =>
  Object.fromEntries(names.filter(name => name in decls).map(name => [name, decls[name]]));

// AILE_TOKENS_CSS yalnız mutasyon kontrolü içindir (bozuk kopya ile bu blok FAIL vermeli); üretimde admin.css okunur.
describe('admin.css adaptive custom properties', () => {
  const css = readFileSync(process.env.AILE_TOKENS_CSS ?? resolve(__dirname, '../admin/admin.css'), 'utf8');
  const all = cssRules(css);
  const adaptiveNames = [...DENSITY_VARS, TARGET_VAR, ...Object.keys(SAFE_VARS)];
  const setters = all.filter(rule => adaptiveNames.some(name => name in declarations(rule.body)));
  const baseRoot = setters.find(rule => rule.media === null && rule.selector === ':root');
  const profileSelector = (profile: string) => `:root[data-profile='${profile}'], .aile-admin[data-profile='${profile}']`;

  it('declares the narrowest band, the 44 px target and the safe-area insets on :root', () => {
    expect(baseRoot).toBeDefined();
    const decls = declarations(baseRoot!.body);
    expect(pick(decls, DENSITY_VARS)).toEqual(densityCssVars(densityBands[0]));
    expect(pick(decls, [TARGET_VAR])).toEqual(targetCssVars(false));
    expect(pick(decls, Object.keys(SAFE_VARS))).toEqual(safeAreaCssVars);
  });

  it('widens phone bands with min-width media queries in ascending source order', () => {
    const phone = densityBands.filter(band => band.profile === 'phone' && band.min > 0);
    const found = phone.map(band => setters.find(rule => rule.selector === ':root' && rule.media === `@media (min-width: ${band.min}px)`));
    found.forEach((rule, i) => {
      expect(rule, `${phone[i].min}`).toBeDefined();
      expect(pick(declarations(rule!.body), DENSITY_VARS)).toEqual(densityCssVars(phone[i]));
      expect(rule!.index).toBeGreaterThan(i === 0 ? baseRoot!.index : found[i - 1]!.index);
    });
  });

  it('takes tablet and desktop bands from data-profile so a landscape phone stays on the phone band', () => {
    for (const band of densityBands.filter(b => b.profile !== 'phone')) {
      const rule = setters.find(r => r.media === null && r.selector === profileSelector(band.profile));
      expect(rule, band.profile).toBeDefined();
      expect(pick(declarations(rule!.body), DENSITY_VARS)).toEqual(densityCssVars(band));
    }
  });

  it('raises the touch target from the coarse input layer attribute', () => {
    const rule = setters.find(r => r.media === null && r.selector === ':root[data-input-coarse], .aile-admin[data-input-coarse]');
    expect(rule).toBeDefined();
    expect(pick(declarations(rule!.body), [TARGET_VAR])).toEqual(targetCssVars(true));
  });

  it('sets these properties nowhere else (no stray override)', () => {
    const known = new Set([
      ':root',
      ':root[data-input-coarse], .aile-admin[data-input-coarse]',
      ...densityBands.filter(b => b.profile !== 'phone').map(b => profileSelector(b.profile)),
    ]);
    for (const rule of setters) {
      expect(known.has(rule.selector), rule.selector).toBe(true);
      if (rule.media !== null) expect(rule.media).toMatch(/^@media \(min-width: \d+px\)$/);
    }
    expect(setters).toHaveLength(1 + 3 + 2 + 1);
  });

  // Kaskad benzetimi: üstteki testler seçici biçimlerini sabitler (:root 0,1,0; :root[öznitelik] 0,2,0), bu yüzden
  // öznitelik kuralları media sırası ne olursa olsun :root kurallarını ezer. Değerler bant tablosuyla eşleşmeli.
  it('resolves to the contract table at every viewport', () => {
    for (const [width, height, kenar, bosluk, yogun] of SPEC_VIEWPORTS) {
      const profile = classifyProfile({ width, height });
      const values: Record<string, string> = {};
      const apply = (rule: CssRule) => Object.assign(values, pick(declarations(rule.body), DENSITY_VARS));
      for (const rule of setters.filter(r => r.selector === ':root')) {
        const min = rule.media === null ? 0 : Number(/min-width: (\d+)px/.exec(rule.media)![1]);
        if (width >= min) apply(rule);
      }
      for (const rule of setters.filter(r => r.selector === profileSelector(profile))) apply(rule);
      expect(values, `${width}×${height} (${profile})`).toEqual(pxVars(kenar, bosluk, yogun));
    }
  });
});

// Yedek yüzün tek kaynağı src/admin/fonts.css: yığındaki ad orada @font-face olarak (yalnız local(), ağ isteği yok) ve
// Outfit'in ağırlık aralıklarıyla tanımlı olmalı; aksi hâlde ad yığında ölü kalır ve metin system-ui'ye düşer.
describe('fontSans yedek yüzü (src/admin/fonts.css)', () => {
  const css = readFileSync(resolve(__dirname, '../admin/fonts.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const faces = Array.from(css.matchAll(/@font-face\s*\{([^}]*)\}/g), match => match[1]!);
  const family = (body: string) => /font-family:\s*([^;]+);/.exec(body)?.[1]?.trim().replace(/^['"]|['"]$/g, '');
  const weights = (body: string) => /font-weight:\s*([^;]+);/.exec(body)?.[1]?.trim();

  it('yığındaki ikinci aile fonts.css yedek yüzüdür; Outfit hemen önünde, system-ui arkasında', () => {
    const stack = designTokens.fontSans.split(',').map(name => name.trim().replace(/^['"]|['"]$/g, ''));
    expect(stack).toEqual(['Outfit', 'Outfit Yedek', 'system-ui', 'sans-serif']);
    expect(faces.filter(face => family(face) === 'Outfit Yedek').length).toBeGreaterThan(0);
  });

  it('yedek yüz yalnız local() kaynak kullanır ve Outfit ağırlık aralıklarını karşılar', () => {
    const yedek = faces.filter(face => family(face) === 'Outfit Yedek');
    for (const face of yedek) {
      const src = /src:\s*([^;]+);/.exec(face)?.[1] ?? '';
      expect(src).toMatch(/^local\(/);
      expect(src).not.toMatch(/url\(/);
      expect(face).toMatch(/size-adjust:\s*[\d.]+%/);
      expect(face).toMatch(/ascent-override:\s*[\d.]+%/);
      expect(face).toMatch(/descent-override:\s*[\d.]+%/);
    }
    const outfit = new Set(faces.filter(face => family(face) === 'Outfit').map(weights));
    expect(new Set(yedek.map(weights))).toEqual(outfit);
  });
});

// Bileşen ve sayfa CSS'lerinin ortak sözleşmesi (kullanıcının kalıcı arayüz kuralları): ölçüler merkezi --aile-*
// tokenlarından (yalnız tasarım tip ölçeği, 0 ve 1 px kılçizgi düz yazılır), hover yalnız hover destekleyen birincil
// işaretçide (dokunmatikte takılı kalmaz), okunur metin kullanıcının kök yazı boyutu küçükken de 14 CSS px'in altına
// inmez. Kaynak metni okunur; hesaplanmış görünüm e2e'dedir (admin-ui-a09-table: odak çizgisi sınırları).
describe('bileşen ve sayfa CSS sözleşmesi', () => {
  const read = (path: string) => readFileSync(resolve(__dirname, '..', path), 'utf8');
  const TIP_OLCEGI = new Set(['0', '1', '14', '16', '18', '20', '24', '26', '32', '40']);

  it('Drawer.css ölçüleri tokendan: başlık 64 px = 2 × bosluk-8; tip ölçeği ve kılçizgi dışında düz px yok', () => {
    const css = read('admin/ui/Drawer.css').replace(/\/\*[\s\S]*?\*\//g, '');
    const duz = Array.from(css.matchAll(/(?<![\w-])(\d+(?:\.\d+)?)px\b/g), match => match[1]!).filter(value => !TIP_OLCEGI.has(value));
    expect(duz).toEqual([]);
    const baslik = cssRules(css).find(rule => rule.selector === '.aile-drawer .aile-drawer-header');
    expect(declarations(baslik?.body ?? '')['min-height']).toBe('calc(2 * var(--aile-bosluk-8))');
  });

  it('hover tonu yalnız (hover: hover) altında: akordeon, Genel ve Projeler satırları dokunmatikte hover tonunda takılı kalmaz', () => {
    for (const path of ['admin/ui/AccordionList.css', 'admin/pages/GenelPage.css', 'admin/pages/ProjelerPage.css']) {
      const hover = cssRules(read(path)).filter(rule => rule.selector.includes(':hover'));
      expect(hover.length, path).toBeGreaterThan(0);
      for (const rule of hover) expect(rule.media, `${path} › ${rule.selector}`).toBe('@media (hover: hover)');
    }
  });

  // Kullanıcı tarayıcıda küçük yazı boyutu seçerse (kök 12 px) rem tabanlı değer küçülür; kural alt sınırı 14 px'tir
  // ve düğme etiketi gövde metniyle (admin.css .aile-admin 16 px) aynı ölçüde kalır. Büyük kökte büyüme korunur.
  it('Button.css: düğme etiketi ve devre dışı nedeni kök 10–12 px iken de 16 / 14 px; kök büyüyünce büyür', () => {
    const rules = cssRules(read('admin/ui/Button.css'));
    const boyut = (selector: string) => declarations(rules.find(rule => rule.selector === selector)?.body ?? '')['font-size'] ?? '';
    /** Yalnız bu dosyada kullanılan biçimler: Npx, Nrem, max(...). */
    const hesapla = (deger: string, kok: number): number => {
      const max = /^max\((.*)\)$/.exec(deger);
      if (max) return Math.max(...max[1]!.split(',').map(part => hesapla(part.trim(), kok)));
      const sayi = /^(\d+(?:\.\d+)?)(px|rem)$/.exec(deger);
      if (!sayi) throw new Error(`çözülemeyen yazı boyutu: ${deger}`);
      return Number(sayi[1]) * (sayi[2] === 'rem' ? kok : 1);
    };
    for (const kok of [10, 12, 16]) {
      expect(hesapla(boyut('.aile-dugme'), kok), `.aile-dugme kök ${kok}`).toBe(16);
      expect(hesapla(boyut('.aile-btn-neden'), kok), `.aile-btn-neden kök ${kok}`).toBe(14);
    }
    expect(hesapla(boyut('.aile-dugme'), 20)).toBe(20);
    expect(hesapla(boyut('.aile-btn-neden'), 20)).toBe(17.5);
  });
});
