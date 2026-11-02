import type { Ref } from 'react';
import { AntButton } from './antd';
import { Icon, type IconName } from './icons';
import './IconButton.css';

// Tasarım: aile-tasarim/tasarim-sistemi/components/IconButton/README.md + index.d.ts IconButtonProps; referans davranış
// bundle.js IconButton. Yalnız simgeli kare düğme, 44 × 44; görünür metni yok, `label` zorunlu ve aria-label olarak
// okunur. Yalnız evrensel eylemlerde (Kapat, Diğer eylemler, dar ekranda Dışa aktar); anlamı belirsizse metinli Button.
// Tooltip yok: hover dokunmatikte yoktur. Görsel kurallar IconButton.css (yalnız --aile tokenları); odak çizgisini
// admin.css çizer (.ant-btn:focus-visible::after), nav üzerinde rengi IconButton.css acik-mavi yapar.
export interface IconButtonProps {
  icon: IconName;
  /** Ekran okuyucu adı, cümle düzeni: "Kapat", "Diğer eylemler". */
  label: string;
  /** quiet (varsayılan): dolgusuz, eylem rengi. secondary: yuzey dolgu + eylem kenar. */
  variant?: 'quiet' | 'secondary';
  /** Basılı/seçili durum: aria-pressed + secili yüzey. Verilmezse aria-pressed yazılmaz (iki durumlu düğme değildir). */
  selected?: boolean;
  disabled?: boolean;
  /** nav zemini üzerinde: nav-metin rengi, acik-mavi kenar (secondary), odak çizgisi odak-nav. */
  onNav?: boolean;
  onClick?: () => void;
  className?: string;
  /** Düğme öğesi; çekmece kapanınca odak dönüşü için (MobileNavDrawerProps.returnFocusTo). */
  ref?: Ref<HTMLButtonElement>;
}

export function IconButton({ icon, label, variant = 'quiet', selected, disabled, onNav, onClick, className, ref }: IconButtonProps) {
  const classes = ['aile-iconbtn', `aile-iconbtn--${variant}`, onNav && 'aile-iconbtn--onnav', className].filter(Boolean).join(' ');
  return (
    <AntButton
      // antd düğme/bağlantı ref birliği; href verilmediği için öğe her zaman <button>.
      ref={ref as Ref<HTMLButtonElement | HTMLAnchorElement>}
      htmlType="button"
      variant={variant === 'secondary' ? 'outlined' : 'text'}
      color="primary"
      icon={<Icon name={icon} />}
      aria-label={label}
      aria-pressed={selected === undefined ? undefined : selected}
      disabled={disabled}
      onClick={onClick}
      className={classes}
    />
  );
}
