// TASLAK — sahibi em-model görevi. Dışa aktarılan adlar sabittir; gövde gerçek modelle değişecek.
import type { EmeklilikPlanlayici, EmeklilikProfili, MevzuatParametreleri } from '../contract';

export const MEVZUAT_2026: MevzuatParametreleri = {
  yil: 2026,
  asgariUcretBrutTl: '33030.00',
  gunlukKazancAltSiniriTl: '1101.00',
  borclanmaOrani: 0.45,
  enDusukAylikTl: '23552.00',
  borcKesintiOrani: 0.1,
  borcKesintiTavani: 0.25,
  kaynaklar: ['TASLAK'],
};

export function emeklilikPlanlayicisiOlustur(_profil: EmeklilikProfili, _mevzuat: MevzuatParametreleri = MEVZUAT_2026): EmeklilikPlanlayici {
  throw new Error('Emeklilik modeli henüz uygulanmadı (taslak).');
}
