import { tokens } from '../dashboard/tokens.ts';

// Build-time HTML only: no React, financial values, route fetches or persistence.
// The existing application replaces this root when its code and styles are ready.
const criticalTokens = {
  font: tokens.font, fontSmall: tokens.fontSmall, fontPayment: tokens.fontPayment,
  headingWeight: tokens.headingWeight, lineBody: tokens.lineBody,
  paper: tokens.paper, ink: tokens.ink, muted: tokens.muted, navy: tokens.navy,
  line: tokens.line, blue: tokens.blue, canvas: tokens.canvas,
  timelineOverviewMuted: tokens.timelineOverviewMuted,
  timelineStepRadius: tokens.timelineStepRadius, familySidebarWidth: tokens.familySidebarWidth,
  spacing: tokens.spacing, spaceSmall: tokens.spaceSmall, spaceSection: tokens.spaceSection,
  spaceWide: tokens.spaceWide, spaceTight: tokens.spaceTight,
  radius: tokens.radius, targetMin: tokens.targetMin, ruleWidth: tokens.ruleWidth,
  loadingDuration: tokens.loadingDuration, ease: tokens.ease,
  loadingSegmentWidth: tokens.loadingSegmentWidth, loadingTravel: tokens.loadingTravel,
  loadingTextHeight: tokens.loadingTextHeight, loadingTitleWidth: tokens.loadingTitleWidth,
  loadingTextWidth: tokens.loadingTextWidth, loadingValueWidth: tokens.loadingValueWidth,
};

// Inline before the entry module: even a failed entry download must end loading.
// Resource errors from later UI are ignored once React has replaced this shell.
export const startupFailureScript = `(() => {
  const fail = () => {
    const shell = document.querySelector('.app-startup');
    const status = shell?.querySelector('[role="status"]');
    if (!shell || !status) return;
    shell.setAttribute('aria-busy', 'false');
    status.setAttribute('role', 'alert');
    status.textContent = 'aile açılamadı. Bağlantınızı kontrol edip sayfayı yenileyin.';
  };
  document.addEventListener('aile:startup-error', fail);
  window.addEventListener('error', event => {
    if (!(event.target instanceof HTMLScriptElement) || event.target.type !== 'module') return;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fail, { once: true });
    else fail();
  }, true);
})();`;

export const startupMarkup = `<main class="app-startup" aria-busy="true" aria-label="aile yükleniyor">
  <div class="app-startup-brand"><strong>aile</strong><span>birlikte planla</span><div class="app-startup-navigation" aria-hidden="true"><i></i><i></i><i></i></div></div>
  <div class="app-startup-content"><p role="status">aile hazırlanıyor…</p><div class="app-startup-activity" aria-hidden="true"></div><div class="app-startup-placeholders" aria-hidden="true"><div><i></i><i></i><i></i></div><div><i></i><i></i><i></i></div><div><i></i><i></i><i></i></div></div><noscript>Devam etmek için tarayıcınızda JavaScript’i etkinleştirin.</noscript></div>
</main>`;

export const startupStyles = `
@font-face{font-family:Outfit;src:url('/aile/fonts/outfit-regular.ttf') format('truetype');font-style:normal;font-weight:400 500;font-display:swap}
body{margin:0}
.app-startup{${Object.entries(criticalTokens).map(([key,value]) => `--budget-${key}:${value}`).join(';')};box-sizing:border-box;min-height:100dvh;display:grid;align-content:start;font-family:var(--budget-font);font-size:var(--budget-fontSmall);line-height:var(--budget-lineBody);color:var(--budget-ink);background:var(--budget-paper)}
.app-startup *,.app-startup ::after{box-sizing:border-box}
.app-startup-brand{display:flex;align-items:baseline;flex-wrap:wrap;gap:var(--budget-spaceTight);padding:var(--budget-spacing);color:var(--budget-paper);background:var(--budget-navy)}
.app-startup-brand strong{font-size:var(--budget-fontPayment);font-weight:var(--budget-headingWeight)}
.app-startup-brand span{color:var(--budget-timelineOverviewMuted)}
.app-startup-navigation{display:none}
.app-startup-content{min-width:0;padding:var(--budget-spaceSection) var(--budget-spacing)}
.app-startup-content p{margin:0 0 var(--budget-spacing);color:var(--budget-muted)}
.app-startup-activity{height:var(--budget-ruleWidth);background:var(--budget-line);overflow:hidden;margin-bottom:var(--budget-spaceSection)}
.app-startup-activity::after{content:'';display:block;height:100%;width:var(--budget-loadingSegmentWidth);background:var(--budget-blue);animation:app-startup-travel var(--budget-loadingDuration) var(--budget-ease) infinite alternate}
@keyframes app-startup-travel{from{transform:translateX(0)}to{transform:translateX(var(--budget-loadingTravel))}}
.app-startup-placeholders{display:grid;gap:var(--budget-spaceSmall)}
.app-startup-placeholders>div{display:grid;gap:var(--budget-spacing);padding:var(--budget-spaceSection);background:var(--budget-canvas);border-radius:var(--budget-timelineStepRadius)}
.app-startup i{display:block;width:var(--budget-loadingTextWidth);height:var(--budget-loadingTextHeight);border-radius:var(--budget-radius);background:var(--budget-line)}
.app-startup-placeholders i:nth-child(2){width:var(--budget-loadingTitleWidth)}
.app-startup-placeholders i:nth-child(3){width:var(--budget-loadingValueWidth)}
@media(min-width:64em){.app-startup{grid-template-columns:var(--budget-familySidebarWidth) minmax(0,1fr);align-content:stretch}.app-startup-brand{display:block;padding:var(--budget-spaceSection) var(--budget-spacing)}.app-startup-brand span{display:block}.app-startup-navigation{display:grid;gap:var(--budget-spaceSection);margin-top:var(--budget-spaceWide)}.app-startup-navigation i{background:var(--budget-timelineOverviewMuted);height:var(--budget-targetMin);width:var(--budget-loadingTitleWidth)}.app-startup-content{padding:var(--budget-spaceSection) var(--budget-spaceWide)}}
@media(prefers-reduced-motion:reduce){.app-startup-activity::after{animation-duration:0s}}
.app-startup[aria-busy="false"] .app-startup-activity::after{animation-play-state:paused}
`;
