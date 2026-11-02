import type { Page } from '@playwright/test';

export const ADMIN = 'admin.html#';

/** Yönetim giriş noktasını hash rotasıyla açar ve ana landmark'ı bekler. */
export async function gotoAdmin(page: Page, hash = '/alimlar') {
  await page.goto(ADMIN + hash);
  await page.getByRole('main').waitFor();
}

export const tabKey = (browserName: string) => (browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
export const shiftTabKey = (browserName: string) => (browserName === 'webkit' ? 'Alt+Shift+Tab' : 'Shift+Tab');

export { horizontalOverflow } from './helpers';

/** Klavye modunu açar (installKeyboardMode: Tab → html[data-keyboard='true']). */
export async function enterKeyboardMode(page: Page, browserName: string) {
  await page.keyboard.press(tabKey(browserName));
  await page.waitForFunction(() => document.documentElement.dataset.keyboard === 'true');
}
