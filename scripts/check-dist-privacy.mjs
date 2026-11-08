#!/usr/bin/env node
// dist-privacy kapısı: üretim çıktısında (dist/) özel veri izi aranır. Herhangi bir bulgu → exit 1.
// Kurallar: kasa-work / mutlak kullanıcı yolu (/Users, /home, /var/folders, C:\Users), AILE_GENERATION_DIR değeri,
// Google Sheets kimliği (URL, çıplak sabit, ortam değeri), Apps Script /exec adresi ve dağıtım kimliği, e-posta adresi,
// nesil kimliği yolu, nesil manifesti alanları, partition zarfı ve kayıt parçaları, kaynak manifesti, erişim denetimi
// notu, UUID yoğunluğu, source map içinde gömülü kaynak (sourcesContent; satır içi data: map'ler çözülerek taranır),
// emeklilik profili parçası (dogumTarihi, ilkSigortaGirisi, sgkReferansAylik, kayitliGun, kazanc alanı değeriyle),
// AILE_EMEKLILIK_PROFILE değeri (yol) ve o dosyadaki doğum tarihi (kapı anında okunur, hiçbir zaman yazdırılmaz).
// Emeklilik profili için izinli değerler yalnız fixtures/emeklilik/profil-sentetik.json ('sentetik: true') değerleridir.
// İzinli sentetik değerler: fixtures/generation-synthetic/<id>/manifest.json generation_id'si (yalnız generations/<id>
// yolu için) ve SYNTHETIC_SHEET_IDS. Fixture'ın kendisi dist'e girmemelidir; manifest/partition kuralları muaf değildir.
// Kapı sentetik derleme içindir (VITE_BUDGET_SHEET_ID=synthetic-budget-sheet-2098). Yayın derlemesi gerçek Sheet
// kimliğini bilerek gömer (docs/BUDGET-VEHICLE.md); o derleme bu kapıdan geçmez.
// Bulgu çıktısı eşleşmeyi kırpar; ortam değerleri yalnız değişken adıyla anılır, hiçbir zaman tam yazdırılmaz.
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TEXT_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.css', '.html', '.htm', '.json', '.map', '.txt', '.svg', '.xml', '.webmanifest', '.md', '.csv', '.webapp',
]);

export const UUID_DENSITY_LIMIT = 10;
/** Ortamdan gelen özel değerler bundan kısaysa (ör. "/" veya ".") her metinde eşleşeceği için yok sayılır. */
export const MIN_PRIVATE_VALUE_LENGTH = 8;
/** Testlerde, CI'da ve Playwright sunucusunda kullanılan sentetik bütçe tablosu kimliği; dist'te bulunması serbesttir. */
export const SYNTHETIC_SHEET_IDS = Object.freeze(['synthetic-budget-sheet-2098']);
export const SYNTHETIC_BUILD_HINT = 'VITE_BUDGET_SHEET_ID=synthetic-budget-sheet-2098 pnpm build';

// Ortamdan okunan özel değerler → kural. Değer dist'te herhangi bir biçimde geçerse ihlaldir.
const PRIVATE_ENV = [
  ['AILE_GENERATION_DIR', 'generation-dir'],
  ['VITE_BUDGET_SHEET_ID', 'spreadsheet-id'],
  ['VITE_API_URL', 'apps-script-url'],
  ['AILE_EMEKLILIK_PROFILE', 'retirement-profile-path'],
];
/** Değeri dosya sistemi yolu olan kurallar: sondaki eğik çizgi kırpılır, göreli değer çalışma klasörüne göre de aranır. */
const PATH_RULES = new Set(['generation-dir', 'retirement-profile-path']);

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi;
const ANY_UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const GENERATION = /generations\/([0-9a-f]{64})/gi;
// Eğik çizgi JSON/JS içinde kaçışlı (\/) veya URL kodlu (%2F) olabilir.
const SLASH = String.raw`(?:\\?\/|%2[Ff])`;

/**
 * Serileştirilmiş veri alanı: anahtar tırnaklı ("k"), kaçışlı (\"k\"), tek tırnaklı veya çıplak (JS nesnesi) olabilir;
 * değer bir dize sabitiyle başlar. Şema/erişim kodu (k:z.string(), k:T(), n.k) değer sabiti taşımadığı için eşleşmez.
 */
const keyed = (key, value, flags = '') =>
  new RegExp(String.raw`(?<![\w$])\\?["']?(?:${key})\\?["']?\s*:\s*\\?["'\x60]${value}`, flags);

const SIMPLE = [
  ['kasa-work', /kasa[-_]work/i],
  ['source-manifest', /source-manifest/i],
  ['access-audit', /access-audit/i],
];

const ABSOLUTE_USER_PATH = [
  // macOS /Users/<ad>, Linux /home/<ad> (CI: /home/runner), macOS geçici /var/folders; file:///Users/... dahil.
  // Önünde sözcük, nokta, tire veya # varsa (src/home/x, https://alan/home, #/home) depo göreli yol ya da rotadır.
  /(?<![\w.$#-])((?:\/Users|\/home|(?:\/private)?\/var\/folders)\/)[\w.-]+/,
  // Windows C:\Users\<ad> (JS içinde \\ kaçışlı) veya C:/Users/<ad>. Grup 1 kök; bulgu kullanıcı adını yazmaz.
  /(?<![A-Za-z0-9])([A-Za-z]:(?:\\{1,2}|\/)+Users(?:\\{1,2}|\/)+)[\w. -]+/,
];

const SHEET_URL = new RegExp(
  String.raw`spreadsheets(?:${SLASH}u${SLASH}\d+)?${SLASH}(?:d${SLASH}(?:e${SLASH})?)?([A-Za-z0-9_-]{20,})`, 'g',
);
// Çıplak tırnaklı sabit: Sheets kimliği 44 karakterdir ve 1 (eski biçimde 0) ile başlar.
const SHEET_LITERAL = /(?<=["'\x60])[01][A-Za-z0-9_-]{43}(?=\\?["'\x60])/g;

const APPS_SCRIPT = [
  // /macros/s/<id>/exec, Workspace biçimi /a/macros/<alan>/s/<id>/exec, test dağıtımı /dev.
  new RegExp(String.raw`script\.google\.com(?:${SLASH}[\w.%-]+){0,4}?${SLASH}s${SLASH}[A-Za-z0-9_-]{20,}${SLASH}(?:exec|dev)(?![\w-])`),
  new RegExp(String.raw`script\.googleusercontent\.com${SLASH}macros${SLASH}echo\?[^\s"'\x60]*user_content_key=[A-Za-z0-9_-]{20,}`),
  // Adres parçalardan kurulsa da dağıtım kimliği tek başına ihlaldir.
  /(?<![\w-])AKfyc[A-Za-z0-9_-]{30,}/,
];

const EMAIL = /(?<![\w.%+-])[A-Za-z0-9][\w.%+-]*@((?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,24})(?![\w-])/g;
// RFC 2606 / 6761 ayrılmış alan adları örnek adres içindir; dosya uzantısı TLD'si (logo@2x.png) adres değildir.
const RESERVED_EMAIL_DOMAIN = /(?:^|\.)(?:example\.(?:com|net|org)|example|test|invalid|localhost)$/i;
const FILE_EXTENSION_TLD = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif', 'ico', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'css', 'json', 'map', 'html',
  'txt', 'md', 'woff', 'woff2', 'ttf', 'otf', 'wasm',
]);

// Nesil manifesti parçası: kimlik/özet değeri taşıyan alanlar ve files[] girdisinin partition yolu. Değer taşımayan
// sabitler (storage_policy:`private_only`) ve yardım metnindeki örnek yol veri değildir; bulgu üretmez.
const GENERATION_MANIFEST = [
  keyed('generation_id', '[0-9a-f]{64}', 'i'),
  keyed('sha256', '[0-9a-f]{64}', 'i'),
  keyed('path', String.raw`data\/[a-z_]+\/(?:[\w.-]+\/)*\d{5}\.json`),
];
// Partition kaydı parçası: kiracı veya kaynak kimliği UUID değeriyle.
const GENERATION_RECORD = keyed('tenant_id|source_id', ANY_UUID, 'i');

// Partition zarfı: {"schemaVersion":1,"collection":"…" (eski sıra), sıralı anahtarlı {"collection":"…","records":[
// ve kapanış ],"schemaVersion":1}. Çıplak anahtarlı JS nesnesinde records boş olmayan bir dizi sabiti olmalıdır
// (kod {schemaVersion:1,collection:`x`,records:e} biçimindedir).
const ENVELOPE = [
  /\\?"schemaVersion\\?"\s*:\s*1\s*,\s*\\?"collection\\?"\s*:\s*\\?"[a-z_]+\\?"/,
  /\\?"collection\\?"\s*:\s*\\?"[a-z_]+\\?"\s*,\s*\\?"records\\?"\s*:\s*\[/,
  /\]\s*,\s*\\?"schemaVersion\\?"\s*:\s*1\s*\}/,
  /(?<![\w$])collection\s*:\s*["'\x60][a-z_]+["'\x60]\s*,\s*records\s*:\s*\[\s*\{/,
];

// Emeklilik profili parçası (src/admin/emeklilik/contract.ts EmeklilikProfili): alan adı ve değer sabiti birlikte. Anahtar
// tırnaklı, kaçışlı ya da çıplak; aradaki boşluk JSON.stringify ile gömülmüş satır sonu (\n) olabilir. Grup 1 değerdir;
// yalnız sentetik fikstürün aynı alandaki değeri muaftır. Şema/erişim kodu (dogumTarihi:Tt, p.kayitliGun.gun) eşleşmez.
const GAP = String.raw`(?:\s|\\[nrt])*`;
const QUOTE = String.raw`\\?["'\x60]`;
const FIELD = key => String.raw`(?<![\w$])\\?["']?${key}\\?["']?${GAP}:${GAP}`;
const RETIREMENT_PROFILE = [
  ['dogumTarihi', new RegExp(`${FIELD('dogumTarihi')}${QUOTE}(\\d{4}-\\d{2}-\\d{2})`, 'g')],
  ['ilkSigortaGirisi', new RegExp(`${FIELD('ilkSigortaGirisi')}${QUOTE}(\\d{4}-\\d{2}-\\d{2})`, 'g')],
  ['sgkReferansAylik', new RegExp(`${FIELD('sgkReferansAylik')}\\{${GAP}${FIELD('tl')}${QUOTE}(\\d+(?:\\.\\d{1,2})?)`, 'g')],
  ['kayitliGun', new RegExp(`${FIELD('kayitliGun')}\\{${GAP}${FIELD('gun')}(\\d+)`, 'g')],
  ['kazanc', new RegExp(`${FIELD('kazanc')}\\{${GAP}${FIELD('sonPekTl')}${QUOTE}(\\d+(?:\\.\\d{1,2})?)`, 'g')],
];
/** Sentetik profilden muaf değerler: RETIREMENT_PROFILE alan adı → değer metni. */
const syntheticRetirementFields = profile => ({
  dogumTarihi: profile?.dogumTarihi,
  ilkSigortaGirisi: profile?.ilkSigortaGirisi,
  sgkReferansAylik: profile?.sgkReferansAylik?.tl,
  kayitliGun: profile?.kayitliGun?.gun === undefined ? undefined : String(profile.kayitliGun.gun),
  kazanc: profile?.kazanc?.sonPekTl,
});

const SOURCES_CONTENT = /\\?"sourcesContent\\?"\s*:\s*\[\s*(?:null\s*,\s*)*\\?"/;
const INLINE_MAP = /sourceMappingURL=data:application\/json(?:;charset=[\w-]+)?(;base64)?,([^\s*"'\x60]+)/g;

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

/** 44 karakterlik aday gerçekten rastgele kimlik gibi mi: karışık harf, rakam ve az ayırıcı (sözcüklü adlar elenir). */
const looksLikeSheetId = id => {
  const body = id.slice(1);
  return (body.match(/[A-Z]/g) ?? []).length >= 2 && (body.match(/[a-z]/g) ?? []).length >= 2 && /\d/.test(body)
    && (body.match(/[_-]/g) ?? []).length <= 4;
};

/** Satır içi data: source map'leri çözer; çözülen JSON diğer kurallarla birlikte taranır. */
const decodeInlineMaps = text => {
  const decoded = [];
  for (const [, base64, payload] of text.matchAll(INLINE_MAP)) {
    try {
      decoded.push(base64 ? Buffer.from(payload, 'base64').toString('utf8') : decodeURIComponent(payload));
    } catch {
      // bozuk kodlama: içerik okunamıyor, ham metin taraması yeterli
    }
  }
  return decoded;
};

/**
 * Ortamdaki özel değerleri kurallarıyla döndürür. Sentetik Sheet kimliği, boş ve MIN_PRIVATE_VALUE_LENGTH'ten kısa
 * değerler atlanır. Göreli AILE_GENERATION_DIR çalışma klasörüne göre çözülmüş biçimiyle de aranır.
 * @param {Record<string, string | undefined>} [env]
 * @param {{ cwd?: string, allowedSheetIds?: readonly string[] }} [options]
 * @returns {Array<{ rule: string, name: string, value: string }>}
 */
export function privateValuesFromEnv(env = process.env, { cwd = process.cwd(), allowedSheetIds = SYNTHETIC_SHEET_IDS } = {}) {
  const values = [];
  for (const [name, rule] of PRIVATE_ENV) {
    const raw = env[name]?.trim();
    if (!raw) continue;
    if (rule === 'spreadsheet-id' && allowedSheetIds.includes(raw)) continue;
    const variants = new Set([raw]);
    if (PATH_RULES.has(rule)) {
      const trimmed = raw.replace(/[\\/]+$/, '');
      variants.delete(raw);
      variants.add(trimmed);
      if (trimmed && !path.isAbsolute(trimmed)) variants.add(path.resolve(cwd, trimmed));
    }
    for (const value of variants) {
      if (value.length < MIN_PRIVATE_VALUE_LENGTH) continue;
      values.push({ rule, name, value });
      const escaped = JSON.stringify(value).slice(1, -1);
      if (escaped !== value) values.push({ rule, name, value: escaped });
    }
  }
  return values;
}

/** JSON dosyasını okur; yoksa ya da bozuksa null. */
async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Sentetik emeklilik profilinin (fixtures/emeklilik/profil-sentetik.json) izinli alan değerleri. Dosya yoksa, bozuksa ya da
 * 'sentetik: true' taşımıyorsa muafiyet verilmez ({}).
 * @param {string} file
 * @returns {Promise<Record<string, string>>}
 */
export async function loadSyntheticRetirementValues(file) {
  const profile = await readJson(file);
  if (profile?.sentetik !== true) return {};
  return Object.fromEntries(Object.entries(syntheticRetirementFields(profile)).filter(([, value]) => typeof value === 'string' && value));
}

/**
 * AILE_EMEKLILIK_PROFILE dosyasındaki doğum tarihi: dist'te hangi bağlamda geçerse geçsin ihlaldir (kural
 * retirement-profile, bulgu yalnız değişken adını yazar). Sentetik, okunamayan ya da tanımsız profil değer üretmez.
 * Yalnız doğum tarihi alınır: diğer alanlar (tutar, gün, giriş tarihi) mevzuat sabitleriyle çakışıp yanlış alarm verebilir.
 * @param {Record<string, string | undefined>} [env]
 * @param {{ cwd?: string }} [options]
 * @returns {Promise<Array<{ rule: string, name: string, value: string }>>}
 */
export async function retirementProfileValues(env = process.env, { cwd = process.cwd() } = {}) {
  const raw = env.AILE_EMEKLILIK_PROFILE?.trim();
  if (!raw) return [];
  const profile = await readJson(path.resolve(cwd, raw));
  if (!profile || profile.sentetik === true) return [];
  const birth = profile.dogumTarihi;
  if (typeof birth !== 'string' || birth.length < MIN_PRIVATE_VALUE_LENGTH) return [];
  return [{ rule: 'retirement-profile', name: 'AILE_EMEKLILIK_PROFILE', value: birth }];
}

/**
 * @param {string} text
 * @param {{ exemptGenerationIds?: string[], allowedSheetIds?: readonly string[],
 *   privateValues?: Array<{ rule: string, name: string, value: string }>,
 *   exemptRetirementValues?: Record<string, string> }} [options]
 * @returns {Array<{ rule: string, match: string, count?: number }>}
 */
export function scanText(text, { exemptGenerationIds = [], allowedSheetIds = SYNTHETIC_SHEET_IDS, privateValues = [], exemptRetirementValues = {} } = {}) {
  const findings = [];
  // Kural başına ilk eşleşme yeterli; dosya ve kural birlikte bildirilir.
  const add = (rule, match, extra) => {
    if (!findings.some(f => f.rule === rule)) findings.push({ rule, match, ...extra });
  };
  const inlineMaps = decodeInlineMaps(text);
  const haystack = inlineMaps.length ? [text, ...inlineMaps].join('\n') : text;

  for (const [rule, re] of SIMPLE) {
    const m = re.exec(haystack);
    if (m) add(rule, redact(m[0]));
  }
  for (const re of ABSOLUTE_USER_PATH) {
    const m = re.exec(haystack);
    if (m) add('absolute-user-path', `${m[1]}…`);
  }
  for (const { rule, name, value } of privateValues) {
    if (haystack.includes(value)) add(rule, name);
  }

  for (const [field, re] of RETIREMENT_PROFILE) {
    if (findings.some(f => f.rule === 'retirement-profile')) break;
    for (const m of haystack.matchAll(re)) {
      if (exemptRetirementValues[field] === m[1]) continue;
      add('retirement-profile', field);
      break;
    }
  }

  const exempt = new Set(exemptGenerationIds.map(id => id.toLowerCase()));
  for (const m of haystack.matchAll(GENERATION)) {
    if (exempt.has(m[1].toLowerCase())) continue;
    add('generation-id', redact(m[1]));
    break;
  }
  for (const re of GENERATION_MANIFEST) {
    const m = re.exec(haystack);
    if (m) add('generation-manifest', redact(m[0]));
  }
  if (isEnvelopeJson(text) || ENVELOPE.some(re => re.test(haystack))) add('partition-envelope', 'schemaVersion:1 + collection');
  const record = GENERATION_RECORD.exec(haystack);
  if (record) add('generation-record', redact(record[0]));
  const uuidCount = (haystack.match(UUID) ?? []).length;
  if (uuidCount > UUID_DENSITY_LIMIT) add('uuid-density', `${uuidCount} UUID`, { count: uuidCount });

  const allowedSheets = new Set(allowedSheetIds);
  for (const m of haystack.matchAll(SHEET_URL)) {
    if (allowedSheets.has(m[1])) continue;
    add('spreadsheet-id', redact(m[1]));
    break;
  }
  for (const m of haystack.matchAll(SHEET_LITERAL)) {
    if (allowedSheets.has(m[0]) || !looksLikeSheetId(m[0])) continue;
    add('spreadsheet-id', redact(m[0]));
    break;
  }
  for (const re of APPS_SCRIPT) {
    const m = re.exec(haystack);
    if (m) add('apps-script-url', redact(m[0]));
  }
  for (const m of haystack.matchAll(EMAIL)) {
    const domain = m[1];
    if (RESERVED_EMAIL_DOMAIN.test(domain) || FILE_EXTENSION_TLD.has(domain.slice(domain.lastIndexOf('.') + 1).toLowerCase())) continue;
    add('email', `…@….${domain.slice(domain.lastIndexOf('.') + 1)}`);
    break;
  }
  if (SOURCES_CONTENT.test(haystack)) add('sourcemap-content', inlineMaps.length ? 'sourcesContent (satır içi)' : 'sourcesContent');
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
 * @param {Parameters<typeof scanText>[1]} [options]
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

async function main(argv, env = process.env) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const distDir = path.resolve(root, argv[0] ?? 'dist');
  const exists = await stat(distDir).then(s => s.isDirectory(), () => false);
  if (!exists) {
    console.log(`dist-privacy: dist yok (${path.relative(root, distDir) || '.'}); taranacak çıktı yok, kapı atlandı.`);
    return 0;
  }
  const exemptGenerationIds = await loadSyntheticGenerationIds(path.join(root, 'fixtures', 'generation-synthetic'));
  const exemptRetirementValues = await loadSyntheticRetirementValues(path.join(root, 'fixtures', 'emeklilik', 'profil-sentetik.json'));
  const privateValues = [...privateValuesFromEnv(env, { cwd: root }), ...(await retirementProfileValues(env, { cwd: root }))];
  const findings = await scanDist(distDir, { exemptGenerationIds, privateValues, exemptRetirementValues });
  for (const f of findings) console.error(`dist-privacy: ${f.rule}  ${f.file}  (${f.match})`);
  if (findings.some(f => f.rule === 'spreadsheet-id' || f.rule === 'apps-script-url')) {
    console.error(`dist-privacy: kapı sentetik derleme içindir; önce "${SYNTHETIC_BUILD_HINT}" ile derleyin (VITE_API_URL boş).`);
  }
  console.log(`dist-privacy: ${findings.length} bulgu, ${path.relative(root, distDir)} tarandı.`);
  return findings.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(code => process.exit(code), error => { console.error(`Hata: ${error.message}`); process.exit(2); });
}
