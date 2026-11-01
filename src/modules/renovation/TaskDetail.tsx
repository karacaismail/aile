import { SectionHeading } from '@/components/Info';
import { FormSelect } from '@/components/FormSelect';
import { useMemo, useRef, useState } from 'react';
import { Alert, Chip, Group, Modal, NumberInput, SimpleGrid, Stack, Switch, Text, TextInput, Textarea } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { useForm, schemaResolver } from '@mantine/form';
import { useMediaQuery } from '@mantine/hooks';
import { confirmDelete, unlessConfirming } from '@/components/confirmDelete';
import { notifications } from '@mantine/notifications';
import { z } from 'zod';
import { useLocation } from 'wouter';
import type { Item } from '@shared/schema';
import { DURUM, IS_KIM, IZIN_DURUMU, label } from '@shared/schema';
import { useAppStore, type AppState } from '@/sync/store';
import { upsert, remove } from '@/sync/controller';
import { selectFirstLoad } from '@/data/selectors';
import { EnumSelect } from '@/components/EnumSelect';
import { DetailSkeleton } from '@/components/DetailSkeleton';
import { FormFooter, focusFirstError } from '@/components/FormFooter';
import { DraftConflict } from '@/components/DraftConflict';
import { ownedChanges } from '@/lib/fieldOwnership';
import { useDraftOwnership } from '@/lib/useDraftOwnership';
import { useRouteModalFocusReturn } from '@/lib/routeModalFocus';
import { formatTr } from '@/lib/dates';
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

const FIELD_LABELS: Record<string, string> = {
  kod: 'Kod', ad: 'Ad', is_kim: 'İşi yapan', planlanan_tarih: 'Planlanan tarih', bitis_tarihi: 'Bitiş tarihi', sure_gun: 'Süre (gün)',
  bagimlilik: 'Bağımlılık', izin_gerekli: 'İzin gerekli', izin_durumu: 'İzin durumu', sartname: 'Şartname', durum: 'Durum', not: 'Not',
};
/** Çakışmada formun gösterdiği sözcükler: seçenek etiketleri, tarih ve gün; boş "boş" kalır, 0 değildir. */
function conflictValue(key: string, v: unknown): string {
  if (v == null || v === '' || (Array.isArray(v) && !v.length)) return 'boş';
  if (key === 'is_kim') return (v as string[]).map((k) => label('is_kim', k)).join(', ');
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'boolean') return v ? 'evet' : 'hayır';
  if (key === 'durum') return TASK_DURUM_LABEL[String(v)] ?? String(v);
  if (key === 'izin_durumu') return label('izin_durumu', String(v));
  if (key === 'planlanan_tarih' || key === 'bitis_tarihi') return formatTr(String(v));
  if (key === 'sure_gun') return `${v} gün`;
  return String(v);
}

/** Kaydet/Vazgeç sonrası dönülecek yer: liste (varsayılan) ya da işin açıldığı takvim olayı. */
export type TaskReturn = { href: string; afterDelete?: string; focus?: () => HTMLElement | null };

/** Kayıt çözülmeden form kurulmaz: yükleniyorsa iskelet, bulunamadıysa uyarı; aksi halde gövde `key` = kayıt kimliği. */
export function TaskDetail({ id, back }: { id: string; back?: TaskReturn }) {
  const [, navigate] = useLocation();
  const isNew = id === 'yeni';
  const selectItem = useMemo(() => (s: AppState) => (isNew ? undefined : s.items.find((i) => i.id === id)), [isNew, id]);
  const item = useAppStore(selectItem);
  const loading = useAppStore(selectFirstLoad);
  const isMobile = useMediaQuery('(max-width: 48em)', true);
  // Her kapanış yolu odağı açan öğeye, o sayfadan gittiyse listedeki aynı işe (ya da takvimdeki olaya), o da yoksa h1'e verir.
  useRouteModalFocusReturn(() => new RegExp(`/is(ler)?/${id}$`).test(window.location.hash),
    () => back?.focus?.() ?? document.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(id)}"] [role="link"]`));
  const close = () => navigate(back?.href ?? '~/tadilat/isler');
  const closeAfterDelete = () => navigate(back?.afterDelete ?? back?.href ?? '~/tadilat/isler');
  if (!isNew && !item) {
    return (
      <Modal opened onClose={close} title="İş" fullScreen={isMobile} closeButtonProps={modalCloseProps}>
        {loading ? <DetailSkeleton testId="task-detail-loading" /> : <Alert color="yellow">İş bulunamadı (silinmiş ya da henüz eşitlenmemiş olabilir).</Alert>}
      </Modal>
    );
  }
  return <TaskDetailBody key={item?.id ?? 'yeni'} item={item} onClose={close} onDeleted={closeAfterDelete} />;
}

function TaskDetailBody({ item, onClose, onDeleted }: { item?: Item; onClose: () => void; onDeleted: () => void }) {
  const isNew = !item;
  const isMobile = useMediaQuery('(max-width: 48em)', true);
  // initialValues yalnız mount'ta okunur; bileşen kayıt kimliğiyle anahtarlandığından sunucu güncellemesi düzenlemeyi ezmez.
  const [initial] = useState(() => toForm(item));
  const form = useForm<TaskFormValues>({ mode: 'controlled', initialValues: initial, validate: schemaResolver(schema, { sync: true }) });
  const formRef = useRef<HTMLFormElement>(null);
  // Sahiplik dayanağı formun açılış hâlidir; çözülen çakışma o alanın dayanağını sunucu değerine taşır.
  const { baseline, conflicts, setConflicts, resolve } = useDraftOwnership(initial, () => item && toForm(item), (key, value) => form.setFieldValue(key, value as never));
  const persisted = (values: TaskFormValues) => toTaskPatch(values);

  const save = (values: TaskFormValues) => {
    if (item) {
      // Yalnız kullanıcının açılıştan değiştirdiği ve son kayıttan farklı alanlar yazılır; aynı alan sunucuda da değiştiyse çakışmadır.
      const owned = ownedChanges(persisted, baseline, values, toForm(item));
      if (owned.conflicts.length) { setConflicts(owned.conflicts); return; }
      if (!owned.writes) { onClose(); return; }
      upsert('kalemler', item.id, owned.patch);
    } else {
      upsert('kalemler', undefined, toTaskPatch(values));
    }
    notifications.show({ message: isNew ? 'İş eklendi' : 'Kaydedildi', color: 'green', autoClose: 1500 });
    onClose();
  };
  const del = () => confirmDelete({
    title: 'İşi sil?', body: <>"{item?.ad}" listeden kaldırılır (Sheets'te silinmiş olarak işaretlenir).</>,
    onDelete: () => { if (item) remove('kalemler', item.id); notifications.show({ message: 'Silindi', color: 'gray', autoClose: 1500 }); }, onClosed: onDeleted,
  });

  const v = form.getValues();
  const depsInput = form.getInputProps('bagimlilik');
  return (
    <Modal opened onClose={unlessConfirming(onClose)} title={isNew ? 'Yeni iş' : 'İş'} fullScreen={isMobile} size="lg"
      closeButtonProps={modalCloseProps} styles={{ body: { paddingBottom: 96 } }}>
      <form ref={formRef} onSubmit={form.onSubmit(save, (errors) => focusFirstError(formRef.current, errors))} noValidate data-testid="task-detail">
        <Stack gap="sm">
          <Stack component="section" aria-label="İş ve sorumlular" className="record-form-section" gap="sm">
            <SectionHeading title="İş ve sorumlular" level={3} />
            {item && <DraftConflict fields={conflicts} label={(key) => FIELD_LABELS[key] ?? key} onResolve={resolve}
              mine={(key) => ({ value: conflictValue(key, persisted(form.getValues())[key]) })}
              theirs={(key) => ({ value: conflictValue(key, persisted(toForm(item))[key]) })} />}
            <Group gap="xs" wrap="nowrap" align="flex-start">
              <TextInput label="Kod" placeholder="T1" w={88} style={{ flexShrink: 0 }} {...form.getInputProps('kod')} key={form.key('kod')} />
              {/* Yeni işte zorunlu ilk alan odaklanır (Mantine FocusTrap `data-autofocus`); düzenlemede odak modal başlığında kalır. */}
              <TextInput label="Ad" required data-autofocus={isNew || undefined} style={{ flex: 1 }} {...form.getInputProps('ad')} key={form.key('ad')} />
            </Group>
            <div>
              <Text size="sm" fw={500} mb={4}>İşi yapan</Text>
              <Chip.Group multiple value={v.is_kim} onChange={(val) => form.setFieldValue('is_kim', val)}>
                <Group gap={6}>
                  {IS_KIM.map((k) => <Chip key={k} value={k} size="sm" variant="light">{label('is_kim', k)}</Chip>)}
                </Group>
              </Chip.Group>
            </div>
            <FormSelect label="Durum" allowDeselect={false} data={DURUM.map((d) => ({ value: d, label: TASK_DURUM_LABEL[d] ?? d }))} value={v.durum ?? 'fikir'} onChange={(value) => value && form.setFieldValue('durum', value)} />
          </Stack>
          <Stack component="section" aria-label="İş takvimi" className="record-form-section" gap="sm">
            <SectionHeading title="İş takvimi" level={3} />
            <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="xs">
              <DatePickerInput label="Planlanan tarih" {...dateProps} value={v.planlanan_tarih} onChange={(d) => form.setFieldValue('planlanan_tarih', d)} />
              <DatePickerInput label="Bitiş tarihi" {...dateProps} value={v.bitis_tarihi} onChange={(d) => form.setFieldValue('bitis_tarihi', d)} />
            </SimpleGrid>
            <NumberInput label="Süre (gün)" min={0} inputMode="numeric" hideControls data-path="sure_gun" value={v.sure_gun ?? ''} onChange={(n) => form.setFieldValue('sure_gun', n === '' ? null : Number(n))} error={form.errors.sure_gun} />
            <TextInput label="Bağımlılık (kodlar, virgülle)" placeholder="T1, T2" {...depsInput} key={form.key('bagimlilik')}
              onBlur={(e) => { depsInput.onBlur?.(e); form.setFieldValue('bagimlilik', splitDeps(e.currentTarget.value).join(', ')); }} />
          </Stack>
          <Stack component="section" aria-label="İzin ve şartname" className="record-form-section" gap="sm">
            <SectionHeading title="İzin ve şartname" level={3} />
            <Switch label="İzin gerekli (ev sahibi / yönetim)" {...form.getInputProps('izin_gerekli', { type: 'checkbox' })} key={form.key('izin_gerekli')} />
            {v.izin_gerekli && <EnumSelect label="İzin durumu" field="izin_durumu" options={IZIN_DURUMU} value={v.izin_durumu} onChange={(x) => form.setFieldValue('izin_durumu', x)} />}
            <Textarea label="Şartname" autosize minRows={2} {...form.getInputProps('sartname')} key={form.key('sartname')} />
            <Textarea label="Not" autosize minRows={2} {...form.getInputProps('not')} key={form.key('not')} />
            {item?.updated_by && <Text size="xs" c="dimmed">Son güncelleme: {item.updated_by}</Text>}
          </Stack>
          <FormFooter errors={form.errors} onCancel={onClose} onDelete={isNew ? undefined : del} />
        </Stack>
      </form>
    </Modal>
  );
}
