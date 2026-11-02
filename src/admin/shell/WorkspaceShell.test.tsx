import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useEffect, useState } from 'react';
import { useProfile, useWideModule, wideManifest, wideResource, type WideResource } from '../adaptive';
import { importsOf, isAntdSurface, wideRuleViolations } from '../adaptive/sourceRules';
import { installViewport } from '../adaptive/testing';
import { WorkspaceShell } from './WorkspaceShell';

// Kaynak: tasarim-sistemi/README.md › Kabuk + Uyarlanır teslim, components/AppShell/README.md, W0 uyarlamalı teslim
// sözleşmesi. Telefon kabuğu yerel HTML (antd yok): 56 px üst çubuk "aile · {sayfa} · [Sayfalar]", Sayfalar alt sayfası
// (MobileNavDrawer), İçeriğe geç, tek main. Masaüstü yan gezinmesi (272 px) shell/wide/WorkspaceNav.wide.tsx'te,
// lazyWide ile; yüklenirken ve yüklenemezse telefon üst çubuğu kullanılabilir kalır. Profil değişiminde main yeniden
// bağlanmaz (rota, içerik durumu, kaydırma ve odak korunur). Seçiciler role/label; antd iç sınıfı yok.

// Geniş gezinme modülünün yüklenmesi elle bırakılır: ilk masaüstü testi bekleme (fallback) durumunu görür.
const wideGate = vi.hoisted(() => {
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  return { ready, release };
});
vi.mock('./wide/WorkspaceNav.wide', async (importOriginal: () => Promise<Record<string, unknown>>) => {
  await wideGate.ready;
  return importOriginal();
});

const PHONE = { width: 320, height: 568, coarse: true };
const TABLET = { width: 820, height: 1180, coarse: true };
const DESKTOP = { width: 1440, height: 900, fine: true, hover: true };

const PAGES = [
  'Genel durum', 'Bütçe ve nakit', 'Ödemeler', 'Hesaplar ve borçlar', 'Alımlar ve eşyalar', 'Ev ve odalar',
  'Projeler ve görevler', 'Taraflar ve teklifler', 'Raporlar', 'Sözlükler ve iş akışları', 'Veri kalitesi ve içe aktarma',
];

const pagesButton = () => screen.getByRole('button', { name: 'Sayfalar' });
const sideNav = () => screen.findByRole('complementary');

afterEach(() => {
  document.title = '';
  window.location.hash = '';
});

describe('WorkspaceShell · masaüstü ilk açılış (geniş gezinme tembel)', () => {
  it('shows the native top bar while the side navigation loads, then swaps to it without remounting main', async () => {
    // Ön koşul: bu test dosyada ilk geniş yüklemedir (kapı henüz bırakılmadı).
    expect(wideManifest().find(entry => entry.key === 'shell-nav')?.status ?? 'idle').not.toBe('ready');
    installViewport(DESKTOP);
    render(<WorkspaceShell location="/alimlar"><p>İçerik</p></WorkspaceShell>);
    // Bekleme: telefon üst çubuğu ve Sayfalar düğmesi kullanılabilir; yan gezinme yok.
    expect(screen.getByRole('banner')).toHaveTextContent(/^aile\s*·\s*Alımlar ve eşyalar/);
    expect(pagesButton()).toBeEnabled();
    expect(screen.queryByRole('complementary')).toBeNull();
    const main = screen.getByRole('main');
    await act(async () => { wideGate.release(); });
    const aside = await sideNav();
    expect(within(aside).getByRole('navigation', { name: 'Sayfalar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sayfalar' })).toBeNull();
    expect(screen.queryByRole('banner')).toBeNull();
    expect(screen.getByRole('main')).toBe(main);
    expect(wideManifest().find(entry => entry.key === 'shell-nav')?.status).toBe('ready');
  });
});

describe('WorkspaceShell · masaüstü (≥1024)', () => {
  beforeEach(() => { wideGate.release(); installViewport(DESKTOP); });

  it('side navigation: brand, Sayfalar nav with the 11 pages as hash links, current page marked', async () => {
    render(<WorkspaceShell location="/alimlar/123"><p>İçerik</p></WorkspaceShell>);
    const aside = await sideNav();
    expect(within(aside).getByText('aile')).toBeInTheDocument();
    const nav = within(aside).getByRole('navigation', { name: 'Sayfalar' });
    const links = within(nav).getAllByRole('link');
    expect(links.map(link => link.textContent?.trim())).toEqual(PAGES);
    expect(links.map(link => link.getAttribute('href'))).toEqual([
      '#/genel', '#/butce', '#/odemeler', '#/hesaplar', '#/alimlar', '#/ev', '#/projeler', '#/taraflar', '#/raporlar', '#/sozlukler', '#/veri',
    ]);
    expect(within(nav).getByRole('link', { name: 'Alımlar ve eşyalar' })).toHaveAttribute('aria-current', 'page');
    expect(links.filter(link => link.hasAttribute('aria-current'))).toHaveLength(1);
    // b04 odak sözleşmesi: lacivert yüzey data-odak-zemin="nav" (çizgi odak-nav); eski iskelet sınıfı yok.
    expect(aside).toHaveAttribute('data-odak-zemin', 'nav');
    expect(aside).not.toHaveClass('aile-admin-nav');
  });

  it('offers Ayarlar and E-tabloyu aç below the pages; the sheet link opens in a new tab or is honestly unavailable', async () => {
    render(<WorkspaceShell location="/ayarlar"><p>İçerik</p></WorkspaceShell>);
    const aside = await sideNav();
    const settings = within(aside).getByRole('link', { name: 'Ayarlar' });
    expect(settings).toHaveAttribute('href', '#/ayarlar');
    expect(settings).toHaveAttribute('aria-current', 'page');
    // Ayarlar sayfa listesinde değil (Sayfalar nav'ı yalnız 11 sayfa).
    expect(within(within(aside).getByRole('navigation', { name: 'Sayfalar' })).queryByRole('link', { name: 'Ayarlar' })).toBeNull();
    if (import.meta.env.VITE_BUDGET_SHEET_ID) {
      const sheet = within(aside).getByRole('link', { name: 'E-tabloyu aç (yeni sekmede açılır)' });
      expect(sheet).toHaveAttribute('target', '_blank');
      expect(sheet).toHaveAttribute('rel', 'noopener noreferrer');
      expect(sheet.getAttribute('href')).toMatch(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/[^/]+\/edit$/);
      expect(within(aside).queryByText('E-tablo bağlantısı yok')).toBeNull();
    } else {
      expect(within(aside).queryByRole('link', { name: /E-tabloyu aç/ })).toBeNull();
      expect(within(aside).getByText('E-tabloyu aç').closest('[aria-disabled="true"]')).not.toBeNull();
      expect(within(aside).getByText('E-tablo bağlantısı yok')).toBeInTheDocument();
    }
  });

  it('has a single focusable main landmark with the page content and sets document.title', async () => {
    render(<WorkspaceShell location="/butce"><p>Bütçe içeriği</p></WorkspaceShell>);
    await sideNav();
    const mains = screen.getAllByRole('main');
    expect(mains).toHaveLength(1);
    expect(mains[0]).toHaveAttribute('id', 'admin-content');
    expect(mains[0]).toHaveAttribute('tabindex', '-1');
    expect(within(mains[0]).getByText('Bütçe içeriği')).toBeInTheDocument();
    expect(document.title).toBe('Bütçe ve nakit · aile');
  });
});

describe.each([['telefon', PHONE], ['tablet', TABLET]] as const)('WorkspaceShell · %s', (_name, viewport) => {
  beforeEach(() => { installViewport(viewport); });

  it('renders a native top bar "aile · {sayfa}" and a Sayfalar button, with no antd markup in the shell', async () => {
    const view = render(<WorkspaceShell location="/ev"><p>İçerik</p></WorkspaceShell>);
    const banner = screen.getByRole('banner');
    expect(banner).toHaveTextContent(/^aile\s*·\s*Ev ve odalar/);
    const button = within(banner).getByRole('button', { name: 'Sayfalar' });
    expect(button.tagName).toBe('BUTTON');
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveAttribute('aria-haspopup', 'dialog');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    // Gezinme yalnız alt sayfada; kapalıyken nav landmark'ı ve yan sütun yok.
    expect(screen.queryByRole('navigation', { name: 'Sayfalar' })).toBeNull();
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(view.container.querySelector('[class*="ant-"]')).toBeNull();
    expect(document.title).toBe('Ev ve odalar · aile');
    // Lacivert üst çubuk yerel nav yüzeyidir: odak çizgisi admin.css'ten odak-nav renginde (yerel kural yok).
    expect(banner).toHaveAttribute('data-odak-zemin', 'nav');
  });

  it('skip link is the first stop and focuses main without touching the hash route', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/butce';
    render(<WorkspaceShell location="/butce"><p>İçerik</p></WorkspaceShell>);
    await user.tab();
    const skip = screen.getByRole('link', { name: 'İçeriğe geç' });
    expect(skip).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('main')).toHaveFocus();
    expect(window.location.hash).toBe('#/butce');
    const mains = screen.getAllByRole('main');
    expect(mains).toHaveLength(1);
    expect(mains[0]).toHaveAttribute('id', 'admin-content');
  });

  it('opens Sayfalar as a modal: background inert, aria-expanded + aria-controls, focus inside; Escape returns focus', async () => {
    const user = userEvent.setup();
    render(<WorkspaceShell location="/ev"><p>İçerik</p></WorkspaceShell>);
    const button = pagesButton();
    await user.click(button);
    const dialog = await screen.findByRole('dialog', { name: 'Sayfalar' });
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(button).toHaveAttribute('aria-controls', dialog.id);
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    expect(screen.getByRole('banner', { hidden: true })).toHaveAttribute('inert');
    expect(document.getElementById('admin-content')).toHaveAttribute('inert');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('main')).not.toHaveAttribute('inert');
  });

  it('closes the drawer, updates the title and moves focus to main when the route changes', async () => {
    const user = userEvent.setup();
    const view = render(<WorkspaceShell location="/ev"><p>Ev</p></WorkspaceShell>);
    await user.click(pagesButton());
    expect(pagesButton()).toHaveAttribute('aria-expanded', 'true');
    view.rerender(<WorkspaceShell location="/projeler"><p>Projeler</p></WorkspaceShell>);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(pagesButton()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('banner')).toHaveTextContent('Projeler ve görevler');
    expect(document.title).toBe('Projeler ve görevler · aile');
    expect(screen.getByRole('main')).toHaveFocus();
  });

  it('choosing another page in the drawer leaves focus for main, not the Sayfalar button', async () => {
    const user = userEvent.setup();
    const view = render(<WorkspaceShell location="/ev"><p>Ev</p></WorkspaceShell>);
    await user.click(pagesButton());
    const nav = await screen.findByRole('navigation', { name: 'Sayfalar' });
    await user.click(within(nav).getByRole('link', { name: 'Ödemeler' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(pagesButton()).not.toHaveFocus();
    view.rerender(<WorkspaceShell location="/odemeler"><p>Ödemeler</p></WorkspaceShell>);
    expect(screen.getByRole('main')).toHaveFocus();
  });
});

// --- Odak üst çubuğun altında kalmaz (WCAG 2.4.11): ölçülen çubuk yüksekliği belge kaydırma payıdır ----------------

describe('WorkspaceShell · üst çubuk kaydırma payı', () => {
  const VAR = '--aile-shell-ust-olcu';
  const original = window.ResizeObserver;
  let resize: (() => void) | undefined;
  let barHeight = 56;
  beforeEach(() => {
    barHeight = 56;
    class FakeResizeObserver {
      constructor(callback: ResizeObserverCallback) { resize = () => act(() => callback([], this as unknown as ResizeObserver)); }
      observe() {}
      unobserve() {}
      disconnect() { resize = undefined; }
    }
    window.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect(this: HTMLElement) {
      const height = this.classList.contains('aile-admin-topbar') ? barHeight : 0;
      return { width: 320, height, top: 0, left: 0, right: 320, bottom: height, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    });
  });
  afterEach(() => {
    window.ResizeObserver = original;
    vi.restoreAllMocks();
    document.documentElement.style.removeProperty(VAR);
  });

  it('phone: writes the measured bar height (wrapped title, safe area) to the root, follows resizes, removes it on unmount', () => {
    installViewport(PHONE);
    const view = render(<WorkspaceShell location="/veri"><p>İçerik</p></WorkspaceShell>);
    expect(document.documentElement.style.getPropertyValue(VAR)).toBe('56px');
    // Sarılan ad ya da güvenli alan çubuğu büyütür: pay ölçüyle birlikte (yukarı yuvarlanmış) güncellenir.
    barHeight = 103.2;
    resize?.();
    expect(document.documentElement.style.getPropertyValue(VAR)).toBe('104px');
    view.unmount();
    expect(document.documentElement.style.getPropertyValue(VAR)).toBe('');
  });

  it('desktop: once the side navigation replaces the top bar the root carries no top bar padding', async () => {
    wideGate.release();
    installViewport(DESKTOP);
    render(<WorkspaceShell location="/alimlar"><p>İçerik</p></WorkspaceShell>);
    await sideNav();
    expect(screen.queryByRole('banner')).toBeNull();
    expect(document.documentElement.style.getPropertyValue(VAR)).toBe('');
  });
});

// --- Profil değişimi: aynı main, aynı içerik durumu, rota ve odak korunur; çift başlatma yok ----------------------

let probeMounts = 0;
function Probe() {
  const [count, setCount] = useState(0);
  useEffect(() => { probeMounts += 1; }, []);
  return <button type="button" onClick={() => setCount(value => value + 1)}>Sayaç {count}</button>;
}

describe('WorkspaceShell · profil değişimi', () => {
  beforeEach(() => { wideGate.release(); probeMounts = 0; });

  it('phone → desktop → phone keeps the route, the main element and the page state (no remount)', async () => {
    const user = userEvent.setup();
    const viewport = installViewport(PHONE);
    render(<WorkspaceShell location="/alimlar"><Probe /></WorkspaceShell>);
    await user.click(screen.getByRole('button', { name: 'Sayaç 0' }));
    const main = screen.getByRole('main');
    const counter = screen.getByRole('button', { name: 'Sayaç 1' });
    counter.focus();

    act(() => viewport.set(DESKTOP));
    await sideNav();
    expect(screen.getByRole('main')).toBe(main);
    expect(screen.getByRole('button', { name: 'Sayaç 1' })).toBe(counter);
    expect(counter).toHaveFocus();
    expect(document.title).toBe('Alımlar ve eşyalar · aile');

    act(() => viewport.set(PHONE));
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(screen.getByRole('banner')).toHaveTextContent('Alımlar ve eşyalar');
    expect(screen.getByRole('main')).toBe(main);
    expect(counter).toHaveFocus();
    expect(probeMounts).toBe(1);
  });

  it('focus on Sayfalar moves to the current side link on desktop and back to Sayfalar on phone', async () => {
    const viewport = installViewport(PHONE);
    render(<WorkspaceShell location="/ev"><p>İçerik</p></WorkspaceShell>);
    pagesButton().focus();
    act(() => viewport.set(DESKTOP));
    const aside = await sideNav();
    await waitFor(() => expect(within(aside).getByRole('link', { name: 'Ev ve odalar' })).toHaveFocus());
    act(() => viewport.set(PHONE));
    await waitFor(() => expect(pagesButton()).toHaveFocus());
  });

  it('an open drawer closes when the side navigation appears; focus lands on the current side link', async () => {
    const user = userEvent.setup();
    const viewport = installViewport(TABLET);
    render(<WorkspaceShell location="/raporlar"><p>İçerik</p></WorkspaceShell>);
    await user.click(pagesButton());
    const dialog = await screen.findByRole('dialog', { name: 'Sayfalar' });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    act(() => viewport.set({ width: 1180, height: 820, coarse: true }));
    const aside = await sideNav();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(within(aside).getByRole('link', { name: 'Raporlar' })).toHaveFocus());
    expect(screen.getByRole('main')).not.toHaveAttribute('inert');
  });
});

// --- Kaydırma çapası: geniş adalar yerleşene kadar korunur ----------------------------------------------------------
// Profil değişiminde kabuk kendi yerleşimi değişince çapayı geri kurar; ama sayfanın geniş adası (ör. Alımlar masaüstü
// yerleşimi) yan gezinmeden SONRA gelip içeriğin yüksekliğini değiştirebilir. WebKit/Safari'de yerel kaydırma çapası
// (overflow-anchor) yoktur: kabuk çapayı geniş yükleme bitene ve ResizeObserver sakinleşene kadar tutmalıdır (e2e
// admin-shell "profil değişimi telefon ↔ masaüstü" [webkit] 1532 px kayıyordu). Geometri ölçüm anında DOM'dan türetilir
// (tarayıcı gibi): sınama alanının üstü = üstteki içerik yüksekliği (data-ust) − scrollY. ResizeObserver tarayıcının
// yerleşim sonrası bildirimidir; test onu içerik değişince elle çağırır.

interface Kapi { promise: Promise<void>; ac(): void }
const kapi = (): Kapi => {
  let ac!: () => void;
  const promise = new Promise<void>(resolve => { ac = resolve; });
  return { promise, ac };
};
let adaSayaci = 0;
const adaKaynagi = (gate: Kapi) => wideResource(`sinama-kabuk-ada-${++adaSayaci}`, () => gate.promise.then(() => ({ yerlesti: true })));

const UST_DAR = 800;
const UST_GENIS = 2400;
const ALAN = 'sinama-alan';

/** Geniş adası yerleşince üstteki içeriği büyüten sayfa (Alımlar: dar liste → masaüstü yerleşimi). */
function AdaliSayfa({ ada }: { ada: WideResource<unknown> }) {
  const genis = useProfile() === 'desktop';
  const durum = useWideModule(ada, genis);
  return (
    <>
      <div data-ust={genis && durum.status === 'ready' ? UST_GENIS : UST_DAR} />
      <div id={ALAN}><button type="button">Sınama</button></div>
    </>
  );
}

describe('WorkspaceShell · kaydırma çapası geniş adalar yerleşene kadar', () => {
  const originalObserver = window.ResizeObserver;
  const originalScrollY = Object.getOwnPropertyDescriptor(window, 'scrollY');
  let scrollY = 0;
  const observers = new Set<{ notify(): void }>();
  const kare = () => new Promise<void>(resolve => { window.requestAnimationFrame(() => resolve()); });
  const alanUstu = () => document.getElementById(ALAN)!.getBoundingClientRect().top;
  /** Kullanıcı kaydırması: konum değişir, kaydırma olayı gelir, çapa bir sonraki karede kaydedilir. */
  const kullaniciKaydirir = async (y: number) => {
    scrollY = y;
    await act(async () => { window.dispatchEvent(new Event('scroll')); await kare(); await kare(); });
  };
  /** Tarayıcı yerleşimden sonra boyut değişimini bildirir. */
  const yerlesimBildir = () => act(() => { for (const observer of [...observers]) observer.notify(); });

  beforeEach(() => {
    wideGate.release();
    scrollY = 0;
    observers.clear();
    class FakeResizeObserver {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe() { observers.add(this); }
      unobserve() {}
      disconnect() { observers.delete(this); }
      notify() { this.callback([], this as unknown as ResizeObserver); }
    }
    window.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
    Object.defineProperty(window, 'scrollY', { configurable: true, get: () => scrollY });
    // Tarayıcıda scrollBy konumu hemen değiştirir, kaydırma olayı bir sonraki karede gelir.
    vi.spyOn(window, 'scrollBy').mockImplementation(((x?: number | ScrollToOptions, y?: number) => {
      const dy = typeof x === 'number' ? (y ?? 0) : (x?.top ?? 0);
      scrollY = Math.max(0, scrollY + dy);
      window.requestAnimationFrame(() => window.dispatchEvent(new Event('scroll')));
    }) as typeof window.scrollBy);
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => document.getElementById(ALAN) });
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function rect(this: Element) {
      const ust = Number(document.querySelector('[data-ust]')?.getAttribute('data-ust') ?? 0);
      const alan = this.id === ALAN;
      const icerik = this.matches('main, .aile-admin-main-inner');
      const top = alan ? ust - scrollY : icerik ? -scrollY : 0;
      const height = alan ? 3000 : icerik ? ust + 3000 : 0;
      return { x: 0, y: top, top, left: 0, width: 1000, height, right: 1000, bottom: top + height, toJSON: () => ({}) } as DOMRect;
    });
  });
  afterEach(() => {
    window.ResizeObserver = originalObserver;
    if (originalScrollY) Object.defineProperty(window, 'scrollY', originalScrollY);
    else delete (window as { scrollY?: number }).scrollY;
    delete (document as { elementFromPoint?: unknown }).elementFromPoint;
    vi.restoreAllMocks();
  });

  it('an island that settles after the side navigation keeps the anchored content where the user left it', async () => {
    const gate = kapi();
    const ada = adaKaynagi(gate);
    const viewport = installViewport(PHONE);
    render(<WorkspaceShell location="/alimlar"><AdaliSayfa ada={ada} /></WorkspaceShell>);
    await kullaniciKaydirir(UST_DAR - 300);
    expect(alanUstu()).toBe(300);

    act(() => viewport.set(DESKTOP));
    await sideNav();
    expect(alanUstu(), 'yan gezinme geldi, ada hâlâ yükleniyor').toBe(300);

    // Ada yerleşir: üstteki içerik 1600 px büyür (yan gezinmeden sonra; kabuk yerleşim anahtarı değişmez).
    await act(async () => { gate.ac(); await ada.load(); });
    yerlesimBildir();
    expect(alanUstu(), 'ada yerleşince çapa korunmadı').toBe(300);
  });

  it('a user scroll while the island loads becomes the new anchor; once the islands settle the hold ends', async () => {
    const gate = kapi();
    const ada = adaKaynagi(gate);
    const viewport = installViewport(PHONE);
    render(<WorkspaceShell location="/alimlar"><AdaliSayfa ada={ada} /></WorkspaceShell>);
    await kullaniciKaydirir(UST_DAR - 300);

    act(() => viewport.set(DESKTOP));
    await sideNav();
    // Yükleme sürerken kullanıcı 100 px daha kaydırır: yeni konum onun seçimidir, eski çapaya geri çekilmez.
    await kullaniciKaydirir(scrollY + 100);
    expect(alanUstu()).toBe(200);

    await act(async () => { gate.ac(); await ada.load(); });
    yerlesimBildir();
    expect(alanUstu(), 'kullanıcının yeni çapası korunmadı').toBe(200);

    // Adalar yerleşti ve boyut bildirimi sustu: tutma biter. Sonraki içerik değişimi (ör. kullanıcının açtığı bölüm)
    // kabuk tarafından geri çekilmez.
    await act(async () => { for (let i = 0; i < 4; i += 1) await kare(); });
    const once = scrollY;
    document.querySelector('[data-ust]')!.setAttribute('data-ust', String(UST_GENIS + 500));
    yerlesimBildir();
    expect(scrollY, 'tutma bitmedi: kabuk sonraki değişimi de geri çekti').toBe(once);
  });

  it('a route change ends the hold: the new page is not pulled back to the previous page anchor', async () => {
    const gate = kapi();
    const ada = adaKaynagi(gate);
    const viewport = installViewport(PHONE);
    const view = render(<WorkspaceShell location="/alimlar"><AdaliSayfa ada={ada} /></WorkspaceShell>);
    await kullaniciKaydirir(UST_DAR - 300);
    act(() => viewport.set(DESKTOP));
    await sideNav();

    view.rerender(<WorkspaceShell location="/genel"><AdaliSayfa ada={ada} /></WorkspaceShell>);
    const once = scrollY;
    await act(async () => { gate.ac(); await ada.load(); });
    yerlesimBildir();
    expect(scrollY, 'rota değişti ama kabuk eski çapaya kaydırdı').toBe(once);
  });
});

// --- Teslim sınırı: telefon kabuğu antd yüzeyine statik bağlanmaz; geniş gezinme yalnız lazyWide ile ---------------

describe('WorkspaceShell · teslim sınırı (kaynak)', () => {
  const shellDir = resolve(__dirname);
  const read = (name: string) => readFileSync(resolve(shellDir, name), 'utf8');
  const PHONE_FILES = ['WorkspaceShell.tsx', 'MobileNavDrawer.tsx'];

  it.each(PHONE_FILES)('%s imports no antd surface, ui wrapper, icon package or wide module statically', name => {
    const offending = importsOf(read(name))
      .filter(ref => ref.kind === 'static' && !ref.typeOnly)
      .map(ref => ref.specifier)
      .filter(specifier => isAntdSurface(specifier) || /^@phosphor-icons\//.test(specifier) || /^echarts/.test(specifier) || /\.wide$/.test(specifier) || /(^|\/)wide\//.test(specifier));
    expect(offending).toEqual([]);
  });

  it('loads the side navigation only through a literal lazyWide import of a *.wide module with a default export', () => {
    const shell = read('WorkspaceShell.tsx');
    expect(shell).toMatch(/lazyWide\(\s*'shell-nav'\s*,\s*\(\)\s*=>\s*import\('\.\/wide\/WorkspaceNav\.wide'\)\s*\)/);
    expect(wideRuleViolations('src/admin/shell/WorkspaceShell.tsx', shell)).toEqual([]);
    expect(wideRuleViolations('src/admin/shell/wide/WorkspaceNav.wide.tsx', read('wide/WorkspaceNav.wide.tsx'))).toEqual([]);
  });
});

// --- Kabuk stilleri (kaynak): b04 yoğunluk/dokunma/güvenli alan tokenları; genişlik medya sorgusu ve sabit renk yok ---

describe('WorkspaceShell · stil sözleşmesi (kaynak)', () => {
  const shellDir = resolve(__dirname);
  const CSS_FILES = ['shell.css', 'wide/WorkspaceNav.wide.css'];
  const css = (name: string) => readFileSync(resolve(shellDir, name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  /** Kural gövdesi: seçici listesinde tam olarak bu seçici bulunan ilk blok. */
  const block = (source: string, selector: string) => {
    for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selectors = match[1].split(',').map(part => part.trim().replace(/\s+/g, ' '));
      if (selectors.includes(selector)) return match[2];
    }
    return undefined;
  };

  it.each(CSS_FILES)('%s reads safe areas from --aile-safe-* and derives no width/height media query', name => {
    const source = css(name);
    expect(source).not.toMatch(/env\(\s*safe-area-inset/);
    expect(source).not.toMatch(/@media[^{]*\b(min|max)-(width|height)\b/);
    expect(source).not.toMatch(/@media[^{]*\borientation\b/);
  });

  it.each(CSS_FILES)('%s uses colour, motion and focus only through tokens (no literal colour, no ring)', name => {
    const source = css(name);
    expect(source).not.toMatch(/#[0-9a-f]{3,8}\b|\b(rgba?|hsla?)\(/i);
    for (const [, value] of source.matchAll(/transition\s*:\s*([^;]+);/g)) {
      for (const part of value.split(',').map(item => item.trim()).filter(item => item !== 'none')) {
        expect(part, `transition "${part}"`).toMatch(/^[a-z-]+ var\(--aile-sure\) var\(--aile-egri\)$/);
      }
    }
    expect(source).not.toMatch(/\boutline\s*:\s*(?!none)/);
    expect(source).not.toMatch(/:focus[^{]*\{[^}]*box-shadow/);
  });

  it('page side margin is the density token plus the safe area, on the main content and the top bar alike', () => {
    const source = css('shell.css');
    const main = block(source, '.aile-admin .aile-admin-main') ?? '';
    expect(main).toMatch(/calc\(var\(--aile-yogunluk-kenar\) \+ var\(--aile-safe-left\)\)/);
    expect(main).toMatch(/calc\(var\(--aile-yogunluk-kenar\) \+ var\(--aile-safe-right\)\)/);
    const bar = block(source, '.aile-admin .aile-admin-topbar') ?? '';
    expect(bar).toMatch(/calc\(var\(--aile-yogunluk-kenar\) \+ var\(--aile-safe-left\)\)/);
    expect(bar).toMatch(/var\(--aile-safe-top\)/);
    // Profil bantları yalnız tokenda: kabuk tablet/masaüstü için ayrı kenar yazmaz.
    expect(source).not.toMatch(/\[data-profile=[^\]]+\][^{]*\.aile-admin-main\s*\{[^}]*padding/);
  });

  it('the document scroll padding reserves the top bar: measured height, token derivation until measured; main adds no second offset', () => {
    const source = css('shell.css');
    const root = block(source, ':root:has(.aile-admin .aile-admin-topbar)') ?? '';
    expect(root).toMatch(/scroll-padding-top:\s*var\(--aile-shell-ust-olcu,\s*calc\(var\(--aile-hedef-asgari\) \+ var\(--aile-bosluk-3\) \+ var\(--aile-safe-top\)\)\)/);
    expect(block(source, '.aile-admin .aile-admin-main') ?? '').not.toMatch(/scroll-margin/);
  });

  it('touch targets come from the central --aile-dokunma-hedefi token (44, coarse 48)', () => {
    const source = css('shell.css');
    expect(block(source, '.aile-admin .aile-shell-btn')).toMatch(/min-height:\s*var\(--aile-dokunma-hedefi\)/);
    expect(block(source, '.aile-admin .aile-shell-link')).toMatch(/min-height:\s*var\(--aile-dokunma-hedefi\)/);
    expect(source).not.toMatch(/data-input-coarse/);
  });
});
