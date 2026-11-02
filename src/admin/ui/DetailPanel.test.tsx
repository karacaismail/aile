import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { DeviceContext } from '../device';
import type { Device, RecordRow, StatusLabel } from '../shell/contracts';
import { DetailPanel, differenceText } from './DetailPanel';

// Tasarım: components/DetailPanel/README.md (sıra sabit: kimlik + fotoğraf → Plan | Gerçek → durum ve eylemler →
// bağlı kayıtlar → kaynak ve değişiklik izi; "Fotoğraf yok" + "Fotoğraf ekle"; fark sözcükle) ve envanter.md
// (masaüstü sağda 384 px; tablet ve telefon tam sayfa, üstte "Listeye dön"). Seçiciler role/label; antd iç sınıfı yok.
// Veri sentetiktir (gerçek aile kaydı değil).

const row: RecordRow = {
  id: 'ornek-0001',
  code: 'ALM-0001',
  label: 'Çalışma masası',
  kind: 'purchase_need',
  status: { label: 'Sipariş verildi', tone: 'bilgi' },
  room: 'Çalışma odası',
  category: 'Mobilya',
  owner: 'Ortak',
  planned: { amount: '8500.00', currency: 'TRY' },
  actual: { amount: '7940.00', currency: 'TRY' },
  payment: { label: 'Ödeme bekleniyor', tone: 'uyari' },
  confidence: 'Doğrulandı',
  photo: null,
  dates: { planned: '2026-11-15', ordered: '2026-10-28' },
};

const statusOptions: readonly StatusLabel[] = [
  { label: 'Araştırılıyor', tone: 'notr' },
  { label: 'Sipariş verildi', tone: 'bilgi' },
  { label: 'Teslim alındı', tone: 'olumlu' },
];

const related = [
  { label: 'Ödeme ODM-0001', href: '#/odemeler/ODM-0001' },
  { label: 'Proje PRJ-01', href: '#/projeler/PRJ-01' },
];
const source = [
  { label: 'Sayfa', value: 'Alımlar' },
  { label: 'Hücre', value: 'B14' },
  { label: 'Nesil', value: 'a1b2c3' },
];

function renderOn(device: Device, ui: ReactNode) {
  return render(<DeviceContext.Provider value={device}>{ui}</DeviceContext.Provider>);
}

const SECTION_HEADINGS = ['Plan', 'Gerçek', 'Durum ve eylemler', 'Bağlı kayıtlar', 'Kaynak ve değişiklik izi'];

describe('DetailPanel › dar ekran (telefon)', () => {
  it('tam sayfa diyalog: role dialog, aria-modal, h2 ile adlandırılır; üstte "Listeye dön" onClose çağırır', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderOn('phone', <DetailPanel row={row} onClose={onClose} />);
    const dialog = screen.getByRole('dialog', { name: row.label });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('heading', { level: 2, name: row.label })).toBeInTheDocument();
    // Geniş ekranın "Kapat" düğmesi yok; dar ekranda "Listeye dön".
    expect(screen.queryByRole('button', { name: 'Kapat' })).toBeNull();
    const back = screen.getByRole('button', { name: 'Listeye dön' });
    // Üstte: diyaloğun ilk düğmesi.
    expect(within(dialog).getAllByRole('button')[0]).toBe(back);
    await user.click(back);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape onClose çağırır', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderOn('phone', <DetailPanel row={row} onClose={onClose} />);
    screen.getByRole('button', { name: 'Listeye dön' }).focus();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('bölüm sırası sabittir: kimlik (h2) → Plan | Gerçek → Durum ve eylemler → Bağlı kayıtlar → Kaynak ve değişiklik izi', () => {
    renderOn('phone', <DetailPanel row={row} onClose={() => {}} related={related} source={source} />);
    const headings = screen.getAllByRole('heading').map(h => h.textContent);
    expect(headings).toEqual([row.label, ...SECTION_HEADINGS]);
    // Plan ve gerçek iki ayrı sütun olarak adlandırılmış bir bölgedir.
    expect(screen.getByRole('region', { name: 'Plan ve gerçek' })).toBeInTheDocument();
    // Kimlik: kod ve kategori, oda ve sorumlu.
    expect(screen.getByText(`${row.code} · ${row.category}`)).toBeInTheDocument();
    expect(screen.getByText(`Oda: ${row.room} · Sorumlu: ${row.owner}`)).toBeInTheDocument();
  });

  it('tablet de tam sayfadır (envanter: ayrıntı tam sayfa, "Listeye dön")', () => {
    renderOn('tablet', <DetailPanel row={row} onClose={() => {}} />);
    expect(screen.getByRole('button', { name: 'Listeye dön' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Kapat' })).toBeNull();
  });
});

describe('DetailPanel › plan ve gerçek', () => {
  it('iki ayrı sütunda tr-TR tutar; fark sözcükle: "Planın altında: ₺560,00"', () => {
    renderOn('phone', <DetailPanel row={row} onClose={() => {}} />);
    const region = screen.getByRole('region', { name: 'Plan ve gerçek' });
    const plan = within(region).getByRole('heading', { name: 'Plan' }).parentElement as HTMLElement;
    const actual = within(region).getByRole('heading', { name: 'Gerçek' }).parentElement as HTMLElement;
    expect(within(plan).getByText('₺8.500,00')).toBeInTheDocument();
    expect(within(actual).getByText('₺7.940,00')).toBeInTheDocument();
    // Tarihler 28.10.2026 biçiminde; eksik tarih adıyla.
    expect(within(plan).getByText('15.11.2026')).toBeInTheDocument();
    expect(within(actual).getByText('28.10.2026')).toBeInTheDocument();
    expect(within(actual).getAllByText('Bilinmiyor').length).toBeGreaterThan(0);
    expect(within(region).getByText('Planın altında: ₺560,00')).toBeInTheDocument();
    // Plan ve gerçek tek sayıda birleşmez: toplam ya da birleşik tutar yok.
    expect(within(region).queryByText('₺16.440,00')).toBeNull();
  });

  it('gerçek planın üstündeyse "Planın üstünde", eşitse "Planla aynı"', () => {
    const over: RecordRow = { ...row, actual: { amount: '9100.50', currency: 'TRY' } };
    const first = renderOn('phone', <DetailPanel row={over} onClose={() => {}} />);
    expect(screen.getByText('Planın üstünde: ₺600,50')).toBeInTheDocument();
    first.unmount();
    const same: RecordRow = { ...row, actual: { amount: '8500.00', currency: 'TRY' } };
    renderOn('phone', <DetailPanel row={same} onClose={() => {}} />);
    expect(screen.getByText('Planla aynı')).toBeInTheDocument();
  });

  it('eksik tutar adıyla yazılır ("Fiyat yok", "Henüz yok") ve fark yazılmaz', () => {
    const missing: RecordRow = { ...row, planned: null, actual: null };
    renderOn('phone', <DetailPanel row={missing} onClose={() => {}} />);
    const region = screen.getByRole('region', { name: 'Plan ve gerçek' });
    expect(within(region).getByText('Fiyat yok')).toBeInTheDocument();
    expect(within(region).getByText('Henüz yok')).toBeInTheDocument();
    expect(within(region).queryByText(/Planın/)).toBeNull();
    expect(within(region).queryByText('Planla aynı')).toBeNull();
  });

  it('differenceText: para birimleri farklıysa fark hesaplanmaz, nedeni yazılır', () => {
    expect(differenceText({ amount: '100.00', currency: 'TRY' }, { amount: '90.00', currency: 'TRY' })).toEqual({ text: 'Planın altında: ₺10,00', tone: 'olumlu' });
    expect(differenceText({ amount: '100.00', currency: 'TRY' }, { amount: '90.00', currency: 'EUR' })).toEqual({ text: 'Fark bilinmiyor: para birimleri farklı (TRY, EUR)', tone: 'notr' });
    expect(differenceText(null, { amount: '90.00', currency: 'TRY' })).toBeNull();
  });
});

describe('DetailPanel › fotoğraf', () => {
  it('fotoğraf yoksa "Fotoğraf yok" alanı; "Fotoğraf ekle" yalnız onPhotoAdd verilince', async () => {
    const user = userEvent.setup();
    const first = renderOn('phone', <DetailPanel row={row} onClose={() => {}} />);
    expect(screen.getByText('Fotoğraf yok')).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Fotoğraf ekle' })).toBeNull();
    first.unmount();

    const onPhotoAdd = vi.fn();
    renderOn('phone', <DetailPanel row={row} onClose={() => {}} onPhotoAdd={onPhotoAdd} />);
    const add = screen.getByRole('button', { name: 'Fotoğraf ekle' });
    expect(add).toBeEnabled();
    await user.click(add);
    expect(onPhotoAdd).toHaveBeenCalledTimes(1);
  });

  it('doğrulanmamış fotoğraf asla gösterilmez; doğrulanmış fotoğraf alt metniyle gösterilir', () => {
    const unverified: RecordRow = { ...row, photo: { url: 'https://example.test/yanlis.jpg', verified: false } };
    const first = renderOn('phone', <DetailPanel row={unverified} onClose={() => {}} />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('Fotoğraf yok')).toBeInTheDocument();
    first.unmount();

    const verified: RecordRow = { ...row, photo: { url: 'https://example.test/masa.jpg', verified: true } };
    renderOn('phone', <DetailPanel row={verified} onClose={() => {}} />);
    const img = screen.getByRole('img', { name: `${row.label} fotoğrafı` });
    expect(img).toHaveAttribute('src', 'https://example.test/masa.jpg');
    expect(screen.queryByText('Fotoğraf yok')).toBeNull();
  });
});

describe('DetailPanel › durum ve eylemler', () => {
  it('durum sözcükle yazılır; ödeme ve veri güveni ayrı satırlarda', () => {
    renderOn('phone', <DetailPanel row={row} onClose={() => {}} />);
    const section = screen.getByRole('heading', { name: 'Durum ve eylemler' }).parentElement as HTMLElement;
    expect(within(section).getByText('Sipariş verildi')).toBeInTheDocument();
    expect(within(section).getByText('Ödeme bekleniyor')).toBeInTheDocument();
    expect(within(section).getByText('Doğrulandı')).toBeInTheDocument();
    // Eylem verilmedi: ne "Durumu değiştir" ne "Geri al".
    expect(screen.queryByRole('combobox', { name: 'Durumu değiştir' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Durumu değiştir' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Geri al' })).toBeNull();
  });

  it('"Durumu değiştir" seçimi onChangeStatus(next) verir; "Geri al" onUndo çağırır (masaüstü)', async () => {
    const user = userEvent.setup();
    const onChangeStatus = vi.fn();
    const onUndo = vi.fn();
    renderOn('desktop', <DetailPanel row={row} onClose={() => {}} statusOptions={statusOptions} onChangeStatus={onChangeStatus} onUndo={onUndo} inline />);
    const select = screen.getByRole('combobox', { name: 'Durumu değiştir' });
    await user.click(select);
    const list = await screen.findByRole('listbox');
    expect(within(list).getByRole('option', { name: 'Sipariş verildi' })).toHaveAttribute('aria-selected', 'true');
    await user.click(within(list).getByRole('option', { name: 'Teslim alındı' }));
    expect(onChangeStatus).toHaveBeenCalledTimes(1);
    expect(onChangeStatus).toHaveBeenCalledWith({ label: 'Teslim alındı', tone: 'olumlu' });
    await user.click(screen.getByRole('button', { name: 'Geri al' }));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it('onChangeStatus var ama seçenek yoksa düğme devre dışıdır ve nedeni yakınında yazılıdır', () => {
    renderOn('phone', <DetailPanel row={row} onClose={() => {}} onChangeStatus={() => {}} />);
    const button = screen.getByRole('button', { name: 'Durumu değiştir' });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription('Seçilebilir durum yok');
  });
});

describe('DetailPanel › bağlı kayıtlar, kaynak', () => {
  it('bağlı kayıtlar bağlantı listesidir; yoksa "Bağlı kayıt yok"', () => {
    const first = renderOn('phone', <DetailPanel row={row} onClose={() => {}} related={related} />);
    const list = screen.getByRole('list', { name: 'Bağlı kayıtlar' });
    const links = within(list).getAllByRole('link');
    expect(links.map(a => a.textContent)).toEqual(related.map(r => r.label));
    expect(links[0]).toHaveAttribute('href', related[0].href);
    first.unmount();
    renderOn('phone', <DetailPanel row={row} onClose={() => {}} />);
    expect(screen.getByText('Bağlı kayıt yok')).toBeInTheDocument();
  });

  it('kaynak etiket–değer listesidir (dl); yoksa "Kaynak bilgisi yok"', () => {
    const first = renderOn('phone', <DetailPanel row={row} onClose={() => {}} source={source} />);
    const section = screen.getByRole('heading', { name: 'Kaynak ve değişiklik izi' }).parentElement as HTMLElement;
    const terms = Array.from(section.querySelectorAll('dl dt')).map(dt => dt.textContent);
    const values = Array.from(section.querySelectorAll('dl dd')).map(dd => dd.textContent);
    expect(terms).toEqual(source.map(s => s.label));
    expect(values).toEqual(source.map(s => s.value));
    first.unmount();
    renderOn('phone', <DetailPanel row={row} onClose={() => {}} />);
    expect(screen.getByText('Kaynak bilgisi yok')).toBeInTheDocument();
  });
});


// --- Katman, odak, klavye ----------------------------------------------------------------------------------------
/**
 * Sanal klavye taklidi: window.visualViewport (görsel görünüm alanı) + düzen görünüm alanı yüksekliği
 * (documentElement.clientHeight). Emülasyondur, gerçek cihaz değildir; yalnız hesap ve bağlantıyı sınar.
 */
function installVisualViewport(layoutHeight: number) {
  const target = new EventTarget();
  const state = { height: layoutHeight, offsetTop: 0, scale: 1 };
  for (const key of ['height', 'offsetTop', 'scale'] as const) {
    Object.defineProperty(target, key, { configurable: true, get: () => state[key] });
  }
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: target });
  Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: layoutHeight });
  return {
    set(next: Partial<typeof state>) {
      Object.assign(state, next);
      target.dispatchEvent(new Event('resize'));
    },
    restore() {
      Reflect.deleteProperty(window, 'visualViewport');
      Reflect.deleteProperty(document.documentElement, 'clientHeight');
    },
  };
}

/** Açan düğme + ayrıntı; kapanınca ayrıntı sökülür (sayfaların kullanımı gibi). */
function Harness({ device, withRef = false }: { device: Device; withRef?: boolean }) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  return (
    <DeviceContext.Provider value={device}>
      <button type="button" ref={opener} onClick={() => setOpen(true)}>Örnek satır</button>
      {open ? (
        <DetailPanel row={row} onClose={() => setOpen(false)} returnFocusTo={withRef ? opener : undefined} inline={device === 'desktop'} />
      ) : null}
    </DeviceContext.Provider>
  );
}

describe('DetailPanel › telefon: tam ekran katman', () => {
  it('üstte "Listeye dön" çubuğu, ortada kaydırılan içerik (h2 + bölümler), altta yalnız verilince eylem altlığı', () => {
    const first = renderOn('phone', <DetailPanel row={row} onClose={() => {}} footer={<button type="button">Kaydet</button>} />);
    const dialog = screen.getByRole('dialog', { name: row.label });
    expect(dialog).toHaveClass('aile-detail--dar');
    const [bar, body, foot] = Array.from(dialog.children) as HTMLElement[];
    expect(bar).toHaveClass('aile-detail-bar');
    expect(within(bar).getByRole('button', { name: 'Listeye dön' })).toBeInTheDocument();
    expect(body).toHaveClass('aile-detail-govde');
    expect(within(body).getByRole('heading', { level: 2, name: row.label })).toBeInTheDocument();
    expect(within(body).getByRole('region', { name: 'Plan ve gerçek' })).toBeInTheDocument();
    expect(foot).toHaveClass('aile-detail-altlik');
    expect(within(foot).getByRole('button', { name: 'Kaydet' })).toBeInTheDocument();
    first.unmount();
    renderOn('phone', <DetailPanel row={row} onClose={() => {}} />);
    expect(screen.getByRole('dialog', { name: row.label }).children).toHaveLength(2);
  });

  it('açılınca odak diyaloğun köküne girer (tabIndex -1)', async () => {
    renderOn('phone', <DetailPanel row={row} onClose={() => {}} />);
    const dialog = screen.getByRole('dialog', { name: row.label });
    expect(dialog).toHaveAttribute('tabindex', '-1');
    await waitFor(() => expect(dialog).toHaveFocus());
  });

  it('modal: Tab son öğeden "Listeye dön"e, Shift+Tab ilk öğeden son öğeye döner; odak katmandan çıkmaz', async () => {
    const user = userEvent.setup();
    render(
      <DeviceContext.Provider value="phone">
        <button type="button">Önce</button>
        <DetailPanel row={row} onClose={() => {}} related={related} footer={<button type="button">Kaydet</button>} />
        <button type="button">Sonra</button>
      </DeviceContext.Provider>,
    );
    const back = screen.getByRole('button', { name: 'Listeye dön' });
    const last = screen.getByRole('button', { name: 'Kaydet' });
    last.focus();
    await user.tab();
    expect(back).toHaveFocus();
    await user.tab({ shift: true });
    expect(last).toHaveFocus();
    // Ortadaki öğeler arasında Tab doğal sırayla ilerler.
    back.focus();
    await user.tab();
    expect(screen.getByRole('link', { name: related[0].label })).toHaveFocus();
  });

  it('oklar katmanı kapatmaz, odağı dışarı taşımaz; "Listeye dön" Enter ve Space ile kapatır', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderOn('phone', <DetailPanel row={row} onClose={onClose} related={related} />);
    const dialog = screen.getByRole('dialog', { name: row.label });
    const back = screen.getByRole('button', { name: 'Listeye dön' });
    back.focus();
    await user.keyboard('{ArrowDown}{ArrowUp}{ArrowRight}{ArrowLeft}{Home}{End}');
    expect(onClose).not.toHaveBeenCalled();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await user.keyboard('{Enter}');
    expect(onClose).toHaveBeenCalledTimes(1);
    back.focus();
    await user.keyboard('[Space]');
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('Escape içerikten kapatır; portallı alt katmandan ve açık combobox üstünden gelen Escape kapatmaz', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    function Portalli() {
      return createPortal(<input aria-label="Katman alanı" />, document.body);
    }
    renderOn('phone', (
      <DetailPanel
        row={row}
        onClose={onClose}
        footer={<><Portalli /><input role="combobox" aria-expanded="true" aria-controls="durum-listesi" aria-label="Durum" /></>}
      />
    ));
    screen.getByRole('textbox', { name: 'Katman alanı' }).focus();
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    screen.getByRole('combobox', { name: 'Durum' }).focus();
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    screen.getByRole('button', { name: 'Listeye dön' }).focus();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('sanal klavye görünür alanı daraltınca katman görünür alana sığar; klavye kapanınca pay kalkar', () => {
    const viewport = installVisualViewport(568);
    try {
      renderOn('phone', <DetailPanel row={row} onClose={() => {}} />);
      const dialog = screen.getByRole('dialog', { name: row.label });
      expect(dialog.style.getPropertyValue('--aile-detail-alt')).toBe('');
      act(() => viewport.set({ height: 300, offsetTop: 8 }));
      expect(dialog.style.getPropertyValue('--aile-detail-ust')).toBe('8px');
      expect(dialog.style.getPropertyValue('--aile-detail-alt')).toBe('260px');
      // Yakınlaştırmada görünür alan kovalanmaz (scale ≠ 1).
      act(() => viewport.set({ scale: 2 }));
      expect(dialog.style.getPropertyValue('--aile-detail-alt')).toBe('');
      act(() => viewport.set({ height: 568, offsetTop: 0, scale: 1 }));
      expect(dialog.style.getPropertyValue('--aile-detail-ust')).toBe('');
      expect(dialog.style.getPropertyValue('--aile-detail-alt')).toBe('');
    } finally {
      viewport.restore();
    }
  });
});

describe('DetailPanel › odak dönüşü', () => {
  it.each(['phone', 'desktop'] as const)('%s: kapanınca odak açan öğeye döner', async device => {
    const user = userEvent.setup();
    render(<Harness device={device} />);
    const opener = screen.getByRole('button', { name: 'Örnek satır' });
    await user.click(opener);
    const dialog = await screen.findByRole('dialog', { name: row.label });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    await user.click(within(dialog).getByRole('button', { name: device === 'phone' ? 'Listeye dön' : 'Kapat' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: row.label })).toBeNull());
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it('tıklama odak taşımasa da (Safari: odak body) returnFocusTo verilen öğeye döner', async () => {
    render(<Harness device="phone" withRef />);
    const opener = screen.getByRole('button', { name: 'Örnek satır' });
    // fireEvent.click odak taşımaz: açılış anında odak body'dedir, açan öğe odaktan bilinemez.
    expect(document.activeElement).toBe(document.body);
    fireEvent.click(opener);
    const dialog = await screen.findByRole('dialog', { name: row.label });
    await waitFor(() => expect(dialog).toHaveFocus());
    fireEvent.click(within(dialog).getByRole('button', { name: 'Listeye dön' }));
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it('kapanmadan önce odak panel dışında başka bir öğeye taşındıysa dönüş onu ezmez', async () => {
    const user = userEvent.setup();
    function Disarida() {
      const [open, setOpen] = useState(false);
      return (
        <DeviceContext.Provider value="desktop">
          <button type="button" onClick={() => setOpen(true)}>Aç</button>
          <button type="button" onClick={() => setOpen(false)}>Başka eylem</button>
          {open ? <DetailPanel row={row} onClose={() => setOpen(false)} inline /> : null}
        </DeviceContext.Provider>
      );
    }
    render(<Disarida />);
    await user.click(screen.getByRole('button', { name: 'Aç' }));
    await screen.findByRole('dialog', { name: row.label });
    const other = screen.getByRole('button', { name: 'Başka eylem' });
    await user.click(other);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: row.label })).toBeNull());
    expect(other).toHaveFocus();
  });
});

describe('DetailPanel › geniş ekran (masaüstü)', () => {
  it('örtülü sağ panel (inline yok): modal diyalog, h2 + "Kapat"; örtü tıklaması kapatır, pointercancel kapatmaz', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { container } = renderOn('desktop', <DetailPanel row={row} onClose={onClose} related={related} source={source} />);
    const dialog = screen.getByRole('dialog', { name: row.label });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveClass('aile-detail--genis');
    expect(container.contains(dialog)).toBe(true);
    expect(screen.queryByRole('button', { name: 'Listeye dön' })).toBeNull();
    expect(screen.getAllByRole('heading').map(h => h.textContent)).toEqual([row.label, ...SECTION_HEADINGS]);
    const mask = container.querySelector('.aile-detail-ortu') as HTMLElement;
    expect(mask).not.toBeNull();
    expect(mask).toHaveAttribute('aria-hidden', 'true');
    // Dokunma kaydırmaya dönüşüp iptal olursa (pointercancel) kapanmaz; kapanış tamamlanan tıklamadadır.
    fireEvent.pointerDown(mask, { pointerType: 'touch', isPrimary: true });
    fireEvent.pointerCancel(mask, { pointerType: 'touch', isPrimary: true });
    expect(onClose).not.toHaveBeenCalled();
    await user.click(mask);
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.click(within(dialog).getByRole('button', { name: 'Kapat' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('örtülü panel modaldır: Tab son öğeden "Kapat"a döner', async () => {
    const user = userEvent.setup();
    render(
      <DeviceContext.Provider value="desktop">
        <DetailPanel row={row} onClose={() => {}} related={related} />
        <button type="button">Sonra</button>
      </DeviceContext.Provider>,
    );
    const close = screen.getByRole('button', { name: 'Kapat' });
    screen.getByRole('link', { name: related[1].label }).focus();
    await user.tab();
    expect(close).toHaveFocus();
  });

  it('inline: liste yanında akışta, modal değil (aria-modal yok, örtü yok); Tab panelden çıkabilir; Escape kapatır', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { container } = render(
      <DeviceContext.Provider value="desktop">
        <DetailPanel row={row} onClose={onClose} inline />
        <button type="button">Sonraki</button>
      </DeviceContext.Provider>,
    );
    const dialog = screen.getByRole('dialog', { name: row.label });
    expect(dialog).not.toHaveAttribute('aria-modal');
    expect(dialog).toHaveClass('aile-detail--genis', 'aile-detail--yerinde');
    expect(container.querySelector('.aile-detail-ortu')).toBeNull();
    const close = within(dialog).getByRole('button', { name: 'Kapat' });
    close.focus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Sonraki' })).toHaveFocus();
    close.focus();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('footer genişte de içerikten sonra panelin altındadır', () => {
    renderOn('desktop', <DetailPanel row={row} onClose={() => {}} inline footer={<button type="button">Kaydet</button>} />);
    const dialog = screen.getByRole('dialog', { name: row.label });
    const last = dialog.lastElementChild as HTMLElement;
    expect(last).toHaveClass('aile-detail-altlik');
    expect(within(last).getByRole('button', { name: 'Kaydet' })).toBeInTheDocument();
    expect(dialog.querySelector('.aile-detail-govde')?.compareDocumentPosition(last)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });
});

// --- Kaynak kuralları ----------------------------------------------------------------------------------------------
const readSource = (name: string) => readFileSync(resolve(__dirname, name), 'utf8');
/** Yorumsuz CSS'te seçici listesi tam olarak `selector` olan ilk kuralın bildirimleri. */
function declarations(css: string, selector: string): string {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const match of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (match[1].trim().replace(/\s+/g, ' ') === selector) return match[2];
  }
  return '';
}

describe('DetailPanel › kaynak kuralları', () => {
  const css = readSource('DetailPanel.css');
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');

  it('telefon katmanı ekranı kaplar, güvenli alanları korur ve içerik kendi içinde kayar', () => {
    const dar = declarations(css, '.aile-detail--dar');
    expect(dar).toMatch(/position:\s*fixed/);
    expect(dar).toMatch(/inset:\s*var\(--aile-detail-ust, 0px\) 0 var\(--aile-detail-alt, 0px\)/);
    expect(dar).toMatch(/z-index:\s*\d+/);
    // Güvenli alan ve yan boşluk b04 merkezi tokenlarından (--aile-safe-*, --aile-yogunluk-kenar); env() burada yazılmaz.
    for (const side of ['top', 'right', 'bottom', 'left']) expect(clean).toContain(`var(--aile-safe-${side})`);
    expect(clean).not.toContain('env(safe-area-inset');
    expect(dar).toMatch(/--aile-detail-kenar:\s*var\(--aile-yogunluk-kenar\)/);
    const govde = declarations(css, '.aile-detail .aile-detail-govde');
    expect(govde).toMatch(/overflow-y:\s*auto/);
    expect(govde).toMatch(/overscroll-behavior:\s*contain/);
  });

  it('geniş panel ayrinti-genislik (384) tokenıyla; renk/ölçü yalnız --aile tokenlarından', () => {
    expect(declarations(css, '.aile-detail--genis')).toMatch(/inline-size:\s*var\(--aile-ayrinti-genislik\)/);
    for (const match of clean.matchAll(/var\((--[a-z0-9-]+)/g)) expect(match[1]).toMatch(/^--aile-/);
    expect(clean).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it('halka yok: outline yok, gölge yalnız yükseltilmiş yüzey tokenı; klavye odağı çubuğun altında tek çizgi', () => {
    expect(clean).not.toMatch(/\boutline\s*:/);
    for (const match of clean.matchAll(/box-shadow\s*:\s*([^;]+);/g)) expect(match[1].trim()).toBe('var(--aile-golge-yukseltilmis)');
    expect(clean).toMatch(/html\[data-keyboard='true'\] \.aile-detail:focus-visible > :is\(\.aile-detail-bar, \.aile-detail-ust\)::after/);
    const line = declarations(css, "html[data-keyboard='true'] .aile-detail:focus-visible > :is(.aile-detail-bar, .aile-detail-ust)::after");
    expect(line).toMatch(/height:\s*var\(--aile-odak-kalinlik\)/);
    expect(line).toMatch(/background:\s*var\(--aile-odak\)/);
  });

  it('metin ≥ 14 px; hover yalnız hover katmanında; kaba girişte hedef 48 px; bileşen hareketsiz', () => {
    const sizes = [...clean.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map(m => Number(m[1]));
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(14);
    for (const match of clean.matchAll(/([^{}]*:hover[^{}]*)\{/g)) expect(match[1]).toContain('[data-input-hover]');
    // Dokunma hedefi tek merkezi tokenla (b04 --aile-dokunma-hedefi: 44, kaba girişte 48); yerel 48 hesabı yok.
    expect(declarations(css, '.aile-detail .aile-detail-bag')).toMatch(/min-height:\s*var\(--aile-dokunma-hedefi\)/);
    expect(clean).not.toContain('--aile-hedef-asgari');
    expect(clean).not.toMatch(/\[data-input-coarse\][^{]*\{[^}]*min-height/);
    expect(clean).not.toMatch(/\b(transition|animation)\s*:/);
  });

  it('antd çekmecesi yerine yerel panel: ./Drawer ve antd içe aktarılmaz', () => {
    const tsx = readSource('DetailPanel.tsx');
    expect(tsx).not.toMatch(/from\s+['"]\.\/Drawer['"]/);
    expect(tsx).not.toMatch(/from\s+['"](antd|@ant-design\/|\.\/antd)/);
  });
});
