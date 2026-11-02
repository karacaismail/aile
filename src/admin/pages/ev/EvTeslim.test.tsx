// Uyarlamalı teslim: telefon profili Ev sayfasının geniş modülünü (lazyWide 'ev-iki-bolme') hiç istemez; profil
// genişleyince modül yüklenir ve seçili oda ile sekme korunur (sunum değişir, kullanıcı durumu kaybolmaz). Ayrı test
// dosyası: vitest her dosyayı ayrı modül kaydıyla koşar, geniş kayıt defteri burada temiz başlar.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useState, type ReactNode } from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { wideManifest } from '../../adaptive/loader';
import { GenerationProvider } from '../../data';
import { FixtureGenerationSource } from '../../data/sources';
import type { Room } from '../../data/types';
import { DeviceContext } from '../../device';
import type { Device } from '../../shell/contracts';
import { EvPage } from '../EvPage';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '../../../../fixtures/generation-synthetic');
const DIR = join(ROOT, readdirSync(ROOT).find((name) => statSync(join(ROOT, name)).isDirectory())!);
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.json')) out.push(full);
  }
  return out;
}
const FILES = Object.fromEntries(
  walk(DIR).map((full) => relative(DIR, full)).filter((rel) => rel === 'manifest.json' || rel.startsWith('data/'))
    .map((rel) => [rel, readFileSync(join(DIR, rel), 'utf8')]),
);
const ODA_3 = (JSON.parse(FILES['data/rooms/household/00000.json']!) as { records: Room[] }).records.find((room) => room.code === 'oda_3')!;

/** Geniş modülün ilk dinamik importu (vitest dönüşümü: tablo + antd tablo bağımlılıkları) yavaş makinede uzun sürer. */
const GENIS_ILK_YUKLEME_MS = 30_000;
const evGenis = () => wideManifest().find((entry) => entry.key === 'ev-iki-bolme');

let setProfil: (device: Device) => void = () => {};
function ProfilKaynagi({ children }: { children: ReactNode }) {
  const [profil, set] = useState<Device>('phone');
  setProfil = set;
  return <DeviceContext.Provider value={profil}>{children}</DeviceContext.Provider>;
}

describe('EvPage › uyarlamalı teslim', () => {
  it('telefonda geniş modül boşta kalır; masaüstüne geçince yüklenir ve seçili oda ile sekme korunur', async () => {
    const user = userEvent.setup();
    const source = new FixtureGenerationSource(FILES, 'sentetik');
    render(
      <ProfilKaynagi>
        <GenerationProvider source={source} cache={null} changeSet={null}>
          <EvPage />
        </GenerationProvider>
      </ProfilKaynagi>,
    );
    await screen.findByRole('region', { name: 'Odalar' });
    expect(evGenis()).toEqual({ key: 'ev-iki-bolme', status: 'idle' });

    await user.click(screen.getByRole('button', { name: 'Oda seç' }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Oda seç' })).getByRole('button', { name: ODA_3.label! }));
    const oda = await screen.findByRole('region', { name: ODA_3.label! });
    await user.click(within(oda).getByRole('tab', { name: 'İşler' }));
    expect(evGenis()?.status).toBe('idle');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    act(() => setProfil('desktop'));
    await waitFor(() => expect(evGenis()?.status).toBe('ready'), { timeout: 8000 });
    const panel = await screen.findByRole('region', { name: ODA_3.label! }, { timeout: 8000 });
    expect(within(panel).getByRole('tab', { name: 'İşler' })).toHaveAttribute('aria-selected', 'true');
    expect(within(panel).getByRole('button', { name: 'Ayrıntıyı kapat' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Odalar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Oda seç' })).not.toBeInTheDocument();
  }, GENIS_ILK_YUKLEME_MS);
});
