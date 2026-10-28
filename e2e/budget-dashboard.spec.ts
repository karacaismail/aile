import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { syntheticSheets, gviz } from '../src/dashboard/fixtures';
async function mockSheet(page: Page) {
  let fail=false;
  const raw=syntheticSheets();
  const map={Pano:'summary',Plan:'plan','Gerçekleşen':'actual','Düzensiz giderler':'irregular'} as const;
  await page.route('**/gviz/tq?*',async route=>{
    if(fail)return route.fulfill({status:503,body:'Unavailable'});
    const sheet=new URL(route.request().url()).searchParams.get('sheet') as keyof typeof map;
    const key=map[sheet];
    const rows=(key==='plan'||key==='actual')?raw[key].map(r=>r.slice(0,4)):raw[key];
    return route.fulfill({contentType:'application/json',body:gviz(rows,key==='plan'||key==='actual'?['Kalem',...raw.summary.map(r=>String(r[0]))]:undefined)});
  });
  return {fail:()=>{fail=true;},restore:()=>{fail=false;},change:()=>{raw.summary[0][3]=12000;raw.summary[0][9]=6000;raw.actual[0][1]=12000;raw.actual[4][1]=12000;}};
}

test('live read, manual refresh, failure retention and recovery',async({page})=>{
  const sheet=await mockSheet(page);await page.goto('/aile/#/pano');
  const metrics=page.getByRole('region',{name:'Seçili ay özeti'});
  await expect(metrics).toContainText('10.000 ₺');
  sheet.change();await page.getByRole('button',{name:'Yenile',exact:true}).click();await expect(metrics).toContainText('12.000 ₺');
  sheet.fail();await page.getByRole('button',{name:'Yenile',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Son başarılı veriler');await expect(metrics).toContainText('12.000 ₺');
  sheet.restore();await page.getByRole('button',{name:'Yenile',exact:true}).click();await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button',{name:'Düzensiz giderler',exact:true}).click();await expect(page.getByRole('table')).toContainText('Tutar yok');await expect(page.getByRole('table')).toContainText('0 ₺');
});

test('custom selects, visible keyboard focus, motion and responsive table stay accessible',async({page,browserName})=>{
  await mockSheet(page);await page.setViewportSize({width:320,height:740});await page.goto('/aile/#/pano');
  await expect(page.getByRole('heading',{name:'Aile bütçesi',exact:true})).toBeVisible();
  const picker=page.getByRole('textbox',{name:'Gösterilen ay'}).or(page.getByRole('combobox',{name:'Gösterilen ay'}));
  await picker.click();await expect(page.getByRole('option',{name:'Aralık 2098'})).toBeVisible();
  await picker.press('ArrowDown');await picker.press('Enter');
  // macOS WebKit defaults to text-control-only Tab navigation; Option+Tab
  // traverses all controls when Full Keyboard Access is disabled.
  await picker.press(browserName==='webkit'?'Alt+Tab':'Tab');
  expect(await page.evaluate(()=>document.documentElement.dataset.keyboard)).toBe('true');
  const focused=await page.evaluate(()=>{const e=document.activeElement!;const c=getComputedStyle(e);return {outline:c.outlineStyle,decoration:c.textDecorationLine,shadow:c.boxShadow};});
  expect(focused.outline).toBe('none');expect(focused.decoration).toContain('underline');
  await page.getByRole('button',{name:'Aylık tablo',exact:true}).click();
  expect(await page.evaluate(()=>document.documentElement.dataset.keyboard)).toBe('false');
  const button=page.getByRole('button',{name:'Aylık tablo',exact:true});
  expect(await button.getAttribute('aria-pressed')).toBe('true');
  const motion=await button.evaluate(e=>({duration:getComputedStyle(e).transitionDuration,ease:getComputedStyle(e).transitionTimingFunction}));
  expect(motion.duration).toContain('0.24s');expect(motion.ease).toContain('cubic-bezier(0.65, 0, 0.35, 1)');
  for(const width of [320,360,375,390,575,576,577,767,768,769,959,960,961,1119,1120,1121,1440]){
    await page.setViewportSize({width,height:width===767?390:740});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`width ${width}`).toBe(true);
    const small=await page.locator('main').evaluate(el=>Array.from(el.querySelectorAll('*')).filter(n=>n.textContent?.trim()&&n.getBoundingClientRect().width>0&&parseFloat(getComputedStyle(n).fontSize)<14).map(n=>n.tagName));
    expect(small).toEqual([]);
  }
  await page.setViewportSize({width:320,height:740});
  const region=page.getByRole('region',{name:/Aylık plan ve güncel karşılaştırması/});await region.focus();await region.press('ArrowRight');
  await expect.poll(()=>region.evaluate(e=>e.scrollLeft)).toBeGreaterThan(0);
  const amountCell=region.locator('tbody tr').first().locator('td').nth(2);
  await amountCell.evaluate(e=>e.scrollIntoView({inline:'center',block:'nearest'}));
  const visibleWidth=await amountCell.evaluate(e=>{const cell=e.getBoundingClientRect();const box=e.closest('.table-scroll')!.getBoundingClientRect();const first=e.parentElement!.firstElementChild!;const sticky=getComputedStyle(first).position==='sticky'?first.getBoundingClientRect().right:box.left;return Math.min(cell.right,box.right)-Math.max(cell.left,sticky);});
  expect(visibleWidth).toBeGreaterThanOrEqual(160);
  const violations=(await new AxeBuilder({page}).include('.budget-app').analyze()).violations;
  expect(violations.map(v=>`${v.id}: ${v.nodes.map(n=>n.target).join(',')}`)).toEqual([]);
  await page.screenshot({path:'test-results/budget-320.png',fullPage:true});
  await page.emulateMedia({reducedMotion:'reduce'});
  expect(await button.evaluate(e=>getComputedStyle(e).transitionDuration)).toBe('0s');
});
