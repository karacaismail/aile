import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ComponentType, ReactNode } from 'react';
import { installViewport } from '../adaptive/testing';
import { ICON_SIZE } from '../ui/icons';

// Sayfalar çekmecesinin niyet/istek ayrımı (p-fix M1, m2): düğmeye odak ya da işaretçi basma modülü yalnız önyükler;
// açık etkinleştirme (tıklama, bildirimin "Yeniden dene"si) yükler ve açılışı ister. Yükleme düşünce istek kapanır:
// sonradan yalnız odaklanmak modalı açamaz. Bekleyen açılış Escape ya da başka yerde etkileşimle iptal edilir; geç gelen
// modül o anda yapılanı kesmez. Bekleme boyunca düğme aria-busy, kibar (polite) "Sayfalar yükleniyor…" duyurusu ve üst
// çubukta tek ince şerit (halka değil); "Yeniden dene" odağı Sayfalar düğmesine taşır (bildirim sökülünce odak kaybolmaz).
// Kaynak (anahtar 'shell-sayfalar') modül düzeyinde tekildir: her senaryo taze modül grafiğiyle başlar.

const drawer = vi.hoisted(() => ({
  attempts: 0,
  fail: null as Error | null,
  gate: null as Promise<void> | null,
  release: () => {},
}));

function hold() {
  drawer.gate = new Promise<void>(resolve => { drawer.release = () => { drawer.gate = null; resolve(); }; });
}

const PHONE = { width: 320, height: 568, coarse: true };
type Shell = ComponentType<{ location: string; children?: ReactNode }>;

/** Taze modül grafiği: başarılı sahte modül önbelleğe alındığından her senaryo sahteyi yeniden kaydeder (doMock). */
async function freshShell(): Promise<Shell> {
  vi.resetModules();
  vi.doMock('./MobileNavDrawer', async (importOriginal: () => Promise<Record<string, unknown>>) => {
    drawer.attempts += 1;
    if (drawer.gate) await drawer.gate;
    if (drawer.fail) throw drawer.fail;
    return importOriginal();
  });
  const module = await import('./WorkspaceShell');
  return module.WorkspaceShell as Shell;
}

function renderShell(WorkspaceShell: Shell) {
  installViewport(PHONE);
  render(
    <WorkspaceShell location="/genel">
      <p>Genel içeriği</p>
      <button type="button">İçerikteki düğme</button>
    </WorkspaceShell>,
  );
  return {
    main: screen.getByRole('main'),
    button: screen.getByRole('button', { name: 'Sayfalar' }),
    live: () => document.querySelector<HTMLElement>('[aria-live="polite"]'),
  };
}

/** İlk deneme ve tek yeniden deneme (800 ms) düşene kadar bekler. */
const noticeIn = (main: HTMLElement) => within(main).findByRole('status', {}, { timeout: 4000 });

beforeEach(() => {
  drawer.attempts = 0;
  drawer.fail = null;
  drawer.gate = null;
});
afterEach(() => {
  drawer.release();
  document.title = '';
});

describe('WorkspaceShell · Sayfalar niyeti yalnız önyükler (M1)', () => {
  it('after a failed load, focusing Sayfalar again neither retries nor opens the modal', async () => {
    const user = userEvent.setup();
    drawer.fail = new Error('ağ hatası (sınama)');
    const { main, button } = renderShell(await freshShell());

    await user.click(button);
    const notice = await noticeIn(main);
    expect(notice).toHaveTextContent('Sayfalar yüklenemedi.');
    expect(drawer.attempts).toBe(2);
    expect(button).toHaveAttribute('aria-expanded', 'false');

    // Bağlantı geldi; kullanıcı Tab ile Sayfalar'a gelir (yalnız odak): hiçbir şey etkinleştirilmedi.
    drawer.fail = null;
    act(() => { button.blur(); button.focus(); });
    fireEvent.pointerDown(button);
    await new Promise(resolve => { setTimeout(resolve, 1000); });
    expect(drawer.attempts).toBe(2);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(main).not.toHaveAttribute('inert');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(within(main).getByRole('status')).toBe(notice);
  });
});

describe('WorkspaceShell · bekleyen açılış (m2)', () => {
  it('shows a busy state (aria-busy, polite announcement, strip on the bar) and Escape cancels it; the late module opens nothing', async () => {
    const user = userEvent.setup();
    hold();
    const { main, button, live } = renderShell(await freshShell());
    expect(live()).not.toBeNull();
    expect(live()).toHaveTextContent('');
    expect(live()).not.toHaveAttribute('role');

    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(live()).toHaveTextContent('Sayfalar yükleniyor…');
    expect(screen.getByRole('banner')).toHaveAttribute('data-bekliyor');

    await user.keyboard('{Escape}');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).not.toHaveAttribute('aria-busy');
    expect(live()).toHaveTextContent('');
    expect(screen.getByRole('banner')).not.toHaveAttribute('data-bekliyor');

    await act(async () => { drawer.release(); });
    await new Promise(resolve => { setTimeout(resolve, 50); });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(main).not.toHaveAttribute('inert');
    expect(button).toHaveFocus();

    // Modül artık hazır: bir sonraki açık etkinleştirme hemen açar.
    await user.click(button);
    expect(await screen.findByRole('dialog', { name: 'Sayfalar' })).toBeInTheDocument();
  });

  it.each([
    ['pointer on the content', async (user: ReturnType<typeof userEvent.setup>) => { await user.click(screen.getByText('Genel içeriği')); }],
    ['Tab to another control', async (user: ReturnType<typeof userEvent.setup>) => { await user.tab(); }],
  ] as const)('interaction elsewhere (%s) cancels the pending open; the late module does not take focus or make main inert', async (_name, elsewhere) => {
    const user = userEvent.setup();
    hold();
    const { main, button } = renderShell(await freshShell());
    await user.click(button);
    expect(button).toHaveAttribute('aria-busy', 'true');
    await elsewhere(user);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    const focused = document.activeElement;
    await act(async () => { drawer.release(); });
    await new Promise(resolve => { setTimeout(resolve, 50); });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(main).not.toHaveAttribute('inert');
    expect(document.activeElement).toBe(focused);
  });

  it('"Yeniden dene" moves focus to Sayfalar while it retries; a second failure keeps focus there, not on the body', async () => {
    const user = userEvent.setup();
    drawer.fail = new Error('ağ hatası (sınama)');
    const { main, button, live } = renderShell(await freshShell());
    await user.click(button);
    const notice = await noticeIn(main);

    hold();
    await user.click(within(notice).getByRole('button', { name: 'Yeniden dene' }));
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(live()).toHaveTextContent('Sayfalar yükleniyor…');

    await act(async () => { drawer.release(); });
    const again = await noticeIn(main);
    expect(again).toHaveTextContent('Sayfalar yüklenemedi.');
    expect(button).toHaveFocus();
    expect(document.activeElement).not.toBe(document.body);
    expect(button).toHaveAttribute('aria-expanded', 'false');

    // Bağlantı gelince yeniden deneme çekmeceyi açar; odak içeri girer, kapanınca Sayfalar'a döner.
    drawer.fail = null;
    await user.click(within(again).getByRole('button', { name: 'Yeniden dene' }));
    const dialog = await screen.findByRole('dialog', { name: 'Sayfalar' });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(button).toHaveFocus();
  });
});

describe('WorkspaceShell · bekleme görseli ve simge ölçüsü (kaynak)', () => {
  const css = readFileSync(resolve(__dirname, 'shell.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  it('the busy strip is token based (eylem on liste-zemin, 5 × sure, project curve), static under reduced motion, never a ring', () => {
    const strip = /\.aile-admin \.aile-admin-topbar\[data-bekliyor\]::after\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(strip).toMatch(/position:\s*absolute/);
    expect(strip).toMatch(/inset-block-start:\s*100%/);
    expect(strip).toMatch(/var\(--aile-eylem\)/);
    expect(strip).toMatch(/var\(--aile-liste-zemin\)/);
    expect(strip).toMatch(/animation:\s*aile-shell-serit calc\(var\(--aile-sure\) \* 5\) var\(--aile-egri\) infinite/);
    expect(strip).not.toMatch(/outline|box-shadow|border/);
    const reduced = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    expect(reduced).toMatch(/\.aile-admin \.aile-admin-topbar\[data-bekliyor\]::after\s*\{[^}]*animation:\s*none/);
  });

  // n4: ölçü tasarımın tek simge ölçüsüdür (ui/icons ICON_SIZE). İçe aktarma telefon girişini böldüğü için ShellIcon adlı
  // bir sabit taşır; çizilen ölçü burada ICON_SIZE ile karşılaştırılır, öznitelikte çıplak sayı yok.
  it('ShellIcon draws at the design icon size (equal to ICON_SIZE), through one named constant', async () => {
    const source = readFileSync(resolve(__dirname, 'ShellIcon.tsx'), 'utf8');
    expect(source).not.toMatch(/width="20"|height="20"/);
    expect(source).toMatch(/width=\{SHELL_ICON_SIZE\} height=\{SHELL_ICON_SIZE\}/);
    expect(source.match(/const SHELL_ICON_SIZE = /g)).toHaveLength(1);
    const { ShellIcon } = await import('./ShellIcon');
    const { container } = render(<ShellIcon name="menu" />);
    expect(container.querySelector('svg')).toHaveAttribute('width', String(ICON_SIZE));
    expect(container.querySelector('svg')).toHaveAttribute('height', String(ICON_SIZE));
  });
});
