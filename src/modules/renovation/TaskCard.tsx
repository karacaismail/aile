import { Badge, Box, Card } from '@mantine/core';
import { CheckCircleIcon } from '@phosphor-icons/react/dist/csr/CheckCircle';
import { HourglassMediumIcon } from '@phosphor-icons/react/dist/csr/HourglassMedium';
import { StampIcon } from '@phosphor-icons/react/dist/csr/Stamp';
import { useLocation } from 'wouter';
import type { Item } from '@shared/schema';
import { label } from '@shared/schema';
import { FactList, type Fact } from '@/components/Info';
import { formatTr } from '@/lib/dates';
import { TASK_RESOLVED, depsResolved, taskDurumLabel } from './rules';
import classes from './renovation.module.css';

const DURUM_COLOR: Record<string, string> = { fikir: 'gray.5', arastirma: 'blue.6', karar: 'ember.6', siparis: 'yellow.6', teslim: 'teal.6', kuruldu: 'green.7', iptal: 'red.6' };

/** Tadilat durumu: nötr rozet + renkli nokta, yerel etiket. Kartın tek renkli etiketi budur. */
export function TaskDurumBadge({ value }: { value?: string }) {
  if (!value) return null;
  const color = (DURUM_COLOR[value] ?? 'gray.5').replace('.', '-');
  return (
    <Badge size="xs" variant="default" leftSection={<Box component="span" aria-hidden style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: `var(--mantine-color-${color})` }} />}>
      {taskDurumLabel(value)}
    </Badge>
  );
}

function izinTone(d?: string): 'ok' | 'warn' | 'danger' | undefined {
  if (d === 'alindi' || d === 'gerekmez') return 'ok';
  if (d === 'reddedildi') return 'danger';
  if (d === 'istendi') return undefined;
  return 'warn';
}

/** "T1", "T1 ve T2", "T1, T2 ve T3". */
export function joinCodes(codes: readonly string[]): string {
  return codes.length > 1 ? `${codes.slice(0, -1).join(', ')} ve ${codes[codes.length - 1]}` : codes.join('');
}

/** Planlanan başlangıç her kartta ilk sıradadır; ardından hangisi varsa Süre ve/veya Bitiş, hiçbiri yoksa bir kez "Süre ve bitiş". */
function scheduleFacts(task: Item): Fact[] {
  const facts: Fact[] = [{ label: 'Planlanan başlangıç', value: task.planlanan_tarih ? formatTr(task.planlanan_tarih) : null }];
  if (task.sure_gun != null) facts.push({ label: 'Süre', value: `${task.sure_gun} gün` });
  if (task.bitis_tarihi) facts.push({ label: 'Bitiş', value: formatTr(task.bitis_tarihi) });
  if (facts.length === 1) facts.push({ label: 'Süre ve bitiş', value: null });
  return facts;
}

/** Kayıt dili: kimlik (kod + ad) → durum etiketi ve işi yapanlar düz metin → dikkat (izin, bağımlılık) → iş takvimi. */
export function TaskCard({ task, tasks }: { task: Item; tasks: readonly Item[] }) {
  const [, navigate] = useLocation();
  const done = !!task.durum && TASK_RESOLVED.has(task.durum) && task.durum !== 'iptal';
  const deps = task.bagimlilik?.filter(Boolean) ?? [];
  const resolved = depsResolved(task, tasks);
  const go = () => navigate(`~/tadilat/isler/${task.id}`);
  return (
    <Card radius="md" p="md" className={classes.card} data-testid="task-card" data-task-id={task.id} data-done={done || undefined} data-cancelled={task.durum === 'iptal' || undefined}>
      <div className={`${classes.linkArea} record-card`} role="link" tabIndex={0} aria-label={`${task.ad} detayı`} onClick={go} onKeyDown={(e) => { if (e.key === 'Enter') go(); }}>
        <h3 className={`record-title ${classes.title}`}>
          {task.kod && <><span className={classes.code} data-testid="task-kod">{task.kod}</span> </>}{task.ad}
        </h3>
        {(task.durum || task.is_kim?.length) && (
          <div className="record-meta">
            <TaskDurumBadge value={task.durum} />
            {task.is_kim?.map((k) => <span key={k} className="record-scope">{label('is_kim', k)}</span>)}
          </div>
        )}
        {(task.izin_gerekli || deps.length > 0) && (
          <ul className="record-attention" aria-label={`${task.ad} dikkat`}>
            {task.izin_gerekli && (
              <li data-tone={izinTone(task.izin_durumu)}><StampIcon size={18} aria-hidden />İzin gerekli · {label('izin_durumu', task.izin_durumu) || 'durumu girilmedi'}</li>
            )}
            {deps.length > 0 && (resolved
              ? <li data-tone="ok"><CheckCircleIcon size={18} aria-hidden />Bağımlı: {joinCodes(deps)} bitti</li>
              : <li><HourglassMediumIcon size={18} aria-hidden />Bağımlı: {joinCodes(deps)} bitince başlar</li>)}
          </ul>
        )}
        <div className="record-facts">
          <FactList label={`${task.ad} iş takvimi`} items={scheduleFacts(task)} />
        </div>
      </div>
    </Card>
  );
}
