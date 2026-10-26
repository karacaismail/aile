import { SunIcon, LampIcon, LampPendantIcon, DeskIcon, MoonIcon, SparkleIcon, LightbulbIcon, type Icon } from '@phosphor-icons/react';

const LAYER_ICON: Record<string, Icon> = { ana: SunIcon, ikincil: LampIcon, ucuncul: LampPendantIcon, gorev: DeskIcon, gece: MoonIcon, dekoratif: SparkleIcon };

export function layerIcon(tur?: string): Icon {
  return LAYER_ICON[tur ?? ''] ?? LightbulbIcon;
}
