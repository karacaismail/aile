import { useCallback, useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { AntDrawer } from './antd';
import { Button } from './Button';
import './BottomSheet.css';

// Tasarım: aile-tasarim/tasarim-sistemi/components/BottomSheet/README.md + index.d.ts BottomSheetProps; referans davranış
// bundle.js BottomSheet/useModal. Telefonda alttan açılan katman: seçim listesi (Select), Diğer eylemler (OverflowActions),
// kısa form (Dialog). Bu bileşenler telefonda bunu kendileri kullanır; sayfa kodu ayrıca çağırmaz.
// antd Drawer placement="bottom", yükseklik içeriğe göre (size "auto"); full → "100%". Tutamaç süsleyicidir (aria-hidden).
// Başlık h2 ve diyaloğun erişilebilir adı. Kapat: metinli, her zaman görünür (Button quiet + close); antd'nin X'i kapalı.
// Escape (keyboard) ve örtü tıklaması (referans scrim onClick) kapatır. Odak tuzağı antd'de (focusable.trap).
// Odak girişi ve dönüşü burada, referans useModal gibi (Drawer.tsx ile aynı yol): antd'nin autoFocus'u portal kabı belgeye
// eklenmeden önce çalışıp boşa düşebilir, dönüşü ise kapanış hareketinin sonunu bekler ve hareket bitmeden kapatılınca
// (destroyOnHidden) hiç çalışmaz. Bu yüzden açılınca odak bir sonraki karede role="dialog" paneline girer; open false olduğu
// anda returnFocusTo'ya ya da açıldığı anda odaklı olan öğeye döner.
// Görsel kurallar BottomSheet.css (yalnız --aile tokenları): en çok 85dvh, gövde kendi içinde kayar,
// safe-area-inset-bottom; odak çizgisini admin.css çizer (.ant-drawer kapsamı).
export interface BottomSheetProps {
  /** h2 başlık; diyaloğun erişilebilir adı. */
  title: string;
  children?: ReactNode;
  /** Genelde FormFooter ya da tek düğme. */
  footer?: ReactNode;
  /** Kapat düğmesi, Escape ve örtü. */
  onClose?: () => void;
  /** Varsayılan açık (referans: open !== false). */
  open?: boolean;
  /** Tam ekran (uzun form); köşe ve %85 sınırı kalkar. */
  full?: boolean;
  /** Portal yerine yerinde çizim (önizleme ve yalıtık test). */
  inline?: boolean;
  /** Kapanınca odağın döneceği öğe; verilmezse açıldığı anda odaklı olan öğeye döner. */
  returnFocusTo?: RefObject<HTMLElement | null>;
  className?: string;
}

const CLOSE_LABEL = 'Kapat';

const nextFrame = (callback: () => void): (() => void) => {
  if (typeof window.requestAnimationFrame === 'function') {
    const frame = window.requestAnimationFrame(callback);
    return () => window.cancelAnimationFrame(frame);
  }
  const timer = window.setTimeout(callback, 0);
  return () => window.clearTimeout(timer);
};

export function BottomSheet({ title, children, footer, onClose, open = true, full, inline, returnFocusTo, className }: BottomSheetProps) {
  const rootClass = ['aile-sheet', full && 'aile-sheet--full', className].filter(Boolean).join(' ');
  const close = () => onClose?.();

  // role="dialog" paneli (antd panelRef). Odaklanabilmesi için tabIndex -1 burada yazılır; React bu özniteliği yönetmez.
  const panel = useRef<HTMLDivElement | null>(null);
  const panelRef = useCallback((element: HTMLDivElement | null) => {
    panel.current = element;
    if (element) element.tabIndex = -1;
  }, []);

  // Açan öğe: açılırken, antd'nin autoFocus'u (passive effect) odağı taşımadan önce, layout aşamasında saklanır.
  const opener = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }, [open]);

  // Odak girişi ve dönüşü tek passive effect'te:
  // Giriş: panel portal kabıyla birlikte belgeye eklendikten sonra, bir sonraki karede. İçerik bu arada kendi odağını
  // almışsa (ör. Select'in arama alanı) panel onu çalmaz.
  // Dönüş (temizlik): open false olunca ya da açıkken sökülünce odak returnFocusTo'ya, yoksa açan öğeye döner. Odak bu
  // arada sayfa dışına taşındıysa dokunulmaz; açan öğe "dışarı" sayılmaz (odak içeri girmeden Escape ile kapatılabilir).
  // Dönüş layout temizliğinde değil passive temizlikte yapılır: React commit sonunda, commit öncesi odaklı öğe hâlâ
  // belgedeyse odağı ona geri verir (restoreSelection) ve layout aşamasındaki taşımayı ezer; passive aşama bunun ardındadır.
  // Çocuk (antd) passive temizlikleri önce çalışır, odak tuzağı kalkmış olur ve dönüşle çekişmez.
  const returnTarget = useRef(returnFocusTo);
  returnTarget.current = returnFocusTo;
  useEffect(() => {
    if (!open) return;
    const cancelFocusIn = nextFrame(() => {
      const current = panel.current;
      if (current && !current.contains(document.activeElement)) current.focus({ preventScroll: true });
    });
    return () => {
      cancelFocusIn();
      const active = document.activeElement;
      const current = panel.current;
      const outside = active && active !== document.body && active !== document.documentElement && active !== opener.current
        && !(current && (active.contains(current) || current.contains(active)));
      if (outside) return;
      const target = returnTarget.current?.current ?? opener.current;
      if (target?.isConnected) target.focus({ preventScroll: true });
    };
  }, [open]);

  return (
    <AntDrawer
      open={open}
      onClose={close}
      placement="bottom"
      size={full ? '100%' : 'auto'}
      destroyOnHidden
      getContainer={inline ? false : undefined}
      panelRef={panelRef}
      // Dönüş burada yapılır; antd'nin hareket sonundaki dönüşü returnFocusTo'yu ezmesin.
      focusable={{ focusTriggerAfterClose: false }}
      closable={false}
      title={
        <>
          <span className="aile-sheet-tutamac" aria-hidden="true" />
          <h2 className="aile-sheet-baslik">{title}</h2>
        </>
      }
      extra={
        <Button variant="quiet" icon="close" onClick={close} className="aile-sheet-kapat">
          {CLOSE_LABEL}
        </Button>
      }
      footer={footer}
      rootClassName={rootClass}
      classNames={{
        mask: 'aile-sheet-ortu', wrapper: 'aile-sheet-sarmal', section: 'aile-sheet-yuzey',
        header: 'aile-sheet-ust', body: 'aile-sheet-govde', footer: 'aile-sheet-altlik',
      }}
    >
      {children}
    </AntDrawer>
  );
}
