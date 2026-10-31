import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, userEvent, within } from '@/test-utils/render';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import type { Item } from '@shared/schema';
import { ItemCard } from './ItemCard';
import { TotalsBar } from './TotalsBar';
import { DEFAULT_FILTERS, totalsFor } from '@/data/selectors';
import { toPatch } from './ItemDetail';
import { applyRead, resetStore, setState } from '@/sync/store';
import { PurchaseList } from './PurchaseList';

vi.mock('@/sync/controller', () => ({ upsert: vi.fn(), remove: vi.fn(), refresh: vi.fn(), startSync: vi.fn() }));

const item: Item = { id: 'A', tip: 'satinalma', ad: 'Örnek koltuk takımı uzun bir ad ile', faz: '1', durum: 'karar', oda: 'salon', tahmini_tl_min: 1500, tahmini_tl_max: 1500, karar_bekliyor: true, siparis_son_tarih: '2099-01-01' };

function withRouter(ui: React.ReactElement, path = '/satinalma') {
  const { hook } = memoryLocation({ path, static: false });
  return <Router hook={hook}>{ui}</Router>;
}

beforeEach(() => resetStore());

describe('ItemCard', () => {
  it('ad, fiyat, rozetler ve alındı kutusu', async () => {
    const onToggle = vi.fn();
    render(withRouter(<ItemCard item={item} onToggleDone={onToggle} />));
    expect(screen.getByText(item.ad)).toBeInTheDocument();
    expect(screen.getByText('₺1.500')).toBeInTheDocument();
    expect(screen.getByText('Önce')).toBeInTheDocument();
    expect(screen.getByText('Karar')).toBeInTheDocument();
    expect(screen.getByText('Salon')).toBeInTheDocument();
    expect(screen.getByText('karar')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: /alındı/ }));
    expect(onToggle).toHaveBeenCalledWith(item, true);
  });
  it('uzun adı kırpmaz: başlık satır sınırı olmadan tam görünür', () => {
    render(withRouter(<ItemCard item={item} onToggleDone={vi.fn()} />));
    const title = screen.getByText(item.ad);
    expect(title).not.toHaveAttribute('data-allow-clamp');
    expect(title).not.toHaveAttribute('data-line-clamp');
    expect(title.style.getPropertyValue('--text-line-clamp')).toBe('');
  });
  it('mevcut eşya fiyat yerine "mevcut" gösterir', () => {
    render(withRouter(<ItemCard item={{ ...item, mevcut: true }} onToggleDone={vi.fn()} />));
    expect(screen.getByText('mevcut')).toBeInTheDocument();
  });
});

describe('TotalsBar', () => {
  it('toplam, kalem ve fiyatsız sayısı', () => {
    const items: Item[] = [item, { id: 'B', tip: 'satinalma', ad: 'Fiyatsız', faz: '1' }, { id: 'C', tip: 'satinalma', ad: 'Sonra', faz: '2', tahmini_tl_min: 10 }];
    const { rerender } = render(<TotalsBar faz="1" onFaz={vi.fn()} totals={totalsFor(items, '1', new Date(2026, 9, 26))} />);
    expect(screen.getByTestId('totals-sum')).toHaveTextContent('₺1.500');
    expect(screen.getByText('2 kalem')).toBeInTheDocument();
    expect(screen.queryByText('1 fiyatsız')).toBeNull(); // uyarı rozetleri şeride taşındı
    expect(screen.getByTestId('totals-count')).toHaveTextContent('2 kalem');
    rerender(<TotalsBar faz="1" onFaz={vi.fn()} totals={totalsFor(items, '1', new Date(2026, 9, 26))} count={1} total={2} filtered />);
    expect(screen.getByTestId('totals-sum')).toHaveTextContent('₺1.500');
    expect(screen.getByTestId('totals-count')).toHaveTextContent('1 / 2 kalem');
  });
});

describe('toPatch', () => {
  it('yeni kalemde tüm alanlar; var olanda yalnız değişenler', () => {
    const base = { ad: 'X', faz: '1' as const, karar_bekliyor: false, oncelik: 2, adet: 1, birim: 'adet', tahmini_tl_min: 5, tahmini_tl_max: null, gercek_tl: null, nereden: '', siparis_son_tarih: null, teslim_suresi_gun: null, teslim_tarihi: null, linkler: [], not: '', mevcut: false };
    const p = toPatch(base);
    expect(p).toMatchObject({ tip: 'satinalma', ad: 'X', tahmini_tl_min: 5, tahmini_tl_max: 5, fiyat_guven: 'tahmini', linkler: null, nereden: null });
    const prev: Item = { id: 'A', tip: 'satinalma', ad: 'X', faz: '1', oncelik: 2, adet: 1, birim: 'adet', tahmini_tl_min: 5, tahmini_tl_max: 5, fiyat_guven: 'tahmini' };
    const p2 = toPatch({ ...base, ad: 'Y' }, prev);
    expect(p2).toEqual({ tip: 'satinalma', ad: 'Y' });
  });
});

describe('PurchaseList', () => {
  it('boş liste EmptyState gösterir; veri gelince kartlar', async () => {
    setState({ hydrated: true, status: 'synced' });
    const { rerender } = render(withRouter(<PurchaseList />));
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    applyRead({ ok: true, fingerprint: 'f', serverTime: 't', schemaVersion: 1, items: [item, { ...item, id: 'B', ad: 'İkinci' }], settings: [] });
    rerender(withRouter(<PurchaseList />));
    const list = screen.getByTestId('item-list');
    expect(within(list).getAllByTestId('item-card')).toHaveLength(2);
  });
  it('arama filtreler', async () => {
    setState({ hydrated: true, status: 'synced' });
    applyRead({ ok: true, fingerprint: 'f', serverTime: 't', schemaVersion: 1, items: [item, { ...item, id: 'B', ad: 'Perde' }], settings: [] });
    render(withRouter(<PurchaseList />));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Kalem ara' }), 'perde');
    await screen.findByText('Perde');
    await vi.waitFor(() => expect(within(screen.getByTestId('item-list')).getAllByTestId('item-card')).toHaveLength(1));
  });
});

describe('PurchaseList filtre deneyimi', () => {
  const items: Item[] = [
    { ...item, oncelik: 2 },
    { ...item, id: 'B', ad: 'Perde', durum: 'fikir', oda: 'mutfak', oncelik: 1, tahmini_tl_min: undefined, tahmini_tl_max: undefined, karar_bekliyor: false, siparis_son_tarih: undefined },
    { ...item, id: 'C', ad: 'Alınmış sehpa', durum: 'teslim', oda: 'salon', karar_bekliyor: false, siparis_son_tarih: undefined, tahmini_tl_min: 200, tahmini_tl_max: 200 },
  ];
  const seed = () => {
    setState({ hydrated: true, status: 'synced' });
    applyRead({ ok: true, fingerprint: 'f', serverTime: 't', schemaVersion: 1, items, settings: [] });
  };
  beforeEach(() => { localStorage.clear(); });

  it('hızlı şerit sayımlı çipler; Fiyatsız tek dokunuşla filtreler; huni rozeti ve toplam izler', async () => {
    seed();
    render(withRouter(<PurchaseList />));
    const rail = screen.getByTestId('filter-rail');
    expect(within(rail).getByRole('checkbox', { name: 'Fiyatsız 1' })).not.toBeChecked();
    expect(within(rail).getByRole('checkbox', { name: 'Karar bekliyor 1' })).toBeInTheDocument();
    expect(within(rail).getByRole('checkbox', { name: 'Alınacaklar 2' })).toBeInTheDocument();
    expect(screen.getByTestId('totals-count')).toHaveTextContent('3 kalem');
    await userEvent.click(within(rail).getByText('Fiyatsız'));
    await vi.waitFor(() => expect(within(screen.getByTestId('item-list')).getAllByTestId('item-card')).toHaveLength(1));
    expect(screen.getByText('Perde')).toBeInTheDocument();
    expect(screen.getByTestId('filter-button')).toHaveAccessibleName('Filtrele, 1 etkin');
    expect(screen.getByTestId('totals-count')).toHaveTextContent('1 / 3 kalem');
    // Alınacaklar sayımı diğer filtreye göre daralır
    expect(within(rail).getByRole('checkbox', { name: 'Alınacaklar 1' })).toBeInTheDocument();
  });

  it('kapananlar en altta; Alınacaklar gizler; sayfadan oda seçimi şeritte kaldırılabilir çip olur', async () => {
    seed();
    render(withRouter(<PurchaseList />));
    const cards = () => within(screen.getByTestId('item-list')).getAllByTestId('item-card');
    expect(cards()).toHaveLength(3);
    expect(cards()[2]).toHaveAttribute('data-done');
    await userEvent.click(within(screen.getByTestId('filter-rail')).getByText('Alınacaklar'));
    await vi.waitFor(() => expect(cards()).toHaveLength(2));
    // Sayfa: oda
    await userEvent.click(screen.getByTestId('filter-button'));
    const sheet = await screen.findByTestId('filter-drawer');
    await userEvent.click(within(sheet).getByRole('checkbox', { name: 'Mutfak 1' }));
    expect(screen.getByTestId('filter-apply')).toHaveTextContent('1 kalemi göster');
    await userEvent.click(screen.getByTestId('filter-apply'));
    await vi.waitFor(() => expect(screen.queryByTestId('filter-drawer')).toBeNull());
    const active = screen.getByTestId('active-chip-oda-mutfak');
    expect(within(active).getByRole('checkbox')).toBeChecked();
    expect(screen.getByTestId('filter-button')).toHaveAccessibleName('Filtrele, 2 etkin');
    await userEvent.click(within(active).getByText('Mutfak'));
    await vi.waitFor(() => expect(screen.queryByTestId('active-chip-oda-mutfak')).toBeNull());
    expect(cards()).toHaveLength(2);
    // Temizle hepsini sıfırlar
    await userEvent.click(within(screen.getByTestId('filter-rail')).getByRole('button', { name: /Temizle/ }));
    await vi.waitFor(() => expect(cards()).toHaveLength(3));
  });

  it('eski localStorage şeması güvenle okunur; faz uygulanır', () => {
    localStorage.setItem('aile:purchase:filters', JSON.stringify({ faz: '2', durum: 'karar', fiyatsiz: 1, eski: true }));
    seed();
    render(withRouter(<PurchaseList />));
    // faz 2'de kalem yok (hepsi faz 1) + fiyatsız açık → boş durum, çökmez
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Yerleşme' })).toBeChecked();
  });

  it('bozuk localStorage değeri varsayılana düşer', () => {
    localStorage.setItem('aile:purchase:filters', '{bozuk');
    seed();
    render(withRouter(<PurchaseList />));
    expect(within(screen.getByTestId('item-list')).getAllByTestId('item-card')).toHaveLength(3);
  });

  it('sıfır sayımlı hızlı çip devre dışı: boş sonuca götürmez', async () => {
    seed();
    render(withRouter(<PurchaseList />));
    const rail = screen.getByTestId('filter-rail');
    await userEvent.click(within(rail).getByText('Fiyatsız'));
    await vi.waitFor(() => expect(within(rail).getByRole('checkbox', { name: 'Karar bekliyor 0' })).toBeDisabled());
    expect(within(screen.getByTestId('item-list')).getAllByTestId('item-card')).toHaveLength(1);
  });

  it('bayat kalıcı facet (bu kapsamda 0 kalem) boş liste yapar; şeritte "· 0" çipi ve "Filtreleri temizle" geri getirir', async () => {
    localStorage.setItem('aile:purchase:filters', JSON.stringify({ ...DEFAULT_FILTERS, oda: ['banyo'] }));
    seed();
    render(withRouter(<PurchaseList />));
    expect(within(screen.getByTestId('active-chip-oda-banyo')).getByRole('checkbox', { name: 'Banyo 0' })).toBeChecked();
    const empty = await screen.findByTestId('empty-state');
    expect(empty).toHaveTextContent('Filtreye uyan kalem yok');
    await userEvent.click(within(empty).getByRole('button', { name: 'Filtreleri temizle' }));
    await vi.waitFor(() => expect(within(screen.getByTestId('item-list')).getAllByTestId('item-card')).toHaveLength(3));
  });

  it('sıralama düğmesi: Ad seçilince açık kalemler ada göre, kapananlar yine en altta', async () => {
    seed();
    render(withRouter(<PurchaseList />));
    await userEvent.click(screen.getByTestId('sort-button'));
    const sheet = await screen.findByTestId('sort-sheet');
    await userEvent.click(within(sheet).getByRole('radio', { name: /Ad/ }));
    // Varsayılan (öncelik): Perde(1), Örnek(2), kapalı. Ad: Örnek (Ö < P, tr), Perde, kapalı en altta.
    await vi.waitFor(() => {
      const names = within(screen.getByTestId('item-list')).getAllByTestId('item-card').map((c) => c.textContent ?? '');
      expect(names[0]).toContain('Örnek koltuk');
      expect(names[1]).toContain('Perde');
      expect(names[2]).toContain('Alınmış sehpa');
    });
    expect(screen.getByTestId('sort-button')).toHaveAccessibleName(/Sırala: Ad/);
  });
});

