import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useEffect, useState } from 'react';
import { wideManifest } from '../adaptive';
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

  it('touch targets come from the central --aile-dokunma-hedefi token (44, coarse 48)', () => {
    const source = css('shell.css');
    expect(block(source, '.aile-admin .aile-shell-btn')).toMatch(/min-height:\s*var\(--aile-dokunma-hedefi\)/);
    expect(block(source, '.aile-admin .aile-shell-link')).toMatch(/min-height:\s*var\(--aile-dokunma-hedefi\)/);
    expect(source).not.toMatch(/data-input-coarse/);
  });
});
