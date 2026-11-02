// Emeklilik planı veri katmanı: profil deposu (repository) ve şema doğrulaması. Dışa aktarılan adlar
// profilKaynagiOlustur ve varsayilanProfilKaynagi sabittir (ViewModel ve sayfa bunlara bağlıdır).
//
// Gizlilik: kişisel profil (doğum tarihi, gün sayıları, kazanç, borç) Git'e ve dist'e girmez.
//   - Geliştirme: Vite dev ara katmanı profili yalnız AILE_EMEKLILIK_PROFILE ortam değişkeninin gösterdiği Git dışı
//     dosyadan, /__aile/emeklilik/profil.json yolundan salt okunur verir (src/admin/devServer/privateData.ts).
//   - Üretim (import.meta.env.PROD): varsayılan kaynak yoktur, hiçbir ağ isteği yapılmaz; kullanıcı profil dosyasını
//     içe aktarır ve profil yalnız bellekte tutulur.
//   - Testler fixtures/emeklilik/profil-sentetik.json kullanır.
import type { EmeklilikProfilKaynagi } from '../contract';
import { BellekProfilKaynagi } from './BellekProfilKaynagi';
import { GelistirmeSunucusuYukleyicisi, VarsayilanKaynakYok, type FetchBenzeri, type VarsayilanProfilYukleyicisi } from './yukleyiciler';

export { BellekProfilKaynagi, PROFIL_DOSYA_SINIRI_BAYT, type BellekProfilKaynagiSecenekleri } from './BellekProfilKaynagi';
export { EmeklilikProfiliSemasi, JSON_DEGIL_NEDENI, profilDogrula, profilJsonDogrula, type ProfilDogrulamaSonucu } from './profilSemasi';
export {
  EMEKLILIK_PROFIL_ADRESI, GelistirmeSunucusuYukleyicisi, VarsayilanKaynakYok,
  type FetchBenzeri, type ProfilYuklemeSonucu, type VarsayilanProfilYukleyicisi,
} from './yukleyiciler';

/** 'gelistirme': dev ara katmanından okur. 'uretim': varsayılan istek yok, yalnız dosya içe aktarma. */
export type ProfilKaynagiModu = 'gelistirme' | 'uretim';

export interface ProfilKaynagiSecenekleri {
  /** Verilmezse derleme ortamından: import.meta.env.PROD → 'uretim'. */
  mod?: ProfilKaynagiModu;
  /** Geliştirme isteği için fetch (test). Verilmezse çağrı anındaki global fetch. */
  fetch?: FetchBenzeri;
  /** Verilirse depo bu profille başlar (kaynak 'sentetik'); test ve önizleme içindir, profil doğrulanır. */
  sentetikProfil?: unknown;
}

/** Varsayılan modu belirleyen derleme ortamı (import.meta.env alt kümesi; anahtar tek tek okunur). */
export function varsayilanMod(env: { PROD?: boolean } = { PROD: import.meta.env.PROD }): ProfilKaynagiModu {
  return env.PROD === true ? 'uretim' : 'gelistirme';
}

/** Moda göre varsayılan kaynak stratejisini kurar ve bellek deposuna enjekte eder. */
export function profilKaynagiOlustur(secenekler: ProfilKaynagiSecenekleri = {}): EmeklilikProfilKaynagi {
  const mod = secenekler.mod ?? varsayilanMod();
  const yukleyici: VarsayilanProfilYukleyicisi = mod === 'uretim' ? new VarsayilanKaynakYok() : new GelistirmeSunucusuYukleyicisi(secenekler.fetch);
  return new BellekProfilKaynagi(yukleyici, { sentetikProfil: secenekler.sentetikProfil });
}

/** Uygulamanın tek profil deposu. Oluşturulurken ağ isteği yapmaz; geliştirmede ilk abonelikte okur. */
export const varsayilanProfilKaynagi: EmeklilikProfilKaynagi = profilKaynagiOlustur();
