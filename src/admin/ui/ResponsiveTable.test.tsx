import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactNode } from 'react';
import type { AccordionItem, ResponsiveColumn } from '../shell/contracts';
import { ResponsiveTable } from './ResponsiveTable';

// Tasarım › components/ResponsiveTable/README.md: masaüstünde Table (ilk sütun yapışkan); tablette sığıyorsa Table
// (minWidth toplamı + sütun başına 32 px ≤ alan), sığmıyorsa akordeon; telefonda akordeon (ilk satır açık) ya da
// ≤3 anlamlı sütunda düz liste. Sütun rolleri m: title | meta (" · ") | status | lead | body | hide; only
// desktop|mobile; groupBy telefonda grup başlıkları, geciken grup üstte; narrow zorlar. Table ve AccordionList
// burada sahte: ResponsiveTable'ın onlara verdiği sözleşme (README props'ları) doğrulanır.

interface TableMockProps<R> {
  columns: ResponsiveColumn<R>[];
  rows: R[];
  caption?: string;
  selectedKey?: string;
  onRowClick?: (row: R) => void;
  maxHeight?: number;
}
interface AccordionMockProps {
  items: AccordionItem[];
  caption?: string;
  firstOpen?: boolean;
  defaultOpenKeys?: readonly string[];
  openLabel?: string;
}

vi.mock('./Table', () => ({
  Table: <R,>(props: TableMockProps<R>) => (
    <table aria-label={props.caption} data-max-height={props.maxHeight} data-selected-key={props.selectedKey}>
      <thead>
        <tr>{props.columns.map(column => <th key={column.key} scope="col">{column.title}</th>)}</tr>
      </thead>
      <tbody>
        {props.rows.map((row, index) => (
          <tr key={index} onClick={() => props.onRowClick?.(row)}>
            <td>{String((row as { key?: string; id?: string }).key ?? (row as { id?: string }).id ?? index)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  ),
}));

vi.mock('./AccordionList', () => ({
  AccordionList: (props: AccordionMockProps) => (
    <ul
      aria-label={props.caption}
      data-open-label={props.openLabel}
      data-first-open={props.firstOpen === undefined ? 'default' : String(props.firstOpen)}
      data-default-open={props.defaultOpenKeys?.join(',')}
    >
      {props.items.map(item => (
        <li key={item.key} data-key={item.key} data-group={item.group} data-selected={String(item.selected ?? false)} data-has-body={item.body ? 'true' : 'false'}>
          <span data-part="title">{item.title}</span>
          <span data-part="meta">{item.meta}</span>
          <span data-part="status">{item.status}</span>
          <span data-part="lead">{item.lead}</span>
          <dl>
            {item.body?.map(([label, value], index) => (
              <div key={index}><dt>{label}</dt><dd>{value}</dd></div>
            ))}
          </dl>
          {item.onOpen ? <button type="button" onClick={item.onOpen}>Ayrıntıyı aç</button> : null}
        </li>
      ))}
    </ul>
  ),
}));

// --- Cihaz ve alan mock'ları ---------------------------------------------------------------------
type Listener = (event: { matches: boolean; media: string }) => void;
interface FakeQuery { matches: boolean; media: string; listeners: Set<Listener> }

/** matchMedia: (min-width: Npx) sorgularını viewport genişliğine göre çözer; resize change olayı yayar. */
function installViewport(initialWidth: number) {
  let width = initialWidth;
  const queries: FakeQuery[] = [];
  const evaluate = (media: string) => {
    const match = media.match(/min-width:\s*(\d+)px/);
    return match ? width >= Number(match[1]) : false;
  };
  window.matchMedia = vi.fn().mockImplementation((media: string) => {
    const query: FakeQuery = { matches: evaluate(media), media, listeners: new Set() };
    queries.push(query);
    return {
      get matches() { return query.matches; },
      media,
      onchange: null,
      addEventListener: (_type: string, listener: Listener) => { query.listeners.add(listener); },
      removeEventListener: (_type: string, listener: Listener) => { query.listeners.delete(listener); },
      addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    };
  }) as unknown as typeof window.matchMedia;
  return {
    resize(next: number) {
      width = next;
      for (const query of queries) {
        const matches = evaluate(query.media);
        if (matches === query.matches) continue;
        query.matches = matches;
        for (const listener of query.listeners) listener({ matches, media: query.media });
      }
    },
  };
}

/** Kapsayıcı genişliği: ilk ölçüm getBoundingClientRect, sonrası ResizeObserver callback'i. */
function installContainer(initialWidth: number) {
  let callback: ResizeObserverCallback | undefined;
  class FakeResizeObserver {
    constructor(cb: ResizeObserverCallback) { callback = cb; }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  window.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: initialWidth, height: 0, top: 0, left: 0, right: initialWidth, bottom: 0, x: 0, y: 0, toJSON: () => ({}),
  } as DOMRect);
  return {
    resize(next: number) {
      act(() => {
        callback?.([{ contentRect: { width: next } } as unknown as ResizeObserverEntry], {} as ResizeObserver);
      });
    },
  };
}

const PHONE = 375;
const TABLET = 800;
const DESKTOP = 1280;

// --- Veri -----------------------------------------------------------------------------------------
interface Row { key: string; ad: string; oda: string; kategori: string; durum: string; plan: string; gercek: string; sorumlu: string; kaynak: string; kod: string; g?: string }

const rows: Row[] = [
  { key: 'ALM-0128', ad: 'Karartma perde seti', oda: 'Yatak odası', kategori: 'Tekstil', durum: 'Sipariş verildi', plan: '₺1.150,00', gercek: 'Henüz yok', sorumlu: 'İsmail', kaynak: 'Alımlar!B12', kod: 'K-12' },
  { key: 'ALM-0142', ad: 'Bebek karyolası', oda: 'Bebek odası', kategori: 'Mobilya', durum: 'Teslim edildi', plan: '₺7.940,00', gercek: '₺7.940,00', sorumlu: 'Ayşe', kaynak: 'Alımlar!B19', kod: 'K-19' },
];

const fullColumns: ResponsiveColumn<Row>[] = [
  { key: 'ad', title: 'Ad', minWidth: 200, m: 'title' },
  { key: 'oda', title: 'Oda', minWidth: 140, m: 'meta' },
  { key: 'kategori', title: 'Kategori', minWidth: 140, m: 'meta' },
  { key: 'durum', title: 'Durum', minWidth: 140, m: 'status' },
  { key: 'plan', title: 'Plan', minWidth: 120, align: 'right', m: 'body' },
  { key: 'gercek', title: 'Gerçek', minWidth: 120, align: 'right', m: 'lead' },
  { key: 'sorumlu', title: 'Sorumlu', minWidth: 120 },
  { key: 'kaynak', title: 'Kaynak', minWidth: 120, m: 'hide' },
  { key: 'kod', title: 'Kod', minWidth: 100, only: 'desktop' },
  { key: 'ozet', title: 'Özet', minWidth: 160, only: 'mobile', render: row => `${row.oda} · ${row.durum}` },
];

// Sığma ölçüsü: minWidth toplamı 500 + 3 × 32 = 596.
const fitColumns: ResponsiveColumn<Row>[] = [
  { key: 'ad', title: 'Ad', minWidth: 200, m: 'title' },
  { key: 'plan', title: 'Plan', minWidth: 160, align: 'right' },
  { key: 'gercek', title: 'Gerçek', minWidth: 140, align: 'right', m: 'lead' },
];
const FIT_NEED = 596;

const headerTitles = () => screen.getAllByRole('columnheader').map(cell => cell.textContent);
const items = () => screen.getAllByRole('listitem');
const part = (item: HTMLElement, name: string) => item.querySelector(`[data-part="${name}"]`)?.textContent ?? '';
const bodyOf = (item: HTMLElement) => Array.from(item.querySelectorAll('dl > div')).map(entry => [entry.querySelector('dt')?.textContent, entry.querySelector('dd')?.textContent]);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ResponsiveTable › masaüstü', () => {
  beforeEach(() => {
    installViewport(DESKTOP);
    installContainer(1100);
  });

  it('Table çizer; only: "mobile" sütunları düşer, geri kalanı sırayla geçer', () => {
    render(<ResponsiveTable caption="Alımlar ve eşyalar" columns={fullColumns} rows={rows} />);
    expect(screen.getByRole('table', { name: 'Alımlar ve eşyalar' })).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(headerTitles()).toEqual(['Ad', 'Oda', 'Kategori', 'Durum', 'Plan', 'Gerçek', 'Sorumlu', 'Kaynak', 'Kod']);
  });

  it('sığmasa da tablo kalır (yatay kaydırma ve yapışkan ilk sütun Table\'ın işi); kapsayıcı yerleşimi işaretler', () => {
    installContainer(640);
    const { container } = render(<ResponsiveTable caption="Alımlar" columns={fullColumns} rows={rows} />);
    expect(screen.getByRole('table', { name: 'Alımlar' })).toBeInTheDocument();
    const wrap = container.querySelector('.aile-rtable');
    expect(wrap).not.toBeNull();
    expect(wrap).toHaveAttribute('data-layout', 'table');
  });

  it('caption, rows, selectedKey, onRowClick ve maxHeight Table sözleşmesiyle geçer', async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    render(<ResponsiveTable caption="Alımlar" columns={fullColumns} rows={rows} selectedKey="ALM-0142" onRowClick={onRowClick} maxHeight={560} />);
    const table = screen.getByRole('table', { name: 'Alımlar' });
    expect(table).toHaveAttribute('data-selected-key', 'ALM-0142');
    expect(table).toHaveAttribute('data-max-height', '560');
    const bodyRows = within(table).getAllByRole('row').slice(1);
    expect(bodyRows).toHaveLength(2);
    await user.click(bodyRows[1]!);
    expect(onRowClick).toHaveBeenCalledWith(rows[1]);
  });

  it('narrow zorlanınca masaüstünde de akordeon çizer', () => {
    render(<ResponsiveTable caption="Alımlar" mobileCaption="2 kayıt" columns={fullColumns} rows={rows} narrow />);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('list', { name: '2 kayıt' })).toBeInTheDocument();
  });
});

describe('ResponsiveTable › tablet (sığma hesabı)', () => {
  beforeEach(() => {
    installViewport(TABLET);
  });

  it('alan ≥ minWidth toplamı + 32/sütun ise Table', () => {
    installContainer(FIT_NEED);
    render(<ResponsiveTable caption="Bütçe kalemleri" columns={fitColumns} rows={rows} />);
    expect(screen.getByRole('table', { name: 'Bütçe kalemleri' })).toBeInTheDocument();
    expect(headerTitles()).toEqual(['Ad', 'Plan', 'Gerçek']);
  });

  it('alan 1 px dar kalırsa akordeon; mobileCaption yoksa caption kullanılır', () => {
    installContainer(FIT_NEED - 1);
    render(<ResponsiveTable caption="Bütçe kalemleri" columns={fitColumns} rows={rows} />);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Bütçe kalemleri' })).toBeInTheDocument();
  });

  it('ölçüm henüz yokken (0) tablo çizer', () => {
    installContainer(0);
    render(<ResponsiveTable caption="Bütçe kalemleri" columns={fitColumns} rows={rows} />);
    expect(screen.getByRole('table', { name: 'Bütçe kalemleri' })).toBeInTheDocument();
  });

  it('ResizeObserver daraltınca akordeona, genişletince tabloya döner', () => {
    const containerSize = installContainer(900);
    render(<ResponsiveTable caption="Bütçe kalemleri" columns={fitColumns} rows={rows} />);
    expect(screen.getByRole('table', { name: 'Bütçe kalemleri' })).toBeInTheDocument();
    containerSize.resize(520);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Bütçe kalemleri' })).toBeInTheDocument();
    containerSize.resize(700);
    expect(screen.getByRole('table', { name: 'Bütçe kalemleri' })).toBeInTheDocument();
  });

  it('sığma hesabına only: "mobile" sütunları girmez', () => {
    // fitColumns + 400 px'lik mobil sütun: masaüstü/tablet toplamı değişmez (596).
    const columns: ResponsiveColumn<Row>[] = [...fitColumns, { key: 'ozet', title: 'Özet', minWidth: 400, only: 'mobile' }];
    installContainer(FIT_NEED);
    render(<ResponsiveTable caption="Bütçe kalemleri" columns={columns} rows={rows} />);
    expect(screen.getByRole('table', { name: 'Bütçe kalemleri' })).toBeInTheDocument();
  });

  it('viewport telefona inince tablo yerine akordeon gelir', () => {
    const viewport = installViewport(TABLET);
    installContainer(900);
    render(<ResponsiveTable caption="Bütçe kalemleri" columns={fitColumns} rows={rows} />);
    expect(screen.getByRole('table')).toBeInTheDocument();
    act(() => viewport.resize(PHONE));
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('list')).toBeInTheDocument();
  });
});

describe('ResponsiveTable › telefon', () => {
  beforeEach(() => {
    installViewport(PHONE);
    installContainer(343);
  });

  it('akordeon: only: "desktop" düşer; title, meta (" · "), status, lead ve body rollerine dağıtır; hide gizlenir', () => {
    const { container } = render(
      <ResponsiveTable caption="Alımlar ve eşyalar" mobileCaption="2 kayıt" columns={fullColumns} rows={rows} selectedKey="ALM-0142" defaultOpenKeys={['ALM-0142']} openLabel="Alımı aç" />,
    );
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(container.querySelector('.aile-rtable')).toHaveAttribute('data-layout', 'accordion');
    const list = screen.getByRole('list', { name: '2 kayıt' });
    expect(list).toHaveAttribute('data-open-label', 'Alımı aç');
    expect(list).toHaveAttribute('data-default-open', 'ALM-0142');
    expect(list).not.toHaveAttribute('data-first-open', 'false');

    const [first, second] = items();
    expect(first).toHaveAttribute('data-key', 'ALM-0128');
    expect(part(first!, 'title')).toBe('Karartma perde seti');
    expect(part(first!, 'meta')).toBe('Yatak odası · Tekstil');
    expect(part(first!, 'status')).toBe('Sipariş verildi');
    expect(part(first!, 'lead')).toBe('Henüz yok');
    expect(bodyOf(first!)).toEqual([
      ['Plan', '₺1.150,00'],
      ['Sorumlu', 'İsmail'],
      ['Özet', 'Yatak odası · Sipariş verildi'],
    ]);
    expect(first!.textContent).not.toContain('Alımlar!B12');
    expect(first!.textContent).not.toContain('K-12');
    expect(first).toHaveAttribute('data-selected', 'false');
    expect(second).toHaveAttribute('data-selected', 'true');
  });

  it('onRowClick satırın onOpen eylemi olur ve satırı alır', async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    render(<ResponsiveTable caption="Alımlar" columns={fullColumns} rows={rows} onRowClick={onRowClick} />);
    const [, second] = items();
    await user.click(within(second!).getByRole('button', { name: 'Ayrıntıyı aç' }));
    expect(onRowClick).toHaveBeenCalledWith(rows[1]);
  });

  it('onRowClick yoksa satırda açma eylemi yoktur', () => {
    render(<ResponsiveTable caption="Alımlar" columns={fullColumns} rows={rows} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('title rolü verilmemişse gizli olmayan ilk sütun başlık olur', () => {
    const columns: ResponsiveColumn<Row>[] = [
      { key: 'kaynak', title: 'Kaynak', minWidth: 120, m: 'hide' },
      { key: 'ad', title: 'Ad', minWidth: 200 },
      { key: 'plan', title: 'Plan', minWidth: 120 },
      { key: 'gercek', title: 'Gerçek', minWidth: 120 },
      { key: 'sorumlu', title: 'Sorumlu', minWidth: 120 },
    ];
    render(<ResponsiveTable caption="Alımlar" columns={columns} rows={rows} />);
    const [first] = items();
    expect(part(first!, 'title')).toBe('Karartma perde seti');
    expect(bodyOf(first!)).toEqual([['Plan', '₺1.150,00'], ['Gerçek', 'Henüz yok'], ['Sorumlu', 'İsmail']]);
  });

  it('≤3 anlamlı sütunda kendiliğinden düz liste: body yok, satır doğrudan ayrıntıya gider', async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    const columns: ResponsiveColumn<Row>[] = [
      { key: 'ad', title: 'Ad', minWidth: 200, m: 'title' },
      { key: 'plan', title: 'Plan', minWidth: 120 },
      { key: 'gercek', title: 'Gerçek', minWidth: 120 },
      { key: 'kaynak', title: 'Kaynak', minWidth: 120, m: 'hide' },
    ];
    const { container } = render(<ResponsiveTable caption="Hesaplar" mobileCaption="2 hesap" columns={columns} rows={rows} onRowClick={onRowClick} />);
    expect(container.querySelector('.aile-rtable')).toHaveAttribute('data-layout', 'list');
    for (const item of items()) expect(item).toHaveAttribute('data-has-body', 'false');
    await user.click(within(items()[0]!).getByRole('button', { name: 'Ayrıntıyı aç' }));
    expect(onRowClick).toHaveBeenCalledWith(rows[0]);
  });

  it('mobileMode: "accordion" 3 sütunda da açılır gövde verir; mobileMode: "list" çok sütunda gövdeyi kaldırır', () => {
    const three: ResponsiveColumn<Row>[] = [
      { key: 'ad', title: 'Ad', minWidth: 200, m: 'title' },
      { key: 'plan', title: 'Plan', minWidth: 120 },
      { key: 'gercek', title: 'Gerçek', minWidth: 120 },
    ];
    const { unmount } = render(<ResponsiveTable caption="Hesaplar" columns={three} rows={rows} mobileMode="accordion" />);
    expect(bodyOf(items()[0]!)).toEqual([['Plan', '₺1.150,00'], ['Gerçek', 'Henüz yok']]);
    unmount();

    render(<ResponsiveTable caption="Alımlar" columns={fullColumns} rows={rows} mobileMode="list" />);
    for (const item of items()) expect(item).toHaveAttribute('data-has-body', 'false');
  });

  it('groupBy grup adını verir; geciken grup veri sırası ne olursa olsun üstte, diğerleri ilk görüldüğü sırada', () => {
    const grouped: Row[] = [
      { ...rows[0]!, key: 'ODM-0323', ad: 'Kira', g: 'Bu hafta' },
      { ...rows[0]!, key: 'ODM-0325', ad: 'İhtiyaç kredisi', g: 'Sonra' },
      { ...rows[0]!, key: 'ODM-0322', ad: 'Karartma perde seti', g: 'Gecikenler' },
      { ...rows[0]!, key: 'ODM-0319', ad: 'Veteriner kontrolü', g: 'Ödenenler' },
      { ...rows[0]!, key: 'ODM-0324', ad: 'Elektrik faturası', g: 'Bu hafta' },
      { ...rows[0]!, key: 'ODM-0311', ad: 'Bebek karyolası', g: 'Gecikenler' },
    ];
    render(<ResponsiveTable caption="Ödemeler" columns={fullColumns} rows={grouped} groupBy={row => row.g ?? 'Bilinmiyor'} />);
    const order = items().map(item => [item.getAttribute('data-key'), item.getAttribute('data-group')]);
    expect(order).toEqual([
      ['ODM-0322', 'Gecikenler'],
      ['ODM-0311', 'Gecikenler'],
      ['ODM-0323', 'Bu hafta'],
      ['ODM-0324', 'Bu hafta'],
      ['ODM-0325', 'Sonra'],
      ['ODM-0319', 'Ödenenler'],
    ]);
  });

  it('groupBy yokken satırlar veri sırasında ve grupsuzdur', () => {
    render(<ResponsiveTable caption="Alımlar" columns={fullColumns} rows={rows} />);
    expect(items().map(item => item.getAttribute('data-key'))).toEqual(['ALM-0128', 'ALM-0142']);
    for (const item of items()) expect(item).not.toHaveAttribute('data-group');
  });

  it('satır anahtarı key → id → sıra; selectedKey id ile de eşleşir', () => {
    interface IdRow { id: string; label: string; room: string; owner: string; planned: string }
    const idRows: IdRow[] = [
      { id: 'a1', label: 'Masa', room: 'Salon', owner: 'İsmail', planned: '₺2.000,00' },
      { id: 'b2', label: 'Sandalye', room: 'Salon', owner: 'Ayşe', planned: 'Fiyat yok' },
    ];
    const columns: ResponsiveColumn<IdRow>[] = [
      { key: 'label', title: 'Ad', minWidth: 200, m: 'title' },
      { key: 'room', title: 'Oda', minWidth: 120, m: 'meta' },
      { key: 'owner', title: 'Sorumlu', minWidth: 120 },
      { key: 'planned', title: 'Plan', minWidth: 120 },
    ];
    render(<ResponsiveTable caption="Eşyalar" columns={columns} rows={idRows} selectedKey="b2" />);
    const [first, second] = items();
    expect(first).toHaveAttribute('data-key', 'a1');
    expect(second).toHaveAttribute('data-key', 'b2');
    expect(second).toHaveAttribute('data-selected', 'true');
    expect(part(second!, 'lead')).toBe('');
    expect(bodyOf(second!)).toEqual([['Sorumlu', 'Ayşe'], ['Plan', 'Fiyat yok']]);
  });

  it('narrow={false} telefonda bile tabloyu zorlar', () => {
    render(<ResponsiveTable caption="Alımlar" columns={fullColumns} rows={rows} narrow={false} />);
    expect(screen.getByRole('table', { name: 'Alımlar' })).toBeInTheDocument();
  });
});

describe('ResponsiveTable › kaynak kuralları', () => {
  const read = (file: string) => readFileSync(resolve(__dirname, file), 'utf8');

  it('Table ve AccordionList göreli import; ham antd/pro/phosphor yok; cihaz ve alan ../device üzerinden', () => {
    const tsx = read('ResponsiveTable.tsx');
    expect(tsx).toMatch(/from ['"]\.\/Table['"]/);
    expect(tsx).toMatch(/from ['"]\.\/AccordionList['"]/);
    expect(tsx).toMatch(/from ['"]\.\.\/device['"]/);
    expect(tsx).toMatch(/useDevice\(\)/);
    expect(tsx).toMatch(/useContainerWidth\(/);
    expect(tsx).not.toMatch(/from\s+['"](antd|@ant-design\/|@phosphor-icons\/|echarts|@mantine\/)/);
    expect(tsx).toContain("import './ResponsiveTable.css'");
    // Sütun dolgusu tokendan; bileşen içinde sabit 32 yok.
    expect(tsx).not.toMatch(/\b32\b/);
  });

  it('CSS yalnız yerleşim: hex, outline, box-shadow, sabit px yok (renk ve ölçü Table/AccordionList\'te)', () => {
    const css = read('ResponsiveTable.css');
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/outline|box-shadow/);
    expect(css.match(/\b\d+px\b/g) ?? []).toEqual([]);
  });
});

// Tip denetimi: ReactNode dönen render ve genel satır tipi sözleşmeyi bozmaz.
export const typeProbe: ResponsiveColumn<{ x: ReactNode }> = { key: 'x', title: 'X', minWidth: 120, render: row => row.x };
