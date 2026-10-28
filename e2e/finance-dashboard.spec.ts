import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';

test('vehicle selection and borrowed-down-payment rules stay usable at 320px', async ({ page }) => {
  await page.setViewportSize({width:320,height:740});
  await page.goto('/aile/#/arac');
  await expect(page.getByRole('heading',{name:'Araç ve finansman',exact:true})).toBeVisible();
  await expect(page.getByLabel('Başvuru sahibi aylık net gelir')).toHaveValue('');
  await page.getByLabel('Başvuru sahibi aylık net gelir').fill('30000');
  await page.getByLabel('Hane aylık net gelir').fill('60000');
  await expect(page.getByTestId('finance-result')).toContainText('Taksit yükü bütçe eşiğini aşıyor');
  await expect(page.getByTestId('finance-result')).toContainText('Mevcut borç bilgisi');
  await page.getByRole('combobox', {name:'Model',exact:true}).click();
  await page.getByRole('option',{name:'Citroën C5',exact:true}).click();
  await expect(page.getByRole('img',{name:'Citroën C5 · Ön görünüm'})).toBeVisible();
  await expect(page.getByLabel('Başvuru sahibi aylık net gelir')).toHaveValue('30000');
  await page.getByRole('button',{name:'Ödeme planı',exact:true}).click();
  await expect(page.getByRole('table',{name:'İki kredinin birleşik ödeme planı',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.getByRole('button',{name:'Kurallar',exact:true}).click();
  await expect(page.getByTestId('finance-result')).toContainText('Hane nakit dengesi');
  expect((await new AxeBuilder({page}).include('.budget-app').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,reason:n.failureSummary}))}))).toEqual([]);
  for(const width of [320,360,375,390,768,1440]){await page.setViewportSize({width,height:740});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);}
  await page.screenshot({path:`test-results/vehicle-desktop-${test.info().project.name}.png`});
});

test('open vehicle menu stays readable with a persisted dark preference',async({page})=>{
  await page.emulateMedia({colorScheme:'dark'});
  await page.addInitScript(()=>localStorage.setItem('mantine-color-scheme','dark'));
  await page.goto('/aile/#/arac');
  await page.getByRole('combobox',{name:'Model',exact:true}).click();
  const option=page.getByRole('option',{name:'Toyota Hilux',exact:true});
  await expect(option).toBeVisible();
  const colors=await option.evaluate(e=>{let n:Element|null=e;let bg='';while(n){bg=getComputedStyle(n).backgroundColor;if(bg!=='rgba(0, 0, 0, 0)'&&bg!=='transparent')break;n=n.parentElement;}return {fg:getComputedStyle(e).color,bg};});
  expect(colors.bg).toBe('rgb(255, 255, 255)');
  expect((await new AxeBuilder({page}).include('.budget-app').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,reason:n.failureSummary}))}))).toEqual([]);
  await page.screenshot({path:`test-results/vehicle-menu-${test.info().project.name}.png`});
});

test('invalid alternative rates stay editable without crashing the simulation',async({page})=>{
 await page.goto('/aile/#/arac');
 await page.getByRole('button',{name:'Teklifleri karşılaştır',exact:true}).click();
 const rate=page.getByLabel('Diğer taşıt finansörünün aylık faizi (%)');
 await rate.fill('21');
 await expect(page.getByRole('heading',{name:'Araç ve finansman',exact:true})).toBeVisible();
 await expect(page.getByText('Faiz 0–20 arasında olmalı.',{exact:true})).toBeVisible();
 await rate.fill('3.5');
 await expect(page.getByRole('table',{name:'Girilen oranlarla alternatif finansmanlar'})).toBeVisible();
});

test('eligibility switch filters models, years and catalog without treating approval as known',async({page})=>{
 await page.goto('/aile/#/arac');
 const control=page.getByRole('switch',{name:'Yalnız koşulları karşılayanları göster'});
 await control.click();await expect(control).toBeChecked();
 await page.getByRole('combobox',{name:'Model',exact:true}).click();
 await expect(page.getByRole('option',{name:'Toyota Hilux',exact:true})).toHaveCount(0);
 await expect(page.getByRole('option',{name:'Toyota Corolla',exact:true})).toBeVisible();
 await page.getByRole('combobox',{name:'Model',exact:true}).press('Escape');
 await expect(page.getByTestId('catalog-filter-count')).toContainText('koşulları karşılıyor');
 await control.press('Space');await expect(control).not.toBeChecked();
 await page.getByRole('combobox',{name:'Model',exact:true}).click();
 await expect(page.getByRole('option',{name:'Toyota Hilux',exact:true})).toBeVisible();
});

test('vehicle gallery switches front, rear and cabin and resets with the model',async({page})=>{
 await page.goto('/aile/#/arac');
 await expect(page.getByRole('button',{name:'Arka görünüm',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Arka görünüm',exact:true}).click();
 const rear=page.getByRole('img',{name:'Toyota Corolla · Arka görünüm',exact:true});await expect(rear).toBeVisible();
 await expect.poll(()=>rear.evaluate((e:HTMLImageElement)=>e.complete&&e.naturalWidth>0)).toBe(true);
 await page.getByRole('button',{name:'İç mekân',exact:true}).click();
 await expect(page.getByRole('img',{name:'Toyota Corolla · İç mekân',exact:true})).toBeVisible();
 await page.getByRole('combobox',{name:'Model',exact:true}).click();await page.getByRole('option',{name:'Honda HR-V',exact:true}).click();
 await expect(page.getByRole('img',{name:'Honda HR-V · Ön görünüm',exact:true})).toBeVisible();
});

test('emergency cash closes a fee gap, stays separate, and is remembered only on request',async({page})=>{
 await page.goto('/aile/#/arac');
 await page.getByLabel('Yedek nakit',{exact:true}).fill('40000');
 const reserve=page.getByTestId('contingency-result');
 await expect(reserve).toContainText('Yedekten kullanılan');
 await expect(reserve).not.toContainText('Yedekte kalan 0');
 await expect(page.getByLabel('Borç dışı peşinat',{exact:true})).toHaveValue('0');
 await expect(page.getByText('Alım günü ek nakit açığı').locator('strong')).toHaveText('0 ₺');
 expect(await page.evaluate(()=>localStorage.getItem('aile:finance-input:v1'))).toBeNull();
 await page.getByRole('button',{name:'Bütçe girişlerimi bu cihazda hatırla'}).click();
 await page.reload();await expect(page.getByLabel('Yedek nakit',{exact:true})).toHaveValue('40000');
});
