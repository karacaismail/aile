import { describe, it, expect } from 'vitest';
import type { Item, Setting } from '@shared/schema';
import {
  validateLayer, fieldErrors, completion, cctRange, roomBadges, estimateRange, parseRoomSetting, driverLoad,
  parseLevel, formatLevel, linkedPurchases, isDueSoon, groupByStep, roadmapActive, layerTitle, sortLayers, isComplete, MSG,
} from './rules';

const dogRoom = parseRoomSetting({ id: 's1', tip: 'oda', anahtar: 'salon', deger: JSON.stringify({ en_cm: 400, boy_cm: 500, kopek_erisim: 'serbest' }) });
const noDogRoom = parseRoomSetting({ id: 's2', tip: 'oda', anahtar: 'ebeveyn', deger: JSON.stringify({ kopek_erisim: 'kapali' }) });

const layer = (p: Partial<Item>): Item => ({ id: p.id ?? 'L', tip: 'aydinlatma', ad: 'Katman', oda: 'salon', ...p });

describe('parseRoomSetting', () => {
  it('JSON değeri okur; bozuk/boş değerde boş nesne', () => {
    expect(dogRoom).toEqual({ en_cm: 400, boy_cm: 500, kopek_erisim: 'serbest' });
    expect(parseRoomSetting(undefined)).toEqual({});
    expect(parseRoomSetting({ id: 'x', tip: 'oda', anahtar: 'wc', deger: '{bozuk' } as Setting)).toEqual({});
    expect(parseRoomSetting({ id: 'x', tip: 'oda', anahtar: 'wc', deger: JSON.stringify({ kopek_erisim: 'yok' }) })).toEqual({});
  });
});

describe('validateLayer', () => {
  it('geçerli katman: hata ve uyarı yok', () => {
    const v = validateLayer(layer({ katman_tur: 'ana', cct_min: 2700, cct_max: 4000, cri_min: 80 }), dogRoom);
    expect(v).toEqual({ errors: [], warnings: [] });
  });
  it('cct_min > cct_max hata', () => {
    const v = validateLayer(layer({ cct_min: 4000, cct_max: 2700 }), null);
    expect(v.errors).toContain(MSG.cct);
    expect(fieldErrors(layer({ cct_min: 4000, cct_max: 2700 }), null)).toHaveProperty('cct_max', MSG.cct);
  });
  it('görev katmanında CRI < 90 hata; CRI yoksa uyarı; ≥ 90 temiz', () => {
    expect(validateLayer(layer({ katman_tur: 'gorev', cri_min: 80 }), null).errors).toContain(MSG.gorevCri);
    expect(validateLayer(layer({ katman_tur: 'gorev' }), null).warnings).toContain(MSG.gorevCriMissing);
    expect(validateLayer(layer({ katman_tur: 'gorev', cri_min: 90 }), null)).toEqual({ errors: [], warnings: [] });
    expect(validateLayer(layer({ katman_tur: 'ana', cri_min: 80 }), null).errors).toEqual([]);
  });
  it('köpek erişebilen odada 90 cm altında açıkta şerit hata; kapalı odada ya da gizli montajda değil', () => {
    const low = layer({ acikta: true, montaj_yukseklik_cm: 40 });
    expect(validateLayer(low, dogRoom).errors).toContain(MSG.dog);
    expect(validateLayer(low, undefined).errors).toContain(MSG.dog); // oda ayarı yoksa güvenli varsayım
    expect(validateLayer(low, noDogRoom).errors).toEqual([]);
    expect(validateLayer(layer({ acikta: false, montaj_yukseklik_cm: 40 }), dogRoom).errors).toEqual([]);
    expect(validateLayer(layer({ acikta: true, montaj_yukseklik_cm: 90 }), dogRoom).errors).toEqual([]);
    expect(validateLayer(layer({ acikta: true }), dogRoom).errors).toEqual([]);
    expect(fieldErrors(low, dogRoom)).toHaveProperty('montaj_yukseklik_cm', MSG.dog);
  });
  it('sürücü payı %25: uzunluk × W/m × 1.25 > sürücü W hata', () => {
    expect(validateLayer(layer({ uzunluk_m: 4, w_per_m: 10, surucu_w: 49 }), null).errors).toContain(MSG.driver(50, 49));
    expect(validateLayer(layer({ uzunluk_m: 4, w_per_m: 10, surucu_w: 50 }), null).errors).toEqual([]);
    expect(validateLayer(layer({ uzunluk_m: 3, w_per_m: 7.2, surucu_w: 27 }), null).errors).toEqual([]); // kayan nokta payı
    expect(validateLayer(layer({ uzunluk_m: 4, w_per_m: 10 }), null).errors).toEqual([]);
    expect(driverLoad(layer({ uzunluk_m: 4, w_per_m: 10, surucu_w: 60 }))).toEqual({ loadW: 40, needW: 50, surucuW: 60, marginPct: 50, ok: true });
    expect(driverLoad(layer({ uzunluk_m: 4 }))).toBeNull();
  });
  it('5 m üzeri şerit iki uçtan besleme uyarısı', () => {
    expect(validateLayer(layer({ uzunluk_m: 5.5 }), null).warnings).toContain(MSG.longStrip);
    expect(validateLayer(layer({ uzunluk_m: 5 }), null).warnings).toEqual([]);
  });
  it('birden çok hata birlikte döner', () => {
    const v = validateLayer(layer({ katman_tur: 'gorev', cri_min: 70, cct_min: 5000, cct_max: 3000, acikta: true, montaj_yukseklik_cm: 20, uzunluk_m: 8, w_per_m: 10, surucu_w: 10 }), dogRoom);
    expect(v.errors).toHaveLength(4);
    expect(v.warnings).toEqual([MSG.longStrip]);
  });
});

describe('completion / cctRange / roomBadges / estimateRange', () => {
  const full = layer({ id: '1', katman_tur: 'ana', lux_min: 150, cct_min: 2700, cct_max: 4000, kontrol_cihaz: 'hue_dimmer', tahmini_tl_min: 1000, tahmini_tl_max: 1500 });
  const partial = layer({ id: '2', katman_tur: 'gorev', lux_min: 500, cct_min: 4000, cri_min: 95, tahmini_tl_min: 800 });
  const night = layer({ id: '3', katman_tur: 'gece', cct_max: 2200 });
  it('dolu = katman_tur + lux_min + cct_min + kontrol_cihaz', () => {
    expect(isComplete(full)).toBe(true);
    expect(isComplete(partial)).toBe(false);
    expect(completion([full, partial, night])).toEqual({ done: 1, total: 3, pct: 33 });
    expect(completion([])).toEqual({ done: 0, total: 0, pct: 0 });
  });
  it('cct aralığı katmanların min..max birleşimi; yoksa null', () => {
    expect(cctRange([full, partial, night])).toEqual({ min: 2200, max: 4000 });
    expect(cctRange([layer({})])).toBeNull();
    expect(cctRange([layer({ cct_min: 3000 })])).toEqual({ min: 3000, max: 3000 });
  });
  it('oda rozetleri: gece, görev CRI≥90, sayı, eksik temel katmanlar', () => {
    expect(roomBadges([full, partial, night])).toEqual({ gece: true, gorevCri90: true, count: 3, missing: [] });
    expect(roomBadges([full, layer({ katman_tur: 'gorev', cri_min: 80 })])).toEqual({ gece: false, gorevCri90: false, count: 2, missing: ['gece'] });
    expect(roomBadges([]).missing).toEqual(['ana', 'gorev', 'gece']);
  });
  it('tahmini TL aralığı toplamı', () => {
    expect(estimateRange([full, partial, night])).toEqual({ min: 1800, max: 2300, priced: 2, total: 3 });
  });
});

describe('katman başlığı ve sıralama', () => {
  it('katman_ad yoksa ad, o da yoksa tür etiketi', () => {
    expect(layerTitle(layer({ katman_ad: 'Tavan spot' }))).toBe('Tavan spot');
    expect(layerTitle(layer({ katman_tur: 'gorev', ad: 'Salon görev' }))).toBe('Salon görev');
    expect(layerTitle(layer({ katman_tur: 'gorev', ad: '' }))).toBe('Görev');
    expect(layerTitle(layer({ ad: '' }))).toBe('Katman');
  });
  it('tür sırasına göre: ana, ikincil, üçüncül, görev, gece, dekoratif; türsüz sona', () => {
    const s = sortLayers([layer({ id: 'a', katman_tur: 'gece' }), layer({ id: 'b' }), layer({ id: 'c', katman_tur: 'ana' }), layer({ id: 'd', katman_tur: 'gorev' })]);
    expect(s.map((x) => x.id)).toEqual(['c', 'd', 'a', 'b']);
  });
});

describe('sahne seviyeleri', () => {
  it('"katmanId:pct:cct" ayrıştırma ve biçimleme', () => {
    expect(parseLevel('L1:40:2700')).toEqual({ layerId: 'L1', pct: 40, cct: 2700 });
    expect(parseLevel('L1::')).toEqual({ layerId: 'L1', pct: null, cct: null });
    expect(parseLevel('L1')).toEqual({ layerId: 'L1', pct: null, cct: null });
    expect(parseLevel('')).toBeNull();
    expect(parseLevel(':40:2700')).toBeNull();
    expect(formatLevel({ layerId: 'L1', pct: 40, cct: 2700 })).toBe('L1:40:2700');
    expect(formatLevel({ layerId: 'L1', pct: null, cct: null })).toBe('L1::');
  });
});

describe('bağlı satınalma ve yol haritası', () => {
  const p1: Item = { id: 'P1', tip: 'satinalma', ad: 'Şerit LED 5 m', siparis_son_tarih: '2099-01-10', durum: 'karar' };
  const p2: Item = { id: 'P2', tip: 'satinalma', ad: 'Sürücü 60 W', bagli_idler: ['L1'], durum: 'teslim' };
  const p3: Item = { id: 'P3', tip: 'satinalma', ad: 'Silinmiş', bagli_idler: ['L1'], deleted_at: '2099-01-01' };
  const l1 = layer({ id: 'L1', katman_tur: 'ana', adim: 'elektrik', bagli_idler: ['P1'], lux_min: 100, cct_min: 2700, kontrol_cihaz: 'hue_dimmer' });
  const l2 = layer({ id: 'L2', katman_tur: 'gece', adim: 'akilli' });
  const l3 = layer({ id: 'L3', katman_tur: 'gorev' });
  it('iki yönlü bağ: katmanın bagli_idler alanı ya da kalemin bagli_idler alanı; silinmişler hariç', () => {
    expect(linkedPurchases(l1, [p1, p2, p3]).map((p) => p.id)).toEqual(['P1', 'P2']);
    expect(linkedPurchases(l2, [p1, p2, p3])).toEqual([]);
  });
  it('yaklaşan sipariş: 7 gün içinde ya da geçmiş', () => {
    const now = new Date(2099, 0, 5);
    expect(isDueSoon('2099-01-10', now)).toBe(true);
    expect(isDueSoon('2099-01-01', now)).toBe(true);
    expect(isDueSoon('2099-02-01', now)).toBe(false);
    expect(isDueSoon(undefined, now)).toBe(false);
  });
  it('adıma göre gruplama ADIM sırasında; adımsızlar ayrı', () => {
    const g = groupByStep([l2, l1, l3]);
    expect(g.steps.map((s) => s.adim)).toEqual(['kesif', 'elektrik', 'boya', 'profil', 'ampul', 'akilli', 'mobilya', 'ince_ayar']);
    expect(g.steps[1].layers).toEqual([l1]);
    expect(g.steps[5].layers).toEqual([l2]);
    expect(g.unassigned).toEqual([l3]);
  });
  it('aktif adım: ilk tamamlanmamış adım (katmanı eksik ya da bağlı kalemi alınmamış)', () => {
    const g = groupByStep([l1, l2]);
    // elektrik: katman dolu ama P1 alınmadı → aktif = 1
    expect(roadmapActive(g.steps, [p1, p2])).toBe(1);
    expect(roadmapActive(g.steps, [{ ...p1, durum: 'kuruldu' }, p2])).toBe(5); // akilli: l2 dolu değil
    expect(roadmapActive(groupByStep([]).steps, [])).toBe(8);
  });
});
