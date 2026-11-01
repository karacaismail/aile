import { decodeFinanceWire, buildFinance } from './generated-finance-wire.mjs';
import { scalar, stableId, decimal } from './core.mjs';
import { provenance } from './native.mjs';

/** Verified plan projections: never turn a forecast into a payment or a financing agreement. */
export async function financeCollections(native, tenantId) {
 const collections = new Map();
 const tables = native.sheets.filter(t => t.source_key === 'budget' && t.properties.title === '_Finans web');
 if (tables.length > 1) throw new Error('More than one finance wire source');
 if (!tables.length) return collections;
 const table = tables[0];
 const rows = [...table.rows].sort(([a],[b])=>a-b).map(([row,cells])=>({row,values:Array.from({length:20},(_,c)=>scalar(cells.get(c)))})).filter(r=>r.values.some(v=>v!==null));
 const decoded = await decodeFinanceWire({ labels:rows[0].values, rows:rows.slice(1).map(r=>r.values) });
 const ledger = buildFinance(decoded.source);
 const forecastId = stableId(tenantId,'forecast',table.source_key,table.properties.sheetId,ledger.fingerprint);
 const money = value => ({ amount:decimal(value), currency:'TRY' });
 const add=(collection,record,partition='budget')=>{
  if (!collections.has(collection)) collections.set(collection,[]);
  collections.get(collection).push({partition,record});
 };
 add('forecasts',{id:forecastId,tenant_id:tenantId,kind:'forecast',record_basis:'forecast',source_id:table.source_id,fingerprint:ledger.fingerprint,payload_hash:decoded.metadata.payloadHash,status:ledger.status,notes:ledger.notes,provenance:provenance(table,1)});
 for (const [i,event] of ledger.events.entries()) {
  const {id,date,title,type,certainty,source,...measures}=event;
  add('forecast_events',{
   id:stableId(tenantId,'forecast_event',table.source_key,table.properties.sheetId,id),tenant_id:tenantId,forecast_id:forecastId,source_id:table.source_id,source_record_id:id,
   kind:'forecast_event',label:title,occurred_on:date,record_basis:'forecast',event_type:type,certainty,source_note:source,
   cash_change:money(event.cashChange),measures:Object.fromEntries(Object.entries(measures).map(([k,v])=>[k,money(v)])),
   provenance:provenance(table,rows[13+ledger.months.length+i].row),
  },`budget/${date.slice(0,7)}`);
 }
 for (const [i,month] of ledger.months.entries()) {
  const {month:period,...measures}=month;
  add('forecast_months',{id:stableId(tenantId,'forecast_month',table.source_key,table.properties.sheetId,period),tenant_id:tenantId,forecast_id:forecastId,source_id:table.source_id,kind:'forecast_month',period,record_basis:'forecast',measures:Object.fromEntries(Object.entries(measures).map(([k,v])=>[k,money(v)])),provenance:provenance(table,rows[12+i].row)},'budget');
 }
 return collections;
}
