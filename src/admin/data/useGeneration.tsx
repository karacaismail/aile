// React bağlamı: nesil deposunu (GenerationStore), koleksiyon yükleyicisini, indeks/sorgu katmanını ve yerel
// değişiklik kümesini sayfalara hook olarak sunar. Veri mantığı komşu saf TS dosyalarındadır (store, indexes,
// query, changeSet); burada yalnız React bağlama, abonelik ve memoizasyon vardır. antd yok; ham paket importu yok.
//
//   <GenerationProvider source? cache? changeSet? now?>
//        source: undefined → defaultGenerationSource(): geliştirmede HttpGenerationSource (/__aile/generation), üretimde
//                (VITE_AILE_GENERATION_URL yoksa) UnselectedGenerationSource → istek yok, "Klasör içe aktar" durumu;
//                null → doğrudan "Klasör içe aktar" durumu.
//        cache:  undefined → defaultPartitionCache(): geliştirmede IndexedDB; üretimde VITE_AILE_PARTITION_CACHE=idb|on
//                yoksa kalıcı önbellek YOK (fail-closed, persistentCacheAllowed); null → yok. Yeni nesil yayınlanınca
//                depo eski nesillerin önbellek girdilerini budar.
//     useGeneration()        → durum, manifest, tazelik, refresh, pickDirectory (DirectoryGenerationSource), importRequired
//     useGenerationImport()  → klasör içe aktarma: pickDirectory (Chromium) + importFiles(FileList) (Safari/WebKit)
//     useCollection(name, { periods? })
//                            → { rows, loading, error }     (store.loadCollection, kapsam başına bir kez; hata "Hata: …")
//                              periods: yalnız o YYYY-MM dönemlerinin parçaları. Bileşen kalkınca (rota değişimi)
//                              bekleyen yükleme AbortController ile iptal edilir (başka bekleyen yoksa).
//     useRows(kind)          → RecordRow[]                  (changeSet.apply → buildIndexes → toRecordRow)
//     useQuery(kind, ast)    → { ids, rows, counts, total, loading, error }
//     useChangeSet()         → yerel değişiklik kümesi (add / undo / pendingFor / toBatch); Sheets'e yazma yok
//
// Modüller (hepsi d02 useGeneration.* sahipliğinde; adlar yalnız bu dosyadan ve barrel'dan dışa verilir, içe aktaran kod
// değişmez):
//   useGeneration.provider.tsx → GenerationProvider, CollectionLoader (telefon girişi App.tsx bunu doğrudan içe aktarır)
//   useGeneration.context.ts   → bağlam ve sayfa hook'ları (useGeneration, useGenerationImport, useCollection,
//                                useChangeSet), kayıt türü → koleksiyon eşlemesi; sağlayıcıyla birlikte girişte
//   useGeneration.rows.tsx     → useRows, useQuery (indexes.ts, query.ts); yalnız onları kullanan sayfanın parçasında
//   useGeneration.tsx          → yalnız yeniden dışa verim (bu dosya ve barrel '../data' aynı adları verir)

// Tembel yükleme yardımcıları (saf TS, store.ts): barrel ('../data') bunları buradan da dışa verir.
export {
  MAX_CONCURRENT_PARTITION_READS,
  collectionScopeKey,
  defaultPartitionCache,
  normalizePeriods,
  partitionPeriod,
  periodsBetween,
  persistentCacheAllowed,
  type CollectionScopeOptions,
  type LoadCollectionOptions,
  type PartitionCacheEnv,
  type PeriodsBetweenOptions,
} from './store';
export {
  CollectionLoader,
  GenerationProvider,
  failureMessage,
  type CollectionStoreLike,
  type EnsureOptions,
  type GenerationHandle,
  type GenerationImportHandle,
  type GenerationProviderProps,
} from './useGeneration.provider';
export {
  KIND_COLLECTIONS,
  collectionForKind,
  useChangeSet,
  useCollection,
  useGeneration,
  useGenerationImport,
  type ChangeSetHandle,
  type CollectionLoadOptions,
  type CollectionRecord,
  type CollectionRecordMap,
  type CollectionSnapshot,
  type RecordKind,
} from './useGeneration.context';
export { useQuery, useRows, type QueryResult } from './useGeneration.rows';
