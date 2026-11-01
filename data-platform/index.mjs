import { mkdir, writeFile, rename, rm, readFile, mkdtemp, lstat } from 'node:fs/promises';
import path from 'node:path';
import { canonical, sha256, stableId, safeOutput } from './core.mjs';
import { loadNative } from './native.mjs';
import { normalize } from './normalize.mjs';
import { financeCollections } from './finance.mjs';
import { validateGeneration } from './validate.mjs';
export { canonical, stableId } from './core.mjs';
export { validateGeneration, readCollection } from './validate.mjs';

async function publicationParent(output){
 const parent=path.join(output,'generations');
 const stat=await lstat(parent).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
 if(stat?.isSymbolicLink())throw new Error('Publication parent cannot be a symlink');
 const resolved=await safeOutput(parent);
 if(resolved!==parent)throw new Error('Publication parent escapes private output');
 return parent;
}

export async function convertSnapshot({manifestPath,outputRoot,tenantKey}) {
 if(typeof tenantKey!=='string'||!tenantKey.trim())throw new Error('A stable non-empty tenant key is required');
 const output=await safeOutput(outputRoot),tenantId=stableId('tenant',tenantKey),staging=await mkdtemp(path.join(output,'.staging-'));
 try{
  await publicationParent(output);
  const native=await loadNative(path.resolve(manifestPath),tenantId),collections=normalize(native,tenantId),files=[],counts={};
  for(const [collection,entries]of await financeCollections(native,tenantId)){
   if(collections.has(collection))throw new Error(`Duplicate collection owner: ${collection}`);
   collections.set(collection,entries);
  }
  const write=async(relative,bytes,extra)=>{
   const target=path.join(staging,relative);await mkdir(path.dirname(target),{recursive:true,mode:0o700});await writeFile(target,bytes,{mode:0o600});files.push({path:relative,sha256:sha256(bytes),bytes:Buffer.byteLength(bytes),...extra});
  };
  for(const raw of native.raw)await write(raw.path,raw.bytes,{kind:'raw'});
  for(const [collection,entries]of [...collections].sort(([a],[b])=>a.localeCompare(b))){
   counts[collection]=entries.length;const groups=Map.groupBy(entries,e=>e.partition);
   for(const [partition,group]of [...groups].sort(([a],[b])=>a.localeCompare(b))){
    const records=group.map(e=>e.record).sort((a,b)=>a.id.localeCompare(b.id)),size=collection==='source_cells'?2048:512;
    for(let i=0;i<records.length;i+=size){const part=records.slice(i,i+size);await write(`data/${collection}/${partition}/${String(i/size).padStart(5,'0')}.json`,canonical({schemaVersion:1,collection,records:part}),{kind:'partition',collection,count:part.length});}
   }
  }
  for(const name of ['partition','manifest','source-manifest']){
   const schema=await readFile(new URL(`./schemas/${name}.schema.json`,import.meta.url));await write(`schemas/${name}.schema.json`,schema,{kind:'schema'});
  }
  const mapping=await readFile(new URL('./postgres-mapping.json',import.meta.url));
  await write('contracts/postgres-mapping.json',mapping,{kind:'contract'});
  files.sort((a,b)=>a.path.localeCompare(b.path));
  const sourceSummary=native.sources.map(s=>({key:s.key,source_id:s.id,capture:s.capture}));
  const content={schemaVersion:1,tenant_id:tenantId,files,sources:sourceSummary},generationId=sha256(canonical(content));
  const manifest={...content,generation_id:generationId,counts,consistency:'snapshot_capture_not_transaction',currency_policy:'Unknown values remain null; amounts are decimal strings',storage_policy:'private_only'};
  await writeFile(path.join(staging,'manifest.json'),canonical(manifest),{mode:0o600});
  // Validation streams the written partitions; the full native graph is no longer needed.
  native.raw.length=0;native.sheets.length=0;collections.clear();
  await validateGeneration(staging);
  const directory=path.join(await publicationParent(output),generationId);
  const existing=await lstat(directory).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
  if(existing?.isSymbolicLink())throw new Error('Publication generation cannot be a symlink');
  try{await rename(staging,directory);}catch(e){if(!['ENOTEMPTY','EEXIST'].includes(e.code))throw e;await validateGeneration(directory);await rm(staging,{recursive:true});}
  return {directory,generationId,tenantId,counts,files:files.length};
 }catch(error){await rm(staging,{recursive:true,force:true});throw error;}
}
