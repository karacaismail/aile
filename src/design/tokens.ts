import type { CSSProperties } from 'react';
export const tokens = {
  familyMaxWidth: '1480px', familySidebarWidth: '17rem', familyNavHover: '#264A63', familyOverlayOpacity: 0.5,
  dropdownMaxHeight: '220px',
  purchaseWorkspaceMin: 896, purchaseFilterWidth: '17rem', purchaseCardWidth: '19rem', purchaseDrawerWidth: '24rem',
  chartTrendHeight: '200px',
  chartValueSize: '1.25rem', chartValueWidth: '12rem',
  chartCategoryNameWidth: '11rem', chartCategoryValueWidth: '7rem',
  ink: '#203A51', muted: '#52697C', navy: '#1B3E55', paper: '#FFFFFF', canvas: '#F5F7FA',
  line: '#DCE4EB', blue: '#326B94', lightBlue: '#A6BED0', green: '#316653', red: '#9F4E48', amber: '#805C22',
  greenSurface: '#EFF7F3', redSurface: '#FCF0EE', blueSurface: '#EAF1F6', amberSurface: '#FCF8EE',
  font: 'Outfit, Arial, sans-serif', fontSmall: '1rem', radius: '8px', spacing: '16px',
  switchWidth:'44px', switchHeight:'26px', switchThumb:'18px', switchInset:'3px', switchTravel:'18px', targetMin:'44px',
  spaceTight: '8px', spaceSmall: '12px', spaceSection: '24px', spaceWide: '32px',
  ruleWidth: '1px', selectedWidth: '3px', fontMetric: '1.5rem', fontPayment: '2rem',
  photoHeight: '200px', editorColumns: '25% minmax(0,1fr)',
  vehicleSurface: '#F3F6F8', vehicleRadius: '12px', vehicleMaxWidth: '100%',
  sidebarViewportInset: '32px', sidebarMobileHeight: '65dvh',
  overviewColumns: 'minmax(0,.8fr) minmax(0,1.4fr)',
  spaceDense: '4px', paymentDateWidth: '10rem', paymentAmountWidth: '9rem',
  fontHeroMetric: 'clamp(2rem, 3.4vw, 2.75rem)', fontSection: '1.125rem',
  labelWeight: 500, headingWeight: 700, lineCompact: 1.25, lineBody: 1.5,
  metricTracking: '-.035em', focusOffset: '6px', focusThickness: '3px',
  loadingDuration: '1440ms', loadingSegmentWidth: '33.333%', loadingTravel: '200%',
  loadingTextHeight: '1rem', loadingTextWidth: '45%', loadingValueWidth: '65%', loadingTitleWidth: '75%',
  duration: 240, ease: 'cubic-bezier(.65, 0, .35, 1)',
  layerSticky: 20, layerDropdown: 300,
  timelineReadingWidth: '75ch', timelineFilterWidth: '20rem', timelineBalanceWidth: '22rem', timelineMetricWidth: '7.5rem',
  timelineMaxWidth: '1360px', timelineDateWidth: '5rem', timelineRailInset: '20px', timelineDotSize: '7px',
  timelineDateFont: '1.75rem', timelineRowColumns: 'minmax(0, 1fr) minmax(17rem, .85fr)',
  timelineIconSize: '20px', timelineSurface: '#F0F5F7', timelineSummaryRadius: '12px',
  timelineSidebarWidth: '18rem', timelineHeadingGap: '12px', timelineHeroSurface: '#EAF3EF',
  timelineStickyInset: '16px', timelineStepSurface: '#F0F4F7', timelineStepRadius: '12px',
  timelinePurchaseFactWidth: '11rem', timelineAccountSurface: '#FFFFFF',
  timelineOverviewSurface: '#1B3E55', timelineOverviewMuted: '#C9DBE7', timelineOverviewNegative: '#FFC4BB',
  timelinePanelRadius: '16px',
  timelineTableDateWidth: '9rem', timelineTableEventWidth: '20rem', timelineTableAmountWidth: '10rem',
  timelineTableNoteWidth: '25rem',
  timelineViewSelectedSurface: '#C9DBE7', timelineViewTabWidth: '3.5rem',
  timelineOverviewPositive: '#BFE3D2', timelineSelectedShadow: '0 8px 24px rgba(27, 62, 85, .2)',
  timelineBankNameWidth: '11rem',
  // Timeline surface grammar: canvas behind the steps < elevated step card < tinted inner groups.
  timelineFlowCanvas: '#E1E9EF', timelineStepShadow: '0 2px 4px rgba(27, 62, 85, .18), 0 8px 20px rgba(27, 62, 85, .14)',
  timelineCanvasInset: '12px', timelineStepGap: '40px', timelineDayGap: '48px', timelineSectionGap: '24px', timelineDivider: '#6C8294',
  timelineSourceSurface: '#EAF0F4',
} as const;
// ECharts' typed function adapter evaluates exactly the shared CSS curve.
export function budgetEasing(progress: number) {
  if (progress <= 0 || progress >= 1) return progress;
  let low = 0, high = 1;
  for (let i = 0; i < 24; i++) {
    const t = (low + high) / 2;
    const x = 3 * (1 - t) ** 2 * t * .65 + 3 * (1 - t) * t ** 2 * .35 + t ** 3;
    if (x < progress) low = t; else high = t;
  }
  const t = (low + high) / 2;
  return 3 * (1 - t) * t ** 2 + t ** 3;
}
export const chartMotion = (reduced: boolean) => ({ animation: !reduced, animationDuration: tokens.duration, animationDurationUpdate: tokens.duration, animationEasing: budgetEasing, animationEasingUpdate: budgetEasing });

export const cssTokens = Object.fromEntries(Object.entries(tokens).map(([key,value])=>[`--budget-${key}`,key==='duration'?`${value}ms`:value])) as CSSProperties;

export const dropdownTransition = { in: { transform: 'translateY(0)' }, out: { transform: 'translateY(-6px)' }, transitionProperty: 'transform' };

// Tasarım teslimi (aile-tasarim/tasarim-sistemi/tokens.json) — tek görsel kaynak. Adlar tasarımın camelCase hâli,
// değerler tokens.json'dan birebir; {referans} tokenlar kaynağına bağlanır. Sayılar CSS px (sure ms).
const palette = {
  metin: '#203A51', metinIkincil: '#52697C', nav: '#1B3E55', eylem: '#326B94', acikMavi: '#A6BED0',
  yuzey: '#FFFFFF', zemin: '#F5F7FA', listeZemin: '#E1E9EF', cizgi: '#DCE4EB', secili: '#C9DBE7', bilgiYuzey: '#EAF1F6',
  olumlu: '#316653', olumluYuzey: '#EFF7F3', hata: '#9F4E48', hataYuzey: '#FCF0EE', uyari: '#805C22', uyariYuzey: '#FCF8EE',
} as const;
export const designTokens = {
  ...palette,
  kenarKontrol: palette.metinIkincil, odak: palette.eylem, odakNav: palette.acikMavi, navMetin: palette.yuzey,
  navHover: 'rgba(166, 190, 208, 0.16)', navBasili: 'rgba(166, 190, 208, 0.28)', ortu: 'rgba(27, 62, 85, 0.48)',
  fontSans: 'Outfit, system-ui, sans-serif',
  bosluk1: 4, bosluk2: 8, bosluk3: 12, bosluk4: 16, bosluk6: 24, bosluk8: 32,
  koseKontrol: 8, koseKart: 12, kosePanel: 16,
  golgeYukseltilmis: '0 2px 4px rgba(27, 62, 85, 0.18), 0 8px 20px rgba(27, 62, 85, 0.14)',
  navGenislik: 272, filtreGenislik: 272, ayrintiGenislik: 384, icerikAzami: 1480,
  kirilimTablet: 600, kirilimGenis: 1024, hedefAsgari: 44, fotografListe: 56, odakKalinlik: 3, odakAralik: 4,
  sure: 240, egri: 'cubic-bezier(.65,0,.35,1)',
} as const;

const kebab = (name: string) => name.replace(/([a-z])([A-Z0-9])/g, '$1-$2').toLowerCase();
const cssValue = (name: string, value: string | number) => typeof value === 'number' ? `${value}${name === 'sure' ? 'ms' : 'px'}` : value;
/** `--aile-<kebab>` custom properties for the `.aile-admin` root (App applies them; admin.css keeps :root fallbacks). */
export const aileCssVars: Record<string, string> = Object.fromEntries(
  Object.entries(designTokens).map(([name, value]) => [`--aile-${kebab(name)}`, cssValue(name, value)]),
);
