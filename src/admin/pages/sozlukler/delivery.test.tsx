import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReactNode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { wideManifest } from '../../adaptive';
import { importsOf, wideRuleViolations } from '../../adaptive/sourceRules';
import { FixtureGenerationSource, GenerationProvider } from '../../data';
import { DeviceContext } from '../../device';
import type { Device } from '../../shell/contracts';
import { SozluklerPage } from '../SozluklerPage';

// Uyarlamalı teslim (W0): telefon profili sayfanın geniş-özel kodunu (ağaç tablosu, *.wide.tsx) hiç istemez; geniş
// profilde aynı anahtar lazyWide ile yüklenir. Kayıt defteri modül düzeyinde olduğundan bu dosya ayrı tutulur
// (vitest dosya başına yalıtır): telefon ölçümü masaüstü testinin yüklediği modülle kirlenmez.

const here = dirname(fileURLToPath(import.meta.url));
const PAGES = join(here, '..');
const FIXTURE_ROOT = join(here, '../../../../fixtures/generation-synthetic');
const GENERATION_ID = readdirSync(FIXTURE_ROOT).find((name) => statSync(join(FIXTURE_ROOT, name)).isDirectory())!;
const GENERATION_DIR = join(FIXTURE_ROOT, GENERATION_ID);
const WIDE_KEY = 'sozlukler-terim-tablosu';

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const FILES: Record<string, string> = Object.fromEntries(
  walk(GENERATION_DIR)
    .filter((full) => full.endsWith('.json'))
    .map((full) => relative(GENERATION_DIR, full))
    .filter((rel) => rel === 'manifest.json' || rel.startsWith('data/'))
    .map((rel) => [rel, readFileSync(join(GENERATION_DIR, rel), 'utf8')]),
);

function renderOn(device: Device) {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <DeviceContext.Provider value={device}>
        <GenerationProvider source={new FixtureGenerationSource(FILES, 'sentetik')} cache={null} changeSet={null}>
          {children}
        </GenerationProvider>
      </DeviceContext.Provider>
    );
  }
  return render(<SozluklerPage location="/sozlukler" />, { wrapper: Wrapper });
}

const statusOf = () => wideManifest().find((entry) => entry.key === WIDE_KEY)?.status;

describe('Sözlükler › geniş-özel kod teslimi', () => {
  it('telefonda ağaç tablosu modülü kayıtlıdır ama hiç indirilmez; geniş profilde yüklenir', async () => {
    const phone = renderOn('phone');
    const bolge = await screen.findByRole('region', { name: 'Kategoriler' });
    expect(within(bolge).getAllByRole('button', { name: /kayıt|Kullan/ }).length).toBeGreaterThan(0);
    expect(statusOf()).toBe('idle');
    phone.unmount();

    renderOn('desktop');
    await waitFor(() => expect(statusOf()).toBe('ready'));
    expect(await within(await screen.findByRole('region', { name: 'Kategoriler' })).findByRole('table', { name: 'Kategoriler' })).toBeInTheDocument();
    // İlk dinamik import (geniş modül + ui/Table dönüşümü) bu testin içindedir; süre bütçesi bunun için geniş.
  }, 15_000);

  it('sayfa kaynakları *.wide kuralına uyar: geniş modül statik alınmaz, default export verir', () => {
    const files = walk(PAGES).filter((full) => /^(SozluklerPage(\.wide)?\.tsx|sozlukler[\\/].*\.tsx?)$/.test(relative(PAGES, full)) && !/\.test\.tsx?$/.test(full));
    expect(files.some((full) => /\.wide\.tsx$/.test(full))).toBe(true);
    for (const full of files) {
      const rel = relative(PAGES, full);
      expect(wideRuleViolations(rel, readFileSync(full, 'utf8')), rel).toEqual([]);
    }
    // Telefon yolu (geniş olmayan dosyalar) antd/echarts'a doğrudan bağlanmaz.
    for (const full of files.filter((f) => !/\.wide\.tsx?$/.test(f))) {
      const raw = importsOf(readFileSync(full, 'utf8')).filter((ref) => !ref.typeOnly && /^(antd|@ant-design|echarts|zrender)(\/|$)|(^|\/)ui\/antd$/.test(ref.specifier));
      expect(raw, relative(PAGES, full)).toEqual([]);
    }
  });
});
