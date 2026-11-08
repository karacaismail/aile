import { SectionHeading } from '@/components/Info';
import { FormSelect } from '@/components/FormSelect';
import { useMemo, useRef, useState } from 'react';
import { ActionIcon, Alert, Button, Group, Modal, NumberInput, Paper, Stack, TextInput, Textarea } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useMediaQuery } from '@mantine/hooks';
import { confirmDelete, unlessConfirming } from '@/components/confirmDelete';
import { notifications } from '@mantine/notifications';
import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus';
import { TrashIcon } from '@phosphor-icons/react/dist/csr/Trash';
import { useLocation } from 'wouter';
import type { Item } from '@shared/schema';
import { ODA, TETIK, label } from '@shared/schema';
import { useAppStore, type AppState } from '@/sync/store';
import { ownedChanges } from '@/lib/fieldOwnership';
import { useDraftOwnership } from '@/lib/useDraftOwnership';
import { useRouteModalFocusReturn } from '@/lib/routeModalFocus';
import { DraftConflict } from '@/components/DraftConflict';
import { upsert, remove } from '@/sync/controller';
import { selectFirstLoad } from '@/data/selectors';
import { EnumSelect } from '@/components/EnumSelect';
import { DetailSkeleton } from '@/components/DetailSkeleton';
import { FormFooter, focusFirstError } from '@/components/FormFooter';
import { byId, selectLayers } from './data';
import { levelText } from './SceneCard';
import { formatLevel, layerTitle, parseLevel, sortLayers, type SceneLevel } from './rules';
import classes from './lighting.module.css';

export type SceneFormValues = { ad: string; oda?: string; tetik?: string; seviyeler: SceneLevel[]; not: string };

export function toSceneForm(i?: Item): SceneFormValues {
  return { ad: i?.ad ?? '', oda: i?.oda, tetik: i?.tetik, seviyeler: (i?.seviyeler ?? []).map(parseLevel).filter((x): x is SceneLevel => !!x), not: i?.not ?? '' };
}

/** Form → patch: boş alanlar null ile temizlenir; var olan kayıtta yalnız değişenler (tip hep kalır). */
export function toScenePatch(v: SceneFormValues, prev?: Item): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    tip: 'sahne', ad: v.ad.trim(), oda: v.oda ?? null, tetik: v.tetik ?? null,
    seviyeler: v.seviyeler.length ? v.seviyeler.map(formatLevel) : null, not: v.not.trim() || null,
  };
  if (prev) {
    const p = prev as unknown as Record<string, unknown>;
    for (const k of Object.keys(patch)) {
      if (k === 'tip') continue;
      const a = patch[k]; const b = p[k];
      const eq = Array.isArray(a) ? JSON.stringify(a) === JSON.stringify(b ?? null) : (a ?? null) === (b ?? null);
      if (eq) delete patch[k];
    }
  }
  return patch;
}

/**
 * Patch for an existing scene in stored meaning. `seviyeler` is one whole-array field: a change on either side to any
 * row is a change of the whole list, so a same-list server change is a conflict, never an index merge.
 */
export function ownedScenePatch(baseline: SceneFormValues, values: SceneFormValues, latest: Item) {
  return ownedChanges((v: SceneFormValues) => toScenePatch(v), baseline, values, toSceneForm(latest));
}

const selectAllItems = (s: AppState) => s.items;

const FIELD_LABELS: Record<string, string> = { ad: 'Ad', oda: 'Oda', tetik: 'Tetik', seviyeler: 'Işık seviyeleri', not: 'Not' };

function validateScene(v: SceneFormValues): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!v.ad.trim()) errors.ad = 'Ad gerekli';
  v.seviyeler.forEach((r, i) => {
    if (!r.layerId) errors[`seviyeler.${i}.layerId`] = 'Katman seçin';
    if (r.pct != null && (r.pct < 0 || r.pct > 100)) errors[`seviyeler.${i}.pct`] = '0–100 arası';
  });
  return errors;
}

const modalCloseProps = { size: 'xl' as const, 'aria-label': 'Kapat' };

/** Kayıt çözülmeden form kurulmaz: yükleniyorsa iskelet, bulunamadıysa uyarı; aksi halde gövde `key` = kayıt kimliği. */
export function SceneForm({ id }: { id: string }) {
  const [, navigate] = useLocation();
  const isNew = id === 'yeni';
  const selectItem = useMemo(() => (s: AppState) => (isNew ? undefined : s.items.find((i) => i.id === id)), [isNew, id]);
  const item = useAppStore(selectItem);
  const loading = useAppStore(selectFirstLoad);
  const isMobile = useMediaQuery('(max-width: 48em)', true);
  const close = () => navigate('~/aydinlatma');
  // Any close path returns focus to the opener, else this scene in the Sahneler list, else the page h1.
  useRouteModalFocusReturn(() => window.location.hash.includes(`/aydinlatma/sahne/${id}`), () => document.querySelector<HTMLElement>(`[data-scene-id="${CSS.escape(id)}"]`));
  if (!isNew && !item) {
    return (
      <Modal opened onClose={close} title="Sahne" fullScreen={isMobile} closeButtonProps={modalCloseProps}>
        {loading ? <DetailSkeleton testId="scene-form-loading" /> : <Alert color="yellow">Sahne bulunamadı (silinmiş ya da henüz eşitlenmemiş olabilir).</Alert>}
      </Modal>
    );
  }
  return <SceneFormBody key={item?.id ?? 'yeni'} item={item} onClose={close} />;
}

function SceneFormBody({ item, onClose }: { item?: Item; onClose: () => void }) {
  const isNew = !item;
  const layers = useAppStore(selectLayers);
  const isMobile = useMediaQuery('(max-width: 48em)', true);
  // initialValues yalnız mount'ta okunur; bileşen kayıt kimliğiyle anahtarlandığından sunucu güncellemesi düzenlemeyi ezmez.
  const [initial] = useState(() => toSceneForm(item));
  const form = useForm<SceneFormValues>({ mode: 'controlled', initialValues: initial, validate: validateScene });
  // Ownership baseline: the form as it opened; a resolved conflict moves that field's baseline to the server value.
  const { baseline, conflicts, setConflicts, resolve } = useDraftOwnership(initial, () => item && toSceneForm(item), (key, value) => form.setFieldValue(key, value as never));
  const layerMap = useMemo(() => byId(layers), [layers]);
  const shown = (field: string, v: SceneFormValues) => {
    const value = toScenePatch(v)[field];
    if (value == null || value === '') return { value: 'boş' };
    if (field === 'seviyeler') return { value: v.seviyeler.map((lv) => levelText(lv, layerMap)).join('; ') };
    if (field === 'oda' || field === 'tetik') return { value: label(field, value as string) };
    return { value: String(value) };
  };
  const formRef = useRef<HTMLFormElement>(null);
  const values = form.getValues();
  const allItems = useAppStore(selectAllItems);
  const inRoom = useMemo(() => (values.oda ? layers.filter((l) => l.oda === values.oda) : []), [layers, values.oda]);
  const layerOptions = useMemo(() => {
    const list = sortLayers(inRoom.length ? inRoom : layers);
    return [{ value: '', label: '— katman seç —' }, ...list.map((l) => ({ value: l.id, label: `${label('oda', l.oda)} · ${layerTitle(l)}` }))];
  }, [layers, inRoom]);
  // A selected layer outside the room filter stays a visible option with its own room; a deleted or unknown one says so.
  // The stored id is never replaced or dropped.
  const rowOptions = (selected: string) => {
    if (!selected || layerOptions.some((o) => o.value === selected)) return layerOptions;
    const l = allItems.find((i) => i.id === selected && i.tip === 'aydinlatma');
    const text = l ? `${label('oda', l.oda)} · ${layerTitle(l)}${l.deleted_at ? ' · silinmiş katman' : ''}` : `Bulunamayan katman · ${selected}`;
    return [...layerOptions, { value: selected, label: text }];
  };
  const roomName = values.oda ? label('oda', values.oda) : '';
  const scope = !values.oda ? 'Oda seçilmedi; tüm odaların katmanları listelenir.'
    : inRoom.length ? `Seçim listesi ${roomName} katmanlarıyla sınırlı. Başka odadan seçilmiş katmanlar kendi odasıyla gösterilir.`
    : `${roomName} için katman yok; tüm odaların katmanları listelenir.`;

  const save = (v: SceneFormValues) => {
    const owned = item ? ownedScenePatch(baseline, v, item) : null;
    // Aynı alanı sunucu da değiştirdiyse yazılmaz: çakışma görünür çözülür, taslak korunur.
    if (owned?.conflicts.length) { setConflicts(owned.conflicts as (keyof SceneFormValues)[]); return; }
    // Kullanıcı hiçbir alanı değiştirmediyse (ya da fark kırpmayla kayboluyorsa) Sheets'e yazılmaz: sürüm/son güncelleyen bozulmaz.
    if (owned && !owned.writes) { onClose(); return; }
    const patch = owned ? owned.patch : toScenePatch(v);
    upsert('kalemler', item?.id, patch);
    notifications.show({ message: isNew ? 'Sahne eklendi' : 'Kaydedildi', color: 'green', autoClose: 1500 });
    onClose();
  };
  // The route closes after the confirmation dialog has left, so that dialog's own focus return cannot pull focus
  // back to a removed button; then focus goes to the record, or the page h1 once the record is gone.
  const del = () => confirmDelete({
    title: 'Sahneyi sil?', body: <>"{item?.ad}" listeden kaldırılır (Sheets'te silinmiş olarak işaretlenir).</>,
    onDelete: () => { if (item) remove('kalemler', item.id); notifications.show({ message: 'Silindi', color: 'gray', autoClose: 1500 }); }, onClosed: onClose,
  });
  const addRow = () => form.insertListItem('seviyeler', { layerId: '', pct: null, cct: null } satisfies SceneLevel);

  return (
    <Modal opened onClose={unlessConfirming(onClose)} title={isNew ? 'Yeni sahne' : 'Sahne'} fullScreen={isMobile} size="lg"
      closeButtonProps={modalCloseProps} styles={{ body: { paddingBottom: 'var(--aile-fab-clearance)' } }}>
      <form ref={formRef} onSubmit={form.onSubmit(save, (errors) => focusFirstError(formRef.current, errors))} noValidate data-testid="scene-form">
        <Stack gap="sm">
          <Stack component="section" aria-label="Sahne bilgileri" className="record-form-section" gap="sm"><SectionHeading title="Sahne bilgileri" level={3} />
            {item && <DraftConflict fields={conflicts} label={(field) => FIELD_LABELS[field] ?? field} onResolve={resolve}
              mine={(field) => shown(field, form.getValues())} theirs={(field) => shown(field, toSceneForm(item))} />}
            {/* Yeni sahnede ilk alan odaklanır (Mantine FocusTrap `data-autofocus`); düzenlemede odak modal başlığında kalır. */}
            <TextInput label="Ad" required data-autofocus={isNew || undefined} placeholder="ör. Akşam filmi" {...form.getInputProps('ad')} key={form.key('ad')} />
            <EnumSelect label="Oda" field="oda" options={ODA} value={values.oda} onChange={(v) => form.setFieldValue('oda', v)} />
            <EnumSelect label="Tetik" field="tetik" options={TETIK} value={values.tetik} onChange={(v) => form.setFieldValue('tetik', v)} />
            <Textarea label="Not" autosize minRows={3} {...form.getInputProps('not')} key={form.key('not')} />
          </Stack>
          <Stack component="section" aria-label="Işık seviyeleri" className="record-form-section" gap="sm"><SectionHeading title="Işık seviyeleri" level={3} description={<span data-testid="scene-level-scope">{scope}</span>} />
              <Stack gap="xs">
                {values.seviyeler.map((row, i) => (
                  <Paper key={i} p="var(--budget-clearField)" radius="md" data-testid="scene-level-row">
                    <Stack gap="sm">
                      <FormSelect label={`Katman ${i + 1}`} allowDeselect={false} data={rowOptions(row.layerId)} value={row.layerId} data-path={`seviyeler.${i}.layerId`}
                        onChange={(value) => form.setFieldValue(`seviyeler.${i}.layerId`, value ?? '')} error={form.errors[`seviyeler.${i}.layerId`]} />
                      <Group gap="sm" wrap="nowrap" align="flex-start">
                        <NumberInput label="Parlaklık %" hideControls inputMode="numeric" min={0} max={100} className={classes.grow} data-path={`seviyeler.${i}.pct`}
                          value={row.pct ?? ''} onChange={(v) => form.setFieldValue(`seviyeler.${i}.pct`, v === '' ? null : Number(v))} error={form.errors[`seviyeler.${i}.pct`]} />
                        <NumberInput label="CCT (K)" hideControls inputMode="numeric" min={0} className={classes.grow}
                          value={row.cct ?? ''} onChange={(v) => form.setFieldValue(`seviyeler.${i}.cct`, v === '' ? null : Number(v))} />
                        <ActionIcon aria-label={`Seviye ${i + 1} sil`} color="red" mt="lg" onClick={() => form.removeListItem('seviyeler', i)}>
                          <TrashIcon size={20} aria-hidden />
                        </ActionIcon>
                      </Group>
                    </Stack>
                  </Paper>
                ))}
                <Button variant="default" leftSection={<PlusIcon size={18} aria-hidden />} onClick={addRow}>Seviye ekle</Button>
              </Stack>
          </Stack>
          <FormFooter errors={form.errors} onCancel={onClose} onDelete={isNew ? undefined : del} />
        </Stack>
      </form>
    </Modal>
  );
}
