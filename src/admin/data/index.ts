// Veri katmanı barrel'ı. Kabuk ve sayfalar yalnız buradan (veya alt modülden) alır; ham 'antd' / 'echarts' yok.
// Katmanlar: types (sözleşme tipleri) → contract (Zod) → sources (http/klasör/fixture) → store (nesil deposu)
// → indexes (kimlik/ilişki/terim) → query (AST) → views (görünüm uygunluğu) → live (canlı Sheets) → changeSet
// (yerel değişiklik kümesi) → hooks (React bağlamı).
//
// Zod şemaları types.ts'teki tiplerle aynı adları taşır (Money, Term, Manifest…); çakışmayı önlemek için şema
// modülü ad alanı olarak dışa verilir: `contract.Money.parse(...)`, tip olarak `Money`.
export * from './types';
export * as contract from './contract';
export { collectionSchemas, parseManifest, parsePartition, partitionEnvelope, type ParsedManifest, type ParsedPartition, type ParsedRecord } from './contract';
export * from './sources';
// store.GenerationSource (yalnız readText) sources.GenerationSource'un alt kümesidir; dışa yalnız sources'taki ad verilir.
export {
  ContractError,
  GenerationStore,
  HEAVY_COLLECTIONS,
  HeavyCollectionError,
  IntegrityError,
  createIdbPartitionCache,
  pruneIdbPartitionCache,
  sha256Hex,
  type GenerationStoreOptions,
  type PartitionCache,
  type StoreStatus,
} from './store';
export * from './indexes';
export * from './query';
export * from './views';
export * from './actuals';
export * from './live';
export * from './changeSet';
export * from './useGeneration';
