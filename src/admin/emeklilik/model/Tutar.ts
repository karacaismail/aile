// Tutar: sözleşmedeki TutarBilgisi'nin hesap içindeki karşılığı.
//
// Aralık iki senaryo olarak taşınır: "alt" senaryo (girdi aralıklarının alt ucu) ve "üst" senaryo (üst ucu).
// İşlemler senaryo senaryo yapılır; böylece aynı borç aralığını içeren iki yolun farkı aralığı genişletmez
// (A + [300, 450] − [300, 450] = A). Çıktıda (bilgi()) aralık her zaman alt ≤ üst olarak yazılır; iki senaryo
// aynı sonuca inerse tutar bilinen olur. Bilinmiyor, girdiği her işlemde yayılır ve nedenini taşır.
import type { TutarBilgisi } from '../contract';
import { Para } from './Para';
import { kuralHatasi, nedenleriBirlestir } from './bicim';

type Durum =
  | { tur: 'bilinen'; deger: Para; kaynaklar: readonly string[] }
  | { tur: 'aralik'; alt: Para; ust: Para; kaynaklar: readonly string[] }
  | { tur: 'bilinmiyor'; nedenler: readonly string[] };

const liste = (x: string | readonly string[]) => (typeof x === 'string' ? [x] : [...x]);
const birlestir = (a: readonly string[], b: readonly string[]) => [...new Set([...a, ...b])].filter((s) => s.length > 0);

export class Tutar {
  private constructor(private readonly d: Durum) {}

  static bilinen(deger: Para, kaynak: string | readonly string[]): Tutar {
    return new Tutar({ tur: 'bilinen', deger, kaynaklar: liste(kaynak) });
  }

  /** İki senaryolu tutar; senaryolar eşitse bilinen olur. */
  static aralik(alt: Para, ust: Para, kaynak: string | readonly string[]): Tutar {
    if (alt.esit(ust)) return Tutar.bilinen(alt, kaynak);
    return new Tutar({ tur: 'aralik', alt, ust, kaynaklar: liste(kaynak) });
  }

  static bilinmiyor(neden: string | readonly string[]): Tutar {
    return new Tutar({ tur: 'bilinmiyor', nedenler: liste(neden) });
  }

  static sifir(kaynak = 'Ödeme yok'): Tutar {
    return Tutar.bilinen(Para.sifir(), kaynak);
  }

  /** Sözleşme değerini doğrulayarak çevirir. Ters aralık (alt > üst) ve geçersiz TL metni RangeError verir. */
  static bilgiden(b: TutarBilgisi): Tutar {
    switch (b.tur) {
      case 'bilinen':
        return Tutar.bilinen(Para.tlden(b.tl), b.kaynak);
      case 'aralik': {
        const alt = Para.tlden(b.altTl);
        const ust = Para.tlden(b.ustTl);
        if (alt.karsilastir(ust) > 0) throw kuralHatasi('Aralığın alt ucu üst ucundan büyük olamaz.', { altTl: b.altTl, ustTl: b.ustTl });
        return Tutar.aralik(alt, ust, b.kaynak);
      }
      case 'bilinmiyor':
        if (typeof b.neden !== 'string' || b.neden.trim() === '') throw new RangeError('Bilinmeyen tutarın nedeni yazılmalı.');
        return Tutar.bilinmiyor(b.neden);
      default:
        throw new RangeError('Geçersiz tutar bilgisi.');
    }
  }

  /** Boş liste sıfırdır (bosKaynak etiketiyle). */
  static toplam(tutarlar: readonly Tutar[], bosKaynak = 'Ödeme yok'): Tutar {
    if (tutarlar.length === 0) return Tutar.sifir(bosKaynak);
    return tutarlar.slice(1).reduce((acc, t) => acc.topla(t), tutarlar[0]);
  }

  /** Senaryo senaryo ikili işlem. Bilinmiyor yayılır; kaynaklar ve nedenler birleşir. */
  esle(diger: Tutar, islem: (a: Para, b: Para) => Para): Tutar {
    const a = this.d;
    const b = diger.d;
    if (a.tur === 'bilinmiyor' || b.tur === 'bilinmiyor') {
      return Tutar.bilinmiyor(birlestir(a.tur === 'bilinmiyor' ? a.nedenler : [], b.tur === 'bilinmiyor' ? b.nedenler : []));
    }
    const kaynak = birlestir(a.kaynaklar, b.kaynaklar);
    if (a.tur === 'bilinen' && b.tur === 'bilinen') return Tutar.bilinen(islem(a.deger, b.deger), kaynak);
    const [aAlt, aUst] = a.tur === 'bilinen' ? [a.deger, a.deger] : [a.alt, a.ust];
    const [bAlt, bUst] = b.tur === 'bilinen' ? [b.deger, b.deger] : [b.alt, b.ust];
    return Tutar.aralik(islem(aAlt, bAlt), islem(aUst, bUst), kaynak);
  }

  /**
   * Senaryo senaryo çok girdili işlem (esle'nin genellemesi): her senaryoda girdilerin o senaryodaki değerleri verilir.
   * Bilinmiyor yayılır (nedenler birleşir); hepsi bilinense sonuç bilinendir.
   */
  static senaryoIslemi(tutarlar: readonly Tutar[], islem: (degerler: readonly Para[]) => Para): Tutar {
    const nedenler = tutarlar.reduce<readonly string[]>((acc, t) => (t.d.tur === 'bilinmiyor' ? birlestir(acc, t.d.nedenler) : acc), []);
    if (tutarlar.some((t) => t.d.tur === 'bilinmiyor')) return Tutar.bilinmiyor(nedenler);
    const kaynak = tutarlar.reduce<readonly string[]>((acc, t) => (t.d.tur === 'bilinmiyor' ? acc : birlestir(acc, t.d.kaynaklar)), []);
    const senaryo = (i: 0 | 1) => islem(tutarlar.map((t) => t.senaryolar()![i]));
    if (tutarlar.every((t) => t.d.tur === 'bilinen')) return Tutar.bilinen(senaryo(0), kaynak);
    return Tutar.aralik(senaryo(0), senaryo(1), kaynak);
  }

  /** Her senaryoya tekli işlem. */
  donustur(islem: (p: Para) => Para): Tutar {
    const d = this.d;
    if (d.tur === 'bilinmiyor') return this;
    if (d.tur === 'bilinen') return Tutar.bilinen(islem(d.deger), d.kaynaklar);
    return Tutar.aralik(islem(d.alt), islem(d.ust), d.kaynaklar);
  }

  topla(diger: Tutar): Tutar {
    return this.esle(diger, (a, b) => a.topla(b));
  }

  cikar(diger: Tutar): Tutar {
    return this.esle(diger, (a, b) => a.cikar(b));
  }

  negatif(): Tutar {
    return this.donustur((p) => p.negatif());
  }

  carp(oran: number, tamCarpan = 1): Tutar {
    return this.donustur((p) => p.carp(oran, tamCarpan));
  }

  carpTam(carpan: number): Tutar {
    return this.donustur((p) => p.carpTam(carpan));
  }

  bilinmiyorMu(): boolean {
    return this.d.tur === 'bilinmiyor';
  }

  /** [alt senaryo, üst senaryo]; bilinende ikisi aynı; bilinmiyorsa null. Sıralı olmak zorunda değildir. */
  senaryolar(): [Para, Para] | null {
    const d = this.d;
    if (d.tur === 'bilinmiyor') return null;
    return d.tur === 'bilinen' ? [d.deger, d.deger] : [d.alt, d.ust];
  }

  nedenler(): readonly string[] {
    return this.d.tur === 'bilinmiyor' ? this.d.nedenler : [];
  }

  /** Sıralama ölçütü: iki senaryonun toplamı (ortanın iki katı, kuruş); bilinmiyorsa null. */
  ortaIkiKati(): number | null {
    const s = this.senaryolar();
    return s === null ? null : s[0].kurus + s[1].kurus;
  }

  bilgi(): TutarBilgisi {
    const d = this.d;
    if (d.tur === 'bilinmiyor') return { tur: 'bilinmiyor', neden: nedenleriBirlestir(d.nedenler) };
    const kaynak = d.kaynaklar.join('; ');
    if (d.tur === 'bilinen') return { tur: 'bilinen', tl: d.deger.tlMetni(), kaynak };
    const alt = Para.enKucuk(d.alt, d.ust);
    const ust = Para.enBuyuk(d.alt, d.ust);
    return { tur: 'aralik', altTl: alt.tlMetni(), ustTl: ust.tlMetni(), kaynak };
  }
}

/** TutarBilgisi işlemleri (sözleşme değerleri üzerinde). Aralık uçları ayrı hesaplanır; bilinmiyor yayılır. */
export const TutarIslemleri = Object.freeze({
  topla(a: TutarBilgisi, b: TutarBilgisi): TutarBilgisi {
    return Tutar.bilgiden(a).topla(Tutar.bilgiden(b)).bilgi();
  },
  cikar(a: TutarBilgisi, b: TutarBilgisi): TutarBilgisi {
    return Tutar.bilgiden(a).cikar(Tutar.bilgiden(b)).bilgi();
  },
  negatif(a: TutarBilgisi): TutarBilgisi {
    return Tutar.bilgiden(a).negatif().bilgi();
  },
  toplam(tutarlar: readonly TutarBilgisi[]): TutarBilgisi {
    return Tutar.toplam(tutarlar.map((t) => Tutar.bilgiden(t))).bilgi();
  },
  /** '₺8.500,00', '₺300.000,00 – ₺450.000,00' ya da 'Bilinmiyor'. */
  goster(t: TutarBilgisi): string {
    if (t.tur === 'bilinen') return Para.tlden(t.tl).goster();
    if (t.tur === 'aralik') return `${Para.tlden(t.altTl).goster()} – ${Para.tlden(t.ustTl).goster()}`;
    return 'Bilinmiyor';
  },
});
