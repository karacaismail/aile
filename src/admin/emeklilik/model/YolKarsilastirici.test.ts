import { describe, expect, it, vi } from 'vitest';
import type { Secim, TutarBilgisi, YolSonucu } from '../contract';
import { Ay } from './Ay';
import type { TarihSonucu } from './EmeklilikTarihiHesabi';
import { KesintiPlani } from './KesintiPlani';
import { Para } from './Para';
import { Tutar } from './Tutar';
import { YolHesabi } from './Yol';
import { YolKarsilastirici, type KarsilastirilabilirYol, type KarsilastirmaKosullari } from './YolKarsilastirici';
import { kisa } from './testDestek';

const HIC: Secim = { askerlik: false, bagkur: false, ihya: false };

/** Sabit net aylıklı sahte yol (kesinti yok). Gerçek yol gibi emekliliğin 0. ayında gelir yoktur (bilinen 0). */
function sahteYol(secim: Secim, ay: string | null, odeme: TutarBilgisi, aylikTl: string | null): KarsilastirilabilirYol {
  const aylik = aylikTl === null ? Tutar.bilinmiyor('Elle aylık girilmedi') : Tutar.bilinen(Para.tlden(aylikTl), 'test aylığı');
  const sonuc: YolSonucu = {
    secim, eklenenGun: { askerlik: 0, bagkur: 0, ihya: 0 }, calisarakTamamlananGun: 0,
    emeklilikAyi: ay, yas: null, sinirlayanKosul: ay === null ? null : 'gun',
    odeme, odemeKalemleri: [], aylik: aylik.bilgi(), aylikModeli: 'elle', kesinti: null,
  };
  return {
    secim,
    emeklilikAyi: ay === null ? null : Ay.metinden(ay),
    odeme: Tutar.bilgiden(odeme),
    emekliGeliri: (n: number) => (n === 0 ? Tutar.sifir('Aylık yok') : aylik.carpTam(n)),
    sonuc: () => sonuc,
  };
}

const tl = (t: string): TutarBilgisi => ({ tur: 'bilinen', tl: t, kaynak: 'test' });
const kosul = (k: Partial<KarsilastirmaKosullari> = {}): KarsilastirmaKosullari => ({
  ucret: Para.tlden('100000.00'), ortakOdeme: tl('50000.00'), karsilastirmaSuresiYil: 0, isUcretiDevam: true, ...k,
});

describe('YolKarsilastirici', () => {
  const ref = sahteYol(HIC, '2033-05', tl('0.00'), '25000.00');
  const askerlik = sahteYol({ ...HIC, askerlik: true }, '2032-05', tl('178362.00'), '25000.00');

  it('Codex aracıyla aynı: geç yolun emekliliğine kadar erken aylıklar − ek ödeme', () => {
    const k = new YolKarsilastirici(kosul()).karsilastir(askerlik, ref);
    expect(k.erkenAy).toBe(12);
    expect(kisa(k.ekOdeme)).toBe('178362.00');
    expect(kisa(k.gecYolEmekliOlunca)).toBe('121638.00');
    expect(kisa(k.donemSonunda)).toBe('121638.00');
    expect(k.geriKazanmaAylikSayisi).toBe(8);
    expect(k.hesaplanamayanNeden).toBeNull();
    expect(k.referans).toBe(ref.sonuc());
    expect(k.yol).toBe(askerlik.sonuc());
  });

  it('iş ücreti devam etmezse emekli olan yol ücretten vazgeçer (zamlı ücret); geri kazanma vazgeçilen ücreti de sayar', () => {
    const k = new YolKarsilastirici(kosul({ isUcretiDevam: false })).karsilastir(askerlik, ref);
    expect(kisa(k.gecYolEmekliOlunca)).toBe('-1078362.00');
    // Codex compareCashToSsk: aylık fark = aylık − vazgeçilen ücret < 0 → dönem içinde başa baş yok (geri dönmüyor).
    expect(k.geriKazanmaAylikSayisi).toBeNull();
    expect(k.geriKazanmaAraligi).toEqual({ alt: null, ust: null });
    expect(k.hesaplanamayanNeden).toBeNull();
  });

  it('geri kazanma: hiçbir şey ödemeyen yola göre birikimli farkın ilk kez sıfıra ulaştığı ay; geç yol emekli olduktan sonra da sayılır', () => {
    const yuksek = sahteYol({ ...HIC, askerlik: true }, '2032-05', tl('400000.00'), '30000.00');
    // İlk 12 ay yalnız bu yol aylık alır: 12 × 30.000 − 400.000 = −40.000. Sonra ayda 30.000 − 25.000 = 5.000 → 8 ay daha.
    const birYil = new YolKarsilastirici(kosul({ karsilastirmaSuresiYil: 1 })).karsilastir(yuksek, ref);
    expect(kisa(birYil.gecYolEmekliOlunca)).toBe('-40000.00');
    expect(kisa(birYil.donemSonunda)).toBe('20000.00');
    expect(birYil.geriKazanmaAylikSayisi).toBe(20);
    expect(birYil.geriKazanmaAraligi).toEqual({ alt: 20, ust: 20 });
    // Ortak dönem geç yolun emekliliğinde biterse başa baş dönem içinde yoktur: null ve neden yok ("geri dönmüyor").
    const donemsiz = new YolKarsilastirici(kosul()).karsilastir(yuksek, ref);
    expect(donemsiz.geriKazanmaAylikSayisi).toBeNull();
    expect(donemsiz.geriKazanmaAraligi).toEqual({ alt: null, ust: null });
    expect(donemsiz.hesaplanamayanNeden).toBeNull();
  });

  it('ortak dönem geç yolun emekliliğinden sonra seçilen yıl kadar sürer', () => {
    const erken = sahteYol({ askerlik: true, bagkur: true, ihya: true }, '2029-05', tl('726087.00'), '24000.00');
    const gec = sahteYol({ askerlik: true, bagkur: true, ihya: false }, '2030-09', tl('478362.00'), '26000.00');
    const k = new YolKarsilastirici(kosul({ karsilastirmaSuresiYil: 10 })).karsilastir(erken, gec);
    expect(k.erkenAy).toBe(16);
    expect(kisa(k.ekOdeme)).toBe('247725.00');
    expect(kisa(k.gecYolEmekliOlunca)).toBe('136275.00');
    expect(kisa(k.donemSonunda)).toBe('-103725.00');
    // Codex compareIhyaChoice: başa baş erken dönemde (16 ay) gelir: ⌈247.725 / 24.000⌉ = 11.
    expect(k.geriKazanmaAylikSayisi).toBe(11);
    const isiBirakan = new YolKarsilastirici(kosul({ karsilastirmaSuresiYil: 10, isUcretiDevam: false })).karsilastir(erken, gec);
    expect(kisa(isiBirakan.gecYolEmekliOlunca)).toBe('-1463725.00');
    expect(kisa(isiBirakan.donemSonunda)).toBe('-1703725.00');
    expect(isiBirakan.geriKazanmaAylikSayisi).toBeNull();
  });

  it('yol referanstan geçse fark işaret değiştirir; önde başlayıp eksiye düşen ve dönmeyen fark "geri dönmüyor"dur', () => {
    const k = new YolKarsilastirici(kosul()).karsilastir(ref, askerlik);
    expect(k.erkenAy).toBe(-12);
    expect(kisa(k.ekOdeme)).toBe('-178362.00');
    expect(kisa(k.donemSonunda)).toBe('-121638.00');
    // Ek ödeme yok (eksi): fark +178.362 ile başlar, 8. ayda eksiye düşer ve dönem içinde dönmez. "Gerekmez" (0) denmez.
    expect(k.geriKazanmaAylikSayisi).toBeNull();
    expect(k.geriKazanmaAraligi).toEqual({ alt: null, ust: null });
    expect(k.hesaplanamayanNeden).toBeNull();
  });

  it('ek ödeme yokken fark vazgeçilen ücretle eksiye düşerse "Gerekmez" (0) değildir: eksiye düştükten sonra ilk ≥ 0 ay; dönmüyorsa null', () => {
    // Ödemesiz erken yol 12 ay aylık 20.000 alır; referans o sırada 25.000 ücret alır: ayda −5.000, 12. ayda −60.000.
    // Sonra yol 20.000, referans 10.000 aylık: ayda +10.000; 6 ayda sıfıra döner → dönem başından 18. ay.
    const kosullar = kosul({ ucret: Para.tlden('25000.00'), isUcretiDevam: false, karsilastirmaSuresiYil: 1 });
    const odemesiz = sahteYol({ ...HIC, ihya: true }, '2032-05', tl('0.00'), '20000.00');
    const k = new YolKarsilastirici(kosullar).karsilastir(odemesiz, sahteYol(HIC, '2033-05', tl('0.00'), '10000.00'));
    expect(kisa(k.ekOdeme)).toBe('0.00');
    expect(kisa(k.gecYolEmekliOlunca)).toBe('-60000.00');
    expect(kisa(k.donemSonunda)).toBe('60000.00');
    expect(k.geriKazanmaAylikSayisi).toBe(18);
    expect(k.geriKazanmaAraligi).toEqual({ alt: 18, ust: 18 });
    // Referansın aylığı da 20.000 ise fark −60.000'de kalır: dönem içinde geri dönmüyor (null, neden yok).
    const donmuyor = new YolKarsilastirici(kosullar).karsilastir(odemesiz, sahteYol(HIC, '2033-05', tl('0.00'), '20000.00'));
    expect(donmuyor.geriKazanmaAylikSayisi).toBeNull();
    expect(donmuyor.geriKazanmaAraligi).toEqual({ alt: null, ust: null });
    expect(donmuyor.hesaplanamayanNeden).toBeNull();
  });

  it('ek ödeme yok ve fark dönem boyunca eksiye düşmüyorsa geri kazanma 0 ("Gerekmez")', () => {
    const odemesiz = sahteYol({ ...HIC, ihya: true }, '2032-05', tl('0.00'), '25000.00');
    const k = new YolKarsilastirici(kosul({ karsilastirmaSuresiYil: 1 })).karsilastir(odemesiz, ref);
    expect(kisa(k.donemSonunda)).toBe('300000.00');
    expect(k.geriKazanmaAylikSayisi).toBe(0);
    expect(k.geriKazanmaAraligi).toEqual({ alt: 0, ust: 0 });
    // Hiçbir şey ödemeyen yol kendisiyle: fark hep 0.
    expect(new YolKarsilastirici(kosul()).karsilastir(ref, ref).geriKazanmaAylikSayisi).toBe(0);
  });

  it('ek ödeme yokken sonraki aylar bilinmiyorsa geri kazanma da bilinmiyor (0 değil)', () => {
    const odemesiz = sahteYol({ ...HIC, ihya: true }, '2032-05', tl('0.00'), '25000.00');
    const k = new YolKarsilastirici(kosul({ karsilastirmaSuresiYil: 1 })).karsilastir(odemesiz, sahteYol(HIC, '2033-05', tl('0.00'), null));
    expect(k.geriKazanmaAylikSayisi).toBeNull();
    expect(k.geriKazanmaAraligi).toBeNull();
    expect(k.hesaplanamayanNeden).toContain('Elle aylık girilmedi');
  });

  it('Bağ-Kur yalnız bir yolda varsa ortak ödeme ek ödemeden düşülür; aralık sonuç aralıktır', () => {
    const bagkur = sahteYol({ ...HIC, bagkur: true }, '2031-09',
      { tur: 'aralik', altTl: '300000.00', ustTl: '450000.00', kaynak: 'test' }, '25000.00');
    const k = new YolKarsilastirici(kosul()).karsilastir(bagkur, ref);
    expect(k.erkenAy).toBe(20);
    expect(kisa(k.ekOdeme)).toEqual(['250000.00', '400000.00']);
    expect(kisa(k.donemSonunda)).toEqual(['100000.00', '250000.00']);
    expect(k.geriKazanmaAylikSayisi).toBe(16);
  });

  it('ortak ödeme bilinmiyorsa yalnız Bağ-Kur farkı olan karşılaştırma bilinmiyor olur', () => {
    const k = new YolKarsilastirici(kosul({ ortakOdeme: { tur: 'bilinmiyor', neden: 'Ortak tutar yok' } }));
    expect(kisa(k.karsilastir(askerlik, ref).donemSonunda)).toBe('121638.00');
    const bagkur = sahteYol({ ...HIC, bagkur: true }, '2031-09', tl('300000.00'), '25000.00');
    const sonuc = k.karsilastir(bagkur, ref);
    expect(sonuc.ekOdeme).toMatchObject({ tur: 'bilinmiyor' });
    expect(sonuc.donemSonunda).toMatchObject({ tur: 'bilinmiyor' });
    expect(sonuc.geriKazanmaAylikSayisi).toBeNull();
    expect(sonuc.hesaplanamayanNeden).toContain('Ortak tutar yok');
    expect(sonuc.erkenAy).toBe(20);
  });

  it('birden çok nedeni ayrı ayrı ve tekrarsız taşır', () => {
    const k = new YolKarsilastirici(kosul({ ortakOdeme: { tur: 'bilinmiyor', neden: 'Ortak tutar yok.' } }));
    const bagkur = sahteYol({ ...HIC, bagkur: true }, '2031-09', { tur: 'bilinmiyor', neden: 'Borç yok.' }, '25000.00');
    const sonuc = k.karsilastir(bagkur, ref);
    expect(sonuc.nedenler).toEqual(['Borç yok.', 'Ortak tutar yok.']);
    expect(sonuc.hesaplanamayanNeden).toBe('Borç yok; Ortak tutar yok.');
    expect(k.karsilastir(askerlik, ref).nedenler).toEqual([]);
  });

  it('aylık bilinmiyorsa mali sonuç bilinmiyor; ek ödeme bilinir', () => {
    const elle = sahteYol({ ...HIC, ihya: true }, '2032-01', tl('247725.00'), null);
    const k = new YolKarsilastirici(kosul()).karsilastir(elle, ref);
    expect(kisa(k.ekOdeme)).toBe('247725.00');
    expect(k.donemSonunda).toMatchObject({ tur: 'bilinmiyor' });
    expect(k.hesaplanamayanNeden).toContain('Elle aylık girilmedi');
  });

  it('tarih yoksa erken ay ve mali sonuç yoktur', () => {
    const tarihsiz = sahteYol({ ...HIC, askerlik: true }, null, tl('178362.00'), '25000.00');
    const k = new YolKarsilastirici(kosul()).karsilastir(tarihsiz, ref);
    expect(k.erkenAy).toBeNull();
    expect(k.gecYolEmekliOlunca).toMatchObject({ tur: 'bilinmiyor' });
    expect(k.donemSonunda).toMatchObject({ tur: 'bilinmiyor' });
    expect(k.hesaplanamayanNeden).toMatch(/tarih/i);
  });

  it('karşılaştırma süresini 0–40 yıl ile sınırlar', () => {
    expect(() => new YolKarsilastirici(kosul({ karsilastirmaSuresiYil: 41 }))).toThrow(RangeError);
    expect(() => new YolKarsilastirici(kosul({ karsilastirmaSuresiYil: 1.5 }))).toThrow(RangeError);
  });
});

// Geri kazanma taraması: yol aylık net gelirinin değiştiği ayları (kırılım) bildirirse karşılaştırıcı yalnız parça uçlarını
// hesaplar (parça içinde fark doğrusaldır, başa baş kapalı biçimde bulunur); bildirmezse her ayı tek tek tarar. İki yol bit
// düzeyinde aynı sonucu vermelidir. Gerçek YolHesabi ve KesintiPlani ile rastgele (tohumlu) koşullar.
describe('YolKarsilastirici › kırılımlı tarama', () => {
  /** Tohumlu, belirlenimci rastgele sayı (mulberry32). */
  function rastgele(tohum: number) {
    let a = tohum >>> 0;
    const sayi = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return { sayi, sec: <T>(liste: readonly T[]): T => liste[Math.floor(sayi() * liste.length)]!, tam: (enAz: number, enCok: number) => enAz + Math.floor(sayi() * (enCok - enAz + 1)) };
  }

  const aralik = (altTl: string, ustTl: string): TutarBilgisi => ({ tur: 'aralik', altTl, ustTl, kaynak: 'test' });
  const bilinmiyor: TutarBilgisi = { tur: 'bilinmiyor', neden: 'Test: bilinmiyor' };

  /** Gerçek yol hesabı: aylık − diğer kesinti − (varsa) borç kesintisi, ayda en az 0; kırılımlarını bildirir. */
  function gercekYol(secim: Secim, ay: string, g: { odeme: TutarBilgisi; aylik: TutarBilgisi; kesinti?: { oran: number; borc: TutarBilgisi }; digerTl?: string }): YolHesabi {
    const emeklilikAyi = Ay.metinden(ay);
    const tarih: TarihSonucu = {
      emeklilikAyi, gunAyi: emeklilikAyi, sureAyi: emeklilikAyi, sinirlayanKosul: 'gun', sinirlayanAyrinti: null, yas: null,
      calisarakTamamlananGun: 0, toplamGun: null, calismaGunu: null,
    };
    const aylik = Tutar.bilgiden(g.aylik);
    const kesinti = g.kesinti
      ? KesintiPlani.olustur({ oran: g.kesinti.oran, tavan: 0.25, borc: g.kesinti.borc, aylik, gecikmeAylikOran: null, gecikmeAySayisi: 0 })
      : null;
    return new YolHesabi({
      secim, tarih, eklenenGun: { askerlik: 0, bagkur: 0, ihya: 0 }, aylik, aylikModeli: 'elle', kesinti,
      kalemler: [{ anahtar: 'askerlik', tutar: Tutar.bilgiden(g.odeme) }], digerKesinti: Para.tlden(g.digerTl ?? '0.00'),
    });
  }

  /** Kırılım bildirmeyen sarmalayıcı: karşılaştırıcı her ayı ayrı tarar (başvuru davranışı). */
  const ayAy = (y: KarsilastirilabilirYol): KarsilastirilabilirYol => ({
    secim: y.secim, emeklilikAyi: y.emeklilikAyi, odeme: y.odeme, kalemler: y.kalemler,
    emekliGeliri: (n: number) => y.emekliGeliri(n), sonuc: () => y.sonuc(),
  });

  it('kırılımlı tarama her ayı tarayan başvuruyla bit düzeyinde aynı sonucu verir (400 rastgele koşul)', () => {
    const r = rastgele(20261102);
    const AYLIK = [tl('0.00'), tl('9000.00'), tl('25000.00'), tl('31234.57'), aralik('18000.00', '26000.00'), bilinmiyor];
    const BORC = [tl('1000.00'), tl('250000.00'), tl('251000.00'), aralik('100000.00', '400000.00'), aralik('5000.00', '5000.01'), bilinmiyor];
    const ODEME = [tl('0.00'), tl('178362.00'), tl('600000.00'), aralik('300000.00', '450000.00'), bilinmiyor];
    for (let i = 0; i < 400; i += 1) {
      const refAy = Ay.metinden('2033-05').ekle(r.tam(-24, 24));
      const yolAy = refAy.ekle(r.tam(-60, 12));
      const yolGirdisi = {
        odeme: r.sec(ODEME), aylik: r.sec(AYLIK), digerTl: r.sec(['0.00', '2000.00', '40000.00']),
        kesinti: r.sayi() < 0.5 ? { oran: r.sec([0.05, 0.1, 0.25]), borc: r.sec(BORC) } : undefined,
      };
      const refGirdisi = {
        odeme: r.sayi() < 0.7 ? tl('0.00') : r.sec(ODEME), aylik: r.sec(AYLIK), digerTl: r.sec(['0.00', '2000.00']),
        kesinti: r.sayi() < 0.7 ? { oran: r.sec([0.05, 0.1, 0.25]), borc: r.sec(BORC) } : undefined,
      };
      const yol = gercekYol({ ...HIC, askerlik: true }, yolAy.metin(), yolGirdisi);
      const referans = gercekYol(HIC, refAy.metin(), refGirdisi);
      const k = new YolKarsilastirici(kosul({
        ucret: Para.tlden(r.sec(['0.00', '25000.00', '100000.00'])), ortakOdeme: tl('0.00'),
        karsilastirmaSuresiYil: r.tam(0, 40), isUcretiDevam: r.sayi() < 0.5,
      }));
      const ad = JSON.stringify({ i, yolAy: yolAy.metin(), refAy: refAy.metin(), yolGirdisi, refGirdisi });
      expect(k.karsilastir(yol, referans), ad).toEqual(k.karsilastir(ayAy(yol), ayAy(referans)));
    }
  });

  it('kırılımlar yanlış bildirilirse (parça doğrusal değilse) sonuç yine ay ay taramayla aynıdır', () => {
    // Aylık 18. aydan sonra iki katına çıkan yol, kırılım olarak yalnız 1. ayı bildirir.
    const degisken = (ay: string, odemeTl: string): KarsilastirilabilirYol => {
      const temel = sahteYol({ ...HIC, askerlik: true }, ay, tl(odemeTl), '0.00');
      const aylikAy = (i: number) => Para.tlden(i <= 18 ? '1000.00' : '30000.00');
      return {
        ...temel,
        emekliGeliri: (n: number) => Tutar.bilinen(Array.from({ length: n }, (_, i) => aylikAy(i + 1)).reduce((t, p) => t.topla(p), Para.sifir()), 'test'),
        gelirKirilimlari: () => [1],
      };
    };
    const yol = degisken('2030-05', '100000.00');
    const ref = sahteYol(HIC, '2033-05', tl('0.00'), '25000.00');
    const k = new YolKarsilastirici(kosul({ karsilastirmaSuresiYil: 5 }));
    const sonuc = k.karsilastir(yol, ref);
    expect(sonuc).toEqual(k.karsilastir(ayAy(yol), ayAy(ref)));
    // 18 ayda 18.000; sonra ayda 30.000 (referans 2033-05'e kadar aylıksız): 100.000 − 18.000 = 82.000 → 3 ay daha.
    expect(sonuc.geriKazanmaAylikSayisi).toBe(21);
  });

  it('geri kazanma taraması dönem uzunluğundan bağımsızdır: kırılımlı yolda karşılaştırma başına emekliGeliri ≤ 64', () => {
    const borc = aralik('280000.00', '420000.00');
    const yol = gercekYol({ ...HIC, askerlik: true }, '2029-05', { odeme: tl('178362.00'), aylik: tl('25000.00') });
    const referans = gercekYol(HIC, '2033-05', { odeme: tl('0.00'), aylik: tl('25000.00'), kesinti: { oran: 0.1, borc } });
    const gelir = vi.spyOn(YolHesabi.prototype, 'emekliGeliri');
    try {
      for (const yil of [10, 40]) {
        gelir.mockClear();
        new YolKarsilastirici(kosul({ karsilastirmaSuresiYil: yil, isUcretiDevam: false })).karsilastir(yol, referans);
        expect(gelir.mock.calls.length, `${yil} yıl`).toBeLessThanOrEqual(64);
      }
    } finally {
      gelir.mockRestore();
    }
  });
});

