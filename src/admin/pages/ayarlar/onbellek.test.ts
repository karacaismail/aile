// Önbellek denetimi: nesil deposunun parça önbelleği (store.ts createIdbPartitionCache ile aynı IndexedDB veritabanı ve
// deposu) sayılır ve temizlenir. Değişiklik kümesi (idb-keyval varsayılan deposu) ve localStorage'a dokunulmaz.
// jsdom'da IndexedDB yok; gerçek tarayıcı davranışı e2e/admin-page-ayarlar.spec.ts'de IndexedDB okunarak doğrulanır.
import { describe, expect, it, vi } from 'vitest';
import { PARTITION_CACHE_DB, PARTITION_CACHE_STORE, createPartitionCacheControl, type PartitionCacheDeps } from './onbellek';

function fakeDeps(initial: string[]) {
  let entries = [...initial];
  const store = Symbol('store');
  const deps: PartitionCacheDeps = {
    hasIndexedDb: () => true,
    createStore: vi.fn(() => store as never),
    keys: vi.fn(async (s) => { expect(s).toBe(store); return [...entries]; }),
    clear: vi.fn(async (s) => { expect(s).toBe(store); entries = []; }),
  };
  return deps;
}

describe('createPartitionCacheControl', () => {
  it('IndexedDB yoksa (jsdom) kullanılamaz; sayım 0, temizleme hiçbir şey yapmaz', async () => {
    const control = createPartitionCacheControl();
    expect(control.available).toBe(false);
    await expect(control.count()).resolves.toBe(0);
    await expect(control.clear()).resolves.toBe(0);
  });

  it('nesil deposunun veritabanı/deposunu kullanır (aile-admin / partitions); depo tembel ve tek kez açılır', async () => {
    expect([PARTITION_CACHE_DB, PARTITION_CACHE_STORE]).toEqual(['aile-admin', 'partitions']);
    const deps = fakeDeps(['g/a.json', 'g/b.json']);
    const control = createPartitionCacheControl(deps);
    expect(control.available).toBe(true);
    expect(deps.createStore).not.toHaveBeenCalled();
    await expect(control.count()).resolves.toBe(2);
    await control.count();
    expect(deps.createStore).toHaveBeenCalledTimes(1);
    expect(deps.createStore).toHaveBeenCalledWith('aile-admin', 'partitions');
  });

  it('clear: silinen parça sayısını döner, sonra sayım 0', async () => {
    const deps = fakeDeps(['g/a.json', 'g/b.json', 'h/c.json']);
    const control = createPartitionCacheControl(deps);
    await expect(control.clear()).resolves.toBe(3);
    expect(deps.clear).toHaveBeenCalledTimes(1);
    await expect(control.count()).resolves.toBe(0);
  });

  it('IndexedDB hatası yutulmaz: çağırana iletilir (sayfa "Hata: …" yazar)', async () => {
    const deps = fakeDeps([]);
    deps.clear = vi.fn(async () => { throw new Error('QuotaExceededError'); });
    await expect(createPartitionCacheControl(deps).clear()).rejects.toThrow('QuotaExceededError');
  });
});
