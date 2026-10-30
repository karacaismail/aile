/** Native JSON transport avoids the large-object bridge in the advanced service.
 * Credentials remain in memory and are sent only to the fixed Google Sheets host. */
export function sheetsApi({fetch,token}) {
 const endpoint=id=>{
  if(typeof id!=='string'||! /^[A-Za-z0-9_-]+$/.test(id))throw Error('Geçersiz çalışma kitabı kimliği.');
  return 'https://sheets.googleapis.com/v4/spreadsheets/'+id;
 };
 const request=(url,options={})=>{
  const response=fetch(url,{...options,headers:{Authorization:'Bearer '+token()},followRedirects:false,muteHttpExceptions:true});
  const status=response.getResponseCode();
  if(status<200||status>=300)throw Error('Google Sheets HTTP '+status);
  return JSON.parse(response.getContentText());
 };
 return {
  maxRangesPerRequest:4,
  get(id,options={}){
   const query=Object.entries(options).flatMap(([key,value])=>(Array.isArray(value)?value:[value]).map(v=>encodeURIComponent(key)+'='+encodeURIComponent(String(v)).replaceAll("'",'%27'))).join('&');
   return request(endpoint(id)+(query?'?'+query:''));
  },
  batchUpdate(body,id){return request(endpoint(id)+':batchUpdate',{method:'post',contentType:'application/json',payload:JSON.stringify(body)});},
 };
}
