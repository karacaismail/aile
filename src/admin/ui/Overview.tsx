import { useId, type ReactNode } from 'react';
import { designTokens } from '../../design/tokens.ts';
import { useDevice } from '../device';
import type { Money, ResponsiveColumn, StatusLabel } from '../shell/contracts';
import { Checkbox, ConfigProvider, Progress, type ThemeConfig } from './antd';
import { Icon } from './icons';
import { ResponsiveTable } from './ResponsiveTable';
import { Tag } from './Tag';
import './Overview.css';

// Tasarım: aile-tasarim/tasarim-sistemi/components/Overview/README.md + envanter.md satırı; referans davranış bundle.js
// Overview (Block, ODEMELER/DIKKAT/BUTCE/GOREVLER örnekleri). Genel durum sayfasının iskeleti: üstte en çok üç ölçü
// (kutusuz, tek satır), altında iki sütun: solda Yaklaşan ödemeler + Bütçe tablosu, sağda Dikkat isteyenler + Bu haftaki
// görevler. Her blok bir bölgedir (section + h2) ve başlık satırında ilgili sayfaya bağlantı taşır. Sayfa başlığı (h1,
// amaç, tazelik) kabuğun PageHeader'ındadır; burada yalnız ölçüler ve bloklar vardır. Referansın gömülü örnek verisi yerine
// her şey props ile gelir (sayfa hesaplar): bileşen yalnız çizer ve biçimler (₺8.500,00 tr-TR, 28.10.2026).
//  - Liste blokları düz <ul>: satır tek bağlantıdır (ödeme ya da dikkat satırı), kart ya da kenarlık yok, liste tek
//    yuzey alanı, satırlar cizgi ile ayrılır. Envanterdeki ProList eşlemesi bilgi amaçlıdır: ProList satırı tek bir
//    bağlantı değildir ve kendi meta/eylem yüzeyini getirir.
//  - Bütçe tablosu ResponsiveTable (masaüstünde Table, telefonda akordeon): Planlanan, Gerçekleşen ve Kalan ayrı
//    sütunlardır; hiçbir yerde tek sayıda birleşmez. Telefonda üçü de etiket–değer gövdesindedir (referansta Kalan
//    etiketsiz ana tutardı; etiketsiz tutar plan mı gerçek mi belli olmaz). Kalem hücresinde ince çubuk antd Progress
//    (small = 6 px, renkler tokens.ts) ve yüzde METNİ ("%65 harcandı"); çubuk aria-hidden, bilgiyi metin taşır.
//  - Görevler antd Checkbox; durumu sayfa tutar (controlled), onToggleTask ile bildirilir. Onay kutusu köşesi kontrol
//    köşesinin yarısı (README › Ölçü); yerel ConfigProvider yalnız bunu değiştirir.
//  - Eksik bilgi adıyla: "Tarih yok", "Tutar yok", "Taraf bilinmiyor", "Plan yok", "Henüz yok", "Bilinmiyor"; boş blok
//    gizlenmez, adıyla yazılır. Odak çizgisini admin.css çizer; Overview.css çizgiyi satırın alt kenarına çeker.

export interface OverviewLink { label: string; href: string }

/** Özet ölçüsü; en çok üç tanesi çizilir (README: en çok üç anlamlı ölçü). value null → "Bilinmiyor". */
export interface OverviewMeasure { label: string; value: Money | null; note?: string }

export interface OverviewPayment {
  id: string;
  /** ISO gün (YYYY-MM-DD); null → "Tarih yok". */
  date: string | null;
  /** Tarihin altındaki kısa not ("Gecikti · 4 gün"); verilmezse gün adı ("Salı"). */
  dateNote?: string;
  label: string;
  /** Taraf; yoksa "Taraf bilinmiyor". */
  party?: string;
  /** null → "Tutar yok". */
  amount: Money | null;
  status: StatusLabel;
  /** Verilirse satır bu ödemeye bağlantıdır. */
  href?: string;
}

/** Bütçe kalemi: plan ve gerçek ayrı; Kalan ve yüzde burada ikisinden türetilir, ikisi de yoksa adıyla yazılır. */
export interface OverviewBudgetRow { id: string; label: string; planned: Money | null; actual: Money | null }

export interface OverviewAttentionItem { id: string; label: string; count: number; /** Gidilecek sayfanın adı. */ page: string; href: string }

export interface OverviewTask {
  id: string;
  label: string;
  code?: string;
  owner?: string;
  /** ISO gün; 07.11.2026 diye yazılır. */
  due?: string;
  project?: string;
  done?: boolean;
}

export interface OverviewSection<T> {
  title: string;
  /** Başlık satırındaki bağlantı ("Ödemelere git" → #/odemeler). */
  link?: OverviewLink;
  items: readonly T[];
  /** Boş blok metni; verilmezse bloğun kendi sözü ("Yaklaşan ödeme yok"). */
  empty?: string;
}

export interface OverviewProps {
  /** Tek sütun yerleşimi; verilmezse useDevice() !== 'desktop'. Bütçe tablosuna da aynı değer gider. */
  narrow?: boolean;
  measures: readonly OverviewMeasure[];
  payments: OverviewSection<OverviewPayment>;
  budget: OverviewSection<OverviewBudgetRow>;
  attention: OverviewSection<OverviewAttentionItem>;
  tasks: OverviewSection<OverviewTask>;
  onToggleTask?(task: OverviewTask, done: boolean): void;
}

export const BILINMIYOR = 'Bilinmiyor';
const HENUZ_YOK = 'Henüz yok';
const PLAN_YOK = 'Plan yok';
const TARIH_YOK = 'Tarih yok';
const TUTAR_YOK = 'Tutar yok';
const TARAF_BILINMIYOR = 'Taraf bilinmiyor';
const BOS = { odeme: 'Yaklaşan ödeme yok', butce: 'Bütçe kalemi yok', dikkat: 'Dikkat isteyen kayıt yok', gorev: 'Bu hafta görev yok' } as const;
const BUTCE_CAPTION = 'Bütçe kalemleri';
const OLCU_AZAMI = 3;
const META_AYRACI = ' · ';

// --- Biçimleme (tr-TR) -----------------------------------------------------------------------------
const paraBicimleri = new Map<string, Intl.NumberFormat>();
/** ₺8.500,00 — tr-TR, iki ondalık. Geçersiz tutar "Bilinmiyor"; tanınmayan para birimi "8500.00 XXX" olarak kalır. */
export function paraMetni({ amount, currency }: Money): string {
  const sayi = Number(amount);
  if (amount.trim() === '' || !Number.isFinite(sayi)) return BILINMIYOR;
  let bicim = paraBicimleri.get(currency);
  if (!bicim) {
    try {
      bicim = new Intl.NumberFormat('tr-TR', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
    } catch {
      return `${amount} ${currency}`;
    }
    paraBicimleri.set(currency, bicim);
  }
  return bicim.format(sayi);
}

const tarihBicimi = new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const gunBicimi = new Intl.DateTimeFormat('tr-TR', { weekday: 'long' });
const sayiBicimi = new Intl.NumberFormat('tr-TR');

/** ISO günü yerel takvim günü olarak okur (saat dilimi kaymasız); geçersizse undefined. */
function gunOku(iso: string | null | undefined): Date | undefined {
  if (!iso) return undefined;
  const parca = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!parca) return undefined;
  const gun = new Date(Number(parca[1]), Number(parca[2]) - 1, Number(parca[3]));
  return Number.isNaN(gun.getTime()) ? undefined : gun;
}

const sayiOku = (money: Money | null): number | undefined => {
  if (!money) return undefined;
  const sayi = Number(money.amount);
  return money.amount.trim() === '' || !Number.isFinite(sayi) ? undefined : sayi;
};

/** Kalan = plan − gerçek; yalnız ikisi de biliniyor ve aynı para birimindeyse. */
function kalan(row: OverviewBudgetRow): Money | undefined {
  const plan = sayiOku(row.planned);
  const gercek = sayiOku(row.actual);
  if (plan === undefined || gercek === undefined || row.planned!.currency !== row.actual!.currency) return undefined;
  return { amount: (plan - gercek).toFixed(2), currency: row.planned!.currency };
}

/** Harcanan yüzde (yuvarlanmış, 100'ü aşabilir); plan yok ya da sıfırsa, gerçek yoksa undefined. */
function harcananYuzde(row: OverviewBudgetRow): number | undefined {
  const plan = sayiOku(row.planned);
  const gercek = sayiOku(row.actual);
  if (plan === undefined || gercek === undefined || plan <= 0) return undefined;
  return Math.round((gercek / plan) * 100);
}

const durumSozcugu = (status: StatusLabel) => (status.label.trim() ? status.label.trim() : BILINMIYOR);

// --- Parçalar --------------------------------------------------------------------------------------
function Blok({ title, link, children }: { title: string; link?: OverviewLink; children: ReactNode }) {
  const id = useId();
  return (
    <section className="aile-ov-blok" aria-labelledby={id}>
      <div className="aile-ov-bas">
        <h2 id={id} className="aile-ov-baslik">{title}</h2>
        {link ? <a className="aile-ov-bag" href={link.href}>{link.label}</a> : null}
      </div>
      {children}
    </section>
  );
}

const Bos = ({ text }: { text: string }) => <p className="aile-ov-bos aile-ikincil">{text}</p>;

function Ozet({ measures }: { measures: readonly OverviewMeasure[] }) {
  const olculer = measures.slice(0, OLCU_AZAMI);
  if (olculer.length === 0) return null;
  return (
    <dl className="aile-ov-ozet" aria-label="Özet">
      {olculer.map(olcu => (
        <div key={olcu.label} className="aile-ov-olcu">
          <dt className="aile-kucuk aile-ikincil">{olcu.label}</dt>
          <dd>
            <span className={olcu.value ? 'aile-ov-olcu-deger' : 'aile-ov-olcu-deger aile-ov-olcu-deger--yok'}>
              {olcu.value ? paraMetni(olcu.value) : BILINMIYOR}
            </span>
            {olcu.note ? <span className="aile-kucuk aile-ikincil">{olcu.note}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function OdemeSatiri({ payment }: { payment: OverviewPayment }) {
  const gun = gunOku(payment.date);
  const not = payment.dateNote?.trim() || (gun ? gunBicimi.format(gun) : undefined);
  const icerik = (
    <>
      <span className="aile-ov-tarih">
        {gun ? <strong>{tarihBicimi.format(gun)}</strong> : <span className="aile-ikincil">{TARIH_YOK}</span>}
        {not ? <span className="aile-kucuk aile-ikincil">{not}</span> : null}
      </span>
      <span className="aile-ov-satir-ana">
        <span className="aile-ov-ad">{payment.label}</span>
        <span className="aile-ov-meta aile-kucuk aile-ikincil">{payment.party?.trim() || TARAF_BILINMIYOR}</span>
      </span>
      <span className="aile-ov-son">
        {payment.amount ? <span className="aile-tutar">{paraMetni(payment.amount)}</span> : <span className="aile-ikincil">{TUTAR_YOK}</span>}
        <Tag tone={payment.status.tone}>{durumSozcugu(payment.status)}</Tag>
      </span>
    </>
  );
  const classes = 'aile-ov-satir aile-ov-satir--odeme';
  return <li>{payment.href ? <a className={classes} href={payment.href}>{icerik}</a> : <div className={classes}>{icerik}</div>}</li>;
}

function KalemHucresi({ row }: { row: OverviewBudgetRow }) {
  const yuzde = harcananYuzde(row);
  return (
    <span className="aile-ov-kalem">
      <span>{row.label}</span>
      {yuzde !== undefined ? (
        <>
          {/* Çubuk süsleyicidir; yüzdeyi alttaki metin söyler. Renkler tek kaynaktan (tokens.ts), small = 6 px. */}
          <span className="aile-ov-olcek" aria-hidden="true">
            <Progress
              type="line"
              size="small"
              percent={Math.min(100, Math.max(0, yuzde))}
              showInfo={false}
              status="normal"
              strokeColor={designTokens.eylem}
              railColor={designTokens.listeZemin}
              classNames={{ root: 'aile-ov-olcek-kok' }}
            />
          </span>
          <span className="aile-ov-yuzde aile-kucuk aile-ikincil">{`%${sayiBicimi.format(yuzde)} harcandı`}</span>
        </>
      ) : null}
    </span>
  );
}

/** Tutar hücresi: telefondaki akordeon gövdesinde (dd) de tabular-nums (admin.css .aile-tutar). */
const TutarMetni = ({ value }: { value: Money }) => <span className="aile-tutar">{paraMetni(value)}</span>;

const kalanMetni = (row: OverviewBudgetRow): ReactNode => {
  if (!row.planned) return PLAN_YOK;
  if (!row.actual) return HENUZ_YOK;
  const fark = kalan(row);
  return fark ? <TutarMetni value={fark} /> : BILINMIYOR;
};

// Sütun rolleri (ResponsiveTable): kalem başlık; üç tutar telefonda etiket–değer gövdesinde kalır (lead yok).
const BUTCE_SUTUNLARI: readonly ResponsiveColumn<OverviewBudgetRow>[] = [
  { key: 'label', title: 'Kalem', minWidth: 160, m: 'title', render: row => <KalemHucresi row={row} /> },
  { key: 'planned', title: 'Planlanan', align: 'right', minWidth: 112, render: row => (row.planned ? <TutarMetni value={row.planned} /> : PLAN_YOK) },
  { key: 'actual', title: 'Gerçekleşen', align: 'right', minWidth: 120, render: row => (row.actual ? <TutarMetni value={row.actual} /> : HENUZ_YOK) },
  { key: 'remaining', title: 'Kalan', align: 'right', minWidth: 112, render: kalanMetni },
];

function DikkatSatiri({ item }: { item: OverviewAttentionItem }) {
  return (
    <li>
      <a className="aile-ov-satir aile-ov-satir--sayi" href={item.href}>
        <span className="aile-ov-sayi">{sayiBicimi.format(item.count)}</span>
        <span className="aile-ov-satir-ana">
          <span className="aile-ov-ad">{item.label}</span>
          <span className="aile-ov-meta aile-kucuk aile-ikincil">{item.page}</span>
        </span>
        <Icon name="chevronRight" className="aile-ov-ok" />
      </a>
    </li>
  );
}

// Onay kutusu köşesi kontrol köşesinin yarısı (README › Ölçü, köşe); diğer her şey ortak temadan (antdTheme.ts).
const gorevTemasi: ThemeConfig = { components: { Checkbox: { borderRadiusSM: designTokens.koseKontrol / 2 } } };

function GorevSatiri({ task, onToggle }: { task: OverviewTask; onToggle?: OverviewProps['onToggleTask'] }) {
  const vade = gunOku(task.due);
  const meta = [task.code, task.owner, vade ? tarihBicimi.format(vade) : task.due ? TARIH_YOK : undefined, task.project]
    .map(parca => parca?.trim())
    .filter(Boolean)
    .join(META_AYRACI);
  return (
    <li>
      <Checkbox
        className={task.done ? 'aile-ov-gorev aile-ov-gorev--bitti' : 'aile-ov-gorev'}
        checked={!!task.done}
        onChange={event => onToggle?.(task, event.target.checked)}
      >
        <span className="aile-ov-satir-ana">
          <span className="aile-ov-gorev-ad">{task.label}</span>
          {meta ? <span className="aile-ov-meta aile-kucuk aile-ikincil">{meta}</span> : null}
        </span>
      </Checkbox>
    </li>
  );
}

export function Overview({ narrow, measures, payments, budget, attention, tasks, onToggleTask }: OverviewProps) {
  const device = useDevice();
  const dar = narrow ?? device !== 'desktop';

  return (
    <div className={dar ? 'aile-ov aile-ov--dar' : 'aile-ov'} data-layout={dar ? 'dar' : 'genis'} data-testid="overview">
      <Ozet measures={measures} />
      <div className="aile-ov-izgara">
        <div className="aile-ov-sutun">
          <Blok title={payments.title} link={payments.link}>
            {payments.items.length ? (
              <ul className="aile-ov-liste">{payments.items.map(payment => <OdemeSatiri key={payment.id} payment={payment} />)}</ul>
            ) : (
              <Bos text={payments.empty ?? BOS.odeme} />
            )}
          </Blok>
          <Blok title={budget.title} link={budget.link}>
            {budget.items.length ? (
              <ResponsiveTable<OverviewBudgetRow>
                className="aile-ov-tablo"
                columns={BUTCE_SUTUNLARI}
                rows={budget.items}
                caption={BUTCE_CAPTION}
                mobileCaption={`${sayiBicimi.format(budget.items.length)} kalem`}
                mobileMode="accordion"
                narrow={narrow}
              />
            ) : (
              <Bos text={budget.empty ?? BOS.butce} />
            )}
          </Blok>
        </div>
        <div className="aile-ov-sutun">
          <Blok title={attention.title} link={attention.link}>
            {attention.items.length ? (
              <ul className="aile-ov-liste">{attention.items.map(item => <DikkatSatiri key={item.id} item={item} />)}</ul>
            ) : (
              <Bos text={attention.empty ?? BOS.dikkat} />
            )}
          </Blok>
          <Blok title={tasks.title} link={tasks.link}>
            {tasks.items.length ? (
              <ConfigProvider theme={gorevTemasi}>
                <ul className="aile-ov-liste">{tasks.items.map(task => <GorevSatiri key={task.id} task={task} onToggle={onToggleTask} />)}</ul>
              </ConfigProvider>
            ) : (
              <Bos text={tasks.empty ?? BOS.gorev} />
            )}
          </Blok>
        </div>
      </div>
    </div>
  );
}
