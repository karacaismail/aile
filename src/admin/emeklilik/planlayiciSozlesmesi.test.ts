// Planlayıcı sözleşme testi: gerçek model (model/) ve ViewModel testlerinin sahte planlayıcısı (viewmodel/test/) aynı
// EmeklilikPlanlayici sözleşmesini aynı biçimde uygular. Kapsam yalnız iki uygulamada aynı olması gereken tutar dışı
// davranıştır:
//   - yolKarsilastir'da elle aylık anahtarı yoksa yolun aylığı seçili modeldir, anahtar varsa (null dahil) aylık elle
//     modeldir ve null "Elle aylık girilmedi" adıyla bilinmiyordur;
//   - geri kazanmanın anlamı: 0 yalnız geri kazanılacak bir şey yokken ("Gerekmez"; hiçbir şey ödemeyen yol kendisiyle),
//     ek ödemeli yolda 0 değildir (ay sayısı ya da null).
// Kapsam dışı: tutarlar ve geri kazanmanın ay sayısı. Sahte planlayıcı biçim testleri için basitleştirilmiştir (gerçek
// mevzuat hesabı ve sözleşmenin başa baş tanımı değildir); bunlar gerçek modelin testlerindedir
// (model/EmeklilikPlanlayici.test.ts, model/YolKarsilastirici.test.ts).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EmeklilikPlanlayici, EmeklilikProfili, Secim, TlMetni } from './contract';
import { MEVZUAT_2026, emeklilikPlanlayicisiOlustur } from './model';
import { SahtePlanlayici } from './viewmodel/test/SahtePlanlayici';

const PROFIL = JSON.parse(readFileSync(resolve(__dirname, '../../../fixtures/emeklilik/profil-sentetik.json'), 'utf8')) as EmeklilikProfili;
const IHYALI: Secim = { askerlik: true, bagkur: false, ihya: true };
const IHYASIZ: Secim = { askerlik: true, bagkur: false, ihya: false };

const planlayicilar: Array<[string, () => EmeklilikPlanlayici]> = [
  ['gerçek model', () => emeklilikPlanlayicisiOlustur(PROFIL, MEVZUAT_2026)],
  ['sahte planlayıcı', () => new SahtePlanlayici(PROFIL)],
];

describe.each(planlayicilar)('EmeklilikPlanlayici sözleşmesi › %s', (_ad, olustur) => {
  const karsilastir = (elleAylik?: { a?: TlMetni | null; b?: TlMetni | null }) => {
    const p = olustur();
    return p.yolKarsilastir(IHYALI, IHYASIZ, p.varsayilanVarsayimlar(), elleAylik);
  };

  it('elle aylık verilmezse ya da anahtar yoksa iki yolun aylığı seçili modeldir', () => {
    for (const elle of [undefined, {}]) {
      const k = karsilastir(elle);
      expect(k.yol.aylikModeli, JSON.stringify(elle)).toBe('sgkReferans');
      expect(k.referans.aylikModeli).toBe('sgkReferans');
      expect(k.yol.aylik).toMatchObject({ tur: 'bilinen', tl: PROFIL.sgkReferansAylik.tl });
      expect(k.referans.aylik).toMatchObject({ tur: 'bilinen', tl: PROFIL.sgkReferansAylik.tl });
    }
  });

  it('dolu anahtar yalnız o yolun aylığını elle yapar; diğer yol seçili modelde kalır', () => {
    const k = karsilastir({ a: '30000.00' });
    expect(k.yol.aylikModeli).toBe('elle');
    expect(k.yol.aylik).toMatchObject({ tur: 'bilinen', tl: '30000.00' });
    expect(k.referans.aylikModeli).toBe('sgkReferans');
    const b = karsilastir({ b: '20000.00' });
    expect(b.yol.aylikModeli).toBe('sgkReferans');
    expect(b.referans).toMatchObject({ aylikModeli: 'elle', aylik: { tur: 'bilinen', tl: '20000.00' } });
  });

  it('null anahtar aylığı elle yapar ve adıyla bilinmiyor bırakır (tutar uydurulmaz)', () => {
    const k = karsilastir({ a: null });
    expect(k.yol.aylikModeli).toBe('elle');
    expect(k.yol.aylik).toEqual({ tur: 'bilinmiyor', neden: 'Elle aylık girilmedi.' });
    expect(k.donemSonunda.tur).toBe('bilinmiyor');
    expect(k.hesaplanamayanNeden).toContain('Elle aylık girilmedi');
    expect(k.referans.aylikModeli).toBe('sgkReferans');
  });

  it('geri kazanma 0 yalnız geri kazanılacak bir şey yokken: hiçbir şey ödemeyen yol kendisiyle 0, ek ödemeli yolda 0 değil', () => {
    const p = olustur();
    const tum = p.tumBilesimler(p.varsayilanVarsayimlar());
    expect(tum[0]!.geriKazanmaAylikSayisi).toBe(0);
    const ekOdemeli = tum.filter((k) => k.ekOdeme.tur === 'bilinen' && !/^-|^0\.00$/.test(k.ekOdeme.tl));
    expect(ekOdemeli.length).toBeGreaterThan(0);
    for (const k of ekOdemeli) expect(k.geriKazanmaAylikSayisi).not.toBe(0);
  });
});
