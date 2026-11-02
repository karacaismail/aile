// Hizmet seçenekleri: geçmiş günleri parayla kazandıran üç yol. Ortak soyut sınıf gün, maliyet, dönem ve
// açıklama sözleşmesini tanımlar; yeni bir seçenek (ör. doğum borçlanması) bu sınıftan türetilerek eklenir.
import type { MevzuatParametreleri, SecenekAnahtari, TlMetni, TutarBilgisi, Varsayimlar } from '../contract';
import { Para } from './Para';
import { tamSayi, yuzde } from './bicim';

/** Günlerin aylık hesabında düştüğü dönem: 2008 Ekim öncesi (eski hesap) ya da sonrası (5510). */
export type HizmetDonemi = 'once2008' | 'sonra2008';

/** Seçeneklerin Türkçe adları (bileşim adları da bunlardan kurulur). */
export const SECENEK_ADLARI: Readonly<Record<SecenekAnahtari, string>> = Object.freeze({
  askerlik: 'Askerlik borçlanması',
  bagkur: 'Bağ-Kur borcunun ödenmesi',
  ihya: 'İhya',
});

export const DONEM_ACIKLAMASI: Readonly<Record<HizmetDonemi, string>> = Object.freeze({
  once2008: '2008 öncesi gün: eski dönem aylığına girer',
  sonra2008: '2008 sonrası gün: yeni dönem aylığına girer',
});

function gunDogrula(gun: number, ad: string, azami: number | null): number {
  if (!Number.isSafeInteger(gun) || gun < 0) throw new RangeError(`${ad} günü sıfır ya da pozitif tamsayı olmalı: ${gun}`);
  if (azami !== null && gun > azami) throw new RangeError(`${ad} günü azami ${azami} günü aşamaz: ${gun}`);
  return gun;
}

export abstract class HizmetSecenegi {
  abstract readonly anahtar: SecenekAnahtari;
  abstract readonly ad: string;

  protected constructor(readonly donem: HizmetDonemi) {}

  /** Seçenekle eklenen gün (varsayımlardaki düzenlenebilir değer). */
  abstract gun(varsayim: Varsayimlar): number;

  /** Geçmiş günler için ödeme. Bilinmeyen tutar uydurulmaz. */
  abstract maliyet(varsayim: Varsayimlar, mevzuat: MevzuatParametreleri): TutarBilgisi;

  /** Kullanıcıya gösterilecek kısa açıklama (Türkçe). */
  abstract aciklama(varsayim: Varsayimlar, mevzuat: MevzuatParametreleri): string;

  /** Kazanç tahmininde bu günlerin asgari ücrete göre katı: borçlanma, ihya ve Bağ-Kur günleri asgari düzeyden (1). */
  kazancKati(): number {
    return 1;
  }

  donemAciklamasi(): string {
    return DONEM_ACIKLAMASI[this.donem];
  }
}

/** Gün × günlük bedelle ödenen seçenekler (askerlik borçlanması, ihya). */
export abstract class GunlukBedelliSecenek extends HizmetSecenegi {
  protected abstract girdi(varsayim: Varsayimlar): { gun: number; gunlukBedelTl: TlMetni | null };
  protected azamiGun(): number | null {
    return null;
  }

  gun(varsayim: Varsayimlar): number {
    return gunDogrula(this.girdi(varsayim).gun, this.ad, this.azamiGun());
  }

  /**
   * Günlük bedel: girilmişse o, yoksa mevzuattaki günlük kazanç alt sınırı × borçlanma oranı. Girilen değer
   * mevzuat bedeline eşitse (varsayılan varsayımlar onu kopyalar) kaynak mevzuat olarak yazılır.
   */
  gunlukBedel(varsayim: Varsayimlar, mevzuat: MevzuatParametreleri): { bedel: Para; kaynak: string } {
    const alt = Para.tlden(mevzuat.gunlukKazancAltSiniriTl);
    const asgari = { bedel: alt.carp(mevzuat.borclanmaOrani), kaynak: `${mevzuat.yil} asgari: ${alt.goster()} × ${yuzde(mevzuat.borclanmaOrani)}` };
    const elle = this.girdi(varsayim).gunlukBedelTl;
    if (elle === null) return asgari;
    const bedel = Para.tlden(elle);
    if (bedel.negatifMi()) throw new RangeError(`${this.ad} günlük bedeli negatif olamaz: ${elle}`);
    return bedel.esit(asgari.bedel) ? asgari : { bedel, kaynak: 'girilen günlük bedel' };
  }

  maliyet(varsayim: Varsayimlar, mevzuat: MevzuatParametreleri): TutarBilgisi {
    const gun = this.gun(varsayim);
    const { bedel, kaynak } = this.gunlukBedel(varsayim, mevzuat);
    return {
      tur: 'bilinen',
      tl: bedel.carpTam(gun).tlMetni(),
      kaynak: `${this.ad}: ${tamSayi(gun)} gün × ${bedel.goster()} (${kaynak})`,
    };
  }

  aciklama(varsayim: Varsayimlar, mevzuat: MevzuatParametreleri): string {
    const { bedel } = this.gunlukBedel(varsayim, mevzuat);
    return `${tamSayi(this.gun(varsayim))} gün · günlük ${bedel.goster()} · ${this.donemAciklamasi()}`;
  }
}

export class AskerlikBorclanmasi extends GunlukBedelliSecenek {
  readonly anahtar = 'askerlik' as const;
  readonly ad = SECENEK_ADLARI.askerlik;

  /** azamiGun: profildeki borçlanılabilir en çok gün. Askerlik süresi çoğunlukla 2008 öncesine düşer. */
  constructor(private readonly azami: number, donem: HizmetDonemi = 'once2008') {
    super(donem);
    gunDogrula(azami, 'Askerlik azami', null);
  }

  protected girdi(varsayim: Varsayimlar) {
    return varsayim.secenekGirdileri.askerlik;
  }

  protected azamiGun(): number {
    return this.azami;
  }
}

export class Ihya extends GunlukBedelliSecenek {
  readonly anahtar = 'ihya' as const;
  readonly ad = SECENEK_ADLARI.ihya;

  constructor(donem: HizmetDonemi = 'sonra2008') {
    super(donem);
  }

  protected girdi(varsayim: Varsayimlar) {
    return varsayim.secenekGirdileri.ihya;
  }
}

export class BagkurBorcOdemesi extends HizmetSecenegi {
  readonly anahtar = 'bagkur' as const;
  readonly ad = SECENEK_ADLARI.bagkur;

  constructor(donem: HizmetDonemi = 'sonra2008') {
    super(donem);
  }

  gun(varsayim: Varsayimlar): number {
    return gunDogrula(varsayim.secenekGirdileri.bagkur.gun, this.ad, null);
  }

  /** Düzeltilmiş borç (bilinen, aralık ya da bilinmiyor) olduğu gibi; bilinmiyorsa sıfır sayılmaz. */
  maliyet(varsayim: Varsayimlar, _mevzuat: MevzuatParametreleri): TutarBilgisi {
    return varsayim.secenekGirdileri.bagkur.borc;
  }

  aciklama(varsayim: Varsayimlar, _mevzuat: MevzuatParametreleri): string {
    const borc = varsayim.secenekGirdileri.bagkur.borc;
    const tutar = borc.tur === 'bilinen'
      ? Para.tlden(borc.tl).goster()
      : borc.tur === 'aralik'
        ? `${Para.tlden(borc.altTl).goster()} – ${Para.tlden(borc.ustTl).goster()}`
        : 'borç bilinmiyor';
    return `${tamSayi(this.gun(varsayim))} gün · ${tutar} · ${this.donemAciklamasi()}`;
  }
}
