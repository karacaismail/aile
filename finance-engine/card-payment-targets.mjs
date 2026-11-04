import {value} from './cells.mjs';

/** Sheet values are editable repayment targets, not opening debt balances.
 * Old installation amounts deliberately do not participate in validation. */
export function cardPaymentTargets({plan,banks,startDate,months=14}) {
  const targets=[],seen=new Set();
  for(const row of [14,15]){
    const bank=row===14?banks.Denizbank:row===15?banks.Isbank:null;
    if(!bank||seen.has(bank)||value(plan[row-1]?.[1])!=='KK '+bank)throw new Error('Card payment bank mapping is missing or ambiguous');
    seen.add(bank);
    for(let m=0;m<months;m++){
      const amount=value(plan[row-1]?.[m+2]);
      if(typeof amount!=='number'||!Number.isFinite(amount)||amount<0)throw new Error('Card payment amount must be finite and nonnegative');
      const month=new Date(Date.UTC(Number(startDate.slice(0,4)),Number(startDate.slice(5,7))-1+m,1)).toISOString().slice(0,7);
      targets.push({bank,month,amount,sourceRow:row,sourceMonth:m});
    }
  }
  return targets;
}
