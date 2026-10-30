/** Split value writes around real inputs, including clears, so a late edit survives. */
export function protectInputs(requests,inputs){
 return requests.flatMap(request=>{
  const u=request.updateCells,range=u?.range;if(!range)return[request];
  const protectedCells=inputs.filter(i=>i.sheetId===range.sheetId&&i.row>=range.startRowIndex&&i.row<range.endRowIndex&&i.column>=range.startColumnIndex&&i.column<range.endColumnIndex);
  if(!protectedCells.length)return[request];
  const boundaries=[...new Set([range.startRowIndex,range.endRowIndex,...protectedCells.flatMap(i=>[i.row,i.row+1])])].sort((a,b)=>a-b),out=[];
  for(let band=0;band<boundaries.length-1;band++){
   const startRowIndex=boundaries[band],endRowIndex=boundaries[band+1],excluded=new Set(protectedCells.filter(i=>i.row>=startRowIndex&&i.row<endRowIndex).map(i=>i.column));
   for(let c=range.startColumnIndex;c<range.endColumnIndex;){if(excluded.has(c)){c++;continue;}const startColumnIndex=c;while(c<range.endColumnIndex&&!excluded.has(c))c++;const endColumnIndex=c;
    const rows=u.rows?.length?u.rows.slice(startRowIndex-range.startRowIndex,endRowIndex-range.startRowIndex).map(row=>({...row,values:row.values?.slice(startColumnIndex-range.startColumnIndex,endColumnIndex-range.startColumnIndex)??[]})):[];
    out.push({updateCells:{...u,range:{...range,startRowIndex,endRowIndex,startColumnIndex,endColumnIndex},rows}});
   }
  }
  return out;
 });
}
