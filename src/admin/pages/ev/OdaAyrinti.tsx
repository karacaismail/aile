import { useId, type RefObject } from 'react';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/icons';
import { BILINMIYOR, FIYAT_YOK, HENUZ_YOK } from '../../ui/Money';
import { Tabs } from '../../ui/Tabs';
import type { BagliListeCizici } from './bagliListeler';
import { FOTOGRAF_YOK, SEKMELER, sayi, type OdaOzeti, type Sekme } from './model';
import { Toplam } from './ortak';

// Oda ayrıntısı (tasarım README › Sayfa iskeleti 5): kimlik + fotoğraf → Plan | Gerçek (iki ayrı değer) → sayımlar ve
// eksik bilgi → bağlı kayıtlar (sekmeler) → kaynak. Telefonda ve tablette tam sayfa ("Listeye dön"), masaüstünde sağ
// panel ("Ayrıntıyı kapat"). Başlık programatik odak alır (tabIndex -1) ve klavye modunda tek alt çizgiyi taşır.
// Bağlı kayıt listesinin biçimini çağıran verir (telefon/panel akordeon, tablet tablo); liste "Oda bölümleri"
// sekmelerinin panelinde çizilir (role=tabpanel, seçili sekmeyle adlı).

export interface OdaAyrintiProps {
  oda: OdaOzeti;
  sekme: Sekme;
  onSekme(sekme: Sekme): void;
  baslikRef: RefObject<HTMLHeadingElement | null>;
  /** sayfa: listenin yerinde, "Listeye dön"; panel: masaüstü sağ bölme, "Ayrıntıyı kapat". */
  yerlesim: 'sayfa' | 'panel';
  onDon(): void;
  liste: BagliListeCizici;
  className?: string;
}

export function OdaAyrinti({ oda, sekme, onSekme, baslikRef, yerlesim, onDon, liste, className }: OdaAyrintiProps) {
  const baslikId = useId();
  const sinif = ['aile-ev-ayrinti', `aile-ev-ayrinti--${yerlesim}`, className].filter(Boolean).join(' ');
  const sayimlar = [
    sayi(oda.alimlar.length, 'alım'),
    `${sayi(oda.isler.length, 'iş')} (${oda.acikIs} açık)`,
    sayi(oda.esyalar.length, 'eşya'),
    sayi(oda.aydinlatma.length, 'armatür'),
  ].join(' · ');

  return (
    <section className={sinif} aria-labelledby={baslikId} data-ev-ayrinti={yerlesim}>
      <div className="aile-ev-ayrinti__ust">
        {yerlesim === 'sayfa' ? (
          <Button variant="quiet" icon="back" onClick={onDon}>Listeye dön</Button>
        ) : (
          <Button variant="quiet" icon="close" onClick={onDon}>Ayrıntıyı kapat</Button>
        )}
      </div>

      <div className="aile-ev-kimlik">
        <span className="aile-ev-foto" role="img" aria-label={FOTOGRAF_YOK}>
          <Icon name="imageOff" />
        </span>
        <div className="aile-ev-kimlik__metin">
          <h2 id={baslikId} ref={baslikRef} tabIndex={-1} data-focus-line="" className="aile-ev-ayrinti__baslik">{oda.label}</h2>
          <p className="aile-kucuk aile-ikincil aile-ev-satir-metni">{`${oda.code} · Aşama: ${oda.asama} · ${FOTOGRAF_YOK}`}</p>
        </div>
      </div>

      {/* Plan | Gerçek iki ayrı değer (README › Ayrıntı); asla tek sayıda birleşmez. */}
      <dl className="aile-ev-tutarlar" role="group" aria-label="Tutarlar">
        <div>
          <dt className="aile-kucuk aile-ikincil">Planlanan</dt>
          <dd><Toplam total={oda.planned} eksik={FIYAT_YOK} /></dd>
        </div>
        <div>
          <dt className="aile-kucuk aile-ikincil">Gerçekleşen</dt>
          <dd><Toplam total={oda.actual} eksik={HENUZ_YOK} /></dd>
        </div>
      </dl>

      <div className="aile-ev-ayrinti__ozet">
        <p className="aile-kucuk aile-ev-satir-metni">{sayimlar}</p>
        <p className="aile-kucuk aile-ikincil aile-ev-satir-metni">{`Eksik bilgi: ${oda.eksik}`}</p>
      </div>

      {/* Bağlı liste sekmelerin panelidir (APG Tabs): role=tabpanel seçili sekmeyle adlanır, sekme aria-controls ile bağlı. */}
      <Tabs label="Oda bölümleri" items={SEKMELER} activeKey={sekme} onChange={(key) => onSekme(key as Sekme)}>
        <div className="aile-ev-ayrinti__bolum">{liste(sekme, oda)}</div>
      </Tabs>

      <p className="aile-kucuk aile-ikincil aile-ev-satir-metni">{`Kaynak: ${oda.kaynak ?? BILINMIYOR}`}</p>
    </section>
  );
}
