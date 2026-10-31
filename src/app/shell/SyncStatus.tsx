import { useEffect, useRef } from 'react';
import { ActionIcon, Badge, Button, Drawer, Group, Indicator, Stack, Text, VisuallyHidden } from '@mantine/core';
import { modals } from '@mantine/modals';
import { CloudCheckIcon } from '@phosphor-icons/react/dist/csr/CloudCheck';
import { CloudArrowUpIcon } from '@phosphor-icons/react/dist/csr/CloudArrowUp';
import { CloudSlashIcon } from '@phosphor-icons/react/dist/csr/CloudSlash';
import { WarningCircleIcon } from '@phosphor-icons/react/dist/csr/WarningCircle';
import { PlugsIcon } from '@phosphor-icons/react/dist/csr/Plugs';
import { ArrowsClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowsClockwise';
import { useDisclosure } from '@mantine/hooks';
import { Link } from 'wouter';
import type { Op, Table } from '@shared/api';
import { CASH_COLUMNS, ITEM_COLUMNS, SETTING_COLUMNS, columnByKey, label } from '@shared/schema';
import { dismissConflict, recordLabel, useAppStore, type AppState, type PendingConflict } from '@/sync/store';
import { OUTBOX_WARN, type QueuedOp } from '@/sync/queue';
import { discardRejected, refresh, retryRejected, upsert } from '@/sync/controller';
import { formatTrDateTime } from '@/lib/dates';
import classes from './SyncStatus.module.css';

type ConflictRow = PendingConflict & { label: string };
const NO_CONFLICTS: ConflictRow[] = [];
// Seçici sığ eşitlikle önbelleklenir; çakışma yokken sabit dizi döner ki her store değişimi düğmeyi yeniden çizmesin.
const selectSync = (s: AppState) => ({
  status: s.status, pending: s.outbox.length, lastSync: s.lastSync, lastError: s.lastError,
  rejected: s.rejected, conflicts: s.conflicts.length ? s.conflicts.map((c): ConflictRow => ({ ...c, label: recordLabel(s, c.table, c.id) })) : NO_CONFLICTS,
});

const STATUS_TEXT: Record<string, string> = {
  idle: 'Hazır', loading: 'Yükleniyor', syncing: 'Eşitleniyor', synced: 'Eşitlendi', offline: 'Çevrimdışı',
  error: 'Hata', unconfigured: 'Sheets bağlantısı ayarlanmadı',
};
const COLUMNS: Record<Table, ReturnType<typeof columnByKey>> = { kalemler: columnByKey(ITEM_COLUMNS), ayarlar: columnByKey(SETTING_COLUMNS), nakit: columnByKey(CASH_COLUMNS) };
const fieldLabel = (table: Table, key: string) => COLUMNS[table].get(key)?.label ?? key;
const isEmpty = (v: unknown) => v == null || v === '' || (Array.isArray(v) && v.length === 0);
const fmt = (field: string, v: unknown) => (isEmpty(v) ? '—' : Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? (v ? 'evet' : 'hayır') : typeof v === 'string' ? label(field, v) || v : String(v));
const isNewRecord = (op: Op) => op.op === 'upsert' && op.baseVersion === undefined;
const opKind = (op: Op) => (op.op === 'upsert' ? (isNewRecord(op) ? 'Yeni kayıt' : 'Düzenleme') : op.op === 'delete' ? 'Silme' : 'Geri alma');
/** Kullanıcının değerleri (etiket, değer): yeni kayıtta boş alanlar anlamsızdır ve atlanır; düzenlemede boş değer bilinçli silmedir ve "—" olarak kalır. */
const patchEntries = (op: Op): Array<[string, string]> => (op.op === 'upsert'
  ? Object.entries(op.patch).filter(([, v]) => !(isNewRecord(op) && isEmpty(v))).map(([k, v]) => [fieldLabel(op.table, k), fmt(k, v)])
  : []);
const describePatch = (op: Op) => patchEntries(op).map(([k, v]) => `${k}: ${v}`).join(' · ');
const rejectedText = (n: number) => `${n} değişiklik gönderilemedi`;
const conflictText = (n: number) => `${n} kayıtta çakışma`;

/**
 * Onay modalı kapanınca Mantine odağı açan "Vazgeç" düğmesine döndürmeye çalışır; onaylanan silmede o satır DOM'dan
 * kalktığı için odak gövdeye düşer. Kapanış geçişi bittiğinde (`onExitTransitionEnd`, modal hâlâ DOM'da) odak çekmecede
 * değilse `restoreFocus` çekmecede kalan sabit öğeye taşır. "Geri dön"de düğme yerinde olduğundan Mantine dönüşü yeter.
 */
function confirmDiscard(entry: QueuedOp, restoreFocus: () => void) {
  const name = entry.rejection?.label ?? entry.op.id;
  const values = describePatch(entry.op);
  modals.openConfirmModal({
    title: 'Değişiklikten vazgeç?',
    children: <Text>"{name}" için yapılan bu değişiklik ({opKind(entry.op).toLocaleLowerCase('tr')}) Sheets'e yazılmayacak ve bu cihazdan silinecek.{values ? ` Silinecek değerler — ${values}.` : ''}</Text>,
    labels: { confirm: 'Değişikliği sil', cancel: 'Geri dön' },
    confirmProps: { color: 'red' },
    cancelProps: { variant: 'default' },
    onConfirm: () => { void discardRejected(entry.op.opId); },
    onExitTransitionEnd: restoreFocus,
  });
}

export function SyncStatus() {
  const st = useAppStore(selectSync);
  const [opened, { open, close }] = useDisclosure(false);
  const nRejected = st.rejected.length;
  const nConflicts = st.conflicts.length;
  const attention = nRejected > 0 || nConflicts > 0;
  const icon = st.status === 'unconfigured' ? <PlugsIcon size={22} aria-hidden />
    : st.status === 'offline' ? <CloudSlashIcon size={22} aria-hidden />
    : st.status === 'error' || nRejected > 0 ? <WarningCircleIcon size={22} aria-hidden />
    : st.status === 'syncing' || st.status === 'loading' || st.pending > 0 ? <CloudArrowUpIcon size={22} aria-hidden />
    : <CloudCheckIcon size={22} aria-hidden />;
  const color = st.status === 'error' || nRejected > 0 ? 'red' : st.status === 'offline' || st.status === 'unconfigured' ? 'yellow' : 'gray';
  // Taşıma durumu kullanıcının eylemini engelliyorsa (çevrimdışı/ayarsız/hata) red varken de söylenir; rutin eşitlendi/eşitleniyor yalnız redsizken başlık olur.
  const blocked = st.status === 'offline' || st.status === 'unconfigured' || st.status === 'error';
  // Başlık dürüsttür: reddedilen değişiklik varken kuyruk boş olsa da "Eşitlendi" tek başına yazılmaz.
  const headline = nRejected > 0 ? rejectedText(nRejected) : (STATUS_TEXT[st.status] ?? st.status);
  const tail = [nRejected > 0 && blocked ? STATUS_TEXT[st.status] : '', st.pending > 0 ? `${st.pending} bekleyen` : '', nConflicts > 0 ? conflictText(nConflicts) : ''].filter(Boolean);
  const ariaLabel = `Senkron: ${[headline, ...tail].join(' · ')}`;
  // Programatik durum (WCAG 4.1.3): yalnız kullanıcıyı ilgilendiren durumlar metin taşır. Rutin yükleniyor↔eşitlendi döngüsü ve
  // çevrimiçi kaydetmedeki anlık "1 bekleyen" boş kalır; bekleyen sayısı yalnız gönderim engelliyken duyurulur.
  const live = [
    blocked ? STATUS_TEXT[st.status] : '',
    blocked && st.pending > 0 ? `${st.pending} bekleyen` : '',
    nRejected > 0 ? rejectedText(nRejected) : '',
    nConflicts > 0 ? conflictText(nConflicts) : '',
  ].filter(Boolean).join(' · ');
  // Klavye eylemi (Yeniden dene / Vazgeç) odaklı satırı listeden kaldırır; odak çekmecede kalan sabit bir öğeye taşınır:
  // liste duruyorsa bölüm başlığı, liste boşaldıysa "Şimdi eşitle". Odak çekmecedeyse dokunulmaz.
  const refocus = useRef(false);
  const drawerBody = useRef<HTMLDivElement>(null);
  const rejectedHeading = useRef<HTMLHeadingElement>(null);
  const syncNow = useRef<HTMLButtonElement>(null);
  const focusSurvivor = () => {
    const active = document.activeElement;
    if (active && active !== document.body && drawerBody.current?.contains(active)) return;
    (rejectedHeading.current ?? syncNow.current)?.focus();
  };
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    focusSurvivor();
  }, [nRejected]);
  return (
    <>
      <Indicator disabled={st.pending === 0 && !attention} label={st.pending + nRejected + nConflicts} size={16} color={attention ? 'red' : 'ember'} offset={6}>
        <ActionIcon aria-label={ariaLabel} color={color} onClick={open} data-testid="sync-status">
          {icon}
        </ActionIcon>
      </Indicator>
      <VisuallyHidden role="status" aria-atomic="true" data-testid="sync-live">{live}</VisuallyHidden>
      <Drawer opened={opened} onClose={close} position="bottom" size="auto" title="Senkron durumu" padding="md" closeButtonProps={{ size: 'xl', 'aria-label': 'Kapat' }}>
        <Stack gap="lg" ref={drawerBody}>
          <div className={classes.section}>
            <Group justify="space-between" align="baseline">
              <Text fw={600} size="lg">{headline}{nRejected > 0 && blocked ? ` · ${STATUS_TEXT[st.status]}` : ''}</Text>
              <Badge variant="light" color={st.pending ? 'ember' : 'gray'}>{st.pending} bekleyen</Badge>
            </Group>
            <Text c="dimmed">Son eşitleme: {st.lastSync ? formatTrDateTime(st.lastSync) : 'henüz yok'}</Text>
            {st.pending > OUTBOX_WARN && <Text c="dimmed">Kuyruk olağandan uzun ({st.pending} bekleyen). Hiçbir değişiklik atılmaz; bağlantı gelince sırayla gönderilir.</Text>}
            {st.lastError && <Text><Text span fw={600}>Son hata:</Text> {st.lastError}</Text>}
          </div>

          {nRejected > 0 && (
            <section className={classes.section} aria-labelledby="sync-rejected-heading" data-testid="sync-rejected">
              <h3 id="sync-rejected-heading" ref={rejectedHeading} tabIndex={-1}>Gönderilemeyen değişiklikler</h3>
              <Text c="dimmed">Sheets kabul etmedi; yalnız bu cihazda duruyor, listede görünmüyor.</Text>
              <ul className={classes.list}>
                {/* Okuma sırası: kayıt → neden → eylem; kaydedilen değerler her zaman açık etiket/değer listesi olarak sonra gelir. */}
                {st.rejected.map((entry) => (
                  <li key={entry.op.opId} className={classes.item} data-testid="sync-rejected-item">
                    <Text fw={600}>{entry.rejection?.label ?? entry.op.id} <Text span c="dimmed" fw={400}>· {opKind(entry.op)}</Text></Text>
                    <Text><Text span fw={600}>Neden:</Text> {entry.rejection?.message}</Text>
                    {entry.rejection?.code === 'not_found' && <Text c="dimmed">Satır Sheets'te yoksa yeniden deneme başarmaz; satır geri gelince deneyin ya da vazgeçin.</Text>}
                    <div className={classes.actions}>
                      <Button variant="light" leftSection={<ArrowsClockwiseIcon size={18} aria-hidden />} onClick={() => { refocus.current = true; void retryRejected(entry.op.opId); }}>Yeniden dene</Button>
                      <Button variant="default" onClick={() => confirmDiscard(entry, focusSurvivor)}>Vazgeç</Button>
                    </div>
                    {patchEntries(entry.op).length > 0 && (
                      <div role="group" aria-label="Kaydedilen değerler">
                        <dl className={classes.details}>
                          {patchEntries(entry.op).map(([k, v]) => (<div key={k} className={classes.detail}><dt>{k}</dt><dd>{v}</dd></div>))}
                        </dl>
                      </div>
                    )}
                    <Text c="dimmed">{entry.rejection ? formatTrDateTime(entry.rejection.at) : ''} · yalnız bu cihazda</Text>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {nConflicts > 0 && (
            <section className={classes.section} aria-labelledby="sync-conflict-heading" data-testid="sync-conflicts">
              <h3 id="sync-conflict-heading">Çakışan değişiklikler</h3>
              <Text c="dimmed">Bu kayıtlar siz düzenlerken başka yerde de değişti; Sheets'teki değer uygulandı. Hangi değerin kalacağını seçin.</Text>
              <ul className={classes.list}>
                {st.conflicts.map((c) => (
                  <li key={c.id} className={classes.item} data-testid="sync-conflict-item">
                    <Text fw={600}>{c.label}</Text>
                    <Text>{c.updatedBy ? `${c.updatedBy} değiştirdi.` : "Sheets'te değişti."}{c.updatedAt ? ` ${formatTrDateTime(c.updatedAt)}.` : ''}</Text>
                    {c.keys.map((k) => (
                      <Text key={k}>{fieldLabel(c.table, k)}: benimki <Text span fw={600}>{fmt(k, c.myValues[k])}</Text> · Sheets'teki <Text span fw={600}>{fmt(k, c.serverValues[k])}</Text></Text>
                    ))}
                    <div className={classes.actions}>
                      <Button variant="light" onClick={() => { upsert(c.table, c.id, c.myValues); dismissConflict(c.id); }}>Benimki kalsın</Button>
                      <Button variant="default" onClick={() => dismissConflict(c.id)}>Sheets'teki kalsın</Button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <Group grow>
            <Button ref={syncNow} variant="light" leftSection={<ArrowsClockwiseIcon size={18} aria-hidden />} onClick={() => { void refresh(); }}>Şimdi eşitle</Button>
            <Button component={Link} href="/ayarlar" variant="default" onClick={close}>Ayarlar</Button>
          </Group>
        </Stack>
      </Drawer>
    </>
  );
}
