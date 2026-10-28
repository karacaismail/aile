import { z } from 'zod';
export const sources = {
  auto: 'https://www.bddk.org.tr/Mevzuat/EkGetir/1210?ekId=271',
  personal: 'https://www.bddk.org.tr/Mevzuat/DokumanGetir/1270',
  koc: 'https://www.kocfinans.com.tr/tr/krediler/tasit-kredisi/ikinci-el-tasit-kredisi',
  garanti: 'https://www.garantibbva.com.tr/krediler/2-el-tasit-kredisi',
  enpara: 'https://www.enpara.com/krediler/ihtiyac-kredisi',
  tax: 'https://www.garantibbva.com.tr/krediler/kredi-hesaplama',
  income: 'https://www.enpara.com/sss/default.aspx?category=18',
} as const;
export const RULE_DATE = '2026-10-29';
export const autoLimits = (value: number) => value <= 0 ? { ltv: 0, months: 0 } : value <= 400000 ? { ltv: .7, months: 48 } : value <= 800000 ? { ltv: .5, months: 36 } : value <= 1200000 ? { ltv: .3, months: 24 } : value <= 2000000 ? { ltv: .2, months: 12 } : { ltv: 0, months: 0 };
export const personalTerm = (amount: number) => amount <= 125000 ? 36 : amount <= 250000 ? 24 : 12;
const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export type Payment = { month: number; payment: number; principal: number; interest: number; tax: number; balance: number };
export function amortize(principal: number, monthlyRate: number, months: number): Payment[] {
  if (!principal || !months) return [];
  const rate = monthlyRate / 100, taxRate = .30, effective = rate * (1 + taxRate);
  const instalment = round(effective ? principal * effective / (1 - (1 + effective) ** -months) : principal / months);
  let balance = principal;
  return Array.from({ length: months }, (_, i) => {
    const interest = round(balance * rate), tax = round(interest * .15) * 2;
    const capital = i === months - 1 ? balance : Math.min(balance, round(instalment - interest - tax));
    balance = round(balance - capital);
    return { month: i + 1, payment: round(capital + interest + tax), principal: capital, interest, tax: round(tax), balance };
  });
}
export const MAX_MONEY = 100000000;
export const moneyAmount = z.number().finite().min(0).max(MAX_MONEY);
const amount = moneyAmount;
export const schema = z.object({
  price: amount.positive().max(3000000), value: amount, year: z.number().int().min(1900), startYear: z.number().int().min(2000),
  autoProvider: z.enum(['koc','garanti']), personalProvider: z.enum(['enpara','garanti-digital','other']),
  autoRate: amount.max(20), personalRate: amount.max(20), autoMonths: z.number().int().min(1).max(48), personalMonths: z.number().int().min(1).max(36),
  cash: amount, contingencyCash: amount.optional(), applicantIncome: amount, spouseIncome: amount.optional(), householdIncome: amount, existingPersonalPrincipal: amount.nullable().optional(), existingDebt: amount.nullable(), livingCost: amount.nullable(), reserve: amount, runningCost: amount, otherUpfront: amount,
  debtRatio: z.number().min(1).max(50), personalLimit: amount, vehicleVerified: z.boolean(), sellerApproved: z.boolean(), creditHistory: z.enum(['unknown','clean','late']), vehicleClass: z.enum(['passenger','commercial']).optional(),
});
export type FinanceInput = z.infer<typeof schema>;
export type Rule = { id: string; title: string; status: 'pass' | 'warn' | 'block' | 'unknown'; reason: string; source?: string };

export function simulate(raw: FinanceInput) {
  const input = schema.parse(raw);
  const { price, cash, autoProvider, year, startYear } = input;
  const limit = autoLimits(input.value);
  const age = startYear - year;
  if (age < 0) throw new Error('Model yılı kredi başlangıç yılından büyük olamaz.');
  const ageMonths = autoProvider === 'garanti' ? Math.max(0, 144 - age * 12) : age > 15 ? 0 : 36;
  const maxAutoMonths = input.vehicleClass === 'commercial' ? 0 : Math.min(input.autoMonths, limit.months, ageMonths);
  const autoCap = maxAutoMonths ? Math.min(price, input.value * limit.ltv) : 0;
  const autoFeeRate = .005 * 1.15;
  const personalFeeRate = input.personalProvider === 'enpara' ? 0 : .005 * 1.15;
  const providerCap = input.personalProvider === 'enpara' ? 800000 : input.personalProvider === 'garanti-digital' ? 450000 : Infinity;
  const personalCap = Math.min(input.personalLimit, providerCap);
  const allocate = (totalCash: number) => {
    const availableCash = totalCash - input.otherUpfront;
    // Keep fees inside the cash envelope; never count the same cash twice.
    const autoOnlyDown = (availableCash - autoFeeRate * price) / (1 - autoFeeRate);
    const cashUsed = round(Math.min(price, Math.max(0, availableCash >= price ? price :
      autoOnlyDown >= price - autoCap ? autoOnlyDown :
      (availableCash - autoFeeRate * autoCap - personalFeeRate * (price - autoCap)) / (1 - personalFeeRate))));
    const autoPrincipal = round(Math.min(price - cashUsed, autoCap));
    const personalPrincipal = round(Math.max(0, price - cashUsed - autoPrincipal));
    const fees = round(autoPrincipal * autoFeeRate + personalPrincipal * personalFeeRate);
    const upfront = round(cashUsed + fees + input.otherUpfront);
    return { cashUsed, autoPrincipal, personalPrincipal, fees, upfront,
      upfrontGap: Math.max(0, round(upfront - totalCash)),
      fundingGap: round(Math.max(0, personalPrincipal - personalCap)) };
  };
  const contingencyCash = round(input.contingencyCash ?? 0);
  const base = allocate(cash);
  // A loan below Enpara's minimum must be eliminated, not rounded up into more debt.
  // Pick one monotonic principal target before the cents search.
  const reserveTarget = input.personalProvider==='enpara' && Math.min(base.personalPrincipal,personalCap)<5000 ? 0 : personalCap;
  const belowMinimum = input.personalProvider==='enpara' && base.personalPrincipal>0 && base.personalPrincipal<5000;
  let contingencyUsed = 0;
  if (contingencyCash > 0 && (base.upfrontGap > 0 || base.fundingGap > 0 || belowMinimum)) {
    const coversGap = (draw: number) => { const r=allocate(cash+draw); return r.upfrontGap===0 && r.personalPrincipal<=reserveTarget; };
    if (!coversGap(contingencyCash)) contingencyUsed = contingencyCash;
    else {
      // Search whole cents: draw only what closes the funding / upfront gap.
      let low=0, high=Math.round(contingencyCash*100);
      if (!Number.isSafeInteger(high)) throw new RangeError('Yedek nakit hesaplama sınırını aşıyor.');
      while(low<high) { const mid=Math.floor((low+high)/2); if(coversGap(mid/100))high=mid;else low=mid+1; }
      contingencyUsed=low/100;
    }
  }
  const contingencyRemaining = round(contingencyCash - contingencyUsed);
  const { cashUsed, autoPrincipal, personalPrincipal, fees, upfront, upfrontGap, fundingGap } = allocate(cash + contingencyUsed);
  const needsLoan = autoPrincipal + personalPrincipal > 0;
  const autoMonths = autoPrincipal ? maxAutoMonths : 0;
  // Garanti documents remaining post-13-Feb-2025 personal principal aggregation.
  // With unknown existing principal, use the shortest current legal tier; never
  // infer zero debt or promise a longer available term.
  const aggregatePersonal = input.existingPersonalPrincipal == null ? null : personalPrincipal + input.existingPersonalPrincipal;
  const maxPersonalMonths = aggregatePersonal === null ? 12 : personalTerm(aggregatePersonal);
  const personalMonths = personalPrincipal ? Math.min(Math.max(input.personalMonths,input.personalProvider==='enpara'?3:1), maxPersonalMonths) : 0;
  const autoSchedule = amortize(autoPrincipal, input.autoRate, autoMonths);
  const personalSchedule = amortize(personalPrincipal, input.personalRate, personalMonths);
  const schedule = Array.from({ length: Math.max(autoMonths,personalMonths) }, (_, i) => ({
    month: i + 1, auto: autoSchedule[i]?.payment ?? 0, personal: personalSchedule[i]?.payment ?? 0,
    payment: round((autoSchedule[i]?.payment ?? 0) + (personalSchedule[i]?.payment ?? 0)),
    principal: round((autoSchedule[i]?.principal ?? 0) + (personalSchedule[i]?.principal ?? 0)),
    interest: round((autoSchedule[i]?.interest ?? 0) + (personalSchedule[i]?.interest ?? 0)),
    tax: round((autoSchedule[i]?.tax ?? 0) + (personalSchedule[i]?.tax ?? 0)),
    balance: round((autoSchedule[i]?.balance ?? 0) + (personalSchedule[i]?.balance ?? 0)),
  }));
  const peakPayment = Math.max(0,...schedule.map(r => r.payment));
  const incomeRoom = Math.max(0, input.applicantIncome * input.debtRatio / 100 - (input.existingDebt ?? 0));
  const householdRoom = input.livingCost === null || input.existingDebt === null ? null : input.householdIncome - input.livingCost - input.existingDebt - input.reserve - input.runningCost;
  const documentedHouseholdIncome = input.applicantIncome + (input.spouseIncome ?? 0);
  const rules: Rule[] = [
    { id:'vehicle-class', title:'Araç ve ürün sınıfı', status:input.vehicleClass==='commercial'&&needsLoan?'unknown':'pass', reason:input.vehicleClass==='commercial'?'Pick-up için ruhsat ve ticari ürün koşulları ayrı teyit edilmeli. Binek taşıt kredi limiti uygulanmaz; bu senaryoda taşıt finansmanı hesaplanmaz.':'Bireysel amaçlı ikinci el binek taşıt senaryosu.' },
    { id:'vehicle-value',title:'Kasko değeri ve araç teyidi',status:!needsLoan||input.vehicleVerified?'pass':'unknown',reason:input.vehicleVerified?'Kasko değeri ve ilan bilgileri kullanıcı tarafından teyit edildi.':'Kasko değeri, tam motor/paket ve ilan fiyatı teyit edilmeden sonuç yalnız varsayımsaldır.',source:sources.koc },
    { id:'auto-limit',title:'Yasal taşıt kredisi sınırı',status:limit.ltv > 0?'pass':autoPrincipal===0&&personalPrincipal===0?'pass':'warn',reason:limit.ltv ? `Kasko değerinin en fazla %${limit.ltv*100} kadarı; azami ${limit.months} ay. Kademeli vergi gibi dilim dilim hesaplanmaz.`:'Bu kasko değeri için standart bireysel binek taşıt kredisi yok. Yerli elektrikli istisnası bu kataloğa uygulanmaz.',source:sources.auto },
    { id:'vehicle-age',title:'Finansörün araç yaşı koşulu',status:!needsLoan||ageMonths>0?'pass':'warn',reason:autoProvider==='koc'?'Koçfinans: en fazla 15 yaş. Ürün sayfasındaki daha dar 36 ay üst sınırı esas alınır.':'Garanti BBVA: araç yaşı ile vade toplamı en fazla 144 ay.',source:sources[autoProvider] },
    { id:'personal-term',title:'Peşinat için ihtiyaç kredisi',status:personalPrincipal>0?'warn':'pass',reason:personalPrincipal>0?`Kalan alım bedeli ayrı ihtiyaç kredisi olarak modellenir. Yeni kredi için tutar tavanı ${personalTerm(personalPrincipal)} ay; mevcut anapara da dikkate alındığında hesapta ${maxPersonalMonths} ay kullanılır. İki borç birlikte değerlendirilir; kullanım amacının finansörce kabulü teyit edilmelidir.`:'Peşinat için ihtiyaç kredisi gerekmiyor.',source:sources.personal },
    { id:'personal-minimum',title:'İhtiyaç kredisi asgari tutarı',status:input.personalProvider==='enpara'&&personalPrincipal>0&&personalPrincipal<5000?'block':'pass',reason:'Enpara ihtiyaç kredisi en az 5.000 TL ve en az 3 ay. Daha küçük açıkta nakit tamamlayın; ihtiyaçtan fazla borç otomatik eklenmez.',source:sources.enpara },
    { id:'personal-limit',title:'İhtiyaç kredisi ürün limiti',status:fundingGap>0?'block':personalPrincipal===0?'pass':input.personalProvider==='other'?'unknown':'pass',reason:fundingGap>0?'Gereken ihtiyaç kredisi, seçilen ürün / girilen teklif limitini aşıyor. Eksik tutar başka bankadan onaylanmış sayılmaz.':input.personalProvider==='enpara'?'Enpara yayımlanan tutar aralığı 5.000–800.000 TL; kişisel onay ayrı değerlendirilir.':input.personalProvider==='garanti-digital'?'Garanti BBVA maaş müşterisi olmayanlar için dijital kanal üst sınırı 450.000 TL. Şube teklifi farklı olabilir; sınırsız onay anlamına gelmez.':'Diğer bankanın limiti kullanıcı teklifidir; yayımlanmış ürün koşulları bu seçenek için doğrulanmadı.',source:input.personalProvider==='enpara'?sources.enpara:input.personalProvider==='garanti-digital'?sources.tax:undefined },
    { id:'aggregate-debt',title:'Mevcut ihtiyaç kredisi anaparası',status:personalPrincipal===0||aggregatePersonal!==null?'pass':'unknown',reason:aggregatePersonal===null?'Kalan ihtiyaç kredisi anaparası bilinmiyor; daha uzun vade varsayılmadan 12 ay kullanılır. Garanti açıklamasındaki toplam anapara kuralı ve bankanın uygulaması teyit edilmeli.':'Yeni krediyle mevcut ihtiyaç kredisi kalan anaparası birlikte vade hesabına katıldı.',source:sources.tax },
    { id:'accepted-income',title:'Finansörün kabul edeceği gelir',status:needsLoan?'unknown':'pass',reason:'Başvuru sahibinin belgeli geliri, eşinin bordrosu ve toplam hane geliri ayrıdır. Eş bordrosu ve diğer gelirler otomatik kredi gelirine eklenmez. Koçfinans kişisel gelir/borç/geçmişi değerlendirir; Enpara kefil kabul etmez. Bu kaynaklarda herkese uygulanan sabit bir taksit/gelir onay oranı yayımlanmıyor.',source:sources.income },
    { id:'existing-debt',title:'Mevcut borç bilgisi',status:input.existingDebt===null?'unknown':'pass',reason:input.existingDebt===null?'Başvuru sahibinin mevcut kredi ve kart aylık ödemeleri girilmedi.':'Girilen mevcut kredi/kart aylık ödemeleri hesaba dahil.' },
    { id:'debt-load',title:'Başvuru sahibi ödeme gücü',status:input.applicantIncome===0?'unknown':peakPayment>incomeRoom?'block':'pass',reason:`Yeni taksitler, başvuru sahibi gelirinin %${input.debtRatio} bütçe eşiği eksi mevcut borçla karşılaştırılır. Bu oran yasal/banka onay sınırı değildir. Hane geliri otomatik eklenmez.` },
    { id:'household',title:'Hane nakit dengesi',status:householdRoom===null?'unknown':peakPayment>householdRoom?'block':'pass',reason:householdRoom===null?'Yaşam giderleri ve mevcut borç girilmeden hane bütçesi sonucu belirlenemez.':'Hane gelirinden yaşam, mevcut borç, araç işletme gideri ve güvenlik payı düşülür. Taksit kalan tutarı aşmamalı.' },
    { id:'upfront',title:'Alım günündeki nakit',status:upfrontGap>0?'block':'pass',reason:'Tahsis ücreti, vergi ve girilen noter/ekspertiz/sigorta masrafları peşin nakit ister. Yedek nakit yalnız masraf veya kredi limiti açığı için gerektiği kadar kullanılır; aylık gelire eklenmez.' },
    { id:'seller',title:'Satıcı ve ekspertiz',status:needsLoan&&autoProvider==='koc'&&!input.sellerApproved?'unknown':'pass',reason:autoProvider==='koc'?'Koçfinans anlaşmalı satıcı/platform ve uygun ekspertiz gerekir; ağır hasar kabul edilmiş sayılmaz.':'Finansörün ruhsat, rehin, kasko ve ekspertiz koşulları ayrıca kontrol edilir.',source:sources[autoProvider] },
    { id:'history',title:'Kredi geçmişi',status:!needsLoan?'pass':input.creditHistory==='late'?'warn':input.creditHistory==='unknown'?'unknown':'warn',reason:input.creditHistory==='late'?'Gecikme/takip finansör değerlendirmesini etkiler; buradan otomatik ve kesin ret kararı üretilmez.':'Kredi geçmişi, Risk Merkezi ve banka iç değerlendirmesi bilinmeden onay verilemez. Temiz geçmiş de onay garantisi değildir.',source:sources.enpara },
  ];
  const totalPayments = round(schedule.reduce((sum,r)=>sum+r.payment,0));
  const budgetStatus = rules.some(r=>['debt-load','household'].includes(r.id)&&r.status==='block') ? 'Taksit yükü bütçe eşiğini aşıyor' : input.existingDebt===null||input.livingCost===null||input.applicantIncome===0 ? 'Bütçe bilgisi eksik' : 'Girilen bütçe taksitleri karşılıyor';
  const productBlocked = rules.some(r => ['personal-minimum','personal-limit'].includes(r.id) && r.status === 'block');
  const productUnknown = needsLoan && (input.vehicleClass === 'commercial' || (personalPrincipal > 0 && input.personalProvider === 'other'));
  const productStatus = productBlocked ? 'Seçilen ürün limitleri karşılamıyor' : productUnknown ? 'Ürün koşulları teyit edilmeli' : 'Yasal ve ürün sınırları içinde';
  const status = productBlocked ? 'Uygun değil' : !needsLoan ? 'Kredi gerekmiyor' : productUnknown ? 'Değerlendirilemiyor' : 'Koşullu uygun';
  return { budgetStatus, productStatus, documentedHouseholdIncome, fundingGap, cashUsed, contingencyUsed, contingencyRemaining,
    lenderStatus: 'Finansör onayı bilinmiyor', autoPrincipal,personalPrincipal,autoMonths,personalMonths,autoSchedule,personalSchedule,schedule,fees,upfront,upfrontGap,peakPayment,incomeRoom,householdRoom,rules,totalPayments,
    totalCost: round(cashUsed + totalPayments + fees + input.otherUpfront), financingCost: round(totalPayments-autoPrincipal-personalPrincipal+fees), status,
  };
}

// Budget-only lower bound, never a lender approval. Unknown household costs stay unknown.
export function minimumCash(input: FinanceInput): number | null {
  if (input.existingDebt === null || input.livingCost === null || input.applicantIncome <= 0 || input.vehicleClass === 'commercial') return null;
  const fits = (cash: number) => { const r=simulate({...input,cash}); return !r.rules.some(rule=>['debt-load','household','personal-limit','personal-minimum','upfront'].includes(rule.id)&&rule.status==='block'); };
  if (fits(0)) return 0;
  const ceiling=Math.min(MAX_MONEY,input.price+input.otherUpfront);
  let low=0, high=ceiling;
  if (!fits(high)) return null;
  for(let i=0;i<35;i++){const mid=(low+high)/2;if(fits(mid))high=mid;else low=mid;}
  let target = Math.min(ceiling,Math.ceil(high / 1000) * 1000);
  // Minimum loan amounts create a narrow discontinuity next to a cash purchase.
  // Recheck the rounded result rather than claiming the bisection is sufficient.
  while (!fits(target) && target < ceiling) target = Math.min(ceiling,target+1000);
  return fits(target) ? target : null;
}
