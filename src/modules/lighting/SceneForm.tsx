import { useMemo } from 'react';
import { ActionIcon, Alert, Button, Group, Modal, NativeSelect, NumberInput, Paper, Stack, Text, TextInput, Textarea } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useMediaQuery } from '@mantine/hooks';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { FloppyDiskIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react';
import { useLocation } from 'wouter';
import type { Item } from '@shared/schema';
import { ODA, TETIK, label } from '@shared/schema';
import { useAppStore, type AppState } from '@/sync/store';
import { upsert, remove } from '@/sync/controller';
import { selectFirstLoad } from '@/data/selectors';
import { EnumSelect } from '@/components/EnumSelect';
import { DetailSkeleton } from '@/components/DetailSkeleton';
import { selectLayers } from './data';
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
  const form = useForm<SceneFormValues>({ mode: 'controlled', initialValues: toSceneForm(item), validate: validateScene });
  const values = form.getValues();
  const layerOptions = useMemo(() => {
    const inRoom = values.oda ? layers.filter((l) => l.oda === values.oda) : [];
    const list = sortLayers(inRoom.length ? inRoom : layers);
    return [{ value: '', label: '— katman seç —' }, ...list.map((l) => ({ value: l.id, label: `${label('oda', l.oda)} · ${layerTitle(l)}` }))];
  }, [layers, values.oda]);

  const save = (v: SceneFormValues) => {
    upsert('kalemler', item?.id, toScenePatch(v, item));
    notifications.show({ message: isNew ? 'Sahne eklendi' : 'Kaydedildi', color: 'green', autoClose: 1500 });
    onClose();
  };
  const del = () => modals.openConfirmModal({
    title: 'Sahneyi sil?', children: <Text size="sm">"{item?.ad}" listeden kaldırılır (Sheets'te silinmiş olarak işaretlenir).</Text>,
    labels: { confirm: 'Sil', cancel: 'Vazgeç' }, confirmProps: { color: 'red' },
    onConfirm: () => { if (item) remove('kalemler', item.id); notifications.show({ message: 'Silindi', color: 'gray', autoClose: 1500 }); onClose(); },
  });
  const addRow = () => form.insertListItem('seviyeler', { layerId: '', pct: null, cct: null } satisfies SceneLevel);

  return (
    <Modal opened onClose={onClose} title={isNew ? 'Yeni sahne' : 'Sahne'} fullScreen={isMobile} size="lg" transitionProps={{ transition: 'fade', duration: 120 }}
      closeButtonProps={modalCloseProps} styles={{ body: { paddingBottom: 96 } }}>
      <form onSubmit={form.onSubmit(save)} noValidate data-testid="scene-form">
        <Stack gap="sm">
          <TextInput label="Ad" required autoFocus={isNew} placeholder="ör. Akşam filmi" {...form.getInputProps('ad')} key={form.key('ad')} />
          <EnumSelect label="Oda" field="oda" options={ODA} value={values.oda} onChange={(v) => form.setFieldValue('oda', v)} />
          <EnumSelect label="Tetik" field="tetik" options={TETIK} value={values.tetik} onChange={(v) => form.setFieldValue('tetik', v)} />
          <div>
            <Text size="sm" fw={500} mb={4}>Seviyeler</Text>
            <Stack gap="xs">
              {values.seviyeler.map((row, i) => (
                <Paper key={i} withBorder p="xs" radius="md" data-testid="scene-level-row">
                  <Stack gap={6}>
                    <NativeSelect label={`Katman ${i + 1}`} data={layerOptions} value={row.layerId}
                      onChange={(e) => form.setFieldValue(`seviyeler.${i}.layerId`, e.currentTarget.value)} error={form.errors[`seviyeler.${i}.layerId`]} />
                    <Group gap={6} wrap="nowrap" align="flex-start">
                      <NumberInput label="Parlaklık %" hideControls inputMode="numeric" min={0} max={100} className={classes.grow}
                        value={row.pct ?? ''} onChange={(v) => form.setFieldValue(`seviyeler.${i}.pct`, v === '' ? null : Number(v))} error={form.errors[`seviyeler.${i}.pct`]} />
                      <NumberInput label="CCT (K)" hideControls inputMode="numeric" min={0} className={classes.grow}
                        value={row.cct ?? ''} onChange={(v) => form.setFieldValue(`seviyeler.${i}.cct`, v === '' ? null : Number(v))} />
                      <ActionIcon aria-label={`Seviye ${i + 1} sil`} color="red" mt={26} onClick={() => form.removeListItem('seviyeler', i)}>
                        <TrashIcon size={20} aria-hidden />
                      </ActionIcon>
                    </Group>
                  </Stack>
                </Paper>
              ))}
              <Button variant="default" leftSection={<PlusIcon size={18} aria-hidden />} onClick={addRow}>Seviye ekle</Button>
            </Stack>
          </div>
          <Textarea label="Not" autosize minRows={3} {...form.getInputProps('not')} key={form.key('not')} />
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
