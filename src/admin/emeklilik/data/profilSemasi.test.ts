// Emeklilik profili şeması (Zod): contract.EmeklilikProfili ile birebir; surum 1; tarih (YYYY-AA-GG, takvim geçerli),
// ay (YYYY-AA) ve TL metni (nokta ondalık, en çok iki hane, kayan noktaya çevrilmez) biçimleri; TutarBilgisi ayrık
// birleşimi; bilinmeyen alanlar reddedilmez ama sonuçtan düşer. Hata nedeni Türkçedir, alan yolunu söyler, değeri yazmaz.
// Testler yalnız sentetik profili (fixtures/emeklilik/profil-sentetik.json) ve ondan türetilen kopyaları kullanır.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EmeklilikProfili } from '../contract';
import { profilDogrula, profilJsonDogrula } from './profilSemasi';

const SENTETIK_YOL = resolve(__dirname, '../../../../fixtures/emeklilik/profil-sentetik.json');
const sentetikMetin = readFileSync(SENTETIK_YOL, 'utf8');
const sentetik = (): Record<string, any> => JSON.parse(sentetikMetin);

function gecerli(veri: unknown): EmeklilikProfili {
  const sonuc = profilDogrula(veri);
  if (!sonuc.tamam) throw new Error(`Beklenmeyen ret: ${sonuc.neden}`);
  return sonuc.profil;
}

function reddedilir(veri: unknown): string {
  const sonuc = profilDogrula(veri);
  expect(sonuc.tamam, 'profil reddedilmeliydi').toBe(false);
  return sonuc.tamam ? '' : sonuc.neden;
}

describe('profilDogrula › sentetik profil', () => {
  it('sentetik fikstür geçer ve sonuç girdiyle birebir aynıdır', () => {
    const profil = gecerli(sentetik());
    expect(profil).toEqual(sentetik());
    expect(profil.sentetik).toBe(true);
    expect(profil.surum).toBe(1);
  });

  it('sonuç derin dondurulmuştur (görünüm ya da model profili değiştiremez)', () => {
    const profil = gecerli(sentetik());
    expect(Object.isFrozen(profil)).toBe(true);
    expect(Object.isFrozen(profil.kayitliGun)).toBe(true);
    expect(Object.isFrozen(profil.planlananCalisma)).toBe(true);
    expect(Object.isFrozen(profil.planlananCalisma[0])).toBe(true);
    expect(Object.isFrozen(profil.secenekler.bagkur.borc)).toBe(true);
    expect(Object.isFrozen(profil.kaynaklar)).toBe(true);
  });

  it('girdi nesnesi değiştirilmez ve sonuç girdiye bağlı değildir', () => {
    const girdi = sentetik();
    const profil = gecerli(girdi);
    expect(Object.isFrozen(girdi)).toBe(false);
    girdi.kayitliGun.gun = 1;
    expect(profil.kayitliGun.gun).not.toBe(1);
  });
});

describe('profilDogrula › bilinmeyen alanlar', () => {
  it('üst düzey ve iç içe bilinmeyen alanlar reddedilmez, sonuçtan düşer', () => {
    const girdi = sentetik();
    girdi.notlar = 'serbest metin';
    girdi.kayitliGun.kaynakSayfa = 3;
    girdi.secenekler.bagkur.borc.ekAlan = true;
    girdi.planlananCalisma[0].isyeri = 'Sentetik';
    const profil = gecerli(girdi) as unknown as Record<string, any>;
    expect(profil).not.toHaveProperty('notlar');
    expect(profil.kayitliGun).not.toHaveProperty('kaynakSayfa');
    expect(profil.secenekler.bagkur.borc).not.toHaveProperty('ekAlan');
    expect(profil.planlananCalisma[0]).not.toHaveProperty('isyeri');
    expect(profil).toEqual(sentetik());
  });
});

describe('profilDogrula › sürüm ve zorunlu alanlar', () => {
  it('yalnız surum 1 kabul edilir', () => {
    for (const surum of [2, 0, '1', null]) {
      const girdi = sentetik();
      girdi.surum = surum;
      expect(reddedilir(girdi)).toContain('surum');
    }
    const girdi = sentetik();
    delete girdi.surum;
    expect(reddedilir(girdi)).toContain('surum');
  });

  it('nesne olmayan girdi ve eksik zorunlu alan reddedilir', () => {
    for (const veri of [null, undefined, 42, 'profil', []]) reddedilir(veri);
    for (const alan of ['sentetik', 'dogumTarihi', 'kayitliGun', 'kazanc', 'sgkReferansAylik', 'secenekler', 'kaynaklar', 'planlananCalisma']) {
      const girdi = sentetik();
      delete girdi[alan];
      expect(reddedilir(girdi), alan).toContain(alan);
    }
  });

  it('sentetik alanı boolean olmalıdır', () => {
    const girdi = sentetik();
    girdi.sentetik = 'evet';
    expect(reddedilir(girdi)).toContain('sentetik');
  });
});

describe('profilDogrula › tarih, ay ve TL metin biçimleri', () => {
  it('tarih YYYY-AA-GG ve takvimde geçerli olmalı; saatli ISO ve eksik hane reddedilir', () => {
    for (const deger of ['1986-3-10', '1986-02-30', '1986-13-01', '1986-03-10T00:00:00Z', '10.03.1986', '', 19860310]) {
      const girdi = sentetik();
      girdi.dogumTarihi = deger;
      expect(reddedilir(girdi), String(deger)).toContain('dogumTarihi');
    }
    for (const [alan, yol] of [['kayitTarihi', 'kayitTarihi'], ['ilkSigortaGirisi', 'ilkSigortaGirisi']] as const) {
      const girdi = sentetik();
      girdi[alan] = '2026-02-29';
      expect(reddedilir(girdi), alan).toContain(yol);
    }
    const sgk = sentetik();
    sgk.sgkReferansAylik.tarih = '2026/11/02';
    expect(reddedilir(sgk)).toContain('sgkReferansAylik.tarih');
  });

  it('ay YYYY-AA olmalı', () => {
    for (const deger of ['2026-9', '2026-13', '2026-00', '2026-09-01', '202609']) {
      const girdi = sentetik();
      girdi.kayitliGun.sonAy = deger;
      expect(reddedilir(girdi), deger).toContain('kayitliGun.sonAy');
    }
    const calisma = sentetik();
    calisma.planlananCalisma[1].baslangicAy = '2027-2';
    expect(reddedilir(calisma)).toContain('planlananCalisma.1.baslangicAy');
  });

  it('TL metni nokta ondalıklı, işaretsiz ve en çok iki hanelidir; sayı tipi ve yerel biçim reddedilir', () => {
    for (const deger of ['120000', '120000.5', '120000.50', '0.00']) {
      const girdi = sentetik();
      girdi.kazanc.sonPekTl = deger;
      expect(gecerli(girdi).kazanc.sonPekTl, deger).toBe(deger);
    }
    for (const deger of ['120.000,00', '120000,00', '1e5', '-120000.00', '120000.505', ' 120000.00', '', '₺120000', 120000]) {
      const girdi = sentetik();
      girdi.kazanc.sonPekTl = deger;
      expect(reddedilir(girdi), String(deger)).toContain('kazanc.sonPekTl');
    }
  });

  it('boş bırakılabilen TL alanları null alır; eksik bırakılamaz', () => {
    const girdi = sentetik();
    girdi.sgkReferansAylik.ekOdemeTl = null;
    girdi.secenekler.askerlik.gunlukBedelTl = '1101.00';
    expect(gecerli(girdi).sgkReferansAylik.ekOdemeTl).toBeNull();
    const eksik = sentetik();
    delete eksik.secenekler.ihya.gunlukBedelTl;
    expect(reddedilir(eksik)).toContain('secenekler.ihya.gunlukBedelTl');
  });
});

describe('profilDogrula › sayısal alanlar', () => {
  it('gün sayıları tam sayı ve negatif değildir; gün düzeltmesi negatif olabilir', () => {
    for (const [yol, ata] of [
      ['hedefGun', (g: Record<string, any>) => { g.hedefGun = -1; }],
      ['hedefGun', (g: Record<string, any>) => { g.hedefGun = 5900.5; }],
      ['kayitliGun.gun', (g: Record<string, any>) => { g.kayitliGun.gun = '3500'; }],
      ['secenekler.bagkur.gun', (g: Record<string, any>) => { g.secenekler.bagkur.gun = -10; }],
      ['sgkReferansAylik.gun', (g: Record<string, any>) => { g.sgkReferansAylik.gun = 1.5; }],
    ] as const) {
      const girdi = sentetik();
      ata(girdi);
      expect(reddedilir(girdi), yol).toContain(yol);
    }
    const duzeltme = sentetik();
    duzeltme.gunDuzeltmesi.gun = -3;
    expect(gecerli(duzeltme).gunDuzeltmesi.gun).toBe(-3);
  });

  it('planlanan çalışmada ayda gün 0–30 arasıdır ve bitiş başlangıçtan önce olamaz', () => {
    const fazla = sentetik();
    fazla.planlananCalisma[0].ayBasinaGun = 31;
    expect(reddedilir(fazla)).toContain('planlananCalisma.0.ayBasinaGun');
    const ters = sentetik();
    ters.planlananCalisma[0].bitisAy = '2026-09';
    expect(reddedilir(ters)).toContain('planlananCalisma.0.bitisAy');
    const acik = sentetik();
    acik.planlananCalisma[0].bitisAy = null;
    expect(gecerli(acik).planlananCalisma[0].bitisAy).toBeNull();
    const bos = sentetik();
    bos.planlananCalisma = [];
    expect(gecerli(bos).planlananCalisma).toEqual([]);
  });

  it('oranlar ve katlar sonlu sayıdır; zam oranı negatif olamaz', () => {
    for (const [alan, deger] of [['ucretZamOrani', -0.1], ['ucretZamOrani', '0.25'], ['sonra2008KatToplam', -1], ['once2008OrtalamaKat', Number.NaN]] as const) {
      const girdi = sentetik();
      girdi.kazanc[alan] = deger;
      expect(reddedilir(girdi), `${alan}=${String(deger)}`).toContain(`kazanc.${alan}`);
    }
  });

  it('askerlik günü azami günü aşamaz', () => {
    const girdi = sentetik();
    girdi.secenekler.askerlik.gun = girdi.secenekler.askerlik.azamiGun + 1;
    expect(reddedilir(girdi)).toContain('secenekler.askerlik.gun');
  });

  it('ilk sigorta girişi doğum tarihinden önce olamaz', () => {
    const girdi = sentetik();
    girdi.ilkSigortaGirisi = '1980-01-01';
    expect(reddedilir(girdi)).toContain('ilkSigortaGirisi');
  });
});

describe('profilDogrula › TutarBilgisi ayrık birleşimi', () => {
  it('bilinen, aralik ve bilinmiyor biçimleri kabul edilir', () => {
    const bilinen = sentetik();
    bilinen.secenekler.bagkur.borc = { tur: 'bilinen', tl: '1234.56', kaynak: 'Sentetik borç dökümü' };
    expect(gecerli(bilinen).secenekler.bagkur.borc).toEqual({ tur: 'bilinen', tl: '1234.56', kaynak: 'Sentetik borç dökümü' });
    const bilinmiyor = sentetik();
    bilinmiyor.secenekler.bagkur.borc = { tur: 'bilinmiyor', neden: 'Sentetik: düzeltilmiş borç sorgulanmadı.' };
    expect(gecerli(bilinmiyor).secenekler.bagkur.borc).toEqual({ tur: 'bilinmiyor', neden: 'Sentetik: düzeltilmiş borç sorgulanmadı.' });
    expect(gecerli(sentetik()).secenekler.bagkur.borc).toEqual({ tur: 'aralik', altTl: '300000.00', ustTl: '450000.00', kaynak: 'Sentetik aralık' });
  });

  it('bilinmeyen tür, eksik kaynak/neden ve ters aralık reddedilir', () => {
    const vakalar: Array<[string, unknown]> = [
      ['secenekler.bagkur.borc', { tur: 'tahmin', tl: '1.00', kaynak: 'x' }],
      ['secenekler.bagkur.borc', { tur: 'bilinen', tl: '1.00' }],
      ['secenekler.bagkur.borc', { tur: 'bilinen', tl: '1.00', kaynak: '' }],
      ['secenekler.bagkur.borc', { tur: 'bilinmiyor' }],
      ['secenekler.bagkur.borc', { tur: 'aralik', altTl: '500.00', ustTl: '100.00', kaynak: 'x' }],
      ['secenekler.bagkur.borc', { tur: 'bilinen', tl: 1, kaynak: 'x' }],
      ['secenekler.bagkur.borc', null],
    ];
    for (const [yol, deger] of vakalar) {
      const girdi = sentetik();
      girdi.secenekler.bagkur.borc = deger;
      expect(reddedilir(girdi), JSON.stringify(deger)).toContain(yol);
    }
    const ortak = sentetik();
    ortak.secenekler.bagkur.yalnizSskYolundaOdenecek = { tur: 'aralik', altTl: '2.00', ustTl: '1.00', kaynak: 'x' };
    expect(reddedilir(ortak)).toContain('secenekler.bagkur.yalnizSskYolundaOdenecek');
  });

  it('aralığın iki ucu eşit olabilir; karşılaştırma kuruş tamsayısıyla yapılır (kayan nokta yok)', () => {
    const esit = sentetik();
    esit.secenekler.bagkur.borc = { tur: 'aralik', altTl: '0.1', ustTl: '0.10', kaynak: 'x' };
    expect(gecerli(esit).secenekler.bagkur.borc.tur).toBe('aralik');
    const buyuk = sentetik();
    buyuk.secenekler.bagkur.borc = { tur: 'aralik', altTl: '90071992547409.93', ustTl: '90071992547409.92', kaynak: 'x' };
    reddedilir(buyuk);
  });
});

describe('profilDogrula › aylık modeli', () => {
  it('yalnız sgkReferans, kazancTahmini ve elle', () => {
    for (const model of ['sgkReferans', 'kazancTahmini', 'elle']) {
      const girdi = sentetik();
      girdi.varsayilanAylikModeli = model;
      expect(gecerli(girdi).varsayilanAylikModeli).toBe(model);
    }
    const girdi = sentetik();
    girdi.varsayilanAylikModeli = 'aralik';
    expect(reddedilir(girdi)).toContain('varsayilanAylikModeli');
  });
});

describe('hata nedeni', () => {
  it('Türkçedir, alan yolunu söyler ve hatalı değeri yazmaz', () => {
    const girdi = sentetik();
    girdi.dogumTarihi = '1986-99-99';
    girdi.kazanc.netUcretTl = '81.234,56';
    const neden = reddedilir(girdi);
    expect(neden).toMatch(/^Profil doğrulanamadı: /);
    expect(neden).toContain('dogumTarihi');
    expect(neden).toContain('kazanc.netUcretTl');
    expect(neden).not.toContain('1986-99-99');
    expect(neden).not.toContain('81.234,56');
    expect(neden).not.toMatch(/Invalid|expected|received/i);
  });

  it('çok sayıda sorunda neden kısa kalır (ilk birkaç sorun ve kalan sayısı)', () => {
    const girdi = sentetik();
    for (const alan of ['dogumTarihi', 'kayitTarihi', 'ilkSigortaGirisi']) girdi[alan] = 'x';
    girdi.hedefGun = -1;
    girdi.sigortalilikYili = -1;
    girdi.kaynaklar = 'tek';
    const neden = reddedilir(girdi);
    expect(neden).toMatch(/ve \d+ sorun daha/);
    expect(neden.length).toBeLessThan(400);
  });
});

describe('profilJsonDogrula', () => {
  it('JSON metnini ayrıştırıp doğrular', () => {
    const sonuc = profilJsonDogrula(sentetikMetin);
    expect(sonuc.tamam).toBe(true);
  });

  it('JSON olmayan metin açık nedenle reddedilir; içerik nedene yazılmaz', () => {
    const sonuc = profilJsonDogrula('{"dogumTarihi": "1986-03-10",');
    expect(sonuc.tamam).toBe(false);
    if (!sonuc.tamam) {
      expect(sonuc.neden).toBe('Profil dosyası geçerli JSON değil.');
      expect(sonuc.neden).not.toContain('1986');
    }
  });
});
