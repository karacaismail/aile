export { parseTl } from '@shared/normalize';

const fmtInt = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });
const fmtDec = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 5000 → "₺5.000"; 1250.5 → "₺1.250,50"; null → "—" */
export function formatTl(n: number | null | undefined, opts: { dash?: string } = {}): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return opts.dash ?? '—';
  const f = Number.isInteger(n) ? fmtInt : fmtDec;
  return `₺${f.format(n)}`;
}

/** "₺6.000–7.000" gibi aralık; eşitse tek değer. */
export function formatTlRange(min?: number | null, max?: number | null): string {
  if (min == null && max == null) return '—';
  if (min != null && max != null && min !== max) return `${formatTl(min)}–${fmtInt.format(max)}`;
  return formatTl(min ?? max);
}

export function kompakt(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toLocaleString('tr-TR', { maximumFractionDigits: 2 })} M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} bin`;
  return fmtInt.format(n);
}
