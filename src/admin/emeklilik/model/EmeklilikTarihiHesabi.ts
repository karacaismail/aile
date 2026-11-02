// Emeklilik planlama ayı: prim günü hedefine ulaşılan ay ile sigortalılık süresinin dolduğu ayın geç olanı.
// 18 yaşından önce başlayan sigortalılıkta süre 18. doğum gününden başlar. Planlama ayı kayıt ayından önce olamaz.
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
  /** Emeklilik ayı sonundaki yaş. */
  yas: number | null;
  /** Hedefe ulaşmak için planlanan çalışmadan gereken gün (ulaşılamıyorsa planlanan çalışmanın tamamı). */
  calisarakTamamlananGun: number;
  /** Emeklilik ayı sonunda toplam gün (kayıtlı + düzeltme + seçenekler + o aya kadar planlanan çalışma). */
  toplamGun: number | null;
  /** Emeklilik ayı sonuna kadar planlanan SSK günü (aylık modeli girdisi). */
  calismaGunu: number | null;
}

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
        emeklilikAyi: null, gunAyi: null, sureAyi, sinirlayanKosul: null, yas: null,
        calisarakTamamlananGun: this.takvim.planliToplam(varsayim) ?? 0, toplamGun: null, calismaGunu: null,
      };
    }
    const gunAyi = ulasma.ay;
    const sinirlayanKosul = sureAyi.sonrasiMi(gunAyi) ? 'sigortalilikSuresi' : 'gun';
    const emeklilikAyi = Ay.enGec(Ay.enGec(gunAyi, sureAyi), this.kayitAyi);
    const calismaGunu = this.takvim.calismaGunuAyaKadar(emeklilikAyi, varsayim);
    return {
      emeklilikAyi,
      gunAyi,
      sureAyi,
      sinirlayanKosul,
      yas: this.dogum.yasi(emeklilikAyi.aySonu()),
      calisarakTamamlananGun: Math.max(0, hedefGun - baz),
      toplamGun: baz + calismaGunu,
      calismaGunu,
    };
  }
}
