import type { ReactNode } from 'react';
import { Button, Group, Stack, Text } from '@mantine/core';
import { FloppyDiskIcon } from '@phosphor-icons/react/dist/csr/FloppyDisk';
import { TrashIcon } from '@phosphor-icons/react/dist/csr/Trash';
import { tokens } from '@/dashboard/tokens';

type Errors = Record<string, ReactNode>;

/**
 * Gönderim doğrulaması başarısız olunca DOM sırasındaki ilk hatalı alana odaklan ve görünüme getir.
 * Alanlar Mantine `data-path` sözleşmesini taşır (`getInputProps` verir; `setFieldValue` ile bağlı alanlar açıkça yazar).
 */
export function focusFirstError(root: HTMLElement | null, errors: Errors): void {
  if (!root) return;
  const failing = new Set(Object.keys(errors).filter((k) => errors[k] != null && errors[k] !== false));
  const target = Array.from(root.querySelectorAll<HTMLElement>('[data-path]')).find((el) => failing.has(el.dataset.path ?? ''));
  if (!target) return;
  target.scrollIntoView?.({ block: 'center' });
  target.focus({ preventScroll: true });
}

/**
 * Kayıt formlarının ortak yapışkan alt çubuğu: hata sayısı (odak almadan duyurulur; bölge hep var, metin yalnız hata varken),
 * Sil (var olan kayıtta), Vazgeç ve Kaydet. Doğrulama ve kayıt kararı formun kendisinde kalır.
 */
export function FormFooter({ errors, onCancel, onDelete }: { errors: Errors; onCancel: () => void; onDelete?: () => void }) {
  const count = Object.values(errors).filter(Boolean).length;
  return (
    <Stack gap={tokens.spaceDense} mt="sm" pt={tokens.spaceTight} style={{ position: 'sticky', bottom: 0, background: 'var(--mantine-color-body)' }}>
      <Text component="p" role="status" aria-live="polite" size="sm" c="var(--mantine-color-error)" m={0} data-testid="form-errors">{count ? `${count} alan düzeltilmeli` : ''}</Text>
      <Group justify="space-between">
        {onDelete ? <Button variant="subtle" color="red" leftSection={<TrashIcon size={18} aria-hidden />} onClick={onDelete}>Sil</Button> : <span />}
        <Group gap="xs">
          <Button variant="default" onClick={onCancel}>Vazgeç</Button>
          <Button type="submit" leftSection={<FloppyDiskIcon size={18} aria-hidden />}>Kaydet</Button>
        </Group>
      </Group>
    </Stack>
  );
}
