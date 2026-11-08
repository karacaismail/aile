import { memo, useCallback } from 'react';
import type { RecordRow } from '../../shell/contracts';
import { ListRow } from '../../ui/ListRow';

// Liste görünümü (telefon önce). Tek yüzey <ul>; her satır ListRow (<li><button>). Satır bileşeni memo'ludur: seçim ya
// da yerel durum değişikliğinde yalnız props'u değişen satır yeniden çizilir (kök neden: her değişiklik 28 satırı
// çiziyordu). Bunun için satır nesneleri kararlı (useKararliSatirlar) ve onAc kararlı (useCallback) verilmelidir.

export interface AlimListesiProps {
  rows: readonly RecordRow[];
  seciliId: string | null;
  /** Dar satır biçimi (telefon/tablet; masaüstünde ayrıntı açıkken sıkı satır). */
  dar: boolean;
  /** Geniş biçimde sütun başlığı satırı (ayrıntı kapalıyken). */
  baslik: boolean;
  onAc(row: RecordRow): void;
}

interface AlimSatiriProps { row: RecordRow; secili: boolean; dar: boolean; onAc(row: RecordRow): void }

const AlimSatiri = memo(function AlimSatiri({ row, secili, dar, onAc }: AlimSatiriProps) {
  const ac = useCallback(() => onAc(row), [onAc, row]);
  return <ListRow row={row} selected={secili} narrow={dar} onClick={ac} />;
});

export const AlimListesi = memo(function AlimListesi({ rows, seciliId, dar, baslik, onAc }: AlimListesiProps) {
  return (
    <ul className="aile-alimlar-liste" aria-label="Alımlar">
      {baslik ? <ListRow.Header /> : null}
      {rows.map(row => <AlimSatiri key={row.id} row={row} secili={row.id === seciliId} dar={dar} onAc={onAc} />)}
    </ul>
  );
});
