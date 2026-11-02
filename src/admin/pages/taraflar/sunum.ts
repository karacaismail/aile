// Taraflar sunumunun ortak metinleri (telefon listeleri ve geniş modüller aynı sözcükleri kullanır). Eksik bilgi
// adıyla yazılır: "Bilinmiyor", "Taraf bilinmiyor", "Adı bilinmiyor". Sayılar tr-TR, ondalık metin olduğu gibi
// biçimlenir (sayıya çevirip yuvarlama yok).
import { BILINMIYOR, formatMoney } from '../../ui/Money';
import type { KayitTuru, TeklifGrubu } from './model';

export { BILINMIYOR };
export const TARAF_BILINMIYOR = 'Taraf bilinmiyor';
export const ADI_BILINMIYOR = 'Adı bilinmiyor';
export const MESLEK_BILINMIYOR = 'Meslek bilinmiyor';

const KAYIT_TURU: Record<KayitTuru, string> = { alim: 'Alım', is: 'İş' };
const sayiBicimi = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 });
const sayi = (ondalik: string) => sayiBicimi.format(ondalik as `${number}`);

export const sureMetni = (gun: string | null): string => (gun === null ? BILINMIYOR : `${sayi(gun)} gün`);
export const garantiMetni = (ay: string | null): string => (ay === null ? BILINMIYOR : `${sayi(ay)} ay`);
export const mykMetni = (myk: boolean | null): string => (myk === null ? BILINMIYOR : myk ? 'Doğrulandı' : 'Doğrulanmadı');

/** Grup başlığı: "Bulaşık makinesi · Alım · ALM-0137"; bağsız ve belirsiz usta teklifleri ayrı adla. */
export function grupBasligi(grup: TeklifGrubu): string {
  if (grup.durum === 'bagsiz') return 'Kayda bağlı olmayan teklifler';
  if (grup.durum === 'belirsiz') return 'Birden çok kayda bağlı teklifler';
  return [grup.kayitAdi ?? ADI_BILINMIYOR, grup.tur ? KAYIT_TURU[grup.tur] : null, grup.kayitKodu].filter(Boolean).join(' · ');
}

/** "Bulaşık makinesi: en düşük fiyat Usta Ali, ₺1.450,00 daha ucuz." — yalnız tekil en düşük teklif varken. */
export function karsilastirmaOzeti(grup: TeklifGrubu): string | null {
  const enDusuk = grup.teklifler.find((teklif) => teklif.key === grup.enDusukKey);
  if (!enDusuk || !grup.fark) return null;
  return `${grup.kayitAdi ?? ADI_BILINMIYOR}: en düşük fiyat ${enDusuk.tarafAdi ?? TARAF_BILINMIYOR}, ${formatMoney(grup.fark)} daha ucuz.`;
}
