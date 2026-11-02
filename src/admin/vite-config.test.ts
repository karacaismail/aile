// Kaynak kapısı: vite.config.ts'in admin girişine, parça gruplarına, uyarlamalı teslim grafiğine ve PWA önbelleğine
// dair sözleşmesi. İlk bölüm yapılandırmayı çalıştırmadan metin olarak denetler (eklentiler ve rolldown seçenekleri yan
// etkisiz kalır); sonraki bölümler gerçek üretim derlemesi (geçici klasöre, ayrı Vite süreci) ile davranışı kanıtlar.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const source = readFileSync(resolve(__dirname, '../../vite.config.ts'), 'utf8');

function arrayLiteral(key: string): string[] {
  const match = source.match(new RegExp(`${key}\\s*[:=]\\s*\\[([^\\]]*)\\]`));
  expect(match, `${key} dizisi bulunamadı`).not.toBeNull();
  return [...match![1].matchAll(/'([^']*)'/g)].map((m) => m[1]);
}

/** `const CHUNK_GROUPS = [ ... ];` gövdesi: codeSplitting ve teslim grafiği aynı grup listesini kullanır. */
function groupsBlock(): string {
  const start = source.indexOf('const CHUNK_GROUPS');
  expect(start, 'CHUNK_GROUPS sabiti bulunamadı').toBeGreaterThan(-1);
  return source.slice(start, source.indexOf('\n];', start));
}
const groupLine = (name: string) => groupsBlock().split('\n').find((line) => new RegExp(`name:\\s*'${name}'`).test(line)) ?? '';
const priorityOf = (line: string) => Number(/priority:\s*(-?\d+)/.exec(line)?.[1]);

/** vite.config.ts içindeki `const WIDE_MODULE = /…/;` düzenli ifadesi (metinden; config yürütülmez). */
function wideModulePattern(): RegExp {
  const match = /const WIDE_MODULE = (\/.+\/[a-z]*);/.exec(source);
  expect(match, 'WIDE_MODULE düzenli ifadesi bulunamadı').not.toBeNull();
  return new Function(`return ${match![1]};`)() as RegExp;
}

const LEGACY_IGNORES = ['Charts-*', 'PaymentChart-*', 'VehiclePage-*', 'TimelinePage-*', 'FinancePage-*', 'timelineStore-*', 'financeStore-*', 'LegacyApp-*', 'HomePlanPage-*', 'NumberInput-*', 'Collapse-*', 'Tabs-*'];
const ADMIN_IGNORES = ['admin.html', 'admin-*', 'antd-*', 'pro-*', 'icons-*', 'wide-*'];

describe('vite.config.ts admin sözleşmesi', () => {
  it('base /aile/ olarak kalır', () => {
    expect(source).toMatch(/base:\s*'\/aile\/'/);
  });

  it('rolldown girdisinde index.html ve admin.html bulunur', () => {
    expect(source).toMatch(/rolldownOptions:\s*\{/);
    expect(source).toMatch(/input:\s*\{\s*index:\s*'index\.html',\s*admin:\s*'admin\.html'\s*\}/);
  });

  it('codeSplitting grupları wide/tokens/antd/pro/icons/router/shared adlarını taşır (tek liste: CHUNK_GROUPS)', () => {
    const names = [...groupsBlock().matchAll(/name:\s*'([^']+)'/g)].map((m) => m[1]);
    expect([...names].sort()).toEqual(['antd', 'icons', 'pro', 'router', 'shared', 'tokens', 'wide']);
    const block = source.slice(source.indexOf('codeSplitting:'));
    expect(source).toContain('codeSplitting:');
    expect(block).toMatch(/groups:\s*CHUNK_GROUPS,/);
    expect(block).toMatch(/includeDependenciesRecursively:\s*false/);
  });

  it('wide grubu en yüksek öncelikte; başka hiçbir grup (shared/tokens dahil) geniş-özel modülü alamaz', () => {
    const wide = groupLine('wide');
    expect(wide, 'wide grubu satırı').not.toBe('');
    expect(wide).toContain('test: isWideModule');
    for (const name of ['tokens', 'pro', 'icons', 'antd', 'router', 'shared']) expect(priorityOf(wide), `wide > ${name}`).toBeGreaterThan(priorityOf(groupLine(name)));
    expect(source).toMatch(/const isWideModule = \(id: string\) => !\/\[\\\\\/\]node_modules\[\\\\\/\]\/\.test\(id\) && WIDE_MODULE\.test\(id\);/);
  });

  it('WIDE_MODULE: *.wide.{ts,tsx,js,jsx,css} adı veya src altındaki wide/ klasörü; benzer adlar değil', () => {
    const wide = wideModulePattern();
    const yes = [
      '/repo/src/admin/ui/Table.wide.tsx', '/repo/src/admin/ui/Table.wide.ts', '/repo/src/admin/ui/Table.wide.css', '/repo/src/admin/ui/Table.wide.jsx',
      '/repo/src/admin/wide/Board.tsx', '/repo/src/admin/pages/wide/sub/Grid.ts', 'C:\\repo\\src\\admin\\wide\\Board.tsx', '/repo/src/admin/ui/Table.wide.css?used',
    ];
    const no = [
      '/repo/src/admin/ui/Table.tsx', '/repo/src/admin/ui/widescreen.ts', '/repo/src/admin/widely/Board.tsx', '/repo/src/admin/ui/Table.wider.tsx',
      '/repo/src/admin/ui/wide.ts', '/repo/lib/wide/Board.tsx', '/repo/src/admin/ui/Table.wide.json',
    ];
    for (const id of yes) expect(wide.test(id), id).toBe(true);
    for (const id of no) expect(wide.test(id), id).toBe(false);
  });

  it('router grubu wouter çekirdeğini alır, ana kabuğun hash-location açılışını (WOUTER_BOOT) shared içinde bırakır', () => {
    const router = groupLine('router');
    expect(router, 'router grubu satırı').not.toBe('');
    expect(router).toContain('!WOUTER_BOOT.test(id)');
    expect(router).toMatch(/wouter\|regexparam/);
    const shared = groupLine('shared');
    expect(shared).toContain('WOUTER_BOOT.test(id)');
    expect(shared).not.toContain('!WOUTER_BOOT');
  });

  it('globIgnores eski 12 glob ve admin globlarını (wide-* dahil) aynen içerir (tek kaynak PRECACHE_IGNORES)', () => {
    const ignores = arrayLiteral('const PRECACHE_IGNORES');
    expect(ignores).toEqual([...LEGACY_IGNORES, ...ADMIN_IGNORES].map((glob) => `**/${glob}`));
    expect(source).toMatch(/globIgnores:\s*PRECACHE_IGNORES,/);
  });

  it('ön bellek kapsamı paket grafiğinden süzülür: eklenti listede, manifestTransforms bağlı', () => {
    expect(source).toMatch(/const precacheScope = adminPrecacheScope\(PRECACHE_IGNORES\);/);
    expect(source).toMatch(/plugins:\s*\[[\s\S]*precacheScope\.plugin,[\s\S]*VitePWA\(/);
    expect(source).toMatch(/manifestTransforms:\s*\[precacheScope\.manifestTransform\]/);
  });

  it('build manifesti açık ve teslim grafiği eklentisi aynı grup listesini alır', () => {
    const build = source.slice(source.indexOf('  build: {'));
    expect(build).toMatch(/^\s*build: \{\s*\n\s*sourcemap: false,\s*\n\s*manifest: true,/);
    expect(source).toMatch(/plugins:\s*\[[\s\S]*deliveryGraph\(CHUNK_GROUPS\),[\s\S]*VitePWA\(/);
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
type ManifestChunk = { file: string; name?: string; src?: string; css?: string[]; imports?: string[]; dynamicImports?: string[] };
type DeliveryGraph = { schema: number; groups: string[]; chunks: Record<string, { modules: number; groups: Record<string, number>; packages: Record<string, number> }>; edges: Array<{ fromChunk: string; from: string; fromGroup: string | null; toChunk: string; to: string; toGroup: string | null }> };

const root = resolve(__dirname, '../..');
const run = promisify(execFile);
/** `pnpm build` ile aynı yol: ayrı süreçte Vite CLI. Vitest süreci NODE_ENV=test taşır; o ortamda derleme farklı bir
 *  grafik ve küçültülmemiş sw.js üretir, bu yüzden ortam üretime sabitlenir ve VITEST* değişkenleri atılır. */
function productionEnv() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('VITEST')));
  return { ...env, NODE_ENV: 'production' };
}
function viteBuild(cwd: string, outDir: string) {
  return run(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), 'build', '--config', resolve(root, 'vite.config.ts'), '--outDir', outDir, '--emptyOutDir', '--logLevel', 'error'], { cwd, env: productionEnv(), maxBuffer: 16 * 1024 * 1024 });
}
/** scripts/check-delivery.mjs; çıkış kodu ve rapor (rapor geçici derleme klasörüne yazılır). */
async function checkDelivery(outDir: string, args: string[] = []) {
  try {
    const { stdout, stderr } = await run(process.execPath, [resolve(root, 'scripts/check-delivery.mjs'), outDir, ...args], { cwd: root, maxBuffer: 16 * 1024 * 1024 });
    return { code: 0, output: stdout + stderr };
  } catch (error) {
    const failure = error as { code: number; stdout: string; stderr: string };
    return { code: failure.code, output: failure.stdout + failure.stderr };
  }
}
const parsePrecache = (sw: string) => [...sw.matchAll(/["']?url["']?\s*:\s*["']([^"']+)["']/g)].map((m) => m[1]);
function walk(dir: string, base = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name.startsWith('.') ? [] : walk(full, base);
    return [relative(base, full).split(sep).join('/')];
  });
}

describe('üretim derlemesi PWA ön belleği ve teslim grafiği', () => {
  const outDir = mkdtempSync(join(tmpdir(), 'aile-precache-'));
  let manifest: Record<string, ManifestChunk> = {};
  let graph: DeliveryGraph;
  let precache: string[] = [];

  /** Eski tembel parça adları (globIgnores'un ilk 12 girdisi): ana kabuk bunların içine inmez. */
  const lazyLegacy = (key: string) => LEGACY_IGNORES.some((glob) => manifest[key].file.split('/').pop()!.startsWith(glob.slice(0, -1)));
  function closure(start: string, stop: (key: string) => boolean): Set<string> {
    const seen = new Set<string>();
    const queue = [start];
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
  const mainGraphFiles = () => files(closure('index.html', () => false));
  const adminOnlyFiles = () => { const main = mainShellFiles(); return [...files(closure('admin.html', () => false))].filter((file) => !main.has(file)); };

  beforeAll(async () => {
    // build.manifest config'ten gelir: CLI'ya --manifest verilmez; manifest yoksa aşağıdaki okuma düşer.
    await viteBuild(root, outDir);
    manifest = JSON.parse(readFileSync(join(outDir, '.vite/manifest.json'), 'utf8'));
    graph = JSON.parse(readFileSync(join(outDir, '.vite/delivery-graph.json'), 'utf8'));
    precache = parsePrecache(readFileSync(join(outDir, 'sw.js'), 'utf8'));
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

  // Kök neden (19 ↔ 20 giriş): vite-plugin-pwa varsayılanı (includeManifestIcons: true) manifest simgesi icon.svg'yi
  // ek girdi olarak ekler; workbox globPatterns aynı dosyayı zaten bulduğu için icon.svg iki kez ön belleğe giriyordu
  // (20 giriş, boyut aynı: workbox toplamı tekil dosyalardan sayar). includeManifestIcons: false ile yinelenen girdi
  // kalktı; doğru beklenti "her URL bir kez"dir, sabit bir giriş sayısı değil.
  it('ön bellekte her URL bir kez; icon.svg tek girdi, manifest.webmanifest var', () => {
    const repeated = precache.filter((url, index) => precache.indexOf(url) !== index);
    expect(repeated, 'yinelenen ön bellek girdileri').toEqual([]);
    expect(precache.filter((url) => url === 'icon.svg')).toHaveLength(1);
    expect(precache).toContain('manifest.webmanifest');
  });

  it('ön bellek yalnız ana girişin grafiğinden ve kök kabuk dosyalarından oluşur; kök kabuk dosyalarının hepsi içeride', () => {
    const rootShell = walk(outDir).filter((file) => !file.startsWith('assets/') && /\.(?:js|css|html|svg|woff2|ttf)$/.test(file) && file !== 'admin.html' && file !== 'sw.js' && !/^workbox-[^/]+\.js$/.test(file));
    const allowed = new Set([...mainGraphFiles(), ...rootShell, 'manifest.webmanifest']);
    expect(precache.filter((url) => !allowed.has(url)).sort(), 'ana grafiğe ait olmayan ön bellek girdileri').toEqual([]);
    expect(rootShell.filter((file) => !precache.includes(file)).sort()).toEqual([]);
  });

  it('wouter çekirdeği (router parçası) ana kabukta değil, ön bellekte değil', () => {
    const router = Object.values(manifest).map((chunk) => chunk.file).filter((file) => /^assets\/router-.*\.js$/.test(file));
    expect(router, 'router parçası üretilmeli').toHaveLength(1);
    expect(mainShellFiles().has(router[0]), 'router ana kabuğa girmemeli').toBe(false);
    expect(precache).not.toContain(router[0]);
  });

  it('bilinen yönetim ve ECharts parça adları ön bellekte görünmez', () => {
    const forbidden = /^assets\/(?:admin|antd|pro|icons|wide|router|(?:Alimlar|Ayarlar|Butce|Ev|Genel|Hesaplar|Odemeler|Projeler|Raporlar|Sozlukler|Taraflar|Veri)Page|QueryBar|X\.es|views|contracts|core|charts|components|renderers|graphic|createSeriesData|customGraphicKeyframeAnimation|parseGeoJson)-/;
    expect(precache.filter((url) => forbidden.test(url)).sort()).toEqual([]);
  });

  it('delivery-graph her JS parçasını kapsar, grup üyeliği config testinden gelir, mutlak yol taşımaz', () => {
    expect(graph.schema).toBe(1);
    expect(graph.groups).toEqual(['wide', 'tokens', 'pro', 'icons', 'antd', 'router', 'shared']);
    const jsFiles = Object.values(manifest).map((chunk) => chunk.file).filter((file) => file.endsWith('.js'));
    expect(jsFiles.filter((file) => !graph.chunks[file]).sort(), 'graph içinde olmayan manifest parçaları').toEqual([]);
    const antd = Object.values(manifest).find((chunk) => chunk.name === 'antd' && /^assets\/antd-/.test(chunk.file))!;
    expect(Object.keys(graph.chunks[antd.file].groups)).toEqual(['antd']);
    expect(graph.chunks[antd.file].packages.antd).toBeGreaterThan(0);
    const text = readFileSync(join(outDir, '.vite/delivery-graph.json'), 'utf8');
    expect(text).not.toContain(root);
    expect(text).not.toMatch(/node_modules\/\.pnpm\//);
    expect(graph.edges.some((edge) => edge.from === 'src/admin/ui/antd.ts' && edge.toGroup === 'antd')).toBe(true);
  });

  it('check-delivery ratchet modunda PASS: telefon statik kapanışında baseline dışı ihlal yok; rapor yazılır', async () => {
    const result = await checkDelivery(outDir);
    expect(result.code, result.output).toBe(0);
    const report = JSON.parse(readFileSync(join(outDir, 'delivery-report.json'), 'utf8'));
    const baseline = JSON.parse(readFileSync(resolve(root, 'scripts/delivery-baseline.json'), 'utf8'));
    expect(report.status).toBe('pass');
    expect(report.mode).toBe('ratchet');
    expect(report.violations.map((violation: { id: string }) => violation.id).filter((id: string) => !baseline.violations.includes(id))).toEqual([]);
  }, 60_000);
});

// Geniş-özel modüller: geçici bir mini projede (iki giriş: index + admin) gerçek vite.config.ts ile derlenir. src/ altında
// *.wide.tsx, *.wide.css ve wide/ klasörü; ortak yardımcı (format.ts) telefon girişiyle paylaşılır; tokens ve klavye
// kipi (shared) projeden alias ile gelir. Fixture çıplak paket import etmez (geçici klasörde node_modules yok).
describe('wide grubu: geniş-özel modüller tek parçada, telefon statik grafiğine ve shared/tokens gruplarına sızmaz', () => {
  const fixture = realpathSync(mkdtempSync(join(tmpdir(), 'aile-wide-')));
  const MARKERS = { panel: 'FIXTURE_WIDE_PANEL_MARKER', board: 'FIXTURE_WIDE_BOARD_MARKER', css: 'fixture-wide-panel-marker', format: 'FIXTURE_FORMAT_MARKER' };
  const builds: Record<'lazy' | 'static', { outDir: string; manifest: Record<string, ManifestChunk>; js: Record<string, string> }> = {} as never;

  function writeFixture(dir: string, adminSource: string) {
    mkdirSync(join(dir, 'src/wide'), { recursive: true });
    const html = (script: string) => `<!doctype html><html lang="tr"><head><meta charset="UTF-8" /><title>fixture</title></head><body><button type="button">aç</button><script type="module" src="${script}"></script></body></html>\n`;
    writeFileSync(join(dir, 'index.html'), html('/src/main.ts'));
    writeFileSync(join(dir, 'admin.html'), html('/src/admin.ts'));
    writeFileSync(join(dir, 'src/main.ts'), "import { installKeyboardMode } from '@/dashboard/keyboard.ts';\ninstallKeyboardMode();\ndocument.title = 'FIXTURE_MAIN';\n");
    writeFileSync(join(dir, 'src/format.ts'), `export const formatMarker = (value: string) => '${MARKERS.format}:' + value;\n`);
    writeFileSync(join(dir, 'src/wide/Board.ts'), `export const boardMarker = () => '${MARKERS.board}';\n`);
    writeFileSync(join(dir, 'src/Panel.wide.css'), `.${MARKERS.css} { display: grid; }\n`);
    writeFileSync(join(dir, 'src/Panel.wide.tsx'), [
      "import './Panel.wide.css';",
      "import { designTokens } from '@/design/tokens.ts';",
      "import { formatMarker } from './format.ts';",
      "import { boardMarker } from './wide/Board.ts';",
      `export const panelMarker = () => formatMarker('${MARKERS.panel}' + boardMarker() + designTokens.eylem);`,
      '',
    ].join('\n'));
    writeFileSync(join(dir, 'src/admin.ts'), adminSource);
  }
  const ADMIN_PREFIX = [
    "import { installKeyboardMode } from '@/dashboard/keyboard.ts';",
    "import { designTokens } from '@/design/tokens.ts';",
    "import { formatMarker } from './format.ts';",
    'installKeyboardMode();',
    'document.body.dataset.phone = formatMarker(designTokens.eylem);',
  ].join('\n');
  const LAZY_ADMIN = `${ADMIN_PREFIX}\ndocument.querySelector('button')?.addEventListener('click', () => { void import('./Panel.wide.tsx').then((m) => { document.body.dataset.wide = m.panelMarker(); }); });\n`;
  const STATIC_ADMIN = `import { panelMarker } from './Panel.wide.tsx';\n${ADMIN_PREFIX}\ndocument.body.dataset.wide = panelMarker();\n`;

  beforeAll(async () => {
    for (const [variant, adminSource] of [['lazy', LAZY_ADMIN], ['static', STATIC_ADMIN]] as const) {
      const dir = join(fixture, variant);
      writeFixture(dir, adminSource);
      const outDir = join(dir, 'dist');
      await viteBuild(dir, outDir);
      const manifest = JSON.parse(readFileSync(join(outDir, '.vite/manifest.json'), 'utf8')) as Record<string, ManifestChunk>;
      const js = Object.fromEntries(walk(outDir).filter((file) => file.startsWith('assets/') && file.endsWith('.js')).map((file) => [file, readFileSync(join(outDir, file), 'utf8')]));
      builds[variant] = { outDir, manifest, js };
    }
  }, 180_000);
  afterAll(() => rmSync(fixture, { recursive: true, force: true }));

  const wideChunks = (variant: 'lazy' | 'static') => Object.values(builds[variant].manifest).filter((chunk) => chunk.name === 'wide');

  it('*.wide.tsx, wide/ klasörü ve *.wide.css tek bir wide parçasında (ve onun CSS dosyasında) toplanır', () => {
    const wide = wideChunks('lazy');
    expect(wide.map((chunk) => chunk.file)).toEqual([expect.stringMatching(/^assets\/wide-[^/]+\.js$/)]);
    const code = builds.lazy.js[wide[0].file];
    expect(code).toContain(MARKERS.panel);
    expect(code).toContain(MARKERS.board);
    const css = (wide[0].css ?? []).map((file) => readFileSync(join(builds.lazy.outDir, file), 'utf8')).join('\n');
    expect(css).toContain(MARKERS.css);
  });

  it('wide işaretleri başka hiçbir parçada (giriş, shared, tokens) yok; telefonla ortak yardımcı wide parçasına girmez', () => {
    const wideFile = wideChunks('lazy')[0].file;
    const leaks = Object.entries(builds.lazy.js).filter(([file, code]) => file !== wideFile && (code.includes(MARKERS.panel) || code.includes(MARKERS.board))).map(([file]) => file);
    expect(leaks).toEqual([]);
    expect(builds.lazy.js[wideFile]).not.toContain(MARKERS.format);
    const grouped = (name: string) => Object.values(builds.lazy.manifest).filter((chunk) => chunk.name === name).map((chunk) => chunk.file);
    expect(grouped('shared')).toHaveLength(1);
    expect(grouped('tokens')).toHaveLength(1);
    const otherCss = Object.values(builds.lazy.manifest).filter((chunk) => chunk.name !== 'wide').flatMap((chunk) => chunk.css ?? []);
    for (const file of otherCss) expect(readFileSync(join(builds.lazy.outDir, file), 'utf8'), file).not.toContain(MARKERS.css);
  });

  it('tembel wide: telefon statik kapanışında değil, ön bellekte değil; check-delivery --strict PASS', async () => {
    const wideFile = wideChunks('lazy')[0].file;
    const sw = parsePrecache(readFileSync(join(builds.lazy.outDir, 'sw.js'), 'utf8'));
    expect(sw.filter((url) => /(?:^|\/)wide-/.test(url))).toEqual([]);
    const result = await checkDelivery(builds.lazy.outDir, ['--strict']);
    expect(result.code, result.output).toBe(0);
    const report = JSON.parse(readFileSync(join(builds.lazy.outDir, 'delivery-report.json'), 'utf8'));
    expect(report.phone.static.chunks.map((chunk: { file: string }) => chunk.file)).not.toContain(wideFile);
    expect(report.lazy.some((entry: { added: { byClass: Record<string, unknown> } }) => 'wide' in entry.added.byClass)).toBe(true);
  }, 60_000);

  it('statik wide importu: check-delivery --strict FAIL ve içe aktaran modülü adıyla listeler', async () => {
    expect(wideChunks('static')).toHaveLength(1);
    const result = await checkDelivery(builds.static.outDir, ['--strict']);
    expect(result.code, result.output).toBe(1);
    expect(result.output).toContain('wide <- src/admin.ts');
  }, 60_000);
});
