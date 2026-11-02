import { designTokens as d, tokens } from '../../design/tokens.ts';
import type { ThemeConfig } from '../ui/antd';

// Ant Design 6 eşlemesi: aile-tasarim/tasarim-sistemi/README.md › "Ant Design 6 eşlemesi".
// Yalnız geniş profilin sağlayıcısı (adaptive/WideProviders) kullanır; telefon profili antd'siz çalışır. antd yalnız tür olarak.
// Her değer designTokens'tan türer; sabit renk yok. Odak halkası yok (admin.css alt çizgiyi çizer),
// Menu etkin şeridi yok, 14 px altı metin yok, tek 240 ms süre ve tek eğri.
const sure = `${d.sure / 1000}s`;
export const aileTema: ThemeConfig = {
  token: {
    fontFamily: d.fontSans,
    fontSize: 16, fontSizeSM: 14, fontSizeLG: 18,
    fontSizeHeading1: 32, fontSizeHeading2: 24, fontSizeHeading3: 18, fontSizeHeading4: 16, fontSizeHeading5: 16,
    lineHeight: 1.5, fontWeightStrong: 600,
    colorText: d.metin, colorTextSecondary: d.metinIkincil, colorTextTertiary: d.metinIkincil, colorTextDisabled: d.metinIkincil,
    colorPrimary: d.eylem, colorLink: d.eylem, colorInfo: d.eylem,
    colorSuccess: d.olumlu, colorWarning: d.uyari, colorError: d.hata,
    colorSuccessBg: d.olumluYuzey, colorWarningBg: d.uyariYuzey, colorErrorBg: d.hataYuzey, colorInfoBg: d.bilgiYuzey,
    colorBgLayout: d.zemin, colorBgContainer: d.yuzey, colorBgElevated: d.yuzey,
    colorBgContainerDisabled: d.listeZemin, colorBgMask: d.ortu,
    colorBorder: d.kenarKontrol, colorBorderSecondary: d.cizgi, colorSplit: d.cizgi,
    controlItemBgHover: d.bilgiYuzey, controlItemBgActive: d.secili, controlItemBgActiveHover: d.secili,
    borderRadius: d.koseKontrol, borderRadiusSM: d.koseKontrol, borderRadiusLG: d.koseKart, borderRadiusOuter: d.koseKontrol,
    borderRadiusXS: d.koseKontrol / 2,
    controlHeight: d.hedefAsgari, controlHeightSM: d.hedefAsgari, controlHeightLG: 48,
    padding: d.bosluk4, paddingSM: d.bosluk3, paddingXS: d.bosluk2, paddingXXS: d.bosluk1, paddingLG: d.bosluk6, paddingXL: d.bosluk8,
    boxShadow: 'none',
    boxShadowSecondary: d.golgeYukseltilmis,
    // antd 6 tohum anahtarı focusOutline=false: bileşenlerin genFocusOutline çizgisi kapalı (alias lineWidthFocus 0 türetir);
    // açık 0 değerleri ileride türetme değişse de halkayı kapalı tutar.
    focusOutline: false, controlOutline: 'transparent', controlOutlineWidth: 0, lineWidthFocus: 0,
    motionDurationFast: sure, motionDurationMid: sure, motionDurationSlow: sure,
    motionEaseInOut: d.egri, motionEaseOut: d.egri, motionEaseInOutCirc: d.egri, motionEaseOutCirc: d.egri,
    motionEaseOutBack: d.egri, motionEaseInBack: d.egri, motionEaseInQuint: d.egri, motionEaseOutQuint: d.egri,
    zIndexBase: tokens.layerSticky, zIndexPopupBase: tokens.layerDropdown,
  },
  components: {
    Layout: { siderBg: d.nav, bodyBg: d.zemin, headerBg: d.nav },
    Menu: {
      darkItemBg: d.nav, darkSubMenuItemBg: d.nav, darkItemColor: d.navMetin,
      darkItemHoverBg: d.navHover, darkItemSelectedBg: d.secili, darkItemSelectedColor: d.metin,
      itemHeight: d.hedefAsgari, itemBorderRadius: d.koseKontrol,
      itemSelectedBg: d.secili, itemSelectedColor: d.metin, itemHoverBg: d.bilgiYuzey,
      activeBarWidth: 0, activeBarBorderWidth: 0, activeBarHeight: 0,
    },
    Table: {
      headerBg: d.zemin, headerColor: d.metin, rowHoverBg: d.bilgiYuzey, rowSelectedBg: d.secili, rowSelectedHoverBg: d.secili,
      borderColor: d.cizgi, cellFontSize: 16, cellFontSizeSM: 14,
    },
    Tag: { defaultBg: d.listeZemin, defaultColor: d.metin, fontSizeSM: 14 },
    Tabs: { itemSelectedColor: d.metin, inkBarColor: 'transparent' },
    Select: { optionSelectedBg: d.secili, optionActiveBg: d.bilgiYuzey, optionHeight: d.hedefAsgari },
    Drawer: { colorBgMask: d.ortu },
    Tooltip: { fontSize: 14 },
    Pagination: { fontSizeSM: 14 },
    Badge: { textFontSizeSM: 14 },
    Button: { fontSizeSM: 14, paddingInline: d.bosluk4 },
  },
};
/** Önceki ad; App `themeFor` kullanır. */
export const antdTheme = aileTema;

export function themeFor(reducedMotion: boolean): ThemeConfig {
  return { ...aileTema, token: { ...aileTema.token, motion: !reducedMotion } };
}
