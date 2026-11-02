// Varsayılan profil kaynağı stratejileri. Depo (BellekProfilKaynagi) hangi ortamda olduğunu bilmez; varsayılan kaynağı
// bu arayüzle alır (bağımlılık enjeksiyonu):
//   - GelistirmeSunucusuYukleyicisi: Vite dev ara katmanı /__aile/emeklilik/profil.json (src/admin/devServer/privateData.ts,
//     AILE_EMEKLILIK_PROFILE). İlk abonelikte kendiliğinden okunur.
//   - VarsayilanKaynakYok: üretim (GitHub Pages). Dev yolu orada yoktur ve kişisel profil sunucuda bulunmaz; hiçbir ağ
//     isteği yapılmaz, kullanıcı profil dosyasını içe aktarır.
import type { ProfilDurumu } from '../contract';
import { profilJsonDogrula } from './profilSemasi';

/** Dev ara katmanının profil yolu (privateData.ts EMEKLILIK_PROFILE_PATH ile aynı; privateData.test.ts eşitliği denetler). */
export const EMEKLILIK_PROFIL_ADRESI = '/__aile/emeklilik/profil.json';

/** Yükleme sonucu: 'yukleniyor' dışındaki her durum. */
export type ProfilYuklemeSonucu = Exclude<ProfilDurumu, { tur: 'yukleniyor' }>;

export type FetchBenzeri = (input: string, init?: RequestInit) => Promise<Response>;

/** Ortama göre varsayılan profil kaynağı (strateji). */
export interface VarsayilanProfilYukleyicisi {
  /** Depo ilk abonelikte bu kaynaktan kendiliğinden okusun mu. false ise yenile() de ağa çıkmaz. */
  readonly istekYapar: boolean;
  /** Depo oluşturulduğundaki durum. */
  baslangicDurumu(): ProfilDurumu;
  /** temizle() sonrası 'yok' nedenine eklenen yönlendirme. */
  readonly temizlendiIpucu: string;
  /** Varsayılan kaynaktan okur; hiçbir zaman reddetmez, sonucu durum olarak verir. */
  yukle(signal: AbortSignal): Promise<ProfilYuklemeSonucu>;
}

const TANIMSIZ_NEDENI = 'AILE_EMEKLILIK_PROFILE tanımlı değil';
const AZAMI_SUNUCU_NEDENI = 200;

/** Sunucunun açıklayıcı gövdesi ({ error: '…' }); JSON değilse null. Ara katman yanıtları yol ya da değer taşımaz. */
async function sunucuNedeni(yanit: Response): Promise<string | null> {
  try {
    const govde = JSON.parse(await yanit.text()) as unknown;
    const hata = govde !== null && typeof govde === 'object' ? (govde as { error?: unknown }).error : undefined;
    return typeof hata === 'string' && hata.trim() ? hata.trim().slice(0, AZAMI_SUNUCU_NEDENI) : null;
  } catch {
    return null;
  }
}

export class GelistirmeSunucusuYukleyicisi implements VarsayilanProfilYukleyicisi {
  readonly istekYapar = true;
  readonly temizlendiIpucu = 'Yenileyin ya da profil dosyasını içe aktarın.';
  private readonly adres: string;
  private readonly fetchImpl: FetchBenzeri | undefined;

  /** fetch verilmezse çağrı anındaki global fetch kullanılır (testte stub'lanabilir). */
  constructor(fetchImpl?: FetchBenzeri, adres: string = EMEKLILIK_PROFIL_ADRESI) {
    this.fetchImpl = fetchImpl;
    this.adres = adres;
  }

  baslangicDurumu(): ProfilDurumu {
    return { tur: 'yukleniyor' };
  }

  async yukle(signal: AbortSignal): Promise<ProfilYuklemeSonucu> {
    const fetchImpl = this.fetchImpl ?? (typeof fetch === 'function' ? (fetch as FetchBenzeri) : undefined);
    if (!fetchImpl) return { tur: 'hata', neden: 'Bu ortamda fetch yok; geliştirme profili okunamaz.' };
    let yanit: Response;
    try {
      yanit = await fetchImpl(this.adres, {
        method: 'GET',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
        signal,
      });
    } catch {
      return { tur: 'hata', neden: 'Profil okunamadı: geliştirme sunucusuna ulaşılamadı.' };
    }
    if (yanit.status === 404) return { tur: 'yok', neden: (await sunucuNedeni(yanit)) ?? TANIMSIZ_NEDENI };
    if (!yanit.ok) {
      const neden = (await sunucuNedeni(yanit)) ?? yanit.statusText;
      return { tur: 'hata', neden: `Profil okunamadı (HTTP ${yanit.status})${neden ? `: ${neden}` : '.'}` };
    }
    let metin: string;
    try {
      metin = await yanit.text();
    } catch {
      return { tur: 'hata', neden: 'Profil okunamadı: yanıt gövdesi alınamadı.' };
    }
    const sonuc = profilJsonDogrula(metin);
    return sonuc.tamam ? { tur: 'hazir', profil: sonuc.profil, kaynak: 'gelistirme' } : { tur: 'hata', neden: sonuc.neden };
  }
}

export class VarsayilanKaynakYok implements VarsayilanProfilYukleyicisi {
  readonly istekYapar = false;
  readonly temizlendiIpucu = 'Profil dosyasını yeniden içe aktarın.';
  private readonly baslangic: ProfilYuklemeSonucu = {
    tur: 'yok',
    neden: 'Emeklilik profili yüklenmedi. Profil dosyasını içe aktarın; profil yalnız bu sekmenin belleğinde tutulur.',
  };

  baslangicDurumu(): ProfilDurumu {
    return this.baslangic;
  }

  async yukle(): Promise<ProfilYuklemeSonucu> {
    return this.baslangic;
  }
}
