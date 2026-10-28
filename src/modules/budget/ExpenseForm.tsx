import { useMemo, useState } from 'react';
import { Modal, Stack, TextInput, Button, Group, Chip, NativeSelect, Alert, Text, Box } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { useMediaQuery } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { FloppyDiskIcon, TrashIcon } from '@phosphor-icons/react';
import { useAppStore } from '@/sync/store';
import { upsert, remove } from '@/sync/controller';
import { PriceInput } from '@/components/PriceInput';
import { formatTl } from '@/lib/price';
import { todayIso } from '@/lib/dates';
import { kalemOptions, quickKalems, normKalem, OTHER_GROUP } from './rules';
import { closeExpense, useExpenseTarget, type ExpenseTarget } from './quick';
import classes from './budget.module.css';

/** Tek örnek, kabukta durur: hangi ekrandan açılırsa açılsın aynı form. */
export function ExpenseHost() {
  const target = useExpenseTarget();
  const isMobile = useMediaQuery('(max-width: 48em)', true);
  return (
    <Modal
      opened={!!target}
      onClose={closeExpense}
      title={target?.id ? 'Harcamayı düzenle' : 'Harcama ekle'}
      fullScreen={isMobile}
      closeButtonProps={{ size: 'xl', 'aria-label': 'Kapat' }}
      padding="sm"
    >
      {target && <ExpenseForm key={target.id ?? `yeni:${target.kalem ?? ''}`} target={target} />}
    </Modal>
  );
}

function ExpenseForm({ target }: { target: ExpenseTarget }) {
  const plan = useAppStore((s) => s.plan);
  const cash = useAppStore((s) => s.cash);
  const supported = useAppStore((s) => s.cashSupported);
  const entry = useMemo(() => (target.id ? cash.find((c) => c.id === target.id) : undefined), [cash, target.id]);
  const lastKalem = useMemo(() => [...cash].filter((c) => !c.deleted_at).sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))[0]?.kalem, [cash]);

  const [tutar, setTutar] = useState<number | null>(entry?.tutar ?? null);
  const [kalem, setKalem] = useState<string>(normKalem(entry?.kalem ?? target.kalem ?? lastKalem ?? ''));
  const [tarih, setTarih] = useState<string>(entry?.tarih ?? todayIso());
  const [not, setNot] = useState(entry?.not ?? '');
  const [error, setError] = useState<string | null>(null);

  const options = useMemo(() => kalemOptions(plan, cash), [plan, cash]);
  const month = Number(tarih.slice(5, 7)) || 1;
  const chips = useMemo(() => quickKalems(plan, cash, kalem || undefined, month, 4), [plan, cash, kalem, month]);
  const groups = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const o of options) m.set(o.group, [...(m.get(o.group) ?? []), o.label]);
    return [...m.entries()].map(([group, items]) => ({ group, items }));
  }, [options]);

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!tutar || tutar <= 0) { setError('Tutar girin'); return; }
    const k = normKalem(kalem);
    if (!k) { setError('Kalem seçin'); return; }
    upsert('nakit', entry?.id, { tarih, tutar, kalem: k, not: not.trim() || null });
    notifications.show({ message: `${formatTl(tutar)} · ${k}`, color: 'green', autoClose: 1500 });
    closeExpense();
  };
  const del = () => {
    if (!entry) return;
    remove('nakit', entry.id);
    notifications.show({ message: 'Harcama silindi', color: 'gray', autoClose: 1500 });
    closeExpense();
  };

  return (
    <form onSubmit={save} data-testid="expense-form" noValidate>
      <Stack gap="sm">
        {supported === false && (
          <Alert color="yellow" title="Tablo tarafı güncellenmedi">
            Harcama günlüğü sekmesi henüz kurulmadı; kurulana kadar kayıt eklenemez.
          </Alert>
        )}
        <PriceInput
          label="Tutar"
          value={tutar}
          onChange={(v) => { setTutar(v); setError(null); }}
          size="lg"
          data-autofocus
          required
          error={error === 'Tutar girin' ? error : undefined}
        />
        {chips.length > 0 && (
          <Stack gap={4}>
            <Text fw={500} id="kalem-chips">Kalem</Text>
            <Chip.Group value={kalem} onChange={(v) => { setKalem(String(v)); setError(null); }}>
              <Group gap={8} aria-labelledby="kalem-chips" role="radiogroup">
                {chips.map((k) => <Chip key={k} value={k} data-testid={`kalem-chip-${k}`} classNames={{ label: classes.chipLabel }}>{k}</Chip>)}
              </Group>
            </Chip.Group>
          </Stack>
        )}
        {groups.length > 0 ? (
          <NativeSelect
            label={chips.length ? 'Tüm kalemler' : 'Kalem'}
            value={kalem}
            onChange={(e) => { setKalem(e.currentTarget.value); setError(null); }}
            error={error === 'Kalem seçin' ? error : undefined}
            data-testid="kalem-select"
          >
            <option value="">Seçin</option>
            {groups.map((g) => (
              <optgroup key={g.group} label={g.group === OTHER_GROUP ? OTHER_GROUP : g.group}>
                {g.items.map((k) => <option key={k} value={k}>{k}</option>)}
              </optgroup>
            ))}
          </NativeSelect>
        ) : (
          <TextInput label="Kalem" value={kalem} onChange={(e) => setKalem(e.currentTarget.value)} error={error === 'Kalem seçin' ? error : undefined} />
        )}
        <DatePickerInput
          label="Tarih"
          value={tarih}
          onChange={(v) => v && setTarih(String(v).slice(0, 10))}
          valueFormat="D MMM YYYY"
          dropdownType="modal"
        />
        <TextInput label="Not" placeholder="İsteğe bağlı" value={not} onChange={(e) => setNot(e.currentTarget.value)} />
        {/* Kaydet her zaman başparmak altında: 320×480'de form uzasa da alta yapışık kalır. */}
        <Box className={classes.saveBar}>
          <Group gap="xs" wrap="nowrap" grow>
            {entry && (
              <Button variant="default" color="red" leftSection={<TrashIcon size={20} aria-hidden />} onClick={del} data-testid="expense-delete">
                Sil
              </Button>
            )}
            <Button type="submit" size="md" disabled={supported === false} leftSection={<FloppyDiskIcon size={20} aria-hidden />} data-testid="expense-save">
              Kaydet
            </Button>
          </Group>
        </Box>
      </Stack>
    </form>
  );
}
