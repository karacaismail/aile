import { lazy, Suspense, useMemo, useRef, useState } from 'react';
import { Checkbox, NumberInput, TextInput, Tabs } from '@mantine/core';
import { useReducedMotion } from '@mantine/hooks';
import { Select } from '../dashboard/Select';
import catalog from './catalog.json';
import { simulate, minimumCash, RULE_DATE, sources, MAX_MONEY, moneyAmount, type FinanceInput } from './finance';
import { money, type Budget } from '../dashboard/data';
import { DataTable, type Column } from '../dashboard/DataTable';
import { tokens, dropdownTransition } from '../dashboard/tokens';
import './vehicle.css';
import VehicleGallery from './VehicleGallery';
import { Disclosure } from './Disclosure';
import { FinanceSummary } from './FinanceSummary';
const PaymentChart = lazy(() => import('./PaymentChart'));
type Vehicle = typeof catalog[number];
type Variant = Vehicle['years'][number];
const STORAGE = 'aile:finance-input:v1';
const dateLabel = (month: string, offset: number) => { const [y,m]=month.split('-').map(Number); return new Date(Date.UTC(y,m-1+offset,1)).toLocaleDateString('tr-TR',{month:'long',year:'numeric',timeZone:'UTC'}); };
const initial: FinanceInput = {price:0,value:0,year:2017,startYear:new Date().getFullYear(),autoProvider:'koc',personalProvider:'enpara',autoRate:3.5,personalRate:4,autoMonths:36,personalMonths:36,cash:0,contingencyCash:0,applicantIncome:0,spouseIncome:0,householdIncome:0,existingPersonalPrincipal:null,existingDebt:null,livingCost:null,reserve:0,runningCost:0,otherUpfront:0,debtRatio:40,personalLimit:800000,vehicleVerified:false,sellerApproved:false,creditHistory:'unknown'};
function loadProfile(): Partial<FinanceInput> { try { const saved=JSON.parse(localStorage.getItem(STORAGE)??'{}'); const fields=['cash','contingencyCash','applicantIncome','spouseIncome','householdIncome','existingPersonalPrincipal','existingDebt','livingCost','reserve','runningCost','otherUpfront']; return Object.fromEntries(fields.filter(k=>saved[k]===null&&['existingPersonalPrincipal','existingDebt','livingCost'].includes(k)||moneyAmount.safeParse(saved[k]).success).map(k=>[k,saved[k]])); } catch { return {}; } }
function assessment(car: Vehicle) {
  if(car.id==='toyota-corolla')return 'İlk araştırılacak adayım: 2015–2017 Corolla. Listedeki daha düşük fiyatlı aile sedanlarından biri. Öncelik tam paket yerine bakımlı araç, doğru motor/şanzıman ve nakit peşinat olmalı. Bu bir arıza olasılığı puanı değildir; ekspertiz ve servis kaydı belirleyicidir.';
  if(car.id==='citroen-c5')return 'Daha düşük alım bedeli finansman yükünü azaltır. Buna karşılık yaş, motor/şanzıman ve varsa hidropnömatik süspansiyon için uzman ekspertiz ve bakım bütçesi ayırmadan yalnız ucuzluğuna göre seçmeyin.';
  if(/Peugeot/.test(car.name))return '1.2 PureTech motorlu örneklerde motor kodu, bakım belgeleri ve üreticinin koşullu garanti kapsamı özellikle kontrol edilmeli. Diğer motorlara aynı sonucu taşımayın.';
  if(/Audi|Mercedes|Volvo|Range Rover|Land Rover|Touareg/.test(car.name))return 'Bu senaryoda öncelikli tercihim değil: satın alma fiyatının yanında yaş, bakım ve arıza için nakit tamponu gerekiyor. Peşinatın tamamı da kredi olacaksa üst sınıf araç bütçe baskısını artırır. Bu değerlendirme bir güvenilirlik skoru değildir.';
  if(car.body==='Pick-up')return 'Yük taşıma veya arazi ihtiyacı yoksa aile bütçesi için önce binek alternatiflerini değerlendirin. Ruhsattaki araç sınıfı ve ticari kredi koşulları görülmeden binek finansmanı hesaplanmaz.';
  return 'Bu modeli gövde ihtiyacı, gerçek servis geçmişi ve toplam sahip olma maliyetiyle karşılaştırın. Model adı tek başına sorunsuzluk kanıtı değildir; seçili motor, şanzıman, kilometre ve ekspertiz raporu gerekir.';
}
export default function VehiclePage({ budget }: { budget: Budget | null }) {
  const vehicleTab = useRef<HTMLButtonElement>(null);
  const rulesTab = useRef<HTMLButtonElement>(null);
  const [onlyEligible,setOnlyEligible]=useState(false);
  const [body,setBody]=useState('Tümü'); const [model,setModel]=useState('toyota-corolla'); const [year,setYear]=useState(2017);
  const car=catalog.find(c=>c.id===model)!; const variant=car.years.find(y=>y.year===year)??car.years.at(-1)!;
  const [input,setInput]=useState<FinanceInput>(()=>({...initial,...loadProfile(),price:variant.price,value:variant.price,year:variant.year}));
  const [startMonth,setStartMonth]=useState(new Date().toISOString().slice(0,7));
  const [editor,setEditor]=useState<string|null>('vehicle');
  const [tab,setTab]=useState<string|null>('payments'); const [query,setQuery]=useState(''); const [saved,setSaved]=useState(false);
  const [otherAutoRate,setOtherAutoRate]=useState(3.5); const [otherPersonalRate,setOtherPersonalRate]=useState(4);
  const [showChart,setShowChart]=useState(false); const reduced=useReducedMotion();
  const selectProps={allowDeselect:false,withScrollArea:false,comboboxProps:{withinPortal:false,transitionProps:{duration:reduced?0:tokens.duration,timingFunction:tokens.ease,transition:dropdownTransition}}};
  const update=<K extends keyof FinanceInput>(key:K,value:FinanceInput[K])=>{setInput(prev=>({...prev,[key]:value}));setSaved(false);};
  const choose=(next:Vehicle, selected?:Variant)=>{const v=selected??next.years.at(-1)!;setModel(next.id);setYear(v.year);setInput(prev=>({...prev,price:v.price,value:v.price,year:v.year,vehicleVerified:false,vehicleClass:next.body==='Pick-up'?'commercial':'passenger'}));setSaved(false);};
  const effective={...input,startYear:+startMonth.slice(0,4),vehicleClass:car.body==='Pick-up'?'commercial' as const:'passenger' as const};
  const result=useMemo(()=>{try{return simulate(effective);}catch{return null;}},[input,startMonth,car.body]);
  const cashTarget=useMemo(()=>result?minimumCash(effective):null,[input,startMonth,car.body,result]);
  const monthOptions=Array.from({length:48},(_,i)=>{const y=new Date().getFullYear()+Math.floor(i/12);const m=i%12+1;return {value:`${y}-${String(m).padStart(2,'0')}`,label:dateLabel(`${y}-${String(m).padStart(2,'0')}`,0)};});
  const number=(key:keyof FinanceInput,label:string,description?:string,options:{max?:number;nullable?:boolean;blankZero?:boolean;decimal?:number}={})=><NumberInput label={label} description={description} value={options.blankZero&&input[key]===0?'':(input[key]??'') as number|string} onChange={v=>update(key,(v===''?(options.nullable?null:0):Number(v)) as never)} min={0} max={options.max??MAX_MONEY} decimalScale={options.decimal??0} allowNegative={false} hideControls inputMode="decimal" />;
  const eligibleYears=(candidate:Vehicle)=>candidate.years.filter(v=>{
    if(!onlyEligible)return true;
    try {
      const candidateInput={...effective,year:v.year,price:v.price,value:v.price,vehicleClass:candidate.body==='Pick-up'?'commercial' as const:'passenger' as const};
      const r=simulate(candidateInput);
      return r.status==='Koşullu uygun'||r.status==='Kredi gerekmiyor';
    } catch { return false; }
  });
  const filtered=catalog.filter(c=>(body==='Tümü'||c.body===body)&&eligibleYears(c).length>0);
  const modelYears=eligibleYears(car);
  const rows=filtered.filter(c=>`${c.name} ${c.package}`.toLocaleLowerCase('tr').includes(query.toLocaleLowerCase('tr'))).flatMap(c=>eligibleYears(c).map(v=>({...v,car:c})));
  const yearChecks=onlyEligible?car.years.map(v=>{try{return {year:v.year,result:simulate({...effective,year:v.year,price:v.price,value:v.price})};}catch{return {year:v.year,result:null};}}):[];
  const filterProviders=`${input.autoProvider==='koc'?'Koçfinans':'Garanti BBVA'} + ${input.personalProvider==='enpara'?'Enpara':input.personalProvider==='garanti-digital'?'Garanti BBVA dijital':'Kendi teklifiniz'}`;
  const filterSelectionHidden=onlyEligible&&(!filtered.some(c=>c.id===model)||!modelYears.some(v=>v.year===variant.year));
  type CatalogRow=typeof rows[number];
  const cols:Column<CatalogRow>[]=[
    {key:'model',label:'Model / gövde',value:r=>r.car.name,render:r=><button className="text-button" onClick={()=>{choose(r.car,r);setEditor('vehicle');vehicleTab.current?.focus();}}>{r.car.name}<small>{r.car.body} · {r.year}</small></button>},
    {key:'year',label:'Model yılı',value:r=>r.year,render:r=>r.year},
    {key:'market',label:'İlan göstergesi',numeric:true,value:r=>r.price,render:r=>money(r.price)},
    {key:'claim',label:'İkinci dosya · paket iddiası',numeric:true,value:r=>r.upperClaim??null,render:r=><>{r.upperClaim?money(r.upperClaim):'Kapsamda yok'}<small>Tam paket fiyatı teyitsiz</small></>},
    {key:'sample',label:'İlan adedi',numeric:true,value:r=>r.sample,render:r=>r.sample},
    {key:'source',label:'Kaynak',value:r=>r.car.name,render:r=><a href={r.car.url} target="_blank" rel="noreferrer">Model / yıl verisi</a>},
  ];
  const paymentCols:Column<NonNullable<typeof result>['schedule'][number]>[]=[
    {key:'month',label:'Ödeme ayı',value:r=>r.month,render:r=>dateLabel(startMonth,r.month)},
    ...(['auto','personal','payment','principal','interest','tax','balance'] as const).map((key,i)=>({key,label:['Taşıt taksiti','İhtiyaç taksiti','Toplam taksit','Anapara','Faiz','KKDF + BSMV','Kalan borç'][i],numeric:true,value:(r:NonNullable<typeof result>['schedule'][number])=>r[key],render:(r:NonNullable<typeof result>['schedule'][number])=>money(r[key])})),
  ];
  const validOtherRate=(value:number)=>Number.isFinite(value)&&value>=0&&value<=20;
  const alternativesValid=validOtherRate(otherAutoRate)&&validOtherRate(otherPersonalRate);
  const alternatives=result&&alternativesValid?(['koc','garanti'] as const).flatMap(autoProvider=>(['enpara','garanti-digital'] as const).map(personalProvider=>({name:`${autoProvider==='koc'?'Koçfinans':'Garanti BBVA'} + ${personalProvider==='enpara'?'Enpara':'Garanti BBVA dijital'}`,result:simulate({...effective,autoProvider,personalProvider,autoRate:autoProvider===input.autoProvider?input.autoRate:otherAutoRate,personalRate:personalProvider===input.personalProvider?input.personalRate:otherPersonalRate})}))):[];
  const impact=result&&budget?budget.months.filter(m=>m.key>=startMonth).map(m=>{const offset=(+m.key.slice(0,4)-+startMonth.slice(0,4))*12+(+m.key.slice(5)-+startMonth.slice(5));const payment=result.schedule[offset-1]?.payment??0;return {label:m.label,source:m.source,before:m.free.current,loan:payment,after:m.free.current-payment-input.runningCost-(offset===0?(result.upfront-result.contingencyUsed):0)};}):[];
  return <div className="vehicle-page">
    <header className="vehicle-heading"><div><h1>Araç ve finansman</h1><p className="muted">Seç, hesapla, karşılaştır.</p></div><p className="muted">37 model · 206 model/yıl · En fazla 3 milyon ₺</p></header>
    <div className="scenario-context"><strong>{car.name} · {variant.year}</strong><span>{dateLabel(startMonth,0)}</span><span>Alım tutarı <strong>{money(input.price)}</strong></span>{result&&<button className="context-result" onClick={()=>document.getElementById('finance-conclusion')?.focus()}>En yüksek taksit <strong>{money(result.peakPayment)}</strong><span className="context-action">Sonuca git</span></button>}</div>
    <div className="scenario-workspace">
      <Tabs value={editor} onChange={setEditor} keepMounted keepMountedMode="display-none" unstyled className="workspace-tabs scenario-editor" data-testid="scenario-editor">
        <Tabs.List aria-label="Senaryo ayarları"><Tabs.Tab ref={vehicleTab} value="vehicle">Araç</Tabs.Tab><Tabs.Tab value="budget">Bütçe</Tabs.Tab><Tabs.Tab value="credit">Kredi</Tabs.Tab></Tabs.List>
        <Tabs.Panel value="vehicle">
          <div className="vehicle-choice">
      <div className="form-grid"><Select label="Araç türü" value={body} onChange={v=>{if(v){setBody(v);const next=catalog.find(c=>(v==='Tümü'||c.body===v)&&eligibleYears(c).length);if(next&&v!=='Tümü'&&car.body!==v)choose(next,eligibleYears(next)[0]);}}} data={['Tümü','Sedan','SUV','Pick-up']} {...selectProps}/><Select label="Model" value={filterSelectionHidden?null:model} placeholder="Araç seçin" onChange={v=>{const c=catalog.find(c=>c.id===v);if(c)choose(c,eligibleYears(c)[0]);}} searchable data={filtered.map(c=>({value:c.id,label:c.name}))} {...selectProps}/><Select label="Model yılı" value={filterSelectionHidden?null:String(variant.year)} placeholder="Yıl seçin" onChange={v=>choose(car,car.years.find(y=>String(y.year)===v))} data={modelYears.map(v=>String(v.year))} {...selectProps}/><Select label="Alım ayı" value={startMonth} onChange={v=>v&&setStartMonth(v)} data={monthOptions} {...selectProps}/></div>

            <button type="button" role="switch" aria-checked={onlyEligible} aria-describedby="eligibility-help" className="eligibility-switch" onClick={()=>setOnlyEligible(v=>!v)}><span className="switch-track" aria-hidden="true"><span/></span><span>Yalnız koşulları karşılayanları göster</span></button>
            <p id="eligibility-help" className="muted">Seçili finansörlerin ürün sınırlarına göre; koşullu uygunlar dahil. Kişisel kredi onayı değildir.</p>
            <p data-testid="catalog-filter-count" className="filter-count" role="status">{onlyEligible?`${rows.length} model/yıl koşulları karşılıyor`:`${rows.length} model/yıl gösteriliyor`}</p>
            {filterSelectionHidden&&<p role="status" className="inline-warning">Son seçiminiz filtre dışında; hesabı korunuyor. Uygun bir model/yıl seçebilirsiniz.</p>}
            {!filtered.length&&<p role="status">Bu koşulları karşılayan araç yok. Filtreyi kapatabilir veya kredi seçeneklerini değiştirebilirsiniz.</p>}
            <VehicleGallery key={car.id} model={car.id as Parameters<typeof VehicleGallery>[0]['model']} name={car.name}/>
            <div className="form-grid">{number('price','Alım fiyatı','Gerçek satış tutarı; en fazla 3 milyon ₺.',{max:3000000})}{number('value','TSB kasko değeri','İlan göstergesiyle başladı; gerçek TSB değerini girin.')}</div>
            <Disclosure label="Fiyat kaynağı ve araç değerlendirmesi">
              <p><strong>{money(variant.price)}</strong> · {variant.sample} ilandan model/yıl göstergesi. Satış teklifi veya kasko değeri değildir.</p>
              <p>Karışık donanım aralığı: {money(variant.low)} – {money(variant.high)}. Seçilebilir alım tutarı 3 milyon ₺ ile sınırlıdır.</p>
              <p><strong>Dosyadaki paket:</strong> {car.package}. Bu paketin seçili yıldaki fiyatı doğrulanmış değildir.</p>
              {variant.upperClaim&&<p>İkinci dosyanın teyitsiz paket iddiası: {money(variant.upperClaim)}. Kilometre/paket veya tahmin yöntemi farklı olabilir.</p>}
              <a href={car.url} target="_blank" rel="noreferrer">Fiyat kaynağını incele</a><p>{assessment(car)}</p>
              {/Peugeot/.test(car.name)&&<a href="https://www.peugeot.com.tr/satis-sonrasi/mobilite-cozumleri-ve-sozlesmeler/1.2_puretech_motorlari_garanti_uzatimi.html" target="_blank" rel="noreferrer">Üreticinin koşullu PureTech açıklaması</a>}{car.id==='honda-accord'&&<p>{car.note}</p>}
            </Disclosure>
            {onlyEligible&&<Disclosure label="Diğer model yılları neden eleniyor?"><p>{filterProviders} · Yedek nakit {money(input.contingencyCash??0)}. Adayların ilan göstergesi geçici fiyat/kasko değeridir; diğer kurumların tamamı taranmaz.</p><DataTable rows={yearChecks} rowKey={r=>String(r.year)} caption={`${car.name} · yıllara göre koşullar`} columns={[
              {key:'year',label:'Yıl',value:r=>r.year,render:r=>r.year},
              {key:'status',label:'Ürün sonucu',value:r=>r.result?.status??'',render:r=>r.result?.status??'Alım yılı model yılından önce'},
              {key:'reserve',label:'Gereken yedek',numeric:true,value:r=>r.result?.contingencyUsed??0,render:r=>money(r.result?.contingencyUsed??0)},
              {key:'gap',label:'Kalan kredi açığı',numeric:true,value:r=>r.result?.fundingGap??0,render:r=>money(r.result?.fundingGap??0)},
            ]}/></Disclosure>}
          </div>
        </Tabs.Panel>
        <Tabs.Panel value="budget">
          <p className="panel-help">Girişler bu cihazda kalır. Bilinmeyen borç ve gideri boş bırakın; yoksa 0 girin.</p>
          <h3 className="field-heading">Nakit kaynakları</h3><div className="form-grid">
            {number('cash','Borç dışı peşinat','Alıma ayrılan nakit; yedek parayı tekrar eklemeyin.')}
            {number('contingencyCash','Yedek nakit','Kenarda kalır; yalnız masraf / kredi açığı kadar kullanılır.')}
          </div>
          <h3 className="field-heading">Aylık gelir</h3><div className="form-grid">
            {number('applicantIncome','Başvuru sahibi aylık net gelir','Belgelenebilir gelir.',{blankZero:true})}
            {number('spouseIncome','Eşin belgelenebilir aylık net geliri','Ayrı bordro; kurumun kabulü gerekir.',{blankZero:true})}
            {number('householdIncome','Hane aylık net gelir','Bordrolar + diğer gelirler; toplam tutar.',{blankZero:true})}
          </div>
          <h3 className="field-heading">Borç ve giderler</h3><div className="form-grid">
            {number('existingDebt','Mevcut aylık kredi ve kart ödemeleri','Başvuru sahibinin aylık borcu.',{nullable:true})}
            {number('livingCost','Hanenin diğer aylık giderleri','Diğer hane borçları dahil; yukarıdaki borç hariç.',{nullable:true})}
            {number('existingPersonalPrincipal','Mevcut ihtiyaç kredisi kalan anaparası','13 Şubat 2025 sonrası. Bilinmiyorsa 12 ay varsayılır.',{nullable:true})}
            {number('runningCost','Araç aylık kullanım gideri','Yakıt, bakım, sigorta ve vergi payı.')}
            {number('reserve','Aylık güvenlik / birikim payı')}
            {number('otherUpfront','Diğer peşin alım masrafları','Noter, ekspertiz, sigorta vb.; 0 ise hariç.')}
            {number('debtRatio','Gelire göre borç bütçe eşiği (%)','Kişisel varsayım; banka onay kuralı değil.',{max:50})}
          </div>
      <div className="button-row"><button className="quiet-button" onClick={()=>{try{localStorage.setItem(STORAGE,JSON.stringify(Object.fromEntries(['cash','contingencyCash','applicantIncome','spouseIncome','householdIncome','existingPersonalPrincipal','existingDebt','livingCost','reserve','runningCost','otherUpfront'].map(k=>[k,input[k as keyof FinanceInput]]))));setSaved(true);}catch{setSaved(false);}}}>Bütçe girişlerimi bu cihazda hatırla</button><button className="text-button" onClick={()=>{localStorage.removeItem(STORAGE);setSaved(false);}}>Cihazdaki kaydı sil</button><span role="status">{saved?'Bu tarayıcıda kaydedildi.':''}</span></div>

        </Tabs.Panel>
        <Tabs.Panel value="credit"><p className="panel-help">Faizler örnektir; gerçek teklifinizi girin. Taşıt kredisi üst sınırdan, kalan ihtiyaç kredisiyle hesaplanır.</p>
      <h3 className="field-heading">Taşıt kredisi</h3><div className="form-grid"><Select label="Taşıt finansörü" value={input.autoProvider} onChange={v=>v&&update('autoProvider',v as FinanceInput['autoProvider'])} data={[{value:'koc',label:'Koçfinans'},{value:'garanti',label:'Garanti BBVA'}]} {...selectProps}/>{number('autoRate','Taşıt aylık faiz (%)','Vergiler hariç akdi oran.',{max:20,decimal:3})}{number('autoMonths','İstenen taşıt vadesi (ay)','Yasal ve yaş sınırına otomatik indirilir.',{max:48})}</div><h3 className="field-heading">İhtiyaç kredisi</h3><div className="form-grid"><Select label="İhtiyaç kredisi sağlayıcı" value={input.personalProvider} onChange={v=>v&&update('personalProvider',v as FinanceInput['personalProvider'])} data={[{value:'enpara',label:'Enpara · tahsis ücreti yok'},{value:'garanti-digital',label:'Garanti BBVA · dijital / maaş dışı'},{value:'other',label:'Şube / diğer banka · kendi teklifim'}]} {...selectProps}/>{number('personalRate','İhtiyaç aylık faiz (%)','Vergiler hariç akdi oran.',{max:20,decimal:3})}{number('personalMonths','İstenen ihtiyaç vadesi (ay)','Tutar sınırına otomatik indirilir.',{max:36})}{number('personalLimit','İhtiyaç kredisi ürün / ön limit','Enpara 800.000 ₺; Garanti dijital / maaş dışı 450.000 ₺. Şube veya diğer bankada kendi teklifinizi girin.')}
      <Select label="Kredi geçmişi" value={input.creditHistory} onChange={v=>v&&update('creditHistory',v as FinanceInput['creditHistory'])} data={[{value:'unknown',label:'Henüz değerlendirilmedi'},{value:'clean',label:'Gecikme / takip yok'},{value:'late',label:'Gecikme / takip var'}]} {...selectProps}/></div>
      <div className="confirmation-list"><Checkbox label="Kasko değeri, gerçek ilan, motor ve paket bilgilerini teyit ettim" checked={input.vehicleVerified} onChange={e=>update('vehicleVerified',e.currentTarget.checked)}/><Checkbox label="Koçfinans anlaşmalı satıcı ve uygun ekspertiz koşulunu teyit ettim" checked={input.sellerApproved} onChange={e=>update('sellerApproved',e.currentTarget.checked)}/></div>


        </Tabs.Panel>
      </Tabs>
      <FinanceSummary result={result} input={input} onRules={()=>{setTab('rules');rulesTab.current?.focus();}}/>
    </div>
    <section id="scenario-analysis" tabIndex={-1} className="scenario-analysis" aria-label="Senaryo incelemesi">
      <Tabs value={tab} onChange={setTab} keepMounted={false} unstyled className="workspace-tabs analysis-tabs">
        <Tabs.List aria-label="Senaryo incelemesi">{[['payments','Ödeme planı'],['rules','Kurallar'],['compare','Teklifleri karşılaştır'],['impact','Bütçeye etkisi'],['catalog','Araç listesi']].map(([value,label])=><Tabs.Tab key={value} ref={value==='rules'?rulesTab:undefined} value={value}>{label}</Tabs.Tab>)}</Tabs.List>
        {['payments','rules','compare','impact'].map(value=><Tabs.Panel key={value} value={value}>{tab===value&&(!result?<p role="status">Hesap için araç tutarını ve kredi alanlarını kontrol edin.</p>:<>
      {tab==='rules'&&<><div className="analysis-intro"><h2>Koşullar ve ödeme gücü</h2><p className="muted">{result.lenderStatus}. Belgeli hane toplamı {money(result.documentedHouseholdIncome)}; girilen toplam hane geliri {money(input.householdIncome)}. Eş bordrosu finansör kabul etmeden başvuru gelirine eklenmez.</p><p>{cashTarget===null?'Nakit alt sınırı için mevcut borç ve diğer hane giderlerini doldurun.':`Girilen bütçeye göre, yedek nakit dışında gereken peşinat alt sınırı yaklaşık ${money(cashTarget)}; mevcut peşinata göre ${money(Math.max(0,cashTarget-input.cash))} daha gerekir. Bu hesap kredi onayı değildir.`}</p></div><div className="rule-list">{result.rules.map(rule=><article key={rule.id} className={`rule rule-${rule.status}`}><span className="rule-status">{{pass:'Hesaba uygun',warn:'Dikkat',block:'Engel',unknown:'Teyit gerekli'}[rule.status]}</span><div><h3>{rule.title}</h3><p>{rule.reason}</p>{rule.source&&<a href={rule.source} target="_blank" rel="noreferrer">Resmî koşul</a>}</div></article>)}</div><p className="muted">%{input.debtRatio} kişisel bütçe eşiğidir; kanuni sınır veya banka ret kuralı değildir.</p></>}
      {tab==='payments'&&<><h2>Aylık ödeme planı</h2><p className="muted">İki kredinin birleşik taksitleri. Koşullar sağlanmasa da tahmini yük gösterilir; kesin banka planı değildir.</p><Disclosure label="Faiz, masraf ve ödeme varsayımları"><p>İlk taksit alımı izleyen ayda; faiz üzerinden %15 KKDF + %15 BSMV hesaplanır. Enpara tahsis ücreti 0; diğerlerinde %0,5 + BSMV üst sınırı varsayılır. Gün sayısı, sigorta ve sözleşme banka planını değiştirebilir.</p></Disclosure><button className="quiet-button" onClick={()=>setShowChart(v=>!v)} aria-pressed={showChart}>{showChart?'Grafiği kapat':'Ödeme grafiğini göster'}</button>{showChart&&<Suspense fallback={<p>Grafik yükleniyor…</p>}><PaymentChart schedule={result.schedule}/></Suspense>}<DataTable rows={result.schedule} columns={paymentCols} rowKey={r=>String(r.month)} caption="İki kredinin birleşik ödeme planı" pageSize={6}/></>}
      {tab==='compare'&&<><h2>Aynı araç için alternatifler</h2><p className="muted">Seçili sağlayıcıların oranları yukarıdan; diğer sağlayıcıların teklifleri aşağıdan gelir. Gerçek teklif alınmadan en ucuz banka ilan edilmez.</p><div className="form-grid"><NumberInput label="Diğer taşıt finansörünün aylık faizi (%)" value={otherAutoRate} error={!validOtherRate(otherAutoRate)?"Faiz 0–20 arasında olmalı.":undefined} min={0} max={20} decimalScale={3} hideControls onChange={v=>setOtherAutoRate(Number(v)||0)}/><NumberInput label="Diğer ihtiyaç sağlayıcısının aylık faizi (%)" value={otherPersonalRate} error={!validOtherRate(otherPersonalRate)?"Faiz 0–20 arasında olmalı.":undefined} min={0} max={20} decimalScale={3} hideControls onChange={v=>setOtherPersonalRate(Number(v)||0)}/></div>{alternativesValid?<DataTable rows={alternatives} rowKey={r=>r.name} caption="Girilen oranlarla alternatif finansmanlar" columns={[{key:'name',label:'Finansman',value:r=>r.name,render:r=>r.name},{key:'status',label:'Koşul sonucu',value:r=>r.result.status,render:r=>r.result.status},{key:'peak',label:'En yüksek aylık taksit',numeric:true,value:r=>r.result.peakPayment,render:r=>money(r.result.peakPayment)},{key:'cost',label:'Toplam alım maliyeti',numeric:true,value:r=>r.result.totalCost,render:r=>money(r.result.totalCost)}]}/>:<p role="status">Geçerli oran girilince karşılaştırma yeniden hesaplanır.</p>}</>}
      {tab==='impact'&&<><h2>Google Sheets bütçesi üzerine etkisi</h2><p className="muted">E-tabloya yazmaz. Pano’daki serbest nakitten bu senaryonun taksiti ve aylık araç gideri, alım ayında ayrıca peşin tutarın yedek nakitten karşılanmayan kısmı düşülür. Yedek nakit, e-tablo dışında ayrı bir mevcut fon varsayılır; e-tabloda zaten varsa ikinci kez kaynak saymayın. Araç giderini zaten e-tabloya eklediyseniz ikinci kez düşmemesi için burada tekrar eklemeyin. Sheet geliri ile başvuru/hane geliri farklı olabilir; kredi değerlendirmesi yukarıdaki girişlerle yapılır.</p>{!budget?<p>E-tablo verisi alınamadı; finansman hesabı kullanılabilir.</p>:<DataTable rows={impact} rowKey={r=>r.label} caption="E-tablo dönemi içindeki ek araç yükü" columns={[{key:'month',label:'Ay / veri kaynağı',value:r=>r.label,render:r=><>{r.label}<small>{r.source}</small></>},{key:'before',label:'Mevcut serbest nakit',numeric:true,value:r=>r.before,render:r=>money(r.before)},{key:'loan',label:'Yeni kredi taksiti',numeric:true,value:r=>r.loan,render:r=>money(r.loan)},{key:'after',label:'Araç sonrası serbest nakit',numeric:true,value:r=>r.after,render:r=><strong className={r.after<0?'negative':''}>{money(r.after)}</strong>} ]}/>}</>}

        </>)}</Tabs.Panel>)}
        <Tabs.Panel value="catalog">    <div className="catalog-section"><h2>İki dosyanın ortak araç listesi</h2><p role="status">{onlyEligible?`${rows.length} model/yıl koşulları karşılıyor`:`${rows.length} model/yıl gösteriliyor`}</p><p className="muted">49 model adı birleştirildi. Kaynakta fiyat göstergesi bulunan ve 3 milyon ₺ sınırına uyan 37 modelde 206 model/yıl seçeneği kaldı. Pakete özgü doğrulanmamış tahminler “teyitsiz” olarak gösterilir; satış gerçekleştiği veya sorunsuzluk doğrulandığı iddia edilmez. Fotoğraflar model örneğidir. Sayısal güvenilirlik puanları bağımsız kanıt içermediği için kullanılmadı.</p><div className="filters"><TextInput label="Listede model / paket ara" value={query} onChange={e=>setQuery(e.currentTarget.value)}/></div><DataTable rows={rows} columns={cols} rowKey={r=>`${r.car.id}-${r.year}`} caption="3 milyon ₺ altındaki model/yıl göstergeleri"/></div>
</Tabs.Panel>
      </Tabs>
      {tab==='rules'&&<>    <p className="muted source-footnote">Kural kaynakları: <a href={sources.auto} target="_blank" rel="noreferrer">BDDK taşıt</a> · <a href={sources.personal} target="_blank" rel="noreferrer">BDDK ihtiyaç</a> · <a href={sources.koc} target="_blank" rel="noreferrer">Koçfinans</a> · <a href={sources.garanti} target="_blank" rel="noreferrer">Garanti BBVA</a> · <a href={sources.enpara} target="_blank" rel="noreferrer">Enpara</a>. Mevzuat, fiyat ve ürün koşulları {RULE_DATE} tarihinde kontrol edildi; gelecekteki alım için yeniden teyit gerekir.</p>
</>}
    </section>
  </div>;
}
