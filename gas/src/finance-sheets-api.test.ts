import {describe,expect,it,vi} from 'vitest';
import {sheetsApi} from '../finance/sheets-api.mjs';

const reply=(data:unknown,status=200)=>({getResponseCode:()=>status,getContentText:()=>JSON.stringify(data)});
describe('authenticated Sheets transport',()=>{
 it('reads native cell types using only the fixed Google endpoint',()=>{
  const fetch=vi.fn((_url:string,_options:Record<string,unknown>)=>reply({sheets:[{data:[{rowData:[{values:[{effectiveValue:{numberValue:42}}]}]}]}]}));
  const api=sheetsApi({fetch,token:()=> 'synthetic-token'});
  expect(api.get('synthetic-book',{ranges:["'Plan'!C5"],fields:'sheets(data)'}).sheets[0].data[0].rowData[0].values[0].effectiveValue.numberValue).toBe(42);
  const [url,options]=fetch.mock.calls[0]!;
  expect(url).toBe('https://sheets.googleapis.com/v4/spreadsheets/synthetic-book?ranges=%27Plan%27!C5&fields=sheets(data)');
  expect(options).toMatchObject({headers:{Authorization:'Bearer synthetic-token'},followRedirects:false,muteHttpExceptions:true});
 });
 it('keeps all mutations in one atomic batch request',()=>{
  const fetch=vi.fn((_url:string,_options:Record<string,unknown>)=>reply({replies:[]}));const api=sheetsApi({fetch,token:()=> 'synthetic-token'});
  const body={requests:[{updateCells:{rows:[]}},{appendDimension:{length:1}}]};
  api.batchUpdate(body,'synthetic-book');
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch.mock.calls[0]![0]).toBe('https://sheets.googleapis.com/v4/spreadsheets/synthetic-book:batchUpdate');
  expect(fetch.mock.calls[0]![1]).toMatchObject({method:'post',contentType:'application/json',payload:JSON.stringify(body)});
 });
 it('rejects malformed workbook IDs before sending credentials',()=>{
  const fetch=vi.fn();const api=sheetsApi({fetch,token:()=> 'synthetic-token'});
  expect(()=>api.get('book/../../elsewhere',{})).toThrow('kimliği');expect(fetch).not.toHaveBeenCalled();
 });
 it('does not disclose returned private payloads or credentials on failed requests',()=>{
  const fetch=vi.fn((_url:string,_options:Record<string,unknown>)=>reply({error:{message:'private input synthetic-token'}},403));
  expect(()=>sheetsApi({fetch,token:()=> 'synthetic-token'}).get('book',{})).toThrow('Google Sheets HTTP 403');
 });
});
