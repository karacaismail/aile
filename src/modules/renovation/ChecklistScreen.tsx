import { useState } from 'react';
import { Accordion, Box, Skeleton, Button, Checkbox, CopyButton, Group, NumberInput, Progress, Stack, Text } from '@mantine/core';
import { CheckIcon } from '@phosphor-icons/react/dist/csr/Check';
import { CopyIcon } from '@phosphor-icons/react/dist/csr/Copy';
import type { Item } from '@shared/schema';
import { label } from '@shared/schema';
import { useAppStore, type AppState } from '@/sync/store';
import { FactList, SectionHeading } from '@/components/Info';
import { upsert } from '@/sync/controller';
import { KONTROL_TUR_ORDER, checklistProgress, checklistText, groupChecks } from './rules';
import { DraftConflict } from '@/components/DraftConflict';
import classes from './renovation.module.css';

const selectChecks = (s: AppState): Item[] => s.items.filter((i) => !i.deleted_at && i.tip === 'kontrol');
const selectMeta = (s: AppState) => ({ hydrated: s.hydrated, status: s.status });

const measureText = (v: number | null | undefined, unit?: string) => (v == null ? 'boş' : `${String(v).replace('.', ',')}${unit ? ` ${unit}` : ''}`);

/**
 * Ölçüm odak çıkınca yazılır. Dokunulmamış alan her zaman son kaynak değerini gösterir; düzenleme sırasında kaynak da
 * farklı bir değere geçtiyse yazılmaz, iki değer yan yana gösterilir ve kullanıcı birini seçer.
 */
function CheckRow({ item }: { item: Item }) {
  const latest = item.olcum_deger ?? null;
  // draft: kullanıcının yazdığı metin ve düzenlemeye başladığında kaynakta olan değer; null = dokunulmamış.
  const [draft, setDraft] = useState<{ text: string | number; base: number | null } | null>(null);
  const [conflict, setConflict] = useState<number | null | undefined>(undefined);
  const parsed = (text: string | number) => (text === '' ? null : Number(text));
  const commit = () => {
    if (!draft) return;
    const n = parsed(draft.text);
    if (Number.isNaN(n)) return;
    if (n === latest) { setDraft(null); return; }
    if (latest !== draft.base) { setConflict(n); return; }
    upsert('kalemler', item.id, { olcum_deger: n });
    setDraft(null);
  };
  const keep = (mine: boolean) => {
    if (mine) upsert('kalemler', item.id, { olcum_deger: conflict ?? null });
    setConflict(undefined); setDraft(null);
  };
  return (
    <Stack gap="xs">
      <Checkbox.Card className={classes.checkRow} checked={!!item.tamam} onChange={(c) => upsert('kalemler', item.id, { tamam: c })} radius="md" p="sm" data-testid="kontrol-row">
        <Group wrap="nowrap" align="flex-start" gap="xs">
          <Checkbox.Indicator size="md" mt="xs" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <Text size="sm" fw={500} td={item.tamam ? 'line-through' : undefined} c={item.tamam ? 'dimmed' : undefined}>{item.ad}</Text>
            {(item.esik || item.olcum_birim) && <Text size="xs" c="dimmed">eşik: {item.esik ?? ''}{item.olcum_birim ? ` ${item.olcum_birim}` : ''}</Text>}
            {item.not && <Text size="xs" c="dimmed" >{item.not}</Text>}
          </div>
        </Group>
      </Checkbox.Card>
      {item.kontrol_tur === 'kabul' && (
        <NumberInput className={classes.measure} aria-label={`Ölçüm: ${item.ad}`} placeholder="Ölçüm" hideControls inputMode="decimal" decimalSeparator="," size="sm"
          rightSection={item.olcum_birim ? <Text size="xs" c="dimmed">{item.olcum_birim}</Text> : undefined} rightSectionWidth={item.olcum_birim ? 44 : undefined}
          value={draft ? draft.text : latest ?? ''} onChange={(text) => setDraft((d) => ({ text, base: d ? d.base : latest }))} onBlur={commit} />
      )}
      {conflict !== undefined && (
        <DraftConflict fields={['olcum_deger']} label={() => `${item.ad} ölçümü`} onResolve={(choice) => keep(choice === 'mine')}
          mine={() => ({ value: measureText(conflict, item.olcum_birim) })} theirs={() => ({ value: measureText(latest, item.olcum_birim) })}
          actions={{ mine: `${measureText(conflict, item.olcum_birim)} kalsın`, theirs: `${measureText(latest, item.olcum_birim)} kalsın` }}
          note="Seçim hemen kaydedilir; yalnız bu ölçüm yazılır." />
      )}
    </Stack>
  );
}

/** Kontrol: tür başına akordeon (şartname, kabul, izin, ev seçimi); meslek alt grupları; tamam toggle; kopyalanabilir düz metin. */
export function ChecklistScreen() {
  const checks = useAppStore(selectChecks);
  const { hydrated, status } = useAppStore(selectMeta);
  const loading = !hydrated && status !== 'unconfigured';
  const groups = groupChecks(checks);
  const progress = checklistProgress(checks);
  // Kaynak okunmadan "Madde yok" ve 0 / 0 doğrulanmış boş liste gibi görünmesin.
  if (loading) {
    return (
      <Box pb="var(--aile-fab-clearance)" px="sm" pt="xs" className={classes.checklist} aria-busy="true">
        <Text role="status" size="sm" c="dimmed" data-testid="checklist-loading">Kontrol listesi yükleniyor…</Text>
        <Stack gap="xs" mt="sm" aria-hidden><Skeleton h={56} radius="md" /><Skeleton h={56} radius="md" /><Skeleton h={56} radius="md" /></Stack>
      </Box>
    );
  }
  return (
    <Box pb="var(--aile-fab-clearance)" px="sm" pt="xs" className={classes.checklist}>
      <FactList label="Kontrol özeti" tone="subtle" items={[{ label: 'Tamamlanan kontroller', value: `${progress.done} / ${progress.total}` }]} />
      <SectionHeading title="Kontrol başlıkları" description="Her başlıkta şartları, ölçümleri ve tamamlanma durumunu izleyin." />
      <Accordion multiple defaultValue={['sartname']} keepMounted={false} chevronPosition="right" variant="filled" radius="md"
        styles={{ content: { paddingInline: 'var(--budget-clearControl)', paddingBottom: 'var(--budget-clearControl)' }, label: { paddingBlock: 'var(--budget-clearControl)' } }}>
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
                <Progress value={pct} size="xs" mt="sm" color={pct === 100 ? 'teal.8' : 'ember.7'} aria-label={`${label('kontrol_tur', tur)} ilerleme %${pct}`} />
              </Accordion.Control>
              <Accordion.Panel>
                <Stack gap="sm" data-testid={`group-${tur}`}>
                  {all.length === 0 && <Text size="sm" c="dimmed">Madde yok.</Text>}
                  {[...sub.entries()].map(([meslek, items]) => (
                    <Stack key={meslek} gap="sm">
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
