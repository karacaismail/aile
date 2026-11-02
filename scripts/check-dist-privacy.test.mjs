// dist-privacy kapısı: üretim çıktısına (dist/) özel yol, nesil kimliği, partition zarfı, kaynak manifesti,
// erişim denetimi notu, UUID yoğunluğu veya Sheet kimliği sızmadığını doğrular. Testler yalnız sentetik
// desenler kullanır; gerçek aile verisi veya gerçek Sheet kimliği içermez.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { scanText, scanDist, loadSyntheticGenerationIds, TEXT_EXTENSIONS } from './check-dist-privacy.mjs';

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(root, 'scripts', 'check-dist-privacy.mjs');
const fixtureRoot = path.join(root, 'fixtures', 'generation-synthetic');
const node = process.execPath;

const fakeHex64 = 'ab'.repeat(32);
const fakeUuid = i => `0000${String(i).padStart(4, '0')}-0000-5000-8000-000000000000`;
const fakeSheetId = 'A'.repeat(44);
const rules = findings => findings.map(f => f.rule);

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
    expect(rules(scanText('/Users/x/kasa-work/nesil'))).toEqual(['kasa-work']);
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
    const result = await run(node, [script, dist], { cwd: root }).catch(e => e);
    expect(result.code).toBe(1);
    expect(result.stdout + result.stderr).toMatch(/access-audit/);
    expect(result.stdout + result.stderr).toMatch(/a\.js/);
  });

  it('temiz dist exit 0', async () => {
    const dist = path.join(scratch, 'dist-cli-ok');
    await mkdir(dist, { recursive: true });
    await writeFile(path.join(dist, 'a.js'), 'export const ok = true;');
    const { stdout } = await run(node, [script, dist], { cwd: root });
    expect(stdout).toMatch(/0 bulgu/);
  });

  it('dist yoksa exit 0 ve bunu söyler', async () => {
    const { stdout } = await run(node, [script, path.join(scratch, 'dist-yok')], { cwd: root });
    expect(stdout).toMatch(/dist yok/i);
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
