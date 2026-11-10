import { syntheticBridgeResponse } from '../src/dashboard/bridgeFixtures';
import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';
import { syntheticSheets, gviz } from '../src/dashboard/fixtures';
import { feedName } from './webFeed';

async function openSettings(page: Page) {
  // The route shell shows the same heading while the vehicle module loads; wait for the module itself.
  await expect(page.getByRole('heading',{name:'Araç ve finansman',exact:true})).toBeVisible();
  await expect(page.locator('.vehicle-page')).toBeVisible();
  const toggle=page.getByRole('button',{name:'Ayarları düzenle',exact:true});
  if(await toggle.isVisible() && await toggle.getAttribute('aria-expanded')==='false') await toggle.click();
}

test('vehicle form adapts to space remaining beside global navigation', async ({ page }) => {
  await mockLayoutSheets(page);
  await page.setViewportSize({ width: 1024, height: 800 });
  await page.goto('/aile/#/arac');
  const settings = page.getByRole('button', { name: 'Ayarları düzenle', exact: true });
  await expect(settings).toBeVisible();
  for (const width of [1023, 1024, 1025, 1279, 1280, 1281, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const compact = await page.locator('.vehicle-page').evaluate(el => el.clientWidth < 64 * parseFloat(getComputedStyle(el).fontSize));
    if (compact) await expect(settings).toBeVisible(); else await expect(settings).toBeHidden();
    await openSettings(page);
    expect((await page.getByRole('combobox', { name: 'Model', exact: true }).boundingBox())!.width).toBeGreaterThanOrEqual(200);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  const price = page.getByLabel('Alım fiyatı', { exact: true });
  await price.fill('900000');
  await page.setViewportSize({ width: 1024, height: 800 });
  await expect(price).toBeFocused();
  await expect(price).toHaveValue('900000');
});


test('the wide scenario rail is open when it appears; only the narrow panel a person opens animates', async ({ page }) => {
  await mockLayoutSheets(page);
  await page.addInitScript(() => {
    const counted = window as unknown as { settingsHeightTransitions: number };
    counted.settingsHeightTransitions = 0;
    document.addEventListener('transitionrun', event => {
      if ((event.target as Element).id === 'scenario-settings' && event.propertyName === 'height') counted.settingsHeightTransitions += 1;
    });
  });
  const transitions = () => page.evaluate(() => (window as unknown as { settingsHeightTransitions: number }).settingsHeightTransitions);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/aile/#/arac');
  await expect(page.getByRole('combobox', { name: 'Model', exact: true })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  expect(await transitions()).toBe(0);

  await page.setViewportSize({ width: 320, height: 740 });
  await page.reload();
  const toggle = page.getByRole('button', { name: 'Ayarları düzenle', exact: true });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(await transitions()).toBe(0);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(transitions).toBeGreaterThan(0);
});

async function mockLayoutSheets(page:Page,unavailable=()=>false) {
  const sheets=syntheticSheets();
  const map={Pano:'summary',Plan:'plan','Gerçekleşen':'actual','Düzensiz giderler':'irregular'} as const;
  await page.route('**/gviz/tq?*',async route=>{
    if(unavailable())return route.fulfill({status:503,body:'Unavailable'});
    const sheet=feedName(new URL(route.request().url())) as keyof typeof map;
    const bridge = syntheticBridgeResponse(route.request().url());
    if (bridge) return route.fulfill({ contentType: 'application/json', body: bridge });
    const key=map[sheet];
    if (!key) return route.fulfill({ status: 404, body: 'Unknown schema' });
    const grid=key==='plan'||key==='actual';
    return route.fulfill({contentType:'application/json',body:gviz(grid?sheets[key].map(r=>r.slice(0,4)):sheets[key],grid?['Kalem',...sheets.summary.map(r=>String(r[0]))]:undefined)});
  });
}

test('vehicle budget impact excludes financing and reserve transfers from payment capacity', async ({ page }) => {
  await mockLayoutSheets(page);
  await page.goto('/aile/#/arac');
  await expect(page.locator('.sync-strip')).toContainText('Güncellendi');
  await page.getByRole('tab', { name: 'Bütçe etkisi', exact: true }).click();
  const table = page.getByRole('table', { name: 'Aylık bütçe etkisi' });
  await expect(table.locator('tbody tr').first().locator('td').nth(1)).toHaveText('3.300 ₺');
  await expect(table.getByRole('columnheader', { name: 'Mevcut akış' })).toBeVisible();
  await expect(page.locator('.vehicle-page')).toContainText('Akış: borç ve aktarımlar hariç.');
});

test('vehicle selection and borrowed-down-payment rules stay usable at 320px', async ({ page }) => {
  await page.setViewportSize({width:320,height:740});
  await page.goto('/aile/#/arac');
  await openSettings(page);
  await expect(page.getByRole('heading',{name:'Araç ve finansman',exact:true})).toBeVisible();
  await page.getByRole('tab',{name:'Bütçe',exact:true}).click();
  await expect(page.getByLabel('Başvuranın net geliri')).toHaveValue('');
  await page.getByLabel('Başvuranın net geliri').fill('30000');
  await page.getByLabel('Hanenin net geliri').fill('60000');
  await expect(page.getByTestId('finance-result')).toContainText('Taksit yükü bütçe eşiğini aşıyor');
  await expect(page.getByTestId('finance-result')).toContainText('Eksik: borç');
  await page.getByRole('tab',{name:'Araç',exact:true}).click();
  await page.getByRole('combobox', {name:'Model',exact:true}).click();
  await page.getByRole('option',{name:'Citroën C5',exact:true}).click();
  await expect(page.getByRole('img',{name:'Citroën C5 · Ön'})).toBeVisible();
  await expect(page.getByLabel('Başvuranın net geliri')).toHaveValue('30000');
  await page.getByRole('tab',{name:'Ödeme planı',exact:true}).click();
  await expect(page.getByRole('table',{name:'Taksitler',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.getByRole('tab',{name:'Kurallar',exact:true}).click();
  await expect(page.getByRole('tabpanel',{name:'Kurallar',exact:true})).toContainText('Hane nakit dengesi');
  expect((await new AxeBuilder({page}).include('.budget-app').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,reason:n.failureSummary}))}))).toEqual([]);
  for(const width of [320,360,375,390,768,1440]){await page.setViewportSize({width,height:740});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);}
  await page.screenshot({path:`test-results/vehicle-desktop-${test.info().project.name}.png`});
});

test('open vehicle menu stays readable with a persisted dark preference',async({page})=>{
  await page.emulateMedia({colorScheme:'dark'});
  await page.addInitScript(()=>localStorage.setItem('mantine-color-scheme','dark'));
  await page.goto('/aile/#/arac');
  await openSettings(page);
  await page.getByRole('combobox',{name:'Model',exact:true}).click();
  const option=page.getByRole('option',{name:'Toyota Hilux',exact:true});
  await expect(option).toBeVisible();
  // The click that opened the menu can leave the pointer on an option, whose hover tint fades in about 290 ms later.
  // Measure the menu's own surface: move the pointer off the menu and let running transitions finish, then read once.
  await page.mouse.move(0,0);
  await expect.poll(()=>option.evaluate(e=>e.matches(':hover'))).toBe(false);
  await option.evaluate(async e=>{const chain:Element[]=[];for(let n:Element|null=e;n;n=n.parentElement)chain.push(n);await Promise.all(chain.flatMap(n=>n.getAnimations()).map(a=>a.finished));});
  const colors=await option.evaluate(e=>{let n:Element|null=e;let bg='';while(n){bg=getComputedStyle(n).backgroundColor;if(bg!=='rgba(0, 0, 0, 0)'&&bg!=='transparent')break;n=n.parentElement;}return {fg:getComputedStyle(e).color,bg};});
  expect(colors.bg).toBe('rgb(255, 255, 255)');
  expect((await new AxeBuilder({page}).include('.budget-app').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,reason:n.failureSummary}))}))).toEqual([]);
  await page.screenshot({path:`test-results/vehicle-menu-${test.info().project.name}.png`});
});

test('invalid alternative rates stay editable without crashing the simulation',async({page})=>{
 await page.goto('/aile/#/arac');
  await openSettings(page);
 await page.getByRole('tab',{name:'Teklifler',exact:true}).click();
 await page.getByRole('tab',{name:'Kredi',exact:true}).click();
 const rate=page.getByLabel('Diğer taşıt faizi (aylık %)');
 await rate.fill('21');
 await expect(page.getByRole('heading',{name:'Araç ve finansman',exact:true})).toBeVisible();
 await expect(page.getByText('Faiz 0–20 arasında olmalı.',{exact:true})).toBeVisible();
 await rate.fill('3.5');
 await expect(page.getByRole('table',{name:'Teklifler'})).toBeVisible();
});

test('eligibility switch filters models, years and catalog without treating approval as known',async({page})=>{
 await page.goto('/aile/#/arac');
  await openSettings(page);
 const control=page.getByRole('switch',{name:'Yalnız uygunları göster'});
 await control.click();await expect(control).toBeChecked();
 await page.getByRole('combobox',{name:'Model',exact:true}).click();
 await expect(page.getByRole('option',{name:'Toyota Hilux',exact:true})).toHaveCount(0);
 await expect(page.getByRole('option',{name:'Toyota Corolla',exact:true})).toBeVisible();
 await page.getByRole('combobox',{name:'Model',exact:true}).press('Escape');
 await expect(page.getByTestId('catalog-filter-count')).toContainText('uygun seçenek');
 await control.press('Space');await expect(control).not.toBeChecked();
 await page.getByRole('combobox',{name:'Model',exact:true}).click();
 await expect(page.getByRole('option',{name:'Toyota Hilux',exact:true})).toBeVisible();
});

test('vehicle gallery switches front, rear and cabin and resets with the model',async({page})=>{
 await mockLayoutSheets(page);
 await page.goto('/aile/#/arac');
 await expect(page.locator('.sync-strip')).toContainText('Güncellendi');
  await openSettings(page);
 await expect(page.getByRole('button',{name:'Arka',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Arka',exact:true}).click();
 const rear=page.getByRole('img',{name:'Toyota Corolla · Arka',exact:true});await expect(rear).toBeVisible();
 await expect.poll(()=>rear.evaluate((e:HTMLImageElement)=>e.complete&&e.naturalWidth>0)).toBe(true);
 await page.getByRole('combobox',{name:'Model yılı',exact:true}).click();
 await page.getByRole('option',{name:'2020',exact:true}).click();
 await page.getByRole('button',{name:'İç',exact:true}).click();
 await expect(page.getByRole('img',{name:'Toyota Corolla · İç',exact:true})).toBeVisible();
 await page.getByRole('combobox',{name:'Model',exact:true}).click();await page.getByRole('option',{name:'Honda HR-V',exact:true}).click();
 await expect(page.getByRole('img',{name:'Honda HR-V · Ön',exact:true})).toBeVisible();
});

test('emergency cash closes a fee gap, stays separate, and is remembered only on request',async({page})=>{
 await page.goto('/aile/#/arac');
  await openSettings(page);
 await page.getByRole('tab',{name:'Bütçe',exact:true}).click();
 await page.getByLabel('Yedek nakit',{exact:true}).fill('40000');
 const reserve=page.getByTestId('contingency-result');
 await expect(reserve).toContainText('Yedekten kullanılan');
 await expect(reserve).not.toContainText('Yedekte kalan 0');
 await expect(page.getByLabel('Peşinat',{exact:true})).toHaveValue('0');
 await expect(page.getByText('Alım günü nakit açığı').locator('strong')).toHaveText('0 ₺');
 expect(await page.evaluate(()=>localStorage.getItem('aile:finance-input:v1'))).toBeNull();
 await page.getByRole('button',{name:'Bu cihazda sakla'}).click();
 await page.reload();await openSettings(page);await page.getByRole('tab',{name:'Bütçe',exact:true}).click();await expect(page.getByLabel('Yedek nakit',{exact:true})).toHaveValue('40000');
});


test('compact workspace keeps one editor open and the decision beside it', async ({page}) => {
  await page.setViewportSize({width:320,height:740});
  await page.goto('/aile/#/arac');
  await openSettings(page);
  const editors=page.getByRole('tablist',{name:'Senaryo ayarları'});
  await expect(editors.getByRole('tab',{name:'Araç',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(page.getByLabel('Başvuranın net geliri')).not.toBeVisible();
  await expect(page.getByRole('table',{name:'3 milyon ₺ altı araçlar'})).not.toBeVisible();
  await editors.getByRole('tab',{name:'Bütçe',exact:true}).click();
  const context=page.getByTestId('selected-scenario');
  await expect(context).toBeVisible();
  await expect(context).toContainText('Toyota Corolla · 2017');
  await expect(context).toContainText('1.100.000 ₺');
  const month=await page.getByRole('combobox',{name:'Alım ayı',includeHidden:true}).inputValue();
  await expect(context).toContainText(month);
  await page.getByLabel('Yedek nakit',{exact:true}).fill('40000');
  await page.getByLabel('Başvuranın net geliri').fill('90000');
  await editors.getByRole('tab',{name:'Bütçe',exact:true}).press('ArrowRight');
  await expect(editors.getByRole('tab',{name:'Kredi',exact:true})).toBeFocused();
  await expect(context).toBeVisible();
  await expect(context).toContainText(month);
  await expect(page.getByRole('combobox',{name:'Taşıt finansörü'})).toBeVisible();
  await page.setViewportSize({width:1440,height:900});
  await editors.getByRole('tab',{name:'Bütçe',exact:true}).click();
  await expect(page.getByLabel('Yedek nakit',{exact:true})).toHaveValue('40000');
  await expect(page.getByLabel('Başvuranın net geliri')).toHaveValue('90000');
  await page.evaluate(()=>scrollTo(0,0));
  await page.locator('.sidebar-scroll').evaluate(e=>e.scrollTo(0,0));
  const editor=await page.getByTestId('scenario-editor').boundingBox();
  const decision=await page.getByTestId('finance-result').boundingBox();
  expect(decision!.x).toBeGreaterThan(editor!.x+editor!.width-1);
  expect(Math.abs(decision!.y-editor!.y)).toBeLessThan(5);
  const analysis=page.getByRole('tablist',{name:'Senaryo incelemesi'});
  await analysis.getByRole('tab',{name:'Kurallar',exact:true}).click();
  await expect(page.getByText('Hane nakit dengesi',{exact:true})).toBeVisible();
  await analysis.getByRole('tab',{name:'Araç listesi',exact:true}).click();
  await expect(page.getByRole('table',{name:'3 milyon ₺ altı araçlar'})).toBeVisible();
  await expect(page.getByText('Hane nakit dengesi',{exact:true})).not.toBeVisible();
});


test('compact details preserve motion, focus, readable text and on-demand resources', async ({page,browserName}) => {
  await page.setViewportSize({width:320,height:740});
  const requests:string[]=[];page.on('request',r=>requests.push(r.url()));
  await page.goto('/aile/#/arac');
  await openSettings(page);
  const detail=page.getByRole('button',{name:'Fiyat ve değerlendirme',exact:true});
  const id=await detail.getAttribute('aria-controls');
  const panel=page.locator(`[id="${id}"]`);
  await panel.evaluate(e=>e.addEventListener('transitionrun',()=>{const css=getComputedStyle(e);e.setAttribute('data-test-motion',JSON.stringify({duration:css.transitionDuration,easing:css.transitionTimingFunction}));}));
  await detail.click();
  await expect(detail).toHaveAttribute('aria-expanded','true');
  await expect(panel).toHaveAttribute('aria-hidden','false');
  await expect(panel).not.toHaveAttribute('inert');
  await expect(page.getByRole('link',{name:'Fiyat kaynağı'})).toBeVisible();
  await expect(panel).toHaveAttribute('data-test-motion',/0.24s/);
  expect(await panel.getAttribute('data-test-motion')).toContain('cubic-bezier(0.65, 0, 0.35, 1)');
  await panel.evaluate(e=>e.removeAttribute('data-test-motion'));
  await detail.click();
  await expect(panel).toHaveAttribute('aria-hidden','true');
  await expect(panel).toHaveAttribute('inert');
  await expect(panel).toHaveAttribute('data-test-motion',/0.24s/);
  await expect(panel).not.toBeVisible();
  // macOS WebKit uses Option+Tab to traverse buttons when full keyboard access is off.
  const macWebKit=browserName==='webkit'&&process.platform==='darwin';
  const precedingInput=page.getByRole('button',{name:'Fotoğraf kaynağı',exact:true});
  await precedingInput.focus();
  await expect(precedingInput).toBeFocused();
  await page.keyboard.press(macWebKit?'Alt+Tab':'Tab');
  const activeAfterTab=await page.evaluate(()=>({tag:document.activeElement?.tagName,text:document.activeElement?.textContent,id:document.activeElement?.id}));
  await expect(detail,JSON.stringify(activeAfterTab)).toBeFocused();
  const focus=await detail.evaluate(e=>({outline:getComputedStyle(e).outlineStyle,line:getComputedStyle(e).textDecorationLine}));
  expect(focus).toEqual({outline:'none',line:'underline'});
  await page.keyboard.press(macWebKit?'Alt+Shift+Tab':'Shift+Tab');
  await expect(precedingInput).toBeFocused();
  for(const width of [320,360,375,390,575,576,577,768,1023,1024,1025,1279,1280,1281,1440]){
    await page.setViewportSize({width,height:740});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    const tiny=await page.locator('.vehicle-page :is(p,span,strong,h1,h2,h3,label,button,input,a,th,td)').evaluateAll(es=>es.filter(e=>e.getClientRects().length && parseFloat(getComputedStyle(e).fontSize)<14).map(e=>e.textContent));
    expect(tiny).toEqual([]);
  }
  await page.getByRole('tab',{name:'Bütçe',exact:true}).click();
  await page.getByLabel('Yedek nakit',{exact:true}).fill('40000');
  await page.setViewportSize({width:740,height:320});
  await expect(page.getByLabel('Yedek nakit',{exact:true})).toHaveValue('40000');
  await expect(page.getByLabel('Yedek nakit',{exact:true})).toBeFocused();
  await page.getByRole('tab',{name:'Araç',exact:true}).click();
  await page.emulateMedia({reducedMotion:'reduce'});
  await detail.click();
  await expect(panel).toHaveAttribute('aria-hidden','false');
  expect(await panel.evaluate(e=>getComputedStyle(e).transitionDuration)).toBe('0s');
  await detail.click();
  expect(requests.some(u=>/PaymentChart|echarts|LegacyApp/.test(u))).toBe(false);
  const photos=requests.filter(u=>/vehicles\/.+\.(webp|jpg|png)/.test(u));
  expect(photos.length).toBe(1);
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.setViewportSize({width:320,height:740});await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:`test-results/compact-320-${test.info().project.name}.png`,fullPage:true});
  await page.setViewportSize({width:1440,height:900});
  await page.screenshot({path:`test-results/compact-desktop-${test.info().project.name}.png`,fullPage:true});
});

test('vehicle overview puts the car and payment in the first desktop view', async ({page}) => {
  // Keep layout evidence independent of the live Sheet and its network availability.
  let unavailable=false;
  await mockLayoutSheets(page,()=>unavailable);
  await page.setViewportSize({width:320,height:740});
  await page.goto('/aile/#/arac');
  await openSettings(page);
  await expect(page.locator('.sync-strip [role="status"]')).toContainText('Güncellendi');
  await expect(page.getByRole('alert')).toHaveCount(0);
  const jump=page.getByRole('button',{name:/Sonuca git/});
  await expect(jump).toBeVisible();
  expect((await jump.boundingBox())!.y+(await jump.boundingBox())!.height).toBeLessThanOrEqual(740);
  await jump.click();
  await expect(page.locator('#finance-conclusion')).toBeFocused();
  await page.setViewportSize({width:1440,height:900});
  await page.evaluate(()=>window.scrollTo(0,0));
  const car=page.getByRole('img',{name:'Toyota Corolla · Ön',exact:true});
  await expect(car).toBeVisible();
  const photo=await car.boundingBox();
  expect(photo!.y+photo!.height,'vehicle photo should fit the first desktop view').toBeLessThanOrEqual(900);
  const payment=await page.locator('.payment-metric').boundingBox();
  expect(payment!.y+payment!.height).toBeLessThanOrEqual(900);
  await page.screenshot({path:`test-results/vehicle-refined-${test.info().project.name}.png`,fullPage:true});
  unavailable=true;
  await page.getByRole('button',{name:'Yenile',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Son başarılı veriler');
  await expect(page.getByTestId('finance-result')).toContainText('En yüksek taksit');
  await expect(page.getByRole('combobox',{name:'Model',exact:true})).toBeEnabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});

test('quarter-width sidebar keeps forms together and mobile settings preserve edits', async ({page}) => {
  await page.setViewportSize({width:320,height:740});
  await mockLayoutSheets(page);
  await page.goto('/aile/#/arac');
  await expect(page.locator('.sync-strip [role="status"]')).toContainText('Güncellendi');
  const settings=page.getByRole('button',{name:'Ayarları düzenle',exact:true});
  await expect(settings).toHaveAttribute('aria-expanded','false');
  await expect(page.getByRole('combobox',{name:'Model',exact:true})).not.toBeVisible();
  const collapse=page.locator('#scenario-settings');
  await collapse.evaluate(e=>e.addEventListener('transitionrun',()=>{const css=getComputedStyle(e);e.setAttribute('data-test-motion',`${css.transitionDuration}|${css.transitionTimingFunction}`);}));
  await settings.focus();
  await page.keyboard.press('Enter');
  await expect(collapse).toHaveAttribute('aria-hidden','false');
  await expect(collapse).not.toHaveAttribute('inert');
  await expect(collapse).toHaveAttribute('data-test-motion',/0.24s.*cubic-bezier\(0.65, 0, 0.35, 1\)/);
  await expect(settings).toHaveAttribute('aria-expanded','true');
  await page.getByRole('tab',{name:'Bütçe',exact:true}).click();
  const reserve=page.getByLabel('Yedek nakit',{exact:true});
  await reserve.fill('40000');
  await page.setViewportSize({width:740,height:320});
  await expect(reserve).toHaveValue('40000');
  await expect(reserve).toBeFocused();
  await page.setViewportSize({width:320,height:740});
  await collapse.evaluate(e=>e.removeAttribute('data-test-motion'));
  await page.getByRole('button',{name:'Sonuçları göster',exact:true}).click();
  await expect(collapse).toHaveAttribute('aria-hidden','true');
  await expect(collapse).toHaveAttribute('inert');
  await expect(collapse).toHaveAttribute('data-test-motion',/0.24s/);
  await expect(settings).toHaveAttribute('aria-expanded','false');
  await expect(page.locator('#finance-conclusion')).toBeFocused();
  await expect(reserve).not.toBeVisible();
  await page.emulateMedia({reducedMotion:'reduce'});
  await settings.click();
  expect(await collapse.evaluate(e=>getComputedStyle(e).transitionDuration)).toBe('0s');
  await page.getByRole('button',{name:'Sonuçları göster',exact:true}).click();
  await page.evaluate(()=>scrollTo(0,0));
  await page.screenshot({path:`test-results/sidebar-320-${test.info().project.name}.png`,fullPage:true});
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.setViewportSize({width:1440,height:900});
  const sidebar=page.getByRole('complementary',{name:'Senaryo ayarları',exact:true});
  await expect(reserve).toHaveValue('40000');
  const side=await sidebar.boundingBox();
  const workspace=await page.locator('.scenario-workspace').boundingBox();
  expect(side!.width/workspace!.width).toBeCloseTo(.25,2);
  const main=page.getByTestId('scenario-content');
  const content=await main.boundingBox();
  expect(content!.x).toBeGreaterThanOrEqual(side!.x+side!.width);
  await expect(main.locator('input')).toHaveCount(0);
  for(const tab of ['Araç','Bütçe','Kredi']) {
    await sidebar.getByRole('tab',{name:tab,exact:true}).click();
    expect(await sidebar.locator('input:visible').count()).toBeGreaterThan(0);
  }
  await page.getByRole('tab',{name:'Ödeme planı',exact:true}).click();
  await page.evaluate(()=>scrollTo(0,0));
  const payment=await page.getByRole('table',{name:'Taksitler',exact:true}).boundingBox();
  await page.screenshot({path:`test-results/sidebar-layout-${test.info().project.name}.png`,fullPage:true});
  expect(payment!.y,'payment table should start within the first desktop screen').toBeLessThan(900);
  await page.screenshot({path:`test-results/sidebar-desktop-${test.info().project.name}.png`,fullPage:true});
  // A fixed menu inside the scrolling/sticky rail must remain actionable, not just visible.
  const history=sidebar.getByRole('combobox',{name:'Kredi geçmişi',exact:true});
  await history.click();
  expect(await page.locator('.sidebar-scroll').evaluate(e=>e.scrollTop)).toBeGreaterThan(0);
  await page.getByRole('option',{name:'Gecikme yok',exact:true}).click();
  await expect(history).toHaveValue('Gecikme yok');
  const rate=page.getByLabel('Taşıt faizi (aylık %)',{exact:true});
  await rate.fill('3.75');
  for(const width of [1023,320]) {
    await page.setViewportSize({width,height:740});
    await expect(rate).toHaveValue('3.75');
    await expect(rate).toBeFocused();
    await expect(settings).toHaveAttribute('aria-expanded','true');
    await expect(collapse).toHaveAttribute('aria-hidden','false');
    await expect(collapse).not.toHaveAttribute('inert');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  }
});

test('model year selects the matching body gallery, preserves the angle and requests only that photo',async({page})=>{
  await mockLayoutSheets(page);
  await page.setViewportSize({width:1440,height:900});
  const photos:string[]=[];
  page.on('request',r=>{if(r.url().includes('/vehicles/'))photos.push(r.url());});
  await page.goto('/aile/#/arac');
  const front=page.getByRole('img',{name:'Toyota Corolla · Ön',exact:true});
  await expect(front).toBeVisible();
  const oldBody=await front.getAttribute('src');
  await page.getByRole('combobox',{name:'Model yılı',exact:true}).click();
  await page.getByRole('option',{name:'2026',exact:true}).click();
  await expect(front).not.toHaveAttribute('src',oldBody!);
  await expect(page.getByTestId('vehicle-generation')).toContainText('E210');
  await expect.poll(()=>front.evaluate(img=>(img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  const currentBody=await front.getAttribute('src');
  await page.getByRole('combobox',{name:'Model yılı',exact:true}).click();
  await page.getByRole('option',{name:'2025',exact:true}).click();
  await expect(front).toHaveAttribute('src',currentBody!);
  await page.getByRole('button',{name:'Arka',exact:true}).click();
  const rear=page.getByRole('img',{name:'Toyota Corolla · Arka',exact:true});
  await expect(rear).toBeVisible();
  const currentRear=await rear.getAttribute('src');
  await page.getByRole('combobox',{name:'Model yılı',exact:true}).click();
  await page.getByRole('option',{name:'2015',exact:true}).click();
  await expect(rear).not.toHaveAttribute('src',currentRear!);
  await expect(page.getByTestId('vehicle-generation')).toContainText('E180');
  await expect.poll(()=>rear.evaluate(img=>(img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  const oldRear=await rear.getAttribute('src');
  expect(new Set(photos.map(url=>new URL(url).pathname))).toEqual(new Set([oldBody,currentBody,currentRear,oldRear]));
  for(const width of [320,360,375,390,768,1440]) {
    await page.setViewportSize({width,height:800});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  }
  await page.screenshot({path:`test-results/generation-${test.info().project.name}.png`});
});


test('transition year requires a body choice and missing angles never reuse the preceding body',async({page})=>{
  await mockLayoutSheets(page);
  await page.setViewportSize({width:320,height:740});
  await page.goto('/aile/#/arac');
  await openSettings(page);
  await page.getByRole('combobox',{name:'Model yılı',exact:true}).click();
  await page.getByRole('option',{name:'2016',exact:true}).click();
  await expect(page.locator('.vehicle-photo img')).toHaveCount(0);
  const body=page.getByRole('combobox',{name:'Kasa / makyaj',exact:true});
  await expect(body).toHaveValue('');
  await expect(page.getByTestId('vehicle-generation')).toContainText('Geçiş yılı');
  await body.focus();
  await body.press('ArrowDown');
  await body.press('ArrowDown');
  await body.press('Enter');
  await expect(body).toHaveValue('E180 · Makyajlı sedan');
  await expect(page.getByTestId('vehicle-generation')).toHaveText('E180 · Makyajlı sedan');
  await expect(page.getByRole('img',{name:'Toyota Corolla · Ön',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'İç',exact:true}).click();
  await expect(page.locator('.vehicle-photo img')).toHaveCount(0);
  await expect(page.locator('.vehicle-photo [role="status"]')).toContainText('fotoğraf yok');
  await page.getByRole('combobox',{name:'Model yılı',exact:true}).click();
  await page.getByRole('option',{name:'2020',exact:true}).click();
  await expect(body).toHaveCount(0);
  await expect(page.getByRole('img',{name:'Toyota Corolla · İç',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});


test('a failed vehicle photo can be retried without changing the selected model',async({page})=>{
  await mockLayoutSheets(page);
  let fail=true;
  await page.route('**/vehicles/**',route=>fail?route.abort():route.continue());
  await page.goto('/aile/#/arac');
  await expect(page.locator('.vehicle-photo [role="status"]')).toContainText('Fotoğraf yüklenemedi');
  fail=false;
  await page.getByRole('button',{name:'Yeniden dene',exact:true}).click();
  const photo=page.getByRole('img',{name:'Toyota Corolla · Ön',exact:true});
  await expect(photo).toBeVisible();
  await expect.poll(()=>photo.evaluate(img=>(img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
});
