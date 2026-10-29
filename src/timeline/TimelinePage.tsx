import { useState } from 'react';
import { Select } from '../dashboard/Select';
import { money } from '../dashboard/data';
import { dateLabel, monthLabel, timelineSheetUrl, type Timeline, type TimelineEvent } from './data';
import { useTimeline } from './useTimeline';
import './timeline.css';

const signedMoney = (value: number) => `${value > 0 ? '+' : ''}${money(value)}`;
const stepsPerPage = 50;
function StepPages({ position, page, count, onChange }: { position: 'üst' | 'alt'; page: number; count: number; onChange: (page: number) => void }) {
  return <nav className="timeline-pagination" aria-label={`Adım sayfaları ${position}`}>
    <p aria-live="polite">{page * stepsPerPage + 1}–{Math.min((page + 1) * stepsPerPage, count)} / {count} adım</p>
    <div className="button-row"><button className="quiet-button" disabled={page === 0} onClick={() => onChange(page - 1)}>Önceki adımlar</button><button className="quiet-button" disabled={(page + 1) * stepsPerPage >= count} onClick={() => onChange(page + 1)}>Sonraki adımlar</button></div>
  </nav>;
}
function EventStep({ event, number }: { event: TimelineEvent; number: number }) {
  const changes = [
    event.cashChange !== 0 ? `Nakit ${signedMoney(event.cashChange)}` : null,
    event.denizChange !== 0 ? `Denizbank borcu ${signedMoney(event.denizChange)}` : null,
    event.isChange !== 0 ? `İşbank borcu ${signedMoney(event.isChange)}` : null,
  ].filter(Boolean);
  return <li className={`timeline-step${event.type === 'Kontrol' ? ' timeline-control' : ''}`}>
    <article aria-label={`${number}. adım · ${event.title}`}>
      <div className="timeline-step-context">
        <p className="timeline-meta"><span>Adım {number} · {event.type}</span><span className={event.certainty === 'Tarih varsayımı' ? 'timeline-assumption' : undefined}>{event.certainty}</span></p>
        <h3>{event.title}</h3>
        <p className="timeline-effect">{changes.length ? changes.join(' · ') : 'Nakit ve kart borcu değişmez.'}</p>
        {event.note && <p className="muted timeline-note">{event.note}</p>}
        <p className="muted timeline-source">Kaynak: {event.source}</p>
      </div>
      <dl className="timeline-balances" aria-label="Bu adımdan sonraki plan bakiyesi">
        <div><dt>Kalan nakit</dt><dd className={event.cash < 0 ? 'negative' : undefined}>{money(event.cash)}</dd></div>
        <div><dt>Toplam kart borcu</dt><dd>{money(event.totalDebt)}</dd></div>
        <div className="timeline-bank-debt"><dt>Denizbank</dt><dd>{money(event.denizDebt)}</dd></div>
        <div className="timeline-bank-debt"><dt>İşbank</dt><dd>{money(event.isDebt)}</dd></div>
      </dl>
    </article>
  </li>;
}

function TimelineJourney({ data }: { data: Timeline }) {
  const [selection, setSelection] = useState('');
  const [pageSelection, setPageSelection] = useState({ scope: '', page: 0 });
  const changeSelection = (next: string) => { setSelection(next); setPageSelection({ scope: next, page: 0 }); };
  const selected = selection === 'all' || data.months.includes(selection) ? selection : data.months[0];
  const events = data.events.filter(event => selected === 'all' || event.month === selected);
  const page = Math.min(pageSelection.scope === selected ? pageSelection.page : 0, Math.floor((events.length - 1) / stepsPerPage));
  const visibleEvents = events.slice(page * stepsPerPage, (page + 1) * stepsPerPage);
  const dates = new Map<string, TimelineEvent[]>();
  visibleEvents.forEach(event => { const day = dates.get(event.date) ?? []; day.push(event); dates.set(event.date, day); });
  const eventNumbers = new Map(data.events.map((event, i) => [event.id, i + 1]));
  const changePage = (next: number) => setPageSelection({ scope: selected, page: next });
  const first = events[0], last = events.at(-1)!;
  const startingCash = first.type === 'Başlangıç' ? first.cash : first.cash - first.cashChange;
  const minimumCash = Math.min(startingCash, ...events.map(event => event.cash));
  const assumptions = events.filter(event => event.certainty === 'Tarih varsayımı').length;
  const index = data.months.indexOf(selected);
  const scope = selected === 'all' ? 'Tüm dönem' : monthLabel(selected);
  return <>
    <div className="timeline-toolbar">
      <div className="timeline-month"><Select label="Gösterilen dönem" value={selected} onChange={value => value && changeSelection(value)} allowDeselect={false} data={[...data.months.map(month => ({ value: month, label: monthLabel(month) })), { value: 'all', label: 'Tüm dönem' }]} /></div>
      <div className="button-row timeline-period-buttons"><button className="quiet-button" disabled={index <= 0} onClick={() => changeSelection(data.months[index - 1])}>Önceki ay</button><button className="quiet-button" disabled={index < 0 || index >= data.months.length - 1} onClick={() => changeSelection(data.months[index + 1])}>Sonraki ay</button></div>
      <p className="muted" aria-live="polite">{scope} · {events.length} adım</p>
    </div>
    <section className="timeline-summary" aria-label={`${scope} özeti`}>
      <div><span>Dönem başı nakit</span><strong>{money(startingCash)}</strong></div>
      <div><span>Dönem sonu nakit</span><strong className={last.cash < 0 ? 'negative' : undefined}>{money(last.cash)}</strong></div>
      <div><span>Dönem sonu kart borcu</span><strong>{money(last.totalDebt)}</strong></div>
      <div><span>En düşük planlı nakit</span><strong className={minimumCash < 0 ? 'negative' : undefined}>{money(minimumCash)}</strong></div>
    </section>
    <aside className="timeline-caveat" aria-label="Tarih ve ödeme varsayımları"><strong>{assumptions > 0 ? `${assumptions} adımın günü varsayımdır; ayrıca işaretlidir.` : 'Tarihler ödeme planıdır.'}</strong> Aynı gün maaşın geliş saati ve ödeme sırası ara bakiyeyi değiştirebilir.</aside>
    {minimumCash < 0 && <p className="timeline-cash-warning" role="alert">Bu dönemde planlanan nakit {money(minimumCash)} seviyesine düşüyor. Negatif tutar kullanılabilir para değildir; ödeme sırası veya finansmanı düzeltilmelidir.</p>}
    {events.length > stepsPerPage && <StepPages position="üst" page={page} count={events.length} onChange={changePage} />}
    <div className="timeline-journey" aria-label="Kronolojik ödeme adımları">
      {[...dates].map(([date, day]) => <section className="timeline-day" key={date} aria-labelledby={`timeline-date-${date}`}><h2 id={`timeline-date-${date}`}><time dateTime={date}>{dateLabel(date)}</time></h2><ol>{day.map(event => <EventStep key={event.id} event={event} number={eventNumbers.get(event.id)!} />)}</ol></section>)}
    </div>
    {events.length > stepsPerPage && <StepPages position="alt" page={page} count={events.length} onChange={changePage} />}
  </>;
}

export default function TimelinePage() {
  const state = useTimeline();
  return <div className="timeline-page">
    <div className="timeline-heading"><div><p className="eyebrow">NAKİT VE KART BORCU</p><h1>Timeline</h1><p className="muted">Her adımın ardından kalan nakit ve kart borcu.</p></div><a className="timeline-sheet-link" href={timelineSheetUrl} target="_blank" rel="noreferrer">Timeline e-tablosunu aç</a></div>
    <p className="timeline-plan-label">Tüm tutarlar plan; gerçekleşmiş ödeme değildir.</p>
    <div className="sync-strip"><span role="status" aria-live="polite">{state.loading ? 'Timeline kontrol ediliyor…' : state.updatedAt ? `Son okuma ${state.updatedAt.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' })} · Açıkken her dakika yenilenir` : 'Google Sheets bağlantısı'}</span><button className="quiet-button" disabled={state.loading} onClick={state.refresh}>Yenile</button></div>
    {state.error && <p className="error-message" role="alert">{state.error} {state.data ? 'Son başarılı takvim gösteriliyor.' : 'E-tabloyu kontrol edip yeniden deneyin.'}</p>}
    {state.data ? <TimelineJourney data={state.data} /> : <p className="loading-message">{state.loading ? 'Adımlar ve bakiye kontrolleri yükleniyor…' : 'Doğrulanmış Timeline verisi şu anda alınamıyor.'}</p>}
  </div>;
}
