import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { DeviceContext } from '../device';
import type { Device } from '../shell/contracts';
import { FilterArea } from './FilterArea';

// Kaynak: aile-tasarim/tasarim-sistemi/components/FilterArea/README.md + index.d.ts FilterAreaProps + bundle.js FilterArea
// (+ bundle.css › "Filtre alanı"). Masaüstünde filtre paneli açık (272) ya da 56 px şerit (Funnel + "Filtre" + etkin sayı);
// şerit tıklanınca panel açılır, panelin üstünde "Paneli gizle". defaultOpen'ı çağıran moda göre verir. detail sağda 384.
// Tablet ve telefonda yalnız children (filtre çekmecesi başka yerde). Seçiciler role/label ile; antd iç sınıfı yok.

const read = (file: string) => readFileSync(resolve(__dirname, file), 'utf8');
const PANEL = <p>Oda · Kategori · Aşama</p>;
const SONUCLAR = <p>12 alım</p>;
const AYRINTI = <p>Koltuk takımı ayrıntısı</p>;

function renderArea(ui: ReactNode, device: Device = 'desktop') {
  return render(<DeviceContext.Provider value={device}>{ui}</DeviceContext.Provider>);
}
const serit = (name: string | RegExp = /^Filtreleri göster/) => screen.queryByRole('button', { name });
const gizle = () => screen.queryByRole('button', { name: 'Paneli gizle' });
// Gizli (hidden) öğenin erişilebilir adı boştur (accname 2A); bölge, ona işaret eden düğmenin aria-controls id'siyle bulunur.
const bolge = () => {
  const region = screen.getByRole('region', { hidden: true });
  expect(region).toHaveAttribute('aria-label', 'Filtreler');
  const controller = serit() ?? gizle();
  expect(controller).not.toBeNull();
  expect(controller).toHaveAttribute('aria-controls', region.id);
  return region;
};

// Sağlayıcı yokken useDevice matchMedia'ya bakar; (min-width: Npx) sorgularını verilen genişliğe göre çözer.
function viewport(width: number) {
  window.matchMedia = vi.fn().mockImplementation((media: string) => {
    const match = media.match(/min-width:\s*(\d+)px/);
    return {
      matches: match ? width >= Number(match[1]) : false,
      media,
      onchange: null,
      addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    };
  }) as unknown as typeof window.matchMedia;
}

describe('FilterArea (filtre alanı)', () => {
  const originalMatchMedia = window.matchMedia;
  afterEach(() => { window.matchMedia = originalMatchMedia; });

  it('masaüstünde varsayılan açık: Filtreler bölgesi görünür, "Paneli gizle" aria-expanded=true ve bölgeyi kontrol eder, şerit yok', () => {
    renderArea(<FilterArea panel={PANEL} count={2}>{SONUCLAR}</FilterArea>);
    const region = bolge();
    expect(region).not.toHaveAttribute('hidden');
    expect(region).not.toHaveAttribute('inert');
    expect(screen.getByText('Oda · Kategori · Aşama')).toBeVisible();
    expect(screen.getByText('12 alım')).toBeVisible();

    const hide = gizle();
    expect(hide).not.toBeNull();
    expect(hide).toHaveAttribute('type', 'button');
    expect(hide).toHaveAttribute('aria-expanded', 'true');
    expect(hide).toHaveAttribute('aria-controls', region.id);
    expect(serit()).toBeNull();
  });

  it('defaultOpen=false: 56 px şerit düğmesi Funnel + "Filtre" + sayı; aria-expanded=false; panel bölgesi hidden+inert', () => {
    renderArea(<FilterArea panel={PANEL} defaultOpen={false} count={2}>{SONUCLAR}</FilterArea>);
    const rail = serit('Filtreleri göster, 2 etkin');
    expect(rail).not.toBeNull();
    expect(rail).toHaveAttribute('type', 'button');
    expect(rail).toHaveAttribute('aria-expanded', 'false');
    const region = bolge();
    expect(rail).toHaveAttribute('aria-controls', region.id);
    expect(region).toHaveAttribute('hidden');
    expect(region).toHaveAttribute('inert');
    expect(screen.getByText('Oda · Kategori · Aşama')).not.toBeVisible();
    expect(gizle()).toBeNull();

    // Görünür metin "Filtre" erişilebilir adın parçası (etiket adda); sayı rozeti ayrı görünür metin.
    expect(rail).toHaveTextContent(/^Filtre2$/);
    expect(screen.getByText('2')).toBeVisible();
    const icon = rail!.querySelector('svg[data-icon="filter"]');
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    // Odak çizgisini admin.css çizer ([data-focus-line]); sonuçlar yine görünür.
    expect(rail).toHaveAttribute('data-focus-line');
    expect(screen.getByText('12 alım')).toBeVisible();
  });

  it('etkin filtre yoksa (count yok / 0) şeritte sayı rozeti ve ", N etkin" eki yoktur', () => {
    const { rerender } = renderArea(<FilterArea panel={PANEL} defaultOpen={false}>{SONUCLAR}</FilterArea>);
    expect(serit('Filtreleri göster')).toHaveTextContent(/^Filtre$/);
    rerender(<DeviceContext.Provider value="desktop"><FilterArea panel={PANEL} defaultOpen={false} count={0}>{SONUCLAR}</FilterArea></DeviceContext.Provider>);
    expect(serit('Filtreleri göster')).toHaveTextContent(/^Filtre$/);
    expect(screen.queryByText('0')).toBeNull();
  });

  it('şerit tıklanınca panel açılır ve odak "Paneli gizle"ye geçer; "Paneli gizle" tıklanınca şerit döner ve odağı alır', async () => {
    const user = userEvent.setup();
    renderArea(<FilterArea panel={PANEL} defaultOpen={false} count={3}>{SONUCLAR}</FilterArea>);
    const region = bolge();

    await user.click(serit()!);
    expect(serit()).toBeNull();
    expect(region).not.toHaveAttribute('hidden');
    expect(region).not.toHaveAttribute('inert');
    expect(gizle()).toHaveAttribute('aria-expanded', 'true');
    expect(gizle()).toHaveFocus();
    expect(screen.getByText('Oda · Kategori · Aşama')).toBeVisible();

    await user.click(gizle()!);
    expect(gizle()).toBeNull();
    expect(region).toHaveAttribute('hidden');
    expect(region).toHaveAttribute('inert');
    const rail = serit('Filtreleri göster, 3 etkin');
    expect(rail).toHaveAttribute('aria-expanded', 'false');
    expect(rail).toHaveFocus();
    // Sonuçlar iki durumda da yerinde kalır.
    expect(screen.getByText('12 alım')).toBeVisible();
  });

  it('klavyede Enter şeridi açar, Space paneli gizler', async () => {
    const user = userEvent.setup();
    renderArea(<FilterArea panel={PANEL} defaultOpen={false}>{SONUCLAR}</FilterArea>);
    serit()!.focus();
    await user.keyboard('{Enter}');
    expect(gizle()).toHaveAttribute('aria-expanded', 'true');
    expect(gizle()).toHaveFocus();
    await user.keyboard('[Space]');
    expect(serit()).toHaveAttribute('aria-expanded', 'false');
    expect(serit()).toHaveFocus();
  });

  it('detail verilirse masaüstünde sağ ayrıntı sütunu çizilir; verilmezse yoktur', () => {
    const { rerender } = renderArea(<FilterArea panel={PANEL} detail={AYRINTI}>{SONUCLAR}</FilterArea>);
    expect(screen.getByText('Koltuk takımı ayrıntısı')).toBeVisible();
    expect(screen.getByText('Koltuk takımı ayrıntısı').closest('[data-detail]')).not.toBeNull();
    rerender(<DeviceContext.Provider value="desktop"><FilterArea panel={PANEL}>{SONUCLAR}</FilterArea></DeviceContext.Provider>);
    expect(screen.queryByText('Koltuk takımı ayrıntısı')).toBeNull();
    expect(document.querySelector('[data-detail]')).toBeNull();
  });

  it.each(['tablet', 'phone'] as const)('%s: panel null ise (sayfa kendi çekmecesini kullanıyor) yalnız children; tetik, şerit ve ayrıntı yok', device => {
    renderArea(<FilterArea panel={null} count={2} detail={AYRINTI}>{SONUCLAR}</FilterArea>, device);
    expect(screen.getByText('12 alım')).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Filtreler', hidden: true })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Filtre/ })).toBeNull();
    expect(gizle()).toBeNull();
    expect(screen.queryByText('Koltuk takımı ayrıntısı')).toBeNull();
  });

  it.each(['tablet', 'phone'] as const)('%s: panel verilince etkin sayılı "Filtreler" tetiği; panel alt sayfada ve kapalı başlar; ayrıntı çizilmez', device => {
    renderArea(<FilterArea panel={PANEL} count={2} detail={AYRINTI}>{SONUCLAR}</FilterArea>, device);
    const trigger = screen.getByRole('button', { name: 'Filtreler, 2 etkin' });
    expect(trigger).toHaveAttribute('type', 'button');
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveAttribute('data-focus-line');
    expect(trigger).toHaveTextContent(/^Filtreler2$/);
    expect(trigger.querySelector('svg[data-icon="filter"]')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('12 alım')).toBeVisible();
    expect(screen.queryByText('Oda · Kategori · Aşama')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('Koltuk takımı ayrıntısı')).toBeNull();
    expect(serit()).toBeNull();
  });

  it('telefon: etkin filtre yoksa ad yalnız "Filtreler", rozet yok', () => {
    renderArea(<FilterArea panel={PANEL} count={0}>{SONUCLAR}</FilterArea>, 'phone');
    const trigger = screen.getByRole('button', { name: 'Filtreler' });
    expect(trigger).toHaveTextContent(/^Filtreler$/);
    expect(screen.queryByText('0')).toBeNull();
  });

  it('telefon: tetik "Filtreler" alt sayfasını açar; içerik panel; "N sonucu göster" kapatır ve odak tetiğe döner', async () => {
    const user = userEvent.setup();
    renderArea(<FilterArea panel={PANEL} count={2} resultCount={1240}>{SONUCLAR}</FilterArea>, 'phone');
    const trigger = screen.getByRole('button', { name: 'Filtreler, 2 etkin' });
    await user.click(trigger);
    const sheet = screen.getByRole('dialog', { name: 'Filtreler' });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(within(sheet).getByText('Oda · Kategori · Aşama')).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: '1.240 sonucu göster' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('telefon: resultCount yoksa altlık "Sonuçları göster"; Escape kapatır ve odak tetiğe döner', async () => {
    const user = userEvent.setup();
    renderArea(<FilterArea panel={PANEL}>{SONUCLAR}</FilterArea>, 'phone');
    const trigger = screen.getByRole('button', { name: 'Filtreler' });
    trigger.focus();
    await user.keyboard('{Enter}');
    const sheet = screen.getByRole('dialog', { name: 'Filtreler' });
    expect(within(sheet).getByRole('button', { name: 'Sonuçları göster' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('Pointer Events: tetik ve şerit basılı durumu pointercancel ile silinir; tıklama olmadan açılmaz', () => {
    const { unmount } = renderArea(<FilterArea panel={PANEL} count={1}>{SONUCLAR}</FilterArea>, 'phone');
    const trigger = screen.getByRole('button', { name: 'Filtreler, 1 etkin' });
    fireEvent.pointerDown(trigger, { pointerType: 'touch', button: 0, isPrimary: true });
    expect(trigger).toHaveAttribute('data-pressed', 'true');
    fireEvent.pointerCancel(trigger, { pointerType: 'touch' });
    expect(trigger).not.toHaveAttribute('data-pressed');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    unmount();

    renderArea(<FilterArea panel={PANEL} defaultOpen={false}>{SONUCLAR}</FilterArea>, 'desktop');
    const rail = serit()!;
    fireEvent.pointerDown(rail, { pointerType: 'touch', button: 0, isPrimary: true });
    expect(rail).toHaveAttribute('data-pressed', 'true');
    fireEvent.pointerCancel(rail, { pointerType: 'touch' });
    expect(rail).not.toHaveAttribute('data-pressed');
    expect(rail).toHaveAttribute('aria-expanded', 'false');
  });

  it('CSS: tetik ve şerit 44 px, kaba işaretçide 48 px; basılı durum secili; antd sınıf seçicisi yok', () => {
    const css = read('FilterArea.css');
    expect(css).toMatch(/--aile-filtre-hedef:\s*var\(--aile-hedef-asgari\)/);
    expect(css).toMatch(/\[data-input-coarse\][^{]*\{[^}]*--aile-filtre-hedef:\s*calc\(var\(--aile-hedef-asgari\)\s*\+\s*var\(--aile-bosluk-1\)\)/);
    expect(css).toMatch(/\.aile-filtre-alani-tetik\s*\{[^}]*min-height:\s*var\(--aile-filtre-hedef\)/);
    expect(css).toMatch(/\.aile-filtre-alani-serit\s*\{[^}]*min-width:\s*var\(--aile-filtre-hedef\)/);
    expect(css).toMatch(/\.aile-filtre-alani-tetik\[data-pressed='true'\]/);
    expect(css).toMatch(/\.aile-filtre-alani-serit\[data-pressed='true'\]/);
    expect(css).not.toMatch(/\.ant-/);
  });

  it('sağlayıcı yokken cihazı matchMedia belirler: 1280 px masaüstü (panel var), 800 px tablet (tetik + alt sayfa)', () => {
    viewport(1280);
    const wide = render(<FilterArea panel={PANEL}>{SONUCLAR}</FilterArea>);
    expect(screen.getByRole('region', { name: 'Filtreler' })).toBeVisible();
    wide.unmount();

    viewport(800);
    render(<FilterArea panel={PANEL}>{SONUCLAR}</FilterArea>);
    expect(screen.queryByRole('region', { name: 'Filtreler', hidden: true })).toBeNull();
    expect(screen.getByRole('button', { name: 'Filtreler' })).toBeVisible();
    expect(screen.getByText('12 alım')).toBeVisible();
  });

  it('kaynak kuralları: antd Layout.Sider yok, ham antd importu yok, CSS tokenlardan beslenir, halka/outline yok', () => {
    const tsx = read('FilterArea.tsx');
    // Yorumlar dışındaki kodda Layout/Sider yok (envanterdeki eşleme bilinçli olarak kullanılmadı; gerekçe yorumda).
    const code = tsx.replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/\bSider\b|\bLayout\b/);
    expect(code).not.toMatch(/from\s+['"](antd|@ant-design\/|@phosphor-icons\/)/);
    expect(code).not.toMatch(/from\s+['"]\.{1,2}\/antd['"]/);
    expect(code).not.toMatch(/\.wide['"]/);
    expect(tsx).toContain("import './FilterArea.css'");

    const css = read('FilterArea.css');
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/^\s*(outline|box-shadow)\s*:/m);
    expect(css).toMatch(/var\(--aile-filtre-genislik\)/);
    expect(css).toMatch(/var\(--aile-ayrinti-genislik\)/);
    expect(css).toMatch(/var\(--aile-sure\)/);
    expect(css).toMatch(/var\(--aile-egri\)/);
    expect(css).toMatch(/var\(--aile-hedef-asgari\)/);
    expect(css).toMatch(/prefers-reduced-motion: reduce/);
    // Sabit px yalnız 1 px ayırıcı ve şerit ölçülerinin tek yerde tanımlandığı yerel --aile-filtre-* bildirimleri
    // (tokens.json'da şerit tokenı yok; tokens.ts bu görevde salt okunur).
    const withoutLocalVars = css.replace(/^\s*--aile-filtre-[a-z-]+:\s*\d+px;\s*$/gm, '');
    const fixedPx = (withoutLocalVars.match(/\b\d+px\b/g) ?? []).filter(value => value !== '1px');
    expect(fixedPx).toEqual([]);
  });
});
