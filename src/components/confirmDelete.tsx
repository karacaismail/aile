import type { ReactNode } from 'react';
import { Text } from '@mantine/core';
import { modals } from '@mantine/modals';

// Every Mantine modal listens for Escape on the window, and the record modal underneath registered first, so one Escape
// would close both and drop the user's draft. While a confirmation is open the record modal ignores close requests.
let confirming = 0;
export const unlessConfirming = (close: () => void) => () => { if (!confirming) close(); };

/**
 * Delete confirmation over a record's route modal. The record is removed on confirm, but the route modal closes only
 * after the confirmation has finished leaving (Mantine's exit transition; immediate with reduced motion). Closing it
 * earlier lets the confirmation's focus trap take back the focus the route modal returns, leaving it on <body>.
 */
export function confirmDelete({ title, body, onDelete, onClosed }: { title: string; body: ReactNode; onDelete: () => void; onClosed: () => void }) {
  let deleted = false;
  confirming += 1;
  modals.openConfirmModal({
    title, children: <Text size="sm">{body}</Text>,
    labels: { confirm: 'Sil', cancel: 'Vazgeç' }, confirmProps: { color: 'red' },
    onConfirm: () => { onDelete(); deleted = true; },
    // Released after this event has reached every window listener, so the same Escape cannot close the record.
    onClose: () => { setTimeout(() => { confirming = Math.max(0, confirming - 1); }); },
    onExitTransitionEnd: () => { if (deleted) onClosed(); },
  });
}
