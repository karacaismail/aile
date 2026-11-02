import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { RecordRow } from '../shell/contracts';
import { Timeline } from './Timeline';

// Tasarım: components/Timeline/README.md + index.d.ts TimelineProps; referans bundle.js Timeline. Tek-tarih çizelgesi:
// dateField dışarıdan (planned | ordered | delivered | paid); kayıtlar aya göre bölünür (h3 "Kasım 2026" + "N kayıt"),
// aylar artan sırada, ay içinde günler artan; solda gün + ay kısaltması; sağda kayıt düğmesi (ad, kod · oda · tarih,
// durum etiketi, Planlanan tutar). Tarihi olmayanlar sonda "Tarihi bilinmiyor" grubunda, gizlenmez. Seçiciler role/label.

const row = (over: Partial<RecordRow> & Pick<RecordRow, 'id' | 'label'>): RecordRow => ({
  code: over.id,
  status: { label: 'Sipariş verildi', tone: 'bilgi' },
  planned: null,
  actual: null,
  kind: 'purchase_need',
  ...over,
});

const ITEMS: readonly RecordRow[] = [
  row({ id: 'ALM-0137', label: 'Yemek masası', room: 'Mutfak', planned: { amount: '12400.00', currency: 'TRY' }, dates: { planned: '2026-12-02', paid: '2026-11-20' } }),
  row({ id: 'ALM-0139', label: 'Karartma perde seti', room: 'Bebek odası', dates: { planned: '2026-10-21' } }),
  row({ id: 'ALM-0125', label: 'Bulaşık makinesi', room: 'Mutfak', planned: { amount: '31000.00', currency: 'TRY' }, dates: { planned: '2027-01-10', paid: '2026-11-05' } }),
  row({ id: 'ALM-0142', label: 'Bebek karyolası', room: 'Bebek odası', planned: { amount: '8500.00', currency: 'TRY' }, status: { label: 'Teslim alındı', tone: 'olumlu' }, dates: { planned: '2026-11-15' } }),
  row({ id: 'ALM-0128', label: 'Kedi kumu kabı', room: 'Banyo', dates: { planned: '2026-11-03' } }),
  row({ id: 'ALM-0150', label: 'Çamaşır kurutma makinesi', room: 'Banyo' }),
  row({ id: 'ALM-0151', label: 'Mama kabı', room: 'Mutfak', dates: {} }),
];

const headingTexts = () => screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent ?? '');

/** matchMedia: (min-width: Npx) sorgularını verilen viewport genişliğine göre çözer (vitest.setup her sorguyu eşleşmez sayar → phone). */
function installViewport(width: number) {
  const previous = window.matchMedia;
  window.matchMedia = vi.fn().mockImplementation((media: string) => {
    const match = media.match(/min-width:\s*(\d+)px/);
    return {
      matches: match ? width >= Number(match[1]) : false,
      media,
      onchange: null,
      addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    };
  }) as unknown as typeof window.matchMedia;
  return () => { window.matchMedia = previous; };
}

describe('Timeline — ay grupları', () => {
  it('kayıtları aya böler, ayları artan sırada yazar ve her başlıkta kayıt sayısını verir', () => {
    render(<Timeline items={ITEMS} dateField="planned" />);
    // Başlık metni boşlukla ayrılır: ekran okuyucu "Kasım 2026 2 kayıt" duyar, "20262" değil.
    expect(headingTexts()).toEqual(['Ekim 2026 1 kayıt', 'Kasım 2026 2 kayıt', 'Aralık 2026 1 kayıt', 'Ocak 2027 1 kayıt', 'Tarihi bilinmiyor 2 kayıt']);
    expect(screen.getByRole('heading', { level: 3, name: 'Kasım 2026 2 kayıt' })).toBeInTheDocument();
  });

  it('her grup başlığıyla adlanan bir bölgedir ve kayıtları sıralı liste içinde taşır', () => {
    render(<Timeline items={ITEMS} dateField="planned" />);
    const kasim = screen.getByRole('region', { name: 'Kasım 2026 2 kayıt' });
    const list = within(kasim).getByRole('list');
    expect(list.tagName).toBe('OL');
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
  });

  it('ay içinde günler artan sırada; solda gün ve ay kısaltması, kayıtta tam tarih 15.11.2026 biçiminde', () => {
    render(<Timeline items={ITEMS} dateField="planned" />);
    const kasim = screen.getByRole('region', { name: 'Kasım 2026 2 kayıt' });
    const buttons = within(kasim).getAllByRole('button');
    expect(buttons.map(b => b.textContent)).toEqual([
      expect.stringContaining('Kedi kumu kabı'),
      expect.stringContaining('Bebek karyolası'),
    ]);
    const items = within(kasim).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent(/^3Kas/);
    expect(items[1]).toHaveTextContent(/^15Kas/);
    expect(within(kasim).getByRole('button', { name: /Bebek karyolası/ })).toHaveTextContent('ALM-0142 · Bebek odası · Planlanan teslim 15.11.2026');
  });

  it('tarihi olmayanlar sonda "Tarihi bilinmiyor" grubunda görünür, gizlenmez', () => {
    render(<Timeline items={ITEMS} dateField="planned" />);
    const son = screen.getByRole('region', { name: 'Tarihi bilinmiyor 2 kayıt' });
    expect(screen.getAllByRole('region').at(-1)).toBe(son);
    expect(within(son).getByRole('button', { name: /Çamaşır kurutma makinesi/ })).toHaveTextContent('Planlanan teslim: Bilinmiyor');
    expect(within(son).getByRole('button', { name: /Mama kabı/ })).toBeInTheDocument();
    // Tarih sütunu bu grupta boştur; "—" ekran okuyucuya okunmaz.
    expect(within(son).getAllByRole('listitem')[0]).not.toHaveTextContent(/^\d/);
  });

  it('dateField değişince aynı kayıtlar o tarihe göre yeniden bölünür', () => {
    render(<Timeline items={ITEMS} dateField="paid" />);
    expect(headingTexts()).toEqual(['Kasım 2026 2 kayıt', 'Tarihi bilinmiyor 5 kayıt']);
    const kasim = screen.getByRole('region', { name: 'Kasım 2026 2 kayıt' });
    expect(within(kasim).getAllByRole('button').map(b => b.textContent)).toEqual([
      expect.stringContaining('Bulaşık makinesi'),
      expect.stringContaining('Yemek masası'),
    ]);
    expect(within(kasim).getByRole('button', { name: /Yemek masası/ })).toHaveTextContent('Ödeme 20.11.2026');
  });

  it('okunamayan tarih gizlenmez: kayıt "Tarihi bilinmiyor" grubunda, nedeni yazılı', () => {
    render(<Timeline items={[row({ id: 'ALM-0001', label: 'Lambader', dates: { planned: 'yakında' } })]} dateField="planned" />);
    const son = screen.getByRole('region', { name: 'Tarihi bilinmiyor 1 kayıt' });
    expect(within(son).getByRole('button', { name: /Lambader/ })).toHaveTextContent('Planlanan teslim: Tarih okunamadı');
  });

  it('kayıt yoksa bunu söyler', () => {
    render(<Timeline items={[]} dateField="planned" />);
    expect(screen.getByText('Henüz kayıt yok')).toBeInTheDocument();
    expect(screen.queryByRole('heading')).toBeNull();
  });
});

describe('Timeline — kayıt satırı', () => {
  it('durumu sözcükle (Tag) ve Planlanan tutarı ₺ tr-TR iki ondalıkla gösterir; fiyatsızda "Fiyat yok"', () => {
    render(<Timeline items={ITEMS} dateField="planned" />);
    const karyola = screen.getByRole('button', { name: /Bebek karyolası/ });
    expect(within(karyola).getByText('Teslim alındı').closest('[data-tone]')).toHaveAttribute('data-tone', 'olumlu');
    expect(karyola).toHaveTextContent('Planlanan ₺8.500,00');
    const perde = screen.getByRole('button', { name: /Karartma perde seti/ });
    expect(perde).toHaveTextContent('Planlanan Fiyat yok');
    expect(perde).not.toHaveTextContent('₺');
  });

  it('sayı olmayan tutar "Bilinmiyor" diye yazılır, asla NaN', () => {
    render(<Timeline items={[row({ id: 'ALM-0002', label: 'Halı', planned: { amount: 'yaklaşık', currency: 'TRY' } })]} dateField="planned" />);
    const button = screen.getByRole('button', { name: /Halı/ });
    expect(button).toHaveTextContent('Planlanan Bilinmiyor');
    expect(button).not.toHaveTextContent('NaN');
  });

  it('tıklamada ve Enter ile onOpen kaydın kendisiyle çağrılır', async () => {
    const onOpen = vi.fn();
    render(<Timeline items={ITEMS} dateField="planned" onOpen={onOpen} />);
    await userEvent.click(screen.getByRole('button', { name: /Bebek karyolası/ }));
    expect(onOpen).toHaveBeenCalledWith(ITEMS[3]);
    screen.getByRole('button', { name: /Kedi kumu kabı/ }).focus();
    await userEvent.keyboard('{Enter}');
    expect(onOpen).toHaveBeenLastCalledWith(ITEMS[4]);
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it('selectedKey yalnız o kaydı aria-current ile işaretler', () => {
    render(<Timeline items={ITEMS} dateField="planned" selectedKey="ALM-0142" />);
    expect(screen.getByRole('button', { name: /Bebek karyolası/ })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: /Kedi kumu kabı/ })).not.toHaveAttribute('aria-current');
    expect(screen.getAllByRole('button').filter(b => b.getAttribute('aria-current') === 'true')).toHaveLength(1);
  });

  it('narrow verilmeyince cihazdan türer: masaüstünde geniş, telefonda dar; narrow=true masaüstünde de dar', () => {
    const restore = installViewport(1280);
    try {
      const { container, rerender } = render(<Timeline items={ITEMS} dateField="planned" />);
      expect(container.firstElementChild).toHaveAttribute('data-narrow', 'false');
      rerender(<Timeline items={ITEMS} dateField="planned" narrow />);
      expect(container.firstElementChild).toHaveAttribute('data-narrow', 'true');
    } finally {
      restore();
    }
    const phone = installViewport(375);
    try {
      const { container } = render(<Timeline items={ITEMS} dateField="planned" />);
      expect(container.firstElementChild).toHaveAttribute('data-narrow', 'true');
    } finally {
      phone();
    }
  });

  it('kayıt düğmesi odak çizgisini admin.css\'ten alır (data-focus-line) ve 44 px hedef sınıfını taşır', () => {
    render(<Timeline items={ITEMS} dateField="planned" />);
    const button = screen.getByRole('button', { name: /Bebek karyolası/ });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveAttribute('data-focus-line');
  });
});

describe('Timeline — tarih okuma', () => {
  it('takvimde olmayan gün (31 Şubat, 31 Nisan) okunamadı sayılır: "Tarihi bilinmiyor" grubunda, nedeni yazılı', () => {
    render(<Timeline items={[
      row({ id: 'T-1', label: 'Şubat otuz biri', dates: { planned: '2027-02-31' } }),
      row({ id: 'T-2', label: 'Nisan otuz biri', dates: { planned: '2027-04-31' } }),
      row({ id: 'T-3', label: 'Artık gün', dates: { planned: '2028-02-29' } }),
    ]} dateField="planned" />);
    expect(headingTexts()).toEqual(['Şubat 2028 1 kayıt', 'Tarihi bilinmiyor 2 kayıt']);
    const undated = screen.getByRole('region', { name: /^Tarihi bilinmiyor/ });
    expect(within(undated).getByRole('button', { name: /Şubat otuz biri/ })).toHaveTextContent('Planlanan teslim: Tarih okunamadı');
    expect(within(undated).getByRole('button', { name: /Nisan otuz biri/ })).toHaveTextContent('Planlanan teslim: Tarih okunamadı');
  });

  it('saatli ISO değer Europe/Istanbul takvim gününe yerleşir; ofsetsiz saat yerel duvar saatidir', () => {
    render(<Timeline items={[
      row({ id: 'Z-1', label: 'UTC gece', dates: { paid: '2026-11-30T22:30:00Z' } }),
      row({ id: 'Z-2', label: 'İstanbul gece', dates: { paid: '2026-11-30T23:30:00+03:00' } }),
      row({ id: 'Z-3', label: 'Ofsetsiz', dates: { paid: '2026-12-02T10:00:00' } }),
    ]} dateField="paid" />);
    expect(headingTexts()).toEqual(['Kasım 2026 1 kayıt', 'Aralık 2026 2 kayıt']);
    expect(screen.getByRole('button', { name: /UTC gece/ })).toHaveTextContent('Ödeme 01.12.2026');
    expect(screen.getByRole('button', { name: /İstanbul gece/ })).toHaveTextContent('Ödeme 30.11.2026');
    expect(screen.getByRole('button', { name: /Ofsetsiz/ })).toHaveTextContent('Ödeme 02.12.2026');
  });

  it('aynı gündeki kayıtlar gelen sırayı korur; aylar yıl sınırını doğru sıralar', () => {
    render(<Timeline items={[
      row({ id: 'S-1', label: 'Ocak kaydı', dates: { planned: '2027-01-02' } }),
      row({ id: 'S-2', label: 'Aralık ikinci', dates: { planned: '2026-12-05' } }),
      row({ id: 'S-3', label: 'Aralık birinci', dates: { planned: '2026-12-05' } }),
    ]} dateField="planned" />);
    expect(headingTexts()).toEqual(['Aralık 2026 2 kayıt', 'Ocak 2027 1 kayıt']);
    const aralik = screen.getByRole('region', { name: /^Aralık 2026/ });
    expect(within(aralik).getAllByRole('button').map(b => b.querySelector('.aile-tl-title')?.textContent)).toEqual(['Aralık ikinci', 'Aralık birinci']);
  });
});

describe('Timeline — klavye ve dokunma', () => {
  it('Tab kronolojik sırayla kayıtlarda ilerler, tarihsizler en sonda; Shift+Tab geri; Space de açar', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<Timeline items={ITEMS} dateField="planned" onOpen={onOpen} />);
    const order: string[] = [];
    for (let i = 0; i < ITEMS.length; i += 1) {
      await user.tab();
      order.push((document.activeElement as HTMLElement).querySelector('.aile-tl-title')?.textContent ?? '');
    }
    expect(order).toEqual(['Karartma perde seti', 'Kedi kumu kabı', 'Bebek karyolası', 'Yemek masası', 'Bulaşık makinesi', 'Çamaşır kurutma makinesi', 'Mama kabı']);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Çamaşır kurutma makinesi/ }));
    await user.keyboard(' ');
    expect(onOpen).toHaveBeenCalledWith(ITEMS[5]);
  });

  it('Pointer Events: basılınca data-pressed; pointercancel (kaydırma) basılı durumu siler ve kaydı açmaz', () => {
    const onOpen = vi.fn();
    render(<Timeline items={ITEMS} dateField="planned" onOpen={onOpen} />);
    const button = screen.getByRole('button', { name: /Bebek karyolası/ });
    fireEvent.pointerDown(button, { pointerType: 'touch', button: 0, isPrimary: true });
    expect(button).toHaveAttribute('data-pressed', 'true');
    fireEvent.pointerCancel(button, { pointerType: 'touch' });
    expect(button).not.toHaveAttribute('data-pressed');
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.pointerDown(button, { pointerType: 'pen', button: 0 });
    fireEvent.pointerUp(button, { pointerType: 'pen' });
    expect(button).not.toHaveAttribute('data-pressed');
  });

  it('CSS: kayıt düğmesi 44 px, kaba işaretçide 48 px; basılı durum secili; reduced-motion anlık; antd sınıfı yok', () => {
    const css = readFileSync(resolve(__dirname, 'Timeline.css'), 'utf8');
    expect(css).toMatch(/--aile-tl-hedef:\s*var\(--aile-hedef-asgari\)/);
    expect(css).toMatch(/\[data-input-coarse\][^{]*\{[^}]*--aile-tl-hedef:\s*calc\(var\(--aile-hedef-asgari\)\s*\+\s*var\(--aile-bosluk-1\)\)/);
    expect(css).toMatch(/\.aile-tl-body\s*\{[^}]*min-height:\s*var\(--aile-tl-hedef\)/);
    expect(css).toMatch(/\.aile-tl-body\[data-pressed='true'\]/);
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce[\s\S]*transition-duration:\s*0s/);
    expect(css).not.toMatch(/\.ant-/);
  });
});

describe('Timeline — kaynak kuralları', () => {
  const read = (name: string) => readFileSync(resolve(__dirname, name), 'utf8');

  it('ham antd/phosphor importu yok; cihaz ../device, durum etiketi ./Tag, para ./Money üzerinden (yerel biçimleyici yok)', () => {
    const tsx = read('Timeline.tsx');
    expect(tsx).not.toMatch(/from ['"](antd|@ant-design\/|@phosphor-icons\/|echarts)/);
    expect(tsx).toMatch(/from ['"]\.\.\/device['"]/);
    expect(tsx).toMatch(/useDevice\(\)/);
    expect(tsx).toMatch(/from ['"]\.\/Tag['"]/);
    expect(tsx).toMatch(/from ['"]\.\/Money['"]/);
    expect(tsx).not.toMatch(/Intl\.NumberFormat/);
    expect(tsx).toMatch(/from ['"]\.\.\/shell\/contracts['"]/);
    expect(tsx).not.toMatch(/from\s+['"]\.{1,2}\/antd['"]/);
    expect(tsx).not.toMatch(/\.wide['"]/);
  });

  it('bileşen içinde sabit renk yok; renk, boşluk, köşe, hedef ve hareket --aile tokenlarından', () => {
    const tsx = read('Timeline.tsx');
    const css = read('Timeline.css');
    expect(tsx).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/rgba?\(/);
    for (const token of ['--aile-yuzey', '--aile-cizgi', '--aile-secili', '--aile-bilgi-yuzey', '--aile-eylem', '--aile-acik-mavi', '--aile-metin-ikincil',
      '--aile-kose-kontrol', '--aile-hedef-asgari', '--aile-sure', '--aile-egri']) {
      expect(css, token).toContain(`var(${token})`);
    }
  });

  it('metin 14 CSS px altına inmez; odak için outline/halka/box-shadow yok; renkli tek kenar şeridi yok', () => {
    const css = read('Timeline.css');
    const sizes = [...css.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map(m => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(0);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(14);
    expect(css).not.toMatch(/outline\s*:(?!\s*none)/);
    expect(css).not.toMatch(/box-shadow\s*:(?!\s*none)/);
    expect(css).not.toMatch(/border-(left|right|top|bottom)\s*:\s*\d+px\s+solid\s+var\(--aile-(eylem|olumlu|uyari|hata|acik-mavi)\)/);
    expect(css).toMatch(/prefers-reduced-motion/);
  });
});
