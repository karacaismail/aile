// Kaynak kapısı: vite.config.ts'in admin girişine ve PWA önbelleğine dair sözleşmesi.
// Yapılandırmayı çalıştırmadan metin olarak denetler (eklentiler ve rolldown seçenekleri yan etkisiz kalır).
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const source = readFileSync(resolve(__dirname, '../../vite.config.ts'), 'utf8');

function arrayLiteral(key: string): string[] {
  const match = source.match(new RegExp(`${key}\\s*[:=]\\s*\\[([^\\]]*)\\]`));
  expect(match, `${key} dizisi bulunamadı`).not.toBeNull();
  return [...match![1].matchAll(/'([^']*)'/g)].map((m) => m[1]);
}

const LEGACY_IGNORES = ['Charts-*', 'PaymentChart-*', 'VehiclePage-*', 'TimelinePage-*', 'FinancePage-*', 'timelineStore-*', 'financeStore-*', 'LegacyApp-*', 'HomePlanPage-*', 'NumberInput-*', 'Collapse-*', 'Tabs-*'];
const ADMIN_IGNORES = ['admin.html', 'admin-*', 'antd-*', 'pro-*', 'icons-*'];

describe('vite.config.ts admin sözleşmesi', () => {
  it('base /aile/ olarak kalır', () => {
    expect(source).toMatch(/base:\s*'\/aile\/'/);
  });

  it('rolldown girdisinde index.html ve admin.html bulunur', () => {
    expect(source).toMatch(/rolldownOptions:\s*\{/);
    expect(source).toMatch(/input:\s*\{\s*index:\s*'index\.html',\s*admin:\s*'admin\.html'\s*\}/);
  });

  it('codeSplitting grupları tokens/antd/pro/icons/router/shared adlarını taşır', () => {
    const block = source.slice(source.indexOf('codeSplitting:'));
    expect(source).toContain('codeSplitting:');
    expect(block).toMatch(/groups:\s*\[/);
    const names = [...block.matchAll(/name:\s*'([^']+)'/g)].map((m) => m[1]);
    expect([...names].sort()).toEqual(['antd', 'icons', 'pro', 'router', 'shared', 'tokens']);
    expect(block).toMatch(/includeDependenciesRecursively:\s*false/);
  });

  it('router grubu wouter çekirdeğini alır, ana kabuğun hash-location açılışını (WOUTER_BOOT) shared içinde bırakır', () => {
    const block = source.slice(source.indexOf('codeSplitting:'));
    const router = block.split('\n').find((line) => /name:\s*'router'/.test(line)) ?? '';
    expect(router, 'router grubu satırı').not.toBe('');
    expect(router).toContain('!WOUTER_BOOT.test(id)');
    expect(router).toMatch(/wouter\|regexparam/);
    const shared = block.split('\n').find((line) => /name:\s*'shared'/.test(line)) ?? '';
    expect(shared).toContain('WOUTER_BOOT.test(id)');
    expect(shared).not.toContain('!WOUTER_BOOT');
  });

  it('globIgnores eski 12 glob ve admin globlarını aynen içerir (tek kaynak PRECACHE_IGNORES)', () => {
    const ignores = arrayLiteral('const PRECACHE_IGNORES');
    expect(ignores).toEqual([...LEGACY_IGNORES, ...ADMIN_IGNORES].map((glob) => `**/${glob}`));
    expect(source).toMatch(/globIgnores:\s*PRECACHE_IGNORES,/);
  });

  it('ön bellek kapsamı paket grafiğinden süzülür: eklenti listede, manifestTransforms bağlı', () => {
    expect(source).toMatch(/const precacheScope = adminPrecacheScope\(PRECACHE_IGNORES\);/);
    expect(source).toMatch(/plugins:\s*\[[\s\S]*precacheScope\.plugin,[\s\S]*VitePWA\(/);
    expect(source).toMatch(/manifestTransforms:\s*\[precacheScope\.manifestTransform\]/);
  });

  it('globPatterns değişmez', () => {
    expect(arrayLiteral('globPatterns')).toEqual(['**/*.{js,css,html,svg,woff2,ttf}']);
  });

  it('navigateFallbackDenylist admin.html yolunu dışarıda bırakır', () => {
    const match = source.match(/navigateFallbackDenylist:\s*\[([^\]]*)\]/);
    expect(match).not.toBeNull();
    const patterns = match![1].split(',').map((s) => s.trim()).filter(Boolean);
    expect(patterns).toEqual(['/\\/admin\\.html/']);
    expect(source).toMatch(/navigateFallback:\s*'\/aile\/index\.html'/);
  });

  it('privateData eklentisi içe aktarılır ve eklenti listesinde çağrılır', () => {
    expect(source).toMatch(/import\s*\{\s*privateDataPlugin\s*\}\s*from\s*'\.\/src\/admin\/devServer\/privateData(\.ts)?'/);
    expect(source).toMatch(/plugins:\s*\[[\s\S]*privateDataPlugin\(\)/);
  });

  it('transformIndexHtml açılış kabuğunu yalnız index.html için ekler', () => {
    const start = source.indexOf('transformIndexHtml(');
    expect(start).toBeGreaterThan(-1);
    const body = source.slice(start, source.indexOf('react()', start));
    const guard = body.indexOf("if (!ctx.filename.endsWith('index.html')) return html;");
    expect(guard).toBeGreaterThan(-1);
    for (const token of ['startupMarkup', 'startupStyles', 'startupFailureScript']) {
      const at = body.indexOf(token);
      expect(at, `${token} kullanılmalı`).toBeGreaterThan(-1);
      expect(at, `${token} index.html korumasından sonra gelmeli`).toBeGreaterThan(guard);
    }
    // admin.html yalnız klavye kipi kurucusunu alır, açılış kabuğunu değil.
    const adminLine = body.split('\n').find((line) => line.includes("endsWith('admin.html')")) ?? '';
    expect(adminLine).toContain('adminStartupScript');
    expect(adminLine).not.toMatch(/startupMarkup|startupStyles|startupFailureScript/);
  });
});

// Davranış kapısı: gerçek üretim derlemesi (geçici klasöre) ve workbox sw.js ön belleği. Parça sahipliği config'in
// kendi hesabından bağımsız olarak Vite'ın derleme manifestinden (.vite/manifest.json: imports, dynamicImports, css)
// çıkarılır: admin.html'den erişilen ama ana girişin kabuğundan (bilinçli tembel eski parçalarda durarak) erişilmeyen
// her JS/CSS yönetime aittir ve ön belleğe giremez; ana kabuğun her dosyası ise çevrimdışı için ön bellekte kalır.
type ManifestChunk = { file: string; css?: string[]; imports?: string[]; dynamicImports?: string[] };

describe('üretim derlemesi PWA ön belleği', () => {
  const root = resolve(__dirname, '../..');
  const outDir = mkdtempSync(join(tmpdir(), 'aile-precache-'));
  let manifest: Record<string, ManifestChunk> = {};
  let precache: string[] = [];

  /** Eski tembel parça adları (globIgnores'un ilk 12 girdisi): ana kabuk bunların içine inmez. */
  const lazyLegacy = (key: string) => LEGACY_IGNORES.some((glob) => manifest[key].file.split('/').pop()!.startsWith(glob.slice(0, -1)));
  function closure(root: string, stop: (key: string) => boolean): Set<string> {
    const seen = new Set<string>();
    const queue = [root];
    while (queue.length) {
      const key = queue.shift()!;
      if (seen.has(key)) continue;
      seen.add(key);
      const chunk = manifest[key];
      for (const child of [...(chunk.imports ?? []), ...(chunk.dynamicImports ?? [])]) if (!seen.has(child) && !stop(child)) queue.push(child);
    }
    return seen;
  }
  const files = (keys: Set<string>) => new Set([...keys].flatMap((key) => [manifest[key].file, ...(manifest[key].css ?? [])]).filter((file) => file.startsWith('assets/')));
  const mainShellFiles = () => files(closure('index.html', lazyLegacy));
  const adminOnlyFiles = () => { const main = mainShellFiles(); return [...files(closure('admin.html', () => false))].filter((file) => !main.has(file)); };

  beforeAll(async () => {
    // `pnpm build` ile aynı yol: ayrı süreçte Vite CLI (+ yalnız okunacak --manifest; parça çıktısını değiştirmez).
    // Vitest süreci NODE_ENV=test taşır; o ortamda derleme farklı bir grafik ve küçültülmemiş sw.js üretir, bu yüzden
    // ortam üretime sabitlenir ve VITEST* değişkenleri atılır.
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('VITEST')));
    await promisify(execFile)(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', outDir, '--emptyOutDir', '--manifest', '--logLevel', 'error'], { cwd: root, env: { ...env, NODE_ENV: 'production' }, maxBuffer: 16 * 1024 * 1024 });
    manifest = JSON.parse(readFileSync(join(outDir, '.vite/manifest.json'), 'utf8'));
    const sw = readFileSync(join(outDir, 'sw.js'), 'utf8');
    precache = [...sw.matchAll(/["']?url["']?\s*:\s*["']([^"']+)["']/g)].map((m) => m[1]);
    // Gerçek bir üretim derlemesi (rolldown + workbox) birkaç saniye sürer; bu bir yeniden deneme değil, iş süresidir.
  }, 180_000);
  afterAll(() => rmSync(outDir, { recursive: true, force: true }));

  it('derleme iki girişi ve bir ön bellek listesi üretir', () => {
    expect(Object.keys(manifest)).toEqual(expect.arrayContaining(['index.html', 'admin.html']));
    expect(precache).toContain('index.html');
    expect(precache).not.toContain('admin.html');
  });

  it('yönetime ait hiçbir JS/CSS dosyası (sayfalar, ortak kabuk, ECharts alt parçaları) ön belleğe girmez', () => {
    const adminOnly = adminOnlyFiles();
    expect(adminOnly.length, 'admin grafiği boş olmamalı').toBeGreaterThan(0);
    expect(precache.filter((url) => adminOnly.includes(url)).sort()).toEqual([]);
  });

  it('ana kabuğun her dosyası çevrimdışı için ön bellekte kalır', () => {
    const main = mainShellFiles();
    expect([...main].some((file) => /^assets\/mount-.*\.js$/.test(file)), 'ana kabuk mount parçasını içermeli').toBe(true);
    expect([...main].filter((file) => !precache.includes(file)).sort()).toEqual([]);
  });

  it('wouter çekirdeği (router parçası) ana kabukta değil, ön bellekte değil', () => {
    const router = Object.values(manifest).map((chunk) => chunk.file).filter((file) => /^assets\/router-.*\.js$/.test(file));
    expect(router, 'router parçası üretilmeli').toHaveLength(1);
    expect(mainShellFiles().has(router[0]), 'router ana kabuğa girmemeli').toBe(false);
    expect(precache).not.toContain(router[0]);
  });

  it('bilinen yönetim ve ECharts parça adları ön bellekte görünmez', () => {
    const forbidden = /^assets\/(?:admin|antd|pro|icons|router|(?:Alimlar|Ayarlar|Butce|Ev|Genel|Hesaplar|Odemeler|Projeler|Raporlar|Sozlukler|Taraflar|Veri)Page|QueryBar|X\.es|views|contracts|core|charts|components|renderers|graphic|createSeriesData|customGraphicKeyframeAnimation|parseGeoJson)-/;
    expect(precache.filter((url) => forbidden.test(url)).sort()).toEqual([]);
  });
});
