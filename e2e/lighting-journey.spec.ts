import { test, expect, type Page } from '@playwright/test';
import { mockApi } from './helpers';
import data from './fixtures/lighting.json' with { type: 'json' };

// Round 5: scene and layer route modals return to the place and record they came from.
const SCENE = '01TESTSCENE000000000000001';
const LAYER = '01TESTLAYER000000000000002';
const keyboard = (browserName: string) => browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
const sceneCard = (page: Page) => page.getByRole('link', { name: 'Akşam filmi sahnesi', exact: true });
const layerCard = (page: Page) => page.getByRole('link', { name: 'Okuma köşesi katmanı', exact: true });

test.beforeEach(async ({ page }) => {
  await mockApi(page, data);
  await page.setViewportSize({ width: 320, height: 740 });
});

for (const close of ['Escape', 'Vazgeç'] as const) {
  test(`a direct scene link closed with ${close} shows Sahneler and focuses that scene, even when Odalar was the last tab`, async ({ page, browserName }) => {
    await page.addInitScript(() => localStorage.setItem('aile:lighting:tab', JSON.stringify('odalar')));
    await page.goto(`/aile/#/aydinlatma/sahne/${SCENE}`);
    const form = page.getByTestId('scene-form');
    await expect(form).toBeVisible();
    await page.keyboard.press(keyboard(browserName));
    if (close === 'Escape') await page.keyboard.press('Escape');
    else { await form.getByRole('button', { name: 'Vazgeç', exact: true }).focus(); await page.keyboard.press('Enter'); }
    await expect(form).toHaveCount(0);
    await expect(page.getByRole('radio', { name: 'Sahneler' })).toBeChecked();
    await expect(sceneCard(page)).toBeFocused();
    await expect(sceneCard(page)).toBeInViewport();
  });
}

for (const close of ['Escape', 'Kaydet'] as const) {
  test(`a scene opened from Sahneler and closed with ${close} returns focus to its card`, async ({ page, browserName }) => {
    await page.goto('/aile/#/aydinlatma');
    await page.getByText('Sahneler', { exact: true }).click();
    const origin = sceneCard(page);
    await expect(origin).toBeVisible();
    await page.keyboard.press(keyboard(browserName));
    await origin.focus();
    await page.keyboard.press('Enter');
    const form = page.getByTestId('scene-form');
    await expect(form).toBeVisible();
    if (close === 'Escape') await page.keyboard.press('Escape');
    else { await form.getByLabel('Not').fill('Perde kapalı'); await form.getByRole('button', { name: 'Kaydet', exact: true }).focus(); await page.keyboard.press('Enter'); }
    await expect(form).toHaveCount(0);
    await expect(page.getByRole('radio', { name: 'Sahneler' })).toBeChecked();
    await expect(origin).toBeFocused();
  });
}

for (const close of ['Escape', 'Kaydet'] as const) {
  test(`a layer opened from its card on the room page and closed with ${close} returns focus to that card`, async ({ page, browserName }) => {
    await page.goto('/aile/#/aydinlatma/salon');
    const origin = layerCard(page);
    await expect(origin).toBeVisible();
    await page.keyboard.press(keyboard(browserName));
    await origin.focus();
    await page.keyboard.press('Enter');
    const form = page.getByTestId('layer-form');
    await expect(form).toBeVisible();
    if (close === 'Escape') await page.keyboard.press('Escape');
    else { await form.getByLabel('Amaç', { exact: true }).fill('Okuma ve örgü'); await form.getByRole('button', { name: 'Kaydet', exact: true }).focus(); await page.keyboard.press('Enter'); }
    await expect(form).toHaveCount(0);
    await expect(origin).toBeFocused();
    await expect(origin).toBeInViewport();
  });
}

test('a cold layer deep link closed with Escape focuses that layer on the room page', async ({ page, browserName }) => {
  await page.goto(`/aile/#/aydinlatma/salon/${LAYER}`);
  const form = page.getByTestId('layer-form');
  await expect(form).toBeVisible();
  await page.keyboard.press(keyboard(browserName));
  await page.keyboard.press('Escape');
  await expect(form).toHaveCount(0);
  await expect(layerCard(page)).toBeFocused();
});

test('deleting a layer moves focus to the room heading, not the page body', async ({ page, browserName }) => {
  await page.goto('/aile/#/aydinlatma/salon');
  const origin = layerCard(page);
  await expect(origin).toBeVisible();
  await page.keyboard.press(keyboard(browserName));
  await origin.focus();
  await page.keyboard.press('Enter');
  const form = page.getByTestId('layer-form');
  await form.getByRole('button', { name: 'Sil', exact: true }).click();
  await page.getByRole('dialog', { name: 'Katmanı sil?' }).getByRole('button', { name: 'Sil', exact: true }).click();
  await expect(form).toHaveCount(0);
  await expect(origin).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
});

// Round 5 review (RED first in LayerForm.integrity.test.tsx): a merged CCT range that would be reversed is not written; the
// slider names the problem and the bound the user moved takes focus. From the keyboard (Enter on Kaydet) the central keyboard
// mode stays on and the thumb shows one visible, non-enclosing indicator; after a pointer Save focus still moves, unmarked.
const CCT_LAYER = '01TESTLAYER000000000000001';
async function reversedRange(page: Page, browserName: string) {
  let remote: Record<string, unknown> | null = null;
  const writes: unknown[] = [];
  await page.route('**/macros/s/**', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as { action?: string };
    if (body.action === 'batch') writes.push(body);
    if (!remote || body.action === 'batch' || body.action === 'health') return route.fallback();
    const items = (data.items as Array<Record<string, unknown>>).map((i) => (i.id === CCT_LAYER ? { ...i, ...remote } : i));
    return route.fulfill({ json: { ok: true, fingerprint: 'remote-cct', serverTime: new Date().toISOString(), schemaVersion: 2, items, settings: data.settings, cash: [] } });
  });
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto(`/aile/#/aydinlatma/salon/${CCT_LAYER}`);
  const form = page.getByTestId('layer-form');
  await expect(form).toBeVisible();
  await page.keyboard.press(keyboard(browserName));
  const lower = form.getByRole('slider', { name: 'CCT min' });
  await lower.focus();
  for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowRight');
  await expect(form.getByTestId('cct-value')).toHaveText('3500–4000 K');
  remote = { cct_max: 3000, version: 9 };
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.locator(`[data-layer-id="${CCT_LAYER}"]`)).toContainText('2700–3000 K');
  return { form, lower, writes };
}
const indicator = (el: Element) => {
  const own = getComputedStyle(el), after = getComputedStyle(el, '::after');
  return { outline: own.outlineStyle, ring: own.boxShadow, mark: after.content !== 'none' && after.content !== 'normal', height: after.height, width: parseFloat(after.width) };
};

test('a reversed merged CCT range saved from the keyboard focuses the moved bound with one visible non-enclosing indicator', async ({ page, browserName }, testInfo) => {
  const { form, lower, writes } = await reversedRange(page, browserName);
  await form.getByRole('button', { name: 'Kaydet', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(form.getByTestId('merged-invalid')).toBeVisible();
  await expect(form.getByTestId('cct-error')).toHaveText("CCT min, max'tan büyük olamaz");
  await expect(lower).toBeFocused();
  await expect(lower).toBeInViewport();
  await expect(page.locator('html')).toHaveAttribute('data-keyboard', 'true');
  expect(await lower.evaluate(indicator)).toMatchObject({ outline: 'none', ring: 'none', mark: true, height: '3px' });
  expect((await lower.evaluate(indicator)).width).toBeGreaterThan(0);
  expect(writes).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath(`cct-keyboard-focus-${browserName}-320.png`) });
});

test('a reversed merged CCT range saved with the pointer still focuses the moved bound, without a keyboard indicator', async ({ page, browserName }) => {
  const { form, lower, writes } = await reversedRange(page, browserName);
  await form.getByRole('button', { name: 'Kaydet', exact: true }).click();
  await expect(form.getByTestId('cct-error')).toBeVisible();
  await expect(lower).toBeFocused();
  expect(await lower.evaluate(indicator)).toMatchObject({ outline: 'none', ring: 'none', mark: false });
  expect(writes).toEqual([]);
});
