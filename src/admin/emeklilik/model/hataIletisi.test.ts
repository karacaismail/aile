// Model hata iletileri kullanıcıya gösterilir ("Hesap yapılamadı: …", ErrorState başlığı): ileti alan adı ve kuralı
// söyler, girilen ya da profilden gelen değeri yankılamaz. Değer yalnız geliştirici için Error.cause'dadır.
// Değerler ayırt edici seçildi (987…): iletide geçmemeli, cause'da geçmeli.
import { describe, expect, it } from 'vitest';
import type { AylikModeliAdi, Secim, Varsayimlar } from '../contract';
import { Ay } from './Ay';
import { aylikModeliOlustur } from './AylikModeli';
import { MEVZUAT_2026, emeklilikPlanlayicisiOlustur } from './index';
import { Para } from './Para';
import { Tutar } from './Tutar';
import { sentetikProfil, sentetikVarsayimlar } from './testDestek';

const HIC: Secim = { askerlik: false, bagkur: false, ihya: false };
const ASKERLIK: Secim = { askerlik: true, bagkur: false, ihya: false };

function yakala(islem: () => unknown): Error {
  try {
    islem();
  } catch (hata) {
    return hata as Error;
  }
  throw new Error('Hata atılmadı');
}

const planla = (degistir: (v: Varsayimlar) => void, secim: Secim = HIC) =>
  () => emeklilikPlanlayicisiOlustur(sentetikProfil()).yol(secim, sentetikVarsayimlar(degistir));

const DURUMLAR: Array<[string, () => unknown, RegExp, RegExp]> = [
  ['geçersiz TL metni', () => Para.tlden('987x65'), /TL metni/, /987x65/],
  ['güvenli kuruş aralığı', () => Para.tlden('987654321987654321.00'), /güvenli/, /987654321987654321/],
  ['ters aralık', () => Tutar.bilgiden({ tur: 'aralik', altTl: '987654.00', ustTl: '123.00', kaynak: 'x' }), /alt ucu/, /987654\.00/],
  ['geçersiz ay', () => Ay.metinden('9876-99'), /ay/i, /9876-99/],
  ['asgari yaş', () => emeklilikPlanlayicisiOlustur(sentetikProfil((p) => { p.asgariYas = 987; })).yol(HIC, sentetikVarsayimlar()), /Asgari yaş/, /987/],
  ['kesinti oranı', planla((v) => { v.borcKesintiOrani = 0.987; }), /Borç kesinti oranı/, /0\.987/],
  ['karşılaştırma süresi', planla((v) => { v.karsilastirmaSuresiYil = 987; }), /Karşılaştırma süresi/, /987/],
  ['ayda gün', planla((v) => { v.gelecekAyBasinaGun = 987; }), /ay başına gün/, /987/],
  ['gecikme oranı', planla((v) => { v.bagkurGecikmeAylikOran = 9.87; }), /Gecikme oranı/, /9\.87/],
  ['negatif diğer kesinti', planla((v) => { v.digerKesintilerTl = '-987654.00'; }), /Diğer kesintiler/, /987654/],
  ['çok büyük diğer kesinti', planla((v) => { v.digerKesintilerTl = '987654321987654321.00'; }), /Diğer kesintiler/, /987654321987654321/],
  ['askerlik günü', planla((v) => { v.secenekGirdileri.askerlik.gun = 98765; }, ASKERLIK), /Askerlik/, /98765/],
  ['negatif günlük bedel', planla((v) => { v.secenekGirdileri.askerlik.gunlukBedelTl = '-987.65'; }, ASKERLIK), /günlük bedel/, /987\.65/],
  ['negatif elle aylık', planla((v) => { v.aylikModeli = 'elle'; v.elleAylikTl = '-987654.00'; }), /Elle aylık/, /987654/],
  ['bilinmeyen aylık modeli', () => aylikModeliOlustur('model987' as AylikModeliAdi, sentetikProfil(), MEVZUAT_2026, null), /aylık modeli/, /model987/],
];

describe('Model hata iletileri: değer yankılanmaz, ayrıntı Error.cause’da', () => {
  it.each(DURUMLAR)('%s', (_ad, islem, kural, deger) => {
    const hata = yakala(islem);
    expect(hata).toBeInstanceOf(RangeError);
    expect(hata.message).toMatch(kural);
    expect(hata.message).not.toMatch(deger);
    expect(hata.message).not.toMatch(/\d{4,}/);
    expect(JSON.stringify(hata.cause, (_k, v) => (v instanceof Error ? { message: v.message, cause: v.cause } : v))).toMatch(deger);
  });
});
