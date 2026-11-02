// Single raw-import surface for antd. Geçiş kesimi (plan D8) sonrası hiçbir ui sarmalayıcısı antd kullanmaz: yüzey
// yalnız geniş profilin tembel sağlayıcısına (adaptive/WideProviders.tsx: ConfigProvider + App + tr_TR) ve antd temasının
// türüne (theme/antdTheme.ts: ThemeConfig) hizmet eder. `theme` antd varsayılan token türetimi için theme/antdTheme.test.ts
// tarafından kullanılır. Pro Components ve kullanılmayan bileşen ihracı yok (boundary.test.ts her adın içe aktarıldığını
// kanıtlar). Telefon profili bu dosyayı statik olarak hiç çekmez (scripts/check-delivery.mjs --strict).
export { ConfigProvider, theme, App as AntApp } from 'antd';
export type { ThemeConfig } from 'antd';
export { default as trTR } from 'antd/locale/tr_TR';
