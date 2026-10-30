const round=n=>Math.round((n+Number.EPSILON)*100)/100;
const number=n=>{if(typeof n!=='number'||!Number.isFinite(n))throw new TypeError('Finite ledger amount required');return n;};
const names=['income','creditInflow','reserveTransfer','withdrawal','otherCashOut','loanPayments','savings','cardPayments','kmhDrawn','kmhPrincipalRepaid','kmhCostPaid'];
/** A projection consumer, not a second interest engine. Transfers are not income. */
export function monthlyOutput(projection){
 const rows=projection.ledger;if(!rows?.length||rows[0].type!=='opening')throw new Error('Opening ledger snapshot required');
 const result=[],byMonth=new Map();let prev=rows[0];
 for(const r of rows){const key=r.date.slice(0,7);let m=byMonth.get(key);if(!m){m={month:key,openingCash:number(prev.cash),openingKmh:number(prev.overdraftPrincipal),...Object.fromEntries(names.map(k=>[k,0])),banks:Object.fromEntries(Object.entries(prev.cards).map(([bank,c])=>[bank,{openingDebt:number(c.totalDebt),purchases:0,payments:0,peakDebt:number(c.totalDebt),minimumRequired:0}]))};byMonth.set(key,m);result.push(m);}
  const add=(key,n)=>{m[key]=round(m[key]+number(n));};
  if(r.type==='reserve-transfer')add('reserveTransfer',r.amount);
  if(r.type==='cash'){
   if(r.amount>0){if(/^month-\d+-new-loan$/.test(r.id))add('creditInflow',r.amount);else if(/^month-\d+-withdraw$/.test(r.id))add('withdrawal',r.amount);else if(r.sourceType==='Gelir')add('income',r.amount);else throw new Error('Unclassified positive cash event '+r.id);}
   else if(r.amount<0){if(/-saving$/.test(r.id))add('savings',-r.amount);else if(/-regular-(12|13)$/.test(r.id))add('loanPayments',-r.amount);else add('otherCashOut',-r.amount);}
  }
  if(r.type==='purchase')m.banks[r.bank].purchases=round(m.banks[r.bank].purchases+number(r.amount));
  if(r.type==='card-payment'){add('cardPayments',r.amount);const b=m.banks[r.bank];b.payments=round(b.payments+number(r.amount));b.minimumRequired=round(b.minimumRequired+number(r.required));}
  if(r.type!=='opening'){const change=round(number(r.overdraftPrincipal)-number(prev.overdraftPrincipal));if(change>0)add('kmhDrawn',change);else if(change<0)add('kmhPrincipalRepaid',-change);}
  if(r.kmhCostPaid!==undefined)add('kmhCostPaid',r.kmhCostPaid);
  for(const [bank,c]of Object.entries(r.cards))m.banks[bank].peakDebt=Math.max(m.banks[bank].peakDebt,number(c.totalDebt));
  m.closingCash=number(r.cash);m.closingKmh=number(r.overdraftPrincipal);m.kmhAccruedCost=number(r.overdraftAccruedCost);m.closingCardDebt=number(r.cardDebt);m.closingReserve=number(r.reserveBalance);m.netCashAndDebt=number(r.knownNetAssets);m.unfundedCash=number(r.unfundedCash);m.futureInstallments=round(Object.values(r.cards).reduce((n,c)=>n+number(c.futureInstallmentPrincipal),0));
  for(const [bank,c]of Object.entries(r.cards)){const b=m.banks[bank];b.closingDebt=number(c.totalDebt);b.remainingLimit=number(c.availableLimit);b.fees=round(b.closingDebt-b.openingDebt-b.purchases+b.payments);}
  prev=r;
 }
 for(const m of result){m.financeInflow=round(m.creditInflow+m.kmhDrawn);m.savingsTransfer=round(m.reserveTransfer+m.withdrawal);m.kmhCashOut=round(m.kmhPrincipalRepaid+m.kmhCostPaid);m.grossCashOut=round(m.otherCashOut+m.loanPayments+m.cardPayments+m.kmhCashOut);m.netCashMovement=round(m.income+m.financeInflow+m.savingsTransfer-m.grossCashOut-m.savings);m.cashIdentityDifference=round(m.openingCash+m.netCashMovement-m.closingCash);if(Math.abs(m.cashIdentityDifference)>1e-6)throw new Error('Monthly cash identity failed '+m.month+'; unfunded capacity cannot be reported as cash');}
 return result;
}
