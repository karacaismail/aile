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
