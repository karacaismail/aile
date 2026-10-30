import test from 'node:test';
import assert from 'node:assert/strict';
import { purchaseDates } from './purchase-dates.mjs';
const original = { K: '=IF(A111="";"";TODAY())', Q: '=K111' };
const item = { key:'item-a',ariziRow:5,priorityRow:111,ariziFormula:"=INDEX('Öncelik planı'!$K$111:$K$206;MATCH($P5;'Öncelik planı'!$A$111:$A$206;0))",priorityDateFormula:original.K,priorityCapacityFormula:original.Q,currentEntered:{formulaValue:'=E5'} };
const args = {items:[item],sheetIds:{priority:1,arizi:2,raw:3},ownerFormulas:{'item-a':original}};
test('pending item can become scheduled using its full ownership catalogue',()=>{
 const out=purchaseDates({...args,schedule:[{key:'item-a',date:'2030-04-15'}],priorCatalogue:[{...item,managed:false,owner:original}]});
 assert.equal(out.updates.length,2);assert.equal(out.catalogue[0].managed,true);
});
test('scheduled item becoming pending clears both dates instead of retaining prior month',()=>{
 const old='=IF(\'_Finans kontrol\'!$B$2;DATE(2030;4;15);"")';
 const out=purchaseDates({...args,items:[{...item,priorityDateFormula:old,priorityCapacityFormula:old}],ownerFormulas:{'item-a':{K:old,Q:old}},schedule:[],priorCatalogue:[{...item,managed:true,owner:{K:old,Q:old}}]});
 assert.equal(out.updates.length,2);assert.ok(out.updates.every(u=>u.value===''&&!u.formula.includes('DATE(')));
});
test('manual date remains user owned and is never overwritten',()=>{
 const out=purchaseDates({...args,items:[{...item,ariziFormula:undefined,manualDate:47500}],schedule:[{key:'item-a',date:'2030-04-15'}],priorCatalogue:[{...item,managed:false,owner:original}]});
 assert.equal(out.updates.length,0);assert.equal(out.catalogue[0].manual,true);
});
test('duplicate schedule identity and invalid calendar dates reject before writes',()=>{
 assert.throws(()=>purchaseDates({...args,schedule:[{key:'item-a',date:'2030-02-30'}]}),/date/i);
 assert.throws(()=>purchaseDates({...args,schedule:[{key:'item-a',date:'2030-04-15'},{key:'item-a',date:'2030-05-15'}]}),/Duplicate/);
});
