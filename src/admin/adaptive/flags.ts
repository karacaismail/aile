/**
 * Geçiş bayrağı (tek yer). true (geçiş kesimi, plan D8 + t3-root): telefon profili antd olmadan çalışır ve uygulama
 * ağacı hiçbir profilde antd sağlayıcısıyla (WideProviders: ConfigProvider + trTR + tema) sarılmaz; ağaç biçimi profil
 * değişiminde sabittir. antd gerektiren geniş ada olursa sağlayıcıyı lazyWide(…, { antd: true }) yalnız o ada için
 * tembel yükler. source-rules.test.ts bayrak true iken App.tsx'teki statik WideProviders importunu reddeder;
 * scripts/check-delivery.mjs --strict telefonun statik kapanışında antd/pro/icons/echarts/wide bulursa FAIL verir.
 */
export const PHONE_WITHOUT_ANTD: boolean = true;
