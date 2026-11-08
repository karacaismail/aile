import { del as idbDel, keys as idbKeys } from 'idb-keyval';
import { clearLiveBudgetCache } from '../../data/live';
import { setApiUrl, setAppKey } from '../../../sync/config';
import { createPartitionCacheControl, type PartitionCacheControl } from './onbellek';

// Ayarlar › Cihazdaki panel verisi: ortak bir cihazda paneli bırakmadan önce bu tarayıcıdaki BÜTÜN panel verisini siler.
//   - Nesil parça önbelleği (IndexedDB aile-admin/partitions; onbellek.ts ile aynı depo).
//   - idb-keyval varsayılan deposundaki panel anahtarları: önek `aile:admin:` (değişiklik kümesi changeSet.ts
//     CHANGE_SET_KEY, canlı bütçe son iyi okuması live.ts LIVE_BUDGET_CACHE_KEY ve ileride eklenecek panel anahtarları).
//     Ana uygulama aynı depoyu kendi anahtarlarıyla (aile:data:v1, aile:outbox:v1) kullanır; onlara dokunulmaz.
//   - Canlı bütçenin sekme belleğindeki son iyi okuması (üretimde kalıcı saklama kapalıyken tek kopya).
//   - İsteğe bağlı: Apps Script adresi ve uygulama anahtarı (localStorage; ana uygulamayla ORTAK ayar).
// Bellekteki kopyalar (değişiklik kümesi, okunan nesil, seçilen klasör) sayfa yeniden yüklenince gider; sayfa silmeden
// sonra yeniden yükler. React yok; hatalar yutulmaz, sayfa "Hata: …" yazar ve yenilemez.

/** Panelin idb-keyval varsayılan deposundaki bütün anahtarlarının öneki. */
export const PANEL_KEY_PREFIX = 'aile:admin:';

export interface DeviceWipeOptions {
  /** Apps Script adresi ve uygulama anahtarı da silinsin mi (ana uygulamanın ayarıyla ortaktır). */
  connection: boolean;
}

export interface DeviceWipeResult {
  /** Silinen nesil parçası sayısı. */
  partitions: number;
  /** Silinen panel anahtarları (sıralı). */
  panelKeys: string[];
  /** Adres ve anahtar silindi mi. */
  connection: boolean;
}

export interface DeviceDataControl {
  /** IndexedDB var mı; yoksa yalnız bellek ve (istenirse) bağlantı silinir. */
  readonly available: boolean;
  wipe(options: DeviceWipeOptions): Promise<DeviceWipeResult>;
}

/** Test için enjekte edilen yüzey. */
export interface DeviceDataDeps {
  hasIndexedDb(): boolean;
  partitionCache: PartitionCacheControl;
  defaultStoreKeys(): Promise<IDBValidKey[]>;
  deleteDefaultKey(key: string): Promise<void>;
  clearLiveBudget(): Promise<void>;
  clearConnection(): void;
}

const browserDeps = (): DeviceDataDeps => ({
  hasIndexedDb: () => typeof indexedDB !== 'undefined',
  partitionCache: createPartitionCacheControl(),
  defaultStoreKeys: () => idbKeys(),
  deleteDefaultKey: (key) => idbDel(key),
  clearLiveBudget: clearLiveBudgetCache,
  clearConnection: () => {
    // src/sync/config.ts: boş adres kayıtlı adresi siler (ortam varsayılanına döner), boş anahtar anahtarı kaldırır.
    setApiUrl('');
    setAppKey('');
  },
});

export function createDeviceDataControl(deps: DeviceDataDeps = browserDeps()): DeviceDataControl {
  const available = deps.hasIndexedDb();
  return {
    available,
    async wipe({ connection }) {
      let partitions = 0;
      let panelKeys: string[] = [];
      if (available) {
        partitions = await deps.partitionCache.clear();
        panelKeys = (await deps.defaultStoreKeys())
          .filter((key): key is string => typeof key === 'string' && key.startsWith(PANEL_KEY_PREFIX))
          .sort();
        for (const key of panelKeys) await deps.deleteDefaultKey(key);
      }
      await deps.clearLiveBudget();
      if (connection) deps.clearConnection();
      return { partitions, panelKeys, connection };
    },
  };
}
