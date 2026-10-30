import { useState } from 'react';
import { ActionIcon, Button, Drawer, Group, Indicator, Popover, Radio, Stack, Text } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { ArrowsDownUpIcon } from '@phosphor-icons/react/dist/csr/ArrowsDownUp';
import classes from './filter.module.css';

export interface SortOption<K extends string> { value: K; label: string; description?: string }

export interface SortControlProps<K extends string> {
  value: K;
  options: ReadonlyArray<SortOption<K>>;
  onChange: (v: K) => void;
  /** Varsayılan anahtar; farklıysa düğmede nokta göstergesi. */
  defaultValue?: K;
  hint?: string;
}

function SortOptions<K extends string>({ value, options, onPick, hint }: { value: K; options: ReadonlyArray<SortOption<K>>; onPick: (v: K) => void; hint?: string }) {
  return (
    <Radio.Group value={value} onChange={(v) => onPick(v as K)} aria-label="Sıralama">
      <Stack gap={6} data-testid="sort-sheet">
        {options.map((o) => (
          <Radio.Card key={o.value} value={o.value} radius="md" className={classes.radioRow} aria-label={o.label}>
            <Group wrap="nowrap" gap="sm" align="center">
              <Radio.Indicator />
              <div>
                <Text fw={600}>{o.label}</Text>
                {o.description && <Text>{o.description}</Text>}
              </div>
            </Group>
          </Radio.Card>
        ))}
        {hint && <Text>{hint}</Text>}
      </Stack>
    </Radio.Group>
  );
}

/**
 * Sıralama filtre değildir: ayrı düğme. 320 (dokunma): alttan küçük sayfa; ≥48em (işaretleyici): etiketli düğme + açılır kutu.
 * İki yolda da aynı radyo kartları (44 px); seçim anında uygulanır ve kapatır.
 */
export function SortControl<K extends string>({ value, options, onChange, defaultValue, hint }: SortControlProps<K>) {
  const wide = useMediaQuery('(min-width: 48em)', false, { getInitialValueInEffect: false });
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value) ?? options[0];
  const nonDefault = value !== (defaultValue ?? options[0]?.value);
  const name = `Sırala: ${current?.label ?? ''}`;
  const pick = (v: K) => { onChange(v); setOpen(false); };

  if (wide) {
    return (
      <Popover opened={open} onChange={setOpen} position="bottom-end" width={340} withinPortal trapFocus shadow="md">
        <Popover.Target>
          <Button variant="default" leftSection={<ArrowsDownUpIcon size={20} aria-hidden />} aria-haspopup="dialog" aria-expanded={open}
            onClick={() => setOpen((o) => !o)} data-testid="sort-button" style={{ flexShrink: 0 }}>
            {name}
          </Button>
        </Popover.Target>
        <Popover.Dropdown p="sm">
          <SortOptions value={value} options={options} onPick={pick} hint={hint} />
        </Popover.Dropdown>
      </Popover>
    );
  }
  return (
    <>
      <Indicator disabled={!nonDefault} color="ember" size={10} offset={6} processing={false} withBorder data-testid={nonDefault ? 'sort-indicator' : undefined}>
        <ActionIcon variant={nonDefault ? 'light' : 'subtle'} color={nonDefault ? 'ember' : 'gray'} aria-label={name} aria-haspopup="dialog" aria-expanded={open}
          onClick={() => setOpen(true)} data-testid="sort-button">
          <ArrowsDownUpIcon size={22} aria-hidden />
        </ActionIcon>
      </Indicator>
      <Drawer opened={open} onClose={() => setOpen(false)} position="bottom" size="auto" radius="lg" title="Sıralama" padding="sm"
        vars={() => ({ root: { '--drawer-size': 'auto' } })} /* Mantine 'auto' boyutu çözmez; içerik yüksekliği */
        closeButtonProps={{ size: 'xl', 'aria-label': 'Kapat' }} classNames={{ title: classes.sheetTitle }}>
        <SortOptions value={value} options={options} onPick={pick} hint={hint} />
      </Drawer>
    </>
  );
}
