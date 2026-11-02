import { describe, expect, it } from 'vitest';
import { EmeklilikTarihiHesabi } from './EmeklilikTarihiHesabi';
import { HizmetTakvimi } from './HizmetTakvimi';
import { sentetikProfil, sentetikVarsayimlar } from './testDestek';
import type { EmeklilikProfili } from '../contract';

const hesap = (p: EmeklilikProfili = sentetikProfil()) => new EmeklilikTarihiHesabi(p, new HizmetTakvimi(p));

describe('EmeklilikTarihiHesabi', () => {
  it('18 yaşından önce girişte sigortalılık süresi 18. doğum gününden başlar', () => {
    const h = hesap();
    expect(h.sigortalilikBaslangici().metin()).toBe('2004-03-10');
    expect(h.sigortalilikSuresiDolumu().metin()).toBe('2029-03-10');
  });

  it('18 yaşından sonra girişte süre giriş gününden başlar', () => {
    const h = hesap(sentetikProfil((p) => { p.ilkSigortaGirisi = '2005-06-01'; }));
    expect(h.sigortalilikBaslangici().metin()).toBe('2005-06-01');
    expect(h.sigortalilikSuresiDolumu().metin()).toBe('2030-06-01');
  });

  it('gün koşulu geç kalırsa tarihi gün belirler; yaş ay sonunda hesaplanır', () => {
    const s = hesap().hesapla(0, sentetikVarsayimlar());
    expect(s.emeklilikAyi?.metin()).toBe('2033-05');
    expect(s.sinirlayanKosul).toBe('gun');
    expect(s.yas).toBe(47);
    expect(s.gunAyi?.metin()).toBe('2033-05');
    expect(s.sureAyi.metin()).toBe('2029-03');
    expect(s.toplamGun).toBe(5900);
    expect(s.calisarakTamamlananGun).toBe(2400);
  });

  it('gün erken dolarsa sigortalılık süresinin dolduğu ay belirler', () => {
    const s = hesap().hesapla(2300, sentetikVarsayimlar());
    expect(s.gunAyi?.metin()).toBe('2027-01');
    expect(s.emeklilikAyi?.metin()).toBe('2029-03');
    expect(s.sinirlayanKosul).toBe('sigortalilikSuresi');
    expect(s.yas).toBe(43);
    // Süre ayına kadar çalışma sürer: Ekim 2026–Mart 2029 = 30 ay × 30 gün.
    expect(s.toplamGun).toBe(3500 + 2300 + 900);
    expect(s.calisarakTamamlananGun).toBe(100);
  });

  it('hedefe ulaşılamıyorsa tarih, yaş ve koşul yoktur', () => {
    const s = hesap().hesapla(0, sentetikVarsayimlar((v) => { v.gelecekAyBasinaGun = 0; }));
    expect(s.emeklilikAyi).toBeNull();
    expect(s.yas).toBeNull();
    expect(s.sinirlayanKosul).toBeNull();
    expect(s.toplamGun).toBeNull();
    expect(s.calisarakTamamlananGun).toBe(120);
  });

  it('iki koşul da kayıt ayından önce sağlanmışsa planlama ayı kayıt ayıdır', () => {
    const p = sentetikProfil((k) => { k.ilkSigortaGirisi = '1999-02-01'; k.dogumTarihi = '1970-01-01'; });
    const s = hesap(p).hesapla(3000, sentetikVarsayimlar());
    expect(s.emeklilikAyi?.metin()).toBe('2026-11');
  });
});
