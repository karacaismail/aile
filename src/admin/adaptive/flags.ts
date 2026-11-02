/**
 * Geçiş bayrağı (tek yer). true (geçiş kesimi, plan D8): telefon profili antd sağlayıcısı (ConfigProvider + App +
 * trTR + tema) olmadan çalışır; App.tsx WideProviders'ı wideResource('wide-providers', () => import('./adaptive/WideProviders'))
 * ile tembel yükler, sağlayıcı geniş profilde bağlanır ve sonra yapışkan kalır (telefona dönünce alt ağaç yeniden
 * bağlanmaz). false: sağlayıcı her profilde bağlı (kesim öncesi davranış; AdaptiveRoot phoneWithoutAntd={false} ile
 * testlerde sınanır). source-rules.test.ts bayrak true iken App.tsx'teki statik WideProviders importunu reddeder;
 * scripts/check-delivery.mjs --strict telefonun statik kapanışında antd/pro/icons/echarts/wide bulursa FAIL verir.
 */
export const PHONE_WITHOUT_ANTD: boolean = true;
