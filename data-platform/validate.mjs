import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { canonical, sha256, isoDate } from './core.mjs';
const vocabularies=JSON.parse(await readFile(new URL('./dictionaries/vocabularies.json',import.meta.url),'utf8'));
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const decimal=/^-?\d+(?:\.\d+)?$/;
export const allowedCollections=new Set(['sources','sheets','source_cells','source_rows','supplements','settings','rooms','purchase_needs','lighting_specs','work_orders','layout_items','providers','inspections','automation_scenes','milestones','unclassified_items','payments','relations','media_references','budget_observations','forecasts','forecast_events','forecast_months','vocabularies','terms','workflows','view_definitions','task_templates','issues']);
function fail(message){throw new Error(`Generation validation: ${message}`);}
function money(v){if(v!==null&&(!v||typeof v.amount!=='string'||!decimal.test(v.amount)||! /^[A-Z]{3}$/.test(v.currency)))fail('Invalid decimal money/currency');}
function recordShape(r,tenantId,collection){
 if(!r||!uuid.test(r.id)||r.tenant_id!==tenantId)fail('Invalid id or tenant_id');
 if(r.provenance){const p=r.provenance;if(!uuid.test(p.source_id)||!Number.isInteger(p.row)||p.row<1||!Number.isInteger(p.sheet_id)||typeof p.a1!=='string'||(p.column!==null&&(!Number.isInteger(p.column)||p.column<1)))fail('Invalid provenance');}
 if(Object.hasOwn(r,'amount'))money(r.amount);
 if(r.amounts)for(const v of Object.values(r.amounts))money(v);
 if(r.measures)for(const v of Object.values(r.measures))money(v);
 if(r.cash_change)money(r.cash_change);
 if(Object.hasOwn(r,'occurred_on')&&r.occurred_on!==null&&!isoDate(r.occurred_on))fail('Invalid ISO date');
 if(r.dates)for(const v of Object.values(r.dates))if(v!==null&&!isoDate(v))fail('Invalid ISO date');
 if(r.state_snapshot)for(const [axis,value]of Object.entries(r.state_snapshot))if(value!==null&&!Object.hasOwn(vocabularies[`${axis}_state`]??{},value))fail('Invalid state vocabulary');
 if(collection==='budget_observations'&&(!decimal.test(r.value?.decimal)||!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(r.period)))fail('Invalid observation value/period');
 if(collection==='payments'&&(r.record_basis!=='user_recorded_payment'||r.evidence_status!=='not_supplied'))fail('Unsupported payment evidence claim');
 if(['forecasts','forecast_events','forecast_months'].includes(collection)&&r.record_basis!=='forecast')fail('Forecast cannot claim an actual transaction');
 if(collection==='forecast_months'&&!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(r.period))fail('Invalid forecast period');
 if(collection==='task_templates'&&r.status!=='proposed_template')fail('Task template cannot claim actual task state');
}
export async function validateGeneration(directory){
 const root=await realpath(directory),manifest=JSON.parse(await readFile(path.join(root,'manifest.json'),'utf8'));
 if(manifest.schemaVersion!==1||!uuid.test(manifest.tenant_id)||!Array.isArray(manifest.files)||manifest.storage_policy!=='private_only'||manifest.consistency!=='snapshot_capture_not_transaction')fail('Invalid manifest');
 const ids=new Map(),references=[],parents=new Map(),filePaths=new Set(),counts={},typedRelations=[],forecastReferences=[],states=[],terms=new Map(),vocabularyKeys=new Map(),typedReferences=[],taskDependencies=new Map(),mediaTargets=[],workflowEdges=[];
 for(const file of manifest.files){
  if(!['raw','schema','partition','contract'].includes(file.kind))fail('Unknown file kind');
  if(typeof file.path!=='string'||path.isAbsolute(file.path)||filePaths.has(file.path))fail('Duplicate or invalid file path');filePaths.add(file.path);
  const resolved=await realpath(path.resolve(root,file.path));if(!resolved.startsWith(`${root}${path.sep}`))fail('File path escapes generation');
  const bytes=await readFile(resolved);if(bytes.length!==file.bytes||sha256(bytes)!==file.sha256)fail(`Hash/bytes mismatch: ${file.path}`);
  if(file.kind!=='partition')continue;
  const envelope=JSON.parse(bytes.toString('utf8'));
  if(envelope.schemaVersion!==1||!allowedCollections.has(envelope.collection)||envelope.collection!==file.collection||!Array.isArray(envelope.records)||envelope.records.length!==file.count)fail('Invalid partition schema/count');
  counts[envelope.collection]=(counts[envelope.collection]??0)+envelope.records.length;
  for(const r of envelope.records){
   recordShape(r,manifest.tenant_id,envelope.collection);
   if(ids.has(r.id))fail(`Duplicate id: ${r.id}`);ids.set(r.id,envelope.collection);
   if(envelope.collection==='relations')typedRelations.push(r);
   if(envelope.collection==='terms')terms.set(r.id,r);
   if(envelope.collection==='vocabularies')vocabularyKeys.set(r.id,r.key);
   if(envelope.collection==='task_templates')taskDependencies.set(r.id,r.dependency_template_ids);
   if(envelope.collection==='media_references')mediaTargets.push(r.entity_id);
   if(envelope.collection==='workflows')for(const transition of r.transitions??[])workflowEdges.push({transition,vocabulary_id:r.vocabulary_id});
   if(r.state_snapshot)states.push(r);
   if(['forecast_events','forecast_months'].includes(envelope.collection))forecastReferences.push(r.forecast_id);
   const ref=value=>{if(value!==null&&value!==undefined){if(!uuid.test(value))fail('Invalid foreign key UUID');references.push(value);}};
   for(const key of ['source_id','target_id','room_id','setting_id','vocabulary_id','parent_id','entity_id','category_term_id','phase_term_id','legacy_status_term_id','funding_source_id','payment_method_term_id','account_id','forecast_id','workflow_id'])ref(r[key]);
   if(r.provenance)ref(r.provenance.source_id);
   const typed=(id,targetCollection,vocabulary=null)=>{if(id!==null&&id!==undefined)typedReferences.push({id,targetCollection,vocabulary});};
   if(envelope.collection!=='relations')typed(r.source_id,'sources');
   if(r.provenance)typed(r.provenance.source_id,'sources');
   for(const [key,targetCollection]of Object.entries({room_id:'rooms',setting_id:'settings',vocabulary_id:'vocabularies',parent_id:'terms',funding_source_id:'funding_sources',account_id:'accounts',workflow_id:'workflows'}))typed(r[key],targetCollection);
   for(const [key,vocabulary]of Object.entries({category_term_id:'category',phase_term_id:'phase',legacy_status_term_id:'legacy_status',payment_method_term_id:'payment_method'}))typed(r[key],'terms',vocabulary);
   for(const id of r.context_term_ids??[])typed(id,'terms','life_context');
   for(const id of r.cell_ids??[])typed(id,'source_cells');
   for(const id of r.dependency_template_ids??[]){ref(id);typed(id,'task_templates');}
   for(const id of r.cell_ids??[])ref(id);
   for(const id of r.context_term_ids??[])ref(id);
   for(const id of Object.values(r.state_term_ids??{}))ref(id);
   for(const edge of r.transitions??[]){ref(edge.from_term_id);ref(edge.to_term_id);}
   if(envelope.collection==='terms'&&r.parent_id)parents.set(r.id,r.parent_id);
  }
 }
 for(const id of references)if(!ids.has(id))fail(`Dangling reference: ${id}`);
 for(const {transition,vocabulary_id}of workflowEdges)for(const key of ['from_term_id','to_term_id'])if(terms.get(transition[key])?.vocabulary_id!==vocabulary_id)fail('Workflow transition term belongs to another vocabulary');
 for(const {id,targetCollection,vocabulary}of typedReferences){
  if(ids.get(id)!==targetCollection)fail('Foreign key target collection mismatch');
  if(vocabulary&&vocabularyKeys.get(terms.get(id)?.vocabulary_id)!==vocabulary)fail('Foreign key vocabulary mismatch');
 }
 for(const [id,parent]of parents)if(terms.get(id)?.vocabulary_id!==terms.get(parent)?.vocabulary_id)fail('Parent term belongs to another vocabulary');
 const visitedTasks=new Set(),activeTasks=new Set();
 const visitTask=id=>{if(activeTasks.has(id))fail('Task template dependency cycle');if(visitedTasks.has(id))return;activeTasks.add(id);for(const target of taskDependencies.get(id)??[])visitTask(target);activeTasks.delete(id);visitedTasks.add(id);};
 for(const id of taskDependencies.keys())visitTask(id);
 for(const id of forecastReferences)if(ids.get(id)!=='forecasts')fail('Invalid forecast foreign key target');
 for(const r of states)for(const [axis,code]of Object.entries(r.state_snapshot)){
  const id=r.state_term_ids?.[axis],term=terms.get(id);
  if(code===null?id!==null:!term||term.code!==code||vocabularyKeys.get(term.vocabulary_id)!==`${axis}_state`)fail('State taxonomy term mismatch');
 }
 const itemCollections=new Set(['purchase_needs','lighting_specs','work_orders','layout_items','providers','inspections','automation_scenes','milestones','unclassified_items']);
 for(const id of mediaTargets)if(!itemCollections.has(ids.get(id)))fail('Media entity target must be a domain item');
 for(const r of typedRelations){
  const source=ids.get(r.source_id),target=ids.get(r.target_id);
  const valid=r.kind==='payment_for'?source==='payments'&&itemCollections.has(target):r.kind==='located_in'?itemCollections.has(source)&&target==='rooms':['associated_with','depends_on'].includes(r.kind)&&itemCollections.has(source)&&itemCollections.has(target);
  if(!valid)fail('Invalid typed relation target/source');
 }
 for(const id of parents.keys()){const seen=new Set([id]);for(let parent=parents.get(id);parent;parent=parents.get(parent)){if(seen.has(parent))fail('Category hierarchy cycle');seen.add(parent);}}
 if(canonical(counts)!==canonical(manifest.counts))fail('Manifest record counts differ');
 const digest=sha256(canonical({schemaVersion:manifest.schemaVersion,tenant_id:manifest.tenant_id,files:manifest.files,sources:manifest.sources}));
 if(digest!==manifest.generation_id)fail('Generation content hash differs');
 return {valid:true,generationId:manifest.generation_id,files:manifest.files.length,counts};
}
export async function readCollection(directory,collection){
 const manifest=JSON.parse(await readFile(path.join(directory,'manifest.json'),'utf8')),records=[];
 for(const file of manifest.files.filter(f=>f.collection===collection))records.push(...JSON.parse(await readFile(path.join(directory,file.path),'utf8')).records);
 return records;
}
