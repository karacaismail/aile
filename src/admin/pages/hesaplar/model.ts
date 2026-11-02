import { currentPeriod } from '../../data/actuals';
import type { Forecast, ForecastMonth, Money } from '../../data/types';

// Hesaplar sayfasının saf mantığı (React yok; telefon ve geniş sunum aynı modeli kullanır).
// Veri gerçeği: nesilde hesap ve borç koleksiyonu yoktur; tek bakiye kaynağı forecast_months'tır (record_basis
// 'forecast', _Finans web). Dönem anahtarlı tablodur (data-platform README: "period-keyed table, not additive pivot
// sums"): ayların ya da tahminlerin bakiyeleri toplanmaz, her değer kendi dönem + tahmin bağlamında gösterilir.
// Forecast ne plan ne gerçektir; sayfa her yerde "tahmin" diye yazar. Dönem Europe/Istanbul ayıdır (data/actuals).

export const BILINMIYOR = 'Bilinmiyor';
export const KAPANIS = 'closing_balance';
const TEK_TAHMIN_ADI = 'Nakit tahmini';
const BU_AY = 'Bu ay';
const DONEM_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** Ölçü anahtarı → Türkçe ad. Sıra: açılış → hareketler → kapanış; diğerleri ilk görüldükleri sırada sonda. */
const OLCU_ADLARI: Readonly<Record<string, string>> = {
  opening_balance: 'Açılış bakiyesi',
  planned_inflow: 'Planlanan giriş',
  planned_outflow: 'Planlanan çıkış',
  closing_balance: 'Kapanış bakiyesi',
};
const OLCU_SIRASI = Object.keys(OLCU_ADLARI);

export function olcuAdi(key: string): string {
  const bilinen = OLCU_ADLARI[key];
  if (bilinen) return bilinen;
  const metin = key.replace(/[_-]+/g, ' ').trim();
  return metin ? metin.charAt(0).toLocaleUpperCase('tr-TR') + metin.slice(1) : BILINMIYOR;
}

/** "2027-03" → "03.2027"; biçim dışı ya da eksik dönem "Bilinmiyor". */
export function donemMetni(period: string | undefined): string {
  const match = period ? DONEM_RE.exec(period) : null;
  return match ? `${match[2]}.${match[1]}` : BILINMIYOR;
}

const gecerliDonem = (period: string | undefined): period is string => period !== undefined && DONEM_RE.test(period);

/** Tahmin kimliği → görünen ad: label; yoksa tek tahminde "Nakit tahmini", birden çokta "Tahmin N". */
export function tahminAdlari(forecasts: readonly Forecast[]): Map<string, string> {
  const adlar = new Map<string, string>();
  forecasts.forEach((forecast, index) => {
    const label = typeof forecast.label === 'string' ? forecast.label.trim() : '';
    adlar.set(forecast.id, label || (forecasts.length === 1 ? TEK_TAHMIN_ADI : `Tahmin ${index + 1}`));
  });
  return adlar;
}

export interface DonemSatiri {
  /** forecast_month kimliği (tablo satır anahtarı). */
  key: string;
  forecastId: string;
  period: string | undefined;
  donem: string;
  tahmin: string;
  olculer: Readonly<Record<string, Money | undefined>>;
}

export interface KapanisCizgisi {
  donemler: string[];
  currency: string;
  /** Tahmin başına ayrı seri; seriler yığılmaz ve toplanmaz. */
  seriler: { ad: string; degerler: number[] }[];
}

export interface Projeksiyon {
  /** Dönem artan; biçim dışı dönemler sonda. Silinmiş kayıt yok. */
  satirlar: DonemSatiri[];
  olcuAnahtarlari: string[];
  /** Seçilebilir (biçimi geçerli) dönemler, artan, tekil. */
  donemler: string[];
  /** Satırlardaki farklı tahmin sayısı. */
  tahminSayisi: number;
  cizgi: KapanisCizgisi | null;
}

const siraAnahtari = (period: string | undefined) => (gecerliDonem(period) ? `0${period}` : '1');

function olculerOf(month: ForecastMonth): Record<string, Money | undefined> {
  const raw = month.measures;
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, Money | undefined> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const money = value as Partial<Money> | null;
    out[key] = money && typeof money.amount === 'string' && typeof money.currency === 'string' ? { amount: money.amount, currency: money.currency } : undefined;
  }
  return out;
}

/** Kapanış çizgisi yalnız her tahminin her dönemde aynı birimde, sayıya çevrilebilir kapanışı varsa çizilir. */
function kapanisCizgisi(satirlar: readonly DonemSatiri[], donemler: readonly string[]): KapanisCizgisi | null {
  if (donemler.length < 2) return null;
  const tahminler = [...new Set(satirlar.map(satir => satir.forecastId))];
  let currency: string | undefined;
  const seriler: KapanisCizgisi['seriler'] = [];
  for (const forecastId of tahminler) {
    const degerler: number[] = [];
    let ad = BILINMIYOR;
    for (const period of donemler) {
      const satir = satirlar.find(aday => aday.forecastId === forecastId && aday.period === period);
      const money = satir?.olculer[KAPANIS];
      if (!satir || !money) return null;
      const value = Number(money.amount);
      if (!Number.isFinite(value) || money.amount.trim() === '') return null;
      currency ??= money.currency;
      if (money.currency !== currency) return null;
      ad = satir.tahmin;
      degerler.push(value);
    }
    seriler.push({ ad, degerler });
  }
  return currency ? { donemler: donemler.map(donemMetni), currency, seriler } : null;
}

export function projeksiyon(months: readonly ForecastMonth[], adlar: ReadonlyMap<string, string>): Projeksiyon {
  const canli = months.filter(month => !month.deleted_at);
  const sirali = [...canli].sort((a, b) => siraAnahtari(a.period).localeCompare(siraAnahtari(b.period)) || a.id.localeCompare(b.id));
  const gorulen: string[] = [];
  const satirlar = sirali.map<DonemSatiri>(month => {
    const olculer = olculerOf(month);
    for (const key of Object.keys(olculer)) if (!gorulen.includes(key)) gorulen.push(key);
    const forecastId = typeof month.forecast_id === 'string' ? month.forecast_id : '';
    return { key: month.id, forecastId, period: month.period, donem: donemMetni(month.period), tahmin: adlar.get(forecastId) ?? BILINMIYOR, olculer };
  });
  const olcuAnahtarlari = [...OLCU_SIRASI.filter(key => gorulen.includes(key)), ...gorulen.filter(key => !OLCU_SIRASI.includes(key))];
  const donemler = [...new Set(satirlar.map(satir => satir.period).filter(gecerliDonem))];
  const tahminSayisi = new Set(satirlar.map(satir => satir.forecastId)).size;
  return { satirlar, olcuAnahtarlari, donemler, tahminSayisi, cizgi: kapanisCizgisi(satirlar, donemler) };
}

/** İçinde bulunulan ay (İstanbul) varsa o; yoksa ondan önceki en son dönem; hepsi gelecekteyse ilk dönem. */
export function varsayilanDonem(donemler: readonly string[], bugun: Date): string | null {
  if (donemler.length === 0) return null;
  const simdi = currentPeriod(bugun);
  const sirali = [...donemler].sort();
  if (sirali.includes(simdi)) return simdi;
  const onceki = sirali.filter(period => period < simdi);
  return onceki.at(-1) ?? sirali[0]!;
}

export interface DonemSecenegi { value: string; label: string; note?: string }

export function donemSecenekleri(donemler: readonly string[], bugun: Date): DonemSecenegi[] {
  const simdi = currentPeriod(bugun);
  return donemler.map(period => (period === simdi ? { value: period, label: donemMetni(period), note: BU_AY } : { value: period, label: donemMetni(period) }));
}

export const buAyMi = (period: string, bugun: Date) => period === currentPeriod(bugun);

export interface DonemOlcusu { key: string; ad: string; deger: Money | undefined }
export interface DonemBakiyesi { forecastId: string; tahmin: string; olculer: DonemOlcusu[] }

/** Seçili dönemin bakiyeleri, tahmin başına ayrı grup; ölçüler projeksiyonun sütun sırasında (deger yoksa "Bilinmiyor"). */
export function donemBakiyeleri(veri: Projeksiyon, period: string | null): DonemBakiyesi[] {
  if (!period) return [];
  return veri.satirlar
    .filter(satir => satir.period === period)
    .map(satir => ({
      forecastId: satir.forecastId,
      tahmin: satir.tahmin,
      // Projeksiyonun her ölçüsü her dönemde yazılır; bu dönemde olmayan ölçü saklanmaz, değeri "Bilinmiyor" olur.
      olculer: veri.olcuAnahtarlari.map(key => ({ key, ad: olcuAdi(key), deger: satir.olculer[key] })),
    }));
}

export type KapanisOzeti = { kind: 'tek'; deger: Money | undefined } | { kind: 'cok'; sayi: number } | { kind: 'yok' };

/** Başlık özeti: tek tahminde dönemin kapanışı; birden çok tahminde yalnız sayısı (bakiyeler toplanmaz). */
export function kapanisOzeti(veri: Projeksiyon, period: string | null): KapanisOzeti {
  const gruplar = donemBakiyeleri(veri, period);
  if (gruplar.length === 0) return { kind: 'yok' };
  if (gruplar.length > 1) return { kind: 'cok', sayi: gruplar.length };
  return { kind: 'tek', deger: gruplar[0]!.olculer.find(olcu => olcu.key === KAPANIS)?.deger };
}
