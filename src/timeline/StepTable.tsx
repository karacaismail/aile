import { financeMoney as money } from '../finance/format';
import type { FinanceEvent } from '../finance/data';
import { dateLabel } from './data';
import type { PurchaseDetails } from './purchase';
import { balanceFields, FutureInstalments, StepFacts, StepSource } from './StepCard';

/** The same filtered, paginated steps as the flow, as one contained scrolling table. */
export function StepTable({ events, eventNumbers, purchases, allEvents }: { events: FinanceEvent[]; eventNumbers: Map<string, number>; purchases: Map<string, PurchaseDetails | null>; allEvents: FinanceEvent[] }) {
  return <div className="timeline-table-block">
    <p className="timeline-table-help">Adım sonrası bakiyeler. Diğer sütunlar için yatay kaydır.</p>
    <div className="table-scroll timeline-table-scroll" tabIndex={0} role="region" aria-label="Ödeme tablosu; yatay kaydırılabilir" onKeyDown={event => {
      if (event.target === event.currentTarget && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
        event.preventDefault(); event.currentTarget.scrollLeft += event.currentTarget.clientWidth / 2 * (event.key === 'ArrowRight' ? 1 : -1);
      }
    }}>
      <table className="timeline-table" aria-label="Kronolojik ödeme tablosu">
        <thead><tr><th scope="col">Tarih / adım</th><th scope="col">İşlem ve etkisi</th>{balanceFields.map(([key, label]) => <th scope="col" className="numeric" key={key}>{label}</th>)}<th scope="col">Açıklama / kaynak</th></tr></thead>
        <tbody>{events.map(event => <tr key={event.id}>
          <td className="timeline-table-date"><time dateTime={event.date}>{dateLabel(event.date)}</time><span>Adım {eventNumbers.get(event.id)}</span></td>
          <td className="timeline-table-event"><p className="timeline-meta"><span className="timeline-kind" data-kind={event.type}>{event.type}</span></p><strong className="timeline-table-title">{event.title}</strong><StepFacts event={event} purchase={purchases.get(event.id) ?? null} previous={allEvents[(eventNumbers.get(event.id) ?? 1) - 2]} /></td>
          {balanceFields.map(([key]) => <td className={`numeric${event[key] < 0 ? ' negative' : ''}`} data-balance={key} key={key}>{money(event[key])}</td>)}
          <td className="timeline-table-note"><FutureInstalments event={event} /><StepSource event={event} /></td>
        </tr>)}</tbody>
      </table>
    </div>
  </div>;
}
