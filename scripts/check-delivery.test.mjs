// Uyarlamalı teslim kapısı (scripts/check-delivery.mjs): sahte Vite manifesti + delivery-graph ile.
// Kural: telefon profili = admin.html statik kapanışı + her rota sayfası dinamik girişinin (src/admin/pages/*Page.tsx)
// statik kapanışı; bu kümede antd, pro, icons, echarts, wide sınıfı yoktur. lazyWide/wideResource hedefleri ve
// Chart.runtime gibi diğer tembel (dinamik) parçalarda olabilirler. Sınıf parça adından değil, delivery-graph modül
// üyeliğinden gelir.
// Hem `node --test scripts/check-delivery.test.mjs` hem Vitest (vitest.config.ts `scripts/**/*.test.mjs`) koşar.
// Gerçek veri yok: yalnız sentetik dosya adları ve içerikler.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { gzipSync } from 'node:zlib';
import {
  FORBIDDEN_PHONE_CLASSES, GZIP_LEVEL, analyzeDelivery, compareBaseline, dynamicRoots, formatSummary, measureBuffer, staticClosure,
} from './check-delivery.mjs';

const { describe, it, before, after } = process.env.VITEST
  ? await import('vitest').then((vitest) => ({ ...vitest, before: vitest.beforeAll, after: vitest.afterAll }))
  : await import('node:test');

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(root, 'scripts', 'check-delivery.mjs');

// #region sahte derleme
/** Temiz telefon profili: admin girişi yalnız shared/tokens/ortak kabuğu statik çeker; rota sayfaları da yalnız ortak
 *  parçaları statik çeker. antd (WideProviders adası), wide (lazyWide hedefi, sayfasını statik geri çeker) ve echarts
 *  (Chart.runtime) tembeldir. `_antd-x1.js` adı tuzaktır: ui/antd.ts'ten adını alan otomatik parça, içinde antd paketi
 *  yok (sınıfı app). */
function cleanBuild() {
  const manifest = {
    'admin.html': { file: 'assets/admin-a1.js', name: 'admin', src: 'admin.html', isEntry: true, imports: ['_shared-s1.js', '_tokens-t1.js', '_PageHeader-p1.js', '_antd-x1.js'], dynamicImports: ['src/admin/pages/GenelPage.tsx', 'src/admin/pages/RaporlarPage.tsx'], css: ['assets/admin-a1.css'] },
    '_shared-s1.js': { file: 'assets/shared-s1.js', name: 'shared' },
    '_tokens-t1.js': { file: 'assets/tokens-t1.js', name: 'tokens' },
    '_antd-x1.js': { file: 'assets/antd-x1.js', name: 'antd', imports: ['_shared-s1.js'] },
    '_PageHeader-p1.js': { file: 'assets/PageHeader-p1.js', name: 'PageHeader', imports: ['_shared-s1.js'], dynamicImports: ['_core-e1.js'], css: ['assets/PageHeader-p1.css'] },
    'src/admin/pages/GenelPage.tsx': { file: 'assets/GenelPage-g2.js', name: 'GenelPage', src: 'src/admin/pages/GenelPage.tsx', isDynamicEntry: true, imports: ['_shared-s1.js', 'admin.html'], dynamicImports: ['src/admin/adaptive/WideProviders.tsx'] },
    'src/admin/pages/RaporlarPage.tsx': { file: 'assets/RaporlarPage-r2.js', name: 'RaporlarPage', src: 'src/admin/pages/RaporlarPage.tsx', isDynamicEntry: true, imports: ['_shared-s1.js', 'admin.html'], dynamicImports: ['_wide-w1.js', 'src/admin/ui/Chart.runtime.ts'] },
    // antd adası: yalnız tembel sağlayıcı antd'yi statik çeker (lazyWide(…, { antd: true }) yolu).
    'src/admin/adaptive/WideProviders.tsx': { file: 'assets/WideProviders-v1.js', name: 'WideProviders', src: 'src/admin/adaptive/WideProviders.tsx', isDynamicEntry: true, imports: ['_shared-s1.js', '_antd-n1.js'] },
    // Chart'ın tembel ECharts çalışma zamanı: sayfadan yalnız dinamik import.
    'src/admin/ui/Chart.runtime.ts': { file: 'assets/Chart.runtime-c1.js', name: 'Chart.runtime', src: 'src/admin/ui/Chart.runtime.ts', isDynamicEntry: true, imports: ['_core-e1.js'] },
    // antd ↔ ortak kabuk döngüsü gerçek derlemede de var; kapanış sonsuz döngüye girmemeli.
    '_antd-n1.js': { file: 'assets/antd-n1.js', name: 'antd', imports: ['_shared-s1.js', '_icons-i1.js', '_PageHeader-p1.js'] },
    '_icons-i1.js': { file: 'assets/icons-i1.js', name: 'icons', imports: ['_shared-s1.js'] },
    // lazyWide hedefi kendi sayfasını statik geri çeker (gerçek derlemede de var); kapı tembel parçanın içine inmez.
    '_wide-w1.js': { file: 'assets/wide-w1.js', name: 'wide-raporlar', imports: ['_shared-s1.js', 'src/admin/pages/RaporlarPage.tsx'] },
    '_core-e1.js': { file: 'assets/core-e1.js', name: 'core', imports: ['_graphic-g1.js'] },
    '_graphic-g1.js': { file: 'assets/graphic-g1.js', name: 'graphic' },
  };
  const chunks = {
    'assets/admin-a1.js': { modules: 5, groups: {}, packages: { '.': 5 } },
    'assets/shared-s1.js': { modules: 4, groups: { shared: 4 }, packages: { react: 2, 'react-dom': 1, '.': 1 } },
    'assets/tokens-t1.js': { modules: 2, groups: { tokens: 2 }, packages: { '.': 2 } },
    'assets/antd-x1.js': { modules: 1, groups: {}, packages: { '.': 1 } },
    'assets/PageHeader-p1.js': { modules: 10, groups: {}, packages: { '.': 10 } },
    'assets/GenelPage-g2.js': { modules: 1, groups: {}, packages: { '.': 1 } },
    'assets/RaporlarPage-r2.js': { modules: 1, groups: {}, packages: { '.': 1 } },
    'assets/WideProviders-v1.js': { modules: 1, groups: {}, packages: { '.': 1 } },
    'assets/Chart.runtime-c1.js': { modules: 1, groups: {}, packages: { '.': 1 } },
    'assets/antd-n1.js': { modules: 50, groups: { antd: 50 }, packages: { antd: 40, '@rc-component/table': 10 } },
    'assets/icons-i1.js': { modules: 5, groups: { icons: 5 }, packages: { '@ant-design/icons': 5 } },
    'assets/wide-w1.js': { modules: 2, groups: { wide: 2 }, packages: { '.': 2 } },
    'assets/core-e1.js': { modules: 3, groups: {}, packages: { echarts: 3 } },
    'assets/graphic-g1.js': { modules: 15, groups: {}, packages: { zrender: 10, echarts: 5 } },
  };
  const edges = [
    { fromChunk: 'assets/WideProviders-v1.js', from: 'src/admin/adaptive/WideProviders.tsx', fromGroup: null, toChunk: 'assets/antd-n1.js', to: 'antd', toGroup: 'antd' },
    { fromChunk: 'assets/antd-n1.js', from: 'antd', fromGroup: 'antd', toChunk: 'assets/icons-i1.js', to: '@ant-design/icons', toGroup: 'icons' },
    { fromChunk: 'assets/wide-w1.js', from: 'src/admin/pages/raporlar/Tablo.wide.tsx', fromGroup: 'wide', toChunk: 'assets/RaporlarPage-r2.js', to: 'src/admin/pages/raporlar/model.ts', toGroup: null },
    { fromChunk: 'assets/core-e1.js', from: 'echarts', fromGroup: null, toChunk: 'assets/graphic-g1.js', to: 'zrender', toGroup: null },
    { fromChunk: 'assets/admin-a1.js', from: 'src/admin/App.tsx', fromGroup: null, toChunk: 'assets/shared-s1.js', to: 'react', toGroup: 'shared' },
  ];
  return { manifest, graph: { schema: 1, groups: ['wide', 'tokens', 'pro', 'icons', 'antd', 'router', 'shared'], chunks, edges } };
}

/** Kesim öncesi gerçek ihlalin eşleniği: ui/antd.ts barrel'ı admin girişinde antd'yi statik çeker; antd de icons'u. */
function antdLeakBuild() {
  const build = cleanBuild();
  build.manifest['admin.html'].imports.push('_antd-n1.js');
  build.graph.edges.push({ fromChunk: 'assets/admin-a1.js', from: 'src/admin/ui/antd.ts', fromGroup: null, toChunk: 'assets/antd-n1.js', to: 'antd', toGroup: 'antd' });
  return build;
}

/** Rota sayfasından sızıntı (inceleme bulgusu): giriş kapanışı temiz, ama telefonun her rotada indirdiği sayfa parçaları
 *  antd'yi (GenelPage), geniş-özel modülü ve gömülü ECharts'ı (RaporlarPage) statik çeker. */
function pageLeakBuild() {
  const build = cleanBuild();
  build.manifest['src/admin/pages/GenelPage.tsx'].imports.push('_antd-n1.js');
  build.graph.edges.push({ fromChunk: 'assets/GenelPage-g2.js', from: 'src/admin/pages/OdemelerPage.tsx', fromGroup: null, toChunk: 'assets/antd-n1.js', to: 'antd', toGroup: 'antd' });
  build.manifest['src/admin/pages/RaporlarPage.tsx'].imports.push('_wide-w1.js');
  build.graph.edges.push({ fromChunk: 'assets/RaporlarPage-r2.js', from: 'src/admin/pages/RaporlarPage.tsx', fromGroup: null, toChunk: 'assets/wide-w1.js', to: 'src/admin/ui/Table.wide.tsx', toGroup: 'wide' });
  build.graph.chunks['assets/RaporlarPage-r2.js'] = { modules: 4, groups: {}, packages: { '.': 2, echarts: 2 } };
  build.graph.edges.push({ fromChunk: 'assets/RaporlarPage-r2.js', from: 'src/admin/ui/Chart.tsx', fromGroup: null, toChunk: 'assets/RaporlarPage-r2.js', to: 'echarts', toGroup: null });
  return build;
}

const fixedSize = () => ({ raw: 1000, gzip: 400 });
const ids = (report) => report.violations.map((violation) => violation.id);
// #endregion

describe('check-delivery: manifest grafiği', () => {
  it('statik kapanış yalnız imports zincirini izler, döngüde durur, dinamik importlara inmez', () => {
    const { manifest } = antdLeakBuild();
    const closure = staticClosure(manifest, 'admin.html');
    assert.deepEqual([...closure].sort(), ['_PageHeader-p1.js', '_antd-n1.js', '_antd-x1.js', '_icons-i1.js', '_shared-s1.js', '_tokens-t1.js', 'admin.html']);
    assert.ok(!closure.includes('src/admin/pages/GenelPage.tsx'));
    assert.ok(!closure.includes('_core-e1.js'));
  });

  it('dinamik kökler statik kapanışın dynamicImports listesinden gelir (sayfalar + tembel ECharts)', () => {
    const { manifest } = cleanBuild();
    const roots = dynamicRoots(manifest, staticClosure(manifest, 'admin.html'));
    assert.deepEqual([...roots].sort(), ['_core-e1.js', 'src/admin/pages/GenelPage.tsx', 'src/admin/pages/RaporlarPage.tsx']);
  });

  it('bilinmeyen giriş anahtarı açık hata verir', () => {
    const { manifest } = cleanBuild();
    assert.throws(() => staticClosure(manifest, 'yok.html'), /yok\.html/);
  });
});

describe('check-delivery: sınıflandırma ve ihlal', () => {
  it('temiz telefon kapanışı: ihlal yok; ad tuzağı (antd-x1, app) yanlış alarm vermez', () => {
    const report = analyzeDelivery({ ...cleanBuild(), sizeOf: fixedSize });
    assert.deepEqual(report.violations, []);
    const trap = report.phone.static.chunks.find((chunk) => chunk.file === 'assets/antd-x1.js');
    assert.equal(trap.class, 'app');
    assert.deepEqual(trap.contains, []);
    // Tembel kökler: sayfa parçaları page, ECharts parçası adıyla değil paket üyeliğiyle echarts.
    const lazy = Object.fromEntries(report.lazy.map((entry) => [entry.root, entry]));
    assert.equal(lazy['src/admin/pages/GenelPage.tsx'].class, 'page');
    assert.deepEqual(Object.keys(lazy['src/admin/pages/GenelPage.tsx'].added.byClass), ['page']);
    assert.equal(lazy['chunk:core'].class, 'echarts');
    assert.ok(lazy['chunk:core'].added.byClass.echarts, 'graphic-g1 (zrender) echarts sayılmalı');
    // antd adası, lazyWide hedefi ve Chart.runtime sayfadan tembel kökler olarak kalır (telefon kümesine girmez).
    assert.deepEqual(Object.keys(lazy['src/admin/adaptive/WideProviders.tsx'].added.byClass).sort(), ['antd', 'icons', 'lazy']);
    assert.equal(lazy['src/admin/adaptive/WideProviders.tsx'].importer, 'src/admin/pages/GenelPage.tsx');
    assert.equal(lazy['chunk:wide-raporlar'].class, 'wide');
    assert.equal(lazy['chunk:wide-raporlar'].importer, 'src/admin/pages/RaporlarPage.tsx');
    assert.equal(lazy['src/admin/ui/Chart.runtime.ts'].importer, 'src/admin/pages/RaporlarPage.tsx');
    // Telefon profili: giriş kapanışı + rota sayfalarının kapanışı; sayfa başına yalnız eklediği parçalar.
    const routes = Object.fromEntries(report.phone.routes.map((entry) => [entry.root, entry]));
    assert.deepEqual(Object.keys(routes).sort(), ['src/admin/pages/GenelPage.tsx', 'src/admin/pages/RaporlarPage.tsx']);
    assert.deepEqual(routes['src/admin/pages/RaporlarPage.tsx'].added.chunks, ['src/admin/pages/RaporlarPage.tsx']);
    assert.deepEqual(Object.keys(routes['src/admin/pages/GenelPage.tsx'].added.byClass), ['page']);
  });

  it('antd sızıntısı: içe aktaran modül ve zincir listelenir', () => {
    const report = analyzeDelivery({ ...antdLeakBuild(), sizeOf: fixedSize });
    assert.deepEqual(ids(report), ['antd <- src/admin/ui/antd.ts', 'icons <- antd']);
    const antd = report.violations[0];
    assert.equal(antd.class, 'antd');
    assert.equal(antd.importer, 'src/admin/ui/antd.ts');
    assert.equal(antd.attributed, true);
    assert.deepEqual(antd.via, ['admin.html']);
    assert.deepEqual(report.violations[1].via, ['admin.html', 'chunk:antd']);
  });

  // İnceleme bulgusu (major): kapı yalnız admin.html statik kapanışına bakıyordu; telefon her rotada sayfa parçasını
  // indirdiği için sayfanın statik antd/wide/echarts importu telefonun indirdiği koddur ve ihlaldir.
  it('rota sayfasının statik kapanışı telefon profilidir: sayfadan statik antd, wide ve gömülü ECharts ihlaldir (yol: admin.html > sayfa)', () => {
    const report = analyzeDelivery({ ...pageLeakBuild(), sizeOf: fixedSize });
    assert.deepEqual(ids(report), ['antd <- src/admin/pages/OdemelerPage.tsx', 'echarts <- src/admin/ui/Chart.tsx', 'icons <- antd', 'wide <- src/admin/pages/RaporlarPage.tsx']);
    const byId = Object.fromEntries(report.violations.map((violation) => [violation.id, violation]));
    assert.deepEqual(byId['antd <- src/admin/pages/OdemelerPage.tsx'].via, ['admin.html', 'src/admin/pages/GenelPage.tsx']);
    assert.deepEqual(byId['antd <- src/admin/pages/OdemelerPage.tsx'].importerChunks, ['src/admin/pages/GenelPage.tsx']);
    assert.deepEqual(byId['icons <- antd'].via, ['admin.html', 'src/admin/pages/GenelPage.tsx', 'chunk:antd']);
    assert.deepEqual(byId['wide <- src/admin/pages/RaporlarPage.tsx'].via, ['admin.html', 'src/admin/pages/RaporlarPage.tsx']);
    assert.deepEqual(byId['echarts <- src/admin/ui/Chart.tsx'].via, ['admin.html', 'src/admin/pages/RaporlarPage.tsx']);
    // Sayfa kapanışındaki yasak parçalar telefon profilinin parçası olarak raporlanır.
    const routes = Object.fromEntries(report.phone.routes.map((entry) => [entry.root, entry]));
    assert.ok(routes['src/admin/pages/GenelPage.tsx'].added.byClass.antd, 'GenelPage rotası antd parçasını ekler');
    assert.ok(routes['src/admin/pages/RaporlarPage.tsx'].added.byClass.wide, 'RaporlarPage rotası wide parçasını ekler');
  });

  it('yalnız rota sayfaları (src/admin/pages/*Page.tsx) eklenir: girişten tembel antd adası ya da geniş gezinme telefon kümesine girmez', () => {
    const build = cleanBuild();
    build.manifest['admin.html'].dynamicImports.push('src/admin/adaptive/WideProviders.tsx', '_wide-n1.js');
    build.manifest['_wide-n1.js'] = { file: 'assets/wide-n1.js', name: 'wide-shell', imports: ['_shared-s1.js', '_antd-n1.js'] };
    build.graph.chunks['assets/wide-n1.js'] = { modules: 3, groups: { wide: 3 }, packages: { '.': 3 } };
    const report = analyzeDelivery({ ...build, sizeOf: fixedSize });
    assert.deepEqual(report.violations, []);
    assert.deepEqual(report.phone.routes.map((entry) => entry.root).sort(), ['src/admin/pages/GenelPage.tsx', 'src/admin/pages/RaporlarPage.tsx']);
  });

  it('girişe gömülü ECharts (parça içi kenar) ve statik wide importu yakalanır', () => {
    const build = cleanBuild();
    build.graph.chunks['assets/admin-a1.js'].packages.echarts = 3;
    build.graph.edges.push({ fromChunk: 'assets/admin-a1.js', from: 'src/admin/ui/Chart.tsx', fromGroup: null, toChunk: 'assets/admin-a1.js', to: 'echarts', toGroup: null });
    build.manifest['admin.html'].imports.push('_wide-w1.js');
    build.graph.edges.push({ fromChunk: 'assets/admin-a1.js', from: 'src/admin/ui/Table.tsx', fromGroup: null, toChunk: 'assets/wide-w1.js', to: 'src/admin/ui/Table.wide.tsx', toGroup: 'wide' });
    const report = analyzeDelivery({ ...build, sizeOf: fixedSize });
    assert.deepEqual(ids(report), ['echarts <- src/admin/ui/Chart.tsx', 'wide <- src/admin/ui/Table.tsx']);
  });

  it('kenarla açıklanamayan yasak parça yine ihlaldir (attributed: false, içe aktaran parça etiketiyle)', () => {
    const build = cleanBuild();
    build.manifest['admin.html'].imports.push('_antd-n1.js');
    const report = analyzeDelivery({ ...build, sizeOf: fixedSize });
    const antd = report.violations.find((violation) => violation.class === 'antd');
    assert.equal(antd.id, 'antd <- ?admin.html');
    assert.equal(antd.attributed, false);
  });

  it('pro grubu da yasaktır; yasak sınıf listesi sabittir', () => {
    assert.deepEqual([...FORBIDDEN_PHONE_CLASSES], ['antd', 'pro', 'icons', 'echarts', 'wide']);
    const build = cleanBuild();
    build.manifest['_pro-q1.js'] = { file: 'assets/pro-q1.js', name: 'pro' };
    build.manifest['admin.html'].imports.push('_pro-q1.js');
    build.graph.chunks['assets/pro-q1.js'] = { modules: 3, groups: { pro: 3 }, packages: { '@ant-design/pro-layout': 3 } };
    build.graph.edges.push({ fromChunk: 'assets/admin-a1.js', from: 'src/admin/ui/antd.ts', fromGroup: null, toChunk: 'assets/pro-q1.js', to: '@ant-design/pro-layout', toGroup: 'pro' });
    assert.deepEqual(ids(analyzeDelivery({ ...build, sizeOf: fixedSize })), ['pro <- src/admin/ui/antd.ts']);
  });

  it('manifest parçası graph içinde yoksa açık hata verir (eski/eksik delivery-graph)', () => {
    const build = cleanBuild();
    delete build.graph.chunks['assets/tokens-t1.js'];
    assert.throws(() => analyzeDelivery({ ...build, sizeOf: fixedSize }), /tokens-t1\.js/);
  });
});

describe('check-delivery: ölçüm', () => {
  it('gzip zlib seviye 9, ham bayt; özetler parça başına toplanır', () => {
    const buffer = Buffer.from('aile '.repeat(500));
    assert.equal(GZIP_LEVEL, 9);
    assert.deepEqual(measureBuffer(buffer), { raw: buffer.length, gzip: gzipSync(buffer, { level: 9 }).length });
    const report = analyzeDelivery({ ...cleanBuild(), sizeOf: fixedSize });
    // admin (js+css) + shared + tokens + antd-x1 + PageHeader (js+css) = 7 dosya.
    assert.equal(report.phone.static.files, 7);
    assert.equal(report.phone.static.raw, 7000);
    assert.equal(report.phone.static.gzip, 2800);
    assert.deepEqual(report.phone.static.byClass.shared, { files: 1, raw: 1000, gzip: 400 });
    assert.deepEqual(report.groups.antd, { files: 1, raw: 1000, gzip: 400, list: ['assets/antd-n1.js'] });
    assert.equal(report.groups.echarts.files, 2);
    assert.deepEqual(report.groups.echarts.list, ['assets/core-e1.js', 'assets/graphic-g1.js']);
    assert.match(formatSummary({ ...report, mode: 'ratchet', status: 'pass', baseline: { added: [], known: [], resolved: [] }, warnings: [] }), /shared\s+1\s+1000\s+400/);
  });
});

describe('check-delivery: ratchet ve strict', () => {
  it('ratchet: aynı liste PASS; küçülen liste PASS + daraltma uyarısı; yeni ihlal FAIL', () => {
    assert.equal(compareBaseline(['a', 'b'], ['a', 'b'], { strict: false }).status, 'pass');
    const shrunk = compareBaseline(['a'], ['a', 'b'], { strict: false });
    assert.equal(shrunk.status, 'pass');
    assert.deepEqual(shrunk.resolved, ['b']);
    assert.match(shrunk.warnings.join('\n'), /baseline daraltılabilir/);
    const grown = compareBaseline(['a', 'c'], ['a'], { strict: false });
    assert.equal(grown.status, 'fail');
    assert.deepEqual(grown.added, ['c']);
  });

  it('strict: tek ihlal FAIL, ihlalsiz PASS (baseline yok sayılır)', () => {
    assert.equal(compareBaseline(['a'], ['a'], { strict: true }).status, 'fail');
    assert.equal(compareBaseline([], ['a'], { strict: true }).status, 'pass');
  });
});

describe('check-delivery: CLI', () => {
  let scratch;
  before(async () => { scratch = await mkdtemp(path.join(tmpdir(), 'aile-check-delivery-')); });
  after(async () => { await rm(scratch, { recursive: true, force: true }); });

  async function writeDist(name, build) {
    const dist = path.join(scratch, name);
    await mkdir(path.join(dist, '.vite'), { recursive: true });
    await mkdir(path.join(dist, 'assets'), { recursive: true });
    await writeFile(path.join(dist, '.vite', 'manifest.json'), JSON.stringify(build.manifest));
    if (build.graph) await writeFile(path.join(dist, '.vite', 'delivery-graph.json'), JSON.stringify(build.graph));
    const files = new Set(Object.values(build.manifest).flatMap((chunk) => [chunk.file, ...(chunk.css ?? [])]));
    for (const file of files) await writeFile(path.join(dist, file), `/* ${file} */ export const x = ${JSON.stringify('x'.repeat(200))};`);
    return dist;
  }
  async function cli(args) {
    try {
      const { stdout, stderr } = await run(process.execPath, [script, ...args], { cwd: root });
      return { code: 0, stdout, stderr };
    } catch (error) {
      return { code: error.code, stdout: error.stdout, stderr: error.stderr };
    }
  }

  it('ratchet modu bilinen ihlalle PASS, raporu dist/delivery-report.json olarak yazar', async () => {
    const dist = await writeDist('leak', antdLeakBuild());
    const baseline = path.join(scratch, 'baseline.json');
    await writeFile(baseline, JSON.stringify({ schema: 1, entry: 'admin.html', profile: 'phone', violations: ['antd <- src/admin/ui/antd.ts', 'icons <- antd'] }));
    const result = await cli([dist, '--baseline', baseline]);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /PASS/);
    const text = await readFile(path.join(dist, 'delivery-report.json'), 'utf8');
    // Rapor dist ile yayınlanır: yerel mutlak yol (kullanıcı klasörü, geçici klasör) taşımaz.
    assert.ok(!text.includes(root), 'rapor depo kökünün mutlak yolunu içermemeli');
    assert.ok(!text.includes(scratch), 'rapor geçici klasörün mutlak yolunu içermemeli');
    const report = JSON.parse(text);
    assert.equal(report.baseline.path, 'baseline.json');
    assert.equal(report.schema, 1);
    assert.equal(report.entry, 'admin.html');
    assert.equal(report.profile, 'phone');
    assert.equal(report.mode, 'ratchet');
    assert.equal(report.status, 'pass');
    assert.deepEqual(report.baseline.known, ['antd <- src/admin/ui/antd.ts', 'icons <- antd']);
    assert.equal(report.measurement.gzipLevel, 9);
    for (const key of ['phone', 'lazy', 'groups', 'violations', 'warnings']) assert.ok(key in report, key);
    assert.ok(report.phone.static.gzip > 0);
  });

  it('--strict ihlali listeleyerek FAIL (çıkış 1)', async () => {
    const dist = await writeDist('leak-strict', antdLeakBuild());
    const result = await cli([dist, '--strict']);
    assert.equal(result.code, 1);
    assert.match(result.stdout + result.stderr, /antd <- src\/admin\/ui\/antd\.ts/);
    const report = JSON.parse(await readFile(path.join(dist, 'delivery-report.json'), 'utf8'));
    assert.equal(report.mode, 'strict');
    assert.equal(report.status, 'fail');
  });

  it('ratchet modunda baseline dışı yeni ihlal FAIL', async () => {
    const dist = await writeDist('new-leak', antdLeakBuild());
    const baseline = path.join(scratch, 'baseline-empty.json');
    await writeFile(baseline, JSON.stringify({ schema: 1, entry: 'admin.html', profile: 'phone', violations: [] }));
    const result = await cli([dist, '--baseline', baseline]);
    assert.equal(result.code, 1);
    assert.match(result.stdout + result.stderr, /yeni ihlal/i);
  });

  it('--strict sayfa kapanışındaki ihlali yol ile yazar ve FAIL (çıkış 1)', async () => {
    const dist = await writeDist('page-leak-strict', pageLeakBuild());
    const result = await cli([dist, '--strict']);
    assert.equal(result.code, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /wide <- src\/admin\/pages\/RaporlarPage\.tsx .*yol: admin\.html > src\/admin\/pages\/RaporlarPage\.tsx/);
    assert.match(result.stdout, /rota sayfaları: 2/);
  });

  it('temiz derleme strict modda da PASS', async () => {
    const dist = await writeDist('clean', cleanBuild());
    const result = await cli([dist, '--strict']);
    assert.equal(result.code, 0, result.stdout + result.stderr);
  });

  it('başka girişin baseline’ı: strict yalnız bilgi için okur ve yok sayar; ratchet çıkış 2', async () => {
    const dist = await writeDist('other-entry', cleanBuild());
    const baseline = path.join(scratch, 'baseline-index.json');
    await writeFile(baseline, JSON.stringify({ schema: 1, entry: 'index.html', profile: 'phone', violations: [] }));
    const strict = await cli([dist, '--strict', '--baseline', baseline]);
    assert.equal(strict.code, 0, strict.stdout + strict.stderr);
    const report = JSON.parse(await readFile(path.join(dist, 'delivery-report.json'), 'utf8'));
    assert.equal(report.baseline.path, null);
    const ratchet = await cli([dist, '--baseline', baseline]);
    assert.equal(ratchet.code, 2);
    assert.match(ratchet.stderr, /baseline girişi index\.html/);
  });

  it('delivery-graph yoksa çıkış 2 ve yönlendirici mesaj', async () => {
    const { manifest } = cleanBuild();
    const dist = await writeDist('no-graph', { manifest });
    const result = await cli([dist]);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /delivery-graph\.json/);
  });
});
