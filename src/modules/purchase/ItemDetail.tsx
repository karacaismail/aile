import { SectionHeading } from '@/components/Info';
import { useEffect, useRef, useState } from 'react';
import { Modal, Stack, TextInput, SegmentedControl, Switch, NumberInput, Textarea, Text, Alert, SimpleGrid } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { useForm, schemaResolver } from '@mantine/form';
import { useMediaQuery } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { z } from 'zod';
import { useLocation } from 'wouter';
import type { Item } from '@shared/schema';
import { ODA, KATEGORI, DURUM, BIRIM, FIYAT_GUVEN, FAZ, label } from '@shared/schema';
import { useAppStore } from '@/sync/store';
import { upsert, remove } from '@/sync/controller';
import { PriceInput } from '@/components/PriceInput';
import { LinksField } from '@/components/LinksField';
import { EnumSelect } from '@/components/EnumSelect';
import { FormFooter, focusFirstError } from '@/components/FormFooter';
import { ConflictBanner, FIELD_LABELS, fieldValue } from './ConflictBanner';
import { ownedChanges } from '@/lib/fieldOwnership';
import { DetailSkeleton } from '@/components/DetailSkeleton';
import { DraftConflict } from '@/components/DraftConflict';
import { useDraftOwnership } from '@/lib/useDraftOwnership';
import { confirmDelete, unlessConfirming } from '@/components/confirmDelete';
import { useRouteModalFocusReturn } from '@/lib/routeModalFocus';
import { selectFirstLoad } from '@/data/selectors';
import { tokens } from '@/dashboard/tokens';

const schema = z.object({
  ad: z.string().trim().min(1, 'Ad gerekli'),
  tahmini_tl_min: z.number().min(0).nullable(),
  tahmini_tl_max: z.number().min(0).nullable(),
  gercek_tl: z.number().min(0).nullable(),
  adet: z.number().min(1, 'En az 1').max(999),
}).refine((v) => v.tahmini_tl_min == null || v.tahmini_tl_max == null || v.tahmini_tl_min <= v.tahmini_tl_max, { message: 'Min, max\'tan büyük olamaz', path: ['tahmini_tl_max'] });

type FormValues = {
  ad: string; oda?: string; kategori?: string; faz: '1' | '2' | '3'; durum?: string; karar_bekliyor: boolean; oncelik: number; adet: number; birim?: string;
  tahmini_tl_min: number | null; tahmini_tl_max: number | null; gercek_tl: number | null; fiyat_guven?: string; nereden: string;
  siparis_son_tarih: string | null; teslim_suresi_gun: number | null; teslim_tarihi: string | null; linkler: string[]; not: string; mevcut: boolean;
};

/** Yeni kalemin ön değerleri: kullanıcının o an baktığı faz / tek seçili oda ve kategori (liste sahibi verir). */
export interface NewItemDefaults { faz?: '1' | '2' | '3'; oda?: string; kategori?: string }

function toForm(i?: Item, d?: NewItemDefaults): FormValues {
  return {
    ad: i?.ad ?? '', oda: i ? i.oda : d?.oda, kategori: i ? i.kategori : d?.kategori, faz: i?.faz ?? d?.faz ?? '1', durum: i?.durum ?? (i ? undefined : 'fikir'), karar_bekliyor: !!i?.karar_bekliyor,
    oncelik: i?.oncelik ?? 2, adet: i?.adet ?? 1, birim: i?.birim ?? 'adet', tahmini_tl_min: i?.tahmini_tl_min ?? null, tahmini_tl_max: i?.tahmini_tl_max ?? null,
    gercek_tl: i?.gercek_tl ?? null, fiyat_guven: i?.fiyat_guven, nereden: i?.nereden ?? '', siparis_son_tarih: i?.siparis_son_tarih ?? null,
    teslim_suresi_gun: i?.teslim_suresi_gun ?? null, teslim_tarihi: i?.teslim_tarihi ?? null, linkler: i?.linkler ?? [], not: i?.not ?? '', mevcut: !!i?.mevcut,
  };
}

/** Form → patch: boş/undefined alanlar null ile temizlenir. */
export function toPatch(v: FormValues, prev?: Item): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    tip: 'satinalma', ad: v.ad.trim(), oda: v.oda ?? null, kategori: v.kategori ?? null, faz: v.faz, durum: v.durum ?? null,
    karar_bekliyor: v.karar_bekliyor, oncelik: v.oncelik, adet: v.adet, birim: v.birim ?? null,
    tahmini_tl_min: v.tahmini_tl_min, tahmini_tl_max: v.tahmini_tl_max ?? v.tahmini_tl_min, gercek_tl: v.gercek_tl,
    fiyat_guven: v.fiyat_guven ?? (v.tahmini_tl_min != null ? 'tahmini' : null), nereden: v.nereden.trim() || null,
    siparis_son_tarih: v.siparis_son_tarih, teslim_suresi_gun: v.teslim_suresi_gun, teslim_tarihi: v.teslim_tarihi,
    linkler: v.linkler.length ? v.linkler : null, not: v.not.trim() || null, mevcut: v.mevcut,
  };
  if (prev) {
    for (const k of Object.keys(patch)) {
      const a = patch[k]; const b = (prev as unknown as Record<string, unknown>)[k];
      const eq = Array.isArray(a) ? JSON.stringify(a) === JSON.stringify(b ?? null) : (a ?? null) === (b ?? null) || (a === false && b === undefined) || (a === null && b === undefined);
      if (eq && k !== 'tip') delete patch[k];
    }
  }
  return patch;
}

/**
 * Patch for an existing record. Opening form, local form and latest record are compared in the same persisted
 * meaning (`toPatch`: trimmed text, empty → null, derived values only where the field is empty), so whitespace is not an
 * edit and an untouched explicit field (or one the server updated meanwhile) is never written back.
 * Only owned fields whose result differs from the latest record are written. A same-field server change, or an owned
 * price that would form an invalid range with the latest record, is returned as a conflict and nothing is written.
 */
// An empty field written with a value derived from another field says so, next to the value that would be written.
const DERIVED_FROM: Partial<Record<keyof FormValues, string>> = { tahmini_tl_max: 'Tahmini (min) değerinden türetilir', fiyat_guven: 'Tahmini (min) girildiği için türetilir' };
function persistedValue(key: keyof FormValues, values: FormValues) {
  const persisted = (toPatch(values) as Record<string, unknown>)[key];
  const raw = values[key];
  return { value: persisted, derived: (raw == null || raw === '') && persisted != null ? DERIVED_FROM[key] : undefined };
}

export function ownedPatch(baseline: FormValues, values: FormValues, latest: Item) {
  const { patch, conflicts, latestValues } = ownedChanges((v: FormValues) => toPatch(v), baseline, values, toForm(latest));
  const merged = { ...latestValues, ...patch } as { tahmini_tl_min?: number | null; tahmini_tl_max?: number | null };
  const invalidRange = !conflicts.length && merged.tahmini_tl_min != null && merged.tahmini_tl_max != null && merged.tahmini_tl_min > merged.tahmini_tl_max;
  return { patch, conflicts: (invalidRange ? ['tahmini_tl_min', 'tahmini_tl_max'] : conflicts) as (keyof FormValues)[], invalidRange, range: invalidRange ? { min: merged.tahmini_tl_min!, max: merged.tahmini_tl_max! } : null };
}

// Temizle düğmesi de dokunma hedefi (≥44); sağ bölüm ona göre genişler.
const dateProps = { valueFormat: 'D MMM YYYY', dropdownType: 'modal' as const, clearable: true, clearButtonProps: { size: 'xl' as const, 'aria-label': 'Tarihi temizle' }, rightSectionWidth: 44 };

/** Route modal shell: waits for the record, remembers the opener and returns focus there when the route leaves this record. */
export function ItemDetail({ id, section, defaults, onSaved }: { id: string; section?: 'fiyat'; defaults?: NewItemDefaults; onSaved?: (saved: Item, isNew: boolean) => void }) {
  const [, navigate] = useLocation();
  const isNew = id === 'yeni';
  const item = useAppStore((s) => (isNew ? undefined : s.items.find((i) => i.id === id)));
  const firstLoad = useAppStore(selectFirstLoad);
  const isMobile = useMediaQuery('(max-width: 48em)', true);
  // Any close path (Escape, Vazgeç, Kaydet, Sil, back) returns focus to the opener, else this record in the list.
  useRouteModalFocusReturn(() => window.location.hash.includes(`/satinalma/${id}`), () => document.querySelector<HTMLElement>(`[data-item-id="${CSS.escape(id)}"] [role="link"]`));
  const close = () => navigate('~/satinalma');

  if (!isNew && !item) {
    return (
      <Modal opened onClose={close} title="Kalem" fullScreen={isMobile} closeButtonProps={{ size: 'xl', 'aria-label': 'Kapat' }}>
        {firstLoad ? <DetailSkeleton testId="item-detail-loading" /> : <Alert color="yellow">Kalem bulunamadı (silinmiş ya da henüz eşitlenmemiş olabilir).</Alert>}
      </Modal>
    );
  }
  // The form mounts only once the record exists, so a cold deep link starts from the real record; a later background
  // refresh does not re-initialise it, so edits in progress are kept (conflicts show the banner instead).
  return <ItemForm id={id} item={item} isNew={isNew} section={section} defaults={defaults} onSaved={onSaved} close={close} isMobile={isMobile} />;
}

function ItemForm({ id, item, isNew, section, defaults, onSaved, close, isMobile }: { id: string; item?: Item; isNew: boolean; section?: 'fiyat'; defaults?: NewItemDefaults; onSaved?: (saved: Item, isNew: boolean) => void; close: () => void; isMobile: boolean }) {
  const [initial] = useState(() => toForm(item, defaults));
  const form = useForm<FormValues>({ mode: 'controlled', initialValues: initial, validate: schemaResolver(schema, { sync: true }) });
  const formRef = useRef<HTMLFormElement>(null);
  // Ownership baseline: the form as it opened; a resolved conflict moves that field's baseline to the server value.
  const { baseline, conflicts, setConflicts, resolve } = useDraftOwnership(initial, () => item && toForm(item), (key, value) => form.setFieldValue(key, value as never));
  const [range, setRange] = useState<{ min: number; max: number } | null>(null);
  // Opened for a price: the section starts just under the modal header, so its explanation and first field are visible above the sticky footer.
  useEffect(() => {
    if (section !== 'fiyat') return;
    const frame = requestAnimationFrame(() => {
      const target = formRef.current?.querySelector<HTMLElement>('[data-section="fiyat"]');
      let scroller = target?.parentElement ?? null;
      while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
      const header = target?.closest('[role="dialog"]')?.querySelector<HTMLElement>('.mantine-Modal-header');
      if (!target || !scroller) return;
      scroller.scrollTop += target.getBoundingClientRect().top - (header?.getBoundingClientRect().bottom ?? scroller.getBoundingClientRect().top) - parseFloat(tokens.spaceSmall);
    });
    return () => cancelAnimationFrame(frame);
  }, [section]);

  const save = (values: FormValues) => {
    const owned = item ? ownedPatch(baseline, values, item) : null;
    // Aynı alanı sunucu da değiştirdiyse yazılmaz: çakışma görünür çözülür, taslak korunur.
    if (owned?.conflicts.length) { setConflicts(owned.conflicts); setRange(owned.range); return; }
    const patch = owned ? owned.patch : toPatch(values);
    // Kullanıcı hiçbir alanı değiştirmediyse (ya da fark kırpmayla kayboluyorsa) Sheets'e yazılmaz: sürüm/son güncelleyen/sıralama bozulmaz.
    if (item && Object.keys(patch).length <= 1) { close(); return; }
    const savedId = upsert('kalemler', isNew ? undefined : id, patch);
    if (onSaved) onSaved({ ...(item ?? { id: savedId, tip: 'satinalma', ad: values.ad.trim() }), ...patch } as Item, isNew);
    else notifications.show({ message: isNew ? 'Kalem eklendi' : 'Kaydedildi', color: 'green', autoClose: 1500 });
    close();
  };
  const del = () => confirmDelete({
    title: 'Kalemi sil?', body: <>"{item?.ad}" listeden kaldırılır (Sheets'te silinmiş olarak işaretlenir).</>,
    onDelete: () => { remove('kalemler', id); notifications.show({ message: 'Silindi', color: 'gray', autoClose: 1500 }); }, onClosed: close,
  });

  return (
    <Modal opened onClose={unlessConfirming(close)} title={isNew ? 'Yeni kalem' : item!.ad} fullScreen={isMobile} size="lg" closeButtonProps={{ size: 'xl', 'aria-label': 'Kapat' }}
      styles={{ body: { paddingBottom: 'var(--aile-fab-clearance)' } }}>
      <form ref={formRef} onSubmit={form.onSubmit(save, (errors) => focusFirstError(formRef.current, errors))} noValidate data-testid="item-detail">
        <Stack gap="sm">
          <Stack component="section" aria-label="Kalem bilgileri" className="record-form-section" gap="sm">
            <SectionHeading title="Kalem bilgileri" level={3} />
            {item && <ConflictBanner id={item.id} />}
            {/* Both sides show the persisted values that are compared and would be written, with any derivation named. */}
            {item && <DraftConflict fields={conflicts} label={(key) => FIELD_LABELS[key] ?? key} onResolve={resolve}
              mine={(key) => { const v = persistedValue(key as keyof FormValues, form.getValues()); return { value: fieldValue(key, v.value), derived: v.derived }; }}
              theirs={(key) => { const v = persistedValue(key as keyof FormValues, toForm(item)); return { value: fieldValue(key, v.value), derived: v.derived }; }}>
              {range && <Text size="sm">Sizin değerleriniz Sheets'teki son değerlerle birleşince min {fieldValue('tahmini_tl_min', range.min)}, max {fieldValue('tahmini_tl_max', range.max)} olur; min max'tan büyük olduğu için birlikte kaydedilemez. Hangisinin kalacağını seçin.</Text>}
            </DraftConflict>}
            {/* Yeni kayıtta ilk alan odaklanır (Mantine FocusTrap `data-autofocus`); düzenlemede odak modal başlığında kalır. */}
            <TextInput label="Ad" required data-autofocus={isNew || undefined} {...form.getInputProps('ad')} key={form.key('ad')} />
            <fieldset className="record-fieldset">
              <legend>Faz</legend>
              <SegmentedControl fullWidth data={FAZ.map(value => ({ value, label: label('faz', value) }))} {...form.getInputProps('faz')} key={form.key('faz')} />
              {form.getValues().faz === '2' && <Text size="sm" c="dimmed">{label('fazUzun', '2')}</Text>}
            </fieldset>
            <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="xs">
              <EnumSelect label="Durum" field="durum" options={DURUM} value={form.getValues().durum} onChange={(v) => form.setFieldValue('durum', v)} />
              <EnumSelect label="Oda" field="oda" options={ODA} value={form.getValues().oda} onChange={(v) => form.setFieldValue('oda', v)} />
              <EnumSelect label="Kategori" field="kategori" options={KATEGORI} value={form.getValues().kategori} onChange={(v) => form.setFieldValue('kategori', v)} />
              <NumberInput label="Öncelik (1–3)" min={1} max={3} inputMode="numeric" hideControls {...form.getInputProps('oncelik')} key={form.key('oncelik')} />
            </SimpleGrid>
          </Stack>
          <Stack component="section" aria-label="Fiyat ve teyit" className="record-form-section" gap="sm" data-section="fiyat">
            {/* "Fiyat ekle" opens here: the section heading takes focus, without choosing between estimate and actual for the user. */}
            <SectionHeading title="Fiyat ve teyit" level={3} focusTarget={section === 'fiyat'} description="Boş bırakılan fiyat bilinmiyor demektir; 0 yalnız gerçekten ücretsizse yazılır." />
            <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="xs">
              <PriceInput label="Tahmini (min)" data-path="tahmini_tl_min" value={form.getValues().tahmini_tl_min} onChange={(v) => form.setFieldValue('tahmini_tl_min', v)} error={form.errors.tahmini_tl_min} />
              <PriceInput label="Tahmini (max)" data-path="tahmini_tl_max" value={form.getValues().tahmini_tl_max} onChange={(v) => form.setFieldValue('tahmini_tl_max', v)} error={form.errors.tahmini_tl_max} />
              {/* Description below the input keeps the paired grid inputs aligned. */}
              <PriceInput label="Gerçek" description="Kayıtlı ürün bedeli; ödeme kaydı ayrı tutulur." inputWrapperOrder={['label', 'input', 'description', 'error']} data-path="gercek_tl" value={form.getValues().gercek_tl} onChange={(v) => form.setFieldValue('gercek_tl', v)} error={form.errors.gercek_tl} />
              <EnumSelect label="Güven" field="fiyat_guven" options={FIYAT_GUVEN} value={form.getValues().fiyat_guven} onChange={(v) => form.setFieldValue('fiyat_guven', v)} />
              <NumberInput label="Adet" min={1} inputMode="numeric" hideControls {...form.getInputProps('adet')} key={form.key('adet')} />
              <EnumSelect label="Birim" field="birim" options={BIRIM} value={form.getValues().birim} onChange={(v) => form.setFieldValue('birim', v)} allowEmpty={false} />
            </SimpleGrid>
          </Stack>
          <Stack component="section" aria-label="Sipariş ve teslim" className="record-form-section" gap="sm">
            <SectionHeading title="Sipariş ve teslim" level={3} />
            <TextInput label="Nereden" {...form.getInputProps('nereden')} key={form.key('nereden')} />
            <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="xs">
              <DatePickerInput label="Sipariş son tarih" {...dateProps} value={form.getValues().siparis_son_tarih} onChange={(v) => form.setFieldValue('siparis_son_tarih', v)} />
              <DatePickerInput label="Teslim tarihi" {...dateProps} value={form.getValues().teslim_tarihi} onChange={(v) => form.setFieldValue('teslim_tarihi', v)} />
            </SimpleGrid>
            <NumberInput label="Teslim süresi (gün)" min={0} inputMode="numeric" hideControls value={form.getValues().teslim_suresi_gun ?? ''} onChange={(v) => form.setFieldValue('teslim_suresi_gun', v === '' ? null : Number(v))} />
            <LinksField value={form.getValues().linkler} onChange={(v) => form.setFieldValue('linkler', v)} />
            <Textarea label="Not" autosize minRows={2} {...form.getInputProps('not')} key={form.key('not')} />
            <Stack gap="sm">
              <Switch label="Karar bekliyor" {...form.getInputProps('karar_bekliyor', { type: 'checkbox' })} key={form.key('karar_bekliyor')} />
              <Switch label="Elimizde var (satın alınmayacak)" {...form.getInputProps('mevcut', { type: 'checkbox' })} key={form.key('mevcut')} />
            </Stack>
            {item?.updated_by && <Text size="xs" c="dimmed">Son güncelleme: {item.updated_by} · {label('durum', item.durum)}</Text>}
          </Stack>
          <FormFooter errors={form.errors} onCancel={close} onDelete={isNew ? undefined : del} />
        </Stack>
      </form>
    </Modal>
  );
}
