import { expect, test, type Locator, type Page } from '@playwright/test';
import { accentEdges, focusRing, motion, smallText } from './admin-detectors';
import { openAdmin, tabKey } from './admin-helpers';

// Görev a03 — yerel Select (antd yok) gerçek rotada: Raporlar. Telefonda "Rapor" seçimi alttan açılan modal diyalog
// (APG listbox, dolaşan odak); genişte "Dönem" seçimi popover listbox (odak tetikte, aria-activedescendant).
// Görev koşusu: chromium 320×568 dokunmatik ve webkit 390×844 dokunmatik (ikisi de telefon profili); geniş davranış
// aynı projelerde görünüm alanı büyütülerek ölçülür. @matrix testleri entegrasyonda ek projelerde (360/375/kısa/yatay
// telefon, tablet, masaüstü) de koşar ve profile göre dallanır. Emülasyon gerçek cihaz değildir.
// Veri: webServer yalnız sentetik nesli (fixtures/generation-synthetic) servis eder; Google'a çağrı yok.

const EASE = 'cubic-bezier(0.65, 0, 0.35, 1)';
const WIDE = { width: 1280, height: 800 };
const SHEET = 'dialog.aile-select-sayfa';
const POPOVER = '.aile-select-acilir';

const profileOf = (page: Page) => page.evaluate(() => document.documentElement.dataset.profile ?? '');
const minTarget = async (page: Page) => ((await page.evaluate(() => document.documentElement.hasAttribute('data-input-coarse'))) ? 48 : 44);
const hasTouch = (page: Page) => page.evaluate(() => navigator.maxTouchPoints > 0);
const press = async (page: Page, locator: Locator) => ((await hasTouch(page)) ? locator.tap() : locator.click());
const heightOf = async (locator: Locator) => (await locator.boundingBox())?.height ?? 0;
/** Select kökü (tetiğin üstü) için dedektör seçicisi. */
const rootOf = async (combo: Locator) => `.aile-select:has(> [id="${await combo.getAttribute('id')}"])`;

async function expectTargets(page: Page, locators: Locator[]) {
  const min = await minTarget(page);
  for (const locator of locators) expect(await heightOf(locator), await locator.textContent() ?? '').toBeGreaterThanOrEqual(min - 0.5);
}

/** Giriş hareketi bitene kadar bekler (panel/popover transform 'none'). */
async function settled(page: Page, selector: string) {
  await expect(page.locator(selector)).toHaveAttribute('data-state', 'acik');
  await expect.poll(() => page.locator(selector).evaluate(el => getComputedStyle(el.matches('dialog') ? el.querySelector('.aile-select-sayfa-panel')! : el).transform)).toBe('none');
}

/** Profilin seçimi: telefonda "Rapor" (veri durumundan bağımsız çizilir), genişte "Dönem". */
async function routeSelect(page: Page) {
  await openAdmin(page, '/raporlar');
  const phone = (await profileOf(page)) === 'phone';
  const combo = page.getByRole('combobox', { name: phone ? 'Rapor' : 'Dönem', exact: true });
  await expect(combo).toBeVisible();
  return { phone, combo };
}

test.describe('a03 Select — gerçek rota', () => {
  test('profiline göre açılır, dokunmayla seçer, kapanır ve odak tetiğe döner; hedef ≥44/48 px, metin ≥14 px', { tag: '@matrix' }, async ({ page }) => {
    const { phone, combo } = await routeSelect(page);
    await expect(combo).toHaveAttribute('aria-haspopup', phone ? 'dialog' : 'listbox');
    await expect(page.locator('select')).toHaveCount(0);
    await expectTargets(page, [combo]);
    expect(await smallText(page, { root: await rootOf(combo) })).toEqual([]);

    await press(page, combo);
    await expect(combo).toHaveAttribute('aria-expanded', 'true');
    if (phone) {
      const dialog = page.getByRole('dialog', { name: 'Rapor' });
      await expect(dialog).toBeVisible();
      expect(await dialog.evaluate(el => el.matches(':modal'))).toBe(true);
      await expect(dialog.getByRole('option', { selected: true })).toBeFocused();
      await settled(page, SHEET);
      // Top layer: görünüm alanının üstü örtüdür (arka plan inert, tıklanamaz).
      expect(await page.evaluate(() => document.elementFromPoint(8, 8)?.closest('dialog.aile-select-sayfa') !== null)).toBe(true);
      await expectTargets(page, [...await dialog.getByRole('option').all(), dialog.getByRole('button', { name: 'Kapat' })]);
      expect(await smallText(page, { root: SHEET })).toEqual([]);
      expect(await accentEdges(page, { root: SHEET })).toEqual([]);
      expect(await motion(page, undefined, undefined, { root: SHEET })).toEqual([]);
      expect(await focusRing(page)).toEqual([]); // işaretçi modu: gösterge görünmez
      const panel = page.locator('.aile-select-sayfa-panel');
      expect(await panel.evaluate(el => [getComputedStyle(el).transitionDuration, getComputedStyle(el).transitionTimingFunction])).toEqual(['0.24s', EASE]);

      const target = dialog.getByRole('option', { selected: false }).first();
      const name = ((await target.textContent()) ?? '').trim();
      await press(page, target);
      await expect(combo).toHaveAttribute('aria-expanded', 'false');
      await expect(combo).toBeFocused();
      await expect(page.locator(SHEET)).toHaveCount(0);
      await expect(combo).toContainText(name);

      // Örtüye dokunmak seçmeden kapatır; odak tetiğe döner.
      await press(page, combo);
      await settled(page, SHEET);
      if (await hasTouch(page)) await page.touchscreen.tap(8, 8);
      else await page.mouse.click(8, 8);
      await expect(page.locator(SHEET)).toHaveCount(0);
      await expect(combo).toBeFocused();
      await expect(combo).toContainText(name);
    } else {
      const list = page.getByRole('listbox', { name: 'Dönem' });
      await expect(list).toBeVisible();
      await expect(combo).toBeFocused();
      expect(await page.locator(POPOVER).evaluate(el => el.matches(':popover-open'))).toBe(true);
      await settled(page, POPOVER);
      const box = (await page.locator(POPOVER).boundingBox())!;
      const viewport = page.viewportSize()!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
      await expectTargets(page, await list.getByRole('option').all());
      expect(await smallText(page, { root: POPOVER })).toEqual([]);
      expect(await motion(page, undefined, undefined, { root: POPOVER })).toEqual([]);
      const target = list.getByRole('option', { selected: false }).first();
      const name = ((await target.textContent()) ?? '').trim();
      await press(page, target);
      await expect(combo).toHaveAttribute('aria-expanded', 'false');
      await expect(combo).toBeFocused();
      await expect(page.locator(POPOVER)).toHaveCount(0);
      await expect(combo).toContainText(name);
    }
  });

  test('klavye: Tab ile tetiğe gelir, Enter açar, oklar gezer, Escape kapatır; tek alt çizgi göstergesi', { tag: '@matrix' }, async ({ page, browserName }) => {
    const { phone, combo } = await routeSelect(page);
    for (let i = 0; i < 40 && !(await combo.evaluate(el => el === document.activeElement)); i += 1) await page.keyboard.press(tabKey(browserName));
    await expect(combo).toBeFocused();
    await expect(page.locator('html')).toHaveAttribute('data-keyboard', 'true');
    expect(await focusRing(page)).toEqual([]);

    await page.keyboard.press('Enter');
    await expect(combo).toHaveAttribute('aria-expanded', 'true');
    if (phone) {
      const dialog = page.getByRole('dialog', { name: 'Rapor' });
      const options = dialog.getByRole('option');
      await expect(dialog.getByRole('option', { selected: true })).toBeFocused();
      await settled(page, SHEET);
      expect(await focusRing(page)).toEqual([]);
      const before = await page.evaluate(() => document.activeElement?.id);
      await page.keyboard.press('ArrowDown');
      const after = await page.evaluate(() => document.activeElement?.id);
      if ((await options.count()) > 1 && (await dialog.getByRole('option').last().getAttribute('id')) !== before) expect(after).not.toBe(before);
      expect(await page.evaluate(() => document.activeElement?.getAttribute('role'))).toBe('option');
      expect(await focusRing(page)).toEqual([]);
      await page.keyboard.press('Escape');
      await expect(page.locator(SHEET)).toHaveCount(0);
    } else {
      await settled(page, POPOVER);
      await expect(combo).toBeFocused();
      const first = await combo.getAttribute('aria-activedescendant');
      expect(first).toBeTruthy();
      await page.keyboard.press('End');
      const last = await combo.getAttribute('aria-activedescendant');
      await expect(page.locator(`[id="${last}"]`)).toHaveClass(/is-etkin/);
      // Etkin seçenekte alt çizgi (klavye modu, tetik :focus-visible).
      expect(await page.locator(`[id="${last}"]`).evaluate(el => getComputedStyle(el, '::after').height)).toBe('3px');
      await page.keyboard.press('Escape');
      await expect(page.locator(POPOVER)).toHaveCount(0);
    }
    await expect(combo).toHaveAttribute('aria-expanded', 'false');
    await expect(combo).toBeFocused();
    expect(await focusRing(page)).toEqual([]);
  });

  test('kapanış iki yönlü hareketle: ARIA ve odak hemen, katman çıkış geçişi bitince kalkar; Pointer iptali seçmez', async ({ page }) => {
    const { phone, combo } = await routeSelect(page);
    await press(page, combo);
    const layer = phone ? SHEET : POPOVER;
    await settled(page, layer);
    const valueBefore = (await combo.textContent())?.trim();

    // Dokunma başlar, tarayıcı kaydırmaya geçer (pointercancel): basılı görünüm kalkar, seçim olmaz.
    const cancelled = await page.evaluate(async (selector) => {
      const option = document.querySelector(`${selector} [role="option"][aria-selected="false"]:not([aria-disabled="true"])`) as HTMLElement;
      const init = { bubbles: true, pointerId: 41, pointerType: 'touch', isPrimary: true } as PointerEventInit;
      option.dispatchEvent(new PointerEvent('pointerdown', init));
      await Promise.resolve();
      const pressed = option.classList.contains('is-basili');
      option.dispatchEvent(new PointerEvent('pointercancel', init));
      await Promise.resolve();
      return { pressed, after: option.classList.contains('is-basili') };
    }, layer);
    expect(cancelled).toEqual({ pressed: true, after: false });
    await expect(combo).toHaveAttribute('aria-expanded', 'true');
    expect((await combo.textContent())?.trim()).toBe(valueBefore);

    const exit = await page.evaluate(async ({ selector, sheet }) => {
      const target = sheet ? document.activeElement! : document.querySelector('[role="combobox"][aria-expanded="true"]')!;
      target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
      await Promise.resolve();
      await Promise.resolve();
      const layerEl = document.querySelector(selector) as HTMLElement | null;
      const animated = sheet ? layerEl?.querySelector('.aile-select-sayfa-panel') : layerEl;
      return {
        expanded: document.querySelector('[role="combobox"][aria-expanded="true"]') !== null,
        focusOnTrigger: document.activeElement?.getAttribute('role') === 'combobox',
        state: layerEl?.dataset.state ?? null,
        running: animated ? animated.getAnimations().length : 0,
      };
    }, { selector: layer, sheet: phone });
    expect(exit.expanded).toBe(false);
    expect(exit.focusOnTrigger).toBe(true);
    expect(exit.state).toBe('cikis');
    expect(exit.running).toBeGreaterThan(0);
    await expect(page.locator(layer)).toHaveCount(0);
    await expect(combo).toBeFocused();
  });

  test('reduced-motion: geçiş yok, durum anında', { tag: '@matrix' }, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const { phone, combo } = await routeSelect(page);
    await press(page, combo);
    const layer = phone ? SHEET : POPOVER;
    await expect(page.locator(layer)).toHaveAttribute('data-state', 'acik');
    const animated = phone ? '.aile-select-sayfa-panel' : POPOVER;
    expect(await page.locator(animated).evaluate(el => getComputedStyle(el).transitionDuration.split(',').every(d => parseFloat(d) === 0))).toBe(true);
    expect(await motion(page, undefined, undefined, { root: layer, reduced: true })).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(combo).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator(layer)).toHaveCount(0);
    await expect(combo).toBeFocused();
  });

  test('seçim profil değişiminde korunur (telefon → geniş → telefon)', async ({ page }) => {
    const start = page.viewportSize()!;
    const { phone, combo } = await routeSelect(page);
    test.skip(!phone, 'Başlangıç profili telefon olmalı (görev projeleri 320 ve 390 px)');
    // "Kaleme göre harcama" Dönem seçimini de gösterir.
    await press(page, combo);
    await press(page, page.getByRole('dialog', { name: 'Rapor' }).getByRole('option', { name: 'Kaleme göre harcama', exact: true }));
    await expect(combo).toContainText('Kaleme göre harcama');
    const donem = page.getByRole('combobox', { name: 'Dönem', exact: true });
    await expect(donem).toBeVisible();
    test.skip((await donem.getAttribute('aria-disabled')) === 'true', 'Sentetik nesilde dönem yok');
    await press(page, donem);
    const sheetDialog = page.getByRole('dialog', { name: 'Dönem' });
    const choice = sheetDialog.getByRole('option', { selected: false }).last();
    const chosen = ((await choice.textContent()) ?? '').trim();
    await press(page, choice);
    await expect(donem).toContainText(chosen);

    await page.setViewportSize(WIDE);
    await expect(page.locator('html')).toHaveAttribute('data-profile', 'desktop');
    await expect(donem).toContainText(chosen);
    await expect(donem).toHaveAttribute('aria-haspopup', 'listbox');
    await press(page, donem);
    await expect(page.getByRole('listbox', { name: 'Dönem' }).getByRole('option', { name: chosen, exact: true })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Escape');

    await page.setViewportSize(start);
    await expect(page.locator('html')).toHaveAttribute('data-profile', 'phone');
    await expect(donem).toContainText(chosen);
  });
});
