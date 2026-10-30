import { Chip, type ChipProps } from '@mantine/core';
import { CheckIcon } from '@phosphor-icons/react/dist/csr/Check';
import { XIcon } from '@phosphor-icons/react/dist/csr/X';
import { Dot } from '@/components/badges';
import classes from './filter.module.css';

export interface FilterChipProps {
  label: string;
  /** "Bu çip açıkken kaç kalem" — yoksa yalnız etiket. */
  count?: number;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Seçili durumda gösterilen ikon: onay (varsayılan) ya da kaldır (aktif facet çipi). */
  icon?: 'check' | 'x';
  disabled?: boolean;
  /** Durum çipleri için renkli nokta (DurumBadge ile aynı dil). */
  dot?: string;
  'data-testid'?: string;
  'aria-label'?: string;
  size?: ChipProps['size'];
}

const ICON_VARS = { root: { '--chip-icon-size': '16px', '--chip-spacing': '6px' } };

/**
 * Tek filtre ilkesi: her yerde aynı çip. Görünüm `src/styles.css` genel çip kurallarından gelir
 * (seçisiz kenarlıklı, seçili dolu + ikon). Erişilebilir ad = görünen metin ("Fiyatsız 12").
 */
export function FilterChip({ label, count, checked, onChange, icon = 'check', disabled, dot, size = 'sm', ...rest }: FilterChipProps) {
  const Icon = icon === 'x' ? XIcon : CheckIcon;
  return (
    <Chip
      size={size} radius="xl" checked={checked} disabled={disabled} onChange={onChange}
      icon={<Icon size={16} weight="bold" aria-hidden data-testid={`chip-icon-${icon}`} />}
      vars={() => ICON_VARS}
      classNames={{ label: classes.chipLabel, iconWrapper: classes.chipIconWrap }}
      aria-label={rest['aria-label']}
      wrapperProps={{ 'data-testid': rest['data-testid'] } as Record<string, string>}
    >
      <span className={classes.chipInner}>
        {dot && <span className={classes.chipDot}><Dot color={dot} /></span>}
        <span className={classes.chipText}>{label}</span>
        {count != null && <>{' '}<span className={`${classes.chipCount} tabular`}>{count}</span></>}
      </span>
    </Chip>
  );
}
