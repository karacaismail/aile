#!/usr/bin/env node
import { lstat, mkdir, mkdtemp, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { safeOutput, columnName } from './core.mjs';

const MAX_CELLS = 12000;
const META_FIELDS = 'spreadsheetId,properties,namedRanges,developerMetadata,sheets(properties,merges,conditionalFormats,filterViews,protectedRanges,basicFilter,charts,bandedRanges,rowGroups,columnGroups,tables)';
const CELL_FIELDS = 'spreadsheetId,sheets(properties(sheetId,title),data(startRow,startColumn,rowData(values(userEnteredValue,effectiveValue,formattedValue,note,hyperlink,userEnteredFormat(numberFormat),effectiveFormat(numberFormat),dataValidation,textFormatRuns))))';
const fail = message => { throw new Error(message); };
const integer = value => Number.isSafeInteger(value) && value >= 0;
const timestamp = now => { const value = now(); if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) fail('Capture clock must return an ISO timestamp'); return value; };
async function exists(target) { try { await lstat(target); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }

/** Covers the allocated grid exactly once; Google omits trailing empty cells in responses. */
export function captureBounds(metadata) {
 if (!Array.isArray(metadata.sheets) || !metadata.sheets.length) fail('Workbook metadata has no sheets');
 const bounds = [], ids = new Set(), titles = new Set();
 for (const sheet of metadata.sheets) {
  const p = sheet.properties, g = p?.gridProperties;
  if (!integer(p?.sheetId) || typeof p.title !== 'string' || !p.title || ids.has(p.sheetId) || titles.has(p.title)) fail('Invalid or duplicate sheet identity');
  if (!integer(g?.rowCount) || !integer(g?.columnCount) || !g.rowCount || !g.columnCount) fail('Unsupported sheet without an allocated grid');
  ids.add(p.sheetId); titles.add(p.title);
  const columns = Math.min(g.columnCount, MAX_CELLS);
  for (let startColumn = 0; startColumn < g.columnCount; startColumn += columns) {
   const endColumn = Math.min(g.columnCount, startColumn + columns), rows = Math.floor(MAX_CELLS / (endColumn-startColumn));
   for (let startRow = 0; startRow < g.rowCount; startRow += rows) {
    const endRow = Math.min(g.rowCount, startRow + rows);
    bounds.push({ sheetId: p.sheetId, startRow, endRow, startColumn, endColumn,
     range: `'${p.title.replaceAll("'", "''")}'!${columnName(startColumn)}${startRow+1}:${columnName(endColumn-1)}${endRow}` });
   }
  }
 }
 return bounds;
}

function validateCells(value, source, bound, metadata) {
 if (value.spreadsheetId !== source.spreadsheetId) fail('Workbook identity mismatch in cells response');
 const expected = metadata.sheets.find(s => s.properties.sheetId === bound.sheetId).properties;
 if (!Array.isArray(value.sheets) || value.sheets.length !== 1 || value.sheets[0].properties?.sheetId !== bound.sheetId || value.sheets[0].properties?.title !== expected.title) fail('Sheet identity mismatch in cells response');
 const blocks = value.sheets[0].data ?? [], occupied = new Set();
 if (!Array.isArray(blocks)) fail('Invalid grid data');
 let nonemptyCells = 0, returnedCells = 0, returnedRows = 0;
 for (const block of blocks) {
  const row = block.startRow ?? 0, column = block.startColumn ?? 0, rows = block.rowData ?? [];
  if (!integer(row) || !integer(column) || !Array.isArray(rows)) fail('Invalid grid coordinates');
  if (rows.length && (row < bound.startRow || row + rows.length > bound.endRow || column < bound.startColumn || column >= bound.endColumn)) fail('Returned rows exceed capture bounds');
  returnedRows += rows.length;
  for (const [r, data] of rows.entries()) {
   const cells = data.values ?? [];
   if (!Array.isArray(cells) || column + cells.length > bound.endColumn) fail('Returned cells exceed capture bounds');
   for (const [c, cell] of cells.entries()) {
    if (!cell || typeof cell !== 'object' || Array.isArray(cell)) fail('Invalid native cell');
    const coordinate = `${row+r}:${column+c}`;
    if (occupied.has(coordinate)) fail('Duplicate returned cell coordinates');
    occupied.add(coordinate); returnedCells++; if (Object.keys(cell).length) nonemptyCells++;
   }
  }
 }
 return { nonemptyCells, returnedCells, returnedRows };
}

async function parallelMap(values, concurrency, action) {
 const results = Array(values.length); let next = 0, failure;
 await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
  while (!failure && next < values.length) {
   const index = next++;
   try { results[index] = await action(values[index], index); } catch (error) { failure ??= error; }
  }
 }));
 if (failure) throw failure;
 return results;
}

/** GET-only archival capture. Drive revisions bound observation, not a transactional snapshot. */
export async function captureSnapshot({ sources, outputRoot, captureId = `capture-${randomUUID()}`, accessToken = process.env.GOOGLE_ACCESS_TOKEN, fetchImpl = globalThis.fetch, concurrency = 3, now = () => new Date().toISOString(), timeoutMs = 30000 }) {
 if (!Array.isArray(sources) || !sources.length) fail('Source configuration requires at least one workbook');
 for (const s of sources) if (!s || typeof s.key !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(s.key) || typeof s.spreadsheetId !== 'string' || !/^[\w-]{10,}$/.test(s.spreadsheetId)) fail('Invalid source configuration');
 if (new Set(sources.map(s => s.key)).size !== sources.length || new Set(sources.map(s => s.spreadsheetId)).size !== sources.length) fail('Distinct source keys and workbook identities are required');
 if (!Number.isInteger(concurrency) || concurrency < 2 || concurrency > 4) fail('Capture concurrency must be between 2 and 4');
 if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) fail('Invalid read timeout');
 if (typeof accessToken !== 'string' || !accessToken || /[\r\n]/.test(accessToken)) fail('GOOGLE_ACCESS_TOKEN is required');
 if (typeof captureId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/.test(captureId)) fail('Invalid capture name');
 if (typeof outputRoot !== 'string' || !outputRoot) fail('Private output directory is required');
 const output = await safeOutput(outputRoot), destination = path.join(output, captureId), lockPath = path.join(output, `.${captureId}.lock`);
 if (await exists(destination)) fail('Capture destination already exists');
 let lock;
 try { lock = await open(lockPath, 'wx', 0o600); } catch (error) { if (error.code === 'EEXIST') fail('Capture reservation already exists'); throw error; }
 let staging;
 const started = performance.now();
 const metrics = { requestCount: 0, requestBodyBytes: 0, requestTargetBytes: 0, responseBodyBytes: 0, requests: [] };
 try {
  const startedAt = timestamp(now);
  if (await exists(destination)) fail('Capture destination already exists');
  staging = await mkdtemp(path.join(output, '.capture-staging-'));
  const write = async (relative, bytes) => { const target = path.join(staging, relative); await mkdir(path.dirname(target), { recursive: true, mode: 0o700 }); await writeFile(target, bytes, { flag: 'wx', mode: 0o600 }); };
  const read = async (url, sourceKey, kind) => {
   const begin = performance.now(); metrics.requestCount++;
   const requestTargetBytes = Buffer.byteLength(url.pathname + url.search); metrics.requestTargetBytes += requestTargetBytes;
   let response, bytes;
   try {
    response = await fetchImpl(url, { method: 'GET', headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }, redirect: 'error', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) fail(`Google read failed (HTTP ${response.status})`);
    bytes = await response.text();
   } catch (error) {
    // Fetch errors and API bodies can contain credentials or access-bearing URLs.
    if (response && !response.ok) fail(`Google read failed (HTTP ${response.status})`);
    fail('Google read failed (network or response stream)');
   }
   let value; try { value = JSON.parse(bytes); } catch { fail('Google returned invalid JSON'); }
   if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Google returned invalid JSON object');
   const responseBodyBytes = Buffer.byteLength(bytes); metrics.responseBodyBytes += responseBodyBytes;
   metrics.requests.push({ source: sourceKey, kind, method: 'GET', requestBodyBytes: 0, requestTargetBytes, responseBodyBytes, elapsedMs: performance.now()-begin });
   return { value, bytes };
  };
  const drive = async source => {
   const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(source.spreadsheetId)}`);
   url.searchParams.set('fields', 'id,name,mimeType,modifiedTime,version'); url.searchParams.set('supportsAllDrives', 'true');
   const result = await read(url, source.key, 'drive');
   if (result.value.id !== source.spreadsheetId) fail('Workbook identity mismatch in Drive response');
   if (!/^\d+$/.test(result.value.version) || typeof result.value.modifiedTime !== 'string' || !Number.isFinite(Date.parse(result.value.modifiedTime))) fail('Drive revision metadata is missing');
   if (result.value.mimeType !== 'application/vnd.google-apps.spreadsheet') fail('Source is not a Google spreadsheet');
   return result;
  };
  const captured = [];
  for (const source of sources) {
   const sourceStartedAt = timestamp(now), before = await drive(source);
   await write(`raw/${source.key}/drive-before.json`, before.bytes);
   const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(source.spreadsheetId)}`); url.searchParams.set('fields', META_FIELDS);
   const metadata = await read(url, source.key, 'metadata');
   if (metadata.value.spreadsheetId !== source.spreadsheetId) fail('Workbook identity mismatch in metadata response');
   const bounds = captureBounds(metadata.value), metadataPath = `raw/${source.key}/metadata.json`;
   await write(metadataPath, metadata.bytes);
   const chunks = await parallelMap(bounds, concurrency, async (bound, index) => {
    const chunk = `raw/${source.key}/chunk-${String(index).padStart(5,'0')}.json`;
    const request = new URL(url); request.searchParams.set('fields', CELL_FIELDS); request.searchParams.set('ranges', bound.range);
    const result = await read(request, source.key, 'cells');
    const counts = validateCells(result.value, source, bound, metadata.value);
    await write(chunk, result.bytes); return { bound: { chunk, ...bound }, counts };
   });
   const counts = { sheets: metadata.value.sheets.length, chunks: chunks.length, allocatedCells: bounds.reduce((n,b) => n+(b.endRow-b.startRow)*(b.endColumn-b.startColumn),0), returnedCells: 0, returnedRows: 0, nonemptyCells: 0 };
   for (const chunk of chunks) for (const field of ['returnedCells','returnedRows','nonemptyCells']) counts[field] += chunk.counts[field];
   captured.push({ key: source.key, metadata: metadataPath, driveBefore: before.value, startedAt: sourceStartedAt, chunks: chunks.map(c => c.bound.chunk), bounds: chunks.map(c => c.bound), counts });
  }
  // All sources are checked after the complete multi-workbook read, including the first workbook.
  for (const [index, source] of sources.entries()) {
   const after = await drive(source), entry = captured[index];
   await write(`raw/${source.key}/drive-after.json`, after.bytes);
   if (entry.driveBefore.modifiedTime !== after.value.modifiedTime || entry.driveBefore.version !== after.value.version) fail('Source changed during capture; no snapshot was published');
   entry.driveAfter = after.value; entry.completedAt = timestamp(now);
  }
  const manifest = { schemaVersion: 1, sources: captured, startedAt, completedAt: timestamp(now), consistency: 'drive_checked_capture_not_transactional', metrics: { ...metrics, elapsedMs: performance.now()-started } };
  await write('source-manifest.json', `${JSON.stringify(manifest,null,2)}\n`);
  if (await safeOutput(output) !== output) fail('Private output path changed');
  if (await exists(destination)) fail('Capture destination already exists');
  await rename(staging, destination); staging = undefined;
  return { directory: destination, manifestPath: path.join(destination,'source-manifest.json'), sources: captured.length, chunks: captured.reduce((n,s) => n+s.chunks.length,0), metrics: manifest.metrics };
 } finally {
  if (staging) await rm(staging, { recursive: true, force: true });
  await lock.close(); await rm(lockPath, { force: true });
 }
}

async function main() {
 const flags = {}, args = process.argv.slice(2);
 for (let i=0;i<args.length;i+=2) {
  if (!['--config','--output','--name','--concurrency'].includes(args[i]) || !args[i+1] || Object.hasOwn(flags,args[i])) fail('Usage: capture.mjs --config PRIVATE_CONFIG --output PRIVATE_DIRECTORY [--name CAPTURE_NAME] [--concurrency 2..4]');
  flags[args[i]] = args[i+1];
 }
 if (!flags['--config'] || !flags['--output']) fail('Private config and output are required');
 const config = JSON.parse(await readFile(flags['--config'],'utf8'));
 const result = await captureSnapshot({ sources: config.sources, outputRoot: flags['--output'], ...(flags['--name'] ? { captureId: flags['--name'] } : {}), ...(flags['--concurrency'] ? { concurrency: Number(flags['--concurrency']) } : {}) });
 process.stdout.write(`${JSON.stringify({ manifestPath: result.manifestPath, sources: result.sources, chunks: result.chunks, requestCount: result.metrics.requestCount, responseBodyBytes: result.metrics.responseBodyBytes })}\n`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
 main().catch(() => { process.stderr.write('Capture failed; no new snapshot was published. Check private configuration, access and source stability.\n'); process.exitCode = 1; });
}
