import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { convertSnapshot, validateGeneration, stableId, readCollection, canonical } from './index.mjs';

const value = (v) => v === null ? {} : { userEnteredValue: typeof v === 'number' ? { numberValue: v } : typeof v === 'boolean' ? { boolValue: v } : { stringValue: v }, effectiveValue: typeof v === 'number' ? { numberValue: v } : typeof v === 'boolean' ? { boolValue: v } : { stringValue: v } };
const grid = (sheetId,title,rows,startRow=0) => ({ properties:{sheetId,title},data:[{startRow,startColumn:0,rowData:rows.map(r=>({values:r.map(v=>v && typeof v==='object'?v:value(v))}))}] });
async function fixture() {
 const base=await mkdtemp(path.join(tmpdir(),'aile-json-'));
 await mkdir(path.join(base,'raw'));
 const metadata={spreadsheetId:'synthetic-book',properties:{locale:'tr_TR',timeZone:'Europe/Istanbul'},sheets:[{properties:{sheetId:1,title:'app_kalemler',gridProperties:{rowCount:20,columnCount:20}}},{properties:{sheetId:2,title:'app_ayarlar'}},{properties:{sheetId:3,title:'app_nakit'}},{properties:{sheetId:4,title:'Plan'}}]};
 const sheets=[grid(1,'app_kalemler',[
 ['id','tip','ad','oda','kategori','faz','durum','tahmini_tl_min','gercek_tl','bagli_idler','kod','bagimlilik','updated_at','version','tamam'],
 ['item-a','satinalma','Synthetic cup','mutfak','mutfak_sofra','3','teslim',0,null,'item-b','CUP',null,'2026-11-01T10:00:00Z',1,false],
 ['item-b','aydinlatma','Synthetic light','mutfak','aydinlatma_led','2','karar',125.25,null,null,'LIGHT','CUP','2026-11-01T10:00:00Z',1,false]
 ]),grid(2,'app_ayarlar',[['id','tip','anahtar','deger','etiket','updated_at','version'],['room-a','oda','mutfak','{"en":300}','Mutfak','2026-11-01T10:00:00Z',1]]),grid(3,'app_nakit',[['id','tarih','tutar','kalem','kalem_id','updated_at','version'],['cash-a','2026-11-01',125.25,'Synthetic payment','item-a','2026-11-01T10:00:00Z',1]]),grid(4,'Plan',[
 ['Kalem','2026-11-01','Not'],['Synthetic projection',{userEnteredValue:{formulaValue:'=NA()'},effectiveValue:{errorValue:{type:'N_A',message:'Synthetic error'}},formattedValue:'#N/A',note:'Keep note'},false]
 ])];
 const manifest={schemaVersion:1,sources:[{key:'household',metadata:'raw/meta.json',chunks:['raw/one.json','raw/two.json'],startedAt:'2026-11-01T10:00:00Z',completedAt:'2026-11-01T10:01:00Z'}]};
 await writeFile(path.join(base,'raw/meta.json'),JSON.stringify(metadata));
 await writeFile(path.join(base,'raw/one.json'),JSON.stringify({spreadsheetId:'synthetic-book',sheets:sheets.slice(0,2)}));
 await writeFile(path.join(base,'raw/two.json'),JSON.stringify({spreadsheetId:'synthetic-book',sheets:sheets.slice(2)}));
 await writeFile(path.join(base,'source-manifest.json'),JSON.stringify(manifest));
 return {base,manifest,sheets,metadata,manifestPath:path.join(base,'source-manifest.json'),outputRoot:path.join(base,'private-output'),tenantKey:'synthetic-family'};
}
async function convert(f){return convertSnapshot(f);}

test('native formulas/errors/notes/false/zero survive and domain facts remain conservative',async()=>{
 const f=await fixture(), result=await convert(f);
 const purchases=await readCollection(result.directory,'purchase_needs');
 assert.equal(purchases[0].amounts.estimated_min.amount,'0');
 assert.equal(purchases[0].amounts.recorded_price,null);
 assert.equal(purchases[0].source_attributes.tamam,false);
 assert.equal(purchases[0].phase_term_id,null);
 assert.ok(purchases[0].context_term_ids.length===1);
 assert.equal(purchases[0].state_snapshot.fulfillment,'delivered');
 assert.equal(purchases[0].state_snapshot.payment,null);
 const payments=await readCollection(result.directory,'payments');
 assert.equal(payments.length,1);assert.equal(payments[0].amount.amount,'125.25');
 assert.equal(payments[0].funding_source_id,null);assert.equal(payments[0].payment_method_term_id,null);
 const cells=await readCollection(result.directory,'source_cells');
 const error=cells.find(c=>c.cell.effectiveValue?.errorValue);
 assert.equal(error.cell.userEnteredValue.formulaValue,'=NA()');assert.equal(error.cell.note,'Keep note');
 assert.ok((await readCollection(result.directory,'issues')).some(i=>i.code==='formula_error'));
 assert.equal((await validateGeneration(result.directory)).valid,true);
});

test('IDs, file bytes and generation hash are stable when chunk order changes',async()=>{
 const f=await fixture(), first=await convert(f);
 f.manifest.sources[0].chunks.reverse();await writeFile(f.manifestPath,JSON.stringify(f.manifest));
 const second=await convert(f);assert.equal(first.generationId,second.generationId);
 assert.deepEqual(await readFile(path.join(first.directory,'manifest.json')),await readFile(path.join(second.directory,'manifest.json')));
 assert.match(stableId('tenant','entity'),/^[a-f0-9-]{36}$/);
 assert.notEqual(stableId('tenant','entity'),stableId('another-tenant','entity'));
});

test('duplicate source record IDs reject publication without a partial generation',async()=>{
 const f=await fixture();f.sheets[0].data[0].rowData.push(f.sheets[0].data[0].rowData[1]);
 await writeFile(path.join(f.base,'raw/one.json'),JSON.stringify({spreadsheetId:'synthetic-book',sheets:f.sheets.slice(0,2)}));
 await assert.rejects(convert(f),/duplicate.*id/i);
 assert.equal((await readdir(f.outputRoot).catch(()=>[])).filter(n=>n.startsWith('.staging')).length,0);
});

test('missing and ambiguous relations are issues rather than guessed foreign keys',async()=>{
 const f=await fixture();f.sheets[0].data[0].rowData[1].values[9]=value('missing');
 await writeFile(path.join(f.base,'raw/one.json'),JSON.stringify({spreadsheetId:'synthetic-book',sheets:f.sheets.slice(0,2)}));
 const result=await convert(f), issues=await readCollection(result.directory,'issues');
 assert.ok(issues.some(i=>i.code==='unresolved_relation'));
 assert.ok(!(await readCollection(result.directory,'relations')).some(r=>r.target_id==='missing'));
});

test('wrong workbook, conflicting overlaps and invalid dates fail or surface without false facts',async()=>{
 const f=await fixture();await writeFile(path.join(f.base,'raw/two.json'),JSON.stringify({spreadsheetId:'wrong-book',sheets:[]}));
 await assert.rejects(convert(f),/workbook/i);
 const g=await fixture();g.sheets[2].data[0].rowData[1].values[1]=value('2026-02-31');
 await writeFile(path.join(g.base,'raw/two.json'),JSON.stringify({spreadsheetId:'synthetic-book',sheets:g.sheets.slice(2)}));
 const result=await convert(g);
 assert.equal((await readCollection(result.directory,'payments'))[0].occurred_on,null);
 assert.ok((await readCollection(result.directory,'issues')).some(i=>i.code==='invalid_date'));
});

test('private output rejects git trees and symlink aliases to public trees',async()=>{
 const f=await fixture(), repo=path.join(f.base,'repo');await mkdir(repo);await mkdir(path.join(repo,'.git'));await mkdir(path.join(repo,'public'));
 await assert.rejects(convert({...f,outputRoot:path.join(repo,'exports')}),/private.*output|git/i);
 await symlink(path.join(repo,'public'),path.join(f.base,'public-alias'));
 await assert.rejects(convert({...f,outputRoot:path.join(f.base,'public-alias','exports')}),/private.*output|git/i);
});

test('validator rejects tampering, duplicates and dangling references after integrity hashes are updated',async()=>{
 const f=await fixture(), result=await convert(f), manifest=JSON.parse(await readFile(path.join(result.directory,'manifest.json'),'utf8'));
 const file=manifest.files.find(p=>p.collection==='payments');await writeFile(path.join(result.directory,file.path),'{}');
 await assert.rejects(validateGeneration(result.directory),/hash|bytes/i);
});

test('raw input archive is byte-identical and missing sources are never fabricated',async()=>{
 const f=await fixture(), result=await convert(f), manifest=JSON.parse(await readFile(path.join(result.directory,'manifest.json'),'utf8'));
 const raw=manifest.files.filter(p=>p.kind==='raw');
 const original=await readFile(path.join(f.base,'raw/one.json'));
 assert.ok((await Promise.all(raw.map(p=>readFile(path.join(result.directory,p.path))))).some(b=>b.equals(original)));
 assert.ok(!manifest.sources.some(s=>s.key==='budget'));
});

test('canonical encoding is deterministic and cannot hide non-finite values',()=>{
 assert.equal(canonical({z:0,a:false}),'{"a":false,"z":0}\n');
 assert.throws(()=>canonical({amount:NaN}),/finite/i);
});

async function rewritePartition(result,collection,mutate) {
 const { createHash }=await import('node:crypto');const hash=v=>createHash('sha256').update(v).digest('hex');
 const location=path.join(result.directory,'manifest.json'),manifest=JSON.parse(await readFile(location,'utf8'));
 const file=manifest.files.find(f=>f.collection===collection),filePath=path.join(result.directory,file.path),part=JSON.parse(await readFile(filePath,'utf8'));
 mutate(part.records);const bytes=canonical(part);await writeFile(filePath,bytes);file.sha256=hash(bytes);file.bytes=Buffer.byteLength(bytes);file.count=part.records.length;
 manifest.counts[collection]=manifest.files.filter(f=>f.collection===collection).reduce((n,f)=>n+f.count,0);
 manifest.generation_id=hash(canonical({schemaVersion:manifest.schemaVersion,tenant_id:manifest.tenant_id,files:manifest.files,sources:manifest.sources}));
 await writeFile(location,canonical(manifest));
}
test('deep validator rejects duplicate record IDs even with self-consistent hashes',async()=>{
 const f=await fixture(),result=await convert(f);await rewritePartition(result,'payments',records=>records.push(records[0]));
 await assert.rejects(validateGeneration(result.directory),/duplicate id/i);
});
test('deep validator rejects dangling and wrong-target typed relations',async()=>{
 const f=await fixture(),result=await convert(f);await rewritePartition(result,'relations',records=>{records[0].target_id=stableId('missing');});
 await assert.rejects(validateGeneration(result.directory),/dangling/i);
 const g=await fixture(),other=await convert(g),vocab=(await readCollection(other.directory,'vocabularies'))[0];
 await rewritePartition(other,'relations',records=>{records[0].target_id=vocab.id;});
 await assert.rejects(validateGeneration(other.directory),/relation target|typed relation/i);
});
test('deep validator rejects invalid workflow values and malformed decimal currency',async()=>{
 const f=await fixture(),result=await convert(f);await rewritePartition(result,'purchase_needs',records=>{records[0].state_snapshot.fulfillment='paid';});
 await assert.rejects(validateGeneration(result.directory),/state/i);
 const g=await fixture(),other=await convert(g);await rewritePartition(other,'payments',records=>{records[0].amount.amount='125,25';});
 await assert.rejects(validateGeneration(other.directory),/decimal/i);
});
test('declared capture bounds are verified and source revision evidence is preserved',async()=>{
 const f=await fixture();f.manifest.sources[0].bounds=[{chunk:'raw/one.json',sheetId:1,startRow:0,endRow:20,startColumn:0,endColumn:20}];
 await writeFile(f.manifestPath,JSON.stringify(f.manifest));await assert.rejects(convert(f),/bounds|coverage/i);
});
test('input paths cannot escape snapshot root and output has no UI dependency',async()=>{
 const f=await fixture();f.manifest.sources[0].metadata='../outside.json';await writeFile(f.manifestPath,JSON.stringify(f.manifest));await assert.rejects(convert(f));
 // Build-time adapters may compile existing pure domain validators; runtime files must be independent.
 for(const name of (await readdir(new URL('.',import.meta.url))).filter(n=>n.endsWith('.mjs')&&!n.endsWith('.test.mjs')&&!n.startsWith('build-'))){
  const code=await readFile(new URL(name,import.meta.url),'utf8');assert.ok(!/from ['"](?:react|@mantine|antd|bootstrap|.*src\/)/.test(code));
 }
});
test('product reference URLs retain commas and are not mistaken for verified product photos',async()=>{
 const f=await fixture(),rows=f.sheets[0].data[0].rowData;
 rows[0].values.push(value('linkler'));rows[1].values.push(value('https://example.test/product,123.html\nhttps://example.test/photo.jpg'));
 await writeFile(path.join(f.base,'raw/one.json'),JSON.stringify({spreadsheetId:'synthetic-book',sheets:f.sheets.slice(0,2)}));
 const result=await convert(f),media=await readCollection(result.directory,'media_references');
 assert.equal(media.length,2);assert.ok(media.some(m=>m.url==='https://example.test/product,123.html'&&m.kind==='web_reference'));
 assert.ok(media.every(m=>m.verification==='not_verified'));assert.ok(!(await readCollection(result.directory,'issues')).some(i=>i.code==='invalid_link'));
});
test('private output rejects a public symlink that points out to private storage',async()=>{
 const f=await fixture();await mkdir(path.join(f.base,'public'));await mkdir(path.join(f.base,'private-target'));await symlink(path.join(f.base,'private-target'),path.join(f.base,'public','alias'));
 await assert.rejects(convert({...f,outputRoot:path.join(f.base,'public','alias','exports')}),/private.*output|public/i);
});
test('changed source revision prevents publishing a mixed capture',async()=>{
 const f=await fixture();f.manifest.sources[0].driveBefore={modified_time:'2026-11-01T10:00:00Z'};f.manifest.sources[0].driveAfter={modified_time:'2026-11-01T10:01:00Z'};
 await writeFile(f.manifestPath,JSON.stringify(f.manifest));await assert.rejects(convert(f),/revision|changed/i);
});
test('derived monthly sheets are retained as raw source rather than duplicate budget facts',async()=>{
 const f=await fixture();f.metadata.sheets.push({properties:{sheetId:5,title:'_Derived'}});await writeFile(path.join(f.base,'raw/meta.json'),JSON.stringify(f.metadata));
 await writeFile(path.join(f.base,'raw/two.json'),JSON.stringify({spreadsheetId:'synthetic-book',sheets:[f.sheets[2],grid(4,'Plan',[['Kalem','2026-11','2026-12'],['Synthetic plan',20,30]]),grid(5,'_Derived',[['Kalem','2026-11','2026-12'],['Synthetic copy',20,30]])]}));
 const result=await convert(f),observations=await readCollection(result.directory,'budget_observations');assert.equal(observations.length,2);assert.ok(observations.every(o=>o.provenance.sheet_title==='Plan'));
});
test('Drive camelCase revisions and version changes also reject mixed snapshots',async()=>{
 const f=await fixture();f.manifest.sources[0].driveBefore={modifiedTime:'2026-11-01T10:00:00Z',version:'1'};f.manifest.sources[0].driveAfter={modifiedTime:'2026-11-01T10:00:00Z',version:'2'};
 await writeFile(f.manifestPath,JSON.stringify(f.manifest));await assert.rejects(convert(f),/revision|changed/i);
});
test('all six framework-neutral view definitions are versioned data with explicit eligibility',async()=>{
 const f=await fixture(),result=await convert(f),views=await readCollection(result.directory,'view_definitions');
 assert.deepEqual(views.map(v=>v.key).sort(),['gantt_chart','kanban','listing','pivot','table','timeline']);
 assert.ok(views.every(v=>v.version===1&&v.status==='proposed_template'&&Array.isArray(v.required_fields)));
 assert.match(views.find(v=>v.key==='pivot').aggregation.ownership_rule,/leaf-row/);
});
test('portable JSON schemas parse and decimal strings match the exported pattern',async()=>{
 for(const name of ['partition','manifest','source-manifest']){
  const schema=JSON.parse(await readFile(new URL(`./schemas/${name}.schema.json`,import.meta.url),'utf8'));assert.equal(schema.$schema,'https://json-schema.org/draft/2020-12/schema');
  if(name==='partition'){const pattern=new RegExp(schema.$defs.decimal.pattern);assert.ok(pattern.test('12.34'));assert.ok(pattern.test('-0.25'));assert.ok(!pattern.test('12,34'));assert.ok(!pattern.test('12x34'));}
 }
});
test('state snapshots reference taxonomy terms and end dates do not assert actual completion',async()=>{
 const f=await fixture(),rows=f.sheets[0].data[0].rowData;rows[0].values.push(value('bitis_tarihi'));rows[1].values.push(value('2026-12-01'));
 await writeFile(path.join(f.base,'raw/one.json'),JSON.stringify({spreadsheetId:'synthetic-book',sheets:f.sheets.slice(0,2)}));
 const result=await convert(f),item=(await readCollection(result.directory,'purchase_needs'))[0],terms=await readCollection(result.directory,'terms');
 assert.equal(terms.find(t=>t.id===item.state_term_ids?.fulfillment)?.code,'delivered');assert.equal(item.dates.end_on,'2026-12-01');assert.equal(Object.hasOwn(item.dates,'completed_on'),false);
 const wrong=terms.find(t=>t.code==='mutfak_sofra');await rewritePartition(result,'purchase_needs',records=>{records[0].state_term_ids.fulfillment=wrong.id;});
 await assert.rejects(validateGeneration(result.directory),/state.*term|taxonomy.*state/i);
});
test('FALSE template rows create no records, but TRUE state without identity is diagnosed',async()=>{
 const f=await fixture(),rows=f.sheets[0].data[0].rowData;
 rows.push({values:Array.from({length:15},(_,i)=>value(i===14?false:null))});rows.push({values:Array.from({length:15},(_,i)=>value(i===14?true:null))});
 await writeFile(path.join(f.base,'raw/one.json'),JSON.stringify({spreadsheetId:'synthetic-book',sheets:f.sheets.slice(0,2)}));
 const result=await convert(f),issues=await readCollection(result.directory,'issues');assert.equal((await readCollection(result.directory,'purchase_needs')).length,1);assert.equal(issues.filter(i=>i.code==='missing_record_id').length,1);
});
test('missing known app identity headers reject normalization instead of silently dropping records',async()=>{
 const f=await fixture();f.sheets[0].data[0].rowData[0].values[0]=value('wrong_id');
 await writeFile(path.join(f.base,'raw/one.json'),JSON.stringify({spreadsheetId:'synthetic-book',sheets:f.sheets.slice(0,2)}));await assert.rejects(convert(f),/header/i);
});
test('publication cannot follow an existing generations symlink into a public or private target',async()=>{
 for(const publicTarget of [true,false]){
  const f=await fixture();await mkdir(f.outputRoot);const destination=path.join(f.base,publicTarget?'public':'private-external');await mkdir(destination);await symlink(destination,path.join(f.outputRoot,'generations'));
  await assert.rejects(convert(f),/publication|symlink|private.*output/i);assert.deepEqual(await readdir(destination),[]);
 }
});
test('direct foreign keys enforce target kind and vocabulary after hashes are recomputed',async()=>{
 for(const field of ['category_term_id','phase_term_id','room_id']){
  const f=await fixture(),result=await convert(f),term=(await readCollection(result.directory,'terms')).find(t=>t.code==='delivered');
  await rewritePartition(result,'purchase_needs',records=>{records[0][field]=term.id;});await assert.rejects(validateGeneration(result.directory),/foreign key|target|vocabulary/i);
 }
 const f=await fixture(),result=await convert(f),terms=await readCollection(result.directory,'terms'),other=terms.find(t=>t.code==='delivered');
 await rewritePartition(result,'terms',records=>{records.find(t=>t.code==='mutfak_sofra').parent_id=other.id;});await assert.rejects(validateGeneration(result.directory),/parent|vocabulary/i);
});
test('duplicate supplemental keys fail and distinct classifications remain intact',async()=>{
 const f=await fixture();await writeFile(path.join(f.base,'raw/a.json'),'{"value":"first"}');await writeFile(path.join(f.base,'raw/b.json'),'{"value":"other"}');
 f.manifest.supplements=[{key:'notes',path:'raw/a.json',classification:'sheets_comments'},{key:'notes',path:'raw/b.json',classification:'historical_settings'}];await writeFile(f.manifestPath,JSON.stringify(f.manifest));
 await assert.rejects(convert(f),/duplicate supplement/i);
 f.manifest.supplements[1].key='settings';await writeFile(f.manifestPath,JSON.stringify(f.manifest));
 const result=await convert(f),supplements=await readCollection(result.directory,'supplements');assert.deepEqual(supplements.map(s=>s.classification).sort(),['historical_settings','sheets_comments']);
});
test('forecast views preserve projected date basis and exclude balances from additive pivot',async()=>{
 const f=await fixture(),result=await convert(f),views=await readCollection(result.directory,'view_definitions'),byKey=Object.fromEntries(views.map(v=>[v.key,v]));
 for(const mode of ['listing','table','timeline'])assert.ok(byKey[mode].supported_kinds.includes('forecast_event'));
 assert.ok(byKey.table.supported_kinds.includes('forecast_month'));assert.equal(byKey.table.primary_field_by_kind.forecast_month,'period');
 assert.equal(byKey.timeline.date_field_by_kind.forecast_event,'occurred_on');assert.equal(byKey.timeline.date_basis_by_kind.forecast_event,'forecast');
 assert.ok(!byKey.pivot.supported_kinds.includes('forecast_month'));assert.ok(!byKey.pivot.supported_kinds.includes('forecast_event'));
});
test('proposed task templates retain dependency IDs and do not create actual tasks',async()=>{
 const f=await fixture(),result=await convert(f),templates=await readCollection(result.directory,'task_templates');assert.ok(templates.length>=10);
 assert.ok(templates.every(t=>t.status==='proposed_template'&&t.workflow_id&&Array.isArray(t.dependency_template_ids)));
 assert.deepEqual(await readCollection(result.directory,'tasks'),[]);
 const room=(await readCollection(result.directory,'rooms'))[0];await rewritePartition(result,'task_templates',records=>{records[0].dependency_template_ids=[room.id];});await assert.rejects(validateGeneration(result.directory),/foreign key|target/i);
 const g=await fixture(),other=await convert(g);await rewritePartition(other,'task_templates',records=>{records[0].dependency_template_ids=[records[1].id];records[1].dependency_template_ids=[records[0].id];});await assert.rejects(validateGeneration(other.directory),/cycle/i);
});
test('a generation embeds its hashed PostgreSQL mapping contract',async()=>{
 const f=await fixture(),result=await convert(f),manifest=JSON.parse(await readFile(path.join(result.directory,'manifest.json'),'utf8'));
 const file=manifest.files.find(f=>f.path==='contracts/postgres-mapping.json');assert.equal(file?.kind,'contract');
 assert.deepEqual(await readFile(path.join(result.directory,file.path)),await readFile(new URL('./postgres-mapping.json',import.meta.url)));
});
test('PostgreSQL supplement classification mapping accepts source labels and only defaults absent labels',async()=>{
 const mapping=JSON.parse(await readFile(new URL('./postgres-mapping.json',import.meta.url),'utf8'));
 const field=mapping.collections.find(c=>c.collection==='supplements').fields.find(f=>f.source_path==='classification'),policy=field.source_value_policy;
 assert.equal(policy?.mode,'preserve');assert.equal(policy.allowed_values,null);assert.equal(policy.default_when_missing,'external_catalog_or_configuration');
 const f=await fixture(),classifications=['google_sheets_comments','repository_catalog_not_sheets','historical_configuration_not_runtime_verified'];
 f.manifest.supplements=[];for(const [index,classification]of classifications.entries()){const relative=`raw/supplement-${index}.json`;await writeFile(path.join(f.base,relative),'{"synthetic":true}');f.manifest.supplements.push({key:`supplement-${index}`,path:relative,classification});}
 f.manifest.supplements.push({key:'without-label',path:'raw/supplement-0.json'});await writeFile(f.manifestPath,JSON.stringify(f.manifest));
 const result=await convert(f),records=await readCollection(result.directory,'supplements');
 assert.deepEqual(records.map(r=>r.classification).sort(),[...classifications,policy.default_when_missing].sort());
});
test('media rejects an existing ID from a taxonomy instead of a domain entity',async()=>{
 const f=await fixture(),rows=f.sheets[0].data[0].rowData;rows[0].values.push(value('linkler'));rows[1].values.push(value('https://example.test/photo.jpg'));
 await writeFile(path.join(f.base,'raw/one.json'),JSON.stringify({spreadsheetId:'synthetic-book',sheets:f.sheets.slice(0,2)}));
 const result=await convert(f),term=(await readCollection(result.directory,'terms')).find(t=>t.code==='mutfak_sofra');
 await rewritePartition(result,'media_references',records=>{records[0].entity_id=term.id;});await assert.rejects(validateGeneration(result.directory),/media|entity|target/i);
});
test('workflow transitions reject terms outside their declared vocabulary',async()=>{
 const g=await fixture(),other=await convert(g),category=(await readCollection(other.directory,'terms')).find(t=>t.code==='mutfak_sofra');
 await rewritePartition(other,'workflows',records=>{records.find(r=>r.key==='task').transitions[0].to_term_id=category.id;});await assert.rejects(validateGeneration(other.directory),/transition|vocabulary/i);
});
