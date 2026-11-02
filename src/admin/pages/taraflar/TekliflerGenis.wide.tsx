import { useId } from 'react';
import { FIYAT_YOK, HENUZ_YOK, Money } from '../../ui/Money';
import { Tag } from '../../ui/Tag';
import { Iletisim } from './Iletisim';
import type { TeklifGrubu } from './model';
import { TARAF_BILINMIYOR, garantiMetni, grupBasligi, sureMetni } from './sunum';
import './taraflar.wide.css';

// Geniş (tablet/masaüstü) teklif karşılaştırması — tasarım bundle.js Aile.Pages.Taraflar › .pg-compare / .pg-offer:
// kayıt başına yan yana teklif yuvaları (alan izin verdikçe üç sütun). Yalnız geniş profilde lazyWide ile yüklenir;
// telefon bunu indirmez (TaraflarPage › Adaptive). Plan ve gerçek kayıt başlığında iki ayrı değer; teklifle birleşmez.

export interface TekliflerGenisProps {
  gruplar: readonly TeklifGrubu[];
}

function TeklifGrubuGenis({ grup }: { grup: TeklifGrubu }) {
  const id = useId();
  const baslikId = `${id}-baslik`;
  return (
    <section className="aile-taraflar-grup" aria-labelledby={baslikId}>
      <div className="aile-taraflar-grup__baslik">
        <h3 id={baslikId} className="aile-taraflar-grup__h3">{grupBasligi(grup)}</h3>
        {grup.durum === 'bagli' ? (
          <p className="aile-taraflar-grup__olcu aile-kucuk aile-ikincil">
            <span>Planlanan <Money value={grup.plan} label={FIYAT_YOK} /></span>
            <span aria-hidden="true"> · </span>
            <span>Gerçekleşen <Money value={grup.gercek} label={HENUZ_YOK} /></span>
          </p>
        ) : null}
      </div>
      <div className="aile-taraflar-karsilastirma">
        {grup.teklifler.map((teklif, index) => {
          const adId = `${id}-teklif-${index}`;
          const enDusuk = teklif.key === grup.enDusukKey;
          return (
            <div key={teklif.key} role="group" aria-labelledby={adId} className="aile-taraflar-yuva">
              <div className="aile-taraflar-yuva__baslik">
                <strong id={adId}>{teklif.tarafAdi ?? TARAF_BILINMIYOR}</strong>
                {enDusuk ? <Tag tone="olumlu">En düşük fiyat</Tag> : null}
              </div>
              <dl className="aile-taraflar-yuva__alanlar">
                <div>
                  <dt className="aile-kucuk aile-ikincil">Tutar</dt>
                  <dd><Money value={teklif.tutar} className="aile-taraflar-yuva__tutar" /></dd>
                </div>
                <div>
                  <dt className="aile-kucuk aile-ikincil">Süre</dt>
                  <dd>{sureMetni(teklif.sureGun)}</dd>
                </div>
                <div>
                  <dt className="aile-kucuk aile-ikincil">Garanti</dt>
                  <dd>{garantiMetni(teklif.garantiAy)}</dd>
                </div>
                <div>
                  <dt className="aile-kucuk aile-ikincil">İletişim</dt>
                  <dd><Iletisim ad={teklif.tarafAdi} telefon={teklif.telefon} iletisim={teklif.iletisim} /></dd>
                </div>
              </dl>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default function TekliflerGenis({ gruplar }: TekliflerGenisProps) {
  return (
    <div className="aile-taraflar-gruplar">
      {gruplar.map((grup) => <TeklifGrubuGenis key={grup.key} grup={grup} />)}
    </div>
  );
}
