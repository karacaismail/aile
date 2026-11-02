import type { Icon as PhosphorIcon } from '@phosphor-icons/react/dist/lib/types';
import { ArrowCounterClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowCounterClockwise';
import { ArrowLeftIcon } from '@phosphor-icons/react/dist/csr/ArrowLeft';
import { ArrowSquareOutIcon } from '@phosphor-icons/react/dist/csr/ArrowSquareOut';
import { ArrowsClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowsClockwise';
import { CalendarBlankIcon } from '@phosphor-icons/react/dist/csr/CalendarBlank';
import { CaretDownIcon } from '@phosphor-icons/react/dist/csr/CaretDown';
import { CaretRightIcon } from '@phosphor-icons/react/dist/csr/CaretRight';
import { CheckIcon } from '@phosphor-icons/react/dist/csr/Check';
import { ColumnsIcon } from '@phosphor-icons/react/dist/csr/Columns';
import { DotsThreeIcon } from '@phosphor-icons/react/dist/csr/DotsThree';
import { DownloadSimpleIcon } from '@phosphor-icons/react/dist/csr/DownloadSimple';
import { FunnelIcon } from '@phosphor-icons/react/dist/csr/Funnel';
import { GearIcon } from '@phosphor-icons/react/dist/csr/Gear';
import { ImageBrokenIcon } from '@phosphor-icons/react/dist/csr/ImageBroken';
import { InfoIcon } from '@phosphor-icons/react/dist/csr/Info';
import { ListIcon } from '@phosphor-icons/react/dist/csr/List';
import { MagnifyingGlassIcon } from '@phosphor-icons/react/dist/csr/MagnifyingGlass';
import { PencilSimpleIcon } from '@phosphor-icons/react/dist/csr/PencilSimple';
import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus';
import { SortAscendingIcon } from '@phosphor-icons/react/dist/csr/SortAscending';
import { TableIcon } from '@phosphor-icons/react/dist/csr/Table';
import { WarningIcon } from '@phosphor-icons/react/dist/csr/Warning';
import { XIcon } from '@phosphor-icons/react/dist/csr/X';

// Tasarım README › İkonografi: Aile.Icon adları (menu … edit) + P0b ekleri (calendar, undo, compare).
// Tek simge seti Phosphor, weight regular, 20 px, currentColor. Ham paket importu yalnız bu dosyada ve simge başına
// (dist/csr/<Ad>): paket barrel'ı 3000+ simgeyi modül grafiğine sokar (geliştirme sunucusu, Vitest dönüşümü), telefon
// statik kapanışı yalnız kullanılan 23 simgeyi taşır. antd/@ant-design yok.
const ICONS = {
  menu: ListIcon, close: XIcon, search: MagnifyingGlassIcon, filter: FunnelIcon, refresh: ArrowsClockwiseIcon,
  chevronDown: CaretDownIcon, chevronRight: CaretRightIcon, back: ArrowLeftIcon, check: CheckIcon, plus: PlusIcon,
  download: DownloadSimpleIcon, more: DotsThreeIcon, alert: WarningIcon, info: InfoIcon, imageOff: ImageBrokenIcon,
  sheet: TableIcon, settings: GearIcon, external: ArrowSquareOutIcon, sort: SortAscendingIcon, edit: PencilSimpleIcon,
  calendar: CalendarBlankIcon, undo: ArrowCounterClockwiseIcon, compare: ColumnsIcon,
} satisfies Record<string, PhosphorIcon>;

export type IconName = keyof typeof ICONS;
export const ICON_NAMES = Object.keys(ICONS) as readonly IconName[];

/**
 * Simge boyutu (CSS px), tasarım README › İkonografi: "Simgeler 20 px, metinle birlikte". tokens.json'da simge boyutu
 * tokenı yok; tek kaynak bu sabittir (bileşenler sabit sayı yazmak yerine bunu ya da size prop'unu kullanır).
 */
export const ICON_SIZE = 20;

export interface IconProps {
  name: IconName;
  /** CSS px; varsayılan ICON_SIZE (20, tasarım). */
  size?: number;
  /** Verilirse simge anlam taşır: role="img" + aria-label. Verilmezse süsleyici (aria-hidden). */
  label?: string;
  className?: string;
}

export function Icon({ name, size = ICON_SIZE, label, className }: IconProps) {
  const Glyph = ICONS[name];
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true as const };
  return <Glyph size={size} weight="regular" color="currentColor" className={className} data-icon={name} {...a11y} />;
}
