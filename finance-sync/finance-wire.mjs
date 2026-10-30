import {growDimensions} from './dimensions.mjs';
import { grid } from '../finance-engine/cells.mjs';

export const WIRE_SCHEMA = 'finance-wire-v1';
export const WIRE_TITLE = '_Finans web';
export const WIRE_ID = 7302704;
const STALE = 'Sheet verisi değişti; hesap yenilenmeli';
const HEADER = ['kind', 'index', ...Array.from({ length: 18 }, (_, i) => `c${i + 1}`)];
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const quote = s => '"' + s.replaceAll('"', '""') + '"';
const same = (a, b) => JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});

export function encodeCell(value) {
  if (value === null) return 'z:';
  if (typeof value === 'string') return 's:' + value;
  assert(typeof value === 'number' && Number.isFinite(value), 'Invalid wire primitive');
  // Explicit nine-decimal representation, with exact round-trip eligibility.
  // Values outside this contract are rejected, never silently rounded to cents.
  assert(Math.abs(value) < 1e15 && Number(value.toFixed(9)) === value, 'Unsupported numeric precision');
  return 'n:' + value.toFixed(9);
}
function decodeCell(token) {
  assert(typeof token === 'string', 'Wire cell must be text');
  if (token === 'z:') return null;
  if (token.startsWith('s:')) return token.slice(2);
  assert(/^n:-?\d+\.\d{9}$/.test(token), 'Invalid numeric wire token');
  const value = Number(token.slice(2));
  assert(Number.isFinite(value) && encodeCell(value) === token, 'Noncanonical numeric wire token');
  return value;
}
export function digestPayload(payload, hash) {
  const content = [WIRE_SCHEMA, 'finance-v1', payload.metadata, payload.monthly.labels, payload.monthly.rows, payload.daily.labels, payload.daily.rows];
  assert(typeof hash === 'function', 'SHA256 hash dependency required');
  return hash(JSON.stringify(content));
}
function rowsFor(payload, digest) {
  assert(payload.schema === 'finance-v1' && payload.metadata.length === 9, 'Invalid finance payload schema');
  assert(payload.monthly.labels.length === 9 && payload.daily.labels.length === 18, 'Invalid finance headers');
  const row = (kind, index, values) => {
    assert(values.length <= 18, 'Too many wire fields');
    return [kind, `i:${index}`, ...values.map(encodeCell), ...Array(18 - values.length).fill('z:')];
  };
  return [HEADER, row('manifest', 0, [WIRE_SCHEMA, digest]), ...payload.metadata.map((v, i) => row('meta', i, [v])), row('monthly-header', 0, payload.monthly.labels), ...payload.monthly.rows.map((r, i) => row('monthly', i, r)), row('daily-header', 0, payload.daily.labels), ...payload.daily.rows.map((r, i) => row('daily', i, r))];
}
export function decodeWire(rows) {
  assert(same(rows[0], HEADER), 'Invalid wire header');
  const read = (row, kind, index, count) => {
    assert(row?.length === 20 && row[0] === kind && row[1] === `i:${index}`, 'Invalid wire row identity');
    const values = row.slice(2).map(decodeCell);
    assert(values.slice(count).every(v => v === null), 'Invalid wire padding');
    return values.slice(0, count);
  };
  const [schema, digest] = read(rows[1], 'manifest', 0, 2);
  assert(schema === WIRE_SCHEMA && /^[0-9a-f]{64}$/.test(digest), 'Invalid wire manifest');
  const metadata = Array.from({ length: 9 }, (_, i) => read(rows[i + 2], 'meta', i, 1)[0]);
  assert(metadata.every(v => typeof v === 'string'), 'Metadata must be text');
  const events = Number(metadata[3]), months = Number(metadata[4]);
  assert(Number.isSafeInteger(events) && events > 0 && Number.isSafeInteger(months) && months > 0, 'Invalid wire counts');
  assert(rows.length === 13 + months + events, 'Truncated or extra wire rows');
  const monthly = { labels: read(rows[11], 'monthly-header', 0, 9), rows: Array.from({ length: months }, (_, i) => read(rows[12 + i], 'monthly', i, 9)) };
  const daily = { labels: read(rows[12 + months], 'daily-header', 0, 18), rows: Array.from({ length: events }, (_, i) => read(rows[13 + months + i], 'daily', i, 18)) };
  return { schema: 'finance-v1', metadata, monthly, daily };
}
function wireFormula(payload, digest) {
  const n = payload.monthly.rows.length, e = payload.daily.rows.length;
  const h = values => 'HSTACK(' + values.map(quote).join(';') + ')';
  const padding = (rows, cols) => `MAKEARRAY(${rows};${cols};LAMBDA(r;c;"z:"))`;
  const indices = count => `MAP(SEQUENCE(${count};1;0);LAMBDA(v;"i:"&TEXT(v;"0")))`;
  const kinds = (kind, count) => `MAKEARRAY(${count};1;LAMBDA(r;c;${quote(kind)}))`;
  const sourceRows = (kind, count, range, cols) => `HSTACK(${kinds(kind,count)};${indices(count)};MAP(${range};encode)${cols < 18 ? ';' + padding(count,18-cols) : ''})`;
  const head = (kind, range, cols) => `HSTACK(${quote(kind)};"i:0";MAP(${range};encode)${cols < 18 ? ';' + padding(1,18-cols) : ''})`;
  const encode = 'LAMBDA(v;IF(ISNUMBER(v);IF(AND(ABS(v)<1000000000000000;v=VALUE(TEXT(v;"0.000000000")));"n:"&SUBSTITUTE(TEXT(v;"0.000000000");",";".");"invalid:numeric-precision");IF(ISTEXT(v);"s:"&v;IF(ISBLANK(v);"z:";"invalid:type"))))';
  return '=LET(encode;' + encode + ';VSTACK(' + [h(HEADER), h(['manifest','i:0','s:'+WIRE_SCHEMA,'s:'+digest,...Array(16).fill('z:')]), sourceRows('meta',9,'Finansman!A1:A9',1), head('monthly-header','Finansman!A11:I11',9), sourceRows('monthly',n,`Finansman!A12:I${11+n}`,9), head('daily-header','Finansman!A43:R43',18), sourceRows('daily',e,`Finansman!A44:R${43+e}`,18)].join(';') + '))';
}
export function payloadFromManifest(m) {
  const cells = new Map(m.cells.filter(c => c.sheetId === m.sheets[0].sheetId).map(c => [`${c.row}/${c.column}`, c.entered]));
  const outputs = new Map(m.outputs.map(o => [`${o.row}/${o.column}`, o.value]));
  const text = row => cells.get(`${row}/0`)?.stringValue;
  return { schema:'finance-v1', metadata:[text(0),'Koşullu finansman hesabı · gerçekleşmiş ödeme değildir','TRUE',String(m.eventCount),String(m.monthCount),'finance-v1',m.sourceHash,text(7),text(8)], monthly:{ labels:m.monthHeaders, rows:Array.from({length:m.monthCount},(_,i)=>Array.from({length:9},(_,j)=>outputs.get(`${i+11}/${j}`))) }, daily:{labels:m.dayHeaders,rows:Array.from({length:m.eventCount},(_,i)=>Array.from({length:18},(_,j)=>outputs.get(`${i+43}/${j}`)))} };
}
export function readFinancePayload(snapshot, counts) {
  const g=grid(snapshot,'Finansman');
  const read=(r,c)=>{
    const cell=g[r]?.[c];
    assert(cell,'Missing Finance source cell');
    const v=cell.effectiveValue??{};
    assert(!v.errorValue,'Erroneous Finance source cell');
    if(typeof v.numberValue==='number'){assert(Number.isFinite(v.numberValue),'Nonfinite Finance source');return v.numberValue;}
    if(typeof v.stringValue==='string')return v.stringValue;
    if(Object.keys(v).length===0)return '';
    throw Error('Unsupported Finance source type');
  };
  return {schema:'finance-v1',metadata:Array.from({length:9},(_,r)=>read(r,0)),monthly:{labels:Array.from({length:9},(_,c)=>read(10,c)),rows:Array.from({length:counts.monthCount},(_,r)=>Array.from({length:9},(_,c)=>read(11+r,c)))},daily:{labels:Array.from({length:18},(_,c)=>read(42,c)),rows:Array.from({length:counts.eventCount},(_,r)=>Array.from({length:18},(_,c)=>read(43+r,c)))}};
}
export function checkWireSource(snapshot,manifest){
  const failures=[];
  if(![manifest.sourceSpreadsheetId,manifest.targetSpreadsheetId].includes(snapshot.spreadsheetId))failures.push({kind:'wire-source-workbook'});
  try{const p=readFinancePayload(snapshot,manifest);if(!same(p,manifest.payload))failures.push({kind:'wire-source-parity'});}catch(e){failures.push({kind:'wire-source-parity',detail:e.message});}
  return failures;
}
export function assertWireOwnership(source, manifest) {
  const sh = source.sheets.find(s => s.properties.sheetId === manifest.sheetId);
  assert(sh?.properties.title === WIRE_TITLE, 'Wire ownership sheet identity changed');
  const g = grid(source, WIRE_TITLE);
  for(let r=0;r<manifest.rowCount;r++)for(let c=0;c<20;c++){
    const expected = r===0&&c===0 ? {formulaValue:manifest.formula} : {};
    assert(same(g[r]?.[c]?.userEnteredValue,expected), `Wire ownership changed at ${r+1}/${c+1}`);
  }
}
export function buildWire({source,payload,prior,targetSpreadsheetId=source.spreadsheetId,hash}) {
  if(prior)assertWireOwnership(source,prior);
  else assert(!source.sheets.some(s=>s.properties.sheetId===WIRE_ID||s.properties.title===WIRE_TITLE),'Wire sheet already exists or identity collides');
  assert(payload.metadata[2]==='TRUE' && Number(payload.metadata[3])===payload.daily.rows.length && Number(payload.metadata[4])===payload.monthly.rows.length,'Payload counts/guard mismatch');
  const digest=digestPayload(payload,hash),formula=wireFormula(payload,digest),expectedRows=rowsFor(payload,digest),rowCount=expectedRows.length;
  const manifest={schema:WIRE_SCHEMA,sourceSpreadsheetId:source.spreadsheetId,targetSpreadsheetId,sheetId:WIRE_ID,title:WIRE_TITLE,rowCount,eventCount:payload.daily.rows.length,monthCount:payload.monthly.rows.length,digest,sourceHash:payload.metadata[6],formula,range:`'${WIRE_TITLE}'!A1:T${rowCount}`,metadataRange:`'${WIRE_TITLE}'!A1:T11`,payload};
  const requests=[];
  if(!prior)requests.push({addSheet:{properties:{sheetId:WIRE_ID,title:WIRE_TITLE,hidden:true,gridProperties:{rowCount:rowCount+5,columnCount:20}}}});
  else requests.push(...growDimensions(source.sheets.find(s=>s.properties.sheetId===WIRE_ID),{rows:rowCount+5,columns:20}));
  requests.push({updateCells:{range:{sheetId:WIRE_ID,startRowIndex:0,endRowIndex:1,startColumnIndex:0,endColumnIndex:1},rows:[{values:[{userEnteredValue:{formulaValue:formula}}]}],fields:'userEnteredValue'}});
  return {requests,manifest,formula,expectedRows};
}
