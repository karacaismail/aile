import { useMemo } from 'react';
import { Alert, Button, Chip, Divider, Group, Modal, NativeSelect, NumberInput, SimpleGrid, Stack, Switch, Text, TextInput, Textarea } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { useForm, schemaResolver } from '@mantine/form';
import { useMediaQuery } from '@mantine/hooks';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { FloppyDiskIcon, TrashIcon } from '@phosphor-icons/react';
import { z } from 'zod';
import { useLocation } from 'wouter';
import type { Item } from '@shared/schema';
import { DURUM, IS_KIM, IZIN_DURUMU, label } from '@shared/schema';
import { useAppStore, type AppState } from '@/sync/store';
import { upsert, remove } from '@/sync/controller';
import { selectFirstLoad } from '@/data/selectors';
import { EnumSelect } from '@/components/EnumSelect';
import { DetailSkeleton } from '@/components/DetailSkeleton';
import { TASK_DURUM_LABEL } from './rules';

const schema = z.object({
  ad: z.string().trim().min(1, 'Ad gerekli'),
  sure_gun: z.number().min(0).nullable(),
});

/** `bagimlilik` formda ham metindir ("T1, T2"); kaydederken ve odak çıkınca kodlara bölünür. */
export type TaskFormValues = {
  kod: string; ad: string; is_kim: string[]; planlanan_tarih: string | null; bitis_tarihi: string | null; sure_gun: number | null;
  bagimlilik: string; izin_gerekli: boolean; izin_durumu?: string; sartname: string; durum?: string; not: string;
};

export const splitDeps = (text: string): string[] => text.split(/[,\s]+/).map((d) => d.trim()).filter(Boolean);

function toForm(i?: Item): TaskFormValues {
  return {
    kod: i?.kod ?? '', ad: i?.ad ?? '', is_kim: i?.is_kim ?? [], planlanan_tarih: i?.planlanan_tarih ?? null, bitis_tarihi: i?.bitis_tarihi ?? null,
    sure_gun: i?.sure_gun ?? null, bagimlilik: (i?.bagimlilik ?? []).join(', '), izin_gerekli: !!i?.izin_gerekli, izin_durumu: i?.izin_durumu,
    sartname: i?.sartname ?? '', durum: i?.durum ?? (i ? undefined : 'fikir'), not: i?.not ?? '',
  };
}

/** Form → patch: boş alanlar null ile temizlenir; var olan kayıtta yalnız değişenler (tip hep kalır). */
export function toTaskPatch(v: TaskFormValues, prev?: Item): Record<string, unknown> {
  const deps = splitDeps(v.bagimlilik);
  const patch: Record<string, unknown> = {
    tip: 'tadilat', kod: v.kod.trim() || null, ad: v.ad.trim(), is_kim: v.is_kim.length ? v.is_kim : null,
    planlanan_tarih: v.planlanan_tarih, bitis_tarihi: v.bitis_tarihi, sure_gun: v.sure_gun, bagimlilik: deps.length ? deps : null,
    izin_gerekli: v.izin_gerekli, izin_durumu: v.izin_durumu ?? null, sartname: v.sartname.trim() || null, durum: v.durum ?? null, not: v.not.trim() || null,
  };
  if (prev) {
    for (const k of Object.keys(patch)) {
      const a = patch[k]; const b = (prev as unknown as Record<string, unknown>)[k];
      const eq = Array.isArray(a) ? JSON.stringify(a) === JSON.stringify(b ?? null) : (a ?? null) === (b ?? null) || (a === false && b === undefined);
      if (eq && k !== 'tip') delete patch[k];
    }
  }
  return patch;
}

const modalCloseProps = { size: 'xl' as const, 'aria-label': 'Kapat' };
// Temizle düğmesi de dokunma hedefi (≥44); sağ bölüm ona göre genişler.
const dateProps = { valueFormat: 'D MMM YYYY', dropdownType: 'modal' as const, clearable: true, clearButtonProps: { size: 'xl' as const, 'aria-label': 'Tarihi temizle' }, rightSectionWidth: 44 };

/** Kayıt çözülmeden form kurulmaz: yükleniyorsa iskelet, bulunamadıysa uyarı; aksi halde gövde `key` = kayıt kimliği. */
export function TaskDetail({ id }: { id: string }) {
  const [, navigate] = useLocation();
  const isNew = id === 'yeni';
  const selectItem = useMemo(() => (s: AppState) => (isNew ? undefined : s.items.find((i) => i.id === id)), [isNew, id]);
  const item = useAppStore(selectItem);
  const loading = useAppStore(selectFirstLoad);
  const isMobile = useMediaQuery('(max-width: 48em)', true);
  const close = () => navigate('~/tadilat/isler');
  if (!isNew && !item) {
    return (
      <Modal opened onClose={close} title="İş" fullScreen={isMobile} closeButtonProps={modalCloseProps}>
        {loading ? <DetailSkeleton testId="task-detail-loading" /> : <Alert color="yellow">İş bulunamadı (silinmiş ya da henüz eşitlenmemiş olabilir).</Alert>}
      </Modal>
    );
  }
  return <TaskDetailBody key={item?.id ?? 'yeni'} item={item} onClose={close} />;
}

function TaskDetailBody({ item, onClose }: { item?: Item; onClose: () => void }) {
  const isNew = !item;
  const isMobile = useMediaQuery('(max-width: 48em)', true);
  // initialValues yalnız mount'ta okunur; bileşen kayıt kimliğiyle anahtarlandığından sunucu güncellemesi düzenlemeyi ezmez.
  const form = useForm<TaskFormValues>({ mode: 'controlled', initialValues: toForm(item), validate: schemaResolver(schema, { sync: true }) });

  const save = (values: TaskFormValues) => {
    const patch = toTaskPatch(values, item);
    if (!isNew && Object.keys(patch).length <= 1) { onClose(); return; }
    upsert('kalemler', item?.id, patch);
    notifications.show({ message: isNew ? 'İş eklendi' : 'Kaydedildi', color: 'green', autoClose: 1500 });
    onClose();
  };
  const del = () => modals.openConfirmModal({
    title: 'İşi sil?', children: <Text size="sm">"{item?.ad}" listeden kaldırılır (Sheets'te silinmiş olarak işaretlenir).</Text>,
    labels: { confirm: 'Sil', cancel: 'Vazgeç' }, confirmProps: { color: 'red' },
    onConfirm: () => { if (item) remove('kalemler', item.id); notifications.show({ message: 'Silindi', color: 'gray', autoClose: 1500 }); onClose(); },
  });

  const v = form.getValues();
  const depsInput = form.getInputProps('bagimlilik');
  return (
    <Modal opened onClose={onClose} title={isNew ? 'Yeni iş' : 'İş'} fullScreen={isMobile} size="lg" transitionProps={{ transition: 'fade', duration: 120 }}
      closeButtonProps={modalCloseProps} styles={{ body: { paddingBottom: 96 } }}>
      <form onSubmit={form.onSubmit(save)} noValidate data-testid="task-detail">
        <Stack gap="sm">
          <Group gap="xs" wrap="nowrap" align="flex-start">
            <TextInput label="Kod" placeholder="T1" w={88} style={{ flexShrink: 0 }} {...form.getInputProps('kod')} key={form.key('kod')} />
            <TextInput label="Ad" required autoFocus={isNew} style={{ flex: 1 }} {...form.getInputProps('ad')} key={form.key('ad')} />
          </Group>
          <div>
            <Text size="sm" fw={500} mb={4}>İşi yapan</Text>
            <Chip.Group multiple value={v.is_kim} onChange={(val) => form.setFieldValue('is_kim', val)}>
              <Group gap={6}>
                {IS_KIM.map((k) => <Chip key={k} value={k} size="sm" variant="light">{label('is_kim', k)}</Chip>)}
              </Group>
            </Chip.Group>
          </div>
          <NativeSelect label="Durum" data={DURUM.map((d) => ({ value: d, label: TASK_DURUM_LABEL[d] ?? d }))} value={v.durum ?? 'fikir'} onChange={(e) => form.setFieldValue('durum', e.currentTarget.value)} />
          <Divider label="Zaman" labelPosition="left" />
          <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="xs">
            <DatePickerInput label="Planlanan tarih" {...dateProps} value={v.planlanan_tarih} onChange={(d) => form.setFieldValue('planlanan_tarih', d)} />
            <DatePickerInput label="Bitiş tarihi" {...dateProps} value={v.bitis_tarihi} onChange={(d) => form.setFieldValue('bitis_tarihi', d)} />
          </SimpleGrid>
          <NumberInput label="Süre (gün)" min={0} inputMode="numeric" hideControls value={v.sure_gun ?? ''} onChange={(n) => form.setFieldValue('sure_gun', n === '' ? null : Number(n))} error={form.errors.sure_gun} />
          <TextInput label="Bağımlılık (kodlar, virgülle)" placeholder="T1, T2" {...depsInput} key={form.key('bagimlilik')}
            onBlur={(e) => { depsInput.onBlur?.(e); form.setFieldValue('bagimlilik', splitDeps(e.currentTarget.value).join(', ')); }} />
          <Divider label="İzin" labelPosition="left" />
          <Switch label="İzin gerekli (ev sahibi / yönetim)" {...form.getInputProps('izin_gerekli', { type: 'checkbox' })} key={form.key('izin_gerekli')} />
          {v.izin_gerekli && <EnumSelect label="İzin durumu" field="izin_durumu" options={IZIN_DURUMU} value={v.izin_durumu} onChange={(x) => form.setFieldValue('izin_durumu', x)} />}
          <Textarea label="Şartname" autosize minRows={2} {...form.getInputProps('sartname')} key={form.key('sartname')} />
          <Textarea label="Not" autosize minRows={2} {...form.getInputProps('not')} key={form.key('not')} />
          {item?.updated_by && <Text size="xs" c="dimmed">Son güncelleme: {item.updated_by}</Text>}
          <Group justify="space-between" mt="sm" style={{ position: 'sticky', bottom: 0, background: 'var(--mantine-color-body)', paddingTop: 8 }}>
            {!isNew ? <Button variant="subtle" color="red" leftSection={<TrashIcon size={18} aria-hidden />} onClick={del}>Sil</Button> : <span />}
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
