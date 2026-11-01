import { useEffect, useId, useMemo, useRef, useState, type MouseEvent } from 'react';
import { ActionIcon, Alert, Box, Button, Card, Group, NumberInput, Paper, SimpleGrid, Stack, Table, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { ArrowLeftIcon } from '@phosphor-icons/react/dist/csr/ArrowLeft';
import { FloppyDiskIcon } from '@phosphor-icons/react/dist/csr/FloppyDisk';
import { HouseIcon } from '@phosphor-icons/react/dist/csr/House';
import { LightbulbIcon } from '@phosphor-icons/react/dist/csr/Lightbulb';
import { PencilSimpleIcon } from '@phosphor-icons/react/dist/csr/PencilSimple';
import { PlugIcon } from '@phosphor-icons/react/dist/csr/Plug';
import { ShoppingCartIcon } from '@phosphor-icons/react/dist/csr/ShoppingCart';
import { WarningIcon } from '@phosphor-icons/react/dist/csr/Warning';
import { Link, Route, useLocation } from 'wouter';
import type { Item, Oda, Setting } from '@shared/schema';
import { KOPEK_ERISIM, label } from '@shared/schema';
import { useAppStore, type AppState } from '@/sync/store';
import { upsert } from '@/sync/controller';
import { selectFirstLoad } from '@/data/selectors';
import { ownedChanges } from '@/lib/fieldOwnership';
import { FactList, SectionHeading } from '@/components/Info';
import { EnumSelect } from '@/components/EnumSelect';
import { WarnBadge } from '@/components/badges';
import { DraftConflict } from '@/components/DraftConflict';
import { useDraftOwnership } from '@/lib/useDraftOwnership';
import { Fab } from '@/app/shell/Fab';
import {
  ROOMS, WALL_KEYS, fmtM, formatDims, mergeRoomSetting, needsMap, needsTotal, parseRoomSetting, remaining, roomDimsValues, roomItems, suggestionPatches,
  wallItems, wallLabel, wallLength, type KopekErisim, type NeedsMap, type RoomDims, type WallKey,
} from './rules';
import { ItemForm } from './ItemForm';
import { roomSetting } from './RoomList';
import classes from './layout.module.css';

const selectState = (s: AppState) => ({ items: s.items, settings: s.settings });
// Kaynak okunmuş sayılır: ilk yükleme bitti ya da önbellekten/sunucudan bir okuma var (ayar kimliği bilinir).
const selectReady = (s: AppState) => !selectFirstLoad(s) || s.lastSync !== undefined;

function numOrNull(v: number | string): number | undefined { return v === '' || v === null || v === undefined ? undefined : Number(v); }

type DimKey = keyof RoomDims;
const DIM_LABELS: Record<DimKey, string> = { en_cm: 'En (cm)', boy_cm: 'Boy (cm)', yuk_cm: 'Yükseklik (cm)', kopek_erisim: 'Köpek erişimi' };
const cm = (n?: number) => (n === undefined ? undefined : `${n} cm`);
function dimText(key: DimKey, d: RoomDims): string {
  const v = d[key];
  if (v === undefined) return 'boş';
  return key === 'kopek_erisim' ? label('kopek_erisim', String(v)) : `${v} cm`;
}
const WALL_HINT = 'Kuzey/Güney duvarı = en, Doğu/Batı duvarı = boy.';

/**
 * Oda ölçü formu: en/boy/yükseklik + köpek erişimi → `tip='oda'` ayar satırı. Açılış hâli dayanaktır; arka plan okuması formu
 * yeniden kurmaz. Kayıt son ayarın kimliğini kullanır ve yalnız kullanıcının değiştirdiği alt anahtarları son `deger` üstüne yazar;
 * aynı alt anahtar sunucuda da değiştiyse DraftConflict.
 */
function RoomDimsForm({ oda, setting, initial, focusFirst, onDone }: { oda: Oda; setting?: Setting; initial: RoomDims; focusFirst: boolean; onDone: () => void }) {
  const [dims, setDims] = useState<RoomDims>(initial);
  const latest = parseRoomSetting(setting?.deger);
  const { baseline, conflicts, setConflicts, resolve, rebase } = useDraftOwnership<RoomDims>(initial, () => latest, (key, value) => setDims((d) => ({ ...d, [key]: value })));
  // Untouched dimensions follow a later source read (the form never remounts, so edited ones are kept).
  useEffect(() => {
    const next = Object.fromEntries((Object.keys(DIM_LABELS) as DimKey[]).filter((k) => (dims[k] ?? null) === (baseline[k] ?? null) && (latest[k] ?? null) !== (baseline[k] ?? null)).map((k) => [k, latest[k]])) as Partial<RoomDims>;
    if (!Object.keys(next).length) return;
    rebase(next);
    setDims((d) => ({ ...d, ...next }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the stored setting changes
  }, [setting?.deger]);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => { if (focusFirst) first.current?.focus(); }, [focusFirst]);
  const set = <K extends DimKey>(k: K, v: RoomDims[K]) => setDims((d) => ({ ...d, [k]: v }));
  const save = () => {
    const owned = ownedChanges(roomDimsValues, baseline, dims, latest, []);
    if (owned.conflicts.length) { setConflicts(owned.conflicts as DimKey[]); return; }
    if (!owned.writes) { onDone(); return; }
    upsert('ayarlar', setting?.id, { tip: 'oda', anahtar: oda, deger: mergeRoomSetting(setting?.deger, owned.patch) });
    notifications.show({ message: 'Oda ölçüleri kaydedildi', color: 'green', autoClose: 1500 });
    onDone();
  };
  return (
    <Card radius="md" p="md" className="record-form-section">
      <form onSubmit={(e) => { e.preventDefault(); save(); }} noValidate data-testid="room-dims-form">
        <Stack gap="xs">
          <SectionHeading title="Oda ölçüleri" level={3} />
          <DraftConflict fields={conflicts} label={(k) => DIM_LABELS[k as DimKey]} onResolve={resolve}
            mine={(k) => ({ value: dimText(k as DimKey, dims) })} theirs={(k) => ({ value: dimText(k as DimKey, latest) })} />
          <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="xs">
            <NumberInput ref={first} label={DIM_LABELS.en_cm} min={0} max={9999} inputMode="numeric" hideControls value={dims.en_cm ?? ''} onChange={(v) => set('en_cm', numOrNull(v))} />
            <NumberInput label={DIM_LABELS.boy_cm} min={0} max={9999} inputMode="numeric" hideControls value={dims.boy_cm ?? ''} onChange={(v) => set('boy_cm', numOrNull(v))} />
            <NumberInput label={DIM_LABELS.yuk_cm} min={0} max={9999} inputMode="numeric" hideControls value={dims.yuk_cm ?? ''} onChange={(v) => set('yuk_cm', numOrNull(v))} />
            <EnumSelect label={DIM_LABELS.kopek_erisim} field="kopek_erisim" options={KOPEK_ERISIM} value={dims.kopek_erisim} onChange={(v) => set('kopek_erisim', v as KopekErisim | undefined)} />
          </SimpleGrid>
          <Text size="sm" c="dimmed">{WALL_HINT}</Text>
          <Group gap="xs" grow>
            <Button variant="subtle" onClick={onDone}>Vazgeç</Button>
            <Button type="submit" variant="default" leftSection={<FloppyDiskIcon size={18} aria-hidden />}>Ölçüleri kaydet</Button>
          </Group>
        </Stack>
      </form>
    </Card>
  );
}

/** Önce özet (her değer metin), aynı yerde "Ölçüleri düzenle" ile form. Kaynak okunmadan düzenleme kapalıdır; ölçüsü olmayan odada form açık başlar. */
function RoomDimsSection({ oda, setting }: { oda: Oda; setting?: Setting }) {
  const ready = useAppStore(selectReady);
  const dims = parseRoomSetting(setting?.deger);
  const empty = Object.keys(dims).length === 0;
  const [mode, setMode] = useState<'auto' | 'open' | 'closed'>('auto');
  const byUser = useRef(false);
  const edit = useRef<HTMLButtonElement>(null);
  const headingId = useId();
  // Boş odada form kendiliğinden açılır ve açık kalır: arka planda ayar gelse de taslak kaybolmaz.
  useEffect(() => { if (mode === 'auto' && ready && empty) setMode('open'); }, [mode, ready, empty]);
  useEffect(() => { if (mode === 'closed' && byUser.current) edit.current?.focus(); }, [mode]);
  if (mode === 'open') {
    return <RoomDimsForm oda={oda} setting={setting} initial={dims} focusFirst={byUser.current} onDone={() => { byUser.current = true; setMode('closed'); }} />;
  }
  return (
    <section className={`record-surface ${classes.dimsSummary}`} aria-labelledby={headingId} data-testid="room-dims-summary">
      <div className={classes.dimsHead}>
        <h3 id={headingId}>Oda ölçüleri</h3>
        <Button ref={edit} variant="default" disabled={!ready} leftSection={<PencilSimpleIcon size={18} aria-hidden />} onClick={() => { byUser.current = true; setMode('open'); }}>
          Ölçüleri düzenle
        </Button>
      </div>
      {ready ? (
        <div className={classes.dimsFacts}>
          <FactList label={`${label('oda', oda)} ölçüleri`} items={[
            { label: 'En', value: cm(dims.en_cm) },
            { label: 'Boy', value: cm(dims.boy_cm) },
            { label: 'Yükseklik', value: cm(dims.yuk_cm) },
            { label: 'Köpek erişimi', value: dims.kopek_erisim ? label('kopek_erisim', dims.kopek_erisim) : undefined },
          ]} />
        </div>
      ) : <Text role="status">Ölçüler okunuyor…</Text>}
      <Text size="sm" c="dimmed">{WALL_HINT}</Text>
    </section>
  );
}

/** Kayıt dili: ad kimliktir; tek renkli etiket "elimizde" durumudur; ölçü olgudur; priz, kanal ve ışık notu düz metindir. */
function LayoutItemCard({ oda, item }: { oda: Oda; item: Item }) {
  const dims = formatDims(item);
  const isik = (item.isik_ihtiyaci ?? '').trim();
  const meta = [item.priz_ihtiyaci ? `${item.priz_ihtiyaci} priz` : '', item.kanal_m ? `${fmtM(item.kanal_m)} m kanal` : '', isik].filter(Boolean);
  return (
    <Card component={Link} href={`~/yerlesim/${oda}/${item.id}`} radius="md" p="md" className={classes.card} data-testid="layout-item-card"
      // WebKit does not focus a clicked link; the card must be the opener the item window returns focus to.
      onClick={(e: MouseEvent<HTMLAnchorElement>) => e.currentTarget.focus({ preventScroll: true })}>
      <div className="record-card">
        <h4 className="record-title">{item.ad}</h4>
        {item.mevcut && <div><WarnBadge tone="ok" leftSection={<HouseIcon size={10} aria-hidden />}>elimizde</WarnBadge></div>}
        <p className={`${classes.fact} tabular`}>{dims || 'Ölçü girilmedi'}</p>
        {meta.length > 0 && <p className="record-meta">{meta.map((m) => <span key={m} className="record-scope">{m}</span>)}</p>}
      </div>
    </Card>
  );
}

function WallGroup({ oda, wall, dims, items }: { oda: Oda; wall: WallKey; dims: RoomDims; items: Item[] }) {
  const len = wallLength(dims, wall);
  const rem = remaining(dims, wall, items);
  const list = wallItems(items, wall);
  const headingId = useId();
  const facts = wall === 'orta'
    ? [`${list.length} kalem`]
    : rem === undefined ? ['ölçü yok'] : rem < 0 ? [`${len} cm`] : [`${len} cm`, `kalan ${rem} cm`];
  return (
    <section className={classes.wall} aria-labelledby={headingId} data-testid={`wall-${wall}`}>
      <div className={`record-group-heading ${classes.wallHeading}`}>
        <h3 id={headingId}>{wall === 'orta' ? 'Orta' : `${wallLabel(wall)} duvarı`}</h3>
        <p className="record-meta tabular">{facts.map((f) => <span key={f} className="record-scope">{f}</span>)}</p>
      </div>
      {rem !== undefined && rem < 0 && (
        <ul className={`record-attention ${classes.attention}`}>
          <li data-tone="danger"><WarningIcon size={18} aria-hidden /><span>{-rem} cm taşıyor</span></li>
        </ul>
      )}
      <Stack gap={4}>
        {list.length ? list.map((i) => <LayoutItemCard key={i.id} oda={oda} item={i} />) : <Text size="sm" c="dimmed">Kalem yok</Text>}
      </Stack>
    </section>
  );
}

function NeedsCard({ map, onSuggest }: { map: NeedsMap; onSuggest: () => void }) {
  const total = needsTotal(map);
  const noteId = useId();
  const rows = WALL_KEYS.filter((w) => map[w].priz > 0 || map[w].kanal_m > 0 || map[w].isik.length > 0);
  const empty = rows.length === 0;
  return (
    <Card radius="md" p="md" className="record-support" data-testid="needs-map">
      <Stack gap="xs">
        <Group gap={6} wrap="nowrap">
          <PlugIcon size={18} aria-hidden />
          <Text component="h3" fw={700}>İhtiyaç haritası</Text>
        </Group>
        {empty ? (
          <Text size="sm" c="dimmed">Kalemlerde priz, ışık ya da kanal ihtiyacı girilmemiş.</Text>
        ) : (
          <Table fz="sm" verticalSpacing={4} horizontalSpacing={6} className="tabular">
            <Table.Thead>
              <Table.Tr><Table.Th>Duvar</Table.Th><Table.Th ta="right">Priz</Table.Th><Table.Th ta="right">Kanal (m)</Table.Th></Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((w) => (
                <Table.Tr key={w}>
                  <Table.Td>{wallLabel(w)}</Table.Td>
                  <Table.Td ta="right">{map[w].priz}</Table.Td>
                  <Table.Td ta="right">{fmtM(map[w].kanal_m)}</Table.Td>
                </Table.Tr>
              ))}
              <Table.Tr fw={700}>
                <Table.Td>Toplam</Table.Td>
                <Table.Td ta="right" data-testid="needs-total-priz">{total.priz}</Table.Td>
                <Table.Td ta="right" data-testid="needs-total-kanal">{fmtM(total.kanal_m)}</Table.Td>
              </Table.Tr>
            </Table.Tbody>
          </Table>
        )}
        {total.isik.length > 0 && (
          <Stack gap={2}>
            <Group gap={6} wrap="nowrap"><LightbulbIcon size={14} aria-hidden /><Text size="sm" fw={600}>Işık notları</Text></Group>
            {WALL_KEYS.flatMap((w) => map[w].isik.map((s, i) => (
              <Text key={`${w}-${i}`} size="sm" ><Text component="span" c="dimmed">{wallLabel(w)}: </Text>{s}</Text>
            )))}
          </Stack>
        )}
        {/* Eylemin sonucu düğmeden önce okunur. */}
        <Text size="sm" c="dimmed" id={noteId}>Toplam priz için 1 "Panjurlu priz" ve toplam kanal metresi için 1 "Kablo kanalı" satırı; var olan satır güncellenir.</Text>
        <Button variant="default" fullWidth leftSection={<ShoppingCartIcon size={18} aria-hidden />} onClick={onSuggest} aria-describedby={noteId} data-testid="suggest-button">
          Satınalma satırı öner
        </Button>
      </Stack>
    </Card>
  );
}

export function RoomPage({ oda }: { oda: string }) {
  const [, navigate] = useLocation();
  const { items, settings } = useAppStore(selectState);
  const valid = (ROOMS as readonly string[]).includes(oda);
  const setting = useMemo(() => roomSetting(settings, oda), [settings, oda]);
  const dims = useMemo(() => parseRoomSetting(setting?.deger), [setting]);
  const list = useMemo(() => roomItems(items, oda), [items, oda]);
  const purchases = useMemo(() => items.filter((i) => !i.deleted_at && i.tip === 'satinalma'), [items]);
  const map = useMemo(() => needsMap(list), [list]);

  if (!valid) {
    return (
      <Stack p="sm" gap="sm">
        <Alert color="yellow" title="Oda bulunamadı">Bu oda kodu tanımlı değil.</Alert>
        <Button component={Link} href="~/yerlesim" variant="default" leftSection={<ArrowLeftIcon size={18} aria-hidden />}>Odalara dön</Button>
      </Stack>
    );
  }
  const room = oda as Oda;

  const suggest = () => {
    const total = needsTotal(map);
    if (total.priz === 0 && total.kanal_m === 0) {
      notifications.show({ message: 'Priz ya da kanal ihtiyacı girilmemiş; öneri yok', color: 'gray', autoClose: 2500 });
      return;
    }
    const patches = suggestionPatches(room, items, purchases);
    if (!patches.length) {
      notifications.show({ message: 'Satınalma satırları zaten güncel', color: 'gray', autoClose: 2000 });
      return;
    }
    for (const p of patches) upsert('kalemler', p.id, p.patch);
    notifications.show({ message: `${patches.length} satınalma satırı yazıldı`, color: 'green', autoClose: 2000 });
  };

  return (
    <Box className={classes.page}>
      <Paper className={classes.bar} px="sm" py={4} radius={0}>
        <Group wrap="nowrap" gap="xs">
          <ActionIcon component={Link} href="~/yerlesim" aria-label="Odalara dön" color="gray">
            <ArrowLeftIcon size={22} aria-hidden />
          </ActionIcon>
          <Title order={2} size="h4" style={{ flex: 1, minWidth: 0 }}>{label('oda', room)}</Title>
          <Text c="dimmed" className="tabular">{list.length} kalem</Text>
        </Group>
      </Paper>
      <Box p="sm" className={classes.roomGrid}>
        <div className={classes.dims}><RoomDimsSection oda={room} setting={setting} /></div>
        <div className={classes.walls}>
          {WALL_KEYS.map((wall) => <WallGroup key={wall} oda={room} wall={wall} dims={dims} items={list} />)}
        </div>
        <div className={classes.needs}><NeedsCard map={map} onSuggest={suggest} /></div>
      </Box>
      <Fab onClick={() => navigate(`~/yerlesim/${room}/yeni`)} label="Kalem ekle" />
      <Route path="/:id">{(params) => <ItemForm key={params.id} oda={room} id={params.id} />}</Route>
    </Box>
  );
}
