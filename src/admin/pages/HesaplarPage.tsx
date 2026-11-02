import { useCallback, useId, useMemo, useState, type ComponentProps, type ReactNode } from 'react';
import { designTokens } from '../../design/tokens.ts';
import { useCollection, useGeneration } from '../data/useGeneration';
import type { ForecastMonth, GenerationState, Money as MoneyValue } from '../data/types';
import { useDevice } from '../device';
import type { DataStatusProps, DataStatusState, PageHeaderAction, PageHeaderSummary, ResponsiveColumn } from '../shell/contracts';
import { PageHeader } from '../shell/PageHeader';
import { Button, Chart, Dialog, ErrorState, LoadingShell, Money, ResponsiveTable } from '../ui';
import { formatMoney, HENUZ_YOK } from '../ui/Money';
import './HesaplarPage.css';

// Hesaplar ve borçlar (Para). Tasarım: README "Sayfa iskeleti", bundle.js Aile.Pages.Hesaplar (Sec › Hesaplar tablosu
// mobileMode list, Sec › Borçlar tablosu; başlıkta "Hesap ekle" + Diğer › "Borç ekle"; özet üç ölçü). Veri platformunda
// hesap/borç koleksiyonu yoktur (payments/providers gibi); bu bölümler bunu adıyla söyler, tutar uydurmaz. Nesilde olan
// tek bakiye verisi forecast_months'tır (record_basis: forecast, _Finans web): dönem anahtarlı tablo (data-platform
// README: "period-keyed table, not additive pivot sums") + kapanış bakiyesi çizgisi. Forecast ne plan ne gerçektir;
// her yerde "forecast / tahmin" diye adlandırılır ve gerçek banka hesabı kaydı sayılmaz. Para Money (₺8.500,00),
// dönem 11.2026 (tasarım bitiş "09.2033"), eksik ölçü "Henüz yok". Yazma yok: "Hesap ekle" ve "Borç ekle" bunu
// açıklayan diyalog açar (işlevsiz düğme yerine dürüst gerekçe). Ham antd/echarts yok; tokenlar designTokens/--aile.

export interface HesaplarPageProps {
  /** Hash yolu; PageHeader bölüm/menü adını buradan doğrular. */
  location?: string;
}

const KONUM = '/hesaplar';
const BOLUM = 'Para';
const BASLIK = 'Hesaplar ve borçlar';
const AMAC = 'Hesap bakiyelerini ve kalan borçları, taksit planıyla birlikte görün.';
const KAYNAKTA_YOK = 'Kaynakta kayıt yok';
const HESAP_YOK = 'Kaynakta hesap kaydı yok';
const BORC_YOK = 'Kaynakta borç kaydı yok';
const DONEM_YOK = 'Kaynakta forecast dönemi kaydı yok';
const FORECAST_NOTU = 'Bu forecast; gerçek banka hesabı kaydı değil.';
const TABLO_ADI = 'Nakit projeksiyonu (forecast)';
const KAPANIS = 'closing_balance';
const BILINMIYOR = 'Bilinmiyor';
const ISKELET_SATIR = 6;

/** Ölçü anahtarı → sütun adı; bilinmeyen anahtar okunur hâle getirilir ("kmh_limit" → "Kmh limit"). */
const OLCU_ADLARI: Record<string, string> = {
  opening_balance: 'Açılış bakiyesi',
  planned_inflow: 'Planlanan giriş',
  planned_outflow: 'Planlanan çıkış',
  closing_balance: 'Kapanış bakiyesi',
};
/** Bilinen ölçülerin sütun sırası (açılış → hareket → kapanış); diğerleri ilk görüldükleri sırada sonda. */
const OLCU_SIRASI = Object.keys(OLCU_ADLARI);

export function olcuAdi(key: string): string {
  const bilinen = OLCU_ADLARI[key];
  if (bilinen) return bilinen;
  const metin = key.replace(/[_-]+/g, ' ').trim();
  return metin ? metin.charAt(0).toLocaleUpperCase('tr-TR') + metin.slice(1) : BILINMIYOR;
}

/** "2026-11" → "11.2026"; biçim dışı ya da eksik dönem "Bilinmiyor". */
export function donemMetni(period: string | undefined): string {
  const match = period ? /^(\d{4})-(\d{2})$/.exec(period) : null;
  return match ? `${match[2]}.${match[1]}` : BILINMIYOR;
}

/** Chart sarmalayıcısının option tipi; ham 'echarts' importu ui/ dışına çıkmaz. */
type ChartOption = ComponentProps<typeof Chart>['option'];

const DURUM: Record<GenerationState, DataStatusState> = { idle: 'checking', checking: 'checking', ready: 'fresh', stale: 'stale', error: 'error' };

interface DonemSatiri {
  key: string;
  period: string | undefined;
  donem: string;
  tahmin: string;
  olculer: Record<string, MoneyValue | undefined>;
}

interface Projeksiyon {
  satirlar: DonemSatiri[];
  olcuAnahtarlari: string[];
  /** Kapanış bakiyesi çizgisi: yalnız her dönemde aynı para biriminde tutar varsa. */
  cizgi: { donemler: string[]; degerler: number[]; currency: string } | null;
  sonKapanis: MoneyValue | undefined;
}

/** Dönem anahtarlı projeksiyon: dönemler artan, ölçüler sütun; toplam alınmaz (forecast ayları toplanabilir değildir). */
export function projeksiyon(months: readonly ForecastMonth[], tahminAdlari: ReadonlyMap<string, string>): Projeksiyon {
  const sirali = [...months].sort((a, b) => (a.period ?? '').localeCompare(b.period ?? '') || a.id.localeCompare(b.id));
  const gorulen: string[] = [];
  const satirlar = sirali.map<DonemSatiri>(month => {
    const olculer = (month.measures ?? {}) as Record<string, MoneyValue | undefined>;
    for (const key of Object.keys(olculer)) if (!gorulen.includes(key)) gorulen.push(key);
    const forecastId = typeof month.forecast_id === 'string' ? month.forecast_id : '';
    return { key: month.id, period: month.period, donem: donemMetni(month.period), tahmin: tahminAdlari.get(forecastId) ?? BILINMIYOR, olculer };
  });
  const olcuAnahtarlari = [...OLCU_SIRASI.filter(key => gorulen.includes(key)), ...gorulen.filter(key => !OLCU_SIRASI.includes(key))];

  let cizgi: Projeksiyon['cizgi'] = null;
  const kapanislar = satirlar.map(satir => satir.olculer[KAPANIS]);
  const currency = kapanislar[0]?.currency;
  const tamam = satirlar.length >= 2 && currency !== undefined && kapanislar.every(money => money != null && money.currency === currency && Number.isFinite(Number(money.amount)));
  if (tamam) {
    cizgi = { donemler: satirlar.map(satir => satir.donem), degerler: kapanislar.map(money => Number(money!.amount)), currency };
  }
  const sonKapanis = satirlar.at(-1)?.olculer[KAPANIS];
  return { satirlar, olcuAnahtarlari, cizgi, sonKapanis };
}

function Blok({ title, extra, children }: { title: string; extra?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <section className="aile-hesaplar__blok" aria-labelledby={id}>
      <div className="aile-hesaplar__bas">
        <h2 id={id} className="aile-hesaplar__baslik">{title}</h2>
        {extra ? <span className="aile-kucuk aile-ikincil">{extra}</span> : null}
      </div>
      {children}
    </section>
  );
}

type Ekleme = 'hesap' | 'borc';
const EKLEME: Record<Ekleme, { title: string; neden: string }> = {
  hesap: { title: 'Hesap ekle', neden: 'Kaynakta hesap koleksiyonu yok: doğrulanmış nesilde hesap kaydı bulunmuyor.' },
  borc: { title: 'Borç ekle', neden: 'Kaynakta borç koleksiyonu yok: doğrulanmış nesilde borç kaydı bulunmuyor.' },
};
const YAZMA_YOK = 'E-tabloya yazma bu sürümde yok; kayıt e-tabloda tanımlanıp yeni nesil üretilince burada görünür.';

export function HesaplarPage({ location = KONUM }: HesaplarPageProps) {
  const device = useDevice();
  const dar = device !== 'desktop';
  const generation = useGeneration();
  const forecasts = useCollection('forecasts');
  const months = useCollection('forecast_months');
  const [ekleme, setEkleme] = useState<Ekleme | null>(null);
  const kapat = useCallback(() => setEkleme(null), []);

  const tahminAdlari = useMemo(() => {
    const map = new Map<string, string>();
    forecasts.rows.forEach((forecast, index) => map.set(forecast.id, forecast.label?.trim() || `Tahmin ${index + 1}`));
    return map;
  }, [forecasts.rows]);
  const veri = useMemo(() => projeksiyon(months.rows, tahminAdlari), [months.rows, tahminAdlari]);
  const cokTahmin = forecasts.rows.length > 1;

  const yukleniyor = months.loading || forecasts.loading;
  const hata = months.error ?? forecasts.error;
  const refresh = generation.refresh;
  const yenile = useCallback(() => { void refresh(); }, [refresh]);

  const status: DataStatusProps = {
    state: DURUM[generation.state],
    lastReadAt: generation.lastReadAt ?? undefined,
    generationId: generation.generationId ?? undefined,
    lastGoodAt: generation.lastGoodAt ?? undefined,
    message: generation.message ?? undefined,
    onRefresh: yenile,
  };

  const sonDonem = veri.satirlar.at(-1);
  const summary: readonly PageHeaderSummary[] = [
    { label: 'Hesaplardaki toplam', value: KAYNAKTA_YOK },
    { label: 'Kalan borç', value: KAYNAKTA_YOK },
    {
      label: 'Kapanış bakiyesi (forecast)',
      value: formatMoney(veri.sonKapanis, HENUZ_YOK),
      note: sonDonem ? `${sonDonem.donem} · tahmin, gerçek değil` : undefined,
    },
  ];
  const more: readonly PageHeaderAction[] = [{ label: 'Borç ekle', icon: 'plus', onClick: () => setEkleme('borc') }];

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
        render: satir => <Money value={satir.olculer[key]} label={HENUZ_YOK} />,
      });
    }
    return list;
  }, [cokTahmin, veri.olcuAnahtarlari]);

  const option = useMemo<ChartOption | null>(() => {
    if (!veri.cizgi) return null;
    const ad = 'Kapanış bakiyesi (forecast)';
    return {
      legend: { data: [ad] },
      xAxis: { type: 'category', data: veri.cizgi.donemler },
      yAxis: { type: 'value' },
      // Forecast plan ya da gerçek değildir: acik-mavi (plan tonu) ile tek çizgi; yığılmaz, toplanmaz.
      series: [{ name: ad, type: 'line', data: veri.cizgi.degerler, color: designTokens.acikMavi, connectNulls: false }],
    };
  }, [veri.cizgi]);

  // Nesil hiç okunamadı: sayfa düzeyinde hata, eski tutar yok. Manifest varken parça hatası bölümde kalır.
  const nesilHatasi = generation.state === 'error' && generation.manifest === null;

  let projeksiyonIcerik: ReactNode;
  if (nesilHatasi) {
    projeksiyonIcerik = <ErrorState title="Nesil okunamadı" message={generation.message ?? undefined} onRetry={yenile} />;
  } else if (hata) {
    projeksiyonIcerik = <ErrorState title="Projeksiyon okunamadı" message={hata} onRetry={yenile} />;
  } else if (yukleniyor) {
    projeksiyonIcerik = <LoadingShell rows={ISKELET_SATIR} narrow={device === 'phone'} />;
  } else if (veri.satirlar.length === 0) {
    projeksiyonIcerik = <p className="aile-hesaplar__yok aile-ikincil">{DONEM_YOK}</p>;
  } else {
    const ilk = veri.satirlar[0]!.donem;
    const son = veri.satirlar.at(-1)!.donem;
    const tablo = <ResponsiveTable<DonemSatiri> caption={TABLO_ADI} columns={columns} rows={veri.satirlar} />;
    projeksiyonIcerik = (
      <>
        <p className="aile-hesaplar__meta aile-kucuk aile-ikincil">
          <span>{ilk === son ? ilk : `${ilk} – ${son}`}</span>
          <span aria-hidden="true"> · </span>
          <span>{`${forecasts.rows.length} tahmin`}</span>
        </p>
        {option ? (
          <Chart
            option={option}
            ariaLabel="Dönemlere göre tahmini kapanış bakiyesi çizgisi (forecast); değerler aşağıdaki tabloda"
            description={tablo}
          />
        ) : tablo}
      </>
    );
  }

  return (
    <div className={`aile-hesaplar${dar ? ' aile-hesaplar--dar' : ''}`}>
      <PageHeader
        location={location}
        section={BOLUM}
        title={BASLIK}
        purpose={AMAC}
        primary={<Button variant="primary" icon="plus" onClick={() => setEkleme('hesap')}>Hesap ekle</Button>}
        more={more}
        status={status}
        summary={summary}
      />
      <Blok title="Hesaplar" extra="0 kayıt">
        <p className="aile-hesaplar__yok aile-ikincil">{HESAP_YOK}</p>
      </Blok>
      <Blok title="Borçlar" extra="0 kayıt">
        <p className="aile-hesaplar__yok aile-ikincil">{BORC_YOK}</p>
      </Blok>
      <Blok title="Nakit projeksiyonu" extra={veri.satirlar.length > 0 && !yukleniyor && !hata ? `${veri.satirlar.length} dönem` : undefined}>
        <p className="aile-hesaplar__not">{FORECAST_NOTU}</p>
        {projeksiyonIcerik}
      </Blok>
      {ekleme ? (
        <Dialog title={EKLEME[ekleme].title} onClose={kapat}>
          <p className="aile-hesaplar__neden">{EKLEME[ekleme].neden}</p>
          <p className="aile-hesaplar__neden aile-ikincil">{YAZMA_YOK}</p>
        </Dialog>
      ) : null}
    </div>
  );
}
