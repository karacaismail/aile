// Taraflar ve teklifler — saf model (React yok). Kaynak sözleşmesi data-platform/normalize.mjs:
//  - e-tablodaki "usta" satırı kind 'provider' olur ve 'providers' koleksiyonuna yazılır; teklif_tl → amounts.quote,
//    sayi alanları (teklif_sure_gun, garanti_ay) ondalık metin, bool (myk_dogrulandi) true/false/null, telefon metin.
//  - bagli_idler → associated_with ilişkisi (yön kaynak satırdan hedefe); usta ↔ alım/iş bağı iki yönde de okunur.
// İlkeler: eksik bilgi null döner (sunum "Bilinmiyor" / "Fiyat yok" diye adıyla yazar); hiçbir bağ, ad ya da tutar
// uydurulmaz; plan (planned), gerçek (actual) ve teklif (quote) ayrı alanlardır, tek sayıda birleşmez. Tutar
// karşılaştırması ve farkı data/actuals sumMoney ile kesin ondalık (bigint) yapılır; sayıya çevirip yuvarlama yok.
import { sumMoney } from '../../data/actuals';
import type { Manifest, Money, PurchaseNeedRecord, Relation } from '../../data/types';

type Para = NonNullable<Money>;

// --- Etiketler (shared/schema.ts LABELS ile aynı; model.test.ts eşitliği denetler) ---------------------------------
/** İş emri "İşi yapan" (is_kim) kodları. */
export const IS_KIM_ETIKETLERI: Readonly<Record<string, string>> = {
  elektrikci: 'Elektrikçi', boyaci: 'Boyacı', marangoz: 'Marangoz', nakliye: 'Nakliye', klimaci: 'Klimacı',
  internet: 'İnternet', ev_sahibi: 'Ev sahibi', idari: 'İdari', ben: 'Ben',
};
/** Usta "Meslek" kodları. */
export const MESLEK_ETIKETLERI: Readonly<Record<string, string>> = {
  elektrik: 'Elektrik', boya: 'Boya', marangoz: 'Marangoz', nakliye: 'Nakliye', klima: 'Klima', internet: 'İnternet', diger: 'Diğer',
};

/** Bilinen kodun etiketi; bilinmeyen kod kaynaktaki hâliyle (uydurma etiket yok). */
export const isKimEtiketi = (kod: string): string => IS_KIM_ETIKETLERI[kod] ?? kod;
const meslekEtiketi = (kod: string): string => MESLEK_ETIKETLERI[kod] ?? kod;

// --- Yardımcılar -----------------------------------------------------------------------------------------------
const canli = (record: { deleted_at?: string | null }) => !record.deleted_at;

/** Kırpılmış boş olmayan metin; sayı metne çevrilir (e-tabloda sayı olarak girilmiş telefon). */
function metin(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text ? text : null;
}

/** attributes önce, yoksa source_attributes (normalize her ikisini de taşır). */
function alan(record: PurchaseNeedRecord, key: string): unknown {
  const value = record.attributes?.[key];
  return value !== undefined && value !== null ? value : record.source_attributes?.[key];
}

const ONDALIK = /^-?[0-9]+(\.[0-9]+)?$/;
const ondalik = (value: unknown): string | null => {
  const text = metin(value);
  return text && ONDALIK.test(text) ? text : null;
};
const para = (value: Money | undefined): Para | null => (value && ONDALIK.test(value.amount.trim()) ? value : null);
const paraBirimi = (value: Para): string => value.currency.trim().toUpperCase();
const eksi = (value: Para): Para => ({ currency: value.currency, amount: value.amount.startsWith('-') ? value.amount.slice(1) : `-${value.amount}` });
/** a − b (aynı para birimi); kesin ondalık, en az iki hane. */
const fark = (a: Para, b: Para): Para | null => sumMoney([a, eksi(b)]).money;
/** İşaret: a < b → -1, eşit → 0, a > b → 1. */
function karsilastir(a: Para, b: Para): number {
  const sonuc = fark(a, b);
  if (!sonuc) return 0;
  if (sonuc.amount.startsWith('-')) return -1;
  return /^0+(\.0+)?$/.test(sonuc.amount) ? 0 : 1;
}

// --- İletişim --------------------------------------------------------------------------------------------------
export interface IletisimBaglantisi {
  /** tel:+<E.164> */
  tel: string;
  /** https://wa.me/<hane>; Türkiye sabit hattında (cep değil) null. */
  whatsapp: string | null;
}

/**
 * Kaynaktaki telefon metninden arama ve WhatsApp bağlantısı. Türkiye: 0532…, 532…, +90…, 0090… → +90 + 10 hane.
 * "+" ya da "00" ile başlayan yurt dışı numarası 8–15 hane olduğu gibi kalır. Biçimi tanınmayan değer null döner
 * (ham metin sunumda korunur, bağlantı uydurulmaz).
 */
export function iletisimBaglantisi(value: unknown): IletisimBaglantisi | null {
  const text = metin(value);
  if (!text) return null;
  const uluslararasi = /^\s*(\+|00)/.test(text);
  let digits = text.replace(/\D/g, '');
  if (text.trim().startsWith('00')) digits = digits.slice(2);
  let e164: string | null = null;
  if (digits.startsWith('90') && digits.length === 12) e164 = digits;
  else if (!uluslararasi && digits.startsWith('0') && digits.length === 11) e164 = `9${digits}`;
  else if (!uluslararasi && digits.length === 10 && !digits.startsWith('0')) e164 = `90${digits}`;
  else if (uluslararasi && !digits.startsWith('90') && digits.length >= 8 && digits.length <= 15) e164 = digits;
  if (!e164) return null;
  const turkiye = e164.startsWith('90');
  const cep = !turkiye || e164.startsWith('905');
  return { tel: `tel:+${e164}`, whatsapp: cep ? `https://wa.me/${e164}` : null };
}

// --- Taraflar (providers) --------------------------------------------------------------------------------------
export interface Taraf {
  id: string;
  /** Kaynaktaki ad; yoksa null ("Bilinmiyor"); satır kimliği ad yerine geçmez. */
  ad: string | null;
  /** Kaynak satır kimliği (kalem-050). */
  kod: string | null;
  meslek: string | null;
  /** Kaynaktaki telefon metni olduğu gibi. */
  telefon: string | null;
  iletisim: IletisimBaglantisi | null;
  /** Teklif (plan değil, ödeme değil). */
  teklif: Para | null;
  /** Ondalık metin (gün). */
  sureGun: string | null;
  /** Ondalık metin (ay). */
  garantiAy: string | null;
  /** MYK belgesi doğrulandı mı; kaynakta yoksa null. */
  myk: boolean | null;
  /** "app_kalemler · satır 50" */
  kaynak: string | null;
}

const tarafAdi = (record: PurchaseNeedRecord): string | null => metin(alan(record, 'ad'));

function tarafOf(record: PurchaseNeedRecord): Taraf {
  const meslek = metin(alan(record, 'meslek'));
  const telefon = metin(alan(record, 'telefon'));
  const myk = alan(record, 'myk_dogrulandi');
  const p = record.provenance;
  return {
    id: record.id,
    ad: tarafAdi(record),
    kod: metin(record.source_record_id),
    meslek: meslek ? meslekEtiketi(meslek) : null,
    telefon,
    iletisim: iletisimBaglantisi(telefon),
    teklif: para(record.amounts?.quote),
    sureGun: ondalik(alan(record, 'teklif_sure_gun')),
    garantiAy: ondalik(alan(record, 'garanti_ay')),
    myk: typeof myk === 'boolean' ? myk : null,
    kaynak: p ? `${p.sheet_title} · satır ${p.row}` : null,
  };
}

const adSirasi = (a: string | null, b: string | null) => (a === null ? (b === null ? 0 : 1) : b === null ? -1 : a.localeCompare(b, 'tr-TR'));

/** Silinmemiş usta kayıtları; ada göre (adı olmayan sonda). */
export function taraflariTuret(records: readonly PurchaseNeedRecord[]): Taraf[] {
  return records.filter(canli).map(tarafOf).sort((a, b) => adSirasi(a.ad, b.ad));
}

// --- Teklifler -------------------------------------------------------------------------------------------------
export type KayitTuru = 'alim' | 'is';
/** bagli: tek kayda bağlı; bagsiz: usta teklifi hiçbir kayda bağlı değil; belirsiz: birden çok kayda bağlı. */
export type GrupDurumu = 'bagli' | 'bagsiz' | 'belirsiz';

export interface Teklif {
  key: string;
  /** Usta kaydı; kaydın kendi teklif alanıysa null (taraf bilinmiyor). */
  tarafId: string | null;
  tarafAdi: string | null;
  tutar: Para;
  sureGun: string | null;
  garantiAy: string | null;
  telefon: string | null;
  iletisim: IletisimBaglantisi | null;
}

export interface TeklifGrubu {
  key: string;
  durum: GrupDurumu;
  kayitId: string | null;
  kayitAdi: string | null;
  kayitKodu: string | null;
  tur: KayitTuru | null;
  /** Kaydın planı ve gerçeği; teklifle birleşmez. */
  plan: Para | null;
  gercek: Para | null;
  /** Para birimi, sonra tutar sırasıyla. */
  teklifler: Teklif[];
  /** Tek para biriminde ≥2 teklif varken tekil en düşük teklif; aksi null. */
  enDusukKey: string | null;
  /** En düşük ile bir sonraki arasındaki fark (enDusukKey varken). */
  fark: Para | null;
  paraBirimleri: string[];
}

export interface TeklifKaynaklari {
  /** Alım (purchase_needs) ve iş (work_orders) kayıtları. */
  kayitlar: readonly PurchaseNeedRecord[];
  /** Usta (providers) kayıtları; koleksiyon yoksa verilmez. */
  taraflar?: readonly PurchaseNeedRecord[];
  iliskiler?: readonly Relation[];
}

const turOf = (record: PurchaseNeedRecord): KayitTuru | null => (record.kind === 'purchase_need' ? 'alim' : record.kind === 'work_order' ? 'is' : null);

function teklifSirasi(a: Teklif, b: Teklif): number {
  const ca = paraBirimi(a.tutar);
  const cb = paraBirimi(b.tutar);
  if (ca !== cb) return ca.localeCompare(cb);
  return karsilastir(a.tutar, b.tutar) || adSirasi(a.tarafAdi, b.tarafAdi);
}

function enDusuk(teklifler: readonly Teklif[], birimler: readonly string[]): { key: string | null; fark: Para | null } {
  if (teklifler.length < 2 || birimler.length !== 1) return { key: null, fark: null };
  const [ilk, ikinci] = teklifler as [Teklif, Teklif];
  if (karsilastir(ilk.tutar, ikinci.tutar) >= 0) return { key: null, fark: null };
  return { key: ilk.key, fark: fark(ikinci.tutar, ilk.tutar) };
}

/**
 * Teklifleri kayıt bazında toplar: kaydın kendi amounts.quote değeri (taraf bilinmiyor) + o kayda associated_with ile
 * tek başına bağlı ustaların teklifleri. Karşılaştırma ve "en düşük" yalnız aynı gruptaki tekliflerdedir. Gruplar:
 * ≥2 teklifli olanlar önce, sonra kayıt adına göre; bağsız/belirsiz usta teklifleri en sonda ayrı gruplardadır.
 */
export function teklifGruplari({ kayitlar, taraflar = [], iliskiler = [] }: TeklifKaynaklari): TeklifGrubu[] {
  const kayitById = new Map(kayitlar.filter(canli).map((record) => [record.id, record] as const));
  const ustaIds = new Set(taraflar.filter(canli).map((record) => record.id));
  const baglar = new Map<string, Set<string>>();
  for (const rel of iliskiler) {
    if (rel.kind !== 'associated_with' || rel.deleted_at) continue;
    const [usta, hedef] = ustaIds.has(rel.source_id) ? [rel.source_id, rel.target_id] : [rel.target_id, rel.source_id];
    if (!ustaIds.has(usta) || !kayitById.has(hedef)) continue;
    const set = baglar.get(usta) ?? new Set<string>();
    set.add(hedef);
    baglar.set(usta, set);
  }

  const gruplar = new Map<string, Omit<TeklifGrubu, 'enDusukKey' | 'fark' | 'paraBirimleri'>>();
  const grupFor = (key: string, init: () => Omit<TeklifGrubu, 'enDusukKey' | 'fark' | 'paraBirimleri'>) => {
    let grup = gruplar.get(key);
    if (!grup) {
      grup = init();
      gruplar.set(key, grup);
    }
    return grup;
  };
  const kayitGrubu = (record: PurchaseNeedRecord) => grupFor(record.id, () => ({
    key: record.id,
    durum: 'bagli',
    kayitId: record.id,
    kayitAdi: metin(record.label) ?? metin(alan(record, 'ad')),
    kayitKodu: metin(record.source_record_id),
    tur: turOf(record),
    plan: para(record.amounts?.planned),
    gercek: para(record.amounts?.actual),
    teklifler: [],
  }));
  const ozelGrup = (durum: Exclude<GrupDurumu, 'bagli'>) => grupFor(durum, () => ({
    key: durum, durum, kayitId: null, kayitAdi: null, kayitKodu: null, tur: null, plan: null, gercek: null, teklifler: [],
  }));

  for (const record of kayitById.values()) {
    const tutar = para(record.amounts?.quote);
    if (!tutar) continue;
    kayitGrubu(record).teklifler.push({ key: `${record.id}:kayit`, tarafId: null, tarafAdi: null, tutar, sureGun: null, garantiAy: null, telefon: null, iletisim: null });
  }
  for (const usta of taraflar.filter(canli)) {
    const taraf = tarafOf(usta);
    if (!taraf.teklif) continue;
    const hedefler = [...(baglar.get(usta.id) ?? [])];
    const grup = hedefler.length === 1 ? kayitGrubu(kayitById.get(hedefler[0]!)!) : ozelGrup(hedefler.length === 0 ? 'bagsiz' : 'belirsiz');
    grup.teklifler.push({
      key: `${grup.key}:${usta.id}`,
      tarafId: usta.id,
      tarafAdi: taraf.ad,
      tutar: taraf.teklif,
      sureGun: taraf.sureGun,
      garantiAy: taraf.garantiAy,
      telefon: taraf.telefon,
      iletisim: taraf.iletisim,
    });
  }

  const sonuc: TeklifGrubu[] = [...gruplar.values()].map((grup) => {
    const teklifler = [...grup.teklifler].sort(teklifSirasi);
    const paraBirimleri = [...new Set(teklifler.map((t) => paraBirimi(t.tutar)))].sort();
    const best = enDusuk(teklifler, paraBirimleri);
    return { ...grup, teklifler, paraBirimleri, enDusukKey: best.key, fark: best.fark };
  });
  const sira = (g: TeklifGrubu) => (g.durum === 'bagli' ? (g.teklifler.length >= 2 ? 0 : 1) : g.durum === 'bagsiz' ? 2 : 3);
  return sonuc.sort((a, b) => sira(a) - sira(b) || adSirasi(a.kayitAdi, b.kayitAdi));
}

// --- İş emirlerindeki "İşi yapan" (adaylar) --------------------------------------------------------------------
/** Aday kaynağı: hangi iş emri alanından geldiği (yalnız kaynak metin; ilişki değil). */
export type AdayAlani = 'is_kim' | 'usta';

export interface Aday {
  /** Kaynak metin, kırpılmış (is_kim için kod); anahtar olarak da kullanılır. */
  ad: string;
  /** Adın geçtiği alanlar. */
  alanlar: readonly AdayAlani[];
  /** Adın geçtiği iş emirleri (etiket). */
  isler: readonly string[];
}

const ADAY_ALANLARI: readonly AdayAlani[] = ['is_kim', 'usta'];

function metinler(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(metinler);
  const text = metin(value);
  return text ? [text] : [];
}

/** work_orders.attributes.is_kim / usta (yoksa source_attributes) metinlerini ad bazında toplar; silinmiş kayıt sayılmaz. */
export function adaylariTuret(records: readonly PurchaseNeedRecord[]): Aday[] {
  const map = new Map<string, { alanlar: Set<AdayAlani>; isler: Set<string> }>();
  for (const record of records) {
    if (!canli(record)) continue;
    const label = record.label ?? record.source_record_id ?? record.id;
    for (const key of ADAY_ALANLARI) {
      for (const ad of metinler(alan(record, key))) {
        const entry = map.get(ad) ?? { alanlar: new Set<AdayAlani>(), isler: new Set<string>() };
        entry.alanlar.add(key);
        entry.isler.add(label);
        map.set(ad, entry);
      }
    }
  }
  return [...map.entries()]
    .map(([ad, entry]) => ({ ad, alanlar: [...entry.alanlar], isler: [...entry.isler] }))
    .sort((a, b) => b.isler.length - a.isler.length || a.ad.localeCompare(b.ad, 'tr-TR'));
}

// --- Taraf kaynağı (manifest) ----------------------------------------------------------------------------------
/**
 * bilinmiyor: manifest henüz yok; yok: nesilde providers parçası yok; okunamiyor: parça var ama panel sözleşmesi bu
 * koleksiyonu tanımıyor (okumak nesli bozuk sayardı); okunur: okunabilir.
 */
export type TaraflarKaynakDurumu = 'bilinmiyor' | 'yok' | 'okunamiyor' | 'okunur';

export function taraflarKaynagi(manifest: Manifest | null, destekli: boolean): { durum: TaraflarKaynakDurumu; sayi: number | null } {
  if (!manifest) return { durum: 'bilinmiyor', sayi: null };
  const parcalar = manifest.files.filter((file) => file.kind === 'partition' && file.collection === 'providers');
  if (parcalar.length === 0) return { durum: 'yok', sayi: 0 };
  const sayi = parcalar.every((file) => typeof file.count === 'number') ? parcalar.reduce((total, file) => total + (file.count ?? 0), 0) : null;
  return { durum: destekli ? 'okunur' : 'okunamiyor', sayi };
}
