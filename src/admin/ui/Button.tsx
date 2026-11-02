import type { AriaAttributes, MouseEvent, ReactNode, Ref } from 'react';
import { useButtonActivation } from './Button.activation';
import { Icon, type IconName } from './icons';
import './Button.css';

// Tasarım: components/Button/README.md + index.d.ts ButtonProps; davranış bundle.js Button (type="button",
// aria-pressed yalnız selected verilince, simge → metin → simge sırası). Yerel <button>: telefon sunumu antd istemez,
// aynı uygulama tablet ve masaüstüne de hizmet eder (geniş dosya yok). Görünüm Button.css (.aile-dugme + .aile-btn),
// yalnız --aile-* tokenları; odak alt çizgisi (data-focus-line), dokunma hedefi (--aile-dokunma-hedefi: 44, kaba girişte
// 48) ve hover medyası orada.

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
  /** Devre dışı düğmenin nedeni yakınında yazılı olmalı: `disabledReason` ya da kendi metnine `aria-describedby`. */
  disabled?: boolean;
  /** Devre dışıyken düğmenin hemen ardında görünür yazılır ve `aria-describedby` ile bağlanır. Etkinken yazılmaz. */
  disabledReason?: string;
  /**
   * İşlem sürüyor: `aria-busy` + `aria-disabled`, etiket ve erişilebilir ad korunur, odak düğmede kalır, etkinleştirme
   * (tıklama, Enter/Space, form gönderimi) yok sayılır. onClick bir söz döndürürse düğme o söz bitene kadar kendiliğinden
   * meşguldür.
   */
  loading?: boolean;
  /** Tam genişlik. */
  block?: boolean;
  /** Lacivert nav üzerinde: nav-metin renk, acik-mavi kenar, odak çizgisi odak-nav. */
  onNav?: boolean;
  /** Varsayılan "button"; form altlığında "submit". */
  type?: 'button' | 'submit' | 'reset';
  onClick?(event: MouseEvent<HTMLButtonElement>): void | Promise<unknown>;
  id?: string;
  className?: string;
  /** Odak dönüşü için (ör. çekmece kapanınca "Sayfalar" düğmesine). */
  ref?: Ref<HTMLButtonElement>;
}

export function Button({
  children, variant = 'secondary', icon, iconEnd, selected, disabled, disabledReason, loading, block, onNav, type = 'button',
  onClick, id, className, ref, 'aria-describedby': describedBy, ...rest
}: ButtonProps) {
  const { handleClick, stateProps, reason } = useButtonActivation({ loading, disabled, disabledReason, describedBy, onClick });
  const classes = [
    'aile-dugme', 'aile-btn', `aile-btn--${variant}`,
    selected && 'aile-btn--secili', onNav && 'aile-btn--nav', block && 'aile-btn--blok', className,
  ].filter(Boolean).join(' ');
  return (
    <>
      <button
        // Kalan öznitelikler önce: Dropdown/Popover gibi tetikleyiciler çocuğu klonlayıp olay işleyicisi ve aria ekler.
        {...rest}
        ref={ref}
        id={id}
        type={type}
        className={classes}
        disabled={disabled}
        onClick={handleClick}
        data-variant={variant}
        data-nav={onNav ? '' : undefined}
        // Merkezi odak sözleşmesi (admin.css [data-focus-line]); Button.css kapsam dışı portalda da aynı çizgiyi çizer.
        data-focus-line=""
        aria-pressed={selected === undefined ? undefined : selected}
        {...stateProps}
      >
        {icon && <Icon name={icon} />}
        <span className="aile-btn-metin">{children}</span>
        {iconEnd && <Icon name={iconEnd} />}
      </button>
      {reason && <span id={reason.id} className="aile-btn-neden">{reason.text}</span>}
    </>
  );
}
