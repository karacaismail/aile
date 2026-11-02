import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { DeviceContext } from '../device';
import type { Device } from '../shell/contracts';
import { OverflowActions, OVERFLOW_MENU_MIN_WIDTH, type OverflowActionItem } from './OverflowActions';

// Telefonda OverflowActions listeyi BottomSheet içinde açar. BottomSheet ayrı görevde yazılır; burada yalnız sözleşmesi
// (index.d.ts BottomSheetProps + README: role dialog, başlık adı, görünür "Kapat", Escape kapatır, open=false çizmez)
// taklit edilir ki OverflowActions'ın devri ve geri bağlantısı (onClose) BottomSheet'in uygulamasından bağımsız doğrulansın.
vi.mock('./BottomSheet', () => ({
  BottomSheet: (p: { title: string; children?: ReactNode; onClose?: () => void; open?: boolean; inline?: boolean }) =>
    p.open === false ? null : (
      <div
        role="dialog"
        aria-modal="true"
        aria-label={p.title}
        data-testid="alt-sayfa"
        data-inline={String(p.inline)}
        onKeyDown={event => { if (event.key === 'Escape') p.onClose?.(); }}
      >
        <button type="button" onClick={p.onClose}>Kapat</button>
        {p.children}
      </div>
    ),
}));

const onDevice = (device: Device) => ({ children }: { children: ReactNode }) =>
  <DeviceContext.Provider value={device}>{children}</DeviceContext.Provider>;

function makeItems() {
  const duzenle = vi.fn();
  const disaAktar = vi.fn();
  const sil = vi.fn();
  const items: readonly OverflowActionItem[] = [
    { label: 'Düzenle', icon: 'edit', onClick: duzenle },
    { label: 'Dışa aktar', icon: 'download', onClick: disaAktar },
    { label: 'Sil', onClick: sil },
  ];
  return { items, duzenle, disaAktar, sil };
}

/** jsdom hareket bitişi üretmez; kapanış hareketini antd testleri gibi biz bitiririz ki destroyOnHidden menüyü kaldırsın.
 *  rc-motion olay adını tarayıcıdan türetir (jsdom'da AnimationEvent yok → webkitAnimationEnd); hepsini göndeririz. */
function endLeaveMotion() {
  const panel = document.querySelector('.aile-overflow-menu');
  for (const name of ['animationend', 'webkitAnimationEnd', 'transitionend']) panel?.dispatchEvent(new Event(name));
}
/** rc-motion dinleyiciyi kapanış adımı başlayınca bağlar (raf); bitişi her denemede gönderip menünün kalkmasını bekleriz. */
async function expectMenuRemoved() {
  await waitFor(() => {
    endLeaveMotion();
    expect(screen.queryByRole('menu')).toBeNull();
  });
}

// rc-menu okları ve Enter'ı `which` ile okur; user-event 14 keyCode/which doldurmaz. Tarayıcı ikisini de verir;
// jsdom'da aynı olayı fireEvent ile kuruyoruz (seçici yine role ile). Escape `key` tabanlıdır, user-event ile basılır.
const KEY = {
  ArrowDown: { key: 'ArrowDown', keyCode: 40, which: 40 },
  ArrowUp: { key: 'ArrowUp', keyCode: 38, which: 38 },
  Enter: { key: 'Enter', keyCode: 13, which: 13 },
} as const;

describe('OverflowActions › masaüstü (antd Dropdown menü)', () => {
  const wrapper = onDevice('desktop');

  // jsdom yerleşim hesaplamaz (offsetParent null, kutu 0×0); rc-menu ok dolaşımı öğeleri "görünür" saymak için
  // offsetParent'a bakar. Bağlı öğeler için gövdeyi döndürürüz; her testten sonra geri alınır.
  let offsetParent: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    offsetParent = vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get')
      .mockImplementation(function (this: HTMLElement) { return this.isConnected ? document.body : null; });
  });
  afterEach(() => offsetParent.mockRestore());

  it('metinli "Diğer" düğmesi: aria-haspopup=menu, kapalı başlar, menü çizilmez', () => {
    const { items } = makeItems();
    render(<OverflowActions items={items} />, { wrapper });
    const trigger = screen.getByRole('button', { name: 'Diğer' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveTextContent('Diğer');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('label ve title özelleştirilebilir', async () => {
    const user = userEvent.setup();
    const { items } = makeItems();
    render(<OverflowActions items={items} label="Daha fazla" title="Alım eylemleri" />, { wrapper });
    await user.click(screen.getByRole('button', { name: 'Daha fazla' }));
    expect(await screen.findByRole('menu', { name: 'Alım eylemleri' })).toBeInTheDocument();
  });

  it('tıklama menüyü açar: role menu, başlık adı, sıralı menuitem\'lar, simgeler, aria-expanded ve aria-controls', async () => {
    const user = userEvent.setup();
    const { items } = makeItems();
    render(<OverflowActions items={items} />, { wrapper });
    const trigger = screen.getByRole('button', { name: 'Diğer' });
    await user.click(trigger);
    const menu = await screen.findByRole('menu', { name: 'Diğer eylemler' });
    const menuItems = within(menu).getAllByRole('menuitem');
    expect(menuItems.map(item => item.textContent)).toEqual(['Düzenle', 'Dışa aktar', 'Sil']);
    expect(menuItems[0].querySelector('[data-icon="edit"]')).not.toBeNull();
    expect(menuItems[1].querySelector('[data-icon="download"]')).not.toBeNull();
    expect(menuItems[2].querySelector('[data-icon]')).toBeNull();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(menu.id).not.toBe('');
    expect(trigger).toHaveAttribute('aria-controls', menu.id);
  });

  it('menü paneli en az 240 px (tasarım bundle.css .ai-pop); değer bileşen sabitidir', async () => {
    const user = userEvent.setup();
    const { items } = makeItems();
    render(<OverflowActions items={items} />, { wrapper });
    await user.click(screen.getByRole('button', { name: 'Diğer' }));
    await screen.findByRole('menu');
    expect(OVERFLOW_MENU_MIN_WIDTH).toBe(240);
    const panel = document.querySelector('.aile-overflow-menu');
    expect(panel).not.toBeNull();
    expect(panel).toHaveStyle({ minWidth: `${OVERFLOW_MENU_MIN_WIDTH}px` });
  });

  it('seçim ilgili onClick\'i bir kez çağırır, menüyü kapatır ve odağı düğmeye döndürür', async () => {
    const user = userEvent.setup();
    const { items, duzenle, disaAktar, sil } = makeItems();
    render(<OverflowActions items={items} />, { wrapper });
    const trigger = screen.getByRole('button', { name: 'Diğer' });
    await user.click(trigger);
    const menu = await screen.findByRole('menu');
    // Açılış odağı (autoFocus) yerleşsin; gerçek kullanıcı da menüyü gördükten sonra tıklar.
    await waitFor(() => expect(within(menu).getAllByRole('menuitem')[0]).toHaveFocus());
    await user.click(within(menu).getByRole('menuitem', { name: 'Dışa aktar' }));
    expect(disaAktar).toHaveBeenCalledTimes(1);
    expect(duzenle).not.toHaveBeenCalled();
    expect(sil).not.toHaveBeenCalled();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
    await expectMenuRemoved();
  });

  it('klavye: açılınca odak ilk menuitem\'da, oklar menuitem\'lar arasında sarmalı dolaşır, Enter seçer', async () => {
    const user = userEvent.setup();
    const { items, sil, duzenle } = makeItems();
    render(<OverflowActions items={items} />, { wrapper });
    await user.click(screen.getByRole('button', { name: 'Diğer' }));
    const menu = await screen.findByRole('menu');
    const [duzenleItem, disaAktarItem, silItem] = within(menu).getAllByRole('menuitem');
    // antd Dropdown autoFocus: rc-menu focus() ilk öğeye odaklanır (APG menü düğmesi).
    await waitFor(() => expect(duzenleItem).toHaveFocus());

    fireEvent.keyDown(duzenleItem, KEY.ArrowDown);
    await waitFor(() => expect(disaAktarItem).toHaveFocus());
    fireEvent.keyDown(disaAktarItem, KEY.ArrowDown);
    await waitFor(() => expect(silItem).toHaveFocus());
    // Sarmal: son öğeden aşağı → ilk öğe; ilk öğeden yukarı → son öğe.
    fireEvent.keyDown(silItem, KEY.ArrowDown);
    await waitFor(() => expect(duzenleItem).toHaveFocus());
    fireEvent.keyDown(duzenleItem, KEY.ArrowUp);
    await waitFor(() => expect(silItem).toHaveFocus());

    fireEvent.keyDown(silItem, KEY.Enter);
    expect(sil).toHaveBeenCalledTimes(1);
    expect(duzenle).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Diğer' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('Escape menüyü kapatır, hiçbir eylemi çağırmaz, odak düğmeye döner', async () => {
    const user = userEvent.setup();
    const { items, duzenle, disaAktar, sil } = makeItems();
    render(<OverflowActions items={items} />, { wrapper });
    const trigger = screen.getByRole('button', { name: 'Diğer' });
    await user.click(trigger);
    const menu = await screen.findByRole('menu');
    const [first] = within(menu).getAllByRole('menuitem');
    await waitFor(() => expect(first).toHaveFocus());
    await user.keyboard('{Escape}');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
    expect(duzenle).not.toHaveBeenCalled();
    expect(disaAktar).not.toHaveBeenCalled();
    expect(sil).not.toHaveBeenCalled();
    await expectMenuRemoved();
  });

  it('open=true açık başlar; inline menüyü bileşenin kendi kapsayıcısına çizer', async () => {
    const { items } = makeItems();
    const { container } = render(<OverflowActions items={items} open inline />, { wrapper });
    const menu = await screen.findByRole('menu', { name: 'Diğer eylemler' });
    expect(container.contains(menu)).toBe(true);
    expect(screen.getByRole('button', { name: 'Diğer' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('tablette de açılır menüdür, alt sayfa değil', async () => {
    const user = userEvent.setup();
    const { items } = makeItems();
    render(<OverflowActions items={items} />, { wrapper: onDevice('tablet') });
    const trigger = screen.getByRole('button', { name: 'Diğer' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    await user.click(trigger);
    expect(await screen.findByRole('menu')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('OverflowActions › telefon (BottomSheet listesi)', () => {
  const wrapper = onDevice('phone');

  it('"Diğer" düğmesi aria-haspopup=dialog; kapalı başlar, alt sayfa çizilmez', () => {
    const { items } = makeItems();
    render(<OverflowActions items={items} />, { wrapper });
    const trigger = screen.getByRole('button', { name: 'Diğer' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('tıklama alt sayfayı açar: başlık, 44 px menuitem düğmeleri, simgeler; seçim onClick çağırır ve kapatır', async () => {
    const user = userEvent.setup();
    const { items, duzenle, disaAktar, sil } = makeItems();
    render(<OverflowActions items={items} title="Alım eylemleri" />, { wrapper });
    const trigger = screen.getByRole('button', { name: 'Diğer' });
    await user.click(trigger);
    const sheet = screen.getByRole('dialog', { name: 'Alım eylemleri' });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const menu = within(sheet).getByRole('menu', { name: 'Alım eylemleri' });
    const menuItems = within(menu).getAllByRole('menuitem');
    expect(menuItems.map(item => item.textContent)).toEqual(['Düzenle', 'Dışa aktar', 'Sil']);
    expect(menuItems[0].querySelector('[data-icon="edit"]')).not.toBeNull();
    expect(menuItems[2].querySelector('[data-icon]')).toBeNull();
    menuItems.forEach(item => expect(item.tagName).toBe('BUTTON'));

    await user.click(menuItems[0]);
    expect(duzenle).toHaveBeenCalledTimes(1);
    expect(disaAktar).not.toHaveBeenCalled();
    expect(sil).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
  });

  it('varsayılan başlık "Diğer eylemler"; inline alt sayfaya iletilir', async () => {
    const user = userEvent.setup();
    const { items } = makeItems();
    render(<OverflowActions items={items} inline />, { wrapper });
    await user.click(screen.getByRole('button', { name: 'Diğer' }));
    const sheet = screen.getByRole('dialog', { name: 'Diğer eylemler' });
    expect(sheet).toHaveAttribute('data-inline', 'true');
  });

  it('listede oklar menuitem\'lar arasında dolaşır (sarmalı), Home/End uçlara gider', async () => {
    const user = userEvent.setup();
    const { items } = makeItems();
    render(<OverflowActions items={items} />, { wrapper });
    await user.click(screen.getByRole('button', { name: 'Diğer' }));
    const [duzenle, disaAktar, sil] = screen.getAllByRole('menuitem');
    duzenle.focus();
    await user.keyboard('{ArrowDown}');
    expect(disaAktar).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(sil).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(duzenle).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(sil).toHaveFocus();
    await user.keyboard('{Home}');
    expect(duzenle).toHaveFocus();
    await user.keyboard('{End}');
    expect(sil).toHaveFocus();
  });

  it('Escape (alt sayfanın onClose\'u) listeyi kapatır, eylem çağrılmaz', async () => {
    const user = userEvent.setup();
    const { items, duzenle, disaAktar, sil } = makeItems();
    render(<OverflowActions items={items} />, { wrapper });
    const trigger = screen.getByRole('button', { name: 'Diğer' });
    await user.click(trigger);
    screen.getAllByRole('menuitem')[0].focus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(duzenle).not.toHaveBeenCalled();
    expect(disaAktar).not.toHaveBeenCalled();
    expect(sil).not.toHaveBeenCalled();
  });

  it('görünür "Kapat" da kapatır', async () => {
    const user = userEvent.setup();
    const { items } = makeItems();
    render(<OverflowActions items={items} />, { wrapper });
    await user.click(screen.getByRole('button', { name: 'Diğer' }));
    await user.click(screen.getByRole('button', { name: 'Kapat' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Diğer' })).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('OverflowActions › kaynak sözleşmesi', () => {
  it('ham antd / phosphor paketini değil ui/antd ve ui/icons yüzeylerini kullanır; sabit renk yazmaz', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve(__dirname, 'OverflowActions.tsx'), 'utf8');
    expect(source).not.toMatch(/from ['"]antd['"]/);
    expect(source).not.toContain('@ant-design/');
    expect(source).not.toContain('@phosphor-icons/');
    expect(source).toContain("from './antd'");
    expect(source).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    const css = readFileSync(resolve(__dirname, 'OverflowActions.css'), 'utf8');
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/outline\s*:/);
    expect(css).not.toMatch(/box-shadow\s*:/);
  });
});
