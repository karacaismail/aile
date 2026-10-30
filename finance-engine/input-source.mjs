import{grid,value}from'./cells.mjs';
/** Stable native input rows; visible Timeline may be an output mirror. */
export function sourceEventCells(source){const has=source.sheets.some(s=>s.properties.title==='_Timeline kaynak');if(has){const raw=grid(source,'_Timeline kaynak');if(raw.some(r=>typeof value(r?.[0])==='string'&&typeof value(r?.[11])==='boolean'))return raw.filter(r=>value(r?.[11])===true).map(r=>[...r.slice(0,9),{},{},{},{},r[9],r[10]]).sort((a,b)=>String(value(a[1])).localeCompare(String(value(b[1])))||value(a[2])-value(b[2]));}return grid(source,'Timeline').slice(6).filter(r=>value(r?.[0]));}
export function sourceEvents(source){return sourceEventCells(source).map(r=>r.map(value));}
