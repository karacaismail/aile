import {sourceEventCells} from './input-source.mjs';
import {grid,value,column} from './cells.mjs';
const round=n=>Math.round((n+Number.EPSILON)*100)/100;
const number=n=>{if(typeof n!=='number'||!Number.isFinite(n))throw new Error('Planning FX requires finite numeric input');return n;};
export function planningFxBasis(source,{asOfDate,sourceHash,planningRates}){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)||!sourceHash)throw new Error('Dated planning FX basis required');
 const helper=grid(source,'_Kasa hesap'),plan=grid(source,'Plan'),timeline=sourceEventCells(source),timelineSource=grid(source,'_Timeline kaynak');
 const liveEur=Number(number(value(helper[0]?.[126])).toFixed(5)),liveUsd=Number(number(value(helper[0]?.[127])).toFixed(5));const eurTry=planningRates?.eurTry??liveEur,usdTry=planningRates?.usdTry??liveUsd;if(eurTry<=0||usdTry<=0)throw new Error('Positive planning rates required');
 const savingEvents=timeline.map((r,row)=>({r,row})).filter(({r})=>/^month-\d+-saving$/.test(value(r?.[0])??'')).map(({r,row})=>{
  const id=value(r[0]),month=Number(id.match(/^month-(\d+)/)[1]),planColumn=Math.min(month,13)+2,c=column(planColumn);const eur=number(value(plan[57]?.[planColumn])),usd=number(value(plan[58]?.[planColumn])),goldTl=number(value(plan[59]?.[planColumn])),besTl=number(value(plan[60]?.[planColumn]));
  const sourceRow=timelineSource.findIndex(r=>value(r?.[0])===id);if(sourceRow<0)throw new Error('Saving source ID missing');const formula=timelineSource[sourceRow][6]?.userEnteredValue?.formulaValue;const match=formula?.match(/^=ROUND\(-(.+);2\)$/);if(!match)throw new Error('Unknown saving formula: '+id);
  const liveReference=match[1],amount=-round(eur*eurTry+usd*usdTry+goldTl+besTl);number(value(r[6]));if(Math.abs(-round(eur*liveEur+usd*liveUsd+goldTl+besTl)-value(r[6]))>.000001)throw new Error('Snapshot saving amount does not reconcile to planning rate basis: '+id);
  return{id,month,amount,eur,usd,goldTl,besTl,planColumn,planRange:`Plan!${c}58:${c}61`,timelineRow:source.sheets.some(s=>s.properties.title==='_Finans ham')?row:grid(source,'Timeline').findIndex(t=>value(t?.[0])===id),sourceRow,liveReference};
 });
 return{asOfDate,sourceSnapshotSha256:sourceHash,eurTry,usdTry,rateStatus:'dated-planning-snapshot; not future execution rate',rateSources:["'_Kasa hesap'!DW1","'_Kasa hesap'!DX1"],savingEvents};
}
export function applyPlanningFx(events,basis){const byId=new Map(basis.savingEvents.map(e=>[e.id,e]));return events.map(e=>{const b=byId.get(e.id);return b?{...e,amount:b.amount,planningFxBasisDate:basis.asOfDate,sourceNote:`${e.sourceNote??''} Finansman TL hesabı ${basis.asOfDate} plan kurlarıyla: EUR ${basis.eurTry}, USD ${basis.usdTry}. Gelecek alım kuru değildir.`}:e;});}
