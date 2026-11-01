import { test, expect, type Page } from '@playwright/test';
import { FAKE_API, mockApi, horizontalOverflow, smallTargets, smallText } from './helpers';
import fixture from './fixtures/layout.json' with { type: 'json' };

// Yerleşim yolculuğu (Tur 5): oda ölçüsü kaynağının sahipliği, kalem penceresinden odak dönüşü ve 320 px oda sayfası.

type Row = Record<string, unknown>;

/** Bellekte kaynak: okuma isteğe bağlı bir kapıda bekletilebilir; her yazım kaydedilir; `serverChanges` arka plan okumasını tetikler. */
async function sourceApi(page: Page, settings: Row[], items: Row[] = []) {
  const state = { settings: structuredClone(settings), items: structuredClone(items), rev: 1 };
  const writes: Row[] = [];
  let reads = 0;
  let gate: Promise<void> | null = null;
  let open = () => {};
  let requested = () => {};
  const firstRead = new Promise<void>((resolve) => { requested = resolve; });
  await page.addInitScript((url) => { localStorage.setItem('aile:apiUrl', url); localStorage.setItem('aile:actor', 'e2e'); }, FAKE_API);
  await page.route('**/macros/s/**', async (route) => {
    const req = JSON.parse(route.request().postData() ?? '{}') as { action?: string; ops?: Array<{ id: string; op: string; table: string; patch?: Row }> };
    const now = new Date().toISOString();
    if (req.action === 'health') return route.fulfill({ json: { ok: true, app: 'aile', schemaVersion: 1, serverTime: now, warnings: [] } });
    if (req.action === 'batch') {
      const results = (req.ops ?? []).map((o) => {
        const list = o.table === 'ayarlar' ? state.settings : state.items;
        if (o.table === 'ayarlar') writes.push({ id: o.id, ...o.patch });
        let row = list.find((r) => r.id === o.id);
        if (!row) { row = { id: o.id, version: 0 }; list.push(row); }
        for (const [k, v] of Object.entries(o.patch ?? {})) { if (v === null || v === '') delete row[k]; else row[k] = v; }
        row.version = Number(row.version ?? 0) + 1;
        return { ok: true, id: o.id, row: { ...row } };
      });
      state.rev++;
      return route.fulfill({ json: { ok: true, doneCount: results.length, fingerprint: `src-${state.rev}`, serverTime: now, results } });
    }
    reads++;
    requested();
    if (gate) await gate;
    return route.fulfill({ json: { ok: true, fingerprint: `src-${state.rev}`, serverTime: now, schemaVersion: 1, items: state.items, settings: state.settings, cash: [] } });
  });
  return {
    writes, firstRead, reads: () => reads,
    hold: () => { gate = new Promise<void>((resolve) => { open = resolve; }); },
    release: () => { gate = null; open(); },
    serverChanges: async (id: string, patch: Row) => {
      const row = state.settings.find((r) => r.id === id)!;
      Object.assign(row, patch, { version: Number(row.version ?? 0) + 1 });
      state.rev++;
      const before = reads;
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
      await expect.poll(() => reads).toBeGreaterThan(before);
    },
  };
}

const setting = { id: 'room-setting-1', tip: 'oda', anahtar: 'salon', deger: JSON.stringify({ en_cm: 320, boy_cm: 450 }), version: 1 };

/** Ölçüleri olan odada form özetin "Ölçüleri düzenle" eyleminin arkasındadır; eski düzende form doğrudan görünür. */
async function dimsForm(page: Page) {
  const edit = page.getByRole('button', { name: 'Ölçüleri düzenle', exact: true });
  if (await edit.isVisible() && await edit.isEnabled()) await edit.click();
  return page.getByTestId('room-dims-form');
}

test('late room settings cannot replace an editable unsaved dimension', async ({ page }) => {
  const api = await sourceApi(page, [setting]);
  api.hold();
  try {
    await page.goto('/aile/#/yerlesim/salon');
    await api.firstRead;
    const width = page.getByTestId('room-dims-form').getByLabel('En (cm)', { exact: true });
    const editable = await width.isVisible() && await width.isEnabled();
    // The chosen design: nothing is editable before the first read, so a late read has no draft to replace.
    expect(editable, 'dimensions are not editable before the first source read').toBe(false);
    if (editable) await width.fill('777');
    api.release();
    // Okuma gelmeden yazılabilen bir değer, gelen okumayla silinemez; yazılamıyorsa okuma gelince gerçek değer görünür.
    if (editable) await expect(width).toHaveValue('777');
    else await expect(page.getByTestId('room-dims-summary')).toContainText('320 cm');
    const form = await dimsForm(page);
    await expect(form.getByLabel('En (cm)', { exact: true })).toHaveValue(editable ? '777' : '320');
  } finally { api.release(); }
});

test('before the first source read the dimensions are a loading summary with a disabled edit action', async ({ page }) => {
  const api = await sourceApi(page, [setting]);
  api.hold();
  try {
    await page.goto('/aile/#/yerlesim/salon');
    await api.firstRead;
    const summary = page.getByTestId('room-dims-summary');
    await expect(summary.getByRole('status')).toContainText('Ölçüler okunuyor');
    await expect(summary.getByRole('button', { name: 'Ölçüleri düzenle' })).toBeDisabled();
    await expect(page.getByTestId('room-dims-form')).toHaveCount(0);
    api.release();
    await expect(summary).toContainText('320 cm');
    await expect(summary.getByRole('button', { name: 'Ölçüleri düzenle' })).toBeEnabled();
  } finally { api.release(); }
});

test('a room saved around its first load updates the existing setting instead of creating another identity', async ({ page }) => {
  const api = await sourceApi(page, [setting]);
  api.hold();
  try {
    await page.goto('/aile/#/yerlesim/salon');
    await api.firstRead;
    const form = page.getByTestId('room-dims-form');
    const width = form.getByLabel('En (cm)', { exact: true });
    const save = form.getByRole('button', { name: 'Ölçüleri kaydet', exact: true });
    const editable = await width.isVisible() && await width.isEnabled() && await save.isEnabled();
    expect(editable, 'dimensions cannot be saved before the first source read').toBe(false);
    if (editable) { await width.fill('777'); await save.click(); }
    api.release();
    if (!editable) {
      await expect(page.getByTestId('room-dims-summary')).toContainText('320 cm');
      await dimsForm(page);
      await expect(width).toHaveValue('320');
      await width.fill('777');
      await save.click();
    }
    await expect.poll(() => api.writes.length).toBeGreaterThan(0);
    expect(api.writes.every((w) => w.id === 'room-setting-1')).toBe(true);
  } finally { api.release(); }
});

test('a background update of the same setting keeps the typed width and the save keeps the newer remote length', async ({ page }) => {
  const api = await sourceApi(page, [setting]);
  await page.goto('/aile/#/yerlesim/salon');
  await expect(page.getByTestId('wall-D')).toContainText('450');
  const form = await dimsForm(page);
  const width = form.getByLabel('En (cm)', { exact: true });
  await expect(width).toHaveValue('320');
  await width.fill('777');
  await api.serverChanges('room-setting-1', { deger: JSON.stringify({ en_cm: 320, boy_cm: 999 }) });
  await expect(page.getByTestId('wall-D')).toContainText('999');
  await expect(width).toHaveValue('777');
  await form.getByRole('button', { name: 'Ölçüleri kaydet', exact: true }).click();
  await expect.poll(() => api.writes.length).toBeGreaterThan(0);
  const last = api.writes.at(-1)!;
  expect(last.id).toBe('room-setting-1');
  expect(JSON.parse(String(last.deger))).toEqual({ en_cm: 777, boy_cm: 999 });
});

const KITAPLIK = '01TESTLAYOUT000000000000002';
const card = (page: Page, id: string) => page.locator(`[data-testid="layout-item-card"][href$="/${id}"]`);

test('an item opened from its card returns focus to the card on Escape', async ({ page }) => {
  await mockApi(page, fixture);
  await page.goto('/aile/#/yerlesim/salon');
  const opener = card(page, KITAPLIK);
  await opener.focus();
  await page.keyboard.press('Enter');
  const form = page.getByTestId('layout-item-form');
  await expect(form).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(form).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('after Save focus is on the saved item card; after Delete on the page heading', async ({ page }) => {
  await mockApi(page, fixture);
  await page.goto('/aile/#/yerlesim/salon');
  const opener = card(page, KITAPLIK);
  await opener.click();
  const form = page.getByTestId('layout-item-form');
  await form.getByRole('textbox', { name: 'Not' }).fill('Raf arası 35 cm');
  await form.getByRole('button', { name: 'Kaydet', exact: true }).click();
  await expect(form).toHaveCount(0);
  await expect(opener).toBeFocused();
  await opener.click();
  await form.getByRole('button', { name: 'Sil', exact: true }).click();
  await page.getByRole('dialog').filter({ hasText: 'Kalemi sil?' }).getByRole('button', { name: 'Sil' }).click();
  await expect(card(page, KITAPLIK)).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
});

test('with reduced motion, Delete still lands on the page heading', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mockApi(page, fixture);
  await page.goto('/aile/#/yerlesim/salon');
  await card(page, KITAPLIK).click();
  await page.getByTestId('layout-item-form').getByRole('button', { name: 'Sil', exact: true }).click();
  await page.getByRole('dialog').filter({ hasText: 'Kalemi sil?' }).getByRole('button', { name: 'Sil' }).click();
  await expect(page.getByTestId('layout-item-form')).toHaveCount(0);
  await expect(card(page, KITAPLIK)).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
});

test('a cold deep link to an item has no opener: closing focuses the record card', async ({ page }) => {
  await mockApi(page, fixture);
  await page.goto(`/aile/#/yerlesim/salon/${KITAPLIK}`);
  const form = page.getByTestId('layout-item-form');
  await expect(form.getByLabel(/^Ad/)).toHaveValue('Kitaplık');
  await page.keyboard.press('Escape');
  await expect(form).toHaveCount(0);
  await expect(card(page, KITAPLIK)).toBeFocused();
});

test('room page at 320 shows a dimensions summary, readable wall headings and the first item on the first screen', async ({ page }, testInfo) => {
  await mockApi(page, fixture);
  await page.goto('/aile/#/yerlesim/salon');
  const viewport = page.viewportSize()!;
  // İlk eşya kartının başlığı ilk ekranda.
  const first = page.getByTestId('layout-item-card').first().getByRole('heading');
  const firstBox = (await first.boundingBox())!;
  expect(firstBox.y + firstBox.height).toBeLessThanOrEqual(viewport.height);
  // Duvar adı tek satırlık başlık; taşma cümlesi kırpılmadan tam görünür.
  const wall = page.getByTestId('wall-K');
  const heading = wall.getByRole('heading', { name: 'Kuzey duvarı' });
  const lines = await heading.evaluate((el) => { const r = document.createRange(); r.selectNodeContents(el); return new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size; });
  expect(lines).toBe(1);
  const over = wall.getByText('20 cm taşıyor');
  await expect(over).toBeVisible();
  const clipped = await over.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const host = el.closest('[data-testid="wall-K"]')!.getBoundingClientRect();
    return el.scrollWidth > el.clientWidth + 1 || box.right > host.right + 1 || box.left < host.left - 1;
  });
  expect(clipped).toBe(false);
  const summary = page.getByTestId('room-dims-summary');
  for (const value of ['320 cm', '450 cm', '270 cm', 'Serbest']) await expect(summary).toContainText(value);
  expect(await horizontalOverflow(page)).toEqual([]);
  expect(await smallTargets(page)).toEqual([]);
  expect(await smallText(page), 'metin < 14px').toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('room-320-first-screen.png') });
  // Sayfanın sonunda FAB son içeriği örtmez.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const needs = page.getByTestId('needs-map');
  const fab = (await page.getByTestId('fab').boundingBox())!;
  const needsBox = (await needs.boundingBox())!;
  expect(needsBox.y + needsBox.height).toBeLessThanOrEqual(fab.y);
  expect(await horizontalOverflow(page)).toEqual([]);
  expect(await smallTargets(page)).toEqual([]);
  expect(await smallText(page), 'metin < 14px').toEqual([]);
});
