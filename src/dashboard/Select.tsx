import { useState } from 'react';
import { Select as MantineSelect, type SelectProps } from '@mantine/core';
import { useReducedMotion } from '@mantine/hooks';
import { dropdownTransition, tokens } from './tokens';

// Close semantics immediately while the visible panel finishes its exit motion.
export function Select(props: SelectProps) {
  const [opened, setOpened] = useState(false);
  const reduced = useReducedMotion();
  return <MantineSelect {...props} dropdownOpened={opened} withScrollArea={false}
    onDropdownOpen={() => { setOpened(true); props.onDropdownOpen?.(); }}
    onDropdownClose={() => { setOpened(false); props.onDropdownClose?.(); }}
    attributes={{ ...props.attributes, dropdown: { ...props.attributes?.dropdown, 'aria-hidden': !opened, inert: !opened ? true : undefined } }}
    comboboxProps={{ ...props.comboboxProps, withinPortal: false, transitionProps: {
      duration: reduced ? 0 : tokens.duration, timingFunction: tokens.ease, transition: dropdownTransition,
    } }} />;
}
