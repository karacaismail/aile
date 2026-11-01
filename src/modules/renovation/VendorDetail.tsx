import { SectionHeading } from '@/components/Info';
import { useMemo, useRef, useState } from 'react';
import { Alert, Modal, NumberInput, SimpleGrid, Stack, Switch, Text, TextInput, Textarea } from '@mantine/core';
import { useForm, schemaResolver } from '@mantine/form';
import { useMediaQuery } from '@mantine/hooks';
import { confirmDelete, unlessConfirming } from '@/components/confirmDelete';
import { notifications } from '@mantine/notifications';
import { z } from 'zod';
import { useLocation } from 'wouter';
import type { Item } from '@shared/schema';
import { MESLEK, label } from '@shared/schema';
import { useAppStore, type AppState } from '@/sync/store';
import { upsert, remove } from '@/sync/controller';
import { selectFirstLoad } from '@/data/selectors';
import { EnumSelect } from '@/components/EnumSelect';
import { PriceInput } from '@/components/PriceInput';
import { LinksField } from '@/components/LinksField';
import { DetailSkeleton } from '@/components/DetailSkeleton';
import { FormFooter, focusFirstError } from '@/components/FormFooter';
import { DraftConflict } from '@/components/DraftConflict';
import { ownedChanges } from '@/lib/fieldOwnership';
import { useDraftOwnership } from '@/lib/useDraftOwnership';
import { useRouteModalFocusReturn } from '@/lib/routeModalFocus';
import { formatTl } from '@/lib/price';

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

const FIELD_LABELS: Record<string, string> = {
  ad: 'Ad', meslek: 'Meslek', telefon: 'Telefon', myk_no: 'MYK belge no', myk_dogrulandi: 'MYK doğrulandı', teklif_tl: 'Teklif',
  teklif_sure_gun: 'Süre (gün)', garanti_ay: 'Garanti (ay)', uyum_pct: 'Şartname uyumu (%)', not: 'Not', linkler: 'Bağlantılar',
};
/** Çakışmada formun gösterdiği sözcükler; boş "boş" kalır, 0 değildir. */
function conflictValue(key: string, v: unknown): string {
  if (v == null || v === '' || (Array.isArray(v) && !v.length)) return 'boş';
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'boolean') return v ? 'evet' : 'hayır';
  if (key === 'meslek') return label('meslek', String(v));
  if (key === 'teklif_tl') return formatTl(Number(v));
  if (key === 'uyum_pct') return `%${v}`;
  return String(v);
}

/** Kayıt çözülmeden form kurulmaz: yükleniyorsa iskelet, bulunamadıysa uyarı; aksi halde gövde `key` = kayıt kimliği. */
export function VendorDetail({ id }: { id: string }) {
  const [, navigate] = useLocation();
  const isNew = id === 'yeni';
  const selectItem = useMemo(() => (s: AppState) => (isNew ? undefined : s.items.find((i) => i.id === id)), [isNew, id]);
  const item = useAppStore(selectItem);
  const loading = useAppStore(selectFirstLoad);
  const isMobile = useMediaQuery('(max-width: 48em)', true);
  // Her kapanış yolu odağı açan öğeye, o sayfadan gittiyse listedeki aynı ustaya, o da yoksa h1'e verir.
  useRouteModalFocusReturn(() => window.location.hash.endsWith(`/ustalar/${id}`), () => document.querySelector<HTMLElement>(`[data-vendor-id="${CSS.escape(id)}"] [role="link"]`));
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
  const [initial] = useState(() => toForm(item));
  const form = useForm<VendorFormValues>({ mode: 'controlled', initialValues: initial, validate: schemaResolver(schema, { sync: true }) });
  const formRef = useRef<HTMLFormElement>(null);
  // Sahiplik dayanağı formun açılış hâlidir; çözülen çakışma o alanın dayanağını sunucu değerine taşır.
  const { baseline, conflicts, setConflicts, resolve } = useDraftOwnership(initial, () => item && toForm(item), (key, value) => form.setFieldValue(key, value as never));
  const persisted = (values: VendorFormValues) => toVendorPatch(values);

  const save = (values: VendorFormValues) => {
    if (item) {
      // Yalnız kullanıcının açılıştan değiştirdiği ve son kayıttan farklı alanlar yazılır; aynı alan sunucuda da değiştiyse çakışmadır.
      const owned = ownedChanges(persisted, baseline, values, toForm(item));
      if (owned.conflicts.length) { setConflicts(owned.conflicts); return; }
      if (!owned.writes) { onClose(); return; }
      upsert('kalemler', item.id, owned.patch);
    } else {
      upsert('kalemler', undefined, toVendorPatch(values));
    }
    notifications.show({ message: isNew ? 'Usta eklendi' : 'Kaydedildi', color: 'green', autoClose: 1500 });
    onClose();
  };
  const del = () => confirmDelete({
    title: 'Ustayı sil?', body: <>"{item?.ad}" listeden kaldırılır (Sheets'te silinmiş olarak işaretlenir).</>,
    onDelete: () => { if (item) remove('kalemler', item.id); notifications.show({ message: 'Silindi', color: 'gray', autoClose: 1500 }); }, onClosed: onClose,
  });

  const v = form.getValues();
  const num = (field: 'teklif_sure_gun' | 'garanti_ay' | 'uyum_pct') => ({
    value: v[field] ?? '', onChange: (n: string | number) => form.setFieldValue(field, n === '' ? null : Number(n)), error: form.errors[field], 'data-path': field,
  });
  return (
    <Modal opened onClose={unlessConfirming(onClose)} title={isNew ? 'Yeni usta' : 'Usta'} fullScreen={isMobile} size="lg"
      closeButtonProps={modalCloseProps} styles={{ body: { paddingBottom: 96 } }}>
      <form ref={formRef} onSubmit={form.onSubmit(save, (errors) => focusFirstError(formRef.current, errors))} noValidate data-testid="vendor-detail">
        <Stack gap="sm">
          <Stack component="section" aria-label="Usta ve iletişim" className="record-form-section" gap="sm">
            <SectionHeading title="Usta ve iletişim" level={3} />
            {item && <DraftConflict fields={conflicts} label={(key) => FIELD_LABELS[key] ?? key} onResolve={resolve}
              mine={(key) => ({ value: conflictValue(key, persisted(form.getValues())[key]) })}
              theirs={(key) => ({ value: conflictValue(key, persisted(toForm(item))[key]) })} />}
            {/* Yeni ustada zorunlu ilk alan odaklanır (Mantine FocusTrap `data-autofocus`); düzenlemede odak modal başlığında kalır. */}
            <TextInput label="Ad" required data-autofocus={isNew || undefined} {...form.getInputProps('ad')} key={form.key('ad')} />
            <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="xs">
              <EnumSelect label="Meslek" field="meslek" options={MESLEK} value={v.meslek} onChange={(x) => form.setFieldValue('meslek', x)} />
              <TextInput label="Telefon" inputMode="tel" autoComplete="off" placeholder="05xx xxx xx xx" {...form.getInputProps('telefon')} key={form.key('telefon')} />
            </SimpleGrid>
          </Stack>
          <Stack component="section" aria-label="Yetkinlik kontrolü" className="record-form-section" gap="sm">
            <SectionHeading title="Yetkinlik kontrolü" level={3} />
            <TextInput label="MYK belge no" {...form.getInputProps('myk_no')} key={form.key('myk_no')} />
            <Switch label="MYK doğrulandı (myk.gov.tr sorgusu yapıldı)" {...form.getInputProps('myk_dogrulandi', { type: 'checkbox' })} key={form.key('myk_dogrulandi')} />
          </Stack>
          <Stack component="section" aria-label="Teklif koşulları" className="record-form-section" gap="sm">
            <SectionHeading title="Teklif koşulları" level={3} />
            <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="xs">
              <PriceInput label="Teklif" value={v.teklif_tl} onChange={(x) => form.setFieldValue('teklif_tl', x)} />
              <NumberInput label="Süre (gün)" min={0} inputMode="numeric" hideControls {...num('teklif_sure_gun')} />
              <NumberInput label="Garanti (ay)" min={0} inputMode="numeric" hideControls {...num('garanti_ay')} />
              <NumberInput label="Şartname uyumu (%)" min={0} max={100} inputMode="numeric" hideControls {...num('uyum_pct')} />
            </SimpleGrid>
            <LinksField value={v.linkler} onChange={(x) => form.setFieldValue('linkler', x)} />
            <Textarea label="Not" autosize minRows={2} {...form.getInputProps('not')} key={form.key('not')} />
            {item?.updated_by && <Text size="xs" c="dimmed">Son güncelleme: {item.updated_by}</Text>}
          </Stack>
          <FormFooter errors={form.errors} onCancel={onClose} onDelete={isNew ? undefined : del} />
        </Stack>
      </form>
    </Modal>
  );
}
