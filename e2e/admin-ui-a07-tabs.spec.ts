import { expect, test, type Locator, type Page } from '@playwright/test';
import { openAdmin, shiftTabKey, tabKey } from './admin-helpers';
import { accentEdges, focusRing, smallText } from './admin-detectors';

// Tabs (src/admin/ui/Tabs.*) gerçek rotalarda: /ev oda ayrıntısı (Oda bölümleri, 4 sekme: telefonda da sekme şeridi; dar
// telefonda ve masaüstü yan panelinde şerit kendi içinde kayar), /alimlar (Görünüm modu, 6 segment: telefonda combobox +
// alttan sayfa, genişte radiogroup), /sozlukler (Sözlük, 6 sekme; telefonda sayfa ui/Select kullanır). Görev koşusu:
// chromium 320×568 dokunmatik + webkit 390×844 dokunmatik (ikisi de telefon profili). @matrix testleri entegrasyonda
// 360/375/320×480/568×320 (telefon) ve tablet/masaüstü projelerinde de koşar; dallar data-profile'a göre seçilir.
// Emülasyon gerçek cihaz değildir. Veri: webServer'ın sentetik nesli (fixtures/generation-synthetic); Google'a istek yok.

const MATRIX = { tag: '@matrix' };

const profile = (page: Page) => page.evaluate(() => document.documentElement.dataset.profile ?? '');
const coarseInput = (page: Page) => page.evaluate(() => document.documentElement.hasAttribute('data-input-coarse'));
const keyboardMode = (page: Page) => page.evaluate(() => document.documentElement.dataset.keyboard ?? '');
const minTarget = async (page: Page) => ((await coarseInput(page)) ? 48 : 44);

async function expectTargets(page: Page, locators: Locator[]) {
  const min = await minTarget(page);
  for (const locator of locators) {
    const box = await locator.boundingBox();
    expect(box, await locator.textContent() ?? '').not.toBeNull();
    expect(box!.height, `${await locator.textContent()} yükseklik`).toBeGreaterThanOrEqual(min - 0.5);
    expect(box!.width, `${await locator.textContent()} genişlik`).toBeGreaterThanOrEqual(44 - 0.5);
  }
}

async function noPageOverflow(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(scrollWidth, 'sayfa yatay taşmaz').toBeLessThanOrEqual(clientWidth);
}

/**
 * Klavye modunu açar ve odağı `target`a klavyeyle getirir: hedefe programatik odak, Tab ileri, Shift+Tab geri (admin-focus
 * ile aynı sıra). WebKit, dokunuştan sonraki programatik odaktan ilk Shift+Tab'ı hareketsiz bırakır; gerçek klavye akışı
 * (Tab ile gelinen öğeden Shift+Tab) iki motorda da geri gider, bunu testin sonundaki adım doğrular.
 */
async function tabInto(page: Page, browserName: string, target: Locator) {
  await target.focus();
  await page.keyboard.press(tabKey(browserName));
  await page.keyboard.press(shiftTabKey(browserName));
  await expect(target).toBeFocused();
  expect(await keyboardMode(page)).toBe('true');
}

/** Chromium CDP ile gerçek dokunmatik sürükleme (tarayıcı kaydırmayı devralır → pointercancel, click yok). */
async function touchDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
  for (let step = 1; step <= 10; step += 1) {
    const x = from.x + ((to.x - from.x) * step) / 10;
    const y = from.y + ((to.y - from.y) * step) / 10;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

/**
 * Oda ayrıntısını açar (c06 /ev): telefonda akordeonun ilk (açık) satırındaki "Odayı aç"; masaüstünde oda tablosunun
 * satırı; tablette tablo sığıyorsa satır, sığmıyorsa akordeon "Odayı aç" (ResponsiveTable kuralı). Geniş profilde liste
 * modülü tembel gelir; masaüstünde tıklama telefon yedeğine düşmesin diye tablo beklenir (tablette iki sunumda da aynı
 * "Odayı aç" vardır, seçili oda sayfada tutulur).
 */
async function openRoomDetail(page: Page) {
  await openAdmin(page, '/ev');
  const table = page.getByRole('table', { name: 'Odalar' });
  const open = page.getByRole('button', { name: 'Odayı aç' }).first();
  if ((await profile(page)) === 'desktop') await expect(table).toBeVisible();
  else await expect(table.or(open).first()).toBeVisible();
  if (await table.isVisible()) await table.getByRole('row').nth(1).click();
  else await open.click();
  const tablist = page.getByRole('tablist', { name: 'Oda bölümleri' });
  await expect(tablist).toBeVisible();
  return tablist;
}

/** --aile-secili'nin hesaplanmış rengi: öğenin yanına konan bir sondanın zemini (token değeri yönetim kökünden gelir). */
const seciliRenk = (near: Locator) => near.evaluate((el) => {
  const probe = document.createElement('span');
  probe.style.backgroundColor = 'var(--aile-secili)';
  el.parentElement!.appendChild(probe);
  const value = getComputedStyle(probe).backgroundColor;
  probe.remove();
  return value;
});
const zemin = (locator: Locator) => locator.evaluate((el) => getComputedStyle(el).backgroundColor);

/** Sekme şeridin görünür alanında ve üstünde başka öğe (taşma ipucu) yok: orta noktasına basılan öğe sekmenin kendisi. */
const shownInStrip = (tab: Locator) => tab.evaluate((el) => {
  const box = el.getBoundingClientRect();
  const strip = el.closest('[role="tablist"]')!.getBoundingClientRect();
  const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
  return { inside: box.left >= strip.left - 0.5 && box.right <= strip.right + 0.5, hit: hit !== null && (hit === el || el.contains(hit)) };
});

test.describe('Tabs › sekme şeridi (/ev Oda bölümleri)', () => {
  test('APG sekmeler: tek durak, oklar + Home/End otomatik seçer, seçim secili yüzey + 600 (şerit yok), 44/48 hedef, ≥14 px', MATRIX, async ({ page, browserName }) => {
    const tablist = await openRoomDetail(page);
    const tabs = tablist.getByRole('tab');
    await expect(tabs).toHaveText(['Alımlar', 'İşler', 'Eşyalar', 'Aydınlatma']);
    const alimlar = tablist.getByRole('tab', { name: 'Alımlar' });
    const isler = tablist.getByRole('tab', { name: 'İşler' });
    const esyalar = tablist.getByRole('tab', { name: 'Eşyalar' });
    const aydinlatma = tablist.getByRole('tab', { name: 'Aydınlatma' });
    await expect(page.getByRole('group', { name: 'Oda bölümleri' })).toBeVisible();
    await expect(tablist).toHaveAttribute('aria-orientation', 'horizontal');
    await expect(alimlar).toHaveAttribute('aria-selected', 'true');
    await expect(tablist.locator('[role="tab"][aria-selected="true"]')).toHaveCount(1);
    await expect(tablist.locator('[role="tab"][tabindex="0"]')).toHaveCount(1);
    await expect(alimlar).toHaveAttribute('tabindex', '0');
    for (const tab of [isler, esyalar, aydinlatma]) await expect(tab).toHaveAttribute('tabindex', '-1');

    // Seçim (tasarım: "Seçimi şeritle gösterme"): secili yüzey + 600; seçili olmayan saydam + 500. Şerit/çizgi yok,
    // dört köşe de aynı kontrol köşesi (kavisli vurgu kenarı yok).
    const secili = await seciliRenk(tablist);
    expect(secili).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
    const shape = await alimlar.evaluate((el) => {
      const s = getComputedStyle(el);
      const before = getComputedStyle(el, '::before');
      const next = getComputedStyle(el.nextElementSibling!);
      return {
        weight: s.fontWeight, background: s.backgroundColor, nextWeight: next.fontWeight, nextBackground: next.backgroundColor,
        radii: [s.borderTopLeftRadius, s.borderTopRightRadius, s.borderBottomRightRadius, s.borderBottomLeftRadius],
        borders: [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth],
        before: ['none', 'normal', ''].includes(before.content) ? 'yok' : before.content,
      };
    });
    expect(shape.weight).toBe('600');
    expect(shape.nextWeight).toBe('500');
    expect(shape.background).toBe(secili);
    expect(shape.nextBackground).toBe('rgba(0, 0, 0, 0)');
    expect(shape.before).toBe('yok');
    expect(shape.borders).toEqual(['0px', '0px', '0px', '0px']);
    expect(new Set(shape.radii).size, shape.radii.join(' ')).toBe(1);
    expect(shape.radii[0]).not.toBe('0px');
    expect(await accentEdges(page, { root: '.aile-tabs' })).toEqual([]);
    expect(await smallText(page, { root: '.aile-tabs' })).toEqual([]);
    await expectTargets(page, [alimlar, isler, esyalar, aydinlatma]);
    await noPageOverflow(page);

    // Dokunma/işaretçi: dokunuş seçer ve tek durağı taşır; işaretçi modunda odak çizgisi görünmez. Fareyle tıklanan
    // sekme imleç üstündeyken de secili yüzeyde kalır (üzerine gelme seçimi silmez).
    if (await coarseInput(page)) await isler.tap();
    else await isler.click();
    await expect(isler).toHaveAttribute('aria-selected', 'true');
    await expect(alimlar).toHaveAttribute('aria-selected', 'false');
    await expect.poll(() => zemin(isler)).toBe(secili);
    await expect.poll(() => zemin(alimlar)).toBe('rgba(0, 0, 0, 0)');
    await expect(isler).toHaveAttribute('tabindex', '0');
    await expect(alimlar).toHaveAttribute('tabindex', '-1');
    expect(await keyboardMode(page)).toBe('false');
    expect(await focusRing(page, { target: '[role="tab"][aria-selected="true"]', keyboard: false })).toEqual([]);

    // Klavye: Tab seçili sekmeye girer; oklar odağı taşır ve anında seçer (uçlarda sarar); Home/End. Seçilen sekme
    // şeridin görünür alanına kayar ve ipucunun altında kalmaz.
    await tabInto(page, browserName, isler);
    expect(await focusRing(page)).toEqual([]);
    await page.keyboard.press('ArrowLeft');
    await expect(alimlar).toBeFocused();
    await expect(alimlar).toHaveAttribute('aria-selected', 'true');
    expect(await focusRing(page)).toEqual([]);
    await page.keyboard.press('ArrowLeft');
    await expect(aydinlatma).toBeFocused();
    await expect(aydinlatma).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => shownInStrip(aydinlatma)).toEqual({ inside: true, hit: true });
    await page.keyboard.press('ArrowRight');
    await expect(alimlar).toBeFocused();
    await expect(alimlar).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => shownInStrip(alimlar)).toEqual({ inside: true, hit: true });
    await page.keyboard.press('End');
    await expect(aydinlatma).toBeFocused();
    await expect(aydinlatma).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Home');
    await expect(alimlar).toBeFocused();
    await expect(alimlar).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('End');
    await expect(aydinlatma).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(aydinlatma).toBeFocused();
    await expect(aydinlatma).toHaveAttribute('aria-selected', 'true');
    await expect(tablist.locator('[role="tab"][aria-selected="true"]')).toHaveCount(1);
    // Sonraki Tab şeritten çıkar (tek sekme durağı), Shift+Tab seçili sekmeye döner; Shift+Tab şeridi geriye de tek
    // adımda bırakır (seçili olmayan sekmeler durak değildir), Tab yine seçili sekmeye girer.
    await page.keyboard.press(tabKey(browserName));
    expect(await page.evaluate(() => document.activeElement?.getAttribute('role'))).not.toBe('tab');
    await page.keyboard.press(shiftTabKey(browserName));
    await expect(aydinlatma).toBeFocused();
    await page.keyboard.press(shiftTabKey(browserName));
    expect(await page.evaluate(() => document.activeElement?.getAttribute('role'))).not.toBe('tab');
    for (const tab of [alimlar, isler, esyalar]) await expect(tab).not.toBeFocused();
    await page.keyboard.press(tabKey(browserName));
    await expect(aydinlatma).toBeFocused();
  });

  test('dar şerit kendi içinde kayar: taşan yanda ipucu görünür, sayfa taşmaz; kaydırma dokunuşu (pointercancel) seçmez', MATRIX, async ({ page, browserName }) => {
    const tablist = await openRoomDetail(page);
    const ipucu = (yon: 'bas' | 'son') => page.locator(`.aile-tabs__ipucu[data-yon="${yon}"]`);
    const tasma = () => tablist.evaluate((el) => ({ bas: el.scrollLeft > 1, son: el.scrollLeft + el.clientWidth < el.scrollWidth - 1 }));
    // Gerçek içerik (dört sekme): seçili ilk sekmeyle şerit baştadır, baş yanda ipucu yok; son yanda ipucu yalnız şerit
    // gerçekten taşıyorsa (320 px telefonda ve 384 px yan panelde taşar, geniş tam sayfada sığar).
    const gercek = await tasma();
    expect(gercek.bas).toBe(false);
    await expect(ipucu('bas')).toHaveAttribute('data-gorunur', 'false');
    await expect(ipucu('son')).toHaveAttribute('data-gorunur', String(gercek.son));
    await noPageOverflow(page);

    // Dar kap (uzun ad / çok sekme yerine): şerit taşar, sayfa taşmaz, son yanda ipucu görünür.
    await page.addStyleTag({ content: '.aile-tabs { max-width: 112px; }' });
    await expect(ipucu('son')).toHaveAttribute('data-gorunur', 'true');
    await expect(ipucu('bas')).toHaveAttribute('data-gorunur', 'false');
    await expect.poll(() => ipucu('son').evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    await expect(ipucu('son').locator('svg[data-icon="chevronRight"]')).toBeVisible();
    await expect(ipucu('son')).toHaveAttribute('aria-hidden', 'true');
    await expectTargets(page, [ipucu('son')]);
    await noPageOverflow(page);
    const overflowing = await tablist.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, overflowX: getComputedStyle(el).overflowX }));
    expect(overflowing.scrollWidth).toBeGreaterThan(overflowing.clientWidth);
    expect(overflowing.overflowX).toBe('auto');

    // İpucuna basmak (işaretçi kolaylığı) şeridi kaydırır; baş yanda ipucu belirir.
    await ipucu('son').click();
    await expect(ipucu('bas')).toHaveAttribute('data-gorunur', 'true');
    await tablist.evaluate((el) => { el.scrollLeft = 0; });
    await expect(ipucu('bas')).toHaveAttribute('data-gorunur', 'false');

    if (browserName === 'chromium' && (await coarseInput(page))) {
      // Gerçek dokunmatik sürükleme, seçili olmayan İşler'in GÖRÜNÜR kısmında başlar (ipucunun üstünde başlayan dokunuş
      // ipucunundur): kap, İşler'in ilk 40 px'i ipucunun solunda kalacak genişliğe ayarlanır. Şerit kayar →
      // pointercancel, click yok, seçim değişmez.
      const isler = tablist.getByRole('tab', { name: 'İşler' });
      const listeX = (await tablist.boundingBox())!.x;
      const islerX = (await isler.boundingBox())!.x;
      const ipucuW = (await ipucu('son').boundingBox())!.width;
      await page.addStyleTag({ content: `.aile-tabs { max-width: ${Math.ceil(islerX - listeX + 40 + ipucuW)}px; }` });
      await expect(ipucu('son')).toHaveAttribute('data-gorunur', 'true');
      await expect.poll(() => tablist.evaluate((el) => el.scrollLeft)).toBe(0);
      await page.evaluate(() => {
        const w = window as unknown as { __aileCancel: number };
        w.__aileCancel = 0;
        document.addEventListener('pointercancel', () => { w.__aileCancel += 1; }, true);
      });
      const box = (await isler.boundingBox())!;
      const y = box.y + box.height / 2;
      expect(await page.evaluate(([x, py]) => document.elementFromPoint(x!, py!)?.textContent, [box.x + 12, y])).toBe('İşler');
      await touchDrag(page, { x: box.x + 12, y }, { x: box.x + 12 - 80, y });
      await expect.poll(() => page.evaluate(() => (window as unknown as { __aileCancel: number }).__aileCancel)).toBeGreaterThan(0);
      await expect.poll(() => tablist.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
      await expect(isler).toHaveAttribute('aria-selected', 'false');
      await expect(tablist.getByRole('tab', { name: 'Alımlar' })).toHaveAttribute('aria-selected', 'true');
    }
  });
});

test.describe('Tabs › görünüm modu (/alimlar)', () => {
  test('telefon: combobox → alttan sayfa (dokunma, klavye, odak dönüşü, hareket); geniş: radiogroup', MATRIX, async ({ page, browserName }) => {
    await openAdmin(page, '/alimlar');
    if ((await profile(page)) !== 'phone') {
      const group = page.getByRole('radiogroup', { name: 'Görünüm modu' });
      await expect(group).toHaveAccessibleDescription(/Gantt kullanılamaz/);
      await expect(group.getByRole('radio', { name: 'Gantt' })).toBeDisabled();
      await group.getByText('Tablo', { exact: true }).click();
      await expect(group.getByRole('radio', { name: 'Tablo' })).toHaveAttribute('aria-checked', 'true');
      await tabInto(page, browserName, group.getByRole('radio', { name: 'Tablo' }));
      expect(await focusRing(page)).toEqual([]);
      await page.keyboard.press('ArrowRight');
      await expect(group.getByRole('radio', { name: 'Zaman çizelgesi' })).toBeFocused();
      await expect(group.getByRole('radio', { name: 'Zaman çizelgesi' })).toHaveAttribute('aria-checked', 'true');
      expect(await focusRing(page)).toEqual([]);
      expect(await accentEdges(page, { root: '.aile-tabs--segment' })).toEqual([]);
      expect(await smallText(page, { root: '.aile-tabs--segment' })).toEqual([]);
      await expectTargets(page, [group.getByRole('radio', { name: 'Liste' })]);
      // Hareket: yüzey geçişi tek süre ve tek eğri; azaltılmış harekette süre 0 ve seçim anında. Tercih çalışırken
      // değişince ağaç yeniden kurulmaz (WideProviders hareketi tema tokenıyla ifade eder): odak seçili radyoda ve
      // klavye modu açık kalır.
      // Liste öğeleri virgülle ayrılır; cubic-bezier(…) içindeki virgüller bölünmez.
      const gecis = () => group.getByRole('radio', { name: 'Liste' }).evaluate((el) => ({
        durations: getComputedStyle(el).transitionDuration.split(/,\s*(?![^(]*\))/), eases: getComputedStyle(el).transitionTimingFunction.split(/,\s*(?![^(]*\))/),
      }));
      const normal = await gecis();
      expect(new Set(normal.durations)).toEqual(new Set(['0.24s']));
      expect(new Set(normal.eases)).toEqual(new Set(['cubic-bezier(0.65, 0, 0.35, 1)']));
      const odakta = group.getByRole('radio', { name: 'Zaman çizelgesi' });
      await expect(odakta).toBeFocused();
      const kok = await page.locator('main#admin-content').elementHandle();
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await expect.poll(async () => [...new Set((await gecis()).durations)]).toEqual(['0s']);
      await expect(odakta, 'tercih değişince odak seçili radyoda kalır').toBeFocused();
      expect(await keyboardMode(page), 'tercih değişince klavye modu korunur').toBe('true');
      expect(await kok!.evaluate((element) => element.isConnected), 'main yeniden kurulmadı').toBe(true);
      expect(await focusRing(page)).toEqual([]);
      // Seçim ve yüzey aynı anda: tıklamanın hemen ardından (bekleme yok) radyo işaretli ve yüzey son değerinde (secili;
      // imleç üstünde kalsa da).
      const liste = group.getByRole('radio', { name: 'Liste' });
      const secili = await seciliRenk(liste);
      await group.getByText('Liste', { exact: true }).click();
      const anlik = await liste.evaluate((el) => ({ checked: el.getAttribute('aria-checked'), background: getComputedStyle(el).backgroundColor }));
      expect(anlik).toEqual({ checked: 'true', background: secili });
      return;
    }

    const combobox = page.getByRole('combobox', { name: 'Görünüm modu' });
    await expect(page.getByRole('radiogroup')).toHaveCount(0);
    await expect(combobox).toHaveAccessibleDescription(/Gantt kullanılamaz/);
    await expect(combobox).toHaveAttribute('aria-expanded', 'false');
    await expect(combobox).toContainText('Liste');
    await expectTargets(page, [combobox]);
    await noPageOverflow(page);

    // Dokunma ile açılır: modal sayfa alttan, seçili seçenek odaklı; hareket tek süre ve tek eğri.
    await combobox.tap();
    const sheet = page.getByRole('dialog', { name: 'Görünüm modu' });
    await expect(sheet).toBeVisible();
    await expect(combobox).toHaveAttribute('aria-expanded', 'true');
    const listbox = sheet.getByRole('listbox', { name: 'Görünüm modu' });
    await expect(listbox.getByRole('option')).toHaveCount(6);
    await expect(listbox.getByRole('option', { name: 'Liste' })).toBeFocused();
    await expect(listbox.getByRole('option', { name: 'Liste' })).toHaveAttribute('aria-selected', 'true');
    const gantt = listbox.getByRole('option', { name: /^Gantt/ });
    await expect(gantt).toHaveAttribute('aria-disabled', 'true');
    await expect(gantt).toContainText('Kullanılamaz');
    const motion = await sheet.evaluate((el) => ({ duration: getComputedStyle(el).transitionDuration, ease: getComputedStyle(el).transitionTimingFunction }));
    expect(motion).toEqual({ duration: '0.24s', ease: 'cubic-bezier(0.65, 0, 0.35, 1)' });
    await expect.poll(async () => {
      const box = await sheet.boundingBox();
      const vh = page.viewportSize()!.height;
      return box ? Math.round(box.y + box.height - vh) : NaN;
    }).toBe(0);
    const sheetBox = (await sheet.boundingBox())!;
    expect(sheetBox.height).toBeLessThanOrEqual(page.viewportSize()!.height * 0.85 + 1);
    await expectTargets(page, [listbox.getByRole('option', { name: 'Tablo' }), gantt, sheet.getByRole('button', { name: 'Kapat' })]);
    expect(await smallText(page, { root: '.aile-tabs-sayfa' })).toEqual([]);
    expect(await accentEdges(page, { root: '.aile-tabs-sayfa' })).toEqual([]);

    // Devre dışı seçenek seçilmez; etkin seçeneğe dokunmak seçer, kapatır ve odağı tetiğe döndürür. aria-disabled öğe
    // Playwright'ın eylem denetiminde "etkin değil" sayılır; gerçek dokunuş yine gönderilsin diye force.
    await gantt.tap({ force: true });
    await expect(sheet).toBeVisible();
    await listbox.getByRole('option', { name: 'Tablo' }).tap();
    await expect(combobox).toHaveAttribute('aria-expanded', 'false');
    await expect(combobox).toBeFocused();
    await expect(combobox).toContainText('Tablo');
    await expect(page.locator('.aile-tabs-katman')).toHaveCount(0);

    // Klavye: Tab ile tetiğe; Enter açar (odak seçili seçenekte, çevre halkası yok, alt çizgi var); ↓ taşır; Escape kapatır
    // ve odak tetiğe döner; Tab sayfada kalır (seçenek ↔ Kapat).
    await tabInto(page, browserName, combobox);
    expect(await focusRing(page)).toEqual([]);
    await page.keyboard.press('Enter');
    await expect(sheet.getByRole('option', { name: 'Tablo' })).toBeFocused();
    expect(await focusRing(page)).toEqual([]);
    await page.keyboard.press('ArrowDown');
    await expect(sheet.getByRole('option', { name: 'Zaman çizelgesi' })).toBeFocused();
    await page.keyboard.press(tabKey(browserName));
    await expect(sheet.getByRole('button', { name: 'Kapat' })).toBeFocused();
    expect(await focusRing(page)).toEqual([]);
    await page.keyboard.press(tabKey(browserName));
    await expect(sheet.getByRole('option', { name: 'Zaman çizelgesi' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(combobox).toHaveAttribute('aria-expanded', 'false');
    await expect(combobox).toBeFocused();
    await expect(combobox).toContainText('Tablo');
    expect(await focusRing(page)).toEqual([]);

    // Azaltılmış hareket: geçiş süresi 0; kapanınca katman hemen kalkar, durum ve odak aynı anda. Tercih çalışırken
    // değişince ağaç yeniden kurulmaz: odak combobox'ta ve klavye modu açık kalır.
    const kok = await page.locator('main#admin-content').elementHandle();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(combobox, 'tercih değişince odak combobox\'ta kalır').toBeFocused();
    expect(await keyboardMode(page), 'tercih değişince klavye modu korunur').toBe('true');
    expect(await kok!.evaluate((element) => element.isConnected), 'main yeniden kurulmadı').toBe(true);
    await page.keyboard.press('Enter');
    await expect(sheet).toBeVisible();
    await expect(combobox).toHaveAttribute('aria-expanded', 'true');
    expect(await page.locator('.aile-tabs-sayfa').evaluate((el) => getComputedStyle(el).transitionDuration)).toBe('0s');
    expect(await page.locator('.aile-tabs-katman__ortu').evaluate((el) => getComputedStyle(el).transitionDuration)).toBe('0s');
    await page.keyboard.press('Escape');
    await expect(page.locator('.aile-tabs-katman')).toHaveCount(0, { timeout: 500 });
    await expect(combobox).toHaveAttribute('aria-expanded', 'false');
    await expect(combobox).toBeFocused();
  });
});

test.describe('Tabs › 6 sekmeli şerit (/sozlukler Sözlük)', () => {
  test('telefonda combobox, genişte sekme şeridi; seçim içeriği değiştirir', MATRIX, async ({ page, browserName }) => {
    await openAdmin(page, '/sozlukler');
    if ((await profile(page)) === 'phone') {
      const combobox = page.getByRole('combobox', { name: 'Sözlük' });
      await expect(combobox).toBeVisible();
      await expect(page.getByRole('tablist')).toHaveCount(0);
      await combobox.tap();
      await page.getByRole('dialog', { name: 'Sözlük' }).getByRole('option', { name: 'İş akışları' }).tap();
      await expect(combobox).toContainText('İş akışları');
      await expect(combobox).toBeFocused();
      await noPageOverflow(page);
      return;
    }
    const tablist = page.getByRole('tablist', { name: 'Sözlük' });
    await expect(tablist.getByRole('tab')).toHaveCount(6);
    const first = tablist.getByRole('tab').first();
    const last = tablist.getByRole('tab', { name: 'Görünümler' });
    // İçerik seçili sekmeye bağlı: görünüm tanımları bölümü yalnız "Görünümler" seçilince çizilir. Bölümün tablo mu
    // yoksa (tablette sığmayan tablo) akordeon mu olduğunu ResponsiveTable seçer; burada içerik değişimi sınanır.
    const gorunumler = page.getByRole('heading', { level: 2, name: 'Görünüm tanımları' });
    await expect(first).toHaveAttribute('aria-selected', 'true');
    await expect(gorunumler).toHaveCount(0);
    await tabInto(page, browserName, first);
    await page.keyboard.press('End');
    await expect(last).toBeFocused();
    await expect(last).toHaveAttribute('aria-selected', 'true');
    await expect(first).toHaveAttribute('aria-selected', 'false');
    await expect(gorunumler).toBeVisible();
    await expect.poll(() => shownInStrip(last)).toEqual({ inside: true, hit: true });
    expect(await focusRing(page)).toEqual([]);
    expect(await accentEdges(page, { root: '.aile-tabs' })).toEqual([]);
  });
});
