import { useRef, useState } from 'react';
import { Alert, Button, Code, Group, Stack, Text, TextInput, Title, Anchor } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { PlugsConnectedIcon } from '@phosphor-icons/react/dist/csr/PlugsConnected';
import { TrashIcon } from '@phosphor-icons/react/dist/csr/Trash';
import { callApi } from '@/sync/api';
import { getActor, getApiUrl, getAppKey, isApiConfigured, setActor, setApiUrl, setAppKey } from '@/sync/config';
import { refresh } from '@/sync/controller';
import { clearCache } from '@/sync/cache';
import { getState, setState, useAppStore, type AppState } from '@/sync/store';
import type { HealthResponse } from '@shared/api';

const selectCacheMeta = (s: AppState) => ({ pending: s.outbox.length, status: s.status, hasFreshCopy: Boolean(s.fingerprint) });

/** `reloaded`: tam okuma gerçekten geldi (parmak izi yeniden kuruldu); `status` ardından gelen gönderimin sonucunu da taşıyabilir. */
interface ClearResult { reloaded: boolean; status: AppState['status']; pending: number; lastError?: string }

const pendingText = (n: number) => `${n} bekleyen değişiklik`;

function clearResultText(r: ClearResult): string {
  const kept = r.pending > 0 ? `${pendingText(r.pending)} korundu.` : 'Bekleyen değişiklik yok.';
  if (r.reloaded) return `Yeniden yüklendi. ${kept}`;
  switch (r.status) {
    case 'offline': return `Kopya silindi; çevrimdışı olduğundan yeniden yüklenemedi, bağlantı gelince otomatik denenir. ${kept}`;
    case 'unconfigured': return `Kopya silindi; Sheets bağlantısı ayarlanmadığından yeniden yüklenemedi. ${kept}`;
    default: return `Kopya silindi; yeniden yüklenemedi${r.lastError ? ` (${r.lastError})` : ''}. ${kept}`;
  }
}

export function SettingsPage() {
  const [url, setUrl] = useState(getApiUrl());
  const [actor, setActorState] = useState(getActor());
  const [key, setKey] = useState(getAppKey() ?? '');
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [testing, setTesting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [clearResult, setClearResult] = useState<ClearResult | null>(null);
  const clearingRef = useRef(false);
  const { pending, status, hasFreshCopy } = useAppStore(selectCacheMeta);
  // Başarısız temizlemeden sonra bağlantı dönüp tam okuma gelirse eski "yüklenemedi" satırı bayat kalmasın.
  const shownResult = clearResult && !clearResult.reloaded && hasFreshCopy ? { ...clearResult, reloaded: true, pending } : clearResult;

  const save = () => {
    setApiUrl(url); setActor(actor); setAppKey(key);
    const ok = isApiConfigured();
    setState({ status: ok ? 'idle' : 'unconfigured' });
    notifications.show({ message: 'Ayarlar kaydedildi', color: 'green', autoClose: 1500 });
    if (ok) void refresh();
  };
  const test = async () => {
    setTesting(true); setErr(null); setHealth(null);
    try {
      const h = await callApi<HealthResponse>(url.trim(), { action: 'health' });
      setHealth(h);
    } catch (e) { setErr((e as Error).message); }
    finally { setTesting(false); }
  };
  /**
   * Bu cihazdaki kopyayı siler ve tam okuma zorlar. Store sıfırlanmaz: bekleyen kuyruk (silme beklerken girenler dahil),
   * çakışmalar ve bu sayfadaki girdiler kalır; `applyRead` bekleyen patch'leri yeni sunucu verisinin üstüne yeniden uygular.
   */
  const clear = async () => {
    if (clearingRef.current) return;
    clearingRef.current = true;
    setClearing(true); setClearResult(null);
    try {
      await clearCache();
      setState({ fingerprint: undefined });
      await refresh();
      // Uçuştaki eski parmak izli okuma `notModified` dönmüşse kopya yeniden yazılmamıştır; bir kez daha tam okuma iste.
      if (getState().status === 'synced' && !getState().fingerprint) await refresh();
    } finally {
      const s = getState();
      setClearResult({ reloaded: Boolean(s.fingerprint), status: s.status, pending: s.outbox.length, lastError: s.lastError });
      setClearing(false);
      clearingRef.current = false;
    }
  };

  return (
    <Stack p="sm" gap="md" pb={96}>
      <div>
        <Title order={2} size="h4">Kayıt bağlantısı</Title>
        <Text size="sm" c="dimmed">Apps Script web uygulamasının <Code>/exec</Code> adresi. Kurulum: <Anchor href="https://github.com/karacaismail/aile/blob/main/apps-script/README.md" target="_blank" rel="noreferrer" data-inline-link>apps-script/README</Anchor>.</Text>
      </div>
      <TextInput label="API adresi" placeholder="https://script.google.com/macros/s/…/exec" value={url} onChange={(e) => setUrl(e.currentTarget.value)} inputMode="url" autoCapitalize="none" autoCorrect="off" />
      <TextInput label="Anahtar (opsiyonel, APP_KEY)" value={key} onChange={(e) => setKey(e.currentTarget.value)} autoCapitalize="none" autoCorrect="off" />
      <TextInput label="Cihaz adı (kim değiştirdi)" value={actor} onChange={(e) => setActorState(e.currentTarget.value)} maxLength={60} />
      <Group grow>
        <Button variant="default" loading={testing} leftSection={<PlugsConnectedIcon size={18} aria-hidden />} onClick={() => { void test(); }}>Bağlantıyı test et</Button>
        <Button onClick={save}>Kaydet</Button>
      </Group>
      {health && (
        <Alert color={health.warnings?.length ? 'yellow' : 'green'} title={`Bağlantı tamam · şema v${health.schemaVersion}`}>
          {health.warnings?.length ? health.warnings.map((w) => <Text size="sm" key={w}>{w}</Text>) : <Text size="sm">Uyarı yok.</Text>}
        </Alert>
      )}
      {err && <Alert color="red" title="Bağlantı hatası"><Text size="sm">{err}</Text></Alert>}
      <div>
        <Title order={2} size="h4">Önbellek</Title>
        <Text size="sm" c="dimmed">Veri Sheets'te durur; bu cihazdaki kopya silinip yeniden çekilir. Bağlantı ayarları ve bu sayfadaki girdiler korunur.</Text>
        {pending > 0 && <Text size="sm" c="dimmed">{pendingText(pending)} gönderilmeyi bekliyor; temizleme bunları silmez, bağlantı gelince gönderilir.</Text>}
        {status === 'offline' && <Text size="sm" c="dimmed">Şu an çevrimdışı: kopya, bağlantı gelene kadar yeniden yüklenemez.</Text>}
        {/* Mantine `loading` gerçek `disabled` basıp odağı düşürür; sürerken yalnız görünüm ve ARIA devre dışı, odak düğmede kalır. */}
        <Button mt="xs" variant="subtle" color="red" leftSection={<TrashIcon size={18} aria-hidden />} data-disabled={clearing || undefined} aria-disabled={clearing || undefined}
          onClick={(e) => { if (clearing) { e.preventDefault(); return; } void clear(); }}>
          Önbelleği temizle
        </Button>
        {/* Durum bölgesi mesajdan önce DOM'da durur (ARIA22); odak almaz, kaybolmaz; ilerleme ve sonuç burada. */}
        <Text size="sm" mt="xs" role="status" aria-atomic="true" aria-label="Önbellek sonucu" data-testid="cache-result">
          {clearing ? 'Temizleniyor…' : shownResult ? clearResultText(shownResult) : ''}
        </Text>
      </div>
    </Stack>
  );
}
