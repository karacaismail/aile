// Yazma yardımcıları (sync/controller üzerinden).
import type { Item, Oda } from '@shared/schema';
import { label } from '@shared/schema';
import { upsert } from '@/sync/controller';
import { CORE_LAYERS } from './rules';

/** Odada eksik olan temel katmanları (ana/görev/gece) boş spec ile oluşturur; oluşturulan kimlikleri döndürür. */
export function createCoreLayers(oda: Oda, existing: readonly Item[]): string[] {
  const have = new Set(existing.filter((l) => l.oda === oda && !l.deleted_at).map((l) => l.katman_tur));
  const ids: string[] = [];
  for (const t of CORE_LAYERS) {
    if (have.has(t)) continue;
    ids.push(upsert('kalemler', undefined, { tip: 'aydinlatma', ad: `${label('oda', oda)} ${label('katman_tur', t)}`, oda, katman_tur: t, adim: 'kesif' }));
  }
  return ids;
}
