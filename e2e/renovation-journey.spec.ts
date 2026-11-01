import { test, expect, type Page } from '@playwright/test';
import { mockApi } from './helpers';
import data from './fixtures/renovation.json' with { type: 'json' };

// Tadilat kayıt yolculuğu: işin açıldığı bağlam (takvim olayı ya da liste) kapanışta, kayıtta ve yeniden yüklemede korunur;
// odak açan öğeye, o yoksa listedeki aynı kayda, o da yoksa sayfa başlığına döner.

const drawer = (page: Page) => page.getByTestId('timeline-drawer');
const entry = (page: Page, name: RegExp) => page.getByTestId('timeline').getByRole('button', { name });

async function openT1FromCalendar(page: Page) {
  await mockApi(page, data);
  await page.goto('/#/tadilat');
  await entry(page, /T1 Elektrik altyapı/).click();
  await expect(drawer(page)).toBeVisible();
  await drawer(page).getByRole('button', { name: 'İşi aç' }).click();
  await expect(page.getByTestId('task-detail')).toBeVisible();
}

async function expectBackOnT1Drawer(page: Page) {
  await expect(page.getByTestId('task-detail')).toBeHidden();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tadilat takvimi');
  await expect(page.getByTestId('timeline')).toBeVisible();
  await expect(drawer(page)).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('T1 Elektrik altyapı');
  // The task was opened from the drawer: the drawer's own button takes focus again.
  await expect(drawer(page).getByRole('button', { name: 'İşi aç' })).toBeFocused();
  // Closing the drawer then returns to the calendar entry itself.
  await page.keyboard.press('Escape');
  await expect(drawer(page)).toBeHidden();
  await expect(entry(page, /T1 Elektrik altyapı/)).toBeFocused();
}

test('takvimden açılan iş Escape ile kapanınca takvim ve aynı olayın çekmecesi geri gelir', async ({ page }) => {
  await openT1FromCalendar(page);
  await page.keyboard.press('Escape');
  await expectBackOnT1Drawer(page);
});

test('takvimden açılan iş Vazgeç ile kapanınca takvim ve aynı olayın çekmecesi geri gelir', async ({ page }) => {
  await openT1FromCalendar(page);
  await page.getByTestId('task-detail').getByRole('button', { name: 'Vazgeç' }).click();
  await expectBackOnT1Drawer(page);
});

test('takvimden açılan iş kaydedilince takvime döner ve değişiklik çekmecede görünür', async ({ page }) => {
  await openT1FromCalendar(page);
  await page.getByTestId('task-detail').getByLabel('Not', { exact: true }).fill('Takvimden yazılan not');
  await page.getByTestId('task-detail').getByRole('button', { name: 'Kaydet' }).click();
  await expect(page.getByTestId('task-detail')).toBeHidden();
  await expect(drawer(page)).toContainText('Takvimden yazılan not');
  await expect(drawer(page).getByRole('button', { name: 'İşi aç' })).toBeFocused();
});

test('takvimden açılan iş sayfa yenilense de kapanınca takvime döner', async ({ page }) => {
  await openT1FromCalendar(page);
  await page.reload();
  await expect(page.getByTestId('task-detail')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('task-detail')).toBeHidden();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tadilat takvimi');
  await expect(drawer(page)).toBeVisible();
  await expect(drawer(page).getByRole('button', { name: 'İşi aç' })).toBeFocused();
});

test('kilometre taşının bağlı işi kapanınca o taşın çekmecesine ve aynı iş düğmesine döner', async ({ page }) => {
  await mockApi(page, data);
  await page.goto('/#/tadilat');
  await entry(page, /Mobilya sipariş son gün/).click();
  await drawer(page).getByRole('button', { name: /T3 Mutfak dolabı/ }).click();
  await expect(page.getByTestId('task-detail')).toBeVisible();
  await page.getByTestId('task-detail').getByRole('button', { name: 'Vazgeç' }).click();
  await expect(page.getByTestId('task-detail')).toBeHidden();
  await expect(page.getByRole('dialog')).toContainText('Mobilya sipariş son gün');
  await expect(drawer(page).getByRole('button', { name: /T3 Mutfak dolabı/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(entry(page, /Mobilya sipariş son gün/)).toBeFocused();
  // The calendar keeps its scroll context: the entry the user came from is on screen.
  await expect(entry(page, /Mobilya sipariş son gün/)).toBeInViewport();
});

test('listeden açılan iş Escape ile kapanınca listeye ve aynı karta döner', async ({ page }) => {
  await mockApi(page, data);
  await page.goto('/#/tadilat/isler');
  const link = page.getByRole('link', { name: /Duvar boyası.*detayı/ });
  await link.click();
  await expect(page.getByTestId('task-detail')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('task-detail')).toBeHidden();
  await expect(page).toHaveURL(/#\/tadilat\/isler$/);
  await expect(link).toBeFocused();
});

test('işin derin bağlantısı kapanınca listedeki aynı kayda odaklanır', async ({ page }) => {
  await mockApi(page, data);
  await page.goto('/#/tadilat/isler/01TESTTD00000000000000002');
  await expect(page.getByTestId('task-detail')).toBeVisible();
  await page.getByTestId('task-detail').getByRole('button', { name: 'Vazgeç' }).click();
  await expect(page.getByTestId('task-detail')).toBeHidden();
  await expect(page.getByRole('link', { name: /Duvar boyası.*detayı/ })).toBeFocused();
});

test('usta Escape ile kapanınca aynı karta, silinince sayfa başlığına odak döner', async ({ page }) => {
  await mockApi(page, data);
  await page.goto('/#/tadilat/ustalar');
  const link = page.getByRole('link', { name: 'Örnek Boya Ustası detayı' });
  await link.click();
  await expect(page.getByTestId('vendor-detail')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('vendor-detail')).toBeHidden();
  await expect(link).toBeFocused();
  await link.click();
  await page.getByTestId('vendor-detail').getByRole('button', { name: 'Sil' }).click();
  await page.getByRole('dialog', { name: 'Ustayı sil?' }).getByRole('button', { name: 'Sil' }).click();
  await expect(page.getByTestId('vendor-detail')).toBeHidden();
  await expect(page.getByRole('link', { name: 'Örnek Boya Ustası detayı' })).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
});

test('ustanın derin bağlantısı kaydedilince listedeki aynı kayda odaklanır', async ({ page }) => {
  await mockApi(page, data);
  await page.goto('/#/tadilat/ustalar/01TESTUS00000000000000001');
  const form = page.getByTestId('vendor-detail');
  await expect(form).toBeVisible();
  await form.getByLabel('Not', { exact: true }).fill('Derin bağlantı notu');
  await form.getByRole('button', { name: 'Kaydet' }).click();
  await expect(form).toBeHidden();
  await expect(page.getByRole('link', { name: 'Örnek Elektrik Ustası detayı' })).toBeFocused();
});

// Round 5 review (RED first): the browser's Back button closes the drawer without its onClose; focus must still land on the entry.
test('tarayıcının Geri düğmesi çekmeceyi kapatınca odak takvimdeki aynı olaya döner', async ({ page }) => {
  await mockApi(page, data);
  await page.goto('/#/tadilat');
  await entry(page, /T1 Elektrik altyapı/).click();
  await expect(drawer(page)).toBeVisible();
  await page.goBack();
  await expect(drawer(page)).toBeHidden();
  await expect(page).toHaveURL(/#\/tadilat$/);
  await expect(entry(page, /T1 Elektrik altyapı/)).toBeFocused();
});
