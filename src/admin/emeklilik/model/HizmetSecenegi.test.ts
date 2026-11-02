import { describe, expect, it } from 'vitest';
import { MEVZUAT_2026 } from './mevzuat';
import { AskerlikBorclanmasi, BagkurBorcOdemesi, HizmetSecenegi, Ihya } from './HizmetSecenegi';
import { sentetikVarsayimlar } from './testDestek';

describe('HizmetSecenegi alt sınıfları', () => {
  const secenekler: HizmetSecenegi[] = [new AskerlikBorclanmasi(360), new BagkurBorcOdemesi(), new Ihya()];

  it('ortak soyut sınıftan türer ve anahtarları ayrıdır', () => {
    for (const s of secenekler) expect(s).toBeInstanceOf(HizmetSecenegi);
    expect(secenekler.map((s) => s.anahtar)).toEqual(['askerlik', 'bagkur', 'ihya']);
    expect(secenekler.map((s) => s.gun(sentetikVarsayimlar()))).toEqual([360, 600, 500]);
  });

  it('dönemi 2008 öncesi/sonrası olarak taşır; borçlanılan günler asgari kattan sayılır', () => {
    expect(new AskerlikBorclanmasi(360).donem).toBe('once2008');
    expect(new AskerlikBorclanmasi(360, 'sonra2008').donem).toBe('sonra2008');
    expect(new Ihya().donem).toBe('sonra2008');
    expect(new BagkurBorcOdemesi().donem).toBe('sonra2008');
    for (const s of secenekler) expect(s.kazancKati()).toBe(1);
  });

  it('askerlik ve ihya bedeli gün × günlük bedeldir; bedel yoksa mevzuattan (alt sınır × oran)', () => {
    const v = sentetikVarsayimlar((k) => {
      k.secenekGirdileri.askerlik.gunlukBedelTl = null;
      k.secenekGirdileri.ihya.gunlukBedelTl = null;
    });
    const askerlik = new AskerlikBorclanmasi(360).maliyet(v, MEVZUAT_2026);
    expect(askerlik).toMatchObject({ tur: 'bilinen', tl: '178362.00' });
    expect(askerlik.tur === 'bilinen' && askerlik.kaynak).toContain('₺495,45');
    expect(new Ihya().maliyet(v, MEVZUAT_2026)).toMatchObject({ tur: 'bilinen', tl: '247725.00' });
  });

  it('yuvarlama sırası: günlük bedel önce kuruşa yuvarlanır, sonra gün sayısıyla çarpılır (tam bölünmeyen alt sınır)', () => {
    // 1.000,01 × %45 = 450,0045 → ₺450,00; 360 gün × ₺450,00 = ₺162.000,00 (yuvarlanmadan çarpılsa ₺162.001,62 olurdu).
    const mevzuat = { ...MEVZUAT_2026, gunlukKazancAltSiniriTl: '1000.01' };
    const v = sentetikVarsayimlar((k) => { k.secenekGirdileri.askerlik.gunlukBedelTl = null; });
    const askerlik = new AskerlikBorclanmasi(360);
    expect(askerlik.gunlukBedel(v, mevzuat).bedel.tlMetni()).toBe('450.00');
    expect(askerlik.maliyet(v, mevzuat)).toMatchObject({ tur: 'bilinen', tl: '162000.00' });
    // Yarım kuruş sıfırdan uzağa: 1.000,10 × %45 = 450,045 → ₺450,05; 500 gün → ₺225.025,00.
    const yarim = { ...MEVZUAT_2026, gunlukKazancAltSiniriTl: '1000.10' };
    const ihya = sentetikVarsayimlar((k) => { k.secenekGirdileri.ihya.gunlukBedelTl = null; });
    expect(new Ihya().maliyet(ihya, yarim)).toMatchObject({ tur: 'bilinen', tl: '225025.00' });
  });

  it('elle girilen günlük bedeli kullanır ve kaynağı ayırır', () => {
    const v = sentetikVarsayimlar((k) => { k.secenekGirdileri.askerlik.gunlukBedelTl = '600.00'; });
    const elle = new AskerlikBorclanmasi(360).maliyet(v, MEVZUAT_2026);
    expect(elle).toMatchObject({ tur: 'bilinen', tl: '216000.00' });
    expect(elle.tur === 'bilinen' && elle.kaynak).toContain('girilen günlük bedel');
    // Varsayılan varsayımlar mevzuat bedelini kopyalar; kaynağı yine mevzuattır, "girilen" yazılmaz.
    const varsayilan = new AskerlikBorclanmasi(360).maliyet(sentetikVarsayimlar(), MEVZUAT_2026);
    expect(varsayilan.tur === 'bilinen' && varsayilan.kaynak).toContain('2026 asgari');
    expect(varsayilan.tur === 'bilinen' && varsayilan.kaynak).not.toContain('girilen');
  });

  it('Bağ-Kur maliyeti borç bilgisidir; aralık ve bilinmiyor aynen geçer', () => {
    const b = new BagkurBorcOdemesi();
    expect(b.maliyet(sentetikVarsayimlar(), MEVZUAT_2026)).toEqual({
      tur: 'aralik', altTl: '300000.00', ustTl: '450000.00', kaynak: 'Sentetik aralık',
    });
    const bilinmiyor = sentetikVarsayimlar((k) => { k.secenekGirdileri.bagkur.borc = { tur: 'bilinmiyor', neden: 'Düzeltilmiş borç yok' }; });
    expect(b.maliyet(bilinmiyor, MEVZUAT_2026)).toEqual({ tur: 'bilinmiyor', neden: 'Düzeltilmiş borç yok' });
  });

  it('geçersiz gün sayısını reddeder; askerlik azami günü aşamaz', () => {
    expect(() => new AskerlikBorclanmasi(360).gun(sentetikVarsayimlar((k) => { k.secenekGirdileri.askerlik.gun = 361; }))).toThrow(RangeError);
    expect(() => new Ihya().gun(sentetikVarsayimlar((k) => { k.secenekGirdileri.ihya.gun = -1; }))).toThrow(RangeError);
    expect(() => new BagkurBorcOdemesi().gun(sentetikVarsayimlar((k) => { k.secenekGirdileri.bagkur.gun = 1.5; }))).toThrow(RangeError);
  });

  it('Türkçe ad ve açıklama verir', () => {
    expect(secenekler.map((s) => s.ad)).toEqual(['Askerlik borçlanması', 'Bağ-Kur borcunun ödenmesi', 'İhya']);
    expect(new AskerlikBorclanmasi(360).aciklama(sentetikVarsayimlar(), MEVZUAT_2026)).toContain('360 gün');
  });
});
