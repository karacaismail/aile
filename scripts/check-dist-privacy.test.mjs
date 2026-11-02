// dist-privacy kapısı: üretim çıktısına (dist/) özel yol, mutlak kullanıcı yolu, AILE_GENERATION_DIR değeri, nesil
// kimliği, manifest/partition parçası, kaynak manifesti, erişim denetimi notu, UUID yoğunluğu, Sheet kimliği, Apps
// Script adresi, e-posta veya source map kaynak içeriği sızmadığını doğrular. Her kural için sentetik ihlal enjekte
// edilir ve temiz (gerçek derlemeden alınmış) parçalarda yanlış alarm olmadığı gösterilir. Testler yalnız sentetik
// değer kullanır; gerçek aile verisi, gerçek Sheet/dağıtım kimliği, kişi adresi veya yol içermez.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  scanText, scanDist, loadSyntheticGenerationIds, privateValuesFromEnv, TEXT_EXTENSIONS, SYNTHETIC_SHEET_IDS, MIN_PRIVATE_VALUE_LENGTH,
} from './check-dist-privacy.mjs';

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(root, 'scripts', 'check-dist-privacy.mjs');
const fixtureRoot = path.join(root, 'fixtures', 'generation-synthetic');
const node = process.execPath;

const fakeHex64 = 'ab'.repeat(32);
const fakeUuid = i => `0000${String(i).padStart(4, '0')}-0000-5000-8000-000000000000`;
const fakeSheetId = 'A'.repeat(44);
const rules = findings => findings.map(f => f.rule);
const sortedRules = findings => rules(findings).sort();
// Sentetik, gerçekçi görünen değerler: gerçek Sheet, dağıtım, kişi veya yol değildir.
const fakeRealishSheetId = ('1Sn7eT' + 'kOrNk0Tb'.repeat(5)).slice(0, 44);
const fakeDeploymentId = `AKfycb${'Sn7eTkOrNk0Tb_x-'.repeat(5)}`;
const fakeEmail = ['ornek.kisi', 'aile-posta-sentetik.net'].join('@');
const fakeUserPath = '/Users/ornek-kisi/Developer/aile/src/main.tsx';
const fakeTenantUuid = '11111111-2222-5333-8444-555555555555';
// Ortamı test sürecinden sızdırmamak için CLI alt süreci bu üç değişken olmadan çalışır.
const cleanEnv = (extra = {}) => {
  const env = { ...process.env };
  for (const key of ['AILE_GENERATION_DIR', 'VITE_BUDGET_SHEET_ID', 'VITE_API_URL']) delete env[key];
  return { ...env, ...extra };
};

let scratch;
beforeAll(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), 'aile-dist-privacy-'));
});
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe('scanText', () => {
  it('temiz metinde bulgu yok', () => {
    expect(scanText('const a = 1; export default a;')).toEqual([]);
  });

  it('kasa-work yolu ihlal', () => {
    // Mutlak yol ayrıca absolute-user-path kuralını da tetikler; göreli yol yalnız kasa-work.
    expect(sortedRules(scanText('/Users/x/kasa-work/nesil'))).toEqual(['absolute-user-path', 'kasa-work']);
    expect(rules(scanText('../kasa-work/nesil'))).toEqual(['kasa-work']);
    expect(rules(scanText('KASA-WORK'))).toEqual(['kasa-work']);
  });

  it('generations/<64hex> ihlal; muaf sentetik kimlik değil', () => {
    const text = `fetch('/__aile/generation/generations/${fakeHex64}/manifest.json')`;
    expect(rules(scanText(text))).toEqual(['generation-id']);
    expect(scanText(text, { exemptGenerationIds: [fakeHex64] })).toEqual([]);
    expect(rules(scanText('generations/abc123'))).toEqual([]);
  });

  it('partition zarfı ihlal (saf JSON ve gömülü dize)', () => {
    const envelope = JSON.stringify({ schemaVersion: 1, collection: 'purchase_needs', records: [] });
    expect(rules(scanText(envelope))).toEqual(['partition-envelope']);
    expect(rules(scanText(`const x = ${JSON.stringify(envelope)};`))).toEqual(['partition-envelope']);
    expect(rules(scanText('const s = z.object({ schemaVersion: z.literal(1), collection: z.string() })'))).toEqual([]);
  });

  it('source-manifest ve ACCESS-AUDIT ihlal', () => {
    expect(rules(scanText('/PRIVATE/source-manifest.json'))).toEqual(['source-manifest']);
    expect(rules(scanText('see access-audit.md'))).toEqual(['access-audit']);
  });

  it('UUID yoğunluğu: tek dosyada 10 serbest, 11 ihlal', () => {
    const ten = Array.from({ length: 10 }, (_, i) => fakeUuid(i)).join('\n');
    const eleven = Array.from({ length: 11 }, (_, i) => fakeUuid(i)).join('\n');
    expect(scanText(ten)).toEqual([]);
    const found = scanText(eleven);
    expect(rules(found)).toEqual(['uuid-density']);
    expect(found[0].count).toBe(11);
  });

  it('spreadsheets/d/<30+> ihlal; kısa kimlik değil', () => {
    expect(rules(scanText(`https://docs.google.com/spreadsheets/d/${fakeSheetId}/gviz`))).toEqual(['spreadsheet-id']);
    expect(rules(scanText('spreadsheets/d/short'))).toEqual([]);
  });

  it('bulgu eşleşmeyi kırpar; tam kimliği çıktıya koymaz', () => {
    const [f] = scanText(`spreadsheets/d/${fakeSheetId}`);
    expect(f.match).not.toContain(fakeSheetId);
    expect(f.match.length).toBeLessThan(fakeSheetId.length);
  });
});

describe('loadSyntheticGenerationIds', () => {
  it('fixture manifestinden generation_id okur', async () => {
    const ids = await loadSyntheticGenerationIds(fixtureRoot);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(id).toMatch(/^[a-f0-9]{64}$/);
    const manifest = JSON.parse(await readFile(path.join(fixtureRoot, ids[0], 'manifest.json'), 'utf8'));
    expect(manifest.synthetic).toBe(true);
    expect(manifest.generation_id).toBe(ids[0]);
  });

  it('klasör yoksa boş liste', async () => {
    expect(await loadSyntheticGenerationIds(path.join(scratch, 'yok'))).toEqual([]);
  });
});

describe('scanDist', () => {
  it('metin dosyalarını tarar, ikili dosyaları atlar, dosya yolu bildirir', async () => {
    const dist = path.join(scratch, 'dist-a');
    await mkdir(path.join(dist, 'assets'), { recursive: true });
    await writeFile(path.join(dist, 'index.html'), '<!doctype html><title>aile</title>');
    await writeFile(path.join(dist, 'assets', 'app.js'), `const u = 'spreadsheets/d/${fakeSheetId}';`);
    await writeFile(path.join(dist, 'assets', 'photo.jpg'), Buffer.from(`kasa-work ${fakeHex64}`));
    const findings = await scanDist(dist);
    expect(findings.map(f => [f.rule, f.file])).toEqual([['spreadsheet-id', path.join('assets', 'app.js')]]);
  });

  it('sentetik nesil kimliği muaf, başka kimlik ihlal', async () => {
    const [syntheticId] = await loadSyntheticGenerationIds(fixtureRoot);
    const dist = path.join(scratch, 'dist-b');
    await mkdir(dist, { recursive: true });
    await writeFile(path.join(dist, 'ok.js'), `generations/${syntheticId}`);
    await writeFile(path.join(dist, 'bad.js'), `generations/${fakeHex64}`);
    const findings = await scanDist(dist, { exemptGenerationIds: [syntheticId] });
    expect(findings.map(f => f.file)).toEqual(['bad.js']);
  });

  it('TEXT_EXTENSIONS js/css/html/json/map/svg içerir, jpg/ttf içermez', () => {
    for (const ext of ['.js', '.css', '.html', '.json', '.map', '.svg', '.webmanifest', '.txt']) expect(TEXT_EXTENSIONS.has(ext)).toBe(true);
    for (const ext of ['.jpg', '.ttf', '.png', '.woff2']) expect(TEXT_EXTENSIONS.has(ext)).toBe(false);
  });
});

describe('CLI', () => {
  it('ihlalde exit 1 ve kural + dosya adı yazar', async () => {
    const dist = path.join(scratch, 'dist-cli-bad');
    await mkdir(dist, { recursive: true });
    await writeFile(path.join(dist, 'a.js'), 'ACCESS-AUDIT');
    const result = await run(node, [script, dist], { cwd: root, env: cleanEnv() }).catch(e => e);
    expect(result.code).toBe(1);
    expect(result.stdout + result.stderr).toMatch(/access-audit/);
    expect(result.stdout + result.stderr).toMatch(/a\.js/);
  });

  it('temiz dist exit 0', async () => {
    const dist = path.join(scratch, 'dist-cli-ok');
    await mkdir(dist, { recursive: true });
    await writeFile(path.join(dist, 'a.js'), 'export const ok = true;');
    const { stdout } = await run(node, [script, dist], { cwd: root, env: cleanEnv() });
    expect(stdout).toMatch(/0 bulgu/);
  });

  it('dist yoksa exit 0 ve bunu söyler', async () => {
    const { stdout } = await run(node, [script, path.join(scratch, 'dist-yok')], { cwd: root, env: cleanEnv() });
    expect(stdout).toMatch(/dist yok/i);
  });
});

describe('Google Sheets kimliği (sentetik kimlik izinli)', () => {
  it('URL bağlamındaki her biçim ihlal: /d/, /d/e/ yayın, /u/0/d/, Sheets API, kaçışlı eğik çizgi, 20+ karakter', () => {
    for (const text of [
      `https://docs.google.com/spreadsheets/d/${fakeRealishSheetId}/edit#gid=0`,
      `https://docs.google.com/spreadsheets/d/e/2PACX-1v${'Sn7eTkOrNk0Tb'.repeat(5)}/pubhtml`,
      `https://docs.google.com/spreadsheets/u/0/d/${fakeRealishSheetId}/gviz/tq`,
      `https://sheets.googleapis.com/v4/spreadsheets/${fakeRealishSheetId}/values/A1`,
      `{"u":"https:\\/\\/docs.google.com\\/spreadsheets\\/d\\/${fakeRealishSheetId}\\/edit"}`,
      `spreadsheets/d/${'b'.repeat(22)}/edit`,
    ]) expect(rules(scanText(text)), text).toEqual(['spreadsheet-id']);
  });

  it('URL dışında tırnaklı çıplak kimlik ihlal (VITE_BUDGET_SHEET_ID gömülü sabit)', () => {
    expect(rules(scanText(`const Tc="${fakeRealishSheetId}",Ec=\`https://docs.google.com/spreadsheets/d/\${Tc}/edit\`;`))).toEqual(['spreadsheet-id']);
    expect(rules(scanText(`JSON.parse("{\\"id\\":\\"${fakeRealishSheetId}\\"}")`))).toEqual(['spreadsheet-id']);
    expect(rules(scanText(`let a='${fakeRealishSheetId}'`))).toEqual(['spreadsheet-id']);
  });

  it('ortamdaki gerçek VITE_BUDGET_SHEET_ID değeri biçimi ne olursa olsun ihlal; değer çıktıya yazılmaz', () => {
    const value = 'ornek-gercek-tablo-kimligi-0001';
    const privateValues = privateValuesFromEnv({ VITE_BUDGET_SHEET_ID: value });
    const found = scanText(`const s="${value}";`, { privateValues });
    expect(rules(found)).toEqual(['spreadsheet-id']);
    expect(JSON.stringify(found)).not.toContain(value);
  });

  it('sentetik kimlik izinli: URL, çıplak sabit ve ortam değeri bulgu üretmez', () => {
    expect(SYNTHETIC_SHEET_IDS).toContain('synthetic-budget-sheet-2098');
    const privateValues = privateValuesFromEnv({ VITE_BUDGET_SHEET_ID: 'synthetic-budget-sheet-2098' });
    expect(privateValues).toEqual([]);
    const text = 'const Tc="synthetic-budget-sheet-2098";const u="https://docs.google.com/spreadsheets/d/synthetic-budget-sheet-2098/edit";';
    expect(scanText(text, { privateValues })).toEqual([]);
  });

  it('yanlış alarm yok: şablon, kısa kimlik, 44 karakterlik dosya adı, tek tip 44 karakter', () => {
    for (const text of [
      'const u=`https://docs.google.com/spreadsheets/d/${Tc}/edit`,g=`https://docs.google.com/spreadsheets/d/${t}/gviz/tq`;',
      'spreadsheets/d/short',
      'https://commons.wikimedia.org/wiki/File:2018_Toyota_RAV4_25th_Anniversary_white_rear.jpg',
      `"${'1'.padEnd(44, 'a')}"`,
      `"${'1aaaa_bbbb_cccc_dddd_eeee_ffff_gggg_hh2_JJKK'}"`,
      '"--budget-timelineViewSelectedSurface"',
      'if(!/^[\\w-]{20,}$/.test(sheetId))throw new Error("Google Sheets bağlantısı henüz tanımlanmamış.")',
    ]) expect(scanText(text), text).toEqual([]);
  });
});

describe('Apps Script /exec adresi', () => {
  it('dağıtım adresi, alan adlı Workspace biçimi, kaçışlı biçim, googleusercontent yanıtı ve çıplak dağıtım kimliği ihlal', () => {
    for (const text of [
      `const api="https://script.google.com/macros/s/${fakeDeploymentId}/exec";`,
      `https://script.google.com/a/macros/ornek.invalid/s/${fakeDeploymentId}/exec`,
      `"https:\\/\\/script.google.com\\/macros\\/s\\/${fakeDeploymentId}\\/exec"`,
      `https://script.google.com/macros/s/${fakeDeploymentId}/dev`,
      `https://script.googleusercontent.com/macros/echo?user_content_key=${'Sn7eTkOrNk0Tb'.repeat(3)}&lib=x`,
      `const id='${fakeDeploymentId}'`,
    ]) expect(rules(scanText(text)), text).toEqual(['apps-script-url']);
  });

  it('ortamdaki VITE_API_URL değeri her biçimde ihlal; değer çıktıya yazılmaz', () => {
    const value = 'https://ornek-api.invalid/aile/exec';
    const privateValues = privateValuesFromEnv({ VITE_API_URL: value });
    const found = scanText(`fetch("${value}")`, { privateValues });
    expect(rules(found)).toEqual(['apps-script-url']);
    expect(JSON.stringify(found)).not.toContain(value);
  });

  it('yanlış alarm yok: arayüz örneği, doğrulama ifadesi, belge bağlantısı', () => {
    for (const text of [
      'const APPS_SCRIPT_ORNEK="https://script.google.com/macros/s/…/exec";',
      'const re=/^https:\\/\\/script\\.google\\.com\\/macros\\/s\\/.+\\/exec$/;',
      'placeholder:`https://script.google.com/macros/s/…/exec`',
      'https://script.google.com/home/start',
    ]) expect(scanText(text), text).toEqual([]);
  });
});

describe('mutlak kullanıcı yolları ve kasa-work', () => {
  it('macOS, Linux CI, geçici klasör, file:// ve Windows kullanıcı yolları ihlal', () => {
    for (const text of [
      `"${fakeUserPath}"`,
      'file:///Users/ornek-kisi/aile/dist/x.js',
      'at /home/runner/work/aile/aile/src/main.tsx:1:1',
      '"/private/var/folders/ab/cdef123/T/aile-build/x.js"',
      '"/var/folders/ab/cdef123/T/x"',
      '"C:\\\\Users\\\\ornek\\\\aile\\\\src\\\\x.ts"',
      'C:/Users/ornek/aile/src/x.ts',
    ]) expect(rules(scanText(text)), text).toEqual(['absolute-user-path']);
  });

  it('bulgu kullanıcı adını yazmaz, yalnız kökü gösterir', () => {
    expect(scanText(`"${fakeUserPath}"`)[0].match).toBe('/Users/…');
    expect(scanText('at /home/runner/work/aile')[0].match).toBe('/home/…');
    expect(scanText('C:/Users/ornek/aile')[0].match).not.toContain('ornek');
  });

  it('kasa_work yazımı da ihlal', () => {
    expect(rules(scanText('../kasa_work/nesil'))).toEqual(['kasa-work']);
  });

  it('yanlış alarm yok: depo göreli yol, URL yolu, karma rota, tek /Users', () => {
    for (const text of [
      '"from":"src/home/HomePlanPage.tsx"',
      'https://ornek.invalid/home/abc',
      'href:"#/home/plan"',
      'fetch("/api/Users")',
      '"/Users"',
    ]) expect(scanText(text), text).toEqual([]);
  });
});

describe('AILE_GENERATION_DIR değeri', () => {
  it('mutlak değer (sondaki eğik çizgi kırpılır) dist metninde ihlal; çıktıda yalnız değişken adı', () => {
    const privateValues = privateValuesFromEnv({ AILE_GENERATION_DIR: '/Volumes/ornek-disk/aile-nesil/' });
    const found = scanText('const d="/Volumes/ornek-disk/aile-nesil";', { privateValues });
    expect(rules(found)).toEqual(['generation-dir']);
    expect(found[0].match).toBe('AILE_GENERATION_DIR');
    expect(JSON.stringify(found)).not.toContain('ornek-disk');
  });

  it('göreli değer çalışma klasörüne göre çözülmüş biçimiyle de yakalanır', () => {
    const privateValues = privateValuesFromEnv({ AILE_GENERATION_DIR: 'ozel-nesil-klasoru' }, { cwd: '/srv/ornek' });
    expect(rules(scanText('"/srv/ornek/ozel-nesil-klasoru/manifest.json"', { privateValues }))).toEqual(['generation-dir']);
    expect(rules(scanText('"ozel-nesil-klasoru"', { privateValues }))).toEqual(['generation-dir']);
  });

  it('yanlış alarm yok: kısa veya boş değer yok sayılır, değer yoksa bulgu yok', () => {
    expect(MIN_PRIVATE_VALUE_LENGTH).toBeGreaterThanOrEqual(8);
    expect(privateValuesFromEnv({ AILE_GENERATION_DIR: '/' })).toEqual([]);
    expect(privateValuesFromEnv({ AILE_GENERATION_DIR: '  ' })).toEqual([]);
    expect(privateValuesFromEnv({})).toEqual([]);
    const privateValues = privateValuesFromEnv({ AILE_GENERATION_DIR: '/Volumes/ornek-disk/aile-nesil' });
    expect(scanText('const a="/Volumes/baska-disk";', { privateValues })).toEqual([]);
  });
});

describe('e-posta adresleri', () => {
  it('mailto, ad ile adres ve JSON alanı ihlal; adres kırpılır', () => {
    for (const text of [`mailto:${fakeEmail}`, `"Ornek Kisi <${fakeEmail.replace('@', '+aile@')}>"`, `{"email":"${fakeEmail}"}`]) {
      const found = scanText(text);
      expect(rules(found), text).toEqual(['email']);
      expect(found[0].match).not.toContain(fakeEmail);
      // Çıktı yerel kısmı ve alan adını açmaz; yalnız konumlamaya yetecek iz kalır.
      expect(found[0].match).not.toMatch(/ornek|kisi|aile-posta/);
    }
  });

  it('yanlış alarm yok: CSS @ kuralları, paket sürümü, retina görsel, ayrılmış alan adları, doğrulama ifadesi', () => {
    for (const text of [
      '@media (min-width:600px){a{color:red}}@supports (display:grid){}',
      '"react-dom@19.3.1"',
      '"@ant-design/cssinjs"',
      'srcset="logo@2x.png 2x"',
      'kisi@example.com ornek@aile.test x@site.invalid',
      'const re=/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;',
    ]) expect(scanText(text), text).toEqual([]);
  });
});

describe('nesil manifesti ve partition parçaları', () => {
  let syntheticManifest;
  let syntheticPartition;
  beforeAll(async () => {
    const [id] = await loadSyntheticGenerationIds(fixtureRoot);
    syntheticManifest = await readFile(path.join(fixtureRoot, id, 'manifest.json'), 'utf8');
    syntheticPartition = await readFile(path.join(fixtureRoot, id, 'data', 'rooms', 'household', '00000.json'), 'utf8');
  });

  it('manifest alanları değerleriyle ihlal: JSON, JS nesnesi, kaçışlı dize', () => {
    for (const text of [
      `{"generation_id":"${fakeHex64}","schemaVersion":1}`,
      `const m={generation_id:"${fakeHex64}"};`,
      `JSON.parse("{\\"generation_id\\":\\"${fakeHex64}\\"}")`,
      `{"kind":"partition","path":"x","sha256":"${'cd'.repeat(32)}"}`,
      '{"bytes":757,"kind":"partition","path":"data/rooms/household/00000.json"}',
      '{path:`data/forecast_events/budget/2026-11/00000.json`,kind:`partition`}',
    ]) expect(rules(scanText(text)), text).toEqual(['generation-manifest']);
  });

  it('sentetik manifestin kendisi de dist içinde ihlal (fixture dist\'e girmez)', async () => {
    const [id] = await loadSyntheticGenerationIds(fixtureRoot);
    const found = scanText(`var m=JSON.parse(${JSON.stringify(syntheticManifest)});`, { exemptGenerationIds: [id] });
    expect(rules(found)).toContain('generation-manifest');
  });

  it('sıralı anahtarlı partition (collection önce, schemaVersion sonda) gömülü dize ve nesne olarak ihlal', () => {
    expect(rules(scanText(`var p=JSON.parse(${JSON.stringify(syntheticPartition)});`))).toContain('partition-envelope');
    expect(rules(scanText('var p={collection:"rooms",records:[{id:"x",label:"Örnek oda"}],schemaVersion:1};'))).toEqual(['partition-envelope']);
    expect(rules(scanText('{"collection":"rooms","records":[]}'.replace('{', 'x={')))).toEqual(['partition-envelope']);
  });

  it('tek kayıt parçası (tenant_id/source_id UUID değeriyle) ihlal', () => {
    expect(rules(scanText(`{"id":"x","tenant_id":"${fakeTenantUuid}"}`))).toEqual(['generation-record']);
    expect(rules(scanText(`r={source_id:'${fakeTenantUuid}',label:"Örnek"}`))).toEqual(['generation-record']);
  });

  it('yanlış alarm yok: şema kodu, değişiklik kümesi kodu, alan erişimi', () => {
    for (const text of [
      'Ge=O({schemaVersion:k(1),generation_id:z,tenant_id:L,storage_policy:k(`private_only`),files:E(We),counts:j(T(),A().min(0))})',
      'O({path:T(),kind:ne([`partition`,`raw`,`schema`,`contract`]),sha256:T().regex(/^[0-9a-f]{64}$/),bytes:A().min(0)})',
      'consistency:k(`snapshot_capture_not_transaction`).optional()',
      'JSON.stringify({schemaVersion:1,kind:`aile-change-set-batch`,generation_id:t,pending:n,ops:g.ops},null,2)',
      'return ge(he({schemaVersion:1,collection:`view_definitions`,records:e}))',
      'w({schemaVersion:k(1),collection:mt,records:E(e)})',
      'B=O({id:L,tenant_id:L,kind:T().optional(),source_id:L.optional()});let i=t.get(r.source_id)',
      'if(typeof n.generation_id!=`string`||!/^[a-f0-9]{64}$/.test(n.generation_id))throw new U(`manifest.json`,`generation_id sha256 değil`)',
      // Kimlik/özet taşımayan sabitler ve yardım metnindeki örnek yol veri değildir.
      'const m={schemaVersion:1,storage_policy:`private_only`,consistency:`snapshot_capture_not_transaction`}',
      'children:`Klasörde manifest.json ve data/purchase_needs/household/00000.json gibi parçalar bulunur.`',
    ]) expect(scanText(text), text).toEqual([]);
  });
});

describe('source map gömülü kaynak içeriği', () => {
  const map = extra => JSON.stringify({ version: 3, file: 'app.js', sources: ['../src/app.ts'], mappings: 'AAAA', ...extra });

  it('sourcesContent dizesi taşıyan .map ihlal (null ile başlasa da)', () => {
    expect(rules(scanText(map({ sourcesContent: ['export const a = 1;'] })))).toEqual(['sourcemap-content']);
    expect(rules(scanText(map({ sourcesContent: [null, 'export const a = 1;'] })))).toEqual(['sourcemap-content']);
  });

  it('JS içine gömülü base64 ve URL kodlu satır içi map ihlal; içerikteki yol da yakalanır', () => {
    const b64 = Buffer.from(map({ sourcesContent: [`// ${fakeUserPath}\nexport {}`] })).toString('base64');
    const inline = `console.log(1);\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,${b64}\n`;
    expect(sortedRules(scanText(inline))).toEqual(['absolute-user-path', 'sourcemap-content']);
    const encoded = `a{}\n/*# sourceMappingURL=data:application/json,${encodeURIComponent(map({ sourcesContent: ['a{}'] }))} */`;
    expect(rules(scanText(encoded))).toEqual(['sourcemap-content']);
  });

  it('yanlış alarm yok: içeriksiz map, yalnız null içerik, harici map başvurusu', () => {
    for (const text of [
      map({}),
      map({ sourcesContent: [null, null] }),
      'console.log(1);\n//# sourceMappingURL=app.js.map\n',
      `//# sourceMappingURL=data:application/json;base64,${Buffer.from(map({})).toString('base64')}`,
    ]) expect(scanText(text), text).toEqual([]);
  });

  it('scanDist .map dosyasını bildirir', async () => {
    const dist = path.join(scratch, 'dist-map');
    await mkdir(path.join(dist, 'assets'), { recursive: true });
    await writeFile(path.join(dist, 'assets', 'app.js'), 'export const ok = true;\n//# sourceMappingURL=app.js.map\n');
    await writeFile(path.join(dist, 'assets', 'app.js.map'), map({ sourcesContent: ['export const ok = true;'] }));
    const findings = await scanDist(dist);
    expect(findings.map(f => [f.rule, f.file])).toEqual([['sourcemap-content', path.join('assets', 'app.js.map')]]);
  });
});

describe('privateValuesFromEnv ve izinli sentetik kimlik', () => {
  it('üç değişkeni kural adlarıyla eşler; sentetik Sheet kimliği muaf', () => {
    const values = privateValuesFromEnv({
      AILE_GENERATION_DIR: '/Volumes/ornek-disk/nesil',
      VITE_BUDGET_SHEET_ID: fakeRealishSheetId,
      VITE_API_URL: `https://script.google.com/macros/s/${fakeDeploymentId}/exec`,
      BASKA: 'yok-sayilir-degisken-degeri',
    });
    expect([...new Set(values.map(v => `${v.name}:${v.rule}`))].sort()).toEqual([
      'AILE_GENERATION_DIR:generation-dir', 'VITE_API_URL:apps-script-url', 'VITE_BUDGET_SHEET_ID:spreadsheet-id',
    ]);
  });

  it('izinli sentetik kimlik, Playwright yapılandırması ve CI iş akışlarıyla aynı', async () => {
    const sources = await Promise.all(['playwright.admin.config.ts', '.github/workflows/ci.yml', '.github/workflows/deploy.yml']
      .map(file => readFile(path.join(root, file), 'utf8')));
    const used = sources.flatMap(text => [...text.matchAll(/VITE_BUDGET_SHEET_ID:\s*'?(synthetic-[\w-]+)/g)].map(m => m[1]));
    expect(used.length).toBeGreaterThan(0);
    for (const id of used) expect(SYNTHETIC_SHEET_IDS).toContain(id);
  });
});

describe('temiz paket: yanlış alarm yok', () => {
  it('gerçek derlemeden alınmış temiz parçalar birlikte bulgu üretmez', () => {
    const bundle = [
      'const Tc="synthetic-budget-sheet-2098",Ec=`https://docs.google.com/spreadsheets/d/${Tc}/edit`;',
      'const APPS_SCRIPT_ORNEK="https://script.google.com/macros/s/…/exec",re=/^https:\\/\\/script\\.google\\.com\\/macros\\/s\\/.+\\/exec$/;',
      'Ge=O({schemaVersion:k(1),generation_id:z,tenant_id:L,storage_policy:k(`private_only`),files:E(We)});',
      'return ge(he({schemaVersion:1,collection:`view_definitions`,records:e}))',
      '@media (min-width:600px){.a{--budget-timelineViewSelectedSurface:red}}',
      '{"from":"src/home/HomePlanPage.tsx","packages":{"react-dom@19.3.1":1}}',
      'console.log(1);\n//# sourceMappingURL=app.js.map',
    ].join('\n');
    const privateValues = privateValuesFromEnv({ VITE_BUDGET_SHEET_ID: 'synthetic-budget-sheet-2098', AILE_GENERATION_DIR: '/Volumes/ornek-disk/nesil' });
    expect(scanText(bundle, { privateValues })).toEqual([]);
  });
});

describe('CLI ortam değerleri', () => {
  it('AILE_GENERATION_DIR değeri dist içindeyse exit 1, değer yazdırılmaz', async () => {
    const dist = path.join(scratch, 'dist-cli-gen');
    await mkdir(dist, { recursive: true });
    const value = '/Volumes/ornek-disk/aile-nesil';
    await writeFile(path.join(dist, 'a.js'), `const d=${JSON.stringify(value)};`);
    const result = await run(node, [script, dist], { cwd: root, env: cleanEnv({ AILE_GENERATION_DIR: value }) }).catch(e => e);
    expect(result.code).toBe(1);
    expect(result.stdout + result.stderr).toMatch(/generation-dir/);
    expect(result.stdout + result.stderr).not.toContain(value);
  });

  it('sentetik VITE_BUDGET_SHEET_ID ile sentetik kimlik taşıyan dist exit 0', async () => {
    const dist = path.join(scratch, 'dist-cli-synthetic');
    await mkdir(dist, { recursive: true });
    await writeFile(path.join(dist, 'a.js'), 'const Tc="synthetic-budget-sheet-2098";');
    const { stdout } = await run(node, [script, dist], { cwd: root, env: cleanEnv({ VITE_BUDGET_SHEET_ID: 'synthetic-budget-sheet-2098' }) });
    expect(stdout).toMatch(/0 bulgu/);
  });

  it('gerçek Sheet kimliği bulunca sentetik derleme ipucunu yazar', async () => {
    const dist = path.join(scratch, 'dist-cli-sheet');
    await mkdir(dist, { recursive: true });
    await writeFile(path.join(dist, 'a.js'), `const Tc="${fakeRealishSheetId}";`);
    const result = await run(node, [script, dist], { cwd: root, env: cleanEnv() }).catch(e => e);
    expect(result.code).toBe(1);
    expect(result.stdout + result.stderr).toMatch(/spreadsheet-id/);
    expect(result.stdout + result.stderr).toMatch(/VITE_BUDGET_SHEET_ID=synthetic-budget-sheet-2098/);
    expect(result.stdout + result.stderr).not.toContain(fakeRealishSheetId);
  });
});

describe('gerçek dist (varsa)', () => {
  it('dist/ varsa ihlal yok', async () => {
    const dist = path.join(root, 'dist');
    const exists = await access(dist).then(() => true, () => false);
    if (!exists) return;
    const exemptGenerationIds = await loadSyntheticGenerationIds(fixtureRoot);
    const findings = await scanDist(dist, { exemptGenerationIds });
    expect(findings.map(f => `${f.rule} ${f.file}`)).toEqual([]);
  }, 60_000);
});
