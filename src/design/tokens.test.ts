import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tokens, budgetEasing, chartMotion, cssTokens, dropdownTransition, designTokens, aileCssVars, adaptiveTokens } from './tokens';
import * as legacy from '../dashboard/tokens';

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
    expect(designTokens.fontSans).toBe('Outfit, system-ui, sans-serif');
    expect([designTokens.bosluk1, designTokens.bosluk2, designTokens.bosluk3, designTokens.bosluk4, designTokens.bosluk6, designTokens.bosluk8]).toEqual([4, 8, 12, 16, 24, 32]);
    expect([designTokens.koseKontrol, designTokens.koseKart, designTokens.kosePanel]).toEqual([8, 12, 16]);
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
    expect(aileCssVars['--aile-kose-panel']).toBe('16px');
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
