import {clone,value,dateFromSerial,iso} from './cells.mjs';
/** Adapt explicit Current inputs to the same financial engine, never mirror Plan output. */
export function currentInput({modelInput,regular,savings,irregular,pendingKeys=[]}){
 const pending=new Set(pendingKeys);
 const next=clone(modelInput),changes=[],issues=[];delete next.requiredPaymentSchedule;
 const all=[...next.cashEvents,...next.purchases,...next.extraCashEvents],byId=new Map(all.map(e=>[e.id,e]));
 if(byId.size!==all.length)throw new Error('duplicate source event ID');
 const finite=n=>{if(typeof n!=='number'||!Number.isFinite(n)||n<0)throw new Error('Current amount must be finite and nonnegative');};
 const change=(e,field,v,reason)=>{if(e[field]!==v){changes.push({id:e.id,field,before:e[field],after:v,reason});e[field]=v;}};
 for(const r of regular){finite(r.plan);finite(r.current);if(r.plan===r.current)continue;if(r.row===38)throw new Error('Changed weekly budget needs actual dated weekly payments');if([14,15].includes(r.row))throw new Error('Opening card payment change needs explicit statement mapping');
  const kind=r.row<=8?'income':r.row>=21&&r.row<=28?'bill':'regular';
  for(const month of[r.month,...(r.month===13?Array.from({length:12},(_,i)=>14+i):[])]){const id=`month-${month}-${kind}-${r.row}`,e=byId.get(id);if(!e)throw new Error('Current change has no dated source event: '+id);change(e,'amount',e.amount<0?-r.current:r.current,'Current source amount');}
 }
 for(const s of savings){finite(s.amount);for(const month of[s.month,...(s.month===13?Array.from({length:12},(_,i)=>14+i):[])]){const id=`month-${month}-saving`,e=byId.get(id);if(!e&&s.amount!==0)throw new Error('Current savings have no dated source event: '+id);if(e)change(e,'amount',-s.amount,'Current quantities at dated planning FX');}}
 for(const item of irregular){finite(item.currentPrice);const matches=all.filter(e=>e.id==='candidate-'+item.key||e.id.startsWith(item.key+'-'));
  if(!matches.length&&item.explicitCurrentDate)throw new Error('Changed Current item has no model event: '+item.key);
  if(item.status==='Alındı'&&item.currentPrice>0&&!matches.length){issues.push({key:item.key,amount:item.currentPrice,kind:'acquired-item-payment-unclassified',sourceDate:item.linkedFutureDate??null});continue;}
  if(!matches.length){
   if(pending.has(item.key)){
    if(item.currentPrice!==item.planPrice)issues.push({key:item.key,amount:item.currentPrice,planAmount:item.planPrice,kind:'pending-current-price-override',sourceDate:null});
    continue;
   }
   if(item.currentPrice!==item.planPrice)throw new Error('Changed Current item has no model event: '+item.key);continue;
  }
  if(matches.length!==1)throw new Error('Current item needs explicit split allocation: '+item.key);
  const e=matches[0];change(e,'amount',e.amount<0?-item.currentPrice:item.currentPrice,'Current irregular price');
  if(item.explicitCurrentDate){if(!/^\d{4}-\d{2}-\d{2}$/.test(item.explicitCurrentDate))throw new Error('Invalid Current date');change(e,'date',item.explicitCurrentDate,'User-entered Current purchase date');}
 }
 return{modelInput:next,changes,issues};
}

export function extractIrregularOverrides(rows){return rows.slice(4).filter(r=>value(r?.[15])).filter(r=>value(r[6])!==value(r[7])||(r[5]?.userEnteredValue?.numberValue!==undefined)).map(r=>({key:value(r[15]),status:value(r[3]),planPrice:value(r[6]),currentPrice:value(r[7]),...(r[5]?.userEnteredValue?.numberValue!==undefined?{explicitCurrentDate:iso(dateFromSerial(value(r[5])))}:{linkedFutureDate:typeof value(r[5])==='number'?iso(dateFromSerial(value(r[5]))):null})}));}
