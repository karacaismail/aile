import { useEffect, useSyncExternalStore } from 'react';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react/dist/lib/types';
import { ArrowsClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowsClockwise';
import { CaretDownIcon } from '@phosphor-icons/react/dist/csr/CaretDown';
import { CaretRightIcon } from '@phosphor-icons/react/dist/csr/CaretRight';
import { CheckIcon } from '@phosphor-icons/react/dist/csr/Check';
import { TableIcon } from '@phosphor-icons/react/dist/csr/Table';
import { WarningIcon } from '@phosphor-icons/react/dist/csr/Warning';
import { iconTokens } from '../../design/tokens.ts';
import { CHUNK_RETRY_DELAY_MS, chunkFailureStatus, retryOnRecovery } from '../adaptive/chunkError';
import type { EXTRA_ICONS } from './icons.extra';

// Tasarım README › İkonografi: Aile.Icon adları (menu … edit) + P0b ekleri (calendar, undo, compare).
// Tek simge seti Phosphor, weight regular, 20 px, currentColor. Ham paket importu yalnız bu dosyada ve icons.extra.tsx'te,
// simge başına (dist/csr/<Ad>): paket barrel'ı 3000+ simgeyi modül grafiğine sokar. antd/@ant-design yok. Derlemede
// her simge modülü yalnız regular ağırlığını taşır (ui/icons.build.ts; çıktı aynı SVG).
// Teslim: telefon ilk rotasının (Genel durum) çizdiği altı simge burada statiktir (çekirdek); kalan on yedisi
// icons.extra.tsx'tedir ve ilk gerektiğinde tek parça olarak iner (tek uçuş, CHUNK_RETRY_DELAY_MS sonra bir otomatik
// yeniden deneme). Rota yükleyicisi (routes.tsx) başka bir sayfayı indirirken onu paralel ister (preloadIcons; sayfa
// beklemez). Parça henüz yoksa simge aynı ölçü ve niteliklerle boş çizilir (yerleşim kaymaz, erişilebilir ad korunur) ve
// parça gelince dolar. Parça düşerse simge boş kalır ve bağlantı gelince ('online') ya da kullanıcının bir sonraki
// etkileşiminde bir kez yeniden denenir (adaptive/chunkError retryOnRecovery); yalnız yeniden çizim deneme başlatmaz.
// Çevrim içiyken parça yükleme hatası eski sürümdür: useIconsStatus 'stale-build' verir, rota "Yeni sürüm var · Yenile"
// gösterir. Yükleyici (adaptive/loader) bilerek kullanılmaz: içe aktarılması telefon ilk rota JS'ini parçalara bölüyordu.
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
 * Simge boyutu (CSS px), tasarım README › İkonografi: "Simgeler 20 px, metinle birlikte". Tek kaynak tasarım tokenı
 * (src/design/tokens.ts iconTokens.simgeOlcu); bileşenler sabit sayı yazmak yerine bunu ya da size prop'unu kullanır.
 */
export const ICON_SIZE = iconTokens.simgeOlcu;

/** Çekirdek dışı parçanın durumu (adaptive loader WideStatus ile aynı adlar). */
export type IconsStatus = 'idle' | 'loading' | 'ready' | 'error' | 'stale-build';

let extraIcons: ExtraIcons | null = null;
let extraStatus: IconsStatus = 'idle';
let extraRequest: Promise<ExtraIcons> | null = null;
const listeners = new Set<() => void>();
const setStatus = (next: IconsStatus) => {
  extraStatus = next;
  for (const listener of [...listeners]) listener();
};
const importExtra = () => import('./icons.extra');
const wait = (ms: number) => new Promise<void>(resolve => { setTimeout(resolve, ms); });

/**
 * Çekirdek dışı simgeleri ister (açık istek: düşmüş parçayı yeniden dener); uçuştaki istek paylaşılır. İlk deneme düşerse
 * bir kez daha denenir; yine düşerse durum çevrim içi parça hatasında 'stale-build', diğerlerinde 'error' olur.
 */
export function preloadIcons(): Promise<ExtraIcons> {
  if (extraIcons) return Promise.resolve(extraIcons);
  extraRequest ??= (async () => {
    setStatus('loading');
    try {
      const module = await importExtra().catch(() => wait(CHUNK_RETRY_DELAY_MS).then(importExtra));
      extraIcons = module.EXTRA_ICONS;
      setStatus('ready');
      return extraIcons;
    } catch (error) {
      extraRequest = null;
      setStatus(chunkFailureStatus(error));
      throw error;
    }
  })();
  return extraRequest;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
const readStatus = () => extraStatus;
const ignore = () => {};
/** retryOnRecovery hedefi: sonraki etkileşimde ya da bağlantı gelince parçayı yeniden ister. */
const RECOVERY = { retry: preloadIcons };

/** Çekirdek dışı simge parçasının durumu ('stale-build' → rota yeniden yükleme bildirimi). */
export function useIconsStatus(): IconsStatus {
  return useSyncExternalStore(subscribe, readStatus, readStatus);
}

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
  const status = useIconsStatus();
  const extra = status === 'ready' ? extraIcons : null;
  // İlk gereksinimde ister; düşmüşse yeniden çizim istemez, bağlantı ya da sonraki etkileşim bir kez yeniden dener.
  useEffect(() => {
    if (core || extra) return;
    if (status === 'idle') preloadIcons().catch(ignore);
    else if (status === 'error') retryOnRecovery(RECOVERY);
  }, [core, extra, status]);
  const Glyph: PhosphorIcon | undefined = core ? CORE_ICONS[name] : extra?.[name];
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true as const };
  if (!Glyph) {
    // Phosphor IconBase ile aynı kutu ve nitelikler; yol parça gelince eklenir.
    return <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} fill="currentColor" viewBox="0 0 256 256" className={className} data-icon={name} {...a11y} />;
  }
  return <Glyph size={size} weight="regular" color="currentColor" className={className} data-icon={name} {...a11y} />;
}
