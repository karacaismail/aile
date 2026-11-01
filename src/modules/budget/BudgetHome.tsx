import { useEffect, useMemo, useState } from 'react';
import { ActionIcon, Box, Group, Paper, Progress, Stack, Text, Title, UnstyledButton, EmptyState } from '@mantine/core';
import { CaretLeftIcon } from '@phosphor-icons/react/dist/csr/CaretLeft';
import { CaretRightIcon } from '@phosphor-icons/react/dist/csr/CaretRight';
import { ReceiptIcon } from '@phosphor-icons/react/dist/csr/Receipt';
import { useAppStore } from '@/sync/store';
import { FactList, SourceNote, SectionHeading, JourneyLinks } from '@/components/Info';
import { Fab } from '@/app/shell/Fab';
import { formatTl } from '@/lib/price';
import { formatTr, todayIso } from '@/lib/dates';
import { monthLabel, monthOf, monthSummary, shiftMonth, type SummaryRow } from './rules';
import { onExpenseSaved, openExpense } from './quick';
import classes from './budget.module.css';

function pct(actual: number, plan: number): number {
  if (plan <= 0) return actual > 0 ? 100 : 0;
  return Math.min(100, Math.round((actual / plan) * 100));
}

export function BudgetHome() {
  const [month, setMonth] = useState(() => monthOf(todayIso()));
  // Kaydedilen harcama başka bir aya düştüyse görünüm o aya döner; kayıt "Bu ayın kayıtları"nda hemen görünür.
  useEffect(() => onExpenseSaved((e) => setMonth(monthOf(e.tarih))), []);
  const plan = useAppStore((s) => s.plan);
  const cash = useAppStore((s) => s.cash);
  const supported = useAppStore((s) => s.cashSupported);
  const summary = useMemo(() => monthSummary(plan, cash, month), [plan, cash, month]);
  const over = summary.actual > summary.plan && summary.plan > 0;

  return (
    <Box data-testid="budget" pb={96}>
      <Paper className={classes.monthBar} px="sm" py={4} radius={0}>
        <Group justify="space-between" wrap="nowrap" gap="xs">
          <ActionIcon variant="subtle" color="gray" aria-label="Önceki ay" onClick={() => setMonth((m) => shiftMonth(m, -1))} data-testid="month-prev">
            <CaretLeftIcon size={22} aria-hidden />
          </ActionIcon>
          <Title order={2} size="h4" data-testid="month-label">{monthLabel(month)}</Title>
          <ActionIcon variant="subtle" color="gray" aria-label="Sonraki ay" onClick={() => setMonth((m) => shiftMonth(m, 1))} data-testid="month-next">
            <CaretRightIcon size={22} aria-hidden />
          </ActionIcon>
        </Group>
      </Paper>

      <div className={classes.layout}>
        <Stack gap="sm" p="sm">
          <Paper p="md" className={classes.summary} data-testid="month-summary">
            <FactList label="Ayın harcama özeti" tone="strong" items={[{ label: 'Bu ay kaydedilen', value: <span data-testid="month-actual">{formatTl(summary.actual)}</span>, emphasis: true }]} />
            {summary.hasPlan && summary.plan > 0 ? (
              <>
                <Progress value={pct(summary.actual, summary.plan)} color={over ? 'red' : 'ember'} mt={6} aria-label="Plana göre harcama" />
                <Text mt={4} data-testid="month-plan">
                  Plan {formatTl(summary.plan)} · {over ? `${formatTl(summary.actual - summary.plan)} aşıldı` : `${formatTl(summary.plan - summary.actual)} kaldı`}
                </Text>
              </>
            ) : (
              <Text mt={4} c="dimmed" data-testid="month-plan">{plan ? 'Bu ay için plan yok' : 'Plan sekmesi okunamadı'}</Text>
            )}
            <SourceNote label="Harcama günlüğü">Yalnız kaydettiğiniz ödemeler. Hazırlık listesindeki teslim işareti buraya ödeme eklemez.</SourceNote>
          </Paper>

          {summary.groups.map((g) => (
            <Stack key={g.name} gap={6} data-testid={`group-${g.name}`}>
              <Group justify="space-between" wrap="nowrap" gap="xs">
                <Text fw={700}>{g.name}</Text>
                <Text c="dimmed">{formatTl(g.actual)} / {formatTl(g.plan)}</Text>
              </Group>
              {g.rows.map((r) => <KalemRow key={r.label} row={r} />)}
            </Stack>
          ))}
        </Stack>

        <Stack gap="sm" p="sm">
          <SectionHeading title="Bu ayın kayıtları" description={`${summary.entries.length} ödeme kaydı`} />
          {summary.entries.length === 0 ? (
            <EmptyState
              icon={<ReceiptIcon size={32} aria-hidden />}
              title="Henüz kayıt yok"
              description={supported === false ? 'Harcama günlüğü sekmesi kurulunca kayıtlar burada görünür.' : 'Bir ödeme yaptığınızda + ile ekleyin; Pano gerçekleşeni buradan okur.'}
            />
          ) : (
            <Stack gap={6} data-testid="entries">
              {summary.entries.map((e) => (
                <UnstyledButton key={e.id} className={classes.entry} onClick={() => openExpense({ id: e.id })} data-testid={`entry-${e.id}`}>
                  <Box component="span" miw={0} className={classes.entryIdentity}>
                    <Text component="span" fw={700}>{e.kalem}</Text>
                    <Text component="span" c="dimmed">{formatTr(e.tarih, 'D MMM')}{e.not ? ` · ${e.not}` : ''}</Text>
                  </Box>
                  <span className={classes.entryAmount}><span>Kaydedilen ödeme</span><strong>{formatTl(e.tutar)}</strong></span>
                </UnstyledButton>
              ))}
            </Stack>
          )}
        </Stack>
      </div>

      <JourneyLinks items={[{ href: '#/pano', label: 'Genel bütçeye git' }, { href: '#/satinalma', label: 'Hazırlık listesine git' }]} />
      <Fab onClick={() => openExpense()} label="Harcama ekle" />
    </Box>
  );
}

function KalemRow({ row }: { row: SummaryRow }) {
  const over = row.plan > 0 && row.actual > row.plan;
  return (
    <UnstyledButton
      className={classes.row}
      onClick={() => openExpense({ kalem: row.label })}
      aria-label={`${row.label}: ${formatTl(row.actual)} / ${formatTl(row.plan)}; harcama ekle`}
      data-testid={`kalem-${row.label}`}
    >
      <Group justify="space-between" wrap="nowrap" gap="xs">
        <Text miw={0}>{row.label}</Text>
        <Text fw={600} className={classes.amount}>{row.count ? formatTl(row.actual) : '—'}</Text>
      </Group>
      <Group gap="xs" wrap="nowrap">
        <Progress value={pct(row.actual, row.plan)} color={over ? 'red' : 'ember'} size="sm" style={{ flex: 1 }} aria-hidden />
        <Text c="dimmed" className={classes.amount}>{row.plan > 0 ? `Plan ${formatTl(row.plan)}` : 'plansız'}</Text>
      </Group>
    </UnstyledButton>
  );
}
