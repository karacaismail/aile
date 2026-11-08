import { SectionHeading } from '@/components/Info';
import { useMemo, useRef, useState } from 'react';
import { Alert, Chip, Divider, Group, Modal, NumberInput, SimpleGrid, Stack, Switch, Text, TextInput, Textarea, type NumberInputProps } from '@mantine/core';
import { useForm, schemaResolver, type UseFormReturnType } from '@mantine/form';
import { useMediaQuery } from '@mantine/hooks';
import { confirmDelete, unlessConfirming } from '@/components/confirmDelete';
import { notifications } from '@mantine/notifications';
import { WarningIcon } from '@phosphor-icons/react/dist/csr/Warning';
import { z } from 'zod';
import { useLocation } from 'wouter';
import type { Item } from '@shared/schema';
import { ADIM, CCT_MOD, FIYAT_GUVEN, FLICKER, KATMAN_TUR, KIM, KONTROL_CIHAZ, LUX_DUZLEM, label } from '@shared/schema';
import { useAppStore, type AppState } from '@/sync/store';
import { ownedChanges } from '@/lib/fieldOwnership';
import { useDraftOwnership, type StoredField } from '@/lib/useDraftOwnership';
import { useRouteModalFocusReturn } from '@/lib/routeModalFocus';
import { DraftConflict } from '@/components/DraftConflict';
import { formatTl } from '@/lib/price';
import { upsert, remove } from '@/sync/controller';
import { selectFirstLoad } from '@/data/selectors';
import { PriceInput } from '@/components/PriceInput';
import { EnumSelect } from '@/components/EnumSelect';
import { DetailSkeleton } from '@/components/DetailSkeleton';
import { FormFooter, focusFirstError } from '@/components/FormFooter';
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
  /** null: the record has no CCT; the slider shows DEFAULT_CCT until the user moves it. */
  /** Each bound is its own stored field: the latest record or a resolved bound may leave one bound empty. */
  cct_mod?: string; cct: [number | null, number | null] | null;
  dim_min_pct: number | null; cri_min: number | null; r9_min: number | null;
  flicker?: string; kontrol_cihaz?: string; urun_sinifi: string;
  uzunluk_m: number | null; w_per_m: number | null; surucu_model: string; surucu_w: number | null;
  montaj_yukseklik_cm: number | null; acikta: boolean; adim?: string; kim: string[];
  tahmini_tl_min: number | null; tahmini_tl_max: number | null; fiyat_guven?: string;
  bagli_idler: string[]; not: string;
};

type NumKey = 'lux_min' | 'lux_max' | 'dim_min_pct' | 'cri_min' | 'r9_min' | 'uzunluk_m' | 'w_per_m' | 'surucu_w' | 'montaj_yukseklik_cm';

const clampCct = (v: number) => Math.min(CCT_RANGE.max, Math.max(CCT_RANGE.min, v));
export const DEFAULT_CCT: [number, number] = [2700, 4000];

export function toForm(i?: Item): LayerFormValues {
  const lo = i?.cct_min ?? i?.cct_max;
  const hi = i?.cct_max ?? i?.cct_min;
  return {
    katman_tur: i?.katman_tur ?? '', katman_ad: i?.katman_ad ?? (i ? i.ad : ''), amac: i?.amac ?? '',
    lux_min: i?.lux_min ?? null, lux_max: i?.lux_max ?? null, lux_duzlem: i?.lux_duzlem,
    cct_mod: i?.cct_mod, cct: lo != null && hi != null ? [clampCct(Math.min(lo, hi)), clampCct(Math.max(lo, hi))] : null,
    dim_min_pct: i?.dim_min_pct ?? null, cri_min: i?.cri_min ?? null, r9_min: i?.r9_min ?? null,
    flicker: i?.flicker, kontrol_cihaz: i?.kontrol_cihaz, urun_sinifi: i?.urun_sinifi ?? '',
    uzunluk_m: i?.uzunluk_m ?? null, w_per_m: i?.w_per_m ?? null, surucu_model: i?.surucu_model ?? '', surucu_w: i?.surucu_w ?? null,
    montaj_yukseklik_cm: i?.montaj_yukseklik_cm ?? null, acikta: !!i?.acikta, adim: i?.adim, kim: i?.kim ?? [],
    tahmini_tl_min: i?.tahmini_tl_min ?? null, tahmini_tl_max: i?.tahmini_tl_max ?? null, fiyat_guven: i?.fiyat_guven,
    bagli_idler: i?.bagli_idler ?? [], not: i?.not ?? '',
  };
}

/** Form değerleri → kural girdisi. */
/** The slider's pair: an empty bound shows the other bound (as a single stored bound reads), else the default. */
export const shownCct = (c: LayerFormValues['cct']): [number, number] => [c?.[0] ?? c?.[1] ?? DEFAULT_CCT[0], c?.[1] ?? c?.[0] ?? DEFAULT_CCT[1]];

/**
 * A slider move written back to the stored bounds: only a bound whose shown value moved is set, so a bound that is empty
 * in the record (shown from the other bound) stays empty. With no CCT at all the visible pair is the user's explicit choice.
 */
export const movedCct = (c: LayerFormValues['cct'], next: [number, number]): LayerFormValues['cct'] => {
  if (!c) return next;
  const shown = shownCct(c);
  return [next[0] !== shown[0] ? next[0] : c[0], next[1] !== shown[1] ? next[1] : c[1]];
};

export function toLayerLike(v: LayerFormValues): LayerLike {
  return {
    katman_tur: (v.katman_tur || undefined) as LayerLike['katman_tur'], cct_min: shownCct(v.cct)[0], cct_max: shownCct(v.cct)[1],
    cri_min: v.cri_min ?? undefined, acikta: v.acikta, montaj_yukseklik_cm: v.montaj_yukseklik_cm ?? undefined,
    uzunluk_m: v.uzunluk_m ?? undefined, w_per_m: v.w_per_m ?? undefined, surucu_w: v.surucu_w ?? undefined,
    lux_min: v.lux_min ?? undefined, kontrol_cihaz: (v.kontrol_cihaz || undefined) as LayerLike['kontrol_cihaz'],
  };
}

/**
 * Form → patch: boş alanlar null ile temizlenir; var olan kayıtta yalnız değişenler (tip hep kalır).
 * CCT yalnız kayıtta varsa, kullanıcı kaydırıcıyı oynattıysa ya da mod seçiliyse yazılır: dokunulmamış varsayılan "dolu spec" sayılmaz.
 */
export function toLayerPatch(v: LayerFormValues, oda: string, prev?: Item): Record<string, unknown> {
  const katmanAd = v.katman_ad.trim();
  const derived = `${label('oda', oda)} ${label('katman_tur', v.katman_tur)}`.trim();
  const cct = v.cct ?? (v.cct_mod ? DEFAULT_CCT : null);
  const patch: Record<string, unknown> = {
    tip: 'aydinlatma', oda, ad: katmanAd || (prev ? prev.ad : derived),
    katman_tur: v.katman_tur || null, katman_ad: katmanAd || null, amac: v.amac.trim() || null,
    lux_min: v.lux_min, lux_max: v.lux_max, lux_duzlem: v.lux_duzlem ?? null,
    cct_mod: v.cct_mod ?? null, ...(cct ? { cct_min: cct[0], cct_max: cct[1] } : {}),
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

/** Stored meaning of a form, for ownership: every field present (absent CCT is null); `ad` follows `katman_ad` separately. */
function persistedLayer(v: LayerFormValues, oda: string): Record<string, unknown> {
  const { ad: _ad, ...rest } = toLayerPatch(v, oda);
  return { cct_min: null, cct_max: null, ...rest };
}

/** Form key a stored field belongs to (the CCT slider holds both ends). */
export const layerFormKey = (field: string): keyof LayerFormValues => (field === 'cct_min' || field === 'cct_max' ? 'cct' : field) as keyof LayerFormValues;

/**
 * The latest record as a form for ownership, with its raw CCT pair: `toForm` sorts and clamps the pair for the slider,
 * which would hide a reversed or out-of-range stored range and move a value to the other bound.
 */
export function latestLayerForm(i: Item): LayerFormValues {
  return { ...toForm(i), cct: i.cct_min == null && i.cct_max == null ? null : [i.cct_min ?? null, i.cct_max ?? null] };
}

/** Each CCT bound is its own stored field: resolving one bound copies only that bound (the slider holds both). */
const CCT_BOUND: Record<string, 0 | 1> = { cct_min: 0, cct_max: 1 };
export const layerStoredField: StoredField<LayerFormValues> = {
  key: layerFormKey,
  take: (target, field, from) => {
    if (!(field in CCT_BOUND)) return { ...target, [field]: from[field as keyof LayerFormValues] };
    const next: [number | null, number | null] = [target.cct?.[0] ?? null, target.cct?.[1] ?? null];
    next[CCT_BOUND[field]] = from.cct?.[CCT_BOUND[field]] ?? null;
    return { ...target, cct: next[0] == null && next[1] == null ? null : next };
  },
};

/** Range ends and cross-field rules a stored field takes part in, for naming the latest values beside a combined error. */
const RELATED: Record<string, string[]> = {
  lux_max: ['lux_min', 'lux_max'], tahmini_tl_max: ['tahmini_tl_min', 'tahmini_tl_max'], cct_max: ['cct_min', 'cct_max'],
  cri_min: ['katman_tur', 'cri_min'], montaj_yukseklik_cm: ['acikta', 'montaj_yukseklik_cm'], surucu_w: ['uzunluk_m', 'w_per_m', 'surucu_w'],
};
const layerSchemaErrors = schemaResolver(schema, { sync: true });
function recordErrors(r: Record<string, unknown>, room: ReturnType<typeof useRoomSetting>): Record<string, string> {
  const num = (k: string) => (typeof r[k] === 'number' ? r[k] as number : null);
  const numeric = layerSchemaErrors({ katman_tur: typeof r.katman_tur === 'string' ? r.katman_tur : '', lux_min: num('lux_min'), lux_max: num('lux_max'),
    dim_min_pct: num('dim_min_pct'), cri_min: num('cri_min'), r9_min: num('r9_min'), tahmini_tl_min: num('tahmini_tl_min'), tahmini_tl_max: num('tahmini_tl_max') });
  return { ...(numeric as Record<string, string>), ...(fieldErrors(r as LayerLike, room) as Record<string, string>) };
}

/**
 * Problems in the stored record the user's save would be responsible for: the exact latest record plus the owned patch
 * is checked with the form's numeric rules and the layer rules, and a problem counts when the patch writes any field that
 * rule depends on (`RELATED`), even if the latest record already had the same problem. A problem only in fields the user
 * did not touch is the stored record's own and does not block an unrelated edit.
 */
export function mergedLayerErrors(latest: Item, patch: Record<string, unknown>, room: ReturnType<typeof useRoomSetting>) {
  const after = recordErrors({ ...(latest as unknown as Record<string, unknown>), ...patch }, room);
  return Object.entries(after).map(([field, message]) => ({ field, message, related: RELATED[field] ?? [field] }))
    .filter((problem) => problem.related.some((f) => f !== 'tip' && f in patch));
}

/**
 * Patch for an existing layer: opening form, local form and latest record compared in stored meaning
 * (trimmed text, empty → null, derived price max/confidence, CCT only when it is a real value). Untouched fields,
 * including the untouched default CCT slider, are never written; a same-field server change is a conflict.
 */
export function ownedLayerPatch(baseline: LayerFormValues, values: LayerFormValues, latest: Item, oda: string) {
  const owned = ownedChanges((v: LayerFormValues) => persistedLayer(v, oda), baseline, values, latestLayerForm(latest));
  if (typeof owned.patch.katman_ad === 'string') owned.patch.ad = owned.patch.katman_ad;
  return owned;
}

const FIELD_LABELS: Record<string, string> = {
  katman_tur: 'Katman türü', katman_ad: 'Katman adı', amac: 'Amaç', oda: 'Oda', lux_min: 'Lux min', lux_max: 'Lux max', lux_duzlem: 'Lux düzlemi',
  cct_mod: 'CCT modu', cct_min: 'Renk sıcaklığı (alt)', cct_max: 'Renk sıcaklığı (üst)', dim_min_pct: 'Dim min (%)', cri_min: 'CRI min', r9_min: 'R9 min',
  flicker: 'Flicker', kontrol_cihaz: 'Kontrol cihazı', urun_sinifi: 'Ürün sınıfı', uzunluk_m: 'Uzunluk (m)', w_per_m: 'W/m', surucu_model: 'Sürücü modeli',
  surucu_w: 'Sürücü (W)', montaj_yukseklik_cm: 'Montaj yüksekliği (cm)', acikta: 'Açıkta', adim: 'Adım', kim: 'Kim', tahmini_tl_min: 'Tahmini (min)',
  tahmini_tl_max: 'Tahmini (max)', fiyat_guven: 'Fiyat güveni', bagli_idler: 'Bağlı ürünler', not: 'Not',
};
const ENUM_FIELDS = new Set(['katman_tur', 'lux_duzlem', 'cct_mod', 'flicker', 'kontrol_cihaz', 'adim', 'fiyat_guven', 'oda']);

function NumField({ form, name, label: lbl, inputMode = 'numeric', ...rest }: {
  form: UseFormReturnType<LayerFormValues>; name: NumKey; label: string; inputMode?: 'numeric' | 'decimal';
} & Omit<NumberInputProps, 'value' | 'onChange' | 'label' | 'inputMode' | 'error' | 'form'>) {
  return (
    <NumberInput
      label={lbl} hideControls inputMode={inputMode} min={0} decimalSeparator="," allowDecimal={inputMode === 'decimal'} data-path={name}
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
  // Any close path returns focus to the opener, else this layer on the room page, else the page h1.
  useRouteModalFocusReturn(() => window.location.hash.includes(`/aydinlatma/${oda}/${id}`), () => document.querySelector<HTMLElement>(`[data-layer-id="${CSS.escape(id)}"]`));
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
  const [initial] = useState(() => toForm(item));
  const form = useForm<LayerFormValues>({
    mode: 'controlled', initialValues: initial,
    validate: (values) => ({ ...zodValidate(values), ...fieldErrors(toLayerLike(values), room) }),
  });
  const formRef = useRef<HTMLFormElement>(null);
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

  // Ownership baseline: the form as it opened; a resolved conflict moves that field's baseline to the server value.
  const { baseline, conflicts, setConflicts, resolve } = useDraftOwnership(initial, () => item && latestLayerForm(item), (key, value) => form.setFieldValue(key, value as never), () => form.getValues(), layerStoredField);
  const [merged, setMerged] = useState<ReturnType<typeof mergedLayerErrors>>([]);
  const shown = (field: string, v: LayerFormValues) => {
    const value = persistedLayer(v, oda)[field];
    if (value == null || value === '' || (Array.isArray(value) && !value.length)) return { value: 'boş' };
    if (typeof value === 'boolean') return { value: value ? 'evet' : 'hayır' };
    if (ENUM_FIELDS.has(field)) return { value: label(field as 'adim', value as string) };
    if (field === 'kim') return { value: (value as string[]).map((k) => label('kim', k)).join(', ') };
    if (field === 'bagli_idler') return { value: (value as string[]).map((pid) => purchases.find((p) => p.id === pid)?.ad ?? pid).join(', ') };
    if (field.startsWith('tahmini_tl')) return { value: formatTl(value as number), derived: field === 'tahmini_tl_max' && v.tahmini_tl_max == null ? 'Tahmini (min) değerinden türetilir' : undefined };
    return { value: String(value) };
  };

  const save = (v: LayerFormValues) => {
    const owned = item ? ownedLayerPatch(baseline, v, item, oda) : null;
    // Aynı alanı sunucu da değiştirdiyse yazılmaz: çakışma görünür çözülür, taslak korunur.
    if (owned?.conflicts.length) { setConflicts(owned.conflicts); return; }
    // Kullanıcı hiçbir alanı değiştirmediyse (ya da fark kırpmayla kayboluyorsa) Sheets'e yazılmaz: sürüm/son güncelleyen bozulmaz.
    if (owned && !owned.writes) { onClose(); return; }
    // Son kayıt + sahiplenilen yama birlikte geçersizse (ör. sizin min 700, Sheets'teki max 500) yazılmaz; taslak ve son kayıt korunur.
    const problems = owned && item ? mergedLayerErrors(item, owned.patch, room) : [];
    setMerged(problems);
    if (problems.length) {
      const errors = Object.fromEntries(problems.flatMap((p) => p.related.filter((f) => f in owned!.patch).map((f) => [f, p.message])));
      form.setErrors(errors);
      requestAnimationFrame(() => focusFirstError(formRef.current, errors));
      return;
    }
    const patch = owned ? owned.patch : toLayerPatch(v, oda);
    upsert('kalemler', item?.id, patch);
    notifications.show({ message: isNew ? 'Katman eklendi' : 'Kaydedildi', color: 'green', autoClose: 1500 });
    onClose();
  };
  const del = () => confirmDelete({
    title: 'Katmanı sil?', body: <>"{item ? (item.katman_ad || item.ad) : ''}" listeden kaldırılır (Sheets'te silinmiş olarak işaretlenir).</>,
    onDelete: () => { if (item) remove('kalemler', item.id); notifications.show({ message: 'Silindi', color: 'gray', autoClose: 1500 }); }, onClosed: onClose,
  });

  return (
    <Modal opened onClose={unlessConfirming(onClose)} title={isNew ? `${roomLabel} · yeni katman` : `${roomLabel} · katman`} fullScreen={isMobile} size="lg"
      closeButtonProps={modalCloseProps} styles={{ body: { paddingBottom: 'var(--aile-fab-clearance)' } }}>
      <form ref={formRef} onSubmit={form.onSubmit(save, (errors) => focusFirstError(formRef.current, errors))} noValidate data-testid="layer-form">
        <Stack gap="sm">
          <Stack component="section" aria-label="Katman ve amaç" className="record-form-section" gap="sm">
            <SectionHeading title="Katman ve amaç" level={3} />
            {item && <DraftConflict fields={conflicts} label={(field) => FIELD_LABELS[field] ?? field} onResolve={resolve}
              mine={(field) => shown(field, form.getValues())} theirs={(field) => shown(field, latestLayerForm(item))} />}
            {item && merged.length > 0 && <Alert color="red" variant="light" role="alert" data-testid="merged-invalid" title="Kaydedilmedi: değişikliğiniz Sheets'teki son kayıtla birlikte geçersiz olur">
              <Stack gap="xs">
                {merged.map((p) => <Text key={p.field} size="sm"><b>{FIELD_LABELS[p.field] ?? p.field}</b>: {p.message}. Sheets'teki son değerler: {p.related.map((f) => `${FIELD_LABELS[f] ?? f} ${shown(f, latestLayerForm(item)).value}`).join(', ')}.</Text>)}
                <Text size="sm">Değerinizi düzeltip yeniden kaydedin; Sheets'teki değerler değiştirilmedi.</Text>
              </Stack>
            </Alert>}
            {/* Yeni katmanda ilk (zorunlu) alan odaklanır; düzenlemede odak modal başlığında kalır. */}
            <EnumSelect label="Katman türü" field="katman_tur" options={KATMAN_TUR} required value={values.katman_tur || undefined} data-path="katman_tur" data-autofocus={isNew || undefined}
              onChange={(v) => form.setFieldValue('katman_tur', v ?? '')} error={form.errors.katman_tur} />
            <TextInput label="Katman adı" placeholder={`ör. ${roomLabel} tavan`} {...form.getInputProps('katman_ad')} key={form.key('katman_ad')} />
            <TextInput label="Amaç" {...form.getInputProps('amac')} key={form.key('amac')} />

          </Stack>
          <Stack component="section" aria-label="Işık ve renk" className="record-form-section" gap="sm">
            <SectionHeading title="Işık ve renk" level={3} />
            <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="xs">
              <NumField form={form} name="lux_min" label="Lux min" />
              <NumField form={form} name="lux_max" label="Lux max" />
            </SimpleGrid>
            <EnumSelect label="Lux düzlemi" field="lux_duzlem" options={LUX_DUZLEM} value={values.lux_duzlem} onChange={(v) => form.setFieldValue('lux_duzlem', v)} />

            <Divider label="Renk sıcaklığı" labelPosition="left" />
            <EnumSelect label="CCT modu" field="cct_mod" options={CCT_MOD} value={values.cct_mod} onChange={(v) => form.setFieldValue('cct_mod', v)} />
            <CctSlider value={shownCct(values.cct)} onChange={(v) => form.setFieldValue('cct', movedCct(form.getValues().cct, v))} error={form.errors.cct_min ?? form.errors.cct_max} />
            <NumField form={form} name="dim_min_pct" label="Dim min (%)" max={100} />

            <Divider label="Kalite" labelPosition="left" />
            <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="xs">
              <NumField form={form} name="cri_min" label="CRI min" max={100} />
              <NumField form={form} name="r9_min" label="R9 min" max={100} />
            </SimpleGrid>
            <EnumSelect label="Flicker" field="flicker" options={FLICKER} value={values.flicker} onChange={(v) => form.setFieldValue('flicker', v)} />

          </Stack>
          <Stack component="section" aria-label="Ürün ve kurulum" className="record-form-section" gap="sm">
            <SectionHeading title="Ürün ve kurulum" level={3} />
            <EnumSelect label="Kontrol cihazı" field="kontrol_cihaz" options={KONTROL_CIHAZ} value={values.kontrol_cihaz} onChange={(v) => form.setFieldValue('kontrol_cihaz', v)} />
            <TextInput label="Ürün sınıfı" placeholder="ör. COB şerit 24V" {...form.getInputProps('urun_sinifi')} key={form.key('urun_sinifi')} />

            <Divider label="Şerit ve sürücü" labelPosition="left" />
            <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="xs">
              <NumField form={form} name="uzunluk_m" label="Uzunluk (m)" inputMode="decimal" />
              <NumField form={form} name="w_per_m" label="W/m" inputMode="decimal" />
              <TextInput label="Sürücü modeli" {...form.getInputProps('surucu_model')} key={form.key('surucu_model')} />
              <NumField form={form} name="surucu_w" label="Sürücü (W)" inputMode="decimal" />
            </SimpleGrid>

            <Divider label="Montaj" labelPosition="left" />
            <NumField form={form} name="montaj_yukseklik_cm" label="Montaj yüksekliği (cm)" />
            <Switch label="Açıkta (şerit/kablo görünür)" {...form.getInputProps('acikta', { type: 'checkbox' })} key={form.key('acikta')} />

          </Stack>
          <Stack component="section" aria-label="Plan ve ürün bağlantıları" className="record-form-section" gap="sm">
            <SectionHeading title="Plan ve ürün bağlantıları" level={3} />
            <EnumSelect label="Adım" field="adim" options={ADIM} value={values.adim} onChange={(v) => form.setFieldValue('adim', v)} />
            <div>
              <Text size="sm" fw={500} mb="xs">Kim</Text>
              <Chip.Group multiple value={values.kim} onChange={(v) => form.setFieldValue('kim', v)}>
                <Group gap="sm">
                  {KIM.map((k) => <Chip key={k} value={k} variant="outline">{label('kim', k)}</Chip>)}
                </Group>
              </Chip.Group>
            </div>

            <Divider label="Fiyat" labelPosition="left" />
            <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="xs">
              <PriceInput label="Tahmini (min)" data-path="tahmini_tl_min" value={values.tahmini_tl_min} onChange={(v) => form.setFieldValue('tahmini_tl_min', v)} error={form.errors.tahmini_tl_min} />
              <PriceInput label="Tahmini (max)" data-path="tahmini_tl_max" value={values.tahmini_tl_max} onChange={(v) => form.setFieldValue('tahmini_tl_max', v)} error={form.errors.tahmini_tl_max} />
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
                  <Group gap="sm">
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
          </Stack>
          <FormFooter errors={form.errors} onCancel={onClose} onDelete={isNew ? undefined : del} />
        </Stack>
      </form>
    </Modal>
  );
}
