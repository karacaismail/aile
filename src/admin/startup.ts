import { installKeyboardMode } from '../dashboard/keyboard.ts';
import { aileCssVars } from '../design/tokens.ts';

// Build-time inline script for admin.html (vite.config.ts transformIndexHtml), injected before the entry module:
//  1. the same keyboard-mode installer the main entry uses, so an early Tab counts;
//  2. a plain-HTML failure screen for an entry module that cannot load (a stale admin.html from the HTTP cache naming
//     chunks a new deploy removed, or a dropped connection). Without it the page stays blank. It is drawn only while
//     the React root is still empty, so later resource errors never replace a running panel. Lazy page chunks are
//     not script elements; their failures go to preloadRecovery.ts and the route error boundary instead.
// No React, data or persistence here; colours, spacing, radius and focus come from tokens.ts (--aile-*).

export const ADMIN_STARTUP_FAILURE = {
  title: 'Uygulama yüklenemedi',
  text: 'Bağlantınızı kontrol edip sayfayı yenileyin.',
  action: 'Yenile',
} as const;

// Only the tokens the screen uses; values come from designTokens through aileCssVars (one source).
const TOKENS = [
  'metin', 'metin-ikincil', 'yuzey', 'eylem', 'nav', 'nav-metin', 'odak', 'font-sans',
  'bosluk-1', 'bosluk-2', 'bosluk-4', 'bosluk-6', 'kose-kontrol', 'hedef-asgari', 'odak-kalinlik', 'odak-aralik',
] as const;
const tokenDeclarations = TOKENS.map((name) => {
  const value = aileCssVars[`--aile-${name}`];
  if (value === undefined) throw new Error(`admin startup: --aile-${name} tokens.ts içinde yok`);
  return `--aile-${name}:${value}`;
}).join(';');

// Type sizes follow admin.css (body 16/24, h2 scale 24/32). The coarse-input target is 44 + 4 = 48 px.
// Focus: no surrounding ring; one underline below the button, only in keyboard mode; forced-colors gets an outline.
const styles = [
  "@font-face{font-family:Outfit;src:url('/aile/fonts/outfit-regular.ttf') format('truetype');font-style:normal;font-weight:400 500;font-display:swap}",
  "@font-face{font-family:Outfit;src:url('/aile/fonts/outfit-bold.ttf') format('truetype');font-style:normal;font-weight:600 800;font-display:swap}",
  'body{margin:0}',
  `.aile-startup-failure{${tokenDeclarations};box-sizing:border-box;min-height:100vh;min-height:100dvh;display:grid;align-content:start;justify-items:start;gap:var(--aile-bosluk-4);padding:var(--aile-bosluk-6) var(--aile-bosluk-4);font-family:var(--aile-font-sans);font-size:16px;line-height:24px;color:var(--aile-metin);background:var(--aile-yuzey)}`,
  '.aile-startup-failure h1{margin:0 0 var(--aile-bosluk-2);font-size:24px;line-height:32px;font-weight:600}',
  '.aile-startup-failure p{margin:0;color:var(--aile-metin-ikincil)}',
  '.aile-startup-failure button{position:relative;min-height:var(--aile-hedef-asgari);min-width:var(--aile-hedef-asgari);padding:0 var(--aile-bosluk-4);border:0;border-radius:var(--aile-kose-kontrol);background:var(--aile-eylem);color:var(--aile-nav-metin);font:inherit;font-weight:500;cursor:pointer}',
  '.aile-startup-failure button:focus,.aile-startup-failure button:focus-visible{outline:none;box-shadow:none}',
  "html[data-keyboard='true'] .aile-startup-failure button:focus-visible::after{content:'';position:absolute;left:0;right:0;bottom:calc(-1 * (var(--aile-odak-aralik) + var(--aile-odak-kalinlik)));height:var(--aile-odak-kalinlik);background:var(--aile-odak);pointer-events:none}",
  '@media (any-hover:hover){.aile-startup-failure button:hover{background:var(--aile-nav)}}',
  '@media (any-pointer:coarse){.aile-startup-failure button{min-height:calc(var(--aile-hedef-asgari) + var(--aile-bosluk-1))}}',
  "@media (forced-colors:active){html[data-keyboard='true'] .aile-startup-failure button:focus-visible{outline:2px solid CanvasText}}",
].join('\n');

const markup = `<main class="aile-startup-failure" aria-labelledby="aile-startup-failure-title"><div role="alert"><h1 id="aile-startup-failure-title">${ADMIN_STARTUP_FAILURE.title}</h1><p>${ADMIN_STARTUP_FAILURE.text}</p></div><button type="button">${ADMIN_STARTUP_FAILURE.action}</button></main>`;

/** Serialised into admin.html: only globals and its own parameters. A module script that fails to load (the entry
 *  or one of its static chunks) fires `error` on its element; window capture sees it although it does not bubble. */
export function installAdminStartupFailure(html: string, css: string, reload: () => void): void {
  let shown = false;
  const show = () => {
    const root = document.getElementById('admin-root');
    if (shown || !root || root.childElementCount > 0) return;
    shown = true;
    const style = document.createElement('style');
    style.setAttribute('data-admin-startup-failure', '');
    style.textContent = css;
    document.head.append(style);
    root.innerHTML = html;
    root.querySelector('button')?.addEventListener('click', () => reload());
  };
  window.addEventListener('error', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLScriptElement) || target.type !== 'module') return;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show, { once: true });
    else show();
  }, true);
}

// `<` is escaped so no string can close the inline <script>.
const literal = (value: string) => JSON.stringify(value).replace(/</g, '\\u003c');

export const adminStartupScript = `(${installKeyboardMode.toString()})();
(${installAdminStartupFailure.toString()})(${literal(markup)},${literal(styles)},() => location.reload());`;
