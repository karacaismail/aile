import { describe, expect, it } from 'vitest';
import { BILESIM_SIRASI, type EmeklilikPlanlayici, type Secim, type Varsayimlar } from '../contract';
import { emeklilikPlanlayicisiOlustur, MEVZUAT_2026 } from './index';
import { EmeklilikPlanlayiciImpl, bilesimAdi } from './EmeklilikPlanlayici';
import { kisa, sentetikProfil, sentetikVarsayimlar, varsayimKopya } from './testDestek';

const HIC: Secim = { askerlik: false, bagkur: false, ihya: false };
const HEPSI: Secim = { askerlik: true, bagkur: true, ihya: true };
const planlayici = (): EmeklilikPlanlayici => emeklilikPlanlayicisiOlustur(sentetikProfil());
const sec = (s: string): Secim => ({ askerlik: s[0] === '1', bagkur: s[1] === '1', ihya: s[2] === '1' });
const kod = (s: Secim) => `${+s.askerlik}${+s.bagkur}${+s.ihya}`;

/** Codex aracının karşılaştırma koşulları: süre geç yolun emekliliğinde biter, kesinti yok, borç bilinen. */
const codexKosullari = () => sentetikVarsayimlar((v) => {
  v.karsilastirmaSuresiYil = 0;
  v.borcKesintiOrani = 0;
  v.secenekGirdileri.bagkur.borc = { tur: 'bilinen', tl: '300000.00', kaynak: 'Sentetik düzeltilmiş borç' };
});

describe('EmeklilikPlanlayiciImpl — varsayılanlar', () => {
  it('sözleşmeyi uygular ve varsayılan varsayımları profil + mevzuattan üretir', () => {
    const p = planlayici();
    expect(p).toBeInstanceOf(EmeklilikPlanlayiciImpl);
    expect(p.varsayilanVarsayimlar()).toEqual(sentetikVarsayimlar());
  });

  it('profilde günlük bedel varsa onu korur; açık uçlu çalışma yoksa gelecek gün 0 olur', () => {
    const p = emeklilikPlanlayicisiOlustur(sentetikProfil((k) => {
      k.secenekler.askerlik.gunlukBedelTl = '600.00';
      k.planlananCalisma = k.planlananCalisma.filter((c) => c.bitisAy !== null);
    }));
    const v = p.varsayilanVarsayimlar();
    expect(v.secenekGirdileri.askerlik.gunlukBedelTl).toBe('600.00');
    expect(v.secenekGirdileri.ihya.gunlukBedelTl).toBe('495.45');
    expect(v.gelecekAyBasinaGun).toBe(0);
  });

  it('mevzuat parametresi değişince günlük bedel de değişir (sabit ezberlenmez)', () => {
    const p = emeklilikPlanlayicisiOlustur(sentetikProfil(), { ...MEVZUAT_2026, gunlukKazancAltSiniriTl: '1200.00', borclanmaOrani: 0.32 });
    expect(p.varsayilanVarsayimlar().secenekGirdileri.askerlik.gunlukBedelTl).toBe('384.00');
  });
});

describe('EmeklilikPlanlayiciImpl — yol', () => {
  it('altın değerler: sekiz bileşimin planlama ayı Codex ve sade araçla aynı', () => {
    const p = planlayici();
    const v = p.varsayilanVarsayimlar();
    const beklenen: Record<string, string> = {
      '000': '2033-05', '100': '2032-05', '010': '2031-09', '001': '2032-01',
      '110': '2030-09', '101': '2031-01', '011': '2030-05', '111': '2029-05',
    };
    for (const s of BILESIM_SIRASI) expect(p.yol(s, v).emeklilikAyi, kod(s)).toBe(beklenen[kod(s)]);
  });

  it('eklenen gün, yaş, koşul, ödeme kalemleri ve aylık modelini verir', () => {
    const p = planlayici();
    const y = p.yol(HEPSI, p.varsayilanVarsayimlar());
    expect(y.secim).toEqual(HEPSI);
    expect(y.eklenenGun).toEqual({ askerlik: 360, bagkur: 600, ihya: 500 });
    expect(y.calisarakTamamlananGun).toBe(5900 - 3500 - 1460);
    expect(y.yas).toBe(43);
    expect(y.sinirlayanKosul).toBe('gun');
    expect(y.odemeKalemleri.map((k) => [k.anahtar, kisa(k.tutar)])).toEqual([
      ['askerlik', '178362.00'], ['bagkur', ['300000.00', '450000.00']], ['ihya', '247725.00'],
    ]);
    expect(kisa(y.odeme)).toEqual(['726087.00', '876087.00']);
    expect(y.aylik).toMatchObject({ tur: 'bilinen', tl: '25000.00' });
    expect(y.aylikModeli).toBe('sgkReferans');
    expect(y.kesinti).toBeNull();
  });

  it('hiçbir şey ödemeyen yolda ödeme yoktur ve kalan borç için kesinti borç bitene kadar sürer', () => {
    const p = planlayici();
    const y = p.yol(HIC, p.varsayilanVarsayimlar());
    expect(y.eklenenGun).toEqual({ askerlik: 0, bagkur: 0, ihya: 0 });
    expect(kisa(y.odeme)).toBe('0.00');
    expect(y.odemeKalemleri).toEqual([]);
    expect(y.kesinti).toMatchObject({ oran: 0.1, sureAy: 160 });
    expect(y.kesinti?.neden).toContain('100');
  });

  it('gün düzeltmesi uygulanırsa tarih bir ay kayabilir', () => {
    const p = planlayici();
    const v = sentetikVarsayimlar((k) => { k.gunDuzeltmesiUygula = true; });
    expect(p.yol(HIC, v).emeklilikAyi).toBe('2033-06');
  });

  it('kazanç tahmini modeli yol başına farklı aylık verir ve etiketlenir', () => {
    const p = planlayici();
    const v = sentetikVarsayimlar((k) => { k.aylikModeli = 'kazancTahmini'; });
    expect(p.yol(HIC, v).aylik).toMatchObject({ tur: 'bilinen', tl: '38662.69' });
    expect(p.yol(HEPSI, v).aylik).toMatchObject({ tur: 'bilinen', tl: '33064.31' });
    expect(p.yol(HEPSI, v).aylikModeli).toBe('kazancTahmini');
  });

  it('elle modelde aylık girilmemişse bilinmiyor', () => {
    const p = planlayici();
    const v = sentetikVarsayimlar((k) => { k.aylikModeli = 'elle'; });
    expect(p.yol(HIC, v).aylik).toMatchObject({ tur: 'bilinmiyor' });
    expect(p.yol(HIC, varsayimKopya(v, (k) => { k.elleAylikTl = '30000.00'; })).aylik).toMatchObject({ tur: 'bilinen', tl: '30000.00' });
  });
});

describe('EmeklilikPlanlayiciImpl — karşılaştırma', () => {
  it('altın değerler: Codex aracıyla aynı ek ödeme, fark ve geri kazanma', () => {
    // Kaynak: work/model.cjs compareCashToSsk, sentetik sabitlerle repo dışında çalıştırıldı.
    const beklenen: Record<string, [number, string, string, number]> = {
      '000': [0, '0.00', '0.00', 0],
      '100': [12, '178362.00', '121638.00', 8],
      '010': [20, '250000.00', '250000.00', 10],
      '001': [16, '247725.00', '152275.00', 10],
      '110': [32, '428362.00', '371638.00', 18],
      '101': [28, '426087.00', '273913.00', 18],
      '011': [36, '497725.00', '402275.00', 20],
      '111': [48, '676087.00', '523913.00', 28],
    };
    const tum = planlayici().tumBilesimler(codexKosullari());
    for (const k of tum) {
      const [erken, ek, fark, geri] = beklenen[kod(k.yol.secim)];
      expect(k.erkenAy, kod(k.yol.secim)).toBe(erken);
      expect(kisa(k.ekOdeme), kod(k.yol.secim)).toBe(ek);
      expect(kisa(k.gecYolEmekliOlunca), kod(k.yol.secim)).toBe(fark);
      expect(kisa(k.donemSonunda), kod(k.yol.secim)).toBe(fark);
      expect(k.geriKazanmaAylikSayisi, kod(k.yol.secim)).toBe(geri);
      expect(k.hesaplanamayanNeden).toBeNull();
      expect(k.referans.secim).toEqual(HIC);
    }
  });

  it('altın değer: iş bırakılırsa vazgeçilen zamlı ücret farka girer', () => {
    const v = varsayimKopya(codexKosullari(), (k) => { k.isUcretiDevam = false; });
    const p = planlayici();
    expect(kisa(p.karsilastir(sec('100'), v).donemSonunda)).toBe('-1078362.00');
    expect(kisa(p.karsilastir(HEPSI, v).donemSonunda)).toBe('-4276087.00');
  });

  it('altın değer: ihya karşılaştırması elle girilen net aylıklarla (Codex compareIhyaChoice)', () => {
    const p = planlayici();
    const v = sentetikVarsayimlar();
    const k = p.yolKarsilastir(HEPSI, sec('110'), v, { a: '24000.00', b: '26000.00' });
    expect(k.erkenAy).toBe(16);
    expect(kisa(k.ekOdeme)).toBe('247725.00');
    expect(kisa(k.gecYolEmekliOlunca)).toBe('136275.00');
    expect(kisa(k.donemSonunda)).toBe('-103725.00');
    expect(k.yol.aylikModeli).toBe('elle');
    expect(k.referans.aylikModeli).toBe('elle');
    const bos = p.yolKarsilastir(HEPSI, sec('110'), v, { a: null, b: null });
    expect(bos.donemSonunda).toMatchObject({ tur: 'bilinmiyor' });
    expect(bos.erkenAy).toBe(16);
  });

  it('varsayılanlarda kesinti borç bitene kadar sürer; aralık girdiler aralık sonuç üretir', () => {
    const tum = planlayici().tumBilesimler(sentetikVarsayimlar());
    const bul = (s: string) => tum.find((k) => kod(k.yol.secim) === s)!;
    expect(kisa(bul('100').donemSonunda)).toEqual(['91638.00', '121638.00']);
    expect(kisa(bul('100').gecYolEmekliOlunca)).toBe('91638.00');
    expect(bul('100').geriKazanmaAylikSayisi).toBe(8);
    expect(kisa(bul('010').ekOdeme)).toEqual(['250000.00', '400000.00']);
    expect(kisa(bul('010').donemSonunda)).toEqual(['400000.00', '500000.00']);
    expect(kisa(bul('010').gecYolEmekliOlunca)).toEqual(['100000.00', '250000.00']);
    expect(bul('010').geriKazanmaAylikSayisi).toBe(16);
    expect(kisa(bul('001').donemSonunda)).toEqual(['112275.00', '152275.00']);
    expect(bul('001').geriKazanmaAylikSayisi).toBe(12);
    expect(kisa(bul('111').donemSonunda)).toEqual(['673913.00', '773913.00']);
  });

  it('sekiz bileşim sabit sırada döner', () => {
    const tum = planlayici().tumBilesimler(sentetikVarsayimlar());
    expect(tum).toHaveLength(8);
    expect(tum.map((k) => k.yol.secim)).toEqual([...BILESIM_SIRASI]);
  });

  it('bilinmeyen borç bilinmiyor olarak yayılır ve nedenini söyler; tarih yine hesaplanır', () => {
    const v = sentetikVarsayimlar((k) => {
      k.secenekGirdileri.bagkur.borc = { tur: 'bilinmiyor', neden: 'Düzeltilmiş borç SGK’dan istenmeli' };
    });
    const p = planlayici();
    const bagkur = p.karsilastir(sec('010'), v);
    expect(bagkur.erkenAy).toBe(20);
    expect(bagkur.ekOdeme).toMatchObject({ tur: 'bilinmiyor' });
    expect(bagkur.donemSonunda).toMatchObject({ tur: 'bilinmiyor' });
    expect(bagkur.geriKazanmaAylikSayisi).toBeNull();
    expect(bagkur.hesaplanamayanNeden).toContain('Düzeltilmiş borç SGK’dan istenmeli');
    // Kesinti açıkken ödenmeyen borcun süresi de bilinmez: borçsuz yollar da hesaplanamaz.
    expect(p.karsilastir(sec('100'), v).donemSonunda).toMatchObject({ tur: 'bilinmiyor' });
    expect(p.yol(HIC, v).kesinti).toMatchObject({ sureAy: null });
    // Kesinti kapalıyken Bağ-Kur içermeyen yollar hesaplanır.
    const kesintisiz = varsayimKopya(v, (k) => { k.borcKesintiOrani = 0; });
    expect(kisa(p.karsilastir(sec('100'), kesintisiz).donemSonunda)).toBe('121638.00');
    expect(p.yol(HIC, kesintisiz).kesinti).toBeNull();
  });

  it('seçimlerin tek başına etkisi diğer seçimler sabitken hesaplanır', () => {
    const p = planlayici();
    const v = codexKosullari();
    const hicten = p.secimEtkileri(HIC, v);
    expect(hicten.map((e) => e.anahtar)).toEqual(['askerlik', 'bagkur', 'ihya']);
    expect(hicten.map((e) => e.erkenAy)).toEqual([12, 20, 16]);
    expect(hicten.map((e) => kisa(e.ekOdeme))).toEqual(['178362.00', '250000.00', '247725.00']);
    expect(hicten.map((e) => kisa(e.donemSonundaFark))).toEqual(['121638.00', '250000.00', '152275.00']);
    const hepsinden = p.secimEtkileri(HEPSI, v);
    // Askerlik: Bağ-Kur+ihya (Mayıs 2030) → hepsi (Mayıs 2029).
    expect(hepsinden[0].erkenAy).toBe(12);
    expect(kisa(hepsinden[0].ekOdeme)).toBe('178362.00');
    // Bağ-Kur: askerlik+ihya (Ocak 2031) → hepsi; ortak ödeme düşülür.
    expect(hepsinden[1].erkenAy).toBe(20);
    expect(kisa(hepsinden[1].ekOdeme)).toBe('250000.00');
  });
});

describe('EmeklilikPlanlayiciImpl — öneri', () => {
  it('mali sonuç her bileşimde hesaplanabiliyorsa dönem sonu farkı en yüksek senaryoyu önerir', () => {
    const o = planlayici().oneri(sentetikVarsayimlar());
    expect(o.tur).toBe('senaryoOnerisi');
    expect(o.secim).toEqual(HEPSI);
    expect(o.saglam).toBe(true);
    expect(o.gerekce).toContain('Mayıs 2029');
  });

  it('mali sıralama yapılamıyorsa en erken tarih senaryosunu adıyla önerir', () => {
    const v = sentetikVarsayimlar((k) => {
      k.secenekGirdileri.bagkur.borc = { tur: 'bilinmiyor', neden: 'Borç yok.' };
      k.secenekGirdileri.bagkur.yalnizSskYolundaOdenecek = { tur: 'bilinmiyor', neden: 'Ortak yok.' };
    });
    const o = planlayici().oneri(v);
    expect(o.tur).toBe('enErkenTarih');
    expect(o.gerekce.match(/Ortak yok/g)).toHaveLength(1);
    expect(o.secim).toEqual(HEPSI);
    expect(o.gerekce).toContain('Mayıs 2029');
    expect(o.gerekce).toContain('Borç yok');
    expect(o.gerekce.match(/Borç yok/g)).toHaveLength(1);
    expect(o.gerekce).not.toContain('.;');
    expect(o.saglam).toBe(true);
  });

  it('en erken tarihte eşitlikte daha az seçimli bileşimi seçer', () => {
    const v = sentetikVarsayimlar((k) => {
      k.secenekGirdileri.ihya.gun = 0;
      k.secenekGirdileri.bagkur.borc = { tur: 'bilinmiyor', neden: 'Borç yok' };
    });
    expect(planlayici().oneri(v).secim).toEqual(sec('110'));
  });

  it('kesinti kalkınca öneri değişiyorsa sağlam değildir', () => {
    // Büyük borç: kesintiyle her yolda zaten tahsil edilir; kesinti yoksa ödememek kazançlı olur.
    const v = sentetikVarsayimlar((k) => {
      k.karsilastirmaSuresiYil = 40;
      k.secenekGirdileri.bagkur.borc = { tur: 'bilinen', tl: '1000000.00', kaynak: 'Sentetik büyük borç' };
      k.secenekGirdileri.bagkur.yalnizSskYolundaOdenecek = { tur: 'bilinen', tl: '0.00', kaynak: 'Yok' };
    });
    const o = planlayici().oneri(v);
    expect(o.tur).toBe('senaryoOnerisi');
    expect(o.secim).toEqual(HEPSI);
    expect(o.saglam).toBe(false);
    expect(planlayici().oneri(varsayimKopya(v, (k) => { k.borcKesintiOrani = 0; })).secim).toEqual(sec('101'));
  });

  it('bileşim adlarını Türkçe yazar', () => {
    expect(bilesimAdi(HIC)).toBe('Hiçbir şey ödememek');
    expect(bilesimAdi(HEPSI)).toBe('Askerlik borçlanması + Bağ-Kur borcunun ödenmesi + İhya');
  });
});

describe('EmeklilikPlanlayiciImpl — özellikler', () => {
  const tarihSirasi = (a: string | null, b: string | null) => (a === null ? 1 : b === null ? -1 : a.localeCompare(b));

  it('daha çok gün asla daha geç tarih vermez', () => {
    const p = planlayici();
    for (const anahtar of ['askerlik', 'bagkur', 'ihya'] as const) {
      let onceki: string | null = null;
      for (const gun of [0, 1, 29, 30, 31, 59, 60, 61, 100, 300]) {
        const v = sentetikVarsayimlar((k) => { k.secenekGirdileri[anahtar].gun = gun; });
        const s: Secim = { ...HIC, [anahtar]: true };
        const ay = p.yol(s, v).emeklilikAyi;
        if (onceki !== null) expect(tarihSirasi(ay, onceki), `${anahtar} ${gun}`).toBeLessThanOrEqual(0);
        onceki = ay;
      }
    }
    for (const s of BILESIM_SIRASI) {
      for (const k of ['askerlik', 'bagkur', 'ihya'] as const) {
        if (s[k]) continue;
        const v = sentetikVarsayimlar();
        expect(tarihSirasi(p.yol({ ...s, [k]: true }, v).emeklilikAyi, p.yol(s, v).emeklilikAyi)).toBeLessThanOrEqual(0);
      }
    }
  });

  it('ayda daha çok çalışma günü asla daha geç tarih vermez', () => {
    const p = planlayici();
    let onceki: string | null = null;
    for (let gun = 0; gun <= 30; gun += 1) {
      const ay = p.yol(HIC, sentetikVarsayimlar((k) => { k.gelecekAyBasinaGun = gun; })).emeklilikAyi;
      if (gun === 0) expect(ay).toBeNull();
      else if (onceki !== null) expect(tarihSirasi(ay, onceki)).toBeLessThanOrEqual(0);
      onceki = ay;
    }
  });

  it('kesinti borç bitince durur: uzun dönemde toplam kesinti kalan borca eşittir', () => {
    const p = planlayici();
    const v = sentetikVarsayimlar((k) => {
      k.karsilastirmaSuresiYil = 40;
      k.secenekGirdileri.bagkur.borc = { tur: 'bilinen', tl: '300000.00', kaynak: 'test' };
    });
    // Kesintisiz fark ile kesintili fark arasındaki tek ayrım: hiçbir şey ödemeyen yolun aylığından kesilen
    // kalan borç (300.000 − 50.000 ortak ödeme). 480 ayda 2.500 TL'lik kesinti 100. ayda durur.
    const kesintili = p.karsilastir(sec('010'), v);
    const kesintisiz = p.karsilastir(sec('010'), varsayimKopya(v, (k) => { k.borcKesintiOrani = 0; }));
    expect(kisa(kesintili.donemSonunda)).toBe('500000.00');
    expect(kisa(kesintisiz.donemSonunda)).toBe('250000.00');
  });

  it('geçersiz varsayımı reddeder', () => {
    const p = planlayici();
    const hatali: Array<(k: Varsayimlar) => void> = [
      (k) => { k.borcKesintiOrani = 0.3; },
      (k) => { k.karsilastirmaSuresiYil = 41; },
      (k) => { k.gelecekAyBasinaGun = 31; },
      (k) => { k.secenekGirdileri.askerlik.gun = 361; },
      (k) => { k.digerKesintilerTl = '-1.00'; },
      (k) => { k.secenekGirdileri.bagkur.yalnizSskYolundaOdenecek = { tur: 'bilinen', tl: '500000.00', kaynak: 'fazla' }; },
      (k) => { k.bagkurGecikmeAylikOran = Number.NaN; },
    ];
    for (const degistir of hatali) expect(() => p.yol(HIC, sentetikVarsayimlar(degistir))).toThrow(RangeError);
  });
});
