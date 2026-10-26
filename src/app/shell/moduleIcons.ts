import { ShoppingCartIcon, LightbulbIcon, PaintRollerIcon, BlueprintIcon } from '@phosphor-icons/react';

export const MODULE_ICONS = {
  satinalma: ShoppingCartIcon,
  aydinlatma: LightbulbIcon,
  tadilat: PaintRollerIcon,
  yerlesim: BlueprintIcon,
} as const;

/** 320–359 px'te alt sekme etiketleri kısa (1 rem metin dört sekmeye sığsın); ≥360 px tam ad. */
export const MODULE_SHORT_LABELS: Record<keyof typeof MODULE_ICONS, string> = {
  satinalma: 'Liste',
  aydinlatma: 'Işık',
  tadilat: 'Tadilat',
  yerlesim: 'Yerleşim',
};
