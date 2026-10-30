/** Deterministic plan mathematics. Pure functions; no IO, current clock or bank defaults.
 * Rates are decimal MONTHLY rates. Dates are ISO calendar dates. Money is TL to cents.
 * Outputs are not customer-statement reconciliation, even when every input is confirmed.
 */
const DAY=86400000;
const fail=message=>{throw new TypeError(message);};
function date(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))fail('Invalid ISO date');const n=Date.parse(`${value}T00:00:00.000Z`);if(!Number.isFinite(n)||new Date(n).toISOString().slice(0,10)!==value)fail('Invalid calendar date');return n/DAY;}
const iso=day=>new Date(day*DAY).toISOString().slice(0,10);
const addDays=(d,n)=>iso(date(d)+n);
function number(n,label){if(typeof n!=='number'||!Number.isFinite(n)||n<0)fail(`${label} must be a finite nonnegative number`);return n;}
function cents(n,label='amount'){number(n,label);const c=Math.round(n*100);if(!Number.isSafeInteger(c)||Math.abs(n*100-c)>1e-5)fail(`${label} must have at most two decimal places`);return c;}
const money=c=>c/100;
const round=n=>Math.round((n+Number.EPSILON)*100)/100;
function integer(n,label,min,max){if(!Number.isInteger(n)||n<min||n>max)fail(`Invalid ${label}`);return n;}
function monthDate(d,offset,day){const t=new Date(date(d)*DAY),year=t.getUTCFullYear(),month=t.getUTCMonth()+offset,last=new Date(Date.UTC(year,month+1,0)).getUTCDate();return new Date(Date.UTC(year,month,Math.min(day,last))).toISOString().slice(0,10);}
const flag=(code,details={})=>({code,...details});
const uniqueFlags=items=>[...new Map(items.map(x=>[JSON.stringify(x),x])).values()];
function taxesFor(interest,taxes){if(!taxes||taxes.kkdf==null||taxes.bsmv==null)return{kkdf:null,bsmv:null,flags:[flag('tax_rates_unknown')]};number(taxes.kkdf,'KKDF');number(taxes.bsmv,'BSMV');return{kkdf:interest==null?null:round(interest*taxes.kkdf),bsmv:interest==null?null:round(interest*taxes.bsmv),flags:[]};}
function status(flags,unpriced=false){return unpriced?'unpriced':flags.length?'conditional':'calculated';}
function repaymentList(items,start,end,principal){let total=0;const payments=(items??[]).map((p,index)=>{date(p.date);if(p.date<start||p.date>end)fail('Repayment outside calculation dates');const amount=cents(p.principal,'repayment principal');total+=amount;if(p.minimumCredit!=null)cents(p.minimumCredit,'minimum credit');return{...p,principal:money(amount),index};}).sort((a,b)=>a.date.localeCompare(b.date)||a.index-b.index);if(total>cents(principal))fail('Repayment exceeds principal');return payments;}

/** validTo is exclusive. No carry-forward across gaps. Overlapping bands fail closed.
 * Bounds apply to original transactionAmount (automatic_bill) or fixed statementPrincipal.
 */
export function selectRate({date:at,bank,transactionType,statementPrincipal,transactionAmount,tariffs}){
 date(at);if(!Array.isArray(tariffs))fail('tariffs must be an array');const basis=transactionType==='automatic_bill'?transactionAmount:statementPrincipal;number(basis,'rate-band basis');
 const matches=tariffs.filter(t=>{
  if(t.bank!==bank||t.transactionType!==transactionType)return false;
  date(t.validFrom);date(t.validTo);if(t.validFrom>=t.validTo)fail('Invalid tariff interval');
  for(const k of['minInclusive','minExclusive','maxInclusive','maxExclusive'])if(t[k]!=null)number(t[k],k);
  return at>=t.validFrom&&at<t.validTo&&(t.minInclusive==null||basis>=t.minInclusive)&&(t.minExclusive==null||basis>t.minExclusive)&&(t.maxInclusive==null||basis<=t.maxInclusive)&&(t.maxExclusive==null||basis<t.maxExclusive);
 });
 if(matches.length!==1)return{status:'unpriced',monthlyRate:null,lateMonthlyRate:null,flatFee:null,record:null,flags:[flag(matches.length?'ambiguous_tariff':'missing_tariff',{date:at,bank,transactionType})]};
 const t=matches[0];if(t.monthlyRate==null)return{status:'unpriced',monthlyRate:null,lateMonthlyRate:null,flatFee:t.flatFee??null,record:{...t},flags:[flag('missing_monthly_rate',{date:at,bank})]};
 number(t.monthlyRate,'monthlyRate');if(t.lateMonthlyRate!=null)number(t.lateMonthlyRate,'lateMonthlyRate');if(t.flatFee!=null)cents(t.flatFee,'flatFee');
 const flags=[];if(t.confidence!=='confirmed')flags.push(flag('tariff_not_confirmed',{validFrom:t.validFrom,validTo:t.validTo,bank}));if(!t.source)flags.push(flag('tariff_source_missing',{bank}));
 return{status:status(flags),monthlyRate:t.monthlyRate,lateMonthlyRate:t.lateMonthlyRate??null,flatFee:t.flatFee??null,record:{...t},flags};
}

function dueFor(statementDate,{lagDays,rollDue=false,calendar}){
 const nominalDueDate=addDays(statementDate,lagDays);if(!rollDue)return{nominalDueDate,dueDate:nominalDueDate,flags:[]};
 if(!calendar)return{nominalDueDate,dueDate:null,flags:[flag('business_calendar_unknown')]};
 date(calendar.coverageFrom);date(calendar.coverageTo);if(!Array.isArray(calendar.weekendDays)||!Array.isArray(calendar.holidays))fail('Explicit weekendDays and holidays required');
 const weekends=new Set(calendar.weekendDays.map(d=>integer(d,'weekday',0,6))),holidays=new Set(calendar.holidays.map(d=>{date(d);return d;}));
 let d=nominalDueDate;for(let i=0;i<370;i++,d=addDays(d,1)){
  if(d<calendar.coverageFrom||d>calendar.coverageTo)return{nominalDueDate,dueDate:null,flags:[flag('business_calendar_out_of_coverage',{date:d})]};
  if(!weekends.has(new Date(date(d)*DAY).getUTCDay())&&!holidays.has(d))return{nominalDueDate,dueDate:d,flags:[]};
 }
 fail('No business day found in supplied calendar');
}
export function cardCycle({postedDate,cutoffDay,lagDays=10,cutoffPosting,rollDue=false,calendar}){
 date(postedDate);integer(cutoffDay,'cutoffDay',1,31);integer(lagDays,'lagDays',0,366);if(cutoffPosting!=null&&!['same','next'].includes(cutoffPosting))fail('cutoffPosting must be same or next');
 const current=monthDate(postedDate,0,cutoffDay);if(postedDate===current&&cutoffPosting==null){const candidates=['same','next'].map(mode=>cardCycle({postedDate,cutoffDay,lagDays,cutoffPosting:mode,rollDue,calendar}));return{status:'conditional',statementDate:null,nominalDueDate:null,dueDate:null,candidates,flags:[flag('cutoff_posting_unknown')]};}
 const statementDate=monthDate(postedDate,postedDate>current||(postedDate===current&&cutoffPosting==='next')?1:0,cutoffDay),due=dueFor(statementDate,{lagDays,rollDue,calendar});return{status:status(due.flags),statementDate,...due};
}
export function installmentSchedule({amount,count,buyDate,cutoffDay,lagDays=10,cutoffPosting,rollDue=false,calendar}){
 const total=cents(amount);integer(count,'installment count',1,600);const first=cardCycle({postedDate:buyDate,cutoffDay,lagDays,cutoffPosting,rollDue,calendar});if(!first.statementDate)return{status:'conditional',totalCommittedPrincipal:amount,installments:[],flags:first.flags};
 // Rounding each equal installment may put the residual below zero for tiny inputs.
 // Use floor cents and give only the last installment the residual (documented model).
 const each=Math.floor(total/count);let future=total;const flags=[...first.flags],installments=[];
 for(let i=0;i<count;i++){const principal=i===count-1?total-each*(count-1):each;future-=principal;const statementDate=monthDate(first.statementDate,i,cutoffDay),due=dueFor(statementDate,{lagDays,rollDue,calendar});flags.push(...due.flags);installments.push({number:i+1,principal:money(principal),statementDate,...due,futurePrincipalAfterStatement:money(future)});}
 return{status:status(flags),totalCommittedPrincipal:amount,installments,flags:uniqueFlags(flags),roundingPolicy:'floor-to-cent; residual in final installment'};
}

/** Interest is on explicit unpaid principal only, on [chargeDate,endDate).
 * A repayment reduces the principal at the start of its date. minimumInterestDays
 * adds one day only to principal repaid on chargeDate. No implicit allocation policy.
 */
export function autoBillCost({bank,amount,chargeDate,endDate,repayments=[],tariffs,taxes,minimumInterestDays,allocationBasis,dueDate}){
 cents(amount);date(chargeDate);date(endDate);if(endDate<chargeDate)fail('endDate precedes chargeDate');if(minimumInterestDays!=null)integer(minimumInterestDays,'minimumInterestDays',0,1);
 const payments=repaymentList(repayments,chargeDate,endDate,amount),flags=[],daily=[];if(payments.length&&allocationBasis!=='confirmed')flags.push(flag('allocation_unconfirmed'));
 const initial=selectRate({date:chargeDate,bank,transactionType:'automatic_bill',transactionAmount:amount,tariffs});flags.push(...initial.flags);
 let principal=cents(amount),raw=0,unknown=false;
 const accrue=(at,balance,reason)=>{if(balance===0)return;const t=selectRate({date:at,bank,transactionType:'automatic_bill',transactionAmount:amount,tariffs});flags.push(...t.flags);if(t.monthlyRate==null){unknown=true;daily.push({date:at,principal:money(balance),interest:null,reason});return;}const interest=money(balance)*t.monthlyRate/30;raw+=interest;daily.push({date:at,principal:money(balance),monthlyRate:t.monthlyRate,interest,reason});};
 for(let d=date(chargeDate);d<=date(endDate);d++){
  const at=iso(d),paid=payments.filter(p=>p.date===at).reduce((s,p)=>s+cents(p.principal),0);principal-=paid;
  if(at===chargeDate&&paid>0){if(minimumInterestDays==null){unknown=true;flags.push(flag('same_day_minimum_unknown'));}else if(minimumInterestDays===1)accrue(at,paid,'same-day minimum');}
  if(at<endDate)accrue(at,principal,'daily principal');
 }
 if(dueDate!=null){date(dueDate);if(endDate>dueDate){unknown=true;flags.push(flag('overdue_requires_revolving_model'));}}
 const interest=unknown?null:round(raw),tax=taxesFor(interest,taxes);flags.push(...tax.flags);if(initial.flatFee==null)flags.push(flag('transaction_fee_unknown'));
 const totalCost=interest==null||tax.kkdf==null||initial.flatFee==null?null:round(interest+tax.kkdf+tax.bsmv+initial.flatFee);
 return{status:status(uniqueFlags(flags),totalCost==null),interest,knownInterest:round(raw),kkdf:tax.kkdf,bsmv:tax.bsmv,fee:initial.flatFee,totalCost,remainingPrincipal:money(principal),daily,flags:uniqueFlags(flags),bankReconciled:false,roundingPolicy:'aggregate interest rounded to cents; each tax separately rounded'};
}

/** Single statement principal. Future installments, accrued interest, taxes/fees
 * are never included in this interest base. minimumCredit is supplied explicitly.
 * Confirmed source method: one payment on dueDate. Pre-due variants require an
 * explicit mathematical scenario; bank allocation for those is not established.
 */
export function revolvingCost({bank,statementDate,dueDate,nextStatementDate,statementPrincipal,minimumPayment,repayments=[],tariffs,taxes,allocationBasis,preDueAccrual,rateBandPrincipal=statementPrincipal}){
 const initial=cents(statementPrincipal),minimum=cents(minimumPayment);cents(rateBandPrincipal,'rate band statement total');if(rateBandPrincipal<statementPrincipal)fail('Rate band total below interest-bearing principal');if(minimum>initial)fail('minimumPayment exceeds supplied statement principal');date(statementDate);date(dueDate);date(nextStatementDate);if(statementDate>dueDate||dueDate>=nextStatementDate)fail('Invalid statement date order');
 if(preDueAccrual!=null&&!['remaining-at-due','daily-outstanding'].includes(preDueAccrual))fail('Unknown preDueAccrual model');
 const payments=repaymentList(repayments,statementDate,nextStatementDate,statementPrincipal),beforeDue=payments.filter(p=>p.date<dueDate),flags=[],daily=[];
 if(payments.length&&allocationBasis!=='confirmed')flags.push(flag('allocation_unconfirmed'));
 if(payments.some(p=>p.minimumCredit==null))flags.push(flag('minimum_credit_unconfirmed'));
 const early=beforeDue.length>0,multipleAtDue=payments.filter(p=>p.date===dueDate).length>1;
 let unknown=false;
 const throughDue=payments.filter(p=>p.date<=dueDate),duePrincipal=initial-throughDue.reduce((s,p)=>s+cents(p.principal),0),credit=p=>cents(p.minimumCredit??p.principal,'minimum credit');
 if((early||multipleAtDue)&&duePrincipal>0){unknown=preDueAccrual==null;flags.push(flag(preDueAccrual?'pre_due_scenario':'pre_due_allocation_unsupported'));}
 const shortAtDue=Math.max(0,minimum-throughDue.reduce((s,p)=>s+credit(p),0));
 let principal=initial,credited=0,rawRegular=0,rawLate=0;
 for(let d=date(statementDate);d<date(nextStatementDate);d++){
  const at=iso(d);for(const p of payments.filter(p=>p.date===at)){principal-=cents(p.principal);credited+=credit(p);}
  let regular,late=0;
  if(at<dueDate){regular=duePrincipal===0?0:preDueAccrual==='daily-outstanding'?principal:duePrincipal;}
  else{late=Math.min(principal,Math.max(0,minimum-credited));regular=principal-late;}
  if(regular===0&&late===0)continue;
  const t=selectRate({date:at,bank,transactionType:'purchase',statementPrincipal:rateBandPrincipal,tariffs});flags.push(...t.flags);let ri=null,li=null;
  if(t.monthlyRate==null||(late>0&&t.lateMonthlyRate==null)){unknown=true;if(late>0&&t.lateMonthlyRate==null)flags.push(flag('late_rate_unknown',{date:at}));}
  if(t.monthlyRate!=null){ri=money(regular)*t.monthlyRate/30;rawRegular+=ri;}
  if(late===0)li=0;else if(t.lateMonthlyRate!=null){li=money(late)*t.lateMonthlyRate/30;rawLate+=li;}
  daily.push({date:at,regularPrincipal:money(regular),latePrincipal:money(late),regularInterest:ri,lateInterest:li});
 }
 for(const p of payments.filter(p=>p.date===nextStatementDate)){principal-=cents(p.principal);credited+=credit(p);}
 // Full, on-time payoff preserves the purchase grace period even in a supplied scenario.
 if(duePrincipal===0){for(const line of daily.filter(x=>x.date<dueDate)){line.regularInterest=0;}rawRegular=daily.filter(x=>x.date>=dueDate).reduce((s,x)=>s+(x.regularInterest??0),0);}
 const interest=unknown?null:round(rawRegular+rawLate),tax=taxesFor(interest,taxes);flags.push(...tax.flags);const totalCost=interest==null||tax.kkdf==null?null:round(interest+tax.kkdf+tax.bsmv);
 return{status:status(uniqueFlags(flags),totalCost==null),regularInterest:unknown?null:round(rawRegular),lateInterest:unknown?null:round(rawLate),interest,knownInterest:round(rawRegular+rawLate),kkdf:tax.kkdf,bsmv:tax.bsmv,totalCost,remainingPrincipal:money(principal),minimumShortfallAtDue:money(shortAtDue),minimumMet:shortAtDue===0,daily,flags:uniqueFlags(flags),bankReconciled:false,roundingPolicy:'aggregate interest rounded to cents; each tax separately rounded'};
}

/** Standalone candidate comparison. availableCash means cash already reserved for
 * THIS bill at repaymentDate after all other commitments. Planner must recompute
 * it after each accepted bill; reusing one cash/limit budget across bills is invalid.
 */
export function chooseBillBank({bill,candidates,tariffs,taxes}){
 cents(bill.amount);date(bill.chargeDate);if(!Array.isArray(candidates)||!candidates.length)fail('At least one bank candidate required');
 const options=candidates.map(candidate=>{
  const cycle=cardCycle({...candidate,postedDate:bill.chargeDate}),flags=[...cycle.flags];
  if(!candidate.repaymentDate){flags.push(flag('repayment_date_unknown'));return{bank:candidate.bank,cost:null,liquidityFits:null,limitFits:null,eligible:false,status:'conditional',flags};}
  date(candidate.repaymentDate);if(candidate.repaymentDate<bill.chargeDate)fail('Repayment precedes bill');
  const quote=autoBillCost({bank:candidate.bank,amount:bill.amount,chargeDate:bill.chargeDate,endDate:candidate.repaymentDate,dueDate:cycle.dueDate??undefined,repayments:[{date:candidate.repaymentDate,principal:bill.amount}],tariffs,taxes,allocationBasis:candidate.allocationBasis,minimumInterestDays:candidate.minimumInterestDays});flags.push(...quote.flags);
  const requiredCash=quote.totalCost==null?null:round(bill.amount+quote.totalCost);
  const hasCash=candidate.availableCash!=null,hasLimit=candidate.availableLimit!=null,hasCashLike=candidate.cashLikeAvailableLimit!=null;
  if(hasCash)cents(candidate.availableCash,'availableCash');else flags.push(flag('cash_capacity_unknown'));
  if(hasLimit)cents(candidate.availableLimit,'availableLimit');else flags.push(flag('available_limit_unknown'));
  if(hasCashLike)cents(candidate.cashLikeAvailableLimit,'cashLikeAvailableLimit');else flags.push(flag('cash_like_limit_unknown'));
  const liquidityFits=hasCash&&requiredCash!=null?candidate.availableCash>=requiredCash:null;
  const limitFits=hasLimit&&hasCashLike&&requiredCash!=null?candidate.availableLimit>=requiredCash&&candidate.cashLikeAvailableLimit>=bill.amount:null;
  const onTime=cycle.dueDate?candidate.repaymentDate<=cycle.dueDate:null;
  const eligible=liquidityFits===true&&limitFits===true&&onTime===true&&quote.status==='calculated'&&flags.length===0;
  return{bank:candidate.bank,cycle,repaymentDate:candidate.repaymentDate,quote,cost:quote.totalCost,requiredCash,liquidityFits,limitFits,onTime,eligible,status:status(flags,quote.totalCost==null),flags:uniqueFlags(flags)};
 });
 const eligible=options.filter(x=>x.eligible).sort((a,b)=>a.cost-b.cost||a.bank.localeCompare(b.bank)),selected=eligible[0]??null;
 return{billId:bill.id??null,status:selected?'calculated':'conditional',selectedBank:selected?.bank??null,options,bankReconciled:false};
}
/** Separate KMH account. Booking balances and interest value balances are distinct.
 * A deposit first extinguishes the existing debt; the remainder is spendable cash.
 * valueDate is explicit for every event changing principal. No holiday/one-day
 * convention is invented. Interest postings occur at the START of supplied dates,
 * covering accrued days before that date; inputs on a date retain array order.
 */
export function projectOverdraft({bank,startDate,endDate,openingPrincipal,openingInterest,openingTax,limit,events=[],interestPostingDates=[],tariffs,taxes,depositAllocation,allocationBasis,dailyDivisor,dailyDivisorConfidence}){
 date(startDate);date(endDate);if(endDate<startDate)fail('Invalid overdraft period');
 let principal=cents(openingPrincipal),cash=0,interestBalance=openingInterest==null?0:cents(openingInterest,'opening interest'),taxBalance=openingTax==null?0:cents(openingTax,'opening tax');
 const openingChargesKnown=openingInterest!=null&&openingTax!=null,limitCents=limit==null?null:cents(limit,'overdraft limit'),flags=[],ledger=[],daily=[],blockedEvents=[],valueMovements=[];
 if(!openingChargesKnown)flags.push(flag('opening_charges_unknown'));
 const unknownDivisor=dailyDivisor==null;if(unknownDivisor)flags.push(flag('overdraft_daily_divisor_unknown'));else{number(dailyDivisor,'dailyDivisor');if(dailyDivisor===0)fail('dailyDivisor must be positive');if(dailyDivisorConfidence!=='confirmed')flags.push(flag('overdraft_daily_divisor_scenario'));}
 if(limitCents==null)flags.push(flag('overdraft_limit_unknown'));
 const openingAvailableLimit=limitCents==null?null:!openingChargesKnown&&principal<limitCents?null:money(Math.max(0,limitCents-principal-interestBalance-taxBalance));
 if(limitCents!=null&&principal+interestBalance+taxBalance>limitCents)flags.push(flag('opening_overdraft_limit_exceeded'));
 if(depositAllocation!=null&&(!Array.isArray(depositAllocation)||[...depositAllocation].sort().join(',')!=='interest,principal,tax'))fail('depositAllocation must list principal, interest and tax once');
 const postings=new Set(interestPostingDates.map(d=>{date(d);if(d<startDate||d>endDate)fail('Interest posting outside period');return d;}));if(postings.size!==interestPostingDates.length)fail('Duplicate interest posting');
 const ordered=events.map((event,index)=>{date(event.date);if(event.date<startDate||event.date>endDate)fail('Account event outside period');cents(event.amount,'account event amount');if(!['deposit','withdrawal'].includes(event.type))fail('Unknown account event');if(event.valueDate!=null){date(event.valueDate);if(event.valueDate<event.date)fail('Value date precedes booking date; unsupported retrospective adjustment');}return{...event,index};}).sort((a,b)=>a.date.localeCompare(b.date)||a.index-b.index);
 let valueBalance=principal,raw=0,rawUnposted=0,postedInterestCost=0,postedTaxCost=0,unknownRate=false,unknownValue=false,allocationReliable=true;
 const queueValue=(change,event)=>{if(!change)return;if(event.valueDate==null){unknownValue=true;flags.push(flag('value_date_unknown',{date:event.date,index:event.index}));}else valueMovements.push({date:event.valueDate,change,bookingDate:event.date,index:event.index});};
 const settle=(available,event)=>{
  const total=principal+interestBalance+taxBalance;const paid={principal:0,interest:0,tax:0};let rest=available;if(available===0)return{rest,paid};
  if(rest>=total){paid.principal=principal;paid.interest=interestBalance;paid.tax=taxBalance;rest-=total;principal=interestBalance=taxBalance=0;}
  else if(interestBalance===0&&taxBalance===0){paid.principal=Math.min(rest,principal);principal-=paid.principal;rest-=paid.principal;}
  else if(!depositAllocation){allocationReliable=false;flags.push(flag('deposit_allocation_unknown',{date:event.date}));return null;}
  else{
   if(allocationBasis!=='confirmed')flags.push(flag('deposit_allocation_unconfirmed'));
   for(const bucket of depositAllocation){const balance=bucket==='principal'?principal:bucket==='interest'?interestBalance:taxBalance;const pay=Math.min(rest,balance);paid[bucket]=pay;rest-=pay;if(bucket==='principal')principal-=pay;else if(bucket==='interest')interestBalance-=pay;else taxBalance-=pay;}
  }
  queueValue(-paid.principal,event);return{rest,paid};
 };
 for(let d=date(startDate);d<=date(endDate);d++){
  const at=iso(d);
  if(postings.has(at)){
   if(unknownDivisor||unknownRate||unknownValue||!allocationReliable){flags.push(flag('interest_posting_unpriced',{date:at}));allocationReliable=false;}
   else{const interest=round(rawUnposted),t=taxesFor(interest,taxes);flags.push(...t.flags);
    if(t.kkdf==null){allocationReliable=false;flags.push(flag('interest_posting_unpriced',{date:at}));}
    else{interestBalance+=cents(interest);taxBalance+=cents(round(t.kkdf+t.bsmv));postedInterestCost+=interest;postedTaxCost+=t.kkdf+t.bsmv;rawUnposted=0;
     // Cash already in this account automatically funds posted charges. There is
     // no principal here when cash is positive under this account's netting rule.
     if(cash>0){const payment=settle(cash,{date:at,valueDate:at,index:-1});if(payment)cash=payment.rest;}
    }
   }
  }
  for(const event of ordered.filter(x=>x.date===at)){
   if(!allocationReliable){blockedEvents.push({...event,reason:'allocation_state_unknown'});continue;}
   const amount=cents(event.amount),beforeCash=cash;
   if(event.type==='deposit'){
    if(!openingChargesKnown){allocationReliable=false;flags.push(flag('opening_charges_prevent_exact_net_deposit',{date:at}));blockedEvents.push({...event,reason:'opening_charges_unknown'});continue;}
    const payment=settle(cash+amount,event);if(!payment){blockedEvents.push({...event,reason:'allocation_unknown'});continue;}cash=payment.rest;
    ledger.push({date:at,type:'deposit',grossDeposit:event.amount,principalRepaid:money(payment.paid.principal),interestPaid:money(payment.paid.interest),taxPaid:money(payment.paid.tax),netCashIncrease:money(cash-beforeCash),cash:money(cash),principal:money(principal)});
   }else{
    const borrowed=Math.max(0,amount-cash),available=limitCents==null?null:Math.max(0,limitCents-principal-interestBalance-taxBalance);
    if(borrowed>0&&(!openingChargesKnown||available==null||borrowed>available)){const reason=!openingChargesKnown?'opening_charges_unknown':available==null?'overdraft_limit_unknown':'withdrawal_exceeds_limit';flags.push(flag(reason,{date:at}));blockedEvents.push({...event,reason,shortfall:reason!=='withdrawal_exceeds_limit'?null:money(borrowed-available)});continue;}
    cash=Math.max(0,cash-amount);principal+=borrowed;queueValue(borrowed,event);
    ledger.push({date:at,type:'withdrawal',amount:event.amount,borrowed:money(borrowed),cash:money(cash),principal:money(principal)});
   }
  }
  if(limitCents!=null&&principal+interestBalance+taxBalance>limitCents)flags.push(flag('posted_balance_exceeds_limit',{date:at}));
  valueBalance+=valueMovements.filter(x=>x.date===at).reduce((n,x)=>n+x.change,0);
  if(at<endDate){const base=Math.max(0,valueBalance);if(base>0){const t=selectRate({date:at,bank,transactionType:'overdraft',statementPrincipal:openingPrincipal,tariffs});flags.push(...t.flags);const interest=t.monthlyRate==null||unknownDivisor?null:money(base)*t.monthlyRate/dailyDivisor;if(t.monthlyRate==null)unknownRate=true;if(interest==null){}else{raw+=interest;rawUnposted+=interest;}daily.push({date:at,principal:money(base),interest});}else daily.push({date:at,principal:0,interest:0});}
 }
 const pricingUnknown=unknownDivisor||unknownRate||unknownValue||!allocationReliable,interest=pricingUnknown?null:round(postedInterestCost+round(rawUnposted)),unpostedInterest=pricingUnknown?null:round(rawUnposted),unpostedTax=taxesFor(unpostedInterest,taxes);flags.push(...unpostedTax.flags);
 const totalCost=interest==null||unpostedTax.kkdf==null?null:round(interest+postedTaxCost+unpostedTax.kkdf+unpostedTax.bsmv),unpostedCost=unpostedInterest==null||unpostedTax.kkdf==null?null:round(unpostedInterest+unpostedTax.kkdf+unpostedTax.bsmv);
 const balancesKnown=allocationReliable&&openingChargesKnown,postedDebt=principal+interestBalance+taxBalance;
 return{status:unknownRate||unknownDivisor?'unpriced':status(uniqueFlags(flags)),cash:balancesKnown?money(cash):null,principal:allocationReliable?money(principal):null,postedInterest:balancesKnown?money(interestBalance):null,postedTax:balancesKnown?money(taxBalance):null,interest,totalCost,diagnosticRawInterest:raw,unpostedInterest,unpostedTax:unpostedTax.kkdf==null?null:round(unpostedTax.kkdf+unpostedTax.bsmv),totalDebt:balancesKnown&&unpostedCost!=null?round(money(postedDebt)+unpostedCost):null,openingAvailableLimit,availableLimit:balancesKnown&&limitCents!=null?money(Math.max(0,limitCents-postedDebt)):null,availableLimitAfterAccruedCost:balancesKnown&&limitCents!=null&&unpostedCost!=null?round(Math.max(0,money(limitCents-postedDebt)-unpostedCost)):null,interestPrincipal:unknownValue?null:money(Math.max(0,valueBalance)),pendingValueMovements:valueMovements.filter(x=>x.date>endDate).map(x=>({...x,change:money(x.change)})),ledger,daily,blockedEvents,feasible:blockedEvents.some(x=>x.reason==='withdrawal_exceeds_limit')||flags.some(x=>['opening_overdraft_limit_exceeded','posted_balance_exceeds_limit'].includes(x.code))?false:blockedEvents.length||pricingUnknown||!balancesKnown||limitCents==null||totalCost==null?null:flags.length?null:true,flags:uniqueFlags(flags),bankReconciled:false};
}
