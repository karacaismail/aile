import {afterEach,describe,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {load,save,ensureFinanceTriggers,financeChanged,DurableStateStore,FinanceSheetRepository} from '../finance/main.mjs';

const prefix='FINANCE_AUTO_V1_';
function harness(){
 const data=new Map<string,string>();let failPointer=false;
 const reads=vi.fn();
 const properties={getProperties:()=>{reads();return Object.fromEntries(data);},getProperty:(k:string)=>{reads();return data.get(k)??null;},getKeys:()=>[...data.keys()],deleteProperty:(k:string)=>data.delete(k),setProperty:(k:string,v:string)=>{if(failPointer&&k===prefix+'ACTIVE')throw Error('interrupted');data.set(k,v);},setProperties:(items:Record<string,string>)=>Object.entries(items).forEach(([k,v])=>data.set(k,v))};
 const blob=(v:string|number[]|Buffer,contentType?:string)=>{const b=Buffer.isBuffer(v)?v:typeof v==='string'?Buffer.from(v):Buffer.from(v);return{getBytes:()=>b,getDataAsString:()=>b.toString('utf8'),contentType};};
 vi.stubGlobal('PropertiesService',{getScriptProperties:()=>properties});
 vi.stubGlobal('Utilities',{newBlob:blob,gzip:(b:ReturnType<typeof blob>)=>{expect(b.contentType).toBe('application/json');return blob(gzipSync(b.getBytes()),'application/gzip');},ungzip:(b:ReturnType<typeof blob>)=>{expect(b.contentType).toBe('application/gzip');return blob(gunzipSync(b.getBytes()),'application/json');},base64Encode:(b:Buffer)=>b.toString('base64'),base64Decode:(s:string)=>Buffer.from(s,'base64'),DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:(_:unknown,s:string)=>[...createHash('sha256').update(s).digest()]});
 return{data,reads,properties,utilities:Utilities,interrupt:(v:boolean)=>{failPointer=v;}};
}
afterEach(()=>vi.unstubAllGlobals());
describe('durable Apps Script finance state',()=>{
 it('groups REST reads within the transport budget without dropping sheets or allocated tails',()=>{
  const sheets=Array.from({length:7},(_,i)=>({properties:{title:'Sheet'+i,sheetId:i,gridProperties:{rowCount:100+i,columnCount:20}}}));
  const get=vi.fn((_:string,options:{ranges?:string[]})=>!options.ranges?{spreadsheetId:'test',sheets}:{sheets:options.ranges.map(range=>sheets.find(s=>range.startsWith("'"+s.properties.title+"'")))});
  const repository=new FinanceSheetRepository({spreadsheets:{get,maxRangesPerRequest:4},flush:()=>{},log:()=>{}});
  const source=repository.capture({targetId:'test',config:{readBounds:Object.fromEntries(sheets.map(s=>[s.properties.title,[1,1]]))},prior:{ranges:[]}});
  expect(get.mock.calls.slice(1).map(call=>call[1].ranges!.length)).toEqual([4,3]);
  expect(get.mock.calls[2]![1].ranges).toContain("'Sheet6'!A1:T106");
  expect(source.sheets.map((s:{properties:{sheetId:number}})=>s.properties.sheetId)).toEqual([0,1,2,3,4,5,6]);
 });
 it('loads a coherent property snapshot with one service read',()=>{
  const h=harness();save({generation:'one'});h.reads.mockClear();
  expect(load()).toEqual({generation:'one'});
  expect(h.reads).toHaveBeenCalledTimes(1);
 });
 it('keeps the last complete state when writing the active pointer is interrupted',()=>{
  const h=harness();save({generation:'one'});h.interrupt(true);
  expect(()=>save({generation:'two'})).toThrow('interrupted');
  expect(load()).toEqual({generation:'one'});
  h.interrupt(false);save({generation:'three'});
  expect(load()).toEqual({generation:'three'});
  const active=h.data.get(prefix+'ACTIVE')!;
  expect([...h.data.keys()].every(k=>k===prefix+'ACTIVE'||k.startsWith(prefix+active+'_'))).toBe(true);
 });
 it('cleans abandoned banks before the next allocation and rejects damaged active data',()=>{
  const h=harness();save({generation:'one'});
  for(let i=0;i<40;i++)h.data.set(prefix+'orphan_'+i,'x'.repeat(7500));
  save({generation:'two'});
  expect([...h.data.keys()].some(k=>k.includes('orphan'))).toBe(false);
  h.data.set(prefix+h.data.get(prefix+'ACTIVE')+'_0','corrupt');
  expect(()=>load()).toThrow('bütünlüğü');
 });
 it('captures user-added rows and columns beyond the previous output area',()=>{
  const get=vi.fn().mockReturnValueOnce({spreadsheetId:'test',sheets:[{properties:{title:'Timeline',gridProperties:{rowCount:1500,columnCount:20}}}]}).mockReturnValueOnce({spreadsheetId:'test',sheets:[]});
  const repository=new FinanceSheetRepository({spreadsheets:{get},flush:()=>{}});
  repository.capture({targetId:'test',config:{readBounds:{Timeline:[800,18]}},prior:{ranges:[]}});
  expect(get.mock.calls[1]?.[1].ranges).toEqual(["'Timeline'!A1:T1500"]);
 });
 it('reads separate sheets in bounded responses rather than one oversized native response',()=>{
  const sheets=['Plan','Timeline'].map((title,i)=>({properties:{title,sheetId:i,gridProperties:{rowCount:1500,columnCount:20}}}));
  const get=vi.fn((_:string,options:{ranges?:string[]})=>{
   if(!options.ranges)return {spreadsheetId:'test',properties:{locale:'tr_TR'},sheets};
   if(options.ranges.length!==1)throw Error('native response exceeds memory');
   const sheet=options.ranges[0]!.startsWith("'Plan'")?sheets[0]:sheets[1];
   return {spreadsheetId:'test',sheets:[{...sheet,data:[{rowData:[{values:[{effectiveValue:{numberValue:42}}]}]}]}]};
  });
  const repository=new FinanceSheetRepository({spreadsheets:{get},flush:()=>{}});
  const source=repository.capture({targetId:'test',config:{readBounds:{Plan:[80,16],Timeline:[800,18]}},prior:{ranges:[]}});
  expect(source.sheets).toHaveLength(2);
  expect(source.sheets[1].data[0].rowData[0].values[0].effectiveValue.numberValue).toBe(42);
  expect(source.properties.locale).toBe('tr_TR');
 });
 it('reads the exchange-rate header without loading unrelated generated helper matrices',()=>{
  const get=vi.fn().mockReturnValueOnce({spreadsheetId:'test',sheets:[{properties:{title:'_Kasa hesap',gridProperties:{rowCount:1000,columnCount:160}}}]}).mockReturnValueOnce({sheets:[]});
  const repository=new FinanceSheetRepository({spreadsheets:{get},flush:()=>{}});
  repository.capture({targetId:'test',config:{readBounds:{'_Kasa hesap':[1,156]}},prior:{ranges:[]}});
  expect(get.mock.calls[1]?.[1].ranges).toEqual(["'_Kasa hesap'!A1:FD1"]);
 });
 it('installs one trigger per purpose for the correct workbook, preserving unrelated triggers',()=>{
  const h=harness();let sequence=0;
  type Trigger={getHandlerFunction:()=>string;getEventType:()=>string;getTriggerSourceId:()=>string;getUniqueId:()=>string};
  const trigger=(handler:string,type:string,target='')=>{const id=String(++sequence);return{getHandlerFunction:()=>handler,getEventType:()=>type,getTriggerSourceId:()=>target,getUniqueId:()=>id};};
  const intervals:number[]=[];
  const all:Trigger[]=[trigger('other','ON_EDIT','test'),trigger('financeEdited','ON_EDIT','wrong'),trigger('financeTimer','CLOCK'),trigger('financeTimer','CLOCK')];
  vi.stubGlobal('ScriptApp',{EventType:{CLOCK:'CLOCK',ON_EDIT:'ON_EDIT',ON_CHANGE:'ON_CHANGE'},getProjectTriggers:()=>[...all],deleteTrigger:(t:Trigger)=>all.splice(all.indexOf(t),1),newTrigger:(handler:string)=>{
   let target='',type='';const builder={forSpreadsheet:(id:string)=>{target=id;return builder;},onEdit:()=>{type='ON_EDIT';return builder;},onChange:()=>{type='ON_CHANGE';return builder;},timeBased:()=>{type='CLOCK';return builder;},everyMinutes:(n:number)=>{intervals.push(n);return builder;},create:()=>{const created=trigger(handler,type,target);all.push(created);return created;}};return builder;
  }});
  ensureFinanceTriggers('test');ensureFinanceTriggers('test');
  expect(all.map(t=>[t.getHandlerFunction(),t.getEventType(),t.getTriggerSourceId()])).toEqual([['other','ON_EDIT','test'],['financeEdited','ON_EDIT','test'],['financeChanged','ON_CHANGE','test']]);
  expect(intervals).toEqual([]);
  save({generation:'one'});ensureFinanceTriggers('test');
  expect(intervals).toEqual([]);
  expect(h.data.size).toBeGreaterThan(0);
 });
});


describe('injected finance runtime boundaries',()=>{
 it('keeps two durable stores isolated without consulting global services',()=>{
  const first=harness(),second=harness();
  const a=new DurableStateStore({properties:first.properties,utilities:first.utilities});
  const b=new DurableStateStore({properties:second.properties,utilities:second.utilities});
  vi.unstubAllGlobals();
  a.save({generation:'first'});b.save({generation:'second'});
  expect(a.load()).toEqual({generation:'first'});
  expect(b.load()).toEqual({generation:'second'});
  first.interrupt(true);
  expect(()=>a.save({generation:'interrupted'})).toThrow('interrupted');
  expect(a.load()).toEqual({generation:'first'});
  expect(b.load()).toEqual({generation:'second'});
 });
 it('does not flush a rejected write and propagates the original repository failure',()=>{
  const failure=new Error('rejected batch'),flush=vi.fn(),log=vi.fn();let now=10;
  const api={get:vi.fn(),batchUpdate:vi.fn(()=>{throw failure;})};
  const repository=new FinanceSheetRepository({spreadsheets:api,flush,clock:()=>now++,log});
  const state={targetId:'synthetic-sheet',prior:{financeSheets:[{title:'_Finans kontrol',sheetId:9}]}};
  expect(()=>repository.apply({requests:[{test:'write'}]},state)).toThrow(failure);
  expect(flush).not.toHaveBeenCalled();
  expect(api.batchUpdate).toHaveBeenCalledExactlyOnceWith({requests:[{test:'write'}]},'synthetic-sheet');
  expect(log).toHaveBeenCalledWith({phase:'apply',milliseconds:1,status:'error'});
  expect(()=>repository.gate(state,{boolValue:false})).toThrow(failure);
  expect(flush).not.toHaveBeenCalled();
 });
 it('uses only the injected workbook API and rejects partial captures',()=>{
  const error=new Error('second response failed'),flush=vi.fn(),log=vi.fn();
  const metadata={spreadsheetId:'synthetic-sheet',sheets:['Plan','Timeline'].map((title,sheetId)=>({properties:{title,sheetId,gridProperties:{rowCount:100,columnCount:20}}}))};
  const get=vi.fn().mockReturnValueOnce(metadata).mockReturnValueOnce({sheets:[metadata.sheets[0]]}).mockImplementationOnce(()=>{throw error;});
  const repository=new FinanceSheetRepository({spreadsheets:{get,batchUpdate:vi.fn()},flush,clock:()=>0,log});
  const state={targetId:'synthetic-sheet',config:{readBounds:{Plan:[80,16],Timeline:[90,18]}},prior:{ranges:[]}};
  vi.unstubAllGlobals();
  expect(()=>repository.capture(state)).toThrow(error);
  expect(get).toHaveBeenCalledTimes(3);
  expect(get.mock.calls[1]?.[1].fields).not.toContain('formattedValue');
  expect(flush).not.toHaveBeenCalled();
  expect(log).toHaveBeenLastCalledWith({phase:'capture',milliseconds:0,status:'error'});
 });
 it('ignores the duplicate ON_CHANGE EDIT without loading state or touching Sheets',()=>{
  vi.unstubAllGlobals();
  expect(financeChanged({changeType:'EDIT'})).toBe('ignored');
 });
});
