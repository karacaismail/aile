import { useState, type ReactNode } from 'react';
import { periodFallback, useFinancePeriod } from '../app/family/FinancePeriod';
import { Tabs } from '@mantine/core';
import { Select } from '../dashboard/Select';
import { financeMoney as money } from './format';
import { financeSheetUrl, type FinanceEvent, type FinanceLedger, type FinanceMonth } from './data';
import { useFinance } from './useFinance';
import { PageHeader } from '../app/family/PageHeader';
import { DataStatus } from '../app/family/DataStatus';
import { FactList, JourneyLinks, SectionHeading, SourceNote } from '../components/Info';
import './finance.css';

const monthLabel = (value: string) => new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}-01T00:00:00Z`));
const dateLabel = (value: string) => new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));
const signedMoney = (value: number) => `${value > 0 ? '+' : ''}${money(value)}`;
const pageSize = 50;
function Amount({ value }: { value: number }) { return <span className={value < 0 ? 'negative' : undefined}>{money(value)}</span>; }
function ScrollTable({ label, children }: { label: string; children: ReactNode }) {
  return <div className="table-scroll finance-table-scroll" tabIndex={0} role="region" aria-label={label} onKeyDown={event => {
    if (event.target === event.currentTarget && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault(); event.currentTarget.scrollLeft += event.currentTarget.clientWidth / 2 * (event.key === 'ArrowRight' ? 1 : -1);
    }
  }}>{children}</div>;
}
function PrincipalAndCost({ principal, cost }: { principal: number; cost: number }) {
  return <dl className="finance-bank"><div><dt>Anapara</dt><dd><Amount value={principal} /></dd></div><div><dt>Faiz + vergi</dt><dd><Amount value={cost} /></dd></div></dl>;
}
function DailyTable({ events }: { events: FinanceEvent[] }) {
  return <ScrollTable label="Günlük finansman tablosu; yatay kaydırılabilir">
    <table className="finance-table" aria-label="Günlük finansman adımları">
      <thead><tr><th scope="col">Tarih</th><th scope="col">Adım ve nakit etkisi</th><th scope="col">Harcanabilir nakit</th><th scope="col">Gerekli bakiye</th><th scope="col">KMH</th><th scope="col">Denizbank kartı</th><th scope="col">İşbank kartı</th><th scope="col">Toplam kart borcu</th><th scope="col">Gelecek taksit</th><th scope="col">Fon eksiği</th><th scope="col">Kesinlik ve kaynak</th></tr></thead>
      <tbody>{events.map(event => <tr key={event.id}>
        <td><time dateTime={event.date}>{dateLabel(event.date)}</time></td>
        <td className="finance-event"><span className="muted">{event.type}</span><strong>{event.title}</strong><span>Nakit etkisi <span className={event.cashChange < 0 ? 'negative' : undefined}>{signedMoney(event.cashChange)}</span></span></td>
        <td className="numeric" data-balance="cash"><Amount value={event.cash} /></td>
        <td className="numeric" data-balance="required"><Amount value={event.requiredBalance} /></td>
        <td><PrincipalAndCost principal={event.kmhPrincipal} cost={event.kmhCost} /></td>
        <td><PrincipalAndCost principal={event.denizPrincipal} cost={event.denizCost} /></td>
        <td><PrincipalAndCost principal={event.isPrincipal} cost={event.isCost} /></td>
        <td className="numeric" data-balance="cards"><strong><Amount value={event.cardDebt} /></strong></td>
        <td className="numeric"><Amount value={event.futureInstalments} /></td>
        <td className={`numeric${event.fundingGap > 0 ? ' negative' : ''}`}><Amount value={event.fundingGap} /></td>
        <td className="finance-source"><strong>{event.certainty}</strong><p>{event.source}</p></td>
      </tr>)}</tbody>
    </table>
  </ScrollTable>;
}
/** Month-end change against the previous month end: a plain difference of two source values. */
function monthChange(key: keyof Omit<FinanceMonth, 'month'>, selected: FinanceMonth, previous?: FinanceMonth, name?: string) {
  if (!previous) return null;
  const change = Math.round((selected[key] - previous[key]) * 100) / 100;
  return <span className="finance-change">{name && `${name}: `}{monthLabel(previous.month)} ay sonuna göre {change === 0 ? 'değişmedi' : signedMoney(change)}</span>;
}
function MonthStep({ direction, month, onSelect }: { direction: 'previous' | 'next'; month?: FinanceMonth; onSelect: (month: string) => void }) {
  const label = direction === 'previous' ? 'Önceki ay' : 'Sonraki ay';
  return <button type="button" className="quiet-button finance-month-step" data-direction={direction} disabled={!month} onClick={() => month && onSelect(month.month)}>
    {direction === 'previous' && <span aria-hidden="true">← </span>}{label}{month && <> · <strong>{monthLabel(month.month)}</strong></>}{direction === 'next' && <span aria-hidden="true"> →</span>}
  </button>;
}
function FinanceContent({ data }: { data: FinanceLedger }) {
  const [selection, setSelection] = useFinancePeriod(data.months[0].month);
  const [view, setView] = useState<string | null>('daily');
  const [page, setPage] = useState(0);
  const selected = data.months.find(month => month.month === selection) ?? data.months[0];
  const position = data.months.indexOf(selected), previous = data.months[position - 1];
  // A period carried from another page may be outside this ledger (or Timeline's all-period scope): say which month is shown.
  const fallback = selection && selection !== selected.month ? periodFallback(selection, monthLabel(selected.month)) : null;
  const choose = (month: string) => { setSelection(month); setPage(0); };
  const events = data.events.filter(event => event.date.startsWith(selected.month));
  const activePage = Math.min(page, Math.max(0, Math.ceil(events.length / pageSize) - 1));
  return <>
    <div className="finance-controls"><Select label="Dönem" value={selected.month} onChange={value => { if (value) choose(value); }} data={data.months.map(month => ({ value: month.month, label: monthLabel(month.month) }))} allowDeselect={false} />
      <div className="finance-month-steps" role="group" aria-label="Aylar arasında geç"><MonthStep direction="previous" month={previous} onSelect={choose} /><MonthStep direction="next" month={data.months[position + 1]} onSelect={choose} /></div></div>
    {fallback && <p className="finance-period-note" role="note" aria-label="Seçilen dönem">{fallback}</p>}
    <section className="finance-summary" aria-label={`${monthLabel(selected.month)} ay sonu`}>
      <SectionHeading title={`${monthLabel(selected.month)} · ay sonu`} description={<>Bu ayın son adımındaki nakit ve borç durumu. {previous ? `Değişimler ${monthLabel(previous.month)} ay sonuna göredir.` : 'İlk ay · önceki ayla karşılaştırma yok.'}</>} />
      <div className="finance-summary-groups">
        <FactList label="Nakit sonucu" tone="strong" items={[
          { label: 'Harcanabilir nakit', value: <Amount value={selected.cash} />, emphasis: true, detail: monthChange('cash', selected, previous) },
          { label: 'Net nakit ve borç', value: <Amount value={selected.knownNetAssets} />, detail: monthChange('knownNetAssets', selected, previous) },
        ]} />
        <FactList label="Borç ve taahhütler" tone="plain" items={[
          { label: 'Toplam kart borcu', value: <Amount value={selected.cardDebt} />, emphasis: true, detail: monthChange('cardDebt', selected, previous) },
          { label: 'KMH anaparası', value: <Amount value={selected.kmhPrincipal} />, detail: <>{monthChange('kmhPrincipal', selected, previous, 'Anapara değişimi')}<span className="finance-change">Faiz + vergi <Amount value={selected.kmhCost} /></span></> },
          { label: 'Gelecek taksit', value: <Amount value={selected.futureInstalments} />, detail: <>Kart borcuna dahildir.{monthChange('futureInstalments', selected, previous)}</> },
        ]} />
      </div>
    </section>
    {selected.fundingGap > 0 && <p className="error-message" role="note">Ay sonunda <strong>{money(selected.fundingGap)}</strong> fon eksiği var. Bu tutar kullanılabilir para değildir.</p>}
    <JourneyLinks label="Bu aydan sonraki adım" items={[{ href: '#/timeline', label: `${monthLabel(selected.month)} ödeme adımları`, detail: 'Bu ay sonuna götüren nakit, kart ve KMH adımları', onSelect: () => setSelection(selected.month) }]} />
    <p className="finance-explanation">Gelecek taksit taahhüdü kart borcuna dahildir; tekrar eklenmez. Net nakit ve borç, kalan TL birikimini içerir; döviz, altın ve eşyaların değerini içermez.</p>
    <Tabs value={view} onChange={setView} unstyled keepMounted={false} className="finance-views">
      <Tabs.List aria-label="Finansman görünümleri" className="finance-view-selector"><Tabs.Tab value="daily">Günlük adımlar</Tabs.Tab><Tabs.Tab value="monthly">Aylık özet</Tabs.Tab></Tabs.List>
      <Tabs.Panel value="daily">
        <SectionHeading title={`${monthLabel(selected.month)} · ${events.length} adım`} description="Soldan sağa: işlem → nakit sonucu → banka borçları → kaynak. Diğer sütunlar için tabloyu yatay kaydırın." />
        <DailyTable events={events.slice(activePage * pageSize, (activePage + 1) * pageSize)} />
        {events.length > pageSize && <nav className="finance-pagination" aria-label="Finansman adım sayfaları"><p aria-live="polite">{activePage * pageSize + 1}–{Math.min((activePage + 1) * pageSize, events.length)} / {events.length} adım</p><div className="button-row"><button className="quiet-button" disabled={activePage === 0} onClick={() => setPage(activePage - 1)}>Önceki adımlar</button><button className="quiet-button" disabled={(activePage + 1) * pageSize >= events.length} onClick={() => setPage(activePage + 1)}>Sonraki adımlar</button></div></nav>}
        <p className="finance-explanation">Gerekli bakiye KMH kullanımını da içeren net nakit konumudur. Negatif değer harcanabilir para değildir. Nakit etkisi, adımlar arasındaki bu bakiye değişimidir.</p>
      </Tabs.Panel>
      <Tabs.Panel value="monthly">
        <SectionHeading title="Aydan aya finansman" description="Google Sheets’teki ay sonu sonuçları. Seçili dönem tabloda vurgulanır." />
        <ScrollTable label="Aylık finansman tablosu; yatay kaydırılabilir"><table className="finance-table" aria-label="Aylık finansman özeti"><thead><tr><th scope="col">Ay</th>{['Harcanabilir nakit', 'KMH anapara', 'KMH faiz + vergi', 'Kart borcu', 'Gelecek taksit', 'Birikimde kalan', 'Net nakit ve borç', 'Fon eksiği'].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{data.months.map(month => <tr key={month.month} data-selected={month.month === selected.month}><th scope="row">{monthLabel(month.month)}</th>{(['cash', 'kmhPrincipal', 'kmhCost', 'cardDebt', 'futureInstalments', 'reserve', 'knownNetAssets', 'fundingGap'] as const).map(key => <td className="numeric" key={key}><Amount value={month[key]} /></td>)}</tr>)}</tbody></table></ScrollTable>
      </Tabs.Panel>
    </Tabs>
  </>;
}
function FinanceSkeleton() {
  return <div className="finance-skeleton" aria-busy="true" aria-label="Finansman yükleniyor"><div className="finance-loading-track" aria-hidden="true"><span /></div><div className="finance-skeleton-summary" aria-hidden="true" /><div className="finance-skeleton-table" aria-hidden="true">{Array.from({ length: 4 }, (_, index) => <div key={index} />)}</div></div>;
}
export default function FinancePage() {
  const state = useFinance();
  return <div className="finance-page">
    <PageHeader location="/finansman" lead="Nakit, kredi kartları, KMH ve finansman maliyetleri." actions={<button className="quiet-button" disabled={state.loading} onClick={state.refresh}>Yenile</button>}>
      <p className="finance-plan-note"><strong>Hesap</strong> · Gerçekleşmiş ödeme değildir. Banka ekstresi yerine geçmez.</p>
      <DataStatus loading={state.loading} updatedAt={state.updatedAt} idle="Kaynak doğrulaması tamamlanmadı." />
    </PageHeader>
    {state.error && <p role="alert" className="error-message">{state.error}</p>}
    {state.data ? <><FinanceContent data={state.data} /><SourceNote label="Kaynak durumu"><p>{state.data.status}</p>{state.data.notes.map((note, index) => <p key={index}>{note}</p>)}</SourceNote></> : state.loading ? <FinanceSkeleton /> : <p>Güncel hesap doğrulandığında ay sonu özeti ve bütün ödeme adımları burada görünür.</p>}
    <footer className="finance-footer"><a href={financeSheetUrl} target="_blank" rel="noreferrer">Finansman e-tablosunu aç</a><a href="#/timeline">Ödeme takvimine git</a><p>Tutarlar Finansman sayfasından okunur; bu görünüm e-tabloyu değiştirmez. Ödeme takvimi de aynı doğrulanmış hesabı kullanır.</p></footer>
  </div>;
}
