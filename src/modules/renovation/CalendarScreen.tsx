import { useMemo, useState } from 'react';
import { Badge, Box, Button, Drawer, Group, Paper, SegmentedControl, Stack, Text, ThemeIcon, Timeline, UnstyledButton } from '@mantine/core';
import { ArrowSquareOutIcon, CalendarBlankIcon, CircleIcon, FlagIcon, GearSixIcon, HammerIcon, MoonIcon, PackageIcon, SparkleIcon } from '@phosphor-icons/react';
import { Link, useLocation } from 'wouter';
import type { Item } from '@shared/schema';
import { label } from '@shared/schema';
import { useAppStore, selectSetting, type AppState } from '@/sync/store';
import { upsert } from '@/sync/controller';
import { formatTr, toDate, todayIso } from '@/lib/dates';
import { WarnBadge } from '@/components/badges';
import { countdown, taskDurumLabel, timelineEntries, type TimelineEntry } from './rules';
import classes from './renovation.module.css';

const selectTimelineItems = (s: AppState): Item[] => s.items.filter((i) => !i.deleted_at && (i.tip === 'kilometre' || i.tip === 'tadilat'));
const SCENARIOS = [{ value: 'A', label: 'A' }, { value: 'B', label: 'B' }, { value: 'C', label: 'C' }];
// Seçiciler modül düzeyinde sabit: useAppStore önbelleği her render'da yeniden abone olmasın.
const selectMoveDate = selectSetting('tarih', 'tasinma');
const selectScenario = selectSetting('ayar', 'senaryo');

function entryVisual(e: TimelineEntry): { icon: React.ReactNode; color: string } {
  const sz = 16;
  if (e.kind === 'bugun') return { icon: <CircleIcon size={sz} weight="fill" aria-hidden />, color: 'ember.7' };
  if (e.kind === 'bant') return e.band === 'bayram'
    ? { icon: <SparkleIcon size={sz} aria-hidden />, color: 'grape.7' }
    : { icon: <MoonIcon size={sz} aria-hidden />, color: 'indigo.7' };
  if (e.kind === 'tadilat') return { icon: <HammerIcon size={sz} aria-hidden />, color: 'sand.7' };
  if (e.tur === 'hedef') return { icon: <FlagIcon size={sz} aria-hidden />, color: 'ember.7' };
  if (e.tur === 'siparis') return { icon: <PackageIcon size={sz} aria-hidden />, color: 'teal.8' };
  return { icon: <CalendarBlankIcon size={sz} aria-hidden />, color: 'blue.7' };
}

function dateRange(e: TimelineEntry): string {
  return e.endDate && e.endDate !== e.date ? `${formatTr(e.date)} – ${formatTr(e.endDate)}` : formatTr(e.date);
}

/** Takvim: taşınma sayacı (yapışkan), senaryo seçici, kilometre taşları + tarihli işler zaman çizelgesi, alt çekmece. */
export function CalendarScreen({ now }: { now?: Date } = {}) {
  const items = useAppStore(selectTimelineItems);
  const move = useAppStore(selectMoveDate);
  const scenarioSetting = useAppStore(selectScenario);
  const [, navigate] = useLocation();
  const [open, setOpen] = useState<TimelineEntry | null>(null);
  const scenario = scenarioSetting?.deger && SCENARIOS.some((s) => s.value === scenarioSetting.deger) ? scenarioSetting.deger : '';
  const today = now ?? new Date();
  const todayKey = todayIso(today);
  const days = countdown(move?.deger, today);
  const entries = useMemo(() => timelineEntries(items, scenario || undefined, toDate(todayKey)), [items, scenario, todayKey]);
  const setScenario = (v: string) => upsert('ayarlar', scenarioSetting?.id, { tip: 'ayar', anahtar: 'senaryo', deger: v });
  const linked: Item[] = useMemo(() => {
    if (!open?.item || open.kind !== 'kilometre' && open.kind !== 'bant') return [];
    const ids = new Set(open.item.bagli_idler ?? []);
    return items.filter((i) => i.tip === 'tadilat' && ids.has(i.id));
  }, [open, items]);

  return (
    <Box pb={96}>
      <Paper className={classes.strip} px="sm" py={6} radius={0} data-testid="countdown">
        <Group justify="space-between" wrap={days == null ? 'wrap' : 'nowrap'} gap="xs" align="center">
          {days == null ? (
            <Group gap={4} wrap="nowrap" style={{ flex: '1 1 100%', minWidth: 0 }}>
              <Text size="sm" c="dimmed">Taşınma tarihi ayarlanmadı</Text>
              <Button component={Link} href="~/ayarlar" variant="subtle" size="xs" leftSection={<GearSixIcon size={16} aria-hidden />} style={{ flexShrink: 0 }}>Ayarlar</Button>
            </Group>
          ) : (
            <div style={{ flex: 1, minWidth: 0 }}>
              <Group gap={4} wrap="nowrap" align="baseline">
                <Text className={classes.bigNumber} data-testid="countdown-days">{Math.abs(days)}</Text>
                <Text size="sm" fw={600}>{days < 0 ? 'gün önce' : days === 0 ? 'gün — bugün' : 'gün'}</Text>
              </Group>
              <Text size="xs" c="dimmed" lineClamp={1} data-allow-clamp>{days < 0 ? 'Taşınma' : 'Taşınmaya'} · {formatTr(move?.deger)}</Text>
            </div>
          )}
          <SegmentedControl size="sm" value={scenario} onChange={setScenario} data={SCENARIOS} aria-label="Senaryo" ml="auto" styles={{ label: { minWidth: 44 } }} />
        </Group>
        <Text size="xs" c="dimmed" mt={2} lineClamp={1} data-allow-clamp>{scenario ? label('senaryo', scenario) : 'Senaryo seçilmedi (tüm taşlar)'}</Text>
      </Paper>

      <Timeline bulletSize={28} lineWidth={2} color="gray.4" p="sm" pt="md" data-testid="timeline" className={classes.timeline}>
        {entries.map((e) => {
          const v = entryVisual(e);
          const bullet = <ThemeIcon size={28} radius="xl" color={v.color} variant="filled">{v.icon}</ThemeIcon>;
          if (e.kind === 'bugun') {
            return (
              <Timeline.Item key={e.id} bullet={bullet} lineVariant="solid" data-testid="timeline-today">
                <Text fw={700} size="sm" c="ember.8">Bugün</Text>
                <Text size="xs" c="dimmed" className="tabular">{formatTr(e.date)}</Text>
              </Timeline.Item>
            );
          }
          return (
            <Timeline.Item key={e.id} bullet={bullet} lineVariant={e.past ? 'dashed' : 'solid'}>
              <UnstyledButton className={classes.entry} data-testid="timeline-entry" data-past={e.past ? 'true' : undefined} data-current={e.current ? 'true' : undefined}
                aria-label={e.title} onClick={() => setOpen(e)}>
                <Text size="xs" c="dimmed" className="tabular">{dateRange(e)}</Text>
                <Text fw={600} size="sm" lineClamp={2} className={classes.title} data-allow-clamp>{e.title}</Text>
                <Group gap={4} mt={2}>
                  {e.kind === 'tadilat'
                    ? <Badge size="xs" variant="default">{taskDurumLabel(e.item?.durum) || 'İş'}</Badge>
                    : <Badge size="xs" variant="default">{label('kilometre_tur', e.tur ?? 'bant')}</Badge>}
                  {e.senaryo && e.senaryo !== 'hepsi' && <Badge size="xs" variant="outline" color="gray">Senaryo {e.senaryo}</Badge>}
                  {e.current && <WarnBadge tone="ok">şu an</WarnBadge>}
                </Group>
              </UnstyledButton>
            </Timeline.Item>
          );
        })}
      </Timeline>

      <Drawer opened={!!open} onClose={() => setOpen(null)} position="bottom" size="55%" title={open?.title} padding="md" closeButtonProps={{ size: 'xl', 'aria-label': 'Kapat' }}>
        {open && (
          <Stack gap="xs" data-testid="timeline-drawer" pb="sm">
            <Text size="sm" fw={600} className="tabular">{dateRange(open)}</Text>
            <Group gap={4}>
              {open.kind === 'tadilat'
                ? <Badge size="sm" variant="default">{taskDurumLabel(open.item?.durum) || 'İş'}</Badge>
                : <Badge size="sm" variant="default">{label('kilometre_tur', open.tur ?? 'bant')}</Badge>}
              {open.senaryo && <Badge size="sm" variant="outline" color="gray">{label('senaryo', open.senaryo)}</Badge>}
              {open.item?.is_kim?.map((k) => <Badge key={k} size="sm" variant="outline" color="gray">{label('is_kim', k)}</Badge>)}
            </Group>
            {open.note ? <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{open.note}</Text> : <Text size="sm" c="dimmed">Not yok</Text>}
            {open.kind === 'tadilat' && open.item && (
              <Button leftSection={<ArrowSquareOutIcon size={18} aria-hidden />} onClick={() => { setOpen(null); navigate(`~/tadilat/isler/${open.item!.id}`); }}>İşi aç</Button>
            )}
            {linked.map((t) => (
              <Button key={t.id} variant="default" leftSection={<HammerIcon size={18} aria-hidden />} onClick={() => { setOpen(null); navigate(`~/tadilat/isler/${t.id}`); }}>
                {[t.kod, t.ad].filter(Boolean).join(' ')}
              </Button>
            ))}
          </Stack>
        )}
      </Drawer>
    </Box>
  );
}
