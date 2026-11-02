import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Money } from '../shell/contracts';
import { Overview, type OverviewProps } from './Overview';

// Tasarım: components/Overview/README.md — başlık altında üç ölçü (kutusuz, tek satır); sol sütun Yaklaşan ödemeler
// (tarih, ad, taraf, tutar, durum sözcüğü) + Bütçe tablosu (Planlanan, Gerçekleşen, Kalan ayrı; ince çubuk + yüzde
// METNİ); sağ sütun Dikkat isteyenler (sayı + bağlantı) + Bu haftaki görevler (onay kutusu); her blok başlığının
// yanında ilgili sayfaya bağlantı. Veri props ile gelir; Overview yalnız çizer ve biçimler. Seçiciler role/label.

const money = (amount: string): Money => ({ amount, currency: 'TRY' });

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
        { id: 'b1', label: 'Bebek odası', planned: money('42000.00'), actual: money('27380.00') },
        { id: 'b2', label: 'Mutfak', planned: money('31000.00'), actual: money('4120.00') },
        { id: 'b3', label: 'Birikim', planned: money('5000.00'), actual: null },
        { id: 'b4', label: 'Ulaşım', planned: money('3500.00'), actual: money('3920.00') },
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

describe('Overview', () => {
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

  it('keeps Planlanan, Gerçekleşen and Kalan as separate budget columns with a percent text on wide screens', () => {
    render(<Overview {...props()} />);
    const block = region('Bütçe · Kasım 2026');
    // antd yapışkan başlıkta başlık ve gövde ayrı <table> öğeleridir; sütun başlıkları blok içinde aranır.
    const table = within(block).getByRole('table', { name: 'Bütçe kalemleri' });
    expect(within(block).getAllByRole('columnheader').map(th => th.textContent)).toEqual(['Kalem', 'Planlanan', 'Gerçekleşen', 'Kalan']);

    const bebek = within(table).getByText('Bebek odası').closest('tr') as HTMLTableRowElement;
    const cells = within(bebek).getAllByRole('cell').map(td => td.textContent);
    expect(cells[1]).toBe('₺42.000,00');
    expect(cells[2]).toBe('₺27.380,00');
    expect(cells[3]).toBe('₺14.620,00');
    expect(within(bebek).getByText('%65 harcandı')).toBeInTheDocument();

    // Aşılan kalem: yüzde 100'ü geçer, kalan eksi yazılır; iki değer tek sayıda birleşmez.
    const ulasim = within(table).getByText('Ulaşım').closest('tr') as HTMLTableRowElement;
    expect(within(ulasim).getByText('%112 harcandı')).toBeInTheDocument();
    expect(within(ulasim).getAllByRole('cell').map(td => td.textContent)[3]).toBe('-₺420,00');
    expect(within(table).queryByText(/₺[\d.,]+\s*\/\s*₺/)).not.toBeInTheDocument();

    // Gerçekleşen yoksa adıyla yazılır ve yüzde üretilmez.
    const birikim = within(table).getByText('Birikim').closest('tr') as HTMLTableRowElement;
    const birikimCells = within(birikim).getAllByRole('cell').map(td => td.textContent);
    expect(birikimCells[1]).toBe('₺5.000,00');
    expect(birikimCells[2]).toBe('Henüz yok');
    expect(birikimCells[3]).toBe('Henüz yok');
    expect(within(birikim).queryByText(/harcandı/)).not.toBeInTheDocument();

    // Çubuk süsleyicidir: yüzde bilgisini metin taşır, ekran okuyucuya ikinci bir ilerleme çubuğu okunmaz.
    expect(screen.queryAllByRole('progressbar')).toHaveLength(0);
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
  });

  it('shows attention counts as links into the related page', () => {
    render(<Overview {...props()} />);
    const block = region('Dikkat isteyenler');
    const link = within(block).getByRole('link', { name: /Fiyatı eksik alım/ });
    expect(link).toHaveAttribute('href', '#/alimlar?fiyat=yok');
    expect(within(link).getByText('5')).toBeInTheDocument();
    expect(within(link).getByText('Alımlar ve eşyalar')).toBeInTheDocument();
    expect(within(block).getByRole('link', { name: /Yanıt bekleyen teklif/ })).toHaveAttribute('href', '#/taraflar');
  });

  it("renders this week's tasks as checkboxes with their meta and reports toggles to the page", async () => {
    const user = userEvent.setup();
    const onToggleTask = vi.fn();
    const p = props({ onToggleTask });
    render(<Overview {...p} />);
    const block = region('Bu haftaki görevler');
    const montaj = within(block).getByRole('checkbox', { name: /Montaj için gün seç/ });
    expect(montaj).not.toBeChecked();
    expect(within(block).getByText('GRV-0213 · Mert · 07.11.2026 · Bebek odasını hazırlama')).toBeInTheDocument();
    // Proje yoksa "—" eklenmez.
    expect(within(block).getByText('GRV-0199 · Elif · 10.11.2026')).toBeInTheDocument();
    expect(within(block).getByRole('checkbox', { name: /Kredi kartı ekstresini içe aktar/ })).toBeChecked();

    await user.click(montaj);
    expect(onToggleTask).toHaveBeenCalledTimes(1);
    expect(onToggleTask).toHaveBeenLastCalledWith(p.tasks.items[0], true);
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

  it('styles only through aile tokens: no raw colors, no focus ring, no shadow in Overview.css', () => {
    const css = readFileSync(resolve(__dirname, 'Overview.css'), 'utf8');
    expect(css).toMatch(/var\(--aile-/);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/box-shadow\s*:/);
    expect(css).not.toMatch(/outline\s*:\s*(?!none)/);
    expect(css).not.toMatch(/font-size\s*:\s*(1[0-3]|[0-9])px/);
  });
});
