// Uyarlamalı teslim yüzeyi. WideProviders bilerek burada yok: antd grafiğini bu barrel'a (ve telefon yoluna) sokmaz;
// antd gerektiren geniş ada onu lazyWide(…, { antd: true }) ile tembel alır. testing.ts de yok (yalnız testler içindir).
export {
  BASELINE_SNAPSHOT, INPUT_QUERIES, PROFILE_QUERIES, PROFILE_THRESHOLDS, adaptiveAttributes, applyAdaptiveAttributes,
  classifyProfile, readAdaptive, sameSnapshot, watchAdaptive,
} from './profile';
export type { AdaptiveSnapshot, AdaptiveWindow, InputLayers, Profile, Viewport } from './profile';
export { AdaptiveProvider, InputLayersContext, ProfileContext, useAdaptiveWatcher, useInputLayers, useProfile } from './context';
export {
  Adaptive, WIDE_RETRY_DELAY_MS, WideNotice, WideOnly, isChunkLoadError, lazyResource, lazyWide, useWideLoading, useWideModule, wideManifest,
  wideResource,
} from './loader';
export type { AdaptiveProps, LazyWideOptions, WideComponent, WideOptions, WideProps, WideResource, WideState, WideStatus } from './loader';
export { AdaptiveRoot } from './AdaptiveRoot';
export type { AdaptiveRootProps, ProvidersComponent, ProvidersSource } from './AdaptiveRoot';
export { PHONE_WITHOUT_ANTD } from './flags';
export { useReducedMotion } from './useReducedMotion';
