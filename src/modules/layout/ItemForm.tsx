import { useMemo, useState } from 'react';
import { Alert, Button, Checkbox, Group, Modal, NumberInput, ScrollArea, SegmentedControl, SimpleGrid, Stack, Switch, Text, TextInput, Textarea } from '@mantine/core';
import { useForm, schemaResolver } from '@mantine/form';
import { useMediaQuery } from '@mantine/hooks';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { FloppyDiskIcon, MagnifyingGlassIcon, TrashIcon } from '@phosphor-icons/react';
import { z } from 'zod';
import { useLocation } from 'wouter';
import type { Item, Oda } from '@shared/schema';
import { label } from '@shared/schema';
import { useAppStore, type AppState } from '@/sync/store';
import { upsert, remove } from '@/sync/controller';
import { selectFirstLoad } from '@/data/selectors';
import { DetailSkeleton } from '@/components/DetailSkeleton';
import { OdaBadge } from '@/components/badges';
import { WALL_KEYS, toFormValues, toItemPatch, type LayoutFormValues, type WallKey } from './rules';
import classes from './layout.module.css';

const schema = z.object({
  ad: z.string().trim().min(1, 'Ad gerekli'),
  en_cm: z.number().min(0, '0 ya da üstü').nullable(),
  boy_cm: z.number().min(0, '0 ya da üstü').nullable(),
  yuk_cm: z.number().min(0, '0 ya da üstü').nullable(),
  priz_ihtiyaci: z.number().int('Tam sayı').min(0, '0 ya da üstü').nullable(),
  kanal_m: z.number().min(0, '0 ya da üstü').nullable(),
});

const WALL_OPTIONS = WALL_KEYS.map((w) => ({ value: w, label: w === 'orta' ? 'Orta' : w }));

const selectPurchases = (s: AppState) => s.items.filter((i) => !i.deleted_at && i.tip === 'satinalma');

/** Bağlı satınalma kalemi seçimi: arama + Checkbox.Card listesi (dokunma hedefi ≥44). Aynı odadakiler önce. */
function PurchasePicker({ oda, value, onChange }: { oda: Oda; value: string[]; onChange: (v: string[]) => void }) {
  const purchases = useAppStore(selectPurchases);
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const coll = new Intl.Collator('tr');
    const needle = q.trim().toLocaleLowerCase('tr');
    return purchases
      .filter((p) => !needle || p.ad.toLocaleLowerCase('tr').includes(needle) || value.includes(p.id))
      .sort((a, b) => Number(value.includes(b.id)) - Number(value.includes(a.id)) || Number(b.oda === oda) - Number(a.oda === oda) || coll.compare(a.ad, b.ad));
  }, [purchases, q, oda, value]);
  return (
    <Stack gap={6}>
      <Group justify="space-between" wrap="nowrap">
        <Text size="sm" fw={500}>Bağlı satınalma kalemleri</Text>
        {value.length > 0 && <Text size="xs" c="dimmed">{value.length} seçili</Text>}
      </Group>
      {purchases.length === 0 ? (
        <Text size="sm" c="dimmed">Satınalma kalemi yok.</Text>
      ) : (
        <>
          {purchases.length > 6 && (
            <TextInput placeholder="Satınalma ara" aria-label="Satınalma ara" type="search" value={q} onChange={(e) => setQ(e.currentTarget.value)} leftSection={<MagnifyingGlassIcon size={18} aria-hidden />} />
          )}
          <Checkbox.Group value={value} onChange={onChange}>
            <ScrollArea.Autosize mah={220} type="auto" offsetScrollbars>
              <Stack gap={4}>
                {list.map((p) => (
                  <Checkbox.Card key={p.id} value={p.id} withBorder radius="md" px="xs" py={4} className={classes.pick} aria-label={p.ad}>
                    <Group wrap="nowrap" gap="xs" align="center" style={{ width: '100%' }}>
                      <Checkbox.Indicator />
                      <Text size="sm" lineClamp={1} data-allow-clamp style={{ flex: 1, minWidth: 0 }}>{p.ad}</Text>
                      <OdaBadge value={p.oda} />
                    </Group>
                  </Checkbox.Card>
                ))}
                {list.length === 0 && <Text size="sm" c="dimmed">Eşleşen kalem yok.</Text>}
              </Stack>
            </ScrollArea.Autosize>
          </Checkbox.Group>
        </>
      )}
    </Stack>
  );
}

type NumKey = 'en_cm' | 'boy_cm' | 'yuk_cm' | 'priz_ihtiyaci' | 'kanal_m';

const modalCloseProps = { size: 'xl' as const, 'aria-label': 'Kapat' };

/** Kayıt çözülmeden form kurulmaz: yükleniyorsa iskelet, bulunamadıysa uyarı; aksi halde gövde `key` = kayıt kimliği. */
export function ItemForm({ oda, id }: { oda: Oda; id: string }) {
  const [, navigate] = useLocation();
  const isNew = id === 'yeni';
  const selectItem = useMemo(() => (s: AppState) => (isNew ? undefined : s.items.find((i) => i.id === id && i.tip === 'yerlesim')), [isNew, id]);
  const item = useAppStore(selectItem);
  const loading = useAppStore(selectFirstLoad);
  const isMobile = useMediaQuery('(max-width: 48em)', true);
  const close = () => navigate(`~/yerlesim/${oda}`);
  if (!isNew && !item) {
    return (
      <Modal opened onClose={close} title="Yerleşim kalemi" fullScreen={isMobile} size="lg" closeButtonProps={modalCloseProps}>
        {loading ? <DetailSkeleton testId="layout-item-form-loading" /> : <Alert color="yellow">Kalem bulunamadı (silinmiş ya da henüz eşitlenmemiş olabilir).</Alert>}
      </Modal>
    );
  }
  return <ItemFormBody key={item?.id ?? 'yeni'} oda={oda} item={item} onClose={close} />;
}

function ItemFormBody({ oda, item, onClose }: { oda: Oda; item?: Item; onClose: () => void }) {
  const isNew = !item;
  const isMobile = useMediaQuery('(max-width: 48em)', true);
  // initialValues yalnız mount'ta okunur; bileşen kayıt kimliğiyle anahtarlandığından sunucu güncellemesi düzenlemeyi ezmez.
  const form = useForm<LayoutFormValues>({ mode: 'controlled', initialValues: toFormValues(item), validate: schemaResolver(schema, { sync: true }) });

  const save = (values: LayoutFormValues) => {
    upsert('kalemler', item?.id, toItemPatch(values, oda, item));
    notifications.show({ message: isNew ? 'Kalem eklendi' : 'Kaydedildi', color: 'green', autoClose: 1500 });
    onClose();
  };
  const del = () => modals.openConfirmModal({
    title: 'Kalemi sil?',
    children: <Text size="sm">"{item?.ad}" yerleşimden kaldırılır (Sheets'te silinmiş olarak işaretlenir).</Text>,
    labels: { confirm: 'Sil', cancel: 'Vazgeç' }, confirmProps: { color: 'red' },
    onConfirm: () => { if (item) remove('kalemler', item.id); notifications.show({ message: 'Silindi', color: 'gray', autoClose: 1500 }); onClose(); },
  });

  const num = (k: NumKey, lbl: string, mode: 'numeric' | 'decimal' = 'numeric') => (
    <NumberInput
      label={lbl} min={0} inputMode={mode} hideControls decimalSeparator="," decimalScale={mode === 'decimal' ? 1 : 0} allowNegative={false}
      value={form.getValues()[k] ?? ''} onChange={(v) => form.setFieldValue(k, v === '' ? null : Number(v))} error={form.errors[k]}
    />
  );

  return (
    <Modal opened onClose={onClose} title={isNew ? `Yeni kalem · ${label('oda', oda)}` : label('oda', oda)} fullScreen={isMobile} size="lg"
      closeButtonProps={modalCloseProps} styles={{ body: { paddingBottom: 96 } }}>
      <form onSubmit={form.onSubmit(save)} noValidate data-testid="layout-item-form">
        <Stack gap="sm">
          <TextInput label="Ad" required autoFocus={isNew} {...form.getInputProps('ad')} key={form.key('ad')} />
          <div>
            <Text size="sm" fw={500} mb={4} id="duvar-label">Duvar</Text>
            <SegmentedControl fullWidth aria-labelledby="duvar-label" data={WALL_OPTIONS} value={form.getValues().duvar} onChange={(v) => form.setFieldValue('duvar', v as WallKey)} />
          </div>
          <SimpleGrid cols={3} spacing="xs">
            {num('en_cm', 'En (cm)')}
            {num('boy_cm', 'Boy (cm)')}
            {num('yuk_cm', 'Yük. (cm)')}
          </SimpleGrid>
          <Switch label="Elimizde var" {...form.getInputProps('mevcut', { type: 'checkbox' })} key={form.key('mevcut')} />
          <SimpleGrid cols={2} spacing="xs">
            {num('priz_ihtiyaci', 'Priz ihtiyacı')}
            {num('kanal_m', 'Kanal (m)', 'decimal')}
          </SimpleGrid>
          <TextInput label="Işık ihtiyacı" placeholder="ör. raf aydınlatması" {...form.getInputProps('isik_ihtiyaci')} key={form.key('isik_ihtiyaci')} />
          <PurchasePicker oda={oda} value={form.getValues().bagli_idler} onChange={(v) => form.setFieldValue('bagli_idler', v)} />
          <Textarea label="Not" autosize minRows={3} {...form.getInputProps('not')} key={form.key('not')} />
          {item?.updated_by && <Text size="xs" c="dimmed">Son güncelleme: {item.updated_by}</Text>}
          <Group justify="space-between" mt="sm" style={{ position: 'sticky', bottom: 0, background: 'var(--mantine-color-body)', paddingTop: 8 }}>
            {!isNew ? (
              <Button variant="subtle" color="red" leftSection={<TrashIcon size={18} aria-hidden />} onClick={del}>Sil</Button>
            ) : <span />}
            <Group gap="xs">
              <Button variant="default" onClick={onClose}>Vazgeç</Button>
              <Button type="submit" leftSection={<FloppyDiskIcon size={18} aria-hidden />}>Kaydet</Button>
            </Group>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
