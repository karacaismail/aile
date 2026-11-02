// İki yolun ortak dönemde nakit karşılaştırması.
//
// Ortak dönem: erken emekli olan yolun emeklilik ayından başlar; geç yolun emeklilik ayından sonra
// karsilastirmaSuresiYil yıl sürer. Her yol emeklilik ayını izleyen aydan itibaren aylık alır
// (aylık − borç kesintisi − diğer kesintiler, ayda en az 0). isUcretiDevam=false ise emekli olan yol iş ücretini bırakır;
// henüz emekli olmayan yol zamlı ücreti almaya devam eder. Ek ödeme = yolun ödemesi − referansın ödemesi;
// Bağ-Kur yalnız bir yolda seçiliyse, Bağ-Kur'u seçmeyen yolda da ödenecek ortak tutar farktan düşülür.
// Geri kazanma (başa baş, Codex aracının tanımı): referansa göre birikimli fark(t) = gelir farkı − ek ödeme (vazgeçilen
// ücret dahil) senaryo başına ilk kez ≥ 0 olduğu ay; dönem başından (erken emeklilik ayı) sayılır. Dönem içinde
// yoksa null ve neden yoktur ("geri dönmüyor"); girdi bilinmiyorsa null ve neden hesaplanamayanNeden'dedir.
// Bilinmeyen herhangi bir girdi sonucu 'bilinmiyor' yapar ve nedenini taşır; aralık girdiler aralık sonuç verir.
// Faiz, enflasyon ve ileride aylık/ücret zamları hesaba katılmaz.
import type { AyMetni, KarsilastirmaSonucu, SecenekAnahtari, Secim, TutarBilgisi, YolSonucu } from '../contract';
import { Ay } from './Ay';
import type { Para } from './Para';
import { Tutar } from './Tutar';
import { nedenleriBirlestir } from './bicim';

/** Karşılaştırıcının yoldan beklediği. */
export interface KarsilastirilabilirYol {
  readonly secim: Secim;
  readonly emeklilikAyi: Ay | null;
  readonly odeme: Tutar;
  /**
   * İsteğe bağlı ödeme kalemleri (seçenek başına). İki yolda da verilirse aynı seçeneğin aynı kalemi ek ödemede birbirini
   * götürür (bilinmese de): ek ödeme yalnız farklı kalemlerden hesaplanır (Codex: ortak borç ve askerlik bedeli düşer).
   */
  readonly kalemler?: ReadonlyArray<{ readonly anahtar: SecenekAnahtari; readonly tutar: Tutar }>;
  /** Emekliliğin ilk n ayında eline geçen net aylık toplamı. */
  emekliGeliri(n: number): Tutar;
  sonuc(): YolSonucu;
}

export interface KarsilastirmaKosullari {
  /** Aylık net iş ücreti (zam varsayımı uygulanmış). */
  ucret: Para;
  /** Ücretin kaynağı (ekranda tutarın yanında yazılır); verilmezse 'Zamlı net iş ücreti'. */
  ucretKaynagi?: string;
  /** Bağ-Kur'u seçmeyen yolda da ödenecek Bağ-Kur tutarı. */
  ortakOdeme: TutarBilgisi;
  karsilastirmaSuresiYil: number;
  isUcretiDevam: boolean;
}

/** Sözleşmedeki KarsilastirmaSonucu + görünüm için ek alanlar (geriye uyumlu üst küme). */
export interface KarsilastirmaAyrintisi extends KarsilastirmaSonucu {
  /**
   * Geri kazanma süresinin alt/üst senaryosu (dönem başından ay); senaryoda dönem içinde başa baş yoksa o uç null.
   * Bütünü null: girdi bilinmiyor. Sözleşme alanı iki uç da varsa en uzun (ihtiyatlı) olanı, yoksa null taşır.
   */
  geriKazanmaAraligi: { alt: number | null; ust: number | null } | null;
  /** Mali sonucu engelleyen nedenler (tekrarsız); hesaplanamayanNeden bunların birleşimidir. */
  nedenler: readonly string[];
  /** Geç yolun emeklilik ayı ve ortak dönemin son ayı. */
  gecYolAyi: AyMetni | null;
  donemBitisAyi: AyMetni | null;
}

const UCRET_KAYNAGI = 'Zamlı net iş ücreti';

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
    const isUcreti: TutarBilgisi = { tur: 'bilinen', tl: this.k.ucret.tlMetni(), kaynak: this.k.ucretKaynagi ?? UCRET_KAYNAGI };
    const temel = { referans: referans.sonuc(), yol: yol.sonuc(), ekOdeme: ekOdeme.bilgi(), isUcreti };

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
    const geri = this.geriKazanma(fark, baslangic, bitis);
    const nedenler = [...new Set([...gecYolEmekliOlunca.nedenler(), ...donemSonunda.nedenler()])];

    return {
      ...temel,
      erkenAy: rAy.fark(yAy),
      gecYolEmekliOlunca: gecYolEmekliOlunca.bilgi(),
      donemSonunda: donemSonunda.bilgi(),
      geriKazanmaAylikSayisi: geri === null || geri.alt === null || geri.ust === null ? null : Math.max(geri.alt, geri.ust),
      geriKazanmaAraligi: geri,
      hesaplanamayanNeden: nedenler.length > 0 ? nedenleriBirlestir(nedenler) : null,
      nedenler,
      gecYolAyi: gec.metin(),
      donemBitisAyi: bitis.metin(),
    };
  }

  private ekOdeme(yol: KarsilastirilabilirYol, referans: KarsilastirilabilirYol): Tutar {
    const fark = this.odemeFarki(yol, referans);
    if (yol.secim.bagkur && !referans.secim.bagkur) return fark.cikar(this.ortak);
    if (!yol.secim.bagkur && referans.secim.bagkur) return fark.topla(this.ortak);
    return fark;
  }

  /** yol − referans ödemesi; iki yolda aynı olan kalemler (aynı seçenek, aynı tutar bilgisi) birbirini götürür. */
  private odemeFarki(yol: KarsilastirilabilirYol, referans: KarsilastirilabilirYol): Tutar {
    if (!yol.kalemler || !referans.kalemler) return yol.odeme.cikar(referans.odeme);
    const imza = (t: Tutar) => JSON.stringify(t.bilgi());
    const ref = new Map(referans.kalemler.map((k) => [k.anahtar, imza(k.tutar)]));
    const ortak = new Set(yol.kalemler.filter((k) => ref.get(k.anahtar) === imza(k.tutar)).map((k) => k.anahtar));
    const ayri = (kalemler: NonNullable<KarsilastirilabilirYol['kalemler']>) =>
      Tutar.toplam(kalemler.filter((k) => !ortak.has(k.anahtar)).map((k) => k.tutar));
    return ayri(yol.kalemler).cikar(ayri(referans.kalemler));
  }

  /** Dönem başından t ayı sonuna kadar yolun geliri: aylıklar + (iş ücreti devam etmiyorsa) emekli olmadan alınan ücret. */
  private gelir(yol: KarsilastirilabilirYol, emeklilik: Ay, baslangic: Ay, t: Ay): Tutar {
    const aylik = yol.emekliGeliri(Math.max(0, t.fark(emeklilik)));
    if (this.k.isUcretiDevam) return aylik;
    const calisilanAy = Math.max(0, Ay.enErken(t, emeklilik).fark(baslangic));
    return calisilanAy === 0 ? aylik : aylik.topla(Tutar.bilinen(this.k.ucret.carpTam(calisilanAy), UCRET_KAYNAGI));
  }

  /**
   * Başa baş: dönem başından kaç ay sonra birikimli fark (ödeme ve vazgeçilen ücret dahil) ilk kez ≥ 0 olur; senaryo
   * başına, dönem sonuna kadar aranır. Fark bilinmiyorsa null.
   */
  private geriKazanma(fark: (t: Ay) => Tutar, baslangic: Ay, bitis: Ay): { alt: number | null; ust: number | null } | null {
    const sonuc: [number | null, number | null] = [null, null];
    const son = bitis.fark(baslangic);
    for (let n = 0; n <= son && (sonuc[0] === null || sonuc[1] === null); n += 1) {
      const deger = fark(baslangic.ekle(n)).senaryolar();
      if (deger === null) return null;
      for (const i of [0, 1] as const) {
        if (sonuc[i] === null && !deger[i].negatifMi()) sonuc[i] = n;
      }
    }
    return { alt: sonuc[0], ust: sonuc[1] };
  }
}
