import { NumberInput, type NumberInputProps } from '@mantine/core';

export type PriceInputProps = Omit<NumberInputProps, 'value' | 'onChange'> & {
  value: number | null | undefined;
  onChange: (v: number | null) => void;
};

/** TL girişi: "₺ " öneki, Türkçe ayraçlar, sayısal klavye. Boş → null. */
export function PriceInput({ value, onChange, ...rest }: PriceInputProps) {
  return (
    <NumberInput
      prefix="₺ "
      thousandSeparator="."
      decimalSeparator=","
      decimalScale={2}
      allowNegative={false}
      min={0}
      hideControls
      inputMode="decimal"
      value={value ?? ''}
      onChange={(v) => onChange(v === '' || v === null || v === undefined ? null : Number(v))}
      {...rest}
    />
  );
}
