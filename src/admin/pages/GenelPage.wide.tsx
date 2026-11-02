import { useId, useMemo } from 'react';
import type { RecordedTotal } from '../data';
import { useProfile } from '../adaptive';
import { Chart, chartSeriesColors, type ChartProps } from '../ui/Chart';
import { HENUZ_YOK } from '../ui/Money';
import { Overview, type OverviewBudgetRow, type OverviewTask } from '../ui/Overview';
import {
  donemAdi,
  gerceklesenMetni,
  grafikDegeri,
  planMetni,
  type GenelAy,
  type GenelButceSatiri,
  type GenelSunumProps,
} from './genel/model';
import './GenelPage.wide.css';

// Genel durum › geniş sunum (tablet ve masaüstü). Yalnız GenelPage'deki lazyWide('genel-genis') ile yüklenir; telefon
// profili bu modülü, Overview'un antd parçalarını (Checkbox, Progress) ve ECharts'ı hiç indirmez. Tasarım: components/
// Overview (masaüstünde iki sütun: solda Yaklaşan ödemeler + Bütçe tablosu, sağda Dikkat isteyenler + görevler; tablette
// tek sütun) ve Raporlar'ın plan/gerçek çubukları: aylık grafik + yanında aynı değerlerin tablosu (grafik tek bilgi
// kaynağı değil). Veri telefonla aynı saf modelden (genel/model.ts → data/actuals.ts).
// Overview satırı bugün yalnız `actual` (Money | null) alır ve ondan yüzde/"harcandı" türetir; a10-overview satıra
// `recorded` (RecordedValue | RecordedTotal; actuals.ts spendLabel ile) kabulünü paralelde ekliyor ve iki alan birlikte
// verilince `recorded`ı yeğliyor. Satır bu yüzden ikisini de taşır: `actual` geçiş için kaynak değeri, `recorded`
// Gerçekleşenin anlamı (gelecek ay not_yet, kanıt bayrağı). Kaydı olmayan kalemde `recorded` verilmez ("Henüz yok").

type GenelOverviewSatiri = OverviewBudgetRow & { recorded?: RecordedTotal };

function overviewSatiri(satir: GenelButceSatiri): GenelOverviewSatiri {
  const recorded = satir.recorded;
  const row: GenelOverviewSatiri = {
    id: satir.id,
    label: satir.label,
    planned: satir.planned.money,
    actual: recorded && recorded.kind === 'recorded' ? recorded.money : null,
  };
  if (recorded) row.recorded = recorded;
  return row;
}

const GRAFIK_ETIKETI = 'Aylık planlanan ve gerçekleşen gider; değerler yanındaki tabloda';
const eksenBicimi = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });
const ipucuBicimi = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** İpucu değeri: ₺121.800,00; değersiz ay (gelecek ya da kayıt yok) adıyla. Tablo kesin metni taşır. */
const ipucuMetni = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? ipucuBicimi.format(value) : HENUZ_YOK);

function grafikOption(aylar: readonly GenelAy[]): ChartProps['option'] {
  return {
    // Lejant üstte: ECharts 6 varsayılanı alttır ve kategori ekseni etiketleriyle çakışır (tema grid.top boşluğu bırakır).
    legend: { data: ['Planlanan', 'Gerçekleşen'], top: 0 },
    tooltip: { valueFormatter: ipucuMetni },
    xAxis: { type: 'category', data: aylar.map(ay => donemAdi(ay.donem, 'kisa')) },
    yAxis: { type: 'value', axisLabel: { formatter: (value: number) => eksenBicimi.format(value) } },
    series: [
      { name: 'Planlanan', type: 'bar', data: aylar.map(ay => grafikDegeri(ay.planned.money)), itemStyle: { color: chartSeriesColors.plan } },
      {
        name: 'Gerçekleşen',
        type: 'bar',
        // Gelecek ay ("Henüz yok") ve kaydı olmayan ay boş kalır; kaynak değeri ödeme olayı sayılmaz (tabloda durum).
        data: aylar.map(ay => (ay.recorded && ay.recorded.kind === 'recorded' ? grafikDegeri(ay.recorded.money) : null)),
        itemStyle: { color: chartSeriesColors.gercek },
      },
    ],
  };
}

function AylikTablo({ aylar }: { aylar: readonly GenelAy[] }) {
  return (
    <table className="aile-genel-aylik">
      <caption className="aile-kucuk aile-ikincil">Aylık planlanan ve gerçekleşen gider</caption>
      <thead>
        <tr>
          <th scope="col">Ay</th>
          <th scope="col" className="aile-genel-sag">Planlanan</th>
          <th scope="col" className="aile-genel-sag">Gerçekleşen</th>
          <th scope="col">Durum</th>
        </tr>
      </thead>
      <tbody>
        {aylar.map(ay => (
          <tr key={ay.donem}>
            <th scope="row">{donemAdi(ay.donem, 'kisa')}</th>
            <td className="aile-genel-sag aile-tutar">{planMetni(ay.planned)}</td>
            <td className="aile-genel-sag aile-tutar">{gerceklesenMetni(ay.recorded)}</td>
            <td className="aile-ikincil">{ay.spend.text}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AylikGrafik({ baslik, link, aylar, bos }: { baslik: string; link: { label: string; href: string }; aylar: readonly GenelAy[]; bos: string }) {
  const id = useId();
  const option = useMemo(() => grafikOption(aylar), [aylar]);
  return (
    <section className="aile-genel-grafik" aria-labelledby={id}>
      <div className="aile-genel-bas">
        <h2 id={id} className="aile-genel-baslik">{baslik}</h2>
        <a className="aile-genel-bag" href={link.href}>{link.label}</a>
      </div>
      {aylar.length > 0 ? (
        <Chart option={option} ariaLabel={GRAFIK_ETIKETI} description={<AylikTablo aylar={aylar} />} className="aile-genel-grafik-govde" />
      ) : (
        <p className="aile-genel-bos aile-ikincil">{bos}</p>
      )}
    </section>
  );
}

export default function GenelGenis({ gorunum, onToggleTask }: GenelSunumProps) {
  const profile = useProfile();
  const { odemeler, dikkat, butce, gorevler, aylik } = gorunum;
  const butceSatirlari = useMemo(() => butce.items.map(overviewSatiri), [butce.items]);
  return (
    <div className={profile === 'desktop' ? 'aile-genel-genis' : 'aile-genel-genis aile-genel-genis--dar'} data-testid="genel-genis">
      {butce.note ? <p className="aile-genel-not aile-kucuk" role="note">{butce.note}</p> : null}
      <Overview
        measures={[]}
        payments={{ title: odemeler.title, link: odemeler.link, items: odemeler.items, empty: odemeler.empty }}
        budget={{ title: butce.title, link: butce.link, items: butceSatirlari, empty: butce.empty }}
        attention={{ title: dikkat.title, link: dikkat.link, items: dikkat.items, empty: dikkat.empty }}
        tasks={{ title: gorevler.title, link: gorevler.link, items: gorevler.items, empty: gorevler.empty }}
        onToggleTask={onToggleTask ? (task: OverviewTask, done: boolean) => onToggleTask(task.id, done) : undefined}
      />
      <AylikGrafik baslik={aylik.title} link={aylik.link} aylar={aylik.items} bos={aylik.empty} />
    </div>
  );
}
