import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { ADMIN, ADMIN_MAIN, gotoAdmin, horizontalOverflow, openAdmin } from './admin-helpers';

// Rotalar ve sayfa başlığı — telefon önce (görev b02-header-routes). Tasarım: tasarim-sistemi/README.md › "Sayfa iskeleti
// (sıra sabit)" 1–2 ve "Uyarlanır teslim", components/PageHeader/README.md, bundle.js PageHeader.
//   - Başlık sırası: bölüm adı → h1 (menü etiketi, kelime arasından doğal sarılır) → amaç → eylemler → bağlam (tazelik,
//     özet, sayfa notu). Telefonda bloklar alt alta durur; ikincil eylemler "Diğer" alt sayfasındadır, ana eylem görünür.
//   - Belge başlığı "<etiket> · aile".
//   - Bilinmeyen rota /genel'e geçmişe kayıt eklemeden (replace) yönlenir; /alimlar/:id ayrıntı rotası korunur.
//   - Sayfa parçası indirilemezse kabuk ve başlık ayakta kalır: çevrim içi (sürüm kayması) "Yeni sürüm var · Yenile" sayfayı
//     yeniden yükler; çevrim dışı "Yeniden dene" bağlantı gelince parçayı getirir.
//   - Başka sayfanın parçası ya da geniş (*.wide) parça önceden indirilmez.
// Veri: webServer sentetik nesli /__aile/generation/* altında verir (playwright.admin.config.ts). Yerel sunucu dışındaki her
// istek (Google GViz / Apps Script dahil) kesilir. Görünüm genişliğinden bağımsız testler @matrix etiketlidir; tablet ve
// masaüstü profilinde aynı sözleşme o profile göre denetlenir (profil <html data-profile>'dan okunur).

interface RouteCase { path: string; label: string; section: string; purpose: string }

/** navigation.ts › adminPages + Ayarlar; metinler tasarım bundle.js Aile.Pages ile aynı (e2e uygulama kaynağını içe aktarmaz). */
const ROUTES: readonly RouteCase[] = [
  { path: '/genel', label: 'Genel durum', section: 'Genel', purpose: 'Bu ayın nakdini, yaklaşan ödemeleri ve dikkat isteyen kayıtları tek yerde görün.' },
  { path: '/butce', label: 'Bütçe ve nakit', section: 'Para', purpose: 'Ayın gelirini, planlanan giderlerini ve kalan nakdi kalem kalem izleyin.' },
  { path: '/odemeler', label: 'Ödemeler', section: 'Para', purpose: 'Planlanan, yapılan ve geciken ödemeleri tarihleriyle izleyin.' },
  { path: '/hesaplar', label: 'Hesaplar ve borçlar', section: 'Para', purpose: 'Hesap bakiyelerini ve kalan borçları, taksit planıyla birlikte görün.' },
  { path: '/alimlar', label: 'Alımlar ve eşyalar', section: 'Alım ve envanter', purpose: 'Ev için alınacak ve alınmış her şeyi plan ve gerçek tutarıyla izleyin.' },
  { path: '/ev', label: 'Ev ve odalar', section: 'Ev', purpose: 'Her odanın alımlarını, görevlerini ve plan ile gerçek tutarını oda oda izleyin.' },
  { path: '/projeler', label: 'Projeler ve görevler', section: 'İşler', purpose: 'Ev projelerini ve görevlerini kim, ne zaman ve hangi sırayla yapacak, görün.' },
  { path: '/taraflar', label: 'Taraflar ve teklifler', section: 'İşler', purpose: 'Satıcıları, ustaları ve gelen teklifleri tek yerde karşılaştırın.' },
  { path: '/raporlar', label: 'Raporlar', section: 'Rapor', purpose: 'Hazır raporları açın; her rakamın hangi kayıtlardan geldiğini görün.' },
  { path: '/sozlukler', label: 'Sözlükler ve iş akışları', section: 'Yapı', purpose: 'Kategorileri, odaları, durumları ve durumların hangi sırayla değişeceğini tanımlayın.' },
  { path: '/veri', label: 'Veri kalitesi ve içe aktarma', section: 'Yapı', purpose: 'E-tablodan gelen veriyi içe aktarın, eşleşmeyen satırları ve çakışmaları çözün.' },
  { path: '/ayarlar', label: 'Ayarlar', section: 'Uygulama', purpose: 'Aile bilgilerini, biçimleri, e-tablo bağlantısını ve üyeleri yönetin.' },
];
const route = (routePath: string) => ROUTES.find(item => item.path === routePath)!;

// Sentetik nesilden silinmemiş ilk alım kaydı (kimlik fixture'dan okunur, sabit yazılmaz).
const FIXTURE_ROOT = fileURLToPath(new URL('../fixtures/generation-synthetic/', import.meta.url));
const GENERATION_DIR = path.join(
  FIXTURE_ROOT,
  readdirSync(FIXTURE_ROOT).find(name => /^[a-f0-9]{64}$/.test(name) && statSync(path.join(FIXTURE_ROOT, name)).isDirectory())!,
);
const PURCHASE = (JSON.parse(readFileSync(path.join(GENERATION_DIR, 'data/purchase_needs/household/00000.json'), 'utf8')) as {
  records: { id: string; label: string; deleted_at: string | null }[];
}).records.find(record => !record.deleted_at)!;

type Profile = 'phone' | 'tablet' | 'desktop';

/** Yalnız yerel geliştirme sunucusu: dış adreslere (Google dahil) giden her istek kesilir. */
async function localOnly(page: Page) {
  await page.route(url => url.hostname !== '127.0.0.1', handler => handler.abort());
}

async function profileOf(page: Page): Promise<Profile> {
  const value = await page.evaluate(() => document.documentElement.dataset.profile);
  expect(['phone', 'tablet', 'desktop'], `<html data-profile="${value}">`).toContain(value);
  return value as Profile;
}

function heading(page: Page): Locator {
  return page.locator(ADMIN_MAIN).getByRole('heading', { level: 1 });
}

async function box(locator: Locator, what: string) {
  const rect = await locator.boundingBox();
  expect(rect, `${what} görünür bir kutuya sahip olmalı`).not.toBeNull();
  return rect!;
}

/**
 * h1'in doğal sarılması: her kelime tek satırda kalır (kelime ortasından bölünmez), metin kesilmez, üç nokta ya da
 * nowrap yok, zorlayıcı kırma (break-all / anywhere) yok. Tarayıcıda çalışır; dış kapsam kullanmaz.
 */
function wrapViolations(element: Element): string[] {
  const out: string[] = [];
  const style = getComputedStyle(element);
  if (style.whiteSpace === 'nowrap' || style.whiteSpace === 'pre') out.push(`white-space: ${style.whiteSpace}`);
  if (style.textOverflow === 'ellipsis') out.push('text-overflow: ellipsis');
  if (style.wordBreak === 'break-all') out.push('word-break: break-all');
  if (style.overflowWrap === 'anywhere') out.push('overflow-wrap: anywhere');
  const host = element as HTMLElement;
  if (host.scrollWidth > host.clientWidth + 1) out.push(`kesiliyor: scrollWidth ${host.scrollWidth} > clientWidth ${host.clientWidth}`);
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent ?? '';
    for (const match of text.matchAll(/\S+/g)) {
      const range = document.createRange();
      range.setStart(node, match.index ?? 0);
      range.setEnd(node, (match.index ?? 0) + match[0].length);
      const lines = new Set(Array.from(range.getClientRects()).filter(rect => rect.width > 0).map(rect => Math.round(rect.top)));
      if (lines.size > 1) out.push(`kelime bölündü: "${match[0]}" (${lines.size} satır)`);
    }
  }
  return out;
}

test.describe('sayfa başlığı: telefon önce', () => {
  test.beforeEach(async ({ page }) => {
    await localOnly(page);
  });

  for (const item of ROUTES) {
    test(`${item.path}: bölüm → h1 → amaç → eylemler → bağlam; belge başlığı; h1 doğal sarılır`, { tag: '@matrix' }, async ({ page }) => {
      await openAdmin(page, item.path);
      const profile = await profileOf(page);
      const h1 = heading(page);
      await expect(h1).toHaveCount(1);
      await expect(h1).toHaveText(item.label);
      await expect(page).toHaveTitle(`${item.label} · aile`);

      const header = h1.locator('xpath=ancestor::header[1]');
      const caption = h1.locator('xpath=preceding-sibling::*[1]');
      const purpose = h1.locator('xpath=following-sibling::*[1]');
      await expect(caption).toHaveText(item.section);
      await expect(purpose).toHaveText(item.purpose);
      expect(await h1.evaluate(wrapViolations), 'h1 kelime arasından doğal sarılır').toEqual([]);

      // Sıra (DOM): başlık bloğu → eylemler → bağlam. Bağlam: tazelik satırı, özet ve sayfanın notları tek bölgede.
      const actions = header.locator(':scope > [data-part="actions"]');
      const context = header.locator(':scope > [data-part="context"]');
      const parts = await header.evaluate(element => Array.from(element.children).map(child =>
        child.querySelector('h1') ? 'title' : (child as HTMLElement).dataset.part ?? child.tagName.toLowerCase()));
      expect(parts[0], 'başlık bloğu (bölüm + h1 + amaç) ilk sırada').toBe('title');
      expect(parts.filter(part => part !== 'actions' && part !== 'context' && part !== 'title'), 'başlıkta tanımsız bölge yok').toEqual([]);
      if ((await actions.count()) > 0 && (await context.count()) > 0) expect(parts.indexOf('actions')).toBeLessThan(parts.indexOf('context'));
      if ((await context.count()) > 0) {
        const status = header.getByRole('status');
        if ((await status.count()) > 0) await expect(context.getByRole('status')).toHaveCount(await status.count());
        const summary = header.getByRole('list', { name: 'Özet' });
        if ((await summary.count()) > 0) await expect(context.getByRole('list', { name: 'Özet' })).toHaveCount(1);
      }

      const titleBox = await box(purpose, 'amaç');
      const h1Box = await box(h1, 'h1');
      const captionBox = await box(caption, 'bölüm adı');
      expect(captionBox.y + captionBox.height, 'bölüm adı h1 üstünde').toBeLessThanOrEqual(h1Box.y + 1);
      expect(h1Box.y + h1Box.height, 'amaç h1 altında').toBeLessThanOrEqual(titleBox.y + 1);

      if ((await actions.count()) > 0) {
        const actionsBox = await box(actions, 'eylemler');
        const controls = actions.locator('button:visible, a:visible');
        const names = (await controls.allInnerTexts()).map(text => text.trim());
        if (profile === 'desktop') {
          // Masaüstü: eylemler başlık bloğunun sağında, ikincil eylemler düğme olarak görünür; "Diğer" yok.
          expect(actionsBox.x, 'masaüstünde eylemler sağda').toBeGreaterThanOrEqual(h1Box.x + h1Box.width - 1);
          expect(names, 'masaüstünde ikincil eylemler açık düğmedir').not.toContain('Diğer');
        } else {
          // Telefon ve tablet: tek sütun, eylemler amaç cümlesinin altında.
          expect(actionsBox.y, 'eylemler amaç altında').toBeGreaterThanOrEqual(titleBox.y + titleBox.height - 1);
          if (profile === 'phone') {
            const primaries = names.filter(name => name !== 'Diğer');
            expect(primaries.length, `telefonda başlıkta tek ana eylem (+ "Diğer"): ${names.join(' | ')}`).toBeLessThanOrEqual(1);
            if (names.includes('Diğer')) expect(names.at(-1), '"Diğer" ana eylemden sonra').toBe('Diğer');
          } else {
            expect(names, 'tablette ikincil eylemler açık düğmedir').not.toContain('Diğer');
          }
        }
        if ((await context.count()) > 0 && profile !== 'desktop') {
          const contextBox = await box(context, 'bağlam');
          expect(contextBox.y, 'bağlam eylemlerin altında').toBeGreaterThanOrEqual(actionsBox.y + actionsBox.height - 1);
        }
      }
      expect(await horizontalOverflow(page), 'sayfa düzeyinde yatay taşma').toEqual([]);
    });
  }

  /** Telefon başlığı: eylemler bölgesi ve "Diğer" düğmesi (/hesaplar: ana eylem + bir ikincil eylem). */
  async function phoneActions(page: Page) {
    await openAdmin(page, '/hesaplar');
    const phone = (await profileOf(page)) === 'phone';
    const actions = heading(page).locator('xpath=ancestor::header[1]').locator(':scope > [data-part="actions"]');
    return { phone, actions, more: actions.getByRole('button', { name: 'Diğer', exact: true }) };
  }

  test('telefon: ana eylem görünür, ikincil eylemler "Diğer" alt sayfasında; klavyeyle Escape odağı geri verir', { tag: '@matrix' }, async ({ page }) => {
    const { phone, actions, more } = await phoneActions(page);
    test.skip(!phone, 'yalnız telefon profili');
    await expect(more).toBeVisible();
    const primary = actions.locator('button:visible').first();
    await expect(primary).not.toHaveText('Diğer');
    await expect(primary).toBeInViewport();
    await expect(more).toBeInViewport();

    // Dokunma: alt sayfa ekranın altına oturur, ikincil eylemler menü öğesidir.
    await more.click();
    const sheet = page.getByRole('dialog', { name: 'Diğer eylemler' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('menuitem').first()).toBeVisible();
    const sheetBox = await box(sheet, 'alt sayfa');
    expect(sheetBox.y + sheetBox.height, 'alt sayfa ekranın altına oturur').toBeGreaterThanOrEqual(page.viewportSize()!.height - 2);
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();

    // Klavye: Enter açar, Escape kapatır ve odak "Diğer"e döner.
    await more.focus();
    await page.keyboard.press('Enter');
    await expect(sheet).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(more).toBeFocused();
  });

  test('telefon: dokunmayla açılan "Diğer" alt sayfası kapanınca odak "Diğer" düğmesine döner', { tag: '@matrix' }, async ({ page }) => {
    // WebKit dokunma/tıklamada düğmeye odak vermez; dönüş hedefi açan öğe (tetikleyici) olmalıdır, o anki odak değil.
    const { phone, more } = await phoneActions(page);
    test.skip(!phone, 'yalnız telefon profili');
    await more.click();
    const sheet = page.getByRole('dialog', { name: 'Diğer eylemler' });
    await expect(sheet).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(more).toBeFocused();
  });
});

test.describe('rotalar', () => {
  test.beforeEach(async ({ page }) => {
    await localOnly(page);
  });

  test('bilinmeyen rota ve boş hash Genel durum\'a yönlenir; yönlendirme geçmişe kayıt eklemez', { tag: '@matrix' }, async ({ page }) => {
    const genel = route('/genel');
    await openAdmin(page, '/boyle-bir-sayfa-yok');
    await expect(page).toHaveURL(/\/admin\.html#\/genel$/);
    await expect(heading(page)).toHaveText(genel.label);
    await expect(page).toHaveTitle(`${genel.label} · aile`);

    await page.goto('about:blank');
    await page.goto(ADMIN.replace(/#$/, ''));
    await expect(page).toHaveURL(/\/admin\.html#\/genel$/);
    await expect(heading(page)).toHaveText(genel.label);

    // Uygulama içinden bilinmeyen yola gidiş: tek yeni kayıt (gidiş), yönlendirme onu değiştirir (replace).
    const before = await page.evaluate(() => history.length);
    await page.evaluate(() => { window.location.hash = '/eski-sayfa'; });
    await expect(page).toHaveURL(/\/admin\.html#\/genel$/);
    await expect(heading(page)).toHaveText(genel.label);
    expect(await page.evaluate(() => history.length), 'yönlendirme yeni geçmiş kaydı açmaz').toBe(before + 1);
  });

  test('/alimlar/:id ayrıntı rotası korunur ve Alımlar sayfasında açılır', { tag: '@matrix' }, async ({ page }) => {
    const alimlar = route('/alimlar');
    await gotoAdmin(page, `/alimlar/${PURCHASE.id}`);
    // Ayrıntı açılır (telefonda tam sayfa, geniş ekranda yan panel); rota yönlendirilmez.
    await expect(page.locator(ADMIN_MAIN).getByRole('heading', { name: PURCHASE.label, exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(new RegExp(`/admin\\.html#/alimlar/${PURCHASE.id}(?:\\?.*)?$`));
    await expect(page).toHaveTitle(`${alimlar.label} · aile`);
    // Sayfanın tek h1'i Alımlar'ındır (telefonda ayrıntı açıkken liste ve başlığı gizli olabilir).
    const h1 = page.locator(ADMIN_MAIN).getByRole('heading', { level: 1, includeHidden: true });
    await expect(h1).toHaveCount(1);
    await expect(h1).toHaveText(alimlar.label);
  });

  /** Kabuk ayakta: sayfalar arası gezinme hâlâ kullanılabilir (masaüstünde yan menü, dar ekranda "Sayfalar"). */
  async function expectShellUsable(page: Page) {
    if ((await profileOf(page)) === 'desktop') {
      await expect(page.getByRole('complementary').getByRole('link', { name: route('/genel').label })).toBeVisible();
    } else {
      await expect(page.getByRole('button', { name: 'Sayfalar', exact: true })).toBeVisible();
    }
  }

  /** Başlık sınırda korunur: tek h1 (menü etiketi), amaç, belge başlığı; iskelet kalmaz. */
  async function expectHeaderKept(page: Page, item: RouteCase) {
    await expect(heading(page)).toHaveCount(1);
    await expect(heading(page)).toHaveText(item.label);
    await expect(heading(page).locator('xpath=following-sibling::*[1]')).toHaveText(item.purpose);
    await expect(page).toHaveTitle(`${item.label} · aile`);
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  }

  /** VeriPage parçasına giden istekleri sayar; ilk `blocked` istek ağ hatasıyla kesilir. */
  async function blockVeriChunk(page: Page, blocked: number) {
    const counter = { requests: 0 };
    await page.route(/\/src\/admin\/pages\/VeriPage\.tsx(?:\?.*)?$/, async handler => {
      counter.requests += 1;
      if (blocked > 0) {
        blocked -= 1;
        await handler.abort('failed');
        return;
      }
      await handler.continue();
    });
    return counter;
  }

  test('sayfa parçası indirilemezse (sürüm kayması) kabuk ve başlık kalır; "Yeni sürüm var · Yenile" sayfayı yeniden yükler', { tag: '@matrix' }, async ({ page }) => {
    const veri = route('/veri');
    // İlk deneme ve otomatik tek yeniden deneme kesilir; "Yenile" ile açılan yeni belgede parça gelir.
    const chunk = await blockVeriChunk(page, 2);
    await gotoAdmin(page, veri.path);
    const main = page.locator(ADMIN_MAIN);
    const notice = main.getByRole('status').filter({ hasText: 'Yeni sürüm var' });
    await expect(notice).toBeVisible({ timeout: 15_000 });
    await expectHeaderKept(page, veri);
    await expect(main.getByRole('alert')).toHaveCount(0);
    expect(chunk.requests, 'ilk deneme + bir otomatik yeniden deneme').toBe(2);
    await expectShellUsable(page);

    const reload = notice.getByRole('button', { name: 'Yenile', exact: true });
    await expect(reload).toBeVisible();
    const box = await reload.boundingBox();
    expect(box!.height, 'Yenile dokunma hedefi').toBeGreaterThanOrEqual(44);
    await Promise.all([page.waitForEvent('load'), reload.click()]);
    await expect(heading(page)).toHaveText(veri.label, { timeout: 15_000 });
    await expect(notice).toHaveCount(0);
    // Gerçek sayfa geldi: başlığında tazelik satırı (DataStatus) var; sınır başlığında yok.
    await expect(heading(page).locator('xpath=ancestor::header[1]').getByRole('status')).toHaveCount(1, { timeout: 15_000 });
    expect(chunk.requests, 'yenileme parçayı yeniden indirir').toBe(3);
  });

  test('çevrim dışıyken sayfa parçası gelmezse "Yeniden dene" bağlantı gelince sayfayı getirir', { tag: '@matrix' }, async ({ page, context }) => {
    const veri = route('/veri');
    await openAdmin(page, '/genel');
    // Bağlantı, açık sayfa tamamen yüklendikten sonra kesilir: openAdmin'in hazır sinyali geniş profilde geç gelen
    // parçaları (GenelPage.wide ve bağımlılıkları) beklemez. WebKit başarısız modül isteğini modül haritasında tutar;
    // çevrim dışıyken yarıda kalan ortak bir modül (ör. ui/Tag) /veri parçasının da bağımlılığıysa bağlantı gelince
    // yeniden deneme de düşer (yalnız tam yenileme düzeltir). Bu test yalnız /veri parçasının kesilmesini sınar.
    await page.waitForLoadState('networkidle');
    await context.setOffline(true);
    await page.evaluate(() => { window.location.hash = '/veri'; });
    const main = page.locator(ADMIN_MAIN);
    const alert = main.getByRole('alert');
    await expect(alert).toBeVisible({ timeout: 15_000 });
    await expect(alert).toContainText('Hata: Sayfa yüklenemedi');
    await expect(alert).toContainText('bağlantı yok');
    await expect(main.getByRole('status').filter({ hasText: 'Yeni sürüm var' })).toHaveCount(0);
    await expectHeaderKept(page, veri);
    await expectShellUsable(page);

    await context.setOffline(false);
    const retry = alert.getByRole('button', { name: 'Yeniden dene' });
    await retry.click();
    await expect(alert).toHaveCount(0, { timeout: 15_000 });
    await expect(heading(page)).toHaveText(veri.label);
    await expect(heading(page).locator('xpath=ancestor::header[1]').getByRole('status')).toHaveCount(1, { timeout: 15_000 });
    await expect(main).toBeFocused();
  });

  test('başka sayfanın parçası ya da geniş parça önceden indirilmez', { tag: '@matrix' }, async ({ page }) => {
    const requested: string[] = [];
    page.on('request', request => {
      const { pathname } = new URL(request.url());
      if (pathname.includes('/src/')) requested.push(pathname);
    });
    await openAdmin(page, '/genel');
    await page.waitForLoadState('networkidle');
    const profile = await profileOf(page);
    const pageModules = () => [...new Set(requested.map(name => /\/src\/admin\/pages\/(\w+Page)(?:\.wide)?\.tsx$/.exec(name)?.[1]).filter(Boolean))];
    expect(pageModules(), 'yalnız açık sayfanın parçası').toEqual(['GenelPage']);
    if (profile === 'phone') {
      expect(requested.filter(name => /\.wide(?:\.[cm]?[jt]sx?)?$|\/wide\//.test(name)), 'telefon geniş parça indirmez').toEqual([]);
    }

    // Menüden başka sayfaya geçiş yalnız o sayfanın parçasını getirir.
    const butce = route('/butce');
    if (profile === 'desktop') {
      await page.getByRole('complementary').getByRole('link', { name: butce.label }).click();
    } else {
      await page.getByRole('button', { name: 'Sayfalar', exact: true }).click();
      await page.getByRole('dialog', { name: 'Sayfalar' }).getByRole('link', { name: butce.label }).click();
    }
    await expect(heading(page)).toHaveText(butce.label);
    await page.waitForLoadState('networkidle');
    expect(pageModules().sort(), 'yalnız ziyaret edilen sayfalar').toEqual(['ButcePage', 'GenelPage']);
    if (profile === 'phone') {
      expect(requested.filter(name => /\.wide(?:\.[cm]?[jt]sx?)?$|\/wide\//.test(name)), 'telefon geniş parça indirmez').toEqual([]);
    }
  });
});
