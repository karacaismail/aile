import { useEffect, useMemo, useState } from 'react';
import { Tabs } from '@mantine/core';
import { Select } from '../dashboard/Select';
import { money } from '../dashboard/data';
import { dateLabel, monthLabel, timelineSheetUrl, type Timeline, type TimelineEvent } from './data';
import { useTimeline } from './useTimeline';
import { TimelineLoading } from './TimelineLoading';
import './timeline.css';

const signedMoney = (value: number) => `${value > 0 ? '+' : ''}${money(value)}`;
function incomeTiming(income: TimelineEvent, payment: TimelineEvent) {
  const days = Math.round((Date.parse(income.date) - Date.parse(payment.date)) / 86400000);
  return days === 0 ? 'ödemeyle aynı gün' : `ödemeden ${Math.abs(days)} gün ${days < 0 ? 'önce' : 'sonra'}`;
}
const stepsPerPage = 50;
function useVisibleStepCount(scope: string, total: number) {
  const initial = Math.min(8, total);
  const [progress, setProgress] = useState({ scope, count: initial });
  const count = progress.scope === scope ? Math.min(progress.count, total) : initial;
  useEffect(() => {
    if (count >= total) return;
    let active = true;
    // Queue the next batch only after this one commits, so React cannot merge frames.
    const frame = requestAnimationFrame(() => {
      if (active) setProgress({ scope, count: Math.min(total, count + 16) });
    });
    return () => { active = false; cancelAnimationFrame(frame); };
  }, [scope, total, count]);
  return count;
}
const journeyFilters = [
  { id: 'all', label: 'Tüm adımlar' }, { id: 'payment', label: 'Ödemeler' },
  { id: 'purchase', label: 'Alışveriş' }, { id: 'income', label: 'Gelir' },
] as const;
type JourneyFilter = typeof journeyFilters[number]['id'];
const matchesFilter = (event: TimelineEvent, filter: JourneyFilter) => filter === 'all' ||
  (filter === 'payment' && event.cashChange < 0) || (filter === 'purchase' && event.type === 'Alışveriş') ||
  (filter === 'income' && event.type === 'Gelir');
function MonthArrow({ next = false }: { next?: boolean }) {
  return <svg className="timeline-arrow" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8"><path d={next ? 'M9 5l7 7-7 7' : 'M15 5l-7 7 7 7'} /></svg>;
}
function StepPages({ position, page, count, onChange }: { position: 'üst' | 'alt'; page: number; count: number; onChange: (page: number) => void }) {
  return <nav className="timeline-pagination" aria-label={`Adım sayfaları ${position}`}>
    <p aria-live="polite">{page * stepsPerPage + 1}–{Math.min((page + 1) * stepsPerPage, count)} / {count} adım</p>
    <div className="button-row"><button className="quiet-button" disabled={page === 0} onClick={() => onChange(page - 1)}>Önceki adımlar</button><button className="quiet-button" disabled={(page + 1) * stepsPerPage >= count} onClick={() => onChange(page + 1)}>Sonraki adımlar</button></div>
  </nav>;
}
function EventDetails({ event, incomes }: { event: TimelineEvent; incomes: TimelineEvent[] }) {
  // The legacy conditional hint is superseded by the explicit dates below; retain every other source note.
  const note = event.type === 'Kart ödemesi'
    ? event.note.replace('Maaştan önceyse önceki aydan nakit gerekir; aynı günse maaşın yatması beklenir.', '').trim()
    : event.note;
  return <div className="timeline-details">
    {event.type === 'Kart ödemesi' && <div className="timeline-payment-dates" role="group" aria-label="Ödeme ve gelir tarihleri">
      <p><strong>Ödeme günü</strong> {dateLabel(event.date)}</p>
      <p><strong>Ödeme öncesi nakit</strong> {money(event.cash - event.cashChange)}</p>
      <div className="timeline-income-dates">{incomes.length ? <><p><strong>Bu ayın gelir takvimi</strong></p><ul>{incomes.map(income => <li key={income.id}>{dateLabel(income.date)} · {income.title} · {incomeTiming(income, event)}{income.certainty === 'Tarih varsayımı' ? ' · gün varsayımı' : ''}</li>)}</ul>{incomes.some(income => income.certainty === 'Tarih varsayımı') && <p>Varsayılan gelir günü, kesin maaş günü değildir.</p>}</> : <p>Bu ay için gelir adımı kayıtlı değil.</p>}</div>
    </div>}
    {note && <p className="timeline-source-note"><strong>E-tablo notu</strong> {note}</p>}
    <p className="timeline-source"><strong>Kaynak</strong> {event.source} <span>· {event.certainty}</span></p>
  </div>;
}
function EventEffects({ event }: { event: TimelineEvent }) {
  const changes = [
    { label: 'Nakit', value: event.cashChange, tone: event.cashChange > 0 ? 'inflow' : 'outflow' },
    { label: 'Denizbank borcu', value: event.denizChange, tone: event.denizChange > 0 ? 'outflow' : 'neutral' },
    { label: 'İşbank borcu', value: event.isChange, tone: event.isChange > 0 ? 'outflow' : 'neutral' },
  ].filter(change => change.value !== 0);
  return <div className="timeline-effect">{changes.length ? changes.map(change => <span className="timeline-change" data-tone={change.tone} key={change.label}><span>{change.label}</span> <strong>{signedMoney(change.value)}</strong></span>) : <span className="muted">Nakit ve kart borcu değişmez.</span>}</div>;
}
function EventStep({ event, number, incomes }: { event: TimelineEvent; number: number; incomes: TimelineEvent[] }) {
  return <li className={`timeline-step${event.type === 'Kontrol' ? ' timeline-control' : ''}`}>
    <article aria-label={`${number}. adım · ${event.title}`}>
      <div className="timeline-step-context">
        <p className="timeline-meta"><span className="timeline-kind" data-kind={event.type}>{event.type}</span><span>Adım {number}</span>{event.certainty === 'Tarih varsayımı' && <span className="timeline-assumption">Tarih varsayımı</span>}</p>
        <h3>{event.title}</h3>
        <EventEffects event={event} />
      </div>
      <dl className="timeline-balances" aria-label="Bu adımdan sonraki plan bakiyesi">
        <div className="timeline-cash"><dt>Kalan nakit</dt><dd className={event.cash < 0 ? 'negative' : undefined}>{money(event.cash)}</dd></div>
        <div className="timeline-total-debt"><dt>Toplam kart borcu</dt><dd>{money(event.totalDebt)}</dd></div>
        <div className="timeline-bank-debt"><dt>Denizbank</dt><dd>{money(event.denizDebt)}</dd></div>
        <div className="timeline-bank-debt"><dt>İşbank</dt><dd>{money(event.isDebt)}</dd></div>
      </dl>
      <EventDetails event={event} incomes={incomes} />
    </article>
  </li>;
}

function EventTable({ events, eventNumbers, incomesByMonth }: { events: TimelineEvent[]; eventNumbers: Map<string, number>; incomesByMonth: Map<string, TimelineEvent[]> }) {
  return <div className="timeline-table-block">
    <p className="timeline-table-help">Adım sonrası bakiyeler. Diğer sütunlar için yatay kaydır.</p>
    <div className="table-scroll timeline-table-scroll" tabIndex={0} role="region" aria-label="Ödeme tablosu; yatay kaydırılabilir" onKeyDown={event => {
      if (event.target === event.currentTarget && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
        event.preventDefault();
        event.currentTarget.scrollLeft += event.currentTarget.clientWidth / 2 * (event.key === 'ArrowRight' ? 1 : -1);
      }
    }}>
      <table className="timeline-table" aria-label="Kronolojik ödeme tablosu">
        <thead><tr><th scope="col">Tarih / adım</th><th scope="col">İşlem ve etkisi</th><th scope="col" className="numeric">Kalan nakit</th><th scope="col" className="numeric">Denizbank borcu</th><th scope="col" className="numeric">İşbank borcu</th><th scope="col" className="numeric">Toplam kart borcu</th><th scope="col">Açıklama / kaynak</th></tr></thead>
        <tbody>{events.map(event => <tr key={event.id}>
          <td className="timeline-table-date"><time dateTime={event.date}>{dateLabel(event.date)}</time><span>Adım {eventNumbers.get(event.id)}</span></td>
          <td className="timeline-table-event"><p className="timeline-meta"><span className="timeline-kind" data-kind={event.type}>{event.type}</span>{event.certainty === 'Tarih varsayımı' && <span className="timeline-assumption">Tarih varsayımı</span>}</p><strong className="timeline-table-title">{event.title}</strong><EventEffects event={event} /></td>
          <td className={`numeric${event.cash < 0 ? ' negative' : ''}`} data-balance="cash">{money(event.cash)}</td>
          <td className="numeric" data-balance="denizDebt">{money(event.denizDebt)}</td>
          <td className="numeric" data-balance="isDebt">{money(event.isDebt)}</td>
          <td className="numeric" data-balance="totalDebt">{money(event.totalDebt)}</td>
          <td className="timeline-table-note"><EventDetails event={event} incomes={incomesByMonth.get(event.month) ?? []} /></td>
        </tr>)}</tbody>
      </table>
    </div>
  </div>;
}

function DayHeading({ date, count }: { date: string; count: number }) {
  const value = new Date(`${date}T12:00:00Z`);
  const month = new Intl.DateTimeFormat('tr-TR', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(value);
  const weekday = new Intl.DateTimeFormat('tr-TR', { weekday: 'long', timeZone: 'UTC' }).format(value);
  return <div className="timeline-day-heading"><h2 id={`timeline-date-${date}`}><time dateTime={date} aria-label={dateLabel(date)}><span className="timeline-date-number">{date.slice(8)}</span><span className="timeline-date-month">{month}</span><span className="timeline-weekday">{weekday}</span></time></h2>{count > 1 && <span className="timeline-day-count">{count} adım</span>}</div>;
}

function TimelineJourney({ data }: { data: Timeline }) {
  const incomesByMonth = useMemo(() => {
    const months = new Map<string, TimelineEvent[]>();
    data.events.forEach(event => {
      if (event.type !== 'Gelir') return;
      const incomes = months.get(event.month) ?? [];
      incomes.push(event);
      months.set(event.month, incomes);
    });
    return months;
  }, [data.events]);
  const [selection, setSelection] = useState('');
  const [view, setView] = useState<string | null>('timeline');
  const [filter, setFilter] = useState<JourneyFilter>('all');
  const [pageSelection, setPageSelection] = useState({ scope: '', page: 0 });
  const changeSelection = (next: string) => { setSelection(next); setPageSelection({ scope: next, page: 0 }); };
  const selected = selection === 'all' || data.months.includes(selection) ? selection : data.months[0];
  const events = data.events.filter(event => selected === 'all' || event.month === selected);
  const filteredEvents = events.filter(event => matchesFilter(event, filter));
  const pageScope = `${selected}:${filter}`;
  const page = Math.max(0, Math.min(pageSelection.scope === pageScope ? pageSelection.page : 0, Math.floor((filteredEvents.length - 1) / stepsPerPage)));
  const pageEvents = filteredEvents.slice(page * stepsPerPage, (page + 1) * stepsPerPage);
  // A fresh copy of the same ledger must not collapse an already visible page.
  const renderScope = JSON.stringify([selected, filter, page, view, pageEvents.map(event => event.id)]);
  const visibleCount = useVisibleStepCount(renderScope, pageEvents.length);
  const visibleEvents = pageEvents.slice(0, visibleCount);
  const rendering = visibleCount < pageEvents.length;
  const dates = new Map<string, TimelineEvent[]>();
  visibleEvents.forEach(event => { const day = dates.get(event.date) ?? []; day.push(event); dates.set(event.date, day); });
  const eventNumbers = new Map(data.events.map((event, i) => [event.id, i + 1]));
  const changePage = (next: number) => setPageSelection({ scope: pageScope, page: next });
  const first = events[0], last = events.at(-1)!;
  const startingCash = first.type === 'Başlangıç' ? first.cash : first.cash - first.cashChange;
  const minimumCash = Math.min(startingCash, ...events.map(event => event.cash));
  const assumptions = events.filter(event => event.certainty === 'Tarih varsayımı').length;
  const index = data.months.indexOf(selected);
  const scope = selected === 'all' ? 'Tüm dönem' : monthLabel(selected);
  return <div className="timeline-workspace">
    <aside className="timeline-overview" aria-label="Dönem kontrolü">
    <h2 className="timeline-overview-heading">Dönem özeti</h2>
    <div className="timeline-toolbar">
      <div className="timeline-month"><Select aria-label="Gösterilen dönem" value={selected} onChange={value => value && changeSelection(value)} allowDeselect={false} data={[...data.months.map(month => ({ value: month, label: monthLabel(month) })), { value: 'all', label: 'Tüm dönem' }]} /></div>
      <div className="button-row timeline-period-buttons"><button className="quiet-button timeline-month-arrow" aria-label="Önceki ay" disabled={index <= 0} onClick={() => changeSelection(data.months[index - 1])}><MonthArrow /></button><button className="quiet-button timeline-month-arrow" aria-label="Sonraki ay" disabled={index < 0 || index >= data.months.length - 1} onClick={() => changeSelection(data.months[index + 1])}><MonthArrow next /></button></div>
    </div>
    <section className="timeline-summary" aria-label={`${scope} özeti`}>
      <div className="timeline-summary-cash"><span>Son nakit</span><strong className={last.cash < 0 ? 'negative' : undefined}>{money(last.cash)}</strong></div>
      <div className="timeline-summary-debt"><span>Kalan kart borcu</span><strong>{money(last.totalDebt)}</strong></div>
      <div className="timeline-summary-secondary"><span>Başlangıç nakdi</span><strong>{money(startingCash)}</strong></div>
      <div className="timeline-summary-secondary"><span>En düşük nakit</span><strong className={minimumCash < 0 ? 'negative' : undefined}>{money(minimumCash)}</strong></div>
    </section>
    <aside className="timeline-caveat" aria-label="Tarih ve ödeme varsayımları"><strong>{assumptions > 0 ? `${assumptions} adımın günü varsayımdır.` : 'Tarihler ödeme planıdır.'}</strong></aside>
    {minimumCash < 0 && <p className="timeline-cash-warning" role="alert">Bu dönemde planlanan nakit {money(minimumCash)} seviyesine düşüyor. Negatif tutar kullanılabilir para değildir; ödeme sırası veya finansmanı düzeltilmelidir.</p>}
    </aside>
    <section className="timeline-flow" aria-label="Ödeme akışı">
    <Tabs value={view} onChange={setView} keepMounted={false} unstyled className="timeline-views">
    <div className="timeline-flow-heading"><div><div className="timeline-flow-meta"><p className="timeline-flow-label">Ödeme akışı</p><span className="timeline-step-count">{events.length} adım</span></div><h2>{scope}</h2></div><Tabs.List aria-label="Takvim görünümü" className="timeline-view-switch"><Tabs.Tab value="timeline" aria-label="Zaman akışı">Akış</Tabs.Tab><Tabs.Tab value="table">Tablo</Tabs.Tab></Tabs.List></div>
    <div className="timeline-filters" role="group" aria-label="Adımları filtrele">{journeyFilters.map(item => <button key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => { setFilter(item.id); setPageSelection({ scope: `${selected}:${item.id}`, page: 0 }); }}>{item.label}</button>)}</div>
    {filter !== 'all' && <p className="timeline-filter-note" role="status">{filteredEvents.length} / {events.length} adım gösteriliyor. Bakiyeler tüm işlemleri içerir.</p>}
    {filteredEvents.length === 0 && <div className="timeline-empty"><h3>Bu dönemde {filter === 'purchase' ? 'alışveriş' : filter === 'payment' ? 'ödeme' : 'gelir'} adımı yok.</h3><p>Başka bir ay seçebilir veya tüm adımları görüntüleyebilirsin.</p></div>}
    {filteredEvents.length > stepsPerPage && <StepPages position="üst" page={page} count={filteredEvents.length} onChange={changePage} />}
    <Tabs.Panel value="timeline" aria-busy={rendering}><div className="timeline-journey" aria-label="Kronolojik ödeme adımları">
      {[...dates].map(([date, day]) => <section className="timeline-day" key={date} aria-labelledby={`timeline-date-${date}`}><DayHeading date={date} count={day.length} /><ol>{day.map(event => <EventStep key={event.id} event={event} number={eventNumbers.get(event.id)!} incomes={incomesByMonth.get(event.month) ?? []} />)}</ol></section>)}
    </div></Tabs.Panel>
    <Tabs.Panel value="table" aria-busy={rendering}>{visibleEvents.length > 0 && <EventTable events={visibleEvents} eventNumbers={eventNumbers} incomesByMonth={incomesByMonth} />}</Tabs.Panel>
    {filteredEvents.length > stepsPerPage && <StepPages position="alt" page={page} count={filteredEvents.length} onChange={changePage} />}
    </Tabs>
    </section>
  </div>;
}

export default function TimelinePage() {
  const state = useTimeline();
  return <div className="timeline-page">
    <header className="timeline-heading">
      <div className="timeline-title"><h1>Timeline</h1><p className="muted">Nakit ve borç takvimi.</p></div>
      <div className="timeline-heading-tools"><button className="quiet-button" disabled={state.loading} onClick={state.refresh}>Yenile</button></div>
    </header>
    <p className="timeline-plan-label"><span>Plan</span> Gerçekleşmiş ödeme değildir.</p>
    {state.error && !state.loading && <p className="error-message" role="alert">{state.error} {state.data ? 'Son başarılı takvim gösteriliyor.' : 'E-tabloyu kontrol edip yeniden deneyin.'}</p>}
    {state.data ? <TimelineJourney data={state.data} /> : state.loading ? <TimelineLoading /> : <p className="loading-message">Doğrulanmış Timeline verisi şu anda alınamıyor.</p>}
    <footer className="timeline-data-note"><span className="timeline-sync" role="status" aria-live="polite">{state.loading ? 'Kontrol ediliyor…' : state.updatedAt ? `Güncellendi ${state.updatedAt.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' })}` : 'Google Sheets bağlantısı'}</span><a className="timeline-sheet-link" href={timelineSheetUrl} target="_blank" rel="noreferrer">E-tabloda aç <span aria-hidden="true">↗</span></a><p>Açıkken her dakika yenilenir. Aynı gün maaşın geliş saati ve ödeme sırası ara bakiyeyi değiştirebilir.</p></footer>
  </div>;
}
