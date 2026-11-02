import { describe, expect, it } from 'vitest';
import { MEVZUAT_2026 } from './mevzuat';
import {
  ElleAylikModeli,
  KazancTahminiAylikModeli,
  SgkReferansAylikModeli,
  aylikModeliOlustur,
  type AylikGirdisi,
  type AylikModeli,
} from './AylikModeli';
import { sentetikProfil } from './testDestek';

const girdi = (ask: number, bk: number, ih: number, calismaGunu: number, duzeltmeGunu = 0): AylikGirdisi => ({
  calismaGunu,
  duzeltmeGunu,
  secenekler: [
    { donem: 'once2008', gun: ask, kat: 1 },
    { donem: 'sonra2008', gun: bk, kat: 1 },
    { donem: 'sonra2008', gun: ih, kat: 1 },
  ],
});

describe('SgkReferansAylikModeli', () => {
  it('tarihli SGK referansını tüm yollarda sabit ve etiketli verir', () => {
    const m: AylikModeli = new SgkReferansAylikModeli(sentetikProfil());
    expect(m.ad).toBe('sgkReferans');
    const a = m.aylik(girdi(0, 0, 0, 2400));
    const b = m.aylik(girdi(360, 600, 500, 960));
    expect(a).toMatchObject({ tur: 'bilinen', tl: '25000.00' });
    expect(b).toEqual(a);
    expect(a.tur === 'bilinen' && a.kaynak).toContain('2 Kasım 2026');
    expect(a.tur === 'bilinen' && a.kaynak).toContain('3.500 gün');
    expect(m.aylik(null)).toEqual(a);
  });
});

describe('KazancTahminiAylikModeli (sade aracın formülü, kayıtlı günle kalibre)', () => {
  const model = () => new KazancTahminiAylikModeli(sentetikProfil(), MEVZUAT_2026);

  it('kalibrasyon noktasında (yalnız kayıtlı günler) SGK referansını verir', () => {
    expect(model().aylik(girdi(0, 0, 0, 0))).toMatchObject({ tur: 'bilinen', tl: '25000.00' });
  });

  it('altın değerler: sade aracın formülüyle aynı gün dökümünde aynı aylık', () => {
    // Kaynak: emeklilik-senaryolari.html satır 179-208, sentetik sabitlerle repo dışında çalıştırıldı.
    const beklenen: Array<[number, number, number, number, string]> = [
      [0, 0, 0, 2400, '38662.69'],
      [360, 0, 0, 2040, '38260.29'],
      [0, 600, 0, 1800, '35763.69'],
      [0, 0, 500, 1920, '36367.83'],
      [360, 600, 0, 1440, '35361.29'],
      [360, 0, 500, 1560, '35963.31'],
      [0, 600, 500, 1320, '33468.83'],
      [360, 600, 500, 960, '33064.31'],
    ];
    for (const [ask, bk, ih, calisma, tl] of beklenen) {
      expect(model().aylik(girdi(ask, bk, ih, calisma)), `${ask}/${bk}/${ih}`).toMatchObject({ tur: 'bilinen', tl });
    }
  });

  it('tahmin olduğunu ve modelini etiketinde yazar', () => {
    const a = model().aylik(girdi(0, 0, 0, 2400));
    expect(a.tur === 'bilinen' && a.kaynak).toMatch(/tahmin/i);
  });

  it('borçlanılan günler asgari kattan sayıldığı için aynı günü çalışmaktan düşük aylık verir', () => {
    const calisarak = model().aylik(girdi(0, 0, 0, 2400));
    const ihyayla = model().aylik(girdi(0, 0, 500, 1900));
    expect(calisarak.tur === 'bilinen' && ihyayla.tur === 'bilinen').toBe(true);
    if (calisarak.tur === 'bilinen' && ihyayla.tur === 'bilinen') {
      expect(Number(ihyayla.tl)).toBeLessThan(Number(calisarak.tl));
    }
  });

  it('en düşük aylık tabanını uygular', () => {
    const dusuk = new KazancTahminiAylikModeli(
      sentetikProfil((p) => { p.sgkReferansAylik.tl = '5000.00'; }),
      MEVZUAT_2026,
    );
    const a = dusuk.aylik(girdi(0, 0, 0, 2400));
    expect(a).toMatchObject({ tur: 'bilinen', tl: '23552.00' });
    expect(a.tur === 'bilinen' && a.kaynak).toMatch(/en düşük aylık/i);
  });

  it('SGK referansının günü kayıtlı günden farklıysa kalibre etmez', () => {
    const m = new KazancTahminiAylikModeli(sentetikProfil((p) => { p.sgkReferansAylik.gun = 3530; }), MEVZUAT_2026);
    expect(m.aylik(girdi(0, 0, 0, 2400))).toMatchObject({ tur: 'bilinmiyor' });
  });

  it('2008 öncesi ve sonrası günlerin toplamı kayıtlı güne eşit değilse kalibre etmez', () => {
    const m = new KazancTahminiAylikModeli(sentetikProfil((p) => { p.kayitliGun.once2008Gun = 1300; }), MEVZUAT_2026);
    expect(m.aylik(girdi(0, 0, 0, 2400))).toMatchObject({ tur: 'bilinmiyor' });
  });

  it('emeklilik ayı yoksa gün dökümü de yoktur', () => {
    expect(model().aylik(null)).toMatchObject({ tur: 'bilinmiyor' });
  });
});

describe('ElleAylikModeli ve fabrika', () => {
  it('elle girilen aylığı verir; girilmemişse bilinmiyor', () => {
    expect(new ElleAylikModeli('30000.00').aylik(null)).toMatchObject({ tur: 'bilinen', tl: '30000.00' });
    expect(new ElleAylikModeli(null).aylik(null)).toMatchObject({ tur: 'bilinmiyor' });
    expect(() => new ElleAylikModeli('30.000,00')).toThrow(RangeError);
  });

  it('ada göre stratejiyi seçer', () => {
    const p = sentetikProfil();
    expect(aylikModeliOlustur('sgkReferans', p, MEVZUAT_2026, null)).toBeInstanceOf(SgkReferansAylikModeli);
    expect(aylikModeliOlustur('kazancTahmini', p, MEVZUAT_2026, null)).toBeInstanceOf(KazancTahminiAylikModeli);
    expect(aylikModeliOlustur('elle', p, MEVZUAT_2026, '1.00')).toBeInstanceOf(ElleAylikModeli);
  });
});
