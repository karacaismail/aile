import { Group } from '@mantine/core';
import { ITEM_COLUMN_MAP, label as schemaLabel } from '@shared/schema';
import { UNSET } from '@/data/selectors';
import { FilterChip } from './FilterChip';

export interface FacetChipsProps {
  field: string;
  /** Seçenek → sayım (sıfırlar yok). Seçili ama haritada olmayan değer "0" ile yine gösterilir (seçim bırakılabilsin). */
  options: ReadonlyMap<string, number>;
  value: string[];
  onChange: (next: string[]) => void;
  labelOf?: (v: string) => string;
  dotOf?: (v: string) => string | undefined;
  testIdPrefix?: string;
}

export function facetLabel(field: string, v: string, withField = false): string {
  if (v !== UNSET) return schemaLabel(field, v);
  return withField ? `${ITEM_COLUMN_MAP.get(field)?.label ?? field}: Belirsiz` : 'Belirsiz';
}

export function FacetChips({ field, options, value, onChange, labelOf, dotOf, testIdPrefix }: FacetChipsProps) {
  const entries: Array<[string, number]> = [...options.entries()];
  for (const v of value) if (!options.has(v)) entries.push([v, 0]);
  const toggle = (v: string, on: boolean) => onChange(on ? [...value.filter((x) => x !== v), v] : value.filter((x) => x !== v));
  return (
    <Group gap={6} wrap="wrap">
      {entries.map(([v, n]) => (
        <FilterChip
          key={v || '__unset'} label={(labelOf ?? ((x) => facetLabel(field, x)))(v)} count={n} checked={value.includes(v)}
          onChange={(on) => toggle(v, on)} dot={dotOf?.(v)} data-testid={testIdPrefix ? `${testIdPrefix}-${v || 'belirsiz'}` : undefined}
        />
      ))}
    </Group>
  );
}
