import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mockApi } from './helpers';

test('axe: satınalma listesi ciddi ihlal içermiyor', async ({ page }) => {
  await mockApi(page);
  await page.goto('/#/satinalma');
  await expect(page.getByTestId('item-card').first()).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => `${n.target.join(' ')} :: ${n.html.slice(0, 120)}`).join(' | ')}`)).toEqual([]);
});

test.describe('koyu tema', () => {
  test.use({ colorScheme: 'dark' });
  test('axe: filtre şeridi, sayfa ve sıralama sayfası ciddi ihlal içermiyor', async ({ page }) => {
    await mockApi(page);
    await page.goto('/#/satinalma');
    await expect(page.getByTestId('item-card').first()).toBeVisible();
    const check = async (name: string) => {
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).include('[data-testid="filter-toolbar"]').include('[role="dialog"]').analyze();
      const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(serious.map((v) => `${name} ${v.id}: ${v.nodes.map((n) => `${n.target.join(' ')} :: ${n.html.slice(0, 120)}`).join(' | ')}`)).toEqual([]);
    };
    await check('şerit');
    // Çekmece/açılır kutu geçiş animasyonu bitmeden axe koşmasın (yarı saydam katman kontrastı bozar)
    const settled = () => page.waitForFunction(() => [...document.querySelectorAll<HTMLElement>('.mantine-Drawer-content, .mantine-Popover-dropdown')].every((el) => getComputedStyle(el).opacity === '1'));
    await page.getByTestId('filter-button').click();
    await expect(page.getByTestId('filter-drawer')).toBeVisible();
    await settled();
    await check('sayfa');
    await page.getByTestId('filter-apply').click();
    await expect(page.getByTestId('filter-drawer')).toBeHidden();
    await page.getByTestId('sort-button').click();
    await expect(page.getByTestId('sort-sheet')).toBeVisible();
    await settled();
    await check('sıralama');
  });
});

