// Ödenmeyen Bağ-Kur borcunun aylıktan kesintisi: her ay oran × aylık kesilir, borç bitince durur (son ay yalnız
// kalan borç). Borç bilinmiyorsa süre ve toplam bilinmiyor; borç aralıksa alt/üst senaryo ayrı hesaplanır.
// Gecikme oranı verilirse ödenmeyen borca, kayıt ayından emeklilik ayına kadar basit faizle eklenir; kesinti
// döneminde ayrıca gecikme eklenmez (sade varsayım).
import type { TutarBilgisi } from '../contract';
import type { Para } from './Para';
import { Tutar } from './Tutar';
import { tamSayi, yuzde } from './bicim';

export interface KesintiGirdisi {
  /** Varsayımdaki kesinti oranı (0 … tavan). */
  oran: number;
  /** Mevzuattaki kanuni tavan. */
  tavan: number;
  /** Ödenmeyen (kalan) borç. */
  borc: TutarBilgisi | Tutar;
  /** Kesintinin uygulandığı brüt aylık. */
  aylik: TutarBilgisi | Tutar;
  /** Aylık gecikme oranı tahmini; null = tahmin yapılmaz. */
  gecikmeAylikOran: number | null;
  /** Kayıt ayından emeklilik ayına kadar geçen ay. */
  gecikmeAySayisi: number;
}

export interface KesintiOzeti {
  oran: number;
  /** En uzun senaryodaki süre; bilinmiyor ya da borç hiç bitmiyorsa null. */
  sureAy: number | null;
  neden: string;
}

const tutar = (t: TutarBilgisi | Tutar) => (t instanceof Tutar ? t : Tutar.bilgiden(t));

export class KesintiPlani {
  private constructor(
    readonly oran: number,
    private readonly kalanBorc: Tutar,
    private readonly kesinti: Tutar,
  ) {}

  /** Kesinti uygulanmıyorsa (oran 0 ya da borç kesin 0) null. */
  static olustur(g: KesintiGirdisi): KesintiPlani | null {
    if (!Number.isFinite(g.tavan) || g.tavan < 0 || g.tavan > 1) throw new RangeError(`Kesinti tavanı geçersiz: ${g.tavan}`);
    if (!Number.isFinite(g.oran) || g.oran < 0 || g.oran > g.tavan) {
      throw new RangeError(`Borç kesinti oranı 0 ile ${yuzde(g.tavan)} arasında olmalı: ${g.oran}`);
    }
    if (g.gecikmeAylikOran !== null && (!Number.isFinite(g.gecikmeAylikOran) || g.gecikmeAylikOran < 0 || g.gecikmeAylikOran > 1)) {
      throw new RangeError(`Gecikme oranı 0 ile 1 arasında olmalı: ${g.gecikmeAylikOran}`);
    }
    if (!Number.isSafeInteger(g.gecikmeAySayisi) || g.gecikmeAySayisi < 0) throw new RangeError(`Gecikme ayı geçersiz: ${g.gecikmeAySayisi}`);
    if (g.oran === 0) return null;
    let borc = tutar(g.borc);
    const s = borc.senaryolar();
    if (s !== null && s[0].sifirMi() && s[1].sifirMi()) return null;
    if (s !== null && (s[0].negatifMi() || s[1].negatifMi())) throw new RangeError('Kalan borç negatif olamaz.');
    if (g.gecikmeAylikOran !== null && g.gecikmeAylikOran > 0 && g.gecikmeAySayisi > 0) {
      const oran = g.gecikmeAylikOran;
      const ay = g.gecikmeAySayisi;
      borc = borc.donustur((p) => p.topla(p.carp(oran, ay)));
    }
    return new KesintiPlani(g.oran, borc, tutar(g.aylik).carp(g.oran));
  }

  borc(): Tutar {
    return this.kalanBorc;
  }

  aylikKesinti(): Tutar {
    return this.kesinti;
  }

  /** Borcun bittiği ay sayısı (alt/üst senaryo); bilinmiyor ya da hiç bitmiyorsa null. */
  sureAy(): { alt: number; ust: number } | null {
    const borc = this.kalanBorc.senaryolar();
    const kesinti = this.kesinti.senaryolar();
    if (borc === null || kesinti === null) return null;
    const alt = borc[0].kacBirim(kesinti[0]);
    const ust = borc[1].kacBirim(kesinti[1]);
    return alt === null || ust === null ? null : { alt, ust };
  }

  /** Emekliliğin ilk n ayında kesilen toplam: min(n × aylık kesinti, kalan borç), senaryo senaryo. */
  toplam(n: number): Tutar {
    if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`Ay sayısı geçersiz: ${n}`);
    if (n === 0) return Tutar.sifir('Kesinti yok');
    return this.kesinti.carpTam(n).esle(this.kalanBorc, (k: Para, b: Para) => (k.karsilastir(b) <= 0 ? k : b));
  }

  ozet(): KesintiOzeti {
    const oranMetni = `Ödenmeyen Bağ-Kur borcu için aylıktan ${yuzde(this.oran)} kesinti`;
    if (this.kalanBorc.bilinmiyorMu() || this.kesinti.bilinmiyorMu()) {
      const nedenler = [...this.kalanBorc.nedenler(), ...this.kesinti.nedenler()].join('; ');
      return { oran: this.oran, sureAy: null, neden: `${oranMetni}; süre bilinmiyor: ${nedenler}` };
    }
    const sure = this.sureAy();
    if (sure === null) return { oran: this.oran, sureAy: null, neden: `${oranMetni}; aylık sıfır olduğu için borç kesintiyle kapanmaz.` };
    const enUzun = Math.max(sure.alt, sure.ust);
    const enKisa = Math.min(sure.alt, sure.ust);
    const sureMetni = enKisa === enUzun ? `${tamSayi(enUzun)} ay` : `borç aralığına göre ${tamSayi(enKisa)}–${tamSayi(enUzun)} ay`;
    return { oran: this.oran, sureAy: enUzun, neden: `${oranMetni}; borç bitince durur: ${sureMetni}.` };
  }
}
