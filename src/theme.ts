import { ActionIcon, Button, Input, createTheme, type MantineColorsTuple } from '@mantine/core';

// Sıcak nötr zemin (sand) + terracotta vurgu (ember). Emoji yok, ikon Phosphor.
const sand: MantineColorsTuple = [
  '#faf7f2', '#f3eee6', '#e8e0d3', '#d9ceba', '#c6b79e',
  '#b09f84', '#8f7f66', '#6e604b', '#4a4034', '#2b2520',
];
const ember: MantineColorsTuple = [
  '#fdf1ec', '#f9ddd1', '#f3bfa9', '#eb9d80', '#e07b5a',
  '#d4643f', '#c65d3b', '#a94a2d', '#883a22', '#5f2717',
];

export const theme = createTheme({
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  fontFamilyMonospace: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
  headings: { fontWeight: '700', fontFamily: 'inherit' },
  fontSizes: { xs: '12px', sm: '14px', md: '15px', lg: '17px', xl: '20px' },
  lineHeights: { xs: '1.35', sm: '1.4', md: '1.47', lg: '1.5', xl: '1.5' },
  // Dar ekranda sıkı boşluk; dokunma hedefi büyük kalır.
  spacing: { xs: '6px', sm: '10px', md: '14px', lg: '20px', xl: '28px' },
  radius: { xs: '4px', sm: '6px', md: '10px', lg: '14px', xl: '20px' },
  defaultRadius: 'md',
  colors: { sand, ember },
  primaryColor: 'ember',
  primaryShade: { light: 6, dark: 4 },
  white: '#fffdf9',
  black: '#1f1a16',
  other: {
    success: '#2f7d4f',
    warning: '#b7791f',
    tabBarHeight: 56,
    topBarHeight: 48,
  },
  components: {
    ActionIcon: ActionIcon.extend({ defaultProps: { size: 'xl', variant: 'subtle' } }),
    Button: Button.extend({ styles: { root: { minHeight: 44 } } }),
    Input: Input.extend({ styles: { input: { minHeight: 44, fontSize: 16 } } }),
  },
});
