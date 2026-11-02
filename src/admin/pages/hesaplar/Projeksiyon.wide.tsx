import { useId, useMemo, type ComponentProps } from 'react';
import type { ResponsiveColumn } from '../../shell/contracts';
import { Chart, chartSeriesColors } from '../../ui/Chart';
import { BILINMIYOR, Money } from '../../ui/Money';
import { ResponsiveTable } from '../../ui/ResponsiveTable';
import { KAPANIS, olcuAdi, type DonemSatiri, type Projeksiyon } from './model';

// Geniş profil (tablet/masaüstü) eki: tüm dönemlerin nakit projeksiyonu tablosu + kapanış bakiyesi çizgisi. Telefon
// bunu indirmez (HesaplarPage lazyWide 'hesaplar-projeksiyon'); telefonda aynı veriye dönem seçici (alt sayfa) ile
// dönem dönem ulaşılır. Dönem anahtarlı tablodur: satırlar ve dönemler toplanmaz, toplam satırı yoktur. Forecast ne
// plan ne gerçektir: çizgi kesik ve nötr tonda (plan/gerçek renkleri kullanılmaz), her yerde "tahmin" diye adlandırılır.
// Satıra tıklamak ya da Enter dönemi seçer; Hesaplar bölümündeki liste o dönemin bakiyelerine geçer.

export interface ProjeksiyonWideProps {
  veri: Projeksiyon;
  /** Seçili dönem ("2027-03"); tabloda seçili satır olarak işaretlenir. */
  secili: string | null;
  onSec(period: string): void;
}

/** Chart sarmalayıcısının option tipi; ham 'echarts' importu ui/ dışına çıkmaz. */
type ChartOption = ComponentProps<typeof Chart>['option'];

const BASLIK = 'Nakit projeksiyonu';
const TABLO_ADI = 'Nakit projeksiyonu (tahmin)';
const CIZGI_ADI = 'Kapanış bakiyesi (tahmin)';
const NOT = 'Dönem anahtarlı tahmin: dönemler ve tahminler toplanmaz. Bir satır seçince Hesaplar o dönemin bakiyelerini gösterir.';
const DONEM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
/** Eksen değerleri tr-TR ("50.000"); tutarın tam biçimi (₺8.500,00) tabloda. */
const EKSEN_SAYI = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });

export default function ProjeksiyonWide({ veri, secili, onSec }: ProjeksiyonWideProps) {
  const id = useId();
  const cokTahmin = veri.tahminSayisi > 1;

  const columns = useMemo<ResponsiveColumn<DonemSatiri>[]>(() => {
    const list: ResponsiveColumn<DonemSatiri>[] = [{ key: 'donem', title: 'Dönem', minWidth: 112, m: 'title', render: satir => satir.donem }];
    if (cokTahmin) list.push({ key: 'tahmin', title: 'Tahmin', minWidth: 160, m: 'meta', render: satir => satir.tahmin });
    for (const key of veri.olcuAnahtarlari) {
      list.push({
        key,
        title: olcuAdi(key),
        align: 'right',
        minWidth: 136,
        m: key === KAPANIS ? 'lead' : 'body',
        render: satir => <Money value={satir.olculer[key]} label={BILINMIYOR} />,
      });
    }
    return list;
  }, [cokTahmin, veri.olcuAnahtarlari]);

  const option = useMemo<ChartOption | null>(() => {
    if (!veri.cizgi) return null;
    const seriler = veri.cizgi.seriler.map((seri, index) => ({
      name: cokTahmin ? `${CIZGI_ADI} · ${seri.ad}` : CIZGI_ADI,
      type: 'line' as const,
      data: seri.degerler,
      connectNulls: false,
      lineStyle: { type: 'dashed' as const },
      ...(index === 0 ? { color: chartSeriesColors.notr } : {}),
    }));
    // Tek seride lejant yok (adı bölüm başlığı ve aria-label söyler); birden çok tahminde lejant serileri ayırır.
    return {
      ...(seriler.length > 1 ? { legend: { data: seriler.map(seri => seri.name) } } : {}),
      xAxis: { type: 'category', data: veri.cizgi.donemler },
      yAxis: { type: 'value', axisLabel: { formatter: (value: number) => EKSEN_SAYI.format(value) } },
      series: seriler,
    };
  }, [veri.cizgi, cokTahmin]);

  const seciliKey = secili ? veri.satirlar.find(satir => satir.period === secili)?.key : undefined;
  const tablo = (
    <ResponsiveTable<DonemSatiri>
      caption={TABLO_ADI}
      columns={columns}
      rows={veri.satirlar}
      selectedKey={seciliKey}
      onRowClick={satir => { if (satir.period && DONEM_RE.test(satir.period)) onSec(satir.period); }}
    />
  );

  return (
    <section className="aile-hesaplar__blok" aria-labelledby={id}>
      <div className="aile-hesaplar__bas">
        <h2 id={id} className="aile-hesaplar__baslik">{BASLIK}</h2>
        <span className="aile-kucuk aile-ikincil">{`${veri.donemler.length} dönem · tahmin`}</span>
      </div>
      <p className="aile-hesaplar__not">{NOT}</p>
      {option ? (
        <Chart option={option} ariaLabel="Dönemlere göre tahmini kapanış bakiyesi çizgisi; değerler aşağıdaki tabloda" description={tablo} />
      ) : tablo}
    </section>
  );
}
