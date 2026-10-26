import dayjs from 'dayjs';
import 'dayjs/locale/tr';

dayjs.locale('tr');

export const DAY_MS = 86_400_000;

/** Kamusal takvim gerçekleri (Diyanet 2027): aile verisi değildir. */
export const RAMAZAN_2027 = { start: '2027-02-08', end: '2027-03-08' } as const;
export const BAYRAM_2027 = { start: '2027-03-09', end: '2027-03-11' } as const;
export const KADIR_GECESI_2027 = '2027-03-05';

export function toDate(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/** Gün farkı (tam gün, yerel takvim günleri). Geçmiş için negatif. */
export function daysUntil(targetIso: string, now: Date = new Date()): number {
  const t = toDate(targetIso);
  const n = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((t.getTime() - n.getTime()) / DAY_MS);
}

export function inRange(iso: string, range: { start: string; end: string }): boolean {
  const d = iso.slice(0, 10);
  return d >= range.start && d <= range.end;
}

export function formatTr(iso: string | undefined, pattern = 'D MMM YYYY'): string {
  if (!iso) return '';
  return dayjs(toDate(iso)).locale('tr').format(pattern);
}

export function formatTrDateTime(iso: string | undefined): string {
  if (!iso) return '';
  return dayjs(iso).locale('tr').format('D MMM HH:mm');
}

export function todayIso(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function addDays(iso: string, days: number): string {
  const d = toDate(iso);
  d.setDate(d.getDate() + days);
  return todayIso(d);
}

export function weekdayTr(iso: string): string {
  return dayjs(toDate(iso)).locale('tr').format('dddd');
}
