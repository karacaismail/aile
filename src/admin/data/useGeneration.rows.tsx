// Tür koleksiyonunun liste satırları (useRows) ve sorgu sonucu (useQuery): değişiklik kümesi → indeks (indexes.ts) →
// sorgu (query.ts). useGeneration.tsx'ten ayrı modüldür ve onu içe aktarmaz (bağlam useGeneration.context.ts'ten): nesil
// bağlamı (GenerationProvider, telefon girişi) indeks ve sorgu katmanını statik çekmez; yalnız bu hook'ları kullanan
// sayfa çeker. useGeneration.tsx ve barrel ('../data') bu adları aynen yeniden dışa verir; davranış useGeneration.tsx'teki
// önceki tanımla aynıdır.
import { useMemo } from 'react';
import type { RecordRow } from '../shell/contracts';
import { buildIndexes, toRecordRow, type GenerationCollections, type GenerationIndexes } from './indexes';
import { createQueryContext, facetCounts, runQuery, toQueryRow, type FacetCounts, type QueryAst, type QueryContext, type QueryRow } from './query';
import type { PurchaseNeedRecord } from './types';
import { collectionForKind, useChangeOverlay, useCollection } from './useGeneration.context';

interface KindData {
  /** Değişiklik kümesi uygulanmış kayıtlar. */
  records: readonly PurchaseNeedRecord[];
  indexes: GenerationIndexes;
  queryContext: QueryContext;
  loading: boolean;
  error: string | null;
}

/** Tür koleksiyonu + indeks için gereken yardımcı koleksiyonlar; overlay indeksten önce uygulanır. */
function useKindData(kind: string): KindData {
  const collection = collectionForKind(kind);
  const { changeSet, changeVersion } = useChangeOverlay();
  const main = useCollection(collection);
  const rooms = useCollection('rooms');
  const terms = useCollection('terms');
  const relations = useCollection('relations');
  const media = useCollection('media_references');
  const vocabularies = useCollection('vocabularies');
  const parts = [main, rooms, terms, relations, media, vocabularies];
  const loading = parts.some((part) => part.loading);
  const error = parts.find((part) => part.error !== null)?.error ?? null;

  // changeVersion bağımlılığı: add/undo sonrası aynı changeSet nesnesiyle yeniden uygulanır.
  const records = useMemo<readonly PurchaseNeedRecord[]>(
    () => (changeSet ? changeSet.apply(main.rows) : main.rows),
    [changeSet, changeVersion, main.rows],
  );
  const indexes = useMemo(() => {
    const collections: GenerationCollections = {
      [collection]: records,
      rooms: rooms.rows,
      terms: terms.rows,
      relations: relations.rows,
      media_references: media.rows,
      vocabularies: vocabularies.rows,
    };
    return buildIndexes(collections);
  }, [collection, records, rooms.rows, terms.rows, relations.rows, media.rows, vocabularies.rows]);
  const queryContext = useMemo(() => createQueryContext({ terms: terms.rows, media: media.rows }), [terms.rows, media.rows]);

  return useMemo(() => ({ records, indexes, queryContext, loading, error }), [records, indexes, queryContext, loading, error]);
}

/** Tür için liste/tablo/kanban satırları. Yüklenirken boş dizi; yükleme durumu için useCollection(collectionForKind(kind)). */
export function useRows(kind: string): RecordRow[] {
  const { records, indexes } = useKindData(kind);
  return useMemo(() => records.map((record) => toRecordRow(record, indexes)), [records, indexes]);
}

export interface QueryResult {
  /** Eşleşen kayıt kimlikleri; altı görünüm aynı kümeyi kullanır. */
  ids: ReadonlySet<string>;
  /** Eşleşen satırlar, AST sıralamasıyla. */
  rows: RecordRow[];
  /** Boyut sayımları (kendi seçimi hariç, diğer filtrelerle). */
  counts: FacetCounts;
  /** Filtre öncesi kayıt sayısı. */
  total: number;
  loading: boolean;
  error: string | null;
}

/** Sorgu AST'sini türün kayıtlarına uygular. AST içerik olarak karşılaştırılır; her render'da yeni nesne vermek güvenlidir. */
export function useQuery(kind: string, ast: QueryAst): QueryResult {
  const { records, indexes, queryContext, loading, error } = useKindData(kind);
  // AST içerik anahtarıyla sabitlenir: aynı içerikli yeni nesne yeniden hesaplatmaz.
  const astKey = JSON.stringify(ast);
  const stableAst = useMemo(() => ast, [astKey]);

  const queryRows = useMemo<readonly QueryRow[]>(() => records.map((record) => toQueryRow(record, queryContext)), [records, queryContext]);
  const matched = useMemo(() => runQuery(queryRows, stableAst, queryContext), [queryRows, stableAst, queryContext]);
  const ids = useMemo<ReadonlySet<string>>(() => new Set(matched.map((row) => row.id)), [matched]);
  const rows = useMemo(() => {
    const byId = new Map(records.map((record) => [record.id, record] as const));
    const out: RecordRow[] = [];
    for (const match of matched) {
      const record = byId.get(match.id);
      if (record) out.push(toRecordRow(record, indexes));
    }
    return out;
  }, [matched, records, indexes]);
  const counts = useMemo(() => facetCounts(queryRows, stableAst, queryContext), [queryRows, stableAst, queryContext]);

  return useMemo(() => ({ ids, rows, counts, total: queryRows.length, loading, error }), [ids, rows, counts, queryRows.length, loading, error]);
}
