import { ShoppingCartIcon } from '@phosphor-icons/react/dist/csr/ShoppingCart';
import { LightbulbIcon } from '@phosphor-icons/react/dist/csr/Lightbulb';
import { PaintRollerIcon } from '@phosphor-icons/react/dist/csr/PaintRoller';
import { BlueprintIcon } from '@phosphor-icons/react/dist/csr/Blueprint';
import { WalletIcon } from '@phosphor-icons/react/dist/csr/Wallet';

export const MODULE_ICONS = {
  satinalma: ShoppingCartIcon,
  aydinlatma: LightbulbIcon,
  tadilat: PaintRollerIcon,
  yerlesim: BlueprintIcon,
  butce: WalletIcon,
} as const;

/** 320–359 px'te alt sekme etiketleri kısa (1 rem metin beş sekmeye sığsın); ≥360 px tam ad. */
export const MODULE_SHORT_LABELS: Record<keyof typeof MODULE_ICONS, string> = {
  satinalma: 'Liste',
  aydinlatma: 'Işık',
  tadilat: 'Tadilat',
  yerlesim: 'Yerleşim',
  butce: 'Bütçe',
};
