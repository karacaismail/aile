import test from 'node:test';
import assert from 'node:assert/strict';
import {grid} from '../finance-engine/cells.mjs';
import {FLOW_ANCHOR,PRIORITY_ANCHOR,WEB_TITLE,physicalTitles,resolveLayout,toLogical,toPhysical} from './sheet-layout.mjs';

const cell=(v,f)=>({effectiveValue:typeof v==='number'?{numberValue:v}:{stringValue:v},userEnteredValue:f?{formulaValue:f}:typeof v==='number'?{numberValue:v}:{stringValue:v}});
const at=(rows,r,c,v)=>{rows[r]??=[];rows[r][c]=v;};
const sheet=(sheetId,title,rows,rowCount=600,columnCount=80)=>({properties:{sheetId,title,gridProperties:{rowCount,columnCount}},data:[{rowData:Array.from(rows,r=>({values:r??[]}))}]});
function physical(){
 const arizi=[],ham=[],web=[],plan=[];
 at(arizi,4,15,cell('KASA-1'));at(arizi,4,4,cell(0,"=INDEX('_Finans ham'!$K$261:$K$356;MATCH($P5;'_Finans ham'!$A$261:$A$356;0))"));
 at(arizi,346,1,cell(FLOW_ANCHOR));at(arizi,346+46,2,cell(7));
 at(ham,5,2,cell(9,"='Arızi Giderler'!C365+Plan!C14"));at(ham,150,1,cell(PRIORITY_ANCHOR));at(ham,260,10,cell(1,"=IF('_Finans kontrol'!$B$2;DATE(2027;1;1);\"\")"));
 at(web,0,0,cell('wire'));at(web,0,21,cell('timeline'));at(web,0,39,cell('finance-bridge-v1'));
 at(plan,76,2,cell(1,"=IF('_Finans kontrol'!$B$2;'_Web verisi'!AP52+C75*'Arızi Giderler'!C394;\"\")"));
 return {spreadsheetId:'x',sheets:[sheet(7302602,'Arızi Giderler',arizi),sheet(7302702,'_Finans ham',ham,420,18),sheet(9000001,WEB_TITLE,web,1600,70),sheet(1,'Plan',plan,100,26)]};
}
test('physical tabs read back under their stable engine names and ids',()=>{
 const logical=toLogical(physical());
 const flow=logical.sheets.find(s=>s.properties.title==='_Taşınma akışı');
 assert.equal(flow.properties.sheetId,7302612);
 assert.equal(grid(logical,'_Taşınma akışı')[0][1].effectiveValue.stringValue,FLOW_ANCHOR);
 assert.equal(grid(logical,'_Taşınma akışı')[46][2].effectiveValue.numberValue,7);
 assert.equal(grid(logical,'Öncelik planı')[110][10].effectiveValue.numberValue,1);
 assert.equal(grid(logical,'_Finans web')[0][0].effectiveValue.stringValue,'wire');
 assert.equal(grid(logical,'_Finans web')[0].length,20,'wire stops before the timeline zone');
 assert.equal(grid(logical,'_Finans aylık')[0][0].effectiveValue.stringValue,'finance-bridge-v1');
 assert.equal(logical.sheets.some(s=>s.properties.title===WEB_TITLE),false);
});
test('the item table ends before the merged flow block',()=>{
 const logical=toLogical(physical());
 assert.equal(grid(logical,'Arızi Giderler').length,346,'no flow row may be read as a purchase');
 assert.equal(logical.sheets.find(s=>s.properties.title==='Arızi Giderler').properties.gridProperties.rowCount,346);
});
test('formula text is restored to the addresses the engine expects',()=>{
 const logical=toLogical(physical());
 assert.equal(grid(logical,'Arızi Giderler')[4][4].userEnteredValue.formulaValue,"=INDEX('Öncelik planı'!$K$111:$K$206;MATCH($P5;'Öncelik planı'!$A$111:$A$206;0))");
 assert.equal(grid(logical,'_Finans ham')[5][2].userEnteredValue.formulaValue,"='_Taşınma akışı'!C19+Plan!C14");
 assert.equal(grid(logical,'Plan')[76][2].userEnteredValue.formulaValue,"=IF('_Finans kontrol'!$B$2;'_Finans aylık'!C52+C75*'_Taşınma akışı'!C48;\"\")");
});
test('writes land in the merged block with translated formulas',()=>{
 const layout=resolveLayout(physical());
 const [date,plan]=toPhysical([
  {updateCells:{range:{sheetId:7302605,startRowIndex:110,endRowIndex:111,startColumnIndex:10,endColumnIndex:11},rows:[{values:[{userEnteredValue:{formulaValue:'=1'}}]}],fields:'userEnteredValue'}},
  {updateCells:{range:{sheetId:1,startRowIndex:76,endRowIndex:77,startColumnIndex:2,endColumnIndex:3},rows:[{values:[{userEnteredValue:{formulaValue:"='_Finans aylık'!C52+'_Taşınma akışı'!C48"}}]}],fields:'userEnteredValue'}},
 ],layout);
 assert.deepEqual([date.updateCells.range.sheetId,date.updateCells.range.startRowIndex],[7302702,260]);
 assert.equal(plan.updateCells.rows[0].values[0].userEnteredValue.formulaValue,"='_Web verisi'!AP52+'Arızi Giderler'!C394");
});
test('bridge writes shift right inside the web tab',()=>{
 const [r]=toPhysical([{updateCells:{range:{sheetId:7302703,startRowIndex:0,endRowIndex:1,startColumnIndex:0,endColumnIndex:2},rows:[],fields:'userEnteredValue'}}],resolveLayout(physical()));
 assert.deepEqual(r.updateCells.range,{sheetId:9000001,startRowIndex:0,endRowIndex:1,startColumnIndex:39,endColumnIndex:41});
});
test('open-ended guards are closed at the block edge and reopen on read',()=>{
 const layout=resolveLayout(physical());
 const guard=`=AND(EXACT(TEXTJOIN("|";FALSE;'Arızi Giderler'!P5:P);"x");EXACT(TEXTJOIN("|";FALSE;'_Taşınma akışı'!A101:A);"y"))`;
 const [w]=toPhysical([{updateCells:{range:{sheetId:1,startRowIndex:0,endRowIndex:1,startColumnIndex:0,endColumnIndex:1},rows:[{values:[{userEnteredValue:{formulaValue:guard}}]}],fields:'userEnteredValue'}}],layout);
 const written=w.updateCells.rows[0].values[0].userEnteredValue.formulaValue;
 assert.equal(written,`=AND(EXACT(TEXTJOIN("|";FALSE;'Arızi Giderler'!P5:P346);"x");EXACT(TEXTJOIN("|";FALSE;'Arızi Giderler'!A447:A546);"y"))`);
 const p=physical();p.sheets[3].data[0].rowData[0]={values:[cell(1,written)]};
 assert.equal(grid(toLogical(p),'Plan')[0][0].userEnteredValue.formulaValue,guard);
});
test('addresses inside guard text literals are translated too',()=>{
 const [w]=toPhysical([{updateCells:{range:{sheetId:1,startRowIndex:0,endRowIndex:1,startColumnIndex:0,endColumnIndex:1},rows:[{values:[{userEnteredValue:{formulaValue:`=TYPE(INDIRECT("'_Taşınma akışı'!C47"))`}}]}],fields:'userEnteredValue'}}],resolveLayout(physical()));
 assert.equal(w.updateCells.rows[0].values[0].userEnteredValue.formulaValue,`=TYPE(INDIRECT("'Arızi Giderler'!C393"))`);
});
test('structural requests against a merged block fail closed',()=>{
 assert.throws(()=>toPhysical([{mergeCells:{range:{sheetId:7302612,startRowIndex:0,endRowIndex:1,startColumnIndex:0,endColumnIndex:2},mergeType:'MERGE_ALL'}}],resolveLayout(physical())),/merged block/);
});
test('growth on the wire appends to the web tab itself',()=>{
 const [r]=toPhysical([{appendDimension:{sheetId:7302704,dimension:'ROWS',length:5}}],resolveLayout(physical()));
 assert.deepEqual(r,{appendDimension:{sheetId:9000001,dimension:'ROWS',length:5}});
});
test('a shifted item table moves the block without a code change',()=>{
 const p=physical(),rows=p.sheets[0].data[0].rowData;rows.splice(10,0,{values:[]});
 const logical=toLogical(p);
 assert.equal(logical.sheets.find(s=>s.properties.title==='Arızi Giderler').properties.gridProperties.rowCount,347);
 assert.equal(grid(logical,'_Taşınma akışı')[46][2].effectiveValue.numberValue,7);
});
test('a workbook that still has the old tabs passes through untouched',()=>{
 const old={spreadsheetId:'x',sheets:[sheet(7302612,'_Taşınma akışı',[[cell(1,"='Arızi Giderler'!A1")]]),sheet(7302602,'Arızi Giderler',[[cell('a')]])]};
 assert.equal(toLogical(old),old);
});
test('a missing anchor stops the run instead of guessing rows',()=>{
 const p=physical();p.sheets[0].data[0].rowData[346].values[1]=cell('değişti');
 assert.throws(()=>toLogical(p),/anchor/i);
});
test('reads map stable names to the tab that really holds them',()=>{
 const titles=physicalTitles(['Plan','_Taşınma akışı','Öncelik planı','_Finans web','_Finans aylık','Arızi Giderler'],new Set(['Plan','Arızi Giderler','_Finans ham',WEB_TITLE]));
 assert.deepEqual(titles,['Plan','Arızi Giderler','_Finans ham',WEB_TITLE]);
});
