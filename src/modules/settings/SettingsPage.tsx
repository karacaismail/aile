import { useState } from 'react';
import { Alert, Button, Code, Group, SegmentedControl, Stack, Text, TextInput, Title, useMantineColorScheme, Anchor } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { PlugsConnectedIcon, TrashIcon } from '@phosphor-icons/react';
import { callApi } from '@/sync/api';
import { getActor, getApiUrl, getAppKey, isApiConfigured, setActor, setApiUrl, setAppKey } from '@/sync/config';
import { refresh } from '@/sync/controller';
import { clearCache } from '@/sync/cache';
import { resetStore, setState } from '@/sync/store';
import type { HealthResponse } from '@shared/api';

export function SettingsPage() {
  const [url, setUrl] = useState(getApiUrl());
  const [actor, setActorState] = useState(getActor());
  const [key, setKey] = useState(getAppKey() ?? '');
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [testing, setTesting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { colorScheme, setColorScheme } = useMantineColorScheme();

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
  const clear = async () => { await clearCache(); resetStore(); notifications.show({ message: 'Önbellek temizlendi; yeniden yükleniyor', color: 'gray' }); void refresh(); };

  return (
    <Stack p="sm" gap="md" pb={96}>
      <div>
        <Title order={2} size="h4">Google Sheets bağlantısı</Title>
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
        <Title order={2} size="h4">Görünüm</Title>
        <SegmentedControl mt="xs" fullWidth value={colorScheme} onChange={(v) => setColorScheme(v as 'auto' | 'light' | 'dark')}
          data={[{ value: 'auto', label: 'Sistem' }, { value: 'light', label: 'Açık' }, { value: 'dark', label: 'Koyu' }]} />
      </div>
      <div>
        <Title order={2} size="h4">Önbellek</Title>
        <Text size="sm" c="dimmed">Veri Sheets'te durur; bu cihazdaki kopya silinip yeniden çekilir.</Text>
        <Button mt="xs" variant="subtle" color="red" leftSection={<TrashIcon size={18} aria-hidden />} onClick={() => { void clear(); }}>Önbelleği temizle</Button>
      </div>
    </Stack>
  );
}
