// ViewModel + gerçek model (bütünleşik): Bağ-Kur borcunun kaynağı önerinin adını ve ortak dönem farkını değiştirir.
// Sentetik profille (fixtures/emeklilik/profil-sentetik.json): düzeltilmiş tutar bilinmezken mali sıralama yapılamaz ve
// öneri "En erken tarih senaryosu" adını taşır; sade aracın tahmin aralığı ya da girilen tutarla sıralama yapılır ve
// öneri "Senaryo önerisi" olur. Tutarların doğruluğu model birim testlerinin işidir; burada biçim ve değişim sınanır.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EmeklilikProfili } from '../contract';
import { MEVZUAT_2026, emeklilikPlanlayicisiOlustur } from '../model';
import { EmeklilikPlaniViewModel } from './EmeklilikPlaniViewModel';

const PROFIL = JSON.parse(readFileSync(resolve(__dirname, '../../../../fixtures/emeklilik/profil-sentetik.json'), 'utf8')) as EmeklilikProfili;
const BUGUN = () => new Date('2026-11-02T12:00:00+03:00');
const ARALIK_FARK = /^[+-]?₺\d{1,3}(?:\.\d{3})*,\d{2} – [+-]?₺\d{1,3}(?:\.\d{3})*,\d{2}$/;
const TEK_FARK = /^[+-]?₺\d{1,3}(?:\.\d{3})*,\d{2}$/;

function kur() {
  const vm = new EmeklilikPlaniViewModel(emeklilikPlanlayicisiOlustur(PROFIL, MEVZUAT_2026), PROFIL, { mevzuat: MEVZUAT_2026, bugun: BUGUN });
  return { vm, ekran: () => vm.getSnapshot() };
}

describe('EmeklilikPlaniViewModel + model › Bağ-Kur borcunun kaynağı', () => {
  it('unknown corrected debt names the earliest-date scenario; the tahmin range and an entered amount allow a financial ranking', () => {
    const { vm, ekran } = kur();
    expect(ekran().hesap.durum).toBe('hazir');
    expect(ekran().form!.borcKaynagi.secili).toBe('bilinmiyor');
    expect(ekran().oneri).toMatchObject({ etiket: 'En erken tarih senaryosu', secimAdi: 'Üçü birlikte' });
    expect(ekran().oneri!.gerekce).toContain('SGK düzeltilmiş tutarı bilinmiyor');
    expect(ekran().sonuc!.donemSonunda.deger).toBe('Bilinmiyor · SGK düzeltilmiş tutarı bilinmiyor');

    vm.borcKaynagiSec('tahmin');
    expect(ekran().oneri).toMatchObject({ etiket: 'Senaryo önerisi', secimAdi: 'Üçü birlikte' });
    expect(ekran().sonuc!.donemSonunda.deger).toMatch(ARALIK_FARK);
    expect(ekran().sorular[1]!.aciklama).toBe('600 gün · ₺280.000,00 – ₺420.000,00');

    vm.borcKaynagiSec('elle');
    vm.alanGuncelle('bagkurBorc', '350.000,00');
    expect(ekran().oneri!.etiket).toBe('Senaryo önerisi');
    expect(ekran().sonuc!.donemSonunda.deger).toMatch(TEK_FARK);

    vm.varsayimlariSifirla();
    expect(ekran().form!.borcKaynagi.secili).toBe('bilinmiyor');
    expect(ekran().oneri!.etiket).toBe('En erken tarih senaryosu');
  });
});

describe('EmeklilikPlaniViewModel + model › ihya karşılaştırması', () => {
  it('boş net aylık seçili aylık modelini kullanır: başlangıçta iki yol da SGK referansıyla hesaplanır, fark bilinir', () => {
    const { vm, ekran } = kur();
    const ihya = ekran().ihya;
    expect(ihya.ihyali.aylik).toBe('₺25.000,00 · SGK referansı');
    expect(ihya.ihyasiz.aylik).toBe('₺25.000,00 · SGK referansı');
    expect(ihya.donemSonunda.bicim).toBe('tutar');
    expect(ihya.donemSonunda.deger).toMatch(TEK_FARK);
    expect(ihya.neden).toBeNull();
    vm.ihyaAylikGuncelle('ihyali', '30.000,00');
    expect(ekran().ihya.ihyali.aylik).toBe('₺30.000,00 · Elle girilen');
    expect(ekran().ihya.ihyasiz.aylik).toBe('₺25.000,00 · SGK referansı');
    vm.ihyaAylikGuncelle('ihyali', '');
    expect(ekran().ihya.ihyali.aylik).toBe('₺25.000,00 · SGK referansı');
  });
});

describe('EmeklilikPlaniViewModel + model › hesap hatası yerine alan hatası', () => {
  it('a debt below the shared payment ("4") stays a field error; the real planner is never asked with it', () => {
    const { vm, ekran } = kur();
    vm.borcKaynagiSec('elle');
    vm.alanGuncelle('bagkurBorc', '4');
    expect(ekran().hesap).toEqual({ durum: 'hazir', neden: null });
    expect(ekran().form!.borcKaynagi.alan!.hata).toBe('Hata: Borç, yalnız SSK yolunda da ödenecek tutardan (₺50.000,00) az olamaz.');
    expect(ekran().sorular[1]!.aciklama).toBe('600 gün · ₺300.000,00 – ₺450.000,00');
    expect(ekran().sonuc).not.toBeNull();
    vm.alanGuncelle('bagkurBorc', '400.000,00');
    expect(ekran().sorular[1]!.aciklama).toBe('600 gün · ₺400.000,00');
    vm.alanGuncelle('bagkurOrtakOdeme', '500.000,00');
    expect(ekran().hesap.durum).toBe('hazir');
    expect(ekran().form!.gruplar[0]!.alanlar.find(a => a.anahtar === 'bagkurOrtakOdeme')!.hata).toBe('Hata: Bu tutar düzeltilmiş borcu (₺400.000,00) aşamaz.');
  });
});

describe('EmeklilikPlaniViewModel + model › tarihi belirleyen ve iş ücreti', () => {
  const profille = (degistir: (p: EmeklilikProfili) => void) => {
    const profil = structuredClone(PROFIL);
    degistir(profil);
    const vm = new EmeklilikPlaniViewModel(emeklilikPlanlayicisiOlustur(profil, MEVZUAT_2026), profil, { mevzuat: MEVZUAT_2026, bugun: BUGUN });
    return () => vm.getSnapshot();
  };

  it('names the minimum-age condition when it sets the date', () => {
    const ekran = profille(p => { p.asgariYas = 50; });
    expect(ekran().sonuc!.sinirlayan).toBe('Tarihi yaş şartı belirliyor (50 yaş)');
    expect(ekran().sonuc!.planlamaAyi).toBe('Mart 2036');
  });

  it('names the record month when both conditions were met before it', () => {
    const ekran = profille(p => {
      p.dogumTarihi = '1970-01-01';
      p.kayitliGun = { ...p.kayitliGun, gun: 6000 };
    });
    expect(ekran().sonuc!.planlamaAyi).toBe('Kasım 2026');
    expect(ekran().sonuc!.sinirlayan).toBe('Gün ve sigortalılık süresi kayıt ayından önce dolmuş; planlama ayı kayıt ayı');
  });

  it('shows the compared wage with its source (net wage + raise assumption)', () => {
    const { ekran } = kur();
    const bayrak = ekran().form!.gruplar.flatMap(g => g.bayraklar).find(b => b.anahtar === 'isUcretiDevam')!;
    expect(bayrak.not).toBe('İş ücreti ayda ₺100.000,00 (profildeki net ücret ₺80.000,00 + %25 zam varsayımı); iki yolda aynı olduğundan farka girmez.');
  });
});
