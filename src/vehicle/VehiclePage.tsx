import { lazy, useMemo, useRef, useState } from 'react';
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
import { generationsFor, resolveGeneration } from './generations';
import { Disclosure } from './Disclosure';
import { FinanceSummary } from './FinanceSummary';
import { ScenarioSidebar } from './ScenarioSidebar';
import { PageHeader } from '../app/family/PageHeader';
import { loadCharts } from '../dashboard/chartLoader';
import { OptionalCharts } from '../dashboard/OptionalCharts';
const PaymentChart = lazy(() => Promise.all([import('./PaymentChart'), loadCharts()]).then(([module]) => module));
type Vehicle = typeof catalog[number];
type Variant = Vehicle['years'][number];
const STORAGE = 'aile:finance-input:v1';
const dateLabel = (month: string, offset: number) => { const [y,m]=month.split('-').map(Number); return new Date(Date.UTC(y,m-1+offset,1)).toLocaleDateString('tr-TR',{month:'long',year:'numeric',timeZone:'UTC'}); };
const initial: FinanceInput = {price:0,value:0,year:2017,startYear:new Date().getFullYear(),autoProvider:'koc',personalProvider:'enpara',autoRate:3.5,personalRate:4,autoMonths:36,personalMonths:36,cash:0,contingencyCash:0,applicantIncome:0,spouseIncome:0,householdIncome:0,existingPersonalPrincipal:null,existingDebt:null,livingCost:null,reserve:0,runningCost:0,otherUpfront:0,debtRatio:40,personalLimit:800000,vehicleVerified:false,sellerApproved:false,creditHistory:'unknown'};
function loadProfile(): Partial<FinanceInput> { try { const saved=JSON.parse(localStorage.getItem(STORAGE)??'{}'); const fields=['cash','contingencyCash','applicantIncome','spouseIncome','householdIncome','existingPersonalPrincipal','existingDebt','livingCost','reserve','runningCost','otherUpfront']; return Object.fromEntries(fields.filter(k=>saved[k]===null&&['existingPersonalPrincipal','existingDebt','livingCost'].includes(k)||moneyAmount.safeParse(saved[k]).success).map(k=>[k,saved[k]])); } catch { return {}; } }
function assessment(car: Vehicle) {
  if(car.id==='toyota-corolla')return 'İlk aday. Bakımlı araç, doğru motor ve nakit peşinat öncelikli.';
  if(car.id==='citroen-c5')return 'Ucuz ama yaşlı. Ekspertiz ve bakım payı ayırın.';
  if(/Peugeot/.test(car.name))return '1.2 PureTech: motor kodu, bakım belgesi ve garantiye bakın.';
  if(/Audi|Mercedes|Volvo|Range Rover|Land Rover|Touareg/.test(car.name))return 'Bakım ve arıza için ek nakit ister. Kredili alımda bütçeyi zorlar.';
  if(car.body==='Pick-up')return 'Yük ya da arazi ihtiyacı yoksa önce binek araçlara bakın.';
  return 'Servis geçmişi, kilometre ve ekspertizle karşılaştırın.';
}
export default function VehiclePage({ budget }: { budget: Budget | null }) {
  const vehicleTab = useRef<HTMLButtonElement>(null);
  const rulesTab = useRef<HTMLButtonElement>(null);
  const [onlyEligible,setOnlyEligible]=useState(false);
  const [body,setBody]=useState('Tümü'); const [model,setModel]=useState('toyota-corolla'); const [year,setYear]=useState(2017);
  const car=catalog.find(c=>c.id===model)!; const variant=car.years.find(y=>y.year===year)??car.years.at(-1)!;
  const [generationChoice,setGenerationChoice]=useState<{model:string;year:number;id:string}|null>(null);
  const generationOptions=generationsFor(car.id,variant.year);
  const generation=resolveGeneration(car.id,variant.year,generationChoice?.model===car.id&&generationChoice.year===variant.year?generationChoice.id:undefined);
  const [input,setInput]=useState<FinanceInput>(()=>({...initial,...loadProfile(),price:variant.price,value:variant.price,year:variant.year}));
  const [startMonth,setStartMonth]=useState(new Date().toISOString().slice(0,7));
  const [settingsOpen,setSettingsOpen]=useState(false);
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
  const number=(key:keyof FinanceInput,label:string,description?:string,options:{max?:number;nullable?:boolean;blankZero?:boolean;decimal?:number}={})=><NumberInput inputWrapperOrder={['label','input','description','error']} label={label} description={description} value={options.blankZero&&input[key]===0?'':(input[key]??'') as number|string} onChange={v=>update(key,(v===''?(options.nullable?null:0):Number(v)) as never)} min={0} max={options.max??MAX_MONEY} decimalScale={options.decimal??0} allowNegative={false} hideControls inputMode="decimal" />;
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
    {key:'model',label:'Model',value:r=>r.car.name,render:r=><button className="text-button" onClick={()=>{choose(r.car,r);setEditor('vehicle');setSettingsOpen(true);requestAnimationFrame(()=>vehicleTab.current?.focus());}}>{r.car.name}<small>{r.car.body} · {r.year}</small></button>},
    {key:'year',label:'Yıl',value:r=>r.year,render:r=>r.year},
    {key:'market',label:'İlan fiyatı',numeric:true,value:r=>r.price,render:r=>money(r.price)},
    {key:'claim',label:'Paket fiyatı',numeric:true,value:r=>r.upperClaim??null,render:r=>r.upperClaim?<>{money(r.upperClaim)}<small>Teyitsiz</small></>:'Yok'},
    {key:'sample',label:'İlan',numeric:true,value:r=>r.sample,render:r=>r.sample},
    {key:'source',label:'Kaynak',value:r=>r.car.name,render:r=><a href={r.car.url} target="_blank" rel="noreferrer">Kaynak</a>},
  ];
  const paymentCols:Column<NonNullable<typeof result>['schedule'][number]>[]=[
    {key:'month',label:'Ödeme ayı',value:r=>r.month,render:r=>dateLabel(startMonth,r.month)},
    ...(['auto','personal','payment','principal','interest','tax','balance'] as const).map((key,i)=>({key,label:['Taşıt taksiti','İhtiyaç taksiti','Toplam taksit','Anapara','Faiz','KKDF + BSMV','Kalan borç'][i],numeric:true,value:(r:NonNullable<typeof result>['schedule'][number])=>r[key],render:(r:NonNullable<typeof result>['schedule'][number])=>money(r[key])})),
  ];
  const validOtherRate=(value:number)=>Number.isFinite(value)&&value>=0&&value<=20;
  const alternativesValid=validOtherRate(otherAutoRate)&&validOtherRate(otherPersonalRate);
  const alternatives=result&&alternativesValid?(['koc','garanti'] as const).flatMap(autoProvider=>(['enpara','garanti-digital'] as const).map(personalProvider=>({name:`${autoProvider==='koc'?'Koçfinans':'Garanti BBVA'} + ${personalProvider==='enpara'?'Enpara':'Garanti BBVA dijital'}`,result:simulate({...effective,autoProvider,personalProvider,autoRate:autoProvider===input.autoProvider?input.autoRate:otherAutoRate,personalRate:personalProvider===input.personalProvider?input.personalRate:otherPersonalRate})}))):[];
  const impact=result&&budget?budget.months.filter(m=>m.key>=startMonth).map(m=>{const offset=(+m.key.slice(0,4)-+startMonth.slice(0,4))*12+(+m.key.slice(5)-+startMonth.slice(5));const payment=result.schedule[offset-1]?.payment??0;return {label:m.label,source:m.source,before:m.selfFundedCashFlow?.current??null,loan:payment,after:m.selfFundedCashFlow===undefined?null:m.selfFundedCashFlow.current-payment-input.runningCost-(offset===0?(result.upfront-result.contingencyUsed):0)};}):[];
  return <div className="vehicle-page">
    <PageHeader location="/arac" lead={<span className="selected-scenario" data-testid="selected-scenario"><span>{car.name} · {variant.year}</span><span>{money(input.price)} · {dateLabel(startMonth,0)}</span></span>}
      actions={result&&<button className="context-result" onClick={()=>document.getElementById('finance-conclusion')?.focus()}><span>En yüksek taksit <strong>{money(result.peakPayment)}</strong></span><span className="context-action">Sonuca git <span aria-hidden="true">↗</span></span></button>} />
    <div className="scenario-workspace">
      <ScenarioSidebar open={settingsOpen} onOpenChange={setSettingsOpen} onResult={()=>document.getElementById('finance-conclusion')?.focus()}>
      <Tabs value={editor} onChange={setEditor} keepMounted keepMountedMode="display-none" unstyled className="workspace-tabs scenario-editor" data-testid="scenario-editor">
        <Tabs.List aria-label="Senaryo ayarları"><Tabs.Tab ref={vehicleTab} value="vehicle">Araç</Tabs.Tab><Tabs.Tab value="budget">Bütçe</Tabs.Tab><Tabs.Tab value="credit">Kredi</Tabs.Tab></Tabs.List>
        <Tabs.Panel value="vehicle">
          <div className="vehicle-choice">
      <div className="form-grid"><Select label="Araç türü" value={body} onChange={v=>{if(v){setBody(v);const next=catalog.find(c=>(v==='Tümü'||c.body===v)&&eligibleYears(c).length);if(next&&v!=='Tümü'&&car.body!==v)choose(next,eligibleYears(next)[0]);}}} data={['Tümü','Sedan','SUV','Pick-up']} {...selectProps}/><Select label="Model" value={filterSelectionHidden?null:model} placeholder="Araç seçin" onChange={v=>{const c=catalog.find(c=>c.id===v);if(c)choose(c,eligibleYears(c)[0]);}} searchable data={filtered.map(c=>({value:c.id,label:c.name}))} {...selectProps}/><Select label="Model yılı" value={filterSelectionHidden?null:String(variant.year)} placeholder="Yıl seçin" onChange={v=>choose(car,car.years.find(y=>String(y.year)===v))} data={modelYears.map(v=>String(v.year))} {...selectProps}/>{generationOptions.length>1&&<Select label="Kasa / makyaj" placeholder="Kasa seçin" description="Geçiş yılı" value={generation?.id??null} onChange={id=>id&&setGenerationChoice({model:car.id,year:variant.year,id})} data={generationOptions.map(g=>({value:g.id,label:g.label}))} {...selectProps}/>}<Select label="Alım ayı" value={startMonth} onChange={v=>v&&setStartMonth(v)} data={monthOptions} {...selectProps}/></div>

            <div className="eligibility-toolbar"><button type="button" role="switch" aria-checked={onlyEligible} className="eligibility-switch" onClick={()=>setOnlyEligible(v=>!v)}><span className="switch-track" aria-hidden="true"><span/></span><span>Yalnız uygunları göster</span></button>
            <p data-testid="catalog-filter-count" className="filter-count" role="status">{onlyEligible?`${rows.length} uygun seçenek`:`${rows.length} seçenek`}</p></div>
            {filterSelectionHidden&&<p role="status" className="inline-warning">Seçili araç filtre dışında kaldı.</p>}
            {!filtered.length&&<p role="status">Uygun araç yok. Filtreyi kapatın ya da kredi ayarlarını değiştirin.</p>}

            <div className="form-grid">{number('price','Alım fiyatı','En fazla 3 milyon ₺',{max:3000000})}{number('value','TSB kasko değeri','Varsayılan: ilan fiyatı')}</div>
            {onlyEligible&&<Disclosure label="Elenen yıllar"><p>{filterProviders} · Yedek {money(input.contingencyCash??0)}</p><DataTable rows={yearChecks} rowKey={r=>String(r.year)} caption={`${car.name} · yıllar`} columns={[
              {key:'year',label:'Yıl',value:r=>r.year,render:r=>r.year},
              {key:'status',label:'Sonuç',value:r=>r.result?.status??'',render:r=>r.result?.status??'Geçersiz yıl'},
              {key:'reserve',label:'Gereken yedek',numeric:true,value:r=>r.result?.contingencyUsed??0,render:r=>money(r.result?.contingencyUsed??0)},
              {key:'gap',label:'Kredi açığı',numeric:true,value:r=>r.result?.fundingGap??0,render:r=>money(r.result?.fundingGap??0)},
            ]}/></Disclosure>}
<div className="filters"><TextInput label="Model ara" value={query} onChange={e=>setQuery(e.currentTarget.value)}/></div><button className="text-button" onClick={()=>{setTab('catalog');requestAnimationFrame(()=>document.getElementById('scenario-analysis')?.focus());}}>Araç listesini aç</button>
          </div>
        </Tabs.Panel>
        <Tabs.Panel value="budget">
          <p className="panel-help">Bilmediğiniz alanı boş bırakın, yoksa 0 girin.</p>
          <h3 className="field-heading">Nakit</h3><div className="form-grid">
            {number('cash','Peşinat','Kendi nakdiniz, yedek hariç')}
            {number('contingencyCash','Yedek nakit','Yalnız açık kadar kullanılır')}
          </div>
          <h3 className="field-heading">Gelir</h3><div className="form-grid">
            {number('applicantIncome','Başvuranın net geliri','Aylık, belgeli',{blankZero:true})}
            {number('spouseIncome','Eşin net geliri','Aylık, belgeli',{blankZero:true})}
            {number('householdIncome','Hanenin net geliri','Aylık, tüm gelirler',{blankZero:true})}
          </div>
          <h3 className="field-heading">Borç ve gider</h3><div className="form-grid">
            {number('existingDebt','Kredi ve kart ödemesi','Başvuranın aylık borcu',{nullable:true})}
            {number('livingCost','Diğer hane giderleri','Aylık, bu borç hariç',{nullable:true})}
            {number('existingPersonalPrincipal','İhtiyaç kredisi kalan anapara','13 Şubat 2025 sonrası krediler',{nullable:true})}
            {number('runningCost','Araç gideri','Aylık yakıt, bakım, sigorta, vergi')}
            {number('reserve','Aylık birikim payı')}
            {number('otherUpfront','Alım masrafları','Noter, ekspertiz, sigorta')}
            {number('debtRatio','Borç sınırı (%)','Gelire oranla, kendi sınırınız',{max:50})}
          </div>
      <div className="button-row"><button className="quiet-button" onClick={()=>{try{localStorage.setItem(STORAGE,JSON.stringify(Object.fromEntries(['cash','contingencyCash','applicantIncome','spouseIncome','householdIncome','existingPersonalPrincipal','existingDebt','livingCost','reserve','runningCost','otherUpfront'].map(k=>[k,input[k as keyof FinanceInput]]))));setSaved(true);}catch{setSaved(false);}}}>Bu cihazda sakla</button><button className="text-button" onClick={()=>{localStorage.removeItem(STORAGE);setSaved(false);}}>Kaydı sil</button><span role="status">{saved?'Kaydedildi.':''}</span></div>

        </Tabs.Panel>
        <Tabs.Panel value="credit"><p className="panel-help">Faizler örnek. Aldığınız teklifi girin.</p>
      <h3 className="field-heading">Taşıt kredisi</h3><div className="form-grid"><Select label="Taşıt finansörü" value={input.autoProvider} onChange={v=>v&&update('autoProvider',v as FinanceInput['autoProvider'])} data={[{value:'koc',label:'Koçfinans'},{value:'garanti',label:'Garanti BBVA'}]} {...selectProps}/>{number('autoRate','Taşıt faizi (aylık %)','Vergiler hariç',{max:20,decimal:3})}{number('autoMonths','Taşıt vadesi (ay)','Sınırı aşarsa kısalır',{max:48})}</div><h3 className="field-heading">İhtiyaç kredisi</h3><div className="form-grid"><Select label="İhtiyaç kredisi bankası" value={input.personalProvider} onChange={v=>v&&update('personalProvider',v as FinanceInput['personalProvider'])} data={[{value:'enpara',label:'Enpara'},{value:'garanti-digital',label:'Garanti BBVA dijital'},{value:'other',label:'Diğer banka'}]} {...selectProps}/>{number('personalRate','İhtiyaç faizi (aylık %)','Vergiler hariç',{max:20,decimal:3})}{number('personalMonths','İhtiyaç vadesi (ay)','Sınırı aşarsa kısalır',{max:36})}{number('personalLimit','İhtiyaç kredisi limiti','Enpara 800.000 ₺ · Garanti 450.000 ₺')}
      <Select label="Kredi geçmişi" value={input.creditHistory} onChange={v=>v&&update('creditHistory',v as FinanceInput['creditHistory'])} data={[{value:'unknown',label:'Değerlendirilmedi'},{value:'clean',label:'Gecikme yok'},{value:'late',label:'Gecikme var'}]} {...selectProps}/></div>
      <div className="confirmation-list"><Checkbox label="Araç bilgilerini teyit ettim" checked={input.vehicleVerified} onChange={e=>update('vehicleVerified',e.currentTarget.checked)}/><Checkbox label="Satıcı ve ekspertizi teyit ettim" checked={input.sellerApproved} onChange={e=>update('sellerApproved',e.currentTarget.checked)}/></div>
<h3 className="field-heading" id="alternative-rates" tabIndex={-1}>Diğer teklifler</h3><div className="form-grid"><NumberInput label="Diğer taşıt faizi (aylık %)" value={otherAutoRate} error={!validOtherRate(otherAutoRate)?"Faiz 0–20 arasında olmalı.":undefined} min={0} max={20} decimalScale={3} hideControls onChange={v=>setOtherAutoRate(Number(v)||0)}/><NumberInput label="Diğer ihtiyaç faizi (aylık %)" value={otherPersonalRate} error={!validOtherRate(otherPersonalRate)?"Faiz 0–20 arasında olmalı.":undefined} min={0} max={20} decimalScale={3} hideControls onChange={v=>setOtherPersonalRate(Number(v)||0)}/></div>


        </Tabs.Panel>
      </Tabs>
      </ScenarioSidebar>
      <div className="scenario-content" data-testid="scenario-content">
      <div className="vehicle-overview">
        <div className="vehicle-preview"><VehicleGallery key={car.id} name={car.name} year={variant.year} price={input.price} generation={generation} ambiguous={generationOptions.length>1}/>
            <Disclosure label="Fiyat ve değerlendirme">
              <p><strong>{money(variant.price)}</strong> · {variant.sample} ilana göre</p>
              <p>Aralık: {money(variant.low)} – {money(variant.high)}</p>
              <p>Paket: {car.package}</p>
              {variant.upperClaim&&<p>Paket fiyatı: {money(variant.upperClaim)} · teyitsiz</p>}
              <p>{assessment(car)}</p>
              <a href={car.url} target="_blank" rel="noreferrer">Fiyat kaynağı</a>
              {/Peugeot/.test(car.name)&&<a href="https://www.peugeot.com.tr/satis-sonrasi/mobilite-cozumleri-ve-sozlesmeler/1.2_puretech_motorlari_garanti_uzatimi.html" target="_blank" rel="noreferrer">PureTech garanti açıklaması</a>}{car.id==='honda-accord'&&<p>{car.note}</p>}
            </Disclosure>
        </div>
      <FinanceSummary result={result} input={input} onRules={()=>{setTab('rules');rulesTab.current?.focus();}}/>
    </div>
    <section id="scenario-analysis" tabIndex={-1} className="scenario-analysis" aria-label="Senaryo incelemesi">
      <Tabs value={tab} onChange={setTab} keepMounted={false} unstyled className="workspace-tabs analysis-tabs">
        <Tabs.List aria-label="Senaryo incelemesi">{[['payments','Ödeme planı'],['rules','Kurallar'],['compare','Teklifler'],['impact','Bütçe etkisi'],['catalog','Araç listesi']].map(([value,label])=><Tabs.Tab key={value} ref={value==='rules'?rulesTab:undefined} value={value}>{label}</Tabs.Tab>)}</Tabs.List>
        {['payments','rules','compare','impact'].map(value=><Tabs.Panel key={value} value={value} className={value==='payments'?'payment-panel':undefined}>{tab===value&&(!result?<p role="status">Fiyatı ve kredi alanlarını kontrol edin.</p>:<>
      {tab==='rules'&&<><div className="analysis-intro"><h2>Koşullar</h2><p className="muted">Belgeli hane geliri {money(result.documentedHouseholdIncome)}</p><p>{cashTarget===null?'Peşinat hesabı için borç ve gideri girin.':`Bütçenize göre peşinat en az ${money(cashTarget)} · Eksik ${money(Math.max(0,cashTarget-input.cash))}`}</p></div><div className="rule-list">{result.rules.map(rule=><article key={rule.id} className={`rule rule-${rule.status}`}><span className="rule-status">{{pass:'Uygun',warn:'Dikkat',block:'Engel',unknown:'Teyit gerekli'}[rule.status]}</span><div><h3>{rule.title}</h3><p>{rule.reason}</p>{rule.source&&<a href={rule.source} target="_blank" rel="noreferrer">Kaynak</a>}</div></article>)}</div></>}
      {tab==='payments'&&<><div className="payment-heading"><h2>Aylık ödeme planı</h2><button className="quiet-button" onClick={()=>setShowChart(v=>!v)} aria-pressed={showChart}>{showChart?'Grafiği gizle':'Grafiği göster'}</button></div><Disclosure label="Varsayımlar"><p>İlk taksit alımdan sonraki ay.</p><p>Faize %15 KKDF ve %15 BSMV eklenir.</p><p>Tahsis ücreti: Enpara yok, diğerleri %0,5 + BSMV.</p></Disclosure>{showChart&&<OptionalCharts loading="Grafik yükleniyor…" error="Grafik yüklenemedi. Tablo aşağıda."><PaymentChart schedule={result.schedule}/></OptionalCharts>}<DataTable rows={result.schedule} columns={paymentCols} rowKey={r=>String(r.month)} caption="Taksitler" pageSize={6}/></>}
      {tab==='compare'&&<><h2>Teklif karşılaştırması</h2><button className="text-button" onClick={()=>{setEditor('credit');setSettingsOpen(true);requestAnimationFrame(()=>document.getElementById('alternative-rates')?.focus());}}>Oranları düzenle</button>{alternativesValid?<DataTable rows={alternatives} rowKey={r=>r.name} caption="Teklifler" columns={[{key:'name',label:'Finansman',value:r=>r.name,render:r=>r.name},{key:'status',label:'Sonuç',value:r=>r.result.status,render:r=>r.result.status},{key:'peak',label:'En yüksek taksit',numeric:true,value:r=>r.result.peakPayment,render:r=>money(r.result.peakPayment)},{key:'cost',label:'Toplam maliyet',numeric:true,value:r=>r.result.totalCost,render:r=>money(r.result.totalCost)}]}/>:<p role="status">Geçerli bir oran girin.</p>}</>}
      {tab==='impact'&&<><h2>Bütçe etkisi</h2>{!budget?<p>E-tablo okunamadı.</p>:<DataTable rows={impact} rowKey={r=>r.label} caption="Aylık bütçe etkisi" columns={[{key:'month',label:'Ay',value:r=>r.label,render:r=><>{r.label}<small>{r.source}</small></>},{key:'before',label:'Mevcut akış',numeric:true,value:r=>r.before,render:r=>money(r.before)},{key:'loan',label:'Taksit',numeric:true,value:r=>r.loan,render:r=>money(r.loan)},{key:'after',label:'Kalan akış',numeric:true,value:r=>r.after,render:r=><strong className={r.after!==null&&r.after<0?'negative':''}>{money(r.after)}</strong>} ]}/>}<p className="muted">Akış: borç ve aktarımlar hariç.</p><p className="muted">Kalan akıştan taksit, araç gideri ve alım günü nakdi düşülür.</p></>}

        </>)}</Tabs.Panel>)}
        <Tabs.Panel value="catalog">    <div className="catalog-section"><h2>Araç listesi</h2><p role="status">{onlyEligible?`${rows.length} uygun seçenek`:`${rows.length} seçenek`}</p><DataTable rows={rows} columns={cols} rowKey={r=>`${r.car.id}-${r.year}`} caption="3 milyon ₺ altı araçlar"/></div>
</Tabs.Panel>
      </Tabs>
      {tab==='rules'&&<>    <p className="muted source-footnote">Kaynak: <a href={sources.auto} target="_blank" rel="noreferrer">BDDK taşıt</a> · <a href={sources.personal} target="_blank" rel="noreferrer">BDDK ihtiyaç</a> · <a href={sources.koc} target="_blank" rel="noreferrer">Koçfinans</a> · <a href={sources.garanti} target="_blank" rel="noreferrer">Garanti</a> · <a href={sources.enpara} target="_blank" rel="noreferrer">Enpara</a> · {new Date(`${RULE_DATE}T12:00:00Z`).toLocaleDateString('tr-TR',{timeZone:'UTC'})}</p>
</>}
    </section>
      </div>
    </div>
  </div>;
}
