import { useMemo } from 'react';
import { Box, Group, Paper, Stepper, Text } from '@mantine/core';
import type { Item } from '@shared/schema';
import { label } from '@shared/schema';
import { useAppStore } from '@/sync/store';
import { formatTlRange } from '@/lib/price';
import { formatTr } from '@/lib/dates';
import { selectLayers, selectPurchases } from './data';
import { estimateRange, groupByStep, isDueSoon, layerTitle, linkedPurchases, roadmapActive, type StepGroup } from './rules';
import classes from './lighting.module.css';

/** Adım gövdesi: Stepper.Step bir <button> olduğundan yalnız satır içi (span) öğeler kullanılır. */
function StepBody({ step, purchases, now }: { step: StepGroup; purchases: readonly Item[]; now: Date }) {
  if (step.layers.length === 0) return <Text component="span" size="xs" c="dimmed" className={classes.stepLine}>Katman yok</Text>;
  return (
    <Box component="span" className={classes.stepLine} data-testid={`step-${step.adim}`}>
      {step.layers.map((l) => {
        const linked = linkedPurchases(l, purchases);
        return (
          <Box component="span" key={l.id} className={classes.stepLine} mb={4}>
            <Text component="span" size="sm" className={classes.stepLine}>{label('oda', l.oda)} · {layerTitle(l)}</Text>
            {linked.map((p) => {
              const soon = isDueSoon(p.siparis_son_tarih, now);
              return (
                <Text component="span" key={p.id} size="xs" c={soon ? 'red.8' : 'dimmed'} fw={soon ? 600 : undefined} className={classes.stepLine} data-due={soon ? 'soon' : undefined}>
                  {p.ad}{p.siparis_son_tarih ? ` · son sipariş ${formatTr(p.siparis_son_tarih)}` : ''}
                </Text>
              );
            })}
          </Box>
        );
      })}
    </Box>
  );
}

export function RoadmapTab({ now = new Date() }: { now?: Date }) {
  const layers = useAppStore(selectLayers);
  const purchases = useAppStore(selectPurchases);
  const grouped = useMemo(() => groupByStep(layers), [layers]);
  const active = useMemo(() => roadmapActive(grouped.steps, purchases), [grouped, purchases]);
  const est = useMemo(() => estimateRange(layers), [layers]);
  return (
    <Box p="sm" className={classes.roadmap} data-testid="roadmap">
      <Paper withBorder p="sm" radius="md" className={classes.roadmapSummary}>
        <Group justify="space-between" wrap="nowrap" gap="xs">
          <Text size="sm" c="dimmed">Toplam tahmini</Text>
          <Text fw={700} size="lg" className="tabular" data-testid="roadmap-total">{formatTlRange(est.min, est.max)}</Text>
        </Group>
        <Text size="xs" c="dimmed">{est.priced}/{est.total} katman fiyatlı · {layers.length} katman, {purchases.length} satınalma kalemi</Text>
      </Paper>
      <Stepper active={active} orientation="vertical" iconSize={44} size="sm" allowNextStepsSelect={false} data-testid="roadmap-steps" className={classes.roadmapSteps}>
        {grouped.steps.map((s) => (
          <Stepper.Step key={s.adim} label={label('adim', s.adim)} allowStepSelect={false} description={<StepBody step={s} purchases={purchases} now={now} />} />
        ))}
      </Stepper>
      {grouped.unassigned.length > 0 && (
        <Text size="xs" c="dimmed" className={classes.roadmapNote}>Adımı belirlenmemiş {grouped.unassigned.length} katman: {grouped.unassigned.map((l) => `${label('oda', l.oda)} · ${layerTitle(l)}`).join(', ')}</Text>
      )}
    </Box>
  );
}
