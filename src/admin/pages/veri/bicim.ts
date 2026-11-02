// Veri sayfasının ortak biçimleri (saf): tr-TR sayı, İstanbul saatiyle zaman ve eksik bilgi adları.
export const BILINMIYOR = 'Bilinmiyor';
export const HENUZ_YOK = 'Henüz yok';
const ZAMAN_DILIMI = 'Europe/Istanbul';

const sayiBicimi = new Intl.NumberFormat('tr-TR');
const tarihBicimi = new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: ZAMAN_DILIMI });
const saatBicimi = new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: ZAMAN_DILIMI });

/** 12345 → "12.345". */
export const sayi = (value: number): string => sayiBicimi.format(value);

/** ISO zaman → "28.10.2026 11:00" (İstanbul); geçersiz/boş → "Bilinmiyor". */
export function zamanMetni(iso: unknown): string {
  if (typeof iso !== 'string' || iso.trim() === '') return BILINMIYOR;
  const an = new Date(iso);
  if (Number.isNaN(an.getTime())) return BILINMIYOR;
  return `${tarihBicimi.format(an)} ${saatBicimi.format(an)}`;
}
