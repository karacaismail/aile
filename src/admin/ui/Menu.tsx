import type { KeyboardEvent } from 'react';
import { AntMenu, type AntMenuProps } from './antd';
import { Icon, type IconName } from './icons';
import './Menu.css';

// Tasarım: components/Menu/README.md + index.d.ts MenuProps/MenuItem; davranış bundle.js Menu (href → <a>, external →
// target=_blank + rel=noopener + gizli "yeni sekmede açılır", seçili → aria-current="page", devre dışı tıklamaz).
// antd Menu üzerine: variant "nav" lacivert panel (theme="dark"), aksi açık yüzey; mode="vertical" (inline modun
// seçili şeridi ::after'ı admin.css odak çizgisiyle çakışır; vertical'da şerit yok). Renk ve ölçüler Menu.css'te tokenla.

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
  /** Devre dışı: aria-disabled, href düşer, onSelect çağrılmaz. */
  disabled?: boolean;
  /** Yalnız ayırıcı (cizgi); diğer alanlar yok sayılır. */
  divider?: boolean;
}

export interface MenuProps {
  items: readonly MenuItem[];
  /** Seçili öğe: secili yüzey + 600 ağırlık + aria-current="page". Seçim odaktan ayrıdır. */
  selectedKey?: string;
  /** Tıklama, Enter ya da Space ile; devre dışı öğede çağrılmaz. Bağlantılı öğede tarayıcı gezinmesi de olur. */
  onSelect?(key: string): void;
  /** "nav": lacivert panel (nav-metin, nav-hover, odak çizgisi odak-nav). Varsayılan açık yüzey. */
  variant?: 'nav';
  /** Menünün erişilebilir adı; çevreleyen <nav aria-label> varsa gerekmez. */
  label?: string;
  className?: string;
}

type AntItems = NonNullable<AntMenuProps['items']>;
type AntMenuItem = Extract<NonNullable<AntItems[number]>, { type?: 'item' }>;
type AntDivider = Extract<NonNullable<AntItems[number]>, { type: 'divider' }>;
/** antd öğe nesnesindeki ek alanlar <li role="menuitem"> üzerine yayılır (antd 6 generic items). */
type AileAntItem = AntMenuItem & {
  'aria-current'?: 'page';
  tabIndex?: number;
  onKeyDown?(event: KeyboardEvent<HTMLLIElement>): void;
};

const NEW_TAB_NOTE = 'yeni sekmede açılır';
const countFormat = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });

function ItemContent({ item, selected }: { item: MenuItem; selected: boolean }) {
  const iconEnd = item.iconEnd ?? (item.external ? 'external' : undefined);
  // Parçalar arasındaki {' '} metin düğümleri erişilebilir adı ayırır ("E-tabloyu aç (yeni sekmede açılır)",
  // "Alımlar ve eşyalar 1.250"); flex satırında yalnız boşluk olan metin çizilmez.
  const body = (
    <>
      {item.icon && <Icon name={item.icon} />}
      <span className="aile-menu-label">{item.label}</span>
      {item.external && <>{' '}<span className="aile-menu-sr">({NEW_TAB_NOTE})</span></>}
      {item.count !== undefined && <>{' '}<span className="aile-menu-count">{countFormat.format(item.count)}</span></>}
      {iconEnd && <Icon name={iconEnd} />}
    </>
  );
  if (!item.href) return <span className="aile-menu-link">{body}</span>;
  if (item.disabled) return <a className="aile-menu-link" aria-disabled="true">{body}</a>;
  return (
    <a
      className="aile-menu-link"
      href={item.href}
      target={item.external ? '_blank' : undefined}
      rel={item.external ? 'noopener' : undefined}
      aria-current={selected ? 'page' : undefined}
    >
      {body}
    </a>
  );
}

export function Menu({ items, selectedKey, onSelect, variant, label, className }: MenuProps) {
  const antItems: (AileAntItem | AntDivider)[] = items.map((item, index) => {
    if (item.divider) return { type: 'divider', key: item.key || `divider-${index}`, className: 'aile-menu-divider' };
    const selected = item.key === selectedKey;
    const focusable = !item.disabled && !item.href;
    return {
      key: item.key,
      disabled: item.disabled,
      className: 'aile-menu-item',
      'aria-current': selected ? 'page' : undefined,
      // Bağlantılı öğede sekme durağı <a>'dır; eylem öğesinde li'nin kendisi (antd varsayılanı -1 ile erişilmez kalırdı).
      tabIndex: focusable ? 0 : undefined,
      // Enter'ı antd işler (tıklama sayılır); Space eylem öğesinde aynı işi yapar, sayfayı kaydırmaz.
      onKeyDown: focusable
        ? event => { if (event.key === ' ' && event.target === event.currentTarget) { event.preventDefault(); onSelect?.(item.key); } }
        : undefined,
      label: <ItemContent item={item} selected={selected} />,
    };
  });
  return (
    <AntMenu<AileAntItem>
      mode="vertical"
      theme={variant === 'nav' ? 'dark' : 'light'}
      items={antItems}
      selectedKeys={selectedKey === undefined ? [] : [selectedKey]}
      onClick={info => onSelect?.(info.key)}
      // Liste kendisi sekme durağı değildir (görünmez odak olurdu); öğeler kendileri odaklanır, oklar antd ile gezer.
      tabIndex={-1}
      tooltip={false}
      aria-label={label}
      className={['aile-menu', className].filter(Boolean).join(' ')}
      classNames={{ itemContent: 'aile-menu-content' }}
      data-variant={variant}
    />
  );
}
