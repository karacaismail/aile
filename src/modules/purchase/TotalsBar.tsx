import { Group, Paper, SegmentedControl, Text, Badge } from '@mantine/core';
import { WarnBadge } from '@/components/badges';
import type { Faz } from '@shared/schema';
import type { Totals } from '@/data/selectors';
import { formatTl } from '@/lib/price';
import classes from './TotalsBar.module.css';

export function TotalsBar({ faz, onFaz, totals }: { faz: Faz | 'hepsi'; onFaz: (f: Faz | 'hepsi') => void; totals: Totals }) {
  const range = totals.sumMin === totals.sumMax ? formatTl(totals.sumMin) : `${formatTl(totals.sumMin)}–${formatTl(totals.sumMax).replace('₺', '')}`;
  return (
    <Paper className={classes.bar} px="sm" py={6} radius={0} data-testid="totals-bar">
      <SegmentedControl
        fullWidth
        size="xs"
        value={faz}
        onChange={(v) => onFaz(v as Faz | 'hepsi')}
        data={[{ value: 'hepsi', label: 'Hepsi' }, { value: '1', label: 'Önce' }, { value: '2', label: 'Yerleşme' }, { value: '3', label: 'Bebek' }]}
        aria-label="Faz"
      />
      <Text fw={700} className="tabular" size="lg" mt={6} lineClamp={1} data-allow-clamp data-testid="totals-sum">{range}</Text>
      <Group gap={4} wrap="wrap" mt={2}>
        <Badge variant="default" size="xs">{totals.count} kalem</Badge>
        {totals.unpriced > 0 && <WarnBadge tone="info" size="xs">{totals.unpriced} fiyatsız</WarnBadge>}
        {totals.dueSoon > 0 && <WarnBadge tone="warn" size="xs">{totals.dueSoon} sipariş son tarihi</WarnBadge>}
        {totals.pendingDecision > 0 && <WarnBadge tone="warn" size="xs">{totals.pendingDecision} karar bekliyor</WarnBadge>}
      </Group>
    </Paper>
  );
}
