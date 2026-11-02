// Emeklilik profil deposu (repository): profil yalnız bu nesnenin belleğinde durur. Kalıcı depolama yoktur (hiçbir
// tarayıcı depolama ya da önbellek API'si kullanılmaz; kaynak kapısı profilKaynagi.test.ts); sekme kapanınca ya da
// temizle() ile profil gider.
//
// Durum geçişleri (ProfilDurumu):
//   başlangıç ─ varsayılan yükleyicinin başlangıcı ('yukleniyor' dev, 'yok' üretim) ya da verilmişse sentetik profil.
//   ilk abonelik ─ yükleyici istek yapıyorsa ve henüz hiçbir işlem başlamadıysa yenile() kendiliğinden çağrılır.
//   yenile() ─ 'yukleniyor' → yükleyicinin sonucu. Yükleyici istek yapmıyorsa (üretim) durum değişmez.
//   dosyadanYukle() ─ 'yukleniyor' → 'hazir' (kaynak 'dosya') ya da 'hata'.
//   temizle() ─ 'yok'.
// En son başlayan işlem kazanır: yeni işlem uçuştaki isteği iptal eder; geç gelen yanıt durumu değiştirmez.
// Yöntemler sınıf alanıdır (bağlı): useSyncExternalStore(kaynak.subscribe, kaynak.durum) doğrudan kullanılabilir.
import type { EmeklilikProfilKaynagi, ProfilDurumu } from '../contract';
import { profilDogrula, profilJsonDogrula } from './profilSemasi';
import type { ProfilYuklemeSonucu, VarsayilanProfilYukleyicisi } from './yukleyiciler';

/** İçe aktarılan profil dosyasının üst sınırı. Profil birkaç KB'dir; sınır yanlış dosyanın belleğe alınmasını önler. */
export const PROFIL_DOSYA_SINIRI_BAYT = 256 * 1024;

const YUKLENIYOR: ProfilDurumu = Object.freeze({ tur: 'yukleniyor' });

export interface BellekProfilKaynagiSecenekleri {
  /** Verilirse depo bu profille ('hazir', kaynak 'sentetik') başlar; doğrulanır, geçersizse 'hata'. Test ve önizleme içindir. */
  sentetikProfil?: unknown;
  /** İçe aktarılan dosya için üst sınır (bayt). */
  dosyaSiniriBayt?: number;
}

export class BellekProfilKaynagi implements EmeklilikProfilKaynagi {
  private mevcut: ProfilDurumu;
  private readonly dinleyiciler = new Set<() => void>();
  /** Son başlayan işlemin numarası; geç gelen sonuç numarası eşleşmiyorsa yok sayılır. */
  private islemNo = 0;
  private iptal: AbortController | null = null;
  /** Herhangi bir işlem (yenile, içe aktarma, temizleme) başladı mı; başladıysa abonelik kendiliğinden okumaz. */
  private basladi = false;
  private readonly dosyaSiniriBayt: number;

  constructor(private readonly yukleyici: VarsayilanProfilYukleyicisi, secenekler: BellekProfilKaynagiSecenekleri = {}) {
    this.dosyaSiniriBayt = secenekler.dosyaSiniriBayt ?? PROFIL_DOSYA_SINIRI_BAYT;
    if (secenekler.sentetikProfil === undefined) {
      this.mevcut = yukleyici.baslangicDurumu();
      return;
    }
    const sonuc = profilDogrula(secenekler.sentetikProfil);
    this.mevcut = sonuc.tamam ? { tur: 'hazir', profil: sonuc.profil, kaynak: 'sentetik' } : { tur: 'hata', neden: sonuc.neden };
    this.basladi = true;
  }

  readonly durum = (): ProfilDurumu => this.mevcut;

  readonly subscribe = (dinleyici: () => void): (() => void) => {
    this.dinleyiciler.add(dinleyici);
    if (!this.basladi && this.yukleyici.istekYapar) void this.yenile();
    return () => {
      this.dinleyiciler.delete(dinleyici);
    };
  };

  readonly yenile = async (): Promise<void> => {
    if (!this.yukleyici.istekYapar) return;
    const { no, signal } = this.yeniIslem();
    this.ayarla(YUKLENIYOR);
    let sonuc: ProfilYuklemeSonucu;
    try {
      sonuc = await this.yukleyici.yukle(signal);
    } catch {
      // Yükleyici sözleşmesi reddetmemektir; yine de bekleyen durum açıkta kalmaz.
      sonuc = { tur: 'hata', neden: 'Profil okunamadı: beklenmeyen hata.' };
    }
    this.bitir(no, sonuc);
  };

  readonly dosyadanYukle = async (dosya: File): Promise<void> => {
    const { no } = this.yeniIslem();
    if (dosya.size > this.dosyaSiniriBayt) {
      this.bitir(no, { tur: 'hata', neden: `Profil dosyası çok büyük (en çok ${Math.round(this.dosyaSiniriBayt / 1024)} KB).` });
      return;
    }
    this.ayarla(YUKLENIYOR);
    let metin: string;
    try {
      metin = await dosya.text();
    } catch {
      this.bitir(no, { tur: 'hata', neden: 'Profil dosyası okunamadı.' });
      return;
    }
    const sonuc = profilJsonDogrula(metin);
    this.bitir(no, sonuc.tamam ? { tur: 'hazir', profil: sonuc.profil, kaynak: 'dosya' } : { tur: 'hata', neden: sonuc.neden });
  };

  readonly temizle = (): void => {
    this.yeniIslem();
    this.iptal = null;
    this.ayarla({ tur: 'yok', neden: `Profil bellekten silindi. ${this.yukleyici.temizlendiIpucu}` });
  };

  /** Uçuştaki işlemi iptal eder ve yeni işlem numarası verir. */
  private yeniIslem(): { no: number; signal: AbortSignal } {
    this.basladi = true;
    this.iptal?.abort();
    const iptal = new AbortController();
    this.iptal = iptal;
    this.islemNo += 1;
    return { no: this.islemNo, signal: iptal.signal };
  }

  private bitir(no: number, sonuc: ProfilYuklemeSonucu): void {
    if (no !== this.islemNo) return;
    this.iptal = null;
    this.ayarla(sonuc);
  }

  private ayarla(durum: ProfilDurumu): void {
    // Aynı durum (ya da yükleniyor → yükleniyor) dinleyicileri boşuna uyandırmaz; anlık görüntü aynı nesne kalır.
    if (durum === this.mevcut || (durum.tur === 'yukleniyor' && this.mevcut.tur === 'yukleniyor')) return;
    this.mevcut = durum;
    for (const dinleyici of [...this.dinleyiciler]) dinleyici();
  }
}
