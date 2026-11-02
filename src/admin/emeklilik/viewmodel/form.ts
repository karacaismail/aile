import type { AylikModeliAdi, EmeklilikProfili, SecenekAnahtari, TlMetni, Varsayimlar } from '../contract';
import { OranAlani, ParaAlani, TamSayiAlani, TutarBilgisiAlani, type Araclar, type Erisim, type FormAlani } from './alanlar';
import { BORC_ALANI, ELLE_BOS_HATA, ELLE_BOS_NEDENI } from './borcKaynagi';
import type { AlanAnahtari, AlanGrubuAnahtari, AylikModeliSecenegi, BayrakAnahtari, IhyaAlanAnahtari } from './ekran';

// Varsayım formu kataloğu: hangi alanın hangi grupta, hangi etiket/yardım/aralıkla durduğunu ve değerin Varsayimlar
// içinde nerede saklandığını (Erisim) tanımlar. Aralıklar profilden (askerlik azami günü, hedef gün) ve mevzuattan
// (borç kesintisi tavanı) gelir; kişisel değer metne gömülmez. İhya karşılaştırmasının kendi girdileri (iki net aylık ve
// süre) aynı alan sınıflarıyla IhyaGirdileri üzerinde çalışır.

export type VarsayimAlani = FormAlani<Varsayimlar, unknown, AlanAnahtari>;

/** İhya karşılaştırmasının ViewModel'de tutulan girdileri (varsayım değildir; sıfırlamada süre varsayıma döner). */
export interface IhyaGirdileri {
  ihyaliTl: TlMetni | null;
  ihyasizTl: TlMetni | null;
  sureYil: number;
}
export type IhyaAlani = FormAlani<IhyaGirdileri, unknown, IhyaAlanAnahtari>;

export interface FormSinirlari {
  /** Mevzuattaki borç kesintisi tavanı (0.25 = %25); bilinmiyorsa %100. */
  kesintiTavani: number;
}

/** Bağ-Kur borcuna eklenecek aylık gecikme oranı tahmininin üst sınırı (yazım denetimi; mevzuat oranı değildir). */
export const GECIKME_ORANI_UST = 0.1;
export const KARSILASTIRMA_YIL_UST = 40;
export const AYLIK_GUN_UST = 30;

export const GRUP_BASLIKLARI: Readonly<Record<AlanGrubuAnahtari, string>> = {
  gunVeTutar: 'Gün ve tutarları düzenle',
  maasVeAylik: 'Maaş ve aylık varsayımları',
};

export const AYLIK_MODELI_ETIKETI: Readonly<Record<AylikModeliAdi, string>> = {
  sgkReferans: 'SGK referansı',
  kazancTahmini: 'Kazanç tahmini',
  elle: 'Elle girilen',
};

function secenekGirdisi<K extends SecenekAnahtari, A extends keyof Varsayimlar['secenekGirdileri'][K]>(anahtar: K, alan: A): Erisim<Varsayimlar, Varsayimlar['secenekGirdileri'][K][A]> {
  return {
    oku: v => v.secenekGirdileri[anahtar][alan],
    yaz: (v, deger) => ({ ...v, secenekGirdileri: { ...v.secenekGirdileri, [anahtar]: { ...v.secenekGirdileri[anahtar], [alan]: deger } } }),
  };
}

function kok<A extends keyof Varsayimlar>(alan: A): Erisim<Varsayimlar, Varsayimlar[A]> {
  return { oku: v => v[alan], yaz: (v, deger) => ({ ...v, [alan]: deger }) };
}

function ihya<A extends keyof IhyaGirdileri>(alan: A): Erisim<IhyaGirdileri, IhyaGirdileri[A]> {
  return { oku: g => g[alan], yaz: (g, deger) => ({ ...g, [alan]: deger }) };
}

export interface BayrakTanimi { anahtar: BayrakAnahtari; grup: AlanGrubuAnahtari; etiket: string; aciklama: string }

export class VarsayimFormu {
  readonly alanlar: readonly VarsayimAlani[];
  readonly ihyaAlanlari: Readonly<Record<IhyaAlanAnahtari, IhyaAlani>>;
  readonly bayraklar: readonly BayrakTanimi[];
  readonly aylikModelleri: readonly AylikModeliSecenegi[];
  private readonly dizin: ReadonlyMap<string, VarsayimAlani>;

  constructor(profil: EmeklilikProfili, sinirlar: FormSinirlari, araclar: Araclar) {
    const { bicimleyici } = araclar;
    const azamiAskerlik = profil.secenekler.askerlik.azamiGun;
    const hedef = profil.hedefGun;
    const resmiBedel = 'Boşsa mevzuattaki asgari günlük bedel kullanılır.';
    const alanlar: VarsayimAlani[] = [
      new TamSayiAlani({ anahtar: 'askerlikGun', etiket: 'Askerlikten eklenecek gün', yardim: `En çok ${bicimleyici.gun(azamiAskerlik)}; SSK ile çakışan gün ikinci kez eklenmez.`, grup: 'gunVeTutar' }, secenekGirdisi('askerlik', 'gun'), araclar, 0, azamiAskerlik, 'gün'),
      new ParaAlani({ anahtar: 'askerlikGunlukBedel', etiket: 'Askerlik için günlük bedel', yardim: `${resmiBedel} SGK tebliğindeki bedeli girebilirsiniz.`, grup: 'gunVeTutar' }, secenekGirdisi('askerlik', 'gunlukBedelTl'), araclar),
      new TamSayiAlani({ anahtar: 'bagkurGun', etiket: 'Kabul edilecek Bağ-Kur günü', yardim: 'Çakışan dönemler düşüldükten sonraki gün.', grup: 'gunVeTutar' }, secenekGirdisi('bagkur', 'gun'), araclar, 0, hedef, 'gün'),
      // Borç tutarı grubun düz alanı değildir (grup yok): "Bağ-Kur borcunun kaynağı" radyo grubunda "Tutarı gir" seçiliyken
      // kaynağın altında çizilir (borcKaynagi.ts). Orada zorunludur; bilinmiyorsa kullanıcı ilk kaynağı seçer.
      new TutarBilgisiAlani({ anahtar: BORC_ALANI, etiket: 'Düzeltilmiş Bağ-Kur borcu', yardim: 'Tek tutar (350.000,00) ya da aralık (300.000,00 – 450.000,00).' }, secenekGirdisi('bagkur', 'borc'), araclar, ELLE_BOS_NEDENI, ELLE_BOS_HATA),
      new TutarBilgisiAlani({ anahtar: 'bagkurOrtakOdeme', etiket: 'Yalnız SSK yolunda da ödenecek Bağ-Kur tutarı', yardim: 'İki yolda da ödenecek tutar; hiç ödenmeyecekse 0. Boşsa bilinmiyor sayılır.', grup: 'gunVeTutar' }, secenekGirdisi('bagkur', 'yalnizSskYolundaOdenecek'), araclar, 'Ortak ödenecek Bağ-Kur tutarı girilmedi'),
      new OranAlani({ anahtar: 'bagkurGecikmeOrani', etiket: 'Bağ-Kur borcuna aylık gecikme oranı', yardim: `Boşsa gecikme tahmini yapılmaz. En çok ${bicimleyici.oran(GECIKME_ORANI_UST)}.`, grup: 'gunVeTutar' }, kok('bagkurGecikmeAylikOran'), araclar, 0, GECIKME_ORANI_UST, true),
      new TamSayiAlani({ anahtar: 'ihyaGun', etiket: 'İhya edilecek gün', yardim: 'SGK’nın kabul edeceği durdurulmuş süre.', grup: 'gunVeTutar' }, secenekGirdisi('ihya', 'gun'), araclar, 0, hedef, 'gün'),
      new ParaAlani({ anahtar: 'ihyaGunlukBedel', etiket: 'İhya için günlük bedel', yardim: resmiBedel, grup: 'gunVeTutar' }, secenekGirdisi('ihya', 'gunlukBedelTl'), araclar),
      new TamSayiAlani({ anahtar: 'gelecekAyBasinaGun', etiket: 'Planlanan çalışmada ayda SSK günü', yardim: `0–${AYLIK_GUN_UST}; 0 yazılırsa yeni gün eklenmez.`, grup: 'gunVeTutar' }, kok('gelecekAyBasinaGun'), araclar, 0, AYLIK_GUN_UST, 'gün'),
      new ParaAlani({ anahtar: 'elleAylik', etiket: 'Elle aylık (net)', yardim: 'Bütün yollarda bu aylık kullanılır.', grup: 'maasVeAylik', gorunur: v => v.aylikModeli === 'elle' }, kok('elleAylikTl'), araclar, { bosHata: 'Elle aylık için tutar girin.' }),
      new OranAlani({ anahtar: 'borcKesintiOrani', etiket: 'Ödenmeyen borç için aylık kesinti oranı', yardim: `0 ile ${bicimleyici.oran(sinirlar.kesintiTavani)} arası; 0 yazılırsa kesinti uygulanmaz. Kesinti borç bitene kadar sürer.`, grup: 'maasVeAylik' }, kok('borcKesintiOrani'), araclar, 0, sinirlar.kesintiTavani, false),
      new ParaAlani({ anahtar: 'digerKesintiler', etiket: 'Diğer aylık kesintiler', yardim: 'Sağlık gibi her ay düşülen tutar; yoksa 0.', grup: 'maasVeAylik' }, kok('digerKesintilerTl'), araclar, { bosHata: 'Boş bırakılamaz; kesinti yoksa 0 yazın.' }),
      new TamSayiAlani({ anahtar: 'karsilastirmaSuresi', etiket: 'Karşılaştırma süresi', yardim: `Geç yol emekli olduktan sonra 0–${KARSILASTIRMA_YIL_UST} yıl. Yollar bu ortak dönemde karşılaştırılır.`, grup: 'maasVeAylik' }, kok('karsilastirmaSuresiYil'), araclar, 0, KARSILASTIRMA_YIL_UST, 'yıl'),
    ];
    this.alanlar = alanlar;
    this.dizin = new Map(alanlar.map(alan => [alan.anahtar, alan]));

    const ihyaPara = { yardim: 'Kesintilerden sonra elinize kalacağını varsaydığınız aylık. Boşsa seçili aylık modeli kullanılır.' };
    this.ihyaAlanlari = {
      ihyaAylikIhyali: new ParaAlani({ anahtar: 'ihyaAylikIhyali', etiket: 'İhya eklenen yolda net aylık', ...ihyaPara }, ihya('ihyaliTl'), araclar),
      ihyaAylikIhyasiz: new ParaAlani({ anahtar: 'ihyaAylikIhyasiz', etiket: 'İhyasız yolda net aylık', ...ihyaPara }, ihya('ihyasizTl'), araclar),
      ihyaSuresi: new TamSayiAlani({ anahtar: 'ihyaSuresi', etiket: 'İki yol da emekli olduktan sonraki süre', yardim: `0–${KARSILASTIRMA_YIL_UST} yıl; süre geç yolun emekliliğinde başlar.` }, ihya('sureYil'), araclar, 0, KARSILASTIRMA_YIL_UST, 'yıl'),
    };

    const duzeltme = profil.gunDuzeltmesi.gun;
    this.bayraklar = [
      { anahtar: 'gunDuzeltmesiUygula', grup: 'gunVeTutar', etiket: `Kayıttaki gün düzeltmesini uygula (${duzeltme > 0 ? '+' : ''}${bicimleyici.sayi(duzeltme)}\u00a0gün)`, aciklama: profil.gunDuzeltmesi.aciklama },
      { anahtar: 'isUcretiDevam', grup: 'maasVeAylik', etiket: 'İki yolda da iş ücreti aynı devam eder', aciklama: 'Kapalıysa emekli olan yol işi bırakır ve vazgeçilen ücret farka girer. Emeklilik tarihini değiştirmez.' },
    ];

    const referans = profil.sgkReferansAylik;
    this.aylikModelleri = [
      { deger: 'sgkReferans', etiket: AYLIK_MODELI_ETIKETI.sgkReferans, aciklama: `SGK’nın ${bicimleyici.tarih(referans.tarih)} tarihli hesabı (${bicimleyici.gun(referans.gun)}); gelecekte bağlanacak aylık değildir.` },
      { deger: 'kazancTahmini', etiket: AYLIK_MODELI_ETIKETI.kazancTahmini, aciklama: 'Gün ve kazanç girdilerinden tahmin; resmî hesap değildir.' },
      { deger: 'elle', etiket: AYLIK_MODELI_ETIKETI.elle, aciklama: 'Girdiğiniz aylık bütün yollarda kullanılır.' },
    ];
  }

  alan(anahtar: AlanAnahtari): VarsayimAlani {
    const alan = this.dizin.get(anahtar);
    if (!alan) throw new Error(`Bilinmeyen alan: ${anahtar}`);
    return alan;
  }
}
