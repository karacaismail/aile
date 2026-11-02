// TASLAK — sahibi em-data görevi. Dışa aktarılan adlar sabittir; gövde gerçek kaynakla değişecek.
import type { EmeklilikProfilKaynagi, ProfilDurumu } from '../contract';

export function profilKaynagiOlustur(): EmeklilikProfilKaynagi {
  let durum: ProfilDurumu = { tur: 'yok', neden: 'Profil kaynağı henüz uygulanmadı (taslak).' };
  return {
    durum: () => durum,
    subscribe: () => () => {},
    yenile: async () => {},
    dosyadanYukle: async () => { durum = { tur: 'hata', neden: 'Taslak' }; },
    temizle: () => {},
  };
}

export const varsayilanProfilKaynagi: EmeklilikProfilKaynagi = profilKaynagiOlustur();
