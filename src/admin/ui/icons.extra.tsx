import type { Icon as PhosphorIcon } from '@phosphor-icons/react/dist/lib/types';
import { ArrowCounterClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowCounterClockwise';
import { ArrowLeftIcon } from '@phosphor-icons/react/dist/csr/ArrowLeft';
import { ArrowSquareOutIcon } from '@phosphor-icons/react/dist/csr/ArrowSquareOut';
import { CalendarBlankIcon } from '@phosphor-icons/react/dist/csr/CalendarBlank';
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
import { XIcon } from '@phosphor-icons/react/dist/csr/X';

// Telefon ilk rotasının (Genel durum) çizmediği simgeler: ui/icons.tsx bu modülü yalnız böyle bir simge ilk kez
// çizilince ya da rota yükleyicisi (routes.tsx) başka bir sayfayı indirirken ister. Ad → Phosphor (regular) eşlemesi
// tasarım README › İkonografi ile aynıdır; çekirdek simgeler icons.tsx'tedir.
export const EXTRA_ICONS = {
  menu: ListIcon, close: XIcon, search: MagnifyingGlassIcon, filter: FunnelIcon, back: ArrowLeftIcon, plus: PlusIcon,
  download: DownloadSimpleIcon, more: DotsThreeIcon, info: InfoIcon, imageOff: ImageBrokenIcon, settings: GearIcon,
  external: ArrowSquareOutIcon, sort: SortAscendingIcon, edit: PencilSimpleIcon, calendar: CalendarBlankIcon,
  undo: ArrowCounterClockwiseIcon, compare: ColumnsIcon,
} satisfies Record<string, PhosphorIcon>;
