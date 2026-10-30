import { ActionIcon, Anchor, Group, Stack, Text, TextInput } from '@mantine/core';
import { ArrowSquareOutIcon } from '@phosphor-icons/react/dist/csr/ArrowSquareOut';
import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus';
import { TrashIcon } from '@phosphor-icons/react/dist/csr/Trash';
import { useState } from 'react';

export function LinksField({ value, onChange, label = 'Linkler' }: { value: string[]; onChange: (v: string[]) => void; label?: string }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const s = draft.trim();
    if (!s) return;
    if (!value.includes(s)) onChange([...value, s]);
    setDraft('');
  };
  return (
    <Stack gap={6}>
      <Text size="sm" fw={500}>{label}</Text>
      {value.map((u) => (
        <Group key={u} gap={4} wrap="nowrap">
          <Anchor href={u} target="_blank" rel="noreferrer" size="sm" lineClamp={1} style={{ flex: 1 }} data-inline-link>
            {u.replace(/^https?:\/\//, '')}
          </Anchor>
          <ActionIcon component="a" href={u} target="_blank" rel="noreferrer" aria-label="Linki aç" color="gray">
            <ArrowSquareOutIcon size={20} aria-hidden />
          </ActionIcon>
          <ActionIcon aria-label="Linki sil" color="red" onClick={() => onChange(value.filter((x) => x !== u))}>
            <TrashIcon size={20} aria-hidden />
          </ActionIcon>
        </Group>
      ))}
      <Group gap={4} wrap="nowrap">
        <TextInput
          style={{ flex: 1 }}
          placeholder="https://…"
          inputMode="url"
          value={draft}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          aria-label="Yeni link"
        />
        <ActionIcon aria-label="Link ekle" variant="light" onClick={add}>
          <PlusIcon size={20} aria-hidden />
        </ActionIcon>
      </Group>
    </Stack>
  );
}
