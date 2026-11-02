import { useMemo, type ReactNode } from 'react';
import { themeFor } from '../theme/antdTheme';
import { ConfigProvider, trTR } from '../ui/antd';
import { useReducedMotion } from './useReducedMotion';

// src/admin/adaptive içinde antd yüzeyini içe aktaran TEK dosya (source-rules.test.ts). Geniş profilin tembel sağlayıcısı
// (App.tsx: wideResource('wide-providers', …); default export bu yüzden var): antd ConfigProvider + Türkçe yerel + aile
// teması. DOM öğesi çizmez, yalnız bağlam verir:
//  - antd App bileşeni yok: kabı antd özet sınıfını taşıdığı için antd'nin genel bağlantı sıfırlaması (a { transition:
//    color …; } eğrisiz = ease) ürünün kendi bağlantılarına da işliyordu. Hiçbir ürün bileşeni antd ya da App.useApp
//    kullanmaz; telefon da sağlayıcısız çalışır, iki profilde DOM aynı kalır.
//  - prefers-reduced-motion süre tokenlarıyla ifade edilir (themeFor): antd motion hep açık kalır, tercih çalışırken
//    değişince alt ağaç yeniden kurulmaz; odak ve durum korunur.
export function WideProviders({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion();
  const theme = useMemo(() => themeFor(reduced), [reduced]);
  return (
    <ConfigProvider theme={theme} locale={trTR}>
      {children}
    </ConfigProvider>
  );
}

export default WideProviders;
