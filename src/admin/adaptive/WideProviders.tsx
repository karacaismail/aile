import type { ReactNode } from 'react';
import { themeFor } from '../theme/antdTheme';
import { AntApp, ConfigProvider, trTR } from '../ui/antd';
import { useReducedMotion } from './useReducedMotion';

// src/admin/adaptive içinde antd yüzeyini içe aktaran TEK dosya (source-rules.test.ts). antd ConfigProvider + App
// + Türkçe yerel + aile teması (reduced-motion'da antd hareketi kapalı). PHONE_WITHOUT_ANTD=false iken App.tsx bunu
// statik bağlar; bayrak çevrilince wideResource ile tembel yüklenir (default export bu yüzden var).
export function WideProviders({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion();
  return (
    <ConfigProvider theme={themeFor(reduced)} locale={trTR}>
      <AntApp>{children}</AntApp>
    </ConfigProvider>
  );
}

export default WideProviders;
