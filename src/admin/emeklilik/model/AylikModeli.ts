// Aylık modeli stratejileri. Her model aylığı tek değer olarak verir ve kaynağında adını/dayanağını yazar;
// ölçülmemiş ±% aralık üretilmez. Planlayıcı modeli ada göre seçer (aylikModeliOlustur).
import type { AylikModeliAdi, EmeklilikProfili, MevzuatParametreleri, TlMetni, TutarBilgisi } from '../contract';
import { TakvimGunu } from './Ay';
import type { HizmetDonemi } from './HizmetSecenegi';
import { Para } from './Para';
import { tamSayi } from './bicim';

/** Bir yolun emeklilik ayındaki gün dökümü (kayıtlı günler modelin kendi profilinden okunur). */
export interface AylikGirdisi {
  /** Kayıtlı aydan sonra emeklilik ayı sonuna kadar planlanan SSK günü. */
  calismaGunu: number;
  /** Uygulanan kayıt düzeltmesi (gün; uygulanmıyorsa 0). */
  duzeltmeGunu: number;
  /** Seçili hizmet seçeneklerinin günleri, dönemleri ve asgari ücrete göre katları. */
  secenekler: ReadonlyArray<{ donem: HizmetDonemi; gun: number; kat: number }>;
}

export interface AylikModeli {
  readonly ad: AylikModeliAdi;
  readonly etiket: string;
  /** girdi null: emeklilik ayı hesaplanamadı (gün dökümü yok). */
  aylik(girdi: AylikGirdisi | null): TutarBilgisi;
}

/** SGK'nın tarihli aylık hesabı; bütün yollarda aynı kalır (yollar arası aylık farkı göstermez). */
export class SgkReferansAylikModeli implements AylikModeli {
  readonly ad = 'sgkReferans' as const;
  readonly etiket = 'SGK referansı (sabit)';
  private readonly sonuc: TutarBilgisi;

  constructor(profil: EmeklilikProfili) {
    const ref = profil.sgkReferansAylik;
    const tutar = Para.tlden(ref.tl);
    const ek = ref.ekOdemeTl === null ? '' : `; içinde ek ödeme ${Para.tlden(ref.ekOdemeTl).goster()}`;
    this.sonuc = {
      tur: 'bilinen',
      tl: tutar.tlMetni(),
      kaynak: `SGK referansı: ${TakvimGunu.metinden(ref.tarih).adi()} tarihli hesap, ${tamSayi(ref.gun)} gün ile${ek}; tüm yollarda sabit`,
    };
  }

  aylik(_girdi: AylikGirdisi | null): TutarBilgisi {
    return this.sonuc;
  }
}

/** 2000–2008 dönemi aylık bağlama oranı (sade araçtaki yaklaşım): ilk 10 yıl %3,5/yıl, sonrası %2/yıl. */
function eskiDonemOrani(gun: number): number {
  const yil = gun / 360;
  return Math.min(10, yil) * 0.035 + Math.max(0, yil - 10) * 0.02;
}

/**
 * Kazanç tahmini (sade karar aracındaki 2008 öncesi/sonrası formülü). Kalibrasyon yalnız SGK referansının
 * hesaplandığı kayıtlı günlerle yapılır; planlanan (henüz kayıtta olmayan) günler kalibrasyona karışmaz.
 * Yeni dönem kısmı: toplam gün/360 × %2 × (kat toplamı / gün) × asgari ücret. Kayıt sonrası SSK günleri son
 * prime esas kazancın asgari ücrete oranıyla, borçlanılan/ihya/Bağ-Kur günleri asgari düzeyden (kat 1) sayılır.
 * Eski dönem kısmı SGK referansından geri çözülür ve gün arttıkça eski dönem oranıyla ölçeklenir.
 * Sonuç en düşük aylıktan az olamaz. Bu bir tahmindir; resmi hesap aylık kazanç cetveli ister.
 */
export class KazancTahminiAylikModeli implements AylikModeli {
  readonly ad = 'kazancTahmini' as const;
  readonly etiket = 'Kazanç tahmini';

  constructor(private readonly profil: EmeklilikProfili, private readonly mevzuat: MevzuatParametreleri) {}

  private kalibrasyonEngeli(): string | null {
    const { kayitliGun, sgkReferansAylik } = this.profil;
    if (sgkReferansAylik.gun !== kayitliGun.gun) {
      return `SGK referansı ${tamSayi(sgkReferansAylik.gun)} gün ile hesaplanmış, kayıtlı gün ${tamSayi(kayitliGun.gun)}; kazanç tahmini yalnız kayıtlı günle kalibre edilir.`;
    }
    if (kayitliGun.once2008Gun + kayitliGun.sonra2008Gun !== kayitliGun.gun) {
      return '2008 öncesi ve sonrası kayıtlı günlerin toplamı kayıtlı güne eşit değil; kazanç tahmini kalibre edilemez.';
    }
    if (kayitliGun.once2008Gun <= 0 || kayitliGun.sonra2008Gun <= 0) {
      return 'Kazanç tahmini hem 2008 öncesi hem 2008 sonrası kayıtlı günü olan profil için kalibre edilir.';
    }
    if (!(this.profil.kazanc.once2008OrtalamaKat > 0)) return '2008 öncesi ortalama kat bilinmiyor.';
    return null;
  }

  aylik(girdi: AylikGirdisi | null): TutarBilgisi {
    if (girdi === null) return { tur: 'bilinmiyor', neden: 'Emeklilik ayı hesaplanamadığı için kazanç tahmini yapılamıyor.' };
    const engel = this.kalibrasyonEngeli();
    if (engel !== null) return { tur: 'bilinmiyor', neden: engel };

    const { kayitliGun, kazanc, sgkReferansAylik } = this.profil;
    const tl = (metin: TlMetni) => Para.tlden(metin).kurus / 100;
    const asgari = tl(this.mevzuat.asgariUcretBrutTl);
    const referans = tl(sgkReferansAylik.tl);
    const kayitli = kayitliGun.gun;
    const once = kayitliGun.once2008Gun;
    const sonra = kayitliGun.sonra2008Gun;
    const katToplam = kazanc.sonra2008KatToplam;
    const onceKat = kazanc.once2008OrtalamaKat;
    const gelecekKat = tl(kazanc.sonPekTl) / asgari;
    const yeniDonem = (toplamGun: number, gun: number, kat: number) => toplamGun / 360 * 0.02 * kat / gun * asgari;

    // Kalibrasyon (yalnız kayıtlı günler): referans × kayıtlı = eski × önce + yeni × sonra.
    const yeniSimdi = yeniDonem(kayitli, sonra, katToplam);
    const eskiSimdi = (referans - yeniSimdi * sonra / kayitli) / (once / kayitli);

    // Yolun günleri. Düzeltme yeni dönem günlerine, ortalama kat korunarak uygulanır.
    const sonraKayitli = sonra + girdi.duzeltmeGunu;
    const katKayitli = katToplam * sonraKayitli / sonra;
    let onceEkGun = 0;
    let onceEkKat = 0;
    let sonraEkGun = 0;
    let sonraEkKat = 0;
    for (const s of girdi.secenekler) {
      if (s.donem === 'once2008') { onceEkGun += s.gun; onceEkKat += s.gun * s.kat; } else { sonraEkGun += s.gun; sonraEkKat += s.gun * s.kat; }
    }
    const onceGun = once + onceEkGun;
    const sonraGun = sonraKayitli + sonraEkGun + girdi.calismaGunu;
    const toplam = onceGun + sonraGun;
    const eski = eskiSimdi * eskiDonemOrani(toplam) / eskiDonemOrani(kayitli) * (once * onceKat + onceEkKat) / (onceGun * onceKat);
    const yeni = yeniDonem(toplam, sonraGun, katKayitli + girdi.calismaGunu * gelecekKat + sonraEkKat);
    const hesap = Para.yaklasikTl((eski * onceGun + yeni * sonraGun) / toplam);
    const taban = Para.tlden(this.mevzuat.enDusukAylikTl);
    const tabanli = hesap.karsilastir(taban) < 0;
    const sonuc = tabanli ? taban : hesap;
    return {
      tur: 'bilinen',
      tl: sonuc.tlMetni(),
      kaynak: `Kazanç tahmini (tahmindir): SGK referansı ${Para.tlden(sgkReferansAylik.tl).goster()} ve ${tamSayi(kayitli)} kayıtlı günle kalibre; `
        + `${tamSayi(toplam)} gün (2008 öncesi ${tamSayi(onceGun)}, sonrası ${tamSayi(sonraGun)}); borçlanılan günler asgari düzeyden`
        + (tabanli ? `; en düşük aylık (${taban.goster()}) uygulandı` : ''),
    };
  }
}

/** Kullanıcının elle girdiği net aylık; bütün yollarda (ya da ihya karşılaştırmasında tek yolda) kullanılır. */
export class ElleAylikModeli implements AylikModeli {
  readonly ad = 'elle' as const;
  readonly etiket = 'Elle girilen aylık';
  private readonly tutar: Para | null;

  constructor(elleAylikTl: TlMetni | null) {
    this.tutar = elleAylikTl === null ? null : Para.tlden(elleAylikTl);
    if (this.tutar?.negatifMi()) throw new RangeError('Elle aylık negatif olamaz.');
  }

  aylik(_girdi: AylikGirdisi | null): TutarBilgisi {
    if (this.tutar === null) return { tur: 'bilinmiyor', neden: 'Elle aylık girilmedi.' };
    return { tur: 'bilinen', tl: this.tutar.tlMetni(), kaynak: 'Elle girilen net aylık' };
  }
}

export function aylikModeliOlustur(
  ad: AylikModeliAdi,
  profil: EmeklilikProfili,
  mevzuat: MevzuatParametreleri,
  elleAylikTl: TlMetni | null,
): AylikModeli {
  switch (ad) {
    case 'sgkReferans':
      return new SgkReferansAylikModeli(profil);
    case 'kazancTahmini':
      return new KazancTahminiAylikModeli(profil, mevzuat);
    case 'elle':
      return new ElleAylikModeli(elleAylikTl);
    default:
      throw new RangeError(`Bilinmeyen aylık modeli: ${String(ad)}`);
  }
}
