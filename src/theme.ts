import { ActionIcon, Button, Checkbox, Chip, Input, SegmentedControl, Switch, createTheme, type CSSVariablesResolver, type MantineColorsTuple } from '@mantine/core';

// Sıcak nötr zemin (sand) + terracotta vurgu (ember). Emoji yok, ikon Phosphor.
const sand: MantineColorsTuple = [
  '#faf7f2', '#f3eee6', '#e8e0d3', '#d9ceba', '#c6b79e',
  '#b09f84', '#8f7f66', '#6e604b', '#4a4034', '#2b2520',
];
const ember: MantineColorsTuple = [
  '#fdf1ec', '#f9ddd1', '#f3bfa9', '#eb9d80', '#e07b5a',
  '#d4643f', '#c65d3b', '#a94a2d', '#883a22', '#5f2717',
];

// Açık temada 'light' rozet/düğme metinleri ve 'dimmed' metin AA kontrastı için koyulaştırılır.
const LIGHT_COLORS = ['ember', 'sand', 'teal', 'yellow', 'green', 'blue', 'red', 'orange', 'gray', 'cyan', 'grape', 'pink', 'lime', 'indigo', 'violet'];
export const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {},
  light: Object.fromEntries([
    ['--mantine-color-dimmed', 'var(--mantine-color-gray-7)'],
    ...LIGHT_COLORS.map((c) => [`--mantine-color-${c}-light-color`, `var(--mantine-color-${c}-8)`]),
    ...LIGHT_COLORS.map((c) => [`--mantine-color-${c}-outline`, `var(--mantine-color-${c}-8)`]),
  ]),
  dark: {},
});

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
  primaryShade: { light: 7, dark: 4 },
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
    // Dokunma hedefi ≥44 px (320×480 kuralı): görünmez native input'lu bileşenlerde dokunulan kutu gövde/etikettir.
    Switch: Switch.extend({ styles: { body: { minHeight: 44, alignItems: 'center' } } }),
    Checkbox: Checkbox.extend({ styles: (_theme, props) => (props.label ? { body: { minHeight: 44, alignItems: 'center' } } : {}) }),
    // Satır yüksekliğiyle ortalanır; `display: block` kalır (dar segmentte üç nokta çalışır).
    SegmentedControl: SegmentedControl.extend({ styles: { label: { minHeight: 44, paddingBlock: 0, lineHeight: '44px' } } }),
    Chip: Chip.extend({ styles: { label: { height: 44 } } }),
  },
});
