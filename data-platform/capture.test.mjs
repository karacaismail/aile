import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, mkdir, symlink, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { captureSnapshot, captureBounds } from './capture.mjs';
import { loadNative } from './native.mjs';

const TOKEN = 'synthetic-token-never-save';
const source = { key: 'budget', spreadsheetId: 'synthetic-budget-workbook' };
const cell = { userEnteredValue: { formulaValue: '=1+1' }, effectiveValue: { numberValue: 2 }, formattedValue: '2,00', note: 'A note', hyperlink: 'https://example.test/item', userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: '0.00' } }, effectiveFormat: { numberFormat: { type: 'NUMBER', pattern: '0.00' } }, dataValidation: { condition: { type: 'NUMBER_GREATER', values: [{ userEnteredValue: '0' }] } } };

function mockGoogle({ changed = false, modified = false, wrongWorkbook = false, outsideBounds = false, malformed = false, fail = false, metadataPatch = {}, drivePatch = {}, empty = false, entry = source } = {}) {
 const requests = [], raw = new Map(); let active = 0, peak = 0, driveReads = 0;
 const fetchImpl = async (input, init) => {
  const url = new URL(input); requests.push({ url, init });
  assert.equal(init.method, 'GET'); assert.equal(init.body, undefined);
  assert.equal(init.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(init.redirect, 'error');
  if (fail) throw new Error(`Network error containing ${TOKEN}`);
  if (url.hostname === 'www.googleapis.com') {
   driveReads++;
   return new Response(JSON.stringify({ id: entry.spreadsheetId, name: 'Synthetic workbook', mimeType: 'application/vnd.google-apps.spreadsheet', modifiedTime: modified && driveReads > 1 ? '2030-01-02T00:00:00Z' : '2030-01-01T00:00:00Z', version: changed && driveReads > 1 ? '2' : '1', ...drivePatch }));
  }
  assert.equal(url.hostname, 'sheets.googleapis.com');
  const range = url.searchParams.get('ranges');
  if (!range) return new Response(JSON.stringify({ spreadsheetId: entry.spreadsheetId, properties: { locale: 'tr_TR', timeZone: 'Europe/Istanbul' }, namedRanges: [], sheets: [
   { properties: { sheetId: 1, title: "Visible ' sheet", gridProperties: { rowCount: 241, columnCount: 100 } } },
   { properties: { sheetId: 2, title: 'Hidden', hidden: true, gridProperties: { rowCount: 3, columnCount: 2 } } },
  ], ...metadataPatch }));
  active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 3)); active--;
  const match = range.match(/!([A-Z]+)(\d+):([A-Z]+)(\d+)$/); assert.ok(match);
  const col = name => [...name].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  const startRow = Number(match[2]) - 1, startColumn = col(match[1]);
  assert.ok((Number(match[4]) - startRow) * (col(match[3]) - startColumn + 1) <= 12000);
  const title = range.startsWith("'Hidden'") ? 'Hidden' : "Visible ' sheet";
  const value = { spreadsheetId: wrongWorkbook ? 'different-workbook' : entry.spreadsheetId, sheets: [{ properties: { sheetId: title === 'Hidden' ? 2 : 1, title }, data: empty ? [] : [{ startRow: outsideBounds ? 9999 : startRow, startColumn, rowData: [{ values: [cell] }] }] }] };
  const bytes = malformed ? '{invalid' : `${JSON.stringify(value, null, 1)}\n`; raw.set(range, bytes);
  return new Response(bytes);
 };
 return { fetchImpl, requests, raw, peak: () => peak };
}
async function temporary(t) {
 const directory = await mkdtemp(path.join(tmpdir(), 'aile-capture-test-'));
 t.after(() => rm(directory, { recursive: true, force: true })); return directory;
}
async function filesUnder(root) {
 const result = [];
 for (const entry of await readdir(root, { withFileTypes: true })) {
  const full = path.join(root, entry.name);
  result.push(...(entry.isDirectory() ? await filesUnder(full) : [full]));
 }
 return result;
}
function options(directory, google, extra = {}) {
 return { sources: [source], outputRoot: directory, captureId: 'capture-one', accessToken: TOKEN, fetchImpl: google.fetchImpl, concurrency: 2, ...extra };
}

test('captures visible and hidden grids with bounded parallel GETs, exact native bytes and reproducible manifest', async t => {
 const directory = await temporary(t), google = mockGoogle();
 const result = await captureSnapshot(options(directory, google));
 const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8'));
 assert.equal(manifest.schemaVersion, 1); assert.equal(manifest.sources.length, 1);
 const captured = manifest.sources[0]; assert.equal(captured.key, 'budget');
 assert.equal(captured.chunks.length, 4); assert.equal(captured.bounds.length, 4);
 assert.deepEqual(new Set(captured.bounds.map(b => b.sheetId)), new Set([1, 2]));
 assert.equal(captured.bounds.reduce((n, b) => n + (b.endRow-b.startRow)*(b.endColumn-b.startColumn), 0), 24106);
 for (const bound of captured.bounds) assert.equal(await readFile(path.join(result.directory, bound.chunk), 'utf8'), google.raw.get(bound.range));
 assert.equal(captured.driveBefore.version, captured.driveAfter.version);
 assert.ok(Date.parse(captured.startedAt) <= Date.parse(captured.completedAt));
 assert.equal(manifest.consistency, 'drive_checked_capture_not_transactional');
 assert.equal(manifest.metrics.requestCount, 7); assert.equal(manifest.metrics.requestBodyBytes, 0);
 assert.ok(manifest.metrics.responseBodyBytes > 0); assert.ok(manifest.metrics.requestTargetBytes > 0);
 assert.equal(google.peak(), 2); assert.equal(captured.counts.sheets, 2); assert.equal(captured.counts.nonemptyCells, 4);
 for (const request of google.requests.filter(r => r.url.searchParams.has('ranges'))) {
  for (const field of ['userEnteredValue','effectiveValue','formattedValue','note','hyperlink','numberFormat','dataValidation']) assert.match(request.url.searchParams.get('fields'), new RegExp(field));
 }
 for (const file of await filesUnder(directory)) assert.ok(!(await readFile(file, 'utf8')).includes(TOKEN));
 const normalized = await loadNative(result.manifestPath, 'synthetic-tenant');
 assert.equal(normalized.sources.length, 1); assert.equal(normalized.sheets.length, 2);
 assert.deepEqual(normalized.sheets[0].rows.get(0).get(0), cell);
});

for (const [name, failure, expected] of [
 ['Drive version changes despite equal modifiedTime', { changed: true }, /source changed/i],
 ['Drive modifiedTime changes despite equal version', { modified: true }, /source changed/i],
 ['wrong metadata workbook', { metadataPatch: { spreadsheetId: 'different-workbook' } }, /workbook identity/i],
 ['wrong Drive workbook', { drivePatch: { id: 'different-workbook' } }, /workbook identity/i],
 ['Drive revision missing', { drivePatch: { version: undefined } }, /revision metadata/i],
 ['wrong workbook', { wrongWorkbook: true }, /workbook identity/i],
 ['cell outside requested range', { outsideBounds: true }, /bounds/i],
 ['malformed response', { malformed: true }, /JSON/i],
 ['network error is sanitized', { fail: true }, /Google read failed/i],
]) test(`${name}: rejects without publishing or leaking credentials`, async t => {
 const directory = await temporary(t), google = mockGoogle(failure);
 await assert.rejects(captureSnapshot(options(directory, google)), error => { assert.match(error.message, expected); assert.ok(!error.message.includes(TOKEN)); return true; });
 assert.deepEqual(await readdir(directory), []);
});

test('a clock failure releases its reservation and leaves no partial capture', async t => {
 const directory = await temporary(t), google = mockGoogle();
 await assert.rejects(captureSnapshot(options(directory, google, { now: () => 'invalid-clock' })), /clock/i);
 assert.deepEqual(await readdir(directory), []); assert.equal(google.requests.length, 0);
});

test('invalid source entries reject before reserving or fetching', async t => {
 const directory = await temporary(t), google = mockGoogle();
 await assert.rejects(captureSnapshot(options(directory, google, { sources: [null] })), /source configuration/i);
 assert.deepEqual(await readdir(directory), []); assert.equal(google.requests.length, 0);
});

test('empty grid responses retain full coverage without inventing records', async t => {
 const directory = await temporary(t), google = mockGoogle({ empty: true });
 const result = await captureSnapshot(options(directory, google, { concurrency: 4 }));
 const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8'));
 assert.equal(manifest.sources[0].counts.nonemptyCells, 0);
 assert.equal(manifest.sources[0].counts.allocatedCells, 24106); assert.equal(google.peak(), 4);
 assert.equal((await loadNative(result.manifestPath, 'synthetic-tenant')).sheets.length, 2);
});

test('a grid wider than one chunk is tiled without overlap or missing cells', () => {
 const bounds = captureBounds({ sheets: [{ properties: { sheetId: 4, title: 'Wide', gridProperties: { rowCount: 2, columnCount: 13000 } } }] });
 const cells = new Set();
 for (const b of bounds) {
  assert.ok((b.endRow-b.startRow)*(b.endColumn-b.startColumn) <= 12000);
  for (let row=b.startRow;row<b.endRow;row++) for (let col=b.startColumn;col<b.endColumn;col++) { const key=`${row}:${col}`; assert.ok(!cells.has(key)); cells.add(key); }
 }
 assert.equal(cells.size, 26000);
});

test('two simultaneous capture attempts cannot overwrite the same name', async t => {
 const directory = await temporary(t), google = mockGoogle();
 const results = await Promise.allSettled([captureSnapshot(options(directory, google)), captureSnapshot(options(directory, google))]);
 assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
 assert.match(results.find(r => r.status === 'rejected').reason.message, /exists/i);
 assert.deepEqual(await readdir(directory), ['capture-one']);
});

test('the first workbook is revision-checked after all other workbooks have been captured', async t => {
 const directory = await temporary(t), second = { key: 'household', spreadsheetId: 'synthetic-household-workbook' };
 const firstGoogle = mockGoogle(), secondGoogle = mockGoogle({ entry: second }), order = [];
 const fetchImpl = async (url, init) => {
  const first = url.pathname.includes(source.spreadsheetId), kind = url.hostname === 'www.googleapis.com' ? 'drive' : url.searchParams.has('ranges') ? 'cells' : 'metadata';
  order.push(`${first ? 'budget' : 'household'}:${kind}`);
  return (first ? firstGoogle : secondGoogle).fetchImpl(url, init);
 };
 const result = await captureSnapshot(options(directory, { fetchImpl }, { sources: [source, second] }));
 assert.equal(result.sources, 2); assert.equal(result.chunks, 8);
 assert.ok(order.lastIndexOf('budget:drive') > order.lastIndexOf('household:cells'));
 assert.equal((await loadNative(result.manifestPath, 'synthetic-tenant')).sources.length, 2);
});

test('CLI rejects missing authorization locally and never prints config contents', async t => {
 const directory = await temporary(t), configPath = path.join(directory, 'config.json');
 await writeFile(configPath, JSON.stringify({ sources: [source], ignoredSecret: TOKEN }));
 const result = spawnSync(process.execPath, [fileURLToPath(new URL('./capture.mjs', import.meta.url)), '--config', configPath, '--output', path.join(directory, 'output')], { encoding: 'utf8', env: { ...process.env, GOOGLE_ACCESS_TOKEN: '' } });
 assert.equal(result.status, 1); assert.match(result.stderr, /Capture failed/);
 assert.ok(!`${result.stdout}${result.stderr}`.includes(TOKEN));
 assert.deepEqual(await readdir(directory), ['config.json']);
});

test('an existing capture is never overwritten or re-fetched', async t => {
 const directory = await temporary(t), google = mockGoogle();
 const result = await captureSnapshot(options(directory, google));
 const original = await readFile(result.manifestPath); const calls = google.requests.length;
 await assert.rejects(captureSnapshot(options(directory, google)), /exists/i);
 assert.deepEqual(await readFile(result.manifestPath), original); assert.equal(google.requests.length, calls);
});

test('private guard rejects repository, public/dist and symlink aliases before any HTTP request', async t => {
 const directory = await temporary(t), repo = path.join(directory, 'repo');
 await mkdir(repo); await writeFile(path.join(repo, '.git'), 'gitdir: synthetic');
 await symlink(repo, path.join(directory, 'alias'));
 await mkdir(path.join(directory, 'public')); await symlink(directory, path.join(directory, 'public', 'escape'));
 for (const target of [path.join(repo, 'output'), path.join(directory, 'alias', 'output'), path.join(directory, 'public', 'data'), path.join(directory, 'dist', 'data'), path.join(directory, 'public', 'escape', 'output')]) {
  const google = mockGoogle(); await assert.rejects(captureSnapshot(options(target, google)), /private output/i); assert.equal(google.requests.length, 0);
 }
});
