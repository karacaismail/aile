import {clone,grid,column} from '../finance-engine/cells.mjs';
import {checkDependencies} from './native-finance.mjs';
const same=(a,b)=>JSON.stringify(a??{})===JSON.stringify(b??{});
/** Effective formula values are checked as well as entered inputs, so external or
 * asynchronous formula changes cannot pass an unchanged entered-value digest. */
export function validateCandidateSource(candidate,source,{phase='before'}={}){
 if(!['before','after'].includes(phase))throw Error('Invalid source validation phase');
 const manifest=clone(candidate.financeManifest),targets=new Map(candidate.targets.map(t=>[`${t.title}/${t.row}/${t.column}`,t]));
 if(phase==='before')for(const dependency of manifest.dependencies){const target=targets.get(`${dependency.title}/${dependency.row}/${dependency.column}`);if(target)dependency.entered=target.before;}
 const failures=checkDependencies(manifest,source,{includeInputs:true});let checks=manifest.dependencies.length;
 if(phase==='before'){
  const grids=new Map(source.sheets.map(s=>[s.properties.title,grid(source,s.properties.title)]));
  for(const target of candidate.targets){checks++;if(!same(grids.get(target.title)?.[target.row]?.[target.column]?.userEnteredValue,target.before))failures.push({kind:'target-owner-drift',title:target.title,row:target.row+1,column:column(target.column)});}
  for(const range of candidate.clearRanges??[])for(const cell of range.cells??[]){checks++;if(!same(grids.get(range.title)?.[cell.row]?.[cell.column]?.userEnteredValue,cell.entered))failures.push({kind:'clear-owner-drift',title:range.title,row:cell.row+1,column:column(cell.column)});}
 }
 return{checks,failures};
}
export const preflightCandidate=(candidate,source)=>validateCandidateSource(candidate,source,{phase:'before'});
