import {grid} from '../finance-engine/cells.mjs';
const key=(title,row,column)=>`${title}/${row}/${column}`;
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>[k,stable(v[k])])):v;
const encode=v=>JSON.stringify(stable(v));
const contains=(range,row,col)=>row>=range.startRow&&row<range.endRow&&col>=range.startColumn&&col<range.endColumn&&!range.excluded?.some(([r,c])=>row===r&&col===c);
const digestRange=(range,get,hash)=>hash(encode(Array.from({length:range.endRow-range.startRow},(_,r)=>Array.from({length:range.endColumn-range.startColumn},(_,c)=>{const row=r+range.startRow,col=c+range.startColumn;return contains(range,row,col)?get(row,col):null;}))));
/** Durable ownership stores digests, not duplicated 40MB candidate snapshots. */
export function compactOwnership(candidate,{hash}={}) {
 if(typeof hash!=='function')throw Error('SHA256 hash dependency required');
 const sheets=new Map((candidate.financeManifest?.sheets??[]).map(s=>[s.sheetId,s.title]));
 const expected=new Map(),rows=new Map(),ranges=[];
 const add=(title,sheetId,row,column,entered)=>{if(!title)throw Error('Missing output sheet title');sheets.set(sheetId,title);expected.set(key(title,row,column),entered??{});const id=key(title,row,0);if(!rows.has(id))rows.set(id,{title,sheetId,row,columns:new Set()});rows.get(id).columns.add(column);};
 for(const t of candidate.targets??[])add(t.title,t.sheetId,t.row,t.column,t.entered);
 for(const c of candidate.financeManifest?.cells??[])add(sheets.get(c.sheetId),c.sheetId,c.row,c.column,c.entered);
 for(const c of candidate.bridge?.cells??[])add('_Finans aylık',c.sheetId,c.row,c.column,c.entered);
 const mutable=new Set((candidate.financeManifest?.inputs??[]).filter(i=>['planningEurTry','planningUsdTry'].includes(i.key)).map(i=>key(sheets.get(i.sheetId),i.row,i.column)));
 mutable.add(key('_Finans kontrol',1,1));
 const whole=[...(candidate.clearRanges??[]).map(({cells,...r})=>r)];
 if(candidate.wire)whole.push({title:candidate.wire.title??'_Finans web',sheetId:candidate.wire.sheetId,startRow:0,endRow:candidate.wire.rowCount,startColumn:0,endColumn:20});
 if(candidate.wire)add('_Finans web',candidate.wire.sheetId,0,0,{formulaValue:candidate.wire.formula});
 // Generated sheets own their complete rectangle, including blank cells.
 for(const title of ['Finansman','_Finans kontrol','_Finans aylık']){const owned=[...rows.values()].filter(r=>r.title===title);if(owned.length)whole.push({title,sheetId:owned[0].sheetId,startRow:0,endRow:Math.max(...owned.map(r=>r.row))+1,startColumn:0,endColumn:Math.max(...owned.flatMap(r=>[...r.columns]))+1});}
 const finish=range=>{range.excluded=[];for(let r=range.startRow;r<range.endRow;r++)for(let c=range.startColumn;c<range.endColumn;c++)if(mutable.has(key(range.title,r,c)))range.excluded.push([r,c]);range.digest=digestRange(range,(r,c)=>expected.get(key(range.title,r,c))??{},hash);ranges.push(range);};
 for(const range of whole)finish({...range});
 for(const row of rows.values()){
  const cols=[...row.columns].filter(c=>!whole.some(r=>r.title===row.title&&contains(r,row.row,c))).sort((a,b)=>a-b);
  // Split noncontiguous owned columns so unrelated user input stays editable.
  for(let i=0;i<cols.length;){let j=i+1;while(j<cols.length&&cols[j]===cols[j-1]+1)j++;finish({title:row.title,sheetId:row.sheetId,startRow:row.row,endRow:row.row+1,startColumn:cols[i],endColumn:cols[j-1]+1});i=j;}
 }
 ranges.push(...(candidate.retainedRanges??[]));
 const dates=(candidate.dates?.catalogue??[]).map(({key,ariziRow,priorityRow,owner,managed,manual})=>({key,ariziRow,priorityRow,owner,managed,manual}));
 const wire=candidate.wire?Object.fromEntries(['schema','sheetId','title','rowCount','eventCount','monthCount','digest','sourceHash','formula','range','metadataRange'].map(k=>[k,candidate.wire[k]])):undefined;
 const control=(candidate.financeManifest?.sheets??[]).find(s=>s.title==='_Finans kontrol'),gateCell=(candidate.financeManifest?.cells??[]).find(c=>c.sheetId===control?.sheetId&&c.row===1&&c.column===1);
 const gate=gateCell?{sheetId:control.sheetId,title:control.title,entered:gateCell.entered}:undefined;
 return{gate,schema:'finance-ownership-v1',sourceSpreadsheetId:candidate.sourceSpreadsheetId,targetSpreadsheetId:candidate.targetSpreadsheetId,ranges,dates:{catalogue:dates},controls:{mapping:candidate.controls?.mapping??[]},wire,mirror:candidate.mirror,financeSheets:candidate.financeManifest?.sheets??[],generationHash:candidate.generationHash};
}
export function assertRefreshOwnership(source,prior,{hash}={}){
 if(prior?.schema!=='finance-ownership-v1')throw Error('Compact finance ownership required');
 if(![prior.sourceSpreadsheetId,prior.targetSpreadsheetId].includes(source.spreadsheetId))throw Error('Workbook ownership mismatch');
 const grids=new Map(source.sheets.map(s=>[s.properties.title,grid(source,s.properties.title)]));
 if(prior.gate){const actual=grids.get(prior.gate.title)?.[1]?.[1]?.userEnteredValue??{};if(encode(actual)!==encode(prior.gate.entered)&&encode(actual)!==encode({boolValue:false}))throw Error('Publication gate ownership changed');}
 for(const range of prior.ranges){const sheet=source.sheets.find(s=>s.properties.sheetId===range.sheetId);if(sheet?.properties.title!==range.title)throw Error('Sheet ownership identity changed: '+range.title);const cells=grids.get(range.title);if(digestRange(range,(r,c)=>cells[r]?.[c]?.userEnteredValue??{},hash)!==range.digest)throw Error('Output ownership changed: '+range.title+' row '+(range.startRow+1));}
}
// Match grid's overlapping-block merge for one cell, without materializing a sheet.
function cellAt(sheet,row,column){
 let cell;
 for(const block of sheet.data??[]){
  const r=row-(block.startRow??0),c=column-(block.startColumn??0),rows=block.rowData??[];
  if(r<0||r>=rows.length||c<0)continue;
  const values=rows[r]?.values??[];if(c<values.length)cell={...cell,...values[c]};
 }
 return cell;
}
/** Inputs are entered values/formulas. Recalculated outputs and volatile caches are not inputs. */
export function inputFingerprint({source,config,prior,hash}){
 const ranges=prior?.ranges??[],entries=[];
 for(const sheet of [...source.sheets].sort((a,b)=>a.properties.sheetId-b.properties.sheetId)){
  if((config.ignoreInputSheets??[]).includes(sheet.properties.title))continue;
  const title=sheet.properties.title,data=[];
  if(['_Finans kontrol','_Finans aylık','Timeline','_Finans web'].includes(title)){
   // Sheet identity still participates in the exact same fingerprint payload.
   entries.push([sheet.properties.sheetId,title,data]);continue;
  }
  const owned=ranges.filter(r=>r.title===title);
  if(title==='Finansman'){
   for(const r of[35,36]){if(owned.some(range=>contains(range,r,11)))continue;const entered=cellAt(sheet,r,11)?.userEnteredValue??{};if(Object.keys(entered).length)data.push([r,11,entered]);}
   entries.push([sheet.properties.sheetId,title,data]);continue;
  }
  const cells=grid(source,title);
  for(let r=0;r<cells.length;r++)for(let c=0;c<(cells[r]?.length??0);c++){
   if(title==='Öncelik planı'&&r>=110&&r<206&&[10,16].includes(c)||owned.some(range=>contains(range,r,c)))continue;
   const entered=cells[r]?.[c]?.userEnteredValue??{};if(Object.keys(entered).length)data.push([r,c,entered]);
  }
  entries.push([sheet.properties.sheetId,title,data]);
 }
 return hash(encode({schema:'finance-input-v1',spreadsheetId:source.spreadsheetId,config,entries}));
}
/** One-time migration from the previously audited candidate to compact durable state. */
export function bootstrapOwnership(candidate,source,{hash}) {
 const copy={...candidate,dates:{...candidate.dates,catalogue:[]}},priority=grid(source,'Öncelik planı'),arizi=grid(source,'Arızi Giderler');
 const managed=new Set(candidate.dates?.updates?.map(u=>u.key));
 for(let r=110;r<206;r++){
  const cell=priority[r]?.[0],key=cell?.effectiveValue?.stringValue??cell?.userEnteredValue?.stringValue;
  const a=arizi.findIndex(row=>(row?.[15]?.effectiveValue?.stringValue??row?.[15]?.userEnteredValue?.stringValue)===key);
  if(!key)throw Error('Missing bootstrap purchase identity');
  copy.dates.catalogue.push({key,ariziRow:a<0?null:a+1,priorityRow:r+1,owner:{K:priority[r]?.[10]?.userEnteredValue?.formulaValue,Q:priority[r]?.[16]?.userEnteredValue?.formulaValue},managed:managed.has(key),manual:a<0||!arizi[a]?.[4]?.userEnteredValue?.formulaValue});
 }
 const prior=compactOwnership(copy,{hash});assertRefreshOwnership(source,prior,{hash});return prior;
}
