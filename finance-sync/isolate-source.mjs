import {grid,value,column} from '../finance-engine/cells.mjs';
export const RAW_TITLE='_Finans ham';
export const RAW_ROWS=new Map([[10,6],[16,7],[17,8],[439,9],[447,10]]);
export function expectedRawFormula(row,col){const c=column(col);return ({10:`=SUM('_Kasa hesap'!${column(66+col-2)}2:${column(66+col-2)}368)`,16:`=ROUND(Plan!${c}58*'_Kasa hesap'!$DW$1+Plan!${c}59*'_Kasa hesap'!$DX$1+Plan!${c}60+Plan!${c}61;2)`,17:`=Plan!${c}62`,439:`='_Taşınma akışı'!${c}19+Plan!${c}14`,447:`='_Taşınma akışı'!${c}28+Plan!${c}15`})[row];}
const fail=(ok,msg)=>{if(!ok)throw new Error(msg);};
const patchCell=(sheetId,row,col,entered)=>({updateCells:{range:{sheetId,startRowIndex:row,endRowIndex:row+1,startColumnIndex:col,endColumnIndex:col+1},rows:[{values:[{userEnteredValue:entered}]}],fields:'userEnteredValue'}});
/** Reuse a migrated raw contract; no output summary is ever read as an input. */
export function existingIsolation(source,{targetSpreadsheetId,sheetId=7302702}){
 const raw=grid(source,RAW_TITLE),tl=grid(source,'_Timeline kaynak'),mapping=[],rewrites=[];fail(source.sheets.some(s=>s.properties.title===RAW_TITLE&&s.properties.sheetId===sheetId),'Existing raw identity mismatch');
 for(const[oldRow,newRow]of RAW_ROWS)for(let c=2;c<16;c++){const cell=raw[newRow-1]?.[c],formula=expectedRawFormula(oldRow,c);fail(cell?.userEnteredValue?.formulaValue===formula&&Number.isFinite(value(cell)),'Existing raw owner formula changed');const oldAddress=`Kasa!${column(c)}${oldRow}`,newAddress=`'${RAW_TITLE}'!${column(c)}${newRow}`,entered={formulaValue:formula};mapping.push({oldAddress,newAddress,source:{sheet:'Kasa',row:oldRow-1,column:c,entered,value:value(cell)},target:{sheet:RAW_TITLE,row:newRow-1,column:c,entered,value:value(cell)}});const negative=[16,439,447].includes(oldRow),expected=`=ROUND(${negative?'-':''}${newAddress};2)`,rows=tl.flatMap((r,i)=>r?.[6]?.userEnteredValue?.formulaValue===expected?[i]:[]);fail(rows.length===1,'Existing raw consumer missing or changed');rewrites.push({row:rows[0],column:6,source:oldAddress,target:newAddress,before:expected,after:expected,value:value(tl[rows[0]][6])});}
 return{alreadyIsolated:true,sourceSpreadsheetId:source.spreadsheetId,targetSpreadsheetId,sheetId,mapping,rewrites,requests:[]};
}
