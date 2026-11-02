import type { AyMetni, TarihMetni, TlMetni, TutarBilgisi } from '../contract';

// Türkçe biçimleyici: ViewModel'in bütün ekran metinleri buradan geçer; görünüm hesap ya da biçimleme yapmaz.
// Para tr-TR "₺8.500,00" (iki ondalık, tabular hizayı görünüm verir); ondalık TL metni Intl'e metin olarak verilir,
// kayan noktaya çevrilip yuvarlanmaz. Ay ve tarih sabit Türkçe ay adlarıyla yazılır (cihazın saat diliminden bağımsız).
// Eksik bilgi saklanmaz: bozuk tutar/ay "Bilinmiyor", bilinmeyen tutar "Bilinmiyor · <neden>" yazılır.

export type Ton = 'olumlu' | 'hata' | 'uyari' | 'notr';

export const BILINMIYOR = 'Bilinmiyor';
const AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'] as const;
const TL = /^-?\d+(?:\.\d+)?$/;
const SIFIR = /^-?0+(?:\.0+)?$/;
const AY = /^(\d{4})-(\d{2})$/;
const TARIH = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCALE = 'tr-TR';

type Isaret = -1 | 0 | 1;

export class TurkceBicimleyici {
  private readonly paraBicimi = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: 'TRY', minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'negative' });
  private readonly isaretliParaBicimi = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: 'TRY', minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'exceptZero' });
  private readonly girdiBicimi = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  private readonly sayiBicimi = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });
  private readonly oranBicimi = new Intl.NumberFormat(LOCALE, { style: 'percent', maximumFractionDigits: 2 });
  private readonly oranGirdiBicimi = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2, useGrouping: false });

  /** '208089.00' → '₺208.089,00'; bozuk metin 'Bilinmiyor'. */
  para(tl: TlMetni): string {
    return TL.test(tl) ? this.paraBicimi.format(tl as `${number}`) : BILINMIYOR;
  }

  /** İşaretli tutar (fark): '+₺240.114,98', '-₺1.250,00', sıfır işaretsiz. */
  isaretliPara(tl: TlMetni): string {
    return TL.test(tl) ? this.isaretliParaBicimi.format(tl as `${number}`) : BILINMIYOR;
  }

  /** TutarBilgisi: bilinen tek tutar, aralık "₺A – ₺B" ya da "Bilinmiyor · <neden>". */
  tutar(bilgi: TutarBilgisi): string {
    if (bilgi.tur === 'bilinen') return this.para(bilgi.tl);
    if (bilgi.tur === 'aralik') return `${this.para(bilgi.altTl)} – ${this.para(bilgi.ustTl)}`;
    return this.bilinmiyor(bilgi.neden);
  }

  isaretliTutar(bilgi: TutarBilgisi): string {
    if (bilgi.tur === 'bilinen') return this.isaretliPara(bilgi.tl);
    if (bilgi.tur === 'aralik') return `${this.isaretliPara(bilgi.altTl)} – ${this.isaretliPara(bilgi.ustTl)}`;
    return this.bilinmiyor(bilgi.neden);
  }

  bilinmiyor(neden: string | null | undefined): string {
    const metin = neden?.trim();
    return metin ? `${BILINMIYOR} · ${metin}` : BILINMIYOR;
  }

  /** Farkın tonu yalnız destekler; yön metindedir. Aralık ancak iki ucu aynı yöndeyse tonlanır. */
  ton(bilgi: TutarBilgisi): Ton {
    if (bilgi.tur === 'bilinmiyor') return 'notr';
    const isaretler = bilgi.tur === 'bilinen' ? [this.isaret(bilgi.tl)] : [this.isaret(bilgi.altTl), this.isaret(bilgi.ustTl)];
    if (isaretler.every(i => i === 1)) return 'olumlu';
    if (isaretler.every(i => i === -1)) return 'hata';
    return 'notr';
  }

  /** TutarBilgisi bilinen ve sıfır mı (ödeme yok). */
  sifirMi(bilgi: TutarBilgisi): boolean {
    return bilgi.tur === 'bilinen' && this.isaret(bilgi.tl) === 0;
  }

  private isaret(tl: TlMetni): Isaret {
    if (!TL.test(tl) || SIFIR.test(tl)) return 0;
    return tl.startsWith('-') ? -1 : 1;
  }

  /** 'YYYY-MM' → 'Aralık 2027'. */
  ay(ay: AyMetni): string {
    const eslesme = AY.exec(ay);
    const no = eslesme ? Number(eslesme[2]) : 0;
    return eslesme && no >= 1 && no <= 12 ? `${AYLAR[no - 1]} ${eslesme[1]}` : BILINMIYOR;
  }

  /** 'YYYY-MM-DD' → '2 Kasım 2026'. */
  tarih(tarih: TarihMetni): string {
    const eslesme = TARIH.exec(tarih);
    const ay = eslesme ? Number(eslesme[2]) : 0;
    return eslesme && ay >= 1 && ay <= 12 ? `${Number(eslesme[3])} ${AYLAR[ay - 1]} ${eslesme[1]}` : BILINMIYOR;
  }

  sayi(n: number): string {
    return this.sayiBicimi.format(n);
  }

  gun(n: number): string {
    return `${this.sayi(n)} gün`;
  }

  /** 0.1 → '%10'. */
  oran(oran: number): string {
    return this.oranBicimi.format(oran);
  }

  /** Referansa göre ay farkı: '14 ay erken', 'Aynı ay', '3 ay geç'; bilinmiyorsa 'Bilinmiyor'. */
  erken(ay: number | null): string {
    if (ay === null) return BILINMIYOR;
    if (ay === 0) return 'Aynı ay';
    return ay > 0 ? `${this.sayi(ay)} ay erken` : `${this.sayi(-ay)} ay geç`;
  }

  /** Düzenlenebilir taslak: '208089.00' → '208.089,00'. */
  paraGirdisi(tl: TlMetni): string {
    return TL.test(tl) ? this.girdiBicimi.format(tl as `${number}`) : '';
  }

  /** 0.105 → '10,5'. */
  oranGirdisi(oran: number): string {
    return this.oranGirdiBicimi.format(oran * 100);
  }

  sayiGirdisi(n: number): string {
    return String(n);
  }
}
