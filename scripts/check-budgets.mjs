#!/usr/bin/env node
// Profil bazlı aktarım bütçesi: yönetim panelinin (admin.html) ilk rotası telefon ve geniş profilde kaç bayt indirir?
//
// Telefon ilk rota = admin.html + girişin statik kapanışı (check-delivery ile aynı manifest grafiği) + varsayılan rotanın
// sayfa parçası ve onun statik kapanışı + bu parçaların CSS'i + ilk ekran fontları (rota CSS'indeki @font-face ve
// admin.html font ön yüklemeleri). Geniş ilk rota = telefon ilk rotası + geniş başlangıç kökleri: telefon rotasından
// dinamik import ile erişilen ve budgets.json `wideStartup` ile eşleşen kökler (WideProviders kaynağı, `wide` sınıfı)
// ve onların statik kapanışı. Diğer sayfalar, ECharts ve sonradan açılan yetenekler ilk rotada sayılmaz.
//
// Girdi: <dist>/.vite/manifest.json, <dist>/.vite/delivery-graph.json, <dist>/delivery-report.json (önce
// `node scripts/check-delivery.mjs <dist>`; aynı derlemeden olmalı), <dist>/admin.html, scripts/budgets.json.
// Sınıf (antd, icons, wide, page …) delivery-report `groups` listesinden; karma parçanın azınlık modülleri
// delivery-graph üyeliğinden. "Yetenek kaynağı" = telefon rotasında delivery-report `forbidden` sınıflarından
// (antd, pro, icons, echarts, wide) birini taşıyan parçanın her dosyası (istek).
//
// Ölçüm: ham bayt ve node:zlib gzip seviye 9, dosya başına (check-delivery ile aynı). Aktarım = HTML/JS/CSS için gzip,
// font için ham bayt. Bütçeler bayt olarak yazılır; KB = 1000 bayt. Soğuk önbellek: her dosya bir istek, bir kez.
// Modlar: varsayılan "ratchet" — bütçeyi aşan ölçüm, budgets.json `ratchet.ceilings` kayıtlı tavanı aşmıyorsa geçer;
// tavan yalnız düşer. "--strict" — tavan yok sayılır, her bütçe aşımı FAIL.
// Rapor: <dist>/budget-report.json (schema 1). Çıkış: 0 PASS, 1 FAIL, 2 girdi/kullanım hatası. Ağ çağrısı yok.
//
// Kullanım: node scripts/check-budgets.mjs [dist] [--strict] [--budgets <json>] [--delivery-report <json>] [--report <json>]
import { readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ECHARTS_PACKAGES, GZIP_LEVEL, chunkLabel, dynamicRoots, measureBuffer, staticClosure } from './check-delivery.mjs';

export const BUDGETS_SCHEMA = 1;
export const REPORT_SCHEMA = 1;
export const DELIVERY_SCHEMA = 1;
/** Bütçe birimi: 1 KB = 1000 bayt (adaptive-qa "KB"; Vite kB ile aynı taban, KiB değil). */
export const KB = 1000;
export const PROFILES = Object.freeze(['phone', 'wide']);
export const BUDGET_METRICS = Object.freeze(['html', 'js', 'css', 'transfer', 'capabilityRequests']);
const FONT_FILE = /\.(?:woff2?|ttf|otf|eot)$/i;
const KINDS = ['html', 'js', 'css', 'font'];

class InputError extends Error {}

/** check-delivery yardımcıları kendi (dışa aktarılmayan) InputError sınıfını atar; burada aynı çıkış koduna (2) çevrilir.
 *  Başka hatalar (program hatası) olduğu gibi geçer. */
const asInput = (fn) => {
  try {
    return fn();
  } catch (error) {
    if (error?.constructor?.name === 'InputError' && !(error instanceof InputError)) throw new InputError(error.message);
    throw error;
  }
};

export const MEASUREMENT = Object.freeze({
  gzipLevel: GZIP_LEVEL,
  kb: KB,
  gzip: 'node:zlib gzipSync, seviye 9, dosya başına; bayt (check-delivery ile aynı)',
  raw: 'diskteki dosya boyutu; bayt',
  transfer: 'HTML/JS/CSS için gzip baytı; font için ham bayt (sunucunun fontu sıkıştırdığı varsayılmaz, woff2 zaten sıkıştırılmıştır)',
  units: 'rapor alanları bayt; bütçeler KB = 1000 bayt (120 KB = 120000 B). check-delivery özeti KiB = 1024 bayt yazar; Vite çıktısındaki kB = 1000 bayt ama kendi gzip hesabıdır, karşılaştırılamaz',
  cache: 'soğuk: HTTP önbelleği ve service worker yok (yönetim parçaları zaten ön belleğe alınmaz); her dosya bir istek, bir kez sayılır',
  data: 'derleme veriden bağımsızdır; nesil (sentetik ya da gerçek) ve e-tablo istekleri kullanıcı içeriğidir, sayılmaz. Kayıtlı ölçüm VITE_BUDGET_SHEET_ID=synthetic-budget-sheet-2098 ile alınan derlemedendir',
  scope: 'telefon: admin.html + statik kapanış + ilk sayfa kapanışı + CSS + ilk ekran fontları; geniş: telefon + geniş başlangıç kökleri. favicon, görseller ve veri istekleri dahil değil',
  sources: ['admin.html', '.vite/manifest.json', '.vite/delivery-graph.json', 'delivery-report.json', 'rota CSS @font-face ve admin.html font ön yüklemeleri'],
});

// #region HTML/CSS çözümleme
const attribute = (tag, name) => {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(tag);
  return match ? (match[1] ?? match[2] ?? match[3]) : null;
};

/** CSS içindeki her @font-face kuralının src listesindeki ilk url (tarayıcı ilk desteklenen biçimi indirir). data:
 *  URL'leri CSS baytındadır, ayrı istek değildir; @font-face dışındaki url'ler (görsel) font sayılmaz. Tekil, sırayla. */
export function fontUrlsFromCss(css) {
  const urls = [];
  for (const [, body] of css.matchAll(/@font-face\s*\{([^}]*)\}/gi)) {
    const at = body.search(/(?:^|[;\s])src\s*:/i);
    if (at < 0) continue;
    const first = /url\(\s*(['"]?)([^'")\s]+)\1\s*\)?/i.exec(body.slice(at));
    if (!first || first[2].startsWith('data:')) continue;
    if (!urls.includes(first[2])) urls.push(first[2]);
  }
  return urls;
}

/** admin.html içindeki <link rel="preload" as="font" href> adresleri (öznitelik sırası serbest). */
export function preloadFontHrefs(html) {
  const hrefs = [];
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    const rel = (attribute(tag, 'rel') ?? '').toLowerCase().split(/\s+/);
    const href = attribute(tag, 'href');
    if (rel.includes('preload') && (attribute(tag, 'as') ?? '').toLowerCase() === 'font' && href && !hrefs.includes(href)) hrefs.push(href);
  }
  return hrefs;
}

/** Yayın tabanı (Vite `base`): giriş script'inin src değerinden manifest dosya adı çıkarılınca kalan önek. */
export function detectBase(html, entryFile) {
  for (const [tag] of html.matchAll(/<script\b[^>]*>/gi)) {
    const src = attribute(tag, 'src');
    if (src && src.endsWith(entryFile)) return src.slice(0, src.length - entryFile.length);
  }
  throw new InputError(`HTML içinde giriş script'i bulunamadı: ${entryFile}`);
}

/** Adresi dist köküne göreli dosya yoluna çevirir; başka köken veya dist dışı ölçülemez (girdi hatası). */
function distPath(url, base, fromFile) {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(url)) throw new InputError(`font dist dışında, ölçülemez: ${url} (${fromFile})`);
  const clean = url.replace(/[?#].*$/, '');
  let resolved;
  if (clean.startsWith('/')) {
    if (!base.startsWith('/') || !clean.startsWith(base)) throw new InputError(`font yayın tabanının (${base}) dışında: ${url} (${fromFile})`);
    resolved = path.posix.normalize(clean.slice(base.length));
  } else {
    resolved = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), clean));
  }
  if (resolved.startsWith('..') || path.posix.isAbsolute(resolved)) throw new InputError(`font dist dışında: ${url} (${fromFile})`);
  return resolved;
}

const kindOf = (file) => (file.endsWith('.html') ? 'html' : file.endsWith('.css') ? 'css' : FONT_FILE.test(file) ? 'font' : /\.[cm]?js$/.test(file) ? 'js' : 'other');
// #endregion

// #region rota ölçümü
const emptyTotal = () => ({ files: 0, raw: 0, gzip: 0, transfer: 0 });
const addTo = (total, file) => { total.files += 1; total.raw += file.raw; total.gzip += file.gzip; total.transfer += file.transfer; };

/**
 * İlk rota dosya kümelerini ve boyutlarını çıkarır.
 * @param {{ manifest: Record<string, any>, graph: { chunks: Record<string, any> }, delivery: any, html: string,
 *   readText: (file: string) => string, sizeOf: (file: string) => { raw: number, gzip: number }, budgets: any }} input
 */
export function measureRoutes({ manifest, graph, delivery, html, readText, sizeOf, budgets }) {
  const entry = budgets.entry;
  if (delivery?.schema !== DELIVERY_SCHEMA) throw new InputError(`delivery-report schema ${delivery?.schema}; beklenen ${DELIVERY_SCHEMA}`);
  if (delivery.entry !== entry) throw new InputError(`delivery-report girişi ${delivery.entry}, bütçe girişi ${entry}`);
  if (!manifest[entry]) throw new InputError(`manifest girişi yok: ${entry}`);
  const forbidden = [...(delivery.forbidden ?? [])];
  const staticKeys = asInput(() => staticClosure(manifest, entry));
  const staticSet = new Set(staticKeys);
  const chunkFiles = (key) => [manifest[key].file, ...(manifest[key].css ?? [])];

  // Tazelik: delivery-report aynı derlemeden olmalı (statik kapanış dosyaları ve ham baytlar birebir).
  const stale = (why) => new InputError(`delivery-report eski ya da başka derlemeden: ${why}; node scripts/check-delivery.mjs <dist> ile yeniden üretin`);
  const reported = new Map((delivery.phone?.static?.chunks ?? []).map((chunk) => [chunk.file, chunk]));
  for (const key of staticKeys) {
    const chunk = reported.get(manifest[key].file);
    if (!chunk) throw stale(`${manifest[key].file} raporda yok`);
    const raw = chunkFiles(key).reduce((sum, file) => sum + sizeOf(file).raw, 0);
    if (raw !== chunk.raw) throw stale(`${manifest[key].file} raporda ${chunk.raw} B, dist içinde ${raw} B`);
  }
  if (reported.size !== staticKeys.length) throw stale('statik kapanış parça sayısı farklı');

  const classOf = new Map();
  for (const [cls, bucket] of Object.entries(delivery.groups ?? {})) for (const file of bucket.list ?? []) classOf.set(file, cls);
  const chunkClass = (key) => {
    const cls = classOf.get(manifest[key].file);
    if (!cls) throw stale(`${manifest[key].file} için sınıf yok`);
    return cls;
  };
  const containsOf = (key) => {
    const info = graph.chunks?.[manifest[key].file];
    if (!info) throw new InputError(`delivery-graph içinde parça yok: ${manifest[key].file} (manifest ile graph farklı derlemelerden)`);
    const found = Object.entries(info.groups ?? {}).filter(([, count]) => count > 0).map(([name]) => name);
    if (ECHARTS_PACKAGES.some((pkg) => (info.packages?.[pkg] ?? 0) > 0) && !found.includes('echarts')) found.push('echarts');
    return found.sort();
  };

  const base = detectBase(html, manifest[entry].file);
  const preloads = preloadFontHrefs(html);
  const fileOf = (file, extra) => {
    const size = sizeOf(file);
    const kind = kindOf(file);
    return { file, kind, ...extra, raw: size.raw, gzip: size.gzip, transfer: kind === 'font' ? size.raw : size.gzip };
  };

  // Parça grupları (statik, sayfa, geniş) → dosya listesi; fontlar rotadaki CSS'ten ve HTML ön yüklemelerinden.
  const buildRoute = (profile, groups) => {
    const files = [fileOf(entry, { part: 'html', label: entry, class: null, contains: [], capability: false })];
    const seen = new Set([entry]);
    for (const { part, keys } of groups) {
      for (const key of keys) {
        const cls = chunkClass(key);
        const contains = containsOf(key);
        const capabilityClasses = [...new Set([cls, ...contains])].filter((name) => forbidden.includes(name)).sort();
        for (const file of chunkFiles(key)) {
          if (seen.has(file)) continue;
          seen.add(file);
          files.push(fileOf(file, { part, label: chunkLabel(manifest, key), class: cls, contains, capability: capabilityClasses.length > 0, capabilityClasses }));
        }
      }
    }
    const fonts = [];
    for (const css of files.filter((file) => file.kind === 'css')) for (const url of fontUrlsFromCss(readText(css.file))) fonts.push(distPath(url, base, css.file));
    for (const href of preloads) fonts.push(distPath(href, base, entry));
    for (const font of fonts) {
      if (seen.has(font)) continue;
      seen.add(font);
      files.push(fileOf(font, { part: 'font', label: font, class: null, contains: [], capability: false }));
    }
    const totals = Object.fromEntries([...KINDS, 'all'].map((kind) => [kind, emptyTotal()]));
    const byPart = {};
    const withoutCapability = { js: emptyTotal() };
    const capability = { requests: 0, raw: 0, gzip: 0, files: [], classes: [] };
    for (const file of files) {
      if (totals[file.kind]) addTo(totals[file.kind], file);
      addTo(totals.all, file);
      addTo((byPart[file.part] ??= emptyTotal()), file);
      if (file.capability) {
        capability.requests += 1;
        capability.raw += file.raw;
        capability.gzip += file.gzip;
        capability.files.push(file.file);
        for (const name of file.capabilityClasses) if (!capability.classes.includes(name)) capability.classes.push(name);
      } else if (file.kind === 'js') addTo(withoutCapability.js, file);
      delete file.capabilityClasses;
    }
    capability.files.sort();
    capability.classes.sort();
    return { profile, files, totals, byPart, capability, withoutCapability };
  };

  const { path: routePath, page } = budgets.firstRoute;
  if (!manifest[page]) throw new InputError(`ilk sayfa manifestte yok: ${page} (budgets.json firstRoute)`);
  if (!dynamicRoots(manifest, staticKeys).includes(page)) throw new InputError(`ilk sayfa ${page}, ${entry} statik kapanışından tembel (dinamik import) olarak erişilmiyor`);
  const pageKeys = asInput(() => staticClosure(manifest, page)).filter((key) => !staticSet.has(key));
  const phone = { ...buildRoute('phone', [{ part: 'static', keys: staticKeys }, { part: 'page', keys: pageKeys }]), firstPage: page };

  // Geniş başlangıç: telefon rotasından dinamik erişilen ve wideStartup ile eşleşen kökler (zincirleme), statik kapanışlarıyla.
  const { sources = [], classes = [] } = budgets.wideStartup ?? {};
  const wideSet = new Set([...staticKeys, ...pageKeys]);
  const wideKeys = [];
  const startupRoots = [];
  const visited = new Set();
  let frontier = dynamicRoots(manifest, [...wideSet]);
  while (frontier.length) {
    const next = [];
    for (const root of frontier) {
      if (visited.has(root) || wideSet.has(root)) continue;
      visited.add(root);
      const label = chunkLabel(manifest, root);
      if (!sources.includes(label) && !classes.includes(chunkClass(root))) continue;
      startupRoots.push(label);
      const added = asInput(() => staticClosure(manifest, root)).filter((key) => !wideSet.has(key));
      for (const key of added) { wideSet.add(key); wideKeys.push(key); }
      next.push(...dynamicRoots(manifest, added));
    }
    frontier = next;
  }
  const wide = { ...buildRoute('wide', [{ part: 'static', keys: staticKeys }, { part: 'page', keys: pageKeys }, { part: 'wide', keys: wideKeys }]), startupRoots };

  return { base, firstRoute: { path: routePath, page }, phone, wide };
}
// #endregion

// #region bütçe dosyası ve değerlendirme
const isCount = (value) => Number.isInteger(value) && value >= 0;
const isStringList = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string');

/** budgets.json yapısını doğrular; bozuksa girdi hatası (çıkış 2). */
export function validateBudgets(doc) {
  if (!doc || typeof doc !== 'object') throw new InputError('bütçe dosyası nesne değil');
  if (doc.schema !== BUDGETS_SCHEMA) throw new InputError(`bütçe dosyası schema ${doc.schema}; beklenen ${BUDGETS_SCHEMA}`);
  if (typeof doc.entry !== 'string' || !doc.entry) throw new InputError('bütçe dosyasında entry yok');
  if (doc.units?.kb !== KB) throw new InputError(`bütçe dosyası units.kb ${doc.units?.kb}; bu kapı KB = ${KB} bayt kullanır`);
  if (doc.units?.measure !== 'gzip') throw new InputError(`bütçe dosyası units.measure ${doc.units?.measure}; beklenen gzip`);
  if (typeof doc.firstRoute?.path !== 'string' || !doc.firstRoute.path.startsWith('/') || typeof doc.firstRoute?.page !== 'string' || !doc.firstRoute.page) {
    throw new InputError('bütçe dosyası firstRoute { path: "/…", page: "src/…" } ister');
  }
  if (doc.wideStartup !== undefined && (!isStringList(doc.wideStartup.sources ?? []) || !isStringList(doc.wideStartup.classes ?? []))) {
    throw new InputError('bütçe dosyası wideStartup { sources: [], classes: [] } dizileri ister');
  }
  if (!Array.isArray(doc.budgets) || doc.budgets.length === 0) throw new InputError('bütçe dosyasında budgets listesi yok');
  const ids = new Map();
  for (const budget of doc.budgets) {
    if (typeof budget?.id !== 'string' || !budget.id) throw new InputError('her bütçenin id alanı olmalı');
    if (ids.has(budget.id)) throw new InputError(`${budget.id}: bütçe kimliği iki kez`);
    if (!PROFILES.includes(budget.profile)) throw new InputError(`${budget.id}: bilinmeyen profil ${budget.profile} (${PROFILES.join(', ')})`);
    if (!BUDGET_METRICS.includes(budget.metric)) throw new InputError(`${budget.id}: bilinmeyen ölçüt ${budget.metric} (${BUDGET_METRICS.join(', ')})`);
    if (!isCount(budget.max)) throw new InputError(`${budget.id}: max negatif olmayan tam sayı (bayt ya da istek) olmalı`);
    if (budget.classes !== undefined) {
      const keys = Object.keys(budget.classes ?? {});
      if (keys.length !== 1 || !['only', 'exclude'].includes(keys[0]) || !isStringList(budget.classes[keys[0]])) throw new InputError(`${budget.id}: classes yalnız { only: [...] } ya da { exclude: [...] } olabilir`);
    }
    ids.set(budget.id, budget);
  }
  const ceilings = doc.ratchet?.ceilings ?? {};
  if (typeof ceilings !== 'object' || Array.isArray(ceilings)) throw new InputError('ratchet.ceilings nesne olmalı');
  for (const [id, ceiling] of Object.entries(ceilings)) {
    const budget = ids.get(id);
    if (!budget) throw new InputError(`ratchet tavanı bilinmeyen bütçe için: ${id}`);
    if (!isCount(ceiling)) throw new InputError(`${id}: ratchet tavanı negatif olmayan tam sayı olmalı`);
    if (ceiling <= budget.max) throw new InputError(`${id}: ratchet tavanı (${ceiling}) bütçeden (${budget.max}) büyük olmalı; değilse kaydı silin`);
  }
  return doc;
}

const passesClasses = (file, classes) => (!classes ? true : classes.only ? classes.only.includes(file.class) : !classes.exclude.includes(file.class));

function metricValue(route, budget) {
  if (budget.metric === 'capabilityRequests') return route.capability.requests;
  const files = route.files.filter((file) => passesClasses(file, budget.classes));
  if (budget.metric === 'transfer') return files.reduce((sum, file) => sum + file.transfer, 0);
  return files.filter((file) => file.kind === budget.metric).reduce((sum, file) => sum + file.gzip, 0);
}

/** Her bütçe: pass (bütçe içinde), ratchet (bütçe üstü, kayıtlı tavan içinde; yalnız ratchet modunda), fail. */
export function evaluateBudgets(measured, doc, { strict }) {
  validateBudgets(doc);
  const ceilings = doc.ratchet?.ceilings ?? {};
  const results = [];
  const warnings = [];
  for (const budget of doc.budgets) {
    const route = measured[budget.profile];
    const value = metricValue(route, budget);
    const ceiling = ceilings[budget.id] ?? null;
    let status;
    if (value <= budget.max) {
      status = 'pass';
      if (ceiling !== null) warnings.push(`${budget.id}: bütçe içinde (${value} ≤ ${budget.max}); ratchet tavanı scripts/budgets.json listesinden silinebilir`);
    } else if (strict) status = 'fail';
    else if (ceiling !== null && value <= ceiling) {
      status = 'ratchet';
      if (value < ceiling) warnings.push(`${budget.id}: ratchet daraltılabilir: tavan ${ceiling} → ${value}`);
    } else status = 'fail';
    results.push({
      id: budget.id, profile: budget.profile, metric: budget.metric, classes: budget.classes ?? null, unit: budget.metric === 'capabilityRequests' ? 'istek' : 'B',
      max: budget.max, ceiling, measured: value, status, exception: budget.exception === true, source: budget.source ?? null,
    });
  }
  return { status: results.some((result) => result.status === 'fail') ? 'fail' : 'pass', results, warnings };
}

/** Yazılan rapor (schema 1). */
export function composeReport({ measured, evaluation, mode, entry, budgetsFile }) {
  return {
    schema: REPORT_SCHEMA,
    entry,
    mode,
    status: evaluation.status,
    measurement: { ...MEASUREMENT },
    base: measured.base,
    firstRoute: measured.firstRoute,
    profiles: { phone: measured.phone, wide: measured.wide },
    budgets: evaluation.results,
    warnings: evaluation.warnings,
    budgetsFile,
  };
}
// #endregion

// #region çıktı
const kb = (bytes) => `${(bytes / KB).toFixed(1)} KB`;
const amount = (value, unit) => (unit === 'istek' ? `${value} istek` : `${value} B (${kb(value)})`);
const PROFILE_NAMES = { phone: 'telefon', wide: 'geniş' };
const PART_NAMES = { html: 'admin.html', static: 'statik kapanış', page: 'ilk sayfa', wide: 'geniş başlangıç', font: 'font' };

function routeLines(route, title) {
  const lines = [`  ${title}: ${route.totals.all.files} dosya, aktarım ${amount(route.totals.all.transfer, 'B')}`];
  lines.push(`    ${'tür'.padEnd(5)} ${'dosya'.padStart(5)} ${'ham B'.padStart(10)} ${'gzip B'.padStart(10)} ${'aktarım B'.padStart(10)}`);
  for (const kind of KINDS) {
    const total = route.totals[kind];
    lines.push(`    ${kind.padEnd(5)} ${String(total.files).padStart(5)} ${String(total.raw).padStart(10)} ${String(total.gzip).padStart(10)} ${String(total.transfer).padStart(10)}`);
  }
  const parts = Object.entries(route.byPart).map(([part, total]) => `${PART_NAMES[part] ?? part} ${total.files} dosya, ham ${total.raw} B, gzip ${total.gzip} B`);
  lines.push(`    bölümler: ${parts.join('; ')}`);
  const capability = route.capability;
  lines.push(`    yetenek kaynağı: ${capability.requests} istek${capability.requests ? `, gzip ${amount(capability.gzip, 'B')} (${capability.classes.join(', ')}: ${capability.files.join(', ')})` : ''}`);
  if (capability.requests) lines.push(`    yetenek sınıfları hariç JS: gzip ${amount(route.withoutCapability.js.gzip, 'B')}`);
  return lines;
}

/** İnsan için özet: rota bileşimi, bütçeler, uyarılar, sonuç. */
export function formatSummary(report) {
  const lines = [`check-budgets: ${report.entry} ilk rota ${report.firstRoute.path} (${report.firstRoute.page}), mod ${report.mode}`];
  lines.push(`  ölçüm: ham bayt + gzip (node:zlib seviye ${report.measurement.gzipLevel}, dosya başına); KB = ${report.measurement.kb} B; soğuk önbellek; aktarım = HTML/JS/CSS gzip + font ham`);
  lines.push(...routeLines(report.profiles.phone, 'telefon ilk rota'));
  lines.push(...routeLines(report.profiles.wide, 'geniş ilk rota'));
  lines.push(`    geniş başlangıç kökleri: ${report.profiles.wide.startupRoots.length ? report.profiles.wide.startupRoots.join(', ') : 'yok (geniş rota telefon rotasına eşit)'}`);
  lines.push('  bütçeler:');
  for (const result of report.budgets) {
    const scope = `${PROFILE_NAMES[result.profile]} ${result.metric}${result.classes ? ` ${result.classes.only ? 'yalnız' : 'hariç'} ${(result.classes.only ?? result.classes.exclude).join(',')}` : ''}${result.exception ? ' (istisna)' : ''}`;
    const ceiling = result.ceiling === null ? '' : `  tavan ${amount(result.ceiling, result.unit)}`;
    lines.push(`    ${result.id.padEnd(17)} ${scope.padEnd(32)} ${amount(result.measured, result.unit)}  bütçe ${amount(result.max, result.unit)}${ceiling}  ${result.status.toUpperCase()}`);
  }
  for (const warning of report.warnings) lines.push(`  uyarı: ${warning}`);
  const ratcheted = report.budgets.filter((result) => result.status === 'ratchet').length;
  const failed = report.budgets.filter((result) => result.status === 'fail').map((result) => result.id);
  lines.push(`  sonuç: ${report.status === 'pass' ? `PASS (${report.mode}${ratcheted ? `: ${ratcheted} bütçe kayıtlı tavanında` : ': tüm bütçeler içinde'})` : `FAIL (${report.mode}: ${failed.join(', ')})`}`);
  return `${lines.join('\n')}\n`;
}
// #endregion

// #region CLI
async function readJson(file, missing) {
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    throw new InputError(missing);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new InputError(`${file} JSON değil: ${error.message}`);
  }
}

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Rapor dist ile yayınlanabilir: yol depo köküne göreli, kök dışındaysa yalnız dosya adı (mutlak yol yok). */
const publicPath = (file) => {
  const rel = path.relative(REPO_ROOT, file);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel.split(path.sep).join('/') : path.basename(file);
};

/** Dist'i okur, ölçer, bütçelerle karşılaştırır, raporu yazar. */
export async function runCheck({ distDir, budgetsPath, deliveryReportPath, reportPath, strict = false }) {
  const budgets = validateBudgets(await readJson(budgetsPath, `bütçe dosyası yok: ${budgetsPath}`));
  const manifest = await readJson(path.join(distDir, '.vite', 'manifest.json'), `${path.join(distDir, '.vite', 'manifest.json')} yok: önce pnpm build`);
  const graph = await readJson(path.join(distDir, '.vite', 'delivery-graph.json'), `${path.join(distDir, '.vite', 'delivery-graph.json')} yok: vite.config.ts deliveryGraph eklentisiyle pnpm build gerekli`);
  const delivery = await readJson(deliveryReportPath, `${deliveryReportPath} yok: önce node scripts/check-delivery.mjs <dist> (aynı derleme)`);
  let html;
  try {
    html = await readFile(path.join(distDir, budgets.entry), 'utf8');
  } catch {
    throw new InputError(`${budgets.entry} dist içinde yok: önce pnpm build`);
  }
  const sizes = new Map();
  const sizeOf = (file) => {
    if (!sizes.has(file)) {
      try {
        sizes.set(file, measureBuffer(readFileSync(path.join(distDir, file))));
      } catch {
        throw new InputError(`dist içinde dosya yok: ${file}`);
      }
    }
    return sizes.get(file);
  };
  const readText = (file) => {
    try {
      return readFileSync(path.join(distDir, file), 'utf8');
    } catch {
      throw new InputError(`dist içinde dosya yok: ${file}`);
    }
  };
  const measured = measureRoutes({ manifest, graph, delivery, html, readText, sizeOf, budgets });
  const evaluation = evaluateBudgets(measured, budgets, { strict });
  const report = composeReport({ measured, evaluation, mode: strict ? 'strict' : 'ratchet', entry: budgets.entry, budgetsFile: publicPath(budgetsPath) });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return { report, exitCode: report.status === 'pass' ? 0 : 1 };
}

function parseArgs(argv, root) {
  const options = { strict: false };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--strict') options.strict = true;
    else if (arg === '--budgets' || arg === '--report' || arg === '--delivery-report') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new InputError(`${arg} bir değer ister`);
      options[arg.slice(2)] = value;
      i += 1;
    } else if (arg.startsWith('--')) throw new InputError(`bilinmeyen seçenek: ${arg}`);
    else positional.push(arg);
  }
  if (positional.length > 1) throw new InputError('tek dist klasörü verilir');
  const distDir = path.resolve(root, positional[0] ?? 'dist');
  return {
    distDir,
    strict: options.strict,
    budgetsPath: options.budgets ? path.resolve(root, options.budgets) : path.join(root, 'scripts', 'budgets.json'),
    deliveryReportPath: options['delivery-report'] ? path.resolve(root, options['delivery-report']) : path.join(distDir, 'delivery-report.json'),
    reportPath: options.report ? path.resolve(root, options.report) : path.join(distDir, 'budget-report.json'),
  };
}

async function main(argv) {
  const root = REPO_ROOT;
  const options = parseArgs(argv, root);
  const { report, exitCode } = await runCheck(options);
  process.stdout.write(formatSummary(report));
  const shown = path.relative(root, options.reportPath);
  process.stdout.write(`  rapor: ${shown && !shown.startsWith('..') ? shown : options.reportPath}\n`);
  if (exitCode !== 0) {
    const failing = report.budgets.filter((result) => result.status === 'fail').map((result) => `${result.id} (${amount(result.measured, result.unit)} > ${amount(result.max, result.unit)}${result.ceiling === null ? '' : `, tavan ${amount(result.ceiling, result.unit)}`})`);
    process.stderr.write(`check-budgets: FAIL — bütçe aşımı: ${failing.join('; ')}\n`);
  }
  return exitCode;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      process.stderr.write(`check-budgets: ${error instanceof InputError ? '' : 'Hata: '}${error.message}\n`);
      process.exit(2);
    },
  );
}
