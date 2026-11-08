import { test, expect, type Locator, type Page, type Route, type TestInfo } from '@playwright/test';
import { enterKeyboardMode, gotoAdmin, horizontalOverflow, openAdmin } from './admin-helpers';
import { focusRing, motion, smallText } from './admin-detectors';

// a08-status: durum bileşenleri gerçek rotada (yerel HTML, antd'siz) — DataStatus, ErrorState, EmptyState, Tag,
// StatusText, LoadingShell. Görev koşusu: chromium 320×568 dokunmatik + webkit 390×844 dokunmatik; genişliğe bağlı
// testler @matrix etiketlidir (entegrasyonda 360/375/320×480/568×320/tablet/masaüstü projelerinde de koşar).
// Emülasyon gerçek cihaz değildir. Veri: dev sunucusunun sentetik nesli (fixtures/generation-synthetic); bazı testler
// manifest isteğini page.route ile geciktirir ya da 404 yapar. Google'a ağ çağrısı yok.

const isManifest = (url: URL) => url.pathname.endsWith('/__aile/generation/manifest.json');
/** Başlıktaki tek tazelik satırı (DataStatus): role="status" + data-state. */
const dataStatus = (page: Page) => page.locator('[role="status"][data-state]');
const TONES = ['notr', 'bilgi', 'olumlu', 'uyari', 'hata'];

/**
 * İşaretçiyle etkinleştirme: dokunmatik projede (hasTouch) gerçek dokunma, dokunmasız masaüstü projesinde fare tıklaması.
 * Dokunmasız bağlamda Playwright tap() çalışmaz ("The page does not support tap"); orada işaretçi faredir.
 */
async function press(locator: Locator, testInfo: TestInfo) {
  if (testInfo.project.use.hasTouch) await locator.tap();
  else await locator.click();
}

/** Konumlayıcıya geçici bir seçici verir; dedektörler string kök/hedef alır. */
async function mark(locator: Locator, id: string): Promise<string> {
  await locator.evaluate((el, value) => el.setAttribute('data-e2e-a08', value), id);
  return `[data-e2e-a08="${id}"]`;
}

/** Etkin dokunma hedefi: AdaptiveRoot coarse katmanı (html[data-input-coarse]) açıksa 48, değilse 44 px. */
async function minTarget(page: Page): Promise<number> {
  return (await page.evaluate(() => document.documentElement.hasAttribute('data-input-coarse'))) ? 48 : 44;
}

async function expectTarget(locator: Locator, min: number, square = false) {
  const box = await locator.boundingBox();
  expect(box, 'görünür hedef').not.toBeNull();
  expect(box!.height, 'hedef yüksekliği').toBeGreaterThanOrEqual(min - 0.5);
  if (square) expect(box!.width, 'hedef genişliği').toBeGreaterThanOrEqual(min - 0.5);
}

function countManifest(page: Page) {
  const hits = { n: 0 };
  page.on('request', request => { if (isManifest(new URL(request.url()))) hits.n += 1; });
  return hits;
}

/** Manifest yanıtını release() çağrılana dek bekletir (dev sunucusundaki sentetik nesil sonra aynen döner). */
async function holdManifest(page: Page) {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(isManifest, async (route: Route) => {
    await gate;
    await route.continue();
  });
  return release;
}

/** Kelime arası olmayan uzun yol (ör. parça yolu): ErrorState metni bunu kabın genişliğinde sarmalı, belgeyi taşırmamalı. */
const UZUN_YOL = '(data/forecast_months/budget/00000.json/sentetik-uzun-yol)';

const frames = (page: Page) => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

// --- DataStatus ------------------------------------------------------------------------------------------------
test('DataStatus: "Son okuma · Nesil · Yenile" tek durum satırı; doğal sarılır, satır "·" ile başlamaz, taşmaz', { tag: '@matrix' }, async ({ page }, testInfo) => {
  await openAdmin(page, '/alimlar');
  const status = dataStatus(page);
  await expect(status).toHaveCount(1);
  await expect(status).toHaveAttribute('data-state', 'fresh');
  await expect(status).toHaveAttribute('aria-live', 'polite');
  await expect(status).toHaveText(/^Son okuma \d{2}:\d{2} · Nesil [0-9a-f]{6} · Yenile$/);

  const layout = await status.evaluate(root => {
    const box = root.getBoundingClientRect();
    const seps = Array.from(root.querySelectorAll<HTMLElement>('[aria-hidden="true"]:not(svg)')).map(sep => {
      const text = sep.previousSibling;
      if (!text) return 'ayırıcıdan önce metin yok';
      const range = document.createRange();
      range.selectNodeContents(text);
      const rects = Array.from(range.getClientRects());
      const last = rects[rects.length - 1];
      const s = sep.getBoundingClientRect();
      const sameLine = last && Math.abs((last.top + last.bottom) / 2 - (s.top + s.bottom) / 2) < 2;
      return sameLine && s.left >= last.right - 1 ? '' : `"${text.textContent}" ile ayırıcı aynı satırda değil`;
    });
    const outside = Array.from(root.children)
      .filter(child => { const r = child.getBoundingClientRect(); return r.left < box.left - 0.5 || r.right > box.right + 0.5; })
      .map(child => child.className);
    return { seps: seps.filter(Boolean), outside, scroll: root.scrollWidth - root.clientWidth };
  });
  expect(layout.seps, 'her ayırıcı önceki metnin satırında').toEqual([]);
  expect(layout.outside, 'parçalar satırın içinde').toEqual([]);
  expect(layout.scroll, 'satır yatay taşmaz').toBeLessThanOrEqual(1);

  await expectTarget(status.getByRole('button', { name: 'Yenile' }), await minTarget(page));
  expect(await smallText(page, { root: await mark(status, 'durum'), min: 14 }), 'DataStatus metin boyutu').toEqual([]);
  expect(await motion(page, undefined, undefined, { root: await mark(status, 'durum') }), 'DataStatus hareketi').toEqual([]);
  if (testInfo.project.name.startsWith('chromium')) expect(await horizontalOverflow(page), 'belge düzeyinde yatay taşma').toEqual([]);
});

test('DataStatus: metin genişliği değişince (yedek fonttan Outfit\'e geçiş) satır yüksekliği, parçaların satırı ve eylemin dikey yeri sabit kalır', { tag: '@matrix' }, async ({ page }) => {
  // Outfit gelmeden metin yedek fontla çizilir; 14 px'te yedek dize birkaç yüzde geniştir. Dar ekranda bu fark "Yenile"yi ya
  // da "Nesil …" parçasını başka satıra itip içeriği kaydırmamalı (e2e/admin-typography geç font kayması). Yedeğin geniş
  // dizgesi, yalnız parça metinlerine harf aralığı verilerek taklit edilir (%8 ≈ SF Pro Text 14 px / Outfit).
  await openAdmin(page, '/alimlar');
  const status = dataStatus(page);
  await expect(status).toHaveAttribute('data-state', 'fresh');
  const olc = () => status.evaluate(root => {
    const row = root.getBoundingClientRect();
    const button = root.querySelector('button')!.getBoundingClientRect();
    const satirlar = Array.from(root.querySelectorAll('.aile-ds__metin')).map(el => Math.round(el.getBoundingClientRect().top - row.top));
    return { yukseklik: Math.round(row.height * 100) / 100, dugmeUst: Math.round((button.top - row.top) * 100) / 100, satirlar };
  });
  const outfit = await olc();
  for (const genislik of ['0.04em', '0.08em']) {
    await status.evaluate((root, value) => root.querySelectorAll<HTMLElement>('.aile-ds__metin').forEach(el => { el.style.letterSpacing = value; }), genislik);
    expect(await olc(), `metin ${genislik} harf aralığıyla genişleyince`).toEqual(outfit);
  }
  await status.evaluate(root => root.querySelectorAll<HTMLElement>('.aile-ds__metin').forEach(el => { el.style.letterSpacing = ''; }));
  expect(await olc()).toEqual(outfit);
});

test('DataStatus: Tab + Enter yeniler; okurken Yenile devre dışı, bitince odak aynı düğmeye döner; odak tek alt çizgi', async ({ page, browserName }) => {
  await openAdmin(page, '/alimlar');
  const status = dataStatus(page);
  const refresh = status.getByRole('button', { name: 'Yenile' });
  const release = await holdManifest(page);
  await enterKeyboardMode(page, browserName);
  await refresh.focus();
  const target = await mark(refresh, 'yenile');
  expect(await focusRing(page, { target, keyboard: true }), 'Yenile odağı').toEqual([]);

  await page.keyboard.press('Enter');
  await expect(status).toHaveAttribute('data-state', 'checking');
  await expect(refresh).toBeDisabled();
  release();
  await expect(status).toHaveAttribute('data-state', 'fresh');
  await expect(refresh).toBeEnabled();
  await expect(refresh, 'okuma bitince odak Yenile’ye döner').toBeFocused();
  expect(await focusRing(page, { target, keyboard: true }), 'dönen odak görünür tek çizgi').toEqual([]);
});

test('DataStatus: dokunma Yenile’yi bir kez çalıştırır; kaydırmaya dönen dokunma (pointercancel) çalıştırmaz', async ({ page, browserName }, testInfo) => {
  await openAdmin(page, '/alimlar');
  const hits = countManifest(page);
  const status = dataStatus(page);
  const refresh = status.getByRole('button', { name: 'Yenile' });
  await refresh.evaluate(button => {
    const w = window as unknown as { __a08: { click: number; cancel: number } };
    w.__a08 = { click: 0, cancel: 0 };
    button.addEventListener('click', () => { w.__a08.click += 1; });
    document.addEventListener('pointercancel', () => { w.__a08.cancel += 1; }, true);
  });
  const counts = () => page.evaluate(() => (window as unknown as { __a08: { click: number; cancel: number } }).__a08);

  if (browserName === 'chromium') {
    // Gerçek dokunmatik kaydırma (CDP): parmak düğmede başlar, yukarı kayar; tarayıcı pointercancel verir, tıklama yok.
    // Kaydırma için yer: sayfa kısa kalırsa sona geçici bir boşluk eklenir (yalnız bu test sayfasında).
    await page.evaluate(() => {
      if (document.scrollingElement!.scrollHeight > window.innerHeight + 240) return;
      const spacer = document.createElement('div');
      spacer.style.height = `${window.innerHeight * 2}px`;
      document.body.append(spacer);
    });
    const box = (await refresh.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let step = 1; step <= 8; step += 1) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - step * 15 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await frames(page);
    await expect.poll(async () => (await counts()).cancel, { message: 'tarayıcı pointercancel verdi' }).toBeGreaterThan(0);
    await frames(page);
    expect((await counts()).click, 'iptal edilen dokunma tıklama üretmez').toBe(0);
    await page.evaluate(() => window.scrollTo(0, 0));
  }

  const before = hits.n;
  await press(refresh, testInfo);
  await expect.poll(() => hits.n, { message: 'dokunma manifesti yeniden ister' }).toBeGreaterThan(before);
  expect((await counts()).click).toBe(1);
  await expect(status).toHaveAttribute('data-state', 'fresh');
});

// --- ErrorState -------------------------------------------------------------------------------------------------
test('ErrorState: manifest okunamazsa "Hata: …", tutar yok; "Yeniden dene" 44/48 px, Enter ve dokunmayla yeniden ister', { tag: '@matrix' }, async ({ page, browserName }, testInfo) => {
  // Neden metni sunucunun hata gövdesinden gelir; içindeki uzun yol tek kelimedir ve dar alana sığmalıdır (taşma ölçülür).
  await page.route(isManifest, route => route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: `nesil bulunamadı ${UZUN_YOL}` }) }));
  const hits = countManifest(page);
  await gotoAdmin(page, '/alimlar');
  const alert = page.getByRole('alert').filter({ has: page.getByRole('heading', { name: /^Hata: / }) });
  await expect(alert).toBeVisible();
  await expect(alert.getByRole('heading', { level: 2 })).toHaveText(/^Hata: /);
  await expect(alert, 'neden metni uzun yolu taşır (taşma ölçümü gerçek girdiyle)').toContainText(UZUN_YOL);
  await expect(page.getByRole('main')).not.toContainText(/₺\d/);
  const retry = alert.getByRole('button', { name: 'Yeniden dene' });
  await expectTarget(retry, await minTarget(page));
  const root = await mark(alert, 'hata');
  expect(await smallText(page, { root, min: 14 }), 'ErrorState metin boyutu').toEqual([]);
  expect(await motion(page, undefined, undefined, { root }), 'ErrorState hareketi').toEqual([]);
  if (testInfo.project.name.startsWith('chromium')) expect(await horizontalOverflow(page), 'belge düzeyinde yatay taşma').toEqual([]);

  await enterKeyboardMode(page, browserName);
  await retry.focus();
  expect(await focusRing(page, { target: await mark(retry, 'yeniden'), keyboard: true }), 'Yeniden dene odağı').toEqual([]);
  let before = hits.n;
  await page.keyboard.press('Enter');
  await expect.poll(() => hits.n, { message: 'Enter manifesti yeniden ister' }).toBeGreaterThan(before);
  await expect(alert).toBeVisible();

  before = hits.n;
  await press(alert.getByRole('button', { name: 'Yeniden dene' }), testInfo);
  await expect.poll(() => hits.n, { message: 'dokunma manifesti yeniden ister' }).toBeGreaterThan(before);
  await expect(alert).toBeVisible();
});

/** Dar kap türleri: ErrorState sayfalarda esnek satırın, 1fr ızgara izinin ya da içerik genişliğine göre boyutlanan bir
 *  kabın (tablo hücresi: en küçük içerik genişliğine büyür) öğesi olur. Kap, metindeki en uzun kelimeden dardır. */
const DAR_KAPLAR = {
  'esnek satır': 'display:flex',
  'ızgara 1fr': 'display:grid;grid-template-columns:1fr',
  'tablo hücresi': 'display:table;table-layout:auto',
} as const;
const DAR_KAP_PX = 240;

test('ErrorState: en uzun kelimeden dar kapta (esnek, ızgara, tablo hücresi) sığar; kelime yalnız sığmazsa bölünür', { tag: '@matrix' }, async ({ page }) => {
  // Gerçek girdi: sunucunun hata gövdesindeki uzun yol tek kelimedir; başlık ve neden metni sayfanın ErrorState'inden.
  await page.route(isManifest, route => route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: `nesil bulunamadı ${UZUN_YOL}` }) }));
  await gotoAdmin(page, '/alimlar');
  const alert = page.getByRole('alert').filter({ has: page.getByRole('heading', { name: /^Hata: / }) });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText(UZUN_YOL);
  const root = await mark(alert, 'dar-kap');

  for (const [ad, stil] of Object.entries(DAR_KAPLAR)) {
    // Bileşen geçici bir kaba taşınır, aynı görevde ölçülür ve yerine konur (React'in göreceği bir an yok).
    const olcum = await page.evaluate(({ selector, stil, genislik, uzunYol }) => {
      const el = document.querySelector<HTMLElement>(selector)!;
      const yer = el.parentElement!;
      const sonraki = el.nextSibling;
      const kap = document.createElement('div');
      kap.setAttribute('style', `${stil};width:${genislik}px;max-width:${genislik}px`);
      let tasiyici: HTMLElement = kap;
      if (stil.includes('display:table')) {
        tasiyici = document.createElement('div');
        tasiyici.setAttribute('style', 'display:table-cell');
        kap.appendChild(tasiyici);
      }
      yer.insertBefore(kap, el);
      tasiyici.appendChild(el);
      const kapKutu = kap.getBoundingClientRect();
      const kutu = el.getBoundingClientRect();
      const tasan = Array.from(el.querySelectorAll<HTMLElement>('*'))
        .filter(child => child.getClientRects().length > 0)
        .filter(child => { const r = child.getBoundingClientRect(); return r.left < kutu.left - 0.5 || r.right > kutu.right + 0.5; })
        .map(child => `${child.tagName.toLowerCase()}.${child.className || ''} ${Math.round(child.getBoundingClientRect().width)} px`);
      // Kelime satırı: aralığın satır kutuları (aynı satırdaki parçalar tek sayılır).
      const satirlar = (node: Text, start: number, end: number) => {
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, end);
        return new Set(Array.from(range.getClientRects()).filter(r => r.width > 0).map(r => Math.round(r.top))).size;
      };
      let uzunKelime = 0;
      const bolunen: string[] = [];
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
        for (const match of node.data.matchAll(/\S+/g)) {
          const start = match.index ?? 0;
          const end = start + match[0].length;
          const range = document.createRange();
          range.setStart(node, start);
          range.setEnd(node, end);
          if (match[0] === uzunYol) { uzunKelime = Math.max(uzunKelime, range.getBoundingClientRect().width); continue; }
          // Kendi satırına sığan kelime bölünmez (anywhere yalnız sığmayan kelimede devreye girer).
          if (satirlar(node, start, end) > 1) bolunen.push(match[0]);
        }
      }
      // Uzun kelimenin tek satırdaki doğal genişliği: aynı yazı biçimiyle ölçülür.
      const olcer = document.createElement('span');
      const mesaj = Array.from(el.querySelectorAll('p')).find(p => p.textContent?.includes(uzunYol)) ?? el;
      const cs = getComputedStyle(mesaj);
      olcer.setAttribute('style', `position:absolute;visibility:hidden;white-space:nowrap;font:${cs.font}`);
      olcer.textContent = uzunYol;
      document.body.appendChild(olcer);
      const dogalGenislik = olcer.getBoundingClientRect().width;
      olcer.remove();
      const sonuc = {
        dogalGenislik: Math.round(dogalGenislik),
        kap: Math.round(kapKutu.width),
        bilesenTasmasi: Math.round(Math.max(0, kutu.right - kapKutu.right, kapKutu.left - kutu.left)),
        kayma: el.scrollWidth - el.clientWidth,
        tasan,
        uzunKelimeSatirda: Math.round(uzunKelime),
        bolunen,
      };
      yer.insertBefore(el, sonraki);
      kap.remove();
      return sonuc;
    }, { selector: root, stil, genislik: DAR_KAP_PX, uzunYol: UZUN_YOL });

    const nerede = `${ad} (${DAR_KAP_PX} px): ${JSON.stringify(olcum)}`;
    expect(olcum.dogalGenislik, `girdi anlamlı: uzun kelime kaptan geniş · ${nerede}`).toBeGreaterThan(DAR_KAP_PX);
    expect(olcum.kap, `kap genişliği korunur (bileşen kabı büyütmez) · ${nerede}`).toBeLessThanOrEqual(DAR_KAP_PX + 0.5);
    expect(olcum.bilesenTasmasi, `bileşen kaptan taşmaz · ${nerede}`).toBe(0);
    expect(olcum.kayma, `bileşen içinde yatay kayma yok · ${nerede}`).toBeLessThanOrEqual(1);
    expect(olcum.tasan, `iç öğe bileşen kutusundan taşmaz · ${nerede}`).toEqual([]);
    expect(olcum.uzunKelimeSatirda, `uzun kelime satırlara bölünerek kaba sığar · ${nerede}`).toBeLessThanOrEqual(DAR_KAP_PX);
    expect(olcum.bolunen, `sığan kelime bölünmez · ${nerede}`).toEqual([]);
  }
  await expect(alert, 'ölçümden sonra bileşen yerinde').toBeVisible();
});

// --- EmptyState + Tag (etkin filtre) ----------------------------------------------------------------------------
test('EmptyState ve filtre etiketi: boş sonuç etkin filtreleri yazar; kaldır/temizle 44/48 px; metin ≥14 px; taşma yok', { tag: '@matrix' }, async ({ page }, testInfo) => {
  await openAdmin(page, '/alimlar/?ara=zzqx-eslesmeyen&room=unknown');
  const empty = page.getByRole('status').filter({ has: page.getByRole('heading', { name: 'Bu filtrelerle kayıt yok' }) });
  await expect(empty).toBeVisible();
  await expect(empty.getByRole('list')).toContainText('Arama: zzqx-eslesmeyen');
  await expect(empty.getByRole('list')).toContainText('Oda: Bilinmiyor');
  const min = await minTarget(page);
  await expectTarget(empty.getByRole('button', { name: 'Filtreyi kaldır: Arama: zzqx-eslesmeyen' }), min, true);
  await expectTarget(empty.getByRole('button', { name: 'Filtreleri temizle' }), min);

  // Sorgu şeridindeki kaldırılabilir Tag: ayrı ad ("… filtresini kaldır"), kare kaldır düğmesi.
  const chipRemove = page.getByRole('button', { name: 'Arama: zzqx-eslesmeyen filtresini kaldır' });
  await expectTarget(chipRemove, min, true);
  const chip = chipRemove.locator('xpath=..');
  await expect(chip).toHaveAttribute('data-tone', /.+/);

  const emptyRoot = await mark(empty, 'bos');
  const chipRoot = await mark(chip, 'etiket');
  expect(await smallText(page, { root: emptyRoot, min: 14 }), 'EmptyState metin boyutu').toEqual([]);
  expect(await smallText(page, { root: chipRoot, min: 14 }), 'Tag metin boyutu').toEqual([]);
  expect(await motion(page, undefined, undefined, { root: emptyRoot }), 'EmptyState hareketi').toEqual([]);
  expect(await motion(page, undefined, undefined, { root: chipRoot }), 'Tag hareketi').toEqual([]);
  if (testInfo.project.name.startsWith('chromium')) expect(await horizontalOverflow(page), 'belge düzeyinde yatay taşma').toEqual([]);
});

test('EmptyState: klavyeyle filtre kaldırılınca odak kalan kaldır düğmesine geçer (sayfaya düşmez); tek alt çizgi', async ({ page, browserName }) => {
  await openAdmin(page, '/alimlar/?ara=zzqx-eslesmeyen&room=unknown');
  const empty = page.getByRole('status').filter({ has: page.getByRole('heading', { name: 'Bu filtrelerle kayıt yok' }) });
  await expect(empty).toBeVisible();
  await enterKeyboardMode(page, browserName);
  await empty.getByRole('button', { name: 'Filtreyi kaldır: Oda: Bilinmiyor' }).focus();
  await page.keyboard.press('Enter');
  await expect(empty.getByRole('list')).not.toContainText('Oda: Bilinmiyor');
  const next = empty.getByRole('button', { name: 'Filtreyi kaldır: Arama: zzqx-eslesmeyen' });
  await expect(next, 'odak kalan kaldır düğmesinde').toBeFocused();
  expect(await focusRing(page, { target: await mark(next, 'sonraki'), keyboard: true }), 'dönen odak görünür tek çizgi').toEqual([]);
  await page.keyboard.press('Space');
  await expect(empty).toHaveCount(0);
});

// --- Tag (durum) ve StatusText ----------------------------------------------------------------------------------
test('Tag durum ve StatusText: ton + sözcük birlikte; boş sözcük yok; metin ≥14 px', async ({ page }) => {
  const seen = { tag: 0, status: 0 };
  for (const route of ['/alimlar', '/alimlar/?mod=table']) {
    await openAdmin(page, route);
    const found = await page.evaluate(() => {
      const visible = (el: Element) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
      const read = (selector: string) => Array.from(document.querySelectorAll(selector)).filter(visible).map(el => ({
        tone: el.getAttribute('data-tone'),
        text: (el.textContent ?? '').trim(),
        size: parseFloat(getComputedStyle(el).fontSize),
      }));
      return { tags: read('main .aile-tag--durum'), statuses: read('main .aile-status') };
    });
    for (const item of [...found.tags, ...found.statuses]) {
      expect(TONES, `ton ${item.tone}`).toContain(item.tone);
      expect(item.text, 'sözcük').not.toBe('');
      expect(item.size, `"${item.text}" yazı boyutu`).toBeGreaterThanOrEqual(14);
    }
    seen.tag += found.tags.length;
    seen.status += found.statuses.length;
  }
  expect(seen.tag + seen.status, 'gerçek rotada en az bir durum etiketi ya da durum metni').toBeGreaterThan(0);
});

// --- LoadingShell -----------------------------------------------------------------------------------------------
test('LoadingShell: iskelet + aria-busy, tek şerit; bloklar parıldamaz; dar kapsayıcıda geniş iskelet kesilmez; reduced-motion’da şerit durur', { tag: '@matrix' }, async ({ page }) => {
  const release = await holdManifest(page);
  await gotoAdmin(page, '/ayarlar');
  const shells = page.locator('[role="status"][aria-busy="true"]').filter({ has: page.locator('[data-part="strip"]') });
  // Önce rota yedeği (sayfa parçası inerken PageHeader + LoadingShell), sonra sayfanın kendi iskeletleri çizilir. Geniş
  // profilde (tablet/masaüstü) tembel antd sağlayıcısı bağlanınca alt ağaç bir kez yeniden kurulur; o ana dek uygulama
  // kökü aria-busy taşır (adaptive/AdaptiveRoot). Ölçüm, ayrılan öğede yapılırsa hesaplanmış stil boş okunur (WebKit:
  // '' ≠ 'none'; gates/m5-round2 webkit-tablet). Bu yüzden: kök meşgul değilken (yeniden kurulum bitti, telefonda hemen)
  // sayfa bölümü göründükten sonra ölçülür; iskeletler manifest bırakılana dek kalıcıdır.
  await expect(page.locator('.aile-admin[data-profile]')).not.toHaveAttribute('aria-busy', 'true');
  await expect(page.getByRole('heading', { level: 2, name: 'Aile', exact: true })).toBeVisible();
  await expect(shells.first()).toBeVisible();

  // Sorgu ve ölçüm tek değerlendirmede: locator.evaluateAll öğeleri bir turda bulur, işlevi sonraki turda çalıştırır;
  // arada React işlerse ayrılmış öğe ölçülürdü. Burada yalnız o anda belgeye bağlı iskeletler ölçülür.
  const inspect = () => page.evaluate(() => Array.from(document.querySelectorAll('[role="status"][aria-busy="true"]'))
    .filter(root => root.querySelector('[data-part="strip"]'))
    .map(root => {
      const box = root.getBoundingClientRect();
      const strip = root.querySelector('[data-part="strip"] > span');
      const blocks = Array.from(root.querySelectorAll('[data-part="block"], [data-part="photo"]'));
      const rows = Array.from(root.querySelectorAll<HTMLElement>('[data-part="row"]'));
      return {
        connected: root.isConnected,
        layout: root.getAttribute('data-layout'),
        width: box.width,
        strip: strip ? getComputedStyle(strip).animationName : 'yok',
        shimmer: blocks.filter(block => getComputedStyle(block).animationName !== 'none').length,
        clipped: rows.filter(row => row.scrollWidth > row.clientWidth + 1 || row.getBoundingClientRect().right > box.right + 0.5).length,
        visibleAmountSlots: Array.from(root.querySelectorAll('.aile-loading-blok--tutar')).filter(el => getComputedStyle(el).display !== 'none').length,
      };
    }));

  let shellsNow = await inspect();
  expect(shellsNow.length).toBeGreaterThan(0);
  for (const shell of shellsNow) {
    expect(shell.connected, 'ölçülen iskelet belgede').toBe(true);
    expect(shell.strip, 'şerit döngüsü').not.toBe('none');
    expect(shell.shimmer, 'iskelet blokları parıldamaz').toBe(0);
    expect(shell.clipped, 'iskelet satırı kesilmez/taşmaz').toBe(0);
    if (shell.width < 600) expect(shell.visibleAmountSlots, 'dar kapsayıcıda tutar yuvaları gizli').toBe(0);
  }
  expect(await motion(page, undefined, undefined, { root: await mark(shells.first(), 'iskelet') }), 'iskelet hareketi (şerit bildirilmiş istisna)').toEqual([]);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  shellsNow = await inspect();
  expect(shellsNow.length, 'reduced-motion’da iskelet hâlâ çizili (manifest bekliyor)').toBeGreaterThan(0);
  for (const shell of shellsNow) expect(shell.strip, 'reduced-motion’da şerit durur').toBe('none');
  await expect(shells.first()).toHaveAttribute('aria-busy', 'true');

  release();
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
});
