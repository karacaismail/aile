import { useEffect, useMemo, useState } from 'react';
import { Tabs } from '@mantine/core';
import { Select } from '../dashboard/Select';
import { financeMoney as money } from '../finance/format';
import { financeSheetUrl, type FinanceLedger, type FinanceEvent } from '../finance/data';
import { dateLabel, monthLabel } from './data';
import { useFinance } from '../finance/useFinance';
import { TimelineLoading } from './TimelineLoading';
import { isPurchase, purchaseDetails, type PurchaseDetails } from './purchase';
import './timeline.css';

const signedMoney = (value: number) => `${value > 0 ? '+' : ''}${money(value)}`;
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
const matchesFilter = (event: FinanceEvent, filter: JourneyFilter) => filter === 'all' ||
  (filter === 'payment' && event.cashChange < 0) || (filter === 'purchase' && isPurchase(event)) ||
  (filter === 'income' && event.type === 'Gelir');
const purchaseGroups = [{ id: 'all', label: 'Tüm alımlar' }, { id: 'before', label: 'Taşınma öncesi' }, { id: 'after', label: 'Taşınma sonrası' }] as const;
type PurchaseGroup = typeof purchaseGroups[number]['id'];
function MonthArrow({ next = false }: { next?: boolean }) {
  return <svg className="timeline-arrow" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8"><path d={next ? 'M9 5l7 7-7 7' : 'M15 5l-7 7 7 7'} /></svg>;
}
function StepPages({ position, page, count, onChange }: { position: 'üst' | 'alt'; page: number; count: number; onChange: (page: number) => void }) {
  return <nav className="timeline-pagination" aria-label={`Adım sayfaları ${position}`}>
    <p aria-live="polite">{page * stepsPerPage + 1}–{Math.min((page + 1) * stepsPerPage, count)} / {count} adım</p>
    <div className="button-row"><button className="quiet-button" disabled={page === 0} onClick={() => onChange(page - 1)}>Önceki adımlar</button><button className="quiet-button" disabled={(page + 1) * stepsPerPage >= count} onClick={() => onChange(page + 1)}>Sonraki adımlar</button></div>
  </nav>;
}
function EventDetails({ event }: { event: FinanceEvent }) {
  return <div className="timeline-details">
    <p className="timeline-source"><strong>{event.certainty}</strong> · {event.source}</p>
    {event.fundingGap > 0 && <p className="negative">Fon eksiği {money(event.fundingGap)} · Kullanılabilir para değildir.</p>}
  </div>;
}
function EventEffects({ event, previous }: { event: FinanceEvent; previous?: FinanceEvent }) {
  const weeklyCash = /^week-\d+-etut-\d+$/.test(event.id) && event.type === 'Nakit hareketi' && event.cashChange < 0 && event.source.includes('her cuma akşamı');
  if (weeklyCash) return <div className="timeline-cash-payment" role="group" aria-label="Planlanan nakit ödeme bilgileri">
    <p>Elden nakit · Her cuma akşamı</p>
    <dl className="timeline-purchase-facts">
      <div className="timeline-purchase-amount"><dt>Planlanan ödeme</dt><dd>{money(Math.abs(event.cashChange))}</dd></div>
      <div><dt>Ödeme tarihi</dt><dd><time dateTime={event.date}>{dateLabel(event.date)}</time></dd></div>
    </dl>
    <p>Bu adımda yeni KMH kullanımı: {previous ? money(Math.max(0, Math.round((event.kmhPrincipal - previous.kmhPrincipal) * 100) / 100)) : 'doğrulanamadı'}.</p>
    <p className="timeline-purchase-status">Planlanan işlem · Gerçekleşmiş harcama değildir.</p>
  </div>;
  return <div className="timeline-effect"><span className="timeline-change" data-tone={event.cashChange > 0 ? 'inflow' : event.cashChange < 0 ? 'outflow' : 'neutral'}><span>Net nakit etkisi</span> <strong>{signedMoney(event.cashChange)}</strong></span></div>;
}
const balanceFields = [
  ['cash', 'Harcanabilir nakit'], ['cardDebt', 'Toplam kart borcu'],
  ['requiredBalance', 'Net nakit konumu'], ['kmhPrincipal', 'KMH anaparası'],
  ['kmhCost', 'KMH faiz + vergi'], ['denizPrincipal', 'Denizbank anapara'],
  ['denizCost', 'Denizbank faiz + vergi'], ['isPrincipal', 'İşbank anapara'],
  ['isCost', 'İşbank faiz + vergi'],
] as const;
function PurchaseSummary({ event, purchase }: { event: FinanceEvent; purchase: PurchaseDetails | null }) {
  return <div className="timeline-purchase" role="group" aria-label="Planlanan alım bilgileri">
    <dl className="timeline-purchase-facts">
      <div className="timeline-purchase-amount"><dt>Planlanan alım tutarı</dt><dd>{purchase ? money(purchase.amount) : <span className="timeline-missing">Tutar doğrulanamadı</span>}</dd></div>
      <div><dt>Alım tarihi</dt><dd><time dateTime={event.date}>{dateLabel(event.date)}</time></dd></div>
      <div><dt>Ödeme yöntemi</dt><dd>{purchase?.method ?? 'Yöntem doğrulanamadı'}{purchase?.instalments && <span className="timeline-purchase-terms">{purchase.instalments === 1 ? 'Tek çekim' : `${purchase.instalments} taksit`}</span>}</dd></div>
    </dl>
    {purchase && <p className="timeline-purchase-impact">{purchase.method === 'Nakit' ? <>Bu adımda kasadan {money(purchase.amount)} çıkar.</> : <>Alım bedeli karta borç yazılır. Kasadan ödeme, ekstre ödeme adımlarındadır.</>}</p>}
    <p className="timeline-purchase-status">Planlanan işlem · Gerçekleşmiş harcama değildir.</p>
  </div>;
}
function FutureInstalments({ event }: { event: FinanceEvent }) {
  return event.futureInstalments > 0 ? <p className="timeline-future-instalments">İki kartın gelecek ekstrelerdeki taksit toplamı: <strong>{money(event.futureInstalments)}</strong>. Toplam kart borcuna dahildir; bu alımın taksiti değildir.</p> : null;
}
function EventStep({ event, number, purchase, previous }: { event: FinanceEvent; number: number; purchase: PurchaseDetails | null; previous?: FinanceEvent }) {
  const buying = isPurchase(event);
  const balanceTitle = buying ? 'Alım sonrası · tüm hesaplar' : 'Adım sonrası · tüm hesaplar';
  return <li className={`timeline-step${buying ? ' timeline-purchase-step' : ''}${['Kontrol', 'Ay sonu'].includes(event.type) ? ' timeline-control' : ''}`}>
    <article aria-label={`${number}. adım · ${event.title}`}>
      <div className="timeline-step-context">
        <p className="timeline-meta"><span className="timeline-kind" data-kind={event.type}>{event.type}</span><span>Adım {number}</span></p>
        <h3>{event.title}</h3>
        {buying ? <PurchaseSummary event={event} purchase={purchase} /> : <EventEffects event={event} previous={previous} />}
      </div>
      <div className="timeline-account-state" role="group" aria-label={balanceTitle}>
        <h4>{balanceTitle}</h4>
        <dl className="timeline-balances" aria-label="Bu adımdan sonraki hesap bakiyesi">
          {balanceFields.slice(0, 4).map(([key, label], index) => <div className={index > 1 ? 'timeline-bank-debt' : undefined} key={key}><dt>{label}</dt><dd className={event[key] < 0 ? 'negative' : undefined}>{money(event[key])}</dd></div>)}
        </dl>
        <dl className="timeline-secondary-balances" aria-label="Banka ve maliyet ayrıntıları">{balanceFields.slice(4).map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{money(event[key])}</dd></div>)}</dl>
        <FutureInstalments event={event} />
      </div>
      <EventDetails event={event} />
    </article>
  </li>;
}
function EventTable({ events, eventNumbers, purchases, allEvents }: { events: FinanceEvent[]; eventNumbers: Map<string, number>; purchases: Map<string, PurchaseDetails | null>; allEvents: FinanceEvent[] }) {
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
          <td className="timeline-table-event"><p className="timeline-meta"><span className="timeline-kind" data-kind={event.type}>{event.type}</span></p><strong className="timeline-table-title">{event.title}</strong>{isPurchase(event) ? <PurchaseSummary event={event} purchase={purchases.get(event.id) ?? null} /> : <EventEffects event={event} previous={allEvents[(eventNumbers.get(event.id) ?? 1) - 2]} />}</td>
          {balanceFields.map(([key]) => <td className={`numeric${event[key] < 0 ? ' negative' : ''}`} data-balance={key} key={key}>{money(event[key])}</td>)}
          <td className="timeline-table-note"><FutureInstalments event={event} /><EventDetails event={event} /></td>
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

function TimelineJourney({ data }: { data: FinanceLedger }) {
  const purchases = useMemo(() => new Map(data.events.map((event, index) => [event.id, purchaseDetails(event, data.events[index - 1])])), [data.events]);
  const months = data.months.map(month => month.month);
  const [selection, setSelection] = useState('');
  const [view, setView] = useState<string | null>('timeline');
  const [purchaseGroup, setPurchaseGroup] = useState<PurchaseGroup>('all');
  const [filter, setFilter] = useState<JourneyFilter>('all');
  const [pageSelection, setPageSelection] = useState({ scope: '', page: 0 });
  const changeSelection = (next: string) => { setSelection(next); setPageSelection({ scope: next, page: 0 }); };
  const selected = selection === 'all' || months.includes(selection) ? selection : months[0];
  const events = data.events.filter(event => selected === 'all' || event.date.startsWith(selected));
  const filteredEvents = events.filter(event => matchesFilter(event, filter) && (filter !== 'purchase' || purchaseGroup === 'all' || event.type === `Alışveriş · ${purchaseGroup === 'before' ? 'Taşınma öncesi' : 'Taşınma sonrası'}`));
  const pageScope = `${selected}:${filter}:${purchaseGroup}`;
  const page = Math.max(0, Math.min(pageSelection.scope === pageScope ? pageSelection.page : 0, Math.floor((filteredEvents.length - 1) / stepsPerPage)));
  const pageEvents = filteredEvents.slice(page * stepsPerPage, (page + 1) * stepsPerPage);
  // A fresh copy of the same ledger must not collapse an already visible page.
  const renderScope = JSON.stringify([selected, filter, purchaseGroup, page, view, pageEvents.map(event => event.id)]);
  const visibleCount = useVisibleStepCount(renderScope, pageEvents.length);
  const visibleEvents = pageEvents.slice(0, visibleCount);
  const rendering = visibleCount < pageEvents.length;
  const dates = new Map<string, FinanceEvent[]>();
  visibleEvents.forEach(event => { const day = dates.get(event.date) ?? []; day.push(event); dates.set(event.date, day); });
  const eventNumbers = new Map(data.events.map((event, i) => [event.id, i + 1]));
  const changePage = (next: number) => setPageSelection({ scope: pageScope, page: next });
  const first = events[0], last = events.at(-1)!;
  const previous = data.events[data.events.indexOf(first) - 1];
  const startingCash = previous?.cash ?? first.cash;
  const maximumGap = Math.max(...events.map(event => event.fundingGap));
  const monthEnd = data.months.find(month => month.month === last.date.slice(0, 7))!;
  const index = months.indexOf(selected);
  const scope = selected === 'all' ? 'Tüm dönem' : monthLabel(selected);
  return <div className="timeline-workspace">
    <aside className="timeline-overview" aria-label="Dönem kontrolü">
    <h2 className="timeline-overview-heading">Dönem sonu</h2>
    <div className="timeline-toolbar">
      <div className="timeline-month"><Select aria-label="Gösterilen dönem" value={selected} onChange={value => value && changeSelection(value)} allowDeselect={false} data={[...months.map(month => ({ value: month, label: monthLabel(month) })), { value: 'all', label: 'Tüm dönem' }]} /></div>
      <div className="button-row timeline-period-buttons"><button className="quiet-button timeline-month-arrow" aria-label="Önceki ay" disabled={index <= 0} onClick={() => changeSelection(months[index - 1])}><MonthArrow /></button><button className="quiet-button timeline-month-arrow" aria-label="Sonraki ay" disabled={index < 0 || index >= months.length - 1} onClick={() => changeSelection(months[index + 1])}><MonthArrow next /></button></div>
    </div>
    <section className="timeline-summary" aria-label={`${scope} özeti`}>
      <div className="timeline-summary-cash"><span>Harcanabilir nakit</span><strong className={last.cash < 0 ? 'negative' : undefined}>{money(last.cash)}</strong></div>
      <div className="timeline-summary-debt"><span>Kalan kart borcu</span><strong>{money(last.cardDebt)}</strong></div>
      <div className="timeline-summary-secondary"><span>Başlangıç nakdi</span><strong>{money(startingCash)}</strong></div>
      <div className="timeline-summary-secondary"><span>KMH anaparası</span><strong>{money(last.kmhPrincipal)}</strong></div>
      <div className="timeline-summary-secondary"><span>KMH faiz + vergi</span><strong>{money(last.kmhCost)}</strong></div>
      <div className="timeline-summary-secondary"><span>Net nakit ve borç</span><strong className={monthEnd.knownNetAssets < 0 ? 'negative' : undefined}>{money(monthEnd.knownNetAssets)}</strong></div>
    </section>
    {maximumGap > 0 && <p className="timeline-cash-warning" role="alert">Bu dönemde fon eksiği {money(maximumGap)} seviyesine ulaşıyor. Bu tutar kullanılabilir para değildir.</p>}
    </aside>
    <section className="timeline-flow" aria-label="Ödeme akışı">
    <Tabs value={view} onChange={setView} keepMounted={false} unstyled className="timeline-views">
    <div className="timeline-flow-heading"><div><div className="timeline-flow-meta"><p className="timeline-flow-label">Ödeme akışı</p><span className="timeline-step-count">{events.length} adım</span></div><h2>{scope}</h2></div><Tabs.List aria-label="Takvim görünümü" className="timeline-view-switch"><Tabs.Tab value="timeline" aria-label="Zaman akışı">Akış</Tabs.Tab><Tabs.Tab value="table">Tablo</Tabs.Tab></Tabs.List></div>
    <div className="timeline-filters" role="group" aria-label="Adımları filtrele">{journeyFilters.map(item => <button key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => { setFilter(item.id); setPageSelection({ scope: `${selected}:${item.id}:${purchaseGroup}`, page: 0 }); }}>{item.label}</button>)}</div>
    {filter === 'purchase' && <>
      <div className="timeline-filters timeline-purchase-filters" role="group" aria-label="Alım grubu">{purchaseGroups.map(item => <button key={item.id} type="button" aria-pressed={purchaseGroup === item.id} onClick={() => { setPurchaseGroup(item.id); setPageSelection({ scope: `${selected}:${filter}:${item.id}`, page: 0 }); }}>{item.label}</button>)}</div>
      <p className="timeline-filter-note">Eşya ve taşınma giderleri, e-tablodaki kategorilerine göre ayrılır. Sıra planlanan alım tarihidir; teslimat tarihi değildir.</p>
      {selected !== 'all' && <button className="quiet-button" onClick={() => changeSelection('all')}>Tüm dönemde göster</button>}
    </>}
    {filter !== 'all' && <p className="timeline-filter-note" role="status">{filteredEvents.length} / {events.length} adım gösteriliyor. Bakiyeler tüm işlemleri içerir.</p>}
    {filteredEvents.length === 0 && <div className="timeline-empty"><h3>Bu dönemde {filter === 'purchase' ? purchaseGroup === 'all' ? 'alışveriş adımı' : purchaseGroup === 'before' ? 'taşınma öncesi alımı' : 'taşınma sonrası alımı' : filter === 'payment' ? 'ödeme adımı' : 'gelir adımı'} yok.</h3><p>Başka bir ay seçebilir veya tüm adımları görüntüleyebilirsin.</p></div>}
    {filteredEvents.length > stepsPerPage && <StepPages position="üst" page={page} count={filteredEvents.length} onChange={changePage} />}
    <Tabs.Panel value="timeline" aria-busy={rendering}><div className="timeline-journey" aria-label="Kronolojik ödeme adımları">
      {[...dates].map(([date, day]) => <section className="timeline-day" key={date} aria-labelledby={`timeline-date-${date}`}><DayHeading date={date} count={day.length} /><ol>{day.map(event => <EventStep key={event.id} event={event} number={eventNumbers.get(event.id)!} purchase={purchases.get(event.id) ?? null} previous={data.events[eventNumbers.get(event.id)! - 2]} />)}</ol></section>)}
    </div></Tabs.Panel>
    <Tabs.Panel value="table" aria-busy={rendering}>{visibleEvents.length > 0 && <EventTable events={visibleEvents} eventNumbers={eventNumbers} purchases={purchases} allEvents={data.events} />}</Tabs.Panel>
    {filteredEvents.length > stepsPerPage && <StepPages position="alt" page={page} count={filteredEvents.length} onChange={changePage} />}
    </Tabs>
    </section>
  </div>;
}

export default function TimelinePage() {
  const state = useFinance();
  return <div className="timeline-page">
    <header className="timeline-heading">
      <div className="timeline-title"><h1>Timeline</h1><p className="muted">Nakit ve borç takvimi.</p></div>
      <div className="timeline-heading-tools"><button className="quiet-button" disabled={state.loading} onClick={state.refresh}>Yenile</button></div>
    </header>
    <p className="timeline-plan-label"><span>Plan</span> Gerçekleşmiş ödeme değildir.</p>
    {state.error && !state.loading && <p className="error-message" role="alert">{state.error} E-tabloyu kontrol edip yeniden deneyin.</p>}
    {state.data ? <TimelineJourney data={state.data} /> : state.loading ? <TimelineLoading /> : <p className="loading-message">Doğrulanmış Timeline verisi şu anda alınamıyor.</p>}
    <p className="timeline-model-note">Nakit, kartlar ve KMH aynı finansman hesabından gelir. <a href="#/finansman">Aylık özet ve ayrıntılı tablo</a></p>
    {state.data && <div className="timeline-model-notes"><p><strong>Kaynak durumu</strong> {state.data.status}</p>{state.data.notes.map((note, index) => <p key={index}>{note}</p>)}</div>}
    <aside className="timeline-caveat" aria-label="Hesap kapsamı"><p>Harcanabilir nakit, ayrılan bütçeler sonrasıdır. Net nakit konumu KMH kullanımını da içerir; negatif tutar harcanabilir para değildir.</p><p>Gelecek taksitler kart borcuna dahildir. Tarih ve maliyet koşulları her adımın kaynağında görünür.</p></aside>
    <footer className="timeline-data-note"><span className="timeline-sync" role="status" aria-live="polite">{state.loading ? 'Kontrol ediliyor…' : state.updatedAt ? `Güncellendi ${state.updatedAt.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' })}` : 'Google Sheets bağlantısı'}</span><a className="timeline-sheet-link" href={financeSheetUrl} target="_blank" rel="noreferrer">E-tabloda aç <span aria-hidden="true">↗</span></a><p>Açıkken her dakika yenilenir. Aynı gün içindeki sıra e-tablodaki hesap sırasıdır; banka hareketinin gerçekleştiğini göstermez.</p></footer>
  </div>;
}
