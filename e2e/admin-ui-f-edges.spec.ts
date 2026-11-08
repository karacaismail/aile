import { test, expect, type Locator, type Page } from '@playwright/test';
import { enterKeyboardMode, openAdmin } from './admin-helpers';
import { accentEdges } from './admin-detectors';

// Görev f-edges: son satırın odak çizgisi radiuslu ve taşmayı kırpan kabın köşe eğrisinde kesilmez (kavisli vurgu kenarı
// yasağı, AGENT.md). Satır çizgisi satırın alt kenarındadır; son satırda bu kenar kabın alt kenarıdır. Düzeltme kalıbı:
// yalnız çizgi görünürken (klavye modu + :focus-visible) kabın çizginin değdiği iki alt köşesi radiussuz; üst köşeler,
// diğer satırlar ve işaretçi modu değişmez. Üç kap:
//  - ui/Table.css .aile-table-kaydirici: geniş tablo (masaüstü /butce, /ev). Satırlar tek sekme durağıdır (dolaşan
//    tabindex), son satıra End ile gelinir; sayfa yolculuğu (admin-focus) yalnız ilk satırı gördüğü için burada sınanır.
//  - ui/Overview.css .aile-ov-liste: Genel durum listeleri (geniş profil /genel).
//  - pages/sozlukler/TermTree.css .aile-sz-agac-liste: terim ağacı (telefon /sozlukler), dış ve iç liste.
// Ölçüm paylaşılan dedektörle (accentEdgeViolations: "radiuslu ve kırpan ata kenarında şerit") ve kabın hesaplanmış
// köşeleriyle. Ayrıca Overview hover tonu yalnız gerçek hover girişinde (@media (hover: hover)): dokunmada takılı kalmaz.
// Profilde bulunmayan yüzey testi atlanır (not_applicable): tablo/Overview geniş profilde, terim ağacı telefonda.
// Veri: sentetik nesil (playwright.admin.config.ts webServer); ağ isteği yok.

const MATRIX = { tag: '@matrix' };

interface Corners { tl: string; tr: string; br: string; bl: string }
const corners = (box: Locator): Promise<Corners> => box.evaluate(el => {
  const s = getComputedStyle(el);
  return { tl: s.borderTopLeftRadius, tr: s.borderTopRightRadius, br: s.borderBottomRightRadius, bl: s.borderBottomLeftRadius };
});
const squaredBottom = (before: Corners): Corners => ({ ...before, br: '0px', bl: '0px' });
/** İşaretçi girişi: klavye modunu kapatır (installKeyboardMode pointerdown dinler); odak yerinde kalır. */
const pointerDown = (page: Page) => page.locator('main h1').first().dispatchEvent('pointerdown', { pointerType: 'mouse', bubbles: true });
const keyboardMode = (page: Page) => page.evaluate(() => document.documentElement.dataset.keyboard);

test.describe('geniş tablo: son satırın odak çizgisi', () => {
  for (const route of ['/butce', '/ev']) {
    test(`${route}: End ile son satırda çizgi kabın köşesinde kırpılmaz; köşeler yalnız çizgi görünürken radiussuz`, MATRIX, async ({ page, browserName }) => {
      await openAdmin(page, route);
      const kap = page.locator('main .aile-table-kaydirici').filter({ has: page.locator('tbody tr[tabindex]') }).first();
      test.skip((await kap.count()) === 0, 'telefon profili: tablo akordeondur (not_applicable)');
      const rows = kap.locator('tbody tr[tabindex]');
      expect(await rows.count(), 'en az iki tıklanabilir satır').toBeGreaterThan(1);
      const before = await corners(kap);
      expect(before.bl, 'kap radiuslu').not.toBe('0px');

      await enterKeyboardMode(page, browserName);
      await rows.first().focus();
      await expect(rows.first()).toBeFocused();
      expect(await corners(kap)).toEqual(before);
      await page.keyboard.press('End');
      await expect(rows.last()).toBeFocused();
      expect(await accentEdges(page, { root: 'main' })).toEqual([]);
      expect(await corners(kap)).toEqual(squaredBottom(before));

      await page.keyboard.press('Home');
      await expect(rows.first()).toBeFocused();
      expect(await corners(kap)).toEqual(before);

      await page.keyboard.press('End');
      await pointerDown(page);
      expect(await keyboardMode(page)).toBe('false');
      await expect(rows.last()).toBeFocused();
      expect(await corners(kap)).toEqual(before);
    });
  }
});

test.describe('Genel durum listeleri: son satırın odak çizgisi', () => {
  test('/genel: her listenin son satırında çizgi listenin köşesinde kırpılmaz; ilk satırda köşeler korunur', MATRIX, async ({ page, browserName }) => {
    await openAdmin(page, '/genel');
    const lists = page.locator('main ul.aile-ov-liste');
    test.skip((await lists.count()) === 0, 'Genel durum özeti (Overview) yalnız geniş profilde (not_applicable)');
    await enterKeyboardMode(page, browserName);
    let checked = 0;
    for (let i = 0; i < await lists.count(); i += 1) {
      const list = lists.nth(i);
      const items = list.locator(':scope > li');
      const lastTarget = items.last().locator('a, input:not([disabled])').first();
      if ((await lastTarget.count()) === 0) continue; // son satır odak almıyor (bağlantısız ödeme): çizgi yok
      const before = await corners(list);
      expect(before.bl, `liste ${i} radiuslu`).not.toBe('0px');
      await lastTarget.focus();
      await expect(lastTarget).toBeFocused();
      expect(await accentEdges(page, { root: 'main' }), `liste ${i}`).toEqual([]);
      expect(await corners(list), `liste ${i}`).toEqual(squaredBottom(before));
      if ((await items.count()) > 1) {
        const firstTarget = items.first().locator('a, input:not([disabled])').first();
        if ((await firstTarget.count()) > 0) {
          await firstTarget.focus();
          expect(await corners(list), `liste ${i} ilk satır`).toEqual(before);
          await lastTarget.focus();
        }
      }
      await pointerDown(page);
      expect(await corners(list), `liste ${i} işaretçi modu`).toEqual(before);
      await enterKeyboardMode(page, browserName);
      checked += 1;
    }
    expect(checked, 'son satırı odak alan en az bir liste').toBeGreaterThan(0);
  });
});

/** Satırın arka planı geçiş bitince; hedef ton --aile-bilgi-yuzey'in hesaplanmış rengi. */
async function rowBackground(row: Locator): Promise<{ bg: string; hoverTone: string }> {
  await expect.poll(() => row.evaluate(el => el.getAnimations().length)).toBe(0);
  return row.evaluate(el => {
    const probe = document.createElement('div');
    probe.style.background = 'var(--aile-bilgi-yuzey)';
    el.parentElement!.appendChild(probe);
    const hoverTone = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return { bg: getComputedStyle(el).backgroundColor, hoverTone };
  });
}

test.describe('Genel durum satırı: hover tonu yalnız hover girişinde', () => {
  test('/genel: fareyle üzerine gelince satır bilgi-yüzey tonunu alır', MATRIX, async ({ page }) => {
    await openAdmin(page, '/genel');
    const row = page.locator('main a.aile-ov-satir').first();
    test.skip((await row.count()) === 0, 'Genel durum özeti (Overview) yalnız geniş profilde (not_applicable)');
    test.skip(!(await page.evaluate(() => matchMedia('(hover: hover)').matches)), 'bu projede birincil giriş hover vermiyor');
    await row.hover();
    await expect.poll(async () => { const { bg, hoverTone } = await rowBackground(row); return bg === hoverTone; }).toBe(true);
  });

  test.describe('dokunmatik birincil giriş (hover: none)', () => {
    test.use({ hasTouch: true, isMobile: true });
    test('/genel: hover vermeyen girişte üzerine gelinen (dokunulan) satır hover tonunda takılı kalmaz', MATRIX, async ({ page }) => {
      await openAdmin(page, '/genel');
      const row = page.locator('main a.aile-ov-satir').first();
      test.skip((await row.count()) === 0, 'Genel durum özeti (Overview) yalnız geniş profilde (not_applicable)');
      test.skip(await page.evaluate(() => matchMedia('(hover: hover)').matches), 'bu tarayıcı öykünmesi hover: none vermiyor (not_applicable)');
      await row.hover();
      const { bg, hoverTone } = await rowBackground(row);
      expect(bg).not.toBe(hoverTone);
    });
  });
});

test.describe('terim ağacı: son düğümün odak çizgisi', () => {
  test('/sozlukler: kapalı son düğümde çizgi listenin köşesinde kırpılmaz; açık son düğümde köşeler korunur; iç liste de', MATRIX, async ({ page, browserName }) => {
    await openAdmin(page, '/sozlukler');
    const tree = page.locator('main ul.aile-sz-agac-liste:not(.aile-sz-agac-liste--ic)').first();
    test.skip((await tree.count()) === 0, 'terim ağacı yalnız telefon profilinde; geniş profilde terim tablosu (not_applicable)');
    const before = await corners(tree);
    expect(before.bl, 'dış liste radiuslu').not.toBe('0px');
    const lastRoot = tree.locator(':scope > li').last();
    const lastHead = lastRoot.locator(':scope > .aile-sz-dugum-ust > button');

    await enterKeyboardMode(page, browserName);
    await tree.locator('button[data-sz-dugum]').first().focus();
    expect(await corners(tree)).toEqual(before);
    await page.keyboard.press('End');
    await expect(lastHead).toBeFocused();
    await expect(lastHead).toHaveAttribute('aria-expanded', 'false');
    expect(await accentEdges(page, { root: 'main' })).toEqual([]);
    expect(await corners(tree)).toEqual(squaredBottom(before));

    await pointerDown(page);
    await expect(lastHead).toBeFocused();
    expect(await corners(tree)).toEqual(before);
    await enterKeyboardMode(page, browserName);
    await lastHead.focus();

    await page.keyboard.press('ArrowRight');
    await expect(lastHead).toHaveAttribute('aria-expanded', 'true');
    expect(await accentEdges(page, { root: 'main' })).toEqual([]);
    expect(await corners(tree)).toEqual(before);

    // İç liste: açık düğümün (son kök ya da ilk açık kök) alt terimlerinin kapalı sonuncusu.
    const innerLastLi = page.locator('main ul.aile-sz-agac-liste--ic > li:last-child[data-open="false"]').first();
    if ((await innerLastLi.count()) > 0) {
      const inner = innerLastLi.locator('xpath=..');
      const innerBefore = await corners(inner);
      const innerLast = innerLastLi.locator(':scope > .aile-sz-dugum-ust > button');
      await innerLast.focus();
      await expect(innerLast).toBeFocused();
      expect(await accentEdges(page, { root: 'main' })).toEqual([]);
      expect(await corners(inner)).toEqual(squaredBottom(innerBefore));
    }
  });
});
