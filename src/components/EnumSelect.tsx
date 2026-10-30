import type { SelectProps } from '@mantine/core';
import { FormSelect } from './FormSelect';
import { label } from '@shared/schema';

export function EnumSelect({ field, options, value, onChange, allowEmpty = true, ...rest }: {
  field: string;
  options: readonly string[];
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  allowEmpty?: boolean;
} & Omit<SelectProps, 'value' | 'onChange' | 'data'>) {
  const data = [
    ...(allowEmpty ? [{ value: '', label: '—' }] : []),
    ...options.map((o) => ({ value: o, label: label(field, o) })),
  ];
  return (
    <FormSelect data={data} value={value ?? ''} allowDeselect={false} onChange={(next) => onChange(next || undefined)} {...rest} />
  );
}
