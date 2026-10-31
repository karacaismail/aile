import test from 'node:test';
import assert from 'node:assert/strict';
import { purchaseGroupTypes } from './purchase-groups.mjs';
const cell = stringValue => ({effectiveValue:{stringValue}});
const row = (key,category) => { const r=[];r[2]=cell(category);r[15]=cell(key);return r; };

test('purchase groups follow stable Sheet identities and categories, not title, bank or date',()=>{
 const classify=purchaseGroupTypes([row('item-001','Taşınmadan önce'),row('item-002','Taşınma sonrası Eşya yenileme'),row('item-003','Özel gün')]);
 assert.equal(classify({id:'item-001-0',type:'purchase'}),'Alışveriş · Taşınma öncesi');
 assert.equal(classify({id:'candidate-item-001',type:'cash'}),'Alışveriş · Taşınma öncesi');
 assert.equal(classify({id:'item-002-0',type:'cash'}),'Alışveriş · Taşınma sonrası');
 assert.equal(classify({id:'candidate-item-003',type:'cash'}),'Alışveriş');
 for(const event of [{id:'month-0-bill-21',type:'purchase'},{id:'item-001-0',type:'card-payment'},{id:'unknown-0',type:'cash'}]) assert.equal(classify(event),undefined);
});
test('missing category stays ungrouped and duplicate source identities reject',()=>{
 assert.equal(purchaseGroupTypes([row('item','')])({id:'item-0',type:'cash'}),'Alışveriş');
 assert.throws(()=>purchaseGroupTypes([row('same','Taşınmadan önce'),row('same','Taşınma sonrası Eşya yenileme')]),/Duplicate/);
});

test('native publication changes only the type and guards category edits even outside the flexible flow', async()=>{
 const {buildFinance,checkDependencies}=await import('./native-finance.mjs');
 const source={spreadsheetId:'synthetic',sheets:['Plan','Kasa','Timeline','_Timeline kaynak','_Taşınma akışı','Arızi Giderler'].map((title,sheetId)=>({properties:{title,sheetId},data:[{rowData:[]}]}))};
 const sheet=source.sheets.at(-1);sheet.data[0].rowData[4]={values:row('fixed-item','Taşınmadan önce')};
 const cards={committedPrincipal:0,charges:0,futureInstallmentPrincipal:0};
 const event={id:'fixed-item-0',date:'2098-01-03',label:'Sentetik alım',type:'cash',cashRequiredBalance:0,cash:0,overdraftPrincipal:0,overdraftAccruedCost:0,cardDebt:0,unfundedCash:0,cards:{Denizbank:cards,'İşbank':cards}};
 const args={source,sourceHash:'synthetic-hash',engineHash:'test',facts:{openingCash:0,overdraft:{openingUsedPrincipal:0,limit:0}},result:{source:{sha256:'synthetic-hash'},sourceStats:{validated:true},candidate:{monthEnds:[]},openingRequirement:{amount:0},financeCosts:[]},ledger:{ledger:[event]}};
 const before=buildFinance(args).manifest;
 assert.equal(before.outputs.find(c=>c.row===43&&c.column===2).value,'Alışveriş · Taşınma öncesi');
 sheet.data[0].rowData[4].values[2]=cell('Taşınma sonrası Eşya yenileme');
 assert.ok(checkDependencies(before,source).some(f=>f.address==="'Arızi Giderler'!C5"));
 const after=buildFinance(args).manifest;
 assert.equal(after.outputs.find(c=>c.row===43&&c.column===2).value,'Alışveriş · Taşınma sonrası');
 assert.deepEqual(after.outputs.filter(c=>c.column!==2),before.outputs.filter(c=>c.column!==2));
});
