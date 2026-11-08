import type { AriaAttributes, MouseEvent, Ref } from 'react';
import { useButtonActivation } from './Button.activation';
import { Icon, type IconName } from './icons';
import './Button.css';
import './IconButton.css';

// Tasarım: aile-tasarim/tasarim-sistemi/components/IconButton/README.md + index.d.ts IconButtonProps; referans davranış
// bundle.js IconButton (ai-btn + ai-iconbtn). Yalnız simgeli kare düğme, 44 × 44; görünür metni yok, `label` zorunlu ve
// aria-label olarak okunur. Yalnız evrensel eylemlerde (Kapat, Diğer eylemler, dar ekranda Dışa aktar); anlamı belirsizse
// metinli Button. Tooltip yok: hover dokunmatikte yoktur. Yerel <button> (antd yok); taban görünüm, odak alt çizgisi
// (data-focus-line) ve hover medyası Button.css .aile-dugme; kare ölçü IconButton.css (--aile-dokunma-hedefi: 44, kaba
// girişte 48).

/** Menü/çekmece açan ve açıklaması olan simge düğmeleri için izin verilen erişilebilirlik öznitelikleri. */
type AriaPassthrough = Pick<AriaAttributes, 'aria-describedby' | 'aria-controls' | 'aria-expanded' | 'aria-haspopup'>;

export interface IconButtonProps extends AriaPassthrough {
  icon: IconName;
  /** Ekran okuyucu adı, cümle düzeni: "Kapat", "Diğer eylemler". Zorunlu; boş ad geliştirmede hata verir. */
  label: string;
  /** quiet (varsayılan): dolgusuz, eylem rengi. secondary: yuzey dolgu + eylem kenar. */
  variant?: 'quiet' | 'secondary';
  /** Basılı/seçili durum: aria-pressed + secili yüzey. Verilmezse aria-pressed yazılmaz (iki durumlu düğme değildir). */
  selected?: boolean;
  disabled?: boolean;
  /** Devre dışıyken düğmenin ardında görünür yazılır ve aria-describedby ile bağlanır. */
  disabledReason?: string;
  /** İşlem sürüyor: aria-busy + aria-disabled, odak kalır, etkinleştirme yok sayılır (Button ile aynı). */
  loading?: boolean;
  /** nav zemini üzerinde: nav-metin rengi, acik-mavi kenar (secondary), odak çizgisi odak-nav. */
  onNav?: boolean;
  onClick?(event: MouseEvent<HTMLButtonElement>): void | Promise<unknown>;
  className?: string;
  /** Düğme öğesi; çekmece kapanınca odak dönüşü için (MobileNavDrawerProps.returnFocusTo). */
  ref?: Ref<HTMLButtonElement>;
}

export function IconButton({
  icon, label, variant = 'quiet', selected, disabled, disabledReason, loading, onNav, onClick, className, ref,
  'aria-describedby': describedBy, ...rest
}: IconButtonProps) {
  if (!label.trim()) {
    const message = 'IconButton: label (erişilebilir ad) zorunlu; yalnız simgeli düğme adsız kalamaz.';
    if (import.meta.env.DEV) throw new Error(message);
    console.error(message);
  }
  const { handleClick, stateProps, reason } = useButtonActivation({ loading, disabled, disabledReason, describedBy, onClick });
  const classes = ['aile-dugme', 'aile-iconbtn', `aile-iconbtn--${variant}`, onNav && 'aile-iconbtn--onnav', className]
    .filter(Boolean).join(' ');
  return (
    <>
      <button
        // Kalan öznitelikler önce: tetikleyici sarmalayıcılar (Dropdown/Popover) çocuğu klonlayıp işleyici ekler.
        {...rest}
        ref={ref}
        type="button"
        className={classes}
        disabled={disabled}
        onClick={handleClick}
        data-variant={variant}
        data-nav={onNav ? '' : undefined}
        // Merkezi odak sözleşmesi (admin.css [data-focus-line]); Button.css kapsam dışı portalda da aynı çizgiyi çizer.
        data-focus-line=""
        aria-label={label}
        aria-pressed={selected === undefined ? undefined : selected}
        {...stateProps}
      >
        <Icon name={icon} />
      </button>
      {reason && <span id={reason.id} className="aile-btn-neden">{reason.text}</span>}
    </>
  );
}
