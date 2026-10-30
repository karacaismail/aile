import { useHashLocation } from 'wouter/use-hash-location';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { MantineProvider, TextInput, createTheme } from '@mantine/core';
import { useReducedMotion } from '@mantine/hooks';
import { tokens, cssTokens, dropdownTransition } from './tokens';
import { useKeyboardMode } from './keyboard';
import { Select } from './Select';
import { useBudget } from './useBudget';
import { money, percent, percentChange, sheetUrl, type Budget, type Category, type Irregular, type Month } from './data';
import { DataTable, type Column } from './DataTable';
import './dashboard.css';
const VehiclePage = lazy(() => import('../vehicle/VehiclePage'));
const TimelinePage = lazy(() => import('../timeline/TimelinePage'));
const Charts = lazy(() => import('./Charts'));
const dashboardTheme = createTheme({ fontFamily: tokens.font, primaryColor: 'blue', defaultRadius: tokens.radius, fontSizes: { xs: '1rem', sm: '1rem', md: '1rem' }, components: { Input: { styles: { input: { minHeight: 44, fontSize: '1rem' } } }, Select: { styles: { option: { minHeight: 44, fontSize: '1rem' } } } } });
export const Amount = ({ value }: { value: number | null }) => <span className={value !== null && value < 0 ? 'negative' : undefined}>{money(value)}</span>;
function DeferredCharts({ data, selected }: { data: Budget; selected: number }) {
  const ref = useRef<HTMLDivElement>(null); const [visible, setVisible] = useState(false);
  useEffect(() => { const observer = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: '80px' }); if (ref.current) observer.observe(ref.current); return () => observer.disconnect(); }, []);
  return <div ref={ref} className="charts-host">{visible ? <Suspense fallback={<p role="status">Grafikler hazırlanıyor…</p>}><Charts data={data} selected={selected} /></Suspense> : <p>Grafikler</p>}</div>;
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
function BudgetContent({ data }: { data: Budget }) {
  const nowKey = new Intl.DateTimeFormat('sv-SE', { year: 'numeric', month: '2-digit', timeZone: 'Europe/Istanbul' }).format(new Date());
  const [month, setMonth] = useState(data.months.find(m => m.key === nowKey)?.key ?? data.months[0].key);
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
  return <>
    <div className="page-heading"><div><p className="eyebrow">AİLE BÜTÇESİ</p><h1>Aile bütçesi</h1><p className="muted">{data.months[0].label} — {data.months.at(-1)!.label}</p></div><div className="month-picker"><Select label="Gösterilen ay" value={current.key} onChange={v => v && setMonth(v)} data={data.months.map(m => ({ value: m.key, label: m.label }))} {...selectProps} /></div></div>
    <div className="provenance"><span className="source-label">{current.source}</span><span>Güncel değerler Gerçekleşen sayfasından gelir. Planı izleyen tutarlar, yapılmış ödeme anlamına gelmez.</span></div>
    <section className="metrics" aria-label="Seçili ay özeti">{(['income','expense','saving','free'] as const).map((key,i) => <article className={`metric ${key === 'free' ? 'metric-emphasis' : ''}`} key={key}><h2>{['Gelir','Ödemeler','Birikime ayrılan','Aylık net nakit'][i]}</h2><p className="metric-value"><Amount value={current[key].current} /></p><p>Plan <Amount value={current[key].plan} /></p><p className="muted">Önceki aya göre {previous ? key === 'free' ? money(current[key].current - previous[key].current) : percent(percentChange(current[key].current, previous[key].current)) : '—'}</p></article>)}</section>
    <div className="balance-strip"><span>Seçili ay sonunda nakit <strong><Amount value={current.balance.current} /></strong></span><span>Dönem sonunda nakit <strong><Amount value={data.months.at(-1)!.balance.current} /></strong></span></div>
    <nav className="view-nav" aria-label="Bütçe görünümleri">{[['overview','Genel bakış'],['months','Aylık tablo'],['categories','Kalemler ve fark'],['irregular','Düzensiz giderler']].map(([key, label]) => <button key={key} aria-pressed={view === key} onClick={() => { setView(key); setQuery(''); }}>{label}</button>)}</nav>
    {view === 'overview' && <DeferredCharts data={data} selected={index} />}
    {view === 'months' && <section><h2>Aydan aya bütün bütçe</h2><p className="muted">Tüm dönem. Başlıklara dokunarak sıralayın; ayrıntılar için tabloyu yatay kaydırın.</p><DataTable rows={data.months} columns={deltaColumns} rowKey={m => m.key} caption="Aylık plan ve güncel karşılaştırması" /></section>}
    {view === 'categories' && <section><h2>{current.label} kalemleri</h2><p className="muted">Fark = güncel − plan. Giderde pozitif fark daha fazla harcama; gelirde pozitif fark daha fazla gelirdir.</p>{data.schema === 'cashflow' && <p className="muted">Kalemler harcamanın ait olduğu ayı gösterir. Kartla alışveriş ile karta ödeme farklı aylarda olabilir; kasadan çıkan tutarları aylık özette ve Timeline’da izleyin.</p>}<div className="filters"><TextInput label="Kalem ara" value={query} onChange={e => setQuery(e.currentTarget.value)} placeholder="Örneğin kira" /><Select label="Kategori" value={group} onChange={v => v && setGroup(v)} data={['Tümü', ...data.groups.map(g => g.label)]} {...selectProps} /></div><DataTable rows={categories} columns={categoryCols} rowKey={r => r.id} caption={`${current.label} kategori karşılaştırması`} /></section>}
    {view === 'irregular' && <section><h2>Taşınma, özel günler ve tek seferlik ödemeler</h2><p className="muted">Tüm dönemden {data.irregular.length} kalem. {data.irregular.filter(r => r.current === null).length} kalemde tutar eksik; bunlar sıfır değildir.</p><div className="filters"><TextInput label="Gider ara" value={query} onChange={e => setQuery(e.currentTarget.value)} placeholder="Gider, oda veya durum" /><Select label="Gider türü" value={type} onChange={v => v && setType(v)} data={['Tümü','Tutar eksik', ...new Set(data.irregular.map(r => r.type).filter(Boolean))]} {...selectProps} /></div><DataTable rows={irregular} columns={irregularCols} rowKey={r => r.id} caption="Düzensiz giderlerin plan ve güncel tutarları" /></section>}
  </>;
}
export default function Dashboard() {
  useKeyboardMode();
  const [location] = useHashLocation();
  const timeline = location === '/timeline';
  const state = useBudget(!timeline);
  const vehicle = location.startsWith('/arac');
  return <MantineProvider theme={dashboardTheme} forceColorScheme="light"><div className={`budget-app${vehicle ? ' vehicle-shell' : timeline ? ' timeline-shell' : ''}`} style={cssTokens}>
    <a className="skip-link" href="#budget-content" onClick={e=>{e.preventDefault();document.getElementById('budget-content')?.focus();}}>İçeriğe geç</a>
    <header className="budget-header"><a href="#/pano" className="wordmark">aile<span>birlikte planla</span></a><nav aria-label="Ana gezinme"><a href="#/pano" aria-current={!vehicle && !timeline ? "page" : undefined}>Bütçe</a><a href="#/timeline" aria-current={timeline ? "page" : undefined}>Timeline</a><a href="#/arac" aria-current={vehicle ? "page" : undefined}>Araç ve finansman</a><a href={sheetUrl} target="_blank" rel="noreferrer">E-tabloyu aç</a></nav></header>
    <main id="budget-content" tabIndex={-1}>
      {!vehicle && !timeline && <div className="sync-strip"><span role="status" aria-live="polite">{state.loading ? 'Google Sheets kontrol ediliyor…' : state.updatedAt ? `Son okuma ${state.updatedAt.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })} · Açıkken her dakika yenilenir` : 'Google Sheets bağlantısı'}</span><button className="quiet-button" disabled={state.loading} onClick={state.refresh}>Yenile</button></div>}
      {!timeline && state.error && <div role="alert" className="error-message">{state.error} {state.data ? 'Son başarılı veriler gösteriliyor.' : 'E-tablo erişimini kontrol edip yeniden deneyin.'}</div>}
      {timeline ? <Suspense fallback={<p>Timeline yükleniyor…</p>}><TimelinePage /></Suspense> : vehicle ? <Suspense fallback={<p>Araç kataloğu yükleniyor…</p>}><VehiclePage budget={state.data} /></Suspense> : state.data ? <BudgetContent data={state.data} /> : <div className="loading-message"><h1>Aile bütçesi</h1><p>{state.loading ? 'Aylık plan ve güncel tutarlar yükleniyor…' : 'Veriler şu anda alınamıyor.'}</p></div>}
      {vehicle && <div className="sync-strip"><span role="status" aria-live="polite">{state.loading ? 'Google Sheets kontrol ediliyor…' : state.updatedAt ? `Son okuma ${state.updatedAt.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })} · Açıkken her dakika yenilenir` : 'Google Sheets bağlantısı'}</span><button className="quiet-button" disabled={state.loading} onClick={state.refresh}>Yenile</button></div>}
    </main><footer className="budget-footer"><span>Veri kaynağı Google Sheets · Tutarlar Türk lirası</span><a href="#/satinalma">Önceki taşınma planlayıcısı</a></footer>
  </div></MantineProvider>;
}
