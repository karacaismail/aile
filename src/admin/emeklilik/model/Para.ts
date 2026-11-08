// Para değer nesnesi: tutar kuruş tamsayısıyla tutulur. Toplama/çıkarma tamsayıdır; oranla çarpma ondalık kesirle
// (BigInt) yapılır ve kuruşa açıkça yuvarlanır: yarım, sıfırdan uzağa. Kayan nokta toplamı yoktur.
import type { TlMetni } from '../contract';
import { kuralHatasi } from './bicim';

const TL_DESENI = /^(-?)(\d+)(?:\.(\d{1,2}))?$/;
const SAYI_DESENI = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/;

/** Sonlu bir sayıyı tam ondalık kesre çevirir (0.45 → 45/100). JS'in en kısa ondalık yazımı esas alınır. */
function ondalikKesir(sayi: number): { pay: bigint; payda: bigint } {
  if (!Number.isFinite(sayi)) throw kuralHatasi('Oran sonlu bir sayı olmalı.', { oran: sayi });
  const eslesme = SAYI_DESENI.exec(String(sayi));
  if (!eslesme) throw kuralHatasi('Oran ondalık sayıya çevrilemedi.', { oran: sayi });
  const [, isaret, tam, kesir = '', us = '0'] = eslesme;
  const basamaklar = BigInt(`${isaret}${tam}${kesir}`);
  const ust = Number(us) - kesir.length;
  return ust >= 0
    ? { pay: basamaklar * 10n ** BigInt(ust), payda: 1n }
    : { pay: basamaklar, payda: 10n ** BigInt(-ust) };
}

/** pay / payda bölümünü en yakın tamsayıya yuvarlar; yarım sıfırdan uzağa. payda > 0. */
function bolYuvarla(pay: bigint, payda: bigint): bigint {
  const bolum = pay / payda;
  const kalan = pay % payda;
  const mutlakKalan = kalan < 0n ? -kalan : kalan;
  if (mutlakKalan * 2n >= payda) return pay < 0n ? bolum - 1n : bolum + 1n;
  return bolum;
}

function guvenli(kurus: number): number {
  if (!Number.isSafeInteger(kurus)) throw kuralHatasi('Tutar güvenli kuruş aralığının dışında.', { kurus });
  return kurus === 0 ? 0 : kurus; // -0 → 0
}

function bigintten(kurus: bigint): Para {
  if (kurus > BigInt(Number.MAX_SAFE_INTEGER) || kurus < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw kuralHatasi('Tutar güvenli kuruş aralığının dışında.', { kurus: kurus.toString() });
  }
  return Para.kurustan(Number(kurus));
}

function binlikle(tam: string): string {
  return tam.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export class Para {
  private constructor(readonly kurus: number) {}

  static sifir(): Para {
    return new Para(0);
  }

  static kurustan(kurus: number): Para {
    return new Para(guvenli(kurus));
  }

  /** 'TlMetni' (nokta ondalık ayırıcı, en çok iki ondalık) → Para. */
  static tlden(metin: TlMetni): Para {
    const eslesme = typeof metin === 'string' ? TL_DESENI.exec(metin) : null;
    if (!eslesme) throw kuralHatasi('Geçersiz TL metni (nokta ondalıklı, en çok iki ondalık).', { metin });
    const [, isaret, tam, kesir = ''] = eslesme;
    const kurus = BigInt(tam) * 100n + BigInt(kesir.padEnd(2, '0'));
    return bigintten(isaret === '-' ? -kurus : kurus);
  }

  /**
   * Kestirim formüllerinin (oranlı, kayan noktalı) sonucunu bir kez kuruşa yuvarlar. Kayan nokta gürültüsü
   * 15 anlamlı basamakta temizlenir (1.005 → 1,01); yarım sıfırdan uzağa yuvarlanır. Para toplamlarında kullanılmaz.
   */
  static yaklasikTl(deger: number): Para {
    if (!Number.isFinite(deger)) throw kuralHatasi('Kestirim sonlu değil.', { deger });
    const mutlak = Number((Math.abs(deger) * 100).toPrecision(15));
    const kurus = Math.round(mutlak);
    return Para.kurustan(deger < 0 ? -kurus : kurus);
  }

  static enBuyuk(a: Para, b: Para): Para {
    return a.karsilastir(b) >= 0 ? a : b;
  }

  static enKucuk(a: Para, b: Para): Para {
    return a.karsilastir(b) <= 0 ? a : b;
  }

  topla(diger: Para): Para {
    return Para.kurustan(this.kurus + diger.kurus);
  }

  cikar(diger: Para): Para {
    return Para.kurustan(this.kurus - diger.kurus);
  }

  negatif(): Para {
    return Para.kurustan(-this.kurus);
  }

  /** Tamsayı çarpan (gün sayısı, ay sayısı). */
  carpTam(carpan: number): Para {
    if (!Number.isSafeInteger(carpan)) throw kuralHatasi('Çarpan tamsayı olmalı.', { carpan });
    return bigintten(BigInt(this.kurus) * BigInt(carpan));
  }

  /**
   * Oranla çarpar ve kuruşa bir kez yuvarlar (yarım sıfırdan uzağa). tamCarpan, yuvarlamadan önce uygulanan
   * tamsayı çarpandır (ör. aylık oran × ay sayısı).
   */
  carp(oran: number, tamCarpan = 1): Para {
    if (!Number.isSafeInteger(tamCarpan)) throw kuralHatasi('Çarpan tamsayı olmalı.', { tamCarpan });
    const { pay, payda } = ondalikKesir(oran);
    return bigintten(bolYuvarla(BigInt(this.kurus) * pay * BigInt(tamCarpan), payda));
  }

  karsilastir(diger: Para): -1 | 0 | 1 {
    return this.kurus < diger.kurus ? -1 : this.kurus > diger.kurus ? 1 : 0;
  }

  esit(diger: Para): boolean {
    return this.kurus === diger.kurus;
  }

  sifirMi(): boolean {
    return this.kurus === 0;
  }

  negatifMi(): boolean {
    return this.kurus < 0;
  }

  pozitifMi(): boolean {
    return this.kurus > 0;
  }

  /**
   * Bu tutarı karşılamak için kaç adet `birim` gerekir (yukarı yuvarlanmış). Tutar ≤ 0 ise 0; birim ≤ 0 ise
   * hiçbir zaman karşılanmaz (null).
   */
  kacBirim(birim: Para): number | null {
    if (this.kurus <= 0) return 0;
    if (birim.kurus <= 0) return null;
    const tutar = BigInt(this.kurus);
    const bolen = BigInt(birim.kurus);
    return Number((tutar + bolen - 1n) / bolen);
  }

  /** '178362.00' biçimi (sözleşmedeki TlMetni). */
  tlMetni(): TlMetni {
    const mutlak = Math.abs(this.kurus);
    const tam = Math.trunc(mutlak / 100);
    const kesir = String(mutlak % 100).padStart(2, '0');
    return `${this.kurus < 0 ? '-' : ''}${tam}.${kesir}`;
  }

  /** '₺178.362,00' biçimi; eksi işareti U+2212. */
  goster(): string {
    const mutlak = Math.abs(this.kurus);
    const tam = binlikle(String(Math.trunc(mutlak / 100)));
    const kesir = String(mutlak % 100).padStart(2, '0');
    return `${this.kurus < 0 ? '−' : ''}₺${tam},${kesir}`;
  }

  toString(): string {
    return this.tlMetni();
  }
}
