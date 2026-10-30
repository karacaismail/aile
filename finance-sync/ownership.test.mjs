import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {compactOwnership,assertRefreshOwnership,inputFingerprint} from './ownership.mjs';
const hash=text=>createHash('sha256').update(text).digest('hex');
const scalar=n=>({userEnteredValue:{numberValue:n},effectiveValue:{numberValue:n}});
const snapshot=()=>({spreadsheetId:'test',sheets:[{properties:{title:'Plan',sheetId:1},data:[{rowData:[{values:[scalar(7),scalar(100)]}]}]},{properties:{title:'Finansman',sheetId:2},data:[{rowData:[{values:[scalar(70)]}]}]}]});
const candidate={sourceSpreadsheetId:'test',targetSpreadsheetId:'test',targets:[{title:'Plan',sheetId:1,row:0,column:0,entered:{numberValue:7}}],financeManifest:{sheets:[{title:'Finansman',sheetId:2}],cells:[{sheetId:2,row:0,column:0,entered:{numberValue:70}}],inputs:[]},bridge:{cells:[]},dates:{catalogue:[]},clearRanges:[],controls:{mapping:[]}};
test('repeated refreshes do not accumulate identical ownership rectangles',()=>{
 let prior=compactOwnership(candidate,{hash});const size=prior.ranges.length;
 for(let cycle=0;cycle<20;cycle++){
  prior=compactOwnership({...candidate,clearRanges:prior.ranges.filter(r=>r.title==='Finansman')},{hash});
  assert.equal(prior.ranges.length,size);assert.doesNotThrow(()=>assertRefreshOwnership(snapshot(),prior,{hash}));
 }
 // Conflicting digests are not equivalent proofs and must still fail ownership.
 const conflict=compactOwnership({...candidate,retainedRanges:[{...prior.ranges[0],digest:'changed'}]},{hash});
 assert.throws(()=>assertRefreshOwnership(snapshot(),conflict,{hash}),/ownership/i);
});
test('compact ownership detects changes in output but permits user input',()=>{const prior=compactOwnership(candidate,{hash});const source=snapshot();assert.doesNotThrow(()=>assertRefreshOwnership(source,prior,{hash}));source.sheets[0].data[0].rowData[0].values[1]=scalar(200);assert.doesNotThrow(()=>assertRefreshOwnership(source,prior,{hash}));source.sheets[0].data[0].rowData[0].values[0]=scalar(8);assert.throws(()=>assertRefreshOwnership(source,prior,{hash}),/ownership/i);});
test('semantic fingerprint excludes owned outputs and effective recalc, includes input and config',()=>{const prior=compactOwnership(candidate,{hash});const source=snapshot(),config={engineVersion:'test-v1'};const first=inputFingerprint({source,config,prior,hash});source.sheets[0].data[0].rowData[0].values[0]=scalar(8);source.sheets[1].data[0].rowData[0].values[0]=scalar(80);source.sheets[0].data[0].rowData[0].values[1].effectiveValue={numberValue:999};assert.equal(inputFingerprint({source,config,prior,hash}),first);source.sheets[0].data[0].rowData[0].values[1]=scalar(200);assert.notEqual(inputFingerprint({source,config,prior,hash}),first);assert.notEqual(inputFingerprint({source:snapshot(),config:{engineVersion:'test-v2'},prior,hash}),first);});
test('clear range ownership rejects user content in blank spill area',()=>{const owned=structuredClone(candidate);owned.clearRanges=[{title:'Finansman',sheetId:2,startRow:0,endRow:3,startColumn:0,endColumn:2,cells:[]}];const prior=compactOwnership(owned,{hash}),source=snapshot();assert.doesNotThrow(()=>assertRefreshOwnership(source,prior,{hash}));source.sheets[1].data[0].rowData.push({values:[scalar(4)]});assert.throws(()=>assertRefreshOwnership(source,prior,{hash}),/ownership/i);});
test('closing the runtime gate does not create a new input generation',()=>{
 const source=snapshot();source.sheets.push({properties:{title:'_Finans kontrol',sheetId:3},data:[{rowData:[{}, {values:[{}, {userEnteredValue:{formulaValue:'=TRUE'},effectiveValue:{boolValue:true}}]}]}]});
 const prior=compactOwnership(candidate,{hash}),config={engineVersion:'test'};const before=inputFingerprint({source,config,prior,hash});source.sheets[2].data[0].rowData[1].values[1]={userEnteredValue:{boolValue:false},effectiveValue:{boolValue:false}};assert.equal(inputFingerprint({source,config,prior,hash}),before);
});
test('newly claimed priority output dates do not trigger a regeneration loop',()=>{
 const source=snapshot(),rows=Array.from({length:111},()=>({values:[]}));rows[110].values[10]={userEnteredValue:{formulaValue:'=TODAY()'}};source.sheets.push({properties:{title:'Öncelik planı',sheetId:3},data:[{rowData:rows}]});const prior=compactOwnership(candidate,{hash}),config={engineVersion:'test'},first=inputFingerprint({source,config,prior,hash});rows[110].values[10]={userEnteredValue:{formulaValue:'=DATE(2030;4;15)'}};assert.equal(inputFingerprint({source,config,prior,hash}),first);
});
test('a manually forced TRUE gate is rejected while the runtime closed gate is allowed',()=>{
 const c=structuredClone(candidate);c.financeManifest.sheets.push({title:'_Finans kontrol',sheetId:3});c.financeManifest.cells.push({sheetId:3,row:1,column:1,entered:{formulaValue:'=AND(TRUE)'}});const prior=compactOwnership(c,{hash}),source=snapshot();source.sheets.push({properties:{title:'_Finans kontrol',sheetId:3},data:[{rowData:[{}, {values:[{}, {userEnteredValue:{boolValue:false}}]}]}]});assert.doesNotThrow(()=>assertRefreshOwnership(source,prior,{hash}));source.sheets[2].data[0].rowData[1].values[1].userEnteredValue={boolValue:true};assert.throws(()=>assertRefreshOwnership(source,prior,{hash}),/gate ownership/);
});
test('fingerprint preserves exact bytes without walking generated bodies, reading only finance FX cells',()=>{
 const source=snapshot(),config={engineVersion:'test'},prior=compactOwnership(candidate,{hash});
 const finance=source.sheets[1];finance.data=[{startRow:35,startColumn:11,rowData:[{values:[scalar(41)]},{values:[scalar(42)]}]},{startRow:35,startColumn:11,rowData:[{values:[{effectiveValue:{numberValue:999}}]}]}];
 for(const[title,sheetId]of[['_Finans kontrol',3],['_Finans aylık',4],['Timeline',5],['_Finans web',6]])source.sheets.push({properties:{title,sheetId},data:[{rowData:[{values:[scalar(999)]}]}]});
 const expected=inputFingerprint({source,config,prior,hash});
 for(const sheet of source.sheets.filter(s=>['_Finans kontrol','_Finans aylık','Timeline','_Finans web'].includes(s.properties.title)))Object.defineProperty(sheet,'data',{get(){throw Error('Generated output body must not be walked');}});
 finance.data.unshift({startRow:0,startColumn:0,rowData:[{get values(){throw Error('Unrelated finance output row must not be walked');}}]});
 assert.equal(inputFingerprint({source,config,prior,hash}),expected);
 finance.data[1].rowData[0].values[0]=scalar(43);assert.notEqual(inputFingerprint({source,config,prior,hash}),expected);
});
