import path from 'node:path';
import { inputFile, canonical, sha256, scalar, stableId, columnName } from './core.mjs';

function validateBounds(source, tables) {
 if(!source.bounds)return;
 if(!Array.isArray(source.bounds)||!source.bounds.length)throw new Error('Capture bounds are empty');
 for(const bound of source.bounds){
  const table=tables.get(bound.sheetId),grid=table?.properties.gridProperties;
  if(!table||!source.chunks.includes(bound.chunk)||!['startRow','endRow','startColumn','endColumn'].every(k=>Number.isInteger(bound[k]))||bound.startRow<0||bound.startColumn<0||bound.endRow<=bound.startRow||bound.endColumn<=bound.startColumn||bound.endRow>grid?.rowCount||bound.endColumn>grid?.columnCount)throw new Error('Invalid capture bounds');
 }
 for(const table of tables.values()){
  const bounds=source.bounds.filter(b=>b.sheetId===table.properties.sheetId),grid=table.properties.gridProperties;
  if(!bounds.length)throw new Error('Capture coverage is missing a sheet');
  const rows=[...new Set([0,grid.rowCount,...bounds.flatMap(b=>[b.startRow,b.endRow])])].sort((a,b)=>a-b);
  for(let i=0;i<rows.length-1;i++){
   const intervals=bounds.filter(b=>b.startRow<=rows[i]&&b.endRow>=rows[i+1]).map(b=>[b.startColumn,b.endColumn]).sort((a,b)=>a[0]-b[0]);
   let end=0;for(const [start,next]of intervals){if(start>end)throw new Error('Capture coverage has a column gap');end=Math.max(end,next);}
   if(end!==grid.columnCount)throw new Error('Capture coverage has a row or column gap');
  }
 }
}

export async function loadNative(manifestPath, tenantId) {
 const {value:manifest}=await inputFile(path.dirname(manifestPath),path.basename(manifestPath));
 if(manifest.schemaVersion!==1||!Array.isArray(manifest.sources)||!manifest.sources.length)throw new Error('Invalid source manifest');
 const raw=[],sources=[],sheets=[],seen=new Set();
 for(const source of [...manifest.sources].sort((a,b)=>String(a.key).localeCompare(String(b.key)))){
  if(!['household','budget'].includes(source.key)||seen.has(source.key))throw new Error('Invalid or duplicate source key');seen.add(source.key);
  const before=source.driveBefore??{},after=source.driveAfter??{};
  const beforeTime=before.modified_time??before.modifiedTime,afterTime=after.modified_time??after.modifiedTime;
  if((beforeTime&&afterTime&&beforeTime!==afterTime)||(before.version&&after.version&&String(before.version)!==String(after.version)))throw new Error('Source revision changed during capture');
  const metaInput=await inputFile(path.dirname(manifestPath),source.metadata),metadata=metaInput.value.structuredContent??metaInput.value;
  if(!metadata.spreadsheetId||!Array.isArray(metadata.sheets))throw new Error('Invalid workbook metadata');
  const id=stableId(tenantId,'source',source.key),tables=new Map();
  for(const s of metadata.sheets){if(!s.properties||!Number.isInteger(s.properties.sheetId))throw new Error('Missing sheet identity');tables.set(s.properties.sheetId,{source_key:source.key,source_id:id,properties:s.properties,rows:new Map()});}
  raw.push({path:`raw/${source.key}/metadata-${sha256(metaInput.bytes)}.json`,bytes:metaInput.bytes});
  validateBounds(source,tables);
  const hashes=[];
  for(const chunkPath of source.chunks??[]){
   const input=await inputFile(path.dirname(manifestPath),chunkPath),chunk=input.value.structuredContent??input.value;
   if(chunk.spreadsheetId!==metadata.spreadsheetId)throw new Error(`Wrong workbook in source ${source.key}`);
   if(!Array.isArray(chunk.sheets))throw new Error('Invalid native cells chunk');
   hashes.push(sha256(input.bytes));raw.push({path:`raw/${source.key}/chunk-${sha256(input.bytes)}.json`,bytes:input.bytes});
   for(const sheet of chunk.sheets){
    const table=tables.get(sheet.properties?.sheetId);if(!table||table.properties.title!==sheet.properties.title)throw new Error('Unknown sheet identity in chunk');
    for(const data of sheet.data??[]){
     const rowStart=data.startRow??0,colStart=data.startColumn??0;
     if(!Number.isInteger(rowStart)||rowStart<0||!Number.isInteger(colStart)||colStart<0)throw new Error('Invalid grid coordinates');
     for(const [ri,row] of (data.rowData??[]).entries())for(const [ci,cell]of(row.values??[]).entries()){
      if(!cell||!Object.keys(cell).length)continue;
      const r=rowStart+ri,c=colStart+ci;if(!table.rows.has(r))table.rows.set(r,new Map());
      if(source.bounds&&!source.bounds.some(b=>b.chunk===chunkPath&&b.sheetId===sheet.properties.sheetId&&r>=b.startRow&&r<b.endRow&&c>=b.startColumn&&c<b.endColumn))throw new Error('Returned cell falls outside declared capture bounds');
      const cells=table.rows.get(r),before=cells.get(c);
      if(before&&canonical(before)!==canonical(cell))throw new Error('Conflicting overlapping source cells');
      cells.set(c,cell);
     }
    }
   }
  }
  if(!hashes.length)throw new Error('Source must include at least one cells chunk');
  sources.push({id,tenant_id:tenantId,key:source.key,spreadsheet_id:metadata.spreadsheetId,metadata_hash:sha256(metaInput.bytes),chunk_hashes:[...new Set(hashes)].sort(),capture:{started_at:source.startedAt??null,completed_at:source.completedAt??null,coverage:source.bounds?'verified_full_declared_grid':'unknown',bounds:source.bounds?[...source.bounds].sort((a,b)=>a.sheetId-b.sheetId||a.startRow-b.startRow||a.startColumn-b.startColumn):[],drive_before:source.driveBefore??null,drive_after:source.driveAfter??null,consistency:'not_transactional'}});
  sheets.push(...tables.values());
 }
 const supplements=[],supplementKeys=new Set();
 for(const supplement of manifest.supplements??[]){
  if(!supplement.key||!supplement.path)throw new Error('Supplement requires key and path');
  if(supplementKeys.has(supplement.key))throw new Error('Duplicate supplement key');supplementKeys.add(supplement.key);
  const input=await inputFile(path.dirname(manifestPath),supplement.path);
  raw.push({path:`raw/supplements/${sha256(input.bytes)}.json`,bytes:input.bytes});
  supplements.push({id:stableId(tenantId,'supplement',supplement.key),tenant_id:tenantId,key:supplement.key,classification:supplement.classification??'external_catalog_or_configuration',source_url:supplement.sourceUrl??null,payload:input.value});
 }
 return {raw:[...new Map(raw.map(r=>[r.path,r])).values()],sources,sheets,supplements};
}
export function provenance(table,row,column=null) {
 return {source_key:table.source_key,source_id:table.source_id,sheet_id:table.properties.sheetId,sheet_title:table.properties.title,row:row+1,column:column===null?null:column+1,a1:column===null?`${row+1}:${row+1}`:`${columnName(column)}${row+1}`};
}
export function archiveRecords(table,tenantId) {
 const cells=[],rows=[];
 for(const [row,columns]of [...table.rows].sort((a,b)=>a[0]-b[0])){
  const cellIds=[];for(const [column,cell]of[...columns].sort((a,b)=>a[0]-b[0])){
   const p=provenance(table,row,column),id=stableId(tenantId,'cell',table.source_key,p.sheet_id,row,column);cellIds.push(id);
   cells.push({id,tenant_id:tenantId,provenance:p,cell});
  }
  rows.push({id:stableId(tenantId,'row',table.source_key,table.properties.sheetId,row),tenant_id:tenantId,provenance:provenance(table,row),cell_ids:cellIds});
 }
 return {cells,rows};
}
export function tableRecords(table) {
 const header=table.rows.get(0);if(!header)return [];
 const keys=[...header].map(([c,cell])=>[c,scalar(cell)]).filter(([,v])=>typeof v==='string'&&v.trim());
 const names=keys.map(([,v])=>v);if(new Set(names).size!==names.length)throw new Error(`Duplicate headers in ${table.properties.title}`);
 const required={app_kalemler:['id','tip','ad','updated_at','version'],app_ayarlar:['id','tip','anahtar','deger','updated_at','version'],app_nakit:['id','tarih','tutar','kalem','updated_at','version']}[table.properties.title]??[];
 if(required.some(key=>!names.includes(key)))throw new Error(`Missing required headers in ${table.properties.title}`);
 return [...table.rows].filter(([r])=>r>0).sort((a,b)=>a[0]-b[0]).flatMap(([r,cells])=>{
  const attrs=Object.fromEntries(keys.map(([c,key])=>[key,scalar(cells.get(c))]));
  if(!Object.values(attrs).some(v=>v!==null&&v!==''))return [];
  return [{row:r,attrs,cells,columns:new Map(keys.map(([c,key])=>[key,c]))}];
 });
}
