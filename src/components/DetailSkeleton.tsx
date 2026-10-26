import { Skeleton, Stack } from '@mantine/core';

/** Detay modalı: kayıt henüz gelmediyse (ilk okuma sürüyor) form yerine iskelet; form kayıt çözülmeden kurulmaz. */
export function DetailSkeleton({ testId }: { testId?: string }) {
  return (
    <Stack gap="sm" data-testid={testId} aria-busy="true" aria-label="Yükleniyor">
      <Skeleton h={44} radius="md" />
      <Skeleton h={44} radius="md" />
      <Skeleton h={44} radius="md" />
      <Skeleton h={120} radius="md" />
    </Stack>
  );
}
