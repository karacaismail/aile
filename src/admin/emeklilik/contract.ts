// Emeklilik planı — katman sözleşmesi (MVVM).
//
//   model/      Saf alan sınıfları (React yok, DOM yok). Para kuruş tamsayısıyla, gün tamsayıyla tutulur.
//               Tek giriş noktası EmeklilikPlanlayici arayüzüdür; seçenekler (askerlik, Bağ-Kur, ihya) ortak
//               soyut sınıftan türer, aylık hesabı değiştirilebilir stratejidir (SGK referansı, kazanç tahmini, elle).
//   viewmodel/  EmeklilikPlaniViewModel sınıfı: durum + komutlar + değişmez ekran anlık görüntüsü
//               (subscribe/getSnapshot, React'te useSyncExternalStore). Modele yalnız bu dosyadaki
//               arayüzlerle bağlanır; testte sahte planlayıcı verilebilir (bağımlılık enjeksiyonu).
//   view        pages/EmeklilikPage.tsx (telefon, 320 px önce) ve pages/emeklilik/*.wide.tsx (geniş); yalnız
//               anlık görüntüyü çizer ve komut çağırır, hesap yapmaz.
//   data/       Profil kaynağı (dev: /__aile/emeklilik/profil.json, AILE_EMEKLILIK_PROFILE; üretim: dosya içe
//               aktarma, yalnız bellekte). Kişisel profil Git'e ve dist'e girmez; testler sentetik profili kullanır.
//
// Hesap kuralları (iki kaynağın uzlaştırılmış hali, docs/EMEKLILIK-PLANI.md):
//   - Bilinmeyen tutar uydurulmaz: TutarBilgisi 'bilinmiyor' ise ondan türeyen toplam, fark ve geri kazanma da
//     'bilinmiyor' olur ve nedenini taşır.
//   - Ödenmeyen Bağ-Kur borcunun aylık kesintisi yalnız borç bitene kadar sürer; borç bilinmiyorsa süre bilinmiyor.
//   - Aylık tahmini tek değer ve etiketlidir; ölçülmemiş ±% aralık üretilmez.
//   - Yollar ortak bir dönemde karşılaştırılır: geç yolun emekliliğinden sonra karsilastirmaSuresiYil yıl.
//   - Geri kazanma (başa baş): referansa göre birikimli fark (ödeme ve vazgeçilen ücret dahil) ilk kez ≥ 0 olduğu ay;
//     dönem içinde yoksa null ve neden yok ("geri dönmüyor"). Net aylık eksiye düşmez (ayda en az 0).
//   - Sekiz bileşimin hepsi değerlendirilir; mali sıralama yapılamıyorsa öneri "en erken tarih" olarak adlandırılır.

export type SecenekAnahtari = 'askerlik' | 'bagkur' | 'ihya';
export const SECENEK_ANAHTARLARI: readonly SecenekAnahtari[] = ['askerlik', 'bagkur', 'ihya'];

/** 'YYYY-MM' planlama ayı (ay sonu kabul edilir). */
export type AyMetni = string;
/** 'YYYY-MM-DD' takvim günü. */
export type TarihMetni = string;
/** Ondalık TL metni, nokta ondalık ayırıcı; ör. '8500.00'. Kayan noktaya çevrilmeden işlenir. */
export type TlMetni = string;

/** Tutar bilgisi: bilinen tek tutar, aralık ya da bilinmiyor. Kaynak/neden her zaman yazılır. */
export type TutarBilgisi =
  | { tur: 'bilinen'; tl: TlMetni; kaynak: string }
  | { tur: 'aralik'; altTl: TlMetni; ustTl: TlMetni; kaynak: string }
  | { tur: 'bilinmiyor'; neden: string };

/** Kişisel emeklilik profili. Git'e girmez; sentetik örnek fixtures/emeklilik/profil-sentetik.json. */
export interface EmeklilikProfili {
  surum: 1;
  /** Profil sentetik mi (testler) yoksa kişisel kayıtlardan mı. */
  sentetik: boolean;
  /** Verilerin okunduğu gün. */
  kayitTarihi: TarihMetni;
  dogumTarihi: TarihMetni;
  ilkSigortaGirisi: TarihMetni;
  /** Emeklilik için gereken prim günü (giriş tarihine bağlı; kaynakla birlikte). */
  hedefGun: number;
  /** Sigortalılık süresi şartı (yıl). 18 yaşından önce girişte süre 18. doğum gününden başlar. */
  sigortalilikYili: number;
  /**
   * İsteğe bağlı asgari yaş şartı (tam yıl, 0–100). Yaş şartı varsayılan olarak kapsam dışıdır; alan varsa planlama ayı
   * bu yaşın dolduğu aydan önce olamaz (docs/EMEKLILIK-PLANI.md). Alan yoksa hesap değişmez.
   */
  asgariYas?: number;
  kayitliGun: { gun: number; sonAy: AyMetni; once2008Gun: number; sonra2008Gun: number };
  /** Kayıt düzeltmesi önerisi (ör. 31 günlük ayın 30'a inmesi: -1). Uygulanıp uygulanmayacağı varsayımdır. */
  gunDuzeltmesi: { gun: number; aciklama: string };
  /** Kayıtlı aydan sonraki planlanan SSK çalışması; bitisAy null = açık uçlu (varsayımlardaki gelecekAyBasinaGun uygulanır). */
  planlananCalisma: Array<{ baslangicAy: AyMetni; bitisAy: AyMetni | null; ayBasinaGun: number; aciklama: string }>;
  kazanc: {
    /** Son prime esas kazanç (brüt) ve ayı. */
    sonPekTl: TlMetni;
    sonPekAyi: AyMetni;
    /** Bugünkü net iş ücreti ve varsayılan zam oranı (0.30 = %30). */
    netUcretTl: TlMetni;
    ucretZamOrani: number;
    /** Ekim 2008 sonrası günlerin asgari ücrete göre kat toplamı (gün × kat) ve 2008 öncesi ortalama kat (tahmin girdisi). */
    sonra2008KatToplam: number;
    once2008OrtalamaKat: number;
  };
  /** SGK'nın tarihli aylık hesap sonucu (kayitliGun.gun ile hesaplanmış). */
  sgkReferansAylik: { tl: TlMetni; tarih: TarihMetni; gun: number; ekOdemeTl: TlMetni | null };
  /** Varsayılan aylık modeli. */
  varsayilanAylikModeli: AylikModeliAdi;
  secenekler: {
    askerlik: { gun: number; azamiGun: number; gunlukBedelTl: TlMetni | null; aciklama: string };
    bagkur: {
      gun: number;
      /** SGK'nın düzeltilmiş borç tutarı; bilinmiyorsa 'bilinmiyor' (tutar uydurulmaz). */
      borc: TutarBilgisi;
      /**
       * İsteğe bağlı: sade karar aracının borç tahmini (çoğunlukla aralık: çakışan aylar silinirse alt, silinmezse üst uç;
       * gecikme zammı dahil). Yalnız kullanıcı "Sade araç tahmini" kaynağını seçerse hesaba girer; varsayılan kaynak
       * "SGK düzeltilmiş tutarı bilinmiyor"dur. Alan yoksa bu kaynak sunulmaz.
       */
      tahminiBorc?: TutarBilgisi;
      yalnizSskYolundaOdenecek: TutarBilgisi;
      aciklama: string;
    };
    ihya: { gun: number; gunlukBedelTl: TlMetni | null; aciklama: string };
  };
  /** Profilin dayandığı kaynakların kısa adları (kişisel kimlik numarası içermez). */
  kaynaklar: string[];
}

/** Kamu mevzuatı ve resmi oranlar (kişisel değil). Yıl ve kaynak taşır. */
export interface MevzuatParametreleri {
  yil: number;
  asgariUcretBrutTl: TlMetni;
  gunlukKazancAltSiniriTl: TlMetni;
  /** Borçlanma/ihya prim oranı (0.45 = %45). Günlük asgari bedel = alt sınır × oran. */
  borclanmaOrani: number;
  enDusukAylikTl: TlMetni;
  /** Ödenmeyen borç için aylıktan kesinti oranı ve kanuni tavanı. */
  borcKesintiOrani: number;
  borcKesintiTavani: number;
  kaynaklar: string[];
}

export type AylikModeliAdi = 'sgkReferans' | 'kazancTahmini' | 'elle';

/** Kullanıcının değiştirebildiği varsayımlar; varsayılanlar profilden ve mevzuattan üretilir. */
export interface Varsayimlar {
  aylikModeli: AylikModeliAdi;
  /** aylikModeli 'elle' iken tüm yollar için aylık (net). */
  elleAylikTl: TlMetni | null;
  /** 0 … mevzuat.borcKesintiTavani. 0 = kesinti uygulanmaz. */
  borcKesintiOrani: number;
  /** Aylıktan her ay düşülen diğer kesintiler (sağlık vb.). */
  digerKesintilerTl: TlMetni;
  /** Geç yol emekli olduktan sonra karşılaştırma süresi (yıl, 0–40). */
  karsilastirmaSuresiYil: number;
  /** true: iki yolda da iş ücreti aynı devam eder (farkta birbirini götürür). false: emekli olan işi bırakır. */
  isUcretiDevam: boolean;
  gunDuzeltmesiUygula: boolean;
  /** Açık uçlu planlanan çalışmada ayda SSK günü (0–30). 0 → yeni gün eklenmez. */
  gelecekAyBasinaGun: number;
  /** Bağ-Kur borcuna eklenecek aylık gecikme oranı tahmini; null = tahmin yapılmaz. */
  bagkurGecikmeAylikOran: number | null;
  /** Seçenek girdileri (profil değerlerinin düzenlenebilir kopyası). */
  secenekGirdileri: {
    askerlik: { gun: number; gunlukBedelTl: TlMetni | null };
    bagkur: { gun: number; borc: TutarBilgisi; yalnizSskYolundaOdenecek: TutarBilgisi };
    ihya: { gun: number; gunlukBedelTl: TlMetni | null };
  };
}

export interface Secim { askerlik: boolean; bagkur: boolean; ihya: boolean }

/** Bir seçim birleşiminin (yolun) sonucu. */
export interface YolSonucu {
  secim: Secim;
  eklenenGun: Record<SecenekAnahtari, number>;
  /** Hedefe ulaşmak için planlanan çalışmayla tamamlanan gün. */
  calisarakTamamlananGun: number;
  /** Planlama ayı; null = hedefe ulaşılamıyor (ör. gelecekAyBasinaGun 0 ve gün eksik). */
  emeklilikAyi: AyMetni | null;
  /** Emeklilik ayı sonundaki yaş. */
  yas: number | null;
  /**
   * Tarihi belirleyen koşul: prim günü ya da sigortalılık süresi. null: hedefe ulaşılamıyor (emeklilikAyi null) ya da
   * tarihi bu iki koşul dışında bir şey belirliyor (sinirlayanAyrinti).
   */
  sinirlayanKosul: 'gun' | 'sigortalilikSuresi' | null;
  /**
   * İsteğe bağlı: sinirlayanKosul null ve emeklilikAyi varken tarihi ne belirledi. 'asgariYas': profildeki asgari yaş
   * şartı; 'kayitAyi': gün ve süre kayıt ayından önce dolmuş, planlama ayı kayıt ayıdır. Diğer durumlarda null.
   */
  sinirlayanAyrinti?: 'asgariYas' | 'kayitAyi' | null;
  /** Geçmiş günler için toplam ödeme ve kalemleri. */
  odeme: TutarBilgisi;
  odemeKalemleri: Array<{ anahtar: SecenekAnahtari; tutar: TutarBilgisi }>;
  /** Seçili aylık modeline göre brüt aylık (model adıyla etiketlenir). */
  aylik: TutarBilgisi;
  aylikModeli: AylikModeliAdi;
  /** Ödenmeyen Bağ-Kur borcu kesintisi; uygulanmıyorsa null. sureAy null = süre bilinmiyor. */
  kesinti: { oran: number; sureAy: number | null; neden: string } | null;
}

/** Bir yolun referans yola (hiçbir şey ödemeyen) ya da başka bir yola göre ortak dönemdeki nakit karşılaştırması. */
export interface KarsilastirmaSonucu {
  referans: YolSonucu;
  yol: YolSonucu;
  /** Referansa göre kaç ay erken (negatif: geç); tarih yoksa null. */
  erkenAy: number | null;
  /** Ek ödeme (yolun ödemesi − ortak ödemeler − referansın ödemesi). */
  ekOdeme: TutarBilgisi;
  /** Geç yol emekli olduğu ayın sonunda birikimli fark. */
  gecYolEmekliOlunca: TutarBilgisi;
  /** Karşılaştırma süresinin sonunda birikimli fark. */
  donemSonunda: TutarBilgisi;
  /**
   * Geri kazanma (başa baş): ortak dönemin başından (erken yolun emekliliği) kaç ay sonra referansa göre birikimli fark
   * (ödeme ve vazgeçilen ücret dahil) ilk kez ≥ 0 olur; 0 = ek ödeme yok. Aralıklı girdide iki senaryonun uzun olanı.
   * null: girdi bilinmiyor (hesaplanamayanNeden dolu) ya da dönem içinde başa baş yok (hesaplanamayanNeden null).
   */
  geriKazanmaAylikSayisi: number | null;
  /** Mali sonuç üretilemiyorsa neden (Türkçe, kullanıcıya gösterilir). */
  hesaplanamayanNeden: string | null;
  /**
   * İsteğe bağlı: karşılaştırmadaki aylık net iş ücreti (zam varsayımı uygulanmış) ve kaynağı. isUcretiDevam=false iken
   * emekli olan yolun vazgeçtiği ücrettir; true iken iki yolda aynı olduğundan farka girmez. Profilden gelir.
   */
  isUcreti?: TutarBilgisi;
}

export interface SecimEtkisi {
  anahtar: SecenekAnahtari;
  /** Diğer seçimler sabitken bu seçimi açmanın etkisi. */
  erkenAy: number | null;
  ekOdeme: TutarBilgisi;
  donemSonundaFark: TutarBilgisi;
}

export interface Oneri {
  /** Mali sıralama yapılabildiyse 'senaryoOnerisi', yapılamadıysa 'enErkenTarih'. */
  tur: 'senaryoOnerisi' | 'enErkenTarih';
  secim: Secim;
  gerekce: string;
  /** Kesinti olmasa / borç tutarı aralığın üst ucunda olsa da aynı öneri mi. */
  saglam: boolean;
}

/** Model cephesi. ViewModel yalnız buna bağlıdır. */
export interface EmeklilikPlanlayici {
  yol(secim: Secim, varsayim: Varsayimlar): YolSonucu;
  /** Seçili yolu referans (hiçbir şey ödemeyen) yolla karşılaştırır. */
  karsilastir(secim: Secim, varsayim: Varsayimlar): KarsilastirmaSonucu;
  /** İki yolu karşılaştırır; isteğe bağlı olarak her yol için elle girilen net aylıkla (ihya karşılaştırması). */
  yolKarsilastir(a: Secim, b: Secim, varsayim: Varsayimlar, elleAylik?: { a?: TlMetni | null; b?: TlMetni | null }): KarsilastirmaSonucu;
  /** Sekiz bileşim, sabit sıra: hiçbiri, askerlik, bagkur, ihya, askerlik+bagkur, askerlik+ihya, bagkur+ihya, hepsi. */
  tumBilesimler(varsayim: Varsayimlar): KarsilastirmaSonucu[];
  secimEtkileri(secim: Secim, varsayim: Varsayimlar): SecimEtkisi[];
  oneri(varsayim: Varsayimlar): Oneri;
  /** Profil + mevzuattan varsayılan varsayımlar. */
  varsayilanVarsayimlar(): Varsayimlar;
}

/** Sabit sıralı sekiz bileşim (tablo ve tarama bu sırayı kullanır). */
export const BILESIM_SIRASI: readonly Secim[] = [
  { askerlik: false, bagkur: false, ihya: false },
  { askerlik: true, bagkur: false, ihya: false },
  { askerlik: false, bagkur: true, ihya: false },
  { askerlik: false, bagkur: false, ihya: true },
  { askerlik: true, bagkur: true, ihya: false },
  { askerlik: true, bagkur: false, ihya: true },
  { askerlik: false, bagkur: true, ihya: true },
  { askerlik: true, bagkur: true, ihya: true },
];

/** Profil kaynağının durumu. Üretimde varsayılan kaynak yoktur ('yok'): kullanıcı dosya içe aktarır. */
export type ProfilDurumu =
  | { tur: 'yukleniyor' }
  | { tur: 'hazir'; profil: EmeklilikProfili; kaynak: 'gelistirme' | 'dosya' | 'sentetik' }
  | { tur: 'yok'; neden: string }
  | { tur: 'hata'; neden: string };

/** Profil deposu (repository). Profil yalnız bellekte tutulur; kalıcı depolama yoktur. */
export interface EmeklilikProfilKaynagi {
  durum(): ProfilDurumu;
  subscribe(dinleyici: () => void): () => void;
  yenile(): Promise<void>;
  dosyadanYukle(dosya: File): Promise<void>;
  temizle(): void;
}
