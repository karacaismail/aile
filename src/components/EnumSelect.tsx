import { NativeSelect, type NativeSelectProps } from '@mantine/core';
import { label } from '@shared/schema';

export function EnumSelect({ field, options, value, onChange, allowEmpty = true, ...rest }: {
  field: string;
  options: readonly string[];
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  allowEmpty?: boolean;
} & Omit<NativeSelectProps, 'value' | 'onChange' | 'data'>) {
  const data = [
    ...(allowEmpty ? [{ value: '', label: '—' }] : []),
    ...options.map((o) => ({ value: o, label: label(field, o) })),
  ];
  return (
    <NativeSelect data={data} value={value ?? ''} onChange={(e) => onChange(e.currentTarget.value || undefined)} {...rest} />
  );
}
