import { test, expect, type Locator, type Page } from '@playwright/test';
import { focusRing, motion, smallText } from './admin-detectors';
import { ADMIN_MAIN, openAdmin, shiftTabKey, tabKey } from './admin-helpers';

// a01-button: Button ve IconButton yerel <button> (antd yok). Gerçek rota /alimlar; görev koşusu chromium 320×568 dokunmatik
// ve webkit 390×844 dokunmatik. @matrix etiketli testler entegrasyonda 360/375/320×480/568×320/tablet/masaüstü
// projelerinde de koşar; bu yüzden düğmeyi profilden bağımsız seçerler (görünür ilk etkin .aile-dugme).
// Veri: webServer sentetik nesli servis eder (fixtures/generation-synthetic); Google'a istek yok. Emülasyon gerçek cihaz
// değildir.

const DUGME = '.aile-dugme';

/**
 * Görünür ilk etkin ortak taban düğmesi (telefon/tablette sorgu çubuğundaki "Filtreler (N)", masaüstünde içerikteki ilk
 * düğme). Kabuk üst çubuğundaki "Sayfalar" b01'in kendi yerel düğmesidir (.aile-shell-btn), bu bileşen değildir.
 */
async function firstEnabledButton(page: Page): Promise<Locator> {
  const buttons = page.locator(`${DUGME}:not([disabled])`);
  const count = await buttons.count();
  for (let index = 0; index < count; index += 1) {
    const candidate = buttons.nth(index);
    if (await candidate.isVisible()) return candidate;
  }
  throw new Error('görünür etkin .aile-dugme yok');
}

/** Ölçüm için geçici öznitelik: dedektörler seçici kök/hedef alır. */
async function tag(locator: Locator, name: string) {
  await locator.evaluate((element, attribute) => element.setAttribute(attribute, ''), name);
  return `[${name}]`;
}

/**
 * Etkin dokunma alanı sınaması: düğmenin ortasından her yana `reach(yarı boyut)` px uzaklıktaki dört nokta düğmeye mi
 * isabet ediyor? Dokunuş elementFromPoint ile aynı öğeyi hedefler. Düğme önce görünüm alanının ortasına getirilir
 * (telefonda ilk düğme ekranın altında kalabilir): görünüm alanı dışındaki noktada elementFromPoint null döner ve
 * "ıskalar" sonucu anlamsız olurdu; bu yüzden alan dışındaki bir ölçüm noktası testi düşürür.
 */
async function hitsFromCenter(button: Locator, reach: { min: number; extra: number }) {
  return button.evaluate((element, { min, extra }) => {
    element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const r = element.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const dx = Math.max(r.width / 2, min) + extra;
    const dy = Math.max(r.height / 2, min) + extra;
    const points: Array<[string, number, number]> = [['sol', cx - dx, cy], ['sağ', cx + dx, cy], ['üst', cx, cy - dy], ['alt', cx, cy + dy]];
    return Object.fromEntries(points.map(([side, x, y]) => {
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) throw new Error(`ölçüm noktası (${side}: ${x}, ${y}) görünüm alanı dışında`);
      const hit = document.elementFromPoint(x, y);
      return [side, Boolean(hit && (hit === element || element.contains(hit)))];
    }));
  }, reach);
}
/** Kaba girişte: her eksende en az 48 px (merkezden 24 px'in 0,5 px içi isabet). */
const coarseReach = { min: 24, extra: -0.5 };
/** İnce girişte: etkin alan görünür kutudur (kutunun 1,5 px dışı ıskalar). */
const fineReach = { min: 0, extra: 1.5 };

/**
 * Kaba işaretçi katmanını elle açar/kapatır: AdaptiveRoot katmanı hem <html>'e hem kök .aile-admin'e yazar (ikisi de
 * data-profile taşır; querySelector ilkini, <html>'i döndürürdü). Hepsi birlikte değişir.
 */
async function setCoarse(page: Page, on: boolean) {
  await page.evaluate((value) => {
    for (const node of [document.documentElement, ...document.querySelectorAll('[data-profile]')]) {
      if (value) node.setAttribute('data-input-coarse', '');
      else node.removeAttribute('data-input-coarse');
    }
  }, on);
}

test.describe('a01 Button/IconButton — yerel düğme, gerçek rota', () => {
  test('düğmeler yerel <button>: antd sınıfı, Wave sarmalayıcısı yok; görünür kutu ≥ 44 × 44, metin ≥ 14 px', { tag: '@matrix' }, async ({ page }) => {
    await openAdmin(page, '/alimlar');
    const all = page.locator(DUGME);
    expect(await all.count()).toBeGreaterThan(0);
    expect(await page.locator(`${DUGME}.ant-btn, ${DUGME} .ant-wave, ${DUGME}[class*="ant-btn"]`).count()).toBe(0);
    const report = await all.evaluateAll(elements => elements
      .filter(element => element.getClientRects().length > 0)
      .map(element => {
        const r = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return { tag: element.tagName, width: r.width, height: r.height, font: parseFloat(style.fontSize), name: element.getAttribute('aria-label') ?? element.textContent?.trim() };
      }));
    expect(report.length).toBeGreaterThan(0);
    for (const item of report) {
      expect(item.tag, item.name ?? '').toBe('BUTTON');
      expect(item.width, `${item.name} genişlik`).toBeGreaterThanOrEqual(44);
      expect(item.height, `${item.name} yükseklik`).toBeGreaterThanOrEqual(44);
      expect(item.font, `${item.name} yazı`).toBeGreaterThanOrEqual(14);
    }
    const root = await tag(await firstEnabledButton(page), 'data-a01-metin');
    expect(await smallText(page, { root })).toEqual([]);
  });

  test('dokunma hedefi (b04 --aile-dokunma-hedefi): ince girişte en az 44 px, kaba girişte her eksende en az 48 px', { tag: '@matrix' }, async ({ page }) => {
    await openAdmin(page, '/alimlar');
    const button = await firstEnabledButton(page);

    await setCoarse(page, false);
    const fine = (await button.boundingBox())!;
    expect(fine.width).toBeGreaterThanOrEqual(44);
    expect(fine.height).toBeGreaterThanOrEqual(44);
    // Etkin alan görünür kutudur: kutunun 1,5 px dışı ıskalar, 0,5 px içi isabet eder.
    expect(await hitsFromCenter(button, fineReach)).toEqual({ sol: false, sağ: false, üst: false, alt: false });
    expect(await hitsFromCenter(button, { min: 0, extra: -0.5 })).toEqual({ sol: true, sağ: true, üst: true, alt: true });

    await setCoarse(page, true);
    const coarse = (await button.boundingBox())!;
    expect(coarse.width).toBeGreaterThanOrEqual(48);
    expect(coarse.height).toBeGreaterThanOrEqual(48);
    expect(await hitsFromCenter(button, coarseReach)).toEqual({ sol: true, sağ: true, üst: true, alt: true });
  });

  test('klavye: Tab ile gelen odakta tek alt çizgi (halka yok); işaretçi modunda gösterge yok', { tag: '@matrix' }, async ({ page, browserName }) => {
    await openAdmin(page, '/alimlar');
    let reached = false;
    for (let step = 0; step < 80 && !reached; step += 1) {
      await page.keyboard.press(tabKey(browserName));
      reached = await page.evaluate((selector) => document.activeElement?.matches(selector) ?? false, DUGME);
    }
    expect(reached, 'Tab ile bir .aile-dugme odağa gelmedi').toBe(true);
    expect(await page.evaluate(() => document.documentElement.dataset.keyboard)).toBe('true');
    expect(await focusRing(page)).toEqual([]);
    const line = await page.evaluate(() => {
      const after = getComputedStyle(document.activeElement!, '::after');
      return { content: after.content, height: after.height, bottom: after.bottom, outline: getComputedStyle(document.activeElement!).outlineStyle };
    });
    expect(line).toEqual({ content: '""', height: '3px', bottom: '-7px', outline: 'none' });

    // İşaretçi (pointerdown) görsel modu kapatır; odak düğmede kalır ama çizgi görünmez.
    await page.evaluate(() => document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    expect(await page.evaluate(() => document.documentElement.dataset.keyboard)).toBe('false');
    expect(await page.evaluate((selector) => document.activeElement?.matches(selector) ?? false, DUGME)).toBe(true);
    expect(await focusRing(page, { keyboard: false })).toEqual([]);
    expect(await page.evaluate(() => getComputedStyle(document.activeElement!, '::after').content)).toBe('none');
  });

  test('hareket: renk geçişi 240 ms tek eğri; reduced-motion açıkken geçiş yok', { tag: '@matrix' }, async ({ page }) => {
    await openAdmin(page, '/alimlar');
    const root = await tag(await firstEnabledButton(page), 'data-a01-hareket');
    expect(await motion(page, 'cubic-bezier(.65,0,.35,1)', 240, { root })).toEqual([]);
    expect(await page.locator(root).evaluate(element => getComputedStyle(element).transitionProperty)).toBe('background-color, color, border-color');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    // Tercih değişince kök yeniden çizilebilir; ölçüm düğmesi yeniden seçilir.
    const reducedRoot = await tag(await firstEnabledButton(page), 'data-a01-hareket-az');
    expect(await motion(page, 'cubic-bezier(.65,0,.35,1)', 240, { root: reducedRoot, reduced: true })).toEqual([]);
    expect(await page.locator(reducedRoot).evaluate(element => getComputedStyle(element).transitionDuration.split(',').every(value => parseFloat(value) === 0))).toBe(true);
  });

  test('hover kuralları yalnız (hover: hover) medyasında (CSSOM, gerçek motor)', async ({ page }) => {
    await openAdmin(page, '/alimlar');
    const hovers = await page.evaluate(() => {
      const out: Array<{ selector: string; media: string | null }> = [];
      const walk = (rules: CSSRuleList, media: string | null) => {
        for (const rule of Array.from(rules)) {
          if (rule instanceof CSSMediaRule) walk(rule.cssRules, rule.conditionText);
          else if (rule instanceof CSSStyleRule && /\.aile-(dugme|btn|iconbtn)\b/.test(rule.selectorText) && /:hover/.test(rule.selectorText)) {
            out.push({ selector: rule.selectorText, media });
          }
        }
      };
      for (const sheet of Array.from(document.styleSheets)) {
        try { walk(sheet.cssRules, null); } catch { /* başka köken */ }
      }
      return out;
    });
    expect(hovers.length).toBeGreaterThan(0);
    for (const rule of hovers) expect(rule.media, rule.selector).toBe('(hover: hover)');
  });

  test('devre dışı "Alım ekle": yerel disabled, nedeni yakınında görünür ve aria-describedby ile bağlı', { tag: '@matrix' }, async ({ page }) => {
    const main = await openAdmin(page, '/alimlar');
    const add = main.getByRole('button', { name: 'Alım ekle' });
    await expect(add).toBeDisabled();
    await expect(add).toHaveClass(/\baile-dugme\b/);
    const describedBy = await add.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    const note = page.locator(`[id="${describedBy}"]`);
    await expect(note).toBeVisible();
    await expect(note).not.toHaveText('');
    expect(await smallText(page, { root: `[id="${describedBy}"]` })).toEqual([]);
  });
});

test.describe('a01 Button — telefon yolculuğu (320 chromium, 390 webkit)', () => {
  test.describe('"Filtreler (N)" alt sayfa tetiği', () => {
    // Proje ne olursa olsun telefon profili ve dokunma: chromium 320×568, webkit 390×844 (chromium-desktop'ta da). Geniş
    // düzende "Filtreler (N)" yoktur (filtre paneli sayfada açıktır); telefon yolculuğu telefon görünüm alanında sınanır.
    test.use({
      hasTouch: true,
      viewport: async ({ browserName }, use) => {
        await use(browserName === 'webkit' ? { width: 390, height: 844 } : { width: 320, height: 568 });
      },
    });
    /** Sorgu çubuğundaki "Filtreler (N)": bu bileşenin (.aile-dugme) telefon alt sayfası açan gerçek kullanımı. */
    const filtersButton = (page: Page) => page.getByRole('search', { name: 'Sorgu' }).getByRole('button', { name: /^Filtreler \(\d+\)$/ });
    const filtersSheet = (page: Page) => page.getByRole('dialog', { name: 'Filtreler' });

    test('dokunma: "Filtreler (N)" bir dokunuşla alt sayfayı açar; Escape kapatır ve odak düğmeye döner', async ({ page }) => {
      await openAdmin(page, '/alimlar');
      expect(await page.evaluate(() => document.documentElement.dataset.profile)).toBe('phone');
      const trigger = filtersButton(page);
      await expect(trigger).toBeVisible();
      await expect(trigger).toHaveClass(/\baile-dugme\b/);
      await expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
      await expect(filtersSheet(page)).toHaveCount(0);
      await trigger.tap();
      await expect(filtersSheet(page)).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(filtersSheet(page)).toBeHidden();
      await expect(trigger).toBeFocused();
    });

    test('pointercancel: dokunuş iptal edilirse (kaydırma başladı) etkinleştirme yok ve basılı ton kalmaz', async ({ page, browserName }) => {
      await openAdmin(page, '/alimlar');
      const trigger = filtersButton(page);
      await expect(trigger).toBeVisible();
      await trigger.evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
      const box = (await trigger.boundingBox())!;
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      if (browserName === 'chromium') {
        // Gerçek dokunma dizisi: touchStart → touchCancel; tarayıcı pointercancel üretir, click üretmez.
        const cdp = await page.context().newCDPSession(page);
        const cancelled = page.evaluate(() => new Promise<string>(done => {
          document.addEventListener('pointercancel', event => done(event.pointerType), { once: true });
        }));
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
        expect(await cancelled).toBe('touch');
      } else {
        // WebKit'te Playwright dokunma iptali üretemez; olay sırası sentetik verilir (varsayılan eylem üretmez).
        await trigger.dispatchEvent('pointerdown', { pointerType: 'touch', isPrimary: true, bubbles: true });
        await trigger.dispatchEvent('pointercancel', { pointerType: 'touch', isPrimary: true, bubbles: true });
      }
      await expect(filtersSheet(page)).toHaveCount(0);
      expect(await trigger.evaluate(element => element.matches(':active'))).toBe(false);
    });
  });

  test('IconButton tabanı gerçek motorda: kare 44 × 44, kaba girişte 48 × 48, odakta tek alt çizgi', async ({ page, browserName }) => {
    // IconButton bu rotada henüz çizilmiyor; bileşenin ürettiği işaretleme (IconButton.test.tsx ile aynı sınıf ve
    // öznitelikler) içerik alanına eklenir ve yüklü IconButton.css + Button.css ile ölçülür.
    const main = await openAdmin(page, '/alimlar');
    await main.evaluate(element => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'aile-dugme aile-iconbtn aile-iconbtn--secondary';
      button.dataset.variant = 'secondary';
      button.setAttribute('aria-label', 'Dışa aktar');
      button.setAttribute('data-focus-line', '');
      button.setAttribute('data-a01-ikon', '');
      button.innerHTML = '<svg width="20" height="20" aria-hidden="true" viewBox="0 0 20 20"></svg>';
      element.prepend(button);
    });
    const icon = page.locator('[data-a01-ikon]');
    const size = () => icon.evaluate(element => { const r = element.getBoundingClientRect(); return [r.width, r.height]; });
    await setCoarse(page, false);
    expect(await size()).toEqual([44, 44]);
    expect(await hitsFromCenter(icon, fineReach)).toEqual({ sol: false, sağ: false, üst: false, alt: false });
    await setCoarse(page, true);
    expect(await size()).toEqual([48, 48]);
    expect(await hitsFromCenter(icon, coarseReach)).toEqual({ sol: true, sağ: true, üst: true, alt: true });
    await icon.focus();
    await page.keyboard.press(tabKey(browserName));
    await page.keyboard.press(shiftTabKey(browserName));
    await expect(icon).toBeFocused();
    expect(await focusRing(page, { keyboard: true })).toEqual([]);
    expect(await page.locator(ADMIN_MAIN).count()).toBe(1);
  });
});
