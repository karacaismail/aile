import test from 'node:test';
import assert from 'node:assert/strict';
import { computeFinance } from './compute.mjs';
import { projectPlan } from './integrated-projection.mjs';

const cell = value => ({effectiveValue: {[typeof value === 'number' ? 'numberValue' : typeof value === 'boolean' ? 'boolValue' : 'stringValue']: value}});
function fixture() {
  const plan = Array.from({length: 80}, () => Array.from({length: 16}, () => cell(0)));
  const actual = structuredClone(plan), kasa = Array.from({length: 430}, () => []);
  const events = [];
  for (let m = 0; m < 14; m++) {
    plan[4][m + 2] = cell(1000); actual[4][m + 2] = cell(1000);
    const date = new Date(Date.UTC(2030, m, 9)).toISOString().slice(0, 10);
    events.push(['month-' + m + '-income-5', date, 10000, 'Gelir', 'Synthetic income', 'Plan', 1000, 0, 0, 'Confirmed', '', true].map(cell));
  }
  const sheets = {Plan: plan, Gerçekleşen: actual, Kasa: kasa, '_Timeline kaynak': events, '_Taşınma akışı': [], 'Arızi Giderler': [], '_Kasa hesap': [[...Array.from({length:126},()=>cell(0)),cell(1),cell(1)]]};
  const source = {sheets: Object.entries(sheets).map(([title, rows]) => ({properties:{title},data:[{rowData:rows.map(values=>({values}))}]}))};
  const config = {
    version: 'finance-compute-v1', planningFxDate:'2030-01-01', summaryBanks:{Denizbank:'Bank A',Isbank:'Bank B'},
    preflight:{cardRows:[],openingRepayments:[]}, facts:{openingCash:0,overdraft:{limit:0,openingUsedPrincipal:0},existingReserve:{status:'user-confirmed',amount:0,maximumTotalTransfer:0,availableFrom:'2030-01-01',transferWindowEnd:'2031-02-28'},cashAdvanceAvailable:{'Bank A':0,'Bank B':0}},
    modelPolicy:{startDate:'2030-01-01',endDate:'2031-02-28',cardSettings:{'Bank A':{limit:10000,cutoffDay:17,lagDays:10},'Bank B':{limit:10000,cutoffDay:28,lagDays:10}},tariffs:[],taxes:{kkdf:0,bsmv:0},openingCash:0,openingOverdraftPrincipal:0,overdraftLimit:0,overdraftMonthlyRate:0,overdraftBank:'Bank A',salaryDay:9,minimumPaymentRate:0.4,protectUntil:'2030-01-01',paymentMode:'capacity',openingCards:[],openingReserve:0,reserveTransferLimit:0,reserveTransferStart:'2030-01-01',reserveTransferEnd:'2031-02-28',reserveTransfers:[]},
    scheduling:{firstDate:'2030-03-15',lastDate:'2031-02-15',day:15,firstSalaryDate:'2030-01-09'},stagedReserveTransfers:[],assumptions:[],sourceProvenance:{},confirmedOpeningDueDate:null,
  };
  return {source,config,hash:()=> 'synthetic-hash',now:'2030-01-01T00:00:00.000Z'};
}

test('recomputes changed native income while preserving the input snapshot', () => {
  const input=fixture(), before=JSON.stringify(input.source), first=computeFinance(input);
  assert.equal(JSON.stringify(input.source),before);
  assert.equal(first.ledger.monthEnds[0].cash,1000);
  assert.equal(first.result.sourceStats.validated,true);
  input.source.sheets.find(s=>s.properties.title==='Plan').data[0].rowData[4].values[2]=cell(1200);
  input.source.sheets.find(s=>s.properties.title==='Gerçekleşen').data[0].rowData[4].values[2]=cell(1200);
  input.source.sheets.find(s=>s.properties.title==='_Timeline kaynak').data[0].rowData[0].values[6]=cell(1200);
  const next=computeFinance(input);
  assert.equal(next.ledger.monthEnds[0].cash,1200);
  assert.equal(next.currentMonthly[0].closingCash,1200);
});

test('rejects a changed Plan amount when source formulas have not recalculated', () => {
  const input=fixture(); input.source.sheets.find(s=>s.properties.title==='Plan').data[0].rowData[4].values[2]=cell(1200);
  assert.throws(()=>computeFinance(input),/amount missing from source events/);
});

test('supplied salary day controls capacity reservation without inventing an eighth-day income', () => {
  const input=fixture(); const p={...input.config.modelPolicy,endDate:'2030-01-31',openingCash:1000,openingCards:[{bank:'Bank A',principal:500,statementDate:'2029-12-17',dueDate:'2030-01-07',scheduledPayment:0}],cashEvents:[{id:'expense',date:'2030-01-08',amount:-900}],tariffs:[]};
  const result=projectPlan(p); assert.equal(result.payments[0].amount,200); assert.equal(result.payments[0].reserve,900);
});

function flexible(input,{key='synthetic-item',priority=1,amount=100,manualDate}) {
  const sheets=input.source.sheets, row=Array.from({length:16},()=>cell(''));
  row[0]=cell(priority); row[1]=cell(key); row[3]=cell('Plan');row[6]=cell(amount);row[7]=cell(amount);row[15]=cell(key);
  const date=manualDate??'2030-01-20', serial=(Date.parse(date+'T00:00:00Z')-Date.UTC(1899,11,30))/86400000;
  row[4]=manualDate?{...cell(serial),userEnteredValue:{numberValue:serial}}:{...cell(serial),userEnteredValue:{formulaValue:'=1'}};
  const irregular=sheets.find(s=>s.properties.title==='Arızi Giderler').data[0].rowData;
  while(irregular.length<4)irregular.push({values:[]}); irregular.push({values:row});
  const flow=sheets.find(s=>s.properties.title==='_Taşınma akışı').data[0].rowData;
  while(flow.length<100)flow.push({values:[]});flow.push({values:[key,key,'Esnek',serial,amount,'Nakit','',1].map(cell)});
  const events=sheets.find(s=>s.properties.title==='_Timeline kaynak').data[0].rowData;
  events.push({values:[key+'-0',date,50000,'Alışveriş',key,'Arızi',-amount,0,0,'Confirmed','',true].map(cell)});
}

test('changed flexible prices reschedule in strict priority order instead of leaving missing dates',()=>{
  const input=fixture();flexible(input,{key:'first',amount:50000});flexible(input,{key:'second',priority:2,amount:1});
  const blocked=computeFinance(input);assert.equal(blocked.result.prioritySchedule.length,0);assert.equal(blocked.result.pendingPriority.length,2);
  const rows=input.source.sheets.find(s=>s.properties.title==='_Taşınma akışı').data[0].rowData;rows[100].values[4]=cell(100);
  const row=input.source.sheets.find(s=>s.properties.title==='Arızi Giderler').data[0].rowData[4];row.values[6]=cell(100);row.values[7]=cell(100);
  const planned=computeFinance(input);assert.deepEqual(planned.result.prioritySchedule.map(p=>p.key),['first','second']);assert.equal(planned.result.prioritySchedule[0].date,'2030-03-15');
});

test('keeps a manually entered purchase date fixed and rejects its absent source event',()=>{
  const input=fixture();flexible(input,{manualDate:'2030-02-12'});
  const result=computeFinance(input);assert.equal(result.result.prioritySchedule.length,0);
  assert.equal(result.ledger.ledger.find(e=>e.id==='synthetic-item-0').date,'2030-02-12');
  const rows=input.source.sheets.find(s=>s.properties.title==='_Timeline kaynak').data[0].rowData;rows.pop();
  assert.throws(()=>computeFinance(input),/fixed purchase.*source event/i);
});

test('executes bundled computation without Node or structuredClone globals',async()=>{
  const {build}=await import('esbuild'),vm=await import('node:vm');
  const bundle=await build({entryPoints:[new URL('./compute.mjs',import.meta.url).pathname],bundle:true,format:'iife',globalName:'FinanceCompute',platform:'neutral',target:'es2020',write:false});
  const context=vm.createContext({});vm.runInContext(bundle.outputFiles[0].text,context);
  assert.equal(vm.runInContext('typeof structuredClone',context),'undefined');
  assert.equal(vm.runInContext('typeof process',context),'undefined');
  const result=context.FinanceCompute.computeFinance(fixture());
  assert.equal(result.ledger.monthEnds[0].cash,1000);
  assert.equal(result.currentMonthly[0].cashIdentityDifference,0);
});

test('keeps an unaffordable Current price override pending without inventing a purchase date',()=>{
  const input=fixture();flexible(input,{key:'pending-price',amount:50000});
  const row=input.source.sheets.find(s=>s.properties.title==='Arızi Giderler').data[0].rowData[4];row.values[7]=cell(51000);
  const result=computeFinance(input);
  assert.equal(result.result.prioritySchedule.length,0);
  assert.equal(result.result.pendingPriority[0].items[0].key,'pending-price');
  assert.deepEqual(result.currentInput.issues,[{key:'pending-price',amount:51000,planAmount:50000,kind:'pending-current-price-override',sourceDate:null}]);
  assert.equal(result.currentLedger.ledger.some(e=>e.id.includes('pending-price')),false);
  assert.equal(result.currentMonthly[0].closingCash,1000);
  const serial=(Date.parse('2030-02-12T00:00:00Z')-Date.UTC(1899,11,30))/86400000;
  row.values[5]={...cell(serial),userEnteredValue:{numberValue:serial}};
  assert.throws(()=>computeFinance(input),/Current item has no model event/);
});

test('uses the verified source hash without serializing the workbook or hashing it again',()=>{
  const input=fixture(),sourceHash='a'.repeat(64);input.hash=()=>sourceHash;
  const expected=computeFinance(input);
  Object.defineProperty(input.source,'toJSON',{value(){throw new Error('Workbook serialization must be skipped');}});
  delete input.hash;
  const result=computeFinance({...input,sourceHash});
  assert.deepEqual(result,expected);
});

test('rejects invalid supplied source hashes instead of silently generating new provenance',()=>{
  for(const sourceHash of [null,'',42,'not-a-digest'])assert.throws(()=>computeFinance({...fixture(),sourceHash}),/supplied source hash/i);
});
