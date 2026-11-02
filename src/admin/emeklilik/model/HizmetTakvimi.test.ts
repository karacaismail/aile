import { describe, expect, it } from 'vitest';
import { Ay } from './Ay';
import { HizmetTakvimi } from './HizmetTakvimi';
import { sentetikProfil, sentetikVarsayimlar } from './testDestek';

const ay = (m: string) => Ay.metinden(m);

describe('HizmetTakvimi', () => {
  it('kayıtlı günü ve isteğe bağlı düzeltmeyi baz alır', () => {
    const t = new HizmetTakvimi(sentetikProfil());
    expect(t.bazGun(sentetikVarsayimlar())).toBe(3500);
    expect(t.bazGun(sentetikVarsayimlar((v) => { v.gunDuzeltmesiUygula = true; }))).toBe(3499);
  });

  it('planlanan çalışmayı ay ay sayar; kayıtlı ay ve öncesi sayılmaz', () => {
    const t = new HizmetTakvimi(sentetikProfil());
    const v = sentetikVarsayimlar();
    expect(t.ayinGunu(ay('2026-09'), v)).toBe(0);
    expect(t.ayinGunu(ay('2026-10'), v)).toBe(30);
    expect(t.ayinGunu(ay('2027-01'), v)).toBe(30);
    expect(t.ayinGunu(ay('2040-01'), v)).toBe(30);
    expect(t.calismaGunuAyaKadar(ay('2027-01'), v)).toBe(120);
    expect(t.calismaGunuAyaKadar(ay('2026-09'), v)).toBe(0);
  });

  it('açık uçlu dönemde gelecekAyBasinaGun varsayımını uygular', () => {
    const t = new HizmetTakvimi(sentetikProfil());
    const v = sentetikVarsayimlar((k) => { k.gelecekAyBasinaGun = 12; });
    expect(t.ayinGunu(ay('2027-01'), v)).toBe(30);
    expect(t.ayinGunu(ay('2027-02'), v)).toBe(12);
    expect(t.calismaGunuAyaKadar(ay('2027-03'), v)).toBe(144);
  });

  it('hedefe ulaşılan ayı ay sonunda sayılan günlerle bulur', () => {
    const t = new HizmetTakvimi(sentetikProfil());
    const v = sentetikVarsayimlar();
    expect(t.hedefeUlasma(0, v)).toEqual({ ay: ay('2033-05'), calismaGunu: 2400 });
    expect(t.hedefeUlasma(500, v)).toEqual({ ay: ay('2032-01'), calismaGunu: 1920 });
    expect(t.hedefeUlasma(1460, v)).toEqual({ ay: ay('2029-05'), calismaGunu: 960 });
    // Sınır: 3.500 + 2.280 + Ekim–Ocak 120 = 5.900 → Ocak 2027; bir gün eksikse Şubat 2027.
    expect(t.hedefeUlasma(2280, v)).toEqual({ ay: ay('2027-01'), calismaGunu: 120 });
    expect(t.hedefeUlasma(2279, v)).toEqual({ ay: ay('2027-02'), calismaGunu: 150 });
  });

  it('gün zaten yeterliyse kayıtlı ayı verir', () => {
    const t = new HizmetTakvimi(sentetikProfil());
    expect(t.hedefeUlasma(2400, sentetikVarsayimlar())).toEqual({ ay: ay('2026-09'), calismaGunu: 0 });
  });

  it('açık uçlu çalışma 0 gün ise ve sonlu plan yetmiyorsa hedefe ulaşılamaz', () => {
    const t = new HizmetTakvimi(sentetikProfil());
    expect(t.hedefeUlasma(0, sentetikVarsayimlar((v) => { v.gelecekAyBasinaGun = 0; }))).toBeNull();
    expect(t.hedefeUlasma(2280, sentetikVarsayimlar((v) => { v.gelecekAyBasinaGun = 0; }))).toEqual({ ay: ay('2027-01'), calismaGunu: 120 });
  });

  it('çakışan planlarda ay başına 30 günü aşmaz; aradaki boş aylar 0 gündür', () => {
    const t = new HizmetTakvimi(sentetikProfil((p) => {
      p.planlananCalisma = [
        { baslangicAy: '2026-10', bitisAy: '2026-12', ayBasinaGun: 20, aciklama: 'a' },
        { baslangicAy: '2026-11', bitisAy: '2026-11', ayBasinaGun: 20, aciklama: 'b' },
        { baslangicAy: '2027-03', bitisAy: null, ayBasinaGun: 30, aciklama: 'c' },
      ];
    }));
    const v = sentetikVarsayimlar();
    expect(t.ayinGunu(ay('2026-11'), v)).toBe(30);
    expect(t.ayinGunu(ay('2027-01'), v)).toBe(0);
    expect(t.ayinGunu(ay('2027-02'), v)).toBe(0);
    expect(t.calismaGunuAyaKadar(ay('2027-03'), v)).toBe(100);
  });

  it('geçersiz varsayımları reddeder', () => {
    const t = new HizmetTakvimi(sentetikProfil());
    expect(() => t.hedefeUlasma(0, sentetikVarsayimlar((v) => { v.gelecekAyBasinaGun = 31; }))).toThrow(RangeError);
    expect(() => t.hedefeUlasma(-1, sentetikVarsayimlar())).toThrow(RangeError);
  });
});
