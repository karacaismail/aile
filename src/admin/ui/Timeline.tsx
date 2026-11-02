import { useId } from 'react';
import { useDevice } from '../device';
import type { RecordRow } from '../shell/contracts';
import { FIYAT_YOK, Money } from './Money';
import { Tag } from './Tag';
import './Timeline.css';

// Tasarım: aile-tasarim/tasarim-sistemi/components/Timeline/README.md + index.d.ts TimelineProps; referans davranış
// bundle.js Timeline. Alımlar için tek-tarih çizelgesi (Gantt gibi süre değil): seçilen tarih alanına (dateField,
// dışarıdan — sorgu şeridindeki Select) göre kayıtlar aya bölünür; aylar artan, ay içinde günler artan sırada. Her ay
// bir bölgedir: h3 "Kasım 2026" + "N kayıt"; solda gün (18/600) ve ay kısaltması, ortada acik-mavi çizgi + eylem
// kenarlı nokta, sağda ListRow benzeri kayıt düğmesi (ad; kod · oda · tarih türü + tarih; durum etiketi sözcükle;
// Planlanan tutar ₺ tr-TR ya da "Fiyat yok"). Tarihi olmayanlar sonda "Tarihi bilinmiyor" grubunda; gizlenmez ve
// meta satırı eksikliği adıyla yazar. Okunamayan tarih de o gruba düşer, nedeni yazılı ("Tarih okunamadı").
// Plan ve gerçek tek sayıda birleşmez: burada yalnız Planlanan gösterilir (referansla aynı); gerçek ayrıntıdadır.
// Seçili kayıt aria-current + secili yüzey (başlık zaten 600). Odak çizgisini admin.css çizer ([data-focus-line]).
// Dar biçim: narrow ya da cihaz 'phone' (useDevice); gövde tek sütuna iner, tutar sola yaslanır.
// Para biçimi ui/Money'nin işidir (₺8.500,00; eksik "Fiyat yok"; bozuk tutar "Bilinmiyor"); burada yerel biçimleyici yok.

export type TimelineDateField = keyof NonNullable<RecordRow['dates']>;

export const TIMELINE_DATE_LABELS: Readonly<Record<TimelineDateField, string>> = {
  planned: 'Planlanan teslim',
  ordered: 'Sipariş',
  delivered: 'Teslim',
  paid: 'Ödeme',
};

export interface TimelineProps {
  items: readonly RecordRow[];
  /** Çizelgenin tek tarihi hangi alandan okunur; seçimi sorgu şeridi yapar. */
  dateField: TimelineDateField;
  /** Seçili (ayrıntısı açık) kaydın id'si. */
  selectedKey?: string;
  onOpen?(row: RecordRow): void;
  /** Dar biçimi zorlar; verilmezse cihaz 'phone' iken dar. */
  narrow?: boolean;
  className?: string;
}

const TARIHI_BILINMIYOR = 'Tarihi bilinmiyor';
const TARIH_OKUNAMADI = 'Tarih okunamadı';
const BILINMIYOR = 'Bilinmiyor';
const HENUZ_KAYIT_YOK = 'Henüz kayıt yok';
const AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'] as const;
const ISO_GUN = /^(\d{4})-(\d{2})-(\d{2})/;

interface ParsedDate { year: number; month: number; day: number }
interface Entry { row: RecordRow; date: ParsedDate | null; raw: string | undefined }
interface MonthGroup { key: string; title: string; monthShort: string; entries: Entry[] }

/** Veri platformu ISO gün ("2026-11-15" ya da ISO zaman). Saat dilimi kaymasına girmemek için Date kullanılmaz. */
function parseIsoDay(value: string | undefined): ParsedDate | null {
  if (!value) return null;
  const match = ISO_GUN.exec(value.trim());
  if (!match) return null;
  const [, y, m, d] = match;
  const month = Number(m);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year: Number(y), month, day };
}

const pad2 = (n: number) => String(n).padStart(2, '0');
/** 28.10.2026 */
const formatDay = ({ year, month, day }: ParsedDate) => `${pad2(day)}.${pad2(month)}.${year}`;

function groupByMonth(items: readonly RecordRow[], field: TimelineDateField): { months: MonthGroup[]; undated: Entry[] } {
  const byKey = new Map<string, MonthGroup>();
  const undated: Entry[] = [];
  for (const row of items) {
    const raw = row.dates?.[field];
    const date = parseIsoDay(raw);
    if (!date) {
      undated.push({ row, date: null, raw });
      continue;
    }
    const key = `${date.year}-${pad2(date.month)}`;
    let group = byKey.get(key);
    if (!group) {
      const monthName = AYLAR[date.month - 1];
      group = { key, title: `${monthName} ${date.year}`, monthShort: monthName.slice(0, 3), entries: [] };
      byKey.set(key, group);
    }
    group.entries.push({ row, date, raw });
  }
  const months = [...byKey.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  for (const group of months) group.entries.sort((a, b) => (a.date!.day - b.date!.day));
  return { months, undated };
}

export function Timeline({ items, dateField, selectedKey, onOpen, narrow, className }: TimelineProps) {
  const id = useId();
  const device = useDevice();
  const dar = narrow ?? device === 'phone';
  const dateLabel = TIMELINE_DATE_LABELS[dateField];
  const { months, undated } = groupByMonth(items, dateField);

  const dateText = (entry: Entry) =>
    entry.date ? `${dateLabel} ${formatDay(entry.date)}` : `${dateLabel}: ${entry.raw ? TARIH_OKUNAMADI : BILINMIYOR}`;

  const renderEntry = (entry: Entry, monthShort?: string) => {
    const { row, date } = entry;
    const selected = row.id === selectedKey;
    const meta = [row.code, row.room, dateText(entry)].filter(Boolean).join(' · ');
    return (
      <li key={row.id} className="aile-tl-item">
        {date ? (
          <span className="aile-tl-date">
            <strong>{date.day}</strong>
            <span className="aile-kucuk">{monthShort}</span>
          </span>
        ) : (
          <span className="aile-tl-date aile-tl-date--yok" aria-hidden="true">—</span>
        )}
        <span className="aile-tl-dot" aria-hidden="true" />
        <button
          type="button"
          className="aile-tl-body"
          data-focus-line=""
          data-selected={selected ? 'true' : 'false'}
          aria-current={selected ? 'true' : undefined}
          onClick={onOpen ? () => onOpen(row) : undefined}
        >
          <span className="aile-tl-main">
            <span className="aile-tl-title">{row.label}</span>
            <span className="aile-tl-meta aile-kucuk">{meta}</span>
          </span>
          <Tag tone={row.status.tone}>{row.status.label}</Tag>
          <span className="aile-tl-amount">
            <span className="aile-tl-sr">Planlanan </span>
            <Money value={row.planned} label={FIYAT_YOK} />
          </span>
        </button>
      </li>
    );
  };

  const renderGroup = (key: string, title: string, entries: Entry[], monthShort?: string) => {
    const headingId = `${id}-${key}`;
    return (
      <section key={key} className="aile-tl-group" aria-labelledby={headingId}>
        <h3 id={headingId} className="aile-tl-gtitle">
          {title}
          {/* Boşluk: erişilebilir ad "Kasım 2026 2 kayıt" olur, "20262" değil; flex kapsayıcıda yerleşimi etkilemez. */}
          {' '}
          <span className="aile-tl-gcount aile-kucuk">{entries.length} kayıt</span>
        </h3>
        <ol className="aile-tl-list">{entries.map(entry => renderEntry(entry, monthShort))}</ol>
      </section>
    );
  };

  return (
    <div className={['aile-tl', className].filter(Boolean).join(' ')} data-narrow={dar ? 'true' : 'false'}>
      {items.length === 0 ? <p className="aile-tl-bos aile-ikincil">{HENUZ_KAYIT_YOK}</p> : null}
      {months.map(group => renderGroup(group.key, group.title, group.entries, group.monthShort))}
      {undated.length > 0 ? renderGroup('tarihsiz', TARIHI_BILINMIYOR, undated) : null}
    </div>
  );
}
