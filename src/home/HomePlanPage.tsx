import { useState } from 'react';
import { TextInput } from '@mantine/core';
import { DataTable, type Column } from '../dashboard/DataTable';
import { money, sheetUrl, type Budget, type Irregular } from '../dashboard/data';
import { PageHeader } from '../app/family/PageHeader';

const columns: Column<Irregular>[] = [
  { key: 'label', label: 'Alınacak / yapılacak', value: row => row.label, render: row => <><strong>{row.label}</strong><small>{row.room}{row.note && ` · ${row.note}`}</small></> },
  { key: 'type', label: 'Kategori', value: row => row.type, render: row => row.type || 'Belirlenmedi' },
  { key: 'month', label: 'Plan ayı', value: row => row.planMonth, render: row => row.planMonth || 'Belirlenmedi' },
  { key: 'plan', label: 'Plan tutarı', numeric: true, value: row => row.plan, render: row => money(row.plan) },
  { key: 'current', label: 'Güncel tutar', numeric: true, value: row => row.current, render: row => <><strong>{money(row.current)}</strong><small>{row.manual ? 'Elle güncellendi' : 'Planı izliyor'}</small></> },
  { key: 'status', label: 'Durum', value: row => row.status, render: row => row.status || 'Belirlenmedi' },
];
export default function HomePlanPage({ data, loading }: { data: Budget | null; loading: boolean }) {
  const [query, setQuery] = useState('');
  const term = query.trim().toLocaleLowerCase('tr-TR');
  const rows = data?.irregular.filter(row => `${row.label} ${row.type} ${row.room}`.toLocaleLowerCase('tr-TR').includes(term)) ?? [];
  return <section aria-label="Alım planı">
    <PageHeader location="/ev" lead="Bütçedeki alımlardan evin hazır olduğu güne." />
    <div className="home-plan-intro"><p>Alım tutarları bütçe planından gelir. Ölçü, teklif, iş ve teslimat kayıtlarını hazırlık bölümlerinde yönetin.</p><a href="#/timeline">Ödeme takvimine bak</a><a href={sheetUrl} target="_blank" rel="noreferrer">Alım planını e-tabloda düzenle</a></div>
    {!data ? <p role="status" className="family-loading">{loading ? 'Bütçedeki alımlar yükleniyor…' : 'Alım planı şu anda alınamıyor. Yukarıdaki Yenile düğmesiyle yeniden deneyin.'}</p> : <>
      <TextInput className="home-plan-search" label="Alım planında ara" placeholder="Eşya, oda veya kategori" value={query} onChange={event => setQuery(event.currentTarget.value)} />
      <p className="family-hint">{rows.length} / {data.irregular.length} kalem · Plan tutarı ödeme yapıldığı anlamına gelmez.</p>
      <DataTable rows={rows} columns={columns} caption="Bütçedeki alım planı" rowKey={row => row.id} />
      <p className="family-hint">Hazırlık listesindeki teklif ve ölçü kayıtları bu bütçeye ayrıca eklenmez. Bir alımın bütçesini değiştirmek için e-tablodaki ilgili kaydı güncelleyin.</p>
    </>}
  </section>;
}
