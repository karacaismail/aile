import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { theme } from '../ui/antd';
import { designTokens } from '../../design/tokens.ts';
import { importsOf } from '../adaptive/sourceRules';
import { aileTema, themeFor } from './antdTheme';

// Kaynak: aile-tasarim/tasarim-sistemi/README.md › "Ant Design 6 eşlemesi". Değerler oradan birebir;
// hex karşılaştırması büyük/küçük harften bağımsızdır.
const hex = (value: unknown) => String(value).toLowerCase();
const token = () => aileTema.token ?? {};
const component = <K extends keyof NonNullable<typeof aileTema.components>>(name: K) =>
  (aileTema.components?.[name] ?? {}) as Record<string, unknown>;

describe('aileTema (Ant Design 6 eşlemesi)', () => {
  it('uses the palette for text, action, borders and surfaces', () => {
    const t = token();
    expect(t.fontFamily).toBe('Outfit, system-ui, sans-serif');
    expect(hex(t.colorPrimary)).toBe('#326b94');
    expect(hex(t.colorLink)).toBe('#326b94');
    expect(hex(t.colorInfo)).toBe('#326b94');
    expect(hex(t.colorText)).toBe('#203a51');
    expect(hex(t.colorTextSecondary)).toBe('#52697c');
    expect(hex(t.colorTextTertiary)).toBe('#52697c');
    expect(hex(t.colorTextDisabled)).toBe('#52697c');
    expect(hex(t.colorSuccess)).toBe('#316653');
    expect(hex(t.colorWarning)).toBe('#805c22');
    expect(hex(t.colorError)).toBe('#9f4e48');
    expect(hex(t.colorSuccessBg)).toBe('#eff7f3');
    expect(hex(t.colorWarningBg)).toBe('#fcf8ee');
    expect(hex(t.colorErrorBg)).toBe('#fcf0ee');
    expect(hex(t.colorInfoBg)).toBe('#eaf1f6');
    expect(hex(t.colorBgLayout)).toBe('#f5f7fa');
    expect(hex(t.colorBgContainer)).toBe('#ffffff');
    expect(hex(t.colorBgElevated)).toBe('#ffffff');
    expect(hex(t.colorBgContainerDisabled)).toBe('#e1e9ef');
    expect(t.colorBgMask).toBe('rgba(27, 62, 85, 0.48)');
    expect(hex(t.colorBorder)).toBe('#52697c');
    expect(hex(t.colorBorderSecondary)).toBe('#dce4eb');
    expect(hex(t.colorSplit)).toBe('#dce4eb');
    expect(hex(t.controlItemBgHover)).toBe('#eaf1f6');
    expect(hex(t.controlItemBgActive)).toBe('#c9dbe7');
    expect(hex(t.controlItemBgActiveHover)).toBe('#c9dbe7');
  });

  it('keeps typography at or above 14 px with the design heading scale', () => {
    const t = token();
    expect(t.fontSize).toBe(16);
    expect(t.fontSizeSM).toBe(14);
    expect(t.fontSizeLG).toBe(18);
    expect(t.fontSizeHeading1).toBe(32);
    expect(t.fontSizeHeading2).toBe(24);
    expect(t.fontSizeHeading3).toBe(18);
    expect(theme.getDesignToken(aileTema).fontSizeSM).toBeGreaterThanOrEqual(14);
    expect(component('Tooltip').fontSize).toBe(14);
    expect(component('Pagination').fontSizeSM).toBe(14);
    expect(component('Badge').textFontSizeSM).toBe(14);
    expect(component('Table').cellFontSize).toBe(16);
  });

  it('sizes controls, radii, spacing and shadows from the design measures', () => {
    const t = token();
    expect(t.controlHeight).toBe(44);
    expect(t.controlHeightSM).toBe(44);
    expect(t.controlHeightLG).toBe(48);
    expect(t.borderRadius).toBe(8);
    expect(t.borderRadiusSM).toBe(8);
    expect(t.borderRadiusLG).toBe(12);
    expect(t.borderRadiusOuter).toBe(8);
    expect([t.paddingXXS, t.paddingXS, t.paddingSM, t.padding, t.paddingLG, t.paddingXL]).toEqual([4, 8, 12, 16, 24, 32]);
    expect(t.boxShadow).toBe('none');
    expect(t.boxShadowSecondary).toBe(designTokens.golgeYukseltilmis);
  });

  it('removes every focus ring and keeps one motion curve', () => {
    const t = token();
    expect(t.controlOutline).toBe('transparent');
    expect(t.controlOutlineWidth).toBe(0);
    expect(t.lineWidthFocus).toBe(0);
    // antd 6 tohum anahtarı: odakta görünür antd çizgisi kapalı (alias lineWidthFocus'u buradan da 0 türetir).
    expect(t.focusOutline).toBe(false);
    expect(t.motionDurationFast).toBe('0.24s');
    expect(t.motionDurationMid).toBe('0.24s');
    expect(t.motionDurationSlow).toBe('0.24s');
    expect(t.motionEaseInOut).toBe('cubic-bezier(.65,0,.35,1)');
    expect(t.motionEaseOut).toBe('cubic-bezier(.65,0,.35,1)');
    expect(t.zIndexBase).toBe(20);
    expect(t.zIndexPopupBase).toBe(300);
  });

  // Azaltılmış hareket süre tokenlarıyla ifade edilir; token.motion hep açık. antd ConfigProvider'ın MotionWrapper'ı
  // motion ilk kez false olunca alt ağacı MotionProvider ile sarar ve tüm uygulamayı yeniden kurar (odak/durum kaybı).
  it('keeps antd motion on and expresses reduced motion with zero durations (the curve is unchanged)', () => {
    for (const reduced of [false, true]) {
      const t = themeFor(reduced).token ?? {};
      expect(t.motion, `reduced=${reduced}`).toBe(true);
      const sure = reduced ? '0s' : `${designTokens.sure / 1000}s`;
      expect([t.motionDurationFast, t.motionDurationMid, t.motionDurationSlow], `reduced=${reduced}`).toEqual([sure, sure, sure]);
      expect(t.motionEaseInOut).toBe(designTokens.egri);
    }
    expect(themeFor(false).components).toBe(aileTema.components);
    expect(themeFor(true).components).toBe(aileTema.components);
  });

  it('maps Layout and Menu to the nav palette without an active bar', () => {
    const layout = component('Layout');
    expect(hex(layout.siderBg)).toBe('#1b3e55');
    expect(hex(layout.headerBg)).toBe('#1b3e55');
    expect(hex(layout.bodyBg)).toBe('#f5f7fa');
    const menu = component('Menu');
    expect(hex(menu.darkItemBg)).toBe('#1b3e55');
    expect(hex(menu.darkSubMenuItemBg)).toBe('#1b3e55');
    expect(hex(menu.darkItemColor)).toBe('#ffffff');
    expect(menu.darkItemHoverBg).toBe('rgba(166, 190, 208, 0.16)');
    expect(hex(menu.darkItemSelectedBg)).toBe('#c9dbe7');
    expect(hex(menu.darkItemSelectedColor)).toBe('#203a51');
    expect(menu.itemHeight).toBe(44);
    expect(menu.itemBorderRadius).toBe(8);
    expect(hex(menu.itemSelectedBg)).toBe('#c9dbe7');
    expect(hex(menu.itemSelectedColor)).toBe('#203a51');
    expect(hex(menu.itemHoverBg)).toBe('#eaf1f6');
    expect(menu.activeBarWidth).toBe(0);
    expect(menu.activeBarBorderWidth).toBe(0);
    expect(menu.activeBarHeight).toBe(0);
  });

  it('maps Table, Tag, Tabs, Select and Drawer surfaces', () => {
    const table = component('Table');
    expect(hex(table.headerBg)).toBe('#f5f7fa');
    expect(hex(table.headerColor)).toBe('#203a51');
    expect(hex(table.rowHoverBg)).toBe('#eaf1f6');
    expect(hex(table.rowSelectedBg)).toBe('#c9dbe7');
    expect(hex(table.rowSelectedHoverBg)).toBe('#c9dbe7');
    expect(hex(table.borderColor)).toBe('#dce4eb');
    expect(hex(component('Tag').defaultBg)).toBe('#e1e9ef');
    expect(hex(component('Tag').defaultColor)).toBe('#203a51');
    expect(hex(component('Tabs').itemSelectedColor)).toBe('#203a51');
    expect(component('Tabs').inkBarColor).toBe('transparent');
    expect(hex(component('Select').optionSelectedBg)).toBe('#c9dbe7');
    expect(hex(component('Select').optionActiveBg)).toBe('#eaf1f6');
    expect(component('Select').optionHeight).toBe(44);
    expect(component('Drawer').colorBgMask).toBe('rgba(27, 62, 85, 0.48)');
  });

  it('derived antd tokens keep the bridge: no font below 14 px, no focus ring, one duration and one curve', () => {
    const derived = theme.getDesignToken(themeFor(false)) as unknown as Record<string, unknown>;
    const small = Object.entries(derived).filter(([key, value]) => /^fontSize/.test(key) && typeof value === 'number' && value < 14);
    expect(small).toEqual([]);
    expect(derived.focusOutline).toBe(false);
    expect(derived.lineWidthFocus).toBe(0);
    expect(derived.controlOutlineWidth).toBe(0);
    expect(derived.controlOutline).toBe('transparent');
    const eases = Object.entries(derived).filter(([key]) => /^motionEase/.test(key));
    expect(eases.length).toBeGreaterThan(0);
    for (const [key, value] of eases) expect(value, key).toBe(designTokens.egri);
    const durations = Object.entries(derived).filter(([key]) => /^motionDuration/.test(key));
    expect(durations.length).toBeGreaterThan(0);
    for (const [key, value] of durations) expect(value, key).toBe(`${designTokens.sure / 1000}s`);
    const reduced = theme.getDesignToken(themeFor(true)) as unknown as Record<string, unknown>;
    expect(reduced.motion).toBe(true);
    const reducedDurations = Object.entries(reduced).filter(([key]) => /^motionDuration/.test(key));
    expect(reducedDurations.length).toBeGreaterThan(0);
    for (const [key, value] of reducedDurations) expect(value, key).toBe('0s');
  });

  it('is consumed only by adaptive/WideProviders at runtime and imports antd only as a type', () => {
    const repo = resolve(__dirname, '../../..');
    const src = resolve(repo, 'src');
    const users: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) { walk(path); continue; }
        if (!/\.(tsx?|mts)$/.test(entry) || /\.test\.(tsx?|mts)$/.test(entry)) continue;
        const refs = importsOf(readFileSync(path, 'utf8'));
        if (refs.some(ref => !ref.typeOnly && /(^|\/)antdTheme(\.ts)?$/.test(ref.specifier))) users.push(relative(repo, path).split('\\').join('/'));
      }
    };
    walk(src);
    expect(users).toEqual(['src/admin/adaptive/WideProviders.tsx']);
    const own = importsOf(readFileSync(resolve(__dirname, 'antdTheme.ts'), 'utf8'));
    expect(own.filter(ref => !ref.typeOnly && /^(antd|@ant-design)(\/|$)|(^|\/)antd(\.ts)?$/.test(ref.specifier))).toEqual([]);
  });

  it('derives every colour from designTokens instead of literal values', () => {
    const source = readFileSync(resolve(__dirname, 'antdTheme.ts'), 'utf8');
    expect(source).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(source).not.toMatch(/rgba?\(/);
    expect(source).toContain('designTokens');
  });
});
