import { useEffect, useSyncExternalStore } from 'react';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react/dist/lib/types';
import { ArrowsClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowsClockwise';
import { CaretDownIcon } from '@phosphor-icons/react/dist/csr/CaretDown';
import { CaretRightIcon } from '@phosphor-icons/react/dist/csr/CaretRight';
import { CheckIcon } from '@phosphor-icons/react/dist/csr/Check';
import { TableIcon } from '@phosphor-icons/react/dist/csr/Table';
import { WarningIcon } from '@phosphor-icons/react/dist/csr/Warning';
import type { EXTRA_ICONS } from './icons.extra';

// Tasarım README › İkonografi: Aile.Icon adları (menu … edit) + P0b ekleri (calendar, undo, compare).
// Tek simge seti Phosphor, weight regular, 20 px, currentColor. Ham paket importu yalnız bu dosyada ve icons.extra.tsx'te,
// simge başına (dist/csr/<Ad>): paket barrel'ı 3000+ simgeyi modül grafiğine sokar. antd/@ant-design yok. Derlemede
// her simge modülü yalnız regular ağırlığını taşır (ui/icons.build.ts; çıktı aynı SVG).
// Teslim: telefon ilk rotasının (Genel durum) çizdiği altı simge burada statiktir (çekirdek); kalan on yedisi
// icons.extra.tsx'tedir ve ilk gerektiğinde tek parça olarak iner. Rota yükleyicisi (routes.tsx) başka bir sayfayı
// indirirken onu da birlikte ister (preloadIcons): o sayfa ilk çizildiğinde simgeler hazırdır. Parça henüz yoksa simge
// aynı ölçü ve niteliklerle boş çizilir (yerleşim kaymaz, erişilebilir ad korunur) ve parça gelince dolar.
const CORE_ICONS = {
  refresh: ArrowsClockwiseIcon, chevronDown: CaretDownIcon, chevronRight: CaretRightIcon, check: CheckIcon, alert: WarningIcon,
  sheet: TableIcon,
} satisfies Record<string, PhosphorIcon>;

type CoreIconName = keyof typeof CORE_ICONS;
type ExtraIcons = typeof EXTRA_ICONS;
export type IconName = CoreIconName | keyof ExtraIcons;

/** Tasarımdaki simge adları (README sırası). */
export const ICON_NAMES = [
  'menu', 'close', 'search', 'filter', 'refresh', 'chevronDown', 'chevronRight', 'back', 'check', 'plus', 'download', 'more',
  'alert', 'info', 'imageOff', 'sheet', 'settings', 'external', 'sort', 'edit', 'calendar', 'undo', 'compare',
] as const satisfies readonly IconName[];

/**
 * Simge boyutu (CSS px), tasarım README › İkonografi: "Simgeler 20 px, metinle birlikte". tokens.json'da simge boyutu
 * tokenı yok; tek kaynak bu sabittir (bileşenler sabit sayı yazmak yerine bunu ya da size prop'unu kullanır).
 */
export const ICON_SIZE = 20;

let extraIcons: ExtraIcons | null = null;
let extraRequest: Promise<ExtraIcons> | null = null;
const listeners = new Set<() => void>();

/** Çekirdek dışı simgeleri bir kez ister; uçuştaki istek paylaşılır, başarısız istek saklanmaz (sonraki çizim yeniden ister). */
export function preloadIcons(): Promise<ExtraIcons> {
  extraRequest ??= import('./icons.extra').then(
    (module) => {
      extraIcons = module.EXTRA_ICONS;
      for (const listener of [...listeners]) listener();
      return module.EXTRA_ICONS;
    },
    (error: unknown) => {
      extraRequest = null;
      throw error;
    },
  );
  return extraRequest;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
const readExtra = () => extraIcons;
const ignore = () => {};
const isCore = (name: IconName): name is CoreIconName => name in CORE_ICONS;

export interface IconProps {
  name: IconName;
  /** CSS px; varsayılan ICON_SIZE (20, tasarım). */
  size?: number;
  /** Verilirse simge anlam taşır: role="img" + aria-label. Verilmezse süsleyici (aria-hidden). */
  label?: string;
  className?: string;
}

export function Icon({ name, size = ICON_SIZE, label, className }: IconProps) {
  const core = isCore(name);
  const extra = useSyncExternalStore(subscribe, readExtra, readExtra);
  useEffect(() => {
    if (!core && !extra) preloadIcons().catch(ignore);
  }, [core, extra]);
  const Glyph: PhosphorIcon | undefined = core ? CORE_ICONS[name] : extra?.[name];
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true as const };
  if (!Glyph) {
    // Phosphor IconBase ile aynı kutu ve nitelikler; yol parça gelince eklenir.
    return <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} fill="currentColor" viewBox="0 0 256 256" className={className} data-icon={name} {...a11y} />;
  }
  return <Glyph size={size} weight="regular" color="currentColor" className={className} data-icon={name} {...a11y} />;
}
