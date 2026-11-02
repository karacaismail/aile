import { useCallback, useId, useMemo } from 'react';
import { useLocation } from 'wouter';
import {
  useChangeSet,
  useCollection,
  useGeneration,
  type BaseRecord,
  type BudgetObservation,
  type ChangeOp,
  type CollectionSnapshot,
  type ForecastEvent,
  type ForecastMonth,
  type GenerationState,
  type PurchaseNeedRecord,
  type Term,
  type Vocabulary,
} from '../data';
import { useDevice } from '../device';
import { PageHeader } from '../shell/PageHeader';
import { currentAdminLink } from '../shell/navigation';
import type { DataStatusProps, DataStatusState, Money, PageHeaderSummary, StatusLabel } from '../shell/contracts';
import { Button, Chart, ErrorState, LoadingShell, Overview } from '../ui';
import { chartSeriesColors, type ChartProps } from '../ui/Chart';
import { BILINMIYOR, FIYAT_YOK, HENUZ_YOK, formatMoney } from '../ui/Money';
import type { OverviewAttentionItem, OverviewBudgetRow, OverviewPayment, OverviewTask } from '../ui/Overview';
import './GenelPage.css';

// Genel durum sayfası. Tasarım: README.md "Sayfa iskeleti" 1–2 (başlık → en çok üç ölçü, kutusuz), components/Overview/
// README.md (sol: Yaklaşan ödemeler + Bütçe tablosu; sağ: Dikkat isteyenler + görevler; her blok başlığında ilgili sayfaya
// bağlantı), bundle.js Aile.Pages.Genel (AppShell + Overview narrow; telefon/tablet tek sütun, masaüstü iki sütun) ve
// Raporlar sayfasının plan/gerçek çubukları (Chart). Referansın gömülü örnek sayıları yerine her şey nesilden türetilir:
//  - Ölçüler: "Bu ay kalan nakit" forecast_months (closing_balance, "tahmin" etiketiyle); "7 gün içinde ödenecek"
//    forecast_events (bugünden 7 gün, nakit çıkışı); "Geciken" purchase_needs + work_orders (vadesi geçmiş, kapanmamış)
//    yalnız plan toplamı. Plan ve gerçek hiçbir ölçüde tek sayıda birleşmez; eksik bilgi adıyla yazılır.
//  - Dikkat isteyenler: fiyatsız alım, doğrulanmış fotoğrafı olmayan alım (media_references), açık sorun (issues),
//    geciken kayıt. Sayısı sıfır olan satır çizilmez; hepsi sıfırsa blok "Dikkat isteyen kayıt yok" der.
//  - Bekleyen işler: work_orders'ta kurulmamış iş emirleri (tarih sırası). Onay kutusu yerel değişiklik kümesine
//    fulfillment → installed yazar (undo ile geri alınır); Sheets'e yazma bu dilimde yok.
//  - Bütçe tablosu: budget_observations bu ay, kalem başına Planlanan (basis planned) ve Gerçekleşen ayrı. Grafik:
//    aylık plan ve gerçek çubukları (ECharts, Chart) + yanında aynı değerlerin tablosu; grafik tek bilgi kaynağı değil.
//  - Veri durumları gerçek durumdan: nesil okunurken LoadingShell, nesil hatasında ErrorState ("Hata: …", Yeniden dene,
//    tutar yok), stale'de son iyi veri + uyarı tazelik satırı. Nesilde olmayan koleksiyon "Kaynakta … kaydı yok" der.
// payments / providers koleksiyonu yoktur: ödemeler forecast_events'ten gelir ve bloğun bağlantısı Bütçe ve nakit'tir.

export interface GenelPageProps {
  /** Hash yolu; başlık bölüm/ad/amaç buradan türetilir. */
  location?: string;
  /** "Bugün"; test deterministikliği için enjekte edilir. */
  now?: () => Date;
}

const YOL = '/genel';
const BIRINCIL_EYLEM = 'Aylık rapor';
const RAPOR_YOLU = '/raporlar';
const OKUNUYOR = 'Genel durum okunuyor';
const PENCERE_GUN = 7;
const GRAFIK_AY = 6;
const KURULDU = 'installed';
const BITMIS_TESLIMAT: ReadonlySet<string> = new Set(['installed', 'delivered', 'cancelled']);
const TRY = 'TRY';

const KAYNAKTA_YOK = {
  forecast_months: 'Kaynakta tahmin ayı kaydı yok',
  forecast_events: 'Kaynakta tahmin olayı kaydı yok',
  budget_observations: 'Kaynakta bütçe gözlemi kaydı yok',
  work_orders: 'Kaynakta iş emri kaydı yok',
} as const;

const BAGLANTI = {
  butce: { label: 'Bütçe ve nakit', href: '#/butce' },
  veri: { label: 'Veri kalitesi', href: '#/veri' },
  projeler: { label: 'Projeler ve görevler', href: '#/projeler' },
} as const;
const SAYFA_ADI = { alimlar: 'Alımlar ve eşyalar', veri: 'Veri kalitesi ve içe aktarma', projeler: 'Projeler ve görevler' } as const;

const DURUM: Record<GenerationState, DataStatusState> = { idle: 'checking', checking: 'checking', ready: 'fresh', stale: 'stale', error: 'error' };
const ODEME_DURUMU: Record<string, StatusLabel> = {
  planned: { label: 'Planlandı', tone: 'notr' },
  estimated: { label: 'Tutar tahmini', tone: 'uyari' },
};

// --- Tarih ---------------------------------------------------------------------------------------------
const ayUzun = new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' });
const ayKisa = new Intl.DateTimeFormat('tr-TR', { month: 'short', year: 'numeric' });
const gunAy = new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: '2-digit' });
const sayiBicimi = new Intl.NumberFormat('tr-TR');
const siralayici = new Intl.Collator('tr-TR');

/** ISO günü yerel takvim günü olarak okur (saat dilimi kaymasız); geçersizse undefined. */
function gunOku(iso: unknown): Date | undefined {
  if (typeof iso !== 'string') return undefined;
  const parca = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!parca) return undefined;
  const gun = new Date(Number(parca[1]), Number(parca[2]) - 1, Number(parca[3]));
  return Number.isNaN(gun.getTime()) ? undefined : gun;
}
const gunBasi = (an: Date) => new Date(an.getFullYear(), an.getMonth(), an.getDate());
const gunEkle = (gun: Date, adet: number) => new Date(gun.getFullYear(), gun.getMonth(), gun.getDate() + adet);
/** "2026-12" — yerel ay. */
const donemMetni = (gun: Date) => `${gun.getFullYear()}-${String(gun.getMonth() + 1).padStart(2, '0')}`;
/** "2026-12" → ayın ilk günü; bozuksa undefined. */
function donemGunu(donem: string): Date | undefined {
  const parca = /^(\d{4})-(\d{2})$/.exec(donem);
  if (!parca) return undefined;
  const gun = new Date(Number(parca[1]), Number(parca[2]) - 1, 1);
  return Number.isNaN(gun.getTime()) ? undefined : gun;
}
const donemAdi = (donem: string, bicim: Intl.DateTimeFormat) => {
  const gun = donemGunu(donem);
  return gun ? bicim.format(gun) : donem;
};

// --- Para ----------------------------------------------------------------------------------------------
const ONDALIK = /^-?[0-9]+(\.[0-9]+)?$/;

/** Veri platformu para zarfını doğrular; bozuk ya da boş değer null. */
function para(value: unknown): Money | null {
  if (!value || typeof value !== 'object') return null;
  const { amount, currency } = value as { amount?: unknown; currency?: unknown };
  if (typeof amount !== 'string' || !ONDALIK.test(amount.trim())) return null;
  return { amount: amount.trim(), currency: typeof currency === 'string' && currency.trim() ? currency.trim() : TRY };
}
const sayi = (money: Money | null): number | undefined => (money ? Number(money.amount) : undefined);
const tutar = (deger: number, currency: string = TRY): Money => ({ amount: deger.toFixed(2), currency });

/** Aynı para birimindeki tutarları toplar; boş liste null, karışık birim ilk birimle toplanmaz → null. */
function topla(liste: readonly Money[]): Money | null {
  if (liste.length === 0) return null;
  const birim = liste[0]!.currency;
  if (liste.some(m => m.currency !== birim)) return null;
  return tutar(liste.reduce((toplam, m) => toplam + Number(m.amount), 0), birim);
}

// --- Kayıt okuyucular -----------------------------------------------------------------------------------
const aktif = (record: BaseRecord) => !record.deleted_at;
/** Alım/iş emri kapanmamış: silinmemiş, iptal edilmemiş, teslimatı bitmemiş. */
function acik(record: PurchaseNeedRecord): boolean {
  if (!aktif(record) || record.state_snapshot?.decision === 'cancelled') return false;
  const teslimat = record.state_snapshot?.fulfillment;
  return !(teslimat && BITMIS_TESLIMAT.has(teslimat));
}
/** Vade: sipariş vadesi → planlanan gün → bitiş. */
const vade = (record: PurchaseNeedRecord) => gunOku(record.dates?.order_due_on) ?? gunOku(record.dates?.planned_on) ?? gunOku(record.dates?.end_on);
const metin = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
const nitelik = (record: BaseRecord, ...anahtarlar: string[]) => {
  for (const anahtar of anahtarlar) {
    const deger = metin(record.attributes?.[anahtar]);
    if (deger) return deger;
  }
  return undefined;
};

interface Olay { record: ForecastEvent; gun: Date; cikis: boolean; tutar: Money | null; durum: StatusLabel }
function olayOku(record: ForecastEvent): Olay | undefined {
  const gun = gunOku(record.occurred_on);
  if (!gun || !aktif(record)) return undefined;
  const nakit = para(record.cash_change);
  const planli = para((record.measures as { planned?: unknown } | undefined)?.planned);
  const nakitSayi = sayi(nakit);
  // Nakit değişimi biliniyorsa yönü o söyler; bilinmiyorsa olay ödeme sayılır (tutarı plan ölçüsünden).
  const cikis = nakitSayi === undefined ? true : nakitSayi < 0;
  const mutlak = nakitSayi === undefined || !nakit ? null : tutar(Math.abs(nakitSayi), nakit.currency);
  const kesinlik = metin(record.certainty);
  const durum: StatusLabel = (kesinlik ? ODEME_DURUMU[kesinlik] : undefined) ?? { label: kesinlik ?? BILINMIYOR, tone: 'notr' };
  return { record, gun, cikis, tutar: planli ?? mutlak, durum };
}

interface Kalem { label: string; planned: Money[]; actual: Money[] }
function gozlemTutari(record: BudgetObservation): Money | null {
  const ondalik = record.value?.decimal;
  if (typeof ondalik !== 'string' || !ONDALIK.test(ondalik.trim())) return null;
  return { amount: ondalik.trim(), currency: record.value.currency?.trim() || TRY };
}

/** Dönemdeki gözlemleri kaleme göre toplar: planned ayrı, gerçekleşen ayrı. */
function butceKalemleri(gozlemler: readonly BudgetObservation[], donem: string): OverviewBudgetRow[] {
  const kalemler = new Map<string, Kalem>();
  for (const gozlem of gozlemler) {
    if (!aktif(gozlem) || gozlem.period !== donem) continue;
    const deger = gozlemTutari(gozlem);
    if (!deger) continue;
    const ad = metin(gozlem.label) ?? 'Adsız kalem';
    const kalem = kalemler.get(ad) ?? { label: ad, planned: [], actual: [] };
    (gozlem.basis === 'planned' ? kalem.planned : kalem.actual).push(deger);
    kalemler.set(ad, kalem);
  }
  return [...kalemler.values()]
    .sort((a, b) => siralayici.compare(a.label, b.label))
    .map(kalem => ({ id: `${donem}:${kalem.label}`, label: kalem.label, planned: topla(kalem.planned), actual: topla(kalem.actual) }));
}

interface AylikToplam { donem: string; planned: Money | null; actual: Money | null }
/** Dönem başına plan ve gerçek toplamı; bugüne kadarki son N ay (yoksa en erken N ay). */
function aylikToplamlar(gozlemler: readonly BudgetObservation[], buDonem: string, adet: number): AylikToplam[] {
  const aylar = new Map<string, Kalem>();
  for (const gozlem of gozlemler) {
    if (!aktif(gozlem) || typeof gozlem.period !== 'string') continue;
    const deger = gozlemTutari(gozlem);
    if (!deger) continue;
    const ay = aylar.get(gozlem.period) ?? { label: gozlem.period, planned: [], actual: [] };
    (gozlem.basis === 'planned' ? ay.planned : ay.actual).push(deger);
    aylar.set(gozlem.period, ay);
  }
  const sirali = [...aylar.keys()].sort();
  const gecmis = sirali.filter(donem => donem <= buDonem);
  const secili = (gecmis.length > 0 ? gecmis : sirali).slice(gecmis.length > 0 ? -adet : 0, gecmis.length > 0 ? undefined : adet);
  return secili.map(donem => {
    const ay = aylar.get(donem)!;
    return { donem, planned: topla(ay.planned), actual: topla(ay.actual) };
  });
}

// --- Ölçüler --------------------------------------------------------------------------------------------
interface Olculer { nakit: PageHeaderSummary; odenecek: PageHeaderSummary; geciken: PageHeaderSummary }

function olculeriHesapla(args: {
  bugun: Date;
  aylar: CollectionSnapshot<ForecastMonth>;
  pencere: readonly Olay[];
  olaylarBos: boolean;
  gecikenler: readonly PurchaseNeedRecord[];
}): Olculer {
  const { bugun, aylar, pencere, olaylarBos, gecikenler } = args;
  const donem = donemMetni(bugun);
  const ay = aylar.rows.find(row => aktif(row) && row.period === donem);
  const kapanis = para((ay?.measures as { closing_balance?: unknown } | undefined)?.closing_balance);
  const sonGun = new Date(bugun.getFullYear(), bugun.getMonth() + 1, 0);
  const nakit: PageHeaderSummary = {
    label: 'Bu ay kalan nakit',
    value: kapanis ? formatMoney(kapanis) : BILINMIYOR,
    note: kapanis ? `tahmin · ${gunAy.format(sonGun)}'e kadar` : aylar.rows.length === 0 ? KAYNAKTA_YOK.forecast_months : `${donemAdi(donem, ayUzun)} için tahmin yok`,
  };

  const odemeler = pencere.filter(olay => olay.cikis);
  const odemeToplami = topla(odemeler.map(olay => olay.tutar).filter((m): m is Money => m !== null));
  const odenecek: PageHeaderSummary = {
    label: `${PENCERE_GUN} gün içinde ödenecek`,
    value: olaylarBos ? BILINMIYOR : odemeler.length === 0 ? formatMoney(tutar(0)) : odemeToplami ? formatMoney(odemeToplami) : BILINMIYOR,
    note: olaylarBos ? KAYNAKTA_YOK.forecast_events : odemeler.length === 0 ? 'Ödeme yok' : `${sayiBicimi.format(odemeler.length)} ödeme · tahmin`,
  };

  const planlar = gecikenler.map(record => para(record.amounts?.planned)).filter((m): m is Money => m !== null);
  const fiyatsiz = gecikenler.length - planlar.length;
  const planToplami = topla(planlar);
  const geciken: PageHeaderSummary = {
    label: 'Geciken',
    value: gecikenler.length === 0 ? formatMoney(tutar(0)) : planToplami ? formatMoney(planToplami) : BILINMIYOR,
    note:
      gecikenler.length === 0
        ? 'Geciken yok'
        : [`${sayiBicimi.format(gecikenler.length)} kayıt`, fiyatsiz > 0 ? `${sayiBicimi.format(fiyatsiz)} fiyatsız` : undefined, 'plan toplamı'].filter(Boolean).join(' · '),
  };
  return { nakit, odenecek, geciken };
}

// --- Grafik ----------------------------------------------------------------------------------------------
const GRAFIK_ETIKETI = 'Son altı ayın planlanan ve gerçekleşen gideri; değerler yanındaki tabloda';

function grafikOption(aylar: readonly AylikToplam[]): ChartProps['option'] {
  return {
    legend: { data: ['Planlanan', 'Gerçekleşen'] },
    xAxis: { type: 'category', data: aylar.map(ay => donemAdi(ay.donem, ayKisa)) },
    yAxis: { type: 'value' },
    series: [
      { name: 'Planlanan', type: 'bar', data: aylar.map(ay => sayi(ay.planned) ?? null), itemStyle: { color: chartSeriesColors.plan } },
      { name: 'Gerçekleşen', type: 'bar', data: aylar.map(ay => sayi(ay.actual) ?? null), itemStyle: { color: chartSeriesColors.gercek } },
    ],
  };
}

function AylikTablo({ aylar }: { aylar: readonly AylikToplam[] }) {
  return (
    <table className="aile-genel-aylik">
      <caption className="aile-kucuk aile-ikincil">Aylık planlanan ve gerçekleşen gider</caption>
      <thead>
        <tr>
          <th scope="col">Ay</th>
          <th scope="col" className="aile-genel-sag">Planlanan</th>
          <th scope="col" className="aile-genel-sag">Gerçekleşen</th>
        </tr>
      </thead>
      <tbody>
        {aylar.map(ay => (
          <tr key={ay.donem}>
            <th scope="row">{donemAdi(ay.donem, ayKisa)}</th>
            <td className="aile-genel-sag aile-tutar">{formatMoney(ay.planned, FIYAT_YOK)}</td>
            <td className="aile-genel-sag aile-tutar">{formatMoney(ay.actual, HENUZ_YOK)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AylikGrafik({ aylar, bos, dar }: { aylar: readonly AylikToplam[]; bos: boolean; dar: boolean }) {
  const id = useId();
  const option = useMemo(() => grafikOption(aylar), [aylar]);
  return (
    <section className={dar ? 'aile-ov-blok aile-genel-grafik aile-genel-grafik--dar' : 'aile-ov-blok aile-genel-grafik'} aria-labelledby={id}>
      <div className="aile-ov-bas">
        <h2 id={id} className="aile-ov-baslik">Aylık plan ve gerçek</h2>
        <a className="aile-ov-bag" href={BAGLANTI.butce.href}>{BAGLANTI.butce.label}</a>
      </div>
      {aylar.length > 0 ? (
        <Chart option={option} ariaLabel={GRAFIK_ETIKETI} description={<AylikTablo aylar={aylar} />} className="aile-genel-grafik-govde" />
      ) : (
        <p className="aile-ov-bos aile-ikincil">{bos ? KAYNAKTA_YOK.budget_observations : 'Aylık bütçe toplamı yok'}</p>
      )}
    </section>
  );
}

// --- Sayfa -----------------------------------------------------------------------------------------------
/** Değişiklik kümesindeki bekleyen "kuruldu" işlemi (varsa). */
const kurulduOpu = (ops: readonly ChangeOp[]) =>
  ops.find(op => op.kind === 'state_change' && op.after.axis === 'fulfillment' && op.after.code === KURULDU);

export function GenelPage({ location = YOL, now }: GenelPageProps) {
  const device = useDevice();
  const dar = device !== 'desktop';
  const [, navigate] = useLocation();
  const generation = useGeneration();
  const changeSet = useChangeSet();
  const aylar = useCollection('forecast_months');
  const olaylar = useCollection('forecast_events');
  const gozlemler = useCollection('budget_observations');
  const alimlar = useCollection('purchase_needs');
  const isler = useCollection('work_orders');
  const medya = useCollection('media_references');
  const sorunlar = useCollection('issues');
  const terimler = useCollection('terms');
  const sozlukler = useCollection('vocabularies');
  const parcalar = [aylar, olaylar, gozlemler, alimlar, isler, medya, sorunlar, terimler, sozlukler];

  // "Bugün" render başına bir kez okunur; now referansı değişmeden ölçüler yeniden hesaplanmaz.
  const bugun = useMemo(() => gunBasi((now ?? (() => new Date()))()), [now]);
  const buDonem = donemMetni(bugun);

  const acikAlimlar = useMemo(() => alimlar.rows.filter(record => aktif(record) && record.state_snapshot?.decision !== 'cancelled'), [alimlar.rows]);
  const gecikenler = useMemo(() => {
    const kayitlar = [...alimlar.rows, ...isler.rows].filter(acik);
    return kayitlar.filter(record => {
      const gun = vade(record);
      return gun !== undefined && gun < bugun;
    });
  }, [alimlar.rows, isler.rows, bugun]);

  const pencere = useMemo(() => {
    const son = gunEkle(bugun, PENCERE_GUN);
    return olaylar.rows
      .map(olayOku)
      .filter((olay): olay is Olay => olay !== undefined && olay.gun >= bugun && olay.gun < son)
      .sort((a, b) => a.gun.getTime() - b.gun.getTime());
  }, [olaylar.rows, bugun]);

  const olculer = useMemo(
    () => olculeriHesapla({ bugun, aylar, pencere, olaylarBos: olaylar.rows.length === 0, gecikenler }),
    [bugun, aylar, pencere, olaylar.rows.length, gecikenler],
  );

  const odemeler = useMemo<OverviewPayment[]>(
    () =>
      pencere
        .filter(olay => olay.cikis)
        .map(olay => ({
          id: olay.record.id,
          date: olay.record.occurred_on ?? null,
          label: metin(olay.record.label) ?? 'Adsız tahmin olayı',
          party: nitelik(olay.record, 'taraf', 'party'),
          amount: olay.tutar,
          status: olay.durum,
        })),
    [pencere],
  );

  const butce = useMemo(() => butceKalemleri(gozlemler.rows, buDonem), [gozlemler.rows, buDonem]);
  const aylikToplam = useMemo(() => aylikToplamlar(gozlemler.rows, buDonem, GRAFIK_AY), [gozlemler.rows, buDonem]);

  const dikkat = useMemo<OverviewAttentionItem[]>(() => {
    const dogrulanmis = new Set(medya.rows.filter(m => aktif(m) && m.verification === 'verified').map(m => m.entity_id));
    const fiyatsiz = acikAlimlar.filter(record => !para(record.amounts?.planned)).length;
    const fotografsiz = acikAlimlar.filter(record => !dogrulanmis.has(record.id)).length;
    const acikSorun = sorunlar.rows.filter(aktif).length;
    const liste: OverviewAttentionItem[] = [
      { id: 'fiyatsiz', label: 'Fiyatı eksik alım', count: fiyatsiz, page: SAYFA_ADI.alimlar, href: '#/alimlar' },
      { id: 'fotografsiz', label: 'Doğrulanmış fotoğrafı olmayan alım', count: fotografsiz, page: SAYFA_ADI.alimlar, href: '#/alimlar' },
      { id: 'sorun', label: 'Açık sorun', count: acikSorun, page: SAYFA_ADI.veri, href: '#/veri' },
      { id: 'geciken', label: 'Geciken kayıt', count: gecikenler.length, page: SAYFA_ADI.alimlar, href: '#/alimlar' },
    ];
    return liste.filter(item => item.count > 0);
  }, [acikAlimlar, medya.rows, sorunlar.rows, gecikenler.length]);

  const bekleyenIsler = useMemo(
    () =>
      isler.rows
        .filter(acik)
        .sort((a, b) => (vade(a)?.getTime() ?? Number.POSITIVE_INFINITY) - (vade(b)?.getTime() ?? Number.POSITIVE_INFINITY) || siralayici.compare(a.label ?? '', b.label ?? '')),
    [isler.rows],
  );
  const gorevler = useMemo<OverviewTask[]>(
    () =>
      bekleyenIsler.map(record => ({
        id: record.id,
        label: metin(record.label) ?? 'Adsız iş',
        code: nitelik(record, 'kod', 'code') ?? record.source_record_id,
        owner: nitelik(record, 'sorumlu', 'sahip', 'owner'),
        due: record.dates?.planned_on ?? undefined,
        done: kurulduOpu(changeSet.pendingFor(record.id)) !== undefined,
      })),
    // changeSet handle'ı add/undo sonrası yenilenir; done bayrağı o yüzden ona bağlıdır.
    [bekleyenIsler, changeSet],
  );

  // "Kuruldu" terimi: fulfillment_state sözlüğündeki installed; yoksa yalnız kod yazılır (term_id null).
  const kurulduTerimi = useMemo(() => {
    const sozluk = sozlukler.rows.find((v: Vocabulary) => v.key === 'fulfillment_state');
    return terimler.rows.find((t: Term) => t.code === KURULDU && (!sozluk || t.vocabulary_id === sozluk.id))?.id ?? null;
  }, [sozlukler.rows, terimler.rows]);

  const gorevIsaretle = useCallback(
    async (task: OverviewTask, done: boolean) => {
      const record = bekleyenIsler.find(row => row.id === task.id);
      if (!record) return;
      const mevcut = kurulduOpu(changeSet.pendingFor(record.id));
      if (done && !mevcut) {
        await changeSet.add({
          recordId: record.id,
          kind: 'state_change',
          before: { axis: 'fulfillment', code: record.state_snapshot?.fulfillment ?? null, term_id: record.state_term_ids?.fulfillment ?? null },
          after: { axis: 'fulfillment', code: KURULDU, term_id: kurulduTerimi },
        });
      } else if (!done && mevcut) {
        await changeSet.undo(mevcut.opId);
      }
    },
    [bekleyenIsler, changeSet, kurulduTerimi],
  );

  const sayfa = currentAdminLink(location);
  const durum: DataStatusProps = {
    state: DURUM[generation.state],
    lastReadAt: generation.lastReadAt ?? undefined,
    generationId: generation.generationId ?? undefined,
    lastGoodAt: generation.lastGoodAt ?? undefined,
    message: generation.message ?? undefined,
    onRefresh: () => void generation.refresh(),
  };
  const yeniden = () => void generation.refresh();

  // Nesil okunamadı ve elde son iyi nesil yok: tutar gösterilmez.
  const nesilHatasi = generation.state === 'error' && generation.manifest === null;
  const koleksiyonHatasi = parcalar.find(parca => parca.error !== null)?.error ?? null;
  const yukleniyor = !nesilHatasi && ((generation.manifest === null && generation.state !== 'stale') || parcalar.some(parca => parca.loading));
  const hazir = !nesilHatasi && !yukleniyor && koleksiyonHatasi === null;

  const ozet: readonly PageHeaderSummary[] | undefined = hazir ? [olculer.nakit, olculer.odenecek, olculer.geciken] : undefined;

  return (
    <div className="aile-genel">
      <PageHeader
        location={location}
        section={sayfa.section}
        title={sayfa.label}
        purpose={sayfa.purpose}
        primary={
          <Button variant="secondary" icon="sheet" onClick={() => navigate(RAPOR_YOLU)}>
            {BIRINCIL_EYLEM}
          </Button>
        }
        status={durum}
        summary={ozet}
      />
      {nesilHatasi ? (
        <ErrorState title={generation.message ?? 'Nesil okunamadı'} message="Doğrulanmış nesil okunamadı. Tutarlar, yanıltmaması için gösterilmiyor." onRetry={yeniden} />
      ) : koleksiyonHatasi && !yukleniyor ? (
        <ErrorState title={koleksiyonHatasi} message="Bir koleksiyon okunamadı. Tutarlar, yanıltmaması için gösterilmiyor." onRetry={yeniden} />
      ) : yukleniyor ? (
        <LoadingShell narrow={dar} label={OKUNUYOR} />
      ) : (
        <>
          <Overview
            narrow={dar}
            measures={[]}
            payments={{
              title: `Yaklaşan ödemeler · ${PENCERE_GUN} gün`,
              link: BAGLANTI.butce,
              items: odemeler,
              empty: olaylar.rows.length === 0 ? KAYNAKTA_YOK.forecast_events : `Önümüzdeki ${PENCERE_GUN} günde ödeme yok`,
            }}
            budget={{
              title: `Bütçe · ${donemAdi(buDonem, ayUzun)}`,
              link: BAGLANTI.butce,
              items: butce,
              empty: gozlemler.rows.length === 0 ? KAYNAKTA_YOK.budget_observations : `${donemAdi(buDonem, ayUzun)} için bütçe kalemi yok`,
            }}
            attention={{ title: 'Dikkat isteyenler', link: BAGLANTI.veri, items: dikkat, empty: 'Dikkat isteyen kayıt yok' }}
            tasks={{
              title: 'Bekleyen işler',
              link: BAGLANTI.projeler,
              items: gorevler,
              empty: isler.rows.length === 0 ? KAYNAKTA_YOK.work_orders : 'Bekleyen iş yok',
            }}
            onToggleTask={changeSet.ready ? (task, done) => void gorevIsaretle(task, done) : undefined}
          />
          <AylikGrafik aylar={aylikToplam} bos={gozlemler.rows.length === 0} dar={dar} />
        </>
      )}
    </div>
  );
}
