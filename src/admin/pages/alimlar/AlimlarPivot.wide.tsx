import { useMemo } from 'react';
import { Money, Table } from '../../ui';
import { fromMinor, type ParaToplami } from './para';
import type { Pivot, PivotHucre, PivotSatiri } from './pivot';
import './AlimlarPivot.wide.css';

// Alımlar pivot tablosu (tablet ve masaüstü; telefon PivotStack akordeonunu kullanır ve bunu indirmez). Satırlar oda,
// sütunlar durum; her hücrede Plan ve Gerçek iki ayrı satır, hiçbir yerde tek sayıda birleşmez. Kayıt yoksa "Kayıt
// yok", plan yoksa "Fiyat yok", gerçek yoksa "Henüz yok". Birden çok para birimi ayrı yazılır.

const PIVOT_BASLIK = 'Oda ve duruma göre planlanan ve gerçekleşen tutar';
const FIYAT_YOK = 'Fiyat yok';
const HENUZ_YOK = 'Henüz yok';
const KAYIT_YOK = 'Kayıt yok';

export interface AlimlarPivotTabloProps { pivot: Pivot }

function ParaListesi({ total, missing }: { total: ParaToplami; missing: string }) {
  if (total.size === 0) return <span className="aile-alimlar-eksik">{missing}</span>;
  return (
    <>
      {[...total.entries()].map(([currency, minor], index) => (
        <span key={currency}>
          {index > 0 ? ' · ' : null}
          <Money value={fromMinor(minor, currency)} />
        </span>
      ))}
    </>
  );
}

function PivotDeger({ cell }: { cell: PivotHucre | undefined }) {
  if (!cell || cell.kayit === 0) return <span className="aile-alimlar-eksik">{KAYIT_YOK}</span>;
  return (
    <span className="aile-alimlar-pv">
      <span className="aile-alimlar-pv-satir"><span className="aile-alimlar-pv-k aile-kucuk">Plan </span><ParaListesi total={cell.plan} missing={FIYAT_YOK} /></span>
      <span className="aile-alimlar-pv-satir"><span className="aile-alimlar-pv-k aile-kucuk">Gerçek </span><ParaListesi total={cell.gercek} missing={HENUZ_YOK} /></span>
    </span>
  );
}

export default function AlimlarPivotTablo({ pivot }: AlimlarPivotTabloProps) {
  const columns = useMemo(() => [
    { key: 'oda', title: 'Oda / Durum', minWidth: 160, render: (row: PivotSatiri) => <span className="aile-alimlar-pv-oda">{row.oda}</span> },
    ...pivot.sutunlar.map(durum => ({
      key: `d:${durum}`,
      title: durum,
      align: 'right' as const,
      minWidth: 168,
      render: (row: PivotSatiri) => <PivotDeger cell={row.hucreler.get(durum)} />,
    })),
    { key: 'toplam', title: 'Toplam', align: 'right' as const, minWidth: 184, render: (row: PivotSatiri) => <PivotDeger cell={row.toplam} /> },
  ], [pivot]);
  return <Table<PivotSatiri> columns={columns} rows={pivot.satirlar} caption={PIVOT_BASLIK} />;
}
