import { describe, expect, it } from 'vitest';
import { autoLimits, personalTerm, amortize, simulate, minimumCash, schema, type FinanceInput } from './finance';
const input: FinanceInput = { price: 1000000, value: 1000000, year: 2020, startYear: 2026, autoProvider: 'koc', personalProvider: 'enpara', autoRate: 3.5, personalRate: 4, autoMonths: 24, personalMonths: 36, cash: 0, applicantIncome: 30000, householdIncome: 60000, existingDebt: 0, existingPersonalPrincipal: 0, livingCost: 20000, reserve: 5000, runningCost: 4000, otherUpfront: 15000, debtRatio: 40, personalLimit: 800000, vehicleVerified: false, sellerApproved: false, creditHistory: 'unknown' };
it('rejects amounts that can overflow the reserve cents search before calculation',()=>{
  for(const contingencyCash of [100000001,1e308]) expect(schema.safeParse({...input,contingencyCash}).success).toBe(false);
  expect(schema.safeParse({...input,contingencyCash:100000000}).success).toBe(true);
});
describe('vehicle credit rules and payments', () => {
  it.each([[400000,.7,48],[400001,.5,36],[800000,.5,36],[800001,.3,24],[1200000,.3,24],[1200001,.2,12],[2000000,.2,12],[2000001,0,0]])('applies the whole value band at %i', (value,ltv,months) => { expect(autoLimits(value)).toEqual({ ltv, months }); });
  it.each([[125000,36],[125001,24],[250000,24],[250001,12]])('uses the personal-loan boundary %i', (amount,months) => expect(personalTerm(amount)).toBe(months));
  it('includes taxes on interest and clears remaining principal to the cent', () => {
    const rows = amortize(100000, 3, 12);
    expect(rows[0].interest).toBe(3000); expect(rows[0].tax).toBe(900);
    expect(rows.at(-1)?.balance).toBe(0);
    expect(rows.reduce((n,r)=>n+r.principal,0)).toBeCloseTo(100000,2);
    expect(amortize(120000,0,12)[0].payment).toBe(10000);
  });
  it('counts a borrowed down payment in both loans; caps terms and rejects unaffordable debt', () => {
    const r=simulate(input);
    expect(r.autoPrincipal).toBe(300000); expect(r.personalPrincipal).toBe(700000);
    expect(r.personalMonths).toBe(12);
    expect(r.rules.find(r=>r.id==='debt-load')?.status).toBe('block');
    expect(r.upfrontGap).toBeGreaterThan(15000);
    expect(r.peakPayment).toBeGreaterThan(r.autoSchedule[0].payment);
  });
  it('does not treat household income as the applicant income and blocks unknown debt status', () => {
    expect(simulate({...input,householdIncome:900000}).rules.find(r=>r.id==='debt-load')?.status).toBe('block');
    expect(simulate({...input,existingDebt:null}).rules.find(r=>r.id==='existing-debt')?.status).toBe('unknown');
  });
  it('enforces lender age and cash constraints, does not invent a loan above the limit', () => {
    const r=simulate({...input,year:2000,price:2500000,value:2500000});
    expect(r.autoPrincipal).toBe(0); expect(r.rules.find(r=>r.id==='personal-limit')?.status).toBe('block');
    expect(simulate({...input,autoProvider:'garanti',year:2015}).autoMonths).toBe(12);
  });
  it('rejects invalid numeric inputs rather than generating a misleading plan', () => {
    expect(()=>simulate({...input,price:3000001})).toThrow();
    expect(()=>simulate({...input,autoRate:NaN})).toThrow();
    expect(()=>simulate({...input,applicantIncome:-1})).toThrow();
  });
});
it('does not block a fully cash purchase on credit age or band rules', () => {
  const r=simulate({...input,year:2000,price:2500000,value:2500000,cash:2600000});
  expect(r.rules.filter(r=>['vehicle-age','auto-limit','seller','history','vehicle-value'].includes(r.id)).every(r=>r.status==='pass')).toBe(true);
  expect(r.schedule).toHaveLength(0);
});
it('rejects a future model year and treats commercial vehicles as a separate product', () => {
  expect(()=>simulate({...input,year:2027,startYear:2026})).toThrow();
  const r=simulate({...input,vehicleClass:'commercial'} as FinanceInput);
  expect(r.rules.find(r=>r.id==='vehicle-class')?.status).toBe('unknown');
  expect(r.autoPrincipal).toBe(0);
});
it('separates budget pressure from lender approval', () => {
  const r=simulate(input);
  expect(r.budgetStatus).toBe('Taksit yükü bütçe eşiğini aşıyor');
  expect(r.lenderStatus).toBe('Finansör onayı bilinmiyor');
});
it('reserves fees inside available cash and finds a feasible cash floor', () => {
  const rich={...input,applicantIncome:900000,householdIncome:1000000,otherUpfront:0};
  const r=simulate({...rich,cash:500000});
  expect(r.upfrontGap).toBe(0);
  expect(r.cashUsed+r.autoPrincipal+r.personalPrincipal).toBeCloseTo(rich.price,2);
  const target=minimumCash(rich)!;
  expect(target).toBeLessThan(10000);expect(target).toBeGreaterThan(0);
  expect(simulate({...rich,cash:target}).upfrontGap).toBe(0);
});
it('does not turn a personal budget ratio into a legal or product rejection',()=>{
  const r=simulate({...input,cash:20000,vehicleVerified:true,sellerApproved:true,creditHistory:'clean'});
  expect(r.rules.find(r=>r.id==='debt-load')?.status).toBe('block');
  expect(r.productStatus).toBe('Yasal ve ürün sınırları içinde');
  expect(r.status).not.toBe('Uygun değil');
});
it('separates payroll and household money; unknown aggregate personal debt uses a conservative term',()=>{
 const r=simulate({...input,price:200000,value:200000,spouseIncome:20000,householdIncome:600000,existingPersonalPrincipal:null});
 expect(r.documentedHouseholdIncome).toBe(50000);expect(r.personalMonths).toBe(12);
 expect(r.lenderStatus).toBe('Finansör onayı bilinmiyor');
});

it('distinguishes the digital-channel cap from a branch or other personal offer',()=>{
 const r=simulate({...input,cash:20000,personalProvider:'garanti-digital'});
 expect(r.fundingGap).toBeGreaterThan(0);expect(r.status).toBe('Uygun değil');
 expect(simulate({...input,cash:20000,personalProvider:'other'}).status).toBe('Değerlendirilemiyor');
});

it('uses only the emergency cash needed for fees, keeping the rest separate from the down payment',()=>{
  const r=simulate({...input,otherUpfront:0,contingencyCash:40000});
  expect(r.contingencyUsed).toBe(1725);
  expect(r.contingencyRemaining).toBe(38275);
  expect(r.cashUsed).toBe(0);
  expect(r.autoPrincipal).toBe(300000);expect(r.personalPrincipal).toBe(700000);
  expect(r.upfrontGap).toBe(0);
});
it('draws the minimum reserve needed to cover a product cap gap and fees',()=>{
  const r=simulate({...input,price:1200000,value:1200000,otherUpfront:0,contingencyCash:60000});
  expect(r.personalPrincipal).toBe(800000);expect(r.autoPrincipal).toBe(360000);
  expect(r.contingencyUsed).toBe(42070);expect(r.contingencyRemaining).toBe(17930);
  expect(r.fundingGap).toBe(0);expect(r.upfrontGap).toBe(0);
  expect(r.cashUsed+r.autoPrincipal+r.personalPrincipal).toBe(1200000);
});
it('does not invent emergency cash or use it to make monthly affordability look better',()=>{
  const r=simulate({...input,price:1200000,value:1200000,otherUpfront:0,contingencyCash:10000});
  expect(r.contingencyUsed).toBe(10000);expect(r.contingencyRemaining).toBe(0);
  expect(r.fundingGap).toBe(32070);expect(r.status).toBe('Uygun değil');
  expect(r.incomeRoom).toBe(simulate(input).incomeRoom);
  expect(r.householdRoom).toBe(simulate(input).householdRoom);
  expect(simulate({...input,cash:50000,contingencyCash:40000}).contingencyUsed).toBe(0);
});
it('uses the reserve to eliminate a loan below the lender minimum, without overborrowing',()=>{
 const base={...input,cash:700000,otherUpfront:0};
 const r=simulate({...base,contingencyCash:10000});
 expect(r.personalPrincipal).toBe(0);expect(r.contingencyUsed).toBe(1725);
 expect(r.status).toBe('Koşullu uygun');
 const short=simulate({...base,contingencyCash:1000});
 expect(short.contingencyUsed).toBe(1000);expect(short.personalPrincipal).toBe(725);
 expect(short.status).toBe('Uygun değil');
});
it('needs no additional down payment when the reserve closes the gap and the budget already fits',()=>{
 expect(minimumCash({...input,applicantIncome:900000,householdIncome:1000000,otherUpfront:0,contingencyCash:40000})).toBe(0);
});

it('keeps the minimum cash search inside the validated money range',()=>{
 expect(minimumCash({...input,otherUpfront:100000000})).toBeNull();
});
