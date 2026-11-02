import type { EmeklilikProfili, TutarBilgisi } from '../contract';
import type { TurkceBicimleyici } from './bicim';
import type { AlanAnahtari, BorcKaynagiAnahtari, BorcKaynagiSecenegi } from './ekran';

// Bağ-Kur borcunun kaynağı: iki kaynak aracın seçenekleri yan yana. Codex aracı düzeltilmiş tutar bilinmediği için
// 'bilinmiyor' kullanır (varsayılan; tutar uydurulmaz), sade araç tahmin aralığı kullanır (profilde tahminiBorc varsa),
// kullanıcı tutarı kendisi de girebilir. Seçici yalnız durumu tutar ve seçili kaynağın borcunu (TutarBilgisi) verir;
// ViewModel bunu varsayımlar.secenekGirdileri.bagkur.borc'a yazar, hesap modeldedir. Girilen tutar kaynak değişince
// unutulmaz (geri dönülünce yeniden kullanılır); sıfırlama varsayılana döner. Profilde bilinen bir borç varsa "Tutarı gir"
// o tutarla başlar (profil bilgisi kaybolmaz) ama varsayılan kaynak yine 'bilinmiyor'dur.

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
  bilinmiyor: SGK_BILINMIYOR_NEDENI,
  tahmin: 'Sade araç tahmini (aralık)',
  elle: 'Tutarı gir',
};
const SIRA: readonly BorcKaynagiAnahtari[] = ['bilinmiyor', 'tahmin', 'elle'];

export class BorcKaynagiSecici {
  private kaynak: BorcKaynagiAnahtari = 'bilinmiyor';
  private elle: TutarBilgisi | null;
  private readonly tahmin: TutarBilgisi | null;
  /** Profildeki bilinen borç ("Tutarı gir"in başlangıç değeri); bilinmiyorsa null. */
  private readonly profilTutari: TutarBilgisi | null;

  constructor(profil: EmeklilikProfili) {
    const { borc, tahminiBorc } = profil.secenekler.bagkur;
    this.tahmin = tahminiBorc ?? null;
    this.profilTutari = borc.tur === 'bilinmiyor' ? null : borc;
    this.elle = this.profilTutari;
  }

  get secili(): BorcKaynagiAnahtari {
    return this.kaynak;
  }

  /** 'tahmin' yalnız profilde tahmin varsa kullanılabilir. */
  kullanilabilir(kaynak: BorcKaynagiAnahtari): boolean {
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
    if (this.kaynak === 'tahmin' && this.tahmin) return { ...this.tahmin };
    if (this.kaynak === 'elle') return this.elle ? { ...this.elle } : { tur: 'bilinmiyor', neden: ELLE_BOS_NEDENI };
    return { tur: 'bilinmiyor', neden: SGK_BILINMIYOR_NEDENI };
  }

  /** "Tutarı gir" alanından gelen son geçerli tutar. */
  elleAyarla(tutar: TutarBilgisi): void {
    this.elle = tutar;
  }

  /** Varsayılana döner: 'bilinmiyor'; girilen tutar unutulur ("Tutarı gir" yine profildeki tutarla başlar). */
  sifirla(): void {
    this.kaynak = 'bilinmiyor';
    this.elle = this.profilTutari;
  }

  secenekler(b: TurkceBicimleyici): BorcKaynagiSecenegi[] {
    return SIRA.filter(kaynak => this.kullanilabilir(kaynak)).map(kaynak => ({ deger: kaynak, etiket: ETIKET[kaynak], aciklama: this.aciklama(kaynak, b) }));
  }

  private aciklama(kaynak: BorcKaynagiAnahtari, b: TurkceBicimleyici): string {
    if (kaynak === 'bilinmiyor') return 'Ödeme, fark ve geri kazanma bilinmiyor olur; tutar uydurulmaz.';
    if (kaynak === 'elle') return 'SGK’dan öğrendiğiniz ya da kendi tahmininiz; tek tutar ya da aralık.';
    const tahmin = this.tahmin!;
    // Aralık "₺alt – ₺üst" yazılır; bilinmeyen tahmin "Bilinmiyor · <neden>" (kaynağı yoktur).
    return tahmin.tur === 'bilinmiyor' ? b.tutar(tahmin) : `${b.tutar(tahmin)} · ${tahmin.kaynak}`;
  }
}
