import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import type { WideOptions } from '../adaptive';
import { importsOf } from '../adaptive/sourceRules';
import type { Device } from '../shell/contracts';
import type { OverflowActionItem } from './OverflowActions';

// Menü düğmesinin tembel gövdesi (Menu.lazy.tsx → import('./Menu.panel')): telefon ilk rotası "Diğer" tetiğini statik,
// açılır gövdeyi (liste, açılır panel, BottomSheet) ilk niyette indirir. Sınanan sözleşme (WorkspaceShell Sayfalar
// çekmecesiyle aynı kalıp): niyet (basma, odak, tuş) indirmeyi başlatır ama açmaz; bekleme sırasındaki açma isteği
// kaybolmaz (aria-expanded + aria-busy; gövde gelince menü açılır, odak niyetteki öğeye gider); Escape, dışarıya basış
// ve düğmeden ayrılan odak isteği iptal eder; indirme bir kez kendiliğinden yeniden denenir, olmazsa kurtarma bildirimi
// ("Menü yüklenemedi · Yeniden dene" ya da sürüm kaymasında "Yeni sürüm var · Yenile"). Telefon yolu gerçek BottomSheet
// ile (kipli diyalog, odak dönüşü). Gövde yüklendikten sonraki davranış Menu.test.tsx ve OverflowActions.test.tsx'te.
//
// İndirme denetimi: lazyResource'un içe aktarıcısı sarılır (gerçek import('./Menu.panel') çağrılır): her çağrı sayılır,
// plan adımı 'hold' ise serbest bırakılana dek bekler, Error ise reddedilir. Kendiliğinden yeniden deneme beklemesi 0.
// Kaynak modül düzeyinde tektir; her test modülleri sıfırlayıp yeniden içe aktarır (taze, boşta kaynak).

const gate = vi.hoisted(() => ({ epoch: 0, calls: 0, plan: [] as Array<'ok' | 'hold' | Error>, held: [] as Array<() => void> }));

vi.mock('../adaptive', async importOriginal => {
  const actual = await importOriginal<typeof import('../adaptive')>();
  return {
    ...actual,
    // Kayıt anahtara göredir ve sahte modül sıfırlamadan sonra da aynı kaydı tutabilir: her taze grafik yeni anahtar alır.
    lazyResource: <M,>(key: string, importer: () => Promise<M>, options: WideOptions = {}) =>
      actual.lazyResource(`${key}#${gate.epoch}`, async () => {
        gate.calls += 1;
        const step = gate.plan.shift() ?? 'ok';
        if (step instanceof Error) throw step;
        if (step === 'hold') await new Promise<void>(resolve => { gate.held.push(resolve); });
        return importer();
      }, { ...options, retryDelayMs: 0 }),
  };
});
vi.mock('../adaptive/reload', () => ({ reloadPage: vi.fn() }));

const CHUNK_ERROR = () => new TypeError('Failed to fetch dynamically imported module: http://127.0.0.1/aile/assets/Menu.panel-x.js');

function makeItems() {
  const duzenle = vi.fn();
  const sil = vi.fn();
  const items: readonly OverflowActionItem[] = [
    { label: 'Düzenle', icon: 'edit', onClick: duzenle },
    { label: 'Sil', onClick: sil, danger: true },
    { label: 'Dışa aktar', icon: 'download' },
  ];
  return { items, duzenle, sil };
}

/** Taze modül grafiği: boşta gövde kaynağı, aynı grafikten profil bağlamı ve sayfa yenileme taklidi. */
async function fresh() {
  vi.resetModules();
  gate.epoch += 1;
  gate.calls = 0;
  gate.plan = [];
  gate.held = [];
  // Sırayla: sahte modül fabrikası eşzamanlı iki içe aktarmada iki kez çalışabilir (iki ayrı taklit).
  const { OverflowActions } = await import('./OverflowActions');
  const { loadMenuPanel } = await import('./Menu.lazy');
  const { DeviceContext } = await import('../device');
  const { reloadPage } = await import('../adaptive/reload');
  const wrap = (device: Device) => ({ children }: { children: ReactNode }) =>
    <DeviceContext.Provider value={device}>{children}</DeviceContext.Provider>;
  return { OverflowActions, loadMenuPanel, wrap, reloadPage: vi.mocked(reloadPage) };
}

/** Bekleyen indirmeleri bırakır ve sonucu (React güncellemeleri dahil) bekler. */
const release = () => act(async () => {
  for (const resolve of gate.held.splice(0)) resolve();
  await new Promise(resolve => setTimeout(resolve, 0));
});

const trigger = () => screen.getByRole('button', { name: 'Diğer' });

describe('Menu.lazy › niyet ve ilk açılış (gövde tembel)', () => {
  it('render downloads nothing; a pointerdown is intent only (no open), a pointercancel opens nothing, the click opens on the first item', async () => {
    const { OverflowActions, loadMenuPanel, wrap } = await fresh();
    const user = userEvent.setup();
    render(<OverflowActions items={makeItems().items} />, { wrapper: wrap('desktop') });
    expect(gate.calls).toBe(0);
    expect(trigger()).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');

    // Dokunma kaydırmaya dönüştü: tarayıcı pointercancel yayar, click üretmez. Gövde iner, menü açılmaz.
    fireEvent.pointerDown(trigger(), { pointerType: 'touch', button: 0 });
    fireEvent.pointerCancel(trigger(), { pointerType: 'touch' });
    expect(gate.calls).toBe(1);
    // Niyetle başlayan indirme biter (yeni istek yok); menü kendiliğinden açılmaz.
    await act(() => loadMenuPanel());
    expect(gate.calls).toBe(1);
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).toBeNull();

    // Gövde hazır: tıklama menüyü aynı karede açar.
    await user.click(trigger());
    const menu = screen.getByRole('menu', { name: 'Diğer eylemler' });
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    expect(trigger()).toHaveAttribute('aria-controls', menu.id);
    await waitFor(() => expect(within(menu).getByRole('menuitem', { name: 'Düzenle' })).toHaveFocus());
    expect(gate.calls).toBe(1);
  });

  it('focus (Tab) on the trigger starts the download without opening; several menus share one download', async () => {
    const { OverflowActions, wrap } = await fresh();
    const user = userEvent.setup();
    gate.plan = ['hold'];
    render(
      <>
        <button type="button">Önce</button>
        <OverflowActions items={makeItems().items} label="Diğer" />
        <OverflowActions items={makeItems().items} label="Daha fazla" />
      </>,
      { wrapper: wrap('desktop') },
    );
    screen.getByRole('button', { name: 'Önce' }).focus();
    await user.tab();
    expect(trigger()).toHaveFocus();
    expect(gate.calls).toBe(1);
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(trigger()).not.toHaveAttribute('aria-busy');
    await user.tab();
    expect(screen.getByRole('button', { name: 'Daha fazla' })).toHaveFocus();
    await release();
    await user.click(screen.getByRole('button', { name: 'Daha fazla' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(gate.calls).toBe(1);
  });

  it('phone: a press during the download is not lost — aria-expanded + aria-busy, a second press is ignored, then the sheet opens on the first item', async () => {
    const { OverflowActions, wrap } = await fresh();
    const user = userEvent.setup();
    const { items, duzenle } = makeItems();
    gate.plan = ['hold'];
    render(<><OverflowActions items={items} /><p>Arka plan</p></>, { wrapper: wrap('phone') });
    expect(trigger()).toHaveAttribute('aria-haspopup', 'dialog');

    await user.click(trigger());
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    expect(trigger()).toHaveAttribute('aria-busy', 'true');
    expect(trigger()).not.toHaveAttribute('aria-controls');
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(trigger());
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');

    await release();
    const sheet = await screen.findByRole('dialog', { name: 'Diğer eylemler' });
    expect(sheet).toHaveAttribute('aria-modal', 'true');
    const first = within(sheet).getByRole('menuitem', { name: 'Düzenle' });
    await waitFor(() => expect(first).toHaveFocus());
    expect(trigger()).not.toHaveAttribute('aria-busy');
    expect(gate.calls).toBe(1);

    // Kipli alt sayfa: arka plan erişilemez; seçim kapatır, odak düğmeye döner, sonra eylem çalışır.
    expect(screen.getByText('Arka plan').closest('[inert]')).not.toBeNull();
    await user.keyboard('{Enter}');
    expect(duzenle).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(trigger()).toHaveFocus();
    expect(screen.getByText('Arka plan').closest('[inert]')).toBeNull();
  });

  it('keyboard during the download: ArrowUp opens on the last item, ArrowDown/Enter/Space on the first', async () => {
    const { OverflowActions, wrap } = await fresh();
    const user = userEvent.setup();
    gate.plan = ['hold'];
    render(<OverflowActions items={makeItems().items} />, { wrapper: wrap('desktop') });
    trigger().focus();
    await user.keyboard('{ArrowUp}');
    expect(trigger()).toHaveAttribute('aria-busy', 'true');
    await release();
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Sil' })).toHaveFocus());
    await user.keyboard('{Escape}');
    expect(trigger()).toHaveFocus();
    for (const key of ['{ArrowDown}', '{Enter}', ' ']) {
      await user.keyboard(key);
      await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Düzenle' })).toHaveFocus());
      await user.keyboard('{Escape}');
      expect(trigger()).toHaveAttribute('aria-expanded', 'false');
      expect(trigger()).toHaveFocus();
    }
    expect(gate.calls).toBe(1);
  });

  it('Escape during the download cancels the request (focus stays on the button, nothing reaches an outer layer); the late body does not open', async () => {
    const { OverflowActions, wrap } = await fresh();
    const user = userEvent.setup();
    const outer = vi.fn();
    gate.plan = ['hold'];
    render(
      <div onKeyDown={event => { if (event.key === 'Escape') outer(); }}><OverflowActions items={makeItems().items} /></div>,
      { wrapper: wrap('phone') },
    );
    trigger().focus();
    await user.keyboard('{Enter}');
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{Escape}');
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(trigger()).not.toHaveAttribute('aria-busy');
    expect(trigger()).toHaveFocus();
    expect(outer).not.toHaveBeenCalled();
    await release();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger()).toHaveFocus();
  });

  it.each<Device>(['phone', 'desktop'])('%s: Shift+Tab away from the button during the download cancels the request; focus stays where it went', async device => {
    const { OverflowActions, wrap } = await fresh();
    const user = userEvent.setup();
    gate.plan = ['hold'];
    render(<><button type="button">Önce</button><OverflowActions items={makeItems().items} /></>, { wrapper: wrap(device) });
    trigger().focus();
    await user.keyboard('{Enter}');
    expect(trigger()).toHaveAttribute('aria-busy', 'true');
    await user.tab({ shift: true });
    const before = screen.getByRole('button', { name: 'Önce' });
    expect(before).toHaveFocus();
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    await release();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(before).toHaveFocus();
  });

  it.each<Device>(['phone', 'desktop'])('%s: a pointerdown outside during the download cancels the request', async device => {
    const { OverflowActions, wrap } = await fresh();
    const user = userEvent.setup();
    gate.plan = ['hold'];
    render(<><OverflowActions items={makeItems().items} /><p>Dışarı</p></>, { wrapper: wrap(device) });
    await user.click(trigger());
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    fireEvent.pointerDown(screen.getByText('Dışarı'), { pointerType: 'touch' });
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    await release();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('Menu.lazy › indirme hatası ve kurtarma', () => {
  it('after one automatic retry: "Menü yüklenemedi · Yeniden dene"; retrying keeps focus on the button and opens on the first item', async () => {
    const { OverflowActions, wrap } = await fresh();
    const user = userEvent.setup();
    gate.plan = [new Error('ağ yok'), new Error('ağ yok'), 'hold'];
    render(<OverflowActions items={makeItems().items} />, { wrapper: wrap('phone') });
    await user.click(trigger());

    const notice = await screen.findByRole('status');
    expect(notice).toHaveTextContent('Menü yüklenemedi.');
    expect(gate.calls).toBe(2);
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(trigger()).not.toHaveAttribute('aria-busy');
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.click(within(notice).getByRole('button', { name: 'Yeniden dene' }));
    expect(screen.queryByRole('status')).toBeNull();
    expect(trigger()).toHaveFocus();
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    expect(trigger()).toHaveAttribute('aria-busy', 'true');
    await release();
    const sheet = await screen.findByRole('dialog', { name: 'Diğer eylemler' });
    await waitFor(() => expect(within(sheet).getByRole('menuitem', { name: 'Düzenle' })).toHaveFocus());
    expect(gate.calls).toBe(3);
  });

  it('with the notice shown, pressing "Diğer" again retries as well; Escape dismisses the notice', async () => {
    const { OverflowActions, wrap } = await fresh();
    const user = userEvent.setup();
    gate.plan = [new Error('ağ yok'), new Error('ağ yok'), new Error('ağ yok'), new Error('ağ yok')];
    render(<OverflowActions items={makeItems().items} />, { wrapper: wrap('desktop') });
    await user.click(trigger());
    await screen.findByRole('status');
    // Odak düğmeye dönünce (niyet) hata durumunda kendiliğinden yeniden denenmez.
    trigger().blur();
    trigger().focus();
    expect(gate.calls).toBe(2);
    await user.click(trigger());
    await waitFor(() => expect(gate.calls).toBe(4));
    expect(await screen.findByRole('status')).toHaveTextContent('Menü yüklenemedi.');
    trigger().focus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('status')).toBeNull();
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    await user.click(trigger());
    expect(await screen.findByRole('menu')).toBeInTheDocument();
    expect(gate.calls).toBe(5);
  });

  it('a chunk error while online is a stale build: "Yeni sürüm var · Yenile" reloads the page', async () => {
    const { OverflowActions, wrap, reloadPage } = await fresh();
    const user = userEvent.setup();
    gate.plan = [CHUNK_ERROR(), CHUNK_ERROR()];
    render(<OverflowActions items={makeItems().items} />, { wrapper: wrap('phone') });
    await user.click(trigger());
    const notice = await screen.findByRole('status');
    expect(notice).toHaveTextContent('Yeni sürüm var');
    expect(notice).toHaveAttribute('data-kind', 'stale-build');
    await user.click(within(notice).getByRole('button', { name: 'Yenile' }));
    expect(reloadPage).toHaveBeenCalledTimes(1);
  });
});

describe('Menu.lazy › kaynak ve görsel sözleşme', () => {
  const read = (name: string) => readFileSync(resolve(__dirname, name), 'utf8');

  it('the trigger module imports no antd and no menu body statically; it imports the body only through import("./Menu.panel")', () => {
    const refs = importsOf(read('Menu.lazy.tsx'));
    const runtime = refs.filter(ref => ref.kind === 'static' && !ref.typeOnly).map(ref => ref.specifier);
    expect(runtime.filter(specifier => /^(antd|@ant-design)(\/|$)|(^|\/)antd$|antdTheme$/.test(specifier))).toEqual([]);
    expect(runtime.filter(specifier => /^\.\/(Menu|Menu\.panel|BottomSheet|BottomSheet\.layer)$/.test(specifier))).toEqual([]);
    expect([...new Set(refs.filter(ref => ref.kind === 'dynamic').map(ref => ref.specifier))]).toEqual(['./Menu.panel']);
    for (const file of ['Menu.shared.ts', 'Menu.panel.tsx']) {
      const statics = importsOf(read(file)).filter(ref => ref.kind === 'static').map(ref => ref.specifier);
      expect(statics.filter(specifier => /^(antd|@ant-design)(\/|$)|(^|\/)antd$/.test(specifier)), file).toEqual([]);
    }
  });

  it('Menu.lazy.css: tokens only, no colour, border, shadow, outline or motion; the button is the central Button (44/48 px touch token)', () => {
    const css = read('Menu.lazy.css').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
    expect(css).not.toMatch(/\b(outline|box-shadow|border(-[a-z-]+)?|transition|animation|font-size)\s*:/);
    for (const match of css.matchAll(/:\s*([^;{}]+);/g)) {
      const value = match[1].trim();
      if (/\d/.test(value.replace(/var\(--aile-[a-z0-9-]+\)/g, '').replace(/(?<![\w-])(?:0|1|100%)(?![\w%-])/g, ''))) {
        throw new Error(`sabit ölçü: ${value}`);
      }
    }
    // Düğme merkezi Button'dır (dokunma hedefi --aile-dokunma-hedefi: 44 px, kaba işaretçide 48 px).
    expect(read('Menu.lazy.tsx')).toMatch(/<Button\b/);
    expect(read('Button.css')).toMatch(/min-height:\s*var\(--aile-dokunma-hedefi\)/);
  });
});
