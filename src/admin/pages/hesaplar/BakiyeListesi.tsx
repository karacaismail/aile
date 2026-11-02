import { BILINMIYOR, Money } from '../../ui/Money';
import type { DonemBakiyesi } from './model';

// Seçili dönemin bakiye tahmini: düz liste satırı (kart değil). Her satır ölçünün adı + "Tahmin" metni + tutar
// (₺8.500,00, tabular-nums, sağda). Eksik ölçü "Bilinmiyor". Toplam satırı yoktur: bakiyeler toplanmaz. Birden çok
// tahmin varsa her biri kendi başlığı (h3) ve kendi listesiyle ayrı durur; aynı dönemin tahminleri birleşmez.
// Yerel HTML + --aile tokenları (HesaplarPage.css); antd yok, telefon temel sunumudur.

export interface BakiyeListesiProps {
  /** "03.2027" */
  donem: string;
  /** İçinde bulunulan ay mı (Europe/Istanbul). */
  buAy: boolean;
  gruplar: readonly DonemBakiyesi[];
}

const TAHMIN = 'Tahmin';

export function bakiyeListesiAdi(donem: string, tahmin?: string): string {
  const ad = `${donem} dönemi bakiye tahmini`;
  return tahmin ? `${ad} · ${tahmin}` : ad;
}

export function BakiyeListesi({ donem, buAy, gruplar }: BakiyeListesiProps) {
  const cok = gruplar.length > 1;
  return (
    <div className="aile-hesaplar__bakiyeler">
      <p className="aile-hesaplar__donem">{[donem, buAy ? 'Bu ay' : null, 'tahmin'].filter(Boolean).join(' · ')}</p>
      {gruplar.map(grup => (
        <div key={grup.forecastId} className="aile-hesaplar__grup">
          {cok ? <h3 className="aile-hesaplar__grup-adi">{grup.tahmin}</h3> : null}
          <ul className="aile-hesaplar__liste" aria-label={bakiyeListesiAdi(donem, cok ? grup.tahmin : undefined)}>
            {grup.olculer.map(olcu => (
              <li key={olcu.key} className="aile-hesaplar__satir">
                <span className="aile-hesaplar__satir-ad">
                  <span className="aile-hesaplar__olcu">{olcu.ad}</span>
                  <span className="aile-kucuk aile-ikincil">{TAHMIN}</span>
                </span>
                <Money value={olcu.deger} label={BILINMIYOR} className="aile-hesaplar__tutar" />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
