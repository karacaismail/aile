import { test, expect, type Locator, type Page } from '@playwright/test';
import { syntheticBridgeResponse } from '../src/dashboard/bridgeFixtures';
import { syntheticCurrentSheets } from '../src/dashboard/currentFixtures';
import { gviz } from '../src/dashboard/fixtures';
import { ADMIN_MAIN, openAdmin } from './admin-helpers';

// Duman testi: 12 rotanın her biri açılır ve yerleşir. Görev koşusunda chromium (320×568) ve webkit (390×844);
// @matrix etiketiyle entegrasyonda 360, 375, 320×480, 568×320, tablet ve masaüstünde de koşar.
// "Açılır" = openAdmin hazır sinyali (main + dolu h1 + aria-busy yok) + veri okuması ("Okunuyor…") biter + görünür alandaki
// grafik yuvaları ("Grafik hazırlanıyor") çizilir + h1 menü etiketi, belge başlığı "<etiket> · aile", tek main, hata
// durumu yok, belge yatay taşmıyor. Görünür alanın altındaki grafik yuvası tasarım gereği bekler (Chart.tsx: geniş
// profilde IntersectionObserver ile görünür alana girince yüklenir); test onu görünür alana kaydırır ve çizilmesini de
// bekler. Bütün açılış boyunca: konsol hatası yok, yakalanmamış istisna yok, başarısız istek yok, ≥400 yanıt yok.
// Veri: sunucu sentetik nesli verir (AILE_GENERATION_DIR). Dış ağ kapalıdır: Bütçe'nin canlı GViz okuması sentetik
// e-tablo kimliğiyle sentetik GViz yanıtına (src/dashboard/*Fixtures) bağlanır, fikstürdeki ayrılmış ".invalid" görsel
// adresi sentetik 1×1 PNG alır; başka her dış istek kesilir ve ihlal sayılır. Önceki "/butce kalıcı düşüyor" kaydı:
// sentetik GViz yanıtı verilmeyip Google isteği yalnız kesildiğinde /butce "Canlı Sheet" satırı "Hata: Failed to fetch"
// (WebKit "Load failed") gösterir ve test "Hata:" denetiminde düşer; ağ hatasını göstermek doğru davranıştır, eksik olan
// testin ağ yalıtımıydı (ham İngilizce hata metni ayrı bir d01-live kusurudur, f05 kaydı).
// 304 (önbellek doğrulaması) ve sayfanın kendi iptal ettiği istek (AbortController; React StrictMode geliştirme
// kipinde efekti iki kez kurar ve ilk GViz okumasını iptal eder) başarısızlık değildir.

interface SmokeRoute { path: string; label: string }

/** navigation.ts › adminPages + Ayarlar (tasarım bundle.js NAV sırası). */
const ROUTES: readonly SmokeRoute[] = [
  { path: '/genel', label: 'Genel durum' },
  { path: '/butce', label: 'Bütçe ve nakit' },
  { path: '/odemeler', label: 'Ödemeler' },
  { path: '/hesaplar', label: 'Hesaplar ve borçlar' },
  { path: '/emeklilik', label: 'Emeklilik planı' },
  { path: '/alimlar', label: 'Alımlar ve eşyalar' },
  { path: '/ev', label: 'Ev ve odalar' },
  { path: '/projeler', label: 'Projeler ve görevler' },
  { path: '/taraflar', label: 'Taraflar ve teklifler' },
  { path: '/raporlar', label: 'Raporlar' },
  { path: '/sozlukler', label: 'Sözlükler ve iş akışları' },
  { path: '/veri', label: 'Veri kalitesi ve içe aktarma' },
  { path: '/ayarlar', label: 'Ayarlar' },
];

/** Veri okuması sürüyor (DataStatus "Okunuyor…"): yerleşmiş sayfada hiçbir yerde kalmaz. */
const READING = /Okunuyor/;
/** Grafik yuvası (Chart "Grafik hazırlanıyor"): görünür alandaysa çizilir; altındaysa kaydırılınca çizilir. */
const CHART_PENDING = /Grafik hazırlanıyor/;

/**
 * İçerikli uyarı: role=alert ve metni boş değil. APG Alert kalıbında canlı bölge içerikten önce boş durur ki ileti gelince
 * duyurulsun (Alımlar bildirim bölgesi); boş bölge uyarı değildir. Metni görsel olarak gizli uyarı da sayılır (ekran
 * okuyucu duyar); erişilebilirlik ağacından gizlenen (aria-hidden, display:none) sayılmaz (getByRole varsayılanı).
 */
const contentAlerts = (scope: Locator) => scope.getByRole('alert').filter({ hasText: /\S/ });

/** Görünür alanla kesişen (IntersectionObserver anlamında) ve metni kalıba uyan role=status öğelerinin metinleri. */
async function pendingInViewport(page: Page, pattern: RegExp): Promise<string[]> {
  return page.evaluate(({ source, flags, scope }) => {
    const matches = new RegExp(source, flags);
    return Array.from(document.querySelectorAll(`${scope} [role="status"]`))
      .filter(element => matches.test(element.textContent ?? ''))
      .filter(element => {
        const box = element.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && box.top < window.innerHeight && box.bottom > 0 && box.left < window.innerWidth && box.right > 0;
      })
      .map(element => (element.textContent ?? '').trim());
  }, { source: pattern.source, flags: pattern.flags, scope: ADMIN_MAIN });
}

// --- Sayfa izleyicisi ---------------------------------------------------------------------------------------------

/** Sayfanın kendi iptali: Chromium "net::ERR_ABORTED", WebKit "cancelled". Başarısızlık sayılmaz. */
const PAGE_CANCELLED = /^(?:net::ERR_ABORTED|cancelled|Load request cancelled)$/;

interface PageWatch {
  /** İhlaller: konsol hatası, istisna, başarısız istek, ≥400 yanıt, beklenmeyen dış istek. Boş = temiz. */
  problems: string[];
}

/** Sayfa olaylarını ihlal listesine yazar. Yönlendirme veya kurulumdan önce çağrılır. */
function watchPage(page: Page): PageWatch {
  const watch: PageWatch = { problems: [] };
  page.on('console', message => {
    if (message.type() === 'error') watch.problems.push(`konsol hatası: ${message.text().slice(0, 300)}`);
  });
  page.on('pageerror', error => watch.problems.push(`istisna: ${error.message.slice(0, 300)}`));
  page.on('crash', () => watch.problems.push('sayfa çöktü'));
  page.on('requestfailed', request => {
    const reason = request.failure()?.errorText ?? 'bilinmiyor';
    if (PAGE_CANCELLED.test(reason)) return;
    watch.problems.push(`istek başarısız: ${request.method()} ${request.url().slice(0, 200)} (${reason})`);
  });
  page.on('response', response => {
    if (response.status() >= 400) watch.problems.push(`yanıt ${response.status()}: ${response.url().slice(0, 200)}`);
  });
  return watch;
}

const SYNTHETIC_SHEET_ID = 'synthetic-budget-sheet-2098';
const GVIZ_SHEETS = { Pano: 'summary', Plan: 'plan', 'Gerçekleşen': 'actual', Kasa: 'cash', 'Arızi Giderler': 'irregular' } as const;
/** 1×1 saydam PNG: fikstürdeki ayrılmış .invalid görsel adresleri için (gerçek görsel değil). */
const PIXEL_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

/** Sentetik GViz yanıtı (src/dashboard/*Fixtures; gerçek e-tablo değil). Tanınmayan sayfa → undefined. */
function syntheticGviz(url: URL): string | undefined {
  const bridge = syntheticBridgeResponse(url.href);
  if (bridge) return bridge;
  const key = GVIZ_SHEETS[url.searchParams.get('sheet') as keyof typeof GVIZ_SHEETS];
  if (!key) return undefined;
  const raw = syntheticCurrentSheets();
  if (key !== 'irregular') return gviz(raw[key]);
  // GViz headers=0 iken sayısal/tarih sütunlarındaki metin başlıklarını siler (budget-dashboard.spec.ts ile aynı).
  const labels = raw.irregular[0].map(String);
  return url.searchParams.get('headers') === '1'
    ? gviz(raw.irregular.slice(1), labels)
    : gviz([[...labels.slice(0, 3), ...labels.slice(3).map(() => null)], ...raw.irregular.slice(1)]);
}

/**
 * Dış ağı kapatır: sentetik e-tablo kimliğiyle GViz → sentetik yanıt; ayrılmış .invalid alan adındaki görsel → 1×1 PNG;
 * başka her dış istek (sentetik olmayan e-tablo kimliği dahil) kesilir ve ihlal olarak yazılır.
 */
async function isolateNetwork(page: Page, origin: string, watch: PageWatch) {
  const cors = { 'access-control-allow-origin': '*', 'cache-control': 'no-store' };
  await page.route(url => url.origin !== origin && /^https?:$/.test(url.protocol), async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.hostname === 'docs.google.com' && url.pathname === `/spreadsheets/d/${SYNTHETIC_SHEET_ID}/gviz/tq`) {
      const body = syntheticGviz(url);
      if (body !== undefined) return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body });
    }
    if (url.hostname.endsWith('.invalid') && request.resourceType() === 'image') {
      return route.fulfill({ status: 200, contentType: 'image/png', headers: cors, body: PIXEL_PNG });
    }
    watch.problems.push(`dış istek: ${request.method()} ${url.origin}${url.pathname}`);
    return route.abort('blockedbyclient');
  });
}

/** Belge düzeyinde yatay taşma: "<scrollWidth>px > <clientWidth>px"; boş = taşma yok (1 px yuvarlama payı). */
async function documentOverflow(page: Page): Promise<string> {
  return page.evaluate(() => {
    const doc = document.scrollingElement ?? document.documentElement;
    return doc.scrollWidth > doc.clientWidth + 1 ? `${doc.scrollWidth}px > ${doc.clientWidth}px` : '';
  });
}

// --- İzleyici öz denetimi -----------------------------------------------------------------------------------------------

test.describe('izleyici öz-denetimi', () => {
  test('enjekte konsol hatası, istisna, 404, kesilen istek ve dış istek yakalanır; 304, sayfa iptali ve sentetik GViz geçer', async ({ page, baseURL }) => {
    const watch = watchPage(page);
    await isolateNetwork(page, new URL(baseURL!).origin, watch);
    await page.route('**/__f06-oz-denetim/**', async route => {
      const name = new URL(route.request().url()).pathname.split('/').pop();
      if (name === '404') return route.fulfill({ status: 404, contentType: 'text/plain', body: 'yok' });
      if (name === 'kesik') return route.abort('failed');
      if (name === 'bekle') return undefined; // yanıtlanmaz: sayfa isteği kendisi iptal eder
      return route.fulfill({ status: 200, contentType: 'text/plain', body: 'tamam' });
    });
    await page.goto('icon.svg');
    expect(watch.problems, 'temiz başlangıç').toEqual([]);

    // Gerçek 304: Vite sunucusu ETag verir; aynı ETag ile koşullu istek 304 döner (route.fulfill WebKit'te 3xx veremez).
    const revalidated = await page.evaluate(async () => {
      const first = await fetch('/aile/icon.svg', { cache: 'no-store' });
      const etag = first.headers.get('etag');
      if (!etag) return 'etag yok';
      const second = await fetch('/aile/icon.svg', { cache: 'no-store', headers: { 'if-none-match': etag } });
      return String(second.status);
    });
    expect(revalidated, 'öz denetim gerçek bir 304 üretmeli').toBe('304');

    const pageError = page.waitForEvent('pageerror');
    await page.evaluate(async (sheet) => {
      const quiet = (url: string, init?: RequestInit) => fetch(url, init).then(response => response.text(), () => '');
      console.error('öz denetim: enjekte konsol hatası');
      await quiet('/aile/__f06-oz-denetim/404');
      await quiet('/aile/__f06-oz-denetim/kesik');
      await quiet('https://example.org/dis.json');
      await quiet(`https://docs.google.com/spreadsheets/d/${sheet}/gviz/tq?sheet=${encodeURIComponent('_Finans aylık')}&range=A1%3AA7&headers=0&tqx=out%3Ajson`, { credentials: 'omit' });
      setTimeout(() => { throw new Error('öz denetim: enjekte istisna'); });
    }, SYNTHETIC_SHEET_ID);
    await pageError;

    const pending = page.waitForRequest('**/__f06-oz-denetim/bekle');
    const cancelled = page.waitForEvent('requestfailed', request => request.url().endsWith('/__f06-oz-denetim/bekle'));
    await page.evaluate(() => {
      const controller = new AbortController();
      (window as unknown as { f06Iptal?: AbortController }).f06Iptal = controller;
      void fetch('/aile/__f06-oz-denetim/bekle', { signal: controller.signal }).catch(() => undefined);
    });
    await pending;
    await page.evaluate(() => (window as unknown as { f06Iptal: AbortController }).f06Iptal.abort());
    await cancelled;

    const all = () => watch.problems.join('\n');
    await expect.poll(all).toContain('konsol hatası: öz denetim: enjekte konsol hatası');
    await expect.poll(all).toContain('istisna: öz denetim: enjekte istisna');
    await expect.poll(all).toMatch(/yanıt 404: \S+\/__f06-oz-denetim\/404/);
    await expect.poll(all).toMatch(/istek başarısız: GET \S+\/__f06-oz-denetim\/kesik/);
    await expect.poll(all).toContain('dış istek: GET https://example.org/dis.json');
    expect(all(), '304, sayfa iptali ve sentetik GViz ihlal değildir').not.toMatch(/icon\.svg|__f06-oz-denetim\/bekle|gviz/);
  });

  test('bekleyen grafik ölçüsü: görünür alandaki yuvayı yakalar, alanın altındakini ve başka durumu saymaz', async ({ page }) => {
    await page.setContent(`
      <main id="admin-content">
        <h1>Öz denetim</h1>
        <p role="status" data-f06-enjekte>Grafik hazırlanıyor</p>
        <p role="status">Son okuma 14:32 · Nesil a1b2c3</p>
        <div style="height:${4 * 1000}px"></div>
        <p role="status">Grafik hazırlanıyor</p>
      </main>`);
    expect(await pendingInViewport(page, CHART_PENDING), 'yalnız görünür alandaki yuva').toEqual(['Grafik hazırlanıyor']);
    await page.evaluate(() => document.querySelector('[data-f06-enjekte]')?.remove());
    expect(await pendingInViewport(page, CHART_PENDING), 'alanın altındaki yuva sayılmaz').toEqual([]);
    await page.getByRole('status').filter({ hasText: CHART_PENDING }).scrollIntoViewIfNeeded();
    expect(await pendingInViewport(page, CHART_PENDING), 'kaydırılınca yakalanır').toEqual(['Grafik hazırlanıyor']);
  });

  test('içerikli uyarı ölçüsü: boş canlı bölgeyi saymaz; metin gelince (görsel gizli olsa da) sayar', async ({ page }) => {
    await page.setContent(`
      <main id="admin-content">
        <h1>Öz denetim</h1>
        <div role="alert" data-f06-bos></div>
        <div role="alert" data-f06-bosluk>   </div>
        <div role="alert" aria-hidden="true">Hata: gizli ağaç</div>
      </main>`);
    const main = page.locator('main');
    await expect(main.getByRole('alert'), 'ham rol sayımı boş bölgeleri de görür').toHaveCount(2);
    await expect(contentAlerts(main), 'boş ve yalnız boşluklu canlı bölge uyarı değildir').toHaveCount(0);
    await page.evaluate(() => {
      const p = document.createElement('p');
      p.textContent = 'Hata: enjekte uyarı';
      p.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)';
      document.querySelector('[data-f06-bos]')!.append(p);
    });
    await expect(contentAlerts(main), 'metin gelince uyarı sayılır').toHaveCount(1);
  });

  test('belge taşma ölçüsü: görünüm alanından geniş öğeyi yakalar; kaldırılınca temiz', async ({ page }) => {
    await page.setContent('<main><h1>Öz denetim</h1><p>Kısa metin.</p></main>');
    expect(await documentOverflow(page), 'temiz başlangıç').toBe('');
    await page.evaluate(() => {
      const wide = document.createElement('div');
      wide.setAttribute('data-f06-enjekte', '');
      wide.style.cssText = `width:${document.documentElement.clientWidth + 200}px;height:4px`;
      document.body.appendChild(wide);
    });
    expect(await documentOverflow(page), 'enjekte geniş öğe taşma üretmeli').toMatch(/^\d+px > \d+px$/);
    await page.evaluate(() => document.querySelector('[data-f06-enjekte]')?.remove());
    expect(await documentOverflow(page), 'enjeksiyon kaldırılınca yine temiz').toBe('');
  });
});

// --- Rota dumanı ------------------------------------------------------------------------------------------------------

test.describe('duman: 12 rota açılır', () => {
  for (const route of ROUTES) {
    test(`${route.path} açılır: konsol hatası yok, başarısız istek yok, h1 + belge başlığı, yatay taşma yok`, { tag: '@matrix' }, async ({ page, baseURL }) => {
      const watch = watchPage(page);
      await isolateNetwork(page, new URL(baseURL!).origin, watch);

      const main = await openAdmin(page, route.path);
      await expect(main.getByRole('status').filter({ hasText: READING }), 'veri okuması bitmeli').toHaveCount(0, { timeout: 15_000 });
      await expect.poll(() => pendingInViewport(page, CHART_PENDING), { message: 'görünür alandaki grafik çizilmeli', timeout: 15_000 }).toEqual([]);
      const charts = main.getByRole('status').filter({ hasText: CHART_PENDING });
      for (let left = await charts.count(); left > 0; left = await charts.count()) {
        await charts.first().scrollIntoViewIfNeeded();
        await expect.poll(() => charts.count(), { message: 'görünür alana kaydırılan grafik çizilmeli', timeout: 15_000 }).toBeLessThan(left);
      }
      await expect(page.locator('[aria-busy="true"]'), 'iskelet kalmamalı').toHaveCount(0);

      await expect(page.getByRole('heading', { level: 1 })).toHaveText(route.label);
      await expect(page).toHaveTitle(`${route.label} · aile`);
      await expect(page.getByRole('main')).toHaveCount(1);
      await expect(page.locator(ADMIN_MAIN)).toHaveCount(1);
      await expect(contentAlerts(main), 'mutlu yolda içerikli hata uyarısı yok').toHaveCount(0);
      await expect(main.getByText(/^Hata:/), 'mutlu yolda "Hata:" durumu yok').toHaveCount(0);

      expect(await documentOverflow(page), 'belge düzeyinde yatay taşma').toBe('');
      expect(watch.problems, 'konsol hatası / istisna / başarısız istek / ≥400 yanıt').toEqual([]);
    });
  }
});
