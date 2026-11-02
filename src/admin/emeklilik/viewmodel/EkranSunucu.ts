import {
  BILESIM_SIRASI,
  SECENEK_ANAHTARLARI,
  type EmeklilikProfili,
  type KarsilastirmaSonucu,
  type Oneri,
  type Secim,
  type SecenekAnahtari,
  type SecimEtkisi,
  type TutarBilgisi,
  type Varsayimlar,
  type YolSonucu,
} from '../contract';
import type { FormAlani } from './alanlar';
import { BILINMIYOR, type TurkceBicimleyici } from './bicim';
import type {
  AlanAnahtari, AlanGorunumu, BilesimSatiri, IhyaAlanAnahtari, EmeklilikEkrani, FormGorunumu, IhyaGorunumu, IhyaYolGorunumu, Olcu, OneriGorunumu, PayGorunumu,
  SonucGorunumu, SoruGorunumu,
} from './ekran';
import { AYLIK_MODELI_ETIKETI, GRUP_BASLIKLARI, type IhyaGirdileri, type VarsayimFormu } from './form';

// Sunucu (presenter): planlayıcı sonuçlarını ve ViewModel durumunu ekran anlık görüntüsüne çevirir. Saf eşlemedir:
// hesap yapmaz (farkı, tarihi, ödemeyi model verir), yalnız seçer, adlandırır ve biçimler. Sonuç derin dondurulur.

/** Planlayıcıdan bir kerede alınan sonuçlar (ViewModel önbelleğe alır). */
export interface Hesaplar {
  karsilastirma: KarsilastirmaSonucu;
  etkiler: readonly SecimEtkisi[];
  bilesimler: readonly KarsilastirmaSonucu[];
  oneri: Oneri;
  /** yolKarsilastir(ihyalı = yol, ihyasız = referans). */
  ihya: KarsilastirmaSonucu;
  ihyaVarsayim: Varsayimlar;
}

export type HesapDurumu = { tur: 'hazir'; hesaplar: Hesaplar } | { tur: 'hata'; neden: string };

export interface SunumGirdisi {
  secim: Secim;
  varsayim: Varsayimlar | null;
  hesap: HesapDurumu;
  /** Kullanıcının yazdığı taslaklar (alan anahtarı → metin). */
  taslaklar: ReadonlyMap<string, string>;
  /** Ayrıştırma hataları (alan anahtarı → "Hata: …"). */
  hatalar: ReadonlyMap<string, string>;
  ihyaGirdileri: IhyaGirdileri | null;
  /** Bugünün İstanbul takvim günü ('YYYY-MM-DD'); profil tazeliği için. */
  bugun: string;
}

const SORULAR: Readonly<Record<SecenekAnahtari, string>> = {
  askerlik: 'Askerliği borçlanacak mısınız?',
  bagkur: 'Bağ-Kur borcunu ödeyecek misiniz?',
  ihya: 'Durdurulan Bağ-Kur sürelerini ihya edecek misiniz?',
};
const BILESIM_ADI: Readonly<Record<SecenekAnahtari, string>> = { askerlik: 'askerlik', bagkur: 'Bağ-Kur borcu', ihya: 'ihya' };
const KALEM_ADI: Readonly<Record<SecenekAnahtari, string>> = { askerlik: 'Askerlik borçlanması', bagkur: 'Bağ-Kur borcu', ihya: 'İhya' };
const PAY_ADI: Readonly<Record<SecenekAnahtari, string>> = { askerlik: 'Askerlik borçlanması', bagkur: 'Bağ-Kur borcunu ödemek', ihya: 'İhya' };
const ONERI_ETIKETI: Readonly<Record<Oneri['tur'], string>> = { senaryoOnerisi: 'Senaryo önerisi', enErkenTarih: 'En erken tarih senaryosu' };
const SINIRLAYAN: Readonly<Record<'gun' | 'sigortalilikSuresi', string>> = {
  gun: 'Tarihi prim günü belirliyor',
  sigortalilikSuresi: 'Tarihi sigortalılık süresi belirliyor',
};

export const ULASILAMIYOR = 'Ulaşılamıyor';
export const ODEME_YOK = 'Ödeme yok';
export const GEREKMEZ = 'Gerekmez';
export const HICBIRI_ANAHTARI = 'hicbiri';
/** Profil kaydı bu kadar günden eskiyse "Eski veri" yazılır. */
export const ESKI_PROFIL_GUN = 30;
const GUN_MS = 24 * 60 * 60 * 1000;

/** İki 'YYYY-MM-DD' takvim günü arasındaki gün farkı (saat diliminden bağımsız); geçersizse null. */
function gunFarki(once: string, sonra: string): number | null {
  const utc = (tarih: string) => {
    const eslesme = /^(\d{4})-(\d{2})-(\d{2})$/.exec(tarih);
    return eslesme ? Date.UTC(Number(eslesme[1]), Number(eslesme[2]) - 1, Number(eslesme[3])) : Number.NaN;
  };
  const fark = (utc(sonra) - utc(once)) / GUN_MS;
  return Number.isFinite(fark) ? fark : null;
}

export function secimEsit(a: Secim, b: Secim): boolean {
  return SECENEK_ANAHTARLARI.every(k => a[k] === b[k]);
}

export function bilesimAnahtari(secim: Secim): string {
  const acik = SECENEK_ANAHTARLARI.filter(k => secim[k]);
  return acik.length ? acik.join('+') : HICBIRI_ANAHTARI;
}

const hicbiriMi = (secim: Secim) => SECENEK_ANAHTARLARI.every(k => !secim[k]);
/** Bilinen tutar ve aralık biçimli tutardır; bilinmeyen tutar sözcüklü metindir ("Bilinmiyor · …"). */
const bicimi = (tutar: TutarBilgisi): Olcu['bicim'] => (tutar.tur === 'bilinmiyor' ? 'metin' : 'tutar');

function dondur<T>(deger: T): T {
  if (deger && typeof deger === 'object' && !Object.isFrozen(deger)) {
    for (const ic of Object.values(deger)) dondur(ic);
    Object.freeze(deger);
  }
  return deger;
}

export class EkranSunucu {
  constructor(
    private readonly profil: EmeklilikProfili,
    private readonly form: VarsayimFormu,
    private readonly b: TurkceBicimleyici,
  ) {}

  sun(girdi: SunumGirdisi): EmeklilikEkrani {
    const hesaplar = girdi.hesap.tur === 'hazir' ? girdi.hesap.hesaplar : null;
    const ekran: EmeklilikEkrani = {
      hesap: girdi.hesap.tur === 'hazir' ? { durum: 'hazir', neden: null } : { durum: 'hata', neden: girdi.hesap.neden },
      profil: this.profilGorunumu(girdi.bugun),
      sorular: this.sorular(girdi.secim, girdi.varsayim, hesaplar),
      oneri: hesaplar ? this.oneri(girdi.secim, hesaplar.oneri) : null,
      sonuc: hesaplar && girdi.varsayim ? this.sonuc(hesaplar.karsilastirma, girdi.varsayim) : null,
      paylar: hesaplar ? hesaplar.etkiler.map(etki => this.pay(etki, girdi.secim)) : [],
      bilesimler: hesaplar ? hesaplar.bilesimler.map(k => this.bilesim(k, girdi.secim)) : [],
      bilesimNotu: girdi.varsayim
        ? `Aylık: ${AYLIK_MODELI_ETIKETI[girdi.varsayim.aylikModeli]}. Fark, geç yol emekli olduktan sonraki ${this.b.sayi(girdi.varsayim.karsilastirmaSuresiYil)} yıllık ortak dönemde, hiçbir şey ödememeye göredir.`
        : '',
      // Form hesap hatasında da kalır: kullanıcı hatalı varsayımı düzeltebilmeli (yalnız varsayım yoksa form yoktur).
      form: girdi.varsayim ? this.formGorunumu(girdi) : null,
      ihya: this.ihya(girdi, hesaplar),
    };
    return dondur(ekran);
  }

  // --- Profil -------------------------------------------------------------------------------------------------------
  private profilGorunumu(bugun: string): EmeklilikEkrani['profil'] {
    const kayit = `Kayıt ${this.b.tarih(this.profil.kayitTarihi)}`;
    const yas = gunFarki(this.profil.kayitTarihi, bugun);
    const eski = yas !== null && yas > ESKI_PROFIL_GUN;
    return {
      etiket: this.profil.sentetik ? 'Sentetik profil' : 'Kişisel profil',
      kayit,
      kaynaklar: [...this.profil.kaynaklar],
      tazelik: eski
        ? { durum: 'eski', metin: `Eski veri: kayıt ${this.b.tarih(this.profil.kayitTarihi)}, ${this.b.sayi(yas)} gün önce. Gün ve tutarları SGK kayıtlarıyla yenileyin.` }
        : { durum: 'guncel', metin: kayit },
    };
  }

  // --- Seçim adları -------------------------------------------------------------------------------------------------
  secimAdi(secim: Secim): string {
    const acik = SECENEK_ANAHTARLARI.filter(k => secim[k]);
    if (acik.length === 0) return 'Hiçbir şey ödememek';
    if (acik.length === SECENEK_ANAHTARLARI.length) return 'Üçü birlikte';
    if (acik.length === 1) return `Yalnız ${BILESIM_ADI[acik[0]!]}`;
    const ad = acik.map(k => BILESIM_ADI[k]).join(' + ');
    return ad.charAt(0).toLocaleUpperCase('tr-TR') + ad.slice(1);
  }

  // --- Sorular ------------------------------------------------------------------------------------------------------
  private sorular(secim: Secim, varsayim: Varsayimlar | null, hesaplar: Hesaplar | null): SoruGorunumu[] {
    // Gün ve maliyet "üçü birlikte" yolundan okunur: o yolda her seçeneğin kalemi vardır (seçili olmasa da).
    const hepsi = hesaplar?.bilesimler[BILESIM_SIRASI.length - 1]?.yol ?? null;
    return SECENEK_ANAHTARLARI.map(anahtar => {
      const gun = hepsi?.eklenenGun[anahtar] ?? varsayim?.secenekGirdileri[anahtar].gun ?? this.profil.secenekler[anahtar].gun;
      const kalem = hepsi?.odemeKalemleri.find(k => k.anahtar === anahtar);
      return {
        anahtar,
        soru: SORULAR[anahtar],
        aciklama: kalem ? `${this.b.gun(gun)} · ${this.b.tutar(kalem.tutar)}` : this.b.gun(gun),
        evet: secim[anahtar],
      };
    });
  }

  // --- Öneri --------------------------------------------------------------------------------------------------------
  private oneri(secim: Secim, oneri: Oneri): OneriGorunumu {
    const secili = secimEsit(secim, oneri.secim);
    return {
      etiket: ONERI_ETIKETI[oneri.tur],
      secimAdi: this.secimAdi(oneri.secim),
      gerekce: oneri.gerekce,
      saglamlik: oneri.saglam ? 'Kesinti olmasa ya da borç aralığın üst ucunda olsa da aynı öneri.' : 'Varsayımlar değişirse öneri değişebilir.',
      secili,
      eylem: 'Bunu seç',
      devreDisiNedeni: secili ? 'Öneri şu an seçili.' : null,
    };
  }

  // --- Ortak biçimler -----------------------------------------------------------------------------------------------
  private ay(yol: YolSonucu): string {
    return yol.emeklilikAyi ? this.b.ay(yol.emeklilikAyi) : ULASILAMIYOR;
  }

  private odemeMetni(yol: YolSonucu): string {
    return yol.odemeKalemleri.length === 0 && this.b.sifirMi(yol.odeme) ? ODEME_YOK : this.b.tutar(yol.odeme);
  }

  private aylikModeliMetni(yol: YolSonucu): string {
    return `${this.b.tutar(yol.aylik)} · ${AYLIK_MODELI_ETIKETI[yol.aylikModeli]}`;
  }

  private fark(etiket: string, tutar: TutarBilgisi): Olcu {
    return { etiket, deger: this.b.isaretliTutar(tutar), not: null, ton: this.b.ton(tutar), bicim: bicimi(tutar) };
  }

  private geriKazanma(k: KarsilastirmaSonucu, referans: boolean): Olcu {
    const etiket = 'Ödemeyi karşılayan';
    const n = k.geriKazanmaAylikSayisi;
    if (referans || n === 0) return { etiket, deger: GEREKMEZ, not: null, ton: 'notr', bicim: 'metin' };
    if (n === null) return { etiket, deger: BILINMIYOR, not: k.hesaplanamayanNeden, ton: 'notr', bicim: 'metin' };
    return { etiket, deger: `${this.b.sayi(n)} emekli aylığı`, not: null, ton: 'notr', bicim: 'metin' };
  }

  private geriKazanmaKisa(k: KarsilastirmaSonucu, referans: boolean): string {
    const n = k.geriKazanmaAylikSayisi;
    if (referans || n === 0) return GEREKMEZ;
    return n === null ? BILINMIYOR : `${this.b.sayi(n)} emekli aylığı`;
  }

  // --- Sonuç özeti --------------------------------------------------------------------------------------------------
  private sonuc(k: KarsilastirmaSonucu, v: Varsayimlar): SonucGorunumu {
    const yol = k.yol;
    const referans = hicbiriMi(yol.secim);
    const planlamaAyi = this.ay(yol);
    const yas = yol.yas !== null ? `${this.b.sayi(yol.yas)} yaşında` : 'Yaş bilinmiyor';
    const erkenKisa = this.b.erken(k.erkenAy);
    const erken = referans ? 'Referans yol: hiçbir şey ödemeden'
      : k.erkenAy === null ? BILINMIYOR
        : `Hiçbir şey ödememeye göre ${erkenKisa.toLocaleLowerCase('tr-TR')}`;
    const kesinti: Olcu = yol.kesinti
      ? {
        etiket: 'Borç kesintisi',
        deger: `${this.b.oran(yol.kesinti.oran)} kesinti · ${yol.kesinti.sureAy === null ? 'süre bilinmiyor' : `${this.b.sayi(yol.kesinti.sureAy)} ay`}`,
        not: yol.kesinti.neden || null,
        ton: 'uyari',
        bicim: 'metin',
      }
      : { etiket: 'Borç kesintisi', deger: 'Kesinti yok', not: null, ton: 'notr', bicim: 'metin' };
    const donemEtiketi = `Ortak dönem sonunda fark (${this.b.sayi(v.karsilastirmaSuresiYil)} yıl)`;
    const karsilastirmaYok = (etiket: string): Olcu => ({ etiket, deger: 'Karşılaştırma yok', not: 'Bir seçimi Evet yapınca hiçbir şey ödememeye göre fark yazılır.', ton: 'notr', bicim: 'metin' });
    const duyuru = [planlamaAyi, yol.yas !== null ? yas : null, !referans && k.erkenAy !== null ? erkenKisa : null].filter(Boolean).join(' · ');
    return {
      secimAdi: this.secimAdi(yol.secim),
      planlamaAyi,
      yas,
      sinirlayan: yol.sinirlayanKosul ? SINIRLAYAN[yol.sinirlayanKosul] : yol.emeklilikAyi ? '' : 'Planlanan çalışmayla hedef güne ulaşılamıyor',
      erken,
      calisarak: yol.calisarakTamamlananGun > 0 ? `${this.b.gun(yol.calisarakTamamlananGun)} planlanan çalışmayla tamamlanır` : 'Planlanan çalışma gerekmez',
      odeme: { etiket: 'Geçmiş günler için ödeme', deger: this.odemeMetni(yol), not: null, ton: 'notr', bicim: this.odemeMetni(yol) === ODEME_YOK ? 'metin' : bicimi(yol.odeme) },
      odemeKalemleri: yol.odemeKalemleri.map(kalem => ({ ad: KALEM_ADI[kalem.anahtar], tutar: this.b.tutar(kalem.tutar) })),
      aylik: { etiket: 'Aylık', deger: this.b.tutar(yol.aylik), not: AYLIK_MODELI_ETIKETI[yol.aylikModeli], ton: 'notr', bicim: bicimi(yol.aylik) },
      kesinti,
      donemSonunda: referans ? karsilastirmaYok(donemEtiketi) : this.fark(donemEtiketi, k.donemSonunda),
      gecYolEmekliOlunca: referans ? karsilastirmaYok('Geç yol emekli olduğunda fark') : this.fark('Geç yol emekli olduğunda fark', k.gecYolEmekliOlunca),
      geriKazanma: this.geriKazanma(k, referans),
      referansMi: referans,
      hesaplanamayanNeden: k.hesaplanamayanNeden,
      duyuru,
    };
  }

  // --- Paylar ve bileşimler -----------------------------------------------------------------------------------------
  private pay(etki: SecimEtkisi, secim: Secim): PayGorunumu {
    return {
      anahtar: etki.anahtar,
      ad: PAY_ADI[etki.anahtar],
      durum: secim[etki.anahtar] ? 'Seçili' : 'Seçili değil',
      erken: this.b.erken(etki.erkenAy),
      ekOdeme: this.b.tutar(etki.ekOdeme),
      donemSonunda: this.b.isaretliTutar(etki.donemSonundaFark),
      ton: this.b.ton(etki.donemSonundaFark),
    };
  }

  private bilesim(k: KarsilastirmaSonucu, secim: Secim): BilesimSatiri {
    const referans = hicbiriMi(k.yol.secim);
    return {
      anahtar: bilesimAnahtari(k.yol.secim),
      secimAdi: this.secimAdi(k.yol.secim),
      emeklilik: this.ay(k.yol),
      yas: k.yol.yas !== null ? this.b.sayi(k.yol.yas) : BILINMIYOR,
      erken: referans ? 'Referans' : this.b.erken(k.erkenAy),
      odeme: k.yol.odeme.tur === 'bilinmiyor' ? BILINMIYOR : this.odemeMetni(k.yol),
      odemeNedeni: k.yol.odeme.tur === 'bilinmiyor' ? k.yol.odeme.neden || null : null,
      aylik: k.yol.aylik.tur === 'bilinmiyor' ? BILINMIYOR : this.b.tutar(k.yol.aylik),
      aylikNedeni: k.yol.aylik.tur === 'bilinmiyor' ? k.yol.aylik.neden || null : null,
      donemSonunda: referans ? 'Referans yol' : k.donemSonunda.tur === 'bilinmiyor' ? BILINMIYOR : this.b.isaretliTutar(k.donemSonunda),
      donemNedeni: !referans && k.donemSonunda.tur === 'bilinmiyor' ? k.donemSonunda.neden || null : null,
      donemTon: referans ? 'notr' : this.b.ton(k.donemSonunda),
      geriKazanma: this.geriKazanmaKisa(k, referans),
      secili: secimEsit(k.yol.secim, secim),
    };
  }

  // --- Form ---------------------------------------------------------------------------------------------------------
  private alanGorunumu<S, K extends AlanAnahtari | IhyaAlanAnahtari>(alan: FormAlani<S, unknown, K>, durum: S, girdi: SunumGirdisi): AlanGorunumu<K> {
    const taslak = girdi.taslaklar.get(alan.anahtar);
    return {
      anahtar: alan.anahtar,
      etiket: alan.etiket,
      metin: taslak ?? alan.taslakMetni(durum),
      yardim: alan.yardim,
      hata: girdi.hatalar.get(alan.anahtar) ?? alan.durumHatasi(durum),
      girisModu: alan.girisModu,
      bicim: alan.bicim,
      sonek: alan.sonek,
      zorunlu: alan.zorunlu,
    };
  }

  private formGorunumu(girdi: SunumGirdisi): FormGorunumu {
    const v = girdi.varsayim!;
    const gruplar = (['gunVeTutar', 'maasVeAylik'] as const).map(grup => ({
      anahtar: grup,
      baslik: GRUP_BASLIKLARI[grup],
      alanlar: this.form.alanlar.filter(alan => alan.grup === grup && alan.gorunur(v)).map(alan => this.alanGorunumu(alan, v, girdi)),
      bayraklar: this.form.bayraklar.filter(bayrak => bayrak.grup === grup).map(bayrak => ({
        anahtar: bayrak.anahtar, etiket: bayrak.etiket, aciklama: bayrak.aciklama, deger: v[bayrak.anahtar],
      })),
    }));
    const hatali = gruplar.flatMap(g => g.alanlar).filter(alan => alan.hata !== null).length;
    return {
      gruplar,
      aylikModeli: { secili: v.aylikModeli, secenekler: [...this.form.aylikModelleri] },
      hataOzeti: hatali ? `${this.b.sayi(hatali)} alanda hata var; sonuç son geçerli değerlerle hesaplandı.` : null,
    };
  }

  // --- İhya karşılaştırması -----------------------------------------------------------------------------------------
  private ihya(girdi: SunumGirdisi, hesaplar: Hesaplar | null): IhyaGorunumu {
    const ihyali = { ...girdi.secim, ihya: true };
    const ihyasiz = { ...girdi.secim, ihya: false };
    const g: IhyaGirdileri = girdi.ihyaGirdileri ?? { ihyaliTl: null, ihyasizTl: null, sureYil: 0 };
    const alanlar = this.form.ihyaAlanlari;
    const sure = girdi.ihyaGirdileri?.sureYil ?? null;
    const sonuc = hesaplar?.ihya ?? null;
    const yolGorunumu = (secim: Secim, yol: YolSonucu | null): IhyaYolGorunumu => ({
      secimAdi: this.secimAdi(secim),
      emeklilik: yol ? this.ay(yol) : BILINMIYOR,
      aylik: yol ? this.aylikModeliMetni(yol) : BILINMIYOR,
    });
    const donemEtiketi = sure === null ? 'Dönem sonunda fark' : `Sonraki ${this.b.sayi(sure)} yılın sonunda fark`;
    const bilinmiyor = (etiket: string): Olcu => ({ etiket, deger: BILINMIYOR, not: null, ton: 'notr', bicim: 'metin' });
    return {
      ihyali: yolGorunumu(ihyali, sonuc?.yol ?? null),
      ihyasiz: yolGorunumu(ihyasiz, sonuc?.referans ?? null),
      erken: sonuc && sonuc.erkenAy !== null ? `İhya ile ${this.b.erken(sonuc.erkenAy).toLocaleLowerCase('tr-TR')}` : BILINMIYOR,
      ekOdeme: sonuc ? { etiket: 'İhya için ek ödeme', deger: this.b.tutar(sonuc.ekOdeme), not: null, ton: 'notr', bicim: bicimi(sonuc.ekOdeme) } : bilinmiyor('İhya için ek ödeme'),
      gecYolEmekliOlunca: sonuc ? this.fark('İhyasız yol da emekli olduğunda fark', sonuc.gecYolEmekliOlunca) : bilinmiyor('İhyasız yol da emekli olduğunda fark'),
      donemSonunda: sonuc ? this.fark(donemEtiketi, sonuc.donemSonunda) : bilinmiyor(donemEtiketi),
      geriKazanma: sonuc ? this.geriKazanma(sonuc, false) : bilinmiyor('Ödemeyi karşılayan'),
      neden: sonuc?.hesaplanamayanNeden ?? null,
      aylikIhyali: this.alanGorunumu(alanlar.ihyaAylikIhyali, g, girdi),
      aylikIhyasiz: this.alanGorunumu(alanlar.ihyaAylikIhyasiz, g, girdi),
      sure: girdi.ihyaGirdileri ? this.alanGorunumu(alanlar.ihyaSuresi, g, girdi) : { ...this.alanGorunumu(alanlar.ihyaSuresi, g, girdi), metin: girdi.taslaklar.get('ihyaSuresi') ?? '' },
    };
  }
}
