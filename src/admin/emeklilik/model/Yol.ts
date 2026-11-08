// Bir seçim bileşiminin (yolun) hesaplanmış hali: tarih, ödeme kalemleri, aylık ve kesinti planı.
// Karşılaştırıcı yolu yalnız KarsilastirilabilirYol arayüzüyle kullanır.
import type { AyMetni, AylikModeliAdi, SecenekAnahtari, Secim, YolSonucu } from '../contract';
import type { Ay } from './Ay';
import type { TarihSonucu } from './EmeklilikTarihiHesabi';
import type { KesintiPlani } from './KesintiPlani';
import { Para } from './Para';
import { Tutar } from './Tutar';
import { kuralHatasi } from './bicim';
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

  get kalemler(): YolHesabiGirdisi['kalemler'] {
    return this.g.kalemler;
  }

  get emeklilikAyi(): Ay | null {
    return this.g.tarih.emeklilikAyi;
  }

  /**
   * Emekliliğin ilk n ayında eline geçen toplam: her ay aylık − diğer kesintiler − o ayın borç kesintisi, ayda en az 0
   * (net aylık eksiye düşmez). Borç kesintisi borç bitince durur.
   */
  emekliGeliri(n: number): Tutar {
    if (!Number.isSafeInteger(n) || n < 0) throw kuralHatasi('Ay sayısı sıfır ya da pozitif tamsayı olmalı.', { n });
    if (n === 0) return Tutar.sifir('Aylık yok');
    const kullanilabilir = this.g.digerKesinti.sifirMi() ? this.g.aylik : this.g.aylik.cikar(Tutar.bilinen(this.g.digerKesinti, 'Diğer kesintiler'));
    if (this.g.kesinti === null) return kullanilabilir.donustur((p) => Para.enBuyuk(p, Para.sifir()).carpTam(n));
    return this.g.kesinti.netToplam(n, kullanilabilir);
  }

  /**
   * Aylık net gelirin değişebildiği emeklilik ayları (1 tabanlı, artan): kesinti yoksa yalnız 1 (her ay aynı net);
   * kesinti varsa borcun bittiği ay ve sonrası da (KesintiPlani.gelirKirilimlari). Karşılaştırıcı geri kazanmayı yalnız
   * bu parçaların uçlarında hesaplar.
   */
  gelirKirilimlari(): readonly number[] {
    return this.g.kesinti === null ? [1] : this.g.kesinti.gelirKirilimlari();
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
      sinirlayanAyrinti: tarih.sinirlayanAyrinti,
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
