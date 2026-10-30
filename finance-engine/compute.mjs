import { clone, grid, value, dateFromSerial, iso } from './cells.mjs';
import { sourceEvents } from './input-source.mjs';
import { planningFxBasis, applyPlanningFx } from './planning-fx.mjs';
import { projectPlan } from './integrated-projection.mjs';
import { openingCashRequirement } from './opening-requirement.mjs';
import { currentInput, extractIrregularOverrides } from './current-input.mjs';
import { monthlyOutput } from './monthly-output.mjs';

const REGULAR_ROWS = [5,6,7,8,12,13,16,17,21,22,23,24,25,26,27,28,32,33,37,38,39,43,44,45,46,47];
const ACTUAL_ROWS = [5,6,7,8,12,13,14,15,16,17,21,22,23,24,25,26,27,28,32,33,37,38,39,43,44,45,46,47];
const MONTHS = 14;
const validDate = date => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date + 'T00:00:00Z')) && new Date(date + 'T00:00:00Z').toISOString().slice(0,10) === date;

/** Pure generation boundary. All personal policy, rates, opening balances and dates
 * are supplied by private configuration. hash accepts a string; now is an ISO instant.
 * A verified sourceHash avoids serializing and hashing the captured workbook twice.
 * Native writes, publication and concurrency are intentionally owned by the caller. */
export function computeFinance({ source, config, hash, now, sourceHash: suppliedSourceHash }) {
  if (config?.version !== 'finance-compute-v1') throw new Error('Unsupported compute configuration');
  if (suppliedSourceHash !== undefined && (typeof suppliedSourceHash !== 'string' || !/^[a-f0-9]{64}$/i.test(suppliedSourceHash))) throw new Error('Invalid supplied source hash');
  if ((suppliedSourceHash === undefined && typeof hash !== 'function') || !Number.isFinite(Date.parse(now))) throw new Error('Explicit hash and generation clock required');
  const policy = clone(config.modelPolicy), facts = config.facts;
  if (!policy || !facts || !validDate(config.scheduling?.firstSalaryDate)) throw new Error('Complete private financial configuration required');
  const sourceHash = suppliedSourceHash ?? hash(JSON.stringify(source));
  const rows = sourceEvents(source);
  const flow = grid(source, '_Taşınma akışı').slice(100,196).map(r => r?.map(value)).filter(r => r?.[0]);
  let sourceChecks = 0;
  const check = (ok, message) => { sourceChecks++; if (!ok) throw new Error('Source preflight: ' + message); };
  const rowMap = new Map(rows.map(r => [r[0], r]));
  check(rowMap.size === rows.length, 'duplicate timeline ID');
  for (const r of rows) {
    check(validDate(r[1]), 'date ' + r[0]);
    for (const c of [2,6,7,8]) check(typeof r[c] === 'number' && Number.isFinite(r[c]), 'finite timeline ' + r[0] + ' col ' + c);
  }
  const plan = grid(source, 'Plan'), banks = grid(source, 'Kasa');
  for (const card of config.preflight.cardRows) {
    const r = (banks[card.row - 1] ?? []).map(value);
    check(r[1] === card.bank && r[2] === card.limit && r[3] === card.opening && r[5] === card.minimumRate && r[6] === card.cutoffDay && r[7] === card.lagDays, 'card settings changed ' + card.bank);
  }
  for (let m = 0; m < MONTHS; m++) for (const r of REGULAR_ROWS) {
    const expected = value(plan[r - 1]?.[m + 2]) ?? 0;
    check(typeof expected === 'number' && Number.isFinite(expected), 'finite Plan amount');
    let actual;
    if (r === 38) actual = rows.filter(e => e[0].startsWith('week-' + m + '-etut-')).reduce((sum,e) => sum - e[6], 0);
    else {
      const prefix = r <= 8 ? 'income' : r >= 21 && r <= 28 ? 'bill' : 'regular';
      const e = rowMap.get('month-' + m + '-' + prefix + '-' + r);
      actual = e ? (r <= 8 ? e[6] : -e[6] + e[7] + e[8]) : 0;
    }
    check(Math.abs(actual - expected) < .01, 'Plan ' + r + ' month ' + m + ' amount missing from source events');
  }
  for (const repayment of config.preflight.openingRepayments) for (let m = 0; m < MONTHS; m++) check(value(plan[repayment.row - 1]?.[m + 2]) === repayment.amounts[m], 'opening card repayment changed');
  check(facts.openingCash === policy.openingCash, 'opening cash changed');
  check(facts.overdraft.limit === policy.overdraftLimit && facts.overdraft.openingUsedPrincipal === policy.openingOverdraftPrincipal, 'overdraft changed');
  const reserve = facts.existingReserve;
  check(reserve?.status === 'user-confirmed' && reserve.amount === policy.openingReserve && reserve.maximumTotalTransfer === policy.reserveTransferLimit && reserve.availableFrom === policy.reserveTransferStart && reserve.transferWindowEnd === policy.reserveTransferEnd, 'confirmed existing reserve missing');
  for (const bank of Object.keys(policy.cardSettings)) check(facts.cashAdvanceAvailable?.[bank] === 0, 'cash advance availability changed');

  const flowById = new Map(flow.map(r => [r[0],r]));
  const irregularCells = grid(source,'Arızi Giderler').slice(4).filter(r => value(r?.[15]));
  const priorityByKey = new Map(irregularCells.map(r => [value(r[15]),Number(value(r[0]))]));
  // An explicit source date belongs to the user. It is no longer an optimizer choice.
  const fixedKeys = new Set(irregularCells.filter(r => r[4]?.userEnteredValue?.numberValue !== undefined).map(r => value(r[15])));
  const flowKey = id => id.replace(/-\d+$/,'');
  const isFlexible = id => flowById.get(flowKey(id))?.[2] === 'Esnek' && !fixedKeys.has(flowKey(id));
  for (const r of irregularCells) {
    const key = value(r[15]), item = flowById.get(key);
    if (!fixedKeys.has(key) || item?.[2] !== 'Esnek' || !(item[4] > 0)) continue;
    const fixedDate = iso(dateFromSerial(value(r[4])));
    const events = rows.filter(e => flowKey(e[0]) === key);
    check(events.length === 1 && events[0][1] === fixedDate, 'fixed purchase date missing or stale source event: ' + key);
  }
  const nativePlanning = source.sheets.some(s => s.properties.title === 'Finansman') ? grid(source,'Finansman') : null;
  const planningFx = planningFxBasis(source, { planningRates: nativePlanning ? {eurTry:value(nativePlanning[35]?.[11]),usdTry:value(nativePlanning[36]?.[11])} : undefined, asOfDate:config.planningFxDate, sourceHash });
  const sourceCash = applyPlanningFx(rows.filter(r => r[6] !== 0 && r[3] !== 'Kart ödemesi' && r[3] !== 'Faiz' && !isFlexible(r[0])).map(r => ({id:r[0],date:r[1],rank:r[2],sourceType:r[3],label:r[4] + (r[13] === 'Tarih varsayımı' ? ' · bütçe ayırma' : ''),amount:r[6],source:r[5],sourceDateStatus:r[13] ?? 'Bilinmiyor',sourceNote:r[14] ?? '',originalSourceDate:r[1],actualPaymentDate:r[13] === 'Tarih varsayımı' ? null : r[1],executionKind:r[13] === 'Tarih varsayımı' ? 'budget-reservation' : 'source-planned-event',...(r[13] === 'Tarih varsayımı' ? {date:r[1].slice(0,8) + '01'} : {})})), planningFx);
  const purchases = rows.filter(r => r[0] !== 'opening' && r[3] === 'Alışveriş' && (r[7] > 0 || r[8] > 0) && !isFlexible(r[0])).map(r => ({id:r[0],date:r[1],rank:r[2],label:r[4],amount:r[7] + r[8],bank:r[7] > 0 ? config.summaryBanks.Denizbank : config.summaryBanks.Isbank,installments:flowById.get(flowKey(r[0]))?.[7] ?? 1,kind:r[0].includes('-bill-') ? 'automatic_bill' : 'purchase',source:r[5],sourceDateStatus:r[13] ?? 'Bilinmiyor',sourceNote:r[14] ?? ''}));
  const summary = x => ({feasible:x.feasible,mathematicallyFeasible:x.mathematicallyFeasible,firstUnfunded:x.firstUnfunded,maximumUnfundedCash:x.maximumUnfundedCash,afterOpeningUnfunded:x.unfunded.filter(e => e.date >= config.scheduling.firstSalaryDate),limitViolations:x.limitViolations,unpriced:x.unpriced,monthEnds:x.monthEnds.map(e => ({month:e.date.slice(0,7),cash:e.cash,cashRequiredBalance:e.cashRequiredBalance,kmh:e.overdraftPrincipal,kmhAccrued:e.overdraftAccruedCost,cardDebt:e.cardDebt,Denizbank:e.cards[config.summaryBanks.Denizbank].totalDebt,Isbank:e.cards[config.summaryBanks.Isbank].totalDebt,reserveBalance:e.reserveBalance,knownNetAssets:e.knownNetAssets,futureInstallments:e.cards[config.summaryBanks.Denizbank].futureInstallmentPrincipal + e.cards[config.summaryBanks.Isbank].futureInstallmentPrincipal,unfundedCash:e.unfundedCash})),totalFinanceCost:Math.round(x.financeCosts.reduce((s,c) => s + (c.total ?? 0),0) * 100) / 100});
  const base = {...policy,cashEvents:sourceCash,purchases,billPolicy:'source'};
  delete base.extraCashEvents;
  base.requiredPaymentSchedule = projectPlan({...base,paymentMode:'minimum'}).payments.map(p => ({date:p.date,amount:p.amount,bank:p.bank,id:p.id}));
  // Comparisons retain their summaries, not multiple full ledgers for the whole run.
  const baseline = summary(projectPlan(base));
  let final = projectPlan({...base,billPolicy:'cost'});
  const costPolicy = summary(final);
  const billRoutingChanges = final.billComparisons.filter(c => purchases.find(p => p.id === c.billId)?.bank !== c.preferredBank).map(c => ({id:c.billId,sourceBank:purchases.find(p => p.id === c.billId)?.bank,costPreferredBank:c.preferredBank,options:c.options}));
  const stagedReserve = summary(projectPlan({...base,reserveTransfers:config.stagedReserveTransfers}));
  const flexible = flow.filter(r => r[2] === 'Esnek' && r[4] > 0 && !fixedKeys.has(r[0])).map(r => ({key:r[0],label:r[1],priority:priorityByKey.get(r[0]),amount:r[4],method:r[5]})).sort((a,b) => a.priority - b.priority || a.key.localeCompare(b.key));
  if (flexible.some(p => !Number.isFinite(p.priority))) throw new Error('Missing numeric flexible priority');
  const groups = [];
  for (const p of flexible) {
    if (groups[groups.length - 1]?.priority === p.priority) groups[groups.length - 1].items.push(p);
    else groups.push({priority:p.priority,items:[p]});
  }
  const accepted = [], proposed = [], rejected = [];
  let cursor = 0;
  const viable = x => x.unpriced.length === 0 && x.limitViolations.length === 0 && x.unfunded.length === 0;
  const {firstDate,lastDate,day:purchaseDay} = config.scheduling;
  if (!validDate(firstDate) || !validDate(lastDate) || firstDate > lastDate || !Number.isInteger(purchaseDay) || purchaseDay < 1 || purchaseDay > 28) throw new Error('Explicit scheduling range required');
  for (let at = new Date(firstDate + 'T00:00:00Z'); iso(at) <= lastDate; at = new Date(Date.UTC(at.getUTCFullYear(),at.getUTCMonth()+1,purchaseDay))) {
    const date = iso(at);
    while (cursor < groups.length) {
      const group = groups[cursor], trialEvents = group.items.map(p => ({id:'candidate-' + p.key,date,rank:700000,label:p.label,amount:-p.amount,source:'priority-preserving cash purchase candidate'}));
      const trial = projectPlan({...base,billPolicy:'cost',extraCashEvents:[...accepted,...trialEvents]});
      if (!viable(trial)) { rejected.push({date,priority:group.priority,reason:trial.limitViolations.length ? 'card-limit' : trial.unpriced.length ? 'unpriced' : 'later-cash-capacity'}); break; }
      accepted.push(...trialEvents); proposed.push(...group.items.map(p => ({...p,date}))); final = trial; cursor++;
    }
  }
  const mandatory = flow.filter(r => r[2] === 'Zorunlu' && r[4] > 0).map(r => ({key:r[0],label:r[1],date:iso(dateFromSerial(r[3])),amount:r[4],method:r[5],bank:r[6],installments:r[7]}));
  const openingRequirement = openingCashRequirement({cashEvents:sourceCash,openingCards:base.openingCards,startDate:base.startDate,firstSalaryDate:config.scheduling.firstSalaryDate});
  const result = {
    planningFx,generatedAt:now,source:{...config.sourceProvenance,sha256:sourceHash},
    unknownSourceDates:sourceCash.filter(e => e.sourceDateStatus === 'Tarih varsayımı').map(e => ({id:e.id,label:e.label,originalSourceDate:e.originalSourceDate,budgetReservationDate:e.date,actualPaymentDate:null,note:e.sourceNote})),
    status:'conditional scenario; native mutation owned by runtime',fundingEventsInjected:0,assumptions:[...final.flags,...config.assumptions],baseline,costPolicy,confirmedOpeningDueDate:config.confirmedOpeningDueDate,
    openingRequirement:{...openingRequirement,certainty:'confirmed-obligations; existing-reserve-available',availableCashAdvance:0},
    existingReserve:{openingAmount:reserve.amount,transferLimit:reserve.maximumTotalTransfer,windowEnd:reserve.transferWindowEnd,classification:reserve.classification,executionStatus:'planned-not-executed',plan:final.plannedReserveTransfers,totalTransferred:final.reserveTransferred,remaining:final.reserveBalance,openingKnownNetAssets:final.openingKnownNetAssets,comparison:{allUpfront:clone(baseline),staged:stagedReserve,selection:config.reserveSelection}},
    candidate:summary(final),mandatory,mandatoryCash:mandatory.filter(x => x.method === 'Nakit').reduce((s,x) => s + x.amount,0),mandatoryCard:mandatory.filter(x => x.method === 'Kredi kartı').reduce((s,x) => s + x.amount,0),prioritySchedule:proposed,pendingPriority:groups.slice(cursor),lastFlexiblePurchase:proposed[proposed.length - 1]?.date ?? null,
    billRoutingChanges,payments:final.payments,financeCosts:final.financeCosts,rejections:rejected,sourceStats:{cashEvents:sourceCash.length,purchases:purchases.length,flexible:flexible.length,sourceSourceAmountsMutated:0,preflightChecks:sourceChecks},
  };
  const modelInput = {...base,billPolicy:'cost',extraCashEvents:accepted};
  const actual = grid(source,'Gerçekleşen'), regular = [];
  for (let month = 0; month < MONTHS; month++) for (const row of ACTUAL_ROWS) regular.push({row,month,plan:value(plan[row-1]?.[month+2]),current:value(actual[row-1]?.[month+2])});
  const savings = Array.from({length:MONTHS},(_,month) => ({month,amount:Math.round((value(actual[56]?.[month+2])*planningFx.eurTry + value(actual[57]?.[month+2])*planningFx.usdTry + value(actual[58]?.[month+2]) + value(actual[59]?.[month+2]))*100)/100}));
  for (let month = 0; month < MONTHS; month++) if (value(plan[61]?.[month+2]) !== value(actual[60]?.[month+2])) throw new Error('Current withdrawal changed; exact withdrawal date required');
  const adapted = currentInput({modelInput,regular,savings,irregular:extractIrregularOverrides(grid(source,'Arızi Giderler')),pendingKeys:result.pendingPriority.flatMap(group => group.items.map(item => item.key))});
  adapted.modelInput.requiredPaymentSchedule = projectPlan({...adapted.modelInput,paymentMode:'minimum'}).payments.map(p => ({date:p.date,amount:p.amount,bank:p.bank,id:p.id}));
  const currentLedger = projectPlan(adapted.modelInput);
  const currentMonthly = monthlyOutput(currentLedger);
  // Published only after both Plan and Current validation/reconciliation succeed.
  result.sourceStats.validated = true;
  return {result,ledger:final,modelInput,currentInput:adapted,currentLedger,currentMonthly};
}
