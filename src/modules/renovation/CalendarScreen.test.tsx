import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, userEvent, within } from '@/test-utils/render';
import { Router, Route } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { applyRead, resetStore, setState } from '@/sync/store';
import { upsert } from '@/sync/controller';
import { RenovationModule } from './index';
import { readFull } from './testData';

vi.mock('@/sync/controller', () => ({ upsert: vi.fn(), remove: vi.fn(), restore: vi.fn() }));

function mount(path = '/tadilat') {
  const { hook } = memoryLocation({ path, static: false });
  return render(<Router hook={hook}><Route path="/tadilat" nest><RenovationModule /></Route></Router>);
}

beforeEach(() => {
  resetStore(); vi.mocked(upsert).mockClear(); setState({ hydrated: true, status: 'synced' });
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2099, 0, 10, 12, 0)); // 10 Oca 2099 (yalnız Date sahte; userEvent zamanlayıcıları gerçek)
});
afterEach(() => vi.useRealTimers());

describe('Takvim', () => {
  it('sayfa bağlantılarını radyo gibi sunmaz; taşınma sayacı ve yerel senaryo seçiciyi korur', () => {
    applyRead(readFull());
    mount();
    for (const t of ['Takvim', 'İşler', 'Ustalar', 'Kontrol']) expect(screen.queryByRole('radio', { name: t })).not.toBeInTheDocument();
    const strip = screen.getByTestId('countdown');
    expect(strip).toHaveTextContent('Taşınmaya');
    expect(within(strip).getByTestId('countdown-days')).toHaveTextContent('40');
    expect(screen.getByRole('radio', { name: 'A' })).toBeChecked();
  });
  it('taşınma tarihi yoksa "ayarlanmadı" ve Ayarlar bağlantısı', () => {
    applyRead(readFull({ settings: [] }));
    mount();
    expect(screen.getByTestId('countdown')).toHaveTextContent(/ayarlanmadı/);
    expect(screen.getByRole('link', { name: /Ayarlar/ })).toHaveAttribute('href', expect.stringContaining('/ayarlar'));
  });
  it('senaryo filtresi ve değişince ayar upsert', async () => {
    applyRead(readFull());
    mount();
    expect(screen.getByText('Anahtar teslim')).toBeInTheDocument();
    expect(screen.queryByText('Anahtar teslim (B)')).not.toBeInTheDocument();
    expect(screen.getByText('Mobilya siparişi')).toBeInTheDocument();
    expect(screen.getByText('Hedef bitiş')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'B' }));
    expect(upsert).toHaveBeenCalledWith('ayarlar', 's-senaryo', { tip: 'ayar', anahtar: 'senaryo', deger: 'B' });
  });
  it('senaryo ayarı yoksa yeni satır oluşturulur (id undefined)', async () => {
    applyRead(readFull({ settings: [] }));
    mount();
    await userEvent.click(screen.getByRole('radio', { name: 'C' }));
    expect(upsert).toHaveBeenCalledWith('ayarlar', undefined, { tip: 'ayar', anahtar: 'senaryo', deger: 'C' });
  });
  it('Ramazan/Bayram bantları ve bugün işareti satır olmasa da görünür; geçmiş öğe soluk', () => {
    applyRead(readFull());
    mount();
    const tl = screen.getByTestId('timeline');
    expect(within(tl).getByText('Ramazan 2027')).toBeInTheDocument();
    expect(within(tl).getByText('Ramazan Bayramı 2027')).toBeInTheDocument();
    expect(within(tl).getByText('Bugün')).toBeInTheDocument();
    const past = within(tl).getAllByTestId('timeline-entry').filter((e) => e.getAttribute('data-past') === 'true');
    expect(past.length).toBeGreaterThan(0);
  });
  it('öğeye dokununca alt çekmece: not, tarih, bağlı iş düğmesi', async () => {
    applyRead(readFull());
    mount();
    await userEvent.click(screen.getByRole('button', { name: /Mobilya siparişi/ }));
    const drawer = await screen.findByTestId('timeline-drawer');
    expect(drawer).toHaveTextContent('Sipariş notu');
    expect(drawer).toHaveTextContent('5 Oca 2099');
    await userEvent.click(screen.getByRole('button', { name: 'Kapat' }));
    await userEvent.click(screen.getByRole('button', { name: /T1 Elektrik altyapı/ }));
    const d2 = await screen.findByTestId('timeline-drawer');
    expect(within(d2).getByRole('button', { name: 'İşi aç' })).toBeInTheDocument();
  });
});

describe('Takvim: okuma düzeni (Tur 5)', () => {
  const entryNamed = (name: RegExp) => within(screen.getByTestId('timeline')).getByRole('button', { name });
  it('olaylar ay başlıkları altında gruplanır; bugün işareti kendi ayında kalır', () => {
    applyRead(readFull());
    mount();
    const months = within(screen.getByTestId('timeline')).getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(months).toEqual(['Şubat 2027', 'Mart 2027', 'Ocak 2099', 'Mart 2099']);
    const jan = screen.getByRole('region', { name: 'Ocak 2099' });
    expect(within(jan).getByTestId('timeline-today')).toHaveTextContent('Bugün');
    expect(within(jan).getByRole('button', { name: /T1 Elektrik altyapı/ })).toBeInTheDocument();
  });
  it('tür tarihin yanında yazıyla görünür; rozet yoktur', () => {
    applyRead(readFull());
    mount();
    expect(entryNamed(/Anahtar teslim/)).toHaveTextContent('20 Oca 2099 · Kilometre taşı · Senaryo A');
    expect(entryNamed(/T1 Elektrik altyapı/)).toHaveTextContent('İş · Planlandı');
    expect(entryNamed(/Mobilya siparişi/)).toHaveTextContent('Sipariş son günü');
    expect(entryNamed(/Hedef bitiş/)).toHaveTextContent('Hedef');
    expect(entryNamed(/Ramazan 2027/)).toHaveTextContent('Dönem');
    expect(screen.getByTestId('timeline').querySelector('.mantine-Badge-root')).toBeNull();
  });
  it('geçmiş olay soluk ama okunur ve "Geçti" yazar', () => {
    applyRead(readFull());
    mount();
    const past = entryNamed(/Mobilya siparişi/);
    expect(past).toHaveAttribute('data-past', 'true');
    expect(past).toHaveTextContent('Geçti');
  });
  it('sayaç tr-TR binlik ayırıcıyla yazılır', () => {
    applyRead(readFull({ settings: [{ id: 's-tasinma', tip: 'tarih', anahtar: 'tasinma', deger: '2102-01-01' }] }));
    mount();
    expect(screen.getByTestId('countdown-days')).toHaveTextContent(/^1\.086$/);
  });
  it('senaryo seçicisinin anlamı görünür satırda yazar ve seçiciye bağlıdır', () => {
    applyRead(readFull());
    mount();
    const group = screen.getByRole('radiogroup', { name: 'Senaryo' });
    const id = group.getAttribute('aria-describedby');
    expect(id).toBeTruthy();
    const line = document.getElementById(id!)!;
    expect(line).toBeVisible();
    expect(line).toHaveTextContent('A: anahtar ≤ 8 Ocak');
    expect(line).toHaveTextContent(/bu senaryonun ve tüm senaryolara ortak/);
  });
  it('çekmece bilgileri rozet yerine etiketli bilgi listesidir', async () => {
    applyRead(readFull());
    mount();
    await userEvent.click(entryNamed(/T1 Elektrik altyapı/));
    const drawer = await screen.findByTestId('timeline-drawer');
    const facts = within(drawer).getByRole('group', { name: /bilgileri/ });
    expect(within(facts).getByText('Tarih')).toBeInTheDocument();
    expect(within(facts).getByText('15 Oca 2099 – 18 Oca 2099')).toBeInTheDocument();
    expect(within(facts).getByText('Tür')).toBeInTheDocument();
    expect(within(facts).getByText('İş · Planlandı')).toBeInTheDocument();
    expect(within(facts).getByText('İşi yapan')).toBeInTheDocument();
    expect(within(facts).getByText('Elektrikçi')).toBeInTheDocument();
    expect(drawer.querySelector('.mantine-Badge-root')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Kapat' }));
    await userEvent.click(entryNamed(/Anahtar teslim/));
    const d2 = await screen.findByTestId('timeline-drawer');
    const f2 = within(d2).getByRole('group', { name: /bilgileri/ });
    expect(within(f2).getByText('Senaryo')).toBeInTheDocument();
    expect(within(f2).getByText('A: anahtar ≤ 8 Ocak')).toBeInTheDocument();
  });
  it('takvimden açılan iş kapanınca takvime ve aynı olayın çekmecesine döner (liste değil)', async () => {
    applyRead(readFull());
    mount();
    await userEvent.click(entryNamed(/T1 Elektrik altyapı/));
    await userEvent.click(within(await screen.findByTestId('timeline-drawer')).getByRole('button', { name: 'İşi aç' }));
    const form = await screen.findByTestId('task-detail');
    await userEvent.click(within(form).getByRole('button', { name: 'Vazgeç' }));
    expect(screen.queryByTestId('task-list')).not.toBeInTheDocument();
    expect(screen.getByTestId('timeline')).toBeInTheDocument();
    expect(await screen.findByTestId('timeline-drawer')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveTextContent('T1 Elektrik altyapı');
  });
});
