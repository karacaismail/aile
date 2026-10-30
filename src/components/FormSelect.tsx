import type { SelectProps } from '@mantine/core';
import { Select } from '../dashboard/Select';

// A portal keeps the same branded menu clear of scrolling form/dialog containers.
export function FormSelect(props: SelectProps) {
  return <Select {...props} comboboxProps={{ ...props.comboboxProps, withinPortal: true }} />;
}
