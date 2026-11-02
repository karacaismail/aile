import { test, expect } from '@playwright/test';
import { gotoAdmin, horizontalOverflow } from './admin-helpers';

test('admin.html#/alimlar açılır: başlık sözleşmesi, main landmark ve yatay taşma yok', async ({ page }, testInfo) => {
  await gotoAdmin(page, '/alimlar');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Alımlar ve eşyalar');
  await expect(page).toHaveTitle('Alımlar ve eşyalar · aile');
  await expect(page.locator('main#admin-content')).toHaveCount(1);
  if (testInfo.project.name === 'chromium') {
    expect(await horizontalOverflow(page), 'belge düzeyinde yatay taşma').toEqual([]);
  }
});
