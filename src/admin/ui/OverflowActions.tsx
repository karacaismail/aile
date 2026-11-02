import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useProfile } from '../device';
import { Button, type ButtonVariant } from './Button';
import type { IconName } from './icons';
import { MenuButton } from './Menu.lazy';
import { DANGER_GROUP_LABEL, MENU_POPUP_MIN_WIDTH, type MenuItem } from './Menu.shared';
import './OverflowActions.css';

// Tasarım: aile-tasarim/tasarim-sistemi/components/OverflowActions/README.md + index.d.ts OverflowActionsProps; referans
// davranış bundle.js OverflowActions. Birincil eylem dışındaki eylemleri toplayan metinli "Diğer" düğmesi (yalnız ⋯ değil).
// Menü Menu'nün menü düğmesi kalıbıdır (APG Menu Button, antd yok): telefonda alttan sayfa (aria-haspopup="dialog"),
// tablet ve masaüstünde düğmenin altında sağa hizalı açılır panel (aria-haspopup="menu"). Seçim: menü kapanır, odak
// düğmeye döner, sonra eylemin onClick'i çalışır (eylem odağı başka yere taşıyabilir).
// - primary: ana eylem her zaman dışarıda kalır, menüye taşınmaz (telefonda "Diğer"in önünde).
// - danger: tehlikeli eylem menüde ayırıcıdan sonra "Tehlikeli eylemler" grubunda; satırda danger düğmesi, ayrı grupta.
// - collapse="auto": geniş profilde yer varsa ikincil eylemler satırda düğmedir; telefonda ya da satır sığmadığında
//   (kapsayıcı genişliği ölçülür) "Diğer" menüsüne taşınır, kapsayıcı yeniden genişleyince geri çıkar.
// Teslim: "Diğer" düğmesi (Menu.lazy.tsx menü düğmesi) statiktir; açılır gövde (liste, açılır panel, telefonda alt sayfa)
// ilk niyette (basma, odak, tuş) tembel iner. Telefon ilk rotası (PageHeader → bu modül) gövdeyi ve BottomSheet'i
// çekmez; yüklenirken düğme aria-busy taşır, ilk tıklama kaybolmaz (gövde gelince menü açılır, odak ilk öğeye gider).
// Görsel kurallar OverflowActions.css, Menu.lazy.css ve Menu.css (yalnız --aile tokenları); odak çizgisini admin.css çizer.

export interface OverflowActionItem {
  /** Eylem etiketi, cümle düzeni ("Dışa aktar"). Kesilmez. */
  label: string;
  /** Etiketin önünde Phosphor simgesi (süsleyici). */
  icon?: IconName;
  onClick?(): void;
  /** Tehlikeli eylem (Sil): ayrı grupta, hata renginde. */
  danger?: boolean;
  /** Devre dışı: aria-disabled, seçilemez. */
  disabled?: boolean;
}

export interface OverflowActionsProps {
  items: readonly OverflowActionItem[];
  /** Düğme metni; varsayılan "Diğer". */
  label?: string;
  /** Menünün erişilebilir adı ve telefonda alt sayfanın başlığı; varsayılan "Diğer eylemler". */
  title?: string;
  /** Açık başlar (önizleme). */
  open?: boolean;
  /** Portal yerine yerinde çizim (önizleme ve yalıtık test). */
  inline?: boolean;
  /** Düğme görünümü; varsayılan secondary (referans). */
  variant?: Extract<ButtonVariant, 'secondary' | 'quiet'>;
  className?: string;
  /** Ana eylem (ör. <Button variant="primary">): her zaman görünür, menüye taşınmaz. */
  primary?: ReactNode;
  /** "menu" (varsayılan): eylemlerin hepsi "Diğer" menüsünde. "auto": geniş alanda satırda düğme, dar alanda menüde. */
  collapse?: 'menu' | 'auto';
}

export const DEFAULT_LABEL = 'Diğer';
export const DEFAULT_TITLE = 'Diğer eylemler';
/** Tasarım bundle.css .ai-pop: "min-width: 240px"; tek kaynak Menu'deki sabittir. */
export const OVERFLOW_MENU_MIN_WIDTH = MENU_POPUP_MIN_WIDTH;

const itemKey = (index: number) => `o${index}`;
const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

/**
 * Satır sığıyor mu? Satırdayken içerik kutudan taşarsa (scrollWidth > clientWidth) menüye geçer ve gereken genişliği
 * saklar; menüdeyken üst kapsayıcı o genişliği yeniden sağlayınca satıra döner. Gözlem ResizeObserver ile (kutu ve üst
 * kapsayıcı). Ölçüm olmayan ortamda (jsdom) satır kalır. İçerik değişince yeniden ölçülür.
 */
function useInlineFit(ref: RefObject<HTMLElement | null>, enabled: boolean, signature: string): boolean {
  const [fits, setFits] = useState(true);
  const memo = useRef<{ needed: number; slack: number } | null>(null);
  const lastSignature = useRef(signature);

  useLayoutEffect(() => {
    if (lastSignature.current === signature) return;
    lastSignature.current = signature;
    memo.current = null;
    setFits(true);
  }, [signature]);

  useLayoutEffect(() => {
    if (!enabled) return;
    const element = ref.current;
    if (!element) return;
    const parent = element.parentElement;
    const check = () => {
      if (fits) {
        if (element.scrollWidth > element.clientWidth + 1) {
          memo.current = { needed: element.scrollWidth, slack: parent ? Math.max(0, parent.clientWidth - element.clientWidth) : 0 };
          setFits(false);
        }
        return;
      }
      const saved = memo.current;
      if (parent && saved && parent.clientWidth - saved.slack >= saved.needed) setFits(true);
    };
    check();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => check());
    observer.observe(element);
    if (parent) observer.observe(parent);
    return () => observer.disconnect();
  }, [enabled, fits, signature, ref]);

  return fits;
}

export function OverflowActions({
  items, label = DEFAULT_LABEL, title = DEFAULT_TITLE, open: initiallyOpen = false, inline = false, variant = 'secondary',
  className, primary, collapse = 'menu',
}: OverflowActionsProps) {
  const phone = useProfile() === 'phone';
  const auto = collapse === 'auto';
  const rowRef = useRef<HTMLDivElement>(null);
  const signature = items.map(item => `${item.label}|${item.icon ?? ''}|${item.danger ? 1 : 0}|${item.disabled ? 1 : 0}`).join('\n');
  const fits = useInlineFit(rowRef, auto && !phone, signature);

  if (auto && !phone && fits) {
    const regular = items.filter(item => !item.danger);
    const danger = items.filter(item => item.danger);
    const button = (item: OverflowActionItem) => (
      <Button
        key={`${item.label}-${items.indexOf(item)}`}
        variant={item.danger ? 'danger' : 'secondary'}
        icon={item.icon}
        disabled={item.disabled}
        onClick={() => item.onClick?.()}
      >
        {item.label}
      </Button>
    );
    return (
      <div ref={rowRef} className={cx('aile-overflow', 'aile-overflow--satir', className)} data-collapse="auto" data-collapsed="false">
        {regular.map(button)}
        {danger.length > 0 && (
          <span role="group" aria-label={DANGER_GROUP_LABEL} className="aile-overflow-tehlike">{danger.map(button)}</span>
        )}
        {primary}
      </div>
    );
  }

  const menuItems: MenuItem[] = items.map((item, index) => ({
    key: itemKey(index), label: item.label, icon: item.icon, danger: item.danger, disabled: item.disabled,
  }));
  const menu = items.length > 0 && (
    <MenuButton
      trigger={label}
      triggerIcon="more"
      triggerVariant={variant}
      label={title}
      items={menuItems}
      onSelect={key => items[Number(key.slice(1))]?.onClick?.()}
      defaultOpen={initiallyOpen}
      inline={inline}
      align="end"
      popupClassName="aile-overflow-menu"
    />
  );

  if (auto) {
    return (
      <div ref={rowRef} className={cx('aile-overflow', 'aile-overflow--satir', className)} data-collapse="auto" data-collapsed="true">
        {primary}
        {menu}
      </div>
    );
  }
  return (
    <span className={cx('aile-overflow', className)}>
      {primary}
      {menu}
    </span>
  );
}
