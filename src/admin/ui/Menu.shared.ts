import type { KeyboardEvent, RefObject } from 'react';
import type { IconName } from './icons';

// Menu'nün ortak, hafif yüzeyi: genel türler (MenuItem, MenuProps), sabitler ve menü düğmesi (Menu.lazy.tsx) ile açılır
// gövde (Menu.panel.tsx) arasındaki sözleşme. Çalışma zamanı içeriği yalnız sabitler ve odak hedefi seçicisidir: telefon
// ilk rotasının statik kapanışında durur, gövdeyi (liste, açılır panel, BottomSheet) çekmez. Genel adlar Menu.tsx'ten
// yeniden dışa verilir; sayfa ve ui kodu onları oradan (ya da yalnız tetik gerekiyorsa buradan) alır.

export interface MenuItem {
  key: string;
  /** Cümle düzeni ("Alım ekle"); kesilmez, gerekirse sarılır. */
  label: string;
  /** Etiketin önünde Phosphor simgesi (20 px, süsleyici). */
  icon?: IconName;
  /** Etiketin ardında simge; `external` verilince varsayılan "external". */
  iconEnd?: IconName;
  /** Sayım (tr-TR, tabular-nums). Verilmezse gösterilmez. */
  count?: number;
  /** Verilirse öğe bağlantıdır (hash yol: "#/alimlar" ya da tam URL). */
  href?: string;
  /** Yeni sekmede açılır: target=_blank, rel=noopener, dış simge ve görsel gizli "yeni sekmede açılır" notu. */
  external?: boolean;
  /** Devre dışı: aria-disabled, href düşer, onSelect çağrılmaz, oklarla atlanır. */
  disabled?: boolean;
  /** Yalnız ayırıcı (cizgi); diğer alanlar yok sayılır. */
  divider?: boolean;
  /** Tehlikeli eylem (Sil): listenin sonunda, ayırıcıdan sonra "Tehlikeli eylemler" grubunda, hata renginde. */
  danger?: boolean;
}

export interface MenuProps {
  items: readonly MenuItem[];
  /** Seçili öğe: secili yüzey + 600 ağırlık + aria-current="page". Seçim odaktan ayrıdır. */
  selectedKey?: string;
  /** Tıklama, Enter ya da Space ile; devre dışı öğede çağrılmaz. Bağlantılı öğede tarayıcı gezinmesi de olur. */
  onSelect?(key: string): void;
  /** "nav": lacivert panel (nav-metin, nav-hover, odak çizgisi odak-nav). Varsayılan açık yüzey. */
  variant?: 'nav';
  /** Menünün erişilebilir adı; çevreleyen <nav aria-label> varsa gerekmez. Menü düğmesinde alt sayfa başlığıdır
   *  (varsayılan `trigger`). */
  label?: string;
  /** Listede <ul>'a, menü düğmesinde sarmalayıcıya eklenir. */
  className?: string;
  /** Verilirse menü düğmesi kalıbı: bu metinli düğme menüyü açar (telefonda alt sayfa, genişte açılır panel). */
  trigger?: string;
  /** Düğme metninin önündeki simge; verilmezse metnin ardında chevronDown. */
  triggerIcon?: IconName;
  /** Düğme görünümü; varsayılan secondary. */
  triggerVariant?: 'secondary' | 'quiet';
  /** Açık başlar (önizleme); odak taşınmaz. */
  defaultOpen?: boolean;
  /** Portal/üst katman yerine yerinde çizim (önizleme ve yalıtık test). */
  inline?: boolean;
  /** Açılır panelin düğmeye hizası; varsayılan start (sol kenar), end sağ kenar. */
  align?: 'start' | 'end';
  /** Açılır panele eklenecek sınıf. */
  popupClassName?: string;
}

/** Tasarım bundle.css .ai-pop: "min-width: 240px". tokens.json'da karşılığı yok; tek kaynak bu sabittir. */
export const MENU_POPUP_MIN_WIDTH = 240;
/** Tehlikeli öğelerin grubunun erişilebilir adı. */
export const DANGER_GROUP_LABEL = 'Tehlikeli eylemler';

/** Etkin odak hedefinin işareti (her zaman role="menuitem" öğesi: bağlantıda <a>, eylemde <li>). */
export const TARGET_SELECTOR = '[data-menu-target]';

/** Etkin odak hedefleri, DOM sırasıyla. */
export function focusTargets(list: HTMLElement): HTMLElement[] {
  return Array.from(list.querySelectorAll<HTMLElement>(TARGET_SELECTOR));
}

/**
 * Menü düğmesinin açılır gövdesi (Menu.panel.tsx MenuPanel): telefonda alt sayfa (BottomSheet) içinde liste, tablet ve
 * masaüstünde düğmeye bağlı açılır panel. Durum, odak niyeti ve klavye kapanışı düğmededir; gövde yalnız çizer.
 */
export interface MenuPanelProps {
  /** Telefon profili: alt sayfa (liste kipi, tek sekme durağı); değilse açılır panel (öğeler -1, odağı düğme verir). */
  phone: boolean;
  open: boolean;
  /** Menünün erişilebilir adı ve alt sayfa başlığı. */
  name: string;
  /** Liste kimliği (açılır panelde düğmenin aria-controls bağı). */
  menuId: string;
  listRef: RefObject<HTMLUListElement | null>;
  /** Menü düğmesi: alt sayfanın odak dönüşü ve açılır panelin konumu. */
  anchorRef: RefObject<HTMLButtonElement | null>;
  items: readonly MenuItem[];
  selectedKey?: string;
  variant?: 'nav';
  inline: boolean;
  align: 'start' | 'end';
  popupClassName?: string;
  onActivate(item: MenuItem): void;
  /** Açılır panelde Escape/Tab (ok ve typeahead'den önce). */
  onKeyDown(event: KeyboardEvent<HTMLUListElement>): void;
  /** Alt sayfanın kapatma isteği (Kapat, Escape, örtü, sürükleme): kapanır, odak düğmeye döner. */
  onClose(): void;
}
