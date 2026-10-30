import { createTheme, type CSSVariablesResolver, type MantineColorsTuple } from '@mantine/core';
import { tokens } from './dashboard/tokens';

// One family identity. Legacy color names remain aliases so saved records keep their meaning.
const blue: MantineColorsTuple = [tokens.canvas, tokens.blueSurface, tokens.line, tokens.timelineViewSelectedSurface, tokens.lightBlue, '#769BB6', tokens.blue, tokens.navy, tokens.ink, '#142A3B'];
const neutral: MantineColorsTuple = [tokens.paper, tokens.canvas, tokens.blueSurface, tokens.line, tokens.timelineViewSelectedSurface, tokens.lightBlue, tokens.muted, tokens.ink, tokens.navy, '#142A3B'];
export const MIN_FONT = '1rem';
const transitionProps = { duration: tokens.duration, timingFunction: tokens.ease };
export const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: Object.fromEntries(Object.entries(tokens).map(([key, value]) => [`--budget-${key}`, key === 'duration' ? `${value}ms` : String(value)])),
  light: {
    '--mantine-color-body': tokens.paper, '--mantine-color-text': tokens.ink,
    '--mantine-color-dimmed': tokens.muted, '--mantine-color-placeholder': tokens.muted,
    '--mantine-color-default': tokens.paper, '--mantine-color-default-hover': tokens.blueSurface,
    '--mantine-color-default-border': tokens.line,
    ...Object.fromEntries(['aile', 'ember', 'sand', 'teal', 'yellow', 'green', 'blue', 'red', 'orange', 'gray', 'cyan', 'grape', 'pink', 'lime', 'indigo', 'violet'].flatMap(color => [[`--mantine-color-${color}-light-color`, `var(--mantine-color-${color}-8)`], [`--mantine-color-${color}-outline`, `var(--mantine-color-${color}-8)`]])),
  },
  dark: {},
});
export const theme = createTheme({
  fontFamily: tokens.font, fontFamilyMonospace: 'ui-monospace, Menlo, Consolas, monospace',
  headings: { fontFamily: tokens.font, fontWeight: String(tokens.headingWeight), sizes: {
    h1: { fontSize: '2rem', lineHeight: '1.2' }, h2: { fontSize: '1.5rem', lineHeight: '1.3' },
    h3: { fontSize: '1.125rem', lineHeight: '1.4' }, h4: { fontSize: '1rem', lineHeight: '1.5' },
    h5: { fontSize: '1rem', lineHeight: '1.5' }, h6: { fontSize: '1rem', lineHeight: '1.5' },
  } },
  fontSizes: { xs: MIN_FONT, sm: MIN_FONT, md: MIN_FONT, lg: '1.125rem', xl: '1.25rem' },
  lineHeights: { xs: '1.4', sm: '1.45', md: '1.5', lg: '1.5', xl: '1.4' },
  spacing: { xs: tokens.spaceDense, sm: tokens.spaceTight, md: tokens.spacing, lg: tokens.spaceSection, xl: tokens.spaceWide },
  radius: { xs: tokens.spaceDense, sm: tokens.radius, md: tokens.radius, lg: tokens.timelineStepRadius, xl: tokens.timelinePanelRadius },
  defaultRadius: tokens.radius, colors: { aile: blue, ember: blue, sand: neutral },
  primaryColor: 'aile', primaryShade: 7, autoContrast: true, white: tokens.paper, black: tokens.ink,
  breakpoints: { xs: '22.5em', sm: '48em', md: '64em', lg: '80em', xl: '90em' },
  components: {
    ActionIcon: { defaultProps: { size: 'xl', variant: 'subtle' } },
    Button: { styles: { root: { minHeight: tokens.targetMin, fontSize: MIN_FONT } } },
    Input: { styles: { input: { minHeight: tokens.targetMin, fontSize: MIN_FONT } } },
    InputWrapper: { styles: { label: { fontSize: MIN_FONT }, description: { fontSize: MIN_FONT }, error: { fontSize: MIN_FONT } } },
    Select: { defaultProps: { comboboxProps: { transitionProps } }, styles: { option: { minHeight: tokens.targetMin, fontSize: MIN_FONT } } },
    Badge: { defaultProps: { size: 'lg' }, styles: { root: { fontSize: MIN_FONT, height: 'auto', minHeight: 30, paddingBlock: 2, textTransform: 'none', letterSpacing: 0, fontWeight: tokens.labelWeight, lineHeight: 1.3 }, label: { overflow: 'visible' } } },
    Checkbox: { styles: { body: { minHeight: tokens.targetMin, alignItems: 'center' }, label: { fontSize: MIN_FONT } } },
    Switch: { styles: { body: { minHeight: tokens.targetMin, alignItems: 'center' }, label: { fontSize: MIN_FONT } } },
    SegmentedControl: { defaultProps: { transitionDuration: tokens.duration, transitionTimingFunction: tokens.ease }, styles: { label: { minHeight: tokens.targetMin, paddingBlock: 0, lineHeight: tokens.targetMin, fontSize: MIN_FONT } } },
    Chip: { styles: { label: { height: tokens.targetMin, fontSize: MIN_FONT } } },
    NavLink: { styles: { root: { minHeight: tokens.targetMin }, label: { fontSize: MIN_FONT } } },
    Stepper: { styles: { stepLabel: { fontSize: MIN_FONT }, stepDescription: { fontSize: MIN_FONT } } },
    Table: { styles: { table: { fontSize: MIN_FONT } } },
    Modal: { defaultProps: { transitionProps: { ...transitionProps, transition: 'slide-up' } } }, Drawer: { defaultProps: { transitionProps } },
  },
});
