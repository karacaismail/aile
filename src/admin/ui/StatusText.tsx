import type { StatusLabel, Tone } from '../shell/contracts';
import './StatusText.css';

// Durum metni: süsleyici nokta (aria-hidden) + durum sözcüğü. Tasarım README › İçerik ilkeleri: durum her zaman
// sözcükle yazılır, renk yalnız destekler; eksik bilgi saklanmaz, adıyla ("Bilinmiyor") yazılır. Tag'in pil
// biçimli kardeşidir: satır, tablo hücresi ve ayrıntı panelinde akan metin içinde durur. Canlı bölge değildir
// (role yok): bir listede onlarca durum vardır, bir form altlığı duyurusu için FormFooter kullanılır.
// antd Badge kullanılmadı: noktası aria-hidden alamaz, "processing" noktası 1,2 s sonsuz dalga animasyonu taşır
// (tek 240 ms süre kuralına aykırı) ve nötr noktası tema dışı bir renk alır. Renkler StatusText.css'te --aile-* ile.

export interface StatusTextProps extends Pick<StatusLabel, 'label'> {
  /** Varsayılan 'notr'. Yalnız rengi değiştirir; anlamı sözcük taşır. */
  tone?: Tone;
  className?: string;
  id?: string;
}

/** Boş durum sözcüğü gizlenmez; "Bilinmiyor" yazılır (README: eksik bilgi adıyla). */
export const BILINMIYOR = 'Bilinmiyor';

export function StatusText({ label, tone = 'notr', className, id }: StatusTextProps) {
  const word = label.trim();
  const known = word.length > 0;
  const effectiveTone: Tone = known ? tone : 'notr';
  const classes = ['aile-status', `aile-status--${effectiveTone}`, className].filter(Boolean).join(' ');
  return (
    <span id={id} className={classes} data-tone={effectiveTone}>
      <span className="aile-status-nokta" aria-hidden="true" />
      <span className="aile-status-sozcuk">{known ? word : BILINMIYOR}</span>
    </span>
  );
}
