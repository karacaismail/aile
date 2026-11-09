import { DataTable, type Column } from '../dashboard/DataTable';
import { money, sheetUrl, type Budget, type Irregular } from '../dashboard/data';
import { PageHeader } from '../app/family/PageHeader';
import { DataStatus } from '../app/family/DataStatus';
import { useFinancePeriod } from '../app/family/FinancePeriod';
import { FactList, JourneyLinks, SectionHeading, SourceNote } from '../components/Info';
import { paymentMonth, retirementPlan, type RetirementReserve } from './retirement';
import './retirement.css';

// Name and amount come first; the month sorts by calendar position, and a row with no month sorts as empty.
const columns = (order: readonly string[]): Column<Irregular>[] => [
  { key: 'label', label: 'Ödeme', value: row => row.label, render: row => <><strong>{row.label}</strong>{row.note && <small>{row.note}</small>}<span className="retirement-glance" aria-hidden="true">{money(row.current)} · {paymentMonth(row) || 'Ay belirlenmedi'}</span></> },
  { key: 'current', label: 'Tutar', numeric: true, value: row => row.current, render: row => <strong>{money(row.current)}</strong> },
  { key: 'month', label: 'Ödeme ayı', value: row => { const index = order.indexOf(paymentMonth(row)); return index < 0 ? null : index; }, render: row => paymentMonth(row) || 'Belirlenmedi' },
  { key: 'status', label: 'Durum', value: row => row.status, render: row => row.status || 'Belirlenmedi' },
];
const reserveDetail = (reserve: RetirementReserve) => {
  if (reserve.total === null) return 'Plan sekmesinde bu kalemin tutarları boş.';
  const period = reserve.count > 1 ? `${reserve.first} ile ${reserve.last} arasında, ${reserve.count} ay` : reserve.first;
  return reserve.gaps > 0 ? `${period}. ${reserve.gaps} ayın tutarı eksik, toplama eklenmedi.` : period;
};

export default function RetirementPage({ data, loading, updatedAt, refresh }: { data: Budget | null; loading: boolean; updatedAt: Date | null; refresh: () => void }) {
  const [, setPeriod] = useFinancePeriod();
  const plan = data && retirementPlan(data);
  const firstMonth = plan && data?.months.find(month => month.label === plan.months[0]);
  return <section className="retirement-page" aria-label="Emeklilik ve SGK ödemeleri">
    <PageHeader location="/emeklilik" lead="Emeklilik için ödenecek SGK borçları burada görünür." actions={<button className="quiet-button" disabled={loading} onClick={refresh}>Yenile</button>}>
      <DataStatus loading={loading} updatedAt={updatedAt} />
    </PageHeader>
    {!plan ? <p role="status" className="family-loading">{loading ? 'SGK ödemeleri yükleniyor…' : 'SGK ödemeleri şu anda alınamıyor. Yenile düğmesiyle yeniden deneyin.'}</p>
      : plan.payments.length === 0 ? <p role="status">Henüz SGK ödemesi yok. Eklemek için Arızi Giderler sekmesinde Yer / Bölüm sütununa Emeklilik yazın.</p>
        : <>
          <FactList label="SGK ödemeleri özeti" items={[
            { label: plan.missing > 0 ? 'Bilinen toplam' : 'Toplam ödeme', value: money(plan.total), emphasis: true, detail: plan.missing > 0 ? `${plan.missing} kalemin tutarı eksik, toplama eklenmedi.` : undefined },
            { label: plan.months.length > 1 ? 'Ödeme ayları' : 'Ödeme ayı', value: plan.months.join(', ') || 'Belirlenmedi' },
          ]} />
          <section className="retirement-section" aria-label="SGK ödeme kalemleri">
            <SectionHeading title="Ödeme kalemleri" description={`${plan.payments.length} kalem`} />
            <DataTable rows={plan.payments} columns={columns(data!.months.map(month => month.label))} caption="SGK ve emeklilik ödemeleri" rowKey={row => row.id} />
          </section>
        </>}
    {plan && plan.reserves.length > 0 && <section className="retirement-section" aria-label="Dönem boyunca ayrılan para">
      <SectionHeading title="Dönem boyunca ayrılan" description="Bu tutarlar bütün dönemin toplamıdır, aylık tutar değildir." />
      <FactList label="Dönem boyunca ayrılan tutarlar" items={plan.reserves.map(reserve => ({ label: reserve.label, value: money(reserve.total), detail: reserveDetail(reserve) }))} />
    </section>}
    <JourneyLinks label="SGK ödemelerinden sonraki adım" items={[
      { href: '#/timeline', label: 'Ödeme takvimine bak', detail: firstMonth ? `${firstMonth.label} adımları` : undefined, onSelect: firstMonth ? () => setPeriod(firstMonth.key) : undefined },
      { href: 'admin.html#/emeklilik', label: 'Emeklilik seçeneklerini karşılaştır', detail: 'Yönetim panelinde açılır ve profil dosyası ister' },
    ]} />
    <SourceNote>
      <p>Tutarlar Arızi Giderler ve Plan sekmelerinden gelir. Sayfa açıkken dakikada bir yenilenir.</p>
      <a href={sheetUrl} target="_blank" rel="noreferrer">SGK ödemelerini e-tabloda düzenle</a>
    </SourceNote>
  </section>;
}
