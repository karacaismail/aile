import { Money, Tag } from '../../ui';
import { RECORDED_IN_SOURCE_TEXT, RECORDED_NOT_YET_TEXT, type Money as MoneyValue, type RecordedValue } from '../../data';
import { BILINMIYOR, type BudgetRow } from './model';

// Bütçe hücreleri: telefon akordeonu, geniş tablo ve geniş eğilim (ButceTrend.wide) aynı anlamı aynı sözcükle yazar.
// Eksik bilgi adıyla: plan yok "Fiyat yok", Gerçekleşen yok ya da gelecek ay "Henüz yok", okunamayan/yinelenen
// "Bilinmiyor". Ödeme kanıtı olmayan Gerçekleşen tutarı "Kaynakta yazılı" notuyla yazılır (ödeme olayı değildir).
// Oran ve "harcandı" metni yalnız spendLabel'dan gelir (kanıtlı Gerçekleşen); sayfa hesaplamaz.

/** Planlanan: yinelenen ya da okunamayan gözlemde "Bilinmiyor"; gözlem yoksa "Fiyat yok" (Money varsayılanı). */
export function PlannedValue({ planned, unknown }: { planned: MoneyValue; unknown: boolean }) {
  return unknown ? <Money value={null} label={BILINMIYOR} /> : <Money value={planned} />;
}

/** Gerçekleşen (actuals.recordedFor anlamı). */
export function ActualValue({ recorded, unknown }: { recorded: RecordedValue | null; unknown: boolean }) {
  if (unknown) return <Money value={null} label={BILINMIYOR} />;
  if (!recorded || recorded.kind === 'not_yet') return <Money value={null} label={RECORDED_NOT_YET_TEXT} />;
  if (!recorded.money) return <Money value={null} label={BILINMIYOR} />;
  if (recorded.evidence) return <Money value={recorded.money} />;
  return (
    <span className="aile-butce-deger">
      <Money value={recorded.money} />
      <span className="aile-kucuk aile-ikincil">{RECORDED_IN_SOURCE_TEXT}</span>
    </span>
  );
}

/** Durum etiketi; kanıtlı Gerçekleşende altında spendLabel metni ("%95 harcandı"). */
export function StatusValue({ row }: { row: Pick<BudgetRow, 'status' | 'spend'> }) {
  return (
    <span className="aile-butce-durum">
      <Tag tone={row.status.tone}>{row.status.label}</Tag>
      {row.spend.kind === 'spent' ? <span className="aile-kucuk aile-ikincil">{row.spend.text}</span> : null}
    </span>
  );
}
