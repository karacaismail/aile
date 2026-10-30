import {grid,value,column} from '../finance-engine/cells.mjs';
import {checkDependencies} from './native-finance.mjs';
import {bankLimitStatus} from './bridge.mjs';
import {varianceExpectations} from './pano-variance.mjs';
import {decodeWire,digestPayload,readFinancePayload} from './finance-wire.mjs';
import {assertRefreshOwnership,compactOwnership} from './ownership.mjs';
const scalar=v=>v==null?{}:typeof v==='number'?{numberValue:v}:typeof v==='boolean'?{boolValue:v}:{stringValue:String(v)};
const blank=v=>Object.keys(v??{}).length===0||v?.stringValue==='';
const equal=(a,b)=>{const ak=Object.keys(a??{}),bk=Object.keys(b??{});return ak.length===bk.length&&ak.every(k=>typeof a[k]==='number'&&typeof b[k]==='number'?Number.isFinite(a[k])&&Number.isFinite(b[k])&&Math.abs(a[k]-b[k])<=.000001:a[k]===b[k]);};
export function consumerExpectations(candidate,source){const expected=[],plan=candidate.bridge.values.plan,current=candidate.bridge.values.current;const add=(title,row,m,v)=>expected.push({title,row:row-1,column:m+2,value:v});
 const simple={8:'openingCash',9:'income',10:'financeInflow',11:'otherCashOut',12:'cardPayments',13:'loanPayments',14:'kmhCashOut',15:'grossCashOut',16:'savings',17:'savingsTransfer',18:'netCashMovement',19:'closingCash',20:'closingCardDebt'};
 const p=grid(source,'Plan'),flow=grid(source,'_Taşınma akışı');for(let m=0;m<Math.min(14,plan.length);m++){for(const[r,f]of Object.entries(simple)){add('Kasa',Number(r),m,plan[m][f]);add('Kasa',Number(r)+16,m,current[m][f]);}for(const[bank,start]of[['Denizbank',438],['İşbank',446]]){for(const[offset,f]of[[0,'purchases'],[1,'payments'],[2,'closingDebt'],[3,'remainingLimit'],[4,'peakDebt'],[6,'minimumRequired']])add('Kasa',start+offset,m,plan[m].banks[bank][f]);add('Kasa',start+5,m,bankLimitStatus(plan[m].banks[bank]));}
 for(const[title,branch,rows]of[['Plan',plan[m],{52:'financeInflow',54:'grossCashOut',63:'netCashMovement',65:'closingCash',70:'closingCash',71:'closingCardDebt',72:'netCashAndDebt'}],['Gerçekleşen',current[m],{52:'financeInflow',54:'grossCashOut',62:'netCashMovement',64:'closingCash'}]]){for(const[r,f]of Object.entries(rows))add(title,Number(r),m,branch[f]);add(title,53,m,Math.round((branch.grossCashOut-branch.financeInflow)*100)/100);add(title,title==='Plan'?57:56,m,Math.round((branch.income-branch.grossCashOut)*100)/100);}
 const sumRow=r=>Array.from({length:m+1},(_,i)=>value(p[r-1]?.[i+2])).reduce((a,b)=>a+b,0),gold=Array.from({length:m+1},(_,i)=>value(flow[47]?.[i+2])).reduce((a,b)=>a+b,0),fx=candidate.financeManifest.planningFx;add('Plan',77,m,plan[m].closingCash+plan[m].closingReserve+sumRow(59)*fx.usdTry+sumRow(58)*fx.eurTry+gold*value(flow[46]?.[m+2])+sumRow(61));
 for(const[c,v]of[[3,plan[m].income],[4,current[m].income],[5,plan[m].grossCashOut],[6,current[m].grossCashOut],[7,plan[m].savings],[8,current[m].savings],[9,plan[m].netCashMovement],[10,current[m].netCashMovement],[11,plan[m].closingCash],[12,current[m].closingCash]])expected.push({title:'Pano',row:49+m,column:c,value:v});}
 if(candidate.variance)expected.push(...varianceExpectations(plan,current));return expected;}

/** Call only with native readback, after the source guard has been restored. */
export function verifyReadback(candidate,source,{hash}={}) {
 const failures=checkDependencies(candidate.financeManifest,source,{includeInputs:true}),grids=new Map(source.sheets.map(s=>[s.properties.title,grid(source,s.properties.title)]));let checks=failures.length;
 const check=(condition,kind,detail)=>{checks++;if(!condition)failures.push({kind,detail});};
 try{assertRefreshOwnership(source,compactOwnership(candidate,{hash}),{hash});}catch(e){failures.push({kind:'ownership',detail:e.message});}
 check(value(grids.get('_Finans kontrol')?.[1]?.[1])===true,'source-guard');
 for(const sheet of source.sheets)for(const row of grids.get(sheet.properties.title))for(const cell of row??[])check(!cell?.effectiveValue?.errorValue,'native-formula-error',sheet.properties.title);
 const expected=[...candidate.financeManifest.outputs.map(o=>({...o,title:'Finansman'})),...candidate.bridge.outputs.map(o=>({...o,title:'_Finans aylık'})),...consumerExpectations(candidate,source)];
 for(const output of expected){const actual=grids.get(output.title)?.[output.row]?.[output.column]?.effectiveValue??{};check(output.value===''?blank(actual):equal(actual,scalar(output.value)),'output-value',`${output.title}/${output.row+1}/${column(output.column)}`);}
 for(const update of candidate.dates.updates){const item=candidate.dates.catalogue.find(i=>i.key===update.key);const actual=grids.get('Öncelik planı')?.[update.row]?.[update.column]?.effectiveValue??{};check(update.value===''?blank(actual):equal(actual,scalar(update.value)),'purchase-date',update.key);if(item?.ariziRow){const planned=grids.get('Arızi Giderler')?.[item.ariziRow-1]?.[4]?.effectiveValue??{};check(update.value===''?blank(planned):equal(planned,scalar(update.value)),'purchase-visible-date',update.key);}}
 const timeline=grids.get('Timeline'),finance=grids.get('Finansman');for(let r=0;r<=candidate.financeManifest.eventCount;r++)for(let c=0;c<18;c++){const a=timeline?.[r+5]?.[c]?.effectiveValue??{},b=finance?.[r+42]?.[c]?.effectiveValue??{};check(blank(a)&&blank(b)||equal(a,b),'timeline-parity',`${r+6}/${c+1}`);}
 try{const rows=grids.get('_Finans web').slice(0,candidate.wire.rowCount).map(row=>Array.from({length:20},(_,c)=>row?.[c]?.effectiveValue?.stringValue));const payload=decodeWire(rows);check(digestPayload(payload,hash)===candidate.wire.digest,'wire-digest');check(JSON.stringify(payload)===JSON.stringify(readFinancePayload(source,candidate.wire)),'wire-source-parity');}catch(e){failures.push({kind:'wire-readback',detail:e.message});}
 return{checks,failures};
}
