import type { KeyboardEvent, ReactNode } from 'react';
import type { Tone } from '../shell/contracts';
import { Icon, type IconName } from './icons';
import './Tag.css';

// Tasarım: aile-tasarim/tasarim-sistemi/components/Tag/README.md + index.d.ts TagProps; referans davranış bundle.js Tag.
// Yerel HTML, antd yok (telefon profili antd istemez; tek uygulama tüm profillere hizmet eder). Üç biçim:
//  - durum etiketi: span, 14/500, 5 ton. Renk sözcüğün yerine geçmez; ton yalnız yüzeyi/metni boyar (data-tone). Boş
//    etiket rengiyle anlam taşıyamaz: "Bilinmiyor" yazılır ve ton nötre döner (README: eksik bilgi adıyla).
//  - seçilebilir (interactive): APG iki durumlu düğme, yerel <button aria-pressed>; Enter/Space ve dokunma tarayıcının
//    düğme etkinleştirmesidir (pointercancel tıklama üretmez). Basılı tutulan Enter bir kez değiştirir. 44 px, coarse
//    girişte 48 px; seçili = secili yüzey + 600 ağırlık.
//  - kaldırılabilir (removable): etkin filtre etiketi; kaldır düğmesi yerel <button>, "{metin} filtresini kaldır" diye
//    okunur. Görünürlük üst bileşenin kararıdır: onRemove çağrılır, etiket kendini gizlemez.
// Görsel kurallar Tag.css (yalnız --aile tokenları); odak çizgisini admin.css çizer ([data-focus-line]:focus-visible::after).

export interface TagProps {
  children: ReactNode;
  /** Varsayılan 'notr'. Yalnız durum etiketinin rengini değiştirir; anlamı sözcük taşır. */
  tone?: Tone;
  /** İki durumlu filtre düğmesi (aria-pressed). */
  interactive?: boolean;
  selected?: boolean;
  onClick?(): void;
  /** Etkin filtre etiketi: kaldır düğmesi taşır. */
  removable?: boolean;
  onRemove?(): void;
  /** Kaldır düğmesinin adı için metin; children düz metin değilse ver ("Oda: Mutfak"). */
  label?: string;
  disabled?: boolean;
  icon?: IconName;
  className?: string;
}

const KALDIR_VARSAYILAN = 'Filtreyi kaldır';
const BILINMIYOR = 'Bilinmiyor';

function plainText(children: ReactNode, label?: string): string | undefined {
  if (label !== undefined) return label;
  if (typeof children === 'string' || typeof children === 'number') return String(children).trim();
  return undefined;
}

function isEmpty(children: ReactNode): boolean {
  if (children === null || children === undefined || typeof children === 'boolean') return true;
  if (typeof children === 'string') return children.trim() === '';
  if (Array.isArray(children)) return children.every(isEmpty);
  return false;
}

/** Yerel düğmede basılı tutulan Enter tekrar tekrar tıklar; iki durumlu etiket ve kaldırma bir basışta bir kez çalışır. */
function blockRepeat(event: KeyboardEvent<HTMLButtonElement>) {
  if (event.key === 'Enter' && event.repeat) event.preventDefault();
}

export function Tag({ children, tone = 'notr', interactive, selected, onClick, removable, onRemove, label, disabled, icon, className }: TagProps) {
  const mode = removable || onRemove ? 'removable' : interactive || onClick ? 'btn' : 'durum';
  const empty = isEmpty(children);
  const content = empty ? BILINMIYOR : children;
  const effectiveTone: Tone = empty ? 'notr' : tone;
  const classes = ['aile-tag', `aile-tag--${mode}`, className].filter(Boolean).join(' ');
  const iconNode = icon ? <Icon name={icon} size={16} /> : null;

  if (mode === 'removable') {
    const text = label ?? (empty ? BILINMIYOR : plainText(children));
    const removeLabel = text ? `${text} filtresini kaldır` : KALDIR_VARSAYILAN;
    return (
      <span className={classes} data-tone={effectiveTone}>
        {iconNode}
        <span className="aile-tag-metin">{content}</span>
        <button
          type="button"
          className="aile-tag-kaldir"
          aria-label={removeLabel}
          aria-disabled={disabled || undefined}
          disabled={disabled}
          data-focus-line=""
          onClick={() => onRemove?.()}
          onKeyDown={blockRepeat}
        >
          <Icon name="close" />
        </button>
      </span>
    );
  }

  if (mode === 'btn') {
    return (
      <button
        type="button"
        className={classes}
        data-tone={effectiveTone}
        data-focus-line=""
        aria-pressed={!!selected}
        aria-disabled={disabled || undefined}
        disabled={disabled}
        onClick={() => onClick?.()}
        onKeyDown={blockRepeat}
      >
        {iconNode}
        {content}
      </button>
    );
  }

  return (
    <span className={classes} data-tone={effectiveTone}>
      {iconNode}
      {content}
    </span>
  );
}
