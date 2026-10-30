import { SunIcon } from '@phosphor-icons/react/dist/csr/Sun';
import { LampIcon } from '@phosphor-icons/react/dist/csr/Lamp';
import { LampPendantIcon } from '@phosphor-icons/react/dist/csr/LampPendant';
import { DeskIcon } from '@phosphor-icons/react/dist/csr/Desk';
import { MoonIcon } from '@phosphor-icons/react/dist/csr/Moon';
import { SparkleIcon } from '@phosphor-icons/react/dist/csr/Sparkle';
import { LightbulbIcon } from '@phosphor-icons/react/dist/csr/Lightbulb';
import type { Icon } from '@phosphor-icons/react';

const LAYER_ICON: Record<string, Icon> = { ana: SunIcon, ikincil: LampIcon, ucuncul: LampPendantIcon, gorev: DeskIcon, gece: MoonIcon, dekoratif: SparkleIcon };

export function layerIcon(tur?: string): Icon {
  return LAYER_ICON[tur ?? ''] ?? LightbulbIcon;
}
