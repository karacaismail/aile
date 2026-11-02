import {
  CellValue, Pair, RoleMark, TOPLAM, roleOf, type PivotRow, type PivotSummary,
} from '../PivotStack.parts';
import './Pivot.wide.css';

// Geniş-özel (masaüstü; tablette sığarsa) pivot tablo. Yalnız ui/PivotStack.tsx içindeki lazyWide('ui-pivot-tablo', …)
// ile iner; telefonda hiç indirilmez (W0 *.wide kuralı). antd gerekmez: yerel <table> + PivotStack.parts (telefon-
// güvenli model ve hücre parçaları). Tasarım: bundle.js PivotTable — kaydırma bölgesi role="region" + sekme durağı
// (klavyeyle yatay kaydırma), görünmez caption, köşe başlığı + sütunlar + Toplam; satır başlığı th scope=row ve
// yapışkan ilk sütun; her hücrede Planlanan / Gerçekleşen ayrı; altta "Toplam" satırı. Sütun ve genel toplam yalnız
// yaprak (sahipli) satırlardan; alt toplam ve sahipsiz satır kendi değeriyle görünür, işaretlidir, toplanmaz.
// Kolon asgari genişlikleri Pivot.wide.css'te (PivotStack.parts PIVOT_KOLON_ASGARI ile aynı; testle korunur).

export interface PivotTableProps {
  columns: readonly string[];
  rows: readonly PivotRow[];
  summary: PivotSummary;
  caption?: string;
  label: string;
  cornerLabel: string;
}

export default function PivotTable({ columns, rows, summary, caption, label, cornerLabel }: PivotTableProps) {
  return (
    <div className="aile-pivot-genis" data-gorunum="tablo">
      {caption ? <p className="aile-pivot-caption aile-kucuk aile-ikincil">{caption}</p> : null}
      {/* Kaydırma bölgesinin odak çizgisini saran kap çizer (Pivot.wide.css); bölge kendi ::after'ını taşıyamaz. */}
      <div className="aile-pivot-tablo-sar">
        <div className="aile-pivot-tablo-kap" role="region" aria-label={label} tabIndex={0}>
          <table className="aile-pivot-tablo">
            <caption className="aile-pivot-tablo-baslik">{label}</caption>
            <thead>
              <tr>
                <th scope="col">{cornerLabel}</th>
                {columns.map((column, j) => <th key={`${j}:${column}`} scope="col" className="aile-pivot-sayi">{column}</th>)}
                <th scope="col" className="aile-pivot-sayi">{TOPLAM}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const [rowLabel, cells] = row;
                return (
                  <tr key={`${index}:${rowLabel}`} data-rol={roleOf(row)}>
                    <th scope="row">
                      <span className="aile-pivot-title-ad">{rowLabel}</span>
                      {' '}
                      <RoleMark row={row} />
                    </th>
                    {columns.map((column, j) => (
                      <td key={`${j}:${column}`} className="aile-pivot-sayi"><CellValue cell={cells[j]} /></td>
                    ))}
                    <td className="aile-pivot-sayi aile-pivot-satir-toplam"><Pair value={summary.rowTotals[index]!} /></td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr data-rol="toplam">
                <th scope="row">{TOPLAM}</th>
                {summary.columnTotals.map((total, j) => (
                  <td key={j} className="aile-pivot-sayi"><Pair value={total} /></td>
                ))}
                <td className="aile-pivot-sayi"><Pair value={summary.grand} /></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
