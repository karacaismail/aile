import test from 'node:test';
import assert from 'node:assert/strict';
import { computeFinance } from './compute.mjs';
import { projectPlan } from './integrated-projection.mjs';
import { moveDateOverrides } from './move-date.mjs';

const cell = value => ({effectiveValue: {[typeof value === 'number' ? 'numberValue' : typeof value === 'boolean' ? 'boolValue' : 'stringValue']: value}});
function fixture() {
  const plan = Array.from({length: 80}, () => Array.from({length: 16}, () => cell(0)));
  plan[13][1]=cell('KK Bank A');plan[14][1]=cell('KK Bank B');
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
  const dated=computeFinance(input);
  assert.deepEqual(dated.currentInput.issues,[{key:'pending-price',amount:51000,planAmount:50000,kind:'pending-current-date-override',sourceDate:'2030-02-12'}]);
  assert.equal(dated.currentLedger.ledger.some(e=>e.id.includes('pending-price')),false);
});

test('reports a Current edit without any source mapping separately from budget-pending items',()=>{
  const input=fixture(), row=Array.from({length:16},()=>cell(''));
  row[1]=cell('Orphan item');row[3]=cell('Plan');row[6]=cell(100);row[7]=cell(150);row[15]=cell('orphan');
  const irregular=input.source.sheets.find(s=>s.properties.title==='Arızi Giderler').data[0].rowData;
  while(irregular.length<4)irregular.push({values:[]}); irregular.push({values:row});
  const result=computeFinance(input);
  assert.deepEqual(result.currentInput.issues,[{key:'orphan',amount:150,planAmount:100,kind:'unmapped-current-override',sourceDate:null}]);
  assert.equal(result.currentLedger.ledger.some(e=>e.id.includes('orphan')),false);
});

test('publishes an unaffordable Sheet plan with an explicit funding gap instead of stopping',async()=>{
  const {monthlyOutput}=await import('./monthly-output.mjs');
  const input=fixture();
  input.source.sheets.find(s=>s.properties.title==='_Timeline kaynak').data[0].rowData.push({values:['KASA-GAP-0','2030-02-20',60000,'Alışveriş','Large cash purchase','Arızi',-5000,0,0,'Confirmed','',true].map(cell)});
  const result=computeFinance(input), feb=result.currentMonthly.find(m=>m.month==='2030-02'), mar=result.currentMonthly.find(m=>m.month==='2030-03');
  assert.equal(feb.unfundedCash,3000);
  assert.equal(feb.closingCash,0);
  assert.equal(feb.unfundedPrincipalChange,3000);
  assert.equal(feb.cashIdentityDifference,0);
  assert.equal(mar.unfundedCash,2000);
  assert.equal(mar.unfundedPrincipalChange,-1000);
  assert.equal(mar.cashIdentityDifference,0);
  assert.equal(result.result.candidate.monthEnds.find(m=>m.month==='2030-02').unfundedCash,3000);
  assert.equal(monthlyOutput(result.ledger).find(m=>m.month==='2030-02').unfundedCash,3000);
});

test('publishes a funding gap that includes unpaid KMH interest at month end',async()=>{
  const {monthlyOutput}=await import('./monthly-output.mjs');
  const p={...fixture().config.modelPolicy,endDate:'2030-02-28',overdraftLimit:1000,overdraftMonthlyRate:0.05,cashEvents:[{id:'large-expense',date:'2030-01-02',amount:-5000},{id:'small-refund',date:'2030-01-20',amount:1,sourceType:'Gelir'}],purchases:[]};
  const jan=monthlyOutput(projectPlan(p)).find(m=>m.month==='2030-01');
  assert.ok(jan.unfundedCash>jan.unfundedPrincipalChange,'month-end gap must include unpaid KMH cost');
  assert.equal(jan.unfundedPrincipalChange,4000);
  assert.equal(jan.cashIdentityDifference,0);
});

test('still rejects a monthly cash identity broken by something other than a funding gap',async()=>{
  const {monthlyOutput}=await import('./monthly-output.mjs');
  const projection=projectPlan({...fixture().config.modelPolicy,endDate:'2030-01-31',openingCash:100,cashEvents:[{id:'expense',date:'2030-01-05',amount:-50}],purchases:[]});
  const broken=structuredClone(projection),row=broken.ledger.findLast(r=>r.date.startsWith('2030-01'));
  row.cash=row.cash+10;row.cashRequiredBalance=row.cashRequiredBalance+10;
  assert.throws(()=>monthlyOutput(broken),/Monthly cash identity failed 2030-01/);
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

function paymentFixture() {
  const input=fixture();
  input.config.modelPolicy.endDate='2030-01-31';
  input.config.modelPolicy.paymentMode='minimum';
  input.config.modelPolicy.openingCards=[{bank:'Bank A',principal:800,statementDate:'2030-01-17',dueDate:'2030-01-27',scheduledPayment:400}];
  input.config.preflight.openingRepayments=[{row:14,amounts:[400,...Array(13).fill(0)]}];
  for(const title of ['Plan','Gerçekleşen']){
    const rows=input.source.sheets.find(s=>s.properties.title===title).data[0].rowData;
    rows[13].values[1]=cell('KK Bank A');rows[13].values[2]=cell(500);
  }
  return input;
}

test('recalculates edited Sheet card targets without changing opening debt or source cells',()=>{
  const input=paymentFixture(), before=JSON.stringify(input);
  const result=computeFinance(input);
  assert.equal(result.ledger.payments[0].amount,500);
  assert.equal(result.currentLedger.payments[0].amount,500);
  assert.equal(result.ledger.openingKnownNetAssets,-800);
  assert.equal(JSON.stringify(input),before);
  const current=input.source.sheets.find(s=>s.properties.title==='Gerçekleşen').data[0].rowData;
  current[13].values[2]=cell(600);
  const changed=computeFinance(input);
  assert.equal(changed.ledger.payments[0].amount,500);
  assert.equal(changed.currentLedger.payments[0].amount,600);
  assert.equal(changed.currentMonthly[0].closingCash,400);
  assert.equal(changed.currentMonthly[0].cashIdentityDifference,0);
});

test('reports the unapplied part of a target above modeled debt instead of inventing debt or expense',()=>{
  const input=paymentFixture();
  for(const title of ['Plan','Gerçekleşen'])input.source.sheets.find(s=>s.properties.title===title).data[0].rowData[13].values[2]=cell(900);
  const result=computeFinance(input),payment=result.ledger.payments[0];
  assert.equal(payment.amount,800);
  assert.equal(payment.required,800);
  assert.equal(payment.requestedPrincipal,900);
  assert.equal(payment.unappliedPrincipal,100);
  assert.match(payment.sourceNote,/100/);
  assert.equal(result.currentMonthly[0].closingCash,200);
});

test('validates edited targets and mapping rather than comparing with installation amounts',()=>{
  for(const amount of [-1,'500',NaN,Infinity]){
    const input=paymentFixture();input.source.sheets.find(s=>s.properties.title==='Plan').data[0].rowData[13].values[2]=cell(amount);
    assert.throws(()=>computeFinance(input),/card payment.*amount/i);
  }
  const input=paymentFixture();input.source.sheets.find(s=>s.properties.title==='Plan').data[0].rowData[13].values[1]=cell('KK Other Bank');
  assert.throws(()=>computeFinance(input),/card payment.*bank/i);
});


test('reads both payment rows even when installation only listed one',()=>{
 const input=paymentFixture();
 for(const title of ['Plan','Gerçekleşen'])input.source.sheets.find(s=>s.properties.title===title).data[0].rowData[14].values[2]=cell(100);
 const result=computeFinance(input);
 assert.equal(result.modelInput.cardPaymentTargets.find(t=>t.bank==='Bank B'&&t.month==='2030-01').amount,100);
 assert.equal(result.ledger.unappliedPaymentTargets[0].amount,100);
 assert.match(result.ledger.ledger[0].sourceNote,/Bank B.*2030-01.*100/);
});

test('zero and reduced targets retain statutory minimum without rewriting the Sheet',()=>{
 for(const amount of [0,100,350]){
  const input=paymentFixture();
  for(const title of ['Plan','Gerçekleşen'])input.source.sheets.find(s=>s.properties.title===title).data[0].rowData[13].values[2]=cell(amount);
  assert.equal(computeFinance(input).ledger.payments[0].amount,Math.max(320,amount));
 }
});

test('matches targets by due month across a year boundary and reserves both banks before salary',()=>{
 const p={...fixture().config.modelPolicy,startDate:'2030-12-01',endDate:'2031-01-31',openingCash:2000,openingCards:[
  {bank:'Bank A',principal:500,statementDate:'2030-11-17',dueDate:'2030-12-07',scheduledPayment:500},
  {bank:'Bank B',principal:500,statementDate:'2030-11-28',dueDate:'2030-12-07',scheduledPayment:500}],
  cardPaymentTargets:[{bank:'Bank A',month:'2030-12',amount:300},{bank:'Bank B',month:'2030-12',amount:250},{bank:'Bank A',month:'2031-01',amount:100}],paymentMode:'minimum'};
 const result=projectPlan(p),first=result.payments.filter(x=>x.date==='2030-12-07');
 assert.deepEqual(first.map(x=>x.amount),[300,250]);
 assert.equal(first[0].reserve,250);
 assert.equal(first[1].reserve,0);
 assert.equal(result.payments.find(x=>x.bank==='Bank A'&&x.date.startsWith('2031-01')).requestedPrincipal,100);
});

test('opening requirement uses bounded computed payments instead of stale installation targets',async()=>{
 const {openingCashRequirement}=await import('./opening-requirement.mjs');
 const result=openingCashRequirement({cashEvents:[],openingCards:[{dueDate:'2030-01-07',scheduledPayment:900,bank:'Bank A'}],payments:[{date:'2030-01-07',amount:800,bank:'Bank A'},{date:'2030-01-09',amount:100,bank:'Bank B'}],startDate:'2030-01-01',firstSalaryDate:'2030-01-09'});
 assert.equal(result.amount,800);
});

test('keeps bill principal and priced costs separate from the editable principal target',()=>{
 const p={...fixture().config.modelPolicy,endDate:'2030-01-31',openingCash:2000,openingCards:[{bank:'Bank A',principal:800,statementDate:'2030-01-17',dueDate:'2030-01-27',scheduledPayment:400}],
  cardPaymentTargets:[{bank:'Bank A',month:'2030-01',amount:500}],paymentMode:'minimum',
  purchases:[{id:'synthetic-bill',bank:'Bank A',date:'2030-01-05',amount:100,kind:'automatic_bill'}],
  tariffs:[{bank:'Bank A',transactionType:'automatic_bill',validFrom:'2030-01-01',validTo:'2031-01-01',monthlyRate:.03,flatFee:0,confidence:'confirmed',source:'synthetic'}]};
 const payment=projectPlan(p).payments[0];
 assert.equal(payment.purchasePrincipalPaid,500);
 assert.equal(payment.billPrincipalPaid,100);
 assert.ok(payment.billCostReserved>0);
 assert.equal(payment.amount,Math.round((600+payment.billCostReserved)*100)/100);
 assert.equal(payment.required,payment.amount);
 assert.equal(payment.unappliedPrincipal,0);
});

test('a move date in Parametreler replaces the installed move policy', () => {
  const source = {sheets: [{properties: {title: 'Parametreler'}, data: [{rowData: [{}, {}, {}, {}, {values: [{}, {}, cell(46558)]}]}]}]};
  assert.deepEqual(moveDateOverrides(source, {day: 15}), {protectUntil: '2027-06-20', firstDate: '2027-07-15'});
});

test('keeps the installed move policy while the Parametreler sheet does not exist', () => {
  assert.equal(moveDateOverrides({sheets: []}, {day: 15}), null);
});

test('stops instead of guessing when the move date in Parametreler is not a date', () => {
  const input = fixture();
  input.source.sheets.push({properties: {title: 'Parametreler'}, data: [{rowData: [{}, {}, {}, {}, {values: [{}, {}, cell('yaz')]}]}]});
  assert.throws(() => computeFinance(input), /Parametreler taşınma tarihi/);
});
