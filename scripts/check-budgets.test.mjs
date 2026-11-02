// Profil bazlı aktarım bütçesi (scripts/check-budgets.mjs): sahte Vite manifesti + delivery-graph + delivery-report ile.
// Telefon ilk rota = admin.html + statik kapanış + ilk sayfanın (varsayılan rota) statik kapanışı + CSS + ilk ekran
// fontları. Geniş ilk rota = telefon ilk rotası + geniş başlangıç kökleri (WideProviders, wide sınıfı). Ölçüm: ham bayt
// ve node:zlib gzip seviye 9; KB = 1000 bayt. Varsayılan mod ratchet (kayıtlı tavan), --strict yalnız bütçe.
// Hem `node --test scripts/check-budgets.test.mjs` hem Vitest (vitest.config.ts `scripts/**/*.test.mjs`) koşar.
// Gerçek veri yok: yalnız sentetik dosya adları ve içerikler; ağ çağrısı yok.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { analyzeDelivery, measureBuffer } from './check-delivery.mjs';
import {
  KB, BUDGET_METRICS, composeReport, detectBase, evaluateBudgets, fontUrlsFromCss, formatSummary, measureRoutes, preloadFontHrefs, validateBudgets,
} from './check-budgets.mjs';

const { describe, it, before, after } = process.env.VITEST
  ? await import('vitest').then((vitest) => ({ ...vitest, before: vitest.beforeAll, after: vitest.afterAll }))
  : await import('node:test');

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(root, 'scripts', 'check-budgets.mjs');

// #region sahte derleme
/** admin.html statik olarak shared/tokens/ortak kabuğu çeker; ilk sayfa (Alımlar) views'i statik çeker. Geniş başlangıç:
 *  WideProviders (antd + icons) ve wide parçası (Table.wide). ECharts ve diğer sayfalar ilk rotada yok. */
function fakeBuild() {
  const manifest = {
    'admin.html': { file: 'assets/admin-a1.js', name: 'admin', src: 'admin.html', isEntry: true, imports: ['_shared-s1.js', '_tokens-t1.js', '_PageHeader-p1.js'], dynamicImports: ['src/admin/pages/AlimlarPage.tsx', 'src/admin/pages/GenelPage.tsx', 'src/admin/adaptive/WideProviders.tsx'], css: ['assets/admin-a1.css'] },
    '_shared-s1.js': { file: 'assets/shared-s1.js', name: 'shared' },
    '_tokens-t1.js': { file: 'assets/tokens-t1.js', name: 'tokens' },
    '_PageHeader-p1.js': { file: 'assets/PageHeader-p1.js', name: 'PageHeader', imports: ['_shared-s1.js'], dynamicImports: ['src/admin/ui/wide/Table.wide.tsx', '_core-e1.js'], css: ['assets/PageHeader-p1.css'] },
    'src/admin/pages/AlimlarPage.tsx': { file: 'assets/AlimlarPage-l2.js', name: 'AlimlarPage', src: 'src/admin/pages/AlimlarPage.tsx', isDynamicEntry: true, imports: ['_shared-s1.js', '_PageHeader-p1.js', '_views-v1.js', 'admin.html'], css: ['assets/AlimlarPage-l2.css'] },
    '_views-v1.js': { file: 'assets/views-v1.js', name: 'views' },
    'src/admin/pages/GenelPage.tsx': { file: 'assets/GenelPage-g2.js', name: 'GenelPage', src: 'src/admin/pages/GenelPage.tsx', isDynamicEntry: true, imports: ['_shared-s1.js', 'admin.html'], dynamicImports: ['_core-e1.js'] },
    'src/admin/adaptive/WideProviders.tsx': { file: 'assets/WideProviders-q2.js', name: 'WideProviders', src: 'src/admin/adaptive/WideProviders.tsx', isDynamicEntry: true, imports: ['_shared-s1.js', '_antd-n1.js'] },
    '_antd-n1.js': { file: 'assets/antd-n1.js', name: 'antd', imports: ['_shared-s1.js', '_icons-i1.js'] },
    '_icons-i1.js': { file: 'assets/icons-i1.js', name: 'icons', imports: ['_shared-s1.js'] },
    'src/admin/ui/wide/Table.wide.tsx': { file: 'assets/wide-w1.js', name: 'wide', src: 'src/admin/ui/wide/Table.wide.tsx', isDynamicEntry: true, imports: ['_shared-s1.js', '_antd-n1.js'], css: ['assets/wide-w1.css'] },
    '_core-e1.js': { file: 'assets/core-e1.js', name: 'core' },
  };
  const chunks = {
    'assets/admin-a1.js': { modules: 5, groups: {}, packages: { '.': 5 } },
    'assets/shared-s1.js': { modules: 4, groups: { shared: 4 }, packages: { react: 4 } },
    'assets/tokens-t1.js': { modules: 2, groups: { tokens: 2 }, packages: { '.': 2 } },
    'assets/PageHeader-p1.js': { modules: 10, groups: {}, packages: { '.': 10 } },
    'assets/AlimlarPage-l2.js': { modules: 1, groups: {}, packages: { '.': 1 } },
    'assets/views-v1.js': { modules: 3, groups: {}, packages: { '.': 3 } },
    'assets/GenelPage-g2.js': { modules: 1, groups: {}, packages: { '.': 1 } },
    'assets/WideProviders-q2.js': { modules: 1, groups: {}, packages: { '.': 1 } },
    'assets/antd-n1.js': { modules: 50, groups: { antd: 50 }, packages: { antd: 50 } },
    'assets/icons-i1.js': { modules: 5, groups: { icons: 5 }, packages: { '@ant-design/icons': 5 } },
    'assets/wide-w1.js': { modules: 2, groups: { wide: 2 }, packages: { '.': 2 } },
    'assets/core-e1.js': { modules: 3, groups: {}, packages: { echarts: 3 } },
  };
  const css = {
    // İkinci @font-face'in src listesinde tarayıcı ilk desteklenen biçimi indirir: woff2 sayılır, ttf yedeği sayılmaz.
    // Arka plan görseli @font-face dışında: font sayılmaz.
    'assets/admin-a1.css': '@font-face{font-family:Outfit;src:url(/aile/fonts/outfit-regular.ttf)format("truetype");font-weight:400 500}'
      + '@font-face{font-family:Outfit;src:url("/aile/fonts/outfit-bold.woff2") format("woff2"),url(/aile/fonts/outfit-bold.ttf) format("truetype");font-weight:600 800}'
      + '.logo{background:url(/aile/icon.svg)}',
    // Aynı font ikinci kez tanımlanır (tekil sayılır); data: URL zaten CSS baytında, ayrı istek değildir.
    'assets/PageHeader-p1.css': "@font-face{font-family:Outfit;src:url('/aile/fonts/outfit-regular.ttf') format('truetype')}@font-face{font-family:Ikon;src:url(data:font/woff2;base64,AAAA)}",
    'assets/AlimlarPage-l2.css': '.alimlar{color:var(--aile-metin)}',
    // Göreli URL CSS dosyasının klasörüne göre çözülür (assets/../fonts). Yalnız geniş rotada.
    'assets/wide-w1.css': '@font-face{font-family:Mono;src:url(../fonts/mono.woff2) format("woff2")}',
  };
  const html = '<!doctype html><html lang="tr"><head><script type="module" crossorigin src="/aile/assets/admin-a1.js"></script>'
    + '<link rel="modulepreload" crossorigin href="/aile/assets/shared-s1.js">'
    + '<link rel="preload" as="font" type="font/woff2" href="/aile/fonts/outfit-medium.woff2" crossorigin>'
    + '<link rel="preload" href="/aile/fonts/outfit-regular.ttf" as="font" crossorigin></head><body><div id="admin-root"></div></body></html>';
  return { manifest, graph: { schema: 1, groups: ['wide', 'tokens', 'pro', 'icons', 'antd', 'router', 'shared'], chunks, edges: [] }, css, html };
}

/** Dosya türüne göre sabit boyut: hesap elle izlenebilir. */
function fixedSize(file) {
  if (file.endsWith('.html')) return { raw: 2000, gzip: 800 };
  if (file.endsWith('.css')) return { raw: 500, gzip: 200 };
  if (/\.(woff2?|ttf|otf)$/.test(file)) return { raw: 30000, gzip: 18000 };
  return { raw: 1000, gzip: 400 };
}

const deliveryFor = (build, sizeOf = fixedSize) => ({ ...analyzeDelivery({ manifest: build.manifest, graph: build.graph, sizeOf }), mode: 'ratchet', status: 'pass', baseline: { path: null, ids: [], added: [], known: [], resolved: [] }, warnings: [] });

function budgetsDoc(overrides = {}) {
  return {
    schema: 1,
    entry: 'admin.html',
    units: { kb: 1000, measure: 'gzip' },
    firstRoute: { path: '/alimlar', page: 'src/admin/pages/AlimlarPage.tsx' },
    wideStartup: { sources: ['src/admin/adaptive/WideProviders.tsx'], classes: ['wide'] },
    budgets: [
      { id: 'phone-html', profile: 'phone', metric: 'html', max: 50000 },
      { id: 'phone-js', profile: 'phone', metric: 'js', max: 2000 },
      { id: 'phone-css', profile: 'phone', metric: 'css', max: 35000 },
      { id: 'phone-transfer', profile: 'phone', metric: 'transfer', max: 500000 },
      { id: 'phone-capability', profile: 'phone', metric: 'capabilityRequests', max: 0 },
      { id: 'wide-js', profile: 'wide', metric: 'js', classes: { exclude: ['antd'] }, max: 180000 },
      { id: 'wide-antd', profile: 'wide', metric: 'js', classes: { only: ['antd'] }, max: 240000, exception: true },
    ],
    ratchet: { ceilings: { 'phone-js': 3000 } },
    ...overrides,
  };
}

function measureFake(build = fakeBuild(), budgets = budgetsDoc()) {
  return measureRoutes({ manifest: build.manifest, graph: build.graph, delivery: deliveryFor(build), html: build.html, readText: (file) => build.css[file] ?? '', sizeOf: fixedSize, budgets });
}

const filesOf = (route, kind) => route.files.filter((file) => file.kind === kind).map((file) => file.file).sort();
// #endregion

// #region kaynak metin çözümleyicileri (depo testi)
/** navigation.ts › defaultAdminPath: '/yol' sabiti ya da adminPages[N].path (adminPages içindeki page('anahtar', …) sırası). */
function defaultAdminPathOf(source) {
  const literal = /export const defaultAdminPath\s*=\s*'([^']+)'/.exec(source);
  if (literal) return literal[1];
  const indexed = /export const defaultAdminPath\s*=\s*adminPages\[(\d+)\]\.path\b/.exec(source);
  if (!indexed) return null;
  const list = /export const adminPages\b[^=]*=\s*\[([\s\S]*?)\n\];/.exec(source)?.[1] ?? '';
  const keys = [...list.matchAll(/\bpage\(\s*'([^']+)'/g)].map((match) => match[1]);
  const key = keys[Number(indexed[1])];
  return key ? `/${key}` : null;
}

/** routes.tsx: anahtarın sayfa modülü adı (`anahtar: page(() => import('./pages/X'))` ya da `anahtar: () => import('./pages/X')`). */
function routePageOf(source, key) {
  return new RegExp(`\\b${key}:\\s*(?:page\\(\\s*)?\\(\\)\\s*=>\\s*import\\('\\./pages/([A-Za-z]+)'\\)`).exec(source)?.[1] ?? null;
}
// #endregion

describe('check-budgets: font ve taban çözümleme', () => {
  it('@font-face src listesinin ilk url’i sayılır; data: ve @font-face dışı url sayılmaz', () => {
    const { css } = fakeBuild();
    assert.deepEqual(fontUrlsFromCss(css['assets/admin-a1.css']), ['/aile/fonts/outfit-regular.ttf', '/aile/fonts/outfit-bold.woff2']);
    assert.deepEqual(fontUrlsFromCss(css['assets/PageHeader-p1.css']), ['/aile/fonts/outfit-regular.ttf']);
    assert.deepEqual(fontUrlsFromCss('.a{background:url(/x.png)}'), []);
  });

  it('admin.html içindeki font ön yüklemeleri (rel=preload as=font) sırasız özniteliklerle bulunur', () => {
    assert.deepEqual(preloadFontHrefs(fakeBuild().html), ['/aile/fonts/outfit-medium.woff2', '/aile/fonts/outfit-regular.ttf']);
  });

  it('yayın tabanı giriş script’inin src değerinden çıkarılır; bulunamazsa açık hata', () => {
    assert.equal(detectBase(fakeBuild().html, 'assets/admin-a1.js'), '/aile/');
    assert.equal(detectBase('<script type="module" src="./assets/admin-a1.js"></script>', 'assets/admin-a1.js'), './');
    assert.throws(() => detectBase('<html></html>', 'assets/admin-a1.js'), /admin-a1\.js/);
  });
});

describe('check-budgets: ilk rota kümeleri', () => {
  it('telefon ilk rota: admin.html + statik kapanış + ilk sayfa kapanışı + CSS + ilk ekran fontları (tekil)', () => {
    const { phone, firstRoute, base } = measureFake();
    assert.equal(base, '/aile/');
    assert.deepEqual(firstRoute, { path: '/alimlar', page: 'src/admin/pages/AlimlarPage.tsx' });
    assert.deepEqual(filesOf(phone, 'html'), ['admin.html']);
    assert.deepEqual(filesOf(phone, 'js'), ['assets/AlimlarPage-l2.js', 'assets/PageHeader-p1.js', 'assets/admin-a1.js', 'assets/shared-s1.js', 'assets/tokens-t1.js', 'assets/views-v1.js']);
    assert.deepEqual(filesOf(phone, 'css'), ['assets/AlimlarPage-l2.css', 'assets/PageHeader-p1.css', 'assets/admin-a1.css']);
    assert.deepEqual(filesOf(phone, 'font'), ['fonts/outfit-bold.woff2', 'fonts/outfit-medium.woff2', 'fonts/outfit-regular.ttf']);
    // Bölümler: ilk sayfa yalnız statik kapanışa eklediklerini taşır (PageHeader, shared iki kez sayılmaz).
    const part = Object.fromEntries(phone.files.map((file) => [file.file, file.part]));
    assert.equal(part['assets/admin-a1.js'], 'static');
    assert.equal(part['assets/PageHeader-p1.js'], 'static');
    assert.equal(part['assets/AlimlarPage-l2.js'], 'page');
    assert.equal(part['assets/views-v1.js'], 'page');
    assert.equal(part['fonts/outfit-medium.woff2'], 'font');
    // Toplamlar: html 800 + js 6×400 + css 3×200 gzip; aktarım fontu ham sayar (3×30000).
    assert.deepEqual(phone.totals.html, { files: 1, raw: 2000, gzip: 800, transfer: 800 });
    assert.deepEqual(phone.totals.js, { files: 6, raw: 6000, gzip: 2400, transfer: 2400 });
    assert.deepEqual(phone.totals.css, { files: 3, raw: 1500, gzip: 600, transfer: 600 });
    assert.deepEqual(phone.totals.font, { files: 3, raw: 90000, gzip: 54000, transfer: 90000 });
    assert.deepEqual(phone.totals.all, { files: 13, raw: 99500, gzip: 57800, transfer: 93800 });
    // Bölüm toplamları: admin.html, statik kapanış (JS + CSS), ilk sayfa (yalnız eklenenler), ilk ekran fontları.
    assert.deepEqual(phone.byPart, {
      html: { files: 1, raw: 2000, gzip: 800, transfer: 800 },
      static: { files: 6, raw: 5000, gzip: 2000, transfer: 2000 },
      page: { files: 3, raw: 2500, gzip: 1000, transfer: 1000 },
      font: { files: 3, raw: 90000, gzip: 54000, transfer: 90000 },
    });
    for (const absent of ['assets/GenelPage-g2.js', 'assets/WideProviders-q2.js', 'assets/antd-n1.js', 'assets/wide-w1.js', 'assets/core-e1.js']) {
      assert.ok(!phone.files.some((file) => file.file === absent), `${absent} telefon ilk rotasında olmamalı`);
    }
    assert.deepEqual(phone.capability, { requests: 0, raw: 0, gzip: 0, files: [], classes: [] });
  });

  it('geniş ilk rota: telefon rotası + WideProviders kapanışı + wide sınıfı kök; ECharts ve diğer sayfalar yok', () => {
    const { wide } = measureFake();
    assert.deepEqual(filesOf(wide, 'js'), ['assets/AlimlarPage-l2.js', 'assets/PageHeader-p1.js', 'assets/WideProviders-q2.js', 'assets/admin-a1.js', 'assets/antd-n1.js', 'assets/icons-i1.js', 'assets/shared-s1.js', 'assets/tokens-t1.js', 'assets/views-v1.js', 'assets/wide-w1.js']);
    assert.ok(filesOf(wide, 'css').includes('assets/wide-w1.css'));
    assert.ok(filesOf(wide, 'font').includes('fonts/mono.woff2'), 'geniş CSS’in fontu göreli url ile çözülür');
    assert.deepEqual(wide.startupRoots.sort(), ['src/admin/adaptive/WideProviders.tsx', 'src/admin/ui/wide/Table.wide.tsx']);
    assert.ok(!wide.files.some((file) => file.file === 'assets/core-e1.js'));
    assert.ok(!wide.files.some((file) => file.file === 'assets/GenelPage-g2.js'));
    const cls = Object.fromEntries(wide.files.map((file) => [file.file, file.class]));
    assert.equal(cls['assets/antd-n1.js'], 'antd');
    assert.equal(cls['assets/icons-i1.js'], 'icons');
    assert.equal(cls['assets/wide-w1.js'], 'wide');
  });

  it('WideProviders statikken (PHONE_WITHOUT_ANTD=false, kesim öncesi) geniş başlangıç kökü yoktur ve geniş rota telefon rotasına eşittir', () => {
    const build = fakeBuild();
    build.manifest['admin.html'].dynamicImports = ['src/admin/pages/AlimlarPage.tsx', 'src/admin/pages/GenelPage.tsx'];
    build.manifest['_PageHeader-p1.js'].dynamicImports = ['_core-e1.js'];
    const { phone, wide } = measureFake(build);
    assert.deepEqual(wide.startupRoots, []);
    assert.deepEqual(wide.totals, phone.totals);
  });

  it('yetenek kaynağı: ilk sayfanın statik antd importu sayılır (check-delivery de rota sayfası kapanışında ihlal yazar)', () => {
    const build = fakeBuild();
    build.manifest['src/admin/pages/AlimlarPage.tsx'].imports.push('_antd-n1.js');
    const delivery = deliveryFor(build);
    // Telefon profili rota sayfalarının statik kapanışını da kapsar: iki kapı aynı sızıntıyı ayrı ölçütle yakalar.
    assert.deepEqual(delivery.violations.map((violation) => violation.class).sort(), ['antd', 'icons']);
    assert.deepEqual(delivery.violations.find((violation) => violation.class === 'antd').via, ['admin.html', 'src/admin/pages/AlimlarPage.tsx']);
    const { phone } = measureRoutes({ manifest: build.manifest, graph: build.graph, delivery, html: build.html, readText: (file) => build.css[file] ?? '', sizeOf: fixedSize, budgets: budgetsDoc() });
    assert.deepEqual(phone.capability, { requests: 2, raw: 2000, gzip: 800, files: ['assets/antd-n1.js', 'assets/icons-i1.js'], classes: ['antd', 'icons'] });
    assert.equal(phone.withoutCapability.js.gzip, 2400);
  });

  it('yetenek kaynağı: azınlık ECharts modülü taşıyan karma parça da sayılır (graph üyeliği)', () => {
    const build = fakeBuild();
    build.graph.chunks['assets/views-v1.js'] = { modules: 10, groups: {}, packages: { '.': 8, zrender: 2 } };
    const { phone } = measureFake(build);
    assert.deepEqual(phone.capability.files, ['assets/views-v1.js']);
    assert.deepEqual(phone.capability.classes, ['echarts']);
  });

  it('ilk sayfa manifestte yoksa ya da admin.html’den tembel erişilmiyorsa açık hata', () => {
    assert.throws(() => measureFake(fakeBuild(), budgetsDoc({ firstRoute: { path: '/yok', page: 'src/admin/pages/YokPage.tsx' } })), /YokPage/);
    const build = fakeBuild();
    build.manifest['admin.html'].dynamicImports = ['src/admin/pages/GenelPage.tsx', 'src/admin/adaptive/WideProviders.tsx'];
    assert.throws(() => measureFake(build), /AlimlarPage.*tembel/);
  });

  it('dist dışı font (başka köken) ölçülemez: açık hata', () => {
    const build = fakeBuild();
    build.css['assets/admin-a1.css'] += '@font-face{font-family:Uzak;src:url(https://fonts.example.test/uzak.woff2)}';
    assert.throws(() => measureFake(build), /fonts\.example\.test/);
  });

  it('delivery-report başka derlemeden ise (boyut uyuşmaz) açık hata', () => {
    const build = fakeBuild();
    const delivery = deliveryFor(build);
    assert.throws(() => measureRoutes({ manifest: build.manifest, graph: build.graph, delivery, html: build.html, readText: (file) => build.css[file] ?? '', sizeOf: (file) => (file === 'assets/shared-s1.js' ? { raw: 999, gzip: 1 } : fixedSize(file)), budgets: budgetsDoc() }), /delivery-report.*eski/);
  });
});

describe('check-budgets: bütçe değerlendirme', () => {
  const results = (evaluation) => Object.fromEntries(evaluation.results.map((result) => [result.id, result]));

  it('ratchet: bütçe üstü ama kayıtlı tavan içinde PASS (ratchet); tavan altına inen ölçüm daraltma uyarısı verir', () => {
    const measured = measureFake();
    const evaluation = evaluateBudgets(measured, budgetsDoc(), { strict: false });
    const byId = results(evaluation);
    assert.equal(evaluation.status, 'pass');
    assert.equal(byId['phone-js'].measured, 2400);
    assert.equal(byId['phone-js'].status, 'ratchet');
    assert.equal(byId['phone-js'].ceiling, 3000);
    assert.match(evaluation.warnings.join('\n'), /phone-js.*daraltılabilir.*3000.*2400/);
    assert.equal(byId['phone-css'].status, 'pass');
    assert.equal(byId['phone-capability'].measured, 0);
    assert.equal(byId['phone-capability'].unit, 'istek');
    assert.equal(byId['phone-transfer'].measured, 93800);
  });

  it('ratchet: tavanı aşan ölçüm FAIL; tavanı olmayan bütçe aşımı FAIL', () => {
    const measured = measureFake();
    const overCeiling = evaluateBudgets(measured, budgetsDoc({ ratchet: { ceilings: { 'phone-js': 2300 } } }), { strict: false });
    assert.equal(overCeiling.status, 'fail');
    assert.equal(results(overCeiling)['phone-js'].status, 'fail');
    const noCeiling = evaluateBudgets(measured, budgetsDoc({ ratchet: { ceilings: {} } }), { strict: false });
    assert.equal(results(noCeiling)['phone-js'].status, 'fail');
  });

  it('strict: tavan yok sayılır, her bütçe aşımı FAIL', () => {
    const evaluation = evaluateBudgets(measureFake(), budgetsDoc(), { strict: true });
    assert.equal(evaluation.status, 'fail');
    assert.equal(results(evaluation)['phone-js'].status, 'fail');
    assert.equal(results(evaluation)['phone-css'].status, 'pass');
    const fits = budgetsDoc({ ratchet: { ceilings: {} } });
    fits.budgets.find((budget) => budget.id === 'phone-js').max = 120000;
    assert.equal(evaluateBudgets(measureFake(), fits, { strict: true }).status, 'pass');
  });

  it('bütçe içindeki ölçümün tavanı gereksizdir: uyarı “silinebilir”', () => {
    const doc = budgetsDoc({ ratchet: { ceilings: { 'phone-js': 200000 } } });
    doc.budgets.find((budget) => budget.id === 'phone-js').max = 120000;
    const evaluation = evaluateBudgets(measureFake(), doc, { strict: false });
    assert.equal(results(evaluation)['phone-js'].status, 'pass');
    assert.match(evaluation.warnings.join('\n'), /phone-js.*silinebilir/);
  });

  it('sınıf süzgeci: geniş JS antd’yi dışlar; antd istisnası yalnız antd sınıfını ölçer', () => {
    const byId = results(evaluateBudgets(measureFake(), budgetsDoc(), { strict: false }));
    // Geniş JS: 10 parça × 400 − antd 400 = 3600; antd istisnası 400.
    assert.equal(byId['wide-js'].measured, 3600);
    assert.equal(byId['wide-antd'].measured, 400);
    assert.equal(byId['wide-antd'].exception, true);
  });

  it('yetenek isteği bütçesi 0: tek istek FAIL (ratchet tavanı yoksa); sıfır istek PASS', () => {
    const build = fakeBuild();
    build.manifest['src/admin/pages/AlimlarPage.tsx'].imports.push('_antd-n1.js');
    const measured = measureRoutes({ manifest: build.manifest, graph: build.graph, delivery: deliveryFor(build), html: build.html, readText: (file) => build.css[file] ?? '', sizeOf: fixedSize, budgets: budgetsDoc() });
    const evaluation = evaluateBudgets(measured, budgetsDoc(), { strict: false });
    assert.equal(results(evaluation)['phone-capability'].status, 'fail');
    assert.equal(results(evaluation)['phone-capability'].measured, 2);
  });
});

describe('check-budgets: bütçe dosyası doğrulama', () => {
  it('KB = 1000 bayt; ölçütler sabit listedir', () => {
    assert.equal(KB, 1000);
    assert.deepEqual([...BUDGET_METRICS], ['html', 'js', 'css', 'transfer', 'capabilityRequests']);
  });

  it('bozuk bütçe dosyası açık hata verir', () => {
    assert.throws(() => validateBudgets(budgetsDoc({ schema: 2 })), /schema/);
    assert.throws(() => validateBudgets(budgetsDoc({ units: { kb: 1024, measure: 'gzip' } })), /1000/);
    const dup = budgetsDoc();
    dup.budgets.push({ id: 'phone-js', profile: 'phone', metric: 'js', max: 1 });
    assert.throws(() => validateBudgets(dup), /phone-js.*iki kez/);
    const badMetric = budgetsDoc();
    badMetric.budgets.push({ id: 'phone-img', profile: 'phone', metric: 'images', max: 1 });
    assert.throws(() => validateBudgets(badMetric), /images/);
    const badProfile = budgetsDoc();
    badProfile.budgets.push({ id: 'tv-js', profile: 'tv', metric: 'js', max: 1 });
    assert.throws(() => validateBudgets(badProfile), /tv/);
    assert.throws(() => validateBudgets(budgetsDoc({ ratchet: { ceilings: { 'yok-js': 5 } } })), /yok-js/);
    // Tavan bütçenin üstünde olmalı; aksi anlamsız ve gevşetici bir kayıttır.
    assert.throws(() => validateBudgets(budgetsDoc({ ratchet: { ceilings: { 'phone-js': 2000 } } })), /phone-js.*tavan/);
    assert.throws(() => validateBudgets(budgetsDoc({ firstRoute: { path: '/alimlar' } })), /firstRoute/);
  });
});

describe('check-budgets: özet', () => {
  it('özet bayt ve KB (1000) yazar, ölçüm koşullarını ve sonucu söyler', () => {
    const measured = measureFake();
    const evaluation = evaluateBudgets(measured, budgetsDoc(), { strict: false });
    const text = formatSummary(composeReport({ measured, evaluation, mode: 'ratchet', entry: 'admin.html', budgetsFile: 'budgets.json' }));
    assert.match(text, /KB = 1000 B/);
    assert.match(text, /gzip.*9/);
    assert.match(text, /phone-js.*2400 B.*bütçe 2000 B.*tavan 3000 B.*RATCHET/);
    assert.match(text, /phone-css.*600 B.*PASS/);
    assert.match(text, /sonuç: PASS/);
  });
});

describe('check-budgets: CLI', () => {
  let scratch;
  before(async () => { scratch = await mkdtemp(path.join(tmpdir(), 'aile-check-budgets-')); });
  after(async () => { await rm(scratch, { recursive: true, force: true }); });

  /** Sahte dist: dosyalar gerçek içerikle yazılır; delivery-report gerçek boyutlarla check-delivery çözümlemesinden. */
  async function writeDist(name, build = fakeBuild(), { report = true } = {}) {
    const dist = path.join(scratch, name);
    await mkdir(path.join(dist, '.vite'), { recursive: true });
    await mkdir(path.join(dist, 'assets'), { recursive: true });
    await mkdir(path.join(dist, 'fonts'), { recursive: true });
    await writeFile(path.join(dist, '.vite', 'manifest.json'), JSON.stringify(build.manifest));
    await writeFile(path.join(dist, '.vite', 'delivery-graph.json'), JSON.stringify(build.graph));
    await writeFile(path.join(dist, 'admin.html'), build.html);
    const files = new Set(Object.values(build.manifest).flatMap((chunk) => [chunk.file, ...(chunk.css ?? [])]));
    for (const file of files) await writeFile(path.join(dist, file), build.css[file] ?? `/* ${file} */ export const x = ${JSON.stringify('x'.repeat(300))};`);
    for (const font of ['outfit-regular.ttf', 'outfit-bold.woff2', 'outfit-medium.woff2', 'mono.woff2']) await writeFile(path.join(dist, 'fonts', font), Buffer.alloc(4000, font.length));
    if (report) {
      const sizeOf = (file) => measureBuffer(Buffer.from(build.css[file] ?? `/* ${file} */ export const x = ${JSON.stringify('x'.repeat(300))};`));
      await writeFile(path.join(dist, 'delivery-report.json'), JSON.stringify(deliveryFor(build, sizeOf)));
    }
    return dist;
  }
  async function writeBudgets(name, doc) {
    const file = path.join(scratch, name);
    await writeFile(file, JSON.stringify(doc));
    return file;
  }
  async function cli(args) {
    try {
      const { stdout, stderr } = await run(process.execPath, [script, ...args], { cwd: root });
      return { code: 0, stdout, stderr };
    } catch (error) {
      return { code: error.code, stdout: error.stdout, stderr: error.stderr };
    }
  }
  const generous = () => budgetsDoc({ ratchet: { ceilings: {} }, budgets: budgetsDoc().budgets.map((budget) => (budget.id === 'phone-js' ? { ...budget, max: 120000 } : budget)) });

  it('bütçeler sağlanınca PASS (çıkış 0) ve dist/budget-report.json yazılır; rapor mutlak yol taşımaz', async () => {
    const dist = await writeDist('pass');
    const budgets = await writeBudgets('budgets-pass.json', generous());
    const result = await cli([dist, '--budgets', budgets]);
    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /sonuç: PASS/);
    const text = await readFile(path.join(dist, 'budget-report.json'), 'utf8');
    assert.ok(!text.includes(root), 'rapor depo kökünün mutlak yolunu içermemeli');
    assert.ok(!text.includes(scratch), 'rapor geçici klasörün mutlak yolunu içermemeli');
    const report = JSON.parse(text);
    assert.equal(report.schema, 1);
    assert.equal(report.entry, 'admin.html');
    assert.equal(report.mode, 'ratchet');
    assert.equal(report.status, 'pass');
    assert.equal(report.budgetsFile, 'budgets-pass.json');
    assert.equal(report.measurement.gzipLevel, 9);
    assert.equal(report.measurement.kb, 1000);
    for (const key of ['cache', 'data', 'scope', 'transfer', 'sources']) assert.ok(report.measurement[key], key);
    assert.deepEqual(report.firstRoute, { path: '/alimlar', page: 'src/admin/pages/AlimlarPage.tsx' });
    assert.ok(report.profiles.phone.totals.js.gzip > 0);
    assert.ok(report.profiles.wide.totals.js.gzip >= report.profiles.phone.totals.js.gzip);
    assert.ok(Array.isArray(report.budgets) && report.budgets.length === 7);
  });

  it('--strict bütçe aşımında FAIL (çıkış 1) ve aşan kimliği yazar; ratchet tavan içinde PASS', async () => {
    const dist = await writeDist('strict');
    const doc = generous();
    doc.budgets.find((budget) => budget.id === 'phone-js').max = 10;
    doc.ratchet.ceilings['phone-js'] = 50000;
    const budgets = await writeBudgets('budgets-strict.json', doc);
    const strict = await cli([dist, '--budgets', budgets, '--strict']);
    assert.equal(strict.code, 1, strict.stdout + strict.stderr);
    assert.match(strict.stderr, /phone-js/);
    const ratchet = await cli([dist, '--budgets', budgets]);
    assert.equal(ratchet.code, 0, ratchet.stdout + ratchet.stderr);
    assert.match(ratchet.stdout, /RATCHET/);
  });

  it('delivery-report yoksa çıkış 2 ve check-delivery’ye yönlendirir', async () => {
    const dist = await writeDist('no-report', fakeBuild(), { report: false });
    const budgets = await writeBudgets('budgets-no-report.json', generous());
    const result = await cli([dist, '--budgets', budgets]);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /check-delivery/);
  });

  it('delivery-report eski derlemeden (dosya sonradan değişti) ise çıkış 2', async () => {
    const dist = await writeDist('stale');
    await writeFile(path.join(dist, 'assets', 'shared-s1.js'), 'export const degisti = 1;');
    const budgets = await writeBudgets('budgets-stale.json', generous());
    const result = await cli([dist, '--budgets', budgets]);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /eski/);
  });

  it('bilinmeyen seçenek çıkış 2', async () => {
    const result = await cli(['--hizli']);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /--hizli/);
  });
});

describe('check-budgets: depodaki scripts/budgets.json', () => {
  let doc;
  before(async () => { doc = JSON.parse(await readFile(path.join(root, 'scripts', 'budgets.json'), 'utf8')); });

  it('geçerlidir ve aday bütçeleri (adaptive-qa) bayt olarak taşır', () => {
    validateBudgets(doc);
    const max = Object.fromEntries(doc.budgets.map((budget) => [budget.id, budget.max]));
    assert.equal(max['phone-js'], 120 * KB);
    assert.equal(max['wide-js'], 180 * KB);
    assert.equal(max['phone-css'], 35 * KB);
    assert.equal(max['phone-capability'], 0);
    const wideJs = doc.budgets.find((budget) => budget.id === 'wide-js');
    assert.deepEqual(wideJs.classes, { exclude: ['antd'] });
    const antd = doc.budgets.find((budget) => budget.id === 'wide-antd');
    assert.equal(antd.exception, true);
    assert.deepEqual(antd.classes, { only: ['antd'] });
  });

  it('ilk rota varsayılan yönetim rotasıyla ve rotanın sayfa modülüyle eşleşir (navigation.ts, routes.tsx)', async () => {
    const navigation = await readFile(path.join(root, 'src', 'admin', 'shell', 'navigation.ts'), 'utf8');
    const routes = await readFile(path.join(root, 'src', 'admin', 'routes.tsx'), 'utf8');
    const defaultPath = defaultAdminPathOf(navigation);
    assert.ok(defaultPath, 'navigation.ts içinde defaultAdminPath çözülemedi');
    assert.equal(doc.firstRoute.path, defaultPath);
    const key = defaultPath.replace(/^\//, '');
    const page = routePageOf(routes, key);
    assert.ok(page, `routes.tsx içinde ${key} sayfası bulunamadı`);
    assert.equal(doc.firstRoute.page, `src/admin/pages/${page}.tsx`);
  });

  it('kesim sonrası tavanlar: telefon yetenek isteği ve aktarım bütçe içinde, tavanları yok; antd istisnası ölçümün üstünde pay taşımaz', () => {
    const ceilings = doc.ratchet?.ceilings ?? {};
    // PHONE_WITHOUT_ANTD=true: telefon ilk rotası antd/icons istemez (check-delivery --strict); 0 istek bütçesi tavansız.
    assert.equal(ceilings['phone-capability'], undefined);
    assert.equal(ceilings['phone-transfer'], undefined);
    // Kalan tavanlar yalnız bütçeyi aşan ölçümler içindir ve bütçeden büyüktür (validateBudgets); kayıtlı ölçümle aynıdır.
    const measured = doc.measured ?? {};
    for (const [id, ceiling] of Object.entries(ceilings)) assert.equal(ceiling, measured[id], `${id}: tavan kayıtlı ölçüme eşit olmalı`);
    const antd = doc.budgets.find((budget) => budget.id === 'wide-antd');
    assert.equal(antd.max, measured['wide-antd'], 'wide-antd istisnası kayıtlı antd ölçümüne eşit olmalı (gerekçesiz pay yok)');
  });

  // İnceleme bulgusu (major): tavanı yükseltmek her otomatik kontrolden geçiyordu. Tavanlar burada kilitlidir ve yalnız
  // düşer: bir tavanı yükseltmek bu kilidi de değiştirmeyi gerektirir (inceleme ve entegrasyon sahibinin açık kararı).
  // Bütçe aşımı kalmayınca tavan silinir ve kapı --strict koşar. Kayıt: 2026-11-02 r4-gates (taban 006ee49; wide grubu
  // sayfa başına bölündü, preloadRecovery kaldırıldı). Tavansız bütçe kimliği eklemek de bu listeyi değiştirmez.
  // 2 Kasım 2026 entegrasyon kararı: phone-js 171040 → 174066 (gerekçe budgets.json ratchet.karar); wide-js bütçe içinde, kilitten çıktı.
  // 2 Kasım 2026 p-phonejs: phone-js 174066 → 118807 B (≤ 120000 bütçe); ratchet kaydı silindi, kilit boş. Yeni tavan
  // eklemek bütçeyi gevşetir (entegrasyon sahibinin açık kararı). Ölçüm ve kazanç dağılımı: docs/ADMIN-BUDGETS.md.
  const CEILING_LOCK = Object.freeze({});
  it('ratchet tavanları kilitlidir: yalnız düşer, kilitte olmayan bütçeye tavan eklenmez', () => {
    const ceilings = doc.ratchet?.ceilings ?? {};
    for (const [id, ceiling] of Object.entries(ceilings)) {
      assert.ok(id in CEILING_LOCK, `${id}: kilitte olmayan yeni tavan (bütçeyi gevşetir)`);
      assert.ok(ceiling <= CEILING_LOCK[id], `${id}: tavan ${ceiling} > kilit ${CEILING_LOCK[id]} (tavan yalnız düşer)`);
    }
    // Bütçe tanımı da gevşetilemez: aday bütçeler (adaptive-qa) sabittir.
    const max = Object.fromEntries(doc.budgets.map((budget) => [budget.id, budget.max]));
    assert.deepEqual(max, { 'phone-html': 50000, 'phone-js': 120000, 'phone-css': 35000, 'phone-capability': 0, 'phone-transfer': 500000, 'wide-js': 180000, 'wide-antd': 0 });
  });
});

describe('check-budgets: varsayılan rota çözümleyicileri (kaynak metin)', () => {
  it('defaultAdminPath: dizge sabiti ya da adminPages[N].path (page(\'anahtar\', …) sırası)', () => {
    assert.equal(defaultAdminPathOf("export const defaultAdminPath = '/alimlar';"), '/alimlar');
    const source = [
      'export const adminPages: readonly AdminNavItem[] = [',
      "  page('genel', 'Genel durum', 'Genel', 'Amaç.'),",
      "  page('butce', 'Bütçe ve nakit', 'Para', 'Amaç.'),",
      '];',
      'export const defaultAdminPath = adminPages[1].path;',
    ].join('\n');
    assert.equal(defaultAdminPathOf(source), '/butce');
    assert.equal(defaultAdminPathOf('export const defaultAdminPath = hesapla();'), null);
  });

  it('routes.tsx: hem page(() => import(…)) hem () => import(…) yükleyicisi', () => {
    assert.equal(routePageOf("  alimlar: page(() => import('./pages/AlimlarPage')),", 'alimlar'), 'AlimlarPage');
    assert.equal(routePageOf("  genel: () => import('./pages/GenelPage').then(m => m.GenelPage),", 'genel'), 'GenelPage');
    assert.equal(routePageOf("  genel: () => import('./pages/GenelPage'),", 'butce'), null);
  });
});
