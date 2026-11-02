import type { Locator, Page } from '@playwright/test';

export const ADMIN = 'admin.html#';
/** Kabuğun tek ana landmark'ı (WorkspaceShell). */
export const ADMIN_MAIN = 'main#admin-content';

/** Yönetim giriş noktasını hash rotasıyla açar ve ana landmark'ı bekler (yükleme durumu dahil; veri beklenmez). */
export async function gotoAdmin(page: Page, hash = '/alimlar') {
  await page.goto(ADMIN + hash);
  await page.getByRole('main').waitFor();
}

/**
 * Yönetim sayfasının hazır olmadığı gerekçeler; boş liste = hazır. Sayfa bağlamında da çalışır (openAdmin bu fonksiyonun
 * kaynak metnini tarayıcıya gönderir), bu yüzden dış kapsamdan hiçbir şey kullanmaz. Hazır = main#admin-content görünür,
 * main içinde görünür ve dolu bir h1 var, belgede aria-busy="true" taşıyan öğe (LoadingShell iskeleti) kalmadı.
 */
export function adminNotReadyReasons(): string[] {
  const visible = (element: Element): boolean => {
    const probe = element as Element & { checkVisibility?: (options?: Record<string, boolean>) => boolean };
    return typeof probe.checkVisibility === 'function'
      ? probe.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
      : element.getClientRects().length > 0;
  };
  const reasons: string[] = [];
  const main = document.querySelector('main#admin-content');
  if (!main) reasons.push('main#admin-content yok');
  else if (!visible(main)) reasons.push('main#admin-content görünür değil');
  const heading = main ? main.querySelector('h1, [role="heading"][aria-level="1"]') : null;
  if (main && !heading) reasons.push('main içinde h1 yok');
  else if (heading && !visible(heading)) reasons.push('main h1 görünür değil');
  else if (heading && !(heading.textContent ?? '').trim()) reasons.push('main h1 boş');
  const busy = document.querySelectorAll('[aria-busy="true"]').length;
  if (busy > 0) reasons.push(`${busy} öğe aria-busy="true"`);
  return reasons;
}

export interface OpenAdminOptions {
  /** Hazır sinyali için üst sınır (ms). Sabit bekleme değildir; sinyal gelince hemen döner. */
  timeout?: number;
}

const READY_TIMEOUT_MS = 20_000;
let readyProbe = 0;

/**
 * admin.html'i verilen hash rotasında TAM yükleme ile açar ve gerçek hazır sinyalini bekler: main görünür, main içinde
 * görünür h1, aria-busy kalmadı; koşul iki ardışık animasyon karesinde sağlanmalı (React efekti arasındaki ara kare
 * yanıltmaz). Sabit bekleme yoktur. Sayfa zaten admin.html'de ise önce about:blank'e gider: yalnız hash değişimi eski
 * sayfanın h1'ini "hazır" sanabilirdi. Süre dolarsa rota ve eksik sinyallerle hata verir. Döner: main landmark.
 * Yükleme/hata durumlarını gözlemleyen testler bunun yerine gotoAdmin kullanır.
 */
export async function openAdmin(page: Page, route = '/alimlar', options: OpenAdminOptions = {}): Promise<Locator> {
  const hash = route.startsWith('/') ? route : `/${route}`;
  if (/\/admin\.html(?:[?#]|$)/.test(page.url())) await page.goto('about:blank');
  await page.goto(ADMIN + hash);
  const key = `__aileAdminReady${++readyProbe}_${Date.now().toString(36)}`;
  const expression = `(() => { const w = window; const reasons = (${adminNotReadyReasons.toString()})(); `
    + `w[${JSON.stringify(key)}] = reasons.length ? 0 : (w[${JSON.stringify(key)}] || 0) + 1; return w[${JSON.stringify(key)}] >= 2; })()`;
  const timeout = options.timeout ?? READY_TIMEOUT_MS;
  try {
    await page.waitForFunction(expression, undefined, { timeout, polling: 'raf' });
  } catch (error) {
    const reasons = await page.evaluate(`(${adminNotReadyReasons.toString()})()`).catch(() => ['durum okunamadı']);
    throw new Error(`openAdmin('${hash}'): ${timeout} ms içinde hazır olmadı — ${(reasons as string[]).join('; ') || 'kararsız'} (${(error as Error).message})`);
  }
  return page.locator(ADMIN_MAIN);
}

export const tabKey = (browserName: string) => (browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
export const shiftTabKey = (browserName: string) => (browserName === 'webkit' ? 'Alt+Shift+Tab' : 'Shift+Tab');

export { horizontalOverflow } from './helpers';

/** Klavye modunu açar (installKeyboardMode: Tab → html[data-keyboard='true']). */
export async function enterKeyboardMode(page: Page, browserName: string) {
  await page.keyboard.press(tabKey(browserName));
  await page.waitForFunction(() => document.documentElement.dataset.keyboard === 'true');
}
