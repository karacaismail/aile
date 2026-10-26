import { useState } from 'react';
import { Accordion, Box, Button, Checkbox, CopyButton, Group, NumberInput, Progress, Stack, Text } from '@mantine/core';
import { CheckIcon, CopyIcon } from '@phosphor-icons/react';
import type { Item } from '@shared/schema';
import { label } from '@shared/schema';
import { useAppStore, type AppState } from '@/sync/store';
import { upsert } from '@/sync/controller';
import { KONTROL_TUR_ORDER, checklistProgress, checklistText, groupChecks } from './rules';
import classes from './renovation.module.css';

const selectChecks = (s: AppState): Item[] => s.items.filter((i) => !i.deleted_at && i.tip === 'kontrol');

function CheckRow({ item }: { item: Item }) {
  const [draft, setDraft] = useState<string | number>(item.olcum_deger ?? '');
  const commit = () => {
    const n = draft === '' ? null : Number(draft);
    if (Number.isNaN(n)) return;
    if ((n ?? null) !== (item.olcum_deger ?? null)) upsert('kalemler', item.id, { olcum_deger: n });
  };
  return (
    <Stack gap={4}>
      <Checkbox.Card className={classes.checkRow} checked={!!item.tamam} onChange={(c) => upsert('kalemler', item.id, { tamam: c })} radius="md" p="xs" withBorder data-testid="kontrol-row">
        <Group wrap="nowrap" align="flex-start" gap="xs">
          <Checkbox.Indicator size="md" mt={2} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <Text size="sm" fw={500} td={item.tamam ? 'line-through' : undefined} c={item.tamam ? 'dimmed' : undefined}>{item.ad}</Text>
            {(item.esik || item.olcum_birim) && <Text size="xs" c="dimmed">eşik: {item.esik ?? ''}{item.olcum_birim ? ` ${item.olcum_birim}` : ''}</Text>}
            {item.not && <Text size="xs" c="dimmed" lineClamp={2} data-allow-clamp>{item.not}</Text>}
          </div>
        </Group>
      </Checkbox.Card>
      {item.kontrol_tur === 'kabul' && (
        <NumberInput className={classes.measure} aria-label={`Ölçüm: ${item.ad}`} placeholder="Ölçüm" hideControls inputMode="decimal" decimalSeparator="," size="sm"
          rightSection={item.olcum_birim ? <Text size="xs" c="dimmed">{item.olcum_birim}</Text> : undefined} rightSectionWidth={item.olcum_birim ? 44 : undefined}
          value={draft} onChange={setDraft} onBlur={commit} />
      )}
    </Stack>
  );
}

/** Kontrol: tür başına akordeon (şartname, kabul, izin, ev seçimi); meslek alt grupları; tamam toggle; kopyalanabilir düz metin. */
export function ChecklistScreen() {
  const checks = useAppStore(selectChecks);
  const groups = groupChecks(checks);
  return (
    <Box pb={96} px={6} pt="xs" className={classes.checklist}>
      <Accordion multiple defaultValue={['sartname']} keepMounted={false} chevronPosition="right" variant="separated" radius="md"
        styles={{ content: { paddingInline: 6, paddingBottom: 8 }, label: { paddingBlock: 10 } }}>
        {KONTROL_TUR_ORDER.map((tur) => {
          const sub = groups.get(tur) ?? new Map<string, Item[]>();
          const all = [...sub.values()].flat();
          const prog = checklistProgress(all);
          const pct = prog.total ? Math.round((prog.done / prog.total) * 100) : 0;
          return (
            <Accordion.Item key={tur} value={tur}>
              <Accordion.Control>
                <Group justify="space-between" wrap="nowrap" gap="xs">
                  <Text fw={600} size="sm">{label('kontrol_tur', tur)}</Text>
                  <Text size="xs" c="dimmed" className="tabular" data-testid={`progress-${tur}`}>{prog.done}/{prog.total}</Text>
                </Group>
                <Progress value={pct} size="xs" mt={6} color={pct === 100 ? 'teal.8' : 'ember.7'} aria-label={`${label('kontrol_tur', tur)} ilerleme %${pct}`} />
              </Accordion.Control>
              <Accordion.Panel>
                <Stack gap="sm" data-testid={`group-${tur}`}>
                  {all.length === 0 && <Text size="sm" c="dimmed">Madde yok.</Text>}
                  {[...sub.entries()].map(([meslek, items]) => (
                    <Stack key={meslek} gap={6}>
                      <Group justify="space-between" wrap="nowrap" gap="xs">
                        <Text size="sm" fw={600}>{meslek === 'genel' ? 'Genel' : label('meslek', meslek)}</Text>
                        <CopyButton value={checklistText(items)} timeout={1500}>
                          {({ copied, copy }) => (
                            <Button size="xs" variant="subtle" color={copied ? 'teal' : 'ember'} onClick={copy} leftSection={copied ? <CheckIcon size={16} aria-hidden /> : <CopyIcon size={16} aria-hidden />}>
                              {copied ? 'Kopyalandı' : 'Metni kopyala'}
                            </Button>
                          )}
                        </CopyButton>
                      </Group>
                      {items.map((i) => <CheckRow key={i.id} item={i} />)}
                    </Stack>
                  ))}
                </Stack>
              </Accordion.Panel>
            </Accordion.Item>
          );
        })}
      </Accordion>
    </Box>
  );
}
