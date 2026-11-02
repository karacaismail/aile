import { RECORDED_IN_SOURCE_TEXT } from '../../data';
import { Money } from '../../ui/Money';
import { BILINMIYOR } from '../../ui/Money';
import { ODEME_KAYDI_YOK, type OdemeRow } from './model';

// Tutar hücreleri (telefon akordeonu ve geniş tablo ortak): tutar ui/Money ile (.aile-tutar: ₺8.500,00, tabular-nums).
// Plan ve gerçek ayrı öğelerdir, tek sayıda birleşmez. Tahmin olayının ödeme kaydı yoktur: gerçekleşen "Ödeme kaydı yok";
// olayda ölçülmüş gerçek tutar varsa ödeme kanıtı olmadan "Kaynakta yazılı" ile gösterilir (data/actuals.ts sözleşmesi).

/** Planlanan tutar; okunamayan ya da eksik tutar "Bilinmiyor". */
export function PlanTutari({ row }: { row: OdemeRow }) {
  return <Money value={row.planned} label={BILINMIYOR} />;
}

/** Gerçekleşen: "Ödeme kaydı yok" ya da "₺16.000,00 · Kaynakta yazılı". */
export function GerceklesenTutar({ row }: { row: OdemeRow }) {
  if (!row.actual) return <>{ODEME_KAYDI_YOK}</>;
  return (
    <>
      <Money value={row.actual} label={BILINMIYOR} />
      {` · ${RECORDED_IN_SOURCE_TEXT}`}
    </>
  );
}
