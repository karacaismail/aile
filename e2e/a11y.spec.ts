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
