import type { EmeklilikProfili, TutarBilgisi } from '../contract';
import type { TurkceBicimleyici } from './bicim';
import type { AlanAnahtari, BorcKaynagiAnahtari, BorcKaynagiSecenegi } from './ekran';

// Bağ-Kur borcunun kaynağı. Profilde kaynağı yazılı bir borç (tek tutar ya da aralık; ör. e-Devlet 4B borç ekranı) varsa
// varsayılan kaynak odur ('profil'): sayfa bilinen tutarla hesaplar, kaynağı seçeneğin açıklamasında yazar. Profilde
// tutar yoksa varsayılan 'bilinmiyor'dur (tutar uydurulmaz). 'bilinmiyor' her zaman seçilebilir; sade aracın tahmin aralığı
// (profilde tahminiBorc varsa) ve kullanıcının girdiği tutar da seçeneklerdir. Seçici yalnız durumu tutar ve seçili
// kaynağın borcunu (TutarBilgisi) verir; ViewModel bunu varsayımlar.secenekGirdileri.bagkur.borc'a yazar, hesap
// modeldedir. Girilen tutar kaynak değişince unutulmaz (geri dönülünce yeniden kullanılır); sıfırlama varsayılana döner.
// "Tutarı gir" profildeki tutarla başlar.

export const BORC_KAYNAGI_BASLIGI = 'Bağ-Kur borcunun kaynağı';
export const SGK_BILINMIYOR_NEDENI = 'SGK düzeltilmiş tutarı bilinmiyor';
/** "Tutarı gir" seçili ama henüz geçerli tutar yokken borcun nedeni. */
export const ELLE_BOS_NEDENI = 'Bağ-Kur borcu tutarı girilmedi';
/** "Tutarı gir" alanı boşken alanın yanında yazılan neden ("Hata:" öneki alan sınıfınca eklenir). */
export const ELLE_BOS_HATA = 'Tutarı girin; bilinmiyorsa “SGK düzeltilmiş tutarı bilinmiyor” seçeneğini seçin.';
/** Borç tutarı alanının anahtarı ve kaynak grubunun formdaki yeri (Bağ-Kur günü alanından sonra). */
export const BORC_ALANI = 'bagkurBorc' satisfies AlanAnahtari;
export const BORC_KAYNAGI_KONUMU = 'bagkurGun' satisfies AlanAnahtari;

const ETIKET: Readonly<Record<BorcKaynagiAnahtari, string>> = {
  profil: 'Profildeki tutar',
  bilinmiyor: SGK_BILINMIYOR_NEDENI,
  tahmin: 'Sade araç tahmini (aralık)',
  elle: 'Tutarı gir',
};
const SIRA: readonly BorcKaynagiAnahtari[] = ['profil', 'bilinmiyor', 'tahmin', 'elle'];

export class BorcKaynagiSecici {
  private kaynak: BorcKaynagiAnahtari;
  private elle: TutarBilgisi | null;
  private readonly tahmin: TutarBilgisi | null;
  /** Profildeki bilinen borç (varsayılan kaynak ve "Tutarı gir"in başlangıç değeri); bilinmiyorsa null. */
  private readonly profilTutari: Exclude<TutarBilgisi, { tur: 'bilinmiyor' }> | null;

  constructor(profil: EmeklilikProfili) {
    const { borc, tahminiBorc } = profil.secenekler.bagkur;
    this.tahmin = tahminiBorc ?? null;
    this.profilTutari = borc.tur === 'bilinmiyor' ? null : borc;
    this.elle = this.profilTutari;
    this.kaynak = this.varsayilan;
  }

  /** Profilde tutar varsa 'profil', yoksa 'bilinmiyor'. */
  get varsayilan(): BorcKaynagiAnahtari {
    return this.profilTutari ? 'profil' : 'bilinmiyor';
  }

  get secili(): BorcKaynagiAnahtari {
    return this.kaynak;
  }

  /** 'profil' yalnız profilde tutar, 'tahmin' yalnız profilde tahmin varsa kullanılabilir. */
  kullanilabilir(kaynak: BorcKaynagiAnahtari): boolean {
    if (kaynak === 'profil') return this.profilTutari !== null;
    return kaynak !== 'tahmin' || this.tahmin !== null;
  }

  /** Kaynağı değiştirir; değiştiyse true. Kullanılamayan kaynak yok sayılır (görünüm onu sunmaz). */
  sec(kaynak: BorcKaynagiAnahtari): boolean {
    if (kaynak === this.kaynak || !this.kullanilabilir(kaynak)) return false;
    this.kaynak = kaynak;
    return true;
  }

  /** Seçili kaynağın borcu (yeni kopya; varsayımlar profille nesne paylaşmaz). */
  deger(): TutarBilgisi {
    if (this.kaynak === 'profil' && this.profilTutari) return { ...this.profilTutari };
    if (this.kaynak === 'tahmin' && this.tahmin) return { ...this.tahmin };
    if (this.kaynak === 'elle') return this.elle ? { ...this.elle } : { tur: 'bilinmiyor', neden: ELLE_BOS_NEDENI };
    return { tur: 'bilinmiyor', neden: SGK_BILINMIYOR_NEDENI };
  }

  /** "Tutarı gir" alanından gelen son geçerli tutar. */
  elleAyarla(tutar: TutarBilgisi): void {
    this.elle = tutar;
  }

  /** Varsayılana döner; girilen tutar unutulur ("Tutarı gir" yine profildeki tutarla başlar). */
  sifirla(): void {
    this.kaynak = this.varsayilan;
    this.elle = this.profilTutari;
  }

  secenekler(b: TurkceBicimleyici): BorcKaynagiSecenegi[] {
    return SIRA.filter(kaynak => this.kullanilabilir(kaynak)).map(kaynak => ({ deger: kaynak, etiket: ETIKET[kaynak], aciklama: this.aciklama(kaynak, b) }));
  }

  private aciklama(kaynak: BorcKaynagiAnahtari, b: TurkceBicimleyici): string {
    if (kaynak === 'profil') return `${b.tutar(this.profilTutari!)} · ${this.profilTutari!.kaynak}`;
    if (kaynak === 'bilinmiyor') return 'Ödeme, fark ve geri kazanma bilinmiyor olur; tutar uydurulmaz.';
    if (kaynak === 'elle') return 'SGK’dan öğrendiğiniz ya da kendi tahmininiz; tek tutar ya da aralık.';
    const tahmin = this.tahmin!;
    // Aralık "₺alt – ₺üst" yazılır; bilinmeyen tahmin "Bilinmiyor · <neden>" (kaynağı yoktur).
    return tahmin.tur === 'bilinmiyor' ? b.tutar(tahmin) : `${b.tutar(tahmin)} · ${tahmin.kaynak}`;
  }
}
