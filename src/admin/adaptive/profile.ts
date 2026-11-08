import { adaptiveTokens, designTokens } from '../../design/tokens.ts';
import type { InputLayers, Profile } from '../shell/contracts';

// Uyarlamalı teslimin çekirdeği (React'siz). Tek üst düzey yerleşim profili kullanılabilir alandan seçilir:
// genişlik, yükseklik ve kısa kenar birlikte. Cihaz adı, user-agent veya isMobile yok.
//   phone   : genişlik < kirilimTablet (600) YA DA kısa kenar < kirilimKisaKenar (480) → yatay telefon telefon kalır
//   tablet  : 600 ≤ genişlik < kirilimGenis (1024), kısa kenar ≥ 480
//   desktop : genişlik ≥ 1024, kısa kenar ≥ 480
// Giriş katmanları (coarse/fine/hover) ayrı ve eklemelidir; profili değiştirmez. Klavye varlığı bunlardan çıkarılmaz
// (klavye modu: dashboard/keyboard.ts, html[data-keyboard]).
export type { InputLayers, Profile } from '../shell/contracts';
export interface Viewport { readonly width: number; readonly height: number }
export interface AdaptiveSnapshot { readonly profile: Profile; readonly input: InputLayers }

export const PROFILE_THRESHOLDS = Object.freeze({
  tablet: designTokens.kirilimTablet,
  desktop: designTokens.kirilimGenis,
  shortEdge: adaptiveTokens.kirilimKisaKenar,
});

/** Saf sınıflayıcı (CSS px). readAdaptive aynı kararı matchMedia ile verir; ikisi tablo testinde eşlenir. */
export function classifyProfile({ width, height }: Viewport): Profile {
  if (width < PROFILE_THRESHOLDS.tablet || Math.min(width, height) < PROFILE_THRESHOLDS.shortEdge) return 'phone';
  return width >= PROFILE_THRESHOLDS.desktop ? 'desktop' : 'tablet';
}

// Genişlik ≥ 600 iken kısa kenar < 480 ⇔ yükseklik < 480; bu yüzden tek max-height sorgusu yeter.
// min-width dizgeleri önceki device.ts ile birebir aynıdır (mevcut test mock'ları bunları çözer).
export const PROFILE_QUERIES = Object.freeze({
  tablet: `(min-width: ${PROFILE_THRESHOLDS.tablet}px)`,
  desktop: `(min-width: ${PROFILE_THRESHOLDS.desktop}px)`,
  short: `(max-height: ${PROFILE_THRESHOLDS.shortEdge - 0.02}px)`,
});
export const INPUT_QUERIES = Object.freeze({
  coarse: '(any-pointer: coarse)',
  fine: '(any-pointer: fine)',
  hover: '(any-hover: hover)',
});

export type AdaptiveWindow = Pick<Window, 'matchMedia' | 'addEventListener' | 'removeEventListener'>
  & Partial<Pick<Window, 'requestAnimationFrame' | 'cancelAnimationFrame'>>;

/** matchMedia yoksa (eski ortam, SSR) temel deneyim: telefon, katman yok. */
export const BASELINE_SNAPSHOT: AdaptiveSnapshot = Object.freeze({
  profile: 'phone',
  input: Object.freeze({ coarse: false, fine: false, hover: false }),
});

function currentWindow(): AdaptiveWindow | null {
  return typeof window === 'undefined' || typeof window.matchMedia !== 'function' ? null : window;
}

/** Eşzamanlı okuma: ilk render'dan önce çağrılır (yerleşim zıplaması yok). */
export function readAdaptive(win: AdaptiveWindow | null = currentWindow()): AdaptiveSnapshot {
  if (!win || typeof win.matchMedia !== 'function') return BASELINE_SNAPSHOT;
  const matches = (query: string) => win.matchMedia(query).matches;
  const profile: Profile = !matches(PROFILE_QUERIES.tablet) || matches(PROFILE_QUERIES.short)
    ? 'phone'
    : matches(PROFILE_QUERIES.desktop) ? 'desktop' : 'tablet';
  return {
    profile,
    input: { coarse: matches(INPUT_QUERIES.coarse), fine: matches(INPUT_QUERIES.fine), hover: matches(INPUT_QUERIES.hover) },
  };
}

export function sameSnapshot(a: AdaptiveSnapshot, b: AdaptiveSnapshot): boolean {
  return a.profile === b.profile && a.input.coarse === b.input.coarse && a.input.fine === b.input.fine && a.input.hover === b.input.hover;
}

export type AdaptiveAttributeName = 'data-profile' | 'data-input-coarse' | 'data-input-fine' | 'data-input-hover';
const ATTRIBUTE_NAMES: readonly AdaptiveAttributeName[] = ['data-profile', 'data-input-coarse', 'data-input-fine', 'data-input-hover'];

/** Kök öznitelikleri: data-profile="phone|tablet|desktop"; data-input-* yalnız katman açıkken (değer ""). */
export function adaptiveAttributes(snapshot: AdaptiveSnapshot): Record<AdaptiveAttributeName, string | undefined> {
  const layer = (on: boolean) => (on ? '' : undefined);
  return {
    'data-profile': snapshot.profile,
    'data-input-coarse': layer(snapshot.input.coarse),
    'data-input-fine': layer(snapshot.input.fine),
    'data-input-hover': layer(snapshot.input.hover),
  };
}

/** Öznitelikleri bir öğeye yazar (ör. <html>, body'ye portallanan katmanlar için); dönen fonksiyon hepsini siler. */
export function applyAdaptiveAttributes(element: Element, snapshot: AdaptiveSnapshot): () => void {
  for (const [name, value] of Object.entries(adaptiveAttributes(snapshot))) {
    if (value === undefined) element.removeAttribute(name);
    else element.setAttribute(name, value);
  }
  return () => { for (const name of ATTRIBUTE_NAMES) element.removeAttribute(name); };
}

/**
 * Profil ve katmanları izler. matchMedia 'change' eşik başına tek, ayrık bir olaydır: hemen yeniden değerlendirilir
 * (React aynı görevdeki güncellemeleri toplar). Sürekli akan resize/orientationchange tek animasyon karesinde
 * birleştirilir. Dönen fonksiyon bütün dinleyicileri ve bekleyen kareyi bırakır.
 */
export function watchAdaptive(onChange: (snapshot: AdaptiveSnapshot) => void, win: AdaptiveWindow | null = currentWindow()): () => void {
  if (!win || typeof win.matchMedia !== 'function') return () => {};
  const lists = [...Object.values(PROFILE_QUERIES), ...Object.values(INPUT_QUERIES)].map(query => win.matchMedia(query));
  let frame: number | null = null;
  const cancel = () => {
    if (frame !== null) win.cancelAnimationFrame?.(frame);
    frame = null;
  };
  const evaluate = () => { cancel(); onChange(readAdaptive(win)); };
  const schedule = () => {
    if (frame !== null) return;
    if (typeof win.requestAnimationFrame !== 'function') { evaluate(); return; }
    frame = win.requestAnimationFrame(() => { frame = null; onChange(readAdaptive(win)); });
  };
  for (const list of lists) list.addEventListener('change', evaluate);
  win.addEventListener('resize', schedule);
  win.addEventListener('orientationchange', schedule);
  return () => {
    cancel();
    for (const list of lists) list.removeEventListener('change', evaluate);
    win.removeEventListener('resize', schedule);
    win.removeEventListener('orientationchange', schedule);
  };
}
