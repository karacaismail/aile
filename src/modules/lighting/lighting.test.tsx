import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, userEvent, within } from '@/test-utils/render';
import { Router, Route } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import type { Item, Setting } from '@shared/schema';
import { applyRead, resetStore, setState } from '@/sync/store';
import { upsert } from '@/sync/controller';
import { LightingModule } from './index';
import { ROOMS } from './data';

vi.mock('@/sync/controller', () => ({ upsert: vi.fn(() => 'NEWID'), remove: vi.fn(), restore: vi.fn() }));

const items: Item[] = [
  { id: 'L1', tip: 'aydinlatma', ad: 'Salon ana', oda: 'salon', katman_tur: 'ana', katman_ad: 'Tavan', lux_min: 150, cct_min: 2700, cct_max: 4000, kontrol_cihaz: 'hue_dimmer', adim: 'elektrik', tahmini_tl_min: 1000, tahmini_tl_max: 1500, bagli_idler: ['P1'] },
  { id: 'L2', tip: 'aydinlatma', ad: 'Salon gece', oda: 'salon', katman_tur: 'gece', cct_min: 2200, adim: 'akilli' },
  { id: 'S1', tip: 'sahne', ad: 'Akşam filmi', oda: 'salon', tetik: 'dugme', seviyeler: ['L1:40:2700', 'L2::'] },
  { id: 'P1', tip: 'satinalma', ad: 'Şerit LED', oda: 'salon', siparis_son_tarih: '2099-01-10', durum: 'karar' },
];
const settings: Setting[] = [{ id: 'S-oda', tip: 'oda', anahtar: 'salon', deger: JSON.stringify({ kopek_erisim: 'serbest' }) }];

function mount(path: string, data: Item[] = items) {
  setState({ hydrated: true, status: 'synced' });
  applyRead({ ok: true, fingerprint: 'f', serverTime: 't', schemaVersion: 1, items: data, settings });
  const loc = memoryLocation({ path, static: false, record: true });
  render(<Router hook={loc.hook}><Route path="/aydinlatma" nest><LightingModule /></Route></Router>);
  return loc;
}

beforeEach(() => { resetStore(); localStorage.clear(); vi.mocked(upsert).mockClear(); });

describe('LightingModule', () => {
  it('Odalar sekmesi: her oda için kart; boşsa EmptyState ve temel katman oluşturma', async () => {
    mount('/aydinlatma', []);
    expect(screen.getByTestId('lighting-tabs')).toBeInTheDocument();
    expect(screen.getAllByTestId('room-card')).toHaveLength(ROOMS.length);
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('combobox', { name: 'Oda' }));
    await userEvent.click(screen.getByRole('option', { name: 'Çocuk odası' }));
    await userEvent.click(screen.getByRole('button', { name: 'Oda katmanlarını oluştur' }));
    expect(upsert).toHaveBeenCalledTimes(3);
    expect(vi.mocked(upsert).mock.calls.map((c) => (c[2] as { katman_tur: string }).katman_tur)).toEqual(['ana', 'gorev', 'gece']);
    expect(vi.mocked(upsert).mock.calls[0][2]).toMatchObject({ tip: 'aydinlatma', oda: 'cocuk', ad: 'Çocuk odası Ana', adim: 'kesif' });
  });
  it('veri varken EmptyState yok; salon kartı 2 katman, gece rozeti ve görev eksik', () => {
    mount('/aydinlatma');
    expect(screen.queryByTestId('empty-state')).not.toBeInTheDocument();
    const salon = screen.getAllByTestId('room-card').find((c) => c.getAttribute('data-oda') === 'salon')!;
    expect(within(salon).getByText('2 katman')).toBeInTheDocument();
    expect(within(salon).getByText('gece')).toBeInTheDocument();
    expect(within(salon).getByText('görev yok')).toBeInTheDocument();
  });
  it('Oda sayfası: başlık, köpek rozeti, katman kartları, bağlı ürün sayısı ve eksik katman düğmesi', () => {
    mount('/aydinlatma/salon');
    expect(within(screen.getByTestId('room-header')).getByText('Salon')).toBeInTheDocument();
    expect(screen.getByTestId('dog-badge')).toHaveTextContent('köpek serbest');
    expect(screen.getAllByTestId('layer-card')).toHaveLength(2);
    expect(screen.getByText('1 ürün')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Eksik temel katmanları oluştur/ })).toBeInTheDocument();
  });
  it('Oda sayfası + katman kimliği form modalını açar', () => {
    mount('/aydinlatma/salon/L1');
    expect(screen.getByTestId('layer-form')).toBeInTheDocument();
    expect(screen.getByLabelText('Katman adı')).toHaveValue('Tavan');
  });
  it('geçersiz oda uyarı verir', () => {
    mount('/aydinlatma/bilinmeyen');
    expect(screen.getByText('Oda bulunamadı')).toBeInTheDocument();
  });
  it('Sahneler sekmesi: sahne kartı seviyeleri katman adıyla gösterir', async () => {
    mount('/aydinlatma');
    await userEvent.click(screen.getByText('Sahneler'));
    const card = await screen.findByTestId('scene-card');
    expect(within(card).getByText('Akşam filmi')).toBeInTheDocument();
    expect(within(card).getByText('Düğme')).toBeInTheDocument();
    expect(within(card).getAllByTestId('scene-level').map((e) => e.textContent)).toEqual(['Salon · Tavan · %40 · 2700 K', 'Salon · Salon gece · — · —']);
  });
  it('Sahne formu: ad ve katman zorunlu; seviye satırı ekleyip kaydeder', async () => {
    mount('/aydinlatma/sahne/yeni');
    expect(screen.getByTestId('scene-form')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Seviye ekle' }));
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    expect(await screen.findByText('Ad gerekli')).toBeInTheDocument();
    expect(await screen.findByText('Katman seçin')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/^Ad/), 'Gece modu');
    await userEvent.click(screen.getByRole('combobox', { name: 'Katman 1' }));
    await userEvent.click(screen.getByRole('option', { name: 'Salon · Salon gece' }));
    await userEvent.type(screen.getByLabelText('Parlaklık %'), '10');
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    expect(upsert).toHaveBeenCalledWith('kalemler', undefined, expect.objectContaining({ tip: 'sahne', ad: 'Gece modu', seviyeler: ['L2:10:'] }));
  });
  it('Yol haritası: toplam tahmini ve adım içerikleri', async () => {
    mount('/aydinlatma');
    await userEvent.click(screen.getByText('Yol haritası'));
    expect(await screen.findByTestId('roadmap-total')).toHaveTextContent('₺1.000–1.500');
    expect(within(screen.getByTestId('step-elektrik')).getByText('Salon · Tavan')).toBeInTheDocument();
    expect(within(screen.getByTestId('step-elektrik')).getByText(/Şerit LED/)).toBeInTheDocument();
    expect(within(screen.getByTestId('step-akilli')).getByText('Salon · Salon gece')).toBeInTheDocument();
  });
});
