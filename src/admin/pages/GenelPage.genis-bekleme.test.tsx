import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, render, screen, waitFor } from '@testing-library/react';
import { wideManifest } from '../adaptive';
import { ChangeSet, FixtureGenerationSource, GenerationProvider, createMemoryStorage } from '../data';
import { DeviceContext } from '../device';
import type { Device } from '../shell/contracts';
import { GenelPage } from './GenelPage';

// Genel durum › geniş modül beklenirken hazır sinyali. Geniş profilde (tablet/masaüstü) veri hazır olduğunda geniş modül
// (GenelPage.wide, lazyWide 'genel-genis') henüz inmemişse telefon sunumu yedek olarak çizilir (Adaptive) ve modül inince
// yerini geniş sunum alır. Bu ara durumda sayfa kökü aria-busy="true" taşır: yardımcı teknoloji ve hazır sinyali
// (e2e openAdmin: [aria-busy="true"] yok) birazdan değişecek yedek sunumu bitmiş saymaz. Kanıt (RED): e2e/admin-min-text
// /genel testi chromium-desktop ve webkit-tablet'te yedek sunumdaki "Tümünü aç"a tıklarken geniş sunum geldi ve düğme
// kayboldu (gates/m5-round2). Geniş modül veriyle paralel istenir (veri okunurken indirme başlar); telefon hiç istemez.
// Modül kayıt defteri modül düzeyindedir (dosya başına yalıtılmış): telefon testi önce koşar.

const gate = vi.hoisted(() => {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
});
vi.mock('./GenelPage.wide', async () => {
  await gate.promise;
  return { default: () => <section data-testid="genel-genis-taklit" aria-label="Geniş sunum" /> };
});

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = join(here, '../../../fixtures/generation-synthetic');
const GENERATION_ID = readdirSync(FIXTURE_ROOT).find(name => statSync(join(FIXTURE_ROOT, name)).isDirectory())!;
const GENERATION_DIR = join(FIXTURE_ROOT, GENERATION_ID);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.json')) out.push(full);
  }
  return out;
}

const FILES: Record<string, string> = Object.fromEntries(
  walk(GENERATION_DIR)
    .map(full => relative(GENERATION_DIR, full))
    .filter(rel => rel === 'manifest.json' || rel.startsWith('data/'))
    .map(rel => [rel, readFileSync(join(GENERATION_DIR, rel), 'utf8')]),
);

const BUGUN = () => new Date(2026, 11, 5, 10, 0, 0);
const genelGenis = () => wideManifest().find(entry => entry.key === 'genel-genis')?.status ?? 'idle';
const mesgul = () => Array.from(document.querySelectorAll('[aria-busy="true"]'));

function renderPage(device: Device) {
  return render(
    <DeviceContext.Provider value={device}>
      <GenerationProvider source={new FixtureGenerationSource({ ...FILES }, 'sentetik')} cache={null} changeSet={() => ChangeSet.load({ storage: createMemoryStorage() })}>
        <GenelPage now={BUGUN} />
      </GenerationProvider>
    </DeviceContext.Provider>,
  );
}

describe('GenelPage › geniş modül beklenirken hazır sinyali', () => {
  it('telefon: geniş modül hiç istenmez; veri gelince sayfada meşgul öğe kalmaz', async () => {
    const view = renderPage('phone');
    await screen.findByTestId('genel-telefon', {}, { timeout: 5000 });
    await waitFor(() => expect(mesgul()).toEqual([]));
    expect(genelGenis()).toBe('idle');
    view.unmount();
  });

  it('masaüstü: modül veriyle paralel istenir; yedek telefon sunumu çizilirken kök meşgul, modül inince meşgul öğe yok', async () => {
    const view = renderPage('desktop');
    // Veri okunurken (iskelet) geniş modül indirmesi başlamış olmalı: veri bitince ayrıca beklenmez.
    expect(screen.getByText('Genel durum okunuyor')).toBeInTheDocument();
    await waitFor(() => expect(genelGenis()).toBe('loading'));
    expect(screen.queryByText('Genel durum okunuyor'), 'indirme iskelet sürerken başladı').toBeInTheDocument();

    // Veri hazır, modül kapıda: yedek telefon sunumu kullanılabilir ama sayfa kökü meşgul (birazdan değişecek).
    const yedek = await screen.findByTestId('genel-telefon', {}, { timeout: 5000 });
    expect(screen.queryByText('Genel durum okunuyor')).not.toBeInTheDocument();
    const kok = view.container.querySelector('.aile-genel');
    expect(kok).toHaveAttribute('aria-busy', 'true');
    expect(kok).toContainElement(yedek);

    await act(async () => { gate.release(); });
    expect(await screen.findByTestId('genel-genis-taklit')).toBeInTheDocument();
    expect(screen.queryByTestId('genel-telefon')).not.toBeInTheDocument();
    await waitFor(() => expect(mesgul()).toEqual([]));
    expect(kok).not.toHaveAttribute('aria-busy');
  });
});
