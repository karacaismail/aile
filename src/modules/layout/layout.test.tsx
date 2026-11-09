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
  it('kayıt dili: tek renkli etiket köpek erişimidir; duvar kalanları etiketli düz metin, taşma simgeli dikkat cümlesi (Tur 5)', () => {
    mount('/yerlesim');
    const salon = screen.getAllByTestId('room-card').find((c) => within(c).queryByText('Salon'))!;
    expect(salon.querySelectorAll('.mantine-Badge-root')).toHaveLength(1);
    expect(within(salon).getByText('K −20').closest('.record-meta')).toHaveTextContent('Duvarda kalan (cm)');
    const over = within(salon).getByText('Kuzey duvarı 20 cm taşıyor').closest('li')!;
    expect(over.closest('.record-attention')).not.toBeNull();
    expect(over).toHaveAttribute('data-tone', 'danger');
    expect(over.querySelector('svg')).not.toBeNull();
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
    await userEvent.click(within(form).getByRole('combobox', { name: 'Köpek erişimi' }));
    await userEvent.click(screen.getByRole('option', { name: 'Kapalı' }));
    await userEvent.click(within(form).getByRole('button', { name: 'Ölçüleri kaydet' }));
    expect(upsert).toHaveBeenCalledWith('ayarlar', undefined, { tip: 'oda', anahtar: 'cocuk', deger: JSON.stringify({ en_cm: 280, boy_cm: 350, kopek_erisim: 'kapali' }) });
  });
  it('oda ölçü formu var olan ayarı günceller', async () => {
    mount('/yerlesim/salon');
    // Ölçüleri olan odada form özetin "Ölçüleri düzenle" eyleminin arkasındadır (değerler özet metninde görünür).
    await userEvent.click(screen.getByRole('button', { name: 'Ölçüleri düzenle' }));
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
  it('değişiklik yoksa Kaydet Sheets\'e yazmaz ve formu kapatır (boş alanlar null ile silinmez: toItemPatch testi)', async () => {
    const { history } = mount('/yerlesim/salon/L2');
    await userEvent.click(within(screen.getByTestId('layout-item-form')).getByRole('button', { name: 'Kaydet' }));
    expect(upsert).not.toHaveBeenCalled();
    expect(history.at(-1)).toBe('/yerlesim/salon');
  });
  it('yeni kalemde boş Ad ile Kaydet: yazmaz, odak Ad alanına döner, hata sayısı duyurulur', async () => {
    mount('/yerlesim/salon/yeni');
    const form = await screen.findByTestId('layout-item-form');
    await userEvent.click(within(form).getByLabelText('Not'));
    await userEvent.click(within(form).getByRole('button', { name: 'Kaydet' }));
    expect(upsert).not.toHaveBeenCalled();
    expect(within(form).getByLabelText(/^Ad\b/)).toHaveFocus();
    expect(within(form).getByRole('status')).toHaveTextContent('1 alan düzeltilmeli');
  });
});

// Arka plan okuması: aynı kayıt kimlikleri, sunucuda değişen değerler (bekleyen yazım yok).
function serverRead(next: { items?: Item[]; settings?: Setting[] }) {
  applyRead({ ok: true, fingerprint: 'f-next', serverTime: 't2', schemaVersion: 1, items: next.items ?? items, settings: next.settings ?? settings });
}
const salonWith = (patch: Record<string, unknown>): Setting[] => settings.map((s) => (s.id === 'S1' ? { ...s, deger: JSON.stringify({ en_cm: 320, boy_cm: 450, yuk_cm: 270, kopek_erisim: 'gece_kapali', ...patch }) } : s));
const lastDeger = () => JSON.parse((vi.mocked(upsert).mock.calls.at(-1)![2] as { deger: string }).deger);

describe('Oda ölçüleri: özet, kaynak okuması ve alan sahipliği (Tur 5)', () => {
  it('ölçüleri olan odada önce özet: her değer metin olarak görünür, form "Ölçüleri düzenle" ile aynı yerde açılır', async () => {
    mount('/yerlesim/salon');
    const summary = screen.getByTestId('room-dims-summary');
    expect(within(summary).getByText('320 cm')).toBeInTheDocument();
    expect(within(summary).getByText('450 cm')).toBeInTheDocument();
    expect(within(summary).getByText('270 cm')).toBeInTheDocument();
    expect(within(summary).getByText('Gece kapalı')).toBeInTheDocument();
    expect(within(summary).getByText('Kuzey/Güney duvarı = en, Doğu/Batı duvarı = boy.')).toBeInTheDocument();
    expect(screen.queryByTestId('room-dims-form')).not.toBeInTheDocument();
    await userEvent.click(within(summary).getByRole('button', { name: 'Ölçüleri düzenle' }));
    expect(within(screen.getByTestId('room-dims-form')).getByLabelText('En (cm)')).toHaveValue('320');
  });
  it('ilk kaynak okuması gelmeden düzenleme kapalıdır ve yükleniyor durumu duyurulur', () => {
    resetStore();
    setState({ hydrated: true, status: 'loading' });
    const { hook } = memoryLocation({ path: '/yerlesim/salon', static: false });
    render(<Router hook={hook}><Route path="/yerlesim" nest><LayoutModule /></Route></Router>);
    const summary = screen.getByTestId('room-dims-summary');
    expect(within(summary).getByRole('status')).toHaveTextContent('Ölçüler okunuyor');
    expect(within(summary).getByRole('button', { name: 'Ölçüleri düzenle' })).toBeDisabled();
    expect(screen.queryByTestId('room-dims-form')).not.toBeInTheDocument();
  });
  it('düzenlerken aynı ayarın arka plan güncellemesi formu yeniden kurmaz; kayıt yalnız düzenlenen ölçüyü yazar, sunucudaki boyu korur', async () => {
    mount('/yerlesim/salon');
    await userEvent.click(screen.getByRole('button', { name: 'Ölçüleri düzenle' }));
    const form = screen.getByTestId('room-dims-form');
    await userEvent.clear(within(form).getByLabelText('En (cm)'));
    await userEvent.type(within(form).getByLabelText('En (cm)'), '777');
    serverRead({ settings: salonWith({ boy_cm: 999 }) });
    expect(within(screen.getByTestId('room-dims-form')).getByLabelText('En (cm)')).toHaveValue('777');
    await userEvent.click(within(screen.getByTestId('room-dims-form')).getByRole('button', { name: 'Ölçüleri kaydet' }));
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(vi.mocked(upsert).mock.calls[0][1]).toBe('S1');
    expect(lastDeger()).toEqual({ en_cm: 777, boy_cm: 999, yuk_cm: 270, kopek_erisim: 'gece_kapali' });
  });
  it('dokunulmayan köpek erişimi sunucuda değişirse geri yazılmaz', async () => {
    mount('/yerlesim/salon');
    await userEvent.click(screen.getByRole('button', { name: 'Ölçüleri düzenle' }));
    const form = screen.getByTestId('room-dims-form');
    await userEvent.clear(within(form).getByLabelText('Yükseklik (cm)'));
    await userEvent.type(within(form).getByLabelText('Yükseklik (cm)'), '260');
    serverRead({ settings: salonWith({ kopek_erisim: 'kapali' }) });
    await userEvent.click(within(form).getByRole('button', { name: 'Ölçüleri kaydet' }));
    expect(lastDeger()).toEqual({ en_cm: 320, boy_cm: 450, yuk_cm: 260, kopek_erisim: 'kapali' });
  });
  it('aynı ölçü sunucuda da değiştiyse yazılmaz: DraftConflict iki değeri gösterir, seçimden sonra yazılır', async () => {
    mount('/yerlesim/salon');
    await userEvent.click(screen.getByRole('button', { name: 'Ölçüleri düzenle' }));
    const form = screen.getByTestId('room-dims-form');
    await userEvent.clear(within(form).getByLabelText('En (cm)'));
    await userEvent.type(within(form).getByLabelText('En (cm)'), '777');
    serverRead({ settings: salonWith({ en_cm: 330 }) });
    await userEvent.click(within(form).getByRole('button', { name: 'Ölçüleri kaydet' }));
    expect(upsert).not.toHaveBeenCalled();
    const alert = within(form).getByRole('alert');
    expect(alert).toHaveTextContent('En');
    expect(alert).toHaveTextContent('777');
    expect(alert).toHaveTextContent('330');
    expect(within(form).getByLabelText('En (cm)')).toHaveValue('777');
    await userEvent.click(within(alert).getByRole('button', { name: 'Benim değerim kalsın' }));
    await userEvent.click(within(form).getByRole('button', { name: 'Ölçüleri kaydet' }));
    expect(lastDeger()).toEqual({ en_cm: 777, boy_cm: 450, yuk_cm: 270, kopek_erisim: 'gece_kapali' });
  });
  it('"Sheets\'teki kalsın" formu sunucu değerine getirir; değişiklik kalmadıysa yazmadan özete döner', async () => {
    mount('/yerlesim/salon');
    await userEvent.click(screen.getByRole('button', { name: 'Ölçüleri düzenle' }));
    const form = screen.getByTestId('room-dims-form');
    await userEvent.clear(within(form).getByLabelText('En (cm)'));
    await userEvent.type(within(form).getByLabelText('En (cm)'), '777');
    serverRead({ settings: salonWith({ en_cm: 330 }) });
    await userEvent.click(within(form).getByRole('button', { name: 'Ölçüleri kaydet' }));
    await userEvent.click(within(within(form).getByRole('alert')).getByRole('button', { name: "Sheets'teki kalsın" }));
    expect(within(form).getByLabelText('En (cm)')).toHaveValue('330');
    await userEvent.click(within(form).getByRole('button', { name: 'Ölçüleri kaydet' }));
    expect(upsert).not.toHaveBeenCalled();
    expect(screen.queryByTestId('room-dims-form')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('room-dims-summary')).getByText('330 cm')).toBeInTheDocument();
  });
  it('form yeni ayar için açıldıktan sonra ayar başka yerden gelirse aynı kimliği günceller (yeni kimlik yok)', async () => {
    mount('/yerlesim/cocuk');
    const form = screen.getByTestId('room-dims-form');
    await userEvent.type(within(form).getByLabelText('En (cm)'), '280');
    serverRead({ settings: [...settings, { id: 'S9', tip: 'oda', anahtar: 'cocuk', deger: JSON.stringify({ boy_cm: 350 }) }] });
    await userEvent.click(within(screen.getByTestId('room-dims-form')).getByRole('button', { name: 'Ölçüleri kaydet' }));
    expect(vi.mocked(upsert).mock.calls[0][1]).toBe('S9');
    expect(lastDeger()).toEqual({ en_cm: 280, boy_cm: 350 });
  });
  // Review finding (RED first): an untouched field of an open form follows the latest source, as the checklist does.
  it('açık formda dokunulmamış alan sonradan gelen kaynak değerini gösterir; düzenlenen alan korunur', async () => {
    mount('/yerlesim/cocuk');
    const form = screen.getByTestId('room-dims-form');
    await userEvent.type(within(form).getByLabelText('En (cm)'), '280');
    serverRead({ settings: [...settings, { id: 'S9', tip: 'oda', anahtar: 'cocuk', deger: JSON.stringify({ en_cm: 260, boy_cm: 350 }) }] });
    const fresh = screen.getByTestId('room-dims-form');
    await vi.waitFor(() => expect(within(fresh).getByLabelText('Boy (cm)')).toHaveValue('350'));
    expect(within(fresh).getByLabelText('En (cm)')).toHaveValue('280');
  });
});

describe('ItemForm alan sahipliği (Tur 5)', () => {
  const withL1 = (patch: Partial<Item>) => items.map((i) => (i.id === 'L1' ? { ...i, ...patch } : i));
  it('dokunulmayan alan sunucuda değişirse korunur: yalnız düzenlenen alan yazılır', async () => {
    mount('/yerlesim/salon/L1');
    const form = screen.getByTestId('layout-item-form');
    await userEvent.type(within(form).getByLabelText('Işık ihtiyacı'), 'okuma lambası');
    serverRead({ items: withL1({ en_cm: 230, not: 'sunucu notu' }) });
    await userEvent.click(within(form).getByRole('button', { name: 'Kaydet' }));
    expect(upsert).toHaveBeenCalledWith('kalemler', 'L1', { tip: 'yerlesim', isik_ihtiyaci: 'okuma lambası' });
  });
  it('aynı alan sunucuda da değiştiyse yazılmaz: DraftConflict; "Sheets\'teki kalsın" alanı sunucu değerine getirir', async () => {
    mount('/yerlesim/salon/L1');
    const form = screen.getByTestId('layout-item-form');
    await userEvent.clear(within(form).getByLabelText(/^Ad/));
    await userEvent.type(within(form).getByLabelText(/^Ad/), 'Köşe koltuk');
    serverRead({ items: withL1({ ad: 'Üçlü koltuk (gri)' }) });
    await userEvent.click(within(form).getByRole('button', { name: 'Kaydet' }));
    expect(upsert).not.toHaveBeenCalled();
    const alert = within(form).getByRole('alert');
    expect(alert).toHaveTextContent('Ad');
    expect(alert).toHaveTextContent('Köşe koltuk');
    expect(alert).toHaveTextContent('Üçlü koltuk (gri)');
    await userEvent.click(within(alert).getByRole('button', { name: "Sheets'teki kalsın" }));
    expect(within(form).getByLabelText(/^Ad/)).toHaveValue('Üçlü koltuk (gri)');
    await userEvent.click(within(form).getByRole('button', { name: 'Kaydet' }));
    expect(upsert).not.toHaveBeenCalled();
  });
  it('"Benim değerim kalsın" sonrası yalnız o alan yazılır', async () => {
    mount('/yerlesim/salon/L1');
    const form = screen.getByTestId('layout-item-form');
    await userEvent.clear(within(form).getByLabelText('En (cm)'));
    await userEvent.type(within(form).getByLabelText('En (cm)'), '210');
    serverRead({ items: withL1({ en_cm: 230 }) });
    await userEvent.click(within(form).getByRole('button', { name: 'Kaydet' }));
    expect(upsert).not.toHaveBeenCalled();
    await userEvent.click(within(within(form).getByRole('alert')).getByRole('button', { name: 'Benim değerim kalsın' }));
    await userEvent.click(within(form).getByRole('button', { name: 'Kaydet' }));
    expect(upsert).toHaveBeenCalledWith('kalemler', 'L1', { tip: 'yerlesim', en_cm: 210 });
  });
  it('yalnız boşluk değişikliği yazmaz ve formu kapatır', async () => {
    const { history } = mount('/yerlesim/salon/L2');
    const form = screen.getByTestId('layout-item-form');
    await userEvent.type(within(form).getByLabelText(/^Ad/), '  ');
    await userEvent.type(within(form).getByLabelText('Işık ihtiyacı'), ' ');
    await userEvent.click(within(form).getByRole('button', { name: 'Kaydet' }));
    expect(upsert).not.toHaveBeenCalled();
    expect(history.at(-1)).toBe('/yerlesim/salon');
  });
  it('bagli_idler tek değerdir: dokunulmadıysa sunucudaki liste geri yazılmaz', async () => {
    mount('/yerlesim/salon/L1');
    const form = screen.getByTestId('layout-item-form');
    await userEvent.type(within(form).getByLabelText('Işık ihtiyacı'), 'okuma lambası');
    serverRead({ items: withL1({ bagli_idler: ['P2'] }) });
    await userEvent.click(within(form).getByRole('button', { name: 'Kaydet' }));
    expect(upsert).toHaveBeenCalledWith('kalemler', 'L1', { tip: 'yerlesim', isik_ihtiyaci: 'okuma lambası' });
  });
  it('bagli_idler iki tarafta da değiştiyse sıra birleştirmesi yapılmaz: çakışma gösterilir', async () => {
    mount('/yerlesim/salon/L1');
    const form = screen.getByTestId('layout-item-form');
    await userEvent.click(within(form).getByRole('checkbox', { name: /Kablo kanalı/ }));
    serverRead({ items: withL1({ bagli_idler: ['P2'] }) });
    await userEvent.click(within(form).getByRole('button', { name: 'Kaydet' }));
    expect(upsert).not.toHaveBeenCalled();
    const alert = within(form).getByRole('alert');
    expect(alert).toHaveTextContent('Bağlı satınalma kalemleri');
    expect(alert).toHaveTextContent('Kablo kanalı — Salon');
    expect(alert).toHaveTextContent('Örnek sehpa');
  });
});

describe('Oda sayfası kayıt dili (Tur 5)', () => {
  it('kalem kartı: ad kimliktir, ölçü tek olgu olarak görünür ("Ölçüler" etiketi tekrarlanmaz); priz/kanal/ışık düz metin', () => {
    mount('/yerlesim/salon');
    const card = within(screen.getByTestId('wall-K')).getAllByTestId('layout-item-card')[1];
    expect(within(card).getByRole('heading', { name: 'Kitaplık' })).toBeInTheDocument();
    expect(within(card).queryByText('Ölçüler')).not.toBeInTheDocument();
    expect(within(card).getByText('120 cm')).toBeInTheDocument();
    expect(card.querySelector('.mantine-Badge-root')).toBeNull();
    expect(within(card).getByText('1,5 m kanal').closest('.record-meta')).not.toBeNull();
    expect(within(card).getByText('raf aydınlatması').closest('.record-meta')).not.toBeNull();
  });
  it('duvar başlığı: ad başlıktır; uzunluk ve kalan/taşma metindir, taşma simgeli dikkat cümlesidir', () => {
    mount('/yerlesim/salon');
    const k = screen.getByTestId('wall-K');
    expect(within(k).getByRole('heading', { level: 3, name: 'Kuzey duvarı' })).toBeInTheDocument();
    expect(within(k).getByText('320 cm')).toBeInTheDocument();
    const over = within(k).getByText('20 cm taşıyor').closest('li')!;
    expect(over.closest('.record-attention')).not.toBeNull();
    expect(over).toHaveAttribute('data-tone', 'danger');
    expect(over.querySelector('svg')).not.toBeNull();
    expect(k.querySelector('.mantine-Badge-root')).toBeNull();
  });
  it('ihtiyaç haritası: öneri açıklaması düğmeden önce okunur', () => {
    mount('/yerlesim/salon');
    const needs = screen.getByTestId('needs-map');
    const note = within(needs).getByText(/Panjurlu priz/);
    const button = within(needs).getByRole('button', { name: 'Satınalma satırı öner' });
    expect(note.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
