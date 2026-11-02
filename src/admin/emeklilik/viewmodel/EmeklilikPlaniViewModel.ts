import {
  BILESIM_SIRASI,
  type AylikModeliAdi,
  type EmeklilikPlanlayici,
  type EmeklilikProfili,
  type MevzuatParametreleri,
  type Oneri,
  type Secim,
  type SecenekAnahtari,
  type TlMetni,
  type TutarBilgisi,
  type Varsayimlar,
} from '../contract';
import { TurkceSayiAyristirici } from './ayristirma';
import { TurkceBicimleyici } from './bicim';
import { BORC_ALANI, BorcKaynagiSecici } from './borcKaynagi';
import { EkranSunucu, bilesimAnahtari, secimEsit, type HesapDurumu, type Hesaplar } from './EkranSunucu';
import type { AlanAnahtari, BayrakAnahtari, BorcKaynagiAnahtari, EmeklilikEkrani, IhyaAlanAnahtari, IhyaYolu } from './ekran';
import { VarsayimFormu, type CaprazHata, type IhyaGirdileri } from './form';
import { Hatirlayici } from './hatirlayici';

// Emeklilik planı ViewModel'i (MVVM). Durum: seçim (üç bağımsız Evet/Hayır), varsayımlar, form taslakları ve doğrulama
// hataları, ihya karşılaştırma girdileri. Komutlar durumu değiştirir; her değişiklikte planlayıcı (bağımlılık enjeksiyonu,
// yalnız contract.ts arayüzü) yeniden sorulur ve sunucu yeni, derin dondurulmuş ekran anlık görüntüsü üretir.
// React'e subscribe/getSnapshot ile bağlanır (useSyncExternalStore): aynı durumda getSnapshot aynı başvuruyu verir.
// Hesap kuralları modelindir; ViewModel hesap yapmaz, yalnız ayrıştırır, doğrular, önbelleğe alır ve adlandırır.
// Önbellek: sekiz bileşim ve öneri yalnız varsayımlara bağlıdır; seçim değişince yeniden hesaplanmaz.
// Hata: planlayıcı hata atarsa ekran "Hesap yapılamadı: …" durumuna geçer (sayfa çökmez); sonraki komut yeniden dener.
// Alanlar arası kural (ortak ödeme borcu aşamaz) planlayıcıya gitmeden formda denetlenir: istenen varsayımlar (aday)
// kuralı bozarsa alan hatası yazılır ve planlayıcıya borç/ortak ödeme çiftinin son geçerli hâli gider; diğer
// değişiklikler yine uygulanır. Böylece kullanıcı yazarken sayfa hata durumuna düşmez (odak ve açık bölüm korunur).
// Bağ-Kur borcunun kaynağı (borcKaynagi.ts): varsayılan "SGK düzeltilmiş tutarı bilinmiyor"dur; planlayıcının varsayılan
// varsayımlarındaki profil borcu bu yüzden seçili kaynağın borcuyla değiştirilir (ilk yüklemede ve sıfırlamada).

export interface ViewModelAyarlari {
  /** Doğrulama sınırları için mevzuat (borç kesintisi tavanı). Verilmezse oran %0–100 ile sınırlanır. */
  mevzuat?: Pick<MevzuatParametreleri, 'borcKesintiTavani'>;
  bicimleyici?: TurkceBicimleyici;
  ayristirici?: TurkceSayiAyristirici;
  /** "Bugün" (profil tazeliği); test belirlenimciliği için enjekte edilir. Takvim günü Europe/Istanbul'dan okunur. */
  bugun?: () => Date;
}

/** Görünümün çağırdığı komutlar (arayüz ayrımı: görünüm somut sınıfa değil buna bağlıdır). */
export interface EmeklilikPlaniKomutlari {
  secimDegistir(anahtar: SecenekAnahtari, evet: boolean): void;
  oneriyiSec(): void;
  bilesimSec(anahtar: string): void;
  alanGuncelle(alan: AlanAnahtari, metin: string): void;
  aylikModeliSec(model: AylikModeliAdi): void;
  /** Bağ-Kur borcunun kaynağı: bilinmiyor (varsayılan), sade araç tahmini (profilde varsa) ya da girilen tutar. */
  borcKaynagiSec(kaynak: BorcKaynagiAnahtari): void;
  bayrakDegistir(bayrak: BayrakAnahtari, deger: boolean): void;
  varsayimlariSifirla(): void;
  ihyaAylikGuncelle(yol: IhyaYolu, metin: string): void;
  ihyaSuresiGuncelle(metin: string): void;
}

/** Görünüm deposu: değişmez anlık görüntü + abonelik (React useSyncExternalStore). */
export interface EmeklilikEkranDeposu {
  subscribe(dinleyici: () => void): () => void;
  getSnapshot(): EmeklilikEkrani;
}

const HICBIRI: Secim = Object.freeze({ askerlik: false, bagkur: false, ihya: false });
const IHYA_ALANI: Readonly<Record<IhyaYolu, IhyaAlanAnahtari>> = { ihyali: 'ihyaAylikIhyali', ihyasiz: 'ihyaAylikIhyasiz' };
/** Sıfırlamada korunan girdiler: ihya karşılaştırmasının elle girilen aylıkları varsayım değildir. */
const KORUNAN_IHYA_ALANLARI: ReadonlySet<string> = new Set(Object.values(IHYA_ALANI));

/** Varsayımlardaki Bağ-Kur borcunu değiştirir (değişmez kopya). */
function borcYaz(v: Varsayimlar, borc: TutarBilgisi): Varsayimlar {
  return { ...v, secenekGirdileri: { ...v.secenekGirdileri, bagkur: { ...v.secenekGirdileri.bagkur, borc } } };
}

/** Çapraz kurala giren çift: düzeltilmiş borç ve yalnız SSK yolunda da ödenecek tutar. */
type BorcCifti = Pick<Varsayimlar['secenekGirdileri']['bagkur'], 'borc' | 'yalnizSskYolundaOdenecek'>;
const ORTAK_ALANI: AlanAnahtari = 'bagkurOrtakOdeme';

function ciftOku(v: Varsayimlar): BorcCifti {
  const { borc, yalnizSskYolundaOdenecek } = v.secenekGirdileri.bagkur;
  return { borc, yalnizSskYolundaOdenecek };
}

function ciftYaz(v: Varsayimlar, cift: BorcCifti): Varsayimlar {
  return { ...v, secenekGirdileri: { ...v.secenekGirdileri, bagkur: { ...v.secenekGirdileri.bagkur, ...cift } } };
}

const istanbulGunu = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' });

function hataMetni(hata: unknown): string {
  const ileti = hata instanceof Error ? hata.message.trim() : '';
  return ileti ? `Hesap yapılamadı: ${ileti}` : 'Hesap yapılamadı.';
}

export class EmeklilikPlaniViewModel implements EmeklilikPlaniKomutlari, EmeklilikEkranDeposu {
  private secim: Secim = HICBIRI;
  /** Planlayıcıya giden varsayımlar: adayın kuralı bozmayan hâli (borç/ortak ödeme çifti son geçerli değerinde). */
  private varsayim: Varsayimlar | null = null;
  /** Kullanıcının istediği varsayımlar (ayrıştırılan her değer); ekranda bunlar görünür. */
  private aday: Varsayimlar | null = null;
  private sonGecerliCift: BorcCifti | null = null;
  private caprazHata: CaprazHata | null = null;
  /** Çapraz hatanın yazıldığı alan: borç alanı düzenlendiyse orası, diğer durumlarda ortak ödeme alanı. */
  private caprazAlan: AlanAnahtari = ORTAK_ALANI;
  private ihyaGirdileri: IhyaGirdileri | null = null;
  private readonly taslaklar = new Map<string, string>();
  private readonly hatalar = new Map<string, string>();
  private readonly dinleyiciler = new Set<() => void>();
  private readonly form: VarsayimFormu;
  private readonly sunucu: EkranSunucu;
  private readonly borcKaynagi: BorcKaynagiSecici;
  private readonly varsayimHesaplari = new Hatirlayici<{ bilesimler: Hesaplar['bilesimler']; oneri: Oneri }>();
  private readonly secimHesaplari = new Hatirlayici<Pick<Hesaplar, 'karsilastirma' | 'etkiler'>>();
  private readonly ihyaHesabi = new Hatirlayici<Pick<Hesaplar, 'ihya' | 'ihyaVarsayim'>>();
  private anlik: EmeklilikEkrani;
  private readonly bugun: () => Date;

  constructor(
    private readonly planlayici: EmeklilikPlanlayici,
    profil: EmeklilikProfili,
    ayarlar: ViewModelAyarlari = {},
  ) {
    const bicimleyici = ayarlar.bicimleyici ?? new TurkceBicimleyici();
    const ayristirici = ayarlar.ayristirici ?? new TurkceSayiAyristirici();
    this.bugun = ayarlar.bugun ?? (() => new Date());
    this.form = new VarsayimFormu(profil, { kesintiTavani: ayarlar.mevzuat?.borcKesintiTavani ?? 1 }, { bicimleyici, ayristirici });
    this.sunucu = new EkranSunucu(profil, this.form, bicimleyici);
    this.borcKaynagi = new BorcKaynagiSecici(profil);
    // Başlangıç seçimi öneridir (iki kaynak aracın ortak davranışı); öneri alınamazsa hiçbir şey seçili değildir.
    if (this.varsayimlariYukle()) {
      try {
        this.secim = { ...this.varsayimHesabi(this.varsayim!).oneri.secim };
      } catch {
        this.secim = HICBIRI;
      }
    }
    this.anlik = this.olustur();
  }

  // --- React bağlantısı (useSyncExternalStore) ------------------------------------------------------------------------
  readonly subscribe = (dinleyici: () => void): (() => void) => {
    this.dinleyiciler.add(dinleyici);
    return () => { this.dinleyiciler.delete(dinleyici); };
  };

  readonly getSnapshot = (): EmeklilikEkrani => this.anlik;

  // --- Komutlar -----------------------------------------------------------------------------------------------------
  secimDegistir(anahtar: SecenekAnahtari, evet: boolean): void {
    if (this.secim[anahtar] === evet) return;
    this.secim = { ...this.secim, [anahtar]: evet };
    this.yenile();
  }

  /** Öneriyi seçer ("Bunu seç"). Öneri yoksa (hesap hatası) bir şey yapmaz. */
  oneriyiSec(): void {
    const oneri = this.guvenli(() => this.varsayimHesabi(this.varsayimlariAl()).oneri);
    if (!oneri || secimEsit(oneri.secim, this.secim)) return;
    this.secim = { ...oneri.secim };
    this.yenile();
  }

  /** Bileşim tablosundan satır seçer: "hicbiri", "askerlik", "askerlik+ihya", … */
  bilesimSec(anahtar: string): void {
    const secim = BILESIM_SIRASI.find(s => bilesimAnahtari(s) === anahtar);
    if (!secim) throw new Error(`Bilinmeyen bileşim: ${anahtar}`);
    if (secimEsit(secim, this.secim)) return;
    this.secim = { ...secim };
    this.yenile();
  }

  /**
   * Metni ayrıştırır ve doğrular; geçerliyse varsayımı günceller, değilse hatayı alanın yanında gösterir. Bağ-Kur borcu
   * tutarı yazılırsa kaynak "Tutarı gir" olur; geçerli tutar o kaynak için saklanır.
   */
  alanGuncelle(alan: AlanAnahtari, metin: string): void {
    const tanim = this.form.alan(alan);
    const kaynakDegisti = alan === BORC_ALANI && this.borcKaynagiUygula('elle');
    if (this.taslaklar.get(alan) === metin && !kaynakDegisti) return;
    this.taslaklar.set(alan, metin);
    if (this.aday) {
      const sonuc = tanim.uygula(this.aday, metin);
      if (sonuc.tamam) {
        this.hatalar.delete(alan);
        if (alan === BORC_ALANI) this.borcKaynagi.elleAyarla(sonuc.durum.secenekGirdileri.bagkur.borc);
        this.adayUygula(sonuc.durum, alan);
      } else {
        this.hatalar.set(alan, sonuc.hata);
      }
    }
    this.yenile();
  }

  aylikModeliSec(model: AylikModeliAdi): void {
    if (!this.aday || this.aday.aylikModeli === model) return;
    this.adayUygula({ ...this.aday, aylikModeli: model });
    this.yenile();
  }

  /**
   * Bağ-Kur borcunun kaynağını seçer; borç, sonuç, öneri ve bileşimler anında yeniden hesaplanır, seçim korunur. Profilde
   * tahmin yoksa 'tahmin' yok sayılır; varsayımlar yoksa (hesap hatası) bir şey yapmaz.
   */
  borcKaynagiSec(kaynak: BorcKaynagiAnahtari): void {
    if (this.borcKaynagiUygula(kaynak)) this.yenile();
  }

  bayrakDegistir(bayrak: BayrakAnahtari, deger: boolean): void {
    if (!this.aday || this.aday[bayrak] === deger) return;
    this.adayUygula({ ...this.aday, [bayrak]: deger });
    this.yenile();
  }

  /** Varsayımları profil ve mevzuattan yeniden üretir; taslaklar ve hatalar temizlenir, seçim ve ihya aylıkları korunur. */
  varsayimlariSifirla(): void {
    for (const harita of [this.taslaklar, this.hatalar]) {
      for (const anahtar of [...harita.keys()]) if (!KORUNAN_IHYA_ALANLARI.has(anahtar)) harita.delete(anahtar);
    }
    const onceki = this.ihyaGirdileri;
    this.borcKaynagi.sifirla();
    this.varsayim = null;
    this.aday = null;
    this.sonGecerliCift = null;
    this.caprazHata = null;
    this.caprazAlan = ORTAK_ALANI;
    this.ihyaGirdileri = null;
    if (this.varsayimlariYukle() && onceki) {
      this.ihyaGirdileri = { ...this.ihyaGirdileri!, ihyaliTl: onceki.ihyaliTl, ihyasizTl: onceki.ihyasizTl };
    }
    this.yenile();
  }

  /** İhya karşılaştırması: bir yolun elle girilen net aylığı (boş = seçili aylık modeli). */
  ihyaAylikGuncelle(yol: IhyaYolu, metin: string): void {
    this.ihyaAlaniGuncelle(IHYA_ALANI[yol], metin);
  }

  /** İhya karşılaştırmasının kendi dönemi (yıl); ana varsayımı değiştirmez. */
  ihyaSuresiGuncelle(metin: string): void {
    this.ihyaAlaniGuncelle('ihyaSuresi', metin);
  }

  // --- İç işleyiş ---------------------------------------------------------------------------------------------------
  /** Kaynağı değiştirip borcu adaya yazar; değiştiyse true (bildirim çağıranındır). */
  private borcKaynagiUygula(kaynak: BorcKaynagiAnahtari): boolean {
    if (!this.aday || !this.borcKaynagi.sec(kaynak)) return false;
    this.adayUygula(borcYaz(this.aday, this.borcKaynagi.deger()));
    return true;
  }

  /**
   * Adayı kabul eder ve çapraz kuralı denetler. Kural tutuyorsa planlayıcıya aday gider; bozuluyorsa hata yazılır ve
   * planlayıcıya adayın borç/ortak ödeme çifti son geçerli hâliyle gider (diğer değişiklikler uygulanır).
   */
  private adayUygula(aday: Varsayimlar, alan?: AlanAnahtari): void {
    this.aday = aday;
    const hata = this.form.caprazHata(aday);
    if (hata === null || this.sonGecerliCift === null) {
      this.caprazHata = null;
      this.caprazAlan = ORTAK_ALANI;
      this.sonGecerliCift = ciftOku(aday);
      this.varsayim = aday;
      return;
    }
    if (this.caprazHata === null || alan === BORC_ALANI || alan === ORTAK_ALANI) this.caprazAlan = alan === BORC_ALANI ? BORC_ALANI : ORTAK_ALANI;
    this.caprazHata = hata;
    // Yalnız çift değiştiyse hesap girdisi aynıdır: önceki başvuru korunur, planlayıcı her tuşta yeniden sorulmaz.
    const gecerli = ciftYaz(aday, this.sonGecerliCift);
    if (!this.varsayim || JSON.stringify(gecerli) !== JSON.stringify(this.varsayim)) this.varsayim = gecerli;
  }

  /** Ayrıştırma hataları + (varsa) çapraz hata görünen alanda; ayrıştırma hatası önce gelir. */
  private sunulanHatalar(): ReadonlyMap<string, string> {
    if (!this.caprazHata) return this.hatalar;
    const alan = this.caprazAlan === BORC_ALANI && this.borcKaynagi.secili === 'elle' ? BORC_ALANI : ORTAK_ALANI;
    if (this.hatalar.has(alan)) return this.hatalar;
    const hatalar = new Map(this.hatalar);
    hatalar.set(alan, `Hata: ${alan === BORC_ALANI ? this.caprazHata.borcIcin : this.caprazHata.ortakIcin}`);
    return hatalar;
  }

  private ihyaAlaniGuncelle(anahtar: IhyaAlanAnahtari, metin: string): void {
    if (this.taslaklar.get(anahtar) === metin) return;
    this.taslaklar.set(anahtar, metin);
    if (this.ihyaGirdileri) {
      const sonuc = this.form.ihyaAlanlari[anahtar].uygula(this.ihyaGirdileri, metin);
      if (sonuc.tamam) {
        this.hatalar.delete(anahtar);
        this.ihyaGirdileri = sonuc.durum;
      } else {
        this.hatalar.set(anahtar, sonuc.hata);
      }
    }
    this.yenile();
  }

  /**
   * Varsayımlar yoksa planlayıcıdan alır (hata atabilir); Bağ-Kur borcu seçili kaynağın borcudur (varsayılan: bilinmiyor).
   * İhya süresi varsayımdaki karşılaştırma süresiyle başlar.
   */
  private varsayimlariAl(): Varsayimlar {
    if (this.varsayim) return this.varsayim;
    const varsayim = borcYaz(this.planlayici.varsayilanVarsayimlar(), this.borcKaynagi.deger());
    // Planlayıcının varsayılanları geçerli kabul edilir (profil şeması denetler); sonraki komutlar adayla denetlenir.
    this.aday = varsayim;
    this.varsayim = varsayim;
    this.sonGecerliCift = ciftOku(varsayim);
    this.caprazHata = null;
    this.ihyaGirdileri ??= { ihyaliTl: null, ihyasizTl: null, sureYil: varsayim.karsilastirmaSuresiYil };
    return varsayim;
  }

  private varsayimlariYukle(): boolean {
    return this.guvenli(() => this.varsayimlariAl()) !== null;
  }

  private guvenli<T>(islem: () => T): T | null {
    try {
      return islem();
    } catch {
      return null;
    }
  }

  private varsayimHesabi(v: Varsayimlar) {
    return this.varsayimHesaplari.getir([v], () => ({ bilesimler: this.planlayici.tumBilesimler(v), oneri: this.planlayici.oneri(v) }));
  }

  private hesapla(): HesapDurumu {
    try {
      const v = this.varsayimlariAl();
      const { bilesimler, oneri } = this.varsayimHesabi(v);
      const secim = this.secim;
      const { karsilastirma, etkiler } = this.secimHesaplari.getir([v, secim], () => ({
        karsilastirma: this.planlayici.karsilastir(secim, v),
        etkiler: this.planlayici.secimEtkileri(secim, v),
      }));
      const g = this.ihyaGirdileri!;
      const { ihya, ihyaVarsayim } = this.ihyaHesabi.getir([v, secim, g], () => {
        // İhya karşılaştırması: diğer iki seçim şimdiki hâliyle, ihyalı (a, yol) ve ihyasız (b, referans).
        // Yalnız dolu net aylık gönderilir: boş alan "seçili aylık modeli" demektir (sözleşmede anahtar yoksa seçili model,
        // null ise elle model ve bilinmiyor; planlayiciSozlesmesi.test.ts).
        const ihyaVarsayim = g.sureYil === v.karsilastirmaSuresiYil ? v : { ...v, karsilastirmaSuresiYil: g.sureYil };
        const elleAylik: { a?: TlMetni; b?: TlMetni } = {};
        if (g.ihyaliTl !== null) elleAylik.a = g.ihyaliTl;
        if (g.ihyasizTl !== null) elleAylik.b = g.ihyasizTl;
        return {
          ihya: this.planlayici.yolKarsilastir({ ...secim, ihya: true }, { ...secim, ihya: false }, ihyaVarsayim, elleAylik),
          ihyaVarsayim,
        };
      });
      return { tur: 'hazir', hesaplar: { karsilastirma, etkiler, bilesimler, oneri, ihya, ihyaVarsayim } };
    } catch (hata) {
      return { tur: 'hata', neden: hataMetni(hata) };
    }
  }

  private olustur(): EmeklilikEkrani {
    const hesap = this.hesapla();
    return this.sunucu.sun({
      secim: this.secim,
      varsayim: this.aday,
      hesap,
      taslaklar: this.taslaklar,
      hatalar: this.sunulanHatalar(),
      ihyaGirdileri: this.ihyaGirdileri,
      borcKaynagi: this.borcKaynagi,
      bugun: istanbulGunu.format(this.bugun()),
    });
  }

  private yenile(): void {
    this.anlik = this.olustur();
    for (const dinleyici of [...this.dinleyiciler]) dinleyici();
  }
}
