import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import type { Tone } from '../shell/contracts';
import { AntTag, ConfigProvider } from './antd';
import { Icon, type IconName } from './icons';
import './Tag.css';

// Tasarım: aile-tasarim/tasarim-sistemi/components/Tag/README.md + index.d.ts TagProps; referans davranış bundle.js Tag.
// Üç biçim, tek antd Tag temeli:
//  - durum etiketi: span, 14/500, 5 ton. Renk sözcüğün yerine geçmez; ton yalnız yüzeyi/metni boyar (data-tone).
//  - seçilebilir (interactive): iki durumlu düğme, aria-pressed = selected; Enter/Space ile çalışır; 44 px yüksek;
//    seçili = secili yüzey + 600 ağırlık. antd Wave (tıklama halkası) kapalı: tek 240 ms hareket kuralı ve halka yasağı.
//  - kaldırılabilir (removable): etkin filtre etiketi; 44 px; kaldır düğmesi "{metin} filtresini kaldır" diye okunur.
//    Görünürlük üst bileşenin kararıdır: onRemove çağrılır, etiket kendini gizlemez (preventDefault).
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

function plainText(children: ReactNode, label?: string): string | undefined {
  if (label !== undefined) return label;
  if (typeof children === 'string' || typeof children === 'number') return String(children).trim();
  return undefined;
}

export function Tag({ children, tone = 'notr', interactive, selected, onClick, removable, onRemove, label, disabled, icon, className }: TagProps) {
  const mode = removable || onRemove ? 'removable' : interactive || onClick ? 'btn' : 'durum';
  const classes = ['aile-tag', `aile-tag--${mode}`, className].filter(Boolean).join(' ');
  const iconNode = icon ? <Icon name={icon} size={16} /> : undefined;

  if (mode === 'removable') {
    const text = plainText(children, label);
    const removeLabel = text ? `${text} filtresini kaldır` : KALDIR_VARSAYILAN;
    const handleClose = (event: MouseEvent<HTMLElement>) => {
      // antd aksi hâlde etiketi kendi içinde gizler; liste üst bileşenin durumudur.
      event.preventDefault();
      onRemove?.();
    };
    return (
      <AntTag
        className={classes}
        data-tone={tone}
        variant="filled"
        icon={iconNode}
        disabled={disabled}
        closable
        // antd bu öğeye role="button", tabIndex, onClick/onKeyDown (Enter/Space) ve aria-disabled ekler; bizim
        // aria-label'ımız antd'nin "Close" varsayılanını ezer. Icon bileşeni yabancı prop almaz; bu yüzden span.
        closeIcon={
          <span className="aile-tag-kaldir" aria-label={removeLabel} data-focus-line="">
            <Icon name="close" />
          </span>
        }
        onClose={handleClose}
      >
        {children}
      </AntTag>
    );
  }

  if (mode === 'btn') {
    const handleKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      if (!event.repeat) onClick?.();
    };
    return (
      <ConfigProvider wave={{ disabled: true }}>
        <AntTag
          className={classes}
          data-tone={tone}
          data-focus-line=""
          variant="filled"
          icon={iconNode}
          role="button"
          tabIndex={disabled ? -1 : 0}
          aria-pressed={!!selected}
          aria-disabled={disabled || undefined}
          disabled={disabled}
          onClick={disabled ? undefined : () => onClick?.()}
          onKeyDown={disabled ? undefined : handleKeyDown}
        >
          {children}
        </AntTag>
      </ConfigProvider>
    );
  }

  return (
    <AntTag className={classes} data-tone={tone} variant="filled" icon={iconNode}>
      {children}
    </AntTag>
  );
}
