import { Menu } from '../../ui/Menu';

// Masaüstü rapor menüsü (tasarım: solda 240 px .pg-report-nav). Yalnız masaüstü profili; lazyWide('raporlar-menu')
// ile tembel gelir. Telefon ve tablette aynı seçim "Rapor" alanıdır (alttan sayfa / açılır liste); menü yüklenirken ve
// yüklenemezse de o alan yerinde kalır (wideFallback). Seçili rapor aria-current="page" taşır (Menu).

export interface RaporMenuProps {
  items: readonly { key: string; label: string }[];
  selectedKey: string;
  onSelect(key: string): void;
}

export default function RaporMenu({ items, selectedKey, onSelect }: RaporMenuProps) {
  return <Menu items={items} selectedKey={selectedKey} onSelect={onSelect} label="Rapor seçimi" />;
}
