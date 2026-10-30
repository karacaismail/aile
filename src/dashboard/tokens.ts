import type { CSSProperties } from 'react';
export const tokens = {
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
  timelineMaxWidth: '1360px', timelineDateWidth: '6rem', timelineRailInset: '20px', timelineDotSize: '7px',
  timelineDateFont: '1.75rem', timelineRowColumns: 'minmax(0, 1fr) minmax(17rem, .85fr)',
  timelineIconSize: '20px', timelineSurface: '#F0F5F7', timelineSummaryRadius: '12px',
  timelineSidebarWidth: '18rem', timelineHeadingGap: '12px', timelineHeroSurface: '#EAF3EF',
  timelineStickyInset: '16px', timelineStepSurface: '#F0F4F7', timelineStepRadius: '12px',
  timelineOverviewSurface: '#1B3E55', timelineOverviewMuted: '#C9DBE7', timelineOverviewNegative: '#FFC4BB',
  timelinePanelRadius: '16px',
  timelineTableDateWidth: '9rem', timelineTableEventWidth: '20rem', timelineTableAmountWidth: '10rem',
  timelineTableNoteWidth: '25rem',
  timelineViewSelectedSurface: '#C9DBE7', timelineViewTabWidth: '3.5rem',
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
