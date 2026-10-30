/** Private native Sheet patch builder; never writes a remote workbook. */
import {value,column} from '../finance-engine/cells.mjs';
export const MONTH_HEADERS=['Ay','Nakit','KMH anapara','KMH faiz + vergi','Kart borcu','Gelecek taksit','Birikimde kalan','Net nakit ve borç','Fon eksiği'];
export const DAY_HEADERS=['Tarih','Adım','Tür','Nakit değişimi','Gerekli bakiye','Harcanabilir nakit','KMH anapara','KMH faiz + vergi','Denizbank anapara','Denizbank faiz + vergi','İşbank anapara','İşbank faiz + vergi','Gelecek taksit taahhüdü','Toplam kart borcu','Fon eksiği','Kesinlik','Kaynak','ID'];
const STALE='Sheet verisi değişti; hesap yenilenmeli';
const currentIssueNote=issues=>{const pending=(issues??[]).filter(i=>i.kind==='pending-current-price-override').length,acquired=(issues??[]).filter(i=>i.kind==='acquired-item-payment-unclassified').length;return(pending?` Güncel fiyatı değişen ${pending} alım bütçe nedeniyle takvime alınamadı; fiyatları korunuyor, ödeme veya borç oluşmuş sayılmıyor.`:'')+(acquired?` Alındı işaretli ${acquired} kaydın ödeme günü ve yöntemi doğrulanmadı; ödeme gerçekleşmiş sayılmıyor.`:'');};
const ROUND=n=>Math.round((n+Number.EPSILON)*100)/100;
const quoted=s=>'"'+String(s).replaceAll('"','""')+'"';
const sheetFormula=s=>{let inString=false,result='';for(let i=0;i<s.length;i++){const c=s[i];if(c==='"'){if(inString&&s[i+1]==='"'){result+='""';i++;continue;}inString=!inString;}result+=c===','&&!inString?';':c;}return result;};
const numberFormula=n=>{error(Number.isFinite(n),'Nonfinite formula literal');if(Number.isInteger(n))return String(n);const [coefficient,exp='0']=String(n).toLowerCase().split('e'),negative=coefficient.startsWith('-'),parts=coefficient.replace('-','').split('.'),digits=parts.join('').replace(/^0+(?=\d)/,''),power=(parts[1]?.length??0)-Number(exp);const v=power>0?`${digits}/1${'0'.repeat(power)}`:`${digits}${'0'.repeat(-power)}`;return negative?`(-${v})`:`(${v})`;};
const literal=v=>typeof v==='number'?numberFormula(v):typeof v==='boolean'?v?'TRUE':'FALSE':quoted(v??'');
const entered=v=>v==null?{}:typeof v==='number'?{numberValue:v}:typeof v==='boolean'?{boolValue:v}:{stringValue:String(v)};
const cell=v=>({userEnteredValue:entered(v)});
const error=(condition,message)=>{if(!condition)throw new Error(message);};
const finite=v=>{error(typeof v==='number'&&Number.isFinite(v),'Expected finite projection amount');return ROUND(v);};
const state=c=>({entered:c?.userEnteredValue??{},effective:c?.effectiveValue??{}});
const equal=(a,b,tolerance=0)=>{const ak=Object.keys(a??{}),bk=Object.keys(b??{});return ak.length===bk.length&&ak.every(k=>typeof a[k]==='number'&&typeof b[k]==='number'?Number.isFinite(a[k])&&Number.isFinite(b[k])&&Math.abs(a[k]-b[k])<=tolerance:a[k]===b[k]);};
const addr=(title,row,col)=>`'${title.replaceAll("'","''")}'!${column(col)}${row+1}`;
const indirect=address=>`INDIRECT(${quoted(address)})`;

function grid(snapshot,title){const sheet=snapshot.sheets.find(s=>s.properties.title===title);error(sheet,'Missing sheet '+title);const rows=[];for(const block of sheet.data??[])for(const [i,row]of(block.rowData??[]).entries()){const y=(block.startRow??0)+i;rows[y]??=[];for(const[j,c]of(row?.values??[]).entries())rows[y][(block.startColumn??0)+j]=c??{};}return rows;}
const get=(snapshot,title,row,col)=>grid(snapshot,title)[row]?.[col]??{};
function guardFormula(dependency){
 const ref=indirect(dependency.address),ue=dependency.entered,ev=dependency.effective;
 const enteredCheck=ue.formulaValue!==undefined?`EXACT(IFERROR(FORMULATEXT(${ref}),""),${quoted(ue.formulaValue)})`:Object.keys(ue).length===0?(Object.keys(ev).length===0?`AND(NOT(ISFORMULA(${ref})),ISBLANK(${ref}))`:`NOT(ISFORMULA(${ref}))`):`AND(NOT(ISFORMULA(${ref})),${typedCheck(ref,ue,dependency.enteredTolerance??0)})`;
 return `=IFERROR(AND(${enteredCheck},${effectiveCheck(ref,dependency)}),FALSE)`;
}

function effectiveCheck(ref,d){
 if(d.effectiveMode==='formula-only')return 'TRUE';
 if(d.entered.formulaValue&&Object.keys(d.effective).length===0)return `OR(ISBLANK(${ref}),AND(TYPE(${ref})=2,LEN(${ref})=0))`;
 if(d.effectiveMode==='positive-number')return `AND(ISNUMBER(${ref}),${ref}>0)`;
 if(d.effectiveMode==='finite-number')return `ISNUMBER(${ref})`;
 if(d.effectiveMode==='live-savings')return `AND(ISNUMBER(${ref}),ABS(${ref}+ROUND(${indirect(d.liveReference)},2))<=1/1000000)`;
 if(d.effectiveMode==='live-plan-savings'){const c=column(d.planColumn),expected=`ROUND(${indirect('Plan!'+c+'58')}*${indirect("'_Kasa hesap'!DW1")}+${indirect('Plan!'+c+'59')}*${indirect("'_Kasa hesap'!DX1")}+${indirect('Plan!'+c+'60')}+${indirect('Plan!'+c+'61')},2)`;return `AND(ISNUMBER(${ref}),ABS(${ref}-(${expected}))<=1/1000000)`;}
 return typedCheck(ref,d.effective,d.tolerance);
}
function referencedValue(grids,ref){const m=ref.match(/^'?(.+?)'?!(\$?[A-Z]+)\$?(\d+)$/);if(!m)throw new Error('Unknown live reference');const col=[...m[2].replaceAll('$','')].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0)-1;return value(grids[m[1]]?.[Number(m[3])-1]?.[col]);}
function effectiveMatches(d,actual,grids){const n=actual.numberValue;if(d.effectiveMode==='formula-only')return true;
 if(!d.effectiveMode){if(d.entered.formulaValue&&Object.keys(d.effective).length===0)return Object.keys(actual).length===0||equal(actual,{stringValue:''});return equal(d.effective,actual,d.tolerance);}
 if(typeof n!=='number'||!Number.isFinite(n))return false;
 if(d.effectiveMode==='positive-number')return n>0;
 if(d.effectiveMode==='finite-number')return true;
 if(d.effectiveMode==='live-savings'){const v=referencedValue(grids,d.liveReference);return typeof v==='number'&&Number.isFinite(v)&&Math.abs(n+ROUND(v))<=.000001;}
 if(d.effectiveMode==='live-plan-savings'){const p=grids.Plan,c=d.planColumn,v=[57,58,59,60].map(r=>value(p[r]?.[c])),eur=value(grids['_Kasa hesap']?.[0]?.[126]),usd=value(grids['_Kasa hesap']?.[0]?.[127]);return [...v,eur,usd].every(Number.isFinite)&&Math.abs(n-ROUND(v[0]*eur+v[1]*usd+v[2]+v[3]))<=.000001;}
 return false;
}
function typedCheck(ref,expected,tolerance){
 if(expected.numberValue!==undefined)return `AND(ISNUMBER(${ref}),ABS(${ref}-(${numberFormula(expected.numberValue)}))<=${numberFormula(tolerance)})`;
 if(expected.boolValue!==undefined)return `AND(TYPE(${ref})=4,${ref}=${expected.boolValue?'TRUE':'FALSE'})`;
 if(expected.stringValue!==undefined)return `AND(TYPE(${ref})=2,EXACT(${ref},${quoted(expected.stringValue)}))`;
 return `ISBLANK(${ref})`;
}
function identity(snapshot,title,startRow,col){return grid(snapshot,title).slice(startRow).map(r=>value(r?.[col])).filter(v=>v!==undefined&&v!=='').map(v=>{error(typeof v==='string'&&!v.includes('|'),'Invalid identity key');return v;});}
function dependents(source,planningFx,inputEventRows){
 const dependencies=[];const ranges=[... (inputEventRows?inputEventRows.flatMap(r=>[['_Timeline kaynak',r,r+1,0,9],['_Timeline kaynak',r,r+1,9,12]]):[['Timeline',6,grid(source,'Timeline').length,0,9],['Timeline',6,grid(source,'Timeline').length,13,15]]),['Kasa',425,427,1,8],['_Taşınma akışı',100,196,0,8]];
 for(const row of[2,5,6,7,8,12,13,14,15,16,17,21,22,23,24,25,26,27,28,32,33,37,38,39,43,44,45,46,47])ranges.push(['Plan',row-1,row,2,16]);
 const usedKeys=new Set(grid(source,'_Taşınma akışı').slice(100,196).map(r=>value(r?.[0])).filter(Boolean));
 grid(source,'Arızi Giderler').forEach((row,index)=>{if(index>=4&&usedKeys.has(value(row?.[15])))for(const col of[0,15])ranges.push(['Arızi Giderler',index,index+1,col,col+1]);});
 for(const [title,r0,r1,c0,c1]of ranges){const rows=grid(source,title);const sheetId=source.sheets.find(s=>s.properties.title===title).properties.sheetId;for(let row=r0;row<r1;row++)for(let col=c0;col<c1;col++){const st=state(rows[row]?.[col]);error(!st.effective.errorValue,'Source formula error');dependencies.push({kind:'cell',title,sheetId,row,column:col,address:addr(title,row,col),...st,tolerance:st.effective.numberValue===undefined?0:.000001});}}
 const identities=[...(inputEventRows?[['_Timeline kaynak',1,0]]:[['Timeline',6,0]]),['_Taşınma akışı',100,0],['Arızi Giderler',4,15]].map(([title,startRow,column])=>({kind:'identity',title,startRow,column,values:identity(source,title,startRow,column)}));
 if(planningFx){
  const add=(title,row,col,mode,extra={})=>{let d=dependencies.find(d=>d.title===title&&d.row===row&&d.column===col);if(!d){const sh=source.sheets.find(s=>s.properties.title===title);error(sh,'Missing FX source '+title);const st=state(grid(source,title)[row]?.[col]);d={kind:'cell',title,sheetId:sh.properties.sheetId,row,column:col,address:addr(title,row,col),...st,tolerance:.000001};dependencies.push(d);}if(mode)d.effectiveMode=mode;Object.assign(d,extra);};
  for(const col of[126,127])add('_Kasa hesap',0,col,'positive-number');
  for(let col=2;col<16;col++){for(let row=57;row<=60;row++)add('Plan',row,col);add(source.sheets.some(s=>s.properties.title==='_Finans ham')?'_Finans ham':'Kasa',source.sheets.some(s=>s.properties.title==='_Finans ham')?6:15,col,'live-plan-savings',{planColumn:col});}
  for(let col=2;col<28;col++){for(let row=46;row<=49;row++)add('_Taşınma akışı',row,col);for(const row of[11,12])add('_Taşınma akışı',row,col,'finite-number');}add('_Taşınma akışı',4,1);
  for(const s of planningFx.savingEvents){if(!inputEventRows)add('Timeline',s.timelineRow,6,'live-savings',{liveReference:s.liveReference});add('_Timeline kaynak',s.sourceRow,6,'live-savings',{liveReference:s.liveReference});}
 }
 return{dependencies,identities};
}
export function buildFinance({source,result,ledger,facts,sourceHash,engineHash,targetSpreadsheetId=source.spreadsheetId,additionalDependencies=[],inputEventRows,formulaOnlyAddresses=[],ownedSheetIds}){
 error(result.source.sha256===sourceHash,'Source snapshot hash mismatch');error(result.sourceStats.validated===true,'Source preflight incomplete');
 const existing=new Set(source.sheets.map(s=>s.properties.sheetId));let id=ownedSheetIds?.view??7302700;if(!ownedSheetIds)while(existing.has(id)||existing.has(id+1))id+=2;
 error(!source.sheets.some(s=>['Finansman','_Finans kontrol'].includes(s.properties.title)),'Owned sheets already exist; explicit regeneration migration required');
 const sheets=[{title:'Finansman',sheetId:id},{title:'_Finans kontrol',sheetId:ownedSheetIds?.control??id+1}],view=id,control=ownedSheetIds?.control??id+1;
 const manifest={schema:'finance-v1',sourceSpreadsheetId:source.spreadsheetId,targetSpreadsheetId,sourceHash,engineHash,sheets,outputs:[],guards:[],inputs:[],cells:[],staleText:STALE,monthHeaders:MONTH_HEADERS,dayHeaders:DAY_HEADERS,...dependents(source,result.planningFx,inputEventRows)};
 for(const d of additionalDependencies){error(!manifest.dependencies.some(e=>e.title===d.title&&e.row===d.row&&e.column===d.column),'Duplicate additional dependency');manifest.dependencies.push(d);}
 for(const address of formulaOnlyAddresses){const d=manifest.dependencies.find(d=>d.address===address);error(d?.entered.formulaValue,'Formula-only source must be a known formula');d.effectiveMode='formula-only';}
 const pages=new Map(sheets.map(s=>[s.sheetId,[]]));
 const put=(sheetId,row,column,c)=>{const page=pages.get(sheetId);page[row]??=[];page[row][column]=c;manifest.cells.push({sheetId,row,column,entered:c.userEnteredValue??{}});};
 const text=(sheetId,row,col,v)=>put(sheetId,row,col,cell(v));
 const formula=(sheetId,row,col,v)=>put(sheetId,row,col,{userEnteredValue:{formulaValue:sheetFormula(v)}});
 const output=(row,col,v)=>{if(typeof v==='number')finite(v);const f=sheetFormula(`=IF('_Finans kontrol'!$B$2,${literal(v)},"")`);formula(view,row,col,f);manifest.outputs.push({sheetId:view,row,column:col,formula:f,value:v});};
 text(view,0,0,'Finansman · ödeme kapasitesi');formula(view,1,0,`=IF('_Finans kontrol'!$B$2,"Koşullu finansman hesabı · gerçekleşmiş ödeme değildir",${quoted(STALE)})`);formula(view,2,0,`=IF('_Finans kontrol'!$B$2,"TRUE","FALSE")`);
 text(view,3,0,String(ledger.ledger.length));text(view,4,0,String(result.candidate.monthEnds.length));text(view,5,0,'finance-v1');text(view,6,0,sourceHash);
 text(view,7,0,'Harcanabilir nakit ayrılmış bütçeler düşüldükten sonradır; banka bakiyesi veya gerçekleşmiş ödeme değildir. Birikimden aktarım gelir değildir.');
 text(view,8,0,'Gelecek faiz, valör ve eski KMH tahakkuku bilinmiyor. Net nakit ve borç döviz/altın, eşya değeri ve bilinmeyen eski tahakkuku içermez.'+(result.planningFx?` Birikim TL planı ${result.planningFx.asOfDate} sabit kuruyla: EUR ${result.planningFx.eurTry} / USD ${result.planningFx.usdTry}; gelecek alım kuru değildir. Canlı kur hareketi bu tarihli planı değiştirmez.`:'')+currentIssueNote(result.currentIssues));
 MONTH_HEADERS.forEach((v,c)=>text(view,10,c,v));
 result.candidate.monthEnds.forEach((m,i)=>[m.month,m.cash,m.kmh,m.kmhAccrued,m.cardDebt,m.futureInstallments??0,m.reserveBalance??0,m.knownNetAssets??ROUND(m.cash-m.kmh-m.kmhAccrued-m.cardDebt),m.unfundedCash??0].forEach((v,c)=>output(i+11,c,c?finite(v):v)));
 DAY_HEADERS.forEach((v,c)=>text(view,42,c,v));
 let previous=finite(facts.openingCash)-finite(facts.overdraft.openingUsedPrincipal);const seen=new Set();let previousDate='';
 const typeLabels={opening:'Başlangıç','reserve-transfer':'Birikimden aktarım',cash:'Nakit hareketi',purchase:'Kart alışverişi','card-payment':'Kart ödemesi',statement:'Hesap kesimi','month-end':'Ay sonu'};
 ledger.ledger.forEach((r,i)=>{error(typeof r.id==='string'&&r.id&&!seen.has(r.id),'Duplicate or missing ledger ID');seen.add(r.id);error(/^\d{4}-\d{2}-\d{2}$/.test(r.date)&&r.date>=previousDate,'Ledger chronology invalid');previousDate=r.date;const dn=r.cards.Denizbank,isb=r.cards['İşbank'];error(dn&&isb,'Both card states required');const signed=finite(r.cashRequiredBalance),delta=ROUND(signed-previous);previous=signed;const cardTotal=finite(r.cardDebt);error(Math.abs(cardTotal-dn.committedPrincipal-dn.charges-isb.committedPrincipal-isb.charges)<=.000001,'Card debt mismatch');const certainty=r.sourceDateStatus==='Tarih varsayımı'?'Ödeme günü bilinmiyor · ay başı bütçe rezervi':r.type==='reserve-transfer'?'Teyitli kaynak · aktarım planı':`Koşullu hesap · ${r.sourceDateStatus??'planlanan hesap günü'}`;
 const row=[r.date,r.label??(r.bank?`${r.bank} · ${typeLabels[r.type]??r.type}`:typeLabels[r.type]??r.id),r.executionKind==='budget-reservation'?'Bütçe ayırma':r.type==='cash'&&r.sourceType==='Gelir'?'Gelir':typeLabels[r.type]??r.type,delta,signed,finite(r.cash),finite(r.overdraftPrincipal),finite(r.overdraftAccruedCost),finite(dn.committedPrincipal),finite(dn.charges),finite(isb.committedPrincipal),finite(isb.charges),finite(dn.futureInstallmentPrincipal+isb.futureInstallmentPrincipal),cardTotal,finite(r.unfundedCash),certainty,[r.source??'Finansman motoru',r.sourceNote??''].filter(Boolean).join(' · '),r.id];
 for(const c of[5,6,7,8,9,10,11,12,13,14])error(row[c]>=0,'Negative asset/principal/cost');row.forEach((v,c)=>output(i+43,c,v));});
 manifest.eventCount=ledger.ledger.length;manifest.monthCount=result.candidate.monthEnds.length;manifest.ranges={metadata:'Finansman!A1:A9',monthly:`Finansman!A11:I${11+manifest.monthCount}`,daily:`Finansman!A43:R${43+manifest.eventCount}`};
 text(view,9,10,'Teyitli bilgiler / model girdileri');text(view,9,11,'Değer');text(view,9,12,'Açıklama');
 const inputRows=[['openingCash','Başlangıç işletme nakdi',facts.openingCash,'Teyitli'],['reserveAmount','Mevcut TL birikimi',facts.existingReserve?.amount??null,'Mevcut varlık; gelir değildir'],['reserveCap','İlk üç ay toplam aktarım tavanı',facts.existingReserve?.maximumTotalTransfer??null,'Toplam; aylık değildir'],['reserveStart','Aktarım dönemi başlangıcı',facts.existingReserve?.availableFrom??null,'Önerilen yürütme penceresi'],['reserveEnd','Aktarım dönemi sonu',facts.existingReserve?.transferWindowEnd??null,'İlk üç ay'],['kmhLimit','KMH limiti',facts.overdraft.limit,'Teyitli'],['kmhPrincipal','Başlangıç KMH anapara',facts.overdraft.openingUsedPrincipal,'Tamamı kullanılmış'],['isCashAdvance','İşbank kullanılabilir nakit avans',facts.cashAdvanceAvailable?.['İşbank']??null,'Teyitli; yeni kaynak eklenmez'],['denizCashAdvance','Denizbank kullanılabilir nakit avans',facts.cashAdvanceAvailable?.Denizbank??null,'Teyitli; yeni kaynak eklenmez'],['kmhOldInterest','Eski KMH faiz tahakkuku',facts.overdraft.openingAccruedInterest??null,'Bilinmiyor; sıfır kabul edilmedi'],['kmhOldTax','Eski KMH vergi tahakkuku',facts.overdraft.openingAccruedTax??null,'Bilinmiyor; sıfır kabul edilmedi'],['denizAutoFee','Denizbank otomatik fatura ücreti',null,'Bilinmiyor; hesap alt sınır senaryosu'],['confirmedDue','Kasım İşbank son ödeme',result.confirmedOpeningDueDate??null,'Kullanıcı teyidi'],['tariffHash','Tarife kaynak sürümü',result.source.tariffSha256??'synthetic','Gelecek dönem oranı kesin değil']];
 for(const [i,[key,label,v,note]]of inputRows.entries()){text(view,10+i,10,label);text(view,10+i,11,v);text(view,10+i,12,note);manifest.inputs.push({key,value:v,sheetId:view,row:10+i,column:11});manifest.dependencies.push({kind:'cell',title:'Finansman',sheetId:view,row:10+i,column:11,address:addr('Finansman',10+i,11),entered:entered(v),effective:entered(v),tolerance:0,isInput:true});}
 if(result.planningFx){for(const [i,[key,label,v]]of [['planningEurTry','EUR/TRY plan kuru',result.planningFx.eurTry],['planningUsdTry','USD/TRY plan kuru',result.planningFx.usdTry],['planningFxDate','Kur tabanı tarihi',result.planningFx.asOfDate]].entries()){const row=35+i;text(view,row,10,label);text(view,row,11,v);text(view,row,12,'Tarih/veri tabanı; gelecek gerçekleşen kur değildir');manifest.inputs.push({key,value:v,sheetId:view,row,column:11});manifest.dependencies.push({kind:'cell',title:'Finansman',sheetId:view,row,column:11,address:addr('Finansman',row,11),entered:entered(v),effective:entered(v),tolerance:typeof v==='number'?.000001:0,enteredTolerance:typeof v==='number'?.000001:0,isInput:true});}manifest.planningFx=result.planningFx;}
 text(view,26,10,'Planlanan toplam aktarım');output(26,11,result.existingReserve?.totalTransferred??0);text(view,27,10,'Aktarılmamış TL birikimi');output(27,11,result.existingReserve?.remaining??0);text(view,28,10,'İlk maaştan önce zorunlu nakit');output(28,11,result.openingRequirement.amount);text(view,29,10,'Aktarımlar gerçekleşmedi');text(view,29,11,'Yürütme planı');
 text(view,31,10,'Bütçe rezervi');text(view,31,11,'Yarısı bizden günü bilinmiyor. Ayın ilk günü kullanılabilir bütçeden ayrılır; fiili ödeme kaydında ikinci kez gider yazılmaz.');
 text(view,33,10,'Faiz ve tarih sınırı');text(view,33,11,'Son yayımlanan oranların ileri taşınması senaryodur. Banka valörü, gerçek mahsup ve eski tahakkuk doğrulanınca hesap yenilenir.');
 text(control,0,0,'Finansman kaynak doğrulaması');text(control,2,0,'Kaynak SHA');text(control,2,1,sourceHash);text(control,3,0,'Motor SHA');text(control,3,1,engineHash);text(control,4,0,'Üretim zamanı');text(control,4,1,result.generatedAt);text(control,5,0,'Kimlik');text(control,5,1,source.spreadsheetId);
 const guardStart=10;let gRow=guardStart;
 const grouped=new Map();manifest.dependencies.forEach((d,index)=>{const key=d.title+':'+d.row;if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(index);});
 for(const indices of grouped.values()){const ds=indices.map(index=>manifest.dependencies[index]),formulaText=sheetFormula('=AND('+ds.map(d=>guardFormula(d).slice(1)).join(',')+')');text(control,gRow,0,ds.map(d=>d.address).join(' | '));text(control,gRow,1,'Tür + formül + değer');text(control,gRow,2,indices.length);formula(control,gRow,6,formulaText);manifest.guards.push({kind:'cell-group',dependencies:indices,isInput:ds.some(d=>d.isInput),guardRow:gRow,formula:formulaText});gRow++;}
 for(const d of manifest.identities){const ref=indirect(`'${d.title}'!${column(d.column)}${d.startRow+1}:${column(d.column)}`);const f=`=IFERROR(EXACT(TEXTJOIN("|",TRUE,FILTER(${ref},${ref}<>"")),${quoted(d.values.join('|'))}),${d.values.length===0?'TRUE':'FALSE'})`;text(control,gRow,0,d.title+' kimlik sırası');formula(control,gRow,6,f);manifest.guards.push({...d,guardRow:gRow,formula:f});gRow++;}
 formula(control,1,1,`=IFERROR(AND(COUNTIF(G${guardStart+1}:G${gRow},TRUE)=${gRow-guardStart},COUNTA(G${guardStart+1}:G${gRow})=${gRow-guardStart}),FALSE)`);
 manifest.guardRange=`'_Finans kontrol'!G${guardStart+1}:G${gRow}`;
 const costsStart=45+ledger.ledger.length;manifest.ranges.costs=`Finansman!A${costsStart+1}:F${costsStart+1+result.financeCosts.length}`;['Tarih','Banka','Maliyet türü','Faiz','Vergi','Toplam'].forEach((v,c)=>text(view,costsStart,c,v));result.financeCosts.forEach((r,i)=>[r.date,r.bank,r.kind,r.interest,r.tax,r.total].forEach((v,c)=>output(costsStart+1+i,c,v==null?'Bilinmiyor':v)));
 const requests=sheets.map(s=>({addSheet:{properties:{...s,hidden:s.sheetId===control,gridProperties:{rowCount:Math.max(100,pages.get(s.sheetId).length+5),columnCount:18,frozenRowCount:s.sheetId===view?7:1}}}}));
 for(const s of sheets){const page=pages.get(s.sheetId);const columns=s.sheetId===view?18:7,chunk=Math.floor(500/columns);for(let start=0;start<page.length;start+=chunk){const slice=Array.from({length:Math.min(chunk,page.length-start)},(_,index)=>({values:Array.from({length:columns},(_,c)=>page[start+index]?.[c]??{})}));requests.push({updateCells:{range:{sheetId:s.sheetId,startRowIndex:start,endRowIndex:start+slice.length,startColumnIndex:0,endColumnIndex:columns},rows:slice,fields:'userEnteredValue'}});}requests.push({repeatCell:{range:{sheetId:s.sheetId,startRowIndex:0,endRowIndex:page.length,startColumnIndex:0,endColumnIndex:18},cell:{userEnteredFormat:{textFormat:{fontFamily:'Outfit',fontSize:14,foregroundColor:{red:.11,green:.23,blue:.30}},verticalAlignment:'TOP',wrapStrategy:'WRAP'}},fields:'userEnteredFormat'}});}
 const header={backgroundColor:{red:.11,green:.23,blue:.30},textFormat:{fontFamily:'Outfit',fontSize:14,bold:true,foregroundColor:{red:1,green:1,blue:1}}};for(const [row,end]of[[0,18],[10,9],[42,18],[costsStart,6]])requests.push({repeatCell:{range:{sheetId:view,startRowIndex:row,endRowIndex:row+1,startColumnIndex:0,endColumnIndex:end},cell:{userEnteredFormat:header},fields:'userEnteredFormat'}});
 for(const [start,end,width]of[[0,1,140],[1,2,310],[2,3,180],[3,15,160],[15,18,310]])requests.push({updateDimensionProperties:{range:{sheetId:view,dimension:'COLUMNS',startIndex:start,endIndex:end},properties:{pixelSize:width},fields:'pixelSize'}});
 for(const range of[{startRowIndex:11,endRowIndex:11+manifest.monthCount,startColumnIndex:1,endColumnIndex:9},{startRowIndex:43,endRowIndex:43+manifest.eventCount,startColumnIndex:3,endColumnIndex:15}])requests.push({repeatCell:{range:{sheetId:view,...range},cell:{userEnteredFormat:{numberFormat:{type:'NUMBER',pattern:'#,##0.00 "₺"'},horizontalAlignment:'RIGHT'}},fields:'userEnteredFormat.numberFormat,userEnteredFormat.horizontalAlignment'}});
 for(const [r,c1]of[[0,18],[1,18],[7,18],[8,18]])requests.push({mergeCells:{range:{sheetId:view,startRowIndex:r,endRowIndex:r+1,startColumnIndex:0,endColumnIndex:c1},mergeType:'MERGE_ALL'}});
 return{requests,manifest};
}
export function checkDependencies(manifest,snapshot,{includeInputs=false}={}){
 const failures=[];if(![manifest.sourceSpreadsheetId,manifest.targetSpreadsheetId].includes(snapshot.spreadsheetId))failures.push({kind:'workbook-identity',actual:snapshot.spreadsheetId});const grids=Object.fromEntries(snapshot.sheets.map(s=>[s.properties.title,grid(snapshot,s.properties.title)]));for(const d of manifest.dependencies){if(d.isInput&&!includeInputs)continue;const sheet=snapshot.sheets.find(s=>s.properties.title===d.title);if(!sheet||sheet.properties.sheetId!==d.sheetId){failures.push({kind:'sheet-identity',address:d.address});continue;}const actual=state(grids[d.title]?.[d.row]?.[d.column]);if(!equal(d.entered,actual.entered,d.enteredTolerance??0))failures.push({kind:'entered',address:d.address});if(!effectiveMatches(d,actual.effective,grids))failures.push({kind:'effective',address:d.address});}
 for(const d of manifest.identities)if(JSON.stringify(identity(snapshot,d.title,d.startRow,d.column))!==JSON.stringify(d.values))failures.push({kind:'identity',title:d.title});return failures;
}
