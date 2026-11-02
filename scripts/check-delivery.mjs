#!/usr/bin/env node
// Uyarlamalı teslim kapısı: "telefon profili antd/pro/echarts ve geniş-özel parçaları hiç istemez".
//
// Telefon profili = admin.html girişinin STATİK kapanışı: Vite derleme manifestinde (dist/.vite/manifest.json) girişten
// `imports` zinciriyle erişilen her parça. Tablet/masaüstü yetenekleri bu kapanışın dışında, dinamik import ile gelir.
// Kural: statik kapanışta antd, pro, icons (@ant-design/icons), echarts (echarts/zrender) ve wide sınıfından modül yoktur.
//
// Kapanış dosya adı tahminiyle değil manifest grafiğinden hesaplanır. Sınıf da parça adından değil modül üyeliğinden
// gelir: vite.config.ts `deliveryGraph` eklentisi dist/.vite/delivery-graph.json yazar (parça başına codeSplitting grup
// sayıları, paket sayıları ve paket/parça sınırını geçen statik import kenarları). İhlal kimliği "<sınıf> <- <içe
// aktaran>" biçimindedir; içe aktaran proje modülü yolu (src/...) ya da paket adıdır, hash içermez.
//
// Modlar: varsayılan "ratchet" — scripts/delivery-baseline.json dışındaki her ihlal FAIL; liste küçülürse PASS ve
// "baseline daraltılabilir" uyarısı. "--strict" — tek ihlal FAIL (baseline yok sayılır).
// Rapor: <dist>/delivery-report.json (schema 1). Ölçüm: ham bayt + node:zlib gzip seviye 9, dosya başına.
// Çıkış: 0 PASS, 1 FAIL, 2 girdi/kullanım hatası. Ağ çağrısı yok; yalnız dist okunur ve rapor yazılır.
//
// Kullanım: node scripts/check-delivery.mjs [dist] [--strict] [--baseline <json>] [--report <json>] [--entry admin.html]
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

export const REPORT_SCHEMA = 1;
export const GRAPH_SCHEMA = 1;
export const DEFAULT_ENTRY = 'admin.html';
export const GZIP_LEVEL = 9;
/** Telefon statik kapanışında bulunmaması gereken sınıflar (sıra raporda korunur). */
export const FORBIDDEN_PHONE_CLASSES = Object.freeze(['antd', 'pro', 'icons', 'echarts', 'wide']);
/** codeSplitting grubu olmayan ama sınıf sayılan paketler: ECharts çekirdeği ve çizim motoru. */
export const ECHARTS_PACKAGES = Object.freeze(['echarts', 'zrender']);
const PAGE_SOURCE = /^src\/admin\/pages\//;
const KIB = 1024;

class InputError extends Error {}

// #region ölçüm
/** Ham bayt ve gzip (zlib seviye 9) baytı. */
export function measureBuffer(buffer) {
  return { raw: buffer.length, gzip: gzipSync(buffer, { level: GZIP_LEVEL }).length };
}
const kib = (bytes) => (bytes / KIB).toFixed(2);
const emptyTotal = () => ({ files: 0, raw: 0, gzip: 0 });
// #endregion

// #region manifest grafiği
/** Girişten yalnız `imports` ile erişilen manifest anahtarları (BFS sırası). Döngülerde durur. */
export function staticClosure(manifest, entry) {
  if (!manifest[entry]) throw new InputError(`manifest girişi yok: ${entry}`);
  const order = [];
  const seen = new Set();
  const queue = [entry];
  while (queue.length) {
    const key = queue.shift();
    if (seen.has(key)) continue;
    if (!manifest[key]) throw new InputError(`manifest anahtarı yok: ${key}`);
    seen.add(key);
    order.push(key);
    for (const child of manifest[key].imports ?? []) if (!seen.has(child)) queue.push(child);
  }
  return order;
}

/** Verilen kümenin dinamik import ettiği, kümede olmayan anahtarlar (ilk görülme sırasıyla). */
export function dynamicRoots(manifest, keys) {
  const inside = new Set(keys);
  const roots = [];
  for (const key of keys) for (const child of manifest[key].dynamicImports ?? []) if (!inside.has(child) && !roots.includes(child)) roots.push(child);
  return roots;
}

/** pnpm sanal mağaza yolunu sürümsüz paket yoluna indirger. */
const normalizeSource = (src) => src.replace(/^(?:.*\/)?node_modules\/\.pnpm\/[^/]+\/node_modules\//, 'node_modules/');

/** Hash içermeyen kararlı etiket: giriş/dinamik giriş için kaynak yolu, ortak parça için `chunk:<ad>`. */
export function chunkLabel(manifest, key) {
  const chunk = manifest[key];
  if (chunk.src && (chunk.isEntry || chunk.isDynamicEntry)) return normalizeSource(chunk.src);
  return `chunk:${chunk.name ?? path.basename(chunk.file).replace(/-[^-]+\.[a-z]+$/, '')}`;
}

/** Girişten her anahtara statik imports üzerinden en kısa etiket yolu (giriş ve hedef dahil). */
function shortestPaths(manifest, entry) {
  const parent = new Map([[entry, null]]);
  const queue = [entry];
  while (queue.length) {
    const key = queue.shift();
    for (const child of manifest[key].imports ?? []) if (!parent.has(child)) { parent.set(child, key); queue.push(child); }
  }
  return (key) => {
    const chain = [];
    for (let at = key; at !== null && at !== undefined; at = parent.get(at)) chain.unshift(chunkLabel(manifest, at));
    return chain;
  };
}
// #endregion

// #region sınıflandırma
/** Modül anahtarının (kenar ucunun) sınıfı: codeSplitting grubu, yoksa ECharts paketi → echarts. */
const moduleClass = (key, group) => group ?? (ECHARTS_PACKAGES.includes(key) ? 'echarts' : null);

/** Parçanın içerdiği sınıflar (modül sayısıyla) ve birincil sınıfı. Birincil: modüllerin yarısından fazlasını tutan
 *  sınıf; yoksa manifest rolü (entry, page = src/admin/pages/* dinamik girişi, lazy = diğer dinamik giriş, app). */
function chunkProfile(manifest, graph, key) {
  const chunk = manifest[key];
  const info = graph.chunks[chunk.file];
  if (!info) throw new InputError(`delivery-graph içinde parça yok: ${chunk.file} (manifest ile graph farklı derlemelerden; pnpm build yeniden)`);
  const counts = { ...(info.groups ?? {}) };
  const echarts = ECHARTS_PACKAGES.reduce((sum, pkg) => sum + (info.packages?.[pkg] ?? 0), 0);
  if (echarts > 0) counts.echarts = Math.max(counts.echarts ?? 0, echarts);
  const contains = Object.keys(counts).filter((name) => counts[name] > 0).sort();
  const [top] = Object.entries(counts).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  let primary = top && top[1] * 2 > info.modules ? top[0] : null;
  if (!primary) primary = chunk.isEntry ? 'entry' : chunk.isDynamicEntry ? (PAGE_SOURCE.test(normalizeSource(chunk.src ?? '')) ? 'page' : 'lazy') : 'app';
  return { primary, contains };
}
// #endregion

// #region çözümleme
/**
 * @param {{ manifest: Record<string, any>, graph: { schema: number, chunks: Record<string, any>, edges: any[] },
 *   sizeOf: (file: string) => { raw: number, gzip: number }, entry?: string, forbidden?: readonly string[] }} input
 */
export function analyzeDelivery({ manifest, graph, sizeOf, entry = DEFAULT_ENTRY, forbidden = FORBIDDEN_PHONE_CLASSES }) {
  const phoneKeys = staticClosure(manifest, entry);
  const phoneSet = new Set(phoneKeys);
  const profiles = new Map();
  const profileOf = (key) => {
    if (!profiles.has(key)) profiles.set(key, chunkProfile(manifest, graph, key));
    return profiles.get(key);
  };
  const filesOf = (key) => [manifest[key].file, ...(manifest[key].css ?? [])];
  const describe = (key) => {
    const { primary, contains } = profileOf(key);
    const css = (manifest[key].css ?? []).map((file) => ({ file, ...sizeOf(file) }));
    const js = sizeOf(manifest[key].file);
    return { file: manifest[key].file, label: chunkLabel(manifest, key), class: primary, contains, raw: js.raw + css.reduce((sum, item) => sum + item.raw, 0), gzip: js.gzip + css.reduce((sum, item) => sum + item.gzip, 0), css };
  };
  /** Anahtar kümesinin dosya bazında (tekil) toplamı, birincil sınıfa göre de. */
  const summarize = (keys) => {
    const total = emptyTotal();
    const byClass = {};
    const counted = new Set();
    for (const key of keys) {
      const cls = profileOf(key).primary;
      for (const file of filesOf(key)) {
        if (counted.has(file)) continue;
        counted.add(file);
        const size = sizeOf(file);
        byClass[cls] ??= emptyTotal();
        for (const bucket of [total, byClass[cls]]) { bucket.files += 1; bucket.raw += size.raw; bucket.gzip += size.gzip; }
      }
    }
    return { ...total, byClass };
  };

  // Tembel kökler: telefon kapanışından ve onların altından (transitif) erişilen her dinamik import hedefi.
  const lazy = [];
  const lazySeen = new Set();
  const queue = dynamicRoots(manifest, phoneKeys).map((root) => ({ root, from: entry }));
  const reachable = new Set(phoneKeys);
  while (queue.length) {
    const { root, from } = queue.shift();
    if (lazySeen.has(root) || phoneSet.has(root)) continue;
    lazySeen.add(root);
    const closure = staticClosure(manifest, root);
    const added = closure.filter((key) => !phoneSet.has(key));
    for (const key of closure) reachable.add(key);
    lazy.push({ root: chunkLabel(manifest, root), file: manifest[root].file, class: profileOf(root).primary, importer: chunkLabel(manifest, from), added: { ...summarize(added), chunks: added.map((key) => chunkLabel(manifest, key)) } });
    for (const next of dynamicRoots(manifest, closure)) if (!lazySeen.has(next)) queue.push({ root: next, from: root });
  }

  // Admin grafiğinin tamamı (statik + tembel), birincil sınıfa göre.
  const groups = {};
  const listed = new Set();
  for (const key of reachable) {
    const cls = profileOf(key).primary;
    for (const file of filesOf(key)) {
      if (listed.has(file)) continue;
      listed.add(file);
      const size = sizeOf(file);
      groups[cls] ??= { ...emptyTotal(), list: [] };
      groups[cls].files += 1;
      groups[cls].raw += size.raw;
      groups[cls].gzip += size.gzip;
      groups[cls].list.push(file);
    }
  }
  for (const bucket of Object.values(groups)) bucket.list.sort();

  // İhlaller: telefon kapanışındaki her parçada yasak sınıf → o sınıfa statik kenarla giren (sınıf dışı) modül.
  const chainTo = shortestPaths(manifest, entry);
  const fileToKey = new Map(phoneKeys.map((key) => [manifest[key].file, key]));
  const violations = new Map();
  const add = (id, data, importerKey, target) => {
    const current = violations.get(id) ?? { id, ...data, importerChunks: [], via: chainTo(importerKey), targets: [] };
    const label = chunkLabel(manifest, importerKey);
    if (!current.importerChunks.includes(label)) current.importerChunks.push(label);
    if (target && !current.targets.includes(target) && current.targets.length < 10) current.targets.push(target);
    violations.set(id, current);
  };
  for (const key of phoneKeys) {
    const file = manifest[key].file;
    for (const cls of profileOf(key).contains.filter((name) => forbidden.includes(name))) {
      const edges = graph.edges.filter((edge) => edge.toChunk === file && fileToKey.has(edge.fromChunk) && moduleClass(edge.to, edge.toGroup) === cls && moduleClass(edge.from, edge.fromGroup) !== cls);
      if (edges.length) {
        for (const edge of edges) add(`${cls} <- ${edge.from}`, { class: cls, importer: edge.from, attributed: true }, fileToKey.get(edge.fromChunk), edge.to);
        continue;
      }
      // Kenar yoksa (grafik eksik/yeni kalıp) ihlal yine sayılır: içe aktaran parça etiketiyle, açıklanamadı olarak.
      const importers = phoneKeys.filter((other) => other !== key && (manifest[other].imports ?? []).includes(key));
      for (const importerKey of importers.length ? importers : [key]) {
        const label = chunkLabel(manifest, importerKey);
        add(`${cls} <- ?${label}`, { class: cls, importer: `?${label}`, attributed: false }, importerKey, chunkLabel(manifest, key));
      }
    }
  }

  return {
    schema: REPORT_SCHEMA,
    entry,
    profile: 'phone',
    rule: `telefon statik kapanışında şu sınıflardan modül yok: ${forbidden.join(', ')}`,
    forbidden: [...forbidden],
    measurement: {
      gzipLevel: GZIP_LEVEL,
      gzip: 'node:zlib gzipSync, seviye 9, dosya başına; bayt',
      raw: 'diskteki dosya boyutu; bayt',
      units: 'rapor alanları bayt; özet KiB = 1024 bayt. Vite çıktısındaki kB = 1000 bayt ve kendi gzip hesabıdır, karşılaştırılamaz',
      scope: 'manifest parçasının JS dosyası + css[] dosyaları; font/görsel (assets[]) dahil değil; her dosya bir kez sayılır',
      sources: ['.vite/manifest.json', '.vite/delivery-graph.json'],
    },
    phone: { static: { ...summarize(phoneKeys), chunks: phoneKeys.map(describe) } },
    lazy,
    groups,
    violations: [...violations.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  };
}

/** Ratchet/strict karşılaştırması; baseline yalnız kimlik listesidir. */
export function compareBaseline(current, baseline, { strict }) {
  const ids = [...new Set(current)].sort();
  const base = new Set(baseline);
  const added = ids.filter((id) => !base.has(id));
  const known = ids.filter((id) => base.has(id));
  const resolved = [...base].filter((id) => !ids.includes(id)).sort();
  const warnings = resolved.length ? [`baseline daraltılabilir: ${resolved.join(', ')} artık oluşmuyor; scripts/delivery-baseline.json listesinden silin`] : [];
  const status = strict ? (ids.length ? 'fail' : 'pass') : (added.length ? 'fail' : 'pass');
  return { status, added, known, resolved, warnings };
}
// #endregion

// #region çıktı
const row = (name, total) => `  ${name.padEnd(9)} ${String(total.files).padStart(5)} ${String(total.raw).padStart(10)} ${String(total.gzip).padStart(10)}   (${kib(total.raw)} / ${kib(total.gzip)} KiB)`;

/** İnsan için özet: her sınıf için dosya sayısı, ham ve gzip bayt. */
export function formatSummary(report) {
  const lines = [];
  const phone = report.phone.static;
  lines.push(`check-delivery: ${report.entry} telefon profili (statik kapanış), mod ${report.mode}`);
  lines.push(`  statik kapanış: ${phone.files} dosya, ham ${phone.raw} B (${kib(phone.raw)} KiB), gzip ${phone.gzip} B (${kib(phone.gzip)} KiB)`);
  lines.push(`  ${'sınıf'.padEnd(9)} ${'dosya'.padStart(5)} ${'ham B'.padStart(10)} ${'gzip B'.padStart(10)}`);
  for (const [name, total] of Object.entries(phone.byClass).sort()) lines.push(row(name, total));
  const kinds = {};
  for (const entry of report.lazy) kinds[entry.class] = (kinds[entry.class] ?? 0) + 1;
  lines.push(`  tembel kökler: ${report.lazy.length} (${Object.entries(kinds).sort().map(([name, count]) => `${count} ${name}`).join(', ') || 'yok'})`);
  lines.push(`  ${report.entry} grafiğinin tamamı (statik + tembel), birincil sınıfa göre:`);
  for (const [name, total] of Object.entries(report.groups).sort()) lines.push(row(name, total));
  const known = new Set(report.baseline?.known ?? []);
  lines.push(`  ihlaller (${report.violations.length}; yasak: ${report.forbidden.join(', ')}):${report.violations.length ? '' : ' yok'}`);
  const tag = (id) => (report.baseline?.path ? (known.has(id) ? '  [baseline]' : '  [YENİ]') : '');
  for (const violation of report.violations) lines.push(`    ${violation.id}${tag(violation.id)}  yol: ${violation.via.join(' > ')}`);
  for (const warning of report.warnings ?? []) lines.push(`  uyarı: ${warning}`);
  const added = report.baseline?.added ?? [];
  const verdict = report.status === 'pass'
    ? `PASS (${report.mode}${report.mode === 'ratchet' ? `: ${known.size} bilinen ihlal, yeni yok` : ': ihlal yok'})`
    : report.mode === 'strict'
      ? `FAIL (strict: ${report.violations.length} ihlal)`
      : `FAIL (ratchet: yeni ihlal: ${added.join(', ')})`;
  lines.push(`  sonuç: ${verdict}`);
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
/** Rapor dist ile yayınlanır: yol depo köküne göreli yazılır, kök dışındaysa yalnız dosya adı (mutlak yol yok). */
const publicPath = (file) => {
  const rel = path.relative(REPO_ROOT, file);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel.split(path.sep).join('/') : path.basename(file);
};

/** Dist'i okur, çözümler, baseline ile karşılaştırır, raporu yazar. */
export async function runCheck({ distDir, baselinePath, reportPath, strict = false, entry = DEFAULT_ENTRY }) {
  const manifest = await readJson(path.join(distDir, '.vite', 'manifest.json'), `${path.join(distDir, '.vite', 'manifest.json')} yok: önce pnpm build (vite.config.ts build.manifest)`);
  const graph = await readJson(path.join(distDir, '.vite', 'delivery-graph.json'), `${path.join(distDir, '.vite', 'delivery-graph.json')} yok: vite.config.ts deliveryGraph eklentisiyle pnpm build gerekli`);
  if (graph.schema !== GRAPH_SCHEMA) throw new InputError(`delivery-graph schema ${graph.schema}; beklenen ${GRAPH_SCHEMA}`);
  // Ratchet baseline ister; strict baseline'ı yalnız bilgi için okur (yoksa boş sayar, sonuç değişmez).
  let baseline = { violations: [] };
  let baselineUsed = null;
  try {
    baseline = await readJson(baselinePath, `baseline yok: ${baselinePath}`);
    baselineUsed = baselinePath;
  } catch (error) {
    if (!strict) throw error;
  }
  if (!Array.isArray(baseline.violations)) throw new InputError(`baseline violations dizisi değil: ${baselinePath}`);
  if (baseline.entry && baseline.entry !== entry) {
    if (!strict) throw new InputError(`baseline girişi ${baseline.entry}, kontrol edilen ${entry}`);
    baseline = { violations: [] };
    baselineUsed = null;
  }
  const sizes = new Map();
  const files = new Set(Object.values(manifest).flatMap((chunk) => [chunk.file, ...(chunk.css ?? [])]));
  for (const file of files) {
    try {
      sizes.set(file, measureBuffer(await readFile(path.join(distDir, file))));
    } catch {
      sizes.set(file, null);
    }
  }
  const sizeOf = (file) => {
    const size = sizes.get(file);
    if (!size) throw new InputError(`manifest dosyası dist içinde yok: ${file}`);
    return size;
  };
  const analysis = analyzeDelivery({ manifest, graph, sizeOf, entry });
  const comparison = compareBaseline(analysis.violations.map((violation) => violation.id), baseline.violations, { strict });
  const report = {
    ...analysis,
    mode: strict ? 'strict' : 'ratchet',
    status: comparison.status,
    baseline: { path: baselineUsed ? publicPath(baselineUsed) : null, ids: [...baseline.violations], added: comparison.added, known: comparison.known, resolved: comparison.resolved },
    warnings: comparison.warnings,
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return { report, exitCode: report.status === 'pass' ? 0 : 1 };
}

function parseArgs(argv, root) {
  const options = { strict: false, entry: DEFAULT_ENTRY };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--strict') options.strict = true;
    else if (arg === '--baseline' || arg === '--report' || arg === '--entry') {
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
    entry: options.entry,
    baselinePath: options.baseline ? path.resolve(root, options.baseline) : path.join(root, 'scripts', 'delivery-baseline.json'),
    reportPath: options.report ? path.resolve(root, options.report) : path.join(distDir, 'delivery-report.json'),
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
    const failing = report.mode === 'strict' ? report.violations.map((violation) => violation.id) : report.baseline.added;
    process.stderr.write(`check-delivery: FAIL — ${report.mode === 'strict' ? 'ihlal' : 'yeni ihlal'}: ${failing.join(', ')}\n`);
  }
  return exitCode;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      process.stderr.write(`check-delivery: ${error instanceof InputError ? '' : 'Hata: '}${error.message}\n`);
      process.exit(2);
    },
  );
}
// #endregion
