import { readFile } from 'node:fs/promises';
import { stableId, decimal, isoDate, scalar } from './core.mjs';
import { archiveRecords, provenance, tableRecords } from './native.mjs';
import { createTaxonomy } from './taxonomy.mjs';
const columns=JSON.parse(await readFile(new URL('./dictionaries/source-columns.json',import.meta.url),'utf8'));
const kinds={satinalma:'purchase_need',aydinlatma:'lighting_spec',tadilat:'work_order',yerlesim:'layout_item',usta:'provider',kontrol:'inspection',sahne:'automation_scene',kilometre:'milestone'};
const collectionFor={purchase_need:'purchase_needs',lighting_spec:'lighting_specs',work_order:'work_orders',layout_item:'layout_items',provider:'providers',inspection:'inspections',automation_scene:'automation_scenes',milestone:'milestones',unclassified_item:'unclassified_items'};
const list=value=>Array.isArray(value)?value:typeof value==='string'&&value.trim()?parseList(value):[];
const linkList=value=>{if(Array.isArray(value))return value;if(typeof value!=='string'||!value.trim())return [];try{const parsed=JSON.parse(value);if(Array.isArray(parsed))return parsed.map(String);}catch{}return value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);};
function parseList(value){try{const parsed=JSON.parse(value);if(Array.isArray(parsed))return parsed.map(String);}catch{}return value.split(/[\n,;]+/).map(x=>x.trim()).filter(Boolean);}
const nonblank=value=>value!==null&&value!==''&&value!==undefined;
const monthNames=['oca','şub','mar','nis','may','haz','tem','ağu','eyl','eki','kas','ara'];
function month(cell){
 const v=scalar(cell),date=isoDate(v,cell);if(date)return date.slice(0,7);
 if(typeof v!=='string')return null;
 if(/^\d{4}-(?:0[1-9]|1[0-2])$/.test(v))return v;
 const match=v.toLocaleLowerCase('tr-TR').match(/^(oca(?:k)?|şub(?:at)?|mar(?:t)?|nis(?:an)?|may(?:ıs)?|haz(?:iran)?|tem(?:muz)?|ağu(?:stos)?|eyl(?:ül)?|eki(?:m)?|kas(?:ım)?|ara(?:lık)?)[ '\u2019-]*(\d{2}|\d{4})$/);
 return match?`${match[2].length===2?'20':''}${match[2]}-${String(monthNames.indexOf(match[1].slice(0,3))+1).padStart(2,'0')}`:null;
}
export function normalize(native,tenantId) {
 const taxonomy=createTaxonomy(tenantId),collections=new Map(),issues=[],entities=[],pending=[],itemIds=new Map(),codes=new Map(),rooms=new Map();
 const add=(collection,record,partition='global')=>{if(!collections.has(collection))collections.set(collection,[]);collections.get(collection).push({partition,record});};
 const issue=(code,p,detail)=>{const record={id:stableId(tenantId,'issue',code,p??{},detail),tenant_id:tenantId,code,severity:'review',provenance:p,detail};issues.push(record);};
 const term=(key,code,p)=>{if(!nonblank(code))return null;const id=taxonomy.termIndex.get(`${key}:${code}`);if(!id)issue('unknown_term',p,{vocabulary:key,value:code});return id??null;};
 for(const key of ['vocabularies','terms','workflows','view_definitions','task_templates'])for(const record of taxonomy[key])add(key,record);
 for(const record of native.sources)add('sources',record,record.key);
 for(const record of native.supplements)add('supplements',record);
 const tables=[...native.sheets].sort((a,b)=>a.source_key.localeCompare(b.source_key)||a.properties.sheetId-b.properties.sheetId);
 const converted=new Set();
 const identity=(table,row)=>{
  const raw=row.attrs.id;
  if(!nonblank(raw)||typeof raw!=='string'){
   // Template checkbox FALSE cells are still retained in source_cells, not made into records.
   if(Object.entries(row.attrs).some(([k,v])=>['tamam','mevcut','karar_bekliyor','acikta','izin_gerekli','myk_dogrulandi'].includes(k)?v===true:k!=='version'&&nonblank(v)))issue('missing_record_id',provenance(table,row.row),{sheet:table.properties.title});
   return null;
  }
  const key=`${table.source_key}/${table.properties.sheetId}/${raw}`;
  if(converted.has(key))throw new Error(`Duplicate record id in ${table.properties.title}`);converted.add(key);
  return stableId(tenantId,'entity',table.source_key,table.properties.sheetId,raw);
 };
 const attributes=(table,row,defs)=>Object.fromEntries(defs.filter(d=>Object.hasOwn(row.attrs,d.key)).map(d=>{
  const value=row.attrs[d.key],p=provenance(table,row.row,row.columns.get(d.key));let normalized=value;
  if(!nonblank(value))normalized=null;
  else if(d.type==='sayi'){normalized=decimal(value);if(normalized===null)issue('invalid_decimal',p,{field:d.key,value});}
  else if(d.type==='tarih'){normalized=isoDate(value,row.cells.get(row.columns.get(d.key)));if(normalized===null)issue('invalid_date',p,{field:d.key,value});}
  else if(d.type==='tarihsaat'){
   normalized=typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
   if(normalized===null)issue('invalid_timestamp',p,{field:d.key,value});
  }else if(d.type==='bool'){
   normalized=typeof value==='boolean'?value:value==='TRUE'||value==='true'?true:value==='FALSE'||value==='false'?false:null;
   if(normalized===null)issue('invalid_boolean',p,{field:d.key,value});
  }else if(['liste','enumliste'].includes(d.type))normalized=d.key==='linkler'?linkList(value):list(value);
  return [d.key,normalized];
 }));
 const base=(table,row,id,kind,attrs)=>({id,tenant_id:tenantId,kind,label:String(row.attrs.ad??row.attrs.etiket??row.attrs.kalem??row.attrs.anahtar??row.attrs.id),source_id:table.source_id,source_record_id:String(row.attrs.id),source_attributes:row.attrs,attributes:attrs,provenance:provenance(table,row.row),deleted_at:attrs.deleted_at??null});
 const money=value=>value===null||value===undefined?null:{amount:value,currency:'TRY'};
 for(const table of tables){
  const partition=`${table.source_key}/${table.properties.sheetId}`;
  const archived=archiveRecords(table,tenantId);for(const c of archived.cells){add('source_cells',c,partition);if(c.cell.effectiveValue?.errorValue)issue('formula_error',c.provenance,c.cell.effectiveValue.errorValue);}
  for(const row of archived.rows)add('source_rows',row,partition);
  add('sheets',{id:stableId(tenantId,'sheet',table.source_key,table.properties.sheetId),tenant_id:tenantId,source_id:table.source_id,properties:table.properties,nonempty_cell_count:archived.cells.length,nonempty_row_count:archived.rows.length},table.source_key);
  if(table.properties.title==='app_ayarlar')for(const row of tableRecords(table)){
   const id=identity(table,row);if(!id)continue;const attrs=attributes(table,row,columns.settings);
   const record=base(table,row,id,row.attrs.tip==='oda'?'room':'setting',attrs);add('settings',record,table.source_key);
   if(row.attrs.tip==='oda'){
    const room={...record,id:stableId(tenantId,'room',table.source_key,row.attrs.id),setting_id:id,code:String(row.attrs.anahtar),kind:'room'};
    add('rooms',room,table.source_key);entities.push(room);const key=`${table.source_key}/${row.attrs.anahtar}`;rooms.set(key,[...(rooms.get(key)??[]),room.id]);
   }
  }
 }
 for(const table of tables){
  if(!['app_kalemler','app_nakit'].includes(table.properties.title))continue;
  for(const row of tableRecords(table)){
   const id=identity(table,row);if(!id)continue;
   const isCash=table.properties.title==='app_nakit',attrs=attributes(table,row,columns[isCash?'cash':'items']);
   if(isCash){
    const record={...base(table,row,id,'payment',attrs),occurred_on:attrs.tarih??null,amount:money(attrs.tutar),record_basis:'user_recorded_payment',payment_method_term_id:null,funding_source_id:null,account_id:null,evidence_status:'not_supplied'};
    add('payments',record,table.source_key);entities.push(record);
    if(nonblank(row.attrs.kalem_id))pending.push({from:record,kind:'payment_for',target:String(row.attrs.kalem_id),lookup:'id'});
    continue;
   }
   const kind=kinds[row.attrs.tip]??'unclassified_item';if(kind==='unclassified_item')issue('unknown_record_type',provenance(table,row.row),{value:row.attrs.tip});
   const status=row.attrs.durum;
   const decision={fikir:'idea',arastirma:'researching',karar:'decided',iptal:'cancelled'}[status]??(attrs.karar_bekliyor===true?'pending':null);
   const fulfillment={siparis:'ordered',teslim:'delivered',kuruldu:'installed',iptal:'cancelled'}[status]??null;
   const phase=String(row.attrs.faz??'');
   const record={...base(table,row,id,kind,attrs),category_term_id:term('category',row.attrs.kategori,provenance(table,row.row)),phase_term_id:phase==='1'||phase==='2'?term('phase',phase==='1'?'before_move':'after_move',null):null,context_term_ids:phase==='3'?[term('life_context','baby_preparation',null)]:[],state_snapshot:{decision,fulfillment,inspection:kind==='inspection'&&attrs.tamam===true?'completed':null,payment:null},legacy_status_term_id:term('legacy_status',status,provenance(table,row.row)),amounts:{estimated_min:money(attrs.tahmini_tl_min),estimated_max:money(attrs.tahmini_tl_max),recorded_price:money(attrs.gercek_tl),quote:money(attrs.teklif_tl)},dates:{planned_on:attrs.planlanan_tarih??null,order_due_on:attrs.siparis_son_tarih??null,delivered_on:attrs.teslim_tarihi??null,payment_on:attrs.odeme_tarihi??null,end_on:attrs.bitis_tarihi??null},room_id:null};
   record.state_term_ids=Object.fromEntries(Object.entries(record.state_snapshot).map(([axis,code])=>[axis,code===null?null:term(`${axis}_state`,code,record.provenance)]));
   if(phase&&!['1','2','3'].includes(phase))issue('unknown_phase',record.provenance,{value:phase});
   if(nonblank(row.attrs.oda)){
    const roomIds=rooms.get(`${table.source_key}/${row.attrs.oda}`)??[];
    if(roomIds.length===1){record.room_id=roomIds[0];pending.push({from:record,kind:'located_in',target:roomIds[0],lookup:'resolved'});}
    else issue(roomIds.length?'ambiguous_room':'unresolved_room',record.provenance,{value:row.attrs.oda});
   }
   add(collectionFor[kind],record,table.source_key);entities.push(record);
   const key=`${table.source_key}/${row.attrs.id}`;itemIds.set(key,[...(itemIds.get(key)??[]),id]);
   if(nonblank(row.attrs.kod)){const code=`${table.source_key}/${row.attrs.kod}`;codes.set(code,[...(codes.get(code)??[]),id]);}
   for(const target of list(row.attrs.bagli_idler))pending.push({from:record,kind:'associated_with',target,lookup:'id'});
   for(const target of list(row.attrs.bagimlilik))pending.push({from:record,kind:'depends_on',target,lookup:'code'});
   for(const url of linkList(row.attrs.linkler)){
    let parsed;try{parsed=new URL(url);}catch{issue('invalid_link',record.provenance,{value:url});continue;}
    if(!['https:','http:'].includes(parsed.protocol)){issue('unsupported_link_protocol',record.provenance,{protocol:parsed.protocol});continue;}
    const media={id:stableId(tenantId,'reference',id,url),tenant_id:tenantId,entity_id:id,url,kind:/\.(?:png|jpe?g|webp|avif|gif)$/i.test(parsed.pathname)?'image_candidate':'web_reference',verification:'not_verified',rights_status:'unknown',provenance:record.provenance};add('media_references',media,table.source_key);
   }
  }
 }
 for(const link of pending){
  const matches=link.lookup==='resolved'?[link.target]:(link.lookup==='code'?codes:itemIds).get(`${link.from.provenance.source_key}/${link.target}`)??[];
  if(matches.length!==1){issue(matches.length?'ambiguous_relation':'unresolved_relation',link.from.provenance,{kind:link.kind,target:link.target,lookup:link.lookup});continue;}
  add('relations',{id:stableId(tenantId,'relation',link.from.id,link.kind,matches[0]),tenant_id:tenantId,kind:link.kind,source_id:link.from.id,target_id:matches[0],provenance:link.from.provenance},link.from.provenance.source_key);
 }
 for(const table of tables){
  if(table.properties.title.startsWith('app_'))continue;
  if(!['Plan','Gerçekleşen','Giderler Planlanan','Giderler Gerçekleşen'].includes(table.properties.title)){
   if(table.rows.size)issue('source_only_sheet',provenance(table,0),{reason:'Derived or unowned table is retained as source, not duplicated budget facts'});
   continue;
  }
  let headings=null,headerRow=null;
  for(const [r,cells]of [...table.rows].sort((a,b)=>a[0]-b[0]).slice(0,8)){
   const candidates=[...cells].map(([c,cell])=>[c,month(cell)]).filter(([,m])=>m!==null);
   if(candidates.length>=2){headings=candidates;headerRow=r;break;}
  }
  if(!headings){if(table.rows.size)issue('unmapped_sheet',provenance(table,0),{reason:'No unambiguous monthly headers; native rows/cells retained'});continue;}
  for(const [r,cells]of table.rows){if(r<=headerRow)continue;
   const label=[...cells].filter(([c,cell])=>c<headings[0][0]&&typeof scalar(cell)==='string').map(([,cell])=>scalar(cell)).find(nonblank);
   if(!label)continue;
   for(const [c,period]of headings){const cell=cells.get(c),value=scalar(cell);if(typeof value!=='number')continue;
    const currency=/₺|TRY|TL/.test(cell?.effectiveFormat?.numberFormat?.pattern??cell?.userEnteredFormat?.numberFormat?.pattern??'')?'TRY':null;
    add('budget_observations',{id:stableId(tenantId,'observation',table.source_key,table.properties.sheetId,r,c),tenant_id:tenantId,kind:'budget_observation',label,period,value:{decimal:decimal(value),currency},basis:/gerçekleşen/i.test(table.properties.title)?'recorded_aggregate':/plan/i.test(table.properties.title)?'planned':'unclassified',payment_evidence:false,provenance:provenance(table,r,c)},`${table.source_key}/${table.properties.sheetId}`);
   }
  }
 }
 // Repeated references and identical issues are idempotent, not duplicate business records.
 for(const record of new Map(issues.map(i=>[i.id,i])).values())add('issues',record,record.provenance?.source_key??'global');
 for(const [collection,entries]of collections)collections.set(collection,[...new Map(entries.map(e=>[e.record.id,e])).values()]);
 return collections;
}
