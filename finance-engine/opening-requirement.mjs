/** Cash obligations before first confirmed salary; existing reserve is a separate asset. */
export function openingCashRequirement({cashEvents,openingCards,startDate,firstSalaryDate}) {
 const components=[...cashEvents.filter(e=>e.date>=startDate&&e.date<firstSalaryDate&&e.amount<0).map(e=>({id:e.id,date:e.date,amount:-e.amount,label:e.label})),...openingCards.filter(e=>e.dueDate>=startDate&&e.dueDate<firstSalaryDate).map(e=>({date:e.dueDate,amount:e.scheduledPayment,label:e.bank+' ekstre ödemesi'}))].sort((a,b)=>a.date.localeCompare(b.date));
 if(components.some(c=>!Number.isFinite(c.amount)||c.amount<0))throw new TypeError('Opening obligation must have a finite nonnegative amount');
 const amount=Math.round((components.reduce((sum,c)=>sum+c.amount,0)+Number.EPSILON)*100)/100;
 return {amount,components};
}
