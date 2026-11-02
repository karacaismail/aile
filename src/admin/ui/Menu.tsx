import { MenuButton } from './Menu.lazy';
import { MenuList, MenuPanel } from './Menu.panel';
import type { MenuProps } from './Menu.shared';

// Tasarım: components/Menu/README.md + index.d.ts MenuProps/MenuItem; davranış bundle.js Menu (href → <a>, external →
// target=_blank + rel=noopener + gizli "yeni sekmede açılır", seçili → aria-current="page", devre dışı tıklamaz).
// Yerel uygulama (antd yok); tek kod bütün profillere hizmet eder, geniş-özel dosya yoktur. İki kullanım:
//  1. Liste (varsayılan): dikey gezinme ya da eylem listesi. WAI-ARIA APG "Menu": role="menu", tek sekme durağı
//     (roving tabindex: seçili, yoksa ilk etkin öğe), oklar sarmalı dolaşır, Home/End uçlara, yazılan harf (tr-TR)
//     o harfle başlayan sonraki öğeye gider; Enter/Space seçer. Devre dışı öğe ve ayırıcı atlanır. Eylem öğesi
//     <li role="menuitem">; bağlantı öğesi APG'nin bağlantılı öğe kalıbıdır: <li role="none"><a role="menuitem" href>.
//     Odak, sekme durağı, aria-current ve yüzey her zaman menuitem'in kendisindedir (içte ikinci bir hedef yok).
//  2. Menü düğmesi (`trigger` verilince): APG "Menu Button". Düğme aria-haspopup + aria-expanded; tıklama, Enter, Space
//     ve ArrowDown ilk öğeye, ArrowUp son öğeye odakla açar; Escape kapatır ve odağı düğmeye döndürür; Tab kapatır ve
//     odağı doğal sıraya bırakır; seçim kapatır, odağı düğmeye döndürür, sonra onSelect çağırır. Telefon profilinde liste
//     alttan açılan sayfadır (BottomSheet, aria-haspopup="dialog"; modal diyalogda menü tek sekme durağıdır, Tab Kapat ile
//     menü arasında döner); tablet ve masaüstünde düğmenin altında açılır panel
//     (Popover API varsa üst katman: taşma kırpmaz; konum görünüm alanına sığdırılır, sığmazsa yukarı açılır).
// Seçili durum vurgu kenarıyla değil yüzey tonu (secili) + 600 ağırlıkla; odak seçimden ayrıdır. Tehlikeli öğeler
// (danger) listenin sonunda ayırıcıdan sonra kendi grubundadır. Dokunma: Pointer Events ile basılı yüzey (data-pressed);
// pointercancel (kaydırma) basılı durumu siler, seçim yapılmaz. Görsel kurallar Menu.css (yalnız --aile tokenları).
//
// Modül sınırları (telefon ilk rota bütçesi, docs/ADMIN-BUDGETS.md): Menu.shared.ts türler ve sabitler; Menu.lazy.tsx
// menü düğmesi (durum, klavye, tetik; telefon ilk rotasında statik); Menu.panel.tsx gövde (liste, açılır panel,
// BottomSheet sarmalı). Bu modül genel yüzeydir ve gövdeyi statik alır: <Menu> liste kipi ve <Menu trigger> eşzamanlı
// çizer (ilk tıklamada aynı karede açılır). "Diğer" (OverflowActions) aynı düğmeyi gövdesiz kullanır; gövde ilk niyette
// iner.

export { DANGER_GROUP_LABEL, MENU_POPUP_MIN_WIDTH } from './Menu.shared';
export type { MenuItem, MenuProps } from './Menu.shared';

export function Menu(props: MenuProps) {
  if (props.trigger !== undefined) return <MenuButton {...props} trigger={props.trigger} panel={MenuPanel} />;
  const { items, selectedKey, onSelect, variant, label, className } = props;
  return (
    <MenuList
      mode="list"
      items={items}
      selectedKey={selectedKey}
      variant={variant}
      label={label}
      className={className}
      onActivate={item => onSelect?.(item.key)}
    />
  );
}
