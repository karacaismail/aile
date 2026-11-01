import { useState } from 'react';
import { TextInput } from '@mantine/core';
import { DataTable, type Column } from '../dashboard/DataTable';
import { money, sheetUrl, type Budget, type Irregular } from '../dashboard/data';
import { PageHeader } from '../app/family/PageHeader';
import { DataStatus } from '../app/family/DataStatus';
import { Select } from '../dashboard/Select';
import { FactList, SectionHeading, SourceNote, JourneyLinks } from '../components/Info';
import './home.css';

const columns: Column<Irregular>[] = [
  { key: 'label', label: 'Alınacak / yapılacak', value: row => row.label, render: row => <><strong>{row.label}</strong><small>{row.room}{row.note && ` · ${row.note}`}</small></> },
  { key: 'type', label: 'Kategori', value: row => row.type, render: row => row.type || 'Belirlenmedi' },
  { key: 'month', label: 'Plan ayı', value: row => row.planMonth, render: row => row.planMonth || 'Belirlenmedi' },
  { key: 'plan', label: 'Plan tutarı', numeric: true, value: row => row.plan, render: row => money(row.plan) },
  { key: 'current', label: 'Güncel tutar', numeric: true, value: row => row.current, render: row => <><strong>{money(row.current)}</strong><small>{row.manual ? 'Elle güncellendi' : 'Planı izliyor'}</small></> },
  { key: 'status', label: 'Durum', value: row => row.status, render: row => row.status || 'Belirlenmedi' },
];
export default function HomePlanPage({ data, loading, updatedAt, refresh }: { data: Budget | null; loading: boolean; updatedAt: Date | null; refresh: () => void }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [missingOnly, setMissingOnly] = useState(false);
  const term = query.trim().toLocaleLowerCase('tr-TR');
  const rows = data?.irregular.filter(row => (!category || row.type === category) && (!missingOnly || row.current === null) && `${row.label} ${row.type} ${row.room}`.toLocaleLowerCase('tr-TR').includes(term)) ?? [];
  const categories = [...new Set(data?.irregular.map(row => row.type).filter(Boolean) ?? [])];
  return <section className="home-plan-page" aria-label="Alım planı">
    <PageHeader location="/ev" lead="Bütçedeki alımlardan evin hazır olduğu güne." actions={<button className="quiet-button" disabled={loading} onClick={refresh}>Yenile</button>}>
      <DataStatus loading={loading} updatedAt={updatedAt} />
    </PageHeader>
    {!data ? <p role="status" className="family-loading">{loading ? 'Bütçedeki alımlar yükleniyor…' : 'Alım planı şu anda alınamıyor. Yenile düğmesiyle yeniden deneyin.'}</p> : <>
      <section className="home-plan-overview" aria-label="Alım planının kapsamı">
        <div><SectionHeading title="Önce alımı netleştir" description="Tutarı ve plan ayını kontrol et." />
          <p>Plan tutarı ödeme yapıldığı anlamına gelmez. Eksik tutar sıfır değildir.</p></div>
        <FactList label="Plan kapsamı" items={[
          { label: 'Plan kaydı', value: data.irregular.length, emphasis: true },
          { label: 'Tutarı eksik', value: data.irregular.filter(row => row.current === null).length },
          { label: 'Plan ayı eksik', value: data.irregular.filter(row => !row.planMonth).length },
        ]} />
      </section>
      <section className="home-plan-records" aria-label="Alımları incele">
        <SectionHeading title="Alımlar" description={`${rows.length} / ${data.irregular.length} kalem gösteriliyor. Filtreler bütçedeki tutarları değiştirmez.`} />
        <div className="home-plan-filters">
          <TextInput label="Alım planında ara" placeholder="Eşya, oda veya kategori" value={query} onChange={event => setQuery(event.currentTarget.value)} />
          <Select label="Alım kategorisi" value={category} onChange={value => setCategory(value ?? '')} data={[{value:'',label:'Tüm kategoriler'}, ...categories.map(value => ({value,label:value}))]} allowDeselect={false} />
          <div className="home-plan-filter-buttons" role="group" aria-label="Tutar bilgisi">
            <button type="button" aria-pressed={!missingOnly} onClick={() => setMissingOnly(false)}>Tüm alımlar</button>
            <button type="button" aria-pressed={missingOnly} onClick={() => setMissingOnly(true)}>Tutarı eksik</button>
          </div>
        </div>
        <DataTable rows={rows} columns={columns} caption="Bütçedeki alım planı" rowKey={row => row.id} />
      </section>
    </>}
    <JourneyLinks label="Alımdan sonraki adım" items={[{href:'#/timeline',label:'Ödeme takvimine bak'},{href:'#/satinalma',label:'Hazırlık listesine git'}]} />
    <SourceNote>
      <p>Alım tutarları bütçe planından gelir. Ölçü, teklif, iş ve teslimat kayıtlarını hazırlık bölümlerinde yönetin.</p>
      <p>Hazırlık listesindeki teklif ve ölçü kayıtları bu bütçeye ayrıca eklenmez. Bir alımın bütçesini değiştirmek için e-tablodaki ilgili kaydı güncelleyin.</p>
      <a href={sheetUrl} target="_blank" rel="noreferrer">Alım planını e-tabloda düzenle</a>
    </SourceNote>
  </section>;
}
