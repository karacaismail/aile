import { Badge, Box, Card, Group, Stack, Text } from '@mantine/core';
import { useLocation } from 'wouter';
import type { Item } from '@shared/schema';
import { label } from '@shared/schema';
import { WarnBadge } from '@/components/badges';
import { formatTr } from '@/lib/dates';
import { TASK_RESOLVED, depsResolved, taskDurumLabel } from './rules';
import classes from './renovation.module.css';

const DURUM_COLOR: Record<string, string> = { fikir: 'gray.5', arastirma: 'blue.6', karar: 'ember.6', siparis: 'yellow.6', teslim: 'teal.6', kuruldu: 'green.7', iptal: 'red.6' };

/** Tadilat durumu: nötr rozet + renkli nokta, yerel etiket. */
export function TaskDurumBadge({ value }: { value?: string }) {
  if (!value) return null;
  const color = (DURUM_COLOR[value] ?? 'gray.5').replace('.', '-');
  return (
    <Badge size="xs" variant="default" leftSection={<Box component="span" aria-hidden style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: `var(--mantine-color-${color})` }} />}>
      {taskDurumLabel(value)}
    </Badge>
  );
}

function izinTone(d?: string): 'ok' | 'warn' | 'danger' | 'info' {
  if (d === 'alindi' || d === 'gerekmez') return 'ok';
  if (d === 'reddedildi') return 'danger';
  if (d === 'istendi') return 'info';
  return 'warn';
}

export function TaskCard({ task, tasks }: { task: Item; tasks: readonly Item[] }) {
  const [, navigate] = useLocation();
  const done = !!task.durum && TASK_RESOLVED.has(task.durum) && task.durum !== 'iptal';
  const deps = task.bagimlilik?.filter(Boolean) ?? [];
  const resolved = depsResolved(task, tasks);
  const go = () => navigate(`~/tadilat/isler/${task.id}`);
  return (
    <Card withBorder radius="md" p="sm" className={classes.card} data-testid="task-card" data-done={done || undefined} data-cancelled={task.durum === 'iptal' || undefined}>
      <Stack gap={4} className={classes.linkArea} role="link" tabIndex={0} aria-label={`${task.ad} detayı`} onClick={go} onKeyDown={(e) => { if (e.key === 'Enter') go(); }}>
        <Group gap={6} wrap="nowrap" align="flex-start" style={{ minWidth: 0 }}>
          <Badge size="sm" variant="filled" color="sand.8" className="tabular" style={{ flexShrink: 0 }} data-testid="task-kod">{task.kod ?? '—'}</Badge>
          <Text fw={600} className={classes.title}>{task.ad}</Text>
        </Group>
        <Group gap={4} wrap="wrap">
          <TaskDurumBadge value={task.durum} />
          {task.is_kim?.map((k) => <Badge key={k} size="xs" variant="outline" color="gray">{label('is_kim', k)}</Badge>)}
          {task.izin_gerekli && <WarnBadge tone={izinTone(task.izin_durumu)}>İzin: {label('izin_durumu', task.izin_durumu) || 'gerekli'}</WarnBadge>}
          {deps.length > 0 && <WarnBadge tone={resolved ? 'ok' : 'info'}>Bağımlı: {deps.join(', ')}</WarnBadge>}
        </Group>
        <Text size="xs" c="dimmed" className="tabular">
          {task.planlanan_tarih ? formatTr(task.planlanan_tarih) : 'Tarih yok'}
          {task.sure_gun ? <Text span size="xs" c="dimmed"> · {task.sure_gun} gün</Text> : null}
          {task.bitis_tarihi ? <Text span size="xs" c="dimmed"> → {formatTr(task.bitis_tarihi)}</Text> : null}
        </Text>
      </Stack>
    </Card>
  );
}
