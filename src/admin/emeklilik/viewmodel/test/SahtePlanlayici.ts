// Yalnız testler içindir (ViewModel ve sayfa testleri). EmeklilikPlanlayici sözleşmesini basit, belirlenimci kurallarla
// uygulayan sahte planlayıcı: gerçek mevzuat hesabı DEĞİLDİR. Gerçek model src/admin/emeklilik/model/ altındadır.
// Kurallar (testlerin beklentisi bunlardan elle türetilir):
//   - Referans ay: hiçbir şey ödemeyen yol TABAN_AY; eklenen her 30 gün bir ay erkene çeker (aşağı yuvarlama).
//   - gelecekAyBasinaGun 0 ise hedefe ulaşılamaz (emeklilikAyi null).
//   - Ödeme: askerlik/ihya gün × günlük bedel (boşsa VARSAYILAN_GUNLUK_BEDEL); Bağ-Kur girdideki TutarBilgisi.
//     Bilinmeyen bir kalem toplamı bilinmiyor yapar; aralıklı kalem toplamı aralık yapar.
//   - Aylık: sgkReferans → profil referansı, kazancTahmini → KAZANC_TAHMINI, elle → varsayımdaki tutar (yoksa bilinmiyor).
//   - Kesinti: Bağ-Kur ödenmezse ve oran > 0 ise; borç bilinmiyorsa süre null.
//   - Karşılaştırma: dönem sonunda fark = erkenAy × aylık − ödeme (kuruş); ödeme bilinmiyorsa bilinmiyor.
import {
  BILESIM_SIRASI,
  SECENEK_ANAHTARLARI,
  type EmeklilikPlanlayici,
  type EmeklilikProfili,
  type KarsilastirmaSonucu,
  type Oneri,
  type Secim,
  type SecenekAnahtari,
  type SecimEtkisi,
  type TlMetni,
  type TutarBilgisi,
  type Varsayimlar,
  type YolSonucu,
} from '../../contract';

export const TABAN_AY = '2032-12';
export const VARSAYILAN_GUNLUK_BEDEL = '495.00';
export const KAZANC_TAHMINI = '27000.00';
export const HICBIRI: Secim = Object.freeze({ askerlik: false, bagkur: false, ihya: false });

const kurus = (tl: TlMetni): number => {
  const [tam, ondalik = ''] = tl.split('.');
  const isaret = tam!.startsWith('-') ? -1 : 1;
  return isaret * (Math.abs(Number(tam)) * 100 + Number(`${ondalik}00`.slice(0, 2)));
};
const tlMetni = (k: number): TlMetni => {
  const mutlak = Math.abs(k);
  return `${k < 0 ? '-' : ''}${Math.floor(mutlak / 100)}.${String(mutlak % 100).padStart(2, '0')}`;
};
const ayEkle = (ay: string, fark: number): string => {
  const [yil, ayNo] = ay.split('-').map(Number);
  const toplam = yil! * 12 + (ayNo! - 1) + fark;
  return `${Math.floor(toplam / 12)}-${String((toplam % 12) + 1).padStart(2, '0')}`;
};
const ayFarki = (a: string, b: string): number => {
  const [ya, aa] = a.split('-').map(Number);
  const [yb, ab] = b.split('-').map(Number);
  return (yb! * 12 + ab!) - (ya! * 12 + aa!);
};

type Cagri = 'yol' | 'karsilastir' | 'yolKarsilastir' | 'tumBilesimler' | 'secimEtkileri' | 'oneri' | 'varsayilanVarsayimlar';

export interface SahteAyarlar {
  oneri?: Partial<Oneri>;
  /** Verilirse her çağrı bu hatayla düşer (hesap hatası durumu). */
  hata?: string | null;
}

export class SahtePlanlayici implements EmeklilikPlanlayici {
  readonly cagrilar: Record<Cagri, number> = {
    yol: 0, karsilastir: 0, yolKarsilastir: 0, tumBilesimler: 0, secimEtkileri: 0, oneri: 0, varsayilanVarsayimlar: 0,
  };
  /** Son yolKarsilastir çağrısının argümanları. */
  sonYolKarsilastir: { a: Secim; b: Secim; varsayim: Varsayimlar; elleAylik?: { a?: TlMetni | null; b?: TlMetni | null } } | null = null;
  /** Son yol çağrısının varsayımı. */
  sonVarsayim: Varsayimlar | null = null;
  hata: string | null;
  private readonly oneriAyari: Partial<Oneri>;

  constructor(private readonly profil: EmeklilikProfili, ayarlar: SahteAyarlar = {}) {
    this.hata = ayarlar.hata ?? null;
    this.oneriAyari = ayarlar.oneri ?? {};
  }

  private denetle() {
    if (this.hata) throw new Error(this.hata);
  }

  varsayilanVarsayimlar(): Varsayimlar {
    this.cagrilar.varsayilanVarsayimlar++;
    this.denetle();
    const s = this.profil.secenekler;
    return {
      aylikModeli: this.profil.varsayilanAylikModeli,
      elleAylikTl: null,
      borcKesintiOrani: 0.1,
      digerKesintilerTl: '0.00',
      karsilastirmaSuresiYil: 10,
      isUcretiDevam: true,
      gunDuzeltmesiUygula: false,
      gelecekAyBasinaGun: 30,
      bagkurGecikmeAylikOran: null,
      secenekGirdileri: {
        askerlik: { gun: s.askerlik.gun, gunlukBedelTl: s.askerlik.gunlukBedelTl },
        bagkur: { gun: s.bagkur.gun, borc: s.bagkur.borc, yalnizSskYolundaOdenecek: s.bagkur.yalnizSskYolundaOdenecek },
        ihya: { gun: s.ihya.gun, gunlukBedelTl: s.ihya.gunlukBedelTl },
      },
    };
  }

  private kalem(anahtar: SecenekAnahtari, v: Varsayimlar): TutarBilgisi {
    if (anahtar === 'bagkur') return v.secenekGirdileri.bagkur.borc;
    const girdi = v.secenekGirdileri[anahtar];
    const bedel = girdi.gunlukBedelTl ?? VARSAYILAN_GUNLUK_BEDEL;
    return { tur: 'bilinen', tl: tlMetni(girdi.gun * kurus(bedel)), kaynak: 'Sahte bedel' };
  }

  private toplam(kalemler: TutarBilgisi[]): TutarBilgisi {
    const bilinmeyen = kalemler.find((k): k is Extract<TutarBilgisi, { tur: 'bilinmiyor' }> => k.tur === 'bilinmiyor');
    if (bilinmeyen) return { tur: 'bilinmiyor', neden: bilinmeyen.neden };
    let alt = 0;
    let ust = 0;
    for (const k of kalemler) {
      if (k.tur === 'bilinen') { alt += kurus(k.tl); ust += kurus(k.tl); }
      else if (k.tur === 'aralik') { alt += kurus(k.altTl); ust += kurus(k.ustTl); }
    }
    return alt === ust ? { tur: 'bilinen', tl: tlMetni(alt), kaynak: 'Sahte toplam' } : { tur: 'aralik', altTl: tlMetni(alt), ustTl: tlMetni(ust), kaynak: 'Sahte toplam' };
  }

  private aylik(v: Varsayimlar): TutarBilgisi {
    if (v.aylikModeli === 'elle') return v.elleAylikTl ? { tur: 'bilinen', tl: v.elleAylikTl, kaynak: 'Elle' } : { tur: 'bilinmiyor', neden: 'Elle aylık girilmedi' };
    if (v.aylikModeli === 'kazancTahmini') return { tur: 'bilinen', tl: KAZANC_TAHMINI, kaynak: 'Sahte tahmin' };
    return { tur: 'bilinen', tl: this.profil.sgkReferansAylik.tl, kaynak: 'SGK referansı' };
  }

  yol(secim: Secim, varsayim: Varsayimlar): YolSonucu {
    this.cagrilar.yol++;
    this.denetle();
    this.sonVarsayim = varsayim;
    const eklenenGun = Object.fromEntries(
      SECENEK_ANAHTARLARI.map(k => [k, secim[k] ? varsayim.secenekGirdileri[k].gun : 0]),
    ) as Record<SecenekAnahtari, number>;
    const ek = eklenenGun.askerlik + eklenenGun.bagkur + eklenenGun.ihya;
    const ulasilamaz = varsayim.gelecekAyBasinaGun === 0;
    const emeklilikAyi = ulasilamaz ? null : ayEkle(TABAN_AY, -Math.floor(ek / 30));
    const dogumYili = Number(this.profil.dogumTarihi.slice(0, 4));
    const odemeKalemleri = SECENEK_ANAHTARLARI.filter(k => secim[k]).map(anahtar => ({ anahtar, tutar: this.kalem(anahtar, varsayim) }));
    const borc = varsayim.secenekGirdileri.bagkur.borc;
    const kesinti = !secim.bagkur && varsayim.borcKesintiOrani > 0
      ? { oran: varsayim.borcKesintiOrani, sureAy: borc.tur === 'bilinmiyor' ? null : 30, neden: 'Ödenmeyen Bağ-Kur borcu bitene kadar' }
      : null;
    return {
      secim: { ...secim },
      eklenenGun,
      calisarakTamamlananGun: Math.max(0, this.profil.hedefGun - this.profil.kayitliGun.gun - ek),
      emeklilikAyi,
      yas: emeklilikAyi ? Number(emeklilikAyi.slice(0, 4)) - dogumYili : null,
      sinirlayanKosul: emeklilikAyi ? (ek >= 1400 ? 'sigortalilikSuresi' : 'gun') : null,
      odeme: odemeKalemleri.length ? this.toplam(odemeKalemleri.map(k => k.tutar)) : { tur: 'bilinen', tl: '0.00', kaynak: 'Ödeme yok' },
      odemeKalemleri,
      aylik: this.aylik(varsayim),
      aylikModeli: varsayim.aylikModeli,
      kesinti,
    };
  }

  private kiyasla(yol: YolSonucu, referans: YolSonucu): KarsilastirmaSonucu {
    const erkenAy = yol.emeklilikAyi && referans.emeklilikAyi ? ayFarki(yol.emeklilikAyi, referans.emeklilikAyi) : null;
    const aylik = yol.aylik.tur === 'bilinen' ? kurus(yol.aylik.tl) : null;
    const odeme = yol.odeme.tur === 'bilinen' ? kurus(yol.odeme.tl) : null;
    const neden = yol.odeme.tur === 'bilinmiyor' ? yol.odeme.neden
      : yol.odeme.tur === 'aralik' ? 'Ödeme aralık; tek fark hesaplanmadı'
        : aylik === null ? 'Aylık bilinmiyor'
          : erkenAy === null ? 'Tarih yok' : null;
    const fark = (aylar: number): TutarBilgisi => neden || odeme === null || aylik === null
      ? { tur: 'bilinmiyor', neden: neden ?? 'Bilinmiyor' }
      : { tur: 'bilinen', tl: tlMetni(aylar * aylik - odeme), kaynak: 'Sahte fark' };
    return {
      referans,
      yol,
      erkenAy,
      ekOdeme: yol.odeme,
      gecYolEmekliOlunca: fark(erkenAy ?? 0),
      donemSonunda: fark(erkenAy ?? 0),
      geriKazanmaAylikSayisi: neden || odeme === null || aylik === null ? null : Math.ceil(odeme / aylik),
      hesaplanamayanNeden: neden,
    };
  }

  karsilastir(secim: Secim, varsayim: Varsayimlar): KarsilastirmaSonucu {
    this.cagrilar.karsilastir++;
    this.denetle();
    return this.kiyasla(this.yol(secim, varsayim), this.yol(HICBIRI, varsayim));
  }

  yolKarsilastir(a: Secim, b: Secim, varsayim: Varsayimlar, elleAylik?: { a?: TlMetni | null; b?: TlMetni | null }): KarsilastirmaSonucu {
    this.cagrilar.yolKarsilastir++;
    this.denetle();
    this.sonYolKarsilastir = { a, b, varsayim, elleAylik };
    const elle = (tl: TlMetni | null | undefined, yol: YolSonucu): YolSonucu =>
      tl ? { ...yol, aylik: { tur: 'bilinen', tl, kaynak: 'Elle' }, aylikModeli: 'elle' } : yol;
    return this.kiyasla(elle(elleAylik?.a, this.yol(a, varsayim)), elle(elleAylik?.b, this.yol(b, varsayim)));
  }

  tumBilesimler(varsayim: Varsayimlar): KarsilastirmaSonucu[] {
    this.cagrilar.tumBilesimler++;
    this.denetle();
    return BILESIM_SIRASI.map(secim => this.kiyasla(this.yol(secim, varsayim), this.yol(HICBIRI, varsayim)));
  }

  secimEtkileri(secim: Secim, varsayim: Varsayimlar): SecimEtkisi[] {
    this.cagrilar.secimEtkileri++;
    this.denetle();
    return SECENEK_ANAHTARLARI.map(anahtar => {
      const acik = this.yol({ ...secim, [anahtar]: true }, varsayim);
      const kapali = this.yol({ ...secim, [anahtar]: false }, varsayim);
      const k = this.kiyasla(acik, kapali);
      return { anahtar, erkenAy: k.erkenAy, ekOdeme: this.kalem(anahtar, varsayim), donemSonundaFark: k.donemSonunda };
    });
  }

  oneri(varsayim: Varsayimlar): Oneri {
    this.cagrilar.oneri++;
    this.denetle();
    void varsayim;
    return {
      tur: 'senaryoOnerisi',
      secim: { askerlik: true, bagkur: false, ihya: true },
      gerekce: 'Sahte gerekçe: ortak dönem sonunda en yüksek fark.',
      saglam: true,
      ...this.oneriAyari,
    };
  }
}
