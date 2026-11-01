import { useEffect, useRef, type ReactNode } from 'react';
import { Alert, Button, Group, Stack, Text } from '@mantine/core';

export type ConflictValue = { value: ReactNode; derived?: string };

/**
 * A same-field conflict found on Save: the user's draft and the newer stored value both changed one field.
 * Nothing is written until the user chooses; each side shows the stored meaning that was compared and would be
 * written. The heading takes focus so keyboard and screen-reader users land on the decision.
 */
export function DraftConflict({ fields, label, mine, theirs, onResolve, children, actions, note = 'Seçimden sonra Kaydet; değiştirmediğiniz alanlar yazılmaz.' }: {
  fields: readonly string[]; label: (field: string) => string; mine: (field: string) => ConflictValue; theirs: (field: string) => ConflictValue;
  onResolve: (keep: 'mine' | 'theirs') => void; children?: ReactNode;
  /** Button labels when the choice itself saves (a field that saves on blur names the values instead). */
  actions?: { mine: string; theirs: string }; note?: ReactNode;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const key = fields.join('|');
  useEffect(() => { if (key) heading.current?.focus(); }, [key]);
  if (!fields.length) return null;
  return (
    <Alert color="orange" variant="light" role="alert" data-testid="draft-conflict">
      <Stack gap={6}>
        <Text component="h4" ref={heading} tabIndex={-1} fw={600} m={0}>Bu alanları siz düzenlerken Sheets'te de değişti</Text>
        {children}
        {fields.map((field) => {
          const a = mine(field), b = theirs(field);
          return <Text key={field} size="sm"><b>{label(field)}</b>: sizin değeriniz <i>{a.value}</i>{a.derived && ` (${a.derived})`} · Sheets'teki <i>{b.value}</i>{b.derived && ` (${b.derived})`}</Text>;
        })}
        <Group gap="xs">
          <Button size="sm" variant="filled" onClick={() => onResolve('mine')}>{actions?.mine ?? 'Benim değerim kalsın'}</Button>
          <Button size="sm" variant="default" onClick={() => onResolve('theirs')}>{actions?.theirs ?? "Sheets'teki kalsın"}</Button>
        </Group>
        {note && <Text size="sm">{note}</Text>}
      </Stack>
    </Alert>
  );
}
