import { useId, useState } from 'react';
import { Collapse } from '@mantine/core';
import { useReducedMotion } from '@mantine/hooks';
import { tokens } from '../dashboard/tokens';
import { Select } from '../dashboard/Select';
import { money } from '../dashboard/data';
import { dateLabel, monthLabel, timelineSheetUrl, type Timeline, type TimelineEvent } from './data';
import { useTimeline } from './useTimeline';
import './timeline.css';

const signedMoney = (value: number) => `${value > 0 ? '+' : ''}${money(value)}`;
const stepsPerPage = 50;
function MonthArrow({ next = false }: { next?: boolean }) {
  return <svg className="timeline-arrow" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8"><path d={next ? 'M9 5l7 7-7 7' : 'M15 5l-7 7 7 7'} /></svg>;
}
function StepPages({ position, page, count, onChange }: { position: 'üst' | 'alt'; page: number; count: number; onChange: (page: number) => void }) {
  return <nav className="timeline-pagination" aria-label={`Adım sayfaları ${position}`}>
    <p aria-live="polite">{page * stepsPerPage + 1}–{Math.min((page + 1) * stepsPerPage, count)} / {count} adım</p>
    <div className="button-row"><button className="quiet-button" disabled={page === 0} onClick={() => onChange(page - 1)}>Önceki adımlar</button><button className="quiet-button" disabled={(page + 1) * stepsPerPage >= count} onClick={() => onChange(page + 1)}>Sonraki adımlar</button></div>
  </nav>;
}
function EventStep({ event, number }: { event: TimelineEvent; number: number }) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const reduced = useReducedMotion();
  const changes = [
    { label: 'Nakit', value: event.cashChange, tone: event.cashChange > 0 ? 'inflow' : 'outflow' },
    { label: 'Denizbank borcu', value: event.denizChange, tone: event.denizChange > 0 ? 'outflow' : 'neutral' },
    { label: 'İşbank borcu', value: event.isChange, tone: event.isChange > 0 ? 'outflow' : 'neutral' },
  ].filter(change => change.value !== 0);
  return <li className={`timeline-step${event.type === 'Kontrol' ? ' timeline-control' : ''}`}>
    <article aria-label={`${number}. adım · ${event.title}`}>
      <div className="timeline-step-context">
        <p className="timeline-meta"><span className="timeline-kind" data-kind={event.type}>{event.type}</span><span>Adım {number}</span>{event.certainty === 'Tarih varsayımı' && <span className="timeline-assumption">Tarih varsayımı</span>}</p>
        <h3>{event.title}</h3>
        <div className="timeline-effect">{changes.length ? changes.map(change => <span className="timeline-change" data-tone={change.tone} key={change.label}><span>{change.label}</span> <strong>{signedMoney(change.value)}</strong></span>) : <span className="muted">Nakit ve kart borcu değişmez.</span>}</div>
      </div>
      <dl className="timeline-balances" aria-label="Bu adımdan sonraki plan bakiyesi">
        <div className="timeline-cash"><dt>Kalan nakit</dt><dd className={event.cash < 0 ? 'negative' : undefined}>{money(event.cash)}</dd></div>
        <div className="timeline-total-debt"><dt>Toplam kart borcu</dt><dd>{money(event.totalDebt)}</dd></div>
        <div className="timeline-bank-debt"><dt>Denizbank</dt><dd>{money(event.denizDebt)}</dd></div>
        <div className="timeline-bank-debt"><dt>İşbank</dt><dd>{money(event.isDebt)}</dd></div>
      </dl>
      <button className="timeline-detail-toggle" type="button" aria-label={`Ayrıntı: ${event.title}`} aria-expanded={open} aria-controls={detailsId} onClick={() => setOpen(!open)}><span>Ayrıntı</span><span aria-hidden="true">{open ? '−' : '+'}</span></button>
      <Collapse className="timeline-details" id={detailsId} expanded={open} aria-hidden={!open} inert={!open} keepMounted
        transitionDuration={reduced ? 0 : tokens.duration} transitionTimingFunction={tokens.ease} animateOpacity={false}>
        <div className="timeline-details-body">{event.note && <p>{event.note}</p>}<p className="timeline-source"><strong>Kaynak</strong> {event.source} <span>· {event.certainty}</span></p></div>
      </Collapse>
    </article>
  </li>;
}

function DayHeading({ date, count }: { date: string; count: number }) {
  const value = new Date(`${date}T12:00:00Z`);
  const month = new Intl.DateTimeFormat('tr-TR', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(value);
  const weekday = new Intl.DateTimeFormat('tr-TR', { weekday: 'long', timeZone: 'UTC' }).format(value);
  return <div className="timeline-day-heading"><h2 id={`timeline-date-${date}`}><time dateTime={date} aria-label={dateLabel(date)}><span className="timeline-date-number">{date.slice(8)}</span><span className="timeline-date-month">{month}</span><span className="timeline-weekday">{weekday}</span></time></h2><span className="timeline-day-count">{count} adım</span></div>;
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
      <div className="timeline-month"><Select label="Dönem" aria-label="Gösterilen dönem" value={selected} onChange={value => value && changeSelection(value)} allowDeselect={false} data={[...data.months.map(month => ({ value: month, label: monthLabel(month) })), { value: 'all', label: 'Tüm dönem' }]} /></div>
      <div className="button-row timeline-period-buttons"><button className="quiet-button timeline-month-arrow" aria-label="Önceki ay" disabled={index <= 0} onClick={() => changeSelection(data.months[index - 1])}><MonthArrow /></button><button className="quiet-button timeline-month-arrow" aria-label="Sonraki ay" disabled={index < 0 || index >= data.months.length - 1} onClick={() => changeSelection(data.months[index + 1])}><MonthArrow next /></button></div>
      <p className="muted" aria-live="polite">{scope} · {events.length} adım</p>
    </div>
    <section className="timeline-summary" aria-label={`${scope} özeti`}>
      <div><span>Başlangıç nakdi</span><strong>{money(startingCash)}</strong></div>
      <div className="timeline-summary-cash"><span>Son nakit</span><strong className={last.cash < 0 ? 'negative' : undefined}>{money(last.cash)}</strong></div>
      <div><span>Son kart borcu</span><strong>{money(last.totalDebt)}</strong></div>
      <div><span>En düşük nakit</span><strong className={minimumCash < 0 ? 'negative' : undefined}>{money(minimumCash)}</strong></div>
    </section>
    <aside className="timeline-caveat" aria-label="Tarih ve ödeme varsayımları"><strong>{assumptions > 0 ? `${assumptions} adımın günü varsayımdır.` : 'Tarihler ödeme planıdır.'}</strong></aside>
    {minimumCash < 0 && <p className="timeline-cash-warning" role="alert">Bu dönemde planlanan nakit {money(minimumCash)} seviyesine düşüyor. Negatif tutar kullanılabilir para değildir; ödeme sırası veya finansmanı düzeltilmelidir.</p>}
    {events.length > stepsPerPage && <StepPages position="üst" page={page} count={events.length} onChange={changePage} />}
    <div className="timeline-journey" aria-label="Kronolojik ödeme adımları">
      {[...dates].map(([date, day]) => <section className="timeline-day" key={date} aria-labelledby={`timeline-date-${date}`}><DayHeading date={date} count={day.length} /><ol>{day.map(event => <EventStep key={event.id} event={event} number={eventNumbers.get(event.id)!} />)}</ol></section>)}
    </div>
    {events.length > stepsPerPage && <StepPages position="alt" page={page} count={events.length} onChange={changePage} />}
  </>;
}

export default function TimelinePage() {
  const state = useTimeline();
  return <div className="timeline-page">
    <header className="timeline-heading">
      <div className="timeline-title"><h1>Timeline</h1><p className="muted">Adım adım nakit ve kart borcu.</p></div>
      <div className="timeline-heading-tools"><a className="timeline-sheet-link" href={timelineSheetUrl} target="_blank" rel="noreferrer">E-tabloda aç <span aria-hidden="true">↗</span></a><button className="quiet-button" disabled={state.loading} onClick={state.refresh}>Yenile</button></div>
    </header>
    <p className="timeline-plan-label"><span>Plan görünümü</span> Gerçekleşmiş ödeme değildir.</p>
    {state.error && <p className="error-message" role="alert">{state.error} {state.data ? 'Son başarılı takvim gösteriliyor.' : 'E-tabloyu kontrol edip yeniden deneyin.'}</p>}
    {state.data ? <TimelineJourney data={state.data} /> : <p className="loading-message">{state.loading ? 'Adımlar ve bakiye kontrolleri yükleniyor…' : 'Doğrulanmış Timeline verisi şu anda alınamıyor.'}</p>}
    <footer className="timeline-data-note"><span className="timeline-sync" role="status" aria-live="polite">{state.loading ? 'Kontrol ediliyor…' : state.updatedAt ? `Güncellendi ${state.updatedAt.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' })}` : 'Google Sheets bağlantısı'}</span><p>Açıkken her dakika yenilenir. Aynı gün maaşın geliş saati ve ödeme sırası ara bakiyeyi değiştirebilir.</p></footer>
  </div>;
}
