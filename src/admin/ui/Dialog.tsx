import { useCallback, type ReactNode } from 'react';
import { useDevice } from '../device';
import { AntModal } from './antd';
import { BottomSheet } from './BottomSheet';
import { Icon } from './icons';
import './Dialog.css';

// Tasarım: aile-tasarim/tasarim-sistemi/components/Dialog/README.md + index.d.ts DialogProps; referans davranış
// bundle.js Dialog/useModal. Kısa bir karar ya da küçük form için ortadaki modal; uzun form Drawer'a gider.
// antd Modal: ortalı, en çok 560 px, kose-panel, golge-yukseltilmis, arkada ortu (Dialog.css, yalnız --aile tokenları).
// Başlık h2 ve diyaloğun erişilebilir adı. Kapat: antd'nin kendi kapatıcısı, Phosphor close + aria-label "Kapat", 44 px
// (tema controlHeight). Escape kapatır (antd keyboard); örtüye tıklama kapatmaz (referans scrim'de onClick yok).
// Odak açılışta diyaloğa girer, odak tuzağı antd'de, kapanınca açan öğeye döner (focusTriggerAfterClose).
// Telefonda (useDevice) aynı içerik kısa BottomSheet olarak alttan açılır; alert rolü orada taşınmaz (referansla aynı).

/** Tasarım README: "En çok 560 px". tokens.json'da karşılığı yok; tek kaynak bu sabittir. */
export const DIALOG_WIDTH = 560;

export interface DialogProps {
  /** h2 başlık; diyaloğun erişilebilir adı. */
  title: string;
  children?: ReactNode;
  /** Altlık (genelde FormFooter). Verilmezse altlık yok; antd'nin varsayılan OK/Cancel düğmeleri çizilmez. */
  footer?: ReactNode;
  /** Kapat düğmesi ve Escape; telefonda alt sayfanın kapatıcısı. */
  onClose?: () => void;
  /** Varsayılan açık (referans: open !== false). */
  open?: boolean;
  /** Geri alınamaz eylem onayı: role="alertdialog". */
  alert?: boolean;
  /** Portal yerine yerinde çizim (önizleme ve yalıtık test). */
  inline?: boolean;
}

export function Dialog({ title, children, footer, onClose, open = true, alert = false, inline = false }: DialogProps) {
  const device = useDevice();
  // rc-dialog panel kökünü sabit role="dialog" ile çizer ve rolü prop olarak açmaz. alertdialog için rol panel ref'inde
  // yazılır: ref öğe bağlanınca (ve alert değişince) çalışır; React değişmeyen prop'u yeniden yazmadığı için kalıcıdır.
  const panelRef = useCallback((panel: HTMLDivElement | null) => {
    panel?.setAttribute('role', alert ? 'alertdialog' : 'dialog');
  }, [alert]);

  if (device === 'phone') {
    return (
      <BottomSheet title={title} footer={footer} onClose={onClose} open={open} inline={inline}>
        {children}
      </BottomSheet>
    );
  }

  return (
    <AntModal
      open={open}
      centered
      width={DIALOG_WIDTH}
      title={<h2 className="aile-dialog-baslik">{title}</h2>}
      footer={footer ?? null}
      onCancel={onClose}
      keyboard
      mask={{ closable: false }}
      closable={{ closeIcon: <Icon name="close" />, 'aria-label': 'Kapat' }}
      destroyOnHidden
      getContainer={inline ? false : undefined}
      panelRef={panelRef}
      rootClassName={inline ? 'aile-dialog aile-dialog--inline' : 'aile-dialog'}
      className="aile-dialog-panel"
      classNames={{
        mask: 'aile-dialog-ortu', wrapper: 'aile-dialog-sarmal', container: 'aile-dialog-kutu',
        header: 'aile-dialog-ust', body: 'aile-dialog-govde', footer: 'aile-dialog-altlik', close: 'aile-dialog-kapat',
      }}
    >
      {children}
    </AntModal>
  );
}
