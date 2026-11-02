import { render, screen, waitFor } from '@testing-library/react';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { wideManifest } from '../adaptive';
import { importsOf } from '../adaptive/sourceRules';
import { DeviceContext } from '../device';
import type { RecordRow } from '../shell/contracts';
import { Kanban } from './Kanban';
import { PivotStack } from './PivotStack';

// Görünüm ailesi (a12: Kanban, Timeline, PivotStack, FilterArea) için telefon teslim kanıtı, kaynak düzeyinde.
// W0 sözleşmesi: telefon profili antd, @ant-design/*, echarts ve geniş-özel (*.wide) kodu istemez. Bu dosya her
// bileşenin STATİK import kapanışını (göreli importlar dosyaya çözülerek, tür-yalnız importlar hariç) yürür ve
// yasak yüzeyi zinciriyle raporlar. Geniş pano/tablo yalnız lazyWide ile, yalnız geniş profilde iner: telefonda
// wideManifest anahtarı 'idle' kalır. Build düzeyi kanıt scripts/check-delivery.mjs'tedir (entegrasyon).

const uiDir = __dirname;
const repo = resolve(uiDir, '../../..');
const EXTENSIONS = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];

/** Yasak yüzey: ham antd/pro/echarts paketleri, ui/antd sarmalayıcısı, antd teması ya da *.wide modülü. */
function forbidden(specifier: string, file: string | null): string | null {
  if (/^(antd|@ant-design|echarts|zrender)(\/|$)/.test(specifier)) return specifier;
  if (!file) return null;
  const rel = relative(repo, file).split('\\').join('/');
  if (rel === 'src/admin/ui/antd.ts' || rel === 'src/admin/theme/antdTheme.ts') return rel;
  if (/\.wide\.tsx?$/.test(rel) || /\/wide\//.test(rel)) return rel;
  return null;
}

function resolveRelative(from: string, specifier: string): string | null {
  if (!/^\.{1,2}\//.test(specifier)) return null;
  const base = resolve(dirname(from), specifier);
  for (const ext of EXTENSIONS) {
    const candidate = base + ext;
    if (/\.(tsx?)$/.test(candidate) && existsSync(candidate)) return candidate;
  }
  return null;
}

/** Statik kapanıştaki ihlaller: "giriş > ... > modül → yasak". */
function closureViolations(entry: string): string[] {
  const start = resolve(uiDir, entry);
  const seen = new Set<string>([start]);
  const queue: { file: string; chain: string[] }[] = [{ file: start, chain: [relative(repo, start)] }];
  const out: string[] = [];
  while (queue.length) {
    const { file, chain } = queue.shift()!;
    for (const ref of importsOf(readFileSync(file, 'utf8'))) {
      if (ref.kind !== 'static' || ref.typeOnly || /\.css$/.test(ref.specifier)) continue;
      const target = resolveRelative(file, ref.specifier);
      const bad = forbidden(ref.specifier, target);
      if (bad) {
        out.push(`${chain.join(' > ')} → ${bad}`);
        continue;
      }
      if (target && !seen.has(target)) {
        seen.add(target);
        queue.push({ file: target, chain: [...chain, relative(repo, target)] });
      }
    }
  }
  return out;
}

describe('a12 görünümleri › telefon statik kapanışı', () => {
  it.each(['Kanban.tsx', 'Timeline.tsx', 'PivotStack.tsx', 'FilterArea.tsx'])('%s antd/echarts/geniş modülü statik çekmez', entry => {
    expect(closureViolations(entry)).toEqual([]);
  });

  it('geniş modüllerin kendisi de antd/echarts istemez (yerel HTML yeter)', () => {
    for (const entry of ['wide/Kanban.wide.tsx', 'wide/Pivot.wide.tsx']) {
      const violations = closureViolations(entry).filter(v => !/→ src\/admin\/ui\/wide\//.test(v));
      expect(violations, entry).toEqual([]);
    }
  });
});

describe('a12 görünümleri › geniş modül yalnız geniş profilde iner', () => {
  const items: RecordRow[] = [
    { id: 'k1', code: 'K-1', label: 'Sentetik kayıt', status: { label: 'Sipariş verildi', tone: 'bilgi' }, planned: null, actual: null, kind: 'purchase_need' },
  ];
  const status = (key: string) => wideManifest().find(entry => entry.key === key)?.status;

  it('telefonda Kanban ve PivotStack geniş anahtarları boşta kalır (indirme başlamaz)', async () => {
    render(
      <DeviceContext.Provider value="phone">
        <Kanban items={items} />
        <PivotStack columns={['Önce']} rows={[['Salon', [[100, null]]]]} />
      </DeviceContext.Provider>,
    );
    expect(screen.getByRole('region', { name: 'Tedarik durumuna göre alımlar' })).toHaveAttribute('data-gorunum', 'liste');
    await new Promise(r => setTimeout(r, 30));
    expect(status('ui-kanban-pano')).toBe('idle');
    expect(status('ui-pivot-tablo')).toBe('idle');
  });

  it('masaüstünde aynı anahtarlar yüklenir; yedek listede odaktaki kart pano gelince aynı kayıtta kalır (odak kaybolmaz)', async () => {
    render(
      <DeviceContext.Provider value="desktop">
        <Kanban items={items} />
        <PivotStack columns={['Önce']} rows={[['Salon', [[100, null]]]]} />
      </DeviceContext.Provider>,
    );
    const region = screen.getByRole('region', { name: 'Tedarik durumuna göre alımlar' });
    expect(region.querySelector('[data-kanban-izgara]')).toBeNull();
    screen.getByRole('button', { name: /Sentetik kayıt/ }).focus();
    await waitFor(() => expect(region.querySelector('[data-kanban-izgara]')).not.toBeNull(), { timeout: 3000 });
    expect(screen.getByRole('button', { name: /Sentetik kayıt/ })).toHaveFocus();
    await waitFor(() => {
      expect(status('ui-kanban-pano')).toBe('ready');
      expect(status('ui-pivot-tablo')).toBe('ready');
    }, { timeout: 3000 });
    expect(await screen.findByRole('table')).toBeInTheDocument();
  });
});
