// Emeklilik planı — model katmanı (saf alan sınıfları; React ve DOM yok). Tek giriş noktası
// emeklilikPlanlayicisiOlustur: sözleşmedeki EmeklilikPlanlayici arayüzünü uygular.
import type { EmeklilikPlanlayici, EmeklilikProfili, MevzuatParametreleri } from '../contract';
import { EmeklilikPlanlayiciImpl, type PlanlayiciBagimliliklari } from './EmeklilikPlanlayici';
import { MEVZUAT_2026 } from './mevzuat';

export { MEVZUAT_2026 } from './mevzuat';
export { Para } from './Para';
export { Ay, TakvimGunu } from './Ay';
export { Tutar, TutarIslemleri } from './Tutar';
export {
  HizmetSecenegi,
  GunlukBedelliSecenek,
  AskerlikBorclanmasi,
  BagkurBorcOdemesi,
  Ihya,
  SECENEK_ADLARI,
  DONEM_ACIKLAMASI,
  type HizmetDonemi,
} from './HizmetSecenegi';
export {
  SgkReferansAylikModeli,
  KazancTahminiAylikModeli,
  ElleAylikModeli,
  aylikModeliOlustur,
  type AylikModeli,
  type AylikGirdisi,
} from './AylikModeli';
export { HizmetTakvimi } from './HizmetTakvimi';
export { EmeklilikTarihiHesabi, type TarihSonucu } from './EmeklilikTarihiHesabi';
export { KesintiPlani, type KesintiGirdisi, type KesintiOzeti } from './KesintiPlani';
export { YolHesabi, type YolSonucuAyrintili } from './Yol';
export {
  YolKarsilastirici,
  type KarsilastirilabilirYol,
  type KarsilastirmaKosullari,
  type KarsilastirmaAyrintisi,
} from './YolKarsilastirici';
export {
  EmeklilikPlanlayiciImpl,
  HICBIRI,
  VARSAYILAN_KARSILASTIRMA_YILI,
  bilesimAdi,
  type PlanlayiciBagimliliklari,
} from './EmeklilikPlanlayici';
export { tamSayi, yuzde, nedenleriBirlestir } from './bicim';

/** Profil + mevzuattan planlayıcı kurar. Bağımlılıklar (seçenekler, takvim, aylık modeli fabrikası) değiştirilebilir. */
export function emeklilikPlanlayicisiOlustur(
  profil: EmeklilikProfili,
  mevzuat: MevzuatParametreleri = MEVZUAT_2026,
  bagimliliklar: Partial<PlanlayiciBagimliliklari> = {},
): EmeklilikPlanlayici {
  return new EmeklilikPlanlayiciImpl(profil, mevzuat, bagimliliklar);
}
