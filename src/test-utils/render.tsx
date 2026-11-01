import { render as rtlRender, type RenderOptions } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { DatesProvider } from '@mantine/dates';
import type { ReactElement, ReactNode } from 'react';
// Uygulama (LegacyApp) tarih yerelini yükler; testler aynı yerelle çalışsın ki görünen tarih metinleri üretimle aynı olsun.
import 'dayjs/locale/tr';
import { theme } from '../theme';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <MantineProvider theme={theme} env="test">
      <DatesProvider settings={{ locale: 'tr', firstDayOfWeek: 1 }}>
        <ModalsProvider>{children}</ModalsProvider>
      </DatesProvider>
    </MantineProvider>
  );
}

export function render(ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) {
  return rtlRender(ui, { wrapper: Providers, ...options });
}

export * from '@testing-library/react';
export { default as userEvent } from '@testing-library/user-event';
