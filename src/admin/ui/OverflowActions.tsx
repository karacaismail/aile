import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { useDevice } from '../device';
import { Dropdown, type AntMenuProps } from './antd';
import { BottomSheet } from './BottomSheet';
import { Button, type ButtonVariant } from './Button';
import { Icon, type IconName } from './icons';
import './OverflowActions.css';

// Tasarım: aile-tasarim/tasarim-sistemi/components/OverflowActions/README.md + index.d.ts OverflowActionsProps; referans
// davranış bundle.js OverflowActions. Birincil eylem dışındaki eylemleri toplayan metinli "Diğer" düğmesi (yalnız ⋯ değil).
// Masaüstü ve tablette antd Dropdown: role="menu", öğeler role="menuitem"; açılınca odak menüye girer (autoFocus),
// oklar/Home/End rc-menu'de sarmalı dolaşır, Enter seçer, Escape kapatır ve odağı düğmeye döndürür (rc-dropdown).
// Telefonda (useDevice) aynı eylemler BottomSheet içinde bir liste olarak alttan açılır; Escape ve "Kapat" alt sayfada.
// Seçim: menü kapanır, odak düğmeye döner, sonra eylemin onClick'i çalışır (eylem odağı başka yere taşıyabilir).
// Görsel kurallar OverflowActions.css (yalnız --aile tokenları); panel köşe/gölge/boşluk antd temasından (kose-kart,
// golge-yukseltilmis, bosluk-1). Odak çizgisini admin.css çizer ([role=menuitem] ::after); burada outline/halka yok.

export interface OverflowActionItem {
  /** Eylem etiketi, cümle düzeni ("Dışa aktar"). Kesilmez. */
  label: string;
  /** Etiketin önünde Phosphor simgesi (süsleyici). */
  icon?: IconName;
  onClick?(): void;
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
}

export const DEFAULT_LABEL = 'Diğer';
export const DEFAULT_TITLE = 'Diğer eylemler';
/** Tasarım bundle.css .ai-pop: "min-width: 240px". tokens.json'da karşılığı yok; tek kaynak bu sabittir. */
export const OVERFLOW_MENU_MIN_WIDTH = 240;

const itemKey = (index: number) => `o${index}`;

export function OverflowActions({
  items, label = DEFAULT_LABEL, title = DEFAULT_TITLE, open: initiallyOpen = false, inline = false, variant = 'secondary', className,
}: OverflowActionsProps) {
  const device = useDevice();
  const menuId = `aile-overflow${useId()}`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(initiallyOpen);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  };
  const pick = (item: OverflowActionItem) => {
    close();
    item.onClick?.();
  };
  // Escape: rc-trigger (portal) menüyü kapatır ama odağı döndürmez; rc-dropdown'ın dönüşü keyCode'a ve dinleyici sırasına
  // bağlıdır. Portal olayları React ağacından buraya kabarır; kapanış ve odak dönüşü tek yerde, `key` ile, kesin olur.
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape' && open) close();
  };

  const rootClass = ['aile-overflow', className].filter(Boolean).join(' ');

  if (device === 'phone') {
    return (
      <span className={rootClass}>
        <Button
          ref={triggerRef}
          variant={variant}
          icon="more"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(current => !current)}
        >
          {label}
        </Button>
        <BottomSheet title={title} open={open} onClose={() => setOpen(false)} inline={inline}>
          <SheetMenu items={items} title={title} onPick={pick} />
        </BottomSheet>
      </span>
    );
  }

  const menuItems: NonNullable<AntMenuProps['items']> = items.map((item, index) => ({
    key: itemKey(index),
    label: item.label,
    icon: item.icon ? <Icon name={item.icon} /> : undefined,
  }));
  const onMenuClick: AntMenuProps['onClick'] = ({ key }) => {
    const item = items[Number(String(key).slice(1))];
    if (item) pick(item);
  };

  return (
    <span className={rootClass} onKeyDown={onKeyDown}>
      <Dropdown
        open={open}
        onOpenChange={next => setOpen(next)}
        trigger={['click']}
        placement="bottomRight"
        arrow={false}
        autoFocus
        destroyOnHidden
        getPopupContainer={inline ? node => node.parentElement ?? document.body : undefined}
        classNames={{ root: 'aile-overflow-menu', item: 'aile-overflow-eylem', itemIcon: 'aile-overflow-simge' }}
        styles={{ root: { minWidth: OVERFLOW_MENU_MIN_WIDTH } }}
        menu={{ id: menuId, items: menuItems, onClick: onMenuClick, 'aria-label': title }}
      >
        <Button
          ref={triggerRef}
          variant={variant}
          icon="more"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
        >
          {label}
        </Button>
      </Dropdown>
    </span>
  );
}

interface SheetMenuProps {
  items: readonly OverflowActionItem[];
  title: string;
  onPick(item: OverflowActionItem): void;
}

// Telefon listesi: role="menu" içinde menuitem düğmeleri (44 px). Hepsi sekme sırasındadır; oklar sarmalı dolaşır,
// Home/End uçlara gider (masaüstü menüsüyle aynı klavye sözleşmesi). Escape'i BottomSheet kapatır.
function SheetMenu({ items, title, onPick }: SheetMenuProps) {
  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    const count = buttons.length;
    if (count === 0) return;
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next: number;
    switch (event.key) {
      case 'ArrowDown': next = current < 0 ? 0 : (current + 1) % count; break;
      case 'ArrowUp': next = current < 0 ? count - 1 : (current - 1 + count) % count; break;
      case 'Home': next = 0; break;
      case 'End': next = count - 1; break;
      default: return;
    }
    event.preventDefault();
    buttons[next]?.focus();
  };

  return (
    <ul role="menu" aria-label={title} className="aile-overflow-liste" onKeyDown={onKeyDown}>
      {items.map((item, index) => (
        <li key={itemKey(index)} role="none">
          <button type="button" role="menuitem" className="aile-overflow-secenek" data-focus-line onClick={() => onPick(item)}>
            {item.icon && <Icon name={item.icon} />}
            <span className="aile-overflow-secenek-etiket">{item.label}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
