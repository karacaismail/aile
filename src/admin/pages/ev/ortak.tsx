import type { RefObject } from 'react';
import { MIXED_CURRENCY_TEXT, type MoneyTotal } from '../../data/actuals';
import { Money } from '../../ui/Money';
import { ODASIZ_ID, sayi, type EvModeli, type OdaOzeti, type Sekme } from './model';

// Ev sayfasının telefon ve geniş sunumlarının paylaştığı küçük parçalar (antd'siz, yalnız yerel HTML + ui/Money).
// Geniş modül bunları statik içe aktarabilir; tersi yasak (telefon *.wide'ı yalnız lazyWide ile görür).

/** Odak isteği: ayrıntı başlığı (tam sayfa ayrıntı açılınca), oda satırı (listeye dönünce) ya da yok (iki bölme). */
export type OdakHedefi = 'baslik' | 'satir' | 'yok';

/** Telefon ve geniş sunumun ortak sözleşmesi; durum (seçili oda, sekme) EvPage'de tutulur, profil değişince korunur. */
export interface EvSunumProps {
  model: EvModeli;
  secili: OdaOzeti | null;
  sekme: Sekme;
  onSekme(sekme: Sekme): void;
  onAc(id: string, odak: OdakHedefi): void;
  onKapat(odak: OdakHedefi): void;
  baslikRef: RefObject<HTMLHeadingElement | null>;
  /** Listeye dönüşte açık gelecek satır (son açılan oda); yoksa ilk satır açık. */
  sonAcilan: string | null;
}

/** Plan ya da gerçek toplamı; karışık birim "Birden çok para birimi", değer yoksa `eksik`. Asla ₺0,00 uydurmaz. */
export function Toplam({ total, eksik }: { total: MoneyTotal; eksik: string }) {
  if (total.currencies.length > 1) return <Money value={null} label={MIXED_CURRENCY_TEXT} />;
  return <Money value={total.money} label={eksik} />;
}

/** Oda adı; data-ev-oda listeye dönüşte odağın döneceği satırı bulmak içindir (satır başlığı düğmesi ya da tablo satırı). */
export function OdaAdi({ oda }: { oda: OdaOzeti }) {
  return <span data-ev-oda={oda.id}>{oda.label}</span>;
}

/** "7 satır · 6 oda ve odasız kayıtlar" (tasarım Count). */
export function OdaSayimi({ model }: { model: EvModeli }) {
  const odasiz = model.odalar.some((oda) => oda.id === ODASIZ_ID);
  return (
    <p className="aile-ev-sayim">
      <strong>{sayi(model.odalar.length, 'satır')}</strong>
      <span className="aile-ikincil">{` · ${sayi(model.odaSayisi, 'oda')}${odasiz ? ' ve odasız kayıtlar' : ''}`}</span>
    </p>
  );
}

/** data-ev-oda işaretli odanın etkileşimli satırına (akordeon başlığı, tablo satırı) odaklanır; bulduysa true. */
export function odaSatirinaOdaklan(kok: HTMLElement | null, id: string): boolean {
  const isaret = kok?.querySelector<HTMLElement>(`[data-ev-oda="${id}"]`);
  const hedef = isaret?.closest<HTMLElement>('button, tr, [role="row"]');
  if (!hedef) return false;
  hedef.focus();
  return document.activeElement === hedef;
}
