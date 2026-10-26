import { describe, it, expect } from 'vitest';
import type { Item } from '@shared/schema';
import {
  countdown, timelineEntries, vendorStats, checklistText, sortTasks, depsResolved, whatsappHref, normalizePhone,
  taskDurumLabel, groupChecks, checklistProgress, VENDOR_TARGET,
} from './rules';

const NOW = new Date(2099, 0, 10, 12, 0); // 10 Oca 2099

const task = (p: Partial<Item> & { id: string }): Item => ({ tip: 'tadilat', ad: `İş ${p.id}`, ...p });
const ms = (p: Partial<Item> & { id: string }): Item => ({ tip: 'kilometre', ad: `Taş ${p.id}`, ...p });
const vendor = (p: Partial<Item> & { id: string }): Item => ({ tip: 'usta', ad: `Usta ${p.id}`, ...p });
const check = (p: Partial<Item> & { id: string }): Item => ({ tip: 'kontrol', ad: `Madde ${p.id}`, ...p });

describe('countdown', () => {
  it('gün sayısı; geçmiş negatif; tarih yoksa null', () => {
    expect(countdown('2099-01-20', NOW)).toBe(10);
    expect(countdown('2099-01-10', NOW)).toBe(0);
    expect(countdown('2099-01-08', NOW)).toBe(-2);
    expect(countdown(undefined, NOW)).toBeNull();
    expect(countdown('', NOW)).toBeNull();
  });
});

describe('taskDurumLabel', () => {
  it('yerel harita; bilinmeyen değer olduğu gibi', () => {
    expect(taskDurumLabel('fikir')).toBe('Planlandı');
    expect(taskDurumLabel('siparis')).toBe('Devam ediyor');
    expect(taskDurumLabel('kuruldu')).toBe('Kabul edildi');
    expect(taskDurumLabel(undefined)).toBe('');
  });
});

describe('timelineEntries', () => {
  const items: Item[] = [
    ms({ id: 'mA', ad: 'Anahtar teslim', senaryo: 'A', kilometre_tur: 'tarih', planlanan_tarih: '2099-01-20' }),
    ms({ id: 'mB', ad: 'Anahtar teslim B', senaryo: 'B', kilometre_tur: 'tarih', planlanan_tarih: '2099-02-01' }),
    ms({ id: 'mH', ad: 'Mobilya siparişi', senaryo: 'hepsi', kilometre_tur: 'siparis', planlanan_tarih: '2099-01-05' }),
    ms({ id: 'mN', ad: 'Hedef bitiş', kilometre_tur: 'hedef', planlanan_tarih: '2099-03-01' }),
    ms({ id: 'mBant', ad: 'Tatil bandı', senaryo: 'hepsi', kilometre_tur: 'bant', planlanan_tarih: '2099-01-12', bitis_tarihi: '2099-01-14' }),
    task({ id: 't1', kod: 'T1', ad: 'Elektrik', planlanan_tarih: '2099-01-15', sure_gun: 3 }),
    task({ id: 't2', kod: 'T2', ad: 'Tarihsiz iş' }),
    task({ id: 't3', kod: 'T3', ad: 'Silinmiş', planlanan_tarih: '2099-01-16', deleted_at: '2099-01-01T00:00:00Z' }),
  ];
  it('senaryo filtresi: seçili + hepsi + senaryosuz; tarihe göre sıralı; tarihsiz ve silinmiş iş yok', () => {
    const e = timelineEntries(items, 'A', NOW);
    const ids = e.map((x) => x.id);
    expect(ids).not.toContain('mB');
    expect(ids).toContain('mA');
    expect(ids).toContain('mH');
    expect(ids).toContain('mN');
    expect(ids).toContain('t1');
    expect(ids).not.toContain('t2');
    expect(ids).not.toContain('t3');
    const dates = e.map((x) => x.date);
    expect([...dates].sort()).toEqual(dates);
  });
  it('geçmiş işaretli, bugün işareti var, iş bitiş tarihi süreden türetilir', () => {
    const e = timelineEntries(items, 'A', NOW);
    expect(e.find((x) => x.id === 'mH')?.past).toBe(true);
    expect(e.find((x) => x.id === 'mA')?.past).toBe(false);
    const today = e.find((x) => x.kind === 'bugun');
    expect(today?.date).toBe('2099-01-10');
    const t1 = e.find((x) => x.id === 't1');
    expect(t1?.kind).toBe('tadilat');
    expect(t1?.endDate).toBe('2099-01-18');
    expect(t1?.title).toBe('T1 Elektrik');
  });
  it('Ramazan/Bayram sabit bantları satır olmasa da gelir; veri bandı korunur', () => {
    const e = timelineEntries(items, 'B', NOW);
    const bands = e.filter((x) => x.kind === 'bant');
    expect(bands.map((x) => x.band)).toEqual(expect.arrayContaining(['ramazan', 'bayram']));
    expect(bands.find((x) => x.id === 'mBant')).toBeTruthy();
    const ramazan = bands.find((x) => x.band === 'ramazan' && x.id !== 'mBant');
    expect(ramazan?.date).toBe('2027-02-08');
    expect(ramazan?.endDate).toBe('2027-03-08');
    expect(ramazan?.past).toBe(true);
  });
  it('senaryo verilmezse tüm taşlar', () => {
    const e = timelineEntries(items, undefined, NOW);
    expect(e.map((x) => x.id)).toEqual(expect.arrayContaining(['mA', 'mB']));
  });
});

describe('vendorStats', () => {
  const list: Item[] = [
    vendor({ id: 'u1', meslek: 'elektrik', teklif_tl: 1000 }),
    vendor({ id: 'u2', meslek: 'elektrik' }),
    vendor({ id: 'u3', meslek: 'boya', teklif_tl: 500 }),
    vendor({ id: 'u4', meslek: 'elektrik', teklif_tl: 900, deleted_at: 'x' }),
  ];
  it('meslek bazında aday ve teklif; hepsi', () => {
    expect(vendorStats(list, 'elektrik')).toEqual({ aday: 2, teklif: 1 });
    expect(vendorStats(list, 'boya')).toEqual({ aday: 1, teklif: 1 });
    expect(vendorStats(list, 'hepsi')).toEqual({ aday: 3, teklif: 2 });
    expect(VENDOR_TARGET).toEqual({ aday: 5, teklif: 3 });
  });
});

describe('checklistText', () => {
  it('numaralı düz metin, eşik ve birim ile', () => {
    const txt = checklistText([
      check({ id: 'k1', ad: 'Topraklama direnci', esik: '< 4', olcum_birim: 'ohm' }),
      check({ id: 'k2', ad: 'Kaçak akım rölesi 30 mA' }),
      check({ id: 'k3', ad: 'Silinmiş', deleted_at: 'x' }),
    ]);
    expect(txt).toBe('1. Topraklama direnci — eşik: < 4 ohm\n2. Kaçak akım rölesi 30 mA');
  });
});

describe('sortTasks', () => {
  it('kod doğal sıra (T2 < T10), kodsuz sona, sonra tarih', () => {
    const s = sortTasks([
      task({ id: 'a', kod: 'T10' }), task({ id: 'b', kod: 'T2' }), task({ id: 'c', planlanan_tarih: '2099-01-02' }),
      task({ id: 'd', planlanan_tarih: '2099-01-01' }), task({ id: 'e', kod: 'T1' }),
    ]);
    expect(s.map((x) => x.id)).toEqual(['e', 'b', 'a', 'd', 'c']);
  });
});

describe('depsResolved', () => {
  const tasks = [
    task({ id: 'a', kod: 'T1', durum: 'teslim' }),
    task({ id: 'b', kod: 'T2', durum: 'siparis' }),
    task({ id: 'c', kod: 'T3', durum: 'iptal' }),
  ];
  it('bağımlılık yoksa true; bitti/kabul/iptal çözülmüş; devam eden ya da bilinmeyen kod çözülmemiş', () => {
    expect(depsResolved(task({ id: 'x' }), tasks)).toBe(true);
    expect(depsResolved(task({ id: 'x', bagimlilik: ['T1', 'T3'] }), tasks)).toBe(true);
    expect(depsResolved(task({ id: 'x', bagimlilik: ['T1', 'T2'] }), tasks)).toBe(false);
    expect(depsResolved(task({ id: 'x', bagimlilik: ['T9'] }), tasks)).toBe(false);
    expect(depsResolved(task({ id: 'x', bagimlilik: [' t1 '] }), tasks)).toBe(true);
  });
});

describe('telefon', () => {
  it('yalnız rakam, 90 ile başlar', () => {
    expect(normalizePhone('0532 111 22 33')).toBe('905321112233');
    expect(normalizePhone('+90 (532) 111-22-33')).toBe('905321112233');
    expect(normalizePhone('532 111 22 33')).toBe('905321112233');
    expect(normalizePhone('0090 532 111 22 33')).toBe('905321112233');
    expect(whatsappHref('0532 111 22 33')).toBe('https://wa.me/905321112233');
    expect(whatsappHref('')).toBeUndefined();
  });
});

describe('groupChecks / checklistProgress', () => {
  const list: Item[] = [
    check({ id: 'k1', kontrol_tur: 'sartname', meslek: 'elektrik', tamam: true }),
    check({ id: 'k2', kontrol_tur: 'sartname', meslek: 'elektrik' }),
    check({ id: 'k3', kontrol_tur: 'sartname', meslek: 'boya' }),
    check({ id: 'k4', kontrol_tur: 'kabul' }),
    check({ id: 'k5', kontrol_tur: 'kabul', deleted_at: 'x' }),
  ];
  it('tür → meslek grupları; mesleksiz "genel"; ilerleme', () => {
    const g = groupChecks(list);
    expect([...g.keys()]).toEqual(['sartname', 'kabul']);
    expect([...g.get('sartname')!.keys()]).toEqual(['elektrik', 'boya']);
    expect(g.get('kabul')!.get('genel')!.map((x) => x.id)).toEqual(['k4']);
    expect(checklistProgress(list.filter((x) => x.kontrol_tur === 'sartname'))).toEqual({ done: 1, total: 3 });
    expect(checklistProgress([])).toEqual({ done: 0, total: 0 });
  });
});
