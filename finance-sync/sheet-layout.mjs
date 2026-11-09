import {column,grid,value} from '../finance-engine/cells.mjs';

/** The workbook keeps fewer tabs than the engine has concepts. Merged blocks are read
 * under their stable engine names and ids, so calculation code and durable ownership
 * never learn where a block physically lives. Only capture and apply cross this line. */
export const WEB_TITLE='_Web verisi';
export const FLOW_ANCHOR='Haziran taşınması · gelir ve fiyatlara bağlı ödeme hesabı',PRIORITY_ANCHOR='Öncelik planı';
const ARIZI='Arızi Giderler',RAW='_Finans ham';
const ZONES=[
 {logical:'_Taşınma akışı',sheetId:7302612,host:ARIZI,anchor:FLOW_ANCHOR,rows:200,columns:80},
 {logical:'Öncelik planı',sheetId:7302605,host:RAW,anchor:PRIORITY_ANCHOR,rows:250,columns:18},
 {logical:'_Finans web',sheetId:7302704,host:WEB_TITLE,firstColumn:0,columns:20},
 {logical:'_Finans aylık',sheetId:7302703,host:WEB_TITLE,firstColumn:39,columns:28,rows:110},
];
const ANCHOR_COLUMN=1;

export function physicalTitles(logicalTitles,existing){
 const out=new Set();
 for(const title of logicalTitles){const zone=ZONES.find(z=>z.logical===title);out.add(zone&&!existing.has(title)?zone.host:title);}
 return [...out];
}

export function resolveLayout(source){
 const byTitle=new Map(source.sheets.map(s=>[s.properties.title,s]));
 const zones=ZONES.filter(z=>!byTitle.has(z.logical)&&byTitle.has(z.host)).map(z=>{
  const host=byTitle.get(z.host);let firstRow=0;
  if(z.anchor){firstRow=grid(source,z.host).findIndex(row=>value(row?.[ANCHOR_COLUMN])===z.anchor);if(firstRow<0)throw Error('Merged block anchor missing: '+z.logical);}
  return{...z,hostId:host.properties.sheetId,firstRow,firstColumn:z.firstColumn??0,rows:z.rows??host.properties.gridProperties.rowCount};
 });
 return{zones,byId:new Map(zones.map(z=>[z.sheetId,z]))};
}

const letters=c=>{let n=0;for(const ch of c)n=n*26+ch.charCodeAt(0)-64;return n-1;};
const REF=String.raw`(\$?)([A-Z]{1,3})(\$?)(\d+)(?::(\$?)([A-Z]{1,3})(\$?)(\d*))?(?![A-Za-z0-9_(])`;
const quote=title=>`'${title.replaceAll("'","''")}'`;
const escape=text=>text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const pattern=titles=>new RegExp(`'(${titles.map(t=>escape(t.replaceAll("'","''"))).join('|')})'!${REF}`,'g');
const format=(title,a1,c1,a2,r1,end)=>`${quote(title)}!${a1}${column(c1)}${a2}${r1}${end??''}`;

function physicalToLogical(formula,layout){
 if(!layout.hostPattern)return formula;
 return formula.replace(layout.hostPattern,(all,host,a1,col,a2,row,b1,col2,b2,row2)=>{
  const c=letters(col),r=Number(row)-1;
  const zone=layout.zones.find(z=>z.host===host&&r>=z.firstRow&&r<z.firstRow+z.rows&&c>=z.firstColumn&&c<z.firstColumn+z.columns);
  if(!zone){
   const edge=layout.zones.find(z=>z.host===host&&z.anchor);
   return col2&&edge&&Number(row2)===edge.firstRow?`${quote(host)}!${a1}${col}${a2}${row}:${b1}${col2}`:all;
  }
  const shiftColumn=x=>column(letters(x)-zone.firstColumn);
  const start=format(zone.logical,a1,c-zone.firstColumn,a2,r-zone.firstRow+1);
  if(!col2)return start;
  const lastRow=Number(row2);
  if(row2&&zone.anchor&&lastRow===zone.firstRow+zone.rows)return `${start}:${b1}${shiftColumn(col2)}`;
  return `${start}:${b1}${shiftColumn(col2)}${b2}${row2?lastRow-zone.firstRow:''}`;
 });
}

function logicalToPhysical(formula,layout){
 if(!layout.logicalPattern)return formula;
 return formula.replace(layout.logicalPattern,(all,title,a1,col,a2,row,b1,col2,b2,row2)=>{
  const zone=layout.zones.find(z=>z.logical===title);
  if(!zone){
   if(!col2||row2)return all;
   const edge=layout.zones.find(z=>z.host===title&&z.anchor);
   return edge?`${quote(title)}!${a1}${col}${a2}${row}:${b1}${col2}${edge.firstRow}`:all;
  }
  const shiftColumn=x=>column(letters(x)+zone.firstColumn);
  const start=format(zone.host,a1,letters(col)+zone.firstColumn,a2,Number(row)+zone.firstRow);
  if(!col2)return start;
  return `${start}:${b1}${shiftColumn(col2)}${b2}${row2?Number(row2)+zone.firstRow:zone.firstRow+zone.rows}`;
 });
}

function compile(layout){
 const hosts=[...new Set(layout.zones.map(z=>z.host))],names=layout.zones.map(z=>z.logical),edges=layout.zones.filter(z=>z.anchor).map(z=>z.host);
 return{...layout,hostPattern:hosts.length?pattern(hosts):null,logicalPattern:names.length?pattern([...names,...edges]):null};
}

const rewriteCell=(cell,layout)=>{
 const formula=cell?.userEnteredValue?.formulaValue;
 if(typeof formula!=='string'||!formula.includes("'"))return cell;
 const next=physicalToLogical(formula,layout);
 return next===formula?cell:{...cell,userEnteredValue:{...cell.userEnteredValue,formulaValue:next}};
};
const rowsOf=rows=>[{rowData:Array.from(rows,row=>({values:row??[]}))}];

export function toLogical(source){
 const layout=compile(resolveLayout(source));
 if(!layout.zones.length)return source;
 const hostTitles=new Set(layout.zones.map(z=>z.host)),sheets=[];
 const translated=new Map(source.sheets.map(s=>[s.properties.title,grid(source,s.properties.title).map(row=>row?.map(cell=>rewriteCell(cell,layout)))]));
 for(const sheet of source.sheets){
  const title=sheet.properties.title,rows=translated.get(title);
  if(!hostTitles.has(title)){sheets.push({...sheet,data:rowsOf(rows)});continue;}
  const edge=layout.zones.find(z=>z.host===title&&z.anchor);
  if(edge)sheets.push({...sheet,properties:{...sheet.properties,gridProperties:{...sheet.properties.gridProperties,rowCount:edge.firstRow}},data:rowsOf(rows.slice(0,edge.firstRow))});
  for(const zone of layout.zones.filter(z=>z.host===title)){
   const block=rows.slice(zone.firstRow,zone.firstRow+zone.rows).map(row=>row?.slice(zone.firstColumn,zone.firstColumn+zone.columns));
   sheets.push({properties:{...sheet.properties,sheetId:zone.sheetId,title:zone.logical,gridProperties:{rowCount:zone.rows,columnCount:zone.columns}},data:rowsOf(block)});
  }
 }
 return{...source,sheets};
}

const shiftRange=(range,zone)=>({...range,sheetId:zone.hostId,startRowIndex:range.startRowIndex+zone.firstRow,endRowIndex:range.endRowIndex+zone.firstRow,startColumnIndex:range.startColumnIndex+zone.firstColumn,endColumnIndex:range.endColumnIndex+zone.firstColumn});

export function toPhysical(requests,resolved){
 const layout=compile(resolved);
 const refused=node=>{if(Array.isArray(node))return node.some(refused);if(!node||typeof node!=='object')return false;return layout.byId.has(node.sheetId)||Object.values(node).some(refused);};
 return requests.map(request=>{
  if(request.updateCells){
   const u=request.updateCells,zone=layout.byId.get(u.range.sheetId);
   return{updateCells:{...u,range:zone?shiftRange(u.range,zone):u.range,rows:(u.rows??[]).map(row=>({...row,values:(row.values??[]).map(cell=>{const f=cell?.userEnteredValue?.formulaValue;return typeof f==='string'&&f.includes("'")?{...cell,userEnteredValue:{...cell.userEnteredValue,formulaValue:logicalToPhysical(f,layout)}}:cell;})}))}};
  }
  if(request.appendDimension){const zone=layout.byId.get(request.appendDimension.sheetId);return zone?{appendDimension:{...request.appendDimension,sheetId:zone.hostId}}:request;}
  if(refused(request))throw Error('Unsupported request against a merged block: '+Object.keys(request)[0]);
  return request;
 });
}
