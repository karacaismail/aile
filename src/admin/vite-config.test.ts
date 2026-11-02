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

/** Bir CHUNK_GROUPS satırındaki `test: (id: string) => /…/.test(id)` düzenli ifadesi (metinden; config yürütülmez). */
function groupPattern(name: string): RegExp {
  const match = /test: \(id: string\) => (\/.+?\/[a-z]*)\.test\(id\)/.exec(groupLine(name));
  expect(match, `${name} grubunun düzenli ifadesi bulunamadı`).not.toBeNull();
  return new Function(`return ${match![1]};`)() as RegExp;
}

/** `navigateFallbackDenylist: [ … ]` içindeki düzenli ifadeler (metinden). */
function denylistPatterns(): RegExp[] {
  const match = source.match(/navigateFallbackDenylist:\s*\[([^\]]*)\]/);
  expect(match, 'navigateFallbackDenylist bulunamadı').not.toBeNull();
  return match![1].split(/,(?=\s*\/)/).map((s) => s.trim()).filter(Boolean).map((literal) => new Function(`return ${literal};`)() as RegExp);
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

  it('codeSplitting grupları wide/tokens/pro/icons/babel-runtime/antd/router/shared adlarını taşır (tek liste: CHUNK_GROUPS)', () => {
    const names = [...groupsBlock().matchAll(/name:\s*'([^']+)'/g)].map((m) => m[1]);
    expect([...names].sort()).toEqual(['antd', 'babel-runtime', 'icons', 'pro', 'router', 'shared', 'tokens', 'wide']);
    const block = source.slice(source.indexOf('codeSplitting:'));
    expect(source).toContain('codeSplitting:');
    // codeSplitting grupları CHUNK_GROUPS'tan türer: ad, öncelik ve test aynı; yalnız parça adı (chunkName) gruba özeldir.
    expect(block).toMatch(/groups:\s*SPLIT_GROUPS,/);
    expect(source).toMatch(/const SPLIT_GROUPS = CHUNK_GROUPS\.map\(\(\{ name, chunkName, priority, test \}\) => \(\{ name: chunkName \?\? name, priority, test \}\)\);/);
    expect(block).toMatch(/includeDependenciesRecursively:\s*false/);
  });

  // İnceleme bulgusu (major): tek `wide` parçası dokuz sayfa parçasını statik çekiyordu; geniş ilk rota başka sayfaların
  // JS/CSS'ini indirip çalıştırıyordu. Geniş-özel modüller artık birim başına parçadır: rota sayfası klasörü
  // (src/admin/pages/<ad>/… ya da pages/<Ad>Page.wide.*) ya da modülün kendisi (kabuk, ui). Sınıf (delivery-graph) yine `wide`.
  it('wide grubu parça adını birime göre verir: sayfa klasörü/sayfa ya da modül kökü (kabuk, ui)', () => {
    expect(groupLine('wide')).toContain('chunkName: wideChunkName');
    const match = /function wideChunkName\(id: string\): string \{[\s\S]*?\n\}/.exec(source);
    expect(match, 'wideChunkName işlevi').not.toBeNull();
    const body = match![0].replace(/^function wideChunkName\(id: string\): string/, 'function wideChunkName(id)');
    const name = new Function(`${body}; return wideChunkName;`)() as (id: string) => string;
    const cases: Record<string, string> = {
      '/repo/src/admin/pages/GenelPage.wide.tsx': 'wide-genel',
      '/repo/src/admin/pages/GenelPage.wide.css?used': 'wide-genel',
      '/repo/src/admin/pages/alimlar/AlimlarGenis.wide.tsx': 'wide-alimlar',
      '/repo/src/admin/pages/alimlar/AlimlarPivot.wide.css': 'wide-alimlar',
      '/repo/src/admin/pages/projeler/wide/Gantt.tsx': 'wide-projeler',
      '/repo/src/admin/pages/projeler/ProjelerGenis.wide.tsx': 'wide-projeler',
      '/repo/src/admin/shell/wide/WorkspaceNav.wide.tsx': 'wide-shell-workspacenav',
      '/repo/src/admin/shell/QueryBar.wide.tsx': 'wide-shell-querybar',
      '/repo/src/admin/ui/wide/Kanban.wide.tsx': 'wide-ui-kanban',
      '/repo/src/admin/ui/wide/Kanban.wide.css': 'wide-ui-kanban',
      '/repo/src/admin/ui/wide/Pivot.wide.tsx': 'wide-ui-pivot',
      'C:\\repo\\src\\admin\\pages\\ev\\EvIkiBolme.wide.tsx': 'wide-ev',
      '/repo/src/Panel.wide.tsx': 'wide-panel',
      '/repo/src/wide/Board.ts': 'wide-board',
    };
    for (const [id, expected] of Object.entries(cases)) expect(name(id), id).toBe(expected);
  });

  it('wide grubu en yüksek öncelikte; başka hiçbir grup (shared/tokens dahil) geniş-özel modülü alamaz', () => {
    const wide = groupLine('wide');
    expect(wide, 'wide grubu satırı').not.toBe('');
    expect(wide).toContain('test: isWideModule');
    for (const name of ['tokens', 'pro', 'icons', 'babel-runtime', 'antd', 'router', 'shared']) expect(priorityOf(wide), `wide > ${name}`).toBeGreaterThan(priorityOf(groupLine(name)));
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

  // docs/ADMIN-DEPLOY-PROPOSAL.md §8: @babel/runtime antd grubundayken ana uygulamanın tembel LegacyApp girişi
  // (@mantine/notifications, react-transition-group yardımcıları) ve antd'siz telefon modülleri yalnız bu yardımcılar
  // için 735 kB'lık antd parçasını statik çekiyordu. Ayrı küçük grup: antd'den yüksek, pro/icons'tan düşük öncelik.
  it('babel-runtime grubu @babel/runtime\'ı alır; antd grubu artık @babel/runtime almaz (öncelik antd < babel-runtime < pro/icons)', () => {
    const babel = groupLine('babel-runtime');
    expect(babel, 'babel-runtime grubu satırı').not.toBe('');
    expect(priorityOf(babel)).toBe(11);
    expect(priorityOf(babel)).toBeGreaterThan(priorityOf(groupLine('antd')));
    for (const name of ['pro', 'icons']) expect(priorityOf(babel), `babel-runtime < ${name}`).toBeLessThan(priorityOf(groupLine(name)));
    const runtime = [
      '/repo/node_modules/@babel/runtime/helpers/esm/extends.js',
      '/repo/node_modules/.pnpm/@babel+runtime@7.28.4/node_modules/@babel/runtime/helpers/esm/objectSpread2.js',
      'C:\\repo\\node_modules\\@babel\\runtime\\helpers\\esm\\extends.js',
    ];
    const notRuntime = [
      '/repo/node_modules/@babel/runtime-corejs3/helpers/esm/extends.js', '/repo/node_modules/antd/es/button/index.js',
      '/repo/node_modules/@rc-component/util/es/index.js', '/repo/src/admin/babel/runtime/x.ts',
    ];
    const babelTest = groupPattern('babel-runtime');
    for (const id of runtime) expect(babelTest.test(id), id).toBe(true);
    for (const id of notRuntime) expect(babelTest.test(id), id).toBe(false);
    const antdTest = groupPattern('antd');
    for (const id of runtime) expect(antdTest.test(id), `antd grubu ${id} almamalı`).toBe(false);
    for (const id of ['/repo/node_modules/antd/es/button/index.js', '/repo/node_modules/@rc-component/util/es/index.js', '/repo/node_modules/classnames/index.js', '/repo/node_modules/react-is/index.js', '/repo/node_modules/stylis/index.js', '/repo/node_modules/@emotion/hash/dist/x.js']) {
      expect(antdTest.test(id), `antd grubu ${id} almalı`).toBe(true);
    }
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

  it('package.json kapı betikleri: check:delivery --strict; check:budgets ölçülmüş tavanlarla (ratchet)', () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts['check:delivery']).toBe('node scripts/check-delivery.mjs dist --strict');
    expect(pkg.scripts['check:budgets']).toBe('node scripts/check-budgets.mjs dist');
  });

  it('globPatterns değişmez', () => {
    expect(arrayLiteral('globPatterns')).toEqual(['**/*.{js,css,html,svg,woff2,ttf}']);
  });

  // Workbox NavigationRoute denylist'i `pathname + search` üzerinde dener. GitHub Pages uzantısız `/aile/admin`
  // adresini de admin.html olarak çözer (docs/ADMIN-DEPLOY-PROPOSAL.md §2); eski desen yalnız `admin.html`'i dışlıyordu
  // ve SW kurulu tarayıcıda `/aile/admin` ana uygulamayı (index.html) açıyordu.
  it('navigateFallbackDenylist admin.html ve uzantısız /admin yolunu (sorgulu da) dışarıda bırakır, ana uygulama yollarını değil', () => {
    const patterns = denylistPatterns();
    expect(patterns.map(String)).toEqual(['/\\/admin(?:\\.html)?(?:\\?|$)/']);
    const denied = (pathAndSearch: string) => patterns.some((pattern) => pattern.test(pathAndSearch));
    for (const url of ['/aile/admin', '/aile/admin.html', '/aile/admin?v=2', '/aile/admin.html?v=2', '/aile/admin.html?']) expect(denied(url), url).toBe(true);
    for (const url of ['/aile/', '/aile/index.html', '/aile/timeline/', '/aile/administration', '/aile/admin-notes', '/aile/admin.htmlx', '/aile/?admin', '/aile/butce?admin.html=1']) expect(denied(url), url).toBe(false);
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
type ManifestChunk = { file: string; name?: string; src?: string; isEntry?: boolean; isDynamicEntry?: boolean; css?: string[]; imports?: string[]; dynamicImports?: string[] };
type DeliveryGraph = { schema: number; groups: string[]; chunks: Record<string, { modules: number; groups: Record<string, number>; packages: Record<string, number> }>; edges: Array<{ fromChunk: string; from: string; fromGroup: string | null; toChunk: string; to: string; toGroup: string | null }> };

const root = resolve(__dirname, '../..');
const run = promisify(execFile);
/** `pnpm build` ile aynı yol: ayrı süreçte Vite CLI. Vitest süreci NODE_ENV=test taşır; o ortamda derleme farklı bir
 *  grafik ve küçültülmemiş sw.js üretir, bu yüzden ortam üretime sabitlenir ve VITEST* değişkenleri atılır. E-tablo
 *  kimliği sentetiktir (kayıtlı bütçe ölçümüyle aynı koşul; süreç ortamı .env dosyalarındaki değeri ezer). */
const SYNTHETIC_SHEET_ID = 'synthetic-budget-sheet-2098';
function productionEnv() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('VITEST')));
  return { ...env, NODE_ENV: 'production', VITE_BUDGET_SHEET_ID: SYNTHETIC_SHEET_ID };
}
function viteBuild(cwd: string, outDir: string) {
  return run(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), 'build', '--config', resolve(root, 'vite.config.ts'), '--outDir', outDir, '--emptyOutDir', '--logLevel', 'error'], { cwd, env: productionEnv(), maxBuffer: 16 * 1024 * 1024 });
}
/** scripts/check-delivery.mjs (ya da check-budgets.mjs); çıkış kodu ve rapor (rapor geçici derleme klasörüne yazılır). */
async function checkDelivery(outDir: string, args: string[] = [], script = 'scripts/check-delivery.mjs') {
  try {
    const { stdout, stderr } = await run(process.execPath, [resolve(root, script), outDir, ...args], { cwd: root, maxBuffer: 16 * 1024 * 1024 });
    return { code: 0, output: stdout + stderr };
  } catch (error) {
    const failure = error as { code: number; stdout: string; stderr: string };
    return { code: failure.code, output: failure.stdout + failure.stderr };
  }
}
const parsePrecache = (sw: string) => [...sw.matchAll(/["']?url["']?\s*:\s*["']([^"']+)["']/g)].map((m) => m[1]);
/** Bir parçanın dinamik import ön yükleme listesi: Vite'ın `__vite__mapDeps` tablosu (m.f=[…]); tablo yoksa boş. */
function preloadDeps(code: string): string[] {
  const match = /m\.f\|\|\(m\.f=(\[[^\]]*\])\)/.exec(code);
  return match ? (JSON.parse(match[1]) as string[]) : [];
}
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
  function closure(start: string, stop: (key: string) => boolean, dynamic = true): Set<string> {
    const seen = new Set<string>();
    const queue = [start];
    while (queue.length) {
      const key = queue.shift()!;
      if (seen.has(key)) continue;
      seen.add(key);
      const chunk = manifest[key];
      for (const child of [...(chunk.imports ?? []), ...(dynamic ? chunk.dynamicImports ?? [] : [])]) if (!seen.has(child) && !stop(child)) queue.push(child);
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

  // Ölçüm (sentetik derleme VITE_BUDGET_SHEET_ID=synthetic-budget-sheet-2098, 2026-11-02, taban 010c7d8; gzip =
  // node:zlib seviye 9, dosya başına; manifest `imports` kapanışı):
  //  - Önce: LegacyApp `imports` listesi `_antd-*`'yı taşıyordu (antd parçası 735.269 B ham / 233.211 B gzip, içinde 28
  //    @babel/runtime modülü); LegacyApp statik kapanışı 20 dosya, 2.474.295 B ham / 694.820 B gzip.
  //  - Sonra: LegacyApp yalnız babel-runtime parçasını çeker (28 modül, 4.902 B ham / 1.873 B gzip); kapanış 17 dosya,
  //    1.502.846 B ham / 404.005 B gzip (−290.815 B gzip). antd parçası 730.548 B ham / 231.709 B gzip.
  //  - Ön bellek 19 giriş; 898,13 → 898,04 KiB (yalnız ana kabuktaki ön yükleme listesinde antd/icons adları kalktı).
  //    Yeni parçaya ana kabuktan erişilmez (LegacyApp tembeldir) ve admin grafiğinde olduğu için adminPrecacheScope onu
  //    dışlar. Sabit giriş sayısı değil, aşağıdaki üyelik iddiaları kilitlenir.
  //  - check-delivery (admin.html telefon statik kapanışı): 12 → 13 dosya, 413.999 → 414.820 B gzip; ayrı babel-runtime
  //    dosyası antd'den 1.502 B gzip alıp 1.873 B ekler (+371 B), kalan fark preloadRecovery (giriş parçası). İhlaller
  //    aynı iki bilinen kimlik; ratchet PASS. Bedel: telefonda antd kalkınca (PHONE_WITHOUT_ANTD) yardımcılar antd'siz gelir.
  it('@babel/runtime kendi parçasında: antd parçası onu taşımaz, LegacyApp antd parçasını çekmez, parça ön bellekte değil', () => {
    const babel = Object.values(manifest).filter((chunk) => chunk.name === 'babel-runtime');
    expect(babel.map((chunk) => chunk.file), 'tek babel-runtime parçası').toEqual([expect.stringMatching(/^assets\/babel-runtime-[^/]+\.js$/)]);
    const babelChunk = graph.chunks[babel[0].file];
    expect(Object.keys(babelChunk.groups)).toEqual(['babel-runtime']);
    expect(Object.keys(babelChunk.packages)).toEqual(['@babel/runtime']);
    const antd = Object.values(manifest).find((chunk) => chunk.name === 'antd' && /^assets\/antd-/.test(chunk.file))!;
    expect(graph.chunks[antd.file].packages['@babel/runtime'], 'antd parçasında @babel/runtime modülü').toBeUndefined();
    const legacy = manifest['src/LegacyApp.tsx'];
    expect(legacy, 'LegacyApp dinamik girişi').toBeDefined();
    const legacyImports = (legacy.imports ?? []).map((key) => manifest[key].file);
    expect(legacyImports.filter((file) => /^assets\/antd-/.test(file)), 'LegacyApp statik antd importu').toEqual([]);
    expect(legacyImports).toContain(babel[0].file);
    expect(mainShellFiles().has(babel[0].file), 'babel-runtime ana kabuğa girmemeli').toBe(false);
    expect(precache).not.toContain(babel[0].file);
  });

  it('bilinen yönetim ve ECharts parça adları ön bellekte görünmez', () => {
    const forbidden = /^assets\/(?:admin|antd|babel-runtime|pro|icons|wide|router|(?:Alimlar|Ayarlar|Butce|Ev|Genel|Hesaplar|Odemeler|Projeler|Raporlar|Sozlukler|Taraflar|Veri)Page|QueryBar|X\.es|views|contracts|core|charts|components|renderers|graphic|createSeriesData|customGraphicKeyframeAnimation|parseGeoJson)-/;
    expect(precache.filter((url) => forbidden.test(url)).sort()).toEqual([]);
  });

  it('delivery-graph her JS parçasını kapsar, grup üyeliği config testinden gelir, mutlak yol taşımaz', () => {
    expect(graph.schema).toBe(1);
    expect(graph.groups).toEqual(['wide', 'tokens', 'pro', 'icons', 'babel-runtime', 'antd', 'router', 'shared']);
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

  // İnceleme bulgusu (major): --strict hiçbir yerde sabit değildi; baseline'a kimlik eklemek her kontrolden geçerdi.
  // Kapı gerçek derlemede --strict koşar (tek ihlal FAIL), baseline boş kalır ve `pnpm check:delivery` aynı modu kullanır.
  it('check-delivery --strict PASS: telefon profilinde (giriş + rota sayfaları) hiç ihlal yok; baseline boş; rapor yazılır', async () => {
    const result = await checkDelivery(outDir, ['--strict']);
    expect(result.code, result.output).toBe(0);
    const report = JSON.parse(readFileSync(join(outDir, 'delivery-report.json'), 'utf8'));
    const baseline = JSON.parse(readFileSync(resolve(root, 'scripts/delivery-baseline.json'), 'utf8'));
    expect(report.status).toBe('pass');
    expect(report.mode).toBe('strict');
    expect(report.violations).toEqual([]);
    expect(baseline.violations, 'scripts/delivery-baseline.json yalnız daralır; kesimden sonra boştur').toEqual([]);
    // Telefon profili rota sayfalarının kapanışlarını da kapsar (routes.tsx PAGE_LOADERS: 12 sayfa).
    expect(report.phone.routes.map((entry: { root: string }) => entry.root).sort()).toEqual(
      Object.keys(manifest).filter((key) => /^src\/admin\/pages\/[^/]+Page\.tsx$/.test(key)).sort(),
    );
    expect(report.phone.routes).toHaveLength(12);
    // babel-runtime ayrı ve yasak olmayan bir sınıftır: hiçbir ihlal kimliği onu taşımaz, raporda kendi grubu vardır.
    expect(report.forbidden).not.toContain('babel-runtime');
    expect(report.groups['babel-runtime']?.files).toBe(1);
    expect(report.violations.filter((violation: { id: string }) => /babel/.test(violation.id))).toEqual([]);
  }, 60_000);

  // Bütçe kapısı gerçek derlemede: kayıtlı tavanlar ölçüme eşittir (scripts/budgets.json + CEILING_LOCK), bu yüzden ratchet
  // pratikte katıdır: ilk rota JS'i bir bayt bile büyürse FAIL. Tavanı olmayan her bütçe (telefon CSS/aktarım/yetenek isteği,
  // geniş antd) kendi sınırında geçer. Bütçe kapısı aynı derlemenin check-delivery raporunu okur (test önce onu yazar).
  it('check-budgets gerçek derlemede PASS: tavansız her bütçe sınırında, tavanlı bütçe kayıtlı tavanını aşmaz', async () => {
    expect((await checkDelivery(outDir, ['--strict'])).code, 'aynı derlemenin teslim raporu').toBe(0);
    const result = await checkDelivery(outDir, [], 'scripts/check-budgets.mjs');
    expect(result.code, result.output).toBe(0);
    const report = JSON.parse(readFileSync(join(outDir, 'budget-report.json'), 'utf8')) as { mode: string; budgets: { id: string; status: string; ceiling: number | null }[] };
    expect(report.mode).toBe('ratchet');
    expect(report.budgets.filter((budget) => budget.status === 'fail').map((budget) => budget.id)).toEqual([]);
    expect(report.budgets.filter((budget) => budget.status === 'ratchet' && budget.ceiling === null).map((budget) => budget.id)).toEqual([]);
    for (const id of ['phone-capability', 'phone-css', 'phone-transfer', 'phone-html', 'wide-antd']) expect(report.budgets.find((budget) => budget.id === id)?.status, id).toBe('pass');
  }, 60_000);

  // Geniş profil ilk ziyaret: giriş kapanışı + sayfa kapanışı + bunlardan dinamik erişilen wide sınıfı kökler (zincirleme)
  // ve onların statik kapanışı. Bu küme başka hiçbir rota sayfasının parçasını içermez.
  it('geniş profilde bir rota açılınca başka hiçbir rota sayfasının (src/admin/pages/*Page.tsx) parçası statik çekilmez', () => {
    const staticClosure = (start: string) => closure(start, () => false, false);
    const isWide = (key: string) => (graph.chunks[manifest[key].file]?.groups.wide ?? 0) * 2 > (graph.chunks[manifest[key].file]?.modules ?? 0);
    const pages = Object.keys(manifest).filter((key) => /^src\/admin\/pages\/[^/]+Page\.tsx$/.test(key)).sort();
    expect(pages).toHaveLength(12);
    const wideChunks = Object.keys(manifest).filter(isWide);
    expect(wideChunks.length, 'wide sınıfı parçalar').toBeGreaterThan(1);
    const leaks: string[] = [];
    for (const page of pages) {
      const visit = new Set([...staticClosure('admin.html'), ...staticClosure(page)]);
      let frontier = [...visit];
      while (frontier.length) {
        const next: string[] = [];
        for (const key of frontier) for (const child of manifest[key].dynamicImports ?? []) {
          if (visit.has(child) || !isWide(child)) continue;
          for (const added of staticClosure(child)) if (!visit.has(added)) { visit.add(added); next.push(added); }
        }
        frontier = next;
      }
      for (const other of pages) if (other !== page && visit.has(other)) leaks.push(`${page} -> ${other}`);
    }
    expect(leaks, 'geniş ilk ziyarette statik çekilen başka sayfa parçaları').toEqual([]);
    // Her wide parçası en çok kendi sayfasının parçasını statik çeker.
    const multi = wideChunks.map((key) => ({ key, pages: [...staticClosure(key)].filter((child) => pages.includes(child)) })).filter((entry) => entry.pages.length > 1);
    expect(multi, 'birden çok sayfa parçasını statik çeken wide parçası').toEqual([]);
  });

  // İnceleme bulgusu (minor): ana uygulamanın service worker'ı (kapsam /aile/) admin.html'i de denetler; çalışma zamanı
  // önbelleği `aile-visited-modules` (CacheFirst, 30 giriş) yönetim parçalarını da yazıp ana uygulamanın ziyaret edilmiş
  // tembel modüllerini çıkarıyordu. Yönetime ait dosyalar (admin grafiğinden erişilip ana uygulama grafiğinden erişilmeyen)
  // bu önbelleğe yazılmaz: kural sw.js'e derleme sırasında hesaplanan listeyle gömülür.
  it('sw.js çalışma zamanı önbelleği yönetime ait JS/CSS dosyalarını dışlar, ana uygulamanın tembel modüllerini dışlamaz', () => {
    const sw = readFileSync(join(outDir, 'sw.js'), 'utf8');
    expect(sw).toContain('aile-visited-modules');
    const adminFull = files(closure('admin.html', () => false));
    const mainFull = mainGraphFiles();
    const adminOnly = [...adminFull].filter((file) => !mainFull.has(file));
    expect(adminOnly.length).toBeGreaterThan(20);
    const name = (file: string) => file.split('/').pop()!;
    expect(adminOnly.filter((file) => !sw.includes(`"${name(file)}"`)).sort(), 'sw.js dışlama listesinde olmayan yönetim dosyaları').toEqual([]);
    const mainLazy = [...mainFull].filter((file) => !precache.includes(file));
    expect(mainLazy.length, 'ana uygulamanın ön bellekte olmayan tembel dosyaları').toBeGreaterThan(5);
    expect(mainLazy.filter((file) => sw.includes(`"${name(file)}"`)).sort(), 'dışlanan ana uygulama dosyaları').toEqual([]);
  });

  it('sw.js gezinme yedeği admin.html ve uzantısız /admin adresini ana uygulamaya düşürmez', () => {
    const sw = readFileSync(join(outDir, 'sw.js'), 'utf8');
    expect(sw).toContain('denylist:[/\\/admin(?:\\.html)?(?:\\?|$)/]');
  });

  it('dist/admin.html başlangıç hata betiğini giriş modülünden önce satır içi taşır; ana kabuk işaretleri yok', () => {
    const html = readFileSync(join(outDir, 'admin.html'), 'utf8');
    const inline = html.indexOf('Uygulama yüklenemedi');
    const entry = html.search(/<script type="module"[^>]*src="\/aile\/assets\/admin-[^"]+\.js"/);
    expect(inline, 'satır içi hata betiği').toBeGreaterThan(-1);
    expect(entry, 'giriş modülü').toBeGreaterThan(-1);
    expect(inline).toBeLessThan(entry);
    expect(html).not.toContain('<!--admin-startup-->');
    expect(html).not.toMatch(/app-startup/);
  });

  // Giriş parçası sayfanın <script type="module"> öğesiyle zaten yüklenir. Tembel bir parça (sayfa, wide) giriş
  // parçasını statik import edince Vite onu dinamik importun ön yükleme listesine koyar; ön yükleme yardımcısı yinelemeyi
  // yalnız link[href] ile denetlediği için <link rel="modulepreload"> eklenir ve WebKit giriş parçasını ikinci kez ister
  // (e2e/admin-production.spec.ts › admin.html#/alimlar kendi giriş parçasını bir kez yükler). Ön yükleme listeleri
  // giriş parçası taşımaz; giriş dışı bağımlılıklar listede kalır (ön yükleme kapanmadı).
  it('dinamik import ön yükleme listeleri (__vite__mapDeps) hiçbir giriş parçasını taşımaz; diğer bağımlılıklar kalır', () => {
    const entries = new Set(Object.values(manifest).filter((chunk) => chunk.isEntry).map((chunk) => chunk.file));
    expect([...entries].sort()).toEqual([manifest['admin.html'].file, manifest['index.html'].file].sort());
    // Önkoşul: tembel parçalar giriş parçasını gerçekten statik import eder; yoksa bu test boşuna geçer.
    const lazyImportingEntry = Object.entries(manifest).filter(([, chunk]) => chunk.isDynamicEntry && (chunk.imports ?? []).some((key) => manifest[key]?.isEntry));
    expect(lazyImportingEntry.map(([key]) => key), 'giriş parçasını statik import eden tembel parça').toContain('src/admin/pages/AlimlarPage.tsx');
    const scripts = walk(outDir).filter((file) => /^assets\/[^/]+\.js$/.test(file));
    const lists = scripts.map((file) => ({ file, deps: preloadDeps(readFileSync(join(outDir, file), 'utf8')) }));
    expect(lists.flatMap(({ file, deps }) => deps.filter((dep) => entries.has(dep)).map((dep) => `${file} -> ${dep}`)), 'ön yükleme listesindeki giriş parçaları').toEqual([]);
    const alimlar = lists.find(({ file }) => file === manifest['src/admin/pages/AlimlarPage.tsx'].file);
    expect(alimlar?.deps.length ?? 0, 'AlimlarPage tembel wide importu için ön yükleme listesi taşır').toBeGreaterThan(0);
  });
});

// Geniş-özel modüller: geçici bir mini projede (iki giriş: index + admin) gerçek vite.config.ts ile derlenir. src/ altında
// *.wide.tsx, *.wide.css ve wide/ klasörü; ortak yardımcı (format.ts) telefon girişiyle paylaşılır; tokens ve klavye
// kipi (shared) projeden alias ile gelir. Fixture çıplak paket import etmez (geçici klasörde node_modules yok).
// Parça adı birime göredir (wideChunkName): Panel.wide.{tsx,css} → wide-panel, wide/Board.ts → wide-board.
describe('wide grubu: geniş-özel modüller birim parçalarında, telefon statik grafiğine ve shared/tokens gruplarına sızmaz', () => {
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

  const wideChunks = (variant: 'lazy' | 'static') => Object.values(builds[variant].manifest).filter((chunk) => /^wide-/.test(chunk.name ?? ''));
  const wideChunk = (variant: 'lazy' | 'static', name: string) => Object.values(builds[variant].manifest).filter((chunk) => chunk.name === name);

  it('*.wide.tsx ve *.wide.css birim parçasında (wide-panel ve onun CSS dosyası), wide/ klasörü kendi biriminde (wide-board)', () => {
    const panel = wideChunk('lazy', 'wide-panel');
    const board = wideChunk('lazy', 'wide-board');
    expect(panel.map((chunk) => chunk.file)).toEqual([expect.stringMatching(/^assets\/wide-panel-[^/]+\.js$/)]);
    expect(board.map((chunk) => chunk.file)).toEqual([expect.stringMatching(/^assets\/wide-board-[^/]+\.js$/)]);
    expect(wideChunks('lazy')).toHaveLength(2);
    expect(builds.lazy.js[panel[0].file]).toContain(MARKERS.panel);
    expect(builds.lazy.js[board[0].file]).toContain(MARKERS.board);
    const css = (panel[0].css ?? []).map((file) => readFileSync(join(builds.lazy.outDir, file), 'utf8')).join('\n');
    expect(css).toContain(MARKERS.css);
  });

  it('wide işaretleri başka hiçbir parçada (giriş, shared, tokens) yok; telefonla ortak yardımcı wide parçasına girmez', () => {
    const wideFiles = new Set(wideChunks('lazy').map((chunk) => chunk.file));
    const leaks = Object.entries(builds.lazy.js).filter(([file, code]) => !wideFiles.has(file) && (code.includes(MARKERS.panel) || code.includes(MARKERS.board))).map(([file]) => file);
    expect(leaks).toEqual([]);
    for (const file of wideFiles) expect(builds.lazy.js[file], file).not.toContain(MARKERS.format);
    const grouped = (name: string) => Object.values(builds.lazy.manifest).filter((chunk) => chunk.name === name).map((chunk) => chunk.file);
    expect(grouped('shared')).toHaveLength(1);
    expect(grouped('tokens')).toHaveLength(1);
    const otherCss = Object.values(builds.lazy.manifest).filter((chunk) => !/^wide-/.test(chunk.name ?? '')).flatMap((chunk) => chunk.css ?? []);
    for (const file of otherCss) expect(readFileSync(join(builds.lazy.outDir, file), 'utf8'), file).not.toContain(MARKERS.css);
  });

  it('tembel wide: telefon statik kapanışında değil, ön bellekte değil; check-delivery --strict PASS', async () => {
    const wideFile = wideChunk('lazy', 'wide-panel')[0].file;
    const sw = parsePrecache(readFileSync(join(builds.lazy.outDir, 'sw.js'), 'utf8'));
    expect(sw.filter((url) => /(?:^|\/)wide-/.test(url))).toEqual([]);
    const result = await checkDelivery(builds.lazy.outDir, ['--strict']);
    expect(result.code, result.output).toBe(0);
    const report = JSON.parse(readFileSync(join(builds.lazy.outDir, 'delivery-report.json'), 'utf8'));
    expect(report.phone.static.chunks.map((chunk: { file: string }) => chunk.file)).not.toContain(wideFile);
    expect(report.lazy.some((entry: { added: { byClass: Record<string, unknown> } }) => 'wide' in entry.added.byClass)).toBe(true);
  }, 60_000);

  it('statik wide importu: check-delivery --strict FAIL ve içe aktaran modülü adıyla listeler', async () => {
    expect(wideChunk('static', 'wide-panel')).toHaveLength(1);
    const result = await checkDelivery(builds.static.outDir, ['--strict']);
    expect(result.code, result.output).toBe(1);
    expect(result.output).toContain('wide <- src/admin.ts');
  }, 60_000);
});
