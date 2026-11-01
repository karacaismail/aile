import { readFile } from 'node:fs/promises';
import { stableId } from './core.mjs';
const dictionary=JSON.parse(await readFile(new URL('./dictionaries/vocabularies.json',import.meta.url),'utf8'));
const categories=JSON.parse(await readFile(new URL('./dictionaries/categories.json',import.meta.url),'utf8'));
const views=JSON.parse(await readFile(new URL('./dictionaries/views.json',import.meta.url),'utf8'));
const taskDictionary=JSON.parse(await readFile(new URL('./dictionaries/task-templates.json',import.meta.url),'utf8'));
export function createTaxonomy(tenantId) {
 const vocabularies=[],terms=[],workflows=[],termIndex=new Map();
 const vocabulary=(key)=>{const id=stableId(tenantId,'vocabulary',key);vocabularies.push({id,tenant_id:tenantId,key,managed:true});return id;};
 for(const [key,values]of Object.entries(dictionary)){
  const vocabulary_id=vocabulary(key);
  for(const [code,label]of Object.entries(values)){
   const id=stableId(tenantId,'term',key,code);termIndex.set(`${key}:${code}`,id);
   terms.push({id,tenant_id:tenantId,vocabulary_id,code,label,parent_id:null,legacy:false});
  }
 }
 const categoryVocabulary=vocabulary('category');
 for(const [code,label,parent]of categories){
  const id=stableId(tenantId,'term','category',code);termIndex.set(`category:${code}`,id);
  terms.push({id,tenant_id:tenantId,vocabulary_id:categoryVocabulary,code,label,parent_id:parent?stableId(tenantId,'term','category',parent):null,legacy:false});
 }
 const definitions={
  decision:[['idea','researching'],['researching','pending'],['pending','decided'],['decided','researching'],['idea','cancelled'],['researching','cancelled'],['pending','cancelled'],['decided','cancelled']],
  fulfillment:[['planned','ordered'],['ordered','delivered'],['delivered','installed'],['ordered','cancelled'],['delivered','ordered']],
  inspection:[['pending','completed'],['completed','pending']],
  payment:[['planned','partially_paid'],['planned','paid'],['partially_paid','paid'],['paid','reversed']],
  task:[['open','in_progress'],['in_progress','blocked'],['blocked','in_progress'],['in_progress','done'],['done','open'],['open','cancelled']],
  provider:[['searching','shortlisted'],['shortlisted','selected'],['selected','contracted'],['selected','searching']],
 };
 for(const [key,transitions]of Object.entries(definitions)){
  workflows.push({id:stableId(tenantId,'workflow',key),tenant_id:tenantId,key,version:1,status:'proposed_template',vocabulary_id:stableId(tenantId,'vocabulary',`${key}_state`),transitions:transitions.map(([from,to])=>({from_term_id:termIndex.get(`${key}_state:${from}`),to_term_id:termIndex.get(`${key}_state:${to}`),requires_evidence:['payment','inspection'].includes(key)}))});
 }
 const view_definitions=views.map(view=>({id:stableId(tenantId,'view',view.key),tenant_id:tenantId,...view,version:1,status:'proposed_template'}));
 if(new Set(taskDictionary.templates.map(t=>t.id)).size!==taskDictionary.templates.length)throw new Error('Duplicate task template key');
 const task_templates=taskDictionary.templates.map(template=>({...template,id:stableId(tenantId,'task_template',template.id),tenant_id:tenantId,key:template.id,kind:'task_template',version:1,workflow_id:stableId(tenantId,'workflow',template.workflow_key),dependency_template_ids:template.dependencies.map(key=>stableId(tenantId,'task_template',key)),dependency_policy:taskDictionary.dependency_policy,guard_policy:taskDictionary.guard_policy}));
 return {vocabularies,terms,workflows,view_definitions,task_templates,termIndex};
}
