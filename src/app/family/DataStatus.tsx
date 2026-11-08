/**
 * One quiet freshness line for every Sheets-backed page (WCAG 4.1.3: a polite status
 * message that never takes focus). One short wording for Pano, Finansman, Ödeme
 * takvimi and Araç: the time of the last successful read, nothing about the process.
 */
export function DataStatus({ loading, updatedAt, idle = 'Google Sheets bağlantısı', className }: { loading: boolean; updatedAt: Date | null; idle?: string; className?: string }) {
  const text = loading ? 'Kaynak kontrol ediliyor…'
    : updatedAt ? `Güncellendi ${updatedAt.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' })}`
    : idle;
  return <p className={['data-status', className].filter(Boolean).join(' ')} role="status" aria-live="polite">{text}</p>;
}
