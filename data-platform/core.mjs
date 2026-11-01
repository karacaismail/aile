import { createHash } from 'node:crypto';
import { access, realpath, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export const SCHEMA_VERSION = 1;
export function canonical(value) {
 const sort = v => {
  if (typeof v === 'number' && !Number.isFinite(v)) throw new Error('Non-finite JSON number');
  if (Array.isArray(v)) return v.map(sort);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])]));
  if (v === undefined) throw new Error('Undefined is not a JSON value');
  return v;
 };
 return `${JSON.stringify(sort(value))}\n`;
}
export const sha256 = value => createHash('sha256').update(value).digest('hex');
const namespace = Buffer.from('9959e4207e1d4fe29b42f8929e57bb94','hex');
/** RFC 9562 UUIDv5, with length-delimited components encoded as JSON. */
export function stableId(...parts) {
 const bytes=createHash('sha1').update(namespace).update(JSON.stringify(parts)).digest().subarray(0,16);
 bytes[6]=(bytes[6]&15)|80;bytes[8]=(bytes[8]&63)|128;
 const hex=bytes.toString('hex');return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
export const columnName = index => {let n=index+1,s='';while(n){n--;s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26);}return s;};
export function decimal(value) {
 if (typeof value!=='number' && typeof value!=='string') return null;
 const text=String(value).trim();if(!/^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(text)) return null;
 if (!Number.isFinite(Number(text))) return null;
 if(!/[eE]/.test(text)) return text.replace(/^(-?)0+(?=\d)/,'$1');
 const [coefficient,exponent]=text.toLowerCase().split('e'),negative=coefficient.startsWith('-');
 const [whole,fraction='']=coefficient.replace(/^-/,'').split('.'),digits=whole+fraction,place=whole.length+Number(exponent);
 return `${negative?'-':''}${place<=0?'0.'+'0'.repeat(-place)+digits:place>=digits.length?digits+'0'.repeat(place-digits.length):digits.slice(0,place)+'.'+digits.slice(place)}`;
}
export function isoDate(value, cell) {
 if(value===null||value==='')return null;
 let text=value;
 if(typeof value==='number' && /DATE/.test(cell?.effectiveFormat?.numberFormat?.type??cell?.userEnteredFormat?.numberFormat?.type??'')) {
  text=new Date(Date.UTC(1899,11,30)+Math.trunc(value)*86400000).toISOString().slice(0,10);
 }
 if(typeof text!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(text))return null;
 const d=new Date(`${text}T00:00:00Z`);return Number.isFinite(d.valueOf())&&d.toISOString().slice(0,10)===text?text:null;
}
export function scalar(cell) {
 const v=cell?.effectiveValue??cell?.userEnteredValue;
 if(!v||v.errorValue||v.formulaValue)return null;
 for(const key of ['stringValue','numberValue','boolValue'])if(Object.hasOwn(v,key))return v[key];
 return null;
}
export async function safeOutput(outputRoot) {
 // Check both paths: a public symlink to private storage is still publicly served.
 for(let check=path.resolve(outputRoot);;check=path.dirname(check)){
  if(['public','dist','.git'].includes(path.basename(check)))throw new Error('Private output must be outside public/dist/Git directories');
  try {await access(path.join(check,'.git'));throw new Error('Private output must be outside any Git repository');}catch(e){if(e.code!=='ENOENT'&&e.code!=='ENOTDIR')throw e;}
  if(path.dirname(check)===check)break;
 }
 let cursor=path.resolve(outputRoot),tail=[];
 while(true){try{cursor=await realpath(cursor);break;}catch(e){if(e.code!=='ENOENT')throw e;tail.unshift(path.basename(cursor));const parent=path.dirname(cursor);if(parent===cursor)throw e;cursor=parent;}}
 const resolved=path.join(cursor,...tail);
 for(let check=resolved;;check=path.dirname(check)){
  if(['public','dist','.git'].includes(path.basename(check)))throw new Error('Private output must be outside public/dist/Git directories');
  try {await access(path.join(check,'.git'));throw new Error('Private output must be outside any Git repository');}catch(e){if(e.code!=='ENOENT'&&e.code!=='ENOTDIR')throw e;}
  if(path.dirname(check)===check)break;
 }
 await mkdir(resolved,{recursive:true,mode:0o700});return resolved;
}
export async function inputFile(base, relative) {
 if(typeof relative!=='string'||path.isAbsolute(relative))throw new Error('Input path must be manifest-relative');
 const resolved=await realpath(path.resolve(base,relative));const root=await realpath(base);
 if(resolved!==root&&!resolved.startsWith(`${root}${path.sep}`))throw new Error('Input path escapes manifest directory');
 const bytes=await readFile(resolved);return {bytes,value:JSON.parse(bytes.toString('utf8'))};
}
