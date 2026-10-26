import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, userEvent, within } from '@/test-utils/render';
import { Route, Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import type { Item, Setting } from '@shared/schema';
import { applyRead, resetStore, setState } from '@/sync/store';
import { upsert, remove } from '@/sync/controller';
import { LayoutModule } from './index';
import { suggestionKod } from './rules';

vi.mock('@/sync/controller', () => ({ upsert: vi.fn(() => 'NEWID'), remove: vi.fn(), restore: vi.fn(), refresh: vi.fn(), startSync: vi.fn() }));

const items: Item[] = [
  { id: 'L1', tip: 'yerlesim', ad: 'Üçlü koltuk', oda: 'salon', duvar: 'K', en_cm: 220, boy_cm: 90, yuk_cm: 85, priz_ihtiyaci: 1 },
  { id: 'L2', tip: 'yerlesim', ad: 'Kitaplık', oda: 'salon', duvar: 'K', en_cm: 120, isik_ihtiyaci: 'raf aydınlatması', kanal_m: 1.5 },
  { id: 'L3', tip: 'yerlesim', ad: 'TV ünitesi', oda: 'salon', duvar: 'G', en_cm: 180, priz_ihtiyaci: 3, kanal_m: 2.5, mevcut: true },
  { id: 'L4', tip: 'yerlesim', ad: 'Orta sehpa', oda: 'salon', en_cm: 90, boy_cm: 60 },
  { id: 'L5', tip: 'yerlesim', ad: 'Yatak', oda: 'ebeveyn', duvar: 'D', en_cm: 200 },
  { id: 'P1', tip: 'satinalma', ad: 'Kablo kanalı — Salon', kod: suggestionKod('salon', 'kanal'), oda: 'salon', birim: 'm', adet: 1, faz: '1' },
  { id: 'P2', tip: 'satinalma', ad: 'Örnek sehpa', oda: 'salon', faz: '2' },
];
const settings: Setting[] = [
  { id: 'S1', tip: 'oda', anahtar: 'salon', deger: JSON.stringify({ en_cm: 320, boy_cm: 450, yuk_cm: 270, kopek_erisim: 'gece_kapali' }) },
  { id: 'S2', tip: 'oda', anahtar: 'ebeveyn', deger: JSON.stringify({ en_cm: 300, boy_cm: 400 }) },
  { id: 'S3', tip: 'tarih', anahtar: 'tasinma', deger: '2099-02-19' },
];

function mount(path: string, data: { items?: Item[]; settings?: Setting[] } = {}) {
  setState({ hydrated: true, status: 'synced' });
  applyRead({ ok: true, fingerprint: 'f', serverTime: 't', schemaVersion: 1, items: data.items ?? items, settings: data.settings ?? settings });
  const { hook, history } = memoryLocation({ path, static: false, record: true });
  const ui = render(
    <Router hook={hook}>
      <Route path="/yerlesim" nest><LayoutModule /></Route>
    </Router>,
  );
  return { ...ui, history };
}

beforeEach(() => { resetStore(); vi.mocked(upsert).mockClear(); vi.mocked(remove).mockClear(); });

describe('RoomList', () => {
  it('genel hariç tüm odalar; ölçü, kalem sayısı, köpek rozeti ve duvar özeti', () => {
    mount('/yerlesim');
    const cards = screen.getAllByTestId('room-card');
    expect(cards).toHaveLength(10);
    expect(screen.queryByText('Genel')).not.toBeInTheDocument();
    const salon = cards.find((c) => within(c).queryByText('Salon'))!;
    expect(within(salon).getByText('320 × 450 cm')).toBeInTheDocument();
    expect(within(salon).getByText('4 kalem')).toBeInTheDocument();
    expect(within(salon).getByText('Gece kapalı')).toBeInTheDocument();
    expect(within(salon).getByText('K −20')).toBeInTheDocument();
    expect(within(salon).getByText('G 140')).toBeInTheDocument();
    const cocuk = cards.find((c) => within(c).queryByText('Çocuk odası'))!;
    expect(within(cocuk).getByText('ölçü gir')).toBeInTheDocument();
    expect(within(cocuk).getByText('0 kalem')).toBeInTheDocument();
    expect(salon).toHaveAttribute('href', expect.stringContaining('/yerlesim/salon'));
  });
  it('hydrate olmadan iskelet gösterir', () => {
    resetStore();
    setState({ hydrated: false, status: 'loading' });
    const { hook } = memoryLocation({ path: '/yerlesim', static: false });
    render(<Router hook={hook}><Route path="/yerlesim" nest><LayoutModule /></Route></Router>);
    expect(screen.queryAllByTestId('room-card')).toHaveLength(0);
    expect(screen.getByTestId('room-list-skeleton')).toBeInTheDocument();
  });
});

describe('RoomPage', () => {
  it('duvar grupları, kalan/taşma rozetleri, kalem kartları ve ihtiyaç haritası', () => {
    mount('/yerlesim/salon');
    expect(screen.getByRole('heading', { name: 'Salon' })).toBeInTheDocument();
    const k = screen.getByTestId('wall-K');
    expect(within(k).getByText('20 cm taşıyor')).toBeInTheDocument();
    expect(within(k).getAllByTestId('layout-item-card')).toHaveLength(2);
    expect(within(k).getByText('220×90×85 cm')).toBeInTheDocument();
    expect(within(k).getByText('1 priz')).toBeInTheDocument();
    expect(within(k).getByText('raf aydınlatması')).toBeInTheDocument();
    expect(within(k).getByText('1,5 m kanal')).toBeInTheDocument();
    const g = screen.getByTestId('wall-G');
    expect(within(g).getByText('kalan 140 cm')).toBeInTheDocument();
    expect(within(g).getByText('elimizde')).toBeInTheDocument();
    expect(within(screen.getByTestId('wall-D')).getByText('kalan 450 cm')).toBeInTheDocument();
    expect(within(screen.getByTestId('wall-orta')).getByText('Orta sehpa')).toBeInTheDocument();
    const needs = screen.getByTestId('needs-map');
    expect(within(needs).getByTestId('needs-total-priz')).toHaveTextContent('4');
    expect(within(needs).getByTestId('needs-total-kanal')).toHaveTextContent('4');
    expect(within(needs).getByText('raf aydınlatması')).toBeInTheDocument();
    expect(within(k).getAllByTestId('layout-item-card')[0]).toHaveAttribute('href', expect.stringContaining('/yerlesim/salon/L1'));
  });
  it('ölçü yoksa "ölçü yok" ve kalan hesaplanmaz', () => {
    mount('/yerlesim/cocuk');
    expect(within(screen.getByTestId('wall-K')).getByText('ölçü yok')).toBeInTheDocument();
    expect(screen.getAllByText('Kalem yok')).toHaveLength(5);
  });
  it('geçersiz oda uyarı verir', () => {
    mount('/yerlesim/bilinmeyen');
    expect(screen.getByText('Oda bulunamadı')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Odalara dön' })).toBeInTheDocument();
  });
  it('oda ölçü formu ayar satırını upsert eder (yeni satır)', async () => {
    mount('/yerlesim/cocuk');
    const form = screen.getByTestId('room-dims-form');
    await userEvent.type(within(form).getByLabelText('En (cm)'), '280');
    await userEvent.type(within(form).getByLabelText('Boy (cm)'), '350');
    await userEvent.selectOptions(within(form).getByLabelText('Köpek erişimi'), 'kapali');
    await userEvent.click(within(form).getByRole('button', { name: 'Ölçüleri kaydet' }));
    expect(upsert).toHaveBeenCalledWith('ayarlar', undefined, { tip: 'oda', anahtar: 'cocuk', deger: JSON.stringify({ en_cm: 280, boy_cm: 350, kopek_erisim: 'kapali' }) });
  });
  it('oda ölçü formu var olan ayarı günceller', async () => {
    mount('/yerlesim/salon');
    const form = screen.getByTestId('room-dims-form');
    expect(within(form).getByLabelText('En (cm)')).toHaveValue('320');
    await userEvent.clear(within(form).getByLabelText('Yükseklik (cm)'));
    await userEvent.type(within(form).getByLabelText('Yükseklik (cm)'), '260');
    await userEvent.click(within(form).getByRole('button', { name: 'Ölçüleri kaydet' }));
    expect(upsert).toHaveBeenCalledWith('ayarlar', 'S1', { tip: 'oda', anahtar: 'salon', deger: JSON.stringify({ en_cm: 320, boy_cm: 450, yuk_cm: 260, kopek_erisim: 'gece_kapali' }) });
  });
  it('"Satınalma satırı öner": priz yeni, kanal var olanı günceller; ikinci tıklamada yazmaz', async () => {
    mount('/yerlesim/salon');
    await userEvent.click(screen.getByRole('button', { name: 'Satınalma satırı öner' }));
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert).toHaveBeenCalledWith('kalemler', undefined, expect.objectContaining({ tip: 'satinalma', ad: 'Panjurlu priz — Salon', adet: 4, birim: 'adet', kategori: 'elektrik', faz: '1', oda: 'salon' }));
    expect(upsert).toHaveBeenCalledWith('kalemler', 'P1', expect.objectContaining({ adet: 4 }));
    // Mağaza optimistic güncellendi (mock olduğu için elle uygula) → tekrar tıklamada değişiklik yok
    const calls = vi.mocked(upsert).mock.calls;
    const merged = items.map((i) => (i.id === 'P1' ? { ...i, ...(calls[1][2] as object) } : i));
    applyRead({ ok: true, fingerprint: 'f2', serverTime: 't', schemaVersion: 1, items: [...merged, { id: 'NEWID', ...(calls[0][2] as object) } as Item], settings });
    vi.mocked(upsert).mockClear();
    await userEvent.click(screen.getByRole('button', { name: 'Satınalma satırı öner' }));
    expect(upsert).not.toHaveBeenCalled();
  });
  it('ihtiyaç yoksa öneri yazmaz', async () => {
    mount('/yerlesim/ebeveyn');
    await userEvent.click(screen.getByRole('button', { name: 'Satınalma satırı öner' }));
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe('ItemForm', () => {
  it('yeni kalem: ad zorunlu; kaydet → yerlesim patch', async () => {
    const { history } = mount('/yerlesim/salon/yeni');
    const form = screen.getByTestId('layout-item-form');
    await userEvent.click(within(form).getByRole('button', { name: 'Kaydet' }));
    expect(upsert).not.toHaveBeenCalled();
    expect(within(form).getByText('Ad gerekli')).toBeInTheDocument();
    await userEvent.type(within(form).getByLabelText(/^Ad/), 'Yeni dolap');
    await userEvent.click(within(form).getByRole('radio', { name: 'B' }));
    await userEvent.type(within(form).getByLabelText('En (cm)'), '100');
    await userEvent.type(within(form).getByLabelText('Priz ihtiyacı'), '2');
    await userEvent.type(within(form).getByLabelText('Kanal (m)'), '1,5');
    await userEvent.click(within(form).getByLabelText('Elimizde var'));
    await userEvent.click(within(form).getByRole('checkbox', { name: /Örnek sehpa/ }));
    await userEvent.click(within(form).getByRole('button', { name: 'Kaydet' }));
    expect(upsert).toHaveBeenCalledWith('kalemler', undefined, expect.objectContaining({
      tip: 'yerlesim', oda: 'salon', ad: 'Yeni dolap', duvar: 'B', en_cm: 100, priz_ihtiyaci: 2, kanal_m: 1.5, mevcut: true, bagli_idler: ['P2'],
    }));
    expect(history.at(-1)).toBe('/yerlesim/salon');
  });
  it('var olan kalem: alanlar dolu; değişiklik patch; sil → onay → remove', async () => {
    mount('/yerlesim/salon/L1');
    const form = screen.getByTestId('layout-item-form');
    expect(within(form).getByLabelText(/^Ad/)).toHaveValue('Üçlü koltuk');
    expect(within(form).getByRole('radio', { name: 'K' })).toBeChecked();
    expect(within(form).getByLabelText('En (cm)')).toHaveValue('220');
    await userEvent.type(within(form).getByLabelText('Işık ihtiyacı'), 'okuma lambası');
    await userEvent.click(within(form).getByRole('button', { name: 'Kaydet' }));
    expect(upsert).toHaveBeenCalledWith('kalemler', 'L1', { tip: 'yerlesim', isik_ihtiyaci: 'okuma lambası' });
  });
  it('sil onaylanınca remove çağrılır', async () => {
    mount('/yerlesim/salon/L1');
    await userEvent.click(within(screen.getByTestId('layout-item-form')).getByRole('button', { name: 'Sil' }));
    const title = await screen.findByText('Kalemi sil?');
    const dialog = title.closest('[role="dialog"]') as HTMLElement;
    await userEvent.click(within(dialog).getByRole('button', { name: 'Sil' }));
    expect(remove).toHaveBeenCalledWith('kalemler', 'L1');
  });
  it('bulunamayan kalemde uyarı', () => {
    mount('/yerlesim/salon/YOK');
    expect(screen.getByText(/Kalem bulunamadı/)).toBeInTheDocument();
  });
  it('derin bağlantıda kayıt sonradan gelince form dolu açılır (önce iskelet, form kurulmaz)', async () => {
    setState({ hydrated: false, status: 'loading' });
    const { hook } = memoryLocation({ path: '/yerlesim/salon/L1', static: false });
    render(<Router hook={hook}><Route path="/yerlesim" nest><LayoutModule /></Route></Router>);
    expect(screen.getByTestId('layout-item-form-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('layout-item-form')).not.toBeInTheDocument();
    applyRead({ ok: true, fingerprint: 'f', serverTime: 't', schemaVersion: 1, items, settings });
    const form = await screen.findByTestId('layout-item-form');
    expect(within(form).getByLabelText(/^Ad/)).toHaveValue('Üçlü koltuk');
    expect(within(form).getByLabelText('En (cm)')).toHaveValue('220');
    expect(within(form).getByRole('radio', { name: 'K' })).toBeChecked();
  });
  it('değişiklik yoksa kaydet yalnız tip gönderir (boş alanlar null ile silinmez)', async () => {
    mount('/yerlesim/salon/L2');
    await userEvent.click(within(screen.getByTestId('layout-item-form')).getByRole('button', { name: 'Kaydet' }));
    expect(upsert).toHaveBeenCalledWith('kalemler', 'L2', { tip: 'yerlesim' });
  });
});
