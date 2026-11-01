import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, userEvent, within } from '@/test-utils/render';
import { Route, Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { notifications } from '@mantine/notifications';
import type { Item } from '@shared/schema';
import { ItemCard } from './ItemCard';
import { TotalsBar } from './TotalsBar';
import { DEFAULT_FILTERS, totalsFor } from '@/data/selectors';
import { ownedPatch, toPatch } from './ItemDetail';
import { applyRead, resetStore, setState } from '@/sync/store';
import { upsert } from '@/sync/controller';
import { PurchaseList } from './PurchaseList';

vi.mock('@/sync/controller', () => ({ upsert: vi.fn(() => 'NEWID'), remove: vi.fn(), refresh: vi.fn(), startSync: vi.fn() }));
vi.mock('@mantine/notifications', () => ({ notifications: { show: vi.fn(), hide: vi.fn() } }));

const item: Item = { id: 'A', tip: 'satinalma', ad: 'Örnek koltuk takımı uzun bir ad ile', faz: '1', durum: 'karar', oda: 'salon', tahmini_tl_min: 1500, tahmini_tl_max: 1500, karar_bekliyor: true, siparis_son_tarih: '2099-01-01' };

function withRouter(ui: React.ReactElement, path = '/satinalma') {
  const { hook } = memoryLocation({ path, static: false });
  return <Router hook={hook}>{ui}</Router>;
}

beforeEach(() => resetStore());

describe('ItemCard', () => {
  it('tutarın niteliği, sipariş ve teslim tarihi ayrı okunur; teslim ödeme kanıtı sayılmaz', () => {
    render(withRouter(<ItemCard item={{ ...item, durum: 'teslim', gercek_tl: 1700, fiyat_guven: 'dogrulandi', teslim_tarihi: '2099-02-15' }} onToggleDone={vi.fn()} />));
    expect(screen.getByText('Kayıtlı bedel')).toBeInTheDocument();
    expect(screen.getByText('Fiyat doğrulandı')).toBeInTheDocument();
    expect(screen.getByText('Sipariş son günü')).toBeInTheDocument();
    expect(screen.getByText('Teslim tarihi')).toBeInTheDocument();
    expect(screen.getByText('Teslim durumu ödeme kaydı değildir.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Harcama kayıtlarına git' })).toHaveAttribute('href', '/butce');
    expect(screen.queryByText('Ödendi')).not.toBeInTheDocument();
  });
  it('tahmin ve eksik fiyatı açıklar; eksik fiyat sıfır ödeme değildir', () => {
    const { rerender } = render(withRouter(<ItemCard item={item} onToggleDone={vi.fn()} />));
    expect(screen.getByText('Tahmini bedel')).toBeInTheDocument();
    expect(screen.getByText('Ödeme kaydı değildir.')).toBeInTheDocument();
    rerender(withRouter(<ItemCard item={{ ...item, tahmini_tl_min: undefined, tahmini_tl_max: undefined }} onToggleDone={vi.fn()} />));
    expect(screen.getByText('Fiyat girilmedi')).toBeInTheDocument();
    expect(screen.queryByText('₺0')).not.toBeInTheDocument();
  });
  it('ad, fiyat, rozetler ve alındı kutusu', async () => {
    const onToggle = vi.fn();
    render(withRouter(<ItemCard item={item} onToggleDone={onToggle} />));
    expect(screen.getByText(item.ad)).toBeInTheDocument();
    expect(screen.getByText('₺1.500')).toBeInTheDocument();
    expect(screen.getByText('Önce')).toBeInTheDocument();
    expect(screen.getByText('Karar')).toBeInTheDocument();
    expect(screen.getByText('Salon')).toBeInTheDocument();
    // Round 3 wording: the pending-decision warning names itself ("Karar bekliyor") instead of a bare "karar".
    expect(screen.getByText('Karar bekliyor')).toBeInTheDocument();
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

describe('Kayıt yolculuğu: yeni kalem formu ve kayıt sonrası görünürlük', () => {
  const seed = () => {
    setState({ hydrated: true, status: 'synced' });
    applyRead({ ok: true, fingerprint: 'f', serverTime: 't', schemaVersion: 1, items: [item], settings: [] });
  };
  const mountAt = (path: string) => {
    const loc = memoryLocation({ path, static: false, record: true });
    render(<Router hook={loc.hook}><Route path="/satinalma" nest><PurchaseList /></Route></Router>);
    return loc;
  };
  // Mantine FocusTrap odağı mount sonrası zamanlayıcıyla taşır; iddia ondan sonra ölçülür.
  const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 30)));
  beforeEach(() => { localStorage.clear(); vi.mocked(upsert).mockClear(); vi.mocked(notifications.show).mockClear(); vi.mocked(notifications.hide).mockClear(); });

  it('uzun formda kimlik, fiyat teyidi ve sipariş alanları adlandırılmış bölümlerdedir', async () => {
    seed();
    mountAt('/satinalma/yeni');
    expect(within(screen.getByRole('region', { name: 'Kalem bilgileri' })).getByLabelText(/^Ad\b/)).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Fiyat ve teyit' })).getByLabelText('Gerçek')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Sipariş ve teslim' })).getByLabelText('Nereden')).toBeInTheDocument();
  });

  it('açılış odağı modalın Kapat düğmesine değil Ad alanına gider', async () => {
    seed();
    mountAt('/satinalma/yeni');
    const form = await screen.findByTestId('item-detail');
    await settle();
    expect(within(form).getByLabelText(/^Ad\b/)).toHaveFocus();
  });

  it('boş Ad ile Kaydet: kayıt yazılmaz, odak ilk hatalı alana gider, hata sayısı duyurulur', async () => {
    seed();
    mountAt('/satinalma/yeni');
    const form = await screen.findByTestId('item-detail');
    await settle();
    await userEvent.click(within(form).getByLabelText('Not'));
    await userEvent.click(within(form).getByRole('button', { name: 'Kaydet' }));
    expect(upsert).not.toHaveBeenCalled();
    expect(within(form).getByText('Ad gerekli')).toBeInTheDocument();
    expect(within(form).getByLabelText(/^Ad\b/)).toHaveFocus();
    expect(within(form).getByRole('status')).toHaveTextContent('1 alan düzeltilmeli');
    // setFieldValue ile bağlı fiyat alanı da ilk hatalı alan olarak odak alır
    await userEvent.type(within(form).getByLabelText(/^Ad\b/), 'Odak');
    await userEvent.type(within(form).getByLabelText('Tahmini (min)'), '200');
    await userEvent.type(within(form).getByLabelText('Tahmini (max)'), '100');
    await userEvent.click(within(form).getByLabelText('Not'));
    await userEvent.click(within(form).getByRole('button', { name: 'Kaydet' }));
    expect(upsert).not.toHaveBeenCalled();
    expect(within(form).getByLabelText('Tahmini (max)')).toHaveFocus();
    expect(within(form).getByRole('status')).toHaveTextContent('1 alan düzeltilmeli');
  });

  it('etkin faz ve tek seçili oda yeni kaleme ön değer olur; görünür kayıt olağan bildirim alır', async () => {
    localStorage.setItem('aile:purchase:filters', JSON.stringify({ ...DEFAULT_FILTERS, faz: '2', oda: ['mutfak'] }));
    seed();
    mountAt('/satinalma/yeni');
    const form = await screen.findByTestId('item-detail');
    expect(within(form).getByRole('radio', { name: 'Yerleşme' })).toBeChecked();
    expect(within(form).getByRole('combobox', { name: 'Oda' })).toHaveValue('Mutfak');
    await userEvent.type(within(form).getByLabelText(/^Ad\b/), 'Mutfak kalemi');
    await userEvent.click(within(form).getByRole('button', { name: 'Kaydet' }));
    expect(upsert).toHaveBeenCalledWith('kalemler', undefined, expect.objectContaining({ ad: 'Mutfak kalemi', faz: '2', oda: 'mutfak' }));
    expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({ message: 'Kalem eklendi' }));
  });

  it('kayıt etkin filtrede görünmüyorsa bildirim bunu söyler ve Göster filtreyi açar', async () => {
    localStorage.setItem('aile:purchase:filters', JSON.stringify({ ...DEFAULT_FILTERS, faz: '2', fiyatsiz: true }));
    seed();
    mountAt('/satinalma/yeni');
    const form = await screen.findByTestId('item-detail');
    await userEvent.type(within(form).getByLabelText(/^Ad\b/), 'Fiyatlı kalem');
    await userEvent.type(within(form).getByLabelText('Tahmini (min)'), '500');
    await userEvent.click(within(form).getByRole('button', { name: 'Kaydet' }));
    expect(upsert).toHaveBeenCalledTimes(1);
    const shown = vi.mocked(notifications.show).mock.calls.at(-1)![0];
    render(<>{shown.message}</>);
    expect(screen.getByText(/Kalem eklendi · bu filtrede görünmüyor/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Göster' }));
    expect(notifications.hide).toHaveBeenCalledWith(shown.id);
    expect(screen.getByTestId('filter-button')).toHaveAccessibleName('Filtrele');
    expect(screen.getByRole('radio', { name: 'Yerleşme' })).toBeChecked(); // kaydın fazı korunur, yalnız gizleyen filtre kalkar
    // Bildirim kapanınca odak gövdeye düşmez: kayıt listede yoksa (burada upsert sahte) kalan liste kontrolüne gider
    expect(screen.getByTestId('filter-button')).toHaveFocus();
  });

  it('var olan kalemde değişiklik yoksa Kaydet Sheets\'e yazmaz ve form kapanır', async () => {
    // Eksik alanlı (adet/birim/öncelik yok) kayıt: formun gösterdiği varsayılanlar kullanıcı değişikliği değildir, yazılmaz.
    seed();
    const loc = mountAt('/satinalma/A');
    const form = await screen.findByTestId('item-detail');
    await userEvent.click(within(form).getByRole('button', { name: 'Kaydet' }));
    expect(upsert).not.toHaveBeenCalled();
    expect(loc.history.at(-1)).toBe('/satinalma');
  });
});


describe('Tur 3: kayıt kartı okuma sırası, form ve çakışma', () => {
  it('kart: kimlik → durum ve kapsam → dikkat → bedel ve ödeme ayrımı aynı grupta → görünür adlı tamamlama', () => {
    render(withRouter(<ItemCard item={item} onToggleDone={vi.fn()} />));
    const card = screen.getByTestId('item-card');
    const status = within(card).getByRole('group', { name: 'Durum ve kapsam' });
    expect(within(status).getByText('Karar')).toBeInTheDocument();
    expect(status).toHaveTextContent('Önce');
    expect(status).toHaveTextContent('Salon');
    const attention = within(card).getByRole('group', { name: 'Dikkat' });
    expect(attention).toHaveTextContent('Karar bekliyor');
    const facts = within(card).getByRole('group', { name: `${item.ad} alım bilgileri` });
    expect(facts).toHaveTextContent('₺1.500');
    // The payment distinction qualifies the amount, so it sits in the same group, after the dates.
    expect(within(facts).getByText('Ödeme kaydı değildir.')).toBeInTheDocument();
    const order = [within(card).getByRole('heading', { level: 3 }), status, attention, facts];
    for (let i = 1; i < order.length; i++) expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The completion checkbox has a visible name, not only an icon.
    const done = within(card).getByRole('checkbox', { name: /alındı/ });
    expect(done.closest('label')).toHaveTextContent('Alındı');
  });

  it('kart: geçerli HTML üretir; paragraf içinde blok öğe (rozet div) yoktur', () => {
    render(withRouter(<ItemCard item={{ ...item, mevcut: true }} onToggleDone={vi.fn()} />));
    // A Mantine Badge renders a <div>; it must not sit inside a <p> (invalid HTML, React does not always warn).
    expect(screen.getByTestId('item-card').querySelectorAll('p div, p p')).toHaveLength(0);
  });

  it('kart: fiyatı bilinmeyen kayıt eksik bilgiyi adlandırır ve kaydın kendisine "Fiyat ekle" eylemi verir', () => {
    render(withRouter(<ItemCard item={{ ...item, tahmini_tl_min: undefined, tahmini_tl_max: undefined }} onToggleDone={vi.fn()} />));
    const facts = screen.getByRole('group', { name: `${item.ad} alım bilgileri` });
    expect(facts).toHaveTextContent('Fiyat girilmedi');
    // The action opens the record at its price section (round 3 closing), not at identity.
    expect(within(facts).getByRole('link', { name: 'Fiyat ekle' })).toHaveAttribute('href', '/satinalma/A/fiyat');
    expect(screen.queryByText('₺0')).not.toBeInTheDocument();
  });

  const seed = () => {
    setState({ hydrated: true, status: 'synced' });
    applyRead({ ok: true, fingerprint: 'f', serverTime: 't', schemaVersion: 1, items: [item], settings: [] });
  };
  const mountAt = (path: string) => {
    const loc = memoryLocation({ path, static: false, record: true });
    render(<Router hook={loc.hook}><Route path="/satinalma" nest><PurchaseList /></Route></Router>);
    return loc;
  };
  const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 30)));

  it('form: düzenleme penceresi kaydı adıyla açılır; yeni kayıt "Yeni kalem"', async () => {
    seed();
    mountAt('/satinalma/A');
    expect(await screen.findByRole('dialog', { name: item.ad })).toBeInTheDocument();
  });

  it('form: faz seçimi adlandırılmış bir gruptur; fiyat bölümü boş ile 0 farkını söyler', async () => {
    seed();
    mountAt('/satinalma/yeni');
    const dialog = await screen.findByRole('dialog', { name: 'Yeni kalem' });
    expect(within(within(dialog).getByRole('group', { name: 'Faz' })).getByRole('radio', { name: 'Önce' })).toBeInTheDocument();
    expect(within(dialog).getByRole('region', { name: 'Fiyat ve teyit' })).toHaveTextContent('Boş bırakılan fiyat bilinmiyor demektir; 0 yalnız gerçekten ücretsizse yazılır.');
  });

  it('form: ilk hatada düzeltilecek alanlar adıyla listelenir, düğme alana götürür, canlı sayı metni değişmez', async () => {
    seed();
    mountAt('/satinalma/yeni');
    const form = await screen.findByTestId('item-detail');
    await settle();
    expect(within(form).queryByRole('group', { name: 'Düzeltilecek alanlar' })).not.toBeInTheDocument();
    await userEvent.click(within(form).getByLabelText('Not'));
    await userEvent.click(within(form).getByRole('button', { name: 'Kaydet' }));
    expect(within(form).getByRole('status')).toHaveTextContent(/^1 alan düzeltilmeli$/);
    const list = within(form).getByRole('group', { name: 'Düzeltilecek alanlar' });
    await userEvent.click(within(form).getByLabelText('Not'));
    await userEvent.click(within(list).getByRole('button', { name: 'Ad' }));
    expect(within(form).getByLabelText(/^Ad\b/)).toHaveFocus();
  });

  it('çakışma bandı alan adlarını ve seçenek değerlerini okunur etiketle gösterir', async () => {
    seed();
    setState({ conflicts: [{ id: 'A', table: 'kalemler', keys: ['tahmini_tl_min', 'durum'], myValues: { tahmini_tl_min: 1500, durum: 'arastirma' }, serverValues: { tahmini_tl_min: 1800, durum: 'karar' }, updatedBy: 'Örnek kişi', updatedAt: '2099-01-01T10:00:00Z' }] });
    mountAt('/satinalma/A');
    const banner = await screen.findByTestId('conflict-banner');
    expect(banner).toHaveTextContent('Tahmini (min)');
    expect(banner).toHaveTextContent('Araştırma');
    expect(banner).not.toHaveTextContent('tahmini_tl_min');
    expect(banner).not.toHaveTextContent('arastirma');
  });
});

describe('Tur 3 kapanış: arka plan yenilemesi düzenlemeyi ezmez (koruma testi; düzeltmeden önce de geçer)', () => {
  it('açık formdaki değiştirilmiş alan, aynı kaydın yeni okuması gelince korunur; yeni okuma formu yeniden kurmaz', async () => {
    setState({ hydrated: true, status: 'synced' });
    applyRead({ ok: true, fingerprint: 'f', serverTime: 't', schemaVersion: 1, items: [item], settings: [] });
    const loc = memoryLocation({ path: '/satinalma/A', static: false, record: true });
    render(<Router hook={loc.hook}><Route path="/satinalma" nest><PurchaseList /></Route></Router>);
    const form = await screen.findByTestId('item-detail');
    await userEvent.type(within(form).getByLabelText('Not'), 'Benim notum');
    act(() => { applyRead({ ok: true, fingerprint: 'g', serverTime: 't2', schemaVersion: 1, items: [{ ...item, durum: 'siparis', version: 2 }], settings: [] }); });
    expect(within(screen.getByTestId('item-detail')).getByLabelText('Not')).toHaveValue('Benim notum');
    expect(within(screen.getByTestId('item-detail')).getByLabelText(/^Ad\b/)).toHaveValue(item.ad);
  });
});

describe('Tur 3 kapanış: alan sahipliği — yalnız kullanıcının değiştirdiği alanlar yazılır, aynı alan çakışması görünür çözülür', () => {
  const base: Item = { id: 'A', tip: 'satinalma', ad: 'Salon koltuğu', faz: '1', durum: 'karar', version: 1 };
  const open = async (record: Item) => {
    setState({ hydrated: true, status: 'synced' });
    applyRead({ ok: true, fingerprint: 'f', serverTime: 't', schemaVersion: 1, items: [record], settings: [] });
    const loc = memoryLocation({ path: '/satinalma/A', static: false, record: true });
    render(<Router hook={loc.hook}><Route path="/satinalma" nest><PurchaseList /></Route></Router>);
    return screen.findByTestId('item-detail');
  };
  const refresh = (record: Item) => act(() => { applyRead({ ok: true, fingerprint: 'g', serverTime: 't2', schemaVersion: 1, items: [record], settings: [] }); });
  beforeEach(() => { localStorage.clear(); vi.mocked(upsert).mockClear(); });

  it('yalnız Not değişince, sunucuda değişen durum ve hiç kaydedilmemiş varsayılanlar (öncelik, adet, birim) yazılmaz', async () => {
    const form = await open(base);
    await userEvent.type(within(form).getByLabelText('Not'), 'Benim notum');
    refresh({ ...base, durum: 'siparis', version: 2 });
    await userEvent.click(within(form).getByRole('button', { name: 'Kaydet' }));
    expect(vi.mocked(upsert).mock.calls.at(-1)![2]).toEqual({ tip: 'satinalma', not: 'Benim notum' });
  });

  it('aynı alanı sunucu da değiştirdiyse sessizce ezmez: yazmaz, taslağı korur ve çakışmayı alan etiketiyle gösterir', async () => {
    const form = await open({ ...base, not: 'İlk not' });
    await userEvent.clear(within(form).getByLabelText('Not'));
    await userEvent.type(within(form).getByLabelText('Not'), 'Benim notum');
    refresh({ ...base, not: 'Sunucudaki yeni not', version: 2 });
    await userEvent.click(within(form).getByRole('button', { name: 'Kaydet' }));
    expect(upsert).not.toHaveBeenCalled();
    expect(within(form).getByLabelText('Not')).toHaveValue('Benim notum');
    const conflict = within(form).getByRole('alert');
    expect(conflict).toHaveTextContent('Not');
    expect(conflict).toHaveTextContent('Benim notum');
    expect(conflict).toHaveTextContent('Sunucudaki yeni not');
    expect(conflict).not.toHaveTextContent(/\bnot:/);
  });

  it('çakışmada "Benim değerim kalsın" bilerek yazar; "Sheets\'teki kalsın" alanı sunucu değerine alır ve yazmaz', async () => {
    const form = await open({ ...base, not: 'İlk not' });
    await userEvent.clear(within(form).getByLabelText('Not'));
    await userEvent.type(within(form).getByLabelText('Not'), 'Benim notum');
    refresh({ ...base, not: 'Sunucudaki yeni not', version: 2 });
    await userEvent.click(within(form).getByRole('button', { name: 'Kaydet' }));
    await userEvent.click(within(within(form).getByRole('alert')).getByRole('button', { name: "Sheets'teki kalsın" }));
    expect(within(form).getByLabelText('Not')).toHaveValue('Sunucudaki yeni not');
    expect(within(form).queryByRole('alert')).not.toBeInTheDocument();
    await userEvent.clear(within(form).getByLabelText('Not'));
    await userEvent.type(within(form).getByLabelText('Not'), 'Son notum');
    await userEvent.click(within(form).getByRole('button', { name: 'Kaydet' }));
    expect(vi.mocked(upsert).mock.calls.at(-1)![2]).toEqual({ tip: 'satinalma', not: 'Son notum' });
  });

  it('çakışmada "Benim değerim kalsın" seçilince aynı Kaydet yalnız o alanı yazar', async () => {
    const form = await open({ ...base, not: 'İlk not' });
    await userEvent.clear(within(form).getByLabelText('Not'));
    await userEvent.type(within(form).getByLabelText('Not'), 'Benim notum');
    refresh({ ...base, not: 'Sunucudaki yeni not', durum: 'siparis', version: 2 });
    await userEvent.click(within(form).getByRole('button', { name: 'Kaydet' }));
    await userEvent.click(within(within(form).getByRole('alert')).getByRole('button', { name: 'Benim değerim kalsın' }));
    await userEvent.click(within(form).getByRole('button', { name: 'Kaydet' }));
    expect(vi.mocked(upsert).mock.calls.at(-1)![2]).toEqual({ tip: 'satinalma', not: 'Benim notum' });
  });
});

// Post-implementation coverage of ownedPatch (RED for the behaviour was executed through the form tests above).
describe('ownedPatch', () => {
  const stored: Item = { id: 'A', tip: 'satinalma', ad: 'Salon koltuğu', faz: '1', durum: 'karar', tahmini_tl_min: 100, tahmini_tl_max: 100, fiyat_guven: 'tahmini' };
  it('writes derived price fields only when their source is the user\'s, and drops results equal to the latest record', () => {
    const form = (v: Partial<Item>) => ({ ad: v.ad ?? '', oda: v.oda, kategori: v.kategori, faz: v.faz ?? '1', durum: v.durum, karar_bekliyor: false, oncelik: 2, adet: 1, birim: 'adet', tahmini_tl_min: v.tahmini_tl_min ?? null, tahmini_tl_max: v.tahmini_tl_max ?? null, gercek_tl: v.gercek_tl ?? null, fiyat_guven: v.fiyat_guven, nereden: '', siparis_son_tarih: null, teslim_suresi_gun: null, teslim_tarihi: null, linkler: [], not: '', mevcut: false } as Parameters<typeof ownedPatch>[0]);
    const open = form(stored);
    expect(ownedPatch(open, { ...open, tahmini_tl_min: 200, tahmini_tl_max: 200 }, stored).patch).toEqual({ tip: 'satinalma', tahmini_tl_min: 200, tahmini_tl_max: 200 });
    // A trimmed name that equals the latest record is a no-op.
    expect(ownedPatch(open, { ...open, ad: ' Salon koltuğu ' }, stored).patch).toEqual({ tip: 'satinalma' });
    // Clearing a price is unknown (null), not zero.
    expect(ownedPatch(open, { ...open, tahmini_tl_min: null, tahmini_tl_max: null }, stored).patch).toMatchObject({ tahmini_tl_min: null, tahmini_tl_max: null });
  });
});
