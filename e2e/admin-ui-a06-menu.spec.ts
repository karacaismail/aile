import { test, expect, type Locator, type Page } from '@playwright/test';
import { accentEdges, focusRing, motion, smallText, touchTargets } from './admin-detectors';
import { enterKeyboardMode, openAdmin, shiftTabKey, tabKey } from './admin-helpers';

// a06 Menu + OverflowActions (src/admin/ui/Menu.tsx, OverflowActions.tsx) gerçek tarayıcıda.
// Kaynaklar: tasarim-sistemi/components/Menu, OverflowActions README; WAI-ARIA APG Menu ve Menu Button; CLAUDE.md
// arayüz kuralları (çevreleyen odak halkası yok, ≥14 px metin, 44/48 px hedef, kavisli vurgu kenarı yok, seçili durum
// yüzey tonu + ağırlık, 240 ms tek eğri, reduced-motion anlık).
//
// Gerçek rotalar (telefon profili, projeler chromium 320×568 ve webkit 390×844 dokunmatik):
//  - #/butce ve #/hesaplar: PageHeader telefonda ikincil eylemleri "Diğer" (OverflowActions → alt sayfa) altına alır.
//  - Sayfalar çekmecesi (telefon, tablet) ve yan gezinme (masaüstü): kabuğun gezinmesi bir bağlantı listesidir (APG: site
//    gezinmesi menü değildir); Menu README görsel kuralları (44/48 px, seçili secili + 600, şerit yok, nav üzerinde odak
//    çizgisi) orada doğrulanır. Satırı dolduran bağlantı satır taşıyıcısıdır (data-focus-line="row"): odak çizgisi
//    bağlantının kendi alt kenarındadır (bottom 0), böylece seçili sayfada secili yüzeyin, diğerlerinde lacivertin
//    üzerindedir (WCAG 1.4.11 en az 3:1).
// Menu'nün bağlantılı öğesi WAI-ARIA APG kalıbıdır: <li role="none"><a role="menuitem" href aria-current="page">; odak,
// sekme durağı, aria-current ve yüzey menuitem'in kendisindedir (iç <a> ayrı bir link rolü/odak hedefi değildir).
// Menu variant="nav" ve açılır panel (geniş profil) hiçbir rotada görünmez (PageHeader genişte ikincil düğme çizer);
// bu yüzden aynı dev sunucusunun kaynak modülleri (Menu.tsx, OverflowActions.tsx) admin.html üzerinde, gerçek admin.css
// ve <html> data-profile/data-input-* öznitelikleriyle bir yalıtık köke bağlanır (bkz. mountNavHarness: bu projenin
// görünümü; mountHarness: 1280 masaüstü). Emülasyon gerçek cihaz değildir. @matrix etiketli testler entegrasyonda
// 360/375/320×480/568×320 telefon, 820×1180 tablet ve 1440 masaüstü projelerinde de koşar.

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

test('telefon #/butce: klavye — Enter açar, odak ilk öğede tek alt çizgiyle, oklar/Home/End yerinde, menü tek sekme durağı (Tab Kapat ↔ öğe), Escape düğmeye döner', MATRIX, async ({ page, browserName }) => {
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
  // Modal alt sayfada menü tek sekme durağıdır: Shift+Tab Kapat'a, Tab yeniden menüdeki öğeye (odak alt sayfada kalır).
  await expect(item).toHaveAttribute('tabindex', '0');
  await page.keyboard.press(shiftTabKey(browserName));
  await expect(sheet.getByRole('button', { name: 'Kapat' })).toBeFocused();
  await page.keyboard.press(tabKey(browserName));
  await expect(item).toBeFocused();
  expect(await focusRing(page)).toEqual([]);
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

// --- 2. Sayfalar çekmecesi (telefon, tablet): gezinme bir bağlantı listesidir, menü değil ---------------------------
// Kabuk (shell/MobileNavDrawer.tsx ShellNavList; masaüstü yan gezinmesiyle ortak) sayfa gezinmesini yerel <ul>/<a>
// listesiyle çizer. WAI-ARIA APG: site gezinmesi role="menu" değildir (menu uygulama komutları içindir); tasarım
// paketindeki Menu variant="nav" de düz bir bağlantı listesidir (bundle.js Menu: <ul> > <li> > <a aria-current>).
// Her bağlantı doğal Tab sırasındadır; ok/typeahead yoktur. Tasarımın Menu README görsel kuralları (44/48 px öğe, seçili
// secili + 600, şerit yok, nav üzerinde odak çizgisi) bu listede doğrulanır. Menu'nün kendi nav varyantı (roving
// tabindex, oklar, Home/End, typeahead, pointercancel) bölüm 3'te bu projenin görünümünde yalıtık kökte sınanır.

async function openPagesDrawer(page: Page, route = '/alimlar') {
  await openAdmin(page, route);
  test.skip(await profileOf(page) === 'desktop', 'Masaüstünde gezinme kalıcı yan paneldedir; çekmece yok');
  await page.getByRole('button', { name: 'Sayfalar', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Sayfalar' });
  await expect(dialog).toBeVisible();
  return dialog.getByRole('navigation', { name: 'Sayfalar' });
}

/** Odaklı öğenin odak çizgisinin rengi (admin.css: taşıyıcının ::after'ı). */
const lineColor = (target: Locator) => target.evaluate(element => getComputedStyle(element, '::after').backgroundColor);
/**
 * Satır çizgisi (admin.css [data-focus-line='row']): paylaşılan dedektörün satır seçeneği, gap = -kalınlık → beklenen
 * bottom 0 (çizgi bağlantının kendi alt kenarında, bağlantı genişliğinde). Kabuk gezinme bağlantıları satırı doldurur.
 */
const ROW_LINE = { thickness: 3, gap: -3 } as const;

/**
 * Sayfalar gezinmesi: telefon ve tablette Sayfalar çekmecesi (modal), masaüstünde kalıcı yan gezinme (aside; geniş-özel
 * modül yüklenene kadar beklenir). İkisi de kabuğun aynı bağlantı listesidir (ShellNavList).
 */
async function openPagesNav(page: Page, route = '/alimlar') {
  await openAdmin(page, route);
  if (await profileOf(page) === 'desktop') {
    const side = page.locator('aside').getByRole('navigation', { name: 'Sayfalar' });
    await expect(side).toBeVisible();
    return side;
  }
  await page.getByRole('button', { name: 'Sayfalar', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Sayfalar' });
  await expect(dialog).toBeVisible();
  return dialog.getByRole('navigation', { name: 'Sayfalar' });
}

/** Odaklı bağlantının köşeleri: çizginin değdiği alt köşeler radiussuz, üst köşeler korunur (kavisli vurgu kenarı yok). */
const corners = (target: Locator) => target.evaluate(element => {
  const style = getComputedStyle(element);
  return {
    top: [style.borderTopLeftRadius, style.borderTopRightRadius],
    bottom: [style.borderBottomLeftRadius, style.borderBottomRightRadius],
  };
});

/**
 * Odak çizgisinin (::after) rengi ile çizginin üzerine çizildiği zeminin kontrast oranı (WCAG göreli parlaklık). Zemin,
 * çizginin ortasındaki noktadaki en üst öğeden köke doğru katmanlanan arka planlardır; çizginin geometrisinden (kontrolün
 * altında ya da içinde) bağımsız olarak gerçekte bitiştiği yüzeyi ölçer.
 */
function focusLineContrast(target: Locator) {
  return target.evaluate(element => {
    type Rgba = [number, number, number, number];
    const parse = (value: string): Rgba | null => {
      const match = value.match(/rgba?\(([^)]+)\)/);
      if (!match) return null;
      const parts = match[1]!.split(/[\s,/]+/).filter(Boolean).map(Number);
      return [parts[0]!, parts[1]!, parts[2]!, parts[3] ?? 1];
    };
    // Çizgi görünüm alanında olsun (kısa yükseklikte seçili öğe kenarda kalabilir; dışarıdaki noktada isabet olmaz).
    element.scrollIntoView({ block: 'center', inline: 'nearest' });
    const after = getComputedStyle(element, '::after');
    const line = parse(after.backgroundColor);
    const box = element.getBoundingClientRect();
    const bottom = box.bottom - Number.parseFloat(after.bottom);
    const y = bottom - Number.parseFloat(after.height) / 2;
    const x = box.left + box.width / 2;
    if (y < 0 || y >= window.innerHeight || x < 0 || x >= window.innerWidth) {
      return { line: after.backgroundColor, under: `görünüm dışı (x ${Math.round(x)}, y ${Math.round(y)}; görünüm ${window.innerWidth}×${window.innerHeight})`, ratio: 0 };
    }
    // Noktadaki en üst öğe: çizgi kontrolün içindeyse (satır/etiket çizgisi) kontrolün kendi yüzeyi, dışındaysa altındaki
    // yüzey (sözde öğe pointer-events: none, isabet almaz).
    const under = document.elementsFromPoint(x, y)[0] ?? document.body;
    const layers: Rgba[] = [];
    for (let node: Element | null = under; node; node = node.parentElement) {
      const color = parse(getComputedStyle(node).backgroundColor);
      if (color && color[3] > 0) layers.push(color);
      if (color && color[3] >= 1) break;
    }
    let base: [number, number, number] = [255, 255, 255];
    for (const [r, g, b, a] of layers.reverse()) base = [r * a + base[0] * (1 - a), g * a + base[1] * (1 - a), b * a + base[2] * (1 - a)];
    const luminance = ([r, g, b]: readonly number[]) => {
      const channel = (value: number) => { const c = value / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * channel(r!) + 0.7152 * channel(g!) + 0.0722 * channel(b!);
    };
    if (!line) return { line: after.backgroundColor, under: base.map(Math.round).join(','), ratio: 0 };
    const [l1, l2] = [luminance(line), luminance(base)].sort((a, b) => b - a);
    return { line: after.backgroundColor, under: `rgb(${base.map(Math.round).join(', ')})`, ratio: Math.round(((l1! + 0.05) / (l2! + 0.05)) * 100) / 100 };
  });
}

/**
 * Sayfadaki geçişler ve animasyonlar (çekmecenin 240 ms kayması, odakla kaydırma) bitene kadar bekler: iki ardışık karede
 * süren sonlu animasyon yok. Geometri ölçümü hareket ortasında alınmaz (yük altında açılış kayması Tab'lardan uzun sürebilir).
 */
async function settleMotion(page: Page) {
  await page.evaluate(() => { (window as unknown as { __a06Calm?: number }).__a06Calm = 0; });
  await page.waitForFunction(() => {
    const w = window as unknown as { __a06Calm?: number };
    const busy = document.getAnimations().some(animation => animation.playState === 'running'
      && Number.isFinite(Number(animation.effect?.getComputedTiming().endTime)));
    w.__a06Calm = busy ? 0 : (w.__a06Calm ?? 0) + 1;
    return w.__a06Calm >= 2;
  }, undefined, { polling: 'raf', timeout: 5_000 });
}

/** Klavye modunda Tab ile (en çok `limit` adım) hedefe gelir; programatik odak :focus-visible vermeyebilir. */
async function tabTo(page: Page, browserName: string, target: Locator, limit = 16) {
  for (let step = 0; step < limit && !(await target.evaluate(element => element === document.activeElement)); step += 1) {
    await page.keyboard.press(tabKey(browserName));
  }
  await expect(target).toBeFocused();
}

test('Sayfalar gezinmesi: bağlantı listesi (menü rolü yok), her bağlantı Tab sırasında; seçili sayfa secili yüzey + 600, vurgu kenarı yok; 44/48 px; ≥14 px', MATRIX, async ({ page }) => {
  const nav = await openPagesDrawer(page);
  await expect(nav.getByRole('menu')).toHaveCount(0);
  await expect(nav.getByRole('menuitem')).toHaveCount(0);
  const links = nav.getByRole('link');
  expect(await links.count()).toBeGreaterThan(0);
  expect(await links.evaluateAll(elements => elements.filter(element => (element as HTMLElement).tabIndex < 0).map(element => element.textContent)),
    'Tab sırasından çıkarılmış bağlantı').toEqual([]);
  const selected = nav.getByRole('link', { name: 'Alımlar ve eşyalar' });
  await expect(selected).toHaveAttribute('aria-current', 'page');
  await expect(nav.locator('[aria-current]')).toHaveCount(1);

  const look = await selected.evaluate(element => {
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
  expect(await accentEdges(page, { root: '[role="dialog"] nav' })).toEqual([]);
  expect(await smallText(page, { root: '[role="dialog"] nav' })).toEqual([]);
  await expectTargets(page, links);
});

test('Sayfalar gezinmesi: Tab/Shift+Tab bağlantılar arasında doğal sırada; tek alt çizgi bağlantının alt kenarında, nav zemininde odak-nav, seçili sayfada odak; Enter gezinir, çekmece kapanır, odak main\'e', MATRIX, async ({ page, browserName }) => {
  const nav = await openPagesDrawer(page);
  await enterKeyboardMode(page, browserName);
  const link = (name: string) => nav.getByRole('link', { name, exact: true });
  const selected = link('Alımlar ve eşyalar');
  await tabTo(page, browserName, selected);
  await expect(selected).toHaveAttribute('data-focus-line', 'row');
  expect(await focusRing(page, ROW_LINE)).toEqual([]);
  expect(await lineColor(selected), 'seçili sayfada çizgi secili yüzeyde: odak').toBe(await tokenColor(page, '--aile-odak'));

  await page.keyboard.press(tabKey(browserName));
  await expect(link('Ev ve odalar')).toBeFocused();
  expect(await focusRing(page, ROW_LINE)).toEqual([]);
  expect(await lineColor(link('Ev ve odalar'))).toBe(await tokenColor(page, '--aile-odak-nav'));
  await page.keyboard.press(shiftTabKey(browserName));
  await expect(selected).toBeFocused();
  await page.keyboard.press(tabKey(browserName));
  await expect(link('Ev ve odalar')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/ev$/);
  await expect(page.getByRole('dialog', { name: 'Sayfalar' })).toBeHidden();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ev ve odalar');
  await expect(page.locator('main#admin-content')).toBeFocused();
});

test('Sayfalar gezinmesi: odak çizgisi lacivert zeminde en az 3:1 kontrastlı (WCAG 1.4.11), seçili sayfada da', MATRIX, async ({ page, browserName }) => {
  // Telefon/tablet: Sayfalar çekmecesi; masaüstü: yan gezinme. Çizgi bağlantının alt kenarında (satır), seçili sayfada
  // secili yüzeyin üzerinde odak, diğerlerinde lacivertin üzerinde odak-nav; değdiği alt köşeler radiussuz.
  const nav = await openPagesNav(page);
  await enterKeyboardMode(page, browserName);
  const problems: string[] = [];
  for (const name of ['Alımlar ve eşyalar', 'Ev ve odalar']) {
    const target = nav.getByRole('link', { name, exact: true });
    await tabTo(page, browserName, target, 24);
    await settleMotion(page);
    const contrast = await focusLineContrast(target);
    if (contrast.ratio < 3) problems.push(`${name}: çizgi ${contrast.line}, zemin ${contrast.under}, oran ${contrast.ratio}`);
    expect(await focusRing(page, ROW_LINE), `${name}: çizgi bağlantının alt kenarında`).toEqual([]);
    expect((await corners(target)).bottom, `${name}: çizginin değdiği alt köşeler`).toEqual(['0px', '0px']);
    expect(await accentEdges(page, { root: '[data-odak-zemin="nav"]' }), `${name}: kavisli vurgu kenarı`).toEqual([]);
  }
  expect(problems).toEqual([]);
  // İşaretçi modunda (pointerdown görsel modu kapatır, odak yerinde kalır) çizgi yok ve köşeler yerine döner (koşullu
  // radius). Olay gezinme yüzeyine gönderilir: bağlantı etkinleşmez, çekmece açık kalır.
  const selected = nav.getByRole('link', { name: 'Alımlar ve eşyalar', exact: true });
  await selected.focus();
  await nav.dispatchEvent('pointerdown', { pointerType: 'mouse', pointerId: 1, isPrimary: true, button: 0 });
  await expect(page.locator('html')).toHaveAttribute('data-keyboard', 'false');
  await expect(selected).toBeFocused();
  expect(await focusRing(page, ROW_LINE), 'işaretçi modunda çizgi yok').toEqual([]);
  const look = await corners(selected);
  expect(look.bottom, 'işaretçi modunda alt köşeler kontrol köşesi').toEqual(look.top);
  expect(look.top.every(value => value !== '0px'), 'üst köşeler korunur').toBe(true);
});

test('Sayfalar gezinmesi: pointercancel (kaydırmaya dönen dokunuş) gezinmez; dokunuş/tıklama gezinir ve çekmeceyi kapatır', MATRIX, async ({ page }, testInfo) => {
  const touch = testInfo.project.use.hasTouch;
  const nav = await openPagesDrawer(page);
  const dialog = page.getByRole('dialog', { name: 'Sayfalar' });
  const target = nav.getByRole('link', { name: 'Ev ve odalar', exact: true });
  await target.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 3, isPrimary: true, button: 0 });
  await target.dispatchEvent('pointercancel', { pointerType: 'touch', pointerId: 3, isPrimary: true });
  await expect(page).toHaveURL(/#\/alimlar$/);
  await expect(dialog).toBeVisible();
  await press(target, touch);
  await expect(page).toHaveURL(/#\/ev$/);
  await expect(dialog).toBeHidden();
});

// --- 3. Menu variant="nav" bu projenin görünümünde (yalıtık kök; telefon 320/390, @matrix) ---------------------------

interface NavHarnessWindow { __a06nav: { selected: string[] } }

/**
 * Bu projenin görünümünde (telefon profili dahil) admin.html'i açar, uygulama kökünü gizler ve dev sunucusunun aynı React
 * örneğiyle Menu variant="nav"ı lacivert bir <nav data-odak-zemin="nav"> içine bağlar (gerçek admin.css + Menu.css;
 * profil ve giriş katmanları <html>'den). Öğeler kabuğun gerçek gezinme verisidir (shell/navigation.ts). Sağlayıcı
 * (WideProviders) yoktur: Menu yerel bileşendir; telefon profili antd istemez.
 */
async function mountNavHarness(page: Page) {
  await openAdmin(page, '/genel');
  await page.evaluate(async () => {
    const main = await (await fetch('/aile/src/admin/main.tsx')).text();
    const dep = (name: string) => {
      const found = main.match(new RegExp(`["'](/aile/node_modules/\\.vite/deps/${name}\\.js\\?v=[^"']+)["']`));
      if (!found) throw new Error(`dev bağımlılık adresi bulunamadı: ${name}`);
      return found[1]!;
    };
    type ReactLike = { createElement: (...args: unknown[]) => unknown };
    type Root = { render(node: unknown): void };
    type NavLink = { path: string; label: string };
    const load = (url: string) => import(url) as Promise<Record<string, unknown>>;
    const react = (await load(dep('react'))).default as ReactLike;
    const client = (await load(dep('react-dom_client'))).default as { createRoot(element: Element): Root };
    const { Menu } = await load('/aile/src/admin/ui/Menu.tsx');
    const navigation = await load('/aile/src/admin/shell/navigation.ts');
    const pages = navigation.adminPages as readonly NavLink[];
    const settings = navigation.settingsLink as NavLink;
    const items = [
      ...pages.map(item => ({ key: item.path.slice(1), label: item.label, href: `#${item.path}` })),
      { key: 'ayirici', label: '', divider: true },
      { key: settings.path.slice(1), label: settings.label, href: `#${settings.path}` },
    ];
    const h = react.createElement;
    const selected: string[] = [];
    (document.getElementById('admin-root') as HTMLElement).style.display = 'none';
    const host = document.createElement('div');
    host.className = 'aile-admin';
    host.id = 'a06-nav-harness';
    host.style.cssText = 'position:fixed;inset:0;overflow:auto;background:var(--aile-nav);';
    document.body.append(host);
    client.createRoot(host).render(
      h('nav', { 'aria-label': 'Sınama gezinmesi', 'data-odak-zemin': 'nav', style: { padding: 'var(--aile-bosluk-3)', color: 'var(--aile-nav-metin)' } },
        h(Menu, { variant: 'nav', items, selectedKey: 'alimlar', onSelect: (key: string) => selected.push(key) })));
    (window as unknown as NavHarnessWindow).__a06nav = { selected };
  });
  const menu = page.locator('#a06-nav-harness').getByRole('navigation', { name: 'Sınama gezinmesi' }).getByRole('menu');
  await expect(menu).toBeVisible();
  return menu;
}
const navSelections = (page: Page) => page.evaluate(() => (window as unknown as NavHarnessWindow).__a06nav.selected.slice());

test('Menu variant="nav" (bu görünüm): APG bağlantılı öğe (li role=none > a role=menuitem); tek sekme durağı seçili sayfa; seçili secili yüzey + 600, vurgu kenarı yok; 44/48 px; ≥14 px', MATRIX, async ({ page }) => {
  const menu = await mountNavHarness(page);
  // Menü içinde ayrı link rolü yok: bağlantı menuitem'in kendisidir; aria-current tek ve menuitem'de.
  await expect(menu.getByRole('link')).toHaveCount(0);
  const stops = menu.locator('[tabindex="0"]');
  await expect(stops).toHaveCount(1);
  const selected = menu.getByRole('menuitem', { name: 'Alımlar ve eşyalar' });
  await expect(selected).toHaveAttribute('aria-current', 'page');
  await expect(selected).toHaveAttribute('href', '#/alimlar');
  expect(await selected.evaluate(element => [element.tagName, element.parentElement?.tagName, element.parentElement?.getAttribute('role')]))
    .toEqual(['A', 'LI', 'none']);
  await expect(menu.locator('[aria-current]')).toHaveCount(1);
  await expect(stops.first()).toHaveAttribute('aria-current', 'page');
  await expect(stops.first()).toHaveAttribute('role', 'menuitem');
  await expect(menu).toHaveAttribute('data-variant', 'nav');

  const look = await selected.evaluate(element => {
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
  const other = menu.getByRole('menuitem', { name: 'Ev ve odalar' });
  const otherLook = await other.evaluate(element => {
    const style = getComputedStyle(element);
    return { color: style.color, decoration: style.textDecorationLine };
  });
  expect(otherLook.color, 'nav varyantında öğe metni nav-metin (admin.css bağlantı rengi değil)').toBe(await tokenColor(page, '--aile-nav-metin'));
  expect(otherLook.decoration).toBe('none');
  expect(await accentEdges(page, { root: '#a06-nav-harness [role="menu"]' })).toEqual([]);
  expect(await smallText(page, { root: '#a06-nav-harness [role="menu"]' })).toEqual([]);
  await expectTargets(page, menu.getByRole('menuitem'));
});

test('Menu variant="nav" (bu görünüm): odak menuitem\'in kendisinde; oklar sarmalı, Home/End, typeahead (tr-TR); odak çizgisi tek alt çizgi, nav üzerinde odak-nav; Enter bağlantıyı izler', MATRIX, async ({ page, browserName }) => {
  const menu = await mountNavHarness(page);
  await enterKeyboardMode(page, browserName);
  const link = (name: string) => menu.getByRole('menuitem', { name, exact: true });
  const focusedRole = () => page.evaluate(() => document.activeElement?.getAttribute('role') ?? document.activeElement?.tagName ?? null);
  const selected = link('Alımlar ve eşyalar');
  // Tek sekme durağı: uygulama kökü gizli olduğundan ilk Tab doğrudan menünün durağına (seçili sayfa) gelir.
  await tabTo(page, browserName, selected, 2);
  expect(await focusedRole(), 'odak menuitem\'de (iç bağlantıda değil)').toBe('menuitem');
  expect(await focusRing(page)).toEqual([]);
  // Seçili öğede de çizgi lacivert zemine düşer: odak-nav, en az 3:1 (Menu.css nav kuralı).
  expect(await lineColor(selected)).toBe(await tokenColor(page, '--aile-odak-nav'));
  expect((await focusLineContrast(selected)).ratio).toBeGreaterThanOrEqual(3);

  await page.keyboard.press('ArrowDown');
  await expect(link('Ev ve odalar')).toBeFocused();
  expect(await focusedRole()).toBe('menuitem');
  expect(await focusRing(page)).toEqual([]);
  expect(await lineColor(link('Ev ve odalar'))).toBe(await tokenColor(page, '--aile-odak-nav'));
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
  expect(await navSelections(page)).toEqual(['odemeler']);
});

test('Menu variant="nav" (bu görünüm): pointercancel basılı yüzeyi kaldırır ve seçmez; dokunuş/tıklama bağlantıyı izler', MATRIX, async ({ page }, testInfo) => {
  const touch = testInfo.project.use.hasTouch;
  const menu = await mountNavHarness(page);
  const target = menu.getByRole('menuitem', { name: 'Ev ve odalar', exact: true });
  await target.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 3, isPrimary: true, button: 0 });
  await expect(target).toHaveAttribute('data-pressed', '');
  await target.dispatchEvent('pointercancel', { pointerType: 'touch', pointerId: 3, isPrimary: true });
  await expect(target).not.toHaveAttribute('data-pressed');
  await expect(page).toHaveURL(/#\/genel$/);
  expect(await navSelections(page)).toEqual([]);
  await press(target, touch);
  await expect(page).toHaveURL(/#\/ev$/);
  expect(await navSelections(page)).toEqual(['ev']);
  await expect(target).not.toHaveAttribute('data-pressed');
});

// --- 4. Açılır panel ve collapse="auto" (geniş profil; kaynak modül yalıtık kökte) ----------------------------------

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
    // Uygulama hiçbir profilde antd sağlayıcısıyla (WideProviders) sarılmaz; Menu, OverflowActions ve Button yereldir.
    // Yalıtık kök de üretimdeki gibi sağlayıcısızdır (antd indirilmez).
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
      root.render(h('div', null,
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
          h(Menu, { trigger: 'Alttaki', items, align: 'end', onSelect: (key: string) => selected.push(`alt:${key}`) }))));
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

// --- 5. Rapor seçimi (#/raporlar): sayfa içi seçim, menü değil -------------------------------------------------------
// Eskiden Menu kullanan masaüstü rapor listesi (pages/raporlar/RaporMenu.wide.tsx) gezinme değil, aynı sayfada gösterilen
// raporu seçer: menü rolü (uygulama komutları) ve aria-current="page" yerine yerel düğme listesi, seçili rapor
// aria-current="true". Yalnız masaüstü profilinde ve lazyWide ile gelir; telefon ve tablette aynı seçim "Rapor" alanıdır
// ve geniş liste modülü hiç istenmez.

const REPORT_LABELS = ['Aylık plan ve gerçek', 'Kaleme göre harcama', 'Borç ödeme planı', 'Oda bazında alımlar', 'Veri güveni özeti'];
const RAPOR_MENU_MODULE = /\/src\/admin\/pages\/raporlar\/RaporMenu\.wide\.tsx/;

async function openReports(page: Page) {
  const requests: string[] = [];
  page.on('request', request => requests.push(new URL(request.url()).pathname));
  const main = await openAdmin(page, '/raporlar');
  return { main, requests, profile: await profileOf(page) };
}

test('#/raporlar rapor seçimi: masaüstünde yerel düğme listesi (menü yok, aria-current="true"), telefon ve tablette "Rapor" alanı, liste modülü istenmez', MATRIX, async ({ page }) => {
  const { main, requests, profile } = await openReports(page);
  const picker = main.getByRole('list', { name: 'Rapor seçimi' });
  await expect(main.getByRole('menu')).toHaveCount(0);
  await expect(main.getByRole('menuitem')).toHaveCount(0);
  await expect(main.locator('[aria-current="page"]')).toHaveCount(0);
  if (profile !== 'desktop') {
    await expect(main.getByRole('combobox', { name: 'Rapor' })).toBeVisible();
    await expect(picker).toHaveCount(0);
    expect(requests.filter(path => RAPOR_MENU_MODULE.test(path)), 'telefon/tablet rapor listesi modülünü istemez').toEqual([]);
    return;
  }
  await expect(picker).toBeVisible();
  const buttons = picker.getByRole('button');
  await expect(buttons).toHaveText(REPORT_LABELS);
  expect(await buttons.evaluateAll(elements => elements.map(element => [element.tagName, element.getAttribute('type')].join(':'))))
    .toEqual(REPORT_LABELS.map(() => 'BUTTON:button'));
  const selected = picker.getByRole('button', { name: 'Aylık plan ve gerçek', exact: true });
  await expect(selected).toHaveAttribute('aria-current', 'true');
  await expect(picker.locator('[aria-current]')).toHaveCount(1);
  await expect(main.getByRole('combobox', { name: 'Rapor' })).toHaveCount(0);

  const look = await selected.evaluate(element => {
    const style = getComputedStyle(element);
    return {
      background: style.backgroundColor, weight: style.fontWeight, shadow: style.boxShadow,
      borders: ['top', 'right', 'bottom', 'left'].map(side => style.getPropertyValue(`border-${side}-width`)),
    };
  });
  expect(look.background).toBe(await tokenColor(page, '--aile-secili'));
  expect(Number(look.weight)).toBe(600);
  expect(look.shadow).toBe('none');
  expect(look.borders).toEqual(['0px', '0px', '0px', '0px']);
  await expectTargets(page, buttons);
  expect(await touchTargets(page, { root: '.aile-rapor-secim' })).toEqual([]);
  expect(await smallText(page, { root: '.aile-rapor-secim' })).toEqual([]);
  expect(await accentEdges(page, { root: '.aile-rapor-secim' })).toEqual([]);
  expect(await motion(page, 'cubic-bezier(.65,0,.35,1)', 240, { root: '.aile-rapor-secim' })).toEqual([]);
});

test('#/raporlar rapor seçimi (masaüstü): her düğme Tab sırasında; Enter/Boşluk seçer, odak düğmede; oklar/Escape yerinde; satır çizgisi düğmenin alt kenarında, halka yok', MATRIX, async ({ page, browserName }) => {
  const { main, profile } = await openReports(page);
  test.skip(profile !== 'desktop', 'Rapor listesi yalnız masaüstü profilinde');
  const picker = main.getByRole('list', { name: 'Rapor seçimi' });
  const button = (name: string) => picker.getByRole('button', { name, exact: true });
  await expect(button('Aylık plan ve gerçek')).toBeVisible();
  // Satırı dolduran düğme satır taşıyıcısıdır: çizgi kendi alt kenarında (bottom 0), seçili düğmede secili yüzeyin
  // üzerinde; değdiği alt köşeler yalnız çizgi görünürken radiussuz, üst köşeler korunur (kavisli vurgu kenarı yok).
  await expect(button('Aylık plan ve gerçek')).toHaveAttribute('data-focus-line', 'row');
  await enterKeyboardMode(page, browserName);
  await tabTo(page, browserName, button('Aylık plan ve gerçek'), 40);
  expect(await focusRing(page, ROW_LINE)).toEqual([]);
  expect((await corners(button('Aylık plan ve gerçek'))).bottom).toEqual(['0px', '0px']);
  expect(await accentEdges(page, { root: '.aile-rapor-secim' })).toEqual([]);
  await page.keyboard.press(tabKey(browserName));
  await expect(button('Kaleme göre harcama')).toBeFocused();
  expect(await focusRing(page, ROW_LINE)).toEqual([]);
  const unfocused = await corners(button('Aylık plan ve gerçek'));
  expect(unfocused.bottom, 'odak gidince alt köşeler geri döner').toEqual(unfocused.top);
  expect(unfocused.top.every(value => value !== '0px')).toBe(true);
  // Düğme listesi bileşik pencere öğesi değildir: oklar, Home/End ve Escape odağı ve seçimi değiştirmez.
  for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Escape']) {
    await page.keyboard.press(key);
    await expect(button('Kaleme göre harcama'), key).toBeFocused();
  }
  await expect(button('Aylık plan ve gerçek')).toHaveAttribute('aria-current', 'true');
  await page.keyboard.press('Enter');
  await expect(button('Kaleme göre harcama')).toHaveAttribute('aria-current', 'true');
  await expect(button('Aylık plan ve gerçek')).not.toHaveAttribute('aria-current');
  await expect(main.getByRole('region', { name: 'Kaleme göre harcama' })).toBeVisible();
  await expect(button('Kaleme göre harcama')).toBeFocused();
  expect(await focusRing(page, ROW_LINE), 'seçili düğmede de tek satır çizgisi, secili yüzeyde en az 3:1').toEqual([]);
  await page.keyboard.press(shiftTabKey(browserName));
  await expect(button('Aylık plan ve gerçek')).toBeFocused();
  await page.keyboard.press(' ');
  await expect(button('Aylık plan ve gerçek')).toHaveAttribute('aria-current', 'true');
  await expect(main.getByRole('region', { name: 'Aylık plan ve gerçek' })).toBeVisible();
  await expect(button('Aylık plan ve gerçek')).toBeFocused();
  await expect(page.locator('html')).toHaveAttribute('data-keyboard', 'true');
  expect(await focusRing(page, ROW_LINE)).toEqual([]);
});

test('#/raporlar rapor seçimi (masaüstü): pointercancel basılı yüzeyi kaldırır ve seçmez; dokunuş/tıklama seçer; reduced-motion anında', MATRIX, async ({ page }, testInfo) => {
  const touch = testInfo.project.use.hasTouch;
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const { main, profile } = await openReports(page);
  test.skip(profile !== 'desktop', 'Rapor listesi yalnız masaüstü profilinde');
  const picker = main.getByRole('list', { name: 'Rapor seçimi' });
  const target = picker.getByRole('button', { name: 'Veri güveni özeti', exact: true });
  await target.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 5, isPrimary: true, button: 0 });
  await expect(target).toHaveAttribute('data-pressed', '');
  await target.dispatchEvent('pointercancel', { pointerType: 'touch', pointerId: 5, isPrimary: true });
  await expect(target).not.toHaveAttribute('data-pressed');
  await expect(target).not.toHaveAttribute('aria-current');
  await expect(picker.getByRole('button', { name: 'Aylık plan ve gerçek', exact: true })).toHaveAttribute('aria-current', 'true');
  expect(await motion(page, 'cubic-bezier(.65,0,.35,1)', 240, { root: '.aile-rapor-secim', reduced: true })).toEqual([]);
  await press(target, touch);
  await expect(target).toHaveAttribute('aria-current', 'true');
  await expect(main.getByRole('region', { name: 'Veri güveni özeti' })).toBeVisible();
  await expect(target).not.toHaveAttribute('data-pressed');
  const background = await target.evaluate(element => getComputedStyle(element).backgroundColor);
  expect(background, 'reduced-motion: seçili yüzey geçişsiz, anında').toBe(await tokenColor(page, '--aile-secili'));
});
