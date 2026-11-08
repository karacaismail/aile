import { useId, type ReactNode } from 'react';
import { spendLabel, sumMoney, type RecordedTotal, type RecordedValue } from '../data/actuals';
import { useDevice } from '../device';
import type { Money, ResponsiveColumn, StatusLabel } from '../shell/contracts';
import { Icon } from './icons';
import { HENUZ_YOK, Money as Tutar, formatMoney } from './Money';
import { ResponsiveTable } from './ResponsiveTable';
import { Tag } from './Tag';
import './Overview.css';

// Tasarım: aile-tasarim/tasarim-sistemi/components/Overview/README.md + envanter.md satırı; referans davranış bundle.js
// Overview (Block, ODEMELER/DIKKAT/BUTCE/GOREVLER örnekleri). Genel durum sayfasının iskeleti: üstte en çok üç ölçü
// (kutusuz, tek satır), altında iki sütun: solda Yaklaşan ödemeler + Bütçe tablosu, sağda Dikkat isteyenler + Bu haftaki
// görevler. Her blok bir bölgedir (section + h2) ve başlık satırında ilgili sayfaya bağlantı taşır. Sayfa başlığı (h1,
// amaç, tazelik) kabuğun PageHeader'ındadır; burada yalnız ölçüler ve bloklar vardır. Referansın gömülü örnek verisi yerine
// her şey props ile gelir (sayfa hesaplar): bileşen yalnız çizer ve biçimler (₺8.500,00 tr-TR, 28.10.2026).
// Telefon sunumu antd'siz: yerel HTML + ARIA + --aile-* tokenları; tek uygulama tüm profillere hizmet eder (dar/geniş
// yerleşim narrow ya da profil ile, ödeme satırı kendi alanına container query ile uyar). Geniş-özel dosya yok.
//  - Liste blokları düz <ul>: satır tek bağlantıdır (ödeme ya da dikkat satırı), kart ya da kenarlık yok, liste tek
//    yuzey alanı, satırlar cizgi ile ayrılır.
//  - Bütçe tablosu ResponsiveTable (geniş ekranda tablo, telefonda akordeon, ilk satır açık): Planlanan, Gerçekleşen ve
//    Kalan ayrı sütunlardır; hiçbir yerde tek sayıda birleşmez. Gerçekleşen anlamı yalnız data/actuals.ts'ten (W0):
//    oran, çubuk ve "%N harcandı" spendLabel'dan ve yalnız ödeme kanıtıyla; kanıtsız kaynak değeri "Kaynakta yazılı",
//    gelecek dönem "Henüz yok". Kalan = Planlanan − Gerçekleşen, kesin ondalıkla (sumMoney), aynı para biriminde;
//    eksi kalan metindeki "-" ile okunur, ton yalnız destekler. Çubuk aria-hidden; bilgiyi metin taşır.
//  - Görevler yerel onay kutusu: satırın tamamı <label> (64 px hedef), girdinin adı görev adı, açıklaması meta satırı.
//    Durumu sayfa tutar (controlled), onToggleTask ile bildirilir; işleyici yoksa kutu devre dışıdır.
//  - Eksik bilgi adıyla: "Tarih yok", "Tutar yok", "Taraf bilinmiyor", "Plan yok", "Henüz yok", "Bilinmiyor"; boş blok
//    gizlenmez, adıyla yazılır. Odak çizgisini admin.css çizer ([data-focus-line]); liste satırları data-focus-line="row"
//    taşır ve Overview.css çizgiyi satırın alt kenarına çeker (README › Odak: liste satırında alt kenar).

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

/** Bir kalemin Gerçekleşen anlamı: actuals.recordedFor (tek gözlem) ya da actuals.recordedTotal (dönem toplamı). */
export type OverviewRecorded = RecordedValue | RecordedTotal;

/**
 * Bütçe kalemi: plan ve gerçek ayrı; Kalan ve harcama etiketi ikisinden türetilir, yoksa adıyla yazılır.
 * recorded verilmezse (ya da null) Gerçekleşen "Henüz yok"tur.
 */
export interface OverviewBudgetRow {
  id: string;
  label: string;
  planned: Money | null;
  /** Gerçekleşen (data/actuals.ts): not_yet → "Henüz yok"; evidence false → "Kaynakta yazılı"; money null → "Bilinmiyor". */
  recorded?: OverviewRecorded | null;
  /**
   * @deprecated recorded kullanın (actuals.recordedFor / recordedTotal). Geçiş için kabul edilir ve ödeme kanıtı
   * taşımadığından kaynakta yazılı değer sayılır: oran ve "harcandı" üretilmez; null → "Henüz yok". recorded
   * verildiğinde yok sayılır.
   */
  actual?: Money | null;
}

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
  /** Başlığın altındaki kısa not; bölgenin açıklamasıdır (ör. bütçede actuals.MIRRORS_PLAN_NOTE). */
  note?: string;
}

export interface OverviewProps {
  /** Tek sütun yerleşimi; verilmezse useDevice() !== 'desktop'. Bütçe tablosuna da aynı değer gider. */
  narrow?: boolean;
  measures: readonly OverviewMeasure[];
  payments: OverviewSection<OverviewPayment>;
  budget: OverviewSection<OverviewBudgetRow>;
  attention: OverviewSection<OverviewAttentionItem>;
  tasks: OverviewSection<OverviewTask>;
  /** Görev onay kutusu değişimi; verilmezse kutular devre dışıdır (sayfa değişikliği kaydedemiyor). */
  onToggleTask?(task: OverviewTask, done: boolean): void;
}

export const BILINMIYOR = 'Bilinmiyor';
const PLAN_YOK = 'Plan yok';
const TARIH_YOK = 'Tarih yok';
const TUTAR_YOK = 'Tutar yok';
const TARAF_BILINMIYOR = 'Taraf bilinmiyor';
const BOS = { odeme: 'Yaklaşan ödeme yok', butce: 'Bütçe kalemi yok', dikkat: 'Dikkat isteyen kayıt yok', gorev: 'Bu hafta görev yok' } as const;
const BUTCE_CAPTION = 'Bütçe kalemleri';
const OLCU_AZAMI = 3;
const META_AYRACI = ' · ';
const OLCEK_AZAMI = 100;

// --- Biçimleme (tr-TR) -----------------------------------------------------------------------------
/** @deprecated ui/Money formatMoney kullanın. ₺8.500,00 — tr-TR, iki ondalık; bozuk tutar "Bilinmiyor". */
export function paraMetni(money: Money): string {
  return formatMoney(money, BILINMIYOR);
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

const durumSozcugu = (status: StatusLabel) => (status.label.trim() ? status.label.trim() : BILINMIYOR);

// --- Gerçekleşen (data/actuals.ts) ---------------------------------------------------------------------
type Kayitli = Extract<OverviewRecorded, { kind: 'recorded' }>;

/** Satırın Gerçekleşen anlamı; null = kayıt yok ("Henüz yok"). */
function gerceklesen(row: OverviewBudgetRow): OverviewRecorded | null {
  if (row.recorded !== undefined) {
    const value = row.recorded;
    // Dönemde hiç Gerçekleşen kaydı olmayan toplam: kaynakta yazılı bir şey yok.
    if (value?.kind === 'recorded' && 'total' in value && value.total.counted === 0 && value.total.missing === 0) return null;
    return value;
  }
  // Geçiş (deprecated actual): ödeme kanıtı yok; değer kaynakta yazılıdır, harcama sayılmaz.
  return row.actual ? { kind: 'recorded', money: row.actual, evidence: false } : null;
}

const kayitli = (value: OverviewRecorded | null): value is Kayitli => value?.kind === 'recorded';

/** -x (metin ondalık; kayan nokta yok). */
const eksi = ({ amount, currency }: Money): Money => {
  const metin = amount.trim();
  return { amount: metin.startsWith('-') ? metin.slice(1) : `-${metin}`, currency };
};

/** Kalan = Planlanan − Gerçekleşen; ikisi de okunur ve aynı para birimindeyse kesin, aksi hâlde null. */
function kalan(planned: Money, actual: Money): Money | null {
  const fark = sumMoney([planned, eksi(actual)]);
  return fark.counted === 2 && fark.money ? fark.money : null;
}

// --- Parçalar --------------------------------------------------------------------------------------
function Blok({ title, link, note, children }: { title: string; link?: OverviewLink; note?: string; children: ReactNode }) {
  const id = useId();
  const notId = `${id}-not`;
  return (
    <section className="aile-ov-blok" aria-labelledby={id} aria-describedby={note ? notId : undefined}>
      <div className="aile-ov-bas">
        <h2 id={id} className="aile-ov-baslik">{title}</h2>
        {link ? <a className="aile-ov-bag" href={link.href}>{link.label}</a> : null}
      </div>
      {note ? <p id={notId} className="aile-ov-not aile-kucuk aile-ikincil">{note}</p> : null}
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
              {formatMoney(olcu.value, BILINMIYOR)}
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
        <Tutar value={payment.amount} label={TUTAR_YOK} />
        <Tag tone={payment.status.tone}>{durumSozcugu(payment.status)}</Tag>
      </span>
    </>
  );
  const classes = 'aile-ov-satir aile-ov-satir--odeme';
  return (
    <li>
      {payment.href ? <a className={classes} href={payment.href} data-focus-line="row">{icerik}</a> : <div className={classes}>{icerik}</div>}
    </li>
  );
}

/** İnce harcama çubuğu: süsleyici (aria-hidden), yalnız kanıtlı oranla; 100'ü aşan oran çubuğu taşırmaz, aşım tonlanır. */
function Olcek({ percent }: { percent: number }) {
  const dolu = Math.min(OLCEK_AZAMI, Math.max(0, percent));
  return (
    <span className="aile-ov-olcek" aria-hidden="true" data-asim={percent > OLCEK_AZAMI ? 'true' : undefined}>
      <span className="aile-ov-olcek-dolgu" style={{ width: `${dolu}%` }} />
    </span>
  );
}

function KalemHucresi({ row }: { row: OverviewBudgetRow }) {
  const etiket = spendLabel(row.planned ?? undefined, gerceklesen(row));
  // Parçalar arasındaki boşluk metinde kalır (satır ve akordeon başlığının erişilebilir adı "Mutfak Kaynakta yazılı");
  // esnek sütunda görünmez.
  return (
    <span className="aile-ov-kalem">
      <span>{row.label}</span>{' '}
      {etiket.kind === 'spent' && etiket.percent !== null ? <Olcek percent={etiket.percent} /> : null}
      {/* Gelecek dönemin "Henüz yok"u Gerçekleşen sütunundadır; burada tekrarlanmaz. */}
      {etiket.kind !== 'not_yet' ? <span className="aile-ov-yuzde aile-kucuk aile-ikincil">{etiket.text}</span> : null}
    </span>
  );
}

function GerceklesenHucresi({ row }: { row: OverviewBudgetRow }) {
  const deger = gerceklesen(row);
  if (!kayitli(deger)) return <Tutar value={null} label={HENUZ_YOK} />;
  // Toplamda birden çok para birimi: toplanmaz, adıyla ("Birden çok para birimi"); okunamayan değer "Bilinmiyor".
  if (!deger.money) return <Tutar value={'total' in deger ? deger.total : null} label={BILINMIYOR} />;
  return <Tutar value={deger.money} />;
}

function KalanHucresi({ row }: { row: OverviewBudgetRow }) {
  const deger = gerceklesen(row);
  if (!row.planned) return <Tutar value={null} label={PLAN_YOK} />;
  if (!kayitli(deger)) return <Tutar value={null} label={HENUZ_YOK} />;
  const fark = deger.money ? kalan(row.planned, deger.money) : null;
  return <Tutar value={fark} label={BILINMIYOR} sign="negative" />;
}

// Sütun rolleri (ResponsiveTable): kalem başlık; üç tutar telefonda etiket–değer gövdesinde kalır (lead yok).
const BUTCE_SUTUNLARI: readonly ResponsiveColumn<OverviewBudgetRow>[] = [
  { key: 'label', title: 'Kalem', minWidth: 160, m: 'title', render: row => <KalemHucresi row={row} /> },
  { key: 'planned', title: 'Planlanan', align: 'right', minWidth: 112, render: row => <Tutar value={row.planned} label={PLAN_YOK} /> },
  { key: 'actual', title: 'Gerçekleşen', align: 'right', minWidth: 120, render: row => <GerceklesenHucresi row={row} /> },
  { key: 'remaining', title: 'Kalan', align: 'right', minWidth: 112, render: row => <KalanHucresi row={row} /> },
];

function DikkatSatiri({ item }: { item: OverviewAttentionItem }) {
  return (
    <li>
      <a className="aile-ov-satir aile-ov-satir--sayi" href={item.href} data-focus-line="row">
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

// Görev satırı: <label> satırın tamamıdır (dokunma ve tıklama her yerde); girdi görünür kutunun kendisidir
// (appearance: none, forced-colors'ta sistem kutusu), onay işareti girdinin üstünde süsleyici simgedir.
function GorevSatiri({ task, onToggle }: { task: OverviewTask; onToggle?: OverviewProps['onToggleTask'] }) {
  const id = useId();
  const adId = `${id}-ad`;
  const metaId = `${id}-meta`;
  const vade = gunOku(task.due);
  const meta = [task.code, task.owner, vade ? tarihBicimi.format(vade) : task.due ? TARIH_YOK : undefined, task.project]
    .map(parca => parca?.trim())
    .filter(Boolean)
    .join(META_AYRACI);
  return (
    <li>
      <label className={task.done ? 'aile-ov-gorev aile-ov-gorev--bitti' : 'aile-ov-gorev'} data-focus-line="row">
        <span className="aile-ov-kutu">
          <input
            type="checkbox"
            className="aile-ov-kutu-girdi"
            checked={!!task.done}
            disabled={!onToggle}
            aria-labelledby={adId}
            aria-describedby={meta ? metaId : undefined}
            onChange={event => onToggle?.(task, event.currentTarget.checked)}
          />
          <Icon name="check" size={16} className="aile-ov-kutu-isaret" />
        </span>
        <span className="aile-ov-satir-ana">
          <span id={adId} className="aile-ov-gorev-ad">{task.label}</span>
          {meta ? <span id={metaId} className="aile-ov-meta aile-kucuk aile-ikincil">{meta}</span> : null}
        </span>
      </label>
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
          <Blok title={payments.title} link={payments.link} note={payments.note}>
            {payments.items.length ? (
              <ul className="aile-ov-liste">{payments.items.map(payment => <OdemeSatiri key={payment.id} payment={payment} />)}</ul>
            ) : (
              <Bos text={payments.empty ?? BOS.odeme} />
            )}
          </Blok>
          <Blok title={budget.title} link={budget.link} note={budget.note}>
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
          <Blok title={attention.title} link={attention.link} note={attention.note}>
            {attention.items.length ? (
              <ul className="aile-ov-liste">{attention.items.map(item => <DikkatSatiri key={item.id} item={item} />)}</ul>
            ) : (
              <Bos text={attention.empty ?? BOS.dikkat} />
            )}
          </Blok>
          <Blok title={tasks.title} link={tasks.link} note={tasks.note}>
            {tasks.items.length ? (
              <ul className="aile-ov-liste">{tasks.items.map(task => <GorevSatiri key={task.id} task={task} onToggle={onToggleTask} />)}</ul>
            ) : (
              <Bos text={tasks.empty ?? BOS.gorev} />
            )}
          </Blok>
        </div>
      </div>
    </div>
  );
}
