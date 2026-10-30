/** Reconcile the full stable-key catalogue, including unscheduled purchases. */
export function purchaseDates({items,schedule,sheetIds,ownerFormulas={},priorCatalogue=[]}) {
 const byId=new Map(items.map(item=>[item.key,item]));
 if(byId.size!==items.length)throw Error('Duplicate purchase identity');
 const planned=new Map();
 for(const purchase of schedule){
  if(planned.has(purchase.key))throw Error('Duplicate scheduled identity');
  if(!byId.has(purchase.key))throw Error('Missing date source '+purchase.key);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(purchase.date)||new Date(purchase.date+'T00:00:00Z').toISOString().slice(0,10)!==purchase.date)throw Error('Invalid scheduled date');
  planned.set(purchase.key,purchase);
 }
 const previous=new Map(priorCatalogue.map(item=>[item.key,item])),updates=[],provenance=[],catalogue=[];
 for(const item of items){
  const prior=previous.get(item.key),owner=ownerFormulas[item.key]??prior?.owner??{K:item.priorityDateFormula,Q:item.priorityCapacityFormula};
  const expected=`=INDEX('Öncelik planı'!$K$111:$K$206;MATCH($P${item.ariziRow};'Öncelik planı'!$A$111:$A$206;0))`;
  const manual=item.ariziFormula!==expected;
  // Manual dates are input, not an output to reclaim. The compute layer uses them.
  if(manual){catalogue.push({...item,owner,manual:true,managed:false});continue;}
  if(item.priorityDateFormula!==owner.K||item.priorityCapacityFormula!==owner.Q)throw Error('Unexpected date owner formula '+item.key);
  const purchase=planned.get(item.key),managed=Boolean(purchase||prior?.managed);
  if(!managed){catalogue.push({...item,owner,managed:false,manual:false});continue;}
  const date=purchase?.date??'',parts=date?date.split('-').map(Number):[];
  const formula=date?`=IF('_Finans kontrol'!$B$2;DATE(${parts.join(';')});"")`:`=IF('_Finans kontrol'!$B$2;"";"")`;
  const value=date?Math.round((Date.parse(date+'T00:00:00Z')-Date.UTC(1899,11,30))/86400000):'';
  for(const column of[10,16])updates.push({sheetId:sheetIds.priority,row:item.priorityRow-1,column,formula,value,key:item.key});
  catalogue.push({...item,owner:{K:formula,Q:formula},managed:true,manual:false});
  provenance.push({...item,newDate:date,reason:date?'Capacity-tested execution plan; not an executed purchase':'Pending: no feasible date in the modeled horizon'});
 }
 return{updates,provenance,catalogue};
}
