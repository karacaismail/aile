import type { ComponentType } from 'react';
import {
  ArrowCounterClockwise, ArrowLeft, ArrowSquareOut, ArrowsClockwise, CalendarBlank, CaretDown, CaretRight, Check, Columns,
  DotsThree, DownloadSimple, Funnel, Gear, ImageBroken, Info, List, MagnifyingGlass, PencilSimple, Plus, SortAscending,
  Table, Warning, X, type IconProps as PhosphorIconProps,
} from '@phosphor-icons/react';

// Tasarım README › İkonografi: Aile.Icon adları (menu … edit) + P0b ekleri (calendar, undo, compare).
// Tek simge seti Phosphor, weight regular, 20 px, currentColor. Ham paket importu yalnız bu dosyada.
const ICONS = {
  menu: List, close: X, search: MagnifyingGlass, filter: Funnel, refresh: ArrowsClockwise,
  chevronDown: CaretDown, chevronRight: CaretRight, back: ArrowLeft, check: Check, plus: Plus,
  download: DownloadSimple, more: DotsThree, alert: Warning, info: Info, imageOff: ImageBroken,
  sheet: Table, settings: Gear, external: ArrowSquareOut, sort: SortAscending, edit: PencilSimple,
  calendar: CalendarBlank, undo: ArrowCounterClockwise, compare: Columns,
} satisfies Record<string, ComponentType<PhosphorIconProps>>;

export type IconName = keyof typeof ICONS;
export const ICON_NAMES = Object.keys(ICONS) as readonly IconName[];

export interface IconProps {
  name: IconName;
  /** CSS px; varsayılan 20 (tasarım). */
  size?: number;
  /** Verilirse simge anlam taşır: role="img" + aria-label. Verilmezse süsleyici (aria-hidden). */
  label?: string;
  className?: string;
}

export function Icon({ name, size = 20, label, className }: IconProps) {
  const Glyph = ICONS[name];
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true as const };
  return <Glyph size={size} weight="regular" color="currentColor" className={className} data-icon={name} {...a11y} />;
}
