import { ActionIcon, Affix } from '@mantine/core';
import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus';

export function Fab({ onClick, label = 'Ekle' }: { onClick: () => void; label?: string }) {
  return (
    <Affix position={{ bottom: 'var(--aile-fab-bottom)', right: 'var(--aile-fab-right)' }} zIndex={150}>
      <ActionIcon size={56} radius="xl" variant="filled" color="ember" aria-label={label} onClick={onClick} data-testid="fab" style={{ boxShadow: 'var(--mantine-shadow-md)' }}>
        <PlusIcon size={28} weight="bold" aria-hidden />
      </ActionIcon>
    </Affix>
  );
}
