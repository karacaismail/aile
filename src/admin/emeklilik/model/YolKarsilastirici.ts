// İki yolun ortak dönemde nakit karşılaştırması.
//
// Ortak dönem: erken emekli olan yolun emeklilik ayından başlar; geç yolun emeklilik ayından sonra
// karsilastirmaSuresiYil yıl sürer. Her yol emeklilik ayını izleyen aydan itibaren aylık alır
// (aylık − borç kesintisi − diğer kesintiler). isUcretiDevam=false ise emekli olan yol iş ücretini bırakır;
// henüz emekli olmayan yol zamlı ücreti almaya devam eder. Ek ödeme = yolun ödemesi − referansın ödemesi;
// Bağ-Kur yalnız bir yolda seçiliyse, Bağ-Kur'u seçmeyen yolda da ödenecek ortak tutar farktan düşülür.
// Bilinmeyen herhangi bir girdi sonucu 'bilinmiyor' yapar ve nedenini taşır; aralık girdiler aralık sonuç verir.
// Faiz, enflasyon ve ileride aylık/ücret zamları hesaba katılmaz.
import type { AyMetni, KarsilastirmaSonucu, Secim, TutarBilgisi, YolSonucu } from '../contract';
import { Ay } from './Ay';
import type { Para } from './Para';
import { Tutar } from './Tutar';
import { nedenleriBirlestir } from './bicim';

/** Karşılaştırıcının yoldan beklediği. */
export interface KarsilastirilabilirYol {
  readonly secim: Secim;
  readonly emeklilikAyi: Ay | null;
  readonly odeme: Tutar;
  /** Emekliliğin ilk n ayında eline geçen net aylık toplamı. */
  emekliGeliri(n: number): Tutar;
  sonuc(): YolSonucu;
}

export interface KarsilastirmaKosullari {
  /** Aylık net iş ücreti (zam varsayımı uygulanmış). */
  ucret: Para;
  /** Bağ-Kur'u seçmeyen yolda da ödenecek Bağ-Kur tutarı. */
  ortakOdeme: TutarBilgisi;
  karsilastirmaSuresiYil: number;
  isUcretiDevam: boolean;
}

/** Sözleşmedeki KarsilastirmaSonucu + görünüm için ek alanlar (geriye uyumlu üst küme). */
export interface KarsilastirmaAyrintisi extends KarsilastirmaSonucu {
  /** Geri kazanma süresinin alt/üst senaryosu; sözleşme alanı en uzun (ihtiyatlı) olanı taşır. */
  geriKazanmaAraligi: { alt: number; ust: number } | null;
  /** Mali sonucu engelleyen nedenler (tekrarsız); hesaplanamayanNeden bunların birleşimidir. */
  nedenler: readonly string[];
  /** Geç yolun emeklilik ayı ve ortak dönemin son ayı. */
  gecYolAyi: AyMetni | null;
  donemBitisAyi: AyMetni | null;
}

/** Geri kazanma aramasının üst sınırı (100 yıl). */
const GERI_KAZANMA_AZAMI_AY = 1200;

export class YolKarsilastirici {
  private readonly ortak: Tutar;

  constructor(private readonly k: KarsilastirmaKosullari) {
    if (!Number.isSafeInteger(k.karsilastirmaSuresiYil) || k.karsilastirmaSuresiYil < 0 || k.karsilastirmaSuresiYil > 40) {
      throw new RangeError(`Karşılaştırma süresi 0–40 yıl arasında tamsayı olmalı: ${k.karsilastirmaSuresiYil}`);
    }
    if (k.ucret.negatifMi()) throw new RangeError('İş ücreti negatif olamaz.');
    this.ortak = Tutar.bilgiden(k.ortakOdeme);
  }

  /** yol − referans. */
  karsilastir(yol: KarsilastirilabilirYol, referans: KarsilastirilabilirYol): KarsilastirmaAyrintisi {
    const ekOdeme = this.ekOdeme(yol, referans);
    const yAy = yol.emeklilikAyi;
    const rAy = referans.emeklilikAyi;
    const temel = { referans: referans.sonuc(), yol: yol.sonuc(), ekOdeme: ekOdeme.bilgi() };

    if (yAy === null || rAy === null) {
      const neden = 'Emeklilik tarihi hesaplanamıyor: planlanan çalışmayla gün hedefine ulaşılamıyor.';
      const bilinmiyor: TutarBilgisi = { tur: 'bilinmiyor', neden };
      return {
        ...temel, erkenAy: null, gecYolEmekliOlunca: bilinmiyor, donemSonunda: bilinmiyor,
        geriKazanmaAylikSayisi: null, geriKazanmaAraligi: null, hesaplanamayanNeden: neden, nedenler: [neden], gecYolAyi: null, donemBitisAyi: null,
      };
    }

    const baslangic = Ay.enErken(yAy, rAy);
    const gec = Ay.enGec(yAy, rAy);
    const bitis = gec.ekle(12 * this.k.karsilastirmaSuresiYil);
    const fark = (t: Ay) => this.gelir(yol, yAy, baslangic, t).cikar(this.gelir(referans, rAy, baslangic, t)).cikar(ekOdeme);
    const gecYolEmekliOlunca = fark(gec);
    const donemSonunda = fark(bitis);
    const geri = this.geriKazanma(yol, ekOdeme);
    const nedenler = [...new Set([...gecYolEmekliOlunca.nedenler(), ...donemSonunda.nedenler()])];

    return {
      ...temel,
      erkenAy: rAy.fark(yAy),
      gecYolEmekliOlunca: gecYolEmekliOlunca.bilgi(),
      donemSonunda: donemSonunda.bilgi(),
      geriKazanmaAylikSayisi: geri === null ? null : Math.max(geri.alt, geri.ust),
      geriKazanmaAraligi: geri,
      hesaplanamayanNeden: nedenler.length > 0 ? nedenleriBirlestir(nedenler) : null,
      nedenler,
      gecYolAyi: gec.metin(),
      donemBitisAyi: bitis.metin(),
    };
  }

  private ekOdeme(yol: KarsilastirilabilirYol, referans: KarsilastirilabilirYol): Tutar {
    const fark = yol.odeme.cikar(referans.odeme);
    if (yol.secim.bagkur && !referans.secim.bagkur) return fark.cikar(this.ortak);
    if (!yol.secim.bagkur && referans.secim.bagkur) return fark.topla(this.ortak);
    return fark;
  }

  /** Dönem başından t ayı sonuna kadar yolun geliri: aylıklar + (iş ücreti devam etmiyorsa) emekli olmadan alınan ücret. */
  private gelir(yol: KarsilastirilabilirYol, emeklilik: Ay, baslangic: Ay, t: Ay): Tutar {
    const aylik = yol.emekliGeliri(Math.max(0, t.fark(emeklilik)));
    if (this.k.isUcretiDevam) return aylik;
    const calisilanAy = Math.max(0, Ay.enErken(t, emeklilik).fark(baslangic));
    return calisilanAy === 0 ? aylik : aylik.topla(Tutar.bilinen(this.k.ucret.carpTam(calisilanAy), 'Zamlı net iş ücreti'));
  }

  /** Ek ödemeyi yolun kendi net aylıklarıyla karşılamak için gereken aylık sayısı (senaryo başına). */
  private geriKazanma(yol: KarsilastirilabilirYol, ekOdeme: Tutar): { alt: number; ust: number } | null {
    const ek = ekOdeme.senaryolar();
    if (ek === null) return null;
    const sonuc: Array<number | null> = ek.map((e) => (e.pozitifMi() ? null : 0));
    for (let n = 1; n <= GERI_KAZANMA_AZAMI_AY && sonuc.some((s) => s === null); n += 1) {
      const gelir = yol.emekliGeliri(n).senaryolar();
      if (gelir === null) return null;
      for (const i of [0, 1]) {
        if (sonuc[i] === null && gelir[i].karsilastir(ek[i]) >= 0) sonuc[i] = n;
      }
    }
    const [alt, ust] = sonuc;
    return alt === null || ust === null ? null : { alt, ust };
  }
}
