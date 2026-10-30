import{grid}from'../finance-engine/cells.mjs';
export function panoVariance(source){
 const g=grid(source,'Pano'),sheetId=source.sheets.find(s=>s.properties.title==='Pano').properties.sheetId,targets=[],requests=[];
 for(let m=0;m<14;m++){const row=71+m,r=50+m,bodies=[`E${r}-D${r}`,`IF(D${r}=0;"";C${row}/ABS(D${r}))`,`G${r}-F${r}`,`IF(F${r}=0;"";E${row}/ABS(F${r}))`,`I${r}-H${r}`,`IF(H${r}=0;"";G${row}/ABS(H${r}))`,...['E','G','I'].map(c=>m?`IF(${c}${r-1}=0;"";(${c}${r}-${c}${r-1})/ABS(${c}${r-1}))`:'""'),m?`K${r}-K${r-1}`:'""'],ts=[];
  for(let i=0;i<10;i++){const column=i+2,before=g[row-1]?.[column]?.userEnteredValue??{},formula=`=IF('_Finans kontrol'!$B$2;${bodies[i]};"")`;if(!['='+bodies[i],formula].includes(before.formulaValue))throw Error(`Unexpected Pano owner at row ${row} column ${column+1}`);ts.push({title:'Pano',sheetId,row:row-1,column,before,entered:{formulaValue:formula}});}
  targets.push(...ts);requests.push({updateCells:{range:{sheetId,startRowIndex:row-1,endRowIndex:row,startColumnIndex:2,endColumnIndex:12},rows:[{values:ts.map(t=>({userEnteredValue:t.entered}))}],fields:'userEnteredValue'}});
 }
 return{targets,requests};
}
export function varianceExpectations(plan,current){const expected=[],ratio=(n,d)=>d===0?'':n/Math.abs(d);for(let m=0;m<Math.min(14,plan.length);m++){const p=plan[m],c=current[m],previous=current[m-1],delta=[c.income-p.income,c.grossCashOut-p.grossCashOut,c.savings-p.savings],values=[delta[0],ratio(delta[0],p.income),delta[1],ratio(delta[1],p.grossCashOut),delta[2],ratio(delta[2],p.savings),...['income','grossCashOut','savings'].map(k=>m?ratio(c[k]-previous[k],previous[k]):''),m?c.netCashMovement-previous.netCashMovement:''];values.forEach((value,i)=>expected.push({title:'Pano',row:70+m,column:2+i,value}));}return expected;}
