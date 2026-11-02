import {
  BILESIM_SIRASI,
  type AylikModeliAdi,
  type EmeklilikPlanlayici,
  type EmeklilikProfili,
  type MevzuatParametreleri,
  type Oneri,
  type Secim,
  type SecenekAnahtari,
  type Varsayimlar,
} from '../contract';
import { TurkceSayiAyristirici } from './ayristirma';
import { TurkceBicimleyici } from './bicim';
import { EkranSunucu, bilesimAnahtari, secimEsit, type HesapDurumu, type Hesaplar } from './EkranSunucu';
import type { AlanAnahtari, BayrakAnahtari, EmeklilikEkrani, IhyaAlanAnahtari, IhyaYolu } from './ekran';
import { VarsayimFormu, type IhyaGirdileri } from './form';
import { Hatirlayici } from './hatirlayici';

// Emeklilik planı ViewModel'i (MVVM). Durum: seçim (üç bağımsız Evet/Hayır), varsayımlar, form taslakları ve doğrulama
// hataları, ihya karşılaştırma girdileri. Komutlar durumu değiştirir; her değişiklikte planlayıcı (bağımlılık enjeksiyonu,
// yalnız contract.ts arayüzü) yeniden sorulur ve sunucu yeni, derin dondurulmuş ekran anlık görüntüsü üretir.
// React'e subscribe/getSnapshot ile bağlanır (useSyncExternalStore): aynı durumda getSnapshot aynı başvuruyu verir.
// Hesap kuralları modelindir; ViewModel hesap yapmaz, yalnız ayrıştırır, doğrular, önbelleğe alır ve adlandırır.
// Önbellek: sekiz bileşim ve öneri yalnız varsayımlara bağlıdır; seçim değişince yeniden hesaplanmaz.
// Hata: planlayıcı hata atarsa ekran "Hesap yapılamadı: …" durumuna geçer (sayfa çökmez); sonraki komut yeniden dener.

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

const istanbulGunu = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' });

function hataMetni(hata: unknown): string {
  const ileti = hata instanceof Error ? hata.message.trim() : '';
  return ileti ? `Hesap yapılamadı: ${ileti}` : 'Hesap yapılamadı.';
}

export class EmeklilikPlaniViewModel implements EmeklilikPlaniKomutlari, EmeklilikEkranDeposu {
  private secim: Secim = HICBIRI;
  private varsayim: Varsayimlar | null = null;
  private ihyaGirdileri: IhyaGirdileri | null = null;
  private readonly taslaklar = new Map<string, string>();
  private readonly hatalar = new Map<string, string>();
  private readonly dinleyiciler = new Set<() => void>();
  private readonly form: VarsayimFormu;
  private readonly sunucu: EkranSunucu;
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
    const oneri = this.guvenli(() => this.varsayimHesabi(this.varsayim!).oneri);
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

  /** Metni ayrıştırır ve doğrular; geçerliyse varsayımı günceller, değilse hatayı alanın yanında gösterir. */
  alanGuncelle(alan: AlanAnahtari, metin: string): void {
    const tanim = this.form.alan(alan);
    if (this.taslaklar.get(alan) === metin) return;
    this.taslaklar.set(alan, metin);
    if (this.varsayim) {
      const sonuc = tanim.uygula(this.varsayim, metin);
      if (sonuc.tamam) {
        this.hatalar.delete(alan);
        this.varsayim = sonuc.durum;
      } else {
        this.hatalar.set(alan, sonuc.hata);
      }
    }
    this.yenile();
  }

  aylikModeliSec(model: AylikModeliAdi): void {
    if (!this.varsayim || this.varsayim.aylikModeli === model) return;
    this.varsayim = { ...this.varsayim, aylikModeli: model };
    this.yenile();
  }

  bayrakDegistir(bayrak: BayrakAnahtari, deger: boolean): void {
    if (!this.varsayim || this.varsayim[bayrak] === deger) return;
    this.varsayim = { ...this.varsayim, [bayrak]: deger };
    this.yenile();
  }

  /** Varsayımları profil ve mevzuattan yeniden üretir; taslaklar ve hatalar temizlenir, seçim ve ihya aylıkları korunur. */
  varsayimlariSifirla(): void {
    for (const harita of [this.taslaklar, this.hatalar]) {
      for (const anahtar of [...harita.keys()]) if (!KORUNAN_IHYA_ALANLARI.has(anahtar)) harita.delete(anahtar);
    }
    const onceki = this.ihyaGirdileri;
    this.varsayim = null;
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

  /** Varsayımlar yoksa planlayıcıdan alır (hata atabilir); ihya süresi varsayımdaki karşılaştırma süresiyle başlar. */
  private varsayimlariAl(): Varsayimlar {
    if (this.varsayim) return this.varsayim;
    const varsayim = this.planlayici.varsayilanVarsayimlar();
    this.varsayim = varsayim;
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
        const ihyaVarsayim = g.sureYil === v.karsilastirmaSuresiYil ? v : { ...v, karsilastirmaSuresiYil: g.sureYil };
        return {
          ihya: this.planlayici.yolKarsilastir({ ...secim, ihya: true }, { ...secim, ihya: false }, ihyaVarsayim, { a: g.ihyaliTl, b: g.ihyasizTl }),
          ihyaVarsayim,
        };
      });
      return { tur: 'hazir', hesaplar: { karsilastirma, etkiler, bilesimler, oneri, ihya, ihyaVarsayim } };
    } catch (hata) {
      return { tur: 'hata', neden: hataMetni(hata) };
    }
  }

  private olustur(): EmeklilikEkrani {
    return this.sunucu.sun({
      secim: this.secim,
      varsayim: this.varsayim,
      hesap: this.hesapla(),
      taslaklar: this.taslaklar,
      hatalar: this.hatalar,
      ihyaGirdileri: this.ihyaGirdileri,
      bugun: istanbulGunu.format(this.bugun()),
    });
  }

  private yenile(): void {
    this.anlik = this.olustur();
    for (const dinleyici of [...this.dinleyiciler]) dinleyici();
  }
}
