// İki yolun ortak dönemde nakit karşılaştırması.
//
// Ortak dönem: erken emekli olan yolun emeklilik ayından başlar; geç yolun emeklilik ayından sonra
// karsilastirmaSuresiYil yıl sürer. Her yol emeklilik ayını izleyen aydan itibaren aylık alır
// (aylık − borç kesintisi − diğer kesintiler, ayda en az 0). isUcretiDevam=false ise emekli olan yol iş ücretini bırakır;
// henüz emekli olmayan yol zamlı ücreti almaya devam eder. Ek ödeme = yolun ödemesi − referansın ödemesi;
// Bağ-Kur yalnız bir yolda seçiliyse, Bağ-Kur'u seçmeyen yolda da ödenecek ortak tutar farktan düşülür.
// Geri kazanma (başa baş, Codex aracının tanımı): referansa göre birikimli fark(t) = gelir farkı − ek ödeme (vazgeçilen
// ücret dahil) senaryo başına eksiye düştükten sonra ilk kez ≥ 0 olduğu ay; dönem başından (erken emeklilik ayı) sayılır.
// Fark dönem boyunca hiç eksiye düşmüyorsa 0 ("gerekmez"; ek ödeme yoksa ve vazgeçilen ücret farkı eksiye itmiyorsa).
// Eksiye düşüp dönem içinde dönmüyorsa null ve neden yoktur ("geri dönmüyor"); girdi bilinmiyorsa null ve neden
// hesaplanamayanNeden'dedir. Tarama yolların gelir kırılımlarıyla parça parça yapılır (parça içinde fark doğrusaldır).
// Bilinmeyen herhangi bir girdi sonucu 'bilinmiyor' yapar ve nedenini taşır; aralık girdiler aralık sonuç verir.
// Faiz, enflasyon ve ileride aylık/ücret zamları hesaba katılmaz.
import type { AyMetni, KarsilastirmaSonucu, SecenekAnahtari, Secim, TutarBilgisi, YolSonucu } from '../contract';
import { Ay } from './Ay';
import type { Para } from './Para';
import { Tutar } from './Tutar';
import { kuralHatasi, nedenleriBirlestir } from './bicim';

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
  /**
   * İsteğe bağlı: emekliliğin hangi aylarından (1 tabanlı, artan) başlayarak aylık net gelir değişebilir; iki kırılım
   * arasında aylık net sabittir (ör. borç kesintisinin son ayı ve sonrası). Verilirse geri kazanma yalnız parça uçlarında
   * hesaplanır; verilmezse her ay ayrı taranır. Eksik bildirilen kırılım sonucu bozmaz: parça doğrusal çıkmazsa
   * karşılaştırıcı ay ay taramaya döner.
   */
  gelirKirilimlari?(): readonly number[];
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

/** ⌈pay / payda⌉; pay ≥ 0, payda > 0, kuruş tamsayıları (BigInt: büyük tutarda kayan nokta bölme hatası yok). */
const tavanBol = (pay: number, payda: number) => Number((BigInt(pay) + BigInt(payda) - 1n) / BigInt(payda));
/** ⌊pay / payda⌋; pay ≥ 0, payda > 0. */
const tabanBol = (pay: number, payda: number) => Number(BigInt(pay) / BigInt(payda));

/** Senaryonun tarama durumu: önceki ayın farkı (kuruş), fark eksiye düştü mü, sonuç (undefined: henüz karar yok). */
interface TaramaDurumu { onceki: number; eksi: boolean; sonuc: number | null | undefined }

export class YolKarsilastirici {
  private readonly ortak: Tutar;

  constructor(private readonly k: KarsilastirmaKosullari) {
    if (!Number.isSafeInteger(k.karsilastirmaSuresiYil) || k.karsilastirmaSuresiYil < 0 || k.karsilastirmaSuresiYil > 40) {
      throw kuralHatasi('Karşılaştırma süresi 0–40 yıl arasında tamsayı olmalı.', { karsilastirmaSuresiYil: k.karsilastirmaSuresiYil });
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
    const son = bitis.fark(baslangic);
    const geri = this.geriKazanma(fark, baslangic, son, this.parcaBaslari(yol, yAy.fark(baslangic), referans, rAy.fark(baslangic), son));
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
   * Birikimli farkın aylık artışının sabit olduğu parçaların ilk ayları (dönem başından, 1 … son): 1, her yolun emeklilik
   * ayından sonraki ay (aylık başlar, ücret biter) ve yolun gelir kırılımları. Yollardan biri kırılım bildirmezse null
   * (her ay ayrı parça).
   */
  private parcaBaslari(yol: KarsilastirilabilirYol, yolOfseti: number, referans: KarsilastirilabilirYol, refOfseti: number, son: number): number[] | null {
    if (!yol.gelirKirilimlari || !referans.gelirKirilimlari) return null;
    const aylar = new Set<number>([1, yolOfseti + 1, refOfseti + 1]);
    for (const i of yol.gelirKirilimlari()) aylar.add(yolOfseti + i);
    for (const i of referans.gelirKirilimlari()) aylar.add(refOfseti + i);
    return [...aylar].filter((ay) => ay >= 1 && ay <= son).sort((a, b) => a - b);
  }

  /**
   * Başa baş, senaryo başına (dönem başından ay): birikimli fark (ödeme ve vazgeçilen ücret dahil) dönem boyunca hiç
   * eksiye düşmüyorsa 0 (gerekmez); düşüyorsa eksiye düştükten sonra ilk kez ≥ 0 olduğu ay; dönem sonuna kadar dönmüyorsa
   * null. Taranan bir ayda fark bilinmiyorsa bütünü null.
   * Tarama parça parça: parça içinde aylık artış sabit, fark doğrusaldır; yalnız parça uçları kesin hesaplanır, eşik geçişi
   * tamsayı bölmeyle bulunur (her ayı hesaplamakla bit düzeyinde aynı). Bir parçanın uç değeri doğrusal tahminle tutmazsa
   * (kırılım eksik bildirilmiş) ay ay taramaya dönülür. parcalar null: her ay ayrı parça.
   */
  private geriKazanma(fark: (t: Ay) => Tutar, baslangic: Ay, son: number, parcalar: readonly number[] | null): { alt: number | null; ust: number | null } | null {
    const deger = (ay: number) => fark(baslangic.ekle(ay)).senaryolar();
    const ilk = deger(0);
    if (ilk === null) return null;
    const durum: TaramaDurumu[] = ilk.map((p) => ({ onceki: p.kurus, eksi: p.negatifMi(), sonuc: undefined }));
    const baslar = parcalar ?? Array.from({ length: son }, (_, i) => i + 1);
    for (let k = 0; k < baslar.length && durum.some((d) => d.sonuc === undefined); k += 1) {
      const ilkAy = baslar[k]!;
      const sonAy = k + 1 < baslar.length ? baslar[k + 1]! - 1 : son;
      const bas = deger(ilkAy);
      const bit = sonAy === ilkAy ? bas : deger(sonAy);
      if (bas === null || bit === null) return null;
      const uzunluk = sonAy - ilkAy + 1;
      const artislar = durum.map((d, i) => bas[i]!.kurus - d.onceki);
      // Ay ay taramada (parcalar null) her parça tek aydır ve bu denetim kendiliğinden tutar.
      const dogrusal = durum.every((d, i) => d.sonuc !== undefined || d.onceki + artislar[i]! * uzunluk === bit[i]!.kurus);
      if (!dogrusal && parcalar !== null) return this.geriKazanma(fark, baslangic, son, null);
      durum.forEach((d, i) => {
        if (d.sonuc !== undefined) return;
        const artis = artislar[i]!;
        // Eksiye ilk düşüş: önceki ≥ 0, azalan parça; parça içinde (azalırken) geri dönüş olmaz.
        if (!d.eksi && artis < 0 && tabanBol(d.onceki, -artis) + 1 <= uzunluk) d.eksi = true;
        // Geri dönüş: önceki < 0, artan parça; ilk ≥ 0 ay.
        else if (d.eksi && artis > 0 && tavanBol(-d.onceki, artis) <= uzunluk) d.sonuc = ilkAy - 1 + tavanBol(-d.onceki, artis);
        d.onceki = bit[i]!.kurus;
      });
    }
    const sonuc = (d: TaramaDurumu) => (d.sonuc !== undefined ? d.sonuc : d.eksi ? null : 0);
    return { alt: sonuc(durum[0]!), ust: sonuc(durum[1]!) };
  }
}
