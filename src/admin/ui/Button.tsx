import type { AriaAttributes, MouseEvent, ReactNode, Ref } from 'react';
import { AntButton } from './antd';
import { Icon, type IconName } from './icons';
import './Button.css';

// Tasarım: components/Button/README.md + index.d.ts ButtonProps; davranış bundle.js Button (type="button",
// aria-pressed yalnız selected verilince, simge → metin → simge sırası). antd Button üzerine; renkler Button.css'te tokenla.

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger';

/** Menü/çekmece açan ve açıklaması olan düğmeler için izin verilen erişilebilirlik öznitelikleri. */
type AriaPassthrough = Pick<
  AriaAttributes,
  'aria-label' | 'aria-labelledby' | 'aria-describedby' | 'aria-controls' | 'aria-expanded' | 'aria-haspopup' | 'aria-current'
>;

export interface ButtonProps extends AriaPassthrough {
  /** Etiket; fiille ne olacağını söyler ("Alım ekle"). Kesilmez; dar ekranda `block` kullan. */
  children: ReactNode;
  /** Bir bölgede en çok bir `primary`. Varsayılan `secondary`. */
  variant?: ButtonVariant;
  /** Metnin önünde Phosphor simgesi (20 px, süsleyici). */
  icon?: IconName;
  /** Metnin ardında Phosphor simgesi (ör. chevronDown). */
  iconEnd?: IconName;
  /** Aç/kapa düğmesi: verilirse `aria-pressed` + secili yüzey, 600 ağırlık. Seçim odaktan ayrıdır. */
  selected?: boolean;
  /** Devre dışı düğmenin nedeni yakınında yazılı olmalı (`aria-describedby`). */
  disabled?: boolean;
  /** Tam genişlik. */
  block?: boolean;
  /** Lacivert nav üzerinde: nav-metin renk, acik-mavi kenar, odak çizgisi odak-nav. */
  onNav?: boolean;
  /** Varsayılan "button"; form altlığında "submit". */
  type?: 'button' | 'submit' | 'reset';
  onClick?(event: MouseEvent<HTMLButtonElement>): void;
  id?: string;
  className?: string;
  /** Odak dönüşü için (ör. çekmece kapanınca "Sayfalar" düğmesine). */
  ref?: Ref<HTMLButtonElement>;
}

/** Tasarım varyantı → antd 6 color/variant. Renk değerleri antd'den değil Button.css'ten (--ant-btn-* ← --aile-*). */
const ANT_VARIANT: Record<ButtonVariant, { color: 'primary' | 'danger'; variant: 'solid' | 'outlined' | 'text' }> = {
  primary: { color: 'primary', variant: 'solid' },
  secondary: { color: 'primary', variant: 'outlined' },
  quiet: { color: 'primary', variant: 'text' },
  danger: { color: 'danger', variant: 'outlined' },
};

export function Button({
  children, variant = 'secondary', icon, iconEnd, selected, disabled, block, onNav, type = 'button', onClick, id, className, ref, ...aria
}: ButtonProps) {
  const classes = [
    'aile-btn', `aile-btn--${variant}`,
    selected && 'aile-btn--secili', onNav && 'aile-btn--nav', block && 'aile-btn--blok', className,
  ].filter(Boolean).join(' ');
  return (
    <AntButton
      // href verilmez; öğe her zaman <button>, ref türü daraltılır.
      ref={ref as Ref<HTMLAnchorElement | HTMLButtonElement> | undefined}
      id={id}
      htmlType={type}
      color={ANT_VARIANT[variant].color}
      variant={ANT_VARIANT[variant].variant}
      block={block}
      disabled={disabled}
      onClick={onClick}
      className={classes}
      data-variant={variant}
      aria-pressed={selected === undefined ? undefined : selected}
      {...aria}
    >
      {icon && <Icon name={icon} />}
      <span className="aile-btn-metin">{children}</span>
      {iconEnd && <Icon name={iconEnd} />}
    </AntButton>
  );
}
