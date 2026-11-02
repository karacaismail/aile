import { useCallback, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { Adaptive, lazyWide, useProfile, useWideModule } from '../adaptive';
import type { EmeklilikPlanlayici, EmeklilikProfilKaynagi, EmeklilikProfili, MevzuatParametreleri, ProfilDurumu } from '../emeklilik/contract';
import { varsayilanProfilKaynagi } from '../emeklilik/data';
import { MEVZUAT_2026, emeklilikPlanlayicisiOlustur } from '../emeklilik/model';
import { EmeklilikPlaniViewModel } from '../emeklilik/viewmodel';
import { PageHeader } from '../shell/PageHeader';
import { currentAdminLink } from '../shell/navigation';
import { Button } from '../ui/Button';
import { ErrorState } from '../ui/ErrorState';
import { LoadingShell } from '../ui/LoadingShell';
import { EmeklilikTelefon } from './emeklilik/EmeklilikTelefon';
import { useEmeklilikEkrani, type EmeklilikSunumProps } from './emeklilik/parcalar';
import { BELLEK_NOTU, ProfilEylemleri, ProfilIceAktar, ProfilSatiri } from './emeklilik/profil';
import './EmeklilikPage.css';

// Emeklilik planı sayfası (#/emeklilik) — MVVM bileşim kökü. Belge: docs/EMEKLILIK-PLANI.md; sözleşme
// src/admin/emeklilik/contract.ts. Burada yalnız bağlama yapılır: profil kaynağı (data, repository) → planlayıcı (model,
// EmeklilikPlanlayici) → EmeklilikPlaniViewModel → görünüm (pages/emeklilik/*). Görünüm hesap yapmaz; ViewModel'in
// değişmez anlık görüntüsünü çizer ve komutlarını çağırır. Testler kaynak ve planlayıcıyı enjekte eder (sahte sınıflar).
// Profil durumları ayrı ve adıyla: yükleniyor (iskelet), yok (dosya içe aktar; yalnız bellekte), hata (ErrorState +
// yeniden dene + içe aktar), hazır; kayıt 30 günden eskiyse "Eski veri". Profili depo okur (geliştirmede ilk abonelikte);
// sayfa ayrıca yenilemez, profil bir kez istenir. Hesap hatası (planlayıcı kurulamaz ya da hata atar) adıyla gösterilir;
// sayfa çökmez, tutar gösterilmez. Hazır sayfada hesap hatası tek sabit ağaçta çizilir: ErrorState üstte, sunum (Adaptive)
// yerinde kalır; seçimler ve form yeniden kurulmaz (açık bölüm ve odak korunur). Eylem "Varsayımları sıfırla"dır.
// Uyarlamalı teslim (W0): telefon temel sunumu yerel HTML (EmeklilikTelefon); tablet/masaüstü iki sütunlu geniş sunum
// pages/emeklilik/EmeklilikGenis.wide.tsx lazyWide ile, telefonda indirilmez. Geniş modül beklenirken kök aria-busy taşır.
// Kişisel profil Git'e ve dist'e girmez: geliştirmede kaynak Git dışı dosyayı okur, üretimde kullanıcı dosya içe aktarır.

const YOL = '/emeklilik';
// Bölüm, başlık ve amaç tek kaynaktan: shell/navigation.ts (menü = h1 = belge başlığı; amaç cümlesi orada).
const GEZINME = currentAdminLink('/emeklilik');
export const BOLUM = GEZINME.section;
export const BASLIK = GEZINME.label;
export const AMAC = GEZINME.purpose;

const EmeklilikGenis = lazyWide<EmeklilikSunumProps>('emeklilik-genis', () => import('./emeklilik/EmeklilikGenis.wide'));

export interface EmeklilikPageProps {
  /** Hash yolu (rota verir). */
  location?: string;
  /** Profil deposu; varsayılan data/varsayilanProfilKaynagi. Testler bellek kaynağı verir. */
  profilKaynagi?: EmeklilikProfilKaynagi;
  /** Planlayıcı fabrikası; varsayılan model/emeklilikPlanlayicisiOlustur. Testler sahte planlayıcı verir. */
  planlayiciOlustur?: (profil: EmeklilikProfili) => EmeklilikPlanlayici;
  /** Doğrulama sınırları (borç kesintisi tavanı); varsayılan model/MEVZUAT_2026. */
  mevzuat?: Pick<MevzuatParametreleri, 'borcKesintiTavani'>;
  /** "Bugün" (profil tazeliği); test belirlenimciliği için. */
  bugun?: () => Date;
}

const varsayilanPlanlayici = (profil: EmeklilikProfili) => emeklilikPlanlayicisiOlustur(profil, MEVZUAT_2026);
const yut = () => {};

function hataMetni(hata: unknown): string {
  const ileti = hata instanceof Error ? hata.message.trim() : '';
  return ileti ? `Hesap yapılamadı: ${ileti}` : 'Hesap yapılamadı';
}

function Baslik({ location, children }: { location: string; children?: ReactNode }) {
  return <PageHeader location={location} section={BOLUM} title={BASLIK} purpose={AMAC}>{children}</PageHeader>;
}

type Kurulum = { tur: 'hazir'; vm: EmeklilikPlaniViewModel } | { tur: 'hata'; neden: string };

export function EmeklilikPage({
  location = YOL,
  profilKaynagi = varsayilanProfilKaynagi,
  planlayiciOlustur = varsayilanPlanlayici,
  mevzuat = MEVZUAT_2026,
  bugun,
}: EmeklilikPageProps) {
  const abone = useCallback((dinleyici: () => void) => profilKaynagi.subscribe(dinleyici), [profilKaynagi]);
  const oku = useCallback(() => profilKaynagi.durum(), [profilKaynagi]);
  const durum: ProfilDurumu = useSyncExternalStore(abone, oku, oku);

  const dosyadanYukle = useCallback((dosya: File) => { profilKaynagi.dosyadanYukle(dosya).catch(yut); }, [profilKaynagi]);
  const profil = durum.tur === 'hazir' ? durum.profil : null;
  const kurulum = useMemo<Kurulum | null>(() => {
    if (!profil) return null;
    try {
      return { tur: 'hazir', vm: new EmeklilikPlaniViewModel(planlayiciOlustur(profil), profil, { mevzuat, bugun }) };
    } catch (hata) {
      return { tur: 'hata', neden: hataMetni(hata) };
    }
  }, [profil, planlayiciOlustur, mevzuat, bugun]);

  if (durum.tur === 'yukleniyor') {
    return (
      <div className="aile-emeklilik">
        <Baslik location={location} />
        <LoadingShell rows={4} narrow label="Profil okunuyor" />
      </div>
    );
  }

  if (durum.tur === 'yok' || durum.tur === 'hata') {
    return (
      <div className="aile-emeklilik">
        <Baslik location={location} />
        {durum.tur === 'yok' ? (
          <section className="aile-em-bos" aria-labelledby="aile-em-bos-baslik">
            <h2 id="aile-em-bos-baslik" className="aile-em-bolum__baslik">Profil yok</h2>
            <p>{durum.neden}</p>
            <p className="aile-ikincil">Emeklilik profili (JSON) seçin; gün, kazanç ve borç bilgileri hesap için yalnız bu sekmede okunur.</p>
            <ProfilIceAktar onDosya={dosyadanYukle} />
          </section>
        ) : (
          <>
            <ErrorState title="Profil okunamadı" message={durum.neden} detail={BELLEK_NOTU} onRetry={() => { profilKaynagi.yenile().catch(yut); }} />
            <ProfilIceAktar onDosya={dosyadanYukle} />
          </>
        )}
      </div>
    );
  }

  if (!kurulum || kurulum.tur === 'hata') {
    return (
      <div className="aile-emeklilik">
        <Baslik location={location} />
        <ErrorState title={kurulum?.neden ?? 'Hesap yapılamadı'} message="Tutarlar, yanıltmaması için gösterilmiyor." />
      </div>
    );
  }

  return (
    <HazirSayfa
      location={location}
      vm={kurulum.vm}
      kaynak={durum.kaynak}
      onDosya={dosyadanYukle}
      onKaldir={() => profilKaynagi.temizle()}
    />
  );
}

function HazirSayfa({ location, vm, kaynak, onDosya, onKaldir }: {
  location: string;
  vm: EmeklilikPlaniViewModel;
  kaynak: 'gelistirme' | 'dosya' | 'sentetik';
  onDosya(dosya: File): void;
  onKaldir(): void;
}) {
  const ekran = useEmeklilikEkrani(vm);
  const profile = useProfile();
  // Geniş modül sayfa açılır açılmaz paralel istenir; telefon hiç istemez. Beklenirken kök meşguldür (hazır sinyali).
  const genis = useWideModule(EmeklilikGenis.resource, profile !== 'phone');
  const genisBekleniyor = profile !== 'phone' && (genis.status === 'idle' || genis.status === 'loading');
  const eylemler = <ProfilEylemleri kaynak={kaynak} onKaldir={onKaldir} onDosya={onDosya} />;
  const baslik = (
    <Baslik location={location}>
      <ProfilSatiri profil={ekran.profil} kaynak={kaynak} />
    </Baslik>
  );

  // Tek sabit ağaç: hesap hatası yalnız üstte ErrorState ekler; sunum (seçimler, form) aynı yerde kalır, tutarlı bölümler
  // (öneri, sonuç, paylar, bileşimler) anlık görüntüde yoktur. "Yeniden dene" yok: hesap girdiye bağlıdır, eylem
  // varsayımları sıfırlamaktır ve adı budur.
  const hata = ekran.hesap.durum === 'hata' ? (
    <div className="aile-em-hata">
      <ErrorState
        title={ekran.hesap.neden ?? 'Hesap yapılamadı'}
        message="Tutarlar, yanıltmaması için gösterilmiyor. Hatalı varsayımı düzeltin ya da varsayımları sıfırlayın."
      />
      <div className="aile-em-hata__eylem">
        <Button variant="primary" onClick={() => vm.varsayimlariSifirla()}>Varsayımları sıfırla</Button>
      </div>
    </div>
  ) : null;

  return (
    <div className="aile-emeklilik" aria-busy={genisBekleniyor || undefined}>
      {baslik}
      {hata}
      <Adaptive phone={<EmeklilikTelefon ekran={ekran} komutlar={vm} />} wide={<EmeklilikGenis ekran={ekran} komutlar={vm} />} />
      {eylemler}
    </div>
  );
}
