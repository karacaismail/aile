import { ActionIcon, Badge, Button, Checkbox, Chip, Indicator, Input, NavLink, Radio, SegmentedControl, Stepper, Switch, Table, createTheme, type CSSVariablesResolver, type MantineColorsTuple } from '@mantine/core';

// Sıcak nötr zemin (sand) + terracotta vurgu (ember). Emoji yok, ikon Phosphor.
const sand: MantineColorsTuple = [
  '#faf7f2', '#f3eee6', '#e8e0d3', '#d9ceba', '#c6b79e',
  '#b09f84', '#8f7f66', '#6e604b', '#4a4034', '#2b2520',
];
const ember: MantineColorsTuple = [
  '#fdf1ec', '#f9ddd1', '#f3bfa9', '#eb9d80', '#e07b5a',
  '#d4643f', '#c65d3b', '#a94a2d', '#883a22', '#5f2717',
];

// Açık temada 'light' rozet/düğme metinleri ve 'dimmed' metin AA kontrastı için koyulaştırılır; koyu temada açılır.
const LIGHT_COLORS = ['ember', 'sand', 'teal', 'yellow', 'green', 'blue', 'red', 'orange', 'gray', 'cyan', 'grape', 'pink', 'lime', 'indigo', 'violet'];
export const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {},
  light: Object.fromEntries([
    ['--mantine-color-dimmed', 'var(--mantine-color-gray-7)'],
    ['--mantine-color-placeholder', 'var(--mantine-color-gray-7)'],
    ...LIGHT_COLORS.map((c) => [`--mantine-color-${c}-light-color`, `var(--mantine-color-${c}-8)`]),
    ...LIGHT_COLORS.map((c) => [`--mantine-color-${c}-outline`, `var(--mantine-color-${c}-8)`]),
  ]),
  // Koyu temada 'dimmed' (dark-2, 4,0:1) ve gri çerçeve metin için yetersiz → dark-1 (7,0:1) ve gray-3.
  dark: {
    '--mantine-color-dimmed': 'var(--mantine-color-dark-1)',
    '--mantine-color-placeholder': 'var(--mantine-color-dark-1)',
    '--mantine-color-gray-outline': 'var(--mantine-color-gray-3)',
  },
});

/**
 * Tipografi kuralı: içerik metni hiçbir yerde 1 rem'in altına inmez (kullanıcı kuralı).
 * Mantine'in kendi px ölçekli bileşenleri (Badge) de 1 rem'e sabitlenir.
 */
export const MIN_FONT = '1rem';

/**
 * Birincil dolgu metin rengi şemaya göre: Mantine `autoContrast` JS tarafında yalnız açık şemanın tonuna (ember-7) bakar,
 * bu yüzden koyu temada ember-4 üstünde beyaz (2,9:1) kalır. `--mantine-primary-color-contrast` ise şemaya göre çözülür
 * (açık: beyaz, koyu: siyah) → birincil renkli dolgulu bileşenlere onu veririz.
 */
const isPrimary = (color: unknown) => color == null || color === 'ember';
const PRIMARY_CONTRAST = 'var(--mantine-primary-color-contrast)';

export const theme = createTheme({
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  fontFamilyMonospace: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
  headings: {
    fontWeight: '700',
    fontFamily: 'inherit',
    sizes: {
      h1: { fontSize: '1.5rem', lineHeight: '1.3' },
      h2: { fontSize: '1.25rem', lineHeight: '1.35' },
      h3: { fontSize: '1.125rem', lineHeight: '1.4' },
      h4: { fontSize: '1.0625rem', lineHeight: '1.4' },
      h5: { fontSize: '1rem', lineHeight: '1.45' },
      h6: { fontSize: '1rem', lineHeight: '1.45' },
    },
  },
  // xs/sm/md hepsi 1 rem: küçük yazı yok; lg/xl vurgular.
  fontSizes: { xs: MIN_FONT, sm: MIN_FONT, md: MIN_FONT, lg: '1.125rem', xl: '1.25rem' },
  lineHeights: { xs: '1.4', sm: '1.45', md: '1.5', lg: '1.5', xl: '1.4' },
  // Dar ekranda sıkı boşluk; dokunma hedefi büyük kalır. Boşluk ölçeği ≥768'de kabukta genişletilir.
  spacing: { xs: '6px', sm: '10px', md: '14px', lg: '20px', xl: '28px' },
  radius: { xs: '4px', sm: '6px', md: '10px', lg: '14px', xl: '20px' },
  defaultRadius: 'md',
  colors: { sand, ember },
  primaryColor: 'ember',
  primaryShade: { light: 7, dark: 4 },
  // Koyu temada birincil dolgu ember-4 (açık turuncu): beyaz metin 2,9:1 kalır → otomatik koyu metin (5,9:1).
  autoContrast: true,
  white: '#fffdf9',
  black: '#1f1a16',
  breakpoints: { xs: '22.5em', sm: '48em', md: '64em', lg: '80em', xl: '90em' }, // 360 / 768 / 1024 / 1280 / 1440
  other: {
    success: '#2f7d4f',
    warning: '#b7791f',
    tabBarHeight: 60,
    topBarHeight: 52,
  },
  components: {
    ActionIcon: ActionIcon.extend({
      defaultProps: { size: 'xl', variant: 'subtle' },
      vars: (_theme, props) => ({ root: props.variant === 'filled' && isPrimary(props.color) ? { '--ai-color': PRIMARY_CONTRAST } : {} }),
    }),
    Indicator: Indicator.extend({ vars: (_theme, props) => ({ root: isPrimary(props.color) ? { '--indicator-text-color': PRIMARY_CONTRAST } : {} }) }),
    Button: Button.extend({
      styles: { root: { minHeight: 44, fontSize: MIN_FONT } },
      vars: (_theme, props) => ({ root: (props.variant ?? 'filled') === 'filled' && isPrimary(props.color) ? { '--button-color': PRIMARY_CONTRAST } : {} }),
    }),
    Input: Input.extend({ styles: { input: { minHeight: 44, fontSize: MIN_FONT } } }),
    InputWrapper: Input.Wrapper.extend({ styles: { label: { fontSize: MIN_FONT }, description: { fontSize: MIN_FONT }, error: { fontSize: MIN_FONT } } }),
    // Rozet: Mantine px ölçeği yerine 1 rem, normal harf, kendi yüksekliği.
    Badge: Badge.extend({
      defaultProps: { size: 'lg' },
      styles: {
        root: { fontSize: MIN_FONT, height: 'auto', minHeight: 30, paddingBlock: 2, paddingInline: 10, textTransform: 'none', letterSpacing: 0, fontWeight: 600, lineHeight: 1.3 },
        label: { overflow: 'visible' },
      },
    }),
    // Dokunma hedefi ≥44 px (320×480 kuralı): görünmez native input'lu bileşenlerde dokunulan kutu gövde/etikettir.
    Switch: Switch.extend({ styles: { body: { minHeight: 44, alignItems: 'center' }, label: { fontSize: MIN_FONT } } }),
    Checkbox: Checkbox.extend({
      styles: (_theme, props) => (props.label ? { body: { minHeight: 44, alignItems: 'center' }, label: { fontSize: MIN_FONT } } : {}),
      vars: (_theme, props) => ({ root: (props.variant ?? 'filled') === 'filled' && isPrimary(props.color) && !props.iconColor ? { '--checkbox-icon-color': PRIMARY_CONTRAST } : {} }),
    }),
    RadioIndicator: Radio.Indicator.extend({ vars: (_theme, props) => ({ indicator: isPrimary(props.color) && !props.iconColor ? { '--radio-icon-color': PRIMARY_CONTRAST } : {} }) }),
    // Satır yüksekliğiyle ortalanır; `display: block` kalır (dar segmentte üç nokta çalışır).
    SegmentedControl: SegmentedControl.extend({ styles: { label: { minHeight: 44, paddingBlock: 0, lineHeight: '44px', fontSize: MIN_FONT } } }),
    Chip: Chip.extend({ styles: { label: { height: 44, fontSize: MIN_FONT } } }),
    NavLink: NavLink.extend({ styles: { root: { minHeight: 44, borderRadius: 'var(--mantine-radius-md)' }, label: { fontSize: MIN_FONT } } }),
    Stepper: Stepper.extend({ styles: { stepLabel: { fontSize: MIN_FONT }, stepDescription: { fontSize: MIN_FONT } } }),
    Table: Table.extend({ styles: { table: { fontSize: MIN_FONT } } }),
  },
});
