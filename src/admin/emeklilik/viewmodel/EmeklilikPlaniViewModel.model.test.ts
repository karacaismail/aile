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
