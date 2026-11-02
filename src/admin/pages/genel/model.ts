// Genel durum sayfasının saf görünüm modeli: React, antd ve ECharts yok; telefon temel sunumu (GenelTelefon) ve geniş
// modül (GenelPage.wide) aynı modeli çizer. Gerçekleşen anlamının tek kaynağı data/actuals.ts:
//  - Dönem ve "bugün" Europe/Istanbul takviminden (cihazın yerel ayı/günü değil).
//  - Gerçekleşen yalnız silinmemiş 'recorded_aggregate' gözlemidir; 'unclassified', bilinmeyen basis ve silinmiş kayıt
//    hiçbir toplama girmez. Gelecek ayın Gerçekleşeni "Henüz yok"tur (kaynakta plan aynası olsa da gösterilmez).
//  - Kanıtsız (payment_evidence false) değer "Kaynakta yazılı"dır: yüzde, "harcandı" ve "kalan" türetilmez; metin ve
//    oran yalnız spendLabel'dan. Plan ve gerçek tek sayıda birleşmez.
//  - Toplamlar sumMoney ile kesin ondalık (bigint); farklı para birimleri toplanmaz ("Birden çok para birimi").
//  - Aylık plan ve gerçek: bir ayın bütçe gözlemleri tek Planlanan/Gerçekleşen sayısında toplanmaz. Satırlar gelir, ara
//    toplam ("… toplamı"), genel toplam ("Toplam …") ve adet satırlarını da taşır; nesilde satır düzeyinde yaprak sahipliği
//    haritası yok (views.sumUnavailableReason). Ay satırı kayıtları sayar, tutar yerine "Toplam kullanılamaz" yazar.
import {
  BUDGET_TIME_ZONE,
  MIRRORS_PLAN_NOTE,
  MIXED_CURRENCY_TEXT,
  currentPeriod,
  isFuturePeriod,
  mirrorsPlan,
  plannedTotal,
  recordedTotal,
  spendLabel,
  sumMoney,
  type BaseRecord,
  type BudgetObservation,
  type ForecastEvent,
  type ForecastMonth,
  type MediaReference,
  type Issue,
  type Money,
  type MoneyTotal,
  type PurchaseNeedRecord,
  type RecordedTotal,
  type SpendLabel,
} from '../../data';
// Doğrudan views.sums: telefon ilk rotası görünüm kataloğunu (views.ts) indirmez; metin katalogla aynı kaynaktan.
import { BUDGET_SUM_UNAVAILABLE_REASON, TOTAL_UNAVAILABLE_TEXT } from '../../data/views.sums';
import type { StatusLabel } from '../../shell/contracts';
import { BILINMIYOR, HENUZ_YOK, formatMoney } from '../../ui/Money';

export const PENCERE_GUN = 7;
export const GRAFIK_AY = 6;
export const ADSIZ_KALEM = 'Adsız kalem';

export const KAYNAKTA_YOK = {
  forecast_months: 'Kaynakta tahmin ayı kaydı yok',
  forecast_events: 'Kaynakta tahmin olayı kaydı yok',
  budget_observations: 'Kaynakta bütçe gözlemi kaydı yok',
  work_orders: 'Kaynakta iş emri kaydı yok',
  geciken: 'Kaynakta alım ve iş emri kaydı yok',
} as const;

const TRY = 'TRY';
const ODEME_DURUMU: Record<string, StatusLabel> = {
  planned: { label: 'Planlandı', tone: 'notr' },
  estimated: { label: 'Tutar tahmini', tone: 'uyari' },
};
const BITMIS_TESLIMAT: ReadonlySet<string> = new Set(['installed', 'delivered', 'cancelled']);
const BUTCE_BASIS: ReadonlySet<string> = new Set(['planned', 'recorded_aggregate']);

const siralayici = new Intl.Collator('tr-TR');
const sayiBicimi = new Intl.NumberFormat('tr-TR');
export const sayiMetni = (sayi: number) => sayiBicimi.format(sayi);

// --- Gün ve dönem (Europe/Istanbul) ------------------------------------------------------------------------
const ISO_GUN = /^(\d{4})-(\d{2})-(\d{2})/;
const DONEM = /^(\d{4})-(0[1-9]|1[0-2])$/;
const istanbulGunBicimi = new Intl.DateTimeFormat('en-CA', { timeZone: BUDGET_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

/** 'YYYY-MM-DD': anın İstanbul takvimindeki günü. Geçersiz tarih RangeError (gün uydurulmaz). */
export function istanbulGunu(an: Date): string {
  currentPeriod(an); // geçersiz tarihte RangeError
  const parcalar = istanbulGunBicimi.formatToParts(an);
  const parca = (tip: string) => parcalar.find(p => p.type === tip)?.value ?? '';
  return `${parca('year')}-${parca('month')}-${parca('day')}`;
}

/** ISO gün metni (ilk 10 karakter) ya da undefined. */
export function isoGun(deger: unknown): string | undefined {
  if (typeof deger !== 'string') return undefined;
  const parca = ISO_GUN.exec(deger.trim());
  if (!parca) return undefined;
  const gun = new Date(Date.UTC(Number(parca[1]), Number(parca[2]) - 1, Number(parca[3])));
  return Number.isNaN(gun.getTime()) || gun.getUTCDate() !== Number(parca[3]) ? undefined : `${parca[1]}-${parca[2]}-${parca[3]}`;
}

/** ISO güne gün ekler (takvim; saat dilimi yok). */
export function gunEkle(iso: string, adet: number): string {
  const [y, a, g] = iso.split('-').map(Number);
  return new Date(Date.UTC(y!, a! - 1, g! + adet)).toISOString().slice(0, 10);
}

/** "08.12.2026" (tasarım tarih biçimi); ISO değilse undefined. */
export function tarihMetni(iso: string | null | undefined): string | undefined {
  const gun = isoGun(iso);
  if (!gun) return undefined;
  const [y, a, g] = gun.split('-');
  return `${g}.${a}.${y}`;
}

const haftaGunu = new Intl.DateTimeFormat('tr-TR', { weekday: 'long', timeZone: 'UTC' });
/** "Salı"; ISO değilse undefined. */
export function gunAdi(iso: string | null | undefined): string | undefined {
  const gun = isoGun(iso);
  if (!gun) return undefined;
  const [y, a, g] = gun.split('-').map(Number);
  return haftaGunu.format(new Date(Date.UTC(y!, a! - 1, g!)));
}

const ayUzun = new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const ayKisa = new Intl.DateTimeFormat('tr-TR', { month: 'short', year: 'numeric', timeZone: 'UTC' });
/** "Aralık 2026" (uzun) ya da "Ara 2026" (kısa); bozuk dönem olduğu gibi. */
export function donemAdi(donem: string, bicim: 'uzun' | 'kisa' = 'uzun'): string {
  const parca = DONEM.exec(donem);
  if (!parca) return donem;
  const gun = new Date(Date.UTC(Number(parca[1]), Number(parca[2]) - 1, 1));
  return (bicim === 'uzun' ? ayUzun : ayKisa).format(gun);
}

/** Dönemin son günü "31.12" (ölçü notu için). */
function donemSonu(donem: string): string | undefined {
  const parca = DONEM.exec(donem);
  if (!parca) return undefined;
  const son = new Date(Date.UTC(Number(parca[1]), Number(parca[2]), 0)).getUTCDate();
  return `${String(son).padStart(2, '0')}.${parca[2]}`;
}

// --- Para ----------------------------------------------------------------------------------------------
const ONDALIK = /^-?[0-9]+(\.[0-9]+)?$/;

/** Veri platformu para zarfını doğrular; bozuk ya da boş değer null (sıfır değil). Birim yoksa TRY. */
export function para(value: unknown): Money {
  if (!value || typeof value !== 'object') return null;
  const { amount, currency } = value as { amount?: unknown; currency?: unknown };
  if (typeof amount !== 'string' || !ONDALIK.test(amount.trim())) return null;
  return { amount: amount.trim(), currency: typeof currency === 'string' && currency.trim() ? currency.trim().toUpperCase() : TRY };
}

/** Tutarın mutlak değeri (metin ondalık; kayan nokta yok). */
const mutlak = (money: NonNullable<Money>): NonNullable<Money> => ({ amount: money.amount.replace(/^-/, ''), currency: money.currency });
const eksi = (money: NonNullable<Money>): NonNullable<Money> => ({
  amount: money.amount.startsWith('-') ? money.amount.slice(1) : `-${money.amount}`,
  currency: money.currency,
});
const negatifMi = (money: NonNullable<Money>) => money.amount.startsWith('-') && /[1-9]/.test(money.amount);

/** Toplam metni: tek birim → ₺; birden çok birim → adıyla; değer yoksa `bos`. */
export function toplamMetni(toplam: MoneyTotal, bos: string = BILINMIYOR): string {
  if (toplam.money) return formatMoney(toplam.money);
  return toplam.currencies.length > 1 ? MIXED_CURRENCY_TEXT : bos;
}

/** Gerçekleşen değerinin metni: kayıt yok/gelecek ay "Henüz yok"; okunamayan "Bilinmiyor"; karışık birim adıyla. */
export function gerceklesenMetni(recorded: RecordedTotal | null): string {
  if (!recorded || recorded.kind === 'not_yet') return HENUZ_YOK;
  return toplamMetni(recorded.total, BILINMIYOR);
}

/** Planlanan metni: plan yoksa "Plan yok"; karışık birim adıyla. */
export const PLAN_YOK = 'Plan yok';
export function planMetni(planned: MoneyTotal): string {
  if (planned.counted === 0 && planned.missing === 0) return PLAN_YOK;
  return toplamMetni(planned, BILINMIYOR);
}

// --- Kayıt okuyucular -----------------------------------------------------------------------------------
export const aktif = (record: BaseRecord) => !record.deleted_at;
export const metin = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
export function nitelik(record: BaseRecord, ...anahtarlar: string[]): string | undefined {
  for (const anahtar of anahtarlar) {
    const deger = metin(record.attributes?.[anahtar]);
    if (deger) return deger;
  }
  return undefined;
}

/** Alım/iş emri kapanmamış: silinmemiş, iptal edilmemiş, teslimatı bitmemiş. */
export function acik(record: PurchaseNeedRecord): boolean {
  if (!aktif(record) || record.state_snapshot?.decision === 'cancelled') return false;
  const teslimat = record.state_snapshot?.fulfillment;
  return !(teslimat && BITMIS_TESLIMAT.has(teslimat));
}

/** Vade (ISO gün): sipariş vadesi → planlanan gün → bitiş. */
export const vade = (record: PurchaseNeedRecord) => isoGun(record.dates?.order_due_on) ?? isoGun(record.dates?.planned_on) ?? isoGun(record.dates?.end_on);

// --- Yaklaşan ödemeler ------------------------------------------------------------------------------------
export interface GenelOdeme {
  id: string;
  /** ISO gün. */
  date: string;
  label: string;
  party?: string;
  /** Plan ölçüsü ya da nakit çıkışının mutlak değeri; yoksa null ("Tutar yok"). */
  amount: Money;
  status: StatusLabel;
}

interface Olay { odeme: GenelOdeme; cikis: boolean }
function olayOku(record: ForecastEvent): Olay | undefined {
  const gun = isoGun(record.occurred_on);
  if (!gun || !aktif(record)) return undefined;
  const nakit = para(record.cash_change);
  const planli = para((record.measures as { planned?: unknown } | undefined)?.planned);
  // Nakit değişimi biliniyorsa yönü o söyler; bilinmiyorsa olay ödeme sayılır (tutarı plan ölçüsünden).
  const cikis = nakit ? negatifMi(nakit) : true;
  const kesinlik = metin(record.certainty);
  const status: StatusLabel = (kesinlik ? ODEME_DURUMU[kesinlik] : undefined) ?? { label: kesinlik ?? BILINMIYOR, tone: 'notr' };
  return {
    cikis,
    odeme: {
      id: record.id,
      date: gun,
      label: metin(record.label) ?? 'Adsız tahmin olayı',
      party: nitelik(record, 'taraf', 'party'),
      amount: planli ?? (nakit ? mutlak(nakit) : null),
      status,
    },
  };
}

/** Bugünden (dahil) PENCERE_GUN gün içindeki nakit çıkışları, tarih sırasıyla. */
export function yaklasanOdemeler(olaylar: readonly ForecastEvent[], bugun: string): GenelOdeme[] {
  const son = gunEkle(bugun, PENCERE_GUN);
  return olaylar
    .map(olayOku)
    .filter((olay): olay is Olay => olay !== undefined && olay.cikis && olay.odeme.date >= bugun && olay.odeme.date < son)
    .map(olay => olay.odeme)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : siralayici.compare(a.label, b.label)));
}

// --- Ölçüler (başlık özeti) -----------------------------------------------------------------------------
export interface GenelOlcu { label: string; value: string; note?: string }

export function kalanNakit(aylar: readonly ForecastMonth[], donem: string): GenelOlcu {
  const ay = aylar.find(row => aktif(row) && row.period === donem);
  const kapanis = para((ay?.measures as { closing_balance?: unknown } | undefined)?.closing_balance);
  const son = donemSonu(donem);
  return {
    label: 'Bu ay kalan nakit',
    value: kapanis ? formatMoney(kapanis) : BILINMIYOR,
    note: kapanis ? `tahmin · ${son}'e kadar` : aylar.length === 0 ? KAYNAKTA_YOK.forecast_months : `${donemAdi(donem)} için tahmin yok`,
  };
}

export function odenecekOlcusu(odemeler: readonly GenelOdeme[], olaylarBos: boolean): GenelOlcu {
  const label = `${PENCERE_GUN} gün içinde ödenecek`;
  if (olaylarBos) return { label, value: BILINMIYOR, note: KAYNAKTA_YOK.forecast_events };
  if (odemeler.length === 0) return { label, value: formatMoney({ amount: '0.00', currency: TRY }), note: 'Ödeme yok' };
  const toplam = sumMoney(odemeler.map(odeme => odeme.amount));
  const notlar = [`${sayiMetni(odemeler.length)} ödeme`, toplam.missing > 0 ? `${sayiMetni(toplam.missing)} tutarsız` : undefined, 'tahmin'];
  return { label, value: toplamMetni(toplam), note: notlar.filter(Boolean).join(' · ') };
}

/** kaynakBos: nesilde hiç alım ve iş emri kaydı yok; sıfır toplam kayıtla desteklenmez, tutar uydurulmaz. */
export function gecikenOlcusu(gecikenler: readonly PurchaseNeedRecord[], kaynakBos = false): GenelOlcu {
  if (kaynakBos && gecikenler.length === 0) return { label: 'Geciken', value: BILINMIYOR, note: KAYNAKTA_YOK.geciken };
  if (gecikenler.length === 0) return { label: 'Geciken', value: formatMoney({ amount: '0.00', currency: TRY }), note: 'Geciken yok' };
  const toplam = sumMoney(gecikenler.map(record => para(record.amounts?.planned)));
  const notlar = [`${sayiMetni(gecikenler.length)} kayıt`, toplam.missing > 0 ? `${sayiMetni(toplam.missing)} fiyatsız` : undefined, 'plan toplamı'];
  return { label: 'Geciken', value: toplamMetni(toplam), note: notlar.filter(Boolean).join(' · ') };
}

/** Vadesi bugünden önce olan açık alım ve iş emirleri. */
export function gecikenKayitlar(kayitlar: readonly PurchaseNeedRecord[], bugun: string): PurchaseNeedRecord[] {
  return kayitlar.filter(acik).filter(record => {
    const gun = vade(record);
    return gun !== undefined && gun < bugun;
  });
}

// --- Dikkat isteyenler ------------------------------------------------------------------------------------
export interface GenelDikkat { id: string; label: string; count: number; page: string; href: string }
const SAYFA_ADI = { alimlar: 'Alımlar ve eşyalar', veri: 'Veri kalitesi ve içe aktarma' } as const;

export function dikkatIsteyenler(args: {
  alimlar: readonly PurchaseNeedRecord[];
  medya: readonly MediaReference[];
  sorunlar: readonly Issue[];
  geciken: number;
}): GenelDikkat[] {
  const acikAlimlar = args.alimlar.filter(record => aktif(record) && record.state_snapshot?.decision !== 'cancelled');
  const dogrulanmis = new Set(args.medya.filter(m => aktif(m) && m.verification === 'verified').map(m => m.entity_id));
  const liste: GenelDikkat[] = [
    { id: 'fiyatsiz', label: 'Fiyatı eksik alım', count: acikAlimlar.filter(record => !para(record.amounts?.planned)).length, page: SAYFA_ADI.alimlar, href: '#/alimlar' },
    { id: 'fotografsiz', label: 'Doğrulanmış fotoğrafı olmayan alım', count: acikAlimlar.filter(record => !dogrulanmis.has(record.id)).length, page: SAYFA_ADI.alimlar, href: '#/alimlar' },
    { id: 'sorun', label: 'Açık sorun', count: args.sorunlar.filter(aktif).length, page: SAYFA_ADI.veri, href: '#/veri' },
    { id: 'geciken', label: 'Geciken kayıt', count: args.geciken, page: SAYFA_ADI.alimlar, href: '#/alimlar' },
  ];
  return liste.filter(item => item.count > 0);
}

// --- Bekleyen işler ---------------------------------------------------------------------------------------
export interface GenelGorev { id: string; label: string; code?: string; owner?: string; due?: string; done: boolean }

/** Kurulmamış iş emirleri, vade sırasıyla (vadesizler sonda). */
export function bekleyenIsler(isler: readonly PurchaseNeedRecord[]): PurchaseNeedRecord[] {
  const anahtar = (record: PurchaseNeedRecord) => vade(record) ?? '￿';
  return isler.filter(acik).sort((a, b) => {
    const x = anahtar(a);
    const y = anahtar(b);
    return x < y ? -1 : x > y ? 1 : siralayici.compare(a.label ?? '', b.label ?? '');
  });
}

export function gorevMetaMetni(gorev: GenelGorev): string {
  return [gorev.code, gorev.owner, gorev.due ? tarihMetni(gorev.due) ?? 'Tarih yok' : undefined].filter(Boolean).join(' · ');
}

// --- Bütçe (bu ay) --------------------------------------------------------------------------------------
export interface GenelButceSatiri {
  id: string;
  label: string;
  /** Silinmemiş 'planned' gözlemlerinin kesin toplamı. */
  planned: MoneyTotal;
  /** null: bu kalemde Gerçekleşen kaydı yok ("Henüz yok"); not_yet: gelecek ay. */
  recorded: RecordedTotal | null;
  /** Durum metni ve (yalnız ödeme kanıtıyla) oran. */
  spend: SpendLabel;
  /** Kalan = plan − gerçek; yalnız ödeme kanıtı varken (spend.kind 'spent'). */
  remaining: MoneyTotal | null;
}

const etiketi = (observation: BudgetObservation) => metin(observation.label) ?? ADSIZ_KALEM;
const butceGozlemi = (observation: BudgetObservation) => aktif(observation) && BUTCE_BASIS.has(observation.basis) && DONEM.test(observation.period);

/** Kayıtsız (hiç Gerçekleşen satırı olmayan) toplamı "yok" sayar: spendLabel bunu "Henüz yok" der. */
function gercekleseni(gozlemler: readonly BudgetObservation[], donem: string, bugun: Date): RecordedTotal | null {
  const toplam = recordedTotal(gozlemler, donem, bugun);
  if (toplam.kind === 'recorded' && toplam.total.counted === 0 && toplam.total.missing === 0) return null;
  return toplam;
}

function kalani(planned: MoneyTotal, recorded: RecordedTotal | null, spend: SpendLabel): MoneyTotal | null {
  if (spend.kind !== 'spent' || !planned.money || !recorded || recorded.kind !== 'recorded' || !recorded.money) return null;
  return sumMoney([planned.money, eksi(recorded.money)]);
}

/** Dönemin bütçe kalemleri: plan ve Gerçekleşen kalem başına ayrı; unclassified/silinmiş katılmaz. */
export function butceSatirlari(gozlemler: readonly BudgetObservation[], donem: string, bugun: Date): GenelButceSatiri[] {
  const kalemler = new Map<string, BudgetObservation[]>();
  for (const gozlem of gozlemler) {
    if (!butceGozlemi(gozlem) || gozlem.period !== donem) continue;
    const ad = etiketi(gozlem);
    kalemler.set(ad, [...(kalemler.get(ad) ?? []), gozlem]);
  }
  return [...kalemler.entries()]
    .sort(([a], [b]) => siralayici.compare(a, b))
    .map(([label, satirlar]) => {
      const planned = plannedTotal(satirlar, donem);
      const recorded = gercekleseni(satirlar, donem, bugun);
      const spend = spendLabel(planned.money ?? undefined, recorded);
      return { id: `${donem}:${label}`, label, planned, recorded, spend, remaining: kalani(planned, recorded, spend) };
    });
}

/** Bu ayın Gerçekleşeni planın kopyasıysa (kanıtsız) not; değilse null. */
export function planAynasiNotu(gozlemler: readonly BudgetObservation[], donem: string): string | null {
  return mirrorsPlan(gozlemler.filter(gozlem => gozlem.period === donem)) ? MIRRORS_PLAN_NOTE : null;
}

// --- Aylık plan ve gerçek ------------------------------------------------------------------------------
export interface GenelAy {
  donem: string;
  /** Silinmemiş plan kaydı sayısı (tutar toplanmaz). */
  planKaydi: number;
  /** Silinmemiş Gerçekleşen kaydı sayısı; gelecek ayda sayılmaz (0). */
  gerceklesenKaydi: number;
  /** İçinde bulunulan aydan (Europe/Istanbul) sonra. */
  gelecek: boolean;
  /** Durum: gelecek ay ya da kayıt yok "Henüz yok"; kanıtsız "Kaynakta yazılı"; kanıtlı "Harcandı" (oran yok: toplam yok). */
  spend: SpendLabel;
}

/** Aylık blokta toplamın neden yazılmadığı (views ortak metni). */
export const AYLIK_TOPLAM_NOTU = BUDGET_SUM_UNAVAILABLE_REASON;

/** Bugüne kadarki son N ay (yoksa en erken N ay); her ay plan ve Gerçekleşen kayıtları ayrı sayılır, tutar toplanmaz. */
export function aylikSatirlar(gozlemler: readonly BudgetObservation[], bugun: Date, adet: number = GRAFIK_AY): GenelAy[] {
  const buDonem = currentPeriod(bugun);
  const gecerli = gozlemler.filter(butceGozlemi);
  const aylar = [...new Set(gecerli.map(gozlem => gozlem.period))].sort();
  const gecmis = aylar.filter(donem => donem <= buDonem);
  const secili = gecmis.length > 0 ? gecmis.slice(-adet) : aylar.slice(0, adet);
  return secili.map(donem => {
    const ayin = gecerli.filter(gozlem => gozlem.period === donem);
    const gelecek = isFuturePeriod(donem, bugun);
    return {
      donem,
      planKaydi: ayin.filter(gozlem => gozlem.basis === 'planned').length,
      gerceklesenKaydi: gelecek ? 0 : ayin.filter(gozlem => gozlem.basis === 'recorded_aggregate').length,
      gelecek,
      // Durum yalnız kaydın varlığından ve kanıttan: plan verilmez, oran üretilmez; toplam tutar modele girmez.
      spend: spendLabel(undefined, gercekleseni(ayin, donem, bugun)),
    };
  });
}

/** Ayın Planlanan hücresi: plan kaydı yoksa "Plan yok"; varsa "Toplam kullanılamaz" (satırlar toplanmaz). */
export const ayPlanMetni = (ay: GenelAy): string => (ay.planKaydi > 0 ? TOTAL_UNAVAILABLE_TEXT : PLAN_YOK);

/** Ayın Gerçekleşen hücresi: gelecek ay ya da kayıt yoksa "Henüz yok"; varsa "Toplam kullanılamaz". */
export const ayGerceklesenMetni = (ay: GenelAy): string => (ay.gelecek || ay.gerceklesenKaydi === 0 ? HENUZ_YOK : TOTAL_UNAVAILABLE_TEXT);

/** "8 plan · 8 gerçekleşen"; gelecek ayda "8 plan kaydı" (Gerçekleşen sayılmaz). */
export const ayKayitMetni = (ay: GenelAy): string =>
  ay.gelecek ? `${sayiMetni(ay.planKaydi)} plan kaydı` : `${sayiMetni(ay.planKaydi)} plan · ${sayiMetni(ay.gerceklesenKaydi)} gerçekleşen`;

// --- Sunum modeli (telefon ve geniş aynı veriyi çizer) ------------------------------------------------------
export interface GenelBaglanti { label: string; href: string }
export const BAGLANTI = {
  butce: { label: 'Bütçe ve nakit', href: '#/butce' },
  veri: { label: 'Veri kalitesi', href: '#/veri' },
  projeler: { label: 'Projeler ve görevler', href: '#/projeler' },
} as const satisfies Record<string, GenelBaglanti>;

export interface GenelBolum<T> { title: string; link: GenelBaglanti; items: readonly T[]; empty: string }

export interface GenelGorunum {
  odemeler: GenelBolum<GenelOdeme>;
  dikkat: GenelBolum<GenelDikkat>;
  /** note: plan aynası notu (MIRRORS_PLAN_NOTE) ya da null. */
  butce: GenelBolum<GenelButceSatiri> & { note: string | null };
  gorevler: GenelBolum<GenelGorev>;
  /** note: toplamın neden yazılmadığı (AYLIK_TOPLAM_NOTU). */
  aylik: GenelBolum<GenelAy> & { note: string };
}

export interface GenelSunumProps {
  gorunum: GenelGorunum;
  /** Verilmezse (değişiklik kümesi hazır değil) onay kutuları devre dışı. */
  onToggleTask?(id: string, done: boolean): void;
}

export const AYLIK_BASLIK = 'Aylık plan ve gerçek';
