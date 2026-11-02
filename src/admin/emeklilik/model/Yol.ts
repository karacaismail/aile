// Bir seçim bileşiminin (yolun) hesaplanmış hali: tarih, ödeme kalemleri, aylık ve kesinti planı.
// Karşılaştırıcı yolu yalnız KarsilastirilabilirYol arayüzüyle kullanır.
import type { AyMetni, AylikModeliAdi, SecenekAnahtari, Secim, YolSonucu } from '../contract';
import type { Ay } from './Ay';
import type { TarihSonucu } from './EmeklilikTarihiHesabi';
import type { KesintiPlani } from './KesintiPlani';
import type { Para } from './Para';
import { Tutar } from './Tutar';
import type { KarsilastirilabilirYol } from './YolKarsilastirici';

/** Sözleşmedeki YolSonucu + görünüm için ek alanlar (geriye uyumlu üst küme). */
export interface YolSonucuAyrintili extends YolSonucu {
  /** Emeklilik ayı sonunda toplam prim günü. */
  toplamGun: number | null;
  gunAyi: AyMetni | null;
  sureAyi: AyMetni;
  /** Borç kesintisinin alt/üst senaryo süresi (ay); kesinti yoksa ya da süre bilinmiyorsa null. */
  kesintiSuresiAraligi: { alt: number; ust: number } | null;
}

export interface YolHesabiGirdisi {
  secim: Secim;
  tarih: TarihSonucu;
  eklenenGun: Record<SecenekAnahtari, number>;
  kalemler: ReadonlyArray<{ anahtar: SecenekAnahtari; tutar: Tutar }>;
  aylik: Tutar;
  aylikModeli: AylikModeliAdi;
  kesinti: KesintiPlani | null;
  digerKesinti: Para;
}

export class YolHesabi implements KarsilastirilabilirYol {
  readonly secim: Secim;
  readonly odeme: Tutar;

  constructor(private readonly g: YolHesabiGirdisi) {
    this.secim = { ...g.secim };
    this.odeme = Tutar.toplam(g.kalemler.map((k) => k.tutar));
  }

  get emeklilikAyi(): Ay | null {
    return this.g.tarih.emeklilikAyi;
  }

  /** Emekliliğin ilk n ayında eline geçen toplam: n × (aylık − diğer kesintiler) − borç kesintisi. */
  emekliGeliri(n: number): Tutar {
    if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`Ay sayısı geçersiz: ${n}`);
    if (n === 0) return Tutar.sifir('Aylık yok');
    const brut = this.g.aylik.carpTam(n);
    const diger = this.g.digerKesinti.sifirMi() ? brut : brut.cikar(Tutar.bilinen(this.g.digerKesinti.carpTam(n), 'Diğer kesintiler'));
    return this.g.kesinti === null ? diger : diger.cikar(this.g.kesinti.toplam(n));
  }

  sonuc(): YolSonucuAyrintili {
    const { tarih, kesinti } = this.g;
    return {
      secim: { ...this.g.secim },
      eklenenGun: { ...this.g.eklenenGun },
      calisarakTamamlananGun: tarih.calisarakTamamlananGun,
      emeklilikAyi: tarih.emeklilikAyi?.metin() ?? null,
      yas: tarih.yas,
      sinirlayanKosul: tarih.sinirlayanKosul,
      odeme: this.odeme.bilgi(),
      odemeKalemleri: this.g.kalemler.map((k) => ({ anahtar: k.anahtar, tutar: k.tutar.bilgi() })),
      aylik: this.g.aylik.bilgi(),
      aylikModeli: this.g.aylikModeli,
      kesinti: kesinti === null ? null : kesinti.ozet(),
      toplamGun: tarih.toplamGun,
      gunAyi: tarih.gunAyi?.metin() ?? null,
      sureAyi: tarih.sureAyi.metin(),
      kesintiSuresiAraligi: kesinti === null ? null : kesinti.sureAy(),
    };
  }
}
