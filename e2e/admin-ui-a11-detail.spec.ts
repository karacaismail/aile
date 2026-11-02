import { test, expect, type Locator, type Page } from '@playwright/test';
import { enterKeyboardMode, horizontalOverflow, openAdmin, shiftTabKey, tabKey } from './admin-helpers';
import { focusRing, smallText } from './admin-detectors';

// a11-detail bileşenleri gerçek rotalarda (sentetik nesil; dev sunucusu /__aile/generation/* yolunu fixtures'tan
// verir, Google'a ağ çağrısı yok): ListRow ve DetailPanel /alimlar'da, Disclosure /alimlar filtre çekmecesinde,
// FormFooter /ayarlar'da. ConflictView henüz hiçbir rotada kullanılmıyor (yalnız birim testleri).
// Projeler: chromium 320×568 dokunmatik (telefon), webkit 390×844 dokunmatik (telefon). @matrix etiketli testler
// entegrasyonda ek genişliklerde de koşar (360, 375, 320×480, 568×320 yatay telefon, 820 tablet, 1440 masaüstü).
// Emülasyon gerçek cihaz değildir: sanal klavye görsel görünüm alanı taklidiyle, dokunma iptali CDP ile (yalnız Chromium).

const KASE = 'Örnek kase';
const sonuclar = (page: Page) => page.getByRole('region', { name: 'Sonuçlar' });
const satir = (page: Page, label: string) => sonuclar(page).getByRole('button', { name: new RegExp(label) });
const ayrinti = (page: Page, label: string) => page.getByRole('dialog', { name: label });
const profil = (page: Page) => page.evaluate(() => document.documentElement.getAttribute('data-profile'));
const kaba = (page: Page) => page.evaluate(() => document.documentElement.hasAttribute('data-input-coarse'));
const icindeOdak = (dialog: Locator) => dialog.evaluate(element => element.contains(document.activeElement));

/** Sanal klavye taklidi: window.visualViewport'u gerçeğine yaslanan bir vekille değiştirir; ac(px) görünür alanı alttan daraltır. */
async function klavyeTaklidi(page: Page) {
  await page.addInitScript(() => {
    const real = window.visualViewport;
    if (!real) return;
    let override: { height: number; offsetTop: number } | null = null;
    const fake = new EventTarget();
    for (const key of ['width', 'offsetLeft', 'pageLeft', 'pageTop', 'scale'] as const) {
      Object.defineProperty(fake, key, { get: () => real[key] });
    }
    Object.defineProperty(fake, 'height', { get: () => (override ? override.height : real.height) });
    Object.defineProperty(fake, 'offsetTop', { get: () => (override ? override.offsetTop : real.offsetTop) });
    for (const type of ['resize', 'scroll']) real.addEventListener(type, () => fake.dispatchEvent(new Event(type)));
    Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => fake });
    (window as unknown as { __aileKlavye: unknown }).__aileKlavye = {
      ac(px: number) {
        override = { height: real.height - px, offsetTop: real.offsetTop };
        fake.dispatchEvent(new Event('resize'));
      },
      kapat() {
        override = null;
        fake.dispatchEvent(new Event('resize'));
      },
    };
  });
}
const klavyeAc = (page: Page, px: number) => page.evaluate(n => (window as unknown as { __aileKlavye: { ac(n: number): void } }).__aileKlavye.ac(n), px);
const klavyeKapat = (page: Page) => page.evaluate(() => (window as unknown as { __aileKlavye: { kapat(): void } }).__aileKlavye.kapat());
/**
 * Hedefin yerleşim yüksekliği (border-box, CSS px). Alt sayfa 240 ms içinde translateY ile kayarak açılır; ara karede
 * getBoundingClientRect yüksekliği WebKit'te dönüşüm matrisinin float hassasiyetiyle 48 yerine 47.99994 çıkabiliyor
 * (gözlem: aile-sheet-sarmal matrix(1,0,0,1,0,438.186)). Saf öteleme hedef boyutunu değiştirmez; ölçü dönüşümden
 * bağımsız yerleşimden okunur, eşik aynı kalır.
 */
const yerlesimYuksekligi = (locator: Locator) => locator.evaluate(element => {
  const cs = getComputedStyle(element);
  const height = parseFloat(cs.height);
  if (cs.boxSizing === 'border-box') return height;
  return height + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
});
const gorunurAlt = (page: Page) => page.evaluate(() => window.visualViewport!.offsetTop + window.visualViewport!.height);

// --- ListRow ---------------------------------------------------------------------------------------------------------
test('ListRow: satırın tamamı tek etkin öğe; hedef ≥ 44 px (kaba girişte 48); metin ≥ 14 px; sayfa yatay kaymaz', { tag: '@matrix' }, async ({ page }) => {
  await openAdmin(page, '/alimlar');
  const liste = page.getByRole('list', { name: 'Alımlar' });
  await expect(liste.getByRole('listitem').first()).toBeVisible();
  const coarse = await kaba(page);
  const satirlar = await liste.evaluate(ul => {
    const INTERACTIVE = 'a[href], button, input, select, textarea, summary, [tabindex], [contenteditable="true"], [role=button], [role=link], [role=checkbox], [role=switch], [role=menuitem], [role=option], [role=tab]';
    return Array.from(ul.querySelectorAll(':scope > li:not([aria-hidden="true"])')).map(li => {
      const button = li.querySelector('button');
      const r = button?.getBoundingClientRect();
      return {
        text: (li.textContent ?? '').slice(0, 24),
        interactive: li.querySelectorAll(INTERACTIVE).length,
        height: r?.height ?? 0,
        widthGap: Math.abs((r?.width ?? 0) - li.getBoundingClientRect().width),
      };
    });
  });
  expect(satirlar.length).toBeGreaterThan(0);
  for (const row of satirlar) {
    expect(row.interactive, `${row.text}: iç içe etkileşimli öğe`).toBe(1);
    expect(row.height, `${row.text}: hedef yüksekliği`).toBeGreaterThanOrEqual(coarse ? 48 : 44);
    expect(row.widthGap, `${row.text}: düğme satırı doldurmalı`).toBeLessThanOrEqual(1);
  }
  expect(await smallText(page, { root: 'ul[aria-label="Alımlar"]', min: 14 })).toEqual([]);
  expect(await horizontalOverflow(page)).toEqual([]);
});

test('ListRow: dokunma kaydırmaya dönüşüp iptal olursa (pointercancel) ayrıntı açılmaz; tamamlanan dokunma açar', async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== 'chromium', 'Dokunma iptali CDP Input.dispatchTouchEvent ile; WebKit sürücüsünde karşılığı yok.');
  test.skip(!testInfo.project.use.hasTouch, 'Dokunmatik olmayan projede dokunma yok.');
  await openAdmin(page, '/alimlar');
  const row = satir(page, KASE);
  await row.scrollIntoViewIfNeeded();
  const box = (await row.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await row.evaluate(element => {
    const w = window as unknown as { __iptal: number };
    w.__iptal = 0;
    element.addEventListener('pointercancel', () => { w.__iptal += 1; });
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await expect.poll(() => page.evaluate(() => (window as unknown as { __iptal: number }).__iptal)).toBe(1);
  await expect(ayrinti(page, KASE)).toHaveCount(0);
  await page.touchscreen.tap(x, y);
  await expect(ayrinti(page, KASE)).toBeVisible();
});

// --- DetailPanel -----------------------------------------------------------------------------------------------------
test('DetailPanel: telefonda ekranı kaplayan katman; üstte "Listeye dön", içerik kendi içinde kayar; dönüşte odak satıra', { tag: '@matrix' }, async ({ page }) => {
  await openAdmin(page, '/alimlar');
  test.skip((await profil(page)) === 'desktop', 'Masaüstü geometrisi ayrı testte.');
  const row = satir(page, KASE);
  await row.tap();
  const dialog = ayrinti(page, KASE);
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await expect.poll(() => icindeOdak(dialog), { message: 'açılınca odak katmanda' }).toBe(true);

  // Ekranı kaplar: kutusu görünüm alanına eşit; kabuğun üst çubuğu katmanın altında kalır.
  const viewport = page.viewportSize()!;
  const kutu = (await dialog.boundingBox())!;
  expect(Math.abs(kutu.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(kutu.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(kutu.width - viewport.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(kutu.height - viewport.height)).toBeLessThanOrEqual(1);
  const ustteKatman = await page.evaluate(() => {
    const element = document.elementFromPoint(window.innerWidth / 2, 4);
    return Boolean(element?.closest('[role="dialog"]'));
  });
  expect(ustteKatman, 'üst kenarda katman olmalı (kabuk çubuğu altta)').toBe(true);

  // Üstte geri düğmesi; içerik kendi içinde kayar, çubuk yerinde kalır.
  const back = dialog.getByRole('button', { name: 'Listeye dön' });
  const backKutu = (await back.boundingBox())!;
  expect(backKutu.y).toBeLessThan(80);
  expect(backKutu.height).toBeGreaterThanOrEqual(44);
  const govde = dialog.locator('.aile-detail-govde');
  const kayma = await govde.evaluate(element => ({ overflowY: getComputedStyle(element).overflowY, sh: element.scrollHeight, ch: element.clientHeight }));
  expect(kayma.overflowY).toBe('auto');
  if (kayma.sh > kayma.ch + 1) {
    await govde.evaluate(element => element.scrollTo(0, element.scrollHeight));
    await expect.poll(() => govde.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    expect(Math.abs((await back.boundingBox())!.y - backKutu.y)).toBeLessThanOrEqual(1);
  }
  expect(await smallText(page, { root: '[role="dialog"]', min: 14 }), 'ayrıntıda metin ≥ 14 CSS px').toEqual([]);
  expect(await horizontalOverflow(page), 'ayrıntıda yatay taşma').toEqual([]);

  await back.tap();
  await expect(dialog).toBeHidden();
  await expect(row).toBeFocused();
});

test('DetailPanel: klavyeyle Enter açar, odak katmanda döner (Tab/Shift+Tab), gösterge çubuğun altında çizgi; Escape kapatır ve odak satıra döner', async ({ page, browserName }) => {
  await openAdmin(page, '/alimlar');
  await enterKeyboardMode(page, browserName);
  const row = satir(page, KASE);
  await row.focus();
  await page.keyboard.press('Enter');
  const dialog = ayrinti(page, KASE);
  await expect(dialog).toBeVisible();
  await expect.poll(() => dialog.evaluate(element => document.activeElement === element)).toBe(true);

  // Kök odaktayken: halka yok; çubuğun alt kenarında tek 3 px çizgi.
  const gosterge = await dialog.evaluate(element => {
    const bar = element.querySelector('.aile-detail-bar, .aile-detail-ust')!;
    const after = getComputedStyle(bar, '::after');
    const own = getComputedStyle(element);
    return { content: after.content, height: after.height, bottom: after.bottom, background: after.backgroundColor, outline: own.outlineStyle, shadow: own.boxShadow };
  });
  expect(gosterge.content).not.toBe('none');
  expect(gosterge.height).toBe('3px');
  expect(gosterge.bottom).toBe('0px');
  expect(gosterge.outline).toBe('none');
  expect(gosterge.shadow).toBe('none');

  const duraklar = await dialog.evaluate(element => element.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])').length);
  expect(duraklar).toBeGreaterThan(0);
  if ((await dialog.getAttribute('aria-modal')) === 'true') {
    // Telefon/tablet katmanı modal: Tab ve Shift+Tab sekme duraklarının sayısından fazla basılsa da odak katmandan çıkmaz.
    for (let i = 0; i < duraklar + 2; i += 1) {
      await page.keyboard.press(tabKey(browserName));
      expect(await icindeOdak(dialog), `Tab ${i + 1}: odak katmanda`).toBe(true);
    }
    for (let i = 0; i < duraklar + 2; i += 1) {
      await page.keyboard.press(shiftTabKey(browserName));
      expect(await icindeOdak(dialog), `Shift+Tab ${i + 1}: odak katmanda`).toBe(true);
    }
  } else {
    // Masaüstü yan panel liste yanında ve modal değil: Tab son duraktan sonra sayfaya devam eder.
    let cikti = false;
    for (let i = 0; i < duraklar + 2 && !cikti; i += 1) {
      await page.keyboard.press(tabKey(browserName));
      cikti = !(await icindeOdak(dialog));
    }
    expect(cikti, 'modal olmayan panelde odak sayfaya devam etmeli').toBe(true);
    await dialog.getByRole('button', { name: 'Kapat' }).focus();
  }
  const ihlaller = await focusRing(page, { keyboard: true });
  expect(ihlaller.filter(item => /halka|outline|çerçeve/.test(item)), ihlaller.join('\n')).toEqual([]);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(row).toBeFocused();
});

test('DetailPanel: masaüstünde liste yanında 384 px panel (modal değil), seçili satır yüzey tonunda; Kapat odağı satıra döndürür', { tag: '@matrix' }, async ({ page }, testInfo) => {
  if (page.viewportSize()!.width < 1024) {
    // Görev koşusunda masaüstü yalnız telefon Chromium projesi genişletilerek denenir; diğer dar projeler (360/375/kısa/
    // yatay, webkit) aynı şeyi tekrarlamaz. webkit-desktop ve chromium-desktop kendi genişliğinde koşar.
    test.skip(testInfo.project.name !== 'chromium', 'Masaüstü geometrisi masaüstü projelerinde.');
    await page.setViewportSize({ width: 1440, height: 900 });
  }
  await openAdmin(page, '/alimlar');
  expect(await profil(page)).toBe('desktop');
  const row = satir(page, KASE);
  await row.click();
  const dialog = ayrinti(page, KASE);
  await expect(dialog).toBeVisible();
  await expect(dialog).not.toHaveAttribute('aria-modal');
  const panel = (await dialog.boundingBox())!;
  const sonuc = (await sonuclar(page).boundingBox())!;
  expect(Math.abs(panel.width - 384)).toBeLessThanOrEqual(1);
  expect(panel.x).toBeGreaterThanOrEqual(sonuc.x + sonuc.width - 1);
  await expect(sonuclar(page)).toBeVisible();

  // Seçili satır: aria-current + secili yüzey tonu (odaktan ayrı).
  // Zemin 240 ms geçişle değişir (hover → secili); son değer beklenir. Fare hâlâ satırın üstünde: seçim hover'ın üstünde kalır.
  await expect(row).toHaveAttribute('aria-current', 'true');
  // Beklenen renk sabit yazılmaz: --aile-secili tokenı aynı belgede bir sonda öğeyle çözülür.
  const secili = await page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.background = 'var(--aile-secili)';
    document.querySelector('.aile-admin')!.append(probe);
    const value = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return value;
  });
  expect(secili).not.toBe('rgba(0, 0, 0, 0)');
  await expect.poll(() => row.evaluate(element => getComputedStyle(element).backgroundColor)).toBe(secili);

  await dialog.getByRole('button', { name: 'Kapat' }).click();
  await expect(dialog).toBeHidden();
  await expect(row).toBeFocused();
  await expect(row).not.toHaveAttribute('aria-current');
});

// --- Disclosure ------------------------------------------------------------------------------------------------------
test('Disclosure: düğme + aria-expanded + aria-controls; Enter/Space açar-kapar; hedef ≥ 44/48 px; reduced-motion anlık', async ({ page, browserName }) => {
  await openAdmin(page, '/alimlar');
  test.skip((await profil(page)) === 'desktop', 'Filtre çekmecesi telefon/tablet yolunda.');
  await page.getByRole('button', { name: /^Filtreler/ }).click();
  const drawer = page.getByRole('dialog', { name: /^Filtreler/ });
  await expect(drawer).toBeVisible();
  const disc = drawer.getByRole('button', { name: /^Oda/ });
  await expect(disc).toBeVisible();
  const controls = await disc.getAttribute('aria-controls');
  expect(controls).toBeTruthy();
  const bolge = page.locator(`[id="${controls}"]`);
  await expect(bolge).toHaveCount(1);
  expect(await yerlesimYuksekligi(disc)).toBeGreaterThanOrEqual((await kaba(page)) ? 48 : 44);

  await enterKeyboardMode(page, browserName);
  await disc.focus();
  const once = await disc.getAttribute('aria-expanded');
  await page.keyboard.press('Enter');
  await expect(disc).toHaveAttribute('aria-expanded', once === 'true' ? 'false' : 'true');
  await expect(bolge).toBeVisible({ visible: once !== 'true' });
  await page.keyboard.press('Space');
  await expect(disc).toHaveAttribute('aria-expanded', once ?? 'false');
  const ihlaller = await focusRing(page, { keyboard: true });
  expect(ihlaller.filter(item => /halka|outline|çerçeve/.test(item)), ihlaller.join('\n')).toEqual([]);

  const chevron = disc.locator('svg[data-icon="chevronDown"]');
  expect(await chevron.evaluate(element => getComputedStyle(element).transitionDuration)).toBe('0.24s');
  // Reduced-motion: hareket kalkar, durum yine anında değişir. (Tercih değişince sayfa filtre çekmecesini kapatabilir;
  // çekmece sayfanındır, gerekiyorsa yeniden açılır.)
  await page.emulateMedia({ reducedMotion: 'reduce' });
  if (!(await drawer.isVisible())) await page.getByRole('button', { name: /^Filtreler/ }).click();
  await expect(disc).toBeVisible();
  expect(await chevron.evaluate(element => getComputedStyle(element).transitionDuration)).toBe('0s');
  const sonra = await disc.getAttribute('aria-expanded');
  await disc.focus();
  await page.keyboard.press('Enter');
  await expect(disc).toHaveAttribute('aria-expanded', sonra === 'true' ? 'false' : 'true');
});

// --- FormFooter ------------------------------------------------------------------------------------------------------
// /ayarlar'daki dar altlık. Yapışkanlık sayfanın kararıdır (FormFooter sticky; AyarlarPage bugün sticky={false}: iki
// alanlık formda altlık alanların hemen altındadır, yapışkan ≈160 px altlık kısa ekranda odaklı alanı örtüyordu). Test iki
// sözleşmeyi de gerçek tarayıcıda ölçer: yapışkansa sanal klavye açıkken görünür alanın altında (klavyenin üstünde) kalır;
// akıştaysa klavye payı almaz, konumu akıştır ve odaklı alanı örtmez. Hangisinin çizildiği data-sticky'den okunur.
test('FormFooter: telefonda dar altlık (birincil üstte, tam genişlik); yapışkansa sanal klavyenin üstünde kalır, akıştaysa klavye payı almaz ve odaklı alanı örtmez', async ({ page }) => {
  await klavyeTaklidi(page);
  await openAdmin(page, '/ayarlar');
  test.skip((await profil(page)) !== 'phone', 'Dar altlık telefonda.');
  const alan = page.getByRole('textbox', { name: 'Apps Script adresi' });
  const kaydet = page.getByRole('button', { name: 'Kaydet' });
  const altlik = page.locator('.aile-ff', { has: kaydet });
  const vazgec = altlik.getByRole('button', { name: 'Vazgeç' });
  await expect(altlik).toHaveAttribute('data-narrow', 'true');

  // Dar: birincil üstte, iki düğme altlığın içerik genişliğinde (DOM sırası görsel sırayla aynı).
  const [k, v] = [(await kaydet.boundingBox())!, (await vazgec.boundingBox())!];
  expect(k.y + k.height, 'birincil üstte').toBeLessThanOrEqual(v.y + 0.5);
  expect(Math.abs(k.width - v.width), 'iki düğme aynı (tam) genişlikte').toBeLessThanOrEqual(1);
  const icGenislik = await altlik.evaluate(element => {
    const cs = getComputedStyle(element);
    return element.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  });
  expect(Math.abs(k.width - icGenislik), 'birincil tam genişlik').toBeLessThanOrEqual(1);

  const yapiskan = (await altlik.getAttribute('data-sticky')) === 'true';
  await alan.focus();
  await alan.evaluate(element => element.scrollIntoView({ block: 'start' }));

  // Klavye yüksekliği: görünüm alanının %45'i; uzun ekranda altlık zaten yukarıdaysa, altlığın alt kenarını en az 24 px
  // örtecek kadar (emülasyon; mekanizma her projede gerçekten çalışsın, test boş geçmesin).
  const yukseklik = page.viewportSize()!.height;
  const kapali = (await altlik.boundingBox())!;
  const KLAVYE = Math.max(Math.round(yukseklik * 0.45), Math.ceil(yukseklik - (kapali.y + kapali.height) + 24));
  const acikGorunurAlt = yukseklik - KLAVYE;
  expect(kapali.y + kapali.height, 'ön koşul: klavye altlığı örtmeli').toBeGreaterThan(acikGorunurAlt);

  await klavyeAc(page, KLAVYE);
  if (yapiskan) {
    await expect(altlik).toHaveAttribute('data-klavye', 'true');
    await expect.poll(async () => {
      const kutu = (await altlik.boundingBox())!;
      return kutu.y + kutu.height - (await gorunurAlt(page));
    }, { message: 'altlık görünür alanın altında kalmalı' }).toBeLessThanOrEqual(0.5);
    await expect(kaydet).toBeInViewport();
  } else {
    // Akıştaki altlık klavyeyi kovalamaz (pay yalnız yapışkana) ve odaklı alanın üstüne binmez.
    expect(await altlik.evaluate(element => getComputedStyle(element).position), 'akışta').toBe('static');
    await expect(altlik).not.toHaveAttribute('data-klavye');
    await expect(alan).toBeFocused();
    const alanKutu = (await alan.boundingBox())!;
    expect(alanKutu.y + alanKutu.height, 'odaklı alan klavyenin üstünde').toBeLessThanOrEqual(await gorunurAlt(page));
    const altlikKutu = (await altlik.boundingBox())!;
    expect(altlikKutu.y, 'altlık odaklı alanı örtmez').toBeGreaterThanOrEqual(alanKutu.y + alanKutu.height - 0.5);
  }

  await klavyeKapat(page);
  await expect(altlik).not.toHaveAttribute('data-klavye');
});

// DetailPanel'in telefon katmanı aynı görünür alan ölçümünü (FormFooter.viewport) kullanır: sanal klavye açıkken katman
// görsel görünüm alanına sığar, altlığı (sayfanın bildirim yuvası) klavyenin üstünde kalır; kapanınca ekranı yine kaplar.
test('DetailPanel: telefonda sanal klavye açıkken katman görünür alana sığar, altlık klavyenin üstünde; kapanınca tam ekran', async ({ page }, testInfo) => {
  await klavyeTaklidi(page);
  await openAdmin(page, '/alimlar');
  test.skip((await profil(page)) === 'desktop', 'Masaüstünde yan panel; klavye payı telefon/tablet katmanında.');
  const row = satir(page, KASE);
  if (testInfo.project.use.hasTouch) await row.tap();
  else await row.click();
  const dialog = ayrinti(page, KASE);
  await expect(dialog).toBeVisible();
  const altlik = dialog.locator('.aile-detail-altlik');
  await expect(altlik).toHaveCount(1);
  const viewport = page.viewportSize()!;
  const KLAVYE = Math.round(viewport.height * 0.45);

  await klavyeAc(page, KLAVYE);
  await expect.poll(async () => {
    const kutu = (await dialog.boundingBox())!;
    return Math.abs(kutu.y + kutu.height - (await gorunurAlt(page)));
  }, { message: 'katmanın alt kenarı görünür alanın altında (klavyenin üstünde)' }).toBeLessThanOrEqual(0.5);
  expect(Math.abs((await dialog.boundingBox())!.y), 'katman üstten başlar').toBeLessThanOrEqual(1);
  const altlikKutu = (await altlik.boundingBox())!;
  expect(altlikKutu.y + altlikKutu.height, 'altlık klavyenin üstünde').toBeLessThanOrEqual((await gorunurAlt(page)) + 0.5);
  await expect(dialog.getByRole('button', { name: 'Listeye dön' })).toBeInViewport();

  await klavyeKapat(page);
  await expect.poll(async () => Math.abs((await dialog.boundingBox())!.height - viewport.height), { message: 'klavye kapanınca katman ekranı kaplar' })
    .toBeLessThanOrEqual(1);
});
