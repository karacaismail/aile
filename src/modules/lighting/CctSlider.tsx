import { useId, type ComponentProps, type CSSProperties, type ReactNode } from 'react';
import { Box, Group, RangeSlider, Stack, Text } from '@mantine/core';
import { cctGradient, cctLabel } from '@/lib/cct';
import { CCT_RANGE } from './rules';
import classes from './CctSlider.module.css';

const MARKS = CCT_RANGE.marks.map((v) => ({ value: v, label: `${v}` }));
const GRADIENT = cctGradient(CCT_RANGE.min, CCT_RANGE.max);

/** CCT aralığı: 2200–6500 K, adım 100; ray renk sıcaklığı gradyanı. Tutamaç 44 px dokunma hedefi (kök yalnız ray kadar yüksek, dikey boşluk eklenir). */
export function CctSlider({ value, onChange, error }: { value: [number, number]; onChange: (v: [number, number]) => void; error?: ReactNode }) {
  const errorId = useId();
  return (
    <Stack gap="xs" style={{ '--cct-gradient': GRADIENT } as CSSProperties}>
      <Group justify="space-between" wrap="nowrap">
        <Text size="sm" fw={500}>Renk sıcaklığı (K)</Text>
        <Text size="sm" fw={600} className="tabular" data-testid="cct-value">{value[0]}–{value[1]} K</Text>
      </Group>
      <Box px="md" pt="var(--budget-clearField)" pb="lg">
      <RangeSlider
        min={CCT_RANGE.min} max={CCT_RANGE.max} step={CCT_RANGE.step} minRange={0}
        value={value} onChange={onChange} marks={MARKS} label={(v) => `${v} K`}
        size="lg" thumbSize={44} color="ember" mb="md"
        thumbFromLabel="CCT min" thumbToLabel="CCT max"
        // Each thumb is its stored bound for the form's first-error focus (`data-path`); an error is the pair's and
        // describes both thumbs.
        thumbProps={(index) => ({ 'data-path': index === 0 ? 'cct_min' : 'cct_max', ...(error ? { 'aria-invalid': true, 'aria-describedby': errorId } : {}) } as ComponentProps<'div'>)}
        classNames={{ track: classes.track, bar: classes.bar, thumb: classes.thumb, markLabel: classes.markLabel }}
      />
      </Box>
      <Text size="xs" c="dimmed">{value[0] === value[1] ? cctLabel(value[0]) : `${cctLabel(value[0])} → ${cctLabel(value[1])}`}</Text>
      {error ? <Text size="xs" c="var(--mantine-color-error)" id={errorId} data-testid="cct-error">{error}</Text> : null}
    </Stack>
  );
}
