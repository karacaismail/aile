import { useId } from 'react';
import { Badge, Button, Group, Stack, Text } from '@mantine/core';
import type { ReactNode } from 'react';

/** Sayfa bölümü: başlık + seçili sayısı + (seçim varken) Temizle. */
export function FilterSection({ title, selectedCount = 0, onClear, children, hint }: { title: string; selectedCount?: number; onClear?: () => void; children: ReactNode; hint?: string }) {
  const id = useId();
  return (
    <Stack gap={6} role="group" aria-labelledby={id}>
      <Group justify="space-between" wrap="nowrap" gap="xs" style={{ minHeight: 32 }}>
        <Group gap={6} wrap="nowrap">
          <Text id={id} fw={600}>{title}</Text>
          {selectedCount > 0 && <Badge variant="default" className="tabular" aria-label={`${selectedCount} seçili`}>{selectedCount}</Badge>}
        </Group>
        {selectedCount > 0 && onClear && (
          <Button variant="subtle" color="ember" size="compact-sm" onClick={onClear} aria-label={`Temizle: ${title}`}>Temizle</Button>
        )}
      </Group>
      {children}
      {hint && <Text>{hint}</Text>}
    </Stack>
  );
}
