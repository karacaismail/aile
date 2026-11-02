import { test, expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { enterKeyboardMode, openAdmin, shiftTabKey, tabKey } from './admin-helpers';
import { accentEdges, focusRing, motion, overflow, selfCheckDetectors, smallText } from './admin-detectors';

// Telefon katmanları kapısı (f08): alt sayfa (BottomSheet), seçim listesi (Select), Diğer eylemler menüsü (OverflowActions)
// ve telefonda alt sayfa olarak açılan diyalog (Dialog). Tasarım: tasarim-sistemi/components/BottomSheet, Select,
// OverflowActions, Dialog README + bundle.js useModal; W0 uyarlamalı teslim sözleşmesi (telefon profili alt sayfa kullanır).
//
// Kapsam (her yüzey için, telefon profilinde):
//  - Dokunmayla açma/kapama: tetiğe dokunma açar; görünür "Kapat" ve örtüye dokunma kapatır; odak tetiğe döner, işaretçi
//    modunda gösterge görünmez.
//  - Klavye: Enter açar, odak alt sayfaya girer; Tab/Shift+Tab alt sayfada döner (tarayıcı arayüzüne ya da arka plana
//    kaçmaz, tüm duraklara ulaşır); Escape kapatır ve odak tetiğe döner, klavye modu ve göstergesi korunur.
//  - Oklar/Home/End, Enter/Space: listbox (APG; dolaşan tabindex seçili seçenekte) ve menü (menuitem'de kalır).
//  - İç içe katman: diyalog içindeki seçim alt sayfasında Escape yalnız üstteki katmanı kapatır; alttaki katman inert.
//  - Arka plan inert: alt sayfa açıkken arka plandaki öğe odak alamaz (inert ya da showModal), dokunma arkaya geçmez.
//  - Sürüklemeyle kapatma (Pointer Events): uzun aşağı sürükleme kapatır ve sayfa parmağı izler; kısa sürükleme ve
//    pointercancel kapatmaz, sayfa yerine oturur.
//  - Sanal klavye: visualViewport yüksekliği küçültülür ve 'resize' gönderilir (iOS Safari düzen viewport'unu
//    küçültmez); odaklı alan ve eylemler görünür alanda kalmalı.
//  - Kural dedektörleri (e2e/admin-detectors.ts) alt sayfa katmanında; dokunma hedefi 44 px, coarse girişte 48 px.
//  - Azaltılmış hareket: açılış ve kapanışta katmanda çalışan geçiş/animasyon yok (olay + kare kaydedici), durum anında.
//
// Seçiciler rol/erişilebilir ad (combobox "Dönem", button "Diğer"/"Terim ekle"/"Kapat", dialog, listbox, option, menu,
// menuitem); antd iç sınıflarına bağlanılmaz. Yalnız test anında eklenen data-f08-* işaretleri kullanılır.
//
// Girdi benzetimi ve sınırları (emülasyon gerçek cihaz değildir):
//  - chromium (hasTouch): dokunma CDP Input.dispatchTouchEvent ile gerçek touch pointer'ı üretir (touchCancel →
//    pointercancel). Tarayıcı kaydırma jesti başlatırsa kendi pointercancel'ını da verir; bu gerçek cihaz davranışıdır.
//  - webkit (hasTouch): Playwright WebKit'te dokunma hareketi yok (yalnız tap). Sürükleme gerçek fare pointer'ıyla
//    (pointerType "mouse") yapılır; ortak Pointer Events mantığı her işaretçi türünde çalışmalıdır. İptal, sürüklemeyi
//    başlatan pointerdown'ın hedefine aynı pointerId ile pointercancel gönderilerek benzetilir; ardından imleç başlangıca
//    döner ve bırakılır (iptal sonrası hareket ve bırakma sürükleme sayılmamalı).
//  - Sanal klavye: gerçek klavye açılmaz; yalnız visualViewport.height ve olayları benzetilir.
// Her yoklamanın kör olmadığı en alttaki öz denetim testlerinde bilinçli ihlal enjekte edilerek kanıtlanır.
// Veri: yalnız sentetik nesil (webServer env). Yerel olmayan her istek durdurulur (Google'a ağ çağrısı yok). Sabit bekleme
// yok: hazır sinyali openAdmin, durumlar expect/poll ve rAF yoklamasıyla beklenir.

const MATRIX = { tag: '@matrix' } as const;
const KAPAT = 'Kapat';
/** Benzetilen sanal klavye yüksekliği / pencere yüksekliği (iPhone SE dikeyde ~0,46, 390×844'te ~0,40). */
const KLAVYE_ORANI = 0.45;
const DOKUNMA_ASGARI = 44;
const DOKUNMA_COARSE = 48;
/** Tasarım README: alt sayfa en çok ekranın %85'i. */
const AZAMI_ORAN = 0.85;

const softly = expect.configure({ soft: true });

interface Surface {
  key: 'secim' | 'menu' | 'diyalog';
  /** Test başlığında görünen ad. */
  ad: string;
  route: string;
  /** Alt sayfanın h2 başlığı ve erişilebilir adı. */
  title: string;
  trigger(page: Page): Locator;
  /** Tetik aria-expanded taşır (combobox, menü düğmesi). */
  expanded: boolean;
  /** Örtüye dokunma kapatır (referans BottomSheet scrim onClick); form diyaloğu burada denenmez. */
  scrimCloses: boolean;
}

const SECIM: Surface = {
  key: 'secim', ad: 'Seçim listesi (Bütçe › Dönem)', route: '/butce', title: 'Dönem',
  trigger: page => page.getByRole('combobox', { name: 'Dönem', exact: true }), expanded: true, scrimCloses: true,
};
const MENU: Surface = {
  key: 'menu', ad: 'Diğer eylemler (Hesaplar)', route: '/hesaplar', title: 'Diğer eylemler',
  trigger: page => page.getByRole('button', { name: 'Diğer', exact: true }), expanded: true, scrimCloses: true,
};
const DIYALOG: Surface = {
  key: 'diyalog', ad: 'Diyalog (Sözlükler › Terim ekle)', route: '/sozlukler', title: 'Terim ekle',
  trigger: page => page.getByRole('main').getByRole('button', { name: 'Terim ekle', exact: true }), expanded: false, scrimCloses: false,
};
const SURFACES = [SECIM, MENU, DIYALOG] as const;

const sheetOf = (page: Page, title: string) => page.getByRole('dialog', { name: title, exact: true });
const headingOf = (sheet: Locator, title: string) => sheet.getByRole('heading', { level: 2, name: title, exact: true });

// --- Ağ: yalnız yerel sunucu ------------------------------------------------------------------------------------------

test.beforeEach(async ({ context }) => {
  await context.route(url => url.hostname !== '127.0.0.1' && url.hostname !== 'localhost', route => route.abort('blockedbyclient'));
});

// --- Açma ve durum yardımcıları ----------------------------------------------------------------------------------------

/** Yönetimi açar; telefon profili değilse test uygulanamaz (alt sayfa yalnız telefonda; geniş sunum a03/a04/a06 kapsamı). */
async function openPhone(page: Page, route: string) {
  await openAdmin(page, route);
  const profile = await page.locator('html').getAttribute('data-profile');
  test.skip(profile !== 'phone', `alt sayfa yalnız telefon profilinde; bu projede profil "${profile}"`);
}

/** Alt sayfa açılış/kapanış hareketi bitti ve konumu iki ardışık karede aynı (sabit bekleme yok, rAF yoklaması). */
async function settle(sheet: Locator) {
  const handle = await sheet.elementHandle();
  await sheet.page().waitForFunction((dialog) => {
    const probe = dialog as Element & { __f08Top?: number; __f08Same?: number };
    // Katman: içerikten ayrı portal ise örtü dahil en üst ata; main içinde yerinde çiziliyorsa (ör. <dialog>) kendisi.
    const main = document.querySelector('main#admin-content');
    let layer: Element = dialog;
    if (!(main && main.contains(dialog))) {
      while (layer.parentElement && layer.parentElement !== document.body && !(main && layer.parentElement.contains(main))) layer = layer.parentElement;
    }
    const running = document.getAnimations().some((a) => {
      const target = (a.effect as KeyframeEffect | null)?.target;
      return a.playState === 'running' && target instanceof Element && layer.contains(target);
    });
    const top = dialog.getBoundingClientRect().top;
    probe.__f08Same = !running && probe.__f08Top === top ? (probe.__f08Same ?? 0) + 1 : 0;
    probe.__f08Top = top;
    return probe.__f08Same >= 2;
  }, handle, { polling: 'raf', timeout: 5_000 });
  await handle.dispose();
}

async function openByTap(page: Page, s: Surface): Promise<Locator> {
  const trigger = s.trigger(page);
  await expect(trigger).toBeEnabled();
  await trigger.tap();
  const sheet = sheetOf(page, s.title);
  await expect(sheet, `${s.title}: dokunma alt sayfayı açmadı`).toBeVisible();
  await settle(sheet);
  return sheet;
}

async function openByKeyboard(page: Page, browserName: string, s: Surface): Promise<Locator> {
  const trigger = s.trigger(page);
  await expect(trigger).toBeEnabled();
  await enterKeyboardMode(page, browserName);
  await trigger.focus();
  await page.keyboard.press('Enter');
  const sheet = sheetOf(page, s.title);
  await expect(sheet, `${s.title}: Enter alt sayfayı açmadı`).toBeVisible();
  await expect.poll(() => focusWhere(sheet), { message: `${s.title}: açılınca odak alt sayfaya girmeli` }).not.toMatch(/^dışarıda/);
  return sheet;
}

/** Odak nerede: işaretli durak indeksi, içeride işaretsiz öğe ("içeride: …") ya da dışarıda ("dışarıda: …"). */
async function focusWhere(sheet: Locator): Promise<string> {
  return sheet.evaluate((dialog) => {
    const describe = (el: Element) => {
      const name = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 32);
      return `${el.tagName.toLowerCase()}${el.getAttribute('role') ? `[role=${el.getAttribute('role')}]` : ''}${name ? ` "${name}"` : ''}`;
    };
    const active = document.activeElement;
    if (!active || active === document.body || active === document.documentElement) return 'dışarıda: body (odak belgeden çıktı)';
    if (!dialog.contains(active)) return `dışarıda: ${describe(active)}`;
    return active.getAttribute('data-f08-durak') ?? `içeride: ${describe(active)}`;
  });
}

/** Alt sayfadaki sekme duraklarını (görünür, tabIndex ≥ 0, devre dışı ve inert olmayan) sırayla işaretler; adları döner. */
async function markStops(sheet: Locator): Promise<string[]> {
  return sheet.evaluate((dialog) => {
    const SELECTOR = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [tabindex], [contenteditable="true"]';
    const visible = (el: HTMLElement) => {
      const probe = el as HTMLElement & { checkVisibility?: (o?: Record<string, boolean>) => boolean };
      if (el.getClientRects().length === 0) return false;
      return typeof probe.checkVisibility === 'function' ? probe.checkVisibility({ checkVisibilityCSS: true }) : getComputedStyle(el).visibility !== 'hidden';
    };
    const stops = Array.from(dialog.querySelectorAll<HTMLElement>(SELECTOR)).filter(el =>
      el.tabIndex >= 0 && !(el as HTMLButtonElement).disabled && !el.closest('[inert]') && visible(el));
    dialog.querySelectorAll('[data-f08-durak]').forEach(el => el.removeAttribute('data-f08-durak'));
    return stops.map((el, index) => {
      el.setAttribute('data-f08-durak', String(index));
      const name = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 32);
      return `${index}:${el.tagName.toLowerCase()}${el.getAttribute('role') ? `[role=${el.getAttribute('role')}]` : ''}${name ? ` "${name}"` : ''}`;
    });
  });
}

async function walkFocus(page: Page, sheet: Locator, key: string, presses: number, onEach?: () => Promise<void>): Promise<string[]> {
  const seen: string[] = [];
  for (let i = 0; i < presses; i++) {
    await page.keyboard.press(key);
    const where = await focusWhere(sheet);
    seen.push(where);
    if (onEach && !where.startsWith('dışarıda')) await onEach();
  }
  return seen;
}

const unvisited = (stops: readonly string[], seen: readonly string[]) => stops.filter((_, index) => !seen.includes(String(index)));

/** Odaklı öğe alt sayfada verilen rolde mi; değilse en çok `limit` Tab ile oraya gider. Döner: öğenin etiketi. */
async function tabToRole(page: Page, browserName: string, sheet: Locator, role: 'option' | 'menuitem', limit = 8): Promise<string> {
  const path: string[] = [];
  for (let i = 0; i <= limit; i++) {
    const current = await focusedRole(sheet);
    if (current.inside && current.role === role) return current.label;
    path.push(current.inside ? `${current.role ?? current.tag} "${current.label}"` : 'dışarıda');
    if (i < limit) await page.keyboard.press(tabKey(browserName));
  }
  throw new Error(`${limit} Tab içinde role=${role} öğeye ulaşılamadı: ${path.join(' → ')}`);
}

interface FocusedRole { inside: boolean; role: string | null; tag: string; label: string; selected: string | null }
async function focusedRole(sheet: Locator): Promise<FocusedRole> {
  return sheet.evaluate((dialog) => {
    const active = document.activeElement;
    if (!active || !dialog.contains(active)) return { inside: false, role: null, tag: active?.tagName.toLowerCase() ?? '', label: '', selected: null };
    const byIds = (active.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean)
      .map(id => document.getElementById(id)?.textContent ?? '').join(' ');
    const label = (active.getAttribute('aria-label') || byIds || active.textContent || '').replace(/\s+/g, ' ').trim();
    return { inside: true, role: active.getAttribute('role'), tag: active.tagName.toLowerCase(), label, selected: active.getAttribute('aria-selected') };
  });
}

/** Listbox seçenek etiketleri (DOM sırası) ve aria-selected="true" olanlar. */
async function listOptions(sheet: Locator): Promise<{ labels: string[]; selected: string[] }> {
  return sheet.evaluate((dialog) => {
    const label = (el: Element) => {
      const byIds = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean)
        .map(id => document.getElementById(id)?.textContent ?? '').join(' ');
      return (el.getAttribute('aria-label') || byIds || el.textContent || '').replace(/\s+/g, ' ').trim();
    };
    const options = Array.from(dialog.querySelectorAll('[role="option"]'));
    return { labels: options.map(label), selected: options.filter(o => o.getAttribute('aria-selected') === 'true').map(label) };
  });
}

// --- Arka plan inert yoklamaları ---------------------------------------------------------------------------------------

/**
 * Alt sayfa dışındaki odaklanabilir öğeler (main dahil) programatik odak alabiliyor mu? inert (ya da showModal) arka
 * planda focus olayı hiç oluşmaz; yalnız odak tuzağı olan uygulamada olay oluşur ve tuzak odağı geri çeker. Döner:
 * odak alabilen arka plan öğeleri.
 */
async function backgroundFocusLeaks(sheet: Locator): Promise<string[]> {
  return sheet.evaluate((dialog) => {
    const describe = (el: Element) => {
      const name = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 32);
      return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${name ? ` "${name}"` : ''}`;
    };
    // Alt sayfanın kendi katmanı: portal ise uygulama içeriğini içermeyen en üst ata (markLayer ile aynı kural).
    const main = document.querySelector('main#admin-content');
    let layer: Element = dialog;
    if (!(main && main.contains(dialog))) {
      while (layer.parentElement && layer.parentElement !== document.body && !(main && layer.parentElement.contains(main))) layer = layer.parentElement;
    }
    // Katmanın kendi parçaları (dialog'un ataları, dialog dışındaki odak nöbetçileri) arka plan sayılmaz; başka bir
    // diyaloğun içindeki öğe (iç içe katmanda alttaki diyalog) her zaman arka plandır.
    const ownLayerPart = (el: Element) => layer !== dialog && layer.contains(el) && !el.closest('[role="dialog"], dialog, [role="alertdialog"]');
    const candidates = Array.from(document.querySelectorAll<HTMLElement>('a[href], button, input:not([type=hidden]), select, textarea, summary, [tabindex], main'))
      .filter(el => !dialog.contains(el) && !el.contains(dialog) && !ownLayerPart(el) && el.getClientRects().length > 0 && !(el as HTMLButtonElement).disabled);
    const leaks: string[] = [];
    for (const el of candidates.slice(0, 60)) {
      let received = false;
      const onFocus = () => { received = true; };
      el.addEventListener('focus', onFocus, true);
      el.focus({ preventScroll: true });
      el.removeEventListener('focus', onFocus, true);
      if (received || document.activeElement === el) leaks.push(describe(el));
    }
    return leaks;
  });
}

interface ScrimProbe { x: number; y: number; hit: string; background: boolean }
/** Alt sayfanın üstündeki örtü payında bir nokta ve oraya dokunulursa vurulacak öğe; yer yoksa null. */
async function scrimProbe(sheet: Locator): Promise<ScrimProbe | null> {
  return sheet.evaluate((dialog) => {
    const heading = dialog.querySelector('h2');
    const rect = dialog.getBoundingClientRect();
    const top = heading ? Math.max(rect.top, heading.getBoundingClientRect().top - 32) : rect.top;
    if (top < 24) return null;
    const x = Math.round(window.innerWidth / 2);
    const y = Math.round(top / 2);
    const hit = document.elementFromPoint(x, y);
    if (!hit) return { x, y, hit: 'yok', background: false };
    const name = (hit.getAttribute('aria-label') || hit.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 32);
    const label = `${hit.tagName.toLowerCase()}${typeof hit.className === 'string' && hit.className ? `.${hit.className.trim().split(/\s+/)[0]}` : ''}${name ? ` "${name}"` : ''}`;
    const background = !dialog.contains(hit)
      && !!hit.closest('main, header, nav, [role="banner"], [role="navigation"], a[href], button, input, select, textarea, [role="button"], [role="link"]');
    return { x, y, hit: label, background };
  });
}

// --- Sürükleme (Pointer Events) ----------------------------------------------------------------------------------------

interface Point { x: number; y: number }
type DragEnd = 'birak' | 'iptal';

/** Tutamaç bölgesi: başlığın hemen üstü, alt sayfanın yatay ortası (Kapat sağda kalır). */
async function grabPoint(sheet: Locator, title: string): Promise<Point> {
  return sheet.evaluate((dialog, text) => {
    const heading = Array.from(dialog.querySelectorAll('h2')).find(h => (h.textContent || '').trim() === text) ?? dialog.querySelector('h2');
    const rect = dialog.getBoundingClientRect();
    const headTop = heading ? heading.getBoundingClientRect().top : rect.top + 16;
    const top = Math.max(rect.top, headTop - 32);
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(Math.max(top + 4, headTop - 8)) };
  }, title);
}

async function installPointerRecorder(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __f08PointerKayit?: boolean; __f08Pointer?: { id: number; type: string; target: EventTarget | null } };
    if (w.__f08PointerKayit) return;
    w.__f08PointerKayit = true;
    window.addEventListener('pointerdown', (event) => {
      w.__f08Pointer = { id: event.pointerId, type: event.pointerType, target: event.target };
    }, true);
  });
}

/**
 * from noktasından dy kadar aşağı sürükler; 'birak' bırakır, 'iptal' pointercancel ile biter. onMiddle yolun yarısında,
 * işaretçi hâlâ basılıyken çağrılır (sayfanın parmağı izlediğini ölçmek için). chromium+hasTouch: CDP touch; diğerleri fare.
 */
async function dragFrom(page: Page, browserName: string, testInfo: TestInfo, from: Point, dy: number, end: DragEnd, onMiddle?: () => Promise<void>) {
  const steps = 10;
  if (browserName === 'chromium' && testInfo.project.use.hasTouch) {
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', y?: number) => cdp.send('Input.dispatchTouchEvent', {
      type, touchPoints: y === undefined ? [] : [{ x: from.x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }],
    });
    try {
      await touch('touchStart', from.y);
      for (let i = 1; i <= steps; i++) {
        await touch('touchMove', from.y + (dy * i) / steps);
        if (i === steps / 2 && onMiddle) await onMiddle();
      }
      await touch(end === 'birak' ? 'touchEnd' : 'touchCancel');
    } finally {
      await cdp.detach();
    }
    return;
  }
  await installPointerRecorder(page);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x, from.y + (dy * i) / steps);
    if (i === steps / 2 && onMiddle) await onMiddle();
  }
  if (end === 'birak') {
    await page.mouse.up();
    return;
  }
  await page.evaluate(() => {
    const record = (window as unknown as { __f08Pointer?: { id: number; type: string; target: EventTarget | null } }).__f08Pointer;
    const target = record?.target ?? document.body;
    target.dispatchEvent(new PointerEvent('pointercancel', {
      pointerId: record?.id ?? 1, pointerType: record?.type ?? 'mouse', isPrimary: true, bubbles: true, composed: true,
    }));
  });
  await page.mouse.move(from.x, from.y, { steps: 2 });
  await page.mouse.up();
}

const topOf = (locator: Locator) => locator.evaluate(el => el.getBoundingClientRect().top);

/** Modal katman: aria-modal="true" ya da yerel <dialog> showModal (:modal). */
const isModal = (sheet: Locator) => sheet.evaluate((dialog) => {
  if (dialog.getAttribute('aria-modal') === 'true') return true;
  try { return dialog.matches(':modal'); } catch { return false; }
});

// --- Sanal klavye (visualViewport) ---------------------------------------------------------------------------------------

/**
 * addInitScript ile yüklenir: visualViewport.height'ı örneğin kendisinde gölgeler ve window.__f08Klavye(px) ile benzetilen
 * klavye yüksekliğini ayarlar; ardından visualViewport'ta 'resize' ve 'scroll' olayları gönderilir. Düzen viewport'u
 * (innerHeight, position: fixed) değişmez; iOS Safari'deki gibi yalnız görünür alan küçülür.
 */
function installKeyboardShim() {
  const w = window as unknown as { __f08Klavye?: (px: number) => number };
  const viewport = window.visualViewport;
  if (!viewport || w.__f08Klavye) return;
  const getter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(viewport), 'height')?.get;
  if (!getter) return;
  let inset = 0;
  Object.defineProperty(viewport, 'height', { configurable: true, get: () => Math.max(0, (getter.call(viewport) as number) - inset) });
  w.__f08Klavye = (px: number) => {
    inset = Math.max(0, px);
    viewport.dispatchEvent(new Event('resize'));
    viewport.dispatchEvent(new Event('scroll'));
    return viewport.height;
  };
}

/** Benzetilen klavyeyi ayarlar; döner: yeni visualViewport.height (benzetim yoksa null). */
async function setKeyboard(page: Page, px: number): Promise<number | null> {
  return page.evaluate((value) => {
    const fn = (window as unknown as { __f08Klavye?: (n: number) => number }).__f08Klavye;
    return fn ? fn(value) : null;
  }, px);
}

interface CoverRequest { names?: string[]; focused?: boolean; anyOption?: boolean }
/**
 * Görünür alanın (visualViewport offsetTop..offsetTop+height) dışında kalan ya da üstü örtülen gerekli öğeler: adı
 * verilen düğmeler, odaklı alan, en az bir seçenek. Boş liste = hepsi görünür ve dokunulabilir.
 */
async function hiddenUnderKeyboard(sheet: Locator, request: CoverRequest): Promise<string[]> {
  return sheet.evaluate((dialog, req) => {
    const viewport = window.visualViewport;
    const top = viewport ? viewport.offsetTop : 0;
    const bottom = top + (viewport ? viewport.height : window.innerHeight);
    const describe = (el: Element | null) => (el ? `${el.tagName.toLowerCase()}${typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/)[0]}` : ''}` : 'yok');
    const problem = (el: Element, label: string): string | null => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return `${label}: boyutsuz`;
      if (r.top < top - 1 || r.bottom > bottom + 1) {
        return `${label}: ${Math.round(r.top)}–${Math.round(r.bottom)} px, görünür alan ${Math.round(top)}–${Math.round(bottom)} px dışında`;
      }
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!hit || !(hit === el || el.contains(hit))) return `${label}: üstü örtülü (${describe(hit)})`;
      return null;
    };
    const out: string[] = [];
    for (const name of req.names ?? []) {
      const button = Array.from(dialog.querySelectorAll('button, a[href], [role="button"]'))
        .find(el => (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim() === name);
      if (!button) out.push(`"${name}": alt sayfada yok`);
      else { const p = problem(button, `"${name}"`); if (p) out.push(p); }
    }
    if (req.focused) {
      const active = document.activeElement;
      if (!active || !dialog.contains(active)) out.push(`odaklı alan alt sayfada değil (${describe(active)})`);
      else { const p = problem(active, 'odaklı alan'); if (p) out.push(p); }
    }
    if (req.anyOption) {
      const options = Array.from(dialog.querySelectorAll('[role="option"]'));
      if (!options.some(o => problem(o, 'seçenek') === null)) out.push(`hiçbir seçenek görünür değil (${options.length} seçenek)`);
    }
    return out;
  }, request);
}

// --- Katman kökü (dedektörler için) --------------------------------------------------------------------------------------

/**
 * Alt sayfanın katman kökünü işaretler, seçicisini döner: portal ise örtü dahil, uygulama içeriğini içermeyen en üst ata;
 * main içinde yerinde çizilen katmanda (ör. showModal <dialog>, ::backdrop kendi sözde öğesi) dialog'un kendisi.
 */
async function markLayer(sheet: Locator): Promise<string> {
  await sheet.evaluate((dialog) => {
    document.querySelectorAll('[data-f08-katman]').forEach(el => el.removeAttribute('data-f08-katman'));
    const main = document.querySelector('main#admin-content');
    let layer: Element = dialog;
    if (!(main && main.contains(dialog))) {
      while (layer.parentElement && layer.parentElement !== document.body && !(main && layer.parentElement.contains(main))) layer = layer.parentElement;
    }
    layer.setAttribute('data-f08-katman', '');
  });
  return '[data-f08-katman]';
}

// =========================================================================================================================
// 1. Dokunmayla açma/kapama
// =========================================================================================================================

for (const s of SURFACES) {
  test(`${s.ad}: dokunma açar; Kapat${s.scrimCloses ? ' ve örtüye dokunma' : ''} kapatır; odak tetiğe döner, gösterge görünmez`, MATRIX, async ({ page }) => {
    await openPhone(page, s.route);
    const trigger = s.trigger(page);
    if (s.expanded) await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    const sheet = await openByTap(page, s);
    expect(await isModal(sheet), 'alt sayfa modal (aria-modal="true" ya da showModal)').toBe(true);
    await expect(headingOf(sheet, s.title)).toBeVisible();
    if (s.expanded) await softly(trigger, 'alt sayfa açıkken tetik aria-expanded="true"').toHaveAttribute('aria-expanded', 'true');

    // Yerleşim: alttan açılır (alt kenar pencere altında), en çok ekranın %85'i.
    const geometry = await sheet.evaluate((dialog) => {
      const rect = dialog.getBoundingClientRect();
      const heading = dialog.querySelector('h2');
      const top = heading ? Math.max(rect.top, heading.getBoundingClientRect().top - 32) : rect.top;
      return { top, bottom: rect.bottom, height: window.innerHeight };
    });
    softly(Math.abs(geometry.bottom - geometry.height), 'alt sayfa pencerenin altına dayanır').toBeLessThanOrEqual(1);
    softly(geometry.top, `alt sayfa en çok ekranın %${AZAMI_ORAN * 100}'i`).toBeGreaterThanOrEqual(geometry.height * (1 - AZAMI_ORAN) - 1);

    await sheet.getByRole('button', { name: KAPAT, exact: true }).tap();
    await expect(sheet, 'Kapat dokunması kapatmadı').toBeHidden();
    await expect(trigger, 'Kapat sonrası odak tetiğe dönmeli').toBeFocused();
    if (s.expanded) await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('html')).toHaveAttribute('data-keyboard', 'false');
    softly(await focusRing(page), 'dokunmayla dönen odakta gösterge görünmemeli').toEqual([]);

    if (s.scrimCloses) {
      const again = await openByTap(page, s);
      const probe = await scrimProbe(again);
      expect(probe, 'alt sayfanın üstünde örtü payı olmalı').not.toBeNull();
      await page.touchscreen.tap(probe!.x, probe!.y);
      await expect(again, 'örtüye dokunma kapatmadı').toBeHidden();
      await expect(trigger, 'örtü sonrası odak tetiğe dönmeli').toBeFocused();
    }
  });
}

// =========================================================================================================================
// 2. Klavye: odak girişi, Tab/Shift+Tab tuzağı, Escape ve odak dönüşü
// =========================================================================================================================

for (const s of SURFACES) {
  test(`${s.ad}: Enter açar; Tab/Shift+Tab alt sayfada döner; Escape kapatır, odak ve göstergesi tetiğe döner`, async ({ page, browserName }) => {
    await openPhone(page, s.route);
    const trigger = s.trigger(page);
    const sheet = await openByKeyboard(page, browserName, s);
    const stops = await markStops(sheet);
    expect(stops.length, `alt sayfada en az iki sekme durağı (Kapat + içerik): ${stops.join(', ')}`).toBeGreaterThanOrEqual(2);

    const ringIssues: string[] = [];
    const collectRing = async () => { ringIssues.push(...(await focusRing(page))); };
    // Tuzak ihlalleri yumuşak: Shift+Tab, Escape ve odak dönüşü de aynı koşuda raporlansın.
    const forward = await walkFocus(page, sheet, tabKey(browserName), stops.length + 2, collectRing);
    softly(forward.filter(w => w.startsWith('dışarıda')), `Tab: odak alt sayfadan çıktı (${forward.join(' → ')})`).toEqual([]);
    softly(unvisited(stops, forward), `Tab ile ulaşılamayan duraklar (${forward.join(' → ')})`).toEqual([]);
    const backward = await walkFocus(page, sheet, shiftTabKey(browserName), stops.length + 2, collectRing);
    softly(backward.filter(w => w.startsWith('dışarıda')), `Shift+Tab: odak alt sayfadan çıktı (${backward.join(' → ')})`).toEqual([]);
    softly(unvisited(stops, backward), `Shift+Tab ile ulaşılamayan duraklar (${backward.join(' → ')})`).toEqual([]);
    await expect.poll(() => focusWhere(sheet), { message: 'Escape öncesi odak alt sayfada' }).not.toMatch(/^dışarıda/);
    softly([...new Set(ringIssues)], 'alt sayfa duraklarında klavye odak göstergesi (tek alt çizgi)').toEqual([]);

    await page.keyboard.press('Escape');
    await expect(sheet, 'Escape kapatmadı').toBeHidden();
    await expect(trigger, 'Escape sonrası odak tetiğe dönmeli').toBeFocused();
    if (s.expanded) await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('html'), 'dönüş odağı klavye modunu korumalı').toHaveAttribute('data-keyboard', 'true');
    softly(await focusRing(page), 'dönen odakta gösterge görünür olmalı').toEqual([]);
  });
}

// =========================================================================================================================
// 3. Oklar, Home/End, Enter/Space
// =========================================================================================================================

test('Seçim listesi: Tab seçili seçeneğe gelir; oklar/Home/End gezer; Enter ve Space seçer, kapatır, odak tetiğe döner', async ({ page, browserName }) => {
  await openPhone(page, SECIM.route);
  const trigger = SECIM.trigger(page);
  let sheet = await openByKeyboard(page, browserName, SECIM);
  await expect(sheet.getByRole('listbox', { name: SECIM.title })).toBeVisible();
  const { labels, selected } = await listOptions(sheet);
  expect(labels.length, 'dönem seçeneği sayısı').toBeGreaterThanOrEqual(3);
  expect(selected, 'tam bir seçili seçenek (aria-selected="true")').toHaveLength(1);
  const last = labels.length - 1;

  const first = await tabToRole(page, browserName, sheet, 'option');
  expect(first, 'dolaşan tabindex seçili seçenekte (APG listbox)').toBe(selected[0]);
  let index = labels.indexOf(first);
  const expectFocus = async (key: string, next: number) => {
    await page.keyboard.press(key);
    index = next;
    const focused = await focusedRole(sheet);
    expect({ inside: focused.inside, role: focused.role, label: focused.label }, `${key} sonrası odak`).toEqual({ inside: true, role: 'option', label: labels[index] });
  };
  await expectFocus('ArrowDown', Math.min(index + 1, last));
  await expectFocus('ArrowUp', Math.max(index - 1, 0));
  await expectFocus('End', last);
  await expectFocus('Home', 0);
  await expectFocus('ArrowDown', 1);

  await page.keyboard.press('Enter');
  await expect(sheet, 'Enter seçip kapatmalı').toBeHidden();
  await expect(trigger, 'seçimden sonra odak tetiğe dönmeli').toBeFocused();
  await page.keyboard.press('Enter');
  sheet = sheetOf(page, SECIM.title);
  await expect(sheet).toBeVisible();
  expect((await listOptions(sheet)).selected, 'Enter ile seçilen').toEqual([labels[1]]);

  expect(await tabToRole(page, browserName, sheet, 'option'), 'yeniden açınca dolaşan tabindex yeni seçimde').toBe(labels[1]);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Space');
  await expect(sheet, 'Space seçip kapatmalı').toBeHidden();
  await expect(trigger).toBeFocused();
  await page.keyboard.press('Enter');
  sheet = sheetOf(page, SECIM.title);
  await expect(sheet).toBeVisible();
  expect((await listOptions(sheet)).selected, 'Space ile seçilen').toEqual([labels[2]]);
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(trigger).toBeFocused();
});

for (const key of ['Enter', 'Space'] as const) {
  test(`Diğer eylemler: oklar/Home/End menüde kalır; ${key} eylemi çalıştırır; açılan diyalog kapanınca odak Diğer'e döner`, async ({ page, browserName }) => {
    await openPhone(page, MENU.route);
    const trigger = MENU.trigger(page);
    const sheet = await openByKeyboard(page, browserName, MENU);
    await expect(sheet.getByRole('menu', { name: MENU.title })).toBeVisible();
    const items = await sheet.getByRole('menuitem').allTextContents();
    expect(items.map(t => t.trim()), 'Hesaplar Diğer eylemleri').toContain('Borç ekle');

    expect(await tabToRole(page, browserName, sheet, 'menuitem'), 'Tab ilk eyleme gelir').toBe(items[0].trim());
    for (const arrow of ['ArrowDown', 'ArrowUp', 'End', 'Home']) {
      await page.keyboard.press(arrow);
      const focused = await focusedRole(sheet);
      expect({ inside: focused.inside, role: focused.role }, `${arrow} sonrası odak menüde`).toEqual({ inside: true, role: 'menuitem' });
    }
    await page.keyboard.press('Home');
    expect((await focusedRole(sheet)).label, 'Home ilk eyleme gider').toBe(items[0].trim());
    for (let i = 0; i < items.length && (await focusedRole(sheet)).label !== 'Borç ekle'; i++) await page.keyboard.press('ArrowDown');
    expect((await focusedRole(sheet)).label, 'ArrowDown "Borç ekle"ye ulaşır').toBe('Borç ekle');

    await page.keyboard.press(key);
    await expect(sheet, `${key} menüyü kapatmalı`).toBeHidden();
    const dialog = sheetOf(page, 'Borç ekle');
    await expect(dialog, `${key} "Borç ekle" eylemini çalıştırmalı`).toBeVisible();
    await expect.poll(() => focusWhere(dialog), { message: 'açılan diyalogda odak içeride' }).not.toMatch(/^dışarıda/);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger, 'zincirin sonunda odak Diğer düğmesine dönmeli').toBeFocused();
  });
}

// =========================================================================================================================
// 4. İç içe katman: diyalog içindeki seçim alt sayfası
// =========================================================================================================================

test('İç içe: Terim ekle içindeki Sözlük seçimi; Escape yalnız üstteki katmanı kapatır, alttaki inert, odak sırayla döner', async ({ page, browserName }) => {
  await openPhone(page, DIYALOG.route);
  const outer = await openByKeyboard(page, browserName, DIYALOG);
  const combo = outer.getByRole('combobox', { name: 'Sözlük', exact: true });
  await expect(combo).toBeVisible();
  await combo.focus();
  await page.keyboard.press('Enter');
  const inner = sheetOf(page, 'Sözlük');
  await expect(inner, 'Enter Sözlük alt sayfasını açmalı').toBeVisible();
  await expect(outer, 'alttaki diyalog açık kalmalı').toBeVisible();
  await expect.poll(() => focusWhere(inner), { message: 'odak üstteki alt sayfada' }).not.toMatch(/^dışarıda/);
  softly(await backgroundFocusLeaks(inner), 'üstteki alt sayfa açıkken arka plan (alttaki diyalog dahil) odak alamaz').toEqual([]);
  await page.keyboard.press('Escape');
  await expect(inner, 'Escape üstteki alt sayfayı kapatmalı').toBeHidden();
  await expect(outer, 'Escape alttaki diyaloğu kapatmamalı').toBeVisible();
  await expect(combo, 'odak Sözlük seçimine dönmeli').toBeFocused();

  await page.keyboard.press('Enter');
  await expect(inner).toBeVisible();
  await tabToRole(page, browserName, inner, 'option');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(inner, 'seçim üstteki alt sayfayı kapatmalı').toBeHidden();
  await expect(outer).toBeVisible();
  await expect(combo, 'seçimden sonra odak Sözlük seçimine dönmeli').toBeFocused();

  await page.keyboard.press('Escape');
  await expect(outer, 'ikinci Escape diyaloğu kapatmalı').toBeHidden();
  await expect(DIYALOG.trigger(page), 'odak Terim ekle düğmesine dönmeli').toBeFocused();
});

// =========================================================================================================================
// 5. Arka plan inert
// =========================================================================================================================

for (const s of SURFACES) {
  test(`${s.ad}: arka plan inert — arka plandaki öğe odak alamaz, dokunma arkaya geçmez`, MATRIX, async ({ page }) => {
    await openPhone(page, s.route);
    const sheet = await openByTap(page, s);
    const probe = await scrimProbe(sheet);
    if (probe) softly(probe.background ? probe.hit : null, `örtü noktası (${probe.x}, ${probe.y}) arka plandaki öğeyi vurmamalı`).toBeNull();
    expect(await backgroundFocusLeaks(sheet), 'alt sayfa açıkken odak alabilen arka plan öğeleri (inert değil)').toEqual([]);
    await expect(sheet).toBeVisible();
  });
}

// =========================================================================================================================
// 6. Sürüklemeyle kapatma (Pointer Events, iptal)
// =========================================================================================================================

for (const s of [SECIM, MENU]) {
  test(`${s.ad}: kısa sürükleme ve pointercancel geri oturtur; uzun aşağı sürükleme kapatır, sayfa parmağı izler`, MATRIX, async ({ page, browserName }, testInfo) => {
    await openPhone(page, s.route);
    const trigger = s.trigger(page);
    const sheet = await openByTap(page, s);
    const heading = headingOf(sheet, s.title);
    const rest = await topOf(heading);
    const grab = await grabPoint(sheet, s.title);
    const height = page.viewportSize()!.height;
    const long = Math.round(Math.min(height - grab.y - 4, Math.max((height - rest) * 0.6, 120)));
    expect(long, 'sürükleme için yer').toBeGreaterThanOrEqual(80);
    const backHome = () => expect.poll(async () => Math.abs((await topOf(heading)) - rest), { message: 'alt sayfa yerine oturmalı' }).toBeLessThanOrEqual(1);

    await dragFrom(page, browserName, testInfo, grab, 12, 'birak');
    await expect(sheet, 'kısa sürükleme kapatmamalı').toBeVisible();
    await backHome();

    await dragFrom(page, browserName, testInfo, grab, long, 'iptal', async () => {
      await softly.poll(() => topOf(heading), { message: 'sürüklenirken alt sayfa parmağı izlemeli', timeout: 2_000 }).toBeGreaterThan(rest + long / 4);
    });
    await expect(sheet, 'pointercancel kapatmamalı').toBeVisible();
    await backHome();

    await dragFrom(page, browserName, testInfo, grab, long, 'birak');
    await expect(sheet, `${long} px aşağı sürükleme kapatmalı`).toBeHidden();
    await expect(trigger, 'sürükleyerek kapatınca odak tetiğe dönmeli').toBeFocused();
  });
}

// =========================================================================================================================
// 7. Sanal klavye örtmesi (visualViewport küçülür)
// =========================================================================================================================

test('Sanal klavye: Terim ekle — odaklı alan ve form eylemleri görünür alanda kalır', MATRIX, async ({ page }) => {
  await page.addInitScript(installKeyboardShim);
  await openPhone(page, DIYALOG.route);
  const sheet = await openByTap(page, DIYALOG);
  const field = sheet.getByRole('textbox', { name: /^Terim adı/ });
  await field.tap();
  await expect(field).toBeFocused();
  const required: CoverRequest = { names: ['Öneri olarak kaydet', 'Vazgeç'], focused: true };
  expect(await hiddenUnderKeyboard(sheet, required), 'klavye yokken').toEqual([]);

  const base = await setKeyboard(page, 0);
  expect(base, 'visualViewport benzetimi kurulu').not.toBeNull();
  const keyboard = Math.round((await page.evaluate(() => window.innerHeight)) * KLAVYE_ORANI);
  expect(await setKeyboard(page, keyboard), 'visualViewport.height klavye kadar küçüldü').toBe(base! - keyboard);
  await expect.poll(() => hiddenUnderKeyboard(sheet, required), { message: `${keyboard} px klavye açıkken gizlenen` }).toEqual([]);
  await expect(field).toBeFocused();

  expect(await setKeyboard(page, 0)).toBe(base);
  await expect.poll(() => hiddenUnderKeyboard(sheet, required), { message: 'klavye kapanınca gizlenen' }).toEqual([]);
  await expect(sheet).toBeVisible();
});

test('Sanal klavye: Dönem araması — arama alanı, Kapat ve en az bir seçenek görünür alanda kalır', MATRIX, async ({ page }) => {
  await page.addInitScript(installKeyboardShim);
  await openPhone(page, SECIM.route);
  const sheet = await openByTap(page, SECIM);
  const search = sheet.getByRole('searchbox', { name: 'Seçeneklerde ara' });
  await expect(search, 'Dönem 8\'den fazla seçenek: arama alanı').toBeVisible();
  await search.tap();
  await expect(search).toBeFocused();
  const required: CoverRequest = { names: [KAPAT], focused: true, anyOption: true };

  const base = await setKeyboard(page, 0);
  expect(base, 'visualViewport benzetimi kurulu').not.toBeNull();
  const keyboard = Math.round((await page.evaluate(() => window.innerHeight)) * KLAVYE_ORANI);
  expect(await setKeyboard(page, keyboard), 'visualViewport.height klavye kadar küçüldü').toBe(base! - keyboard);
  await expect.poll(() => hiddenUnderKeyboard(sheet, required), { message: `${keyboard} px klavye açıkken gizlenen` }).toEqual([]);
  expect(await setKeyboard(page, 0)).toBe(base);
  await expect.poll(() => hiddenUnderKeyboard(sheet, required), { message: 'klavye kapanınca gizlenen' }).toEqual([]);
});

// =========================================================================================================================
// 8. Kural dedektörleri ve dokunma hedefleri
// =========================================================================================================================

for (const s of SURFACES) {
  test(`${s.ad}: alt sayfa katmanında metin ≥ 14 px, kavisli vurgu yok, taşma/kesme yok, hareket 240 ms tek eğri`, MATRIX, async ({ page }) => {
    await openPhone(page, s.route);
    const sheet = await openByTap(page, s);
    const root = await markLayer(sheet);
    softly(await smallText(page, { root }), '14 px altı metin').toEqual([]);
    softly(await accentEdges(page, { root }), 'kavisli vurgu kenarı').toEqual([]);
    softly(await overflow(page, { root }), 'taşma ya da kesilen metin').toEqual([]);
    softly(await motion(page, undefined, undefined, { root }), 'hareket sözleşmesi (240 ms, cubic-bezier(.65,0,.35,1))').toEqual([]);
  });

  test(`${s.ad}: dokunma hedefleri ≥ ${DOKUNMA_ASGARI} px, coarse girişte ≥ ${DOKUNMA_COARSE} px`, MATRIX, async ({ page }) => {
    await openPhone(page, s.route);
    const sheet = await openByTap(page, s);
    const result = await sheet.evaluate((dialog, sizes) => {
      const coarse = window.matchMedia('(any-pointer: coarse)').matches;
      const min = coarse ? sizes.coarse : sizes.base;
      const INTERACTIVE = 'a[href], button, input:not([type=hidden]), select, textarea, [role="option"], [role="menuitem"], [role="checkbox"], [role="radio"], [role="switch"], [role="tab"], [tabindex]:not([tabindex="-1"])';
      const all = Array.from(dialog.querySelectorAll<HTMLElement>(INTERACTIVE)).filter(el => el.getClientRects().length > 0
        && getComputedStyle(el).visibility !== 'hidden' && !(el as HTMLButtonElement).disabled);
      const small: string[] = [];
      for (const el of all) {
        // Hedef: öğenin kendisi. Metin alanında (input/textarea/select) dokunuşu alana ileten sarmalayıcı da sayılır:
        // yalnız onu saran, başka etkileşimli öğe içermeyen en çok iki ata; en büyüğü. Düğme atasından alan ödünç almaz.
        let box = el.getBoundingClientRect();
        const field = el.matches('input, textarea, select');
        let node: HTMLElement | null = field ? el.parentElement : null;
        for (let depth = 0; depth < 2 && node && node !== dialog; depth++, node = node.parentElement) {
          if (Array.from(node.querySelectorAll(INTERACTIVE)).filter(x => x !== el && x.getClientRects().length > 0 && getComputedStyle(x).visibility !== 'hidden').length > 0) break;
          const r = node.getBoundingClientRect();
          if (r.width * r.height > box.width * box.height) box = r;
        }
        if (box.height + 0.5 < min || box.width + 0.5 < min) {
          const name = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 28);
          small.push(`${el.tagName.toLowerCase()}${el.getAttribute('role') ? `[role=${el.getAttribute('role')}]` : ''} "${name}" ${Math.round(box.width)}×${Math.round(box.height)}`);
        }
      }
      return { coarse, min, count: all.length, small };
    }, { base: DOKUNMA_ASGARI, coarse: DOKUNMA_COARSE });
    expect(result.count, 'alt sayfada etkileşimli öğe').toBeGreaterThan(0);
    expect(result.small, `${result.coarse ? 'coarse' : 'fine'} girişte ${result.min} px altındaki dokunma hedefleri`).toEqual([]);
  });
}

// =========================================================================================================================
// 9. Azaltılmış hareket: açılış ve kapanış animasyonsuz, durum anında
// =========================================================================================================================

/**
 * Hareket kaydedici: katmanlarda (dialog içi ya da uygulama içeriğini içermeyen portal) süresi sıfırdan büyük her geçiş
 * ve animasyon. İki kaynak: transitionrun/animationstart olayları (kısa hareketi de yakalar; süre 0 olan geçiş hiç
 * oluşmaz, süre 0 olan animasyon hesaplanmış süresiyle elenir) ve her karede document.getAnimations() (Web Animations).
 */
async function startMotionRecorder(page: Page) {
  await page.evaluate(() => {
    type Recorder = { on: boolean; seen: string[] };
    const w = window as unknown as { __f08Hareket?: Recorder };
    if (w.__f08Hareket) w.__f08Hareket.on = false;
    const state: Recorder = { on: true, seen: [] };
    w.__f08Hareket = state;
    const main = document.querySelector('main#admin-content');
    const inLayer = (el: Element) => {
      if (el === document.documentElement || el === document.body) return false;
      if (el.closest('[role="dialog"], dialog, [aria-modal="true"]')) return true;
      let top: Element = el;
      while (top.parentElement && top.parentElement !== document.body) top = top.parentElement;
      return top.parentElement === document.body && !(main && top.contains(main));
    };
    const label = (el: Element) => `${el.tagName.toLowerCase()}${typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/)[0]}` : ''}`;
    const note = (entry: string) => { if (state.on && !state.seen.includes(entry)) state.seen.push(entry); };
    const longestMs = (value: string) => Math.max(0, ...value.split(',').map(v => (/ms$/.test(v.trim()) ? parseFloat(v) : parseFloat(v) * 1000) || 0));
    window.addEventListener('transitionrun', (event) => {
      const target = event.target;
      if (target instanceof Element && inLayer(target)) note(`${label(target)}: geçiş ${event.propertyName}`);
    }, true);
    window.addEventListener('animationstart', (event) => {
      const target = event.target;
      if (!(target instanceof Element) || !inLayer(target)) return;
      if (longestMs(getComputedStyle(target).animationDuration) > 0) note(`${label(target)}: animasyon ${event.animationName}`);
    }, true);
    const tick = () => {
      if (!state.on) return;
      for (const animation of document.getAnimations()) {
        const effect = animation.effect as KeyframeEffect | null;
        const target = effect?.target;
        if (animation.playState !== 'running' || !(target instanceof Element) || !inLayer(target)) continue;
        const active = Number(effect!.getComputedTiming().activeDuration) || 0;
        if (active > 0) note(`${label(target)}: çalışan hareket ${Math.round(active)} ms`);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function stopMotionRecorder(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const state = (window as unknown as { __f08Hareket?: { on: boolean; seen: string[] } }).__f08Hareket;
    if (!state) return ['kaydedici kurulmadı'];
    state.on = false;
    return [...state.seen];
  });
}

for (const s of SURFACES) {
  test(`${s.ad}: azaltılmış harekette açılış ve kapanış animasyonsuz, durum anında`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openPhone(page, s.route);
    const trigger = s.trigger(page);
    await expect(trigger).toBeEnabled();
    await startMotionRecorder(page);
    await trigger.tap();
    const sheet = sheetOf(page, s.title);
    await expect(sheet, 'dokunma alt sayfayı açmadı').toBeVisible();
    await settle(sheet);
    const root = await markLayer(sheet);
    softly(await motion(page, undefined, undefined, { root, reduced: true }), 'azaltılmış harekette geçiş/animasyon süresi 0').toEqual([]);
    await sheet.getByRole('button', { name: KAPAT, exact: true }).tap();
    await expect(sheet, 'Kapat dokunması kapatmadı').toBeHidden();
    softly(await stopMotionRecorder(page), 'açılış ve kapanışta çalışan hareket (azaltılmış hareket)').toEqual([]);
  });
}

// =========================================================================================================================
// 10. Öz denetim: paylaşılan dedektörler ve bu dosyanın yoklamaları bilinçli ihlali yakalar
// =========================================================================================================================

/** Sayfaya alttan açılan bir öz denetim katmanı ekler (yalnız test; ürün kodu değil). */
async function injectFixtureSheet(page: Page, options: { trap?: boolean; inertBackground?: boolean; drag?: boolean; keyboardAware?: boolean; noScrim?: boolean; animated?: boolean }) {
  await page.evaluate((opts) => {
    document.querySelectorAll('[data-f08-fixture]').forEach(el => el.remove());
    document.querySelectorAll('[data-f08-inert]').forEach(el => { el.removeAttribute('inert'); el.removeAttribute('data-f08-inert'); });
    const host = document.createElement('div');
    host.setAttribute('data-f08-fixture', '');
    host.innerHTML = (opts.noScrim ? '' : '<div data-ortu style="position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:2147482000"></div>')
      + '<div role="dialog" aria-modal="true" aria-labelledby="f08-oz-baslik" style="position:fixed;left:0;right:0;bottom:0;z-index:2147483000;background:#fff;font-size:16px">'
      + '<div data-tutamac style="padding:16px 16px 4px;touch-action:none"><h2 id="f08-oz-baslik" style="margin:0;font-size:18px">Öz denetim</h2></div>'
      + '<div style="padding:8px 16px"><input aria-label="Alan" style="font-size:16px;height:48px"></div>'
      + '<div style="padding:8px 16px 16px"><button type="button" style="font-size:16px;height:48px">Kaydet</button> <button type="button" style="font-size:16px;height:48px">Vazgeç</button></div>'
      + '</div>';
    document.body.append(host);
    const dialog = host.querySelector<HTMLElement>('[role="dialog"]')!;
    if (opts.inertBackground) {
      const main = document.querySelector('main#admin-content');
      let app: Element | null = main;
      while (app && app.parentElement && app.parentElement !== document.body) app = app.parentElement;
      if (app) { app.setAttribute('inert', ''); app.setAttribute('data-f08-inert', ''); }
    }
    if (opts.trap) {
      document.addEventListener('keydown', (event) => {
        if (event.key !== 'Tab' || !host.isConnected) return;
        const stops = Array.from(dialog.querySelectorAll<HTMLElement>('input, button'));
        const first = stops[0];
        const last = stops[stops.length - 1];
        const active = document.activeElement;
        if (event.shiftKey ? active === first || !dialog.contains(active) : active === last || !dialog.contains(active)) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        }
      }, true);
    }
    if (opts.keyboardAware && window.visualViewport) {
      const viewport = window.visualViewport;
      const place = () => { dialog.style.bottom = `${Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)}px`; };
      viewport.addEventListener('resize', place);
      place();
    }
    if (opts.drag) {
      const zone = host.querySelector<HTMLElement>('[data-tutamac]')!;
      const log: string[] = [];
      (window as unknown as { __f08OzSurukleme?: string[] }).__f08OzSurukleme = log;
      let start: number | null = null;
      let pointer = -1;
      let dy = 0;
      const reset = () => { start = null; dy = 0; dialog.style.transform = ''; };
      zone.addEventListener('pointerdown', (event) => { start = event.clientY; pointer = event.pointerId; zone.setPointerCapture(event.pointerId); log.push(`down:${event.pointerType}`); });
      zone.addEventListener('pointermove', (event) => {
        if (start === null || event.pointerId !== pointer) return;
        dy = Math.max(0, event.clientY - start);
        dialog.style.transform = `translateY(${dy}px)`;
      });
      zone.addEventListener('pointerup', (event) => {
        if (start === null || event.pointerId !== pointer) return;
        log.push(`up:${Math.round(dy)}`);
        if (dy > 80) host.remove();
        reset();
      });
      zone.addEventListener('pointercancel', (event) => { if (event.pointerId !== pointer) return; log.push('cancel'); reset(); });
    }
    if (opts.animated) {
      // Örtü azaltılmış harekette de 240 ms belirir (öz denetim ihlali). Örtü bilerek role="dialog" dışında: ürünün genel
      // reduced-motion kuralı (admin.css, dialog/katman seçicileri) satır içi geçişi sıfırlayıp ihlali gizlemesin.
      const scrim = host.querySelector<HTMLElement>('[data-ortu]')!;
      scrim.style.transition = 'opacity 240ms cubic-bezier(.65,0,.35,1)';
      scrim.style.opacity = '0';
      scrim.getBoundingClientRect();
      scrim.style.opacity = '';
    }
    dialog.querySelector<HTMLElement>('input')!.focus();
  }, options);
  return page.getByRole('dialog', { name: 'Öz denetim', exact: true });
}

async function removeFixtures(page: Page) {
  await page.evaluate(() => {
    document.querySelectorAll('[data-f08-fixture]').forEach(el => el.remove());
    document.querySelectorAll('[data-f08-inert]').forEach(el => { el.removeAttribute('inert'); el.removeAttribute('data-f08-inert'); });
  });
}

test('Öz denetim: paylaşılan dedektörler bu motorda kör değil', MATRIX, async ({ page }) => {
  await openAdmin(page, '/genel');
  expect(await selfCheckDetectors(page), 'ihlali yakalamayan dedektörler').toEqual([]);
});

test('Öz denetim: Tab tuzağı ve inert yoklamaları kaçağı yakalar, doğru katmanı temiz bulur', MATRIX, async ({ page, browserName }) => {
  await openAdmin(page, '/genel');
  await enterKeyboardMode(page, browserName);

  const leaky = await injectFixtureSheet(page, { noScrim: true });
  const leakyStops = await markStops(leaky);
  expect(leakyStops, 'öz denetim katmanı durakları').toHaveLength(3);
  const leakyWalk = await walkFocus(page, leaky, tabKey(browserName), leakyStops.length + 2);
  expect(leakyWalk.some(w => w.startsWith('dışarıda')), `tuzaksız katmanda kaçak yakalanmalı (${leakyWalk.join(' → ')})`).toBe(true);
  expect((await backgroundFocusLeaks(leaky)).length, 'inert olmayan arka plan yakalanmalı').toBeGreaterThan(0);
  const leakyHit = await scrimProbe(leaky);
  expect(leakyHit?.background, `örtüsüz katmanda dokunma arka planı vurur (${leakyHit?.hit})`).toBe(true);

  const trapped = await injectFixtureSheet(page, { trap: true, inertBackground: true });
  const stops = await markStops(trapped);
  const forward = await walkFocus(page, trapped, tabKey(browserName), stops.length + 2);
  expect(forward.filter(w => w.startsWith('dışarıda')), `tuzaklı katman temiz (${forward.join(' → ')})`).toEqual([]);
  expect(unvisited(stops, forward)).toEqual([]);
  const backward = await walkFocus(page, trapped, shiftTabKey(browserName), stops.length + 2);
  expect(backward.filter(w => w.startsWith('dışarıda'))).toEqual([]);
  expect(await backgroundFocusLeaks(trapped), 'inert arka plan temiz').toEqual([]);
  expect((await scrimProbe(trapped))?.background, 'örtü noktası arka planı vurmaz').toBe(false);
  await removeFixtures(page);
});

test('Öz denetim: sanal klavye yoklaması örtülen eylemi yakalar, visualViewport\'a uyan katmanı temiz bulur', MATRIX, async ({ page }) => {
  await page.addInitScript(installKeyboardShim);
  await openAdmin(page, '/genel');
  const keyboard = Math.round((await page.evaluate(() => window.innerHeight)) * KLAVYE_ORANI);
  const required: CoverRequest = { names: ['Kaydet', 'Vazgeç'], focused: true };
  const base = await setKeyboard(page, 0);
  expect(base, 'benzetim kurulu').not.toBeNull();

  const blind = await injectFixtureSheet(page, {});
  expect(await hiddenUnderKeyboard(blind, required), 'klavye yokken öz denetim katmanı görünür').toEqual([]);
  expect(await setKeyboard(page, keyboard), 'benzetim visualViewport.height\'ı küçültür').toBe(base! - keyboard);
  const covered = await hiddenUnderKeyboard(blind, required);
  expect(covered.filter(p => /görünür alan/.test(p)).length, `klavyeye uymayan katmanda örtülen eylemler yakalanmalı (${covered.join('; ')})`).toBeGreaterThanOrEqual(2);
  await setKeyboard(page, 0);

  const aware = await injectFixtureSheet(page, { keyboardAware: true });
  await setKeyboard(page, keyboard);
  await expect.poll(() => hiddenUnderKeyboard(aware, required), { message: 'visualViewport resize dinleyen katman temiz' }).toEqual([]);
  await setKeyboard(page, 0);
  await removeFixtures(page);
});

test('Öz denetim: sürükleme yardımcısı gerçek pointer üretir; sürüklemesiz katmanı yakalar, doğru katmanı temiz bulur', MATRIX, async ({ page, browserName }, testInfo) => {
  await openAdmin(page, '/genel');
  const touch = browserName === 'chromium' && Boolean(testInfo.project.use.hasTouch);
  const log = () => page.evaluate(() => [...((window as unknown as { __f08OzSurukleme?: string[] }).__f08OzSurukleme ?? [])]);

  // Sürüklemesiz katman: uzun sürükleme sonrası açık kalır (gerçek testte "kapatmalı" FAIL olur).
  const still = await injectFixtureSheet(page, {});
  const stillHeading = headingOf(still, 'Öz denetim');
  const stillRest = await topOf(stillHeading);
  const stillGrab = await grabPoint(still, 'Öz denetim');
  await dragFrom(page, browserName, testInfo, stillGrab, 120, 'birak');
  await expect(still, 'sürüklemesiz katman kapanmamalı').toBeVisible();
  expect(Math.abs((await topOf(stillHeading)) - stillRest), 'sürüklemesiz katman yerinden oynamaz').toBeLessThanOrEqual(1);

  // Sürüklenen katman: kısa ve iptal geri oturur, uzun kapatır; pointer türü motorun gerçek girdisi.
  const sheet = await injectFixtureSheet(page, { drag: true });
  const heading = headingOf(sheet, 'Öz denetim');
  const rest = await topOf(heading);
  const grab = await grabPoint(sheet, 'Öz denetim');
  await dragFrom(page, browserName, testInfo, grab, 12, 'birak');
  await expect(sheet).toBeVisible();
  expect(Math.abs((await topOf(heading)) - rest)).toBeLessThanOrEqual(1);
  let followed = 0;
  await dragFrom(page, browserName, testInfo, grab, 120, 'iptal', async () => { followed = (await topOf(heading)) - rest; });
  expect(followed, 'yarı yolda katman izlemeli').toBeGreaterThan(30);
  await expect(sheet, 'iptal kapatmamalı').toBeVisible();
  expect(Math.abs((await topOf(heading)) - rest), 'iptal sonrası yerine oturur').toBeLessThanOrEqual(1);
  await dragFrom(page, browserName, testInfo, grab, 120, 'birak');
  await expect(sheet, 'uzun sürükleme kapatmalı').toBeHidden();
  const events = await log();
  expect(events.filter(e => e.startsWith('down:')).every(e => e === `down:${touch ? 'touch' : 'mouse'}`), `pointer türü (${events.join(', ')})`).toBe(true);
  expect(events, 'iptal pointercancel olarak ulaştı').toContain('cancel');
  await removeFixtures(page);
});

test('Öz denetim: hareket kaydedici azaltılmış harekette katmandaki geçişi yakalar, hareketsiz katmanı temiz bulur', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openAdmin(page, '/genel');
  const fixtureRoot = '[data-f08-fixture]';

  await startMotionRecorder(page);
  const still = await injectFixtureSheet(page, {});
  await expect(still).toBeVisible();
  expect(await motion(page, undefined, undefined, { root: fixtureRoot, reduced: true }), 'hareketsiz katman: süre 0').toEqual([]);
  await removeFixtures(page);
  expect(await stopMotionRecorder(page), 'hareketsiz katman temiz').toEqual([]);

  await startMotionRecorder(page);
  const moving = await injectFixtureSheet(page, { animated: true });
  await expect(moving).toBeVisible();
  expect((await motion(page, undefined, undefined, { root: fixtureRoot, reduced: true })).length, 'azaltılmış harekette 240 ms geçiş yakalanmalı').toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __f08Hareket?: { seen: string[] } }).__f08Hareket?.seen.join('; ') ?? ''),
    { message: 'olay (transitionrun) ve kare (getAnimations) kaynakları ikisi de görmeli' }).toMatch(/geçiş opacity.*çalışan hareket|çalışan hareket.*geçiş opacity/);
  await stopMotionRecorder(page);
  await removeFixtures(page);
});
