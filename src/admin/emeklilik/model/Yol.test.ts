// YolHesabi.emekliGeliri: emekliliğin ilk n ayında eline geçen net aylık toplamı. Her ay net = aylık − diğer kesintiler
// − o ayın borç kesintisi ve ayda en az 0'dır (net aylık eksiye düşmez; kişi aldığından fazlasını ödemez). Borç kesintisi
// borç bitince durur (son ay yalnız kalan). Aralıklı borç alt/üst senaryo ayrı hesaplanır; bilinmiyor yayılır.
import { describe, expect, it } from 'vitest';
import type { TutarBilgisi } from '../contract';
import { Ay } from './Ay';
import { KesintiPlani } from './KesintiPlani';
import { Para } from './Para';
import { Tutar } from './Tutar';
import { YolHesabi } from './Yol';
import { kisa } from './testDestek';

const tutar = (tl: string) => Tutar.bilinen(Para.tlden(tl), 'test');

function yol(aylikTl: string, digerTl: string, borc: TutarBilgisi | null): YolHesabi {
  const aylik = tutar(aylikTl);
  const kesinti = borc === null ? null : KesintiPlani.olustur({ oran: 0.1, tavan: 0.25, borc, aylik, gecikmeAylikOran: null, gecikmeAySayisi: 0 });
  return new YolHesabi({
    secim: { askerlik: false, bagkur: false, ihya: false },
    tarih: {
      emeklilikAyi: Ay.metinden('2033-05'), gunAyi: Ay.metinden('2033-05'), sureAyi: Ay.metinden('2029-03'), sinirlayanKosul: 'gun', sinirlayanAyrinti: null,
      yas: 47, calisarakTamamlananGun: 0, toplamGun: 5900, calismaGunu: 0,
    },
    eklenenGun: { askerlik: 0, bagkur: 0, ihya: 0 },
    kalemler: [],
    aylik,
    aylikModeli: 'sgkReferans',
    kesinti,
    digerKesinti: Para.tlden(digerTl),
  });
}

const gelir = (y: YolHesabi, n: number) => kisa(y.emekliGeliri(n).bilgi());

describe('YolHesabi.emekliGeliri', () => {
  it('diğer kesintiler aylığı aşarsa net aylık 0 sayılır, eksiye düşmez', () => {
    const y = yol('25000.00', '30000.00', null);
    expect(gelir(y, 0)).toBe('0.00');
    expect(gelir(y, 1)).toBe('0.00');
    expect(gelir(y, 120)).toBe('0.00');
  });

  it('borç kesintisi süresince net eksiye düşmez; borç bitince kalan net aylık gelir', () => {
    // 25.000 − 24.000 − 2.500 < 0 → 100 ay 0; sonra ayda 1.000.
    const y = yol('25000.00', '24000.00', { tur: 'bilinen', tl: '250000.00', kaynak: 'test' });
    expect(gelir(y, 1)).toBe('0.00');
    expect(gelir(y, 100)).toBe('0.00');
    expect(gelir(y, 101)).toBe('1000.00');
    expect(gelir(y, 110)).toBe('10000.00');
  });

  it('son kesinti ayında yalnız kalan borç kesilir; kırpma gerekmezse toplam aynı kalır', () => {
    // Kullanılabilir 25.000 − 22.000 = 3.000; tam kesinti ayı 2.500 → net 500; 101. ay kalan 1.000 → net 2.000; sonra 3.000.
    const y = yol('25000.00', '22000.00', { tur: 'bilinen', tl: '251000.00', kaynak: 'test' });
    expect(gelir(y, 100)).toBe('50000.00');
    expect(gelir(y, 101)).toBe('52000.00');
    expect(gelir(y, 102)).toBe('55000.00');
    const kesintisiz = yol('25000.00', '0.00', null);
    expect(gelir(kesintisiz, 12)).toBe('300000.00');
  });

  it('aralıklı borç alt/üst senaryo ayrı kırpılır; bilinmeyen borç bilinmiyor yapar', () => {
    const y = yol('25000.00', '24000.00', { tur: 'aralik', altTl: '250000.00', ustTl: '400000.00', kaynak: 'test' });
    // Alt: 100 ay 0, sonra 1.000 → 120. ayda 20.000. Üst: 160 ay 0 → 0.
    expect(gelir(y, 120)).toEqual(['0.00', '20000.00']);
    const bilinmeyen = yol('25000.00', '0.00', { tur: 'bilinmiyor', neden: 'Borç yok' });
    expect(bilinmeyen.emekliGeliri(12).bilgi()).toMatchObject({ tur: 'bilinmiyor', neden: 'Borç yok' });
  });
});
