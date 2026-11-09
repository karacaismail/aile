import { useHashLocation } from 'wouter/use-hash-location';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { TextInput } from '@mantine/core';
import { useReducedMotion } from '@mantine/hooks';
import { tokens, dropdownTransition } from './tokens';
import { Select } from './Select';
import { TimelineRouteLoading } from '../timeline/TimelineLoading';
import { useBudget } from './useBudget';
import { money, percent, percentChange, type Budget, type Category, type Irregular, type Month } from './data';
import { DataTable, type Column } from './DataTable';
import { PageHeader } from '../app/family/PageHeader';
import { DataStatus } from '../app/family/DataStatus';
import { JourneyLinks, SourceNote, SectionHeading } from '../components/Info';
import { periodFallback, useFinancePeriod } from '../app/family/FinancePeriod';
import { loadCharts } from './chartLoader';
import { OptionalCharts } from './OptionalCharts';
import './dashboard.css';
const VehiclePage = lazy(() => import('../vehicle/VehiclePage'));
const TimelinePage = lazy(() => import('../timeline/TimelinePage'));
const FinancePage = lazy(() => import('../finance/FinancePage'));
const Charts = lazy(loadCharts);
const HomePlanPage = lazy(() => import('../home/HomePlanPage'));
const RetirementPage = lazy(() => import('../retirement/RetirementPage'));

export const Amount = ({ value }: { value: number | null }) => <span className={value !== null && value < 0 ? 'negative' : undefined}>{money(value)}</span>;
function DeferredCharts({ data, selected }: { data: Budget; selected: number }) {
  const ref = useRef<HTMLDivElement>(null); const [visible, setVisible] = useState(false);
  useEffect(() => { const observer = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: '80px' }); if (ref.current) observer.observe(ref.current); return () => observer.disconnect(); }, []);
  return <div ref={ref} className="charts-host">{visible ? <OptionalCharts loading="Grafikler hazırlanıyor…" error="Grafikler yüklenemedi. Tutarlar ve Aylık tablo kullanılabilir."><Charts data={data} selected={selected} /></OptionalCharts> : <p>Grafikler</p>}</div>;
}
const diff = (a: number | null, p: number | null) => a === null || p === null ? null : a - p;
const deltaColumns: Column<Month>[] = [
  { key: 'label', label: 'Ay', value: r => r.key, render: r => <strong>{r.label}</strong> },
  { key: 'source', label: 'Veri kaynağı', value: r => r.source, render: r => <span className="source-label">{r.source}</span> },
  ...(['income','expense','saving','free','balance'] as const).flatMap((key, i): Column<Month>[] => [
    { key: `${key}p`, label: ['Gelir','Ödeme','Birikim','Aylık net nakit','Nakit bakiyesi'][i] + ' · plan', numeric: true, value: r => r[key].plan, render: r => <Amount value={r[key].plan} /> },
    { key: `${key}a`, label: ['Gelir','Ödeme','Birikim','Aylık net nakit','Nakit bakiyesi'][i] + ' · güncel', numeric: true, value: r => r[key].current, render: r => <strong><Amount value={r[key].current} /></strong> },
  ]),
];
type Freshness = { loading: boolean; updatedAt: Date | null; refresh: () => void };
const metricLabels = { income: 'Gelir', expense: 'Ödemeler', saving: 'Birikime ayrılan', free: 'Aylık net nakit' } as const;
// Comparison with the previous month is a plain difference of source values; the first month says so once, on the result, instead of a dash.
function comparison(key: keyof typeof metricLabels, current: Month, previous?: Month) {
  if (!previous) return 'İlk ay · önceki ayla karşılaştırma yok';
  const change = current[key].current - previous[key].current;
  if (change === 0) return `${previous.label} ayına göre değişmedi`;
  return `${previous.label} ayına göre ${key === 'free' ? `${change > 0 ? '+' : ''}${money(change)}` : percentChange(current[key].current, previous[key].current) === null ? 'yüzde hesaplanamaz (önceki ay 0 ₺)' : percent(percentChange(current[key].current, previous[key].current))}`;
}
function BudgetContent({ data, loading, updatedAt, refresh }: { data: Budget } & Freshness) {
  const nowKey = new Intl.DateTimeFormat('sv-SE', { year: 'numeric', month: '2-digit', timeZone: 'Europe/Istanbul' }).format(new Date());
  // The month lives in the shared period, so global navigation and return keep it. Only a month the user
  // chooses is written; a period this budget cannot show is named, not replaced or overwritten.
  const [period, setPeriod] = useFinancePeriod();
  const month = data.months.some(m => m.key === period) ? period : data.months.find(m => m.key === nowKey)?.key ?? data.months[0].key;
  const fallback = period && period !== month ? periodFallback(period, data.months.find(m => m.key === month)!.label) : null;
  const [view, setView] = useState('overview');
  const [query, setQuery] = useState(''); const [group, setGroup] = useState('Tümü'); const [type, setType] = useState('Tümü');
  const reduced = useReducedMotion();
  const selectProps = { allowDeselect: false, withScrollArea: false, comboboxProps: { transitionProps: { duration: reduced ? 0 : tokens.duration, timingFunction: tokens.ease, transition: dropdownTransition }, withinPortal: false } };
  const index = Math.max(0, data.months.findIndex(m => m.key === month)), current = data.months[index], previous = data.months[index - 1];
  const categoryCols: Column<Category>[] = [
    { key: 'label', label: 'Kalem', value: r => r.label, render: r => <><strong>{r.label}</strong><small>{r.group}</small></> },
    { key: 'plan', label: 'Plan', numeric: true, value: r => r.plan[index], render: r => <Amount value={r.plan[index]} /> },
    { key: 'current', label: 'Güncel', numeric: true, value: r => r.current[index], render: r => <strong><Amount value={r.current[index]} /></strong> },
    { key: 'difference', label: 'Fark (güncel − plan)', numeric: true, value: r => diff(r.current[index], r.plan[index]), render: r => <Amount value={diff(r.current[index], r.plan[index])} /> },
  ];
  const irregularCols: Column<Irregular>[] = [
    { key: 'label', label: 'Gider', value: r => r.label, render: r => <><strong>{r.label}</strong><small>{r.room}{r.note && ` · ${r.note}`}</small></> },
    { key: 'type', label: 'Tür', value: r => r.type, render: r => r.type },
    { key: 'planMonth', label: 'Plan ayı', value: r => r.planMonth, render: r => r.planMonth || 'Belirlenmedi' },
    { key: 'month', label: 'Ödeme ayı', value: r => r.month, render: r => r.month || 'Belirlenmedi' },
    { key: 'plan', label: 'Plan', numeric: true, value: r => r.plan, render: r => <Amount value={r.plan} /> },
    { key: 'current', label: 'Güncel', numeric: true, value: r => r.current, render: r => <><Amount value={r.current} /><small>{r.manual ? 'Elle güncellendi' : 'Planı izliyor'}</small></> },
    { key: 'status', label: 'Durum', value: r => r.status, render: r => r.status || 'Belirlenmedi' },
  ];
  const q = query.toLocaleLowerCase('tr');
  const categories = data.categories.filter(c => (group === 'Tümü' || c.group === group) && `${c.label} ${c.group}`.toLocaleLowerCase('tr').includes(q));
  const irregular = data.irregular.filter(r => (type === 'Tümü' || (type === 'Tutar eksik' ? r.current === null : r.type === type)) && `${r.label} ${r.room} ${r.status} ${r.note}`.toLocaleLowerCase('tr').includes(q));
  // Decision order: what is left this month, what the month and the period end with, then the components.
  const metric = (key: keyof typeof metricLabels) => <article className={`metric${key === 'free' ? ' metric-emphasis' : ''}`} key={key}>{key === 'free' && <p className="metric-period">{current.label}</p>}<h2>{metricLabels[key]}</h2><p className="metric-value"><Amount value={current[key].current} /></p><p>Plan <Amount value={current[key].plan} /></p>{(previous || key === 'free') && <p className="muted metric-comparison">{comparison(key, current, previous)}</p>}</article>;
  return <>
    <PageHeader location="/pano" lead={`${data.months[0].label} — ${data.months.at(-1)!.label}`} actions={<><button className="quiet-button" disabled={loading} onClick={refresh}>Yenile</button><div className="month-picker"><Select label="Gösterilen ay" value={current.key} onChange={v => v && setPeriod(v)} data={data.months.map(m => ({ value: m.key, label: m.label }))} {...selectProps} /></div></>}>
      <DataStatus loading={loading} updatedAt={updatedAt} />
    </PageHeader>
    {fallback && <p className="budget-period-note" role="note" aria-label="Seçilen dönem">{fallback}</p>}
    <p className="provenance"><strong>{current.label}</strong><span className="source-label">{current.source}</span>{data.bridge && <span>Koşullu hesap</span>}</p>
    <section className="metrics" aria-label="Seçili ay özeti">
      {metric('free')}
      <div className="balance-strip-group" role="group" aria-label="Nakit bakiyesi"><dl className="balance-strip"><div><dt>Seçili ay sonunda nakit</dt><dd><Amount value={current.balance.current} /></dd></div><div><dt>Dönem sonunda nakit</dt><dd><Amount value={data.months.at(-1)!.balance.current} /></dd></div></dl></div>
      <div className="metric-group" role="group" aria-labelledby="budget-components-title"><p className="metric-group-title" id="budget-components-title">{current.label} · gelir, ödemeler ve birikim</p>{(['income', 'expense', 'saving'] as const).map(metric)}</div>
    </section>
    <nav className="view-nav budget-view-nav" aria-label="Bütçe görünümleri">{[['overview','Genel bakış'],['months','Aylık tablo'],['categories','Kalemler ve fark'],['irregular','Düzensiz giderler']].map(([key, label]) => <button key={key} aria-pressed={view === key} onClick={() => { setView(key); setQuery(''); }}>{label}</button>)}</nav>
    {view === 'overview' && <DeferredCharts data={data} selected={index} />}
    {view === 'months' && <section className="budget-detail"><SectionHeading title="Aydan aya bütün bütçe" description="Tüm dönem" /><DataTable rows={data.months} columns={deltaColumns} rowKey={m => m.key} caption="Aylık plan ve güncel karşılaştırması" /></section>}
    {view === 'categories' && <section className="budget-detail"><SectionHeading title={`${current.label} kalemleri`} description="Fark = güncel − plan" />{data.schema === 'cashflow' && <p className="muted">Kalemler harcamanın ait olduğu aya göre.</p>}<div className="filters"><TextInput label="Kalem ara" value={query} onChange={e => setQuery(e.currentTarget.value)} placeholder="Örneğin kira" /><Select label="Kategori" value={group} onChange={v => v && setGroup(v)} data={['Tümü', ...data.groups.map(g => g.label)]} {...selectProps} /></div><DataTable rows={categories} columns={categoryCols} rowKey={r => r.id} caption={`${current.label} kategori karşılaştırması`} /></section>}
    {view === 'irregular' && <section className="budget-detail"><SectionHeading title="Taşınma, özel günler ve tek seferlik ödemeler" description={`${data.irregular.length} kalem · ${data.irregular.filter(r => r.current === null).length} kalemde tutar eksik`} /><div className="filters"><TextInput label="Gider ara" value={query} onChange={e => setQuery(e.currentTarget.value)} placeholder="Gider, oda veya durum" /><Select label="Gider türü" value={type} onChange={v => v && setType(v)} data={['Tümü','Tutar eksik', ...new Set(data.irregular.map(r => r.type).filter(Boolean))]} {...selectProps} /></div><DataTable rows={irregular} columns={irregularCols} rowKey={r => r.id} caption="Düzensiz giderlerin plan ve güncel tutarları" /></section>}
    {/* The shared finance period carries the month; each destination validates it against its own ledger. */}
    <JourneyLinks label="Bütçeden sonraki adım" items={[{ href: '#/timeline', label: `${current.label} ödeme adımları`, detail: 'Nakit, kart ve KMH adım adım', onSelect: () => setPeriod(current.key) }, { href: '#/finansman', label: `${current.label} finansman özeti`, detail: 'Ay sonu borç ve maliyetler', onSelect: () => setPeriod(current.key) }, { href: '#/ev', label: 'Alım planını incele', detail: 'Bütçedeki alımlar ve eksik tutarlar' }]} />
    <SourceNote><p>Güncel değerler Gerçekleşen sayfasından gelir.</p>{data.bridge && <p>{data.bridge.status} · {data.bridge.scope}</p>}</SourceNote>
  </>;
}
export default function Dashboard() {
  const [location] = useHashLocation();
  const timeline = location === '/timeline';
  const finance = location === '/finansman';
  useEffect(() => {
    if (!timeline && !finance) return;
    let active = true;
    let release: (() => void) | undefined;
    // Fetch the ledger while the selected route's larger UI chunk is loading.
    // Other routes neither import the store nor request financial Timeline data.
    void import('../finance/financeStore').then(({ financeStore }) => {
      if (active) release = financeStore.prefetch();
    });
    return () => { active = false; release?.(); };
  }, [timeline, finance]);
  const state = useBudget(!timeline && !finance);
  const vehicle = location.startsWith('/arac');
  const home = location === '/ev';
  const retirement = location === '/emeklilik';
  return <div className={`budget-app${vehicle ? ' vehicle-shell' : timeline ? ' timeline-shell' : ''}`}>
      {!timeline && !finance && state.error && <div role="alert" className="error-message">{state.error} {state.data ? 'Son başarılı veriler gösteriliyor.' : state.errorKind === 'stale' ? 'E-tablodaki finans hesabı yeniden hesaplanmalı. Yenile yalnız sonucu okur.' : state.errorKind === 'integrity' ? 'Kaynak veriyi ve formülleri kontrol edin.' : 'E-tablo erişimini kontrol edip yeniden deneyin.'}</div>}
      {/* Every state of a route keeps the same page heading as its navigation label, including loading and failure. */}
      {finance ? <Suspense fallback={<div aria-busy="true"><PageHeader location="/finansman" /><p role="status">Finansman çalışma alanı hazırlanıyor…</p></div>}><FinancePage /></Suspense> : timeline ? <Suspense fallback={<TimelineRouteLoading />}><TimelinePage /></Suspense> : vehicle ? <Suspense fallback={<div aria-busy="true"><PageHeader location="/arac" /><p role="status">Araç kataloğu yükleniyor…</p></div>}><VehiclePage budget={state.data} /></Suspense> : retirement ? <Suspense fallback={<div aria-busy="true"><PageHeader location="/emeklilik" /><p role="status">SGK ödemeleri yükleniyor…</p></div>}><RetirementPage data={state.data} loading={state.loading} updatedAt={state.updatedAt} refresh={state.refresh} /></Suspense> : home ? <Suspense fallback={<div aria-busy="true"><PageHeader location="/ev" actions={<button className="quiet-button" disabled>Yenile</button>}><DataStatus loading={state.loading} updatedAt={state.updatedAt} /></PageHeader><p role="status">Alım planı yükleniyor…</p></div>}><HomePlanPage data={state.data} loading={state.loading} updatedAt={state.updatedAt} refresh={state.refresh} /></Suspense> : state.data ? <BudgetContent data={state.data} loading={state.loading} updatedAt={state.updatedAt} refresh={state.refresh} /> : <div className="loading-message" aria-busy={state.loading}><PageHeader location="/pano" actions={<button className="quiet-button" disabled={state.loading} onClick={state.refresh}>Yenile</button>}><DataStatus loading={state.loading} updatedAt={state.updatedAt} /></PageHeader><p role="status">{state.loading ? 'Aylık plan ve güncel tutarlar yükleniyor…' : 'Veriler şu anda alınamıyor.'}</p></div>}
      {vehicle && <div className="sync-strip"><DataStatus loading={state.loading} updatedAt={state.updatedAt} /><button className="quiet-button" disabled={state.loading} onClick={state.refresh}>Yenile</button></div>}
  </div>;
}
