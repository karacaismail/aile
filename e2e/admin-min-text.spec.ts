import { test, expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { gotoAdmin } from './admin-helpers';

// Kalıcı kural: web arayüzündeki tüm okunabilir metin en az 14 CSS px (gövde, tablo, etiket, rozet, yardımcı metin,
// form kontrolü, hata, çekmece ve açılan liste dahil). Bu kapı 12 yönetim rotasını admin projelerinin hepsinde
// (chromium 320, chromium-desktop 1440, webkit 390 dokunmatik) ilk görünümde, dar ekranda "Sayfalar" çekmecesi
// açıkken, varsa "Filtreler" çekmecesi açıkken ve varsa ilk etkin Select açıkken ölçer.
//
// Ölçüm: belgedeki her görünür metin düğümünün üst öğesinin hesaplanmış font-size değeri (SVG <text> için ekran
// dönüşüm ölçeğiyle çarpılmış), değer/yer tutucu taşıyan görünür form kontrolleri. Görünmez sayılanlar: display none,
// visibility hidden/collapse, opacity 0, sıfır kırpılmış ya da 1 px'lik taşması gizli (ekran okuyucuya özel) öğeler ve
// kutusu olmayan metin. Kapsam dışı (ölçülemez): ECharts canvas metni (Chart.tsx canvas renderer; grafik tek bilgi
// kaynağı değildir, yanındaki tablo/metin ölçülür), ::before/::after içeriği, HTML transform ölçeği.
//
// Dedektör yerel kopyadır: e2e/admin-detectors.ts bu dosya yazılırken yoktu. Self-check testleri dedektörün ihlali
// yakaladığını ve görünmez metni saymadığını kanıtlar (bilinen sentetik belge + gerçek sayfaya enjekte edilen ihlal).

const MIN_PX = 14;

/** navigation.ts adminPages sırası + settingsLink. Masaüstü testi nav'daki bağlantılarla eşitliği denetler. */
const PAGE_ROUTES = [
  '/genel', '/butce', '/odemeler', '/hesaplar', '/alimlar', '/ev',
  '/projeler', '/taraflar', '/raporlar', '/sozlukler', '/veri',
] as const;
const ROUTES = [...PAGE_ROUTES, '/ayarlar'] as const;

interface SmallText {
  text: string;
  px: number;
  where: string;
}

/**
 * Sayfa bağlamında çalışır (page.evaluate); dış kapsamdan hiçbir şeye başvurmaz.
 * minPx altındaki görünür metni öğe başına bir kez döndürür.
 */
function collectSmallText(minPx: number): SmallText[] {
  const hiddenCache = new Map<Element, boolean>();
  const zeroClip = /rect\(\s*0(px)?[\s,]+0(px)?[\s,]+0(px)?[\s,]+0(px)?\s*\)/;

  const selfHidden = (el: Element): boolean => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') return true;
    if (Number(cs.opacity) === 0) return true;
    if (zeroClip.test(cs.clip) || /inset\(\s*50%/.test(cs.clipPath)) return true;
    const overflowHidden = [cs.overflow, cs.overflowX, cs.overflowY].some((v) => v === 'hidden' || v === 'clip');
    if (overflowHidden && el instanceof HTMLElement) {
      const r = el.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1) return true;
    }
    return false;
  };
  const isHidden = (el: Element | null): boolean => {
    if (!el || el === document.documentElement) return false;
    const cached = hiddenCache.get(el);
    if (cached !== undefined) return cached;
    const hidden = selfHidden(el) || isHidden(el.parentElement);
    hiddenCache.set(el, hidden);
    return hidden;
  };
  const effectivePx = (el: Element, own?: string): number => {
    const px = parseFloat(own ?? getComputedStyle(el).fontSize);
    if (el instanceof SVGGraphicsElement) {
      const m = el.getScreenCTM();
      if (m) return px * Math.hypot(m.a, m.b);
    }
    return px;
  };
  const describe = (el: Element): string => {
    const id = el.id ? `#${el.id}` : '';
    const cls = typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/)[0]}` : '';
    return `${el.tagName.toLowerCase()}${id}${cls}`;
  };
  const snippet = (text: string) => {
    const t = text.replace(/\s+/g, ' ').trim();
    return t.length > 60 ? `${t.slice(0, 57)}...` : t;
  };

  const out: SmallText[] = [];
  const reported = new Set<Element>();
  const skipTags = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TITLE', 'OPTION']);

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent ?? '';
    if (!text.trim()) continue;
    const parent = node.parentElement;
    if (!parent || skipTags.has(parent.tagName) || reported.has(parent)) continue;
    if (isHidden(parent)) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    const boxed = Array.from(range.getClientRects()).some((r) => r.width > 0 && r.height > 0);
    if (!boxed) continue;
    const px = effectivePx(parent);
    if (px < minPx - 0.01) {
      reported.add(parent);
      out.push({ text: snippet(text), px: Math.round(px * 100) / 100, where: describe(parent) });
    }
  }

  const skipTypes = new Set(['hidden', 'checkbox', 'radio', 'range', 'color', 'image']);
  for (const el of Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select'))) {
    if (el instanceof HTMLInputElement && skipTypes.has(el.type)) continue;
    if (reported.has(el) || isHidden(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) continue;
    const value = el instanceof HTMLSelectElement ? (el.selectedOptions[0]?.textContent ?? '') : el.value;
    const placeholder = el instanceof HTMLSelectElement ? '' : el.placeholder;
    let px: number;
    let text: string;
    if (value.trim()) {
      px = effectivePx(el);
      text = value;
    } else if (placeholder.trim()) {
      const ph = getComputedStyle(el, '::placeholder').fontSize;
      px = effectivePx(el, ph || undefined);
      text = placeholder;
    } else {
      continue;
    }
    if (px < minPx - 0.01) {
      reported.add(el);
      out.push({ text: snippet(text), px: Math.round(px * 100) / 100, where: describe(el) });
    }
  }
  return out;
}

async function smallText(page: Page): Promise<SmallText[]> {
  return page.evaluate(collectSmallText, MIN_PX);
}

/** Yazı tipleri yüklenir ve sonlu tüm animasyon/geçişler biter (sonsuz yükleme şeridi beklenmez). */
async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.waitForFunction(
    () =>
      document.getAnimations().every((a) => {
        if (a.playState !== 'running') return true;
        return !Number.isFinite(Number(a.effect?.getComputedTiming().endTime ?? 0));
      }),
    undefined,
    { timeout: 5_000 },
  );
}

async function openRoute(page: Page, route: string, testInfo: TestInfo) {
  await gotoAdmin(page, route);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  // Veri okunurken iskelet (aria-busy) görünür; ölçüm yerleşik görünümde yapılsın. Yükleme sürerse yine ölçülür, not düşülür.
  const busy = page.locator('[aria-busy="true"]');
  try {
    await expect(busy).toHaveCount(0, { timeout: 10_000 });
  } catch {
    testInfo.annotations.push({ type: 'not', description: `${route}: 10 sn sonra yükleme sürüyordu; yükleme görünümü ölçüldü` });
  }
  await settle(page);
}

function expectNoSmallText(found: SmallText[], state: string) {
  expect.soft(found, `${state}: ${MIN_PX} CSS px altında görünür metin`).toEqual([]);
}

const isNarrow = (page: Page) => (page.viewportSize()?.width ?? 0) < 1024;
const isPhone = (page: Page) => (page.viewportSize()?.width ?? 0) < 600;

/** Tetiği açar, katman görünür olunca ölçer, Escape ile kapatır ve kapandığını doğrular. */
async function measureOverlay(page: Page, trigger: Locator, overlay: Locator, state: string) {
  await trigger.click();
  await expect(overlay).toBeVisible();
  await settle(page);
  expectNoSmallText(await smallText(page), state);
  await page.keyboard.press('Escape');
  await expect(overlay).toBeHidden();
  await settle(page);
}

/** İlk görünür ve etkin combobox; yoksa null. */
async function firstEnabledCombobox(page: Page): Promise<Locator | null> {
  const combos = page.getByRole('combobox').filter({ visible: true });
  const count = await combos.count();
  for (let i = 0; i < count; i += 1) {
    const combo = combos.nth(i);
    if (await combo.isEnabled()) return combo;
  }
  return null;
}

/** Select'i açar: telefonda BottomSheet (dialog), daha genişte antd listesi (aria-expanded). Ölçer ve kapatır. */
async function measureSelect(page: Page, combo: Locator, state: string) {
  await combo.click();
  if (isPhone(page)) {
    const sheet = page.getByRole('dialog').filter({ visible: true }).first();
    await expect(sheet).toBeVisible();
    await settle(page);
    expectNoSmallText(await smallText(page), state);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog').filter({ visible: true })).toHaveCount(0);
  } else {
    await expect(combo).toHaveAttribute('aria-expanded', 'true');
    await settle(page);
    expectNoSmallText(await smallText(page), state);
    await page.keyboard.press('Escape');
    await expect(combo).not.toHaveAttribute('aria-expanded', 'true');
  }
  await settle(page);
}

test.describe('admin görünür metin en az 14 CSS px', () => {
  for (const route of ROUTES) {
    test(`${route}: ilk görünüm, çekmeceler ve Select açıkken`, async ({ page }, testInfo) => {
      await openRoute(page, route, testInfo);
      const covered: string[] = ['ilk görünüm'];
      expectNoSmallText(await smallText(page), `${route} ilk görünüm`);

      if (isNarrow(page)) {
        await measureOverlay(
          page,
          page.getByRole('button', { name: 'Sayfalar', exact: true }),
          page.getByRole('dialog', { name: 'Sayfalar' }),
          `${route} Sayfalar çekmecesi açık`,
        );
        covered.push('Sayfalar çekmecesi');

        const filters = page.getByRole('button', { name: /^Filtreler \(/ }).filter({ visible: true });
        if ((await filters.count()) > 0) {
          await measureOverlay(page, filters.first(), page.getByRole('dialog', { name: /^Filtreler/ }), `${route} Filtreler çekmecesi açık`);
          covered.push('Filtreler çekmecesi');
        }
      }

      const combo = await firstEnabledCombobox(page);
      if (combo) {
        const name = await combo.evaluate((el) => el.getAttribute('aria-label') || (el as HTMLInputElement).labels?.[0]?.textContent?.trim() || '');
        await measureSelect(page, combo, `${route} Select açık (${name || 'adsız'})`);
        covered.push(`Select: ${name || 'adsız'}`);
      }
      testInfo.annotations.push({ type: 'kapsam', description: `${route}: ${covered.join(', ')}` });
    });
  }

  test('en az bir Select açıkken ölçülür (telefonda Raporlar › Rapor zorunlu)', async ({ page }, testInfo) => {
    if (isNarrow(page)) {
      // Dar düzende Raporlar sayfası "Rapor" seçimini veri durumundan bağımsız çizer (RaporlarPage selectors).
      await openRoute(page, '/raporlar', testInfo);
      const combo = page.getByRole('combobox', { name: 'Rapor' });
      await expect(combo).toBeVisible();
      await measureSelect(page, combo, '/raporlar Rapor seçimi açık');
      return;
    }
    let opened = '';
    for (const route of ROUTES) {
      await openRoute(page, route, testInfo);
      const combo = await firstEnabledCombobox(page);
      if (!combo) continue;
      await measureSelect(page, combo, `${route} Select açık`);
      opened = route;
      break;
    }
    // Geniş düzende Select'ler veriye bağlıdır (Bütçe/Raporlar Dönem, Alımlar Sıralama). Veri yoksa ölçülemez: not_run.
    test.skip(!opened, 'Geniş düzende hiçbir rotada etkin Select yok (nesil verisi yok); Select açık durumu ölçülemedi');
    testInfo.annotations.push({ type: 'kapsam', description: `Select açık: ${opened}` });
  });

  test('rota listesi kabuktaki menüyle aynı (12 rota)', async ({ page }) => {
    test.skip(isNarrow(page), 'Kalıcı nav yalnız masaüstünde; dar düzen aynı listeyi çekmecede gösterir');
    await gotoAdmin(page, '/genel');
    const hrefs = await page
      .getByRole('navigation', { name: 'Sayfalar' })
      .locator('a[href^="#/"]')
      .evaluateAll((links) => links.map((a) => (a.getAttribute('href') ?? '').slice(1)));
    expect(hrefs).toEqual([...PAGE_ROUTES]);
    await expect(page.getByRole('link', { name: 'Ayarlar' })).toHaveAttribute('href', '#/ayarlar');
    expect(ROUTES).toHaveLength(12);
  });
});

test.describe('self-check: 14 px dedektörü', () => {
  test('bilinen belgede ihlalleri yakalar, görünmez metni saymaz', async ({ page }) => {
    await page.setContent(`<!doctype html>
      <html lang="tr"><head><style>
        html { font-size: 16px; }
        body { font-size: 16px; margin: 0; }
        .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
        .ip { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
      </style></head><body><main>
        <p style="font-size:14px">Yeterli metin</p>
        <p style="font-size:16px">Büyük <span style="font-size:13px">Küçük ihlal</span></p>
        <p style="font-size:0.8rem">Rem küçük</p>
        <p style="display:none;font-size:10px">Gizli display</p>
        <p style="visibility:hidden;font-size:10px">Gizli visibility</p>
        <p style="opacity:0;font-size:10px">Gizli opaklık</p>
        <div style="display:none"><span style="font-size:16px">Üstü gizli</span><span style="font-size:10px">Üstü gizli küçük</span></div>
        <span class="sr" style="font-size:10px">Ekran okuyucu</span>
        <span class="ip" style="font-size:10px">Kırpılmış</span>
        <p style="font-size:12px">   </p>
        <div style="font-size:12px"><b style="font-size:16px">İç büyük</b></div>
        <label>Değer <input aria-label="Değer" value="Küçük değer" style="font-size:12px"></label>
        <input aria-label="Boş" style="font-size:12px">
        <input aria-label="Yer tutucu" placeholder="Küçük yer tutucu" style="font-size:12px">
        <input aria-label="Yeterli" placeholder="Yeterli yer tutucu" style="font-size:14px">
        <svg width="200" height="40" viewBox="0 0 100 20"><text x="0" y="15" font-size="10">SVG ölçekli</text></svg>
        <svg width="100" height="20" viewBox="0 0 100 20"><text x="0" y="15" font-size="10">SVG küçük</text></svg>
      </main></body></html>`);
    const found = await smallText(page);
    expect(found.map((f) => f.text).sort()).toEqual(
      ['Küçük değer', 'Küçük ihlal', 'Küçük yer tutucu', 'Rem küçük', 'SVG küçük'].sort(),
    );
    const byText = Object.fromEntries(found.map((f) => [f.text, f.px]));
    expect(byText['Küçük ihlal']).toBe(13);
    expect(byText['Rem küçük']).toBeCloseTo(12.8, 1);
    expect(byText['SVG küçük']).toBeCloseTo(10, 1);
  });

  test('gerçek sayfaya enjekte edilen ihlali (içerik ve portal) yakalar', async ({ page }, testInfo) => {
    await openRoute(page, '/genel', testInfo);
    const before = (await smallText(page)).map((f) => f.text);
    await page.evaluate(() => {
      const main = document.querySelector('main');
      const inside = document.createElement('p');
      inside.textContent = 'Enjekte içerik ihlali';
      inside.style.fontSize = '12px';
      main?.append(inside);
      const portal = document.createElement('div');
      portal.textContent = 'Enjekte portal ihlali';
      portal.style.cssText = 'position:fixed;left:0;top:0;font-size:13px;z-index:9999';
      document.body.append(portal);
      const sr = document.createElement('span');
      sr.textContent = 'Enjekte gizli metin';
      sr.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);font-size:10px';
      main?.append(sr);
    });
    const after = (await smallText(page)).map((f) => f.text);
    expect(after).toEqual(expect.arrayContaining(['Enjekte içerik ihlali', 'Enjekte portal ihlali']));
    expect(after).not.toContain('Enjekte gizli metin');
    expect(after.filter((t) => !before.includes(t)).sort()).toEqual(['Enjekte içerik ihlali', 'Enjekte portal ihlali']);
  });
});
