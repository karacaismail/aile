import { AntButton } from './antd';
import { Icon } from './icons';
import './ErrorState.css';

// Tasarım: components/ErrorState/README.md + bundle.js ErrorState. Veri okunamadığında nedeni ve tek çözüm
// yolunu gösterir. Eski tutar gösterilmez (eski veri için DataStatus "eski" kullanılır). Hata metni "Hata:" ile
// başlar (README › Dil); simge süsleyicidir, anlamı başlık taşır (renk tek işaret değil). Ham antd yalnız ui/ içinde;
// Button sarmalayıcısı yerine AntButton: bu bileşen başka sarmalayıcıya bağımlı olmadan tek başına çalışır.
export interface ErrorStateProps {
  /** Başlık; "Hata:" öneki yoksa eklenir. Varsayılan "Veri okunamadı". */
  title?: string;
  /** Neden, bir cümle. */
  message?: string;
  /** Zaman, kod gibi ek bilgi (14 px, ikincil). */
  detail?: string;
  /** Verilirse "Yeniden dene" birincil düğmesi görünür; verilmezse çözüm yolu yoktur, düğme çizilmez. */
  onRetry?: () => void;
}

const VARSAYILAN_BASLIK = 'Veri okunamadı';
const VARSAYILAN_ILETI = 'E-tabloya ulaşılamadı. Tutarlar, yanıltmaması için gösterilmiyor.';
const ONEK = /^hata:/i;

export function hataBasligi(title: string): string {
  const metin = title.trim();
  return ONEK.test(metin) ? metin : `Hata: ${metin}`;
}

export function ErrorState({ title = VARSAYILAN_BASLIK, message = VARSAYILAN_ILETI, detail, onRetry }: ErrorStateProps) {
  return (
    <div role="alert" className="aile-error-state">
      <div className="aile-error-state__head">
        <Icon name="alert" className="aile-error-state__icon" />
        <h2 className="aile-error-state__title">{hataBasligi(title)}</h2>
      </div>
      <p className="aile-error-state__message">{message}</p>
      {detail ? <p className="aile-kucuk aile-ikincil aile-error-state__detail">{detail}</p> : null}
      {onRetry ? (
        <AntButton type="primary" icon={<Icon name="refresh" />} onClick={onRetry}>
          Yeniden dene
        </AntButton>
      ) : null}
    </div>
  );
}
