import { test, expect, type Locator, type Page } from '@playwright/test';
import { accentEdges, focusRing, motion, smallText } from './admin-detectors';
import { enterKeyboardMode, openAdmin, tabKey } from './admin-helpers';

// a06 Menu + OverflowActions (src/admin/ui/Menu.tsx, OverflowActions.tsx) gerçek tarayıcıda.
// Kaynaklar: tasarim-sistemi/components/Menu, OverflowActions README; WAI-ARIA APG Menu ve Menu Button; CLAUDE.md
// arayüz kuralları (çevreleyen odak halkası yok, ≥14 px metin, 44/48 px hedef, kavisli vurgu kenarı yok, seçili durum
// yüzey tonu + ağırlık, 240 ms tek eğri, reduced-motion anlık).
//
// Gerçek rotalar (telefon profili, projeler chromium 320×568 ve webkit 390×844 dokunmatik):
//  - #/butce ve #/hesaplar: PageHeader telefonda ikincil eylemleri "Diğer" (OverflowActions → alt sayfa) altına alır.
//  - Sayfalar çekmecesi: gezinme Menu'sü (variant nav; roving tabindex, oklar, Home/End, typeahead).
// Açılır panel (geniş profil) hiçbir rotada görünmez (PageHeader genişte ikincil düğme çizer); bu yüzden aynı dev
// sunucusunun kaynak modülleri (Menu.tsx, OverflowActions.tsx) admin.html üzerinde, gerçek admin.css ve <html>
// data-profile/data-input-* öznitelikleriyle bir yalıtık köke bağlanır (bkz. mountHarness). Emülasyon gerçek cihaz
// değildir. @matrix etiketli testler entegrasyonda 360/375/320×480/568×320 telefon projelerinde de koşar.

const MATRIX = { tag: '@matrix' };
/** Menu.tsx TYPEAHEAD_RESET_MS ile aynı (APG typeahead dizesinin sıfırlanma süresi). */
const TYPEAHEAD_RESET_MS = 500;
/** Dokunmatik projede gerçek dokunuş (touch → pointer), diğerlerinde fare tıklaması. */
const press = (target: Locator, touch: boolean | undefined) => (touch ? target.tap() : target.click());

const profileOf = (page: Page) => page.locator('html').getAttribute('data-profile');
async function minTarget(page: Page) {
  return (await page.locator('html').getAttribute('data-input-coarse')) !== null ? 48 : 44;
}
/** CSS değişkeninin çözülmüş rengi (rgb). */
function tokenColor(page: Page, name: string) {
  return page.evaluate(token => {
    const probe = document.createElement('span');
    probe.style.color = `var(${token})`;
    (document.querySelector('.aile-admin') ?? document.body).append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, name);
}
const menuItemOf = (link: Locator) => link.locator('xpath=ancestor::li[@role="menuitem"][1]');

async function expectTargets(page: Page, items: Locator) {
  const min = await minTarget(page);
  const count = await items.count();
  expect(count).toBeGreaterThan(0);
  for (let index = 0; index < count; index += 1) {
    const box = (await items.nth(index).boundingBox())!;
    expect(box.height, `öğe ${index + 1} yüksekliği`).toBeGreaterThanOrEqual(min - 0.5);
    expect(box.width).toBeGreaterThanOrEqual(min);
  }
}

// --- 1. Diğer alt sayfası (telefon) ---------------------------------------------------------------------------------

test('telefon #/butce: "Diğer" alt sayfası — menü rolleri, odak ilk öğede, 44/48 px hedef, ≥14 px, Escape ve Kapat odağı döndürür', MATRIX, async ({ page }, testInfo) => {
  const touch = testInfo.project.use.hasTouch;
  await openAdmin(page, '/butce');
  test.skip(await profileOf(page) !== 'phone', 'Diğer yalnız telefon profilinde; genişte ikincil düğmeler (PageHeader)');
  const main = page.locator('main#admin-content');
  const trigger = main.getByRole('button', { name: 'Diğer', exact: true });
  await expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');

  await press(trigger, touch);
  const sheet = page.getByRole('dialog', { name: 'Diğer eylemler' });
  await expect(sheet).toBeVisible();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  const menu = sheet.getByRole('menu', { name: 'Diğer eylemler' });
  const item = menu.getByRole('menuitem', { name: 'Dışa aktar' });
  await expect(item).toBeVisible();
  await expect(item).toBeFocused();
  await expectTargets(page, menu.getByRole('menuitem'));
  expect(await smallText(page, { root: '[role="dialog"] [role="menu"]' })).toEqual([]);
  expect(await accentEdges(page, { root: '[role="dialog"] [role="menu"]' })).toEqual([]);

  // Pointer Events: dokunuş kaydırmaya dönüşürse (pointercancel) basılı yüzey kalkar, eylem çalışmaz.
  await item.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 7, isPrimary: true, button: 0 });
  await expect(item).toHaveAttribute('data-pressed', '');
  await item.dispatchEvent('pointercancel', { pointerType: 'touch', pointerId: 7, isPrimary: true });
  await expect(item).not.toHaveAttribute('data-pressed');
  await expect(sheet).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');

  await press(trigger, touch);
  await expect(sheet).toBeVisible();
  await press(sheet.getByRole('button', { name: 'Kapat' }), touch);
  await expect(sheet).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('telefon #/butce: klavye — Enter açar, odak ilk öğede tek alt çizgiyle, oklar/Home/End yerinde, Escape düğmeye döner', MATRIX, async ({ page, browserName }) => {
  await openAdmin(page, '/butce');
  test.skip(await profileOf(page) !== 'phone', 'Diğer yalnız telefon profilinde');
  const trigger = page.locator('main#admin-content').getByRole('button', { name: 'Diğer', exact: true });
  await enterKeyboardMode(page, browserName);
  await trigger.focus();
  await page.keyboard.press('Enter');
  const sheet = page.getByRole('dialog', { name: 'Diğer eylemler' });
  const item = sheet.getByRole('menuitem', { name: 'Dışa aktar' });
  await expect(item).toBeFocused();
  expect(await focusRing(page)).toEqual([]);
  for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End']) {
    await page.keyboard.press(key);
    await expect(item, key).toBeFocused();
  }
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(page.locator('html')).toHaveAttribute('data-keyboard', 'true');
  expect(await focusRing(page)).toEqual([]);
});

test('telefon #/hesaplar: "Diğer" › "Borç ekle" seçimi alt sayfayı kapatır ve eylemi çalıştırır', MATRIX, async ({ page }, testInfo) => {
  const touch = testInfo.project.use.hasTouch;
  await openAdmin(page, '/hesaplar');
  test.skip(await profileOf(page) !== 'phone', 'Diğer yalnız telefon profilinde');
  const trigger = page.locator('main#admin-content').getByRole('button', { name: 'Diğer', exact: true });
  await press(trigger, touch);
  const sheet = page.getByRole('dialog', { name: 'Diğer eylemler' });
  await press(sheet.getByRole('menuitem', { name: 'Borç ekle' }), touch);
  await expect(sheet).toBeHidden();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('dialog', { name: 'Borç ekle' })).toBeVisible();
});

// --- 2. Sayfalar çekmecesindeki gezinme menüsü (telefon, tablet) ----------------------------------------------------

async function openPagesDrawer(page: Page, route = '/alimlar') {
  await openAdmin(page, route);
  test.skip(await profileOf(page) === 'desktop', 'Masaüstünde gezinme kalıcı yan paneldedir; çekmece yok');
  await page.getByRole('button', { name: 'Sayfalar', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Sayfalar' });
  await expect(dialog).toBeVisible();
  return dialog.getByRole('navigation', { name: 'Sayfalar' }).getByRole('menu');
}

test('Sayfalar menüsü: tek sekme durağı seçili sayfa; seçili durum secili yüzey + 600, vurgu kenarı yok; 44/48 px; ≥14 px', MATRIX, async ({ page }) => {
  const menu = await openPagesDrawer(page);
  const stops = menu.locator('[tabindex="0"]');
  await expect(stops).toHaveCount(1);
  const selected = menu.getByRole('link', { name: 'Alımlar ve eşyalar' });
  await expect(selected).toHaveAttribute('aria-current', 'page');
  await expect(stops.first()).toHaveAttribute('aria-current', 'page');

  const look = await menuItemOf(selected).evaluate(element => {
    const style = getComputedStyle(element);
    return {
      background: style.backgroundColor, weight: style.fontWeight, shadow: style.boxShadow,
      borders: ['Top', 'Right', 'Bottom', 'Left'].map(side => style.getPropertyValue(`border-${side.toLowerCase()}-width`)),
    };
  });
  expect(look.background).toBe(await tokenColor(page, '--aile-secili'));
  expect(Number(look.weight)).toBe(600);
  expect(look.shadow).toBe('none');
  expect(look.borders).toEqual(['0px', '0px', '0px', '0px']);
  expect(await accentEdges(page, { root: '[role="dialog"] [role="menu"]' })).toEqual([]);
  expect(await smallText(page, { root: '[role="dialog"] [role="menu"]' })).toEqual([]);
  await expectTargets(page, menu.getByRole('menuitem'));
});

test('Sayfalar menüsü: oklar sarmalı, Home/End, typeahead (tr-TR); odak çizgisi tek alt çizgi ve nav üzerinde odak-nav; Enter gezinir', MATRIX, async ({ page, browserName }) => {
  const menu = await openPagesDrawer(page);
  await enterKeyboardMode(page, browserName);
  const selected = menu.getByRole('link', { name: 'Alımlar ve eşyalar' });
  for (let step = 0; step < 6 && !(await selected.evaluate(element => element === document.activeElement)); step += 1) {
    await page.keyboard.press(tabKey(browserName));
  }
  await expect(selected).toBeFocused();
  expect(await focusRing(page)).toEqual([]);
  const lineColor = await selected.evaluate(element => getComputedStyle(element, '::after').backgroundColor);
  expect(lineColor).toBe(await tokenColor(page, '--aile-odak-nav'));

  const link = (name: string) => menu.getByRole('link', { name, exact: true });
  await page.keyboard.press('ArrowDown');
  await expect(link('Ev ve odalar')).toBeFocused();
  expect(await focusRing(page)).toEqual([]);
  await expect(link('Ev ve odalar')).toHaveAttribute('tabindex', '0');
  await expect(selected).toHaveAttribute('tabindex', '-1');
  await page.keyboard.press('End');
  await expect(link('Ayarlar')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(link('Genel durum')).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(link('Ayarlar')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(link('Genel durum')).toBeFocused();
  await page.keyboard.press('r');
  await expect(link('Raporlar')).toBeFocused();
  // APG typeahead: 500 ms içinde basılan harfler tek dizedir ("rö" eşleşmez); yeni arama için o süre geçmelidir.
  await page.waitForTimeout(TYPEAHEAD_RESET_MS + 100);
  // Playwright klavyesi yalnız ABD düzenindeki tuşları bilir ("ö" → Unknown key). Türkçe düzenin gönderdiği keydown'u
  // (key "ö") odaklı öğeye gerçek olay olarak yollarız; kabarcıklanır ve menünün tuş işleyicisine ulaşır.
  await link('Raporlar').dispatchEvent('keydown', { key: 'ö', bubbles: true, cancelable: true });
  await expect(link('Ödemeler')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/odemeler$/);
  await expect(page.getByRole('dialog', { name: 'Sayfalar' })).toBeHidden();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ödemeler');
});

test('Sayfalar menüsü: pointercancel basılı yüzeyi kaldırır ve gezinmez; dokunuş gezinir', MATRIX, async ({ page }, testInfo) => {
  const touch = testInfo.project.use.hasTouch;
  const menu = await openPagesDrawer(page);
  const target = menuItemOf(menu.getByRole('link', { name: 'Ev ve odalar', exact: true }));
  await target.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 3, isPrimary: true, button: 0 });
  await expect(target).toHaveAttribute('data-pressed', '');
  await target.dispatchEvent('pointercancel', { pointerType: 'touch', pointerId: 3, isPrimary: true });
  await expect(target).not.toHaveAttribute('data-pressed');
  await expect(page).toHaveURL(/#\/alimlar$/);
  await press(menu.getByRole('link', { name: 'Ev ve odalar', exact: true }), touch);
  await expect(page).toHaveURL(/#\/ev$/);
  await expect(page.getByRole('dialog', { name: 'Sayfalar' })).toBeHidden();
});

// --- 3. Açılır panel ve collapse="auto" (geniş profil; kaynak modül yalıtık kökte) ----------------------------------

interface HarnessWindow { __a06: { selected: string[]; setRowWidth(width: number): void } }

/**
 * Masaüstü genişliğinde admin.html'i açar, uygulama kökünü gizler ve dev sunucusunun aynı React örneğiyle Menu ve
 * OverflowActions'ı .aile-admin sınıflı yalıtık bir köke bağlar (gerçek admin.css, Menu.css; profil <html>'den).
 * React ve react-dom/client adresleri dönüştürülmüş main.tsx'ten okunur (optimize bağımlılık sürüm ekiyle).
 */
async function mountHarness(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openAdmin(page, '/genel');
  await expect(page.locator('html')).toHaveAttribute('data-profile', 'desktop');
  await page.evaluate(async () => {
    const main = await (await fetch('/aile/src/admin/main.tsx')).text();
    const dep = (name: string) => {
      const found = main.match(new RegExp(`["'](/aile/node_modules/\\.vite/deps/${name}\\.js\\?v=[^"']+)["']`));
      if (!found) throw new Error(`dev bağımlılık adresi bulunamadı: ${name}`);
      return found[1]!;
    };
    type ReactLike = { createElement: (...args: unknown[]) => unknown };
    type Root = { render(node: unknown): void };
    const load = (url: string) => import(url) as Promise<Record<string, unknown>>;
    const react = (await load(dep('react'))).default as ReactLike;
    const client = (await load(dep('react-dom_client'))).default as { createRoot(element: Element): Root };
    const { Menu } = await load('/aile/src/admin/ui/Menu.tsx');
    const { OverflowActions } = await load('/aile/src/admin/ui/OverflowActions.tsx');
    // Geniş profilde uygulama WideProviders (antd teması: odak halkası kapalı) içindedir; yalıtık kök de öyle olsun ki
    // henüz antd tabanlı Button (a01) uygulamadaki gibi çizilsin.
    const { WideProviders } = await load('/aile/src/admin/adaptive/WideProviders.tsx');
    const h = react.createElement;
    const selected: string[] = [];
    (document.getElementById('admin-root') as HTMLElement).style.display = 'none';
    const host = document.createElement('div');
    host.className = 'aile-admin';
    host.id = 'a06-harness';
    host.style.cssText = 'position:fixed;inset:0;overflow:auto;padding:24px;';
    document.body.append(host);
    const items = [
      { key: 'duzenle', label: 'Düzenle', icon: 'edit' },
      { key: 'disa', label: 'Dışa aktar', icon: 'download' },
      { key: 'csv', label: 'CSV indir' },
      { key: 'kilitli', label: 'Kilitli eylem', disabled: true },
      { key: 'ice', label: 'İçe aktar' },
      { key: 'sil', label: 'Sil', danger: true },
    ];
    const render = (width: number) => {
      root.render(h(WideProviders, null, h('div', null,
        h('div', { id: 'a06-top', style: { display: 'flex', gap: 16, alignItems: 'center' } },
          h(Menu, { trigger: 'Sırala', items, onSelect: (key: string) => selected.push(key) }),
          h('button', { type: 'button' }, 'Sonraki')),
        h('div', { id: 'a06-row', style: { width, marginTop: 160 } },
          h(OverflowActions, {
            collapse: 'auto',
            primary: h('button', { type: 'button' }, 'Alım ekle'),
            items: [
              { label: 'Düzenle', icon: 'edit', onClick: () => selected.push('row:duzenle') },
              { label: 'Dışa aktar', icon: 'download', onClick: () => selected.push('row:disa') },
              { label: 'Sil', danger: true, onClick: () => selected.push('row:sil') },
            ],
          })),
        h('div', { id: 'a06-bottom', style: { position: 'fixed', right: 24, bottom: 24 } },
          h(Menu, { trigger: 'Alttaki', items, align: 'end', onSelect: (key: string) => selected.push(`alt:${key}`) })))));
    };
    const root = client.createRoot(host);
    render(900);
    (window as unknown as HarnessWindow).__a06 = { selected, setRowWidth: render };
  });
  await expect(page.locator('#a06-harness').getByRole('button', { name: 'Sırala' })).toBeVisible();
  return page.locator('#a06-harness');
}
const selections = (page: Page) => page.evaluate(() => (window as unknown as HarnessWindow).__a06.selected.slice());

test('geniş: menü düğmesi açılır paneli — üst katman, düğmenin altında, görünüm içinde, ilk öğe odakta, 240 ms tek eğri, ≥14 px', async ({ page }) => {
  const harness = await mountHarness(page);
  const trigger = harness.getByRole('button', { name: 'Sırala' });
  await expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
  await trigger.click();
  const menu = page.getByRole('menu', { name: 'Sırala' });
  await expect(menu).toBeVisible();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(trigger).toHaveAttribute('aria-controls', (await menu.getAttribute('id'))!);
  await expect(menu.getByRole('menuitem', { name: 'Düzenle' })).toBeFocused();
  const panel = page.locator('.aile-menu-panel').first();
  const facts = await panel.evaluate(element => ({
    topLayer: typeof (element as HTMLElement).showPopover === 'function' ? element.matches(':popover-open') : null,
    state: element.getAttribute('data-state'),
    side: element.getAttribute('data-side'),
  }));
  if (facts.topLayer !== null) expect(facts.topLayer).toBe(true);
  expect(facts.state).toBe('open');
  expect(facts.side).toBe('bottom');
  const button = (await trigger.boundingBox())!;
  await expect.poll(async () => (await panel.boundingBox())!.y, 'panel yerine oturur').toBeGreaterThanOrEqual(button.y + button.height + 12 - 1);
  const box = (await panel.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(1280);
  expect(box.width).toBeGreaterThanOrEqual(240);
  expect(await motion(page, 'cubic-bezier(.65,0,.35,1)', 240, { root: '.aile-menu-panel' })).toEqual([]);
  expect(await smallText(page, { root: '.aile-menu-panel' })).toEqual([]);
  expect(await accentEdges(page, { root: '.aile-menu-panel' })).toEqual([]);
  await expectTargets(page, menu.getByRole('menuitem'));
  const danger = menu.getByRole('group', { name: 'Tehlikeli eylemler' });
  await expect(danger.getByRole('menuitem', { name: 'Sil' })).toBeVisible();
  const dangerColor = await danger.getByRole('menuitem', { name: 'Sil' }).evaluate(element => getComputedStyle(element).color);
  expect(dangerColor).toBe(await tokenColor(page, '--aile-hata'));
});

test('geniş: klavye — Enter/ArrowUp açar, oklar devre dışıyı atlar ve sarar, typeahead, Enter seçer ve odak döner, Escape döner', async ({ page, browserName }) => {
  const harness = await mountHarness(page);
  const trigger = harness.getByRole('button', { name: 'Sırala' });
  const item = (name: string) => page.getByRole('menu', { name: 'Sırala' }).getByRole('menuitem', { name, exact: true });
  await enterKeyboardMode(page, browserName);
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(item('Düzenle')).toBeFocused();
  expect(await focusRing(page)).toEqual([]);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(item('CSV indir')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(item('İçe aktar')).toBeFocused();
  await page.keyboard.press('End');
  await expect(item('Sil')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(item('Düzenle')).toBeFocused();
  await page.keyboard.press('i');
  await expect(item('İçe aktar')).toBeFocused();
  expect(await focusRing(page)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(await focusRing(page)).toEqual([]);

  await page.keyboard.press('ArrowUp');
  await expect(item('Sil')).toBeFocused();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(trigger).toBeFocused();
  await expect(page.getByRole('menu')).toHaveCount(0);
  expect(await selections(page)).toEqual(['disa']);
});

test('geniş: Tab paneli kapatır ve odak doğal sıradaki öğeye geçer; dışarı tıklama kapatır, odak düğmeye taşınmaz', async ({ page, browserName }) => {
  const harness = await mountHarness(page);
  const trigger = harness.getByRole('button', { name: 'Sırala' });
  await enterKeyboardMode(page, browserName);
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'Düzenle', exact: true })).toBeFocused();
  await page.keyboard.press(tabKey(browserName));
  await expect(harness.getByRole('button', { name: 'Sonraki' })).toBeFocused();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('menu')).toHaveCount(0);

  await trigger.click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.mouse.click(1000, 500);
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(trigger).not.toBeFocused();
});

test('geniş: alttaki düğmenin paneli yukarı açılır ve sağa hizalı görünümde kalır; dokunuş/tıklamayla seçim çalışır', async ({ page }, testInfo) => {
  const touch = testInfo.project.use.hasTouch;
  const harness = await mountHarness(page);
  const trigger = harness.getByRole('button', { name: 'Alttaki' });
  await press(trigger, touch);
  const panel = page.locator('.aile-menu-panel').first();
  await expect(panel).toHaveAttribute('data-side', 'top');
  const button = (await trigger.boundingBox())!;
  await expect.poll(async () => { const box = (await panel.boundingBox())!; return box.y + box.height; }, 'panel düğmenin üstünde')
    .toBeLessThanOrEqual(button.y - 12 + 1);
  const box = (await panel.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(Math.abs(box.x + box.width - (button.x + button.width))).toBeLessThanOrEqual(1);
  await press(page.getByRole('menu', { name: 'Alttaki' }).getByRole('menuitem', { name: 'CSV indir' }), touch);
  await expect(page.getByRole('menu')).toHaveCount(0);
  expect(await selections(page)).toEqual(['alt:csv']);
});

test('geniş: reduced-motion — panel geçişsiz açılır, kapanışta hemen kalkar; durum anında', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const harness = await mountHarness(page);
  const trigger = harness.getByRole('button', { name: 'Sırala' });
  await trigger.click();
  await expect(page.getByRole('menu')).toBeVisible();
  expect(await motion(page, 'cubic-bezier(.65,0,.35,1)', 240, { root: '.aile-menu-panel', reduced: true })).toEqual([]);
  const duration = await page.locator('.aile-menu-panel').evaluate(element => getComputedStyle(element).transitionDuration);
  expect(duration.split(',').map(value => Number.parseFloat(value))).toEqual(duration.split(',').map(() => 0));
  await page.keyboard.press('Escape');
  expect(await page.locator('.aile-menu-panel').count()).toBe(0);
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
});

test('geniş: OverflowActions collapse="auto" — yer varken satırda düğmeler, dar kapsayıcıda "Diğer" menüsü, ana eylem dışarıda', async ({ page }) => {
  const harness = await mountHarness(page);
  const row = harness.locator('#a06-row');
  await expect(row.getByRole('button', { name: 'Düzenle' })).toBeVisible();
  await expect(row.getByRole('group', { name: 'Tehlikeli eylemler' }).getByRole('button', { name: 'Sil' })).toBeVisible();
  await expect(row.getByRole('button', { name: 'Diğer' })).toHaveCount(0);
  await expect(row.getByRole('button', { name: 'Alım ekle' })).toBeVisible();

  await page.evaluate(() => (window as unknown as HarnessWindow).__a06.setRowWidth(220));
  await expect(row.getByRole('button', { name: 'Diğer' })).toBeVisible();
  await expect(row.getByRole('button', { name: 'Düzenle' })).toHaveCount(0);
  await expect(row.getByRole('button', { name: 'Alım ekle' })).toBeVisible();
  await row.getByRole('button', { name: 'Diğer' }).click();
  const menu = page.getByRole('menu', { name: 'Diğer eylemler' });
  await expect(menu.getByRole('menuitem')).toHaveText(['Düzenle', 'Dışa aktar', 'Sil']);
  await menu.getByRole('menuitem', { name: 'Dışa aktar' }).click();
  expect(await selections(page)).toEqual(['row:disa']);

  await page.evaluate(() => (window as unknown as HarnessWindow).__a06.setRowWidth(900));
  await expect(row.getByRole('button', { name: 'Düzenle' })).toBeVisible();
  await expect(row.getByRole('button', { name: 'Diğer' })).toHaveCount(0);
});
