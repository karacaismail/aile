import { useId, useMemo } from 'react';
import { useProfile } from '../adaptive';
import { Overview, type OverviewBudgetRow, type OverviewTask } from '../ui/Overview';
import {
  ayGerceklesenMetni,
  ayKayitMetni,
  ayPlanMetni,
  donemAdi,
  type GenelAy,
  type GenelBaglanti,
  type GenelButceSatiri,
  type GenelSunumProps,
} from './genel/model';
import './GenelPage.wide.css';

// Genel durum › geniş sunum (tablet ve masaüstü). Yalnız GenelPage'deki lazyWide('genel-genis') ile yüklenir; telefon
// profili bu modülü hiç indirmez. Tasarım: components/Overview (masaüstünde iki sütun: solda Yaklaşan ödemeler + Bütçe
// tablosu, sağda Dikkat isteyenler + görevler; tablette tek sütun) ve altında aylık plan ve gerçek tablosu. Veri telefonla
// aynı saf modelden (genel/model.ts → data/actuals.ts).
// Bütçe satırı Gerçekleşeni `recorded` (RecordedTotal) olarak taşır; Overview oranı ve "harcandı"yı yalnız ondan
// (actuals.spendLabel) türetir. Kaydı olmayan kalemde `recorded` verilmez ("Henüz yok").
// Aylık plan ve gerçek: ayın satırları tek Planlanan/Gerçekleşen sayısında toplanmaz (nesilde satır düzeyinde yaprak
// sahipliği haritası yok; gelir, ara toplam, genel toplam ve adet satırları ayrılamaz). Çizilecek tutar olmadığından grafik
// (ve ECharts) yok; tablo eksik toplamı adıyla ("Toplam kullanılamaz"), kayıtları ve durumu yazar, nedeni üstte.

function overviewSatiri(satir: GenelButceSatiri): OverviewBudgetRow {
  const row: OverviewBudgetRow = { id: satir.id, label: satir.label, planned: satir.planned.money };
  if (satir.recorded) row.recorded = satir.recorded;
  return row;
}

function AylikTablo({ aylar }: { aylar: readonly GenelAy[] }) {
  return (
    <div className="aile-genel-aylik-kap">
      <table className="aile-genel-aylik">
        <caption className="aile-kucuk aile-ikincil">Aylık planlanan ve gerçekleşen gider</caption>
        <thead>
          <tr>
            <th scope="col">Ay</th>
            <th scope="col" className="aile-genel-sag">Planlanan</th>
            <th scope="col" className="aile-genel-sag">Gerçekleşen</th>
            <th scope="col">Durum</th>
            <th scope="col">Kayıt</th>
          </tr>
        </thead>
        <tbody>
          {aylar.map(ay => (
            <tr key={ay.donem}>
              <th scope="row">{donemAdi(ay.donem, 'kisa')}</th>
              <td className="aile-genel-sag aile-ikincil">{ayPlanMetni(ay)}</td>
              <td className="aile-genel-sag aile-ikincil">{ayGerceklesenMetni(ay)}</td>
              <td className="aile-ikincil">{ay.spend.text}</td>
              <td>{ayKayitMetni(ay)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Aylik({ baslik, link, aylar, bos, not }: { baslik: string; link: GenelBaglanti; aylar: readonly GenelAy[]; bos: string; not: string }) {
  const id = useId();
  return (
    <section className="aile-genel-grafik" aria-labelledby={id}>
      <div className="aile-genel-bas">
        <h2 id={id} className="aile-genel-baslik">{baslik}</h2>
        <a className="aile-genel-bag" href={link.href}>{link.label}</a>
      </div>
      {aylar.length > 0 ? (
        <>
          <p className="aile-genel-not aile-kucuk">{not}</p>
          <AylikTablo aylar={aylar} />
        </>
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
      <Aylik baslik={aylik.title} link={aylik.link} aylar={aylik.items} bos={aylik.empty} not={aylik.note} />
    </div>
  );
}
