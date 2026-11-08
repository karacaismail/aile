import { useId, type RefObject } from 'react';
import { BottomSheet } from '../../ui/BottomSheet';
import { sayi, type OdaOzeti } from './model';

// Telefonda oda seçimi alttan açılan sayfadır (tasarım: seçim listeleri telefonda alttan açılır). Her oda tek dokunuşla
// seçilen yerel bir <button>dur (44 px, kaba girişte 48 px hedef); erişilebilir ad yalnız oda adıdır (aria-labelledby),
// kod ve sayımlar açıklamadır (aria-describedby). Seçili oda aria-current + secili yüzey ve 600 ağırlıkla işaretlidir.
// Seçimden sonra odak ayrıntı başlığına gider (returnFocusTo); kapatma/Escape odağı "Oda seç" düğmesine döndürür.

export interface OdaSeciciProps {
  open: boolean;
  odalar: readonly OdaOzeti[];
  seciliId: string | null;
  onSec(id: string): void;
  onClose(): void;
  /** Seçimle kapanınca odağın gideceği öğe (ayrıntı başlığı); verilmezse BottomSheet açanı geri odaklar. */
  returnFocusTo?: RefObject<HTMLElement | null>;
}

export function OdaSecici({ open, odalar, seciliId, onSec, onClose, returnFocusTo }: OdaSeciciProps) {
  const id = useId();
  return (
    <BottomSheet title="Oda seç" open={open} onClose={onClose} returnFocusTo={returnFocusTo} className="aile-ev-secici-sayfa">
      <ul className="aile-ev-secici">
        {odalar.map((oda, index) => {
          const adId = `${id}-ad-${index}`;
          const metaId = `${id}-meta-${index}`;
          const secili = oda.id === seciliId;
          return (
            <li key={oda.id}>
              <button
                type="button"
                className="aile-ev-secici__secenek"
                data-focus-line=""
                aria-current={secili ? 'true' : undefined}
                aria-labelledby={adId}
                aria-describedby={metaId}
                onClick={() => onSec(oda.id)}
              >
                <span id={adId} className="aile-ev-secici__ad">{oda.label}</span>
                <span id={metaId} className="aile-ev-secici__meta aile-kucuk aile-ikincil">
                  {`${oda.code} · ${sayi(oda.alimlar.length, 'alım')} · ${oda.acikIs} açık iş`}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </BottomSheet>
  );
}
