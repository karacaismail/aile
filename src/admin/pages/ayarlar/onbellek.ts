import { clear as idbClear, createStore as idbCreateStore, keys as idbKeys, type UseStore } from 'idb-keyval';

// Ayarlar › Önbellek: nesil deposunun parça önbelleğini (src/admin/data/store.ts createIdbPartitionCache) sayar ve
// temizler. Yalnız o IndexedDB veritabanı/deposu; değişiklik kümesi (idb-keyval varsayılan deposu, changeSet.ts) ve
// localStorage'daki Apps Script adresi/anahtarı bu modüle hiç girmez, temizlemede korunur. React yok; hatalar yutulmaz,
// sayfa "Hata: …" yazar. Ad sözleşmesi store.ts'teki IDB_DATABASE/IDB_STORE ile aynıdır (store.ts bunları dışa vermiyor;
// tek kaynak için veri katmanına istek açıldı). Gerçek tarayıcıda e2e/admin-page-ayarlar.spec.ts aynı depoyu okuyarak
// temizlemenin deponun yazdığı parçaları gerçekten sildiğini doğrular.

export const PARTITION_CACHE_DB = 'aile-admin';
export const PARTITION_CACHE_STORE = 'partitions';

export interface PartitionCacheControl {
  /** IndexedDB yoksa false: sayfa düğme göstermez, nedeni yazar. */
  readonly available: boolean;
  /** Önbellekteki parça sayısı. */
  count(): Promise<number>;
  /** Bütün parçaları siler; silinen sayıyı döner. */
  clear(): Promise<number>;
}

/** Test için enjekte edilen IndexedDB yüzeyi (idb-keyval imzaları). */
export interface PartitionCacheDeps {
  hasIndexedDb(): boolean;
  createStore(dbName: string, storeName: string): UseStore;
  keys(store: UseStore): Promise<IDBValidKey[]>;
  clear(store: UseStore): Promise<void>;
}

const browserDeps: PartitionCacheDeps = {
  hasIndexedDb: () => typeof indexedDB !== 'undefined',
  createStore: idbCreateStore,
  keys: (store) => idbKeys(store),
  clear: (store) => idbClear(store),
};

const UNAVAILABLE: PartitionCacheControl = Object.freeze({
  available: false,
  count: async () => 0,
  clear: async () => 0,
});

export function createPartitionCacheControl(deps: PartitionCacheDeps = browserDeps): PartitionCacheControl {
  if (!deps.hasIndexedDb()) return UNAVAILABLE;
  let store: UseStore | undefined;
  const use = () => (store ??= deps.createStore(PARTITION_CACHE_DB, PARTITION_CACHE_STORE));
  return {
    available: true,
    async count() {
      return (await deps.keys(use())).length;
    },
    async clear() {
      const removed = (await deps.keys(use())).length;
      await deps.clear(use());
      return removed;
    },
  };
}
