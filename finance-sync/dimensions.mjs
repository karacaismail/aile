/** Append only: a concurrent user-added row/column must never be truncated. */
export function growDimensions(sheet,{rows=0,columns=0}){
 const current=sheet.properties.gridProperties??{},sheetId=sheet.properties.sheetId,out=[];
 for(const[dimension,required,existing]of[['ROWS',rows,current.rowCount??0],['COLUMNS',columns,current.columnCount??0]])if(required>existing)out.push({appendDimension:{sheetId,dimension,length:required-existing}});
 return out;
}
