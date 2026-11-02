import { describe, expect, it } from 'vitest';
import type { Secim, TutarBilgisi, YolSonucu } from '../contract';
import { Ay } from './Ay';
import { Para } from './Para';
import { Tutar } from './Tutar';
import { YolKarsilastirici, type KarsilastirilabilirYol, type KarsilastirmaKosullari } from './YolKarsilastirici';
import { kisa } from './testDestek';

const HIC: Secim = { askerlik: false, bagkur: false, ihya: false };

/** Sabit net aylıklı sahte yol (kesinti yok). */
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
    emekliGeliri: (n: number) => aylik.carpTam(n),
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

  it('yol referanstan geçse fark işaret değiştirir', () => {
    const k = new YolKarsilastirici(kosul()).karsilastir(ref, askerlik);
    expect(k.erkenAy).toBe(-12);
    expect(kisa(k.ekOdeme)).toBe('-178362.00');
    expect(kisa(k.donemSonunda)).toBe('-121638.00');
    expect(k.geriKazanmaAylikSayisi).toBe(0);
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
