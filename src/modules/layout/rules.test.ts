import { describe, it, expect } from 'vitest';
import type { Item } from '@shared/schema';
import {
  ROOMS, WALL_KEYS, parseRoomSetting, serializeRoomSetting, wallLength, wallOf, wallLabel, remaining, wallSummary,
  needsMap, needsTotal, roomItems, formatDims, suggestionPatches, suggestionKod, suggestionName, toItemPatch, type RoomDims,
} from './rules';

const room: RoomDims = { en_cm: 320, boy_cm: 450, yuk_cm: 270, kopek_erisim: 'serbest' };

const items: Item[] = [
  { id: 'L1', tip: 'yerlesim', ad: 'Üçlü koltuk', oda: 'salon', duvar: 'K', en_cm: 220, boy_cm: 90, yuk_cm: 85, priz_ihtiyaci: 1 },
  { id: 'L2', tip: 'yerlesim', ad: 'Kitaplık', oda: 'salon', duvar: 'K', en_cm: 120, boy_cm: 30, yuk_cm: 200, isik_ihtiyaci: 'raf aydınlatması', kanal_m: 1.5 },
  { id: 'L3', tip: 'yerlesim', ad: 'TV ünitesi', oda: 'salon', duvar: 'G', en_cm: 180, boy_cm: 40, yuk_cm: 50, priz_ihtiyaci: 3, isik_ihtiyaci: 'TV arkası şerit', kanal_m: 2.5 },
  { id: 'L4', tip: 'yerlesim', ad: 'Orta sehpa', oda: 'salon', en_cm: 90, boy_cm: 60, yuk_cm: 40, priz_ihtiyaci: 0 },
  { id: 'L5', tip: 'yerlesim', ad: 'Yatak', oda: 'ebeveyn', duvar: 'D', en_cm: 200, boy_cm: 200, mevcut: true },
  { id: 'L6', tip: 'yerlesim', ad: 'Silinmiş', oda: 'salon', duvar: 'G', en_cm: 500, deleted_at: '2099-01-01T00:00:00Z', priz_ihtiyaci: 9 },
  { id: 'P1', tip: 'satinalma', ad: 'Satınalma, yerleşim değil', oda: 'salon', en_cm: 999 },
];
const salon = roomItems(items, 'salon');

describe('ROOMS / WALL_KEYS', () => {
  it('genel odası listede yok; duvar anahtarları K G D B orta', () => {
    expect(ROOMS).not.toContain('genel');
    expect(ROOMS).toContain('salon');
    expect(WALL_KEYS).toEqual(['K', 'G', 'D', 'B', 'orta']);
  });
});

describe('parseRoomSetting / serializeRoomSetting', () => {
  it('JSON okur, bozuk ya da boş değerde boş nesne döner', () => {
    expect(parseRoomSetting('{"en_cm":320,"boy_cm":450,"yuk_cm":270,"kopek_erisim":"serbest"}')).toEqual(room);
    expect(parseRoomSetting('')).toEqual({});
    expect(parseRoomSetting(undefined)).toEqual({});
    expect(parseRoomSetting('{bozuk')).toEqual({});
    expect(parseRoomSetting('[1,2]')).toEqual({});
  });
  it('sayı olmayan ve geçersiz enum değerlerini atar', () => {
    expect(parseRoomSetting('{"en_cm":"320","boy_cm":"abc","kopek_erisim":"ucan"}')).toEqual({ en_cm: 320 });
  });
  it('serialize boş alanları atar ve parse ile gidip gelir', () => {
    const s = serializeRoomSetting({ en_cm: 320, boy_cm: undefined, yuk_cm: null as unknown as undefined, kopek_erisim: 'kapali' });
    expect(JSON.parse(s)).toEqual({ en_cm: 320, kopek_erisim: 'kapali' });
    expect(parseRoomSetting(serializeRoomSetting(room))).toEqual(room);
  });
});

describe('wallLength / wallOf / wallLabel', () => {
  it('K ve G = en, D ve B = boy, orta = tanımsız', () => {
    expect(wallLength(room, 'K')).toBe(320);
    expect(wallLength(room, 'G')).toBe(320);
    expect(wallLength(room, 'D')).toBe(450);
    expect(wallLength(room, 'B')).toBe(450);
    expect(wallLength(room, 'orta')).toBeUndefined();
    expect(wallLength({}, 'K')).toBeUndefined();
  });
  it('duvarı olmayan kalem ortadadır; etiketler Türkçe', () => {
    expect(wallOf(items[0])).toBe('K');
    expect(wallOf(items[3])).toBe('orta');
    expect(wallLabel('K')).toBe('Kuzey');
    expect(wallLabel('orta')).toBe('Orta');
  });
});

describe('roomItems', () => {
  it('yalnız yerleşim tipli, silinmemiş, odası eşleşen kalemler', () => {
    expect(salon.map((i) => i.id)).toEqual(['L1', 'L2', 'L3', 'L4']);
    expect(roomItems(items, 'ebeveyn').map((i) => i.id)).toEqual(['L5']);
    expect(roomItems(items, 'wc')).toEqual([]);
  });
});

describe('remaining / wallSummary', () => {
  it('duvar uzunluğu − kalem en toplamı; negatif taşma', () => {
    expect(remaining(room, 'K', salon)).toBe(-20);
    expect(remaining(room, 'G', salon)).toBe(140);
    expect(remaining(room, 'D', salon)).toBe(450);
    expect(remaining(room, 'orta', salon)).toBeUndefined();
    expect(remaining({}, 'K', salon)).toBeUndefined();
  });
  it('en girilmemiş kalem 0 sayılır', () => {
    expect(remaining(room, 'B', [{ id: 'x', tip: 'yerlesim', ad: 'x', duvar: 'B' }])).toBe(450);
  });
  it('wallSummary dört duvar için uzunluk, dolu ve kalan verir', () => {
    const s = wallSummary(room, salon);
    expect(s.map((w) => w.wall)).toEqual(['K', 'G', 'D', 'B']);
    expect(s[0]).toEqual({ wall: 'K', length: 320, used: 340, remaining: -20 });
    expect(s[2]).toEqual({ wall: 'D', length: 450, used: 0, remaining: 450 });
    expect(wallSummary({}, salon)[0]).toEqual({ wall: 'K', length: undefined, used: 340, remaining: undefined });
  });
});

describe('needsMap / needsTotal', () => {
  it('duvar başına priz, ışık notları ve kanal metresi', () => {
    const m = needsMap(salon);
    expect(m.K).toEqual({ priz: 1, isik: ['raf aydınlatması'], kanal_m: 1.5 });
    expect(m.G).toEqual({ priz: 3, isik: ['TV arkası şerit'], kanal_m: 2.5 });
    expect(m.D).toEqual({ priz: 0, isik: [], kanal_m: 0 });
    expect(m.B).toEqual({ priz: 0, isik: [], kanal_m: 0 });
    expect(m.orta).toEqual({ priz: 0, isik: [], kanal_m: 0 });
    expect(needsTotal(m)).toEqual({ priz: 4, isik: ['raf aydınlatması', 'TV arkası şerit'], kanal_m: 4 });
  });
  it('kayan nokta toplamı 1 ondalığa yuvarlanır', () => {
    const m = needsMap([
      { id: 'a', tip: 'yerlesim', ad: 'a', duvar: 'K', kanal_m: 0.1 },
      { id: 'b', tip: 'yerlesim', ad: 'b', duvar: 'K', kanal_m: 0.2 },
    ]);
    expect(m.K.kanal_m).toBe(0.3);
  });
});

describe('formatDims', () => {
  it('en×boy×yük cm; eksik olanlar atlanır; hiçbiri yoksa boş', () => {
    expect(formatDims({ en_cm: 220, boy_cm: 90, yuk_cm: 85 })).toBe('220×90×85 cm');
    expect(formatDims({ en_cm: 220 })).toBe('220 cm');
    expect(formatDims({ en_cm: 320, boy_cm: 450 }, ' × ')).toBe('320 × 450 cm');
    expect(formatDims({})).toBe('');
  });
});

describe('suggestionPatches', () => {
  function apply(existing: Item[], patches: ReturnType<typeof suggestionPatches>): Item[] {
    const out = existing.map((p) => ({ ...p }));
    for (const [i, p] of patches.entries()) {
      const id = p.id ?? `NEW${i}`;
      const idx = out.findIndex((x) => x.id === id);
      const base: Record<string, unknown> = idx >= 0 ? { ...out[idx] } : { id };
      for (const [k, v] of Object.entries(p.patch)) { if (v === null || v === '') delete base[k]; else base[k] = v; }
      if (idx >= 0) out[idx] = base as unknown as Item; else out.push(base as unknown as Item);
    }
    return out;
  }

  it('oda için 1 priz + 1 kanal satırı oluşturur (kod, ad, adet, birim, bağlı kalemler, not)', () => {
    const patches = suggestionPatches('salon', items, []);
    expect(patches).toHaveLength(2);
    const [priz, kanal] = patches;
    expect(priz.id).toBeUndefined();
    expect(priz.patch).toMatchObject({
      tip: 'satinalma', kod: suggestionKod('salon', 'priz'), ad: 'Panjurlu priz — Salon', oda: 'salon', kategori: 'elektrik', faz: '1', durum: 'fikir',
      adet: 4, birim: 'adet', bagli_idler: ['L1', 'L3'],
    });
    expect(String(priz.patch.not)).toContain('Kuzey 1');
    expect(String(priz.patch.not)).toContain('Güney 3');
    expect(kanal.patch).toMatchObject({
      tip: 'satinalma', kod: suggestionKod('salon', 'kanal'), ad: 'Kablo kanalı — Salon', oda: 'salon', kategori: 'elektrik', faz: '1',
      adet: 4, birim: 'm', bagli_idler: ['L2', 'L3'],
    });
    expect(String(kanal.patch.not)).toContain('1,5 m');
    expect(suggestionName('cocuk', 'priz')).toBe('Panjurlu priz — Çocuk odası');
  });

  it('ihtiyaç sıfırsa satır üretmez', () => {
    expect(suggestionPatches('ebeveyn', items, [])).toEqual([]);
    expect(suggestionPatches('wc', items, [])).toEqual([]);
  });

  it('idempotent: ikinci çağrıda boş liste; kod eşleşmesiyle çoğaltma yok', () => {
    const first = suggestionPatches('salon', items, []);
    const purchases = apply([], first);
    expect(purchases).toHaveLength(2);
    expect(suggestionPatches('salon', items, purchases)).toEqual([]);
  });

  it('ihtiyaç değişince var olan satırı günceller (yalnız değişen alanlar), ad korunur', () => {
    const purchases = apply([], suggestionPatches('salon', items, []));
    purchases[0].ad = 'Priz (kullanıcı yeniden adlandırdı)';
    const more: Item[] = [...items, { id: 'L7', tip: 'yerlesim', ad: 'Masa lambası', oda: 'salon', duvar: 'B', priz_ihtiyaci: 2 }];
    const patches = suggestionPatches('salon', more, purchases);
    expect(patches).toHaveLength(1);
    expect(patches[0].id).toBe(purchases[0].id);
    expect(patches[0].patch).toEqual({ adet: 6, bagli_idler: ['L1', 'L3', 'L7'], not: expect.stringContaining('Batı 2') });
    expect(patches[0].patch).not.toHaveProperty('ad');
  });

  it('ad eşleşmesiyle (kod yokken) var olanı bulur ve kod atar', () => {
    const existing: Item[] = [{ id: 'P9', tip: 'satinalma', ad: ' panjurlu priz — salon ', adet: 1 }];
    const patches = suggestionPatches('salon', items, existing);
    const priz = patches.find((p) => p.id === 'P9');
    expect(priz).toBeDefined();
    expect(priz!.patch).toMatchObject({ kod: suggestionKod('salon', 'priz'), adet: 4, birim: 'adet' });
    expect(priz!.patch).not.toHaveProperty('ad');
    expect(patches.filter((p) => p.id === undefined)).toHaveLength(1); // yalnız kanal yeni
  });

  it('bağlı kalemler üzerinden (kod ve ad yokken) var olanı bulur; birim ile priz/kanal ayrılır', () => {
    const existing: Item[] = [
      { id: 'K1', tip: 'satinalma', ad: 'Kanal (eski ad)', oda: 'salon', birim: 'm', bagli_idler: ['L3'] },
      { id: 'K2', tip: 'satinalma', ad: 'Priz (eski ad)', oda: 'salon', birim: 'adet', bagli_idler: ['L1'] },
    ];
    const patches = suggestionPatches('salon', items, existing);
    expect(patches.map((p) => p.id).sort()).toEqual(['K1', 'K2']);
    expect(patches.find((p) => p.id === 'K1')!.patch).toMatchObject({ kod: suggestionKod('salon', 'kanal'), adet: 4 });
    expect(patches.find((p) => p.id === 'K2')!.patch).toMatchObject({ kod: suggestionKod('salon', 'priz'), adet: 4 });
  });

  it('silinmiş satınalma satırı eşleşmez', () => {
    const existing: Item[] = [{ id: 'P9', tip: 'satinalma', ad: 'Panjurlu priz — Salon', kod: suggestionKod('salon', 'priz'), deleted_at: '2099-01-01T00:00:00Z' }];
    const patches = suggestionPatches('salon', items, existing);
    expect(patches.every((p) => p.id === undefined)).toBe(true);
  });
});

describe('toItemPatch', () => {
  const base = { ad: ' Koltuk ', duvar: 'orta' as const, en_cm: 220, boy_cm: null, yuk_cm: null, mevcut: false, priz_ihtiyaci: null, isik_ihtiyaci: '  ', kanal_m: null, bagli_idler: [] as string[], not: '' };
  it('yeni kalemde tüm alanlar; boşlar null; orta duvar null', () => {
    expect(toItemPatch(base, 'salon')).toEqual({
      tip: 'yerlesim', oda: 'salon', ad: 'Koltuk', duvar: null, en_cm: 220, boy_cm: null, yuk_cm: null, mevcut: false, priz_ihtiyaci: null, isik_ihtiyaci: null, kanal_m: null, bagli_idler: null, not: null,
    });
    expect(toItemPatch({ ...base, duvar: 'K', bagli_idler: ['P1'], not: 'n' }, 'salon')).toMatchObject({ duvar: 'K', bagli_idler: ['P1'], not: 'n' });
  });
  it('var olanda yalnız değişen alanlar (tip hep kalır)', () => {
    const prev: Item = { id: 'L1', tip: 'yerlesim', ad: 'Koltuk', oda: 'salon', en_cm: 220 };
    expect(toItemPatch(base, 'salon', prev)).toEqual({ tip: 'yerlesim' });
    expect(toItemPatch({ ...base, duvar: 'G', mevcut: true }, 'salon', prev)).toEqual({ tip: 'yerlesim', duvar: 'G', mevcut: true });
  });
});
