import { describe, expect, it } from 'vitest';
import { LABELS } from '../../../../shared/schema.ts';
import type { Manifest, PurchaseNeedRecord, Relation } from '../../data/types';
import {
  IS_KIM_ETIKETLERI,
  MESLEK_ETIKETLERI,
  adaylariTuret,
  iletisimBaglantisi,
  taraflarKaynagi,
  taraflariTuret,
  teklifGruplari,
} from './model';

// Taraflar ve teklifler sayfasının saf modeli. Kaynak: data-platform/normalize.mjs (usta satırı → kind 'provider',
// koleksiyon 'providers'; teklif_tl → amounts.quote; sayi alanları ondalık metin; bagli_idler → associated_with ilişkisi)
// ve shared/schema.ts (is_kim / meslek kodları ve Türkçe etiketleri). Eksik bilgi null döner; sunum katmanı adıyla yazar.

const TENANT = '89bb71d8-2e82-56a2-b231-843cbc783ba2';
let seq = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

function kayit(over: Partial<PurchaseNeedRecord> & { kind: string }): PurchaseNeedRecord {
  return {
    id: uuid(),
    tenant_id: TENANT,
    label: 'Kayıt',
    category_term_id: null,
    phase_term_id: null,
    context_term_ids: [],
    state_snapshot: { decision: null, fulfillment: null, inspection: null, payment: null },
    state_term_ids: { decision: null, fulfillment: null, inspection: null, payment: null },
    amounts: {},
    dates: {},
    room_id: null,
    deleted_at: null,
    ...over,
  };
}
const tl = (amount: string) => ({ amount, currency: 'TRY' });
const iliski = (source_id: string, target_id: string, kind = 'associated_with'): Relation => ({ id: uuid(), tenant_id: TENANT, kind, source_id, target_id });

describe('iletisimBaglantisi › tel: ve WhatsApp', () => {
  it('Türkiye cep numarası: tel:+90… ve wa.me/90…; yazım biçimi önemli değil', () => {
    for (const raw of ['0532 123 45 67', '+90 532 123 45 67', '(0532) 123-45-67', '5321234567', '0090 532 123 4567', 5321234567]) {
      expect(iletisimBaglantisi(raw), String(raw)).toEqual({ tel: 'tel:+905321234567', whatsapp: 'https://wa.me/905321234567' });
    }
  });

  it('sabit hat aranır ama WhatsApp bağlantısı verilmez (cep değil)', () => {
    expect(iletisimBaglantisi('0212 555 10 10')).toEqual({ tel: 'tel:+902125551010', whatsapp: null });
  });

  it('yurt dışı (+ ile) numara olduğu gibi: tel ve WhatsApp', () => {
    expect(iletisimBaglantisi('+44 20 7946 0958')).toEqual({ tel: 'tel:+442079460958', whatsapp: 'https://wa.me/442079460958' });
  });

  it('boş, metin ya da eksik haneli değer bağlantı üretmez (null → "Bilinmiyor")', () => {
    for (const raw of [null, undefined, '', '   ', 'yok', '123', '0532 123', '+1', true, {}]) {
      expect(iletisimBaglantisi(raw), String(raw)).toBeNull();
    }
  });
});

describe('taraflariTuret › usta (provider) kayıtları', () => {
  it('ad, meslek etiketi, telefon, iletişim, teklif, süre, garanti, MYK ve kaynak; eksik alan null', () => {
    const ali = kayit({
      kind: 'provider',
      label: 'Usta Ali',
      source_record_id: 'kalem-050',
      attributes: { ad: 'Usta Ali', meslek: 'elektrik', telefon: '0532 123 45 67', teklif_sure_gun: '5', garanti_ay: '24', myk_dogrulandi: true },
      amounts: { quote: tl('17450.00') },
      provenance: { source_key: 'household', source_id: uuid(), sheet_id: 101, sheet_title: 'app_kalemler', row: 50, column: null, a1: '50:50' },
    });
    const bos = kayit({ kind: 'provider', label: 'kalem-051', source_record_id: 'kalem-051', attributes: { ad: null, meslek: null, telefon: null, myk_dogrulandi: false } });
    const silinmis = kayit({ kind: 'provider', label: 'Eski', attributes: { ad: 'Eski' }, deleted_at: '2026-10-20T09:30:00.000Z' });

    const taraflar = taraflariTuret([bos, ali, silinmis]);
    expect(taraflar.map((t) => t.id)).toEqual([ali.id, bos.id]);
    expect(taraflar[0]).toEqual({
      id: ali.id,
      ad: 'Usta Ali',
      kod: 'kalem-050',
      meslek: 'Elektrik',
      telefon: '0532 123 45 67',
      iletisim: { tel: 'tel:+905321234567', whatsapp: 'https://wa.me/905321234567' },
      teklif: tl('17450.00'),
      sureGun: '5',
      garantiAy: '24',
      myk: true,
      kaynak: 'app_kalemler · satır 50',
    });
    // Ad yoksa uydurulmaz (etiket yalnız satır kimliğidir); bilinmeyen MYK false değil, kaynakta yazan false.
    expect(taraflar[1]).toMatchObject({ ad: null, kod: 'kalem-051', meslek: null, telefon: null, iletisim: null, teklif: null, sureGun: null, garantiAy: null, myk: false, kaynak: null });
  });

  it('telefon geçersizse ham metin korunur, bağlantı üretilmez; bilinmeyen meslek kodu olduğu gibi', () => {
    const t = taraflariTuret([kayit({ kind: 'provider', label: 'X', attributes: { ad: 'X', meslek: 'cilingir', telefon: 'sor' } })])[0]!;
    expect(t).toMatchObject({ telefon: 'sor', iletisim: null, meslek: 'cilingir', myk: null });
  });
});

describe('teklifGruplari › teklifler kayıt bazında; karşılaştırma yalnız aynı kayda bağlı tekliflerde', () => {
  it('kaydın kendi teklifi tek başına grup olur; taraf bilinmiyor, plan ve gerçek ayrı taşınır', () => {
    const is = kayit({ kind: 'work_order', label: 'Boya işi', source_record_id: 'kalem-002', amounts: { quote: tl('9000'), planned: tl('8500.00'), actual: null } });
    const teklifsiz = kayit({ kind: 'work_order', label: 'Teklifsiz', amounts: { planned: tl('100') } });
    const gruplar = teklifGruplari({ kayitlar: [is, teklifsiz] });
    expect(gruplar).toHaveLength(1);
    expect(gruplar[0]).toMatchObject({
      kayitId: is.id, kayitAdi: 'Boya işi', kayitKodu: 'kalem-002', tur: 'is', durum: 'bagli',
      plan: tl('8500.00'), gercek: null, enDusukKey: null, fark: null, paraBirimleri: ['TRY'],
    });
    expect(gruplar[0]!.teklifler).toEqual([expect.objectContaining({ tarafId: null, tarafAdi: null, tutar: tl('9000') })]);
  });

  it('usta teklifleri associated_with (iki yönde de) ile alıma bağlanır; en düşük tekil fiyat ve farkı kesin', () => {
    const alim = kayit({ kind: 'purchase_need', label: 'Bulaşık makinesi', source_record_id: 'ALM-0137', amounts: { planned: tl('20000.00') } });
    const beyaz = kayit({ kind: 'provider', label: 'Beyaz Ev Elektrik', attributes: { ad: 'Beyaz Ev Elektrik', telefon: '0532 000 00 01', teklif_sure_gun: '5', garanti_ay: '36' }, amounts: { quote: tl('17450') } });
    const mutfak = kayit({ kind: 'provider', label: 'Mutfak Dünyası', attributes: { ad: 'Mutfak Dünyası' }, amounts: { quote: tl('18900.00') } });
    const fiyatsiz = kayit({ kind: 'provider', label: 'Çevrim içi mağaza', attributes: { ad: 'Çevrim içi mağaza' }, amounts: { quote: null } });
    const gruplar = teklifGruplari({
      kayitlar: [alim],
      taraflar: [beyaz, mutfak, fiyatsiz],
      iliskiler: [iliski(beyaz.id, alim.id), iliski(alim.id, mutfak.id), iliski(fiyatsiz.id, alim.id), iliski(beyaz.id, alim.id, 'located_in')],
    });
    expect(gruplar).toHaveLength(1);
    const grup = gruplar[0]!;
    expect(grup).toMatchObject({ kayitId: alim.id, kayitAdi: 'Bulaşık makinesi', tur: 'alim', plan: tl('20000.00'), gercek: null });
    // Fiyatsız usta teklif değildir: listede yok (taraflar bölümünde "Fiyat yok" yazar).
    expect(grup.teklifler.map((t) => t.tarafAdi)).toEqual(['Beyaz Ev Elektrik', 'Mutfak Dünyası']);
    expect(grup.teklifler[0]).toMatchObject({ sureGun: '5', garantiAy: '36', iletisim: { tel: 'tel:+905320000001', whatsapp: 'https://wa.me/905320000001' } });
    expect(grup.enDusukKey).toBe(grup.teklifler[0]!.key);
    expect(grup.fark).toEqual(tl('1450.00'));
  });

  it('eşit en düşük fiyat ya da birden çok para birimi: "en düşük" seçilmez', () => {
    const a = kayit({ kind: 'work_order', label: 'A', amounts: { quote: tl('100.00') } });
    const u1 = kayit({ kind: 'provider', label: 'U1', attributes: { ad: 'U1' }, amounts: { quote: tl('100') } });
    const b = kayit({ kind: 'work_order', label: 'B', amounts: { quote: tl('100') } });
    const u2 = kayit({ kind: 'provider', label: 'U2', attributes: { ad: 'U2' }, amounts: { quote: { amount: '90', currency: 'EUR' } } });
    const gruplar = teklifGruplari({ kayitlar: [a, b], taraflar: [u1, u2], iliskiler: [iliski(u1.id, a.id), iliski(u2.id, b.id)] });
    const ga = gruplar.find((g) => g.kayitId === a.id)!;
    const gb = gruplar.find((g) => g.kayitId === b.id)!;
    expect(ga.teklifler).toHaveLength(2);
    expect(ga.enDusukKey).toBeNull();
    expect(ga.fark).toBeNull();
    expect(gb.paraBirimleri).toEqual(['EUR', 'TRY']);
    expect(gb.enDusukKey).toBeNull();
  });

  it('bağı olmayan ya da birden çok kayda bağlı usta teklifi uydurulmuş bir kayda yazılmaz', () => {
    const a = kayit({ kind: 'work_order', label: 'A' });
    const b = kayit({ kind: 'purchase_need', label: 'B' });
    const bagsiz = kayit({ kind: 'provider', label: 'Bağsız', attributes: { ad: 'Bağsız' }, amounts: { quote: tl('10') } });
    const cift = kayit({ kind: 'provider', label: 'Çift', attributes: { ad: 'Çift' }, amounts: { quote: tl('20') } });
    const gruplar = teklifGruplari({ kayitlar: [a, b], taraflar: [bagsiz, cift], iliskiler: [iliski(cift.id, a.id), iliski(cift.id, b.id)] });
    expect(gruplar.map((g) => [g.durum, g.kayitId, g.teklifler.map((t) => t.tarafAdi)])).toEqual([
      ['bagsiz', null, ['Bağsız']],
      ['belirsiz', null, ['Çift']],
    ]);
  });

  it('karşılaştırması olan (≥2 teklif) gruplar önce; sonra kayıt adına göre; silinmiş kayıt ve usta sayılmaz', () => {
    const z = kayit({ kind: 'work_order', label: 'Zemin', amounts: { quote: tl('5') } });
    const c = kayit({ kind: 'purchase_need', label: 'Çekyat', amounts: { quote: tl('7') } });
    const k = kayit({ kind: 'purchase_need', label: 'Koltuk', amounts: { quote: tl('9') } });
    const silinmis = kayit({ kind: 'purchase_need', label: 'Silinmiş', amounts: { quote: tl('1') }, deleted_at: '2026-10-20T09:30:00.000Z' });
    const u = kayit({ kind: 'provider', label: 'U', attributes: { ad: 'U' }, amounts: { quote: tl('6') } });
    const uSil = kayit({ kind: 'provider', label: 'Sil', attributes: { ad: 'Sil' }, amounts: { quote: tl('2') }, deleted_at: '2026-10-20T09:30:00.000Z' });
    const gruplar = teklifGruplari({ kayitlar: [z, c, k, silinmis], taraflar: [u, uSil], iliskiler: [iliski(u.id, z.id), iliski(uSil.id, c.id)] });
    expect(gruplar.map((g) => g.kayitAdi)).toEqual(['Zemin', 'Çekyat', 'Koltuk']);
    expect(gruplar[0]!.teklifler.map((t) => t.tutar.amount)).toEqual(['5', '6']);
  });
});

describe('adaylariTuret › iş emirlerindeki İşi yapan (is_kim) ve usta metni', () => {
  it('ad bazında toplanır; iş sayısı ve kaynak alan; silinmiş kayıt sayılmaz', () => {
    const r1 = kayit({ kind: 'work_order', label: 'İş 1', attributes: { is_kim: ['elektrikci', 'boyaci'] } });
    const r2 = kayit({ kind: 'work_order', label: 'İş 2', attributes: { is_kim: 'elektrikci' } });
    const r3 = kayit({ kind: 'work_order', label: 'İş 3', source_attributes: { usta: 'Perde Atölyesi' } });
    const r4 = kayit({ kind: 'work_order', label: 'İş 4', attributes: { is_kim: ['elektrikci'] }, deleted_at: '2026-10-20T09:30:00.000Z' });
    expect(adaylariTuret([r1, r2, r3, r4])).toEqual([
      { ad: 'elektrikci', alanlar: ['is_kim'], isler: ['İş 1', 'İş 2'] },
      { ad: 'boyaci', alanlar: ['is_kim'], isler: ['İş 1'] },
      { ad: 'Perde Atölyesi', alanlar: ['usta'], isler: ['İş 3'] },
    ]);
  });
});

describe('etiketler › shared/schema ile aynı', () => {
  it('is_kim ve meslek kodlarının Türkçe etiketleri tek kaynakla eşleşir', () => {
    expect(IS_KIM_ETIKETLERI).toEqual(LABELS.is_kim);
    expect(MESLEK_ETIKETLERI).toEqual(LABELS.meslek);
  });
});

describe('taraflarKaynagi › providers koleksiyonu manifestte var mı, panel okuyabiliyor mu', () => {
  const manifest = (files: Manifest['files']): Manifest => ({
    schemaVersion: 1, generation_id: 'a'.repeat(64), tenant_id: TENANT, storage_policy: 'private_only', files, counts: {}, sources: [],
  });
  const parca = { path: 'data/providers/household/00000.json', kind: 'partition' as const, sha256: 'b'.repeat(64), bytes: 10, collection: 'providers', count: 3 };

  it('manifest yokken bilinmez; parça yoksa "yok"; varsa ve sözleşme okuyamıyorsa "okunamiyor", okuyorsa "okunur" + sayı', () => {
    expect(taraflarKaynagi(null, true)).toEqual({ durum: 'bilinmiyor', sayi: null });
    expect(taraflarKaynagi(manifest([]), true)).toEqual({ durum: 'yok', sayi: 0 });
    expect(taraflarKaynagi(manifest([{ ...parca, kind: 'raw' }]), true)).toEqual({ durum: 'yok', sayi: 0 });
    expect(taraflarKaynagi(manifest([parca]), false)).toEqual({ durum: 'okunamiyor', sayi: 3 });
    expect(taraflarKaynagi(manifest([parca, { ...parca, path: 'data/providers/household/00001.json', count: 2 }]), true)).toEqual({ durum: 'okunur', sayi: 5 });
    expect(taraflarKaynagi(manifest([{ ...parca, count: undefined }]), true)).toEqual({ durum: 'okunur', sayi: null });
  });
});
