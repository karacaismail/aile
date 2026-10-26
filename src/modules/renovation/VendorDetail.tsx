import { useMemo } from 'react';
import { Alert, Button, Divider, Group, Modal, NumberInput, SimpleGrid, Stack, Switch, Text, TextInput, Textarea } from '@mantine/core';
import { useForm, schemaResolver } from '@mantine/form';
import { useMediaQuery } from '@mantine/hooks';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { FloppyDiskIcon, TrashIcon } from '@phosphor-icons/react';
import { z } from 'zod';
import { useLocation } from 'wouter';
import type { Item } from '@shared/schema';
import { MESLEK } from '@shared/schema';
import { useAppStore, type AppState } from '@/sync/store';
import { upsert, remove } from '@/sync/controller';
import { selectFirstLoad } from '@/data/selectors';
import { EnumSelect } from '@/components/EnumSelect';
import { PriceInput } from '@/components/PriceInput';
import { LinksField } from '@/components/LinksField';
import { DetailSkeleton } from '@/components/DetailSkeleton';

const schema = z.object({
  ad: z.string().trim().min(1, 'Ad gerekli'),
  uyum_pct: z.number().min(0, '0–100').max(100, '0–100').nullable(),
});

export type VendorFormValues = {
  ad: string; meslek?: string; telefon: string; myk_no: string; myk_dogrulandi: boolean; teklif_tl: number | null; teklif_sure_gun: number | null;
  garanti_ay: number | null; uyum_pct: number | null; not: string; linkler: string[];
};

function toForm(i?: Item): VendorFormValues {
  return {
    ad: i?.ad ?? '', meslek: i?.meslek, telefon: i?.telefon ?? '', myk_no: i?.myk_no ?? '', myk_dogrulandi: !!i?.myk_dogrulandi, teklif_tl: i?.teklif_tl ?? null,
    teklif_sure_gun: i?.teklif_sure_gun ?? null, garanti_ay: i?.garanti_ay ?? null, uyum_pct: i?.uyum_pct ?? null, not: i?.not ?? '', linkler: i?.linkler ?? [],
  };
}

/** Form → patch: boş alanlar null ile temizlenir; var olan kayıtta yalnız değişenler (tip hep kalır). */
export function toVendorPatch(v: VendorFormValues, prev?: Item): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    tip: 'usta', ad: v.ad.trim(), meslek: v.meslek ?? null, telefon: v.telefon.trim() || null, myk_no: v.myk_no.trim() || null, myk_dogrulandi: v.myk_dogrulandi,
    teklif_tl: v.teklif_tl, teklif_sure_gun: v.teklif_sure_gun, garanti_ay: v.garanti_ay, uyum_pct: v.uyum_pct, not: v.not.trim() || null, linkler: v.linkler.length ? v.linkler : null,
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

/** Kayıt çözülmeden form kurulmaz: yükleniyorsa iskelet, bulunamadıysa uyarı; aksi halde gövde `key` = kayıt kimliği. */
export function VendorDetail({ id }: { id: string }) {
  const [, navigate] = useLocation();
  const isNew = id === 'yeni';
  const selectItem = useMemo(() => (s: AppState) => (isNew ? undefined : s.items.find((i) => i.id === id)), [isNew, id]);
  const item = useAppStore(selectItem);
  const loading = useAppStore(selectFirstLoad);
  const isMobile = useMediaQuery('(max-width: 48em)', true);
  const close = () => navigate('~/tadilat/ustalar');
  if (!isNew && !item) {
    return (
      <Modal opened onClose={close} title="Usta" fullScreen={isMobile} closeButtonProps={modalCloseProps}>
        {loading ? <DetailSkeleton testId="vendor-detail-loading" /> : <Alert color="yellow">Usta bulunamadı (silinmiş ya da henüz eşitlenmemiş olabilir).</Alert>}
      </Modal>
    );
  }
  return <VendorDetailBody key={item?.id ?? 'yeni'} item={item} onClose={close} />;
}

function VendorDetailBody({ item, onClose }: { item?: Item; onClose: () => void }) {
  const isNew = !item;
  const isMobile = useMediaQuery('(max-width: 48em)', true);
  // initialValues yalnız mount'ta okunur; bileşen kayıt kimliğiyle anahtarlandığından sunucu güncellemesi düzenlemeyi ezmez.
  const form = useForm<VendorFormValues>({ mode: 'controlled', initialValues: toForm(item), validate: schemaResolver(schema, { sync: true }) });

  const save = (values: VendorFormValues) => {
    const patch = toVendorPatch(values, item);
    if (!isNew && Object.keys(patch).length <= 1) { onClose(); return; }
    upsert('kalemler', item?.id, patch);
    notifications.show({ message: isNew ? 'Usta eklendi' : 'Kaydedildi', color: 'green', autoClose: 1500 });
    onClose();
  };
  const del = () => modals.openConfirmModal({
    title: 'Ustayı sil?', children: <Text size="sm">"{item?.ad}" listeden kaldırılır (Sheets'te silinmiş olarak işaretlenir).</Text>,
    labels: { confirm: 'Sil', cancel: 'Vazgeç' }, confirmProps: { color: 'red' },
    onConfirm: () => { if (item) remove('kalemler', item.id); notifications.show({ message: 'Silindi', color: 'gray', autoClose: 1500 }); onClose(); },
  });

  const v = form.getValues();
  const num = (field: 'teklif_sure_gun' | 'garanti_ay' | 'uyum_pct') => ({
    value: v[field] ?? '', onChange: (n: string | number) => form.setFieldValue(field, n === '' ? null : Number(n)), error: form.errors[field],
  });
  return (
    <Modal opened onClose={onClose} title={isNew ? 'Yeni usta' : 'Usta'} fullScreen={isMobile} size="lg" transitionProps={{ transition: 'fade', duration: 120 }}
      closeButtonProps={modalCloseProps} styles={{ body: { paddingBottom: 96 } }}>
      <form onSubmit={form.onSubmit(save)} noValidate data-testid="vendor-detail">
        <Stack gap="sm">
          <TextInput label="Ad" required autoFocus={isNew} {...form.getInputProps('ad')} key={form.key('ad')} />
          <SimpleGrid cols={2} spacing="xs">
            <EnumSelect label="Meslek" field="meslek" options={MESLEK} value={v.meslek} onChange={(x) => form.setFieldValue('meslek', x)} />
            <TextInput label="Telefon" inputMode="tel" autoComplete="off" placeholder="05xx xxx xx xx" {...form.getInputProps('telefon')} key={form.key('telefon')} />
          </SimpleGrid>
          <Divider label="MYK" labelPosition="left" />
          <TextInput label="MYK belge no" {...form.getInputProps('myk_no')} key={form.key('myk_no')} />
          <Switch label="MYK doğrulandı (myk.gov.tr sorgusu yapıldı)" {...form.getInputProps('myk_dogrulandi', { type: 'checkbox' })} key={form.key('myk_dogrulandi')} />
          <Divider label="Teklif" labelPosition="left" />
          <SimpleGrid cols={2} spacing="xs">
            <PriceInput label="Teklif" value={v.teklif_tl} onChange={(x) => form.setFieldValue('teklif_tl', x)} />
            <NumberInput label="Süre (gün)" min={0} inputMode="numeric" hideControls {...num('teklif_sure_gun')} />
            <NumberInput label="Garanti (ay)" min={0} inputMode="numeric" hideControls {...num('garanti_ay')} />
            <NumberInput label="Şartname uyumu (%)" min={0} max={100} inputMode="numeric" hideControls {...num('uyum_pct')} />
          </SimpleGrid>
          <LinksField value={v.linkler} onChange={(x) => form.setFieldValue('linkler', x)} />
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
