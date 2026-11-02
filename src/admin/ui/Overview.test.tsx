import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { useState } from 'react';
import { MIRRORS_PLAN_NOTE, MIXED_CURRENCY_TEXT, type RecordedTotal, type RecordedValue } from '../data/actuals';
import type { Money } from '../shell/contracts';
import { Overview, paraMetni, type OverviewBudgetRow, type OverviewProps, type OverviewTask } from './Overview';

// Tasarım: components/Overview/README.md — başlık altında üç ölçü (kutusuz, tek satır); sol sütun Yaklaşan ödemeler
// (tarih, ad, taraf, tutar, durum sözcüğü) + Bütçe tablosu (Planlanan, Gerçekleşen, Kalan ayrı; ince çubuk + yüzde
// METNİ); sağ sütun Dikkat isteyenler (sayı + bağlantı) + Bu haftaki görevler (onay kutusu); her blok başlığının
// yanında ilgili sayfaya bağlantı. Veri props ile gelir; Overview yalnız çizer ve biçimler. Seçiciler role/label.
// Gerçekleşen anlamı tek kaynaktan (src/admin/data/actuals.ts, W0): oran ve "%N harcandı" yalnız ödeme kanıtıyla
// (spendLabel); kanıtsız kaynak değeri "Kaynakta yazılı", gelecek dönem "Henüz yok". Telefon sunumu antd'siz.

const money = (amount: string, currency = 'TRY'): Money => ({ amount, currency });
const recorded = (amount: string, evidence: boolean): RecordedValue => ({ kind: 'recorded', money: money(amount), evidence });
const total = (value: Money | null, counted: number, currencies: readonly string[], missing = 0, evidence = false): RecordedTotal => ({
  kind: 'recorded',
  money: value,
  evidence,
  total: { money: value, counted, missing, currencies },
});

function props(overrides: Partial<OverviewProps> = {}): OverviewProps {
  return {
    narrow: false,
    measures: [
      { label: 'Bu ay kalan nakit', value: money('23480.00'), note: "30.11'e kadar" },
      { label: '7 gün içinde ödenecek', value: money('22386.67'), note: '3 ödeme' },
      { label: 'Geciken', value: money('1150.00'), note: '1 ödeme' },
    ],
    payments: {
      title: 'Yaklaşan ödemeler · 7 gün',
      link: { label: 'Ödemelere git', href: '#/odemeler' },
      items: [
        { id: 'p1', date: '2026-11-03', label: 'Kira', party: 'Ev sahibi', amount: money('18500.00'), status: { label: 'Planlandı', tone: 'notr' }, href: '#/odemeler/p1' },
        { id: 'p2', date: '2026-11-06', label: 'Elektrik faturası', party: 'Dağıtım şirketi', amount: money('1240.00'), status: { label: 'Tutar tahmini', tone: 'uyari' } },
        { id: 'p3', date: '2026-10-28', dateNote: 'Gecikti · 4 gün', label: 'Karartma perde seti', party: 'Perde Atölyesi', amount: money('1150.00'), status: { label: 'Gecikti', tone: 'hata' } },
        { id: 'p4', date: null, label: 'Su faturası', amount: null, status: { label: 'Bekliyor', tone: 'notr' } },
      ],
    },
    budget: {
      title: 'Bütçe · Kasım 2026',
      link: { label: 'Bütçe ve nakit', href: '#/butce' },
      items: [
        // Ödeme kanıtlı: oran ve çubuk.
        { id: 'b1', label: 'Bebek odası', planned: money('42000.00'), recorded: recorded('27380.00', true) },
        // Kanıtsız kaynak değeri: "Kaynakta yazılı", oran yok.
        { id: 'b2', label: 'Mutfak', planned: money('31000.00'), recorded: recorded('4120.00', false) },
        // Gelecek dönem: "Henüz yok".
        { id: 'b3', label: 'Birikim', planned: money('5000.00'), recorded: { kind: 'not_yet' } },
        // Kanıtlı aşım: oran 100'ü geçer, kalan eksi.
        { id: 'b4', label: 'Ulaşım', planned: money('3500.00'), recorded: recorded('3920.00', true) },
      ],
    },
    attention: {
      title: 'Dikkat isteyenler',
      link: { label: 'Veri kalitesi', href: '#/veri' },
      items: [
        { id: 'a1', label: 'Fiyatı eksik alım', count: 5, page: 'Alımlar ve eşyalar', href: '#/alimlar?fiyat=yok' },
        { id: 'a2', label: 'Yanıt bekleyen teklif', count: 3, page: 'Taraflar ve teklifler', href: '#/taraflar' },
      ],
    },
    tasks: {
      title: 'Bu haftaki görevler',
      link: { label: 'Projeler ve görevler', href: '#/projeler' },
      items: [
        { id: 't1', code: 'GRV-0213', label: 'Montaj için gün seç', owner: 'Mert', due: '2026-11-07', project: 'Bebek odasını hazırlama' },
        { id: 't2', code: 'GRV-0199', label: 'Kredi kartı ekstresini içe aktar', owner: 'Elif', due: '2026-11-10', done: true },
      ],
    },
    ...overrides,
  };
}

const region = (name: string) => screen.getByRole('region', { name });
const budgetWith = (items: readonly OverviewBudgetRow[], extra: Partial<OverviewProps['budget']> = {}): Partial<OverviewProps> => ({
  budget: { ...props().budget, items, ...extra },
});
/** Masaüstü tablosunda kalemin satırı ve hücre metinleri (Kalem, Planlanan, Gerçekleşen, Kalan). */
function budgetRow(label: string) {
  const table = within(region('Bütçe · Kasım 2026')).getByRole('table', { name: 'Bütçe kalemleri' });
  const row = within(table).getByText(label).closest('tr') as HTMLTableRowElement;
  return { row, cells: within(row).getAllByRole('cell').map(td => td.textContent ?? '') };
}

describe('Overview › özet ve bloklar', () => {
  it('renders at most three measures as one unboxed summary with money, note and named missing values', () => {
    const p = props();
    render(<Overview {...p} measures={[...p.measures, { label: 'Dördüncü ölçü', value: money('1.00') }]} />);
    const ozet = screen.getByLabelText('Özet');
    expect(ozet.tagName).toBe('DL');
    expect(within(ozet).getByText('Bu ay kalan nakit')).toBeInTheDocument();
    expect(within(ozet).getByText('₺23.480,00')).toBeInTheDocument();
    expect(within(ozet).getByText("30.11'e kadar")).toBeInTheDocument();
    expect(within(ozet).getByText('₺22.386,67')).toBeInTheDocument();
    expect(within(ozet).getByText('₺1.150,00')).toBeInTheDocument();
    expect(within(ozet).queryByText('Dördüncü ölçü')).not.toBeInTheDocument();
  });

  it('writes a missing measure value by name instead of a dash', () => {
    render(<Overview {...props({ measures: [{ label: 'Bu ay kalan nakit', value: null }] })} />);
    const ozet = screen.getByLabelText('Özet');
    expect(within(ozet).getByText('Bilinmiyor')).toBeInTheDocument();
    expect(within(ozet).queryByText(/^[—-]$/)).not.toBeInTheDocument();
  });

  it('names the four blocks as regions whose heading row links to the related page', () => {
    render(<Overview {...props()} />);
    const expected: [string, string, string][] = [
      ['Yaklaşan ödemeler · 7 gün', 'Ödemelere git', '#/odemeler'],
      ['Bütçe · Kasım 2026', 'Bütçe ve nakit', '#/butce'],
      ['Dikkat isteyenler', 'Veri kalitesi', '#/veri'],
      ['Bu haftaki görevler', 'Projeler ve görevler', '#/projeler'],
    ];
    for (const [title, label, href] of expected) {
      const block = region(title);
      expect(within(block).getByRole('heading', { level: 2, name: title })).toBeInTheDocument();
      expect(within(block).getByRole('link', { name: label })).toHaveAttribute('href', href);
    }
    expect(screen.getAllByRole('region')).toHaveLength(4);
  });

  it('lists upcoming payments with date, weekday, name, party, amount and status word', () => {
    render(<Overview {...props()} />);
    const block = region('Yaklaşan ödemeler · 7 gün');
    const kira = within(block).getByRole('link', { name: /Kira/ });
    expect(kira).toHaveAttribute('href', '#/odemeler/p1');
    expect(within(kira).getByText('03.11.2026')).toBeInTheDocument();
    expect(within(kira).getByText('Salı')).toBeInTheDocument();
    expect(within(kira).getByText('Ev sahibi')).toBeInTheDocument();
    expect(within(kira).getByText('₺18.500,00')).toBeInTheDocument();
    expect(within(kira).getByText('Planlandı')).toBeInTheDocument();
    // Bağlantısız ödeme düz satırdır; durum sözcüğü yine yazılır.
    expect(within(block).queryByRole('link', { name: /Elektrik faturası/ })).not.toBeInTheDocument();
    expect(within(block).getByText('Tutar tahmini')).toBeInTheDocument();
    // Sayfanın verdiği not gün adının yerini alır.
    expect(within(block).getByText('Gecikti · 4 gün')).toBeInTheDocument();
    expect(within(block).queryByText('Çarşamba')).not.toBeInTheDocument();
    expect(within(block).getByText('Gecikti')).toBeInTheDocument();
  });

  it('names missing payment date, amount and party instead of hiding them', () => {
    render(<Overview {...props()} />);
    const block = region('Yaklaşan ödemeler · 7 gün');
    expect(within(block).getByText('Tarih yok')).toBeInTheDocument();
    expect(within(block).getByText('Tutar yok')).toBeInTheDocument();
    expect(within(block).getByText('Taraf bilinmiyor')).toBeInTheDocument();
  });

  it('shows attention counts as links into the related page', () => {
    render(<Overview {...props()} />);
    const block = region('Dikkat isteyenler');
    const link = within(block).getByRole('link', { name: /Fiyatı eksik alım/ });
    expect(link).toHaveAttribute('href', '#/alimlar?fiyat=yok');
    expect(within(link).getByText('5')).toBeInTheDocument();
    expect(within(link).getByText('Alımlar ve eşyalar')).toBeInTheDocument();
    expect(within(block).getByRole('link', { name: /Yanıt bekleyen teklif/ })).toHaveAttribute('href', '#/taraflar');
    // Liste satırı: odak çizgisi satırın alt kenarında (README › Odak).
    expect(link).toHaveAttribute('data-focus-line', 'row');
  });

  it('names empty blocks instead of hiding them and lets the page override the wording', () => {
    const p = props();
    render(
      <Overview
        {...p}
        payments={{ ...p.payments, items: [] }}
        budget={{ ...p.budget, items: [] }}
        attention={{ ...p.attention, items: [] }}
        tasks={{ ...p.tasks, items: [], empty: 'Bu hafta görev kalmadı' }}
      />,
    );
    expect(within(region('Yaklaşan ödemeler · 7 gün')).getByText('Yaklaşan ödeme yok')).toBeInTheDocument();
    expect(within(region('Bütçe · Kasım 2026')).getByText('Bütçe kalemi yok')).toBeInTheDocument();
    expect(within(region('Dikkat isteyenler')).getByText('Dikkat isteyen kayıt yok')).toBeInTheDocument();
    expect(within(region('Bu haftaki görevler')).getByText('Bu hafta görev kalmadı')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getAllByRole('region')).toHaveLength(4);
  });

  it('switches to the single-column layout when narrow, and by device when narrow is not given', () => {
    const { rerender } = render(<Overview {...props({ narrow: true })} />);
    expect(screen.getByTestId('overview')).toHaveAttribute('data-layout', 'dar');
    rerender(<Overview {...props({ narrow: false })} />);
    expect(screen.getByTestId('overview')).toHaveAttribute('data-layout', 'genis');
    // jsdom matchMedia hiçbir sorguyu eşlemez → useDevice 'phone' → dar.
    rerender(<Overview {...props({ narrow: undefined })} />);
    expect(screen.getByTestId('overview')).toHaveAttribute('data-layout', 'dar');
  });

  it('keeps the deprecated paraMetni export as the shared Money formatter', () => {
    expect(paraMetni(money('8500.00'))).toBe('₺8.500,00');
    expect(paraMetni(money('-1234.5'))).toBe('-₺1.234,50');
    expect(paraMetni(money('abc'))).toBe('Bilinmiyor');
  });
});

describe('Overview › bütçe: Gerçekleşen anlamı actuals.ts ile', () => {
  it('keeps Planlanan, Gerçekleşen and Kalan as separate columns; "%N harcandı" and the bar only with payment evidence', () => {
    render(<Overview {...props()} />);
    const block = region('Bütçe · Kasım 2026');
    // antd yapışkan başlıkta başlık ve gövde ayrı <table> öğeleri olabilir; sütun başlıkları blok içinde aranır.
    expect(within(block).getAllByRole('columnheader').map(th => th.textContent)).toEqual(['Kalem', 'Planlanan', 'Gerçekleşen', 'Kalan']);

    const bebek = budgetRow('Bebek odası');
    expect(bebek.cells.slice(1)).toEqual(['₺42.000,00', '₺27.380,00', '₺14.620,00']);
    expect(within(bebek.row).getByText('%65 harcandı')).toBeInTheDocument();
    const cubuk = bebek.row.querySelector('.aile-ov-olcek') as HTMLElement;
    expect(cubuk).not.toBeNull();
    expect(cubuk).toHaveAttribute('aria-hidden', 'true');
    expect((cubuk.querySelector('.aile-ov-olcek-dolgu') as HTMLElement).style.width).toBe('65%');

    // Kanıtlı aşım: metin 100'ü geçer, çubuk taşmaz; kalan eksi ve metinle (eksi işareti) okunur.
    const ulasim = budgetRow('Ulaşım');
    expect(within(ulasim.row).getByText('%112 harcandı')).toBeInTheDocument();
    expect(ulasim.cells[3]).toBe('-₺420,00');
    expect(within(ulasim.row).getByText('-₺420,00')).toHaveAttribute('data-tone', 'hata');
    const asim = ulasim.row.querySelector('.aile-ov-olcek') as HTMLElement;
    expect((asim.querySelector('.aile-ov-olcek-dolgu') as HTMLElement).style.width).toBe('100%');
    expect(asim).toHaveAttribute('data-asim', 'true');
    // Pozitif kalan tonsuzdur.
    expect(within(bebek.row).getByText('₺14.620,00')).not.toHaveAttribute('data-tone');

    // Kanıtsız kaynak değeri: değer yazılır, oran/çubuk yok, etiket "Kaynakta yazılı".
    const mutfak = budgetRow('Mutfak');
    expect(mutfak.cells.slice(1)).toEqual(['₺31.000,00', '₺4.120,00', '₺26.880,00']);
    expect(within(mutfak.row).getByText('Kaynakta yazılı')).toBeInTheDocument();
    expect(within(mutfak.row).queryByText(/harcandı|%\d/)).not.toBeInTheDocument();
    expect(mutfak.row.querySelector('.aile-ov-olcek')).toBeNull();

    // Gelecek dönem: Gerçekleşen ve Kalan "Henüz yok"; oran ve "Kaynakta yazılı" yok.
    const birikim = budgetRow('Birikim');
    expect(birikim.cells.slice(1)).toEqual(['₺5.000,00', 'Henüz yok', 'Henüz yok']);
    expect(within(birikim.row).queryByText(/harcandı|Kaynakta yazılı/)).not.toBeInTheDocument();
    expect(birikim.row.querySelector('.aile-ov-olcek')).toBeNull();

    // Satırın erişilebilir adı kalem adıyla etiketi ayırır (sayfalar satırı "Kalem adı" ile bulur).
    expect(within(block).getByRole('row', { name: /^Mutfak Kaynakta yazılı/ })).toBe(mutfak.row);
    expect(within(block).getByRole('row', { name: /^Bebek odası %65 harcandı/ })).toBe(bebek.row);

    // Plan ve gerçek tek sayıda birleşmez; ekran okuyucuya ikinci bir ilerleme çubuğu okunmaz.
    expect(within(block).queryByText(/₺[\d.,]+\s*\/\s*₺/)).not.toBeInTheDocument();
    expect(screen.queryAllByRole('progressbar')).toHaveLength(0);
  });

  it('never turns a source value without payment evidence into "%… harcandı": the deprecated actual prop is a source value', () => {
    // Hata (W0 öncesi): Gerçekleşen sekmesi plan değerlerini taşırken düz `actual` "%100 harcandı" yazıyordu.
    render(
      <Overview
        {...props(budgetWith([
          { id: 'm1', label: 'Kira', planned: money('8500.00'), actual: money('8500.00') },
          { id: 'm2', label: 'Market', planned: money('6000.00'), actual: money('4500.00') },
          { id: 'm3', label: 'Aidat', planned: money('1200.00'), actual: null },
        ], { note: MIRRORS_PLAN_NOTE }))}
      />,
    );
    const block = region('Bütçe · Kasım 2026');
    expect(within(block).queryByText(/harcandı/)).not.toBeInTheDocument();
    expect(within(block).queryByText(/%\s?\d/)).not.toBeInTheDocument();
    expect(block.querySelector('.aile-ov-olcek')).toBeNull();

    const kira = budgetRow('Kira');
    expect(kira.cells.slice(1)).toEqual(['₺8.500,00', '₺8.500,00', '₺0,00']);
    expect(within(kira.row).getByText('Kaynakta yazılı')).toBeInTheDocument();
    expect(within(budgetRow('Market').row).getByText('Kaynakta yazılı')).toBeInTheDocument();
    const aidat = budgetRow('Aidat');
    expect(aidat.cells.slice(1)).toEqual(['₺1.200,00', 'Henüz yok', 'Henüz yok']);
    expect(within(aidat.row).queryByText('Kaynakta yazılı')).not.toBeInTheDocument();
    // Plan aynası notu sayfa verirse blokta yazılır.
    expect(within(block).getByText(MIRRORS_PLAN_NOTE)).toBeInTheDocument();
  });

  it('prefers recorded over the deprecated actual when both are given', () => {
    render(<Overview {...props(budgetWith([{ id: 'x', label: 'Mobilya', planned: money('1000.00'), actual: money('1000.00'), recorded: { kind: 'not_yet' } }]))} />);
    expect(budgetRow('Mobilya').cells.slice(1)).toEqual(['₺1.000,00', 'Henüz yok', 'Henüz yok']);
  });

  it('names unreadable, mixed-currency and empty recorded totals; never sums different currencies', () => {
    render(
      <Overview
        {...props(budgetWith([
          { id: 't1', label: 'Seyahat', planned: money('10000.00'), recorded: total(null, 2, ['EUR', 'TRY']) },
          { id: 't2', label: 'Eğitim', planned: money('2000.00'), recorded: total(null, 0, []) },
          { id: 't3', label: 'Sağlık', planned: money('3000.00'), recorded: { kind: 'recorded', money: null, evidence: false } },
          { id: 't4', label: 'Hediye', planned: null, recorded: recorded('750.00', true) },
          { id: 't5', label: 'Döviz', planned: money('100.00'), recorded: { kind: 'recorded', money: money('90.00', 'EUR'), evidence: true } },
          { id: 't6', label: 'Kırtasiye', planned: money('400.00'), recorded: total(money('100.00'), 2, ['TRY'], 0, true) },
        ]))}
      />,
    );
    const seyahat = budgetRow('Seyahat');
    expect(seyahat.cells.slice(1)).toEqual(['₺10.000,00', MIXED_CURRENCY_TEXT, 'Bilinmiyor']);
    expect(within(seyahat.row).getByText('Kaynakta yazılı')).toBeInTheDocument();

    // Dönemde hiç Gerçekleşen kaydı yok: "Kaynakta yazılı" değil, "Henüz yok".
    const egitim = budgetRow('Eğitim');
    expect(egitim.cells.slice(1)).toEqual(['₺2.000,00', 'Henüz yok', 'Henüz yok']);
    expect(within(egitim.row).queryByText('Kaynakta yazılı')).not.toBeInTheDocument();

    expect(budgetRow('Sağlık').cells.slice(1)).toEqual(['₺3.000,00', 'Bilinmiyor', 'Bilinmiyor']);

    // Kanıt var ama oran yok (plan yok): "Harcandı", çubuk yok.
    const hediye = budgetRow('Hediye');
    expect(hediye.cells.slice(1)).toEqual(['Plan yok', '₺750,00', 'Plan yok']);
    expect(within(hediye.row).getByText('Harcandı')).toBeInTheDocument();
    expect(hediye.row.querySelector('.aile-ov-olcek')).toBeNull();

    // Farklı para birimi: değer kendi biriminde yazılır, kalan hesaplanmaz, oran üretilmez.
    const doviz = budgetRow('Döviz');
    expect(doviz.cells.slice(1)).toEqual(['₺100,00', '€90,00', 'Bilinmiyor']);
    expect(within(doviz.row).getByText('Harcandı')).toBeInTheDocument();

    // Kanıtlı toplam (RecordedTotal) oranı da spendLabel'dan.
    expect(within(budgetRow('Kırtasiye').row).getByText('%25 harcandı')).toBeInTheDocument();
  });

  it('computes Kalan with exact decimals instead of floating point', () => {
    render(<Overview {...props(budgetWith([{ id: 'k', label: 'Büyük kalem', planned: money('12345678901234567.89'), recorded: recorded('0.01', true) }]))} />);
    expect(budgetRow('Büyük kalem').cells[3]).toBe('₺12.345.678.901.234.567,88');
  });

  it('folds the budget table into an accordion on the phone and keeps the three labelled amounts apart', () => {
    render(<Overview {...props({ narrow: true })} />);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    const first = screen.getByRole('button', { name: /Bebek odası/, expanded: true });
    const panel = document.getElementById(first.getAttribute('aria-controls') ?? '') as HTMLElement;
    expect(panel).not.toBeNull();
    for (const label of ['Planlanan', 'Gerçekleşen', 'Kalan']) expect(within(panel).getByText(label)).toBeInTheDocument();
    expect(within(panel).getByText('₺42.000,00')).toBeInTheDocument();
    expect(within(panel).getByText('₺27.380,00')).toBeInTheDocument();
    expect(within(panel).getByText('₺14.620,00')).toBeInTheDocument();
    expect(within(first).getByText('%65 harcandı')).toBeInTheDocument();
    // Kapalı satırın başlığı da kanıtsız değeri adıyla söyler.
    expect(within(screen.getByRole('button', { name: /^Mutfak Kaynakta yazılı/ })).getByText('Kaynakta yazılı')).toBeInTheDocument();
  });
});

describe('Overview › görevler: yerel onay kutusu (antd yok)', () => {
  const taskBox = (name: RegExp) => within(region('Bu haftaki görevler')).getByRole('checkbox', { name });

  function Harness({ initial = props() }: { initial?: OverviewProps }) {
    const [items, setItems] = useState<readonly OverviewTask[]>(initial.tasks.items);
    return (
      <Overview
        {...initial}
        tasks={{ ...initial.tasks, items }}
        onToggleTask={(task, done) => setItems(list => list.map(item => (item.id === task.id ? { ...item, done } : item)))}
      />
    );
  }

  it('renders each task as a native checkbox named by the task and described by its meta, inside a full-row label', async () => {
    const user = userEvent.setup();
    const onToggleTask = vi.fn();
    const p = props({ onToggleTask });
    render(<Overview {...p} />);
    const block = region('Bu haftaki görevler');
    const montaj = taskBox(/Montaj için gün seç/);
    expect(montaj.tagName).toBe('INPUT');
    expect(montaj).toHaveAttribute('type', 'checkbox');
    expect(montaj).toHaveAccessibleName('Montaj için gün seç');
    expect(montaj).toHaveAccessibleDescription('GRV-0213 · Mert · 07.11.2026 · Bebek odasını hazırlama');
    expect(montaj).not.toBeChecked();
    // Proje yoksa ayraç eklenmez.
    expect(within(block).getByText('GRV-0199 · Elif · 10.11.2026')).toBeInTheDocument();
    expect(taskBox(/Kredi kartı ekstresini içe aktar/)).toBeChecked();
    // Satırın tamamı etikettir (64 px hedef); odak çizgisini admin.css [data-focus-line] ile çizer.
    const satir = montaj.closest('label') as HTMLLabelElement;
    expect(satir).toHaveClass('aile-ov-gorev');
    expect(satir).toHaveAttribute('data-focus-line', 'row');
    // antd yok: hiçbir ant- sınıfı çizilmez.
    expect(screen.getByTestId('overview').querySelector('[class*="ant-checkbox"]')).toBeNull();

    await user.click(within(satir).getByText('GRV-0213 · Mert · 07.11.2026 · Bebek odasını hazırlama'));
    expect(onToggleTask).toHaveBeenCalledTimes(1);
    expect(onToggleTask).toHaveBeenLastCalledWith(p.tasks.items[0], true);
  });

  it('disables task checkboxes when the page cannot record a toggle', () => {
    render(<Overview {...props({ onToggleTask: undefined })} />);
    expect(taskBox(/Montaj için gün seç/)).toBeDisabled();
  });

  it('toggles once on a touch tap and not when the touch is cancelled (pointercancel, e.g. a scroll)', async () => {
    const user = userEvent.setup();
    const onToggleTask = vi.fn();
    render(<Overview {...props({ onToggleTask })} />);
    const meta = within(region('Bu haftaki görevler')).getByText('GRV-0213 · Mert · 07.11.2026 · Bebek odasını hazırlama');

    await user.pointer([{ keys: '[TouchA>]', target: meta }, { keys: '[/TouchA]', target: meta }]);
    expect(onToggleTask).toHaveBeenCalledTimes(1);

    fireEvent.pointerDown(meta, { pointerId: 7, pointerType: 'touch', isPrimary: true });
    fireEvent.pointerCancel(meta, { pointerId: 7, pointerType: 'touch', isPrimary: true });
    expect(onToggleTask).toHaveBeenCalledTimes(1);
  });

  it('keeps focus on the same checkbox when Space toggles it and the page re-renders the task as done', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const montaj = taskBox(/Montaj için gün seç/);
    montaj.focus();
    await user.keyboard(' ');
    expect(taskBox(/Montaj için gün seç/)).toBe(montaj);
    expect(montaj).toBeChecked();
    expect(montaj).toHaveFocus();
    expect(montaj.closest('label')).toHaveClass('aile-ov-gorev--bitti');
    await user.keyboard(' ');
    expect(montaj).not.toBeChecked();
    expect(montaj).toHaveFocus();
  });

  it('keys that do not belong to a checkbox (arrows, Escape, Enter) neither toggle it nor move focus', async () => {
    const user = userEvent.setup();
    const onToggleTask = vi.fn();
    render(<Overview {...props({ onToggleTask })} />);
    const montaj = taskBox(/Montaj için gün seç/);
    montaj.focus();
    await user.keyboard('{ArrowDown}{ArrowUp}{ArrowLeft}{ArrowRight}{Escape}{Enter}');
    expect(onToggleTask).not.toHaveBeenCalled();
    expect(montaj).toHaveFocus();
  });
});

describe('Overview › klavye sırası ve bağlantılar', () => {
  /** Overview içinde Tab ile ulaşılan öğeler (bütçe tablosu/akordeonu ResponsiveTable'ındır, sırası orada sınanır). */
  async function tabSequence(user: ReturnType<typeof userEvent.setup>, shift = false) {
    const names: string[] = [];
    const root = screen.getByTestId('overview');
    for (let step = 0; step < 40; step += 1) {
      await user.tab({ shift });
      const active = document.activeElement as HTMLElement | null;
      if (!active || !root.contains(active)) break;
      if (active.closest('.aile-ov-tablo')) continue;
      const name = active.getAttribute('type') === 'checkbox'
        ? `[x] ${active.getAttribute('aria-labelledby') ? document.getElementById(active.getAttribute('aria-labelledby')!)?.textContent : ''}`
        : (active.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 24);
      names.push(name);
    }
    return names;
  }

  it('Tab walks blocks in reading order (payments, budget link, attention, tasks) and Shift+Tab walks it back', async () => {
    const user = userEvent.setup();
    render(<Overview {...props({ onToggleTask: vi.fn() })} />);
    const forward = await tabSequence(user);
    expect(forward).toEqual([
      'Ödemelere git',
      expect.stringMatching(/^03\.11\.2026/),
      'Bütçe ve nakit',
      'Veri kalitesi',
      expect.stringMatching(/^5Fiyatı eksik alım/),
      expect.stringMatching(/^3Yanıt bekleyen/),
      'Projeler ve görevler',
      '[x] Montaj için gün seç',
      '[x] Kredi kartı ekstresini içe aktar',
    ]);
    // Son öğeden geriye: aynı sıra ters.
    taskBoxLast().focus();
    const backward = await tabSequence(user, true);
    expect(backward).toEqual(forward.slice(0, -1).reverse());
  });

  const taskBoxLast = () => within(region('Bu haftaki görevler')).getByRole('checkbox', { name: /Kredi kartı/ });

  it('Enter on a payment row follows its link', async () => {
    const user = userEvent.setup();
    window.location.hash = '';
    render(<Overview {...props()} />);
    const kira = within(region('Yaklaşan ödemeler · 7 gün')).getByRole('link', { name: /Kira/ });
    kira.focus();
    await user.keyboard('{Enter}');
    expect(window.location.hash).toBe('#/odemeler/p1');
    window.location.hash = '';
  });
});

// --- Kaynak kuralları: telefon sunumu antd'siz, yalnız --aile-* tokenları ---------------------------------------
const UI_DIR = __dirname;
const SRC_DIR = resolve(UI_DIR, '..', '..');
const FORBIDDEN_PACKAGE = /^(antd|@ant-design\/|echarts|zrender)(\/|$)/;
const VALUE_IMPORT = /^\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\sfrom\s*)?['"]([^'"]+)['"]/gm;

/** Dosyanın statik değer importları (import type ve dinamik import() hariç). */
function staticImports(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  return [...source.matchAll(VALUE_IMPORT)].map(match => match[1]!);
}
function resolveLocal(from: string, specifier: string): string | null {
  const base = resolve(dirname(from), specifier);
  for (const candidate of [base, `${base}.tsx`, `${base}.ts`, resolve(base, 'index.tsx'), resolve(base, 'index.ts')]) {
    if (existsSync(candidate) && /\.(tsx?|mjs|js)$/.test(candidate)) return candidate;
  }
  return null;
}
/** ui/antd.ts (antd yeniden ihracı) ve geniş-özel modüller: telefonun statik kapanışında yer alamaz. */
const isForbiddenLocal = (file: string) => /[\\/]ui[\\/]antd\.ts$/.test(file) || /\.wide\.[tj]sx?$/.test(file) || /[\\/]wide[\\/]/.test(relative(SRC_DIR, file));
/**
 * Statik kapanışta yasak modülü doğrudan içe aktaran her modül, girişten ona giden yol ile:
 * "admin/ui/Overview.tsx > admin/ui/Tag.tsx → ./antd". Her modül bir kez gezilir; yasak hedefin içine inilmez.
 */
function forbiddenChains(entry: string): string[] {
  const name = (file: string) => relative(SRC_DIR, file);
  const parent = new Map<string, string | null>([[entry, null]]);
  const pathTo = (file: string) => {
    const path: string[] = [];
    for (let at: string | null | undefined = file; at; at = parent.get(at)) path.unshift(name(at));
    return path.join(' > ');
  };
  const chains: string[] = [];
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift()!;
    for (const specifier of staticImports(file)) {
      if (specifier.endsWith('.css')) continue;
      if (!specifier.startsWith('.')) {
        if (FORBIDDEN_PACKAGE.test(specifier)) chains.push(`${pathTo(file)} → ${specifier}`);
        continue;
      }
      const next = resolveLocal(file, specifier);
      if (!next) continue;
      if (isForbiddenLocal(next)) {
        chains.push(`${pathTo(file)} → ${specifier}`);
        continue;
      }
      if (!parent.has(next)) {
        parent.set(next, file);
        queue.push(next);
      }
    }
  }
  return chains;
}

/** Overview.css kuralları (yorumlar çıkarılmış): yorumdaki seçici adları kural sanılmasın. */
const overviewCss = () => readFileSync(resolve(UI_DIR, 'Overview.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

describe('Overview › kaynak kuralları', () => {
  it('Overview.tsx and Money.tsx import nothing from antd, @ant-design/*, ./antd, echarts or a wide module', () => {
    for (const file of ['Overview.tsx', 'Money.tsx']) {
      const imports = staticImports(resolve(UI_DIR, file));
      expect(imports.filter(spec => FORBIDDEN_PACKAGE.test(spec) || /(^|\/)antd$/.test(spec) || /\.wide$|\/wide\//.test(spec)), file).toEqual([]);
    }
  });

  it("Money's static closure is phone-safe", () => {
    expect(forbiddenChains(resolve(UI_DIR, 'Money.tsx'))).toEqual([]);
  });

  // Overview ortak bileşenleri kullanır (Tag › a08, ResponsiveTable/Table/AccordionList › a09, Button › a01); onların
  // telefon sunumu antd'siz olunca bu kapanış da temizdir. Zincir hangi modülün yasak yolu açtığını söyler.
  it("Overview's static closure is phone-safe (no antd, @ant-design, echarts or wide module)", () => {
    expect(forbiddenChains(resolve(UI_DIR, 'Overview.tsx'))).toEqual([]);
  });

  it('styles only through aile tokens: no raw colors, no focus ring, no shadow, no small text in Overview.css', () => {
    const css = readFileSync(resolve(UI_DIR, 'Overview.css'), 'utf8');
    expect(css).toMatch(/var\(--aile-/);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/rgba?\(/);
    expect(css).not.toMatch(/box-shadow\s*:/);
    expect(css).not.toMatch(/outline\s*:\s*(?!none)/);
    expect(css).not.toMatch(/font-size\s*:\s*(1[0-3]|[0-9])px/);
    // antd'ye bağlı seçici yok.
    expect(css).not.toMatch(/\.ant-/);
  });

  it('moves with the single duration and curve only, and derives layout from props/container queries, not width media queries', () => {
    const css = overviewCss();
    const transitions = [...css.matchAll(/transition\s*:\s*([^;]+);/g)].map(match => match[1]!.trim());
    expect(transitions.length).toBeGreaterThan(0);
    for (const value of transitions) {
      for (const part of value.split(',')) expect(part.trim()).toMatch(/^[a-z-]+ var\(--aile-sure\) var\(--aile-egri\)$/);
    }
    expect(css).not.toMatch(/animation\s*:|@keyframes/);
    expect(css).not.toMatch(/@media[^{]*(min|max)-width/);
  });

  it('gives every Overview target the shared touch-target token (44 px, coarse 48 px) instead of its own size', () => {
    const css = overviewCss();
    // --aile-dokunma-hedefi: 44 px, kaba işaretçi katmanında 48 px (admin.css, b04). Bileşen kendi coarse kuralını yazmaz.
    expect(css).toMatch(/\.aile-ov-bag\s*\{[^}]*min-height:\s*var\(--aile-dokunma-hedefi\)/);
    expect(css).toMatch(/\.aile-ov-bag\s*\{[^}]*min-width:\s*var\(--aile-dokunma-hedefi\)/);
    expect(css).not.toMatch(/--aile-hedef-asgari/);
    expect(css).not.toMatch(/\[data-input-coarse\]/);
    // Satırlar (ödeme, dikkat, görev) 64 px: hedefin üstünde.
    for (const rule of ['aile-ov-satir', 'aile-ov-gorev']) {
      expect(css).toMatch(new RegExp(`\\.${rule}\\s*\\{[^}]*min-height:\\s*calc\\(var\\(--aile-bosluk-8\\) \\* 2\\)`));
    }
  });
});
