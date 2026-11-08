import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';
import { useState } from 'react';
import { designTokens, targetTokens } from '../../design/tokens.ts';
import type { RecordRow, ResponsiveColumn } from '../shell/contracts';
import { Table, type TableColumn, type TableSort } from './Table';

// Tasarım: components/Table/README.md — başlık yapışkan 14/600, sütun minWidth, tutar sağa, satır tıklanır ve
// Enter ile açılır, seçili satır `secili`, caption görsel gizli. Uyarlamalı teslim: yerel <table> (antd yok), kendi
// kapsayıcısında yatay kayar (taşarken tabindex=0 + bölge adı), ilk sütun alanın en çok yarısını tutuyorsa yapışkan,
// büyüyen (açıklama) sütun kalan alanı alır, sıralanabilir başlık düğme + aria-sort. Seçiciler role/label.
const money = (amount: string) => ({ amount, currency: 'TRY' });
const rows: RecordRow[] = [
  { id: 'r1', code: 'AL-001', label: 'Mutfak dolabı', status: { label: 'Sipariş verildi', tone: 'bilgi' }, planned: money('8500.00'), actual: null, kind: 'purchase_need' },
  { id: 'r2', code: 'AL-002', label: 'Salon halısı', status: { label: 'Teslim edildi', tone: 'olumlu' }, planned: money('3200.00'), actual: money('3150.00'), kind: 'purchase_need' },
];
const columns: ResponsiveColumn<RecordRow>[] = [
  { key: 'code', title: 'Kimlik', minWidth: 112, m: 'meta' },
  { key: 'label', title: 'Ad', minWidth: 240, m: 'title' },
  { key: 'planned', title: 'Plan', align: 'right', minWidth: 128, render: row => row.planned ? row.planned.amount : 'Fiyat yok' },
  { key: 'actual', title: 'Gerçek', align: 'right', minWidth: 128, render: row => row.actual ? row.actual.amount : 'Henüz yok' },
  { key: 'status', title: 'Durum', minWidth: 160, render: row => row.status.label },
];

const read = (file: string) => readFileSync(resolve(__dirname, file), 'utf8');
const rowOf = (text: string) => screen.getByText(text).closest('tr') as HTMLTableRowElement;
const bodyTexts = (columnIndex = 0) =>
  screen.getAllByRole('row').slice(1).map(row => within(row).getAllByRole('cell')[columnIndex]!.textContent);

/** Kaydırma alanı ölçüsü: genişlik getBoundingClientRect, taşma scrollWidth ile clientWidth; ResizeObserver elle tetiklenir. */
function installArea({ width, scrollWidth, clientWidth = width }: { width: number; scrollWidth: number; clientWidth?: number }) {
  let observed: ResizeObserverCallback | undefined;
  class FakeResizeObserver {
    constructor(cb: ResizeObserverCallback) { observed = cb; }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  window.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
  const size = { width, scrollWidth, clientWidth };
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() =>
    ({ width: size.width, height: 0, top: 0, left: 0, right: size.width, bottom: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect);
  vi.spyOn(Element.prototype, 'scrollWidth', 'get').mockImplementation(() => size.scrollWidth);
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(() => size.clientWidth);
  return {
    resize(next: Partial<typeof size>) {
      Object.assign(size, next);
      act(() => observed?.([], {} as ResizeObserver));
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Table', () => {
  it('renders every column title as a column header and names the table with the caption', () => {
    render(<Table columns={columns} rows={rows} caption="Alımlar" />);
    expect(screen.getByRole('table', { name: 'Alımlar' })).toBeInTheDocument();
    const headers = screen.getAllByRole('columnheader').map(th => th.textContent);
    expect(headers).toEqual(['Kimlik', 'Ad', 'Plan', 'Gerçek', 'Durum']);
    expect(screen.getByText('Mutfak dolabı')).toBeInTheDocument();
    expect(screen.getByText('AL-002')).toBeInTheDocument();
  });

  it('keeps each column at its minimum width through the header cell', () => {
    render(<Table columns={columns} rows={rows} caption="Alımlar" />);
    expect(screen.getByRole('columnheader', { name: 'Ad' })).toHaveStyle({ minWidth: '240px' });
    expect(screen.getByRole('columnheader', { name: 'Kimlik' })).toHaveStyle({ minWidth: '112px' });
  });

  it('aligns amount columns to the right and marks their cells as tutar', () => {
    render(<Table columns={columns} rows={rows} caption="Alımlar" />);
    expect(screen.getByRole('columnheader', { name: 'Plan' })).toHaveStyle({ textAlign: 'right' });
    expect(screen.getByRole('columnheader', { name: 'Ad' })).not.toHaveStyle({ textAlign: 'right' });
    const planned = screen.getByText('8500.00').closest('td') as HTMLTableCellElement;
    expect(planned).toHaveClass('aile-tutar');
    expect(screen.getByText('Henüz yok').closest('td')).toHaveClass('aile-tutar');
    expect(screen.getByText('Mutfak dolabı').closest('td')).not.toHaveClass('aile-tutar');
  });

  it('opens a row on click and on Enter, not on other keys', async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    render(<Table columns={columns} rows={rows} caption="Alımlar" onRowClick={onRowClick} />);
    const row = rowOf('Salon halısı');
    // Satırlar odaklanabilir; sekme durağı tektir (dolaşan tabindex, ayrı testte).
    expect(row).toHaveAttribute('tabindex');

    await user.click(within(row).getByText('Salon halısı'));
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick).toHaveBeenLastCalledWith(rows[1]);

    row.focus();
    expect(row).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(onRowClick).toHaveBeenCalledTimes(1);
    await user.keyboard('{Enter}');
    expect(onRowClick).toHaveBeenCalledTimes(2);
    expect(onRowClick).toHaveBeenLastCalledWith(rows[1]);
  });

  it('does not open the row when a control inside a cell is used', async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    const withAction: ResponsiveColumn<RecordRow>[] = [
      ...columns,
      { key: 'edit', title: 'Eylem', minWidth: 96, render: () => <button type="button">Düzenle</button> },
    ];
    render(<Table columns={withAction} rows={rows} caption="Alımlar" onRowClick={onRowClick} />);
    await user.click(within(rowOf('Mutfak dolabı')).getByRole('button', { name: 'Düzenle' }));
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('leaves rows out of the tab order when nothing opens on click', () => {
    render(<Table columns={columns} rows={rows} caption="Alımlar" />);
    expect(rowOf('Mutfak dolabı')).not.toHaveAttribute('tabindex');
  });

  it('marks only the selected row with aria-selected, keyed by id', () => {
    render(<Table columns={columns} rows={rows} caption="Alımlar" selectedKey="r2" onRowClick={() => {}} />);
    expect(rowOf('Salon halısı')).toHaveAttribute('aria-selected', 'true');
    expect(rowOf('Mutfak dolabı')).not.toHaveAttribute('aria-selected');
  });

  it('accepts another row key', () => {
    render(<Table columns={columns} rows={rows} caption="Alımlar" selectedKey="AL-001" rowKey={row => row.code} />);
    expect(rowOf('Mutfak dolabı')).toHaveAttribute('aria-selected', 'true');
    expect(rowOf('Salon halısı')).not.toHaveAttribute('aria-selected');
  });

  it('names the empty state instead of showing a bare table', () => {
    render(<Table columns={columns} rows={[]} caption="Alımlar" />);
    expect(screen.getByText('Henüz yok')).toBeInTheDocument();
    expect(screen.queryByRole('row', { name: /AL-/ })).toBeNull();
    // Boş durum tek hücredir ve bütün sütunları kaplar.
    expect(screen.getByRole('cell', { name: 'Henüz yok' })).toHaveAttribute('colspan', String(columns.length));
  });
});

describe('Table › yerel tablo ve kaydırma alanı', () => {
  it('başlık ve gövde tek <table> içindedir; tablo kendi kaydırma kabının içindedir', () => {
    const { container } = render(<Table columns={columns} rows={rows} caption="Alımlar" />);
    const scroller = container.querySelector('.aile-table-kaydirici') as HTMLElement;
    const table = within(scroller).getByRole('table', { name: 'Alımlar' });
    expect(within(table).getAllByRole('rowgroup')).toHaveLength(2);
    // 1 başlık satırı + 2 gövde satırı aynı tabloda (antd'nin ayrık başlık tablosu yok).
    expect(within(table).getAllByRole('row')).toHaveLength(1 + rows.length);
    expect(within(table).getAllByRole('columnheader')).toHaveLength(columns.length);
    for (const header of within(table).getAllByRole('columnheader')) expect(header).toHaveAttribute('scope', 'col');
    expect(document.querySelectorAll('table')).toHaveLength(1);
  });

  it('kaydırma kabı landmark değildir: sayfanın aynı adlı bölümüyle çakışan ikinci "region" üretmez', () => {
    installArea({ width: 400, scrollWidth: 900 });
    render(<section aria-label="Alımlar"><Table columns={columns} rows={rows} caption="Alımlar" /></section>);
    expect(screen.getAllByRole('region', { name: 'Alımlar' })).toHaveLength(1);
  });

  it('içerik taşarken kap sekme sırasına girer (tabindex=0) ve caption adlı gruptur; taşmayınca ne odak ne ad; ölçü değişince güncellenir', () => {
    const area = installArea({ width: 400, scrollWidth: 900 });
    const { container } = render(<Table columns={columns} rows={rows} caption="Alımlar" />);
    const scroller = container.querySelector('.aile-table-kaydirici') as HTMLElement;
    expect(screen.getByRole('group', { name: 'Alımlar' })).toBe(scroller);
    expect(scroller).toHaveAttribute('tabindex', '0');
    expect(scroller).toHaveAttribute('data-overflow', 'true');

    area.resize({ width: 1200, clientWidth: 1200, scrollWidth: 1200 });
    expect(scroller).not.toHaveAttribute('tabindex');
    expect(scroller).not.toHaveAttribute('data-overflow');
    expect(scroller).not.toHaveAttribute('role');
    expect(scroller).not.toHaveAttribute('aria-label');
  });

  it('ilk sütun alanın en çok yarısını tutuyorsa yapışkandır; dar alanda değildir', () => {
    // İlk sütun: minWidth 112 + iki yanlık hücre dolgusu (2 × bosluk-4) = 144 px.
    const first = 112 + 2 * designTokens.bosluk4;
    const area = installArea({ width: first * 2, scrollWidth: 900 });
    const { container } = render(<Table columns={columns} rows={rows} caption="Alımlar" />);
    const scroller = container.querySelector('.aile-table-kaydirici') as HTMLElement;
    expect(scroller).toHaveAttribute('data-sticky-first', 'true');

    area.resize({ width: first * 2 - 1, clientWidth: first * 2 - 1 });
    expect(scroller).not.toHaveAttribute('data-sticky-first');
  });

  it('ölçüm yokken (0) ilk sütun yapışmaz ve kapsayıcı sekme sırasına girmez', () => {
    const { container } = render(<Table columns={columns} rows={rows} caption="Alımlar" />);
    const scroller = container.querySelector('.aile-table-kaydirici') as HTMLElement;
    expect(scroller).not.toHaveAttribute('data-sticky-first');
    expect(scroller).not.toHaveAttribute('tabindex');
  });

  it('maxHeight verilince kapsayıcı o yükseklikte kendi içinde kayar (yapışkan başlık bu alanda); verilmezse dikey kaydırma yok', () => {
    const { container, unmount } = render(<Table columns={columns} rows={rows} caption="Alımlar" maxHeight={480} />);
    const scroller = container.querySelector('.aile-table-kaydirici') as HTMLElement;
    expect(scroller).toHaveStyle({ maxHeight: '480px' });
    expect(scroller).toHaveAttribute('data-dikey-kaydirma', 'true');
    unmount();
    const { container: plain } = render(<Table columns={columns} rows={rows} caption="Alımlar" />);
    expect(plain.querySelector('.aile-table-kaydirici')).not.toHaveAttribute('data-dikey-kaydirma');
  });

  it('başlık hücreleri yalnız dikey kaydırma alanında (maxHeight) yapışır; aksi hâlde yalnız ilk sütun yapışkandır', () => {
    const css = read('Table.css');
    const stickyRules = Array.from(css.matchAll(/([^{}]+)\{([^}]*)\}/g))
      .filter(([, , body]) => /position: sticky/.test(body!))
      .map(([, selector]) => selector!.replace(/\/\*[\s\S]*?\*\//g, '').trim());
    expect(stickyRules.length).toBeGreaterThan(0);
    for (const selector of stickyRules) expect(selector).toMatch(/\[data-dikey-kaydirma\]|\[data-sticky-first\].*:first-child$/);
  });

  it('büyüyen (açıklama) sütun kalan alanı alır: diğer sütunlar genişliğini en küçük değerine sabitler', () => {
    const withNote: TableColumn<RecordRow>[] = [
      ...columns,
      { key: 'note', title: 'Açıklama', minWidth: 240, grow: true, render: () => 'Uzun açıklama' },
    ];
    const { unmount } = render(<Table columns={withNote} rows={rows} caption="Alımlar" />);
    expect(screen.getByRole('columnheader', { name: 'Ad' })).toHaveStyle({ width: '240px', minWidth: '240px' });
    expect(screen.getByRole('columnheader', { name: 'Kimlik' })).toHaveStyle({ width: '112px' });
    const note = screen.getByRole('columnheader', { name: 'Açıklama' });
    expect(note).toHaveStyle({ minWidth: '240px' });
    expect(note.style.width).toBe('');
    unmount();

    // Büyüyen sütun yoksa genişlik dağılımı içeriğe kalır (yalnız min-width).
    render(<Table columns={columns} rows={rows} caption="Alımlar" />);
    expect(screen.getByRole('columnheader', { name: 'Ad' }).style.width).toBe('');
  });
});

describe('Table › klavye ve dokunma', () => {
  it('Space de satırı açar; oklar, Home ve End satırlar arasında odağı taşır; Escape hiçbir şey yapmaz', async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    const three = [...rows, { ...rows[0]!, id: 'r3', code: 'AL-003', label: 'Bebek karyolası' }];
    render(<Table columns={columns} rows={three} caption="Alımlar" onRowClick={onRowClick} />);
    const [first, second, third] = ['Mutfak dolabı', 'Salon halısı', 'Bebek karyolası'].map(rowOf);

    first!.focus();
    await user.keyboard('[Space]');
    expect(onRowClick).toHaveBeenLastCalledWith(three[0]);
    await user.keyboard('{ArrowDown}');
    expect(second).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(third).toHaveFocus();
    // Son satırda ArrowDown odağı yerinde bırakır (sarmalamaz: tablo bir liste kutusu değil).
    await user.keyboard('{ArrowDown}');
    expect(third).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(second).toHaveFocus();
    await user.keyboard('{Home}');
    expect(first).toHaveFocus();
    await user.keyboard('{End}');
    expect(third).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(third).toHaveFocus();
    expect(onRowClick).toHaveBeenCalledTimes(1);
  });

  it('tıklanabilir satırlar tek sekme durağıdır (dolaşan tabindex): Tab tablodan tek adımda çıkar, oklar durağı taşır, dönüşte son odaklanan satır', async () => {
    const user = userEvent.setup();
    const three = [...rows, { ...rows[0]!, id: 'r3', code: 'AL-003', label: 'Bebek karyolası' }];
    render(
      <>
        <button type="button">Önce</button>
        <Table columns={columns} rows={three} caption="Alımlar" onRowClick={() => {}} />
        <button type="button">Sonra</button>
      </>,
    );
    const [first, second, third] = ['Mutfak dolabı', 'Salon halısı', 'Bebek karyolası'].map(rowOf);
    const duraklar = () => [first, second, third].map(row => row!.getAttribute('tabindex'));
    expect(duraklar()).toEqual(['0', '-1', '-1']);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Önce' })).toHaveFocus();
    await user.tab();
    expect(first).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Sonra' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(first).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(second).toHaveFocus();
    expect(duraklar()).toEqual(['-1', '0', '-1']);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Sonra' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(second).toHaveFocus();
    // İşaretçiyle odaklanan satır da durak olur (tıklanan satır sonraki Tab dönüşünün hedefi).
    await user.click(within(third!).getByText('Bebek karyolası'));
    expect(third).toHaveFocus();
    expect(duraklar()).toEqual(['-1', '-1', '0']);
  });

  it('seçili satır, odaklanmadan önce sekme durağıdır; seçim değişince durak seçili satıra geçer', () => {
    const three = [...rows, { ...rows[0]!, id: 'r3', code: 'AL-003', label: 'Bebek karyolası' }];
    const { rerender } = render(<Table columns={columns} rows={three} caption="Alımlar" selectedKey="r2" onRowClick={() => {}} />);
    const durak = () => ['Mutfak dolabı', 'Salon halısı', 'Bebek karyolası'].map(rowOf).map(row => row.getAttribute('tabindex'));
    expect(durak()).toEqual(['-1', '0', '-1']);
    act(() => rowOf('Mutfak dolabı').focus());
    expect(durak()).toEqual(['0', '-1', '-1']);
    rerender(<Table columns={columns} rows={three} caption="Alımlar" selectedKey="r3" onRowClick={() => {}} />);
    expect(durak()).toEqual(['-1', '-1', '0']);
  });

  it('satırın açılabildiği duyurulur: tıklanabilir satır tek ipucuyla açıklanır (ad değişmez); ipucu değiştirilebilir', () => {
    const { unmount } = render(<Table columns={columns} rows={rows} caption="Alımlar" onRowClick={() => {}} />);
    for (const label of ['Mutfak dolabı', 'Salon halısı']) {
      const row = screen.getByRole('row', { name: new RegExp(label) });
      expect(row).toHaveAccessibleDescription('Enter ya da Boşluk ile açılır.');
      expect(row).toHaveAccessibleName(new RegExp(`^AL-00\\d ${label}`));
    }
    // İpucu görünür değildir ama tek kopyadır (her satıra ayrı metin yok) ve 14 px kuralına takılmaz (görsel gizli).
    expect(document.querySelectorAll('.aile-table-ipucu')).toHaveLength(1);
    unmount();

    const { unmount: kaldir } = render(<Table columns={columns} rows={rows} caption="Alımlar" onRowClick={() => {}} rowHint="Enter ya da Boşluk ile seçilir." />);
    expect(screen.getByRole('row', { name: /Mutfak dolabı/ })).toHaveAccessibleDescription('Enter ya da Boşluk ile seçilir.');
    kaldir();

    render(<Table columns={columns} rows={rows} caption="Alımlar" />);
    expect(screen.getByRole('row', { name: /Mutfak dolabı/ })).not.toHaveAttribute('aria-describedby');
    expect(document.querySelector('.aile-table-ipucu')).toBeNull();
  });

  it('iptal edilen dokunuş (pointercancel: kaydırma başladı) satırı açmaz; dokunup bırakma açar', () => {
    const onRowClick = vi.fn();
    render(<Table columns={columns} rows={rows} caption="Alımlar" onRowClick={onRowClick} />);
    const cell = within(rowOf('Salon halısı')).getByText('Salon halısı');
    fireEvent.pointerDown(cell, { pointerType: 'touch', isPrimary: true });
    fireEvent.pointerCancel(cell, { pointerType: 'touch', isPrimary: true });
    expect(onRowClick).not.toHaveBeenCalled();

    fireEvent.pointerDown(cell, { pointerType: 'touch', isPrimary: true });
    fireEvent.pointerUp(cell, { pointerType: 'touch', isPrimary: true });
    fireEvent.click(cell);
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick).toHaveBeenLastCalledWith(rows[1]);
  });
});

describe('Table › sıralama (aria-sort)', () => {
  interface Item { key: string; ad: string; tutar: number | null }
  const items: Item[] = [
    { key: 'a', ad: 'Çanta', tutar: 1200 },
    { key: 'b', ad: 'Cep telefonu', tutar: null },
    { key: 'c', ad: 'dolap', tutar: 300 },
    { key: 'd', ad: 'Ütü', tutar: 9500 },
    { key: 'e', ad: 'Ayna 10', tutar: 40 },
    { key: 'f', ad: 'Ayna 9', tutar: 40 },
  ];
  const sortable: TableColumn<Item>[] = [
    { key: 'ad', title: 'Ad', minWidth: 200, sortable: true },
    { key: 'tutar', title: 'Tutar', minWidth: 128, align: 'right', sortable: true, render: item => item.tutar === null ? 'Fiyat yok' : String(item.tutar) },
    { key: 'not', title: 'Not', minWidth: 160, render: () => '—' },
  ];
  const header = (name: string) => screen.getByRole('columnheader', { name });
  const sortButton = (name: string) => within(header(name)).getByRole('button', { name });

  it('sıralanabilir başlık içinde başlık adıyla düğme vardır; sıralanmamış sütunda aria-sort yoktur', () => {
    render(<Table columns={sortable} rows={items} caption="Kalemler" />);
    expect(sortButton('Ad')).toHaveAttribute('type', 'button');
    expect(sortButton('Tutar')).toBeInTheDocument();
    expect(within(header('Not')).queryByRole('button')).toBeNull();
    for (const name of ['Ad', 'Tutar', 'Not']) expect(header(name)).not.toHaveAttribute('aria-sort');
    // Düğmenin odak çizgisini admin.css [data-focus-line] çizer (çevreleyen halka yok).
    expect(sortButton('Ad')).toHaveAttribute('data-focus-line');
    // Veri sırası korunur.
    expect(bodyTexts()).toEqual(['Çanta', 'Cep telefonu', 'dolap', 'Ütü', 'Ayna 10', 'Ayna 9']);
  });

  it('tıklama artan, ikinci tıklama azalan sıralar; yalnız sıralanan sütun aria-sort taşır; Türkçe harmanlama, sayısal sıra', async () => {
    const user = userEvent.setup();
    render(<Table columns={sortable} rows={items} caption="Kalemler" />);
    await user.click(sortButton('Ad'));
    expect(header('Ad')).toHaveAttribute('aria-sort', 'ascending');
    expect(header('Tutar')).not.toHaveAttribute('aria-sort');
    // tr-TR: C < Ç < D ... < U < Ü; büyük/küçük harf ayrımı yok; "Ayna 9" < "Ayna 10" (sayısal).
    expect(bodyTexts()).toEqual(['Ayna 9', 'Ayna 10', 'Cep telefonu', 'Çanta', 'dolap', 'Ütü']);

    await user.click(sortButton('Ad'));
    expect(header('Ad')).toHaveAttribute('aria-sort', 'descending');
    expect(bodyTexts()).toEqual(['Ütü', 'dolap', 'Çanta', 'Cep telefonu', 'Ayna 10', 'Ayna 9']);

    // Başka sütuna geçiş artan başlar; önceki sütunun aria-sort'u kalkar.
    await user.click(sortButton('Tutar'));
    expect(header('Tutar')).toHaveAttribute('aria-sort', 'ascending');
    expect(header('Ad')).not.toHaveAttribute('aria-sort');
    // Eşit değerler veri sırasını korur (kararlı); eksik değer ("Fiyat yok") her yönde sonda.
    expect(bodyTexts()).toEqual(['Ayna 10', 'Ayna 9', 'dolap', 'Çanta', 'Ütü', 'Cep telefonu']);
    await user.click(sortButton('Tutar'));
    expect(bodyTexts()).toEqual(['Ütü', 'Çanta', 'dolap', 'Ayna 10', 'Ayna 9', 'Cep telefonu']);
  });

  it('başlık düğmesi Enter ve Space ile sıralar; odak düğmede kalır', async () => {
    const user = userEvent.setup();
    render(<Table columns={sortable} rows={items} caption="Kalemler" />);
    sortButton('Tutar').focus();
    await user.keyboard('{Enter}');
    expect(header('Tutar')).toHaveAttribute('aria-sort', 'ascending');
    expect(sortButton('Tutar')).toHaveFocus();
    await user.keyboard('[Space]');
    expect(header('Tutar')).toHaveAttribute('aria-sort', 'descending');
    expect(sortButton('Tutar')).toHaveFocus();
  });

  it('sıralama sonrası odaktaki satır odakta kalır (anahtarlı satırlar yeniden bağlanmaz)', async () => {
    const user = userEvent.setup();
    render(<Table columns={sortable} rows={items} caption="Kalemler" onRowClick={() => {}} />);
    const utu = rowOf('Ütü');
    utu.focus();
    await user.click(sortButton('Ad'));
    expect(rowOf('Ütü')).toBe(utu);
    utu.focus();
    expect(utu).toHaveFocus();
  });

  it('defaultSort ilk sırayı verir; sortValue verilmişse ona göre sıralar', () => {
    const byLength: TableColumn<Item>[] = [{ ...sortable[0]!, sortValue: item => item.ad.length }, sortable[1]!];
    render(<Table columns={byLength} rows={items} caption="Kalemler" defaultSort={{ key: 'ad', direction: 'descending' }} />);
    expect(header('Ad')).toHaveAttribute('aria-sort', 'descending');
    expect(bodyTexts()).toEqual(['Cep telefonu', 'Ayna 10', 'Ayna 9', 'Çanta', 'dolap', 'Ütü']);
  });

  it('denetimli: sort prop sırayı belirler; tıklama onSortChange ile sonraki sıralamayı bildirir, kendiliğinden değişmez', async () => {
    const user = userEvent.setup();
    const onSortChange = vi.fn();
    const sort: TableSort = { key: 'tutar', direction: 'descending' };
    const { rerender } = render(<Table columns={sortable} rows={items} caption="Kalemler" sort={sort} onSortChange={onSortChange} />);
    expect(header('Tutar')).toHaveAttribute('aria-sort', 'descending');
    await user.click(sortButton('Tutar'));
    expect(onSortChange).toHaveBeenLastCalledWith({ key: 'tutar', direction: 'ascending' });
    expect(header('Tutar')).toHaveAttribute('aria-sort', 'descending');
    await user.click(sortButton('Ad'));
    expect(onSortChange).toHaveBeenLastCalledWith({ key: 'ad', direction: 'ascending' });

    rerender(<Table columns={sortable} rows={items} caption="Kalemler" sort={null} onSortChange={onSortChange} />);
    for (const name of ['Ad', 'Tutar']) expect(header(name)).not.toHaveAttribute('aria-sort');
    expect(bodyTexts()).toEqual(['Çanta', 'Cep telefonu', 'dolap', 'Ütü', 'Ayna 10', 'Ayna 9']);
  });

  it('denetimli kullanım sayfanın durumuyla birlikte çalışır', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [sort, setSort] = useState<TableSort | null>(null);
      return <Table columns={sortable} rows={items} caption="Kalemler" sort={sort} onSortChange={setSort} />;
    }
    render(<Harness />);
    await user.click(sortButton('Tutar'));
    expect(header('Tutar')).toHaveAttribute('aria-sort', 'ascending');
    expect(bodyTexts()[0]).toBe('Ayna 10');
  });
});

describe('Table › kaynak kuralları', () => {
  it('telefon yolunda antd yok: Table.tsx antd, @ant-design/* ya da ./antd içe aktarmaz; ResponsiveColumn sözleşmesi korunur', () => {
    const tsx = read('Table.tsx');
    expect(tsx).not.toMatch(/from\s+['"](antd|antd\/[^'"]*|@ant-design\/[^'"]*|\.\/antd|\.\.\/ui\/antd)['"]/);
    expect(tsx).not.toMatch(/import\(\s*['"](antd|@ant-design\/)/);
    expect(tsx).toContain("import './Table.css'");
    expect(tsx).toMatch(/Pick<ResponsiveColumn<R>, 'key' \| 'title' \| 'align' \| 'minWidth' \| 'render'>/);
  });

  it('CSS yalnız --aile tokenlarıyla: hex yok, outline/box-shadow yok, sabit px yok (1 px çizgi hariç), font-size yok (14/20 .aile-kucuk)', () => {
    const css = read('Table.css');
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/outline|box-shadow/);
    expect(css).not.toMatch(/font-size/);
    const fixedPx = (css.match(/\b\d+(?:\.\d+)?px\b/g) ?? []).filter(value => value !== '1px');
    expect(fixedPx).toEqual([]);
    expect(css).toMatch(/var\(--aile-yuzey\)/);
    expect(css).toMatch(/var\(--aile-cizgi\)/);
    expect(css).toMatch(/var\(--aile-secili\)/);
  });

  it('başlık ve ilk sütun kelime ortasından bölünmez: break-all / anywhere yok, başlıkta keep-all', () => {
    const css = read('Table.css');
    expect(css).not.toMatch(/break-all|anywhere/);
    expect(css).toMatch(/th[^{]*\{[^}]*word-break: keep-all/);
    expect(css).toMatch(/overflow-wrap: normal/);
    // Başlık 14/20 metni admin.css .aile-kucuk sınıfıyla alır (alt sınır 14 px).
    render(<Table columns={columns} rows={rows} caption="Alımlar" />);
    for (const th of screen.getAllByRole('columnheader')) expect(th).toHaveClass('aile-kucuk');
  });

  it('yapışkan ilk sütun ve başlık, kaydırma kapsayıcısı ve tek hareket eğrisi; reduced-motion anlık', () => {
    const css = read('Table.css');
    expect(css).toMatch(/\[data-sticky-first[^\]]*\][^{]*:first-child[^{]*\{[^}]*position: sticky/);
    expect(css).toMatch(/overflow: auto/);
    expect(css).toMatch(/thead[^{]*th[^{]*\{[^}]*position: sticky/);
    expect(css).toMatch(/var\(--aile-sure\) var\(--aile-egri\)/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[^@]*transition-duration: 0s/);
  });

  it('dokunma hedefi: sıralama düğmesi --aile-dokunma-hedefi (44 px, kaba girişte 48 px; b04 tokenı) yükseklik ve genişlikte', () => {
    const css = read('Table.css');
    expect(css).toMatch(/\.aile-table-sirala \{[^}]*min-height: var\(--aile-dokunma-hedefi\)/);
    expect(css).toMatch(/\.aile-table-sirala \{[^}]*min-width: var\(--aile-dokunma-hedefi\)/);
    expect(css).not.toMatch(/--aile-hedef-asgari/);
    expect(targetTokens).toEqual({ dokunmaHedefi: 44, dokunmaHedefiCoarse: 48 });
  });

  it('klavye odak çizgisi yapışkan ilk hücrenin üstünde çizilir (satırın ::after katmanı)', () => {
    const css = read('Table.css');
    expect(css).toMatch(/tr:focus-visible::after \{[^}]*z-index: 1/);
  });
});

// --- Son satırın odak çizgisi ve kabın köşeleri -----------------------------------------------------------------------
// Satırın odak çizgisi (admin.css tr:focus-visible::after) satırın alt kenarındadır (bottom 0). Kaydırma kabı radiuslu ve
// taşmayı kırpar (overflow auto, kose-kart): son satırın çizgisi kabın alt kenarına oturur ve uçları köşe eğrisinde
// kırpılırdı (kavisli vurgu kenarı; e2e accentEdgeViolations "radiuslu ve kırpan ata kenarında şerit"). Kural: yalnız
// çizgi görünürken (klavye modu + :focus-visible) kabın çizginin değdiği iki alt köşesi radiussuz; üst köşeler, işaretçi
// modu ve diğer satırlar değişmez; köşe anında değişir (geçiş yok). Dikey kaydırmada (maxHeight) odaktaki her satır
// kabın alt kenarına oturabilir (odak satırı en yakın kenara kaydırır), bu yüzden orada da alt köşeler radiussuzdur.
// Ölçüm: Table.css kuralları (postcss) render edilen öğeye Element.matches ile uygulanır; at-kuralı içindekiler sayılmaz.
// Odak klavyeyle (Tab, oklar) alınır: jsdom :focus-visible'ı tarayıcı sezgisiyle hesaplar (betik odağı her zaman görünür değil).

interface CssRule { selectors: string[]; atRules: string[]; decls: Map<string, string> }
const CORNERS_OF: Record<string, readonly string[]> = {
  'border-radius': ['top-left', 'top-right', 'bottom-right', 'bottom-left'],
  'border-top-left-radius': ['top-left'],
  'border-top-right-radius': ['top-right'],
  'border-bottom-right-radius': ['bottom-right'],
  'border-bottom-left-radius': ['bottom-left'],
};
function cssRules(file: string): CssRule[] {
  const rules: CssRule[] = [];
  postcss.parse(read(file)).walkRules(rule => {
    const atRules: string[] = [];
    for (let parent = rule.parent; parent && parent.type === 'atrule'; parent = parent.parent) {
      atRules.push(`@${(parent as postcss.AtRule).name} ${(parent as postcss.AtRule).params}`);
    }
    const decls = new Map<string, string>();
    rule.each(node => { if (node.type === 'decl') decls.set(node.prop, node.value.trim()); });
    rules.push({ selectors: rule.selectors, atRules, decls });
  });
  return rules;
}
/** Öğenin kendisine (sözde öğe değil) uyan, at-kuralı dışındaki kurallar. */
// Model: klavye modunda klavyeyle alınan odak görünürdür. jsdom'un :focus-visible sezgisi değerlendirme geçmişine bağlıdır
// (önceki testten kalan durum sonucu değiştirir); bu yüzden eşleşmede :focus-visible → :focus. Kuralın klavye modu ve
// :focus-visible ile koşullandığı ayrıca (cornerRuleSelectors) doğrulanır; gerçek tarayıcı davranışı e2e/admin-ui-f-edges.
function matchingRules(el: Element, rules: readonly CssRule[]): CssRule[] {
  return rules.filter(rule => rule.atRules.length === 0 && rule.selectors.some(selector => {
    if (/::?(before|after)\b/.test(selector)) return false;
    try { return el.matches(selector.replace(/:focus-visible\b/g, ':focus')); } catch { return false; }
  }));
}
/** Kabın (sınıf) köşesini 0'a çeken kuralların seçicileri: yalnız klavye modu + :focus-visible ile koşullu olmalı. */
function cornerRuleSelectors(rules: readonly CssRule[], boxClass: string): string[] {
  return rules
    .filter(rule => [...rule.decls].some(([prop, value]) => CORNERS_OF[prop] && /^0(px)?$/.test(value)))
    .flatMap(rule => rule.selectors)
    .filter(selector => selector.includes(boxClass));
}
function expectKeyboardGated(selectors: readonly string[]) {
  expect(selectors.length).toBeGreaterThan(0);
  for (const selector of selectors) {
    expect(selector).toMatch(/^html\[data-keyboard='true'\] /);
    expect(selector).toMatch(/:focus-visible\b/);
    expect(selector).not.toMatch(/:focus(?!-visible)/);
  }
}
/** Uyan kuralların 0'a çektiği köşeler, sıralı. */
function zeroedCorners(el: Element, rules: readonly CssRule[]): string[] {
  const corners = new Set<string>();
  for (const rule of matchingRules(el, rules)) {
    for (const [prop, value] of rule.decls) if (CORNERS_OF[prop] && /^0(px)?$/.test(value)) CORNERS_OF[prop]!.forEach(c => corners.add(c));
  }
  return [...corners].sort();
}

describe('Table › son satırın odak çizgisi kabın radiuslu köşesinde kırpılmaz', () => {
  const tableCss = cssRules('Table.css');
  const three: RecordRow[] = [...rows, { ...rows[0]!, id: 'r3', code: 'AL-003', label: 'Yatak odası lambası' }];
  const kap = () => document.querySelector('.aile-table-kaydirici')!;
  const bodyRows = () => screen.getAllByRole('row').slice(1) as HTMLTableRowElement[];
  const keyboardMode = (on: boolean) => { document.documentElement.dataset.keyboard = on ? 'true' : 'false'; };
  afterEach(() => { delete document.documentElement.dataset.keyboard; });

  it('kap radiusludur ve taşmayı kırpar: çizginin kırpıldığı durum gerçektir (kural boş çalışmaz)', () => {
    render(<Table columns={columns} rows={three} caption="Alımlar" onRowClick={() => {}} />);
    const decls = matchingRules(kap(), tableCss).flatMap(rule => [...rule.decls]);
    expect(decls).toContainEqual(['border-radius', 'var(--aile-kose-kart)']);
    expect(decls).toContainEqual(['overflow', 'auto']);
  });

  it('klavye modunda son satır odaktayken yalnız kabın iki alt köşesi radiussuz; ilk ve ara satırda köşeler korunur', async () => {
    const user = userEvent.setup();
    render(<Table columns={columns} rows={three} caption="Alımlar" onRowClick={() => {}} />);
    keyboardMode(true);
    expect(zeroedCorners(kap(), tableCss)).toEqual([]);
    await user.tab();
    expect(bodyRows()[0]).toHaveFocus();
    expect(zeroedCorners(kap(), tableCss)).toEqual([]);
    await user.keyboard('{ArrowDown}');
    expect(bodyRows()[1]).toHaveFocus();
    expect(zeroedCorners(kap(), tableCss)).toEqual([]);
    await user.keyboard('{End}');
    expect(bodyRows()[2]).toHaveFocus();
    expect(zeroedCorners(kap(), tableCss)).toEqual(['bottom-left', 'bottom-right']);
    await user.keyboard('{Home}');
    expect(zeroedCorners(kap(), tableCss)).toEqual([]);
  });

  it('işaretçi modunda (data-keyboard=false) son satır odakta kalsa da köşeler korunur; odak tablodan çıkınca da', async () => {
    const user = userEvent.setup();
    render(<><Table columns={columns} rows={three} caption="Alımlar" onRowClick={() => {}} /><button type="button">Sonraki</button></>);
    keyboardMode(true);
    await user.tab();
    await user.keyboard('{End}');
    expect(bodyRows()[2]).toHaveFocus();
    expect(zeroedCorners(kap(), tableCss)).toEqual(['bottom-left', 'bottom-right']);
    keyboardMode(false);
    expect(bodyRows()[2]).toHaveFocus();
    expect(zeroedCorners(kap(), tableCss)).toEqual([]);
    keyboardMode(true);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Sonraki' })).toHaveFocus();
    expect(zeroedCorners(kap(), tableCss)).toEqual([]);
  });

  it('dikey kaydırmada (maxHeight) odaktaki satır kabın alt kenarına oturabilir: klavye odağı satırdayken alt köşeler radiussuz', async () => {
    const user = userEvent.setup();
    render(<Table columns={columns} rows={three} caption="Alımlar" onRowClick={() => {}} maxHeight={120} />);
    keyboardMode(true);
    expect(zeroedCorners(kap(), tableCss)).toEqual([]);
    await user.tab();
    await user.keyboard('{ArrowDown}');
    expect(bodyRows()[1]).toHaveFocus();
    expect(zeroedCorners(kap(), tableCss)).toEqual(['bottom-left', 'bottom-right']);
    keyboardMode(false);
    expect(zeroedCorners(kap(), tableCss)).toEqual([]);
  });

  it('köşe değişimi anlıktır: radiussuz durumda kaba uyan hiçbir kuralda geçiş yok; tıklanamaz satırlar sekme dışıdır', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Table columns={columns} rows={three} caption="Alımlar" onRowClick={() => {}} />);
    keyboardMode(true);
    await user.tab();
    await user.keyboard('{End}');
    expect(zeroedCorners(kap(), tableCss)).toEqual(['bottom-left', 'bottom-right']);
    expect(matchingRules(kap(), tableCss).filter(rule => [...rule.decls.keys()].some(prop => prop.startsWith('transition')))).toEqual([]);
    expectKeyboardGated(cornerRuleSelectors(tableCss, '.aile-table-kaydirici'));
    unmount();
    render(<Table columns={columns} rows={three} caption="Alımlar" />);
    expect(bodyRows().every(row => !row.hasAttribute('tabindex'))).toBe(true);
    expect(zeroedCorners(kap(), tableCss)).toEqual([]);
  });
});
