// Bu cihazdaki tüm panel verisini silme: nesil parça önbelleği (aile-admin/partitions), idb-keyval varsayılan
// deposundaki panel anahtarları (aile:admin:* — değişiklik kümesi, canlı bütçe son iyi okuması), canlı bütçenin sekme
// belleği ve isteğe bağlı Apps Script adresi/anahtarı. Ana uygulamanın aynı depodaki anahtarları (aile:data:v1,
// aile:outbox:v1) silinmez. jsdom'da IndexedDB yok; bağımlılıklar enjekte edilir. Gerçek tarayıcı davranışı
// e2e/admin-page-ayarlar.spec.ts'de IndexedDB okunarak doğrulanır.
import { describe, expect, it, vi } from 'vitest';
import { PANEL_KEY_PREFIX, createDeviceDataControl, type DeviceDataDeps } from './cihazVerisi';

function fakeDeps(initial: Record<string, unknown>, partitions = 3) {
  const store = new Map(Object.entries(initial));
  let parts = partitions;
  const calls: string[] = [];
  const deps: DeviceDataDeps = {
    hasIndexedDb: () => true,
    partitionCache: {
      available: true,
      count: vi.fn(async () => parts),
      clear: vi.fn(async () => {
        calls.push('partitions');
        const removed = parts;
        parts = 0;
        return removed;
      }),
    },
    defaultStoreKeys: vi.fn(async () => [...store.keys()]),
    deleteDefaultKey: vi.fn(async (key: string) => {
      calls.push(`del:${key}`);
      store.delete(key);
    }),
    clearLiveBudget: vi.fn(async () => {
      calls.push('live');
    }),
    clearConnection: vi.fn(() => {
      calls.push('connection');
    }),
  };
  return { deps, store, calls };
}

describe('createDeviceDataControl', () => {
  it('panel anahtar öneki aile:admin: (değişiklik kümesi ve canlı bütçe anahtarları bu önekle başlar)', () => {
    expect(PANEL_KEY_PREFIX).toBe('aile:admin:');
  });

  it('parçaları, aile:admin:* anahtarlarını ve canlı bütçe belleğini siler; ana uygulamanın anahtarlarına dokunmaz', async () => {
    const { deps, store, calls } = fakeDeps({
      'aile:admin:changeset:v1': [{ opId: 'X' }],
      'aile:admin:live-budget:v1': { v: 1 },
      'aile:admin:gelecek-anahtar:v9': 1,
      'aile:data:v1': { items: [] },
      'aile:outbox:v1': [],
    });
    const result = await createDeviceDataControl(deps).wipe({ connection: false });
    expect(result).toEqual({ partitions: 3, panelKeys: ['aile:admin:changeset:v1', 'aile:admin:gelecek-anahtar:v9', 'aile:admin:live-budget:v1'], connection: false });
    expect([...store.keys()].sort()).toEqual(['aile:data:v1', 'aile:outbox:v1']);
    expect(calls).toContain('partitions');
    expect(calls).toContain('live');
    expect(deps.clearConnection).not.toHaveBeenCalled();
  });

  it('connection: true → Apps Script adresi ve anahtarı da silinir', async () => {
    const { deps } = fakeDeps({});
    const result = await createDeviceDataControl(deps).wipe({ connection: true });
    expect(deps.clearConnection).toHaveBeenCalledTimes(1);
    expect(result.connection).toBe(true);
  });

  it('IndexedDB yoksa yalnız bellek ve (istenirse) bağlantı silinir; parça 0', async () => {
    const { deps } = fakeDeps({ 'aile:admin:changeset:v1': [] });
    deps.hasIndexedDb = () => false;
    const control = createDeviceDataControl(deps);
    expect(control.available).toBe(false);
    await expect(control.wipe({ connection: true })).resolves.toEqual({ partitions: 0, panelKeys: [], connection: true });
    expect(deps.partitionCache.clear).not.toHaveBeenCalled();
    expect(deps.deleteDefaultKey).not.toHaveBeenCalled();
    expect(deps.clearLiveBudget).toHaveBeenCalledTimes(1);
    expect(deps.clearConnection).toHaveBeenCalledTimes(1);
  });

  it('IndexedDB hatası yutulmaz: çağırana iletilir (sayfa "Hata: …" yazar, sayfayı yenilemez)', async () => {
    const { deps } = fakeDeps({ 'aile:admin:changeset:v1': [] });
    deps.deleteDefaultKey = vi.fn(async () => {
      throw new Error('InvalidStateError');
    });
    await expect(createDeviceDataControl(deps).wipe({ connection: false })).rejects.toThrow('InvalidStateError');
  });
});
