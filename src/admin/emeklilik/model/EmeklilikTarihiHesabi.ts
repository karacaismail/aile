// Emeklilik planlama ayı: prim günü hedefine ulaşılan ay ile sigortalılık süresinin dolduğu ayın geç olanı.
// 18 yaşından önce başlayan sigortalılıkta süre 18. doğum gününden başlar. Planlama ayı kayıt ayından önce olamaz.
// Yaş şartı kapsam dışıdır; profil isteğe bağlı asgariYas taşırsa planlama ayı o yaşın dolduğu aydan önce olamaz.
// Belirleyen: gün ya da süre (sinirlayanKosul); ikisi de daha önce dolmuşsa yaş şartı ya da kayıt ayı (sinirlayanAyrinti).
import type { EmeklilikProfili, Varsayimlar } from '../contract';
import { Ay, TakvimGunu } from './Ay';
import type { HizmetTakvimi } from './HizmetTakvimi';

export interface TarihSonucu {
  emeklilikAyi: Ay | null;
  /** Gün hedefinin dolduğu ay (gün zaten yetiyorsa kayıtlı ay). */
  gunAyi: Ay | null;
  /** Sigortalılık süresinin dolduğu ay. */
  sureAyi: Ay;
  sinirlayanKosul: 'gun' | 'sigortalilikSuresi' | null;
  /** sinirlayanKosul null ve tarih varken belirleyen: asgari yaş şartı ya da kayıt ayı; diğer durumlarda null. */
  sinirlayanAyrinti: 'asgariYas' | 'kayitAyi' | null;
  /** Emeklilik ayı sonundaki yaş. */
  yas: number | null;
  /** Hedefe ulaşmak için planlanan çalışmadan gereken gün (ulaşılamıyorsa planlanan çalışmanın tamamı). */
  calisarakTamamlananGun: number;
  /** Emeklilik ayı sonunda toplam gün (kayıtlı + düzeltme + seçenekler + o aya kadar planlanan çalışma). */
  toplamGun: number | null;
  /** Emeklilik ayı sonuna kadar planlanan SSK günü (aylık modeli girdisi). */
  calismaGunu: number | null;
}

/** Profildeki asgari yaşın üst sınırı (yazım denetimi). */
export const ASGARI_YAS_UST = 100;

export class EmeklilikTarihiHesabi {
  private readonly dogum: TakvimGunu;
  private readonly giris: TakvimGunu;
  private readonly kayitAyi: Ay;

  constructor(private readonly profil: EmeklilikProfili, private readonly takvim: HizmetTakvimi) {
    this.dogum = TakvimGunu.metinden(profil.dogumTarihi);
    this.giris = TakvimGunu.metinden(profil.ilkSigortaGirisi);
    this.kayitAyi = Ay.tarihten(profil.kayitTarihi);
    if (!Number.isSafeInteger(profil.hedefGun) || profil.hedefGun <= 0) throw new RangeError(`Hedef gün pozitif tamsayı olmalı: ${profil.hedefGun}`);
    if (!Number.isSafeInteger(profil.sigortalilikYili) || profil.sigortalilikYili < 0) throw new RangeError(`Sigortalılık yılı geçersiz: ${profil.sigortalilikYili}`);
    const yas = profil.asgariYas;
    if (yas !== undefined && (!Number.isSafeInteger(yas) || yas < 0 || yas > ASGARI_YAS_UST)) {
      throw new RangeError(`Asgari yaş 0–${ASGARI_YAS_UST} arasında tamsayı olmalı: ${yas}`);
    }
  }

  /** Profilde asgari yaş varsa o yaşın dolduğu ay; yoksa null. */
  yasSartiAyi(): Ay | null {
    return this.profil.asgariYas === undefined ? null : this.dogum.yilEkle(this.profil.asgariYas).ay();
  }

  sigortalilikBaslangici(): TakvimGunu {
    return TakvimGunu.enGec(this.giris, this.dogum.yilEkle(18));
  }

  sigortalilikSuresiDolumu(): TakvimGunu {
    return this.sigortalilikBaslangici().yilEkle(this.profil.sigortalilikYili);
  }

  hesapla(ekGun: number, varsayim: Varsayimlar): TarihSonucu {
    const sureAyi = this.sigortalilikSuresiDolumu().ay();
    const hedefGun = this.profil.hedefGun;
    const baz = this.takvim.bazGun(varsayim) + ekGun;
    const ulasma = this.takvim.hedefeUlasma(ekGun, varsayim);
    if (ulasma === null) {
      return {
        emeklilikAyi: null, gunAyi: null, sureAyi, sinirlayanKosul: null, sinirlayanAyrinti: null, yas: null,
        calisarakTamamlananGun: this.takvim.planliToplam(varsayim) ?? 0, toplamGun: null, calismaGunu: null,
      };
    }
    const gunAyi = ulasma.ay;
    const yasAyi = this.yasSartiAyi();
    const gunVeSure = Ay.enGec(gunAyi, sureAyi);
    const sartlar = yasAyi === null ? gunVeSure : Ay.enGec(gunVeSure, yasAyi);
    const emeklilikAyi = Ay.enGec(sartlar, this.kayitAyi);
    const { sinirlayanKosul, sinirlayanAyrinti } = this.kayitAyi.sonrasiMi(sartlar)
      ? { sinirlayanKosul: null, sinirlayanAyrinti: 'kayitAyi' as const }
      : yasAyi !== null && yasAyi.sonrasiMi(gunVeSure)
        ? { sinirlayanKosul: null, sinirlayanAyrinti: 'asgariYas' as const }
        : { sinirlayanKosul: sureAyi.sonrasiMi(gunAyi) ? 'sigortalilikSuresi' as const : 'gun' as const, sinirlayanAyrinti: null };
    const calismaGunu = this.takvim.calismaGunuAyaKadar(emeklilikAyi, varsayim);
    return {
      emeklilikAyi,
      gunAyi,
      sureAyi,
      sinirlayanKosul,
      sinirlayanAyrinti,
      yas: this.dogum.yasi(emeklilikAyi.aySonu()),
      calisarakTamamlananGun: Math.max(0, hedefGun - baz),
      toplamGun: baz + calismaGunu,
      calismaGunu,
    };
  }
}
