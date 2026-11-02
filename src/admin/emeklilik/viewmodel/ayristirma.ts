import type { TlMetni } from '../contract';

// Türkçe sayı ayrıştırıcı: kullanıcının yazdığı metni değere çevirir; belirsiz girdiyi tahmin etmez.
// Binlik nokta, ondalık virgül ("8.500,00"); "8.5" ya da "8500.50" belirsizdir ve reddedilir (TextField ve
// ui/Money.parseMoneyInput ile aynı yazım kuralı). Para kayan noktaya çevrilmez: sonuç ondalık TL metnidir ('8500.00').
// Hata iletileri "Hata:" öneki olmadan döner; alan ve ViewModel öneki ekler.

export type AyristirmaSonucu<T> = { tamam: true; deger: T } | { tamam: false; hata: string };

export const BOS_HATA = 'Boş bırakılamaz.';
export const TAM_SAYI_HATA = 'Tam sayı girin; ör. 360.';
export const PARA_HATA = 'Tutarı 8.500,00 biçiminde girin.';
export const EKSI_PARA_HATA = 'Tutar eksi olamaz.';
export const ORAN_HATA = 'Oranı 10 ya da 10,5 biçiminde girin.';

const TAM_SAYI = /^(?:\d{1,3}(?:\.\d{3})+|\d+)$/;
const PARA = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/;
const ORAN = /^(\d+)(?:,(\d{1,4}))?$/;
const BAS_SIMGE = /^₺\s*/;
const SON_SIMGE = /\s*(?:₺|TL)$/i;

const tamam = <T>(deger: T): AyristirmaSonucu<T> => ({ tamam: true, deger });
const hata = <T>(ileti: string): AyristirmaSonucu<T> => ({ tamam: false, hata: ileti });

export class TurkceSayiAyristirici {
  /** '5.900' → 5900; kesir, eksi ve harf reddedilir. */
  tamSayi(metin: string): AyristirmaSonucu<number> {
    const temiz = metin.trim();
    if (!temiz) return hata(BOS_HATA);
    return TAM_SAYI.test(temiz) ? tamam(Number(temiz.replace(/\./g, ''))) : hata(TAM_SAYI_HATA);
  }

  /** '8.500,00' → '8500.00' (her zaman iki ondalık); baştaki ₺ ve sondaki ₺/TL hoş görülür. */
  para(metin: string): AyristirmaSonucu<TlMetni> {
    const temiz = metin.trim().replace(BAS_SIMGE, '').replace(SON_SIMGE, '').trim();
    if (!temiz) return hata(BOS_HATA);
    if (temiz.startsWith('-')) return hata(EKSI_PARA_HATA);
    const eslesme = PARA.exec(temiz);
    if (!eslesme) return hata(PARA_HATA);
    const tam = eslesme[1]!.replace(/\./g, '').replace(/^0+(?=\d)/, '');
    const kurus = `${eslesme[2] ?? ''}00`.slice(0, 2);
    return tamam(`${tam}.${kurus}`);
  }

  /** '10' → 0.1, '%10,5' → 0.105 (yüzde işareti başta ya da sonda olabilir). */
  oran(metin: string): AyristirmaSonucu<number> {
    const temiz = metin.trim().replace(/^%\s*/, '').replace(/\s*%$/, '').trim();
    if (!temiz) return hata(BOS_HATA);
    const eslesme = ORAN.exec(temiz);
    if (!eslesme) return hata(ORAN_HATA);
    return tamam(Number(`${eslesme[1]}.${eslesme[2] ?? '0'}`) / 100);
  }
}
