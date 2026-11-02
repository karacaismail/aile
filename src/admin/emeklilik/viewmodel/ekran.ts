import type { AylikModeliAdi, SecenekAnahtari } from '../contract';
import type { Ton } from './bicim';

// Ekran anlık görüntüsü (MVVM'de görünümün tek girdisi). Yalnız biçimlenmiş metin ve görünüm verisi taşır: tutar
// "₺208.089,00", ay "Aralık 2027", eksik bilgi "Bilinmiyor · <neden>". Model nesneleri (TutarBilgisi, Secim) ve işlev
// yoktur; görünüm hesap yapmaz, yalnız çizer ve ViewModel komutlarını çağırır. Nesneler derin dondurulmuştur.

export type { Ton } from './bicim';

export type AlanAnahtari =
  | 'askerlikGun' | 'askerlikGunlukBedel'
  | 'bagkurGun' | 'bagkurBorc' | 'bagkurOrtakOdeme' | 'bagkurGecikmeOrani'
  | 'ihyaGun' | 'ihyaGunlukBedel'
  | 'gelecekAyBasinaGun'
  | 'elleAylik' | 'borcKesintiOrani' | 'digerKesintiler' | 'karsilastirmaSuresi';
export type IhyaAlanAnahtari = 'ihyaAylikIhyali' | 'ihyaAylikIhyasiz' | 'ihyaSuresi';
export type BayrakAnahtari = 'gunDuzeltmesiUygula' | 'isUcretiDevam';
export type AlanGrubuAnahtari = 'gunVeTutar' | 'maasVeAylik';
/** İhya karşılaştırmasında iki yol: ihya eklenen (erken) ve ihyasız (bekleyen). */
export type IhyaYolu = 'ihyali' | 'ihyasiz';

/**
 * Etiket + değer (+ ikincil not) + ton; ton yalnız destekler, anlam metindedir. bicim 'tutar': değer biçimli tutardır
 * (tabular hizalı, bölünmez); 'metin': sözcüklü değer ("Bilinmiyor · …", "Kesinti yok"), satırda doğal sarılır.
 */
export interface Olcu {
  readonly etiket: string;
  readonly deger: string;
  readonly not: string | null;
  readonly ton: Ton;
  readonly bicim: 'tutar' | 'metin';
}

export interface SoruGorunumu {
  readonly anahtar: SecenekAnahtari;
  readonly soru: string;
  /** "360 gün · ₺178.200,00" (maliyet bilinmiyorsa adıyla). */
  readonly aciklama: string;
  readonly evet: boolean;
}

export interface OneriGorunumu {
  /** "Senaryo önerisi" ya da (mali sıralama yoksa) "En erken tarih senaryosu". */
  readonly etiket: string;
  readonly secimAdi: string;
  readonly gerekce: string;
  readonly saglamlik: string;
  readonly secili: boolean;
  readonly eylem: string;
  /** Eylem devre dışıysa yanında yazılan neden. */
  readonly devreDisiNedeni: string | null;
}

export interface OdemeKalemiGorunumu { readonly ad: string; readonly tutar: string }

export interface SonucGorunumu {
  readonly secimAdi: string;
  /** "Aralık 2027" ya da "Ulaşılamıyor". */
  readonly planlamaAyi: string;
  readonly yas: string;
  readonly sinirlayan: string;
  readonly erken: string;
  readonly calisarak: string;
  readonly odeme: Olcu;
  readonly odemeKalemleri: readonly OdemeKalemiGorunumu[];
  readonly aylik: Olcu;
  readonly kesinti: Olcu;
  readonly donemSonunda: Olcu;
  readonly gecYolEmekliOlunca: Olcu;
  readonly geriKazanma: Olcu;
  /** Seçili yol referansın kendisi (hiçbir şey ödememek). */
  readonly referansMi: boolean;
  readonly hesaplanamayanNeden: string | null;
  /** Canlı bölge için tek satır: "Aralık 2027 · 41 yaşında · 14 ay erken". */
  readonly duyuru: string;
}

export interface PayGorunumu {
  readonly anahtar: SecenekAnahtari;
  readonly ad: string;
  readonly durum: string;
  readonly erken: string;
  readonly ekOdeme: string;
  readonly donemSonunda: string;
  readonly ton: Ton;
}

export interface BilesimSatiri {
  /** "hicbiri", "askerlik", "askerlik+ihya", … (bilesimSec komutu için). */
  readonly anahtar: string;
  readonly secimAdi: string;
  readonly emeklilik: string;
  readonly yas: string;
  readonly erken: string;
  /** Kısa hücre değerleri (tutar ya da "Bilinmiyor"); bilinmiyorsa nedeni *Nedeni alanında. */
  readonly odeme: string;
  readonly odemeNedeni: string | null;
  readonly aylik: string;
  readonly aylikNedeni: string | null;
  /** Kısa hücre değeri: tutar, "Referans yol" ya da "Bilinmiyor" (neden donemNedeni'nde). */
  readonly donemSonunda: string;
  readonly donemNedeni: string | null;
  readonly donemTon: Ton;
  readonly geriKazanma: string;
  readonly secili: boolean;
}

export interface AlanGorunumu<K extends AlanAnahtari | IhyaAlanAnahtari = AlanAnahtari | IhyaAlanAnahtari> {
  readonly anahtar: K;
  readonly etiket: string;
  /** Kullanıcının yazdığı taslak; dokunulmamışsa değerden türetilir. */
  readonly metin: string;
  readonly yardim: string;
  /** "Hata: …" ya da null. */
  readonly hata: string | null;
  readonly girisModu: 'numeric' | 'decimal';
  readonly bicim: 'para' | 'metin';
  readonly sonek: string | null;
  readonly zorunlu: boolean;
}

export interface BayrakGorunumu {
  readonly anahtar: BayrakAnahtari;
  readonly etiket: string;
  readonly aciklama: string;
  readonly deger: boolean;
}

export interface FormGrubuGorunumu {
  readonly anahtar: AlanGrubuAnahtari;
  readonly baslik: string;
  readonly alanlar: readonly AlanGorunumu<AlanAnahtari>[];
  readonly bayraklar: readonly BayrakGorunumu[];
}

export interface AylikModeliSecenegi { readonly deger: AylikModeliAdi; readonly etiket: string; readonly aciklama: string }

export interface FormGorunumu {
  readonly gruplar: readonly FormGrubuGorunumu[];
  readonly aylikModeli: { readonly secili: AylikModeliAdi; readonly secenekler: readonly AylikModeliSecenegi[] };
  /** Hata varsa "N alanda hata var; …". */
  readonly hataOzeti: string | null;
}

export interface IhyaYolGorunumu { readonly secimAdi: string; readonly emeklilik: string; readonly aylik: string }

export interface IhyaGorunumu {
  readonly ihyali: IhyaYolGorunumu;
  readonly ihyasiz: IhyaYolGorunumu;
  readonly erken: string;
  readonly ekOdeme: Olcu;
  readonly gecYolEmekliOlunca: Olcu;
  readonly donemSonunda: Olcu;
  readonly geriKazanma: Olcu;
  readonly neden: string | null;
  readonly aylikIhyali: AlanGorunumu<IhyaAlanAnahtari>;
  readonly aylikIhyasiz: AlanGorunumu<IhyaAlanAnahtari>;
  readonly sure: AlanGorunumu<IhyaAlanAnahtari>;
}

export interface ProfilGorunumu {
  readonly etiket: string;
  readonly kayit: string;
  readonly kaynaklar: readonly string[];
  /** Kayıt 30 günden eskiyse "Eski veri: …" (gün ve tutarlar SGK kayıtlarıyla yenilenmeli). */
  readonly tazelik: { readonly durum: 'guncel' | 'eski'; readonly metin: string };
}

export interface EmeklilikEkrani {
  readonly hesap: { readonly durum: 'hazir' | 'hata'; readonly neden: string | null };
  readonly profil: ProfilGorunumu;
  readonly sorular: readonly SoruGorunumu[];
  readonly oneri: OneriGorunumu | null;
  readonly sonuc: SonucGorunumu | null;
  readonly paylar: readonly PayGorunumu[];
  readonly bilesimler: readonly BilesimSatiri[];
  /** Tablonun ortak notu: aylık modeli ve ortak dönem. */
  readonly bilesimNotu: string;
  readonly form: FormGorunumu | null;
  readonly ihya: IhyaGorunumu;
}
