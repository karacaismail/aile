import { test, expect, type Locator } from '@playwright/test';
import { mockApi, horizontalOverflow, smallText, smallTargets } from './helpers';
import { tokens } from '../src/dashboard/tokens';

const items = [
  { id: 'light', tip: 'satinalma', ad: 'Salon lambası', kategori: 'aydinlatma_led', oda: 'salon', faz: '2', durum: 'karar' },
  { id: 'wire', tip: 'satinalma', ad: 'Kablo', kategori: 'elektrik_kablolama', oda: 'salon', faz: '2', durum: 'fikir' },
  { id: 'coffee', tip: 'satinalma', ad: 'Espresso makinesi', kategori: 'mutfak_kahve', oda: 'mutfak', faz: '1', durum: 'siparis' },
  { id: 'bath', tip: 'satinalma', ad: 'Banyo fırçası', kategori: 'banyo_wc', oda: 'banyo', faz: '2', durum: 'karar' },
  { id: 'dog', tip: 'satinalma', ad: 'Köpek yatağı', kategori: 'kopek', oda: 'salon', faz: '2', durum: 'karar' },
];
test.beforeEach(async ({ page }) => { await mockApi(page, { items, settings: [] }); });

/** Capture the real transition start; settled Collapse styles intentionally return to 0s. */
async function expectCollapseMotion(disclosure: Locator, content: Locator, expanded: boolean) {
  await content.evaluate(el => {
    el.removeAttribute('data-motion-sample');
    el.addEventListener('transitionrun', event => {
      if (event.target !== el) return;
      const style = getComputedStyle(el);
      el.setAttribute('data-motion-sample', JSON.stringify({ durations:style.transitionDuration.split(',').map(value => value.trim()), curves:style.transitionTimingFunction.match(/cubic-bezier\([^)]*\)|[a-z-]+/g) }));
    }, { once:true });
  });
  await disclosure.click();
  await expect(disclosure).toHaveAttribute('aria-expanded', String(expanded));
  await expect(content).toHaveAttribute('aria-hidden', String(!expanded));
  if (!expanded) await expect(content).toHaveAttribute('inert', '');
  await expect(content).toHaveAttribute('data-motion-sample', /./);
  const sample = JSON.parse((await content.getAttribute('data-motion-sample'))!);
  expect(sample.durations.length).toBeGreaterThan(0);
  expect(new Set(sample.durations)).toEqual(new Set([`${tokens.duration / 1000}s`]));
  expect(new Set(sample.curves)).toEqual(new Set(['cubic-bezier(0.65, 0, 0.35, 1)']));
  await expect(content).toBeVisible({ visible:expanded });
}


test('desktop filters are open on the left; category parents refine to children without a modal', async ({ page }, info) => {
  await page.setViewportSize({ width:1440,height:900 });
  await page.goto('/#/satinalma');
  await expect(page.getByTestId('item-card')).toHaveCount(5);
  await page.screenshot({ path: info.outputPath('desktop-before-or-after.png'), fullPage: true });
  const panel = page.getByRole('complementary', { name: 'Hazırlık listesi filtreleri' });
  await expect(panel).toBeVisible();
  expect((await panel.boundingBox())!.x + (await panel.boundingBox())!.width).toBeLessThan((await page.getByTestId('item-list').boundingBox())!.x);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await panel.getByRole('checkbox', { name:'Elektrik ve aydınlatma 2' }).check();
  const branchId = await panel.getByRole('button', { name:'Elektrik ve aydınlatma alt kategorileri' }).getAttribute('aria-controls');
  await expect.poll(() => page.locator(`[id="${branchId}"]`).evaluate(el => (el as HTMLElement).style.height)).toBe('');
  await expect(page.getByTestId('item-card')).toHaveCount(2);
  await panel.getByRole('checkbox', { name:'Kablo ve tesisat 1' }).uncheck();
  await expect(panel.getByRole('checkbox', { name:'Elektrik ve aydınlatma 2' })).toHaveJSProperty('indeterminate',true);
  await expect(page.getByTestId('item-card')).toHaveCount(1);
  await expect(page.getByRole('link', { name:'Salon lambası detayı' })).toBeVisible();
  await expect(page.getByTestId('filter-button')).toBeHidden();
  expect(await horizontalOverflow(page)).toEqual([]);
  expect(await smallText(page)).toEqual([]);
  await page.screenshot({ path: info.outputPath('desktop-parent-child.png'), fullPage:true });
});

test('sidebar follows available content at its boundary; reduced motion keeps instant category state', async ({ page }, info) => {
  await page.setViewportSize({ width:1440,height:900 });
  await page.goto('/#/satinalma');
  await expect(page.getByTestId('item-card')).toHaveCount(5);
  const inset = 1440 - (await page.getByTestId('purchase-workspace').boundingBox())!.width;
  for (const delta of [-1, 0, 1]) {
    await page.setViewportSize({ width:tokens.purchaseWorkspaceMin + inset + delta,height:900 });
    const sidebar = page.getByRole('complementary', { name:'Hazırlık listesi filtreleri' });
    if (delta < 0) await expect(sidebar).toBeHidden(); else await expect(sidebar).toBeVisible();
    expect(await horizontalOverflow(page)).toEqual([]);
  }
  await page.setViewportSize({ width:320,height:740 });
  await expect(page.getByTestId('filter-button')).toBeVisible();
  await page.emulateMedia({ reducedMotion:'reduce' });
  await page.getByTestId('filter-button').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toHaveCSS('transition-duration', '0s');
  const category = dialog.getByRole('checkbox', { name:'Elektrik ve aydınlatma 2' });
  await category.check();
  await expect(category).toBeChecked();
  await expect(dialog.getByRole('checkbox', { name:'Kablo ve tesisat 1' })).toBeVisible();
  await page.screenshot({ path:info.outputPath('mobile-expanded-category.png') });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('mobile filters open from the left with padding; selection, phase and undo survive resize', async ({ page }, info) => {
  await page.setViewportSize({ width:320,height:740 });
  await page.goto('/#/satinalma');
  await expect(page.getByTestId('item-card')).toHaveCount(5);
  await page.getByTestId('totals-bar').getByText('Sonra', { exact:true }).click();
  await page.getByTestId('filter-button').click();
  const panel = page.getByRole('dialog');
  await expect(panel).toBeVisible();
  await expect.poll(async () => (await panel.boundingBox())?.x).toBe(0);
  expect((await panel.boundingBox())!.y).toBe(0);
  await expect(panel).toHaveCSS('transition-duration', '0.24s');
  await expect(panel).toHaveCSS('transition-timing-function', 'cubic-bezier(0.65, 0, 0.35, 1)');
  const dog = panel.getByRole('checkbox', { name:'Köpek 1' });
  await dog.check();
  await expect(page.getByTestId('filter-apply')).toHaveText('1 kalemi göster');
  expect(await smallText(page)).toEqual([]);
  expect(await smallTargets(page)).toEqual([]);
  await page.screenshot({ path: info.outputPath('mobile-filter-panel.png') });
  await page.getByTestId('filter-apply').click();
  await expect(page.getByTestId('filter-drawer')).toBeHidden();
  await expect(page.getByTestId('item-card')).toHaveCount(1);
  await expect(page.getByRole('link', { name:'Banyo fırçası detayı' })).toHaveCount(0);
  await page.getByRole('checkbox', { name:'Köpek yatağı alındı' }).click();
  await page.getByRole('button', { name:'Geri al', exact:true }).click();
  await expect(page.getByTestId('item-card')).toHaveCount(1);
  await page.setViewportSize({ width:1440,height:900 });
  const sidebar = page.getByRole('complementary', { name:'Hazırlık listesi filtreleri' });
  await expect(sidebar).toBeVisible();
  await expect(sidebar.getByRole('checkbox', { name:'Köpek 1' })).toBeChecked();
  await expect(page.getByRole('radio', { name:'Sonra', exact:true })).toBeChecked();
  await sidebar.getByRole('button', { name:/^Tüm filtreleri temizle/ }).click();
  await expect(page.getByTestId('item-card')).toHaveCount(4);
  await expect(page.getByRole('radio', { name:'Sonra', exact:true })).toBeChecked();
  expect(await horizontalOverflow(page)).toEqual([]);
});

test('filter focus and selections survive both layout boundaries; hierarchy motion is immediate and symmetric', async ({ page }, info) => {
  await page.setViewportSize({ width:1440,height:900 });
  await page.goto('/#/satinalma');
  const panel = page.getByRole('complementary', { name:'Hazırlık listesi filtreleri' });
  const parent = panel.getByRole('checkbox', { name:'Elektrik ve aydınlatma 2' });
  await expect(parent).toBeVisible();
  await page.keyboard.press('Tab');
  await parent.focus();
  await page.keyboard.press('Space');
  await expect(parent).toBeChecked();
  const child = panel.getByRole('checkbox', { name:'Kablo ve tesisat 1' });
  await child.focus();
  await page.setViewportSize({ width:390,height:844 });
  const mobileChild = page.getByRole('dialog').getByRole('checkbox', { name:'Kablo ve tesisat 1' });
  await expect(mobileChild).toBeFocused();
  await page.keyboard.press('Space');
  await expect(mobileChild).not.toBeChecked();
  await page.setViewportSize({ width:1440,height:900 });
  await expect(child).toBeFocused();
  await expect(child).not.toBeChecked();
  const indicator = await child.evaluate(el => ({ outline:getComputedStyle(el).outlineStyle, shadow:getComputedStyle(el).boxShadow }));
  expect(indicator.outline).toBe('none');
  expect(indicator.shadow).not.toBe('none');
  const expand = panel.getByRole('button', { name:'Elektrik ve aydınlatma alt kategorileri' });
  const controlled = page.locator(`[id="${await expand.getAttribute('aria-controls')}"]`);
  await expectCollapseMotion(expand, controlled, false);
  await expectCollapseMotion(expand, controlled, true);
  await page.screenshot({ path:info.outputPath('keyboard-after-resize.png') });
  for (const size of [{width:320,height:740},{width:360,height:740},{width:375,height:740},{width:390,height:844},{width:667,height:375}]) {
    await page.setViewportSize(size);
    await expect(page.getByTestId('filter-button')).toBeVisible();
    expect(await horizontalOverflow(page)).toEqual([]);
    expect(await smallText(page)).toEqual([]);
  }
});

test('unselected expanded branches and focused children survive both layout boundaries', async ({ page }) => {
  await page.setViewportSize({ width:1440,height:900 });
  await page.goto('/#/satinalma');
  const sidebar = page.getByRole('complementary', { name:'Hazırlık listesi filtreleri' });
  await sidebar.getByRole('button', { name:'Elektrik ve aydınlatma alt kategorileri' }).click();
  const child = sidebar.getByRole('checkbox', { name:'Kablo ve tesisat 1' });
  await expect(child).toBeVisible();
  await expect(child).not.toBeChecked();
  await page.keyboard.press('Tab');
  await child.focus();
  await page.setViewportSize({ width:390,height:844 });
  const mobileChild = page.getByRole('dialog').getByRole('checkbox', { name:'Kablo ve tesisat 1' });
  await expect(mobileChild).toBeVisible();
  await expect(mobileChild).toBeFocused();
  await expect(mobileChild).not.toBeChecked();
  await page.setViewportSize({ width:1440,height:900 });
  await expect(child).toBeVisible();
  await expect(child).toBeFocused();
  await expect(sidebar.getByRole('checkbox', { name:'Elektrik ve aydınlatma 2' })).not.toBeChecked();
});

test('existing-item switch and section clear keep keyboard focus across layout changes', async ({ page }) => {
  await page.setViewportSize({ width:1440,height:900 });
  await page.goto('/#/satinalma');
  const sidebar = page.getByRole('complementary', { name:'Hazırlık listesi filtreleri' });
  const existing = sidebar.getByLabel('Mevcut eşyaları da göster');
  await expect(existing).toBeAttached();
  await page.keyboard.press('Tab');
  await existing.focus();
  await page.setViewportSize({ width:390,height:844 });
  const mobileExisting = page.getByRole('dialog').getByLabel('Mevcut eşyaları da göster');
  await expect(mobileExisting).toBeFocused();
  await page.keyboard.press('Space');
  await expect(mobileExisting).toBeChecked();
  await page.setViewportSize({ width:1440,height:900 });
  await expect(existing).toBeFocused();
  await expect(existing).toBeChecked();
  const clear = sidebar.getByRole('button', { name:'Temizle: Diğer' });
  await clear.focus();
  await page.setViewportSize({ width:390,height:844 });
  await expect(page.getByRole('dialog').getByRole('button', { name:'Temizle: Diğer' })).toBeFocused();
  await page.setViewportSize({ width:1440,height:900 });
  await expect(clear).toBeFocused();
});

test('empty results retain full available width before and after the first response', async ({ page }) => {
  await mockApi(page, { items:[], settings:[] });
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/macros/s/**', async route => { await pending; await route.fallback(); });
  const response = page.waitForResponse('**/macros/s/**');
  await page.setViewportSize({ width:1440,height:900 });
  await page.goto('/#/satinalma');
  const list = page.getByTestId('item-list');
  const workspace = page.getByTestId('purchase-workspace');
  await expect(list).toBeVisible();
  try {
    await expect.poll(async () => (await list.boundingBox())!.width / (await workspace.boundingBox())!.width).toBeGreaterThan(0.9);
  } finally { release(); }
  await response;
  await expect(page.getByTestId('empty-state')).toBeVisible();
  await expect(page.getByRole('complementary', { name:'Hazırlık listesi filtreleri' })).toHaveCount(0);
  await expect.poll(async () => (await list.boundingBox())!.width / (await workspace.boundingBox())!.width).toBeGreaterThan(0.9);
});
