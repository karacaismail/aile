import {grid,value,column,clone} from '../finance-engine/cells.mjs';
import {buildFinance,checkDependencies} from './native-finance.mjs';
import {existingIsolation} from './isolate-source.mjs';
import {monthlyOutput} from './monthly-output.mjs';
import {buildConsumerBridge} from './bridge.mjs';
import {purchaseDates} from './purchase-dates.mjs';
import {panoVariance} from './pano-variance.mjs';
import {buildWire,payloadFromManifest} from './finance-wire.mjs';
import {growDimensions} from './dimensions.mjs';
import {protectInputs} from './protected-inputs.mjs';
import {inputFingerprint,assertRefreshOwnership} from './ownership.mjs';
/** Build one complete generation. IO and commit locking belong to the runtime. */
export function buildCandidate({source:before,config,prior,computed,hash,now}) {
 assertRefreshOwnership(before,prior,{hash});
 const targetSpreadsheetId=config.targetSpreadsheetId??before.spreadsheetId;
 if(before.spreadsheetId!==targetSpreadsheetId)throw Error('Explicit finance target mismatch');
 const overlay=createCandidateSource(before),source=overlay.source,sourceGrid=overlay.grid,beforeGrid=overlay.beforeGrid,result=clone(computed.result),ledger=computed.ledger,current=computed.currentLedger,currentInput=computed.currentInput,facts=config.facts;
 const sourceHash=inputFingerprint({source:before,config,prior,hash}),engineHash=config.engineHash??hash(config.engineVersion);
 result.currentIssues=currentInput.issues;
 result.generatedAt=now;result.source.sha256=sourceHash;result.planningFx.sourceSnapshotSha256=sourceHash;
 const ownedSheetIds={view:before.sheets.find(s=>s.properties.title==='Finansman')?.properties.sheetId,control:before.sheets.find(s=>s.properties.title==='_Finans kontrol')?.properties.sheetId};
 if(!Number.isInteger(ownedSheetIds.view)||!Number.isInteger(ownedSheetIds.control))throw Error('Finance sheets must be installed before automatic refresh');
 const isolation=existingIsolation(source,{targetSpreadsheetId,sheetId:source.sheets.find(s=>s.properties.title==='_Finans ham')?.properties.sheetId});
 const controls={alreadyIsolated:true,mapping:prior.controls.mapping,rewrites:[],requests:[]};
 const priority=sourceGrid('Öncelik planı'),ariziBefore=sourceGrid('Arızi Giderler');
 const items=priority.slice(110,206).map((r,index)=>{
  const key=value(r?.[0]),q=index+110,a=ariziBefore.findIndex(row=>value(row?.[15])===key);
  if(typeof key!=='string'||!key)throw Error('Missing stable date source');
  if(a<0){if(result.prioritySchedule.some(p=>p.key===key))throw Error('Scheduled purchase source disappeared');return{key,ariziRow:null,priorityRow:q+1,priorityDateFormula:priority[q][10]?.userEnteredValue?.formulaValue,priorityCapacityFormula:priority[q][16]?.userEnteredValue?.formulaValue,currentEntered:{}};}
  const cell=ariziBefore[a][4];
  return{key,ariziRow:a+1,priorityRow:q+1,ariziFormula:cell?.userEnteredValue?.formulaValue,manualDate:value(cell),priorityDateFormula:priority[q][10]?.userEnteredValue?.formulaValue,priorityCapacityFormula:priority[q][16]?.userEnteredValue?.formulaValue,currentEntered:ariziBefore[a][5]?.userEnteredValue??{}};
 });
 const dates=purchaseDates({items,schedule:result.prioritySchedule,sheetIds:{priority:source.sheets.find(s=>s.properties.title==='Öncelik planı').properties.sheetId,arizi:source.sheets.find(s=>s.properties.title==='Arızi Giderler').properties.sheetId,raw:isolation.sheetId},priorCatalogue:prior.dates.catalogue});
 for(const u of dates.updates)overlay.set('Öncelik planı',u.row,u.column,{formulaValue:u.formula},u.value===''?{stringValue:''}:{numberValue:u.value});
 for(const item of items){const update=dates.updates.find(u=>u.key===item.key);if(!update)continue;const effective=update.value===''?{stringValue:''}:{numberValue:update.value};overlay.set('Arızi Giderler',item.ariziRow-1,4,{formulaValue:item.ariziFormula},effective);if(item.currentEntered.formulaValue)overlay.set('Arızi Giderler',item.ariziRow-1,5,item.currentEntered,effective);}
 overlay.flush();
 for(const event of result.planningFx.savingEvents){const map=isolation.mapping.find(m=>m.oldAddress===event.liveReference);if(map)event.liveReference=map.newAddress;}
const additionalDependencies=[];const add=(title,row,col)=>{const sh=source.sheets.find(s=>s.properties.title===title),c=sourceGrid(title)[row]?.[col]??{};additionalDependencies.push({kind:'cell',title,sheetId:sh.properties.sheetId,row,column:col,address:`'${title}'!${column(col)}${row+1}`,entered:c.userEnteredValue??{},effective:c.effectiveValue??{},tolerance:1e-6});};
for(const m of controls.mapping)add('_Finans ham',m.targetRow,m.targetColumn);
for(const row of[2,5,6,7,8,12,13,14,15,16,17,21,22,23,24,25,26,27,28,32,33,37,38,39,43,44,45,46,47,57,58,59,60,61])for(let c=2;c<16;c++)add('Gerçekleşen',row-1,c);
for(const m of isolation.mapping)if(m.target.row!==6)add('_Finans ham',m.target.row,m.target.column);
const arizi=sourceGrid('Arızi Giderler');for(let r=4;r<arizi.length;r++)if(value(arizi[r]?.[15]))for(const c of[3,4,5,6,7])add('Arızi Giderler',r,c);
const formulaOnlyAddresses=[];const priorityIds=priority.slice(110,206).map(r=>value(r?.[0]));if(priorityIds.some(x=>typeof x!=='string'||!x)||new Set(priorityIds).size!==priorityIds.length)throw new Error('Priority identities must be unique and nonempty');for(let r=110;r<206;r++)add('Öncelik planı',r,0);
for(const m of isolation.mapping)if([5,8,9].includes(m.target.row))formulaOnlyAddresses.push(`'_Finans ham'!${column(m.target.column)}${m.target.row+1}`);
for(const i of items){if(i.ariziRow===null)continue;for(const c of[4,5])if(sourceGrid('Arızi Giderler')[i.ariziRow-1][c]?.userEnteredValue?.formulaValue)formulaOnlyAddresses.push(`'Arızi Giderler'!${column(c)}${i.ariziRow}`);for(const c of[10,16]){add('Öncelik planı',i.priorityRow-1,c);if(sourceGrid('Öncelik planı')[i.priorityRow-1]?.[c]?.userEnteredValue?.formulaValue)formulaOnlyAddresses.push(`'Öncelik planı'!${column(c)}${i.priorityRow}`);}}
const flow=sourceGrid('_Taşınma akışı');for(let r=100;r<196;r++)if(value(flow[r]?.[2])==='Esnek')formulaOnlyAddresses.push(`'_Taşınma akışı'!D${r+1}`);
// User-owned method, bank, terms and price inputs remain guarded independently of output dates.
const kasa=sourceGrid('Kasa');for(let r=42;r<409;r++)if(value(kasa[r]?.[0]))for(const c of[0,2,3,7,8,9,10,11,12,13]){add('Kasa',r,c);if(c===13&&kasa[r]?.[c]?.userEnteredValue?.formulaValue)formulaOnlyAddresses.push(`'Kasa'!N${r+1}`);}
const modelInput=computed.modelInput,usedIds=new Set([...modelInput.cashEvents,...modelInput.purchases].map(e=>e.id)),inputEventRows=sourceGrid('_Timeline kaynak').flatMap((r,i)=>usedIds.has(value(r?.[0]))?[i]:[]);if(inputEventRows.length!==usedIds.size)throw new Error('Fixed source IDs do not match engine inputs');
const finance=buildFinance({source,result,ledger,facts,sourceHash,engineHash,targetSpreadsheetId,additionalDependencies,inputEventRows,formulaOnlyAddresses,ownedSheetIds});const preflight=checkDependencies(finance.manifest,source);if(preflight.length)throw new Error(JSON.stringify(preflight.slice(0,20)));
const planMonthly=monthlyOutput(ledger),currentMonthly=monthlyOutput(current),generationHash=hash(JSON.stringify({sourceHash,engineHash,planMonthly,currentMonthly,currentChanges:currentInput.changes,issues:currentInput.issues})),bridge=buildConsumerBridge({source,planMonthly,currentMonthly,generationHash,planningFx:result.planningFx});
const variance=panoVariance(source);
const updates=finance.requests.filter(r=>r.updateCells);const maxrow=new Map();for(const r of updates)maxrow.set(r.updateCells.range.sheetId,Math.max(maxrow.get(r.updateCells.range.sheetId)??0,r.updateCells.range.endRowIndex));const resize=[...maxrow].flatMap(([sheetId,rowCount])=>growDimensions(before.sheets.find(s=>s.properties.sheetId===sheetId),{rows:rowCount+5}));
const labels=[['Plan',57,'Gelirden kalan · birikim öncesi'],['Plan',72,'Net nakit ve borç · KMH dahil'],['Plan',77,'Toplam varlık · tarihli TL planı'],['Gerçekleşen',56,'Gelirden kalan · birikim öncesi'],['Kasa',10,'Finansman girişi · kredi / KMH'],['Kasa',14,'KMH anapara + ödenen maliyet'],['Kasa',17,'Birikimden aktarım'],['Kasa',26,'Finansman girişi · kredi / KMH'],['Kasa',30,'KMH anapara + ödenen maliyet'],['Kasa',33,'Birikimden aktarım']].map(([title,row,label])=>({updateCells:{range:{sheetId:source.sheets.find(s=>s.properties.title===title).properties.sheetId,startRowIndex:row-1,endRowIndex:row,startColumnIndex:1,endColumnIndex:2},rows:[{values:[{userEnteredValue:{stringValue:label}}]}],fields:'userEnteredValue'}}));
if(!isolation.alreadyIsolated)isolation.requests[0].addSheet.properties.gridProperties.rowCount=100;
const dateRequests=dates.updates.map(u=>({updateCells:{range:{sheetId:u.sheetId,startRowIndex:u.row,endRowIndex:u.row+1,startColumnIndex:u.column,endColumnIndex:u.column+1},rows:[{values:[{userEnteredValue:{formulaValue:u.formula}}]}],fields:'userEnteredValue'}}));
const provenance={updateCells:{range:{sheetId:isolation.sheetId,startRowIndex:13,endRowIndex:13+dates.provenance.length,startColumnIndex:0,endColumnIndex:6},rows:dates.provenance.map(i=>({values:[i.key,i.ariziRow,i.priorityRow,i.priorityDateFormula,i.priorityCapacityFormula,i.newDate].map(v=>({userEnteredValue:{stringValue:String(v)}}))})),fields:'userEnteredValue'}};
const timelineId=source.sheets.find(s=>s.properties.title==='Timeline').properties.sheetId,timelineLast=6+finance.manifest.eventCount,clearTimelineLast=Math.max(timelineLast,prior.mirror?.lastRow??0),mirror={sheetId:timelineId,firstHeaderRow:5,lastRow:timelineLast,columns:18,formula:`=ARRAYFORMULA(Finansman!A43:R${43+finance.manifest.eventCount})`,sourceHeaderRow:42};
const mirrorRequests=[...growDimensions(before.sheets.find(s=>s.properties.sheetId===timelineId),{rows:clearTimelineLast,columns:18}),{updateSheetProperties:{properties:{sheetId:timelineId,gridProperties:{frozenRowCount:6}},fields:'gridProperties.frozenRowCount'}},{unmergeCells:{range:{sheetId:timelineId,startRowIndex:0,endRowIndex:timelineLast,startColumnIndex:0,endColumnIndex:18}}},{updateCells:{range:{sheetId:timelineId,startRowIndex:0,endRowIndex:clearTimelineLast,startColumnIndex:0,endColumnIndex:18},rows:[],fields:'userEnteredValue'}},{updateCells:{range:{sheetId:timelineId,startRowIndex:0,endRowIndex:6,startColumnIndex:0,endColumnIndex:1},rows:[{values:[{userEnteredValue:{stringValue:'Timeline · ödeme akışı'}}]},{values:[{userEnteredValue:{formulaValue:'=Finansman!A2'}}]},{values:[{userEnteredValue:{formulaValue:'=Finansman!A8'}}]},{values:[{userEnteredValue:{formulaValue:'=Finansman!A9'}}]},{values:[{userEnteredValue:{formulaValue:'=Finansman!A3'}}]},{values:[{userEnteredValue:{formulaValue:mirror.formula}}]}],fields:'userEnteredValue'}}];
for(const row of[0,1,2,3,4])mirrorRequests.push({mergeCells:{range:{sheetId:timelineId,startRowIndex:row,endRowIndex:row+1,startColumnIndex:0,endColumnIndex:18},mergeType:'MERGE_ALL'}});
mirrorRequests.push({copyPaste:{source:{sheetId:ownedSheetIds.view,startRowIndex:42,endRowIndex:43+finance.manifest.eventCount,startColumnIndex:0,endColumnIndex:18},destination:{sheetId:timelineId,startRowIndex:5,endRowIndex:6+finance.manifest.eventCount,startColumnIndex:0,endColumnIndex:18},pasteType:'PASTE_FORMAT'}});
const wire=prior?.wire?buildWire({source:before,payload:payloadFromManifest(finance.manifest),prior:prior.wire,targetSpreadsheetId,hash}):null;
const generatedClears=prior.ranges.filter(r=>['Finansman','_Finans kontrol','_Finans aylık'].includes(r.title)&&r.startRow===0&&r.startColumn===0).map(r=>({updateCells:{range:{sheetId:r.sheetId,startRowIndex:r.startRow,endRowIndex:r.endRow,startColumnIndex:r.startColumn,endColumnIndex:r.endColumn},rows:[],fields:'userEnteredValue'}}));
const requests=protectInputs([...generatedClears,...isolation.requests,...controls.requests,...dateRequests,...(isolation.alreadyIsolated?[]:[provenance]),...resize,...updates,...bridge.requests.filter(r=>!isolation.alreadyIsolated||!r.addSheet),...labels,...mirrorRequests,...variance.requests,...(wire?.requests??[])],finance.manifest.inputs);
const touched=requests.filter(r=>r.updateCells).flatMap(r=>{const u=r.updateCells;return(u.rows??[]).flatMap((row,i)=>(row.values??[]).map((c,j)=>({sheetId:u.range.sheetId,row:u.range.startRowIndex+i,column:u.range.startColumnIndex+j,entered:c.userEnteredValue??{}})));});
const oldById=new Map(before.sheets.map(s=>[s.properties.sheetId,s]));const targets=touched.filter(t=>oldById.has(t.sheetId)&&![ownedSheetIds.view,ownedSheetIds.control].includes(t.sheetId)).map(t=>{const title=oldById.get(t.sheetId).properties.title;return{...t,title,before:beforeGrid(title)[t.row]?.[t.column]?.userEnteredValue??{}};});
for(const t of bridge.targets){const actual=beforeGrid(t.title)[t.row]?.[t.column]?.userEnteredValue;if(!actual?.formulaValue)throw new Error('Cannot overwrite user value at '+t.title+'!'+column(t.column)+(t.row+1));}
const beforeTimeline=beforeGrid('Timeline');const clearRanges=[{title:'Timeline',sheetId:timelineId,startRow:0,endRow:clearTimelineLast,startColumn:0,endColumn:18,cells:Array.from({length:clearTimelineLast},(_,row)=>Array.from({length:18},(_,column)=>({row,column,entered:beforeTimeline[row]?.[column]?.userEnteredValue??{}}))).flat()}];
const output={...(wire?{wire:wire.manifest}:{}),variance,controls,clearRanges,sourceSpreadsheetId:before.spreadsheetId,targetSpreadsheetId,requests,financeManifest:finance.manifest,bridge,isolation,dates,mirror,labels,targets,sourceHash,generationHash,issues:currentInput.issues,inputFingerprint:sourceHash,proof:'Candidate only; native application and calculation not verified'};
for(const r of prior.ranges.filter(r=>['Finansman','_Finans kontrol','_Finans aylık'].includes(r.title)&&r.startRow===0&&r.startColumn===0))output.clearRanges.push({...r,cells:[]});
output.retainedRanges=prior.ranges.filter(range=>!requests.some(request=>{const u=request.updateCells?.range;return u&&u.sheetId===range.sheetId&&u.startRowIndex<range.endRow&&u.endRowIndex>range.startRow&&u.startColumnIndex<range.endColumn&&u.endColumnIndex>range.startColumn;}));
assertExpansionOwnership(before,prior,output,beforeGrid);
return output;
}

function assertExpansionOwnership(source,prior,candidate,beforeGrid){
 const byId=new Map(source.sheets.map(sheet=>[sheet.properties.sheetId,sheet]));
 const rangesBySheet=new Map();for(const range of prior.ranges){if(!rangesBySheet.has(range.sheetId))rangesBySheet.set(range.sheetId,[]);rangesBySheet.get(range.sheetId).push(range);}
 const dateOwners=new Map(prior.dates.catalogue.map(item=>[item.priorityRow,item.owner]));
 const covers=(range,row,col)=>row>=range.startRow&&row<range.endRow&&col>=range.startColumn&&col<range.endColumn;
 for(const request of candidate.requests){const u=request.updateCells;if(!u)continue;const title=byId.get(u.range.sheetId)?.properties.title,ranges=rangesBySheet.get(u.range.sheetId)??[];
  for(let row=u.range.startRowIndex;row<u.range.endRowIndex;row++)for(let col=u.range.startColumnIndex;col<u.range.endColumnIndex;col++){
   if(ranges.some(r=>covers(r,row,col)))continue;
   const entered=beforeGrid(title)?.[row]?.[col]?.userEnteredValue??{};if(Object.keys(entered).length===0)continue;
   const owner=title==='Öncelik planı'&&dateOwners.get(row+1);
   if(owner&&[10,16].includes(col)&&entered.formulaValue===owner[col===10?'K':'Q'])continue;
   throw Error('Unowned data in output expansion: '+title+'/'+(row+1)+'/'+(col+1));
  }
 }
}

/** A copy-on-write overlay: only the two date grids can change. Generated output
 * bodies are never cloned; all other source sheets remain read-only references. */
export function createCandidateSource(before){
 const excluded=new Set(['Finansman','_Finans kontrol','_Finans web']),mutable=new Set(['Öncelik planı','Arızi Giderler']);
 const source={...before,sheets:before.sheets.filter(sheet=>!excluded.has(sheet.properties.title))};
 const originals=new Map(before.sheets.map(sheet=>[sheet.properties.title,sheet])),beforeCache=new Map(),draftCache=new Map(),dirty=new Set();
 const beforeGrid=title=>{if(!beforeCache.has(title))beforeCache.set(title,grid(before,title));return beforeCache.get(title);};
 const draftGrid=title=>{if(!originals.has(title)||excluded.has(title))throw Error('Missing candidate source sheet: '+title);if(!draftCache.has(title)){const rows=beforeGrid(title);draftCache.set(title,mutable.has(title)?rows.map(row=>row?.slice()):rows);}return draftCache.get(title);};
 return{source,grid:draftGrid,beforeGrid,set(title,row,col,entered,effective){
  if(!mutable.has(title))throw Error('Unsupported candidate source mutation: '+title);
  const rows=draftGrid(title);rows[row]??=[];rows[row][col]={userEnteredValue:entered,effectiveValue:effective};dirty.add(title);
 },flush(){
  for(const title of dirty){const rows=draftGrid(title),index=source.sheets.findIndex(sheet=>sheet.properties.title===title);source.sheets[index]={...originals.get(title),data:[{rowData:Array.from({length:rows.length},(_,r)=>({values:rows[r]??[]}))}]};}
  dirty.clear();
 }};
}
