/**
 * One quiet freshness line for every Sheets-backed page (WCAG 4.1.3: a polite status
 * message that never takes focus). The wording is shared so Pano, Finansman, Ödeme
 * takvimi and Araç say the same thing about the same minute-level refresh cycle.
 */
export function DataStatus({ loading, updatedAt, idle = 'Google Sheets bağlantısı', className }: { loading: boolean; updatedAt: Date | null; idle?: string; className?: string }) {
  const text = loading ? 'Kaynak kontrol ediliyor…'
    : updatedAt ? `Son okuma ${updatedAt.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' })} · Açıkken her dakika yenilenir`
    : idle;
  return <p className={['data-status', className].filter(Boolean).join(' ')} role="status" aria-live="polite">{text}</p>;
}
