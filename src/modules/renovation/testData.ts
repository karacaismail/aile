// Sentetik test verisi (aileye özgü hiçbir bilgi yok; tarihler 2099).
import type { Item, Setting } from '@shared/schema';
import type { ReadFull } from '@shared/api';

export const MILESTONES: Item[] = [
  { id: 'mA', tip: 'kilometre', ad: 'Anahtar teslim', senaryo: 'A', kilometre_tur: 'tarih', planlanan_tarih: '2099-01-20' },
  { id: 'mB', tip: 'kilometre', ad: 'Anahtar teslim (B)', senaryo: 'B', kilometre_tur: 'tarih', planlanan_tarih: '2099-02-01' },
  { id: 'mH', tip: 'kilometre', ad: 'Mobilya siparişi', senaryo: 'hepsi', kilometre_tur: 'siparis', planlanan_tarih: '2099-01-05', not: 'Sipariş notu' },
  { id: 'mN', tip: 'kilometre', ad: 'Hedef bitiş', kilometre_tur: 'hedef', planlanan_tarih: '2099-03-01' },
];

export const TASKS: Item[] = [
  { id: 't1', tip: 'tadilat', kod: 'T1', ad: 'Elektrik altyapı', is_kim: ['elektrikci'], planlanan_tarih: '2099-01-15', sure_gun: 3, durum: 'fikir', izin_gerekli: true, izin_durumu: 'istenecek', sartname: 'Kablo 2,5 mm', not: 'İş notu' },
  { id: 't2', tip: 'tadilat', kod: 'T2', ad: 'Boya', is_kim: ['boyaci', 'ben'], bagimlilik: ['T1'], durum: 'siparis', planlanan_tarih: '2099-01-25' },
  { id: 't3', tip: 'tadilat', kod: 'T10', ad: 'Mutfak dolabı', is_kim: ['marangoz'], durum: 'teslim' },
];

export const VENDORS: Item[] = [
  { id: 'u1', tip: 'usta', ad: 'Usta Bir', meslek: 'elektrik', telefon: '0532 111 22 33', myk_no: 'MYK-001', myk_dogrulandi: true, teklif_tl: 12000, teklif_sure_gun: 4, garanti_ay: 12, uyum_pct: 80 },
  { id: 'u2', tip: 'usta', ad: 'Usta İki', meslek: 'boya', telefon: '0533 444 55 66', myk_dogrulandi: false },
];

export const CHECKS: Item[] = [
  { id: 'k1', tip: 'kontrol', kontrol_tur: 'sartname', meslek: 'elektrik', ad: 'Topraklama direnci', esik: '< 4', olcum_birim: 'ohm', tamam: true },
  { id: 'k2', tip: 'kontrol', kontrol_tur: 'sartname', meslek: 'elektrik', ad: 'Kaçak akım rölesi' },
  { id: 'k3', tip: 'kontrol', kontrol_tur: 'sartname', meslek: 'boya', ad: 'Astar iki kat' },
  { id: 'k4', tip: 'kontrol', kontrol_tur: 'kabul', meslek: 'elektrik', ad: 'Priz gerilimi', esik: '220', olcum_birim: 'V' },
  { id: 'k5', tip: 'kontrol', kontrol_tur: 'izin', ad: 'Ev sahibi yazılı onayı' },
  { id: 'k6', tip: 'kontrol', kontrol_tur: 'ev_secimi', ad: 'Sigorta panosu kapasitesi' },
];

export const SETTINGS: Setting[] = [
  { id: 's-tasinma', tip: 'tarih', anahtar: 'tasinma', deger: '2099-02-19' },
  { id: 's-senaryo', tip: 'ayar', anahtar: 'senaryo', deger: 'A' },
];

export function readFull(over: Partial<ReadFull> = {}): ReadFull {
  return { ok: true, fingerprint: 'f', serverTime: 't', schemaVersion: 1, items: [...MILESTONES, ...TASKS, ...VENDORS, ...CHECKS], settings: SETTINGS, ...over };
}
