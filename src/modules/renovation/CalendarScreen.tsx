import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Box, Button, Drawer, Group, Paper, SegmentedControl, Stack, Text, UnstyledButton } from '@mantine/core';
import { ArrowSquareOutIcon } from '@phosphor-icons/react/dist/csr/ArrowSquareOut';
import { CalendarBlankIcon } from '@phosphor-icons/react/dist/csr/CalendarBlank';
import { CircleIcon } from '@phosphor-icons/react/dist/csr/Circle';
import { FlagIcon } from '@phosphor-icons/react/dist/csr/Flag';
import { GearSixIcon } from '@phosphor-icons/react/dist/csr/GearSix';
import { HammerIcon } from '@phosphor-icons/react/dist/csr/Hammer';
import { MoonIcon } from '@phosphor-icons/react/dist/csr/Moon';
import { PackageIcon } from '@phosphor-icons/react/dist/csr/Package';
import { SparkleIcon } from '@phosphor-icons/react/dist/csr/Sparkle';
import { Link, useLocation, useRoute } from 'wouter';
import type { Item } from '@shared/schema';
import { label } from '@shared/schema';
import { useAppStore, selectSetting, type AppState } from '@/sync/store';
import { upsert } from '@/sync/controller';
import { formatTr, toDate, todayIso } from '@/lib/dates';
import { FactList, type Fact } from '@/components/Info';
import { countdown, taskDurumLabel, timelineEntries, type TimelineEntry } from './rules';
import { TaskDetail } from './TaskDetail';
import classes from './renovation.module.css';

const selectTimelineItems = (s: AppState): Item[] => s.items.filter((i) => !i.deleted_at && (i.tip === 'kilometre' || i.tip === 'tadilat'));
const SCENARIOS = [{ value: 'A', label: 'A' }, { value: 'B', label: 'B' }, { value: 'C', label: 'C' }];
// Seçiciler modül düzeyinde sabit: useAppStore önbelleği her render'da yeniden abone olmasın.
const selectMoveDate = selectSetting('tarih', 'tasinma');
const selectScenario = selectSetting('ayar', 'senaryo');
const dayCount = new Intl.NumberFormat('tr-TR');
const enc = encodeURIComponent;

/** İkon yalnız ikincil ipucudur; tür her zaman yazıyla da görünür. */
function entryIcon(e: TimelineEntry): React.ReactNode {
  const sz = 16;
  if (e.kind === 'bugun') return <CircleIcon size={sz} weight="fill" aria-hidden />;
  if (e.kind === 'bant') return e.band === 'bayram' ? <SparkleIcon size={sz} aria-hidden /> : <MoonIcon size={sz} aria-hidden />;
  if (e.kind === 'tadilat') return <HammerIcon size={sz} aria-hidden />;
  if (e.tur === 'hedef') return <FlagIcon size={sz} aria-hidden />;
  if (e.tur === 'siparis') return <PackageIcon size={sz} aria-hidden />;
  return <CalendarBlankIcon size={sz} aria-hidden />;
}

/** "Kilometre taşı", "İş · Planlandı", "Dönem", "Sipariş son günü", "Hedef". */
function kindText(e: TimelineEntry): string {
  if (e.kind === 'bant') return 'Dönem';
  if (e.kind === 'tadilat') return ['İş', taskDurumLabel(e.item?.durum)].filter(Boolean).join(' · ');
  if (e.tur === 'siparis') return 'Sipariş son günü';
  if (e.tur === 'hedef') return 'Hedef';
  return 'Kilometre taşı';
}
const scenarioText = (e: TimelineEntry) => (e.senaryo && e.senaryo !== 'hepsi' ? `Senaryo ${e.senaryo}` : '');

function dateRange(e: TimelineEntry): string {
  return e.endDate && e.endDate !== e.date ? `${formatTr(e.date)} – ${formatTr(e.endDate)}` : formatTr(e.date);
}

function byMonth(entries: readonly TimelineEntry[]) {
  const months: Array<{ key: string; label: string; entries: TimelineEntry[] }> = [];
  for (const e of entries) {
    const key = e.date.slice(0, 7);
    if (months.at(-1)?.key !== key) months.push({ key, label: formatTr(e.date, 'MMMM YYYY'), entries: [] });
    months.at(-1)!.entries.push(e);
  }
  return months;
}

const entryButton = (id: string) => document.querySelector<HTMLElement>(`[data-entry-id="${CSS.escape(id)}"]`);

/**
 * Takvim: taşınma sayacı (yapışkan), senaryo seçici, ay başlıkları altında kilometre taşları + tarihli işler, alt çekmece.
 * Çekmece ve çekmeceden açılan iş adresi taşır (`/tadilat/olay/:olay`, `/tadilat/olay/:olay/is/:iş`): iş kapanınca, kaydedilince
 * ya da sayfa yenilense de aynı olayın çekmecesine dönülür; çekmece kapanınca odak takvimdeki olaya döner.
 */
export function CalendarScreen({ now }: { now?: Date } = {}) {
  const items = useAppStore(selectTimelineItems);
  const move = useAppStore(selectMoveDate);
  const scenarioSetting = useAppStore(selectScenario);
  const [, navigate] = useLocation();
  const [, withTask] = useRoute<{ entry: string; task: string }>('/olay/:entry/is/:task');
  const [, onlyEntry] = useRoute<{ entry: string }>('/olay/:entry');
  const entryId = withTask?.entry ?? onlyEntry?.entry;
  const taskId = withTask?.task;
  const scenarioHelp = useId();
  const scenario = scenarioSetting?.deger && SCENARIOS.some((s) => s.value === scenarioSetting.deger) ? scenarioSetting.deger : '';
  const today = now ?? new Date();
  const todayKey = todayIso(today);
  const days = countdown(move?.deger, today);
  const entries = useMemo(() => timelineEntries(items, scenario || undefined, toDate(todayKey)), [items, scenario, todayKey]);
  const months = useMemo(() => byMonth(entries), [entries]);
  const open = entryId && !taskId ? entries.find((e) => e.id === entryId && e.kind !== 'bugun') : undefined;
  // Kapanış geçişi sırasında çekmece içeriği boşalmasın.
  const shown = useRef<TimelineEntry | undefined>(undefined);
  if (open) shown.current = open;
  const drawerEntry = open ?? shown.current;
  // Çekmeceden açılan işten dönülünce aynı iş düğmesi odak alır (Mantine FocusTrap `data-autofocus`).
  const [returnedTask, setReturnedTask] = useState<string>();
  useEffect(() => { if (taskId) setReturnedTask(taskId); }, [taskId]);
  const setScenario = (v: string) => upsert('ayarlar', scenarioSetting?.id, { tip: 'ayar', anahtar: 'senaryo', deger: v });
  const linked: Item[] = useMemo(() => {
    if (!drawerEntry?.item || drawerEntry.kind !== 'kilometre' && drawerEntry.kind !== 'bant') return [];
    const ids = new Set(drawerEntry.item.bagli_idler ?? []);
    return items.filter((i) => i.tip === 'tadilat' && ids.has(i.id));
  }, [drawerEntry, items]);

  const openEntry = (e: TimelineEntry) => { setReturnedTask(undefined); navigate(`~/tadilat/olay/${enc(e.id)}`); };
  // The entry takes focus once the drawer has left, whichever way it closed (Escape, Kapat, browser Back): the drawer's
  // focus trap stays active during the exit transition and would otherwise take the focus back.
  const lastEntry = useRef<string | undefined>(undefined);
  if (open) lastEntry.current = open.id;
  const focusLastEntry = () => { const id = lastEntry.current; if (id && !taskId && document.activeElement !== entryButton(id)) entryButton(id)?.focus({ preventScroll: false }); };
  const closeDrawer = () => {
    navigate('~/tadilat');
    requestAnimationFrame(focusLastEntry);
  };
  const openTask = (id: string) => navigate(`~/tadilat/olay/${enc(entryId!)}/is/${enc(id)}`);
  const drawerFacts: Fact[] = drawerEntry ? [
    { label: 'Tarih', value: dateRange(drawerEntry) },
    { label: 'Tür', value: kindText(drawerEntry) },
    ...(drawerEntry.senaryo ? [{ label: 'Senaryo', value: drawerEntry.senaryo === 'hepsi' ? 'Tüm senaryolar' : label('senaryo', drawerEntry.senaryo) }] : []),
    ...(drawerEntry.item?.is_kim?.length ? [{ label: 'İşi yapan', value: drawerEntry.item.is_kim.map((k) => label('is_kim', k)).join(', ') }] : []),
  ] : [];

  return (
    <Box pb={96}>
      <Paper className={`${classes.strip} record-support`} px="md" py="sm" radius={0} data-testid="countdown">
        <Group justify="space-between" wrap={days == null ? 'wrap' : 'nowrap'} gap="xs" align="center">
          {days == null ? (
            <Group gap={4} wrap="nowrap" style={{ flex: '1 1 100%', minWidth: 0 }}>
              <Text size="sm" c="dimmed">Taşınma tarihi ayarlanmadı</Text>
              <Button component={Link} href="~/ayarlar" variant="subtle" size="xs" leftSection={<GearSixIcon size={16} aria-hidden />} style={{ flexShrink: 0 }}>Ayarlar</Button>
            </Group>
          ) : (
            <div style={{ flex: 1, minWidth: 0 }}>
              <Group gap={4} wrap="nowrap" align="baseline">
                <Text className={classes.bigNumber} data-testid="countdown-days">{dayCount.format(Math.abs(days))}</Text>
                <Text size="sm" fw={600}>{days < 0 ? 'gün önce' : days === 0 ? 'gün — bugün' : 'gün'}</Text>
              </Group>
              <Text size="sm" c="dimmed">{days < 0 ? 'Taşınma' : 'Taşınmaya'} · {formatTr(move?.deger)}</Text>
            </div>
          )}
          <SegmentedControl size="sm" value={scenario} onChange={setScenario} data={SCENARIOS} aria-label="Senaryo" aria-describedby={scenarioHelp} ml="auto" styles={{ label: { minWidth: 44 } }} />
        </Group>
        <Text id={scenarioHelp} size="sm" mt={4} className={classes.scenarioHelp}>
          {scenario
            ? <><b>Senaryo {label('senaryo', scenario)}.</b> Takvim bu senaryonun ve tüm senaryolara ortak taşları gösterir.</>
            : 'Senaryo seçilmedi: bütün senaryoların taşları gösterilir.'}
        </Text>
      </Paper>

      <div data-testid="timeline" className={classes.timeline}>
        {months.map((m) => {
          const count = m.entries.filter((e) => e.kind !== 'bugun').length;
          return (
            <section key={m.key} aria-labelledby={`ay-${m.key}`} className={classes.month}>
              <div className="record-group-heading">
                <h2 id={`ay-${m.key}`}>{m.label}</h2>
                {count > 0 && <p>{count} olay</p>}
              </div>
              <ol className={classes.entries}>
                {m.entries.map((e) => e.kind === 'bugun' ? (
                  <li key={e.id} className={classes.today} data-testid="timeline-today">
                    <span className={classes.entryIcon} aria-hidden>{entryIcon(e)}</span>
                    <span><strong>Bugün</strong> <span className="tabular">· {formatTr(e.date)}</span></span>
                  </li>
                ) : (
                  <li key={e.id}>
                    <UnstyledButton className={classes.entry} data-testid="timeline-entry" data-entry-id={e.id} data-past={e.past ? 'true' : undefined} data-current={e.current ? 'true' : undefined}
                      onClick={() => openEntry(e)}>
                      <span className={classes.entryIcon} aria-hidden>{entryIcon(e)}</span>
                      <span className={classes.entryText}>
                        <span className={`${classes.entryMeta} tabular`}>{[dateRange(e), kindText(e), scenarioText(e), e.past ? 'Geçti' : '', e.current ? 'Şu an' : ''].filter(Boolean).join(' · ')}</span>{' '}
                        <span className={classes.entryTitle}>{e.title}</span>
                      </span>
                    </UnstyledButton>
                  </li>
                ))}
              </ol>
            </section>
          );
        })}
      </div>

      <Drawer opened={!!open} onClose={closeDrawer} onExitTransitionEnd={focusLastEntry} returnFocus={false} position="bottom" size="55%" title={drawerEntry?.title} padding="md" closeButtonProps={{ size: 'xl', 'aria-label': 'Kapat' }}>
        {drawerEntry && (
          <Stack gap="sm" data-testid="timeline-drawer" pb="sm">
            <div className="record-facts"><FactList label={`${drawerEntry.title} bilgileri`} items={drawerFacts} /></div>
            {drawerEntry.note ? <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{drawerEntry.note}</Text> : <Text size="sm" c="dimmed">Not yok</Text>}
            {drawerEntry.kind === 'tadilat' && drawerEntry.item && (
              <Button leftSection={<ArrowSquareOutIcon size={18} aria-hidden />} data-drawer-task={drawerEntry.item.id}
                data-autofocus={returnedTask === drawerEntry.item.id || undefined} onClick={() => openTask(drawerEntry.item!.id)}>İşi aç</Button>
            )}
            {linked.map((t) => (
              <Button key={t.id} variant="default" leftSection={<HammerIcon size={18} aria-hidden />} data-drawer-task={t.id}
                data-autofocus={returnedTask === t.id || undefined} onClick={() => openTask(t.id)}>
                {[t.kod, t.ad].filter(Boolean).join(' ')}
              </Button>
            ))}
          </Stack>
        )}
      </Drawer>

      {taskId && entryId && (
        <TaskDetail key={taskId} id={taskId} back={{
          href: `~/tadilat/olay/${enc(entryId)}`,
          // Olayın kendisi silinen işse çekmece anlamsızdır: takvime dönülür, odak h1'e düşer.
          afterDelete: entryId === taskId ? '~/tadilat' : `~/tadilat/olay/${enc(entryId)}`,
          focus: () => document.querySelector<HTMLElement>(`[data-drawer-task="${CSS.escape(taskId)}"]`) ?? entryButton(entryId),
        }} />
      )}
    </Box>
  );
}
