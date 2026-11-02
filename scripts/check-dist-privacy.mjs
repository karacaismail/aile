#!/usr/bin/env node
// dist-privacy kapısı: üretim çıktısında (dist/) özel yol, nesil kimliği, partition zarfı, kaynak manifesti,
// erişim denetimi notu, UUID yoğunluğu veya Google Sheet kimliği aranır. Herhangi bir bulgu → exit 1.
// Sentetik fixture'ın generation_id'si (fixtures/generation-synthetic/<id>/manifest.json) muaf tutulur;
// fixture zaten dist'e girmemelidir, bu yüzden partition zarfı kuralı muaf değildir.
// Bulgu çıktısı eşleşmeyi kırpar: gerçek kimlik veya yol hiçbir zaman tam olarak yazdırılmaz.
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TEXT_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.css', '.html', '.htm', '.json', '.map', '.txt', '.svg', '.xml', '.webmanifest', '.md', '.csv', '.webapp',
]);

export const UUID_DENSITY_LIMIT = 10;

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi;
const GENERATION = /generations\/([0-9a-f]{64})/gi;
const SPREADSHEET = /spreadsheets\/d\/([A-Za-z0-9_-]{30,})/g;
// Serileştirilmiş zarf: {"schemaVersion":1,"collection":"…" — hem saf JSON'da hem JS içine gömülü (kaçışlı) dizede.
const ENVELOPE_TEXT = /\\?"schemaVersion\\?"\s*:\s*1\s*,\s*\\?"collection\\?"\s*:\s*\\?"[a-z_]+\\?"/;
const SIMPLE = [
  ['kasa-work', /kasa-work/i],
  ['source-manifest', /source-manifest/i],
  ['access-audit', /access-audit/i],
];

const redact = s => (s.length <= 12 ? `${s.slice(0, 4)}…` : `${s.slice(0, 6)}…${s.slice(-2)}`);

const isEnvelopeJson = text => {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith('{')) return false;
  try {
    const value = JSON.parse(trimmed);
    return value?.schemaVersion === 1 && typeof value.collection === 'string' && Array.isArray(value.records);
  } catch {
    return false;
  }
};

/**
 * @param {string} text
 * @param {{ exemptGenerationIds?: string[] }} [options]
 * @returns {Array<{ rule: string, match: string, count?: number }>}
 */
export function scanText(text, { exemptGenerationIds = [] } = {}) {
  const findings = [];
  for (const [rule, re] of SIMPLE) {
    const m = re.exec(text);
    if (m) findings.push({ rule, match: redact(m[0]) });
  }
  const exempt = new Set(exemptGenerationIds.map(id => id.toLowerCase()));
  for (const m of text.matchAll(GENERATION)) {
    if (exempt.has(m[1].toLowerCase())) continue;
    findings.push({ rule: 'generation-id', match: redact(m[1]) });
    break;
  }
  if (isEnvelopeJson(text) || ENVELOPE_TEXT.test(text)) findings.push({ rule: 'partition-envelope', match: 'schemaVersion:1 + collection' });
  const uuidCount = (text.match(UUID) ?? []).length;
  if (uuidCount > UUID_DENSITY_LIMIT) findings.push({ rule: 'uuid-density', match: `${uuidCount} UUID`, count: uuidCount });
  const sheet = SPREADSHEET.exec(text);
  SPREADSHEET.lastIndex = 0;
  if (sheet) findings.push({ rule: 'spreadsheet-id', match: redact(sheet[1]) });
  return findings;
}

async function* walk(dir, base = dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full, base);
    else if (entry.isFile()) yield path.relative(base, full);
  }
}

/**
 * @param {string} distDir
 * @param {{ exemptGenerationIds?: string[] }} [options]
 * @returns {Promise<Array<{ rule: string, match: string, count?: number, file: string }>>}
 */
export async function scanDist(distDir, options = {}) {
  const findings = [];
  for await (const file of walk(distDir)) {
    if (!TEXT_EXTENSIONS.has(path.extname(file).toLowerCase())) continue;
    const text = await readFile(path.join(distDir, file), 'utf8');
    for (const f of scanText(text, options)) findings.push({ ...f, file });
  }
  return findings.sort((a, b) => a.file.localeCompare(b.file) || a.rule.localeCompare(b.rule));
}

/** fixtures/generation-synthetic/<id>/manifest.json dosyalarından generation_id okur; klasör yoksa []. */
export async function loadSyntheticGenerationIds(fixtureRoot) {
  let entries;
  try {
    entries = await readdir(fixtureRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const ids = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const manifest = JSON.parse(await readFile(path.join(fixtureRoot, entry.name, 'manifest.json'), 'utf8'));
      if (manifest.synthetic === true && /^[a-f0-9]{64}$/.test(manifest.generation_id)) ids.push(manifest.generation_id);
    } catch {
      // manifest yok veya bozuk: muafiyet verilmez
    }
  }
  return ids;
}

async function main(argv) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const distDir = path.resolve(root, argv[0] ?? 'dist');
  const exists = await stat(distDir).then(s => s.isDirectory(), () => false);
  if (!exists) {
    console.log(`dist-privacy: dist yok (${path.relative(root, distDir) || '.'}); taranacak çıktı yok, kapı atlandı.`);
    return 0;
  }
  const exemptGenerationIds = await loadSyntheticGenerationIds(path.join(root, 'fixtures', 'generation-synthetic'));
  const findings = await scanDist(distDir, { exemptGenerationIds });
  for (const f of findings) console.error(`dist-privacy: ${f.rule}  ${f.file}  (${f.match})`);
  console.log(`dist-privacy: ${findings.length} bulgu, ${path.relative(root, distDir)} tarandı.`);
  return findings.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(code => process.exit(code), error => { console.error(`Hata: ${error.message}`); process.exit(2); });
}
