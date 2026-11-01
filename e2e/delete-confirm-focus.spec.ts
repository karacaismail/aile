import { test, expect, type Page } from '@playwright/test';
import { mockApi } from './helpers';
import synthetic from './fixtures/synthetic.json' with { type: 'json' };
import lighting from './fixtures/lighting.json' with { type: 'json' };
import renovation from './fixtures/renovation.json' with { type: 'json' };
import layout from './fixtures/layout.json' with { type: 'json' };

// Round 5 follow-up (RED first: one Escape closed both the confirmation and the record, dropping the draft): cancelling
// the delete confirmation keeps the record open. From the keyboard focus returns to Sil; after a pointer cancel it stays
// inside the record (WebKit does not focus a clicked button, so there is no Sil focus to return to); a later pointer
// focus inside the form is not taken away.
const FORMS = [
  { name: 'Hazırlık kalemi', data: synthetic, hash: '#/satinalma/01TESTITEM0000000000000001', form: 'item-detail', confirm: 'Kalemi sil?' },
  { name: 'Tadilat işi', data: renovation, hash: '#/tadilat/isler/01TESTTD00000000000000001', form: 'task-detail', confirm: 'İşi sil?' },
  { name: 'Usta', data: renovation, hash: '#/tadilat/ustalar/01TESTUS00000000000000001', form: 'vendor-detail', confirm: 'Ustayı sil?' },
  { name: 'Aydınlatma katmanı', data: lighting, hash: '#/aydinlatma/salon/01TESTLAYER000000000000001', form: 'layer-form', confirm: 'Katmanı sil?' },
  { name: 'Sahne', data: lighting, hash: '#/aydinlatma/sahne/01TESTSCENE000000000000001', form: 'scene-form', confirm: 'Sahneyi sil?' },
  { name: 'Yerleşim kalemi', data: layout, hash: '#/yerlesim/salon/01TESTLAYOUT000000000000001', form: 'layout-item-form', confirm: 'Kalemi sil?' },
] as const;

async function openConfirm(page: Page, form: string, confirm: string, by: 'keyboard' | 'pointer') {
  const sil = page.getByTestId(form).getByRole('button', { name: 'Sil', exact: true });
  if (by === 'keyboard') { await sil.focus(); await page.keyboard.press('Enter'); } else await sil.click();
  const dialog = page.getByRole('dialog', { name: confirm });
  await expect(dialog).toBeVisible();
  return { sil, dialog };
}

for (const f of FORMS) {
  test(`${f.name}: silme onayı Escape ya da Vazgeç ile kapanınca kayıt açık kalır ve odak kayıtta kalır`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 740 });
    await mockApi(page, f.data as never);
    await page.goto(`/aile/${f.hash}`);
    const form = page.getByTestId(f.form);
    await expect(form).toBeVisible();

    let { sil, dialog } = await openConfirm(page, f.form, f.confirm, 'keyboard');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(form).toBeVisible();
    await expect(sil).toBeFocused();

    ({ sil, dialog } = await openConfirm(page, f.form, f.confirm, 'pointer'));
    await dialog.getByRole('button', { name: 'Vazgeç', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(form).toBeVisible();
    await expect.poll(() => form.evaluate((el) => !!document.activeElement && document.activeElement !== document.body && !!el.closest('[role="dialog"]')?.contains(document.activeElement))).toBe(true);

    // A pointer focus right after cancelling stays where the user put it (no late focus return takes it away).
    const field = form.getByRole('textbox').first();
    await field.click();
    await expect(field).toBeFocused();
    await page.waitForTimeout(400);
    await expect(field).toBeFocused();
  });
}
