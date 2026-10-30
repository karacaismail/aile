import { useMemo, useState } from 'react';
import { Alert, Button, Chip, Divider, Group, Modal, NumberInput, SimpleGrid, Stack, Switch, Text, TextInput, Textarea, type NumberInputProps } from '@mantine/core';
import { useForm, schemaResolver, type UseFormReturnType } from '@mantine/form';
import { useMediaQuery } from '@mantine/hooks';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { FloppyDiskIcon } from '@phosphor-icons/react/dist/csr/FloppyDisk';
import { TrashIcon } from '@phosphor-icons/react/dist/csr/Trash';
import { WarningIcon } from '@phosphor-icons/react/dist/csr/Warning';
import { z } from 'zod';
import { useLocation } from 'wouter';
import type { Item } from '@shared/schema';
import { ADIM, CCT_MOD, FIYAT_GUVEN, FLICKER, KATMAN_TUR, KIM, KONTROL_CIHAZ, LUX_DUZLEM, label } from '@shared/schema';
import { useAppStore, type AppState } from '@/sync/store';
import { upsert, remove } from '@/sync/controller';
import { selectFirstLoad } from '@/data/selectors';
import { PriceInput } from '@/components/PriceInput';
import { EnumSelect } from '@/components/EnumSelect';
import { DetailSkeleton } from '@/components/DetailSkeleton';
import { CctSlider } from './CctSlider';
import { selectPurchases, useRoomSetting } from './data';
import { CCT_RANGE, fieldErrors, validateLayer, type LayerLike } from './rules';

const schema = z.object({
  katman_tur: z.string().min(1, 'Katman türü gerekli'),
  lux_min: z.number().min(0).nullable(),
  lux_max: z.number().min(0).nullable(),
  dim_min_pct: z.number().min(0).max(100, 'En çok 100').nullable(),
  cri_min: z.number().min(0).max(100, 'En çok 100').nullable(),
  r9_min: z.number().min(-100).max(100, 'En çok 100').nullable(),
  tahmini_tl_min: z.number().min(0).nullable(),
  tahmini_tl_max: z.number().min(0).nullable(),
})
  .refine((v) => v.lux_min == null || v.lux_max == null || v.lux_min <= v.lux_max, { message: "Min, max'tan büyük olamaz", path: ['lux_max'] })
  .refine((v) => v.tahmini_tl_min == null || v.tahmini_tl_max == null || v.tahmini_tl_min <= v.tahmini_tl_max, { message: "Min, max'tan büyük olamaz", path: ['tahmini_tl_max'] });

export type LayerFormValues = {
  katman_tur: string; katman_ad: string; amac: string;
  lux_min: number | null; lux_max: number | null; lux_duzlem?: string;
  cct_mod?: string; cct: [number, number];
  dim_min_pct: number | null; cri_min: number | null; r9_min: number | null;
  flicker?: string; kontrol_cihaz?: string; urun_sinifi: string;
  uzunluk_m: number | null; w_per_m: number | null; surucu_model: string; surucu_w: number | null;
  montaj_yukseklik_cm: number | null; acikta: boolean; adim?: string; kim: string[];
  tahmini_tl_min: number | null; tahmini_tl_max: number | null; fiyat_guven?: string;
  bagli_idler: string[]; not: string;
};

type NumKey = 'lux_min' | 'lux_max' | 'dim_min_pct' | 'cri_min' | 'r9_min' | 'uzunluk_m' | 'w_per_m' | 'surucu_w' | 'montaj_yukseklik_cm';

const clampCct = (v: number) => Math.min(CCT_RANGE.max, Math.max(CCT_RANGE.min, v));

export function toForm(i?: Item): LayerFormValues {
  const lo = i?.cct_min ?? i?.cct_max;
  const hi = i?.cct_max ?? i?.cct_min;
  return {
    katman_tur: i?.katman_tur ?? '', katman_ad: i?.katman_ad ?? (i ? i.ad : ''), amac: i?.amac ?? '',
    lux_min: i?.lux_min ?? null, lux_max: i?.lux_max ?? null, lux_duzlem: i?.lux_duzlem,
    cct_mod: i?.cct_mod, cct: lo != null && hi != null ? [clampCct(Math.min(lo, hi)), clampCct(Math.max(lo, hi))] : [2700, 4000],
    dim_min_pct: i?.dim_min_pct ?? null, cri_min: i?.cri_min ?? null, r9_min: i?.r9_min ?? null,
    flicker: i?.flicker, kontrol_cihaz: i?.kontrol_cihaz, urun_sinifi: i?.urun_sinifi ?? '',
    uzunluk_m: i?.uzunluk_m ?? null, w_per_m: i?.w_per_m ?? null, surucu_model: i?.surucu_model ?? '', surucu_w: i?.surucu_w ?? null,
    montaj_yukseklik_cm: i?.montaj_yukseklik_cm ?? null, acikta: !!i?.acikta, adim: i?.adim, kim: i?.kim ?? [],
    tahmini_tl_min: i?.tahmini_tl_min ?? null, tahmini_tl_max: i?.tahmini_tl_max ?? null, fiyat_guven: i?.fiyat_guven,
    bagli_idler: i?.bagli_idler ?? [], not: i?.not ?? '',
  };
}

/** Form değerleri → kural girdisi. */
export function toLayerLike(v: LayerFormValues): LayerLike {
  return {
    katman_tur: (v.katman_tur || undefined) as LayerLike['katman_tur'], cct_min: v.cct[0], cct_max: v.cct[1],
    cri_min: v.cri_min ?? undefined, acikta: v.acikta, montaj_yukseklik_cm: v.montaj_yukseklik_cm ?? undefined,
    uzunluk_m: v.uzunluk_m ?? undefined, w_per_m: v.w_per_m ?? undefined, surucu_w: v.surucu_w ?? undefined,
    lux_min: v.lux_min ?? undefined, kontrol_cihaz: (v.kontrol_cihaz || undefined) as LayerLike['kontrol_cihaz'],
  };
}

/**
 * Form → patch: boş alanlar null ile temizlenir; var olan kayıtta yalnız değişenler (tip hep kalır).
 * CCT yalnız mod seçiliyse (ya da kayıtta zaten varsa) yazılır: kaydırıcının varsayılanı "dolu spec" sayılmaz.
 */
export function toLayerPatch(v: LayerFormValues, oda: string, prev?: Item): Record<string, unknown> {
  const katmanAd = v.katman_ad.trim();
  const derived = `${label('oda', oda)} ${label('katman_tur', v.katman_tur)}`.trim();
  const writeCct = !!v.cct_mod || prev?.cct_min != null || prev?.cct_max != null;
  const patch: Record<string, unknown> = {
    tip: 'aydinlatma', oda, ad: katmanAd || (prev ? prev.ad : derived),
    katman_tur: v.katman_tur || null, katman_ad: katmanAd || null, amac: v.amac.trim() || null,
    lux_min: v.lux_min, lux_max: v.lux_max, lux_duzlem: v.lux_duzlem ?? null,
    cct_mod: v.cct_mod ?? null, ...(writeCct ? { cct_min: v.cct[0], cct_max: v.cct[1] } : {}),
    dim_min_pct: v.dim_min_pct, cri_min: v.cri_min, r9_min: v.r9_min, flicker: v.flicker ?? null,
    kontrol_cihaz: v.kontrol_cihaz ?? null, urun_sinifi: v.urun_sinifi.trim() || null,
    uzunluk_m: v.uzunluk_m, w_per_m: v.w_per_m, surucu_model: v.surucu_model.trim() || null, surucu_w: v.surucu_w,
    montaj_yukseklik_cm: v.montaj_yukseklik_cm, acikta: v.acikta, adim: v.adim ?? null, kim: v.kim.length ? v.kim : null,
    tahmini_tl_min: v.tahmini_tl_min, tahmini_tl_max: v.tahmini_tl_max ?? v.tahmini_tl_min,
    fiyat_guven: v.fiyat_guven ?? (v.tahmini_tl_min != null ? 'tahmini' : null),
    bagli_idler: v.bagli_idler.length ? v.bagli_idler : null, not: v.not.trim() || null,
  };
  if (prev) {
    const p = prev as unknown as Record<string, unknown>;
    for (const k of Object.keys(patch)) {
      if (k === 'tip') continue;
      const a = patch[k]; const b = p[k];
      const eq = Array.isArray(a) ? JSON.stringify(a) === JSON.stringify(b ?? null) : (a ?? null) === (b ?? null) || (a === false && b === undefined);
      if (eq) delete patch[k];
    }
  }
  return patch;
}

function NumField({ form, name, label: lbl, inputMode = 'numeric', ...rest }: {
  form: UseFormReturnType<LayerFormValues>; name: NumKey; label: string; inputMode?: 'numeric' | 'decimal';
} & Omit<NumberInputProps, 'value' | 'onChange' | 'label' | 'inputMode' | 'error' | 'form'>) {
  return (
    <NumberInput
      label={lbl} hideControls inputMode={inputMode} min={0} decimalSeparator="," allowDecimal={inputMode === 'decimal'}
      value={form.getValues()[name] ?? ''} onChange={(v) => form.setFieldValue(name, v === '' ? null : Number(v))}
      error={form.errors[name]} {...rest}
    />
  );
}

const modalCloseProps = { size: 'xl' as const, 'aria-label': 'Kapat' };

/** Kayıt çözülmeden form kurulmaz: yükleniyorsa iskelet, bulunamadıysa uyarı; aksi halde gövde `key` = kayıt kimliği. */
export function LayerForm({ oda, id }: { oda: string; id: string }) {
  const [, navigate] = useLocation();
  const isNew = id === 'yeni';
  const selectItem = useMemo(() => (s: AppState) => (isNew ? undefined : s.items.find((i) => i.id === id)), [isNew, id]);
  const item = useAppStore(selectItem);
  const loading = useAppStore(selectFirstLoad);
  const isMobile = useMediaQuery('(max-width: 48em)', true);
  const close = () => navigate(`~/aydinlatma/${oda}`);
  if (!isNew && !item) {
    return (
      <Modal opened onClose={close} title="Katman" fullScreen={isMobile} closeButtonProps={modalCloseProps}>
        {loading ? <DetailSkeleton testId="layer-form-loading" /> : <Alert color="yellow">Katman bulunamadı (silinmiş ya da henüz eşitlenmemiş olabilir).</Alert>}
      </Modal>
    );
  }
  return <LayerFormBody key={item?.id ?? 'yeni'} oda={oda} item={item} onClose={close} />;
}

function LayerFormBody({ oda, item, onClose }: { oda: string; item?: Item; onClose: () => void }) {
  const isNew = !item;
  const purchases = useAppStore(selectPurchases);
  const room = useRoomSetting(oda);
  const isMobile = useMediaQuery('(max-width: 48em)', true);
  const zodValidate = useMemo(() => schemaResolver(schema, { sync: true }), []);
  // initialValues yalnız mount'ta okunur; bileşen kayıt kimliğiyle anahtarlandığından sunucu güncellemesi düzenlemeyi ezmez.
  const form = useForm<LayerFormValues>({
    mode: 'controlled', initialValues: toForm(item),
    validate: (values) => ({ ...zodValidate(values), ...fieldErrors(toLayerLike(values), room) }),
  });
  const [q, setQ] = useState('');
  const values = form.getValues();
  const warnings = validateLayer(toLayerLike(values), room).warnings;
  const roomLabel = label('oda', oda);
  const purchaseOptions = useMemo(() => {
    const rank = (p: Item) => (p.oda === oda ? 0 : p.oda === 'genel' || !p.oda ? 1 : 2);
    const coll = new Intl.Collator('tr');
    return purchases.slice().sort((a, b) => rank(a) - rank(b) || coll.compare(a.ad, b.ad));
  }, [purchases, oda]);
  const qn = q.trim().toLocaleLowerCase('tr');
  const visiblePurchases = qn ? purchaseOptions.filter((p) => p.ad.toLocaleLowerCase('tr').includes(qn) || values.bagli_idler.includes(p.id)) : purchaseOptions;

  const save = (v: LayerFormValues) => {
    upsert('kalemler', item?.id, toLayerPatch(v, oda, item));
    notifications.show({ message: isNew ? 'Katman eklendi' : 'Kaydedildi', color: 'green', autoClose: 1500 });
    onClose();
  };
  const del = () => modals.openConfirmModal({
    title: 'Katmanı sil?', children: <Text size="sm">"{item ? (item.katman_ad || item.ad) : ''}" listeden kaldırılır (Sheets'te silinmiş olarak işaretlenir).</Text>,
    labels: { confirm: 'Sil', cancel: 'Vazgeç' }, confirmProps: { color: 'red' },
    onConfirm: () => { if (item) remove('kalemler', item.id); notifications.show({ message: 'Silindi', color: 'gray', autoClose: 1500 }); onClose(); },
  });

  return (
    <Modal opened onClose={onClose} title={isNew ? `${roomLabel} · yeni katman` : `${roomLabel} · katman`} fullScreen={isMobile} size="lg"
      closeButtonProps={modalCloseProps} styles={{ body: { paddingBottom: 96 } }}>
      <form onSubmit={form.onSubmit(save)} noValidate data-testid="layer-form">
        <Stack gap="sm">
          <EnumSelect label="Katman türü" field="katman_tur" options={KATMAN_TUR} required value={values.katman_tur || undefined}
            onChange={(v) => form.setFieldValue('katman_tur', v ?? '')} error={form.errors.katman_tur} />
          <TextInput label="Katman adı" placeholder={`ör. ${roomLabel} tavan`} autoFocus={isNew} {...form.getInputProps('katman_ad')} key={form.key('katman_ad')} />
          <TextInput label="Amaç" {...form.getInputProps('amac')} key={form.key('amac')} />

          <Divider label="Işık" labelPosition="left" />
          <SimpleGrid cols={2} spacing="xs">
            <NumField form={form} name="lux_min" label="Lux min" />
            <NumField form={form} name="lux_max" label="Lux max" />
          </SimpleGrid>
          <EnumSelect label="Lux düzlemi" field="lux_duzlem" options={LUX_DUZLEM} value={values.lux_duzlem} onChange={(v) => form.setFieldValue('lux_duzlem', v)} />

          <Divider label="Renk sıcaklığı" labelPosition="left" />
          <EnumSelect label="CCT modu" field="cct_mod" options={CCT_MOD} value={values.cct_mod} onChange={(v) => form.setFieldValue('cct_mod', v)} />
          <CctSlider value={values.cct} onChange={(v) => form.setFieldValue('cct', v)} error={form.errors.cct_max} />
          <NumField form={form} name="dim_min_pct" label="Dim min (%)" max={100} />

          <Divider label="Kalite" labelPosition="left" />
          <SimpleGrid cols={2} spacing="xs">
            <NumField form={form} name="cri_min" label="CRI min" max={100} />
            <NumField form={form} name="r9_min" label="R9 min" max={100} />
          </SimpleGrid>
          <EnumSelect label="Flicker" field="flicker" options={FLICKER} value={values.flicker} onChange={(v) => form.setFieldValue('flicker', v)} />

          <Divider label="Kontrol ve ürün" labelPosition="left" />
          <EnumSelect label="Kontrol cihazı" field="kontrol_cihaz" options={KONTROL_CIHAZ} value={values.kontrol_cihaz} onChange={(v) => form.setFieldValue('kontrol_cihaz', v)} />
          <TextInput label="Ürün sınıfı" placeholder="ör. COB şerit 24V" {...form.getInputProps('urun_sinifi')} key={form.key('urun_sinifi')} />

          <Divider label="Şerit ve sürücü" labelPosition="left" />
          <SimpleGrid cols={2} spacing="xs">
            <NumField form={form} name="uzunluk_m" label="Uzunluk (m)" inputMode="decimal" />
            <NumField form={form} name="w_per_m" label="W/m" inputMode="decimal" />
            <TextInput label="Sürücü modeli" {...form.getInputProps('surucu_model')} key={form.key('surucu_model')} />
            <NumField form={form} name="surucu_w" label="Sürücü (W)" inputMode="decimal" />
          </SimpleGrid>

          <Divider label="Montaj" labelPosition="left" />
          <NumField form={form} name="montaj_yukseklik_cm" label="Montaj yüksekliği (cm)" />
          <Switch label="Açıkta (şerit/kablo görünür)" {...form.getInputProps('acikta', { type: 'checkbox' })} key={form.key('acikta')} />

          <Divider label="Plan" labelPosition="left" />
          <EnumSelect label="Adım" field="adim" options={ADIM} value={values.adim} onChange={(v) => form.setFieldValue('adim', v)} />
          <div>
            <Text size="sm" fw={500} mb={4}>Kim</Text>
            <Chip.Group multiple value={values.kim} onChange={(v) => form.setFieldValue('kim', v)}>
              <Group gap={6}>
                {KIM.map((k) => <Chip key={k} value={k} variant="outline">{label('kim', k)}</Chip>)}
              </Group>
            </Chip.Group>
          </div>

          <Divider label="Fiyat" labelPosition="left" />
          <SimpleGrid cols={2} spacing="xs">
            <PriceInput label="Tahmini (min)" value={values.tahmini_tl_min} onChange={(v) => form.setFieldValue('tahmini_tl_min', v)} error={form.errors.tahmini_tl_min} />
            <PriceInput label="Tahmini (max)" value={values.tahmini_tl_max} onChange={(v) => form.setFieldValue('tahmini_tl_max', v)} error={form.errors.tahmini_tl_max} />
          </SimpleGrid>
          <EnumSelect label="Fiyat güveni" field="fiyat_guven" options={FIYAT_GUVEN} value={values.fiyat_guven} onChange={(v) => form.setFieldValue('fiyat_guven', v)} />

          <Divider label="Bağlı ürünler" labelPosition="left" />
          {purchaseOptions.length === 0 ? (
            <Text size="sm" c="dimmed">Satınalma listesinde kalem yok.</Text>
          ) : (
            <>
              {purchaseOptions.length > 8 && (
                <TextInput placeholder="Ürün ara" aria-label="Ürün ara" type="search" value={q} onChange={(e) => setQ(e.currentTarget.value)} />
              )}
              <Chip.Group multiple value={values.bagli_idler} onChange={(v) => form.setFieldValue('bagli_idler', v)}>
                <Group gap={6}>
                  {visiblePurchases.map((p) => <Chip key={p.id} value={p.id} variant="outline">{p.ad}</Chip>)}
                </Group>
              </Chip.Group>
            </>
          )}

          <Textarea label="Not" autosize minRows={3} {...form.getInputProps('not')} key={form.key('not')} />

          {warnings.length > 0 && (
            <Alert color="yellow" variant="light" icon={<WarningIcon size={20} aria-hidden />} title="Uyarı" data-testid="layer-warnings">
              {warnings.map((w) => <Text size="sm" key={w}>{w}</Text>)}
            </Alert>
          )}
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
