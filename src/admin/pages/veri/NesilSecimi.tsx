import { Button, Dialog } from '../../ui';
import { BILINMIYOR, sayi, zamanMetni } from './bicim';
import type { NesilAdayi } from './klasor';
import './NesilSecimi.css';

// Klasörde birden çok nesil varsa hangisinin içe aktarılacağını sordurur. Dialog telefonda kendiliğinden alttan
// açılır (BottomSheet), genişte ortadaki pencere. Seçenekler yerel <button> satırlarıdır (APG: eylem düğmeleri listesi);
// tek dokunuş seçer ve içe aktarır. En yeni yakalama üstte ve adıyla ("En yeni") işaretli. Okunamayan manifestler
// gizlenmez, adıyla yazılır. Odak çizgisini admin.css [data-focus-line] çizer; renk/boşluk yalnız --aile-* tokenları.

export interface NesilSecimiProps {
  open: boolean;
  adaylar: readonly NesilAdayi[];
  /** Okunamayan manifestler ("kok/bozuk: manifest.json JSON değil"). */
  atlanan?: readonly string[];
  onSec(aday: NesilAdayi): void;
  onVazgec(): void;
}

function ayrinti(aday: NesilAdayi): string {
  return [
    aday.etiket,
    `Yakalama ${aday.yakalama ? zamanMetni(aday.yakalama) : BILINMIYOR}`,
    `${sayi(aday.koleksiyon)} koleksiyon`,
    `${sayi(aday.kayit)} kayıt`,
    aday.sentetik ? 'Sentetik' : null,
  ].filter(Boolean).join(' · ');
}

export function NesilSecimi({ open, adaylar, atlanan = [], onSec, onVazgec }: NesilSecimiProps) {
  const enYeniBelli = Boolean(adaylar[0]?.yakalama);
  return (
    <Dialog title="Nesil seçin" open={open} onClose={onVazgec} footer={<Button variant="quiet" onClick={onVazgec}>Vazgeç</Button>}>
      <p className="aile-veri-secim-aciklama">
        {`Klasörde ${sayi(adaylar.length)} nesil bulundu. İçe aktarılacak nesli seçin; en yenisi üstte.`}
      </p>
      <ul className="aile-veri-secenekler" aria-label="Nesiller">
        {adaylar.map((aday, index) => (
          <li key={aday.etiket}>
            <button type="button" className="aile-veri-secenek" data-focus-line="" onClick={() => onSec(aday)}>
              <span className="aile-veri-secenek-baslik">
                {`Nesil ${aday.generationId.slice(0, 6)}${index === 0 && enYeniBelli ? ' · En yeni' : ''}`}
              </span>{' '}
              <span className="aile-veri-secenek-ayrinti aile-kucuk aile-ikincil">{ayrinti(aday)}</span>
            </button>
          </li>
        ))}
      </ul>
      {atlanan.length > 0 ? (
        <p className="aile-veri-secim-atlanan aile-kucuk aile-ikincil">{`Okunamayan nesil: ${atlanan.join('; ')}`}</p>
      ) : null}
    </Dialog>
  );
}
