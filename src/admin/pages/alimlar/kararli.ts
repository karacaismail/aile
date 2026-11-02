import { useMemo, useRef } from 'react';
import type { RecordRow } from '../../shell/contracts';

// Çizim kararlılığı. Veri katmanı her yerel değişiklikte (change set add/undo) bütün satır nesnelerini yeniden üretir;
// içerik aynı kalan satırın kimliği korunursa memo'lu satır bileşeni yeniden çizilmez. Ölçüt JSON içeriğidir (satır
// görünüm modeli düz veridir). Önbellek yalnız aynı içerikli eski nesneyi geri verir; çizim sonucu değişmez.

/** İçeriği değişmeyen satırların nesne kimliğini korur; hiçbir satır ve sıra değişmediyse dizinin kendisi de aynı kalır. */
export function useKararliSatirlar(rows: readonly RecordRow[]): readonly RecordRow[] {
  const onbellek = useRef(new Map<string, { imza: string; row: RecordRow }>());
  const onceki = useRef<readonly RecordRow[]>([]);
  return useMemo(() => {
    const yeni = new Map<string, { imza: string; row: RecordRow }>();
    const out = rows.map(row => {
      const imza = JSON.stringify(row);
      const eski = onbellek.current.get(row.id);
      const kararli = eski && eski.imza === imza ? eski.row : row;
      yeni.set(row.id, { imza, row: kararli });
      return kararli;
    });
    onbellek.current = yeni;
    const ayni = out.length === onceki.current.length && out.every((row, index) => row === onceki.current[index]);
    if (!ayni) onceki.current = out;
    return onceki.current;
  }, [rows]);
}

/** Düz veri değeri (fonksiyonsuz) içerik olarak aynıysa önceki referansı verir. */
export function useAyniIcerik<T>(value: T): T {
  const ref = useRef<{ imza: string; value: T } | null>(null);
  const imza = JSON.stringify(value);
  if (!ref.current || ref.current.imza !== imza) ref.current = { imza, value };
  return ref.current.value;
}
