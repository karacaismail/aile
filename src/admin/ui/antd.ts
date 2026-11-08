// Single raw-import surface for antd. Geçiş kesimi (plan D8) sonrası hiçbir ui sarmalayıcısı antd kullanmaz ve uygulama
// ağacı hiçbir profilde antd sağlayıcısıyla sarılmaz (t3-root: profile göre eklenen sarmalayıcı çalışma alanını yeniden
// kuruyordu). Yüzey yalnız antd adasının tembel sağlayıcısına (adaptive/WideProviders.tsx: ConfigProvider + tr_TR;
// lazyWide(…, { antd: true }) ile, bugün hiçbir ada istemez) ve antd temasının türüne (theme/antdTheme.ts: ThemeConfig)
// hizmet eder. `theme` antd varsayılan token türetimi için theme/antdTheme.test.ts tarafından kullanılır. antd App
// (AntApp) ihracı yok: hiçbir ürün bileşeni App.useApp kullanmaz. Pro Components ve kullanılmayan bileşen ihracı yok
// (boundary.test.ts her adın içe aktarıldığını kanıtlar). Telefon profili bu dosyayı statik olarak hiç çekmez
// (scripts/check-delivery.mjs --strict).
export { ConfigProvider, theme } from 'antd';
export type { ThemeConfig } from 'antd';
export { default as trTR } from 'antd/locale/tr_TR';
