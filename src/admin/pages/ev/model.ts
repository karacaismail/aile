import { MIXED_CURRENCY_TEXT, sumMoney, type MoneyTotal } from '../../data/actuals';
import type { PurchaseNeedRecord, Relation, Room, Term, UUID } from '../../data/types';
import type { RecordRow } from '../../shell/contracts';
import { BILINMIYOR, formatMoney } from '../../ui/Money';

// Ev ve odalar görünüm modeli (saf TS, React yok). Girdi: doğrulanmış nesilden rooms + relations + terms ve oda bağlı
// dört kayıt türü (purchase_needs, work_orders, layout_items, lighting_specs) ile veri katmanının RecordRow eşlemesi.
// Kurallar: silinmiş kayıt ve silinmiş oda yok sayılır; kaydın odası room_id (canlı oda) ya da located_in ilişkisiyle
// bulunur, bulunamazsa "Oda bilinmiyor" satırına düşer. "Alım" yalnız purchase_needs'tir: aynı odaya bağlı işler, eşyalar,
// armatürler ayrı sayılır. Plan ve gerçek ayrı toplanır (data/actuals sumMoney: bigint kesin, karışık birim → money null);
// tek sayıda birleşmez. Eksik bilgi adıyla: "Fiyat yok", "Henüz yok", "Bilinmiyor", "Fotoğraf yok", "Oda atanmamış".

export type Sekme = 'alimlar' | 'isler' | 'esyalar' | 'aydinlatma';
export const SEKMELER: readonly { key: Sekme; label: string }[] = [
  { key: 'alimlar', label: 'Alımlar' },
  { key: 'isler', label: 'İşler' },
  { key: 'esyalar', label: 'Eşyalar' },
  { key: 'aydinlatma', label: 'Aydınlatma' },
];

export const ODASIZ_ID = 'odasiz';
export const ODA_BILINMIYOR = 'Oda bilinmiyor';
export const ODA_ATANMAMIS = 'Oda atanmamış';
export const EKSIK_YOK = 'Eksik yok';
export const BIRDEN_COK = 'Birden çok';
export const FOTOGRAF_YOK = 'Fotoğraf yok';
const KAPALI_IS = new Set(['installed', 'delivered', 'completed']);

export interface AydinlatmaSatiri extends RecordRow {
  /** "2400 lm" ya da "Bilinmiyor". */
  lumen: string;
  /** "3000 K" ya da "Bilinmiyor". */
  renk: string;
}

export interface IsSatiri extends RecordRow {
  /** İptal edilmemiş ve kurulmamış/teslim edilmemiş/tamamlanmamış. */
  acik: boolean;
}

export interface OdaOzeti {
  /** Oda kimliği; odasız satırda ODASIZ_ID. */
  id: string;
  label: string;
  code: string;
  odasiz: boolean;
  /** Alımların proje aşaması: tek etiket, "Birden çok" ya da "Bilinmiyor". */
  asama: string;
  alimlar: readonly RecordRow[];
  isler: readonly IsSatiri[];
  /** Açık iş sayısı (IsSatiri.acik). */
  acikIs: number;
  esyalar: readonly RecordRow[];
  aydinlatma: readonly AydinlatmaSatiri[];
  /** Alımların planlanan toplamı; gerçekleşenle birleşmez. */
  planned: MoneyTotal;
  actual: MoneyTotal;
  /** "2 fiyat · 3 fotoğraf" | "Eksik yok"; odasız satırda "Oda atanmamış" ile başlar. */
  eksik: string;
  /** "app_ayarlar · satır 4"; odasız satırda null. */
  kaynak: string | null;
}

export interface EvModeli {
  odalar: readonly OdaOzeti[];
  odaSayisi: number;
  alimSayisi: number;
  odasizAlim: number;
  planned: MoneyTotal;
  actual: MoneyTotal;
}

export interface EvGirdisi {
  rooms: readonly Room[];
  relations: readonly Relation[];
  terms: readonly Term[];
  needs: readonly PurchaseNeedRecord[];
  workOrders: readonly PurchaseNeedRecord[];
  layout: readonly PurchaseNeedRecord[];
  lighting: readonly PurchaseNeedRecord[];
  /** Kaydın liste satırı (veri katmanı toRecordRow); yoksa kayıt atlanır. */
  satir(record: PurchaseNeedRecord): RecordRow | undefined;
}

export const sayi = (n: number, birim: string) => `${n} ${birim}`;

/** Toplamın metni: karışık birim "Birden çok para birimi", hiç değer yoksa `eksik` ("Fiyat yok"/"Henüz yok"). */
export function toplamMetni(total: MoneyTotal, eksik: string): string {
  if (total.currencies.length > 1) return MIXED_CURRENCY_TEXT;
  return formatMoney(total.money, eksik);
}

/** ISO YYYY-MM-DD → 28.10.2026; yoksa `eksik`. */
export function tarihMetni(iso: string | null | undefined, eksik: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return match ? `${match[3]}.${match[2]}.${match[1]}` : eksik;
}

const canli = <R extends { deleted_at?: string | null }>(list: readonly R[]) => list.filter((item) => !item.deleted_at);
const parasi = (rows: readonly RecordRow[], key: 'planned' | 'actual') => sumMoney(rows.map((row) => row[key] ?? undefined));

function odaKimligi(record: PurchaseNeedRecord, iliskiler: ReadonlyMap<UUID, readonly Relation[]>, odalar: ReadonlyMap<UUID, Room>): string {
  if (record.room_id && odalar.has(record.room_id)) return record.room_id;
  for (const rel of iliskiler.get(record.id) ?? []) if (rel.kind === 'located_in' && odalar.has(rel.target_id)) return rel.target_id;
  return ODASIZ_ID;
}

function asamaMetni(records: readonly PurchaseNeedRecord[], terimler: ReadonlyMap<UUID, Term>): string {
  const etiketler = new Set<string>();
  for (const record of records) {
    const term = record.phase_term_id ? terimler.get(record.phase_term_id) : undefined;
    if (term) etiketler.add(term.label);
  }
  if (etiketler.size === 0) return BILINMIYOR;
  return etiketler.size === 1 ? [...etiketler][0]! : BIRDEN_COK;
}

function eksikMetni(alimlar: readonly RecordRow[], odasiz: boolean): string {
  const fiyat = alimlar.filter((row) => row.planned === null).length;
  const fotograf = alimlar.filter((row) => !row.photo?.verified).length;
  const parcalar = [odasiz ? ODA_ATANMAMIS : null, fiyat > 0 ? sayi(fiyat, 'fiyat') : null, fotograf > 0 ? sayi(fotograf, 'fotoğraf') : null];
  const metin = parcalar.filter(Boolean).join(' · ');
  return metin || EKSIK_YOK;
}

const acikIs = (record: PurchaseNeedRecord) =>
  record.state_snapshot?.decision !== 'cancelled' && !KAPALI_IS.has(record.state_snapshot?.fulfillment ?? '');

function ozellik(record: PurchaseNeedRecord, key: string): string | undefined {
  for (const bag of [record.attributes, record.source_attributes]) {
    const value = bag?.[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function kaynakMetni(room: Room): string | null {
  const p = room.provenance;
  if (!p) return null;
  return p.row ? `${p.sheet_title} · satır ${p.row}` : p.sheet_title;
}

export function evModeli(girdi: EvGirdisi): EvModeli {
  const odalarById = new Map<UUID, Room>();
  for (const room of canli(girdi.rooms)) odalarById.set(room.id, room);
  const iliskiler = new Map<UUID, Relation[]>();
  for (const rel of girdi.relations) {
    const list = iliskiler.get(rel.source_id);
    if (list) list.push(rel);
    else iliskiler.set(rel.source_id, [rel]);
  }
  const terimler = new Map<UUID, Term>(girdi.terms.map((term) => [term.id, term]));

  const grupla = (records: readonly PurchaseNeedRecord[]) => {
    const map = new Map<string, PurchaseNeedRecord[]>();
    for (const record of canli(records)) {
      const key = odaKimligi(record, iliskiler, odalarById);
      const list = map.get(key);
      if (list) list.push(record);
      else map.set(key, [record]);
    }
    return map;
  };
  const alim = grupla(girdi.needs);
  const is = grupla(girdi.workOrders);
  const esya = grupla(girdi.layout);
  const isik = grupla(girdi.lighting);
  const satirlar = (records: readonly PurchaseNeedRecord[] | undefined) =>
    (records ?? []).map((record) => girdi.satir(record)).filter((row): row is RecordRow => Boolean(row));

  const ozet = (id: string, label: string, code: string, room: Room | null): OdaOzeti => {
    const alimKayitlari = alim.get(id) ?? [];
    const alimlar = satirlar(alimKayitlari);
    const aydinlatma: AydinlatmaSatiri[] = [];
    for (const record of isik.get(id) ?? []) {
      const row = girdi.satir(record);
      if (!row) continue;
      const lumen = ozellik(record, 'lumen');
      const renk = ozellik(record, 'renk_sicakligi_k');
      aydinlatma.push({ ...row, lumen: lumen ? `${lumen} lm` : BILINMIYOR, renk: renk ? `${renk} K` : BILINMIYOR });
    }
    const isler: IsSatiri[] = [];
    for (const record of is.get(id) ?? []) {
      const row = girdi.satir(record);
      if (row) isler.push({ ...row, acik: acikIs(record) });
    }
    return {
      id, label, code, odasiz: room === null,
      asama: asamaMetni(alimKayitlari, terimler),
      alimlar,
      isler,
      acikIs: isler.filter((row) => row.acik).length,
      esyalar: satirlar(esya.get(id)),
      aydinlatma,
      planned: parasi(alimlar, 'planned'),
      actual: parasi(alimlar, 'actual'),
      eksik: eksikMetni(alimlar, room === null),
      kaynak: room ? kaynakMetni(room) : null,
    };
  };

  const odalar = [...odalarById.values()]
    .sort((a, b) => (a.label ?? a.code).localeCompare(b.label ?? b.code, 'tr-TR'))
    .map((room) => ozet(room.id, room.label ?? room.code, room.code, room));
  const odasizVar = [alim, is, esya, isik].some((map) => (map.get(ODASIZ_ID)?.length ?? 0) > 0);
  if (odasizVar) odalar.push(ozet(ODASIZ_ID, ODA_BILINMIYOR, BILINMIYOR, null));

  const tumAlimlar = odalar.flatMap((oda) => oda.alimlar);
  return {
    odalar,
    odaSayisi: odalarById.size,
    alimSayisi: tumAlimlar.length,
    odasizAlim: alim.get(ODASIZ_ID)?.length ?? 0,
    planned: parasi(tumAlimlar, 'planned'),
    actual: parasi(tumAlimlar, 'actual'),
  };
}

