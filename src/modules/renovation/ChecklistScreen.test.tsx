import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, userEvent, within } from '@/test-utils/render';
import { Router, Route } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { applyRead, resetStore, setState } from '@/sync/store';
import { upsert } from '@/sync/controller';
import { RenovationModule } from './index';
import { readFull } from './testData';

vi.mock('@/sync/controller', () => ({ upsert: vi.fn(), remove: vi.fn(), restore: vi.fn() }));

function mount(path = '/tadilat/kontrol') {
  const { hook } = memoryLocation({ path, static: false });
  return render(<Router hook={hook}><Route path="/tadilat" nest><RenovationModule /></Route></Router>);
}

beforeEach(() => { resetStore(); vi.mocked(upsert).mockClear(); setState({ hydrated: true, status: 'synced' }); });

describe('Kontrol', () => {
  it('dört grup, ilerleme ve meslek alt grupları', () => {
    applyRead(readFull());
    mount();
    for (const t of ['Şartname', 'Kabul testi', 'Yazılı izin', 'Ev seçimi']) expect(screen.getByRole('button', { name: new RegExp(t) })).toBeInTheDocument();
    expect(screen.getByTestId('progress-sartname')).toHaveTextContent('1/3');
    const panel = screen.getByTestId('group-sartname');
    expect(within(panel).getByText('Elektrik')).toBeInTheDocument();
    expect(within(panel).getByText('Boya')).toBeInTheDocument();
    expect(within(panel).getByText(/< 4 ohm/)).toBeInTheDocument();
    expect(within(panel).getAllByRole('button', { name: 'Metni kopyala' })).toHaveLength(2);
  });
  it('madde işaretlenince tamam upsert', async () => {
    applyRead(readFull());
    mount();
    const row = screen.getByRole('checkbox', { name: /Kaçak akım rölesi/ });
    expect(row).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(row);
    expect(upsert).toHaveBeenCalledWith('kalemler', 'k2', { tamam: true });
    await userEvent.click(screen.getByRole('checkbox', { name: /Topraklama direnci/ }));
    expect(upsert).toHaveBeenCalledWith('kalemler', 'k1', { tamam: false });
  });
  it('kabul maddesinde ölçüm değeri girilince upsert', async () => {
    applyRead(readFull());
    mount();
    await userEvent.click(screen.getByRole('button', { name: /Kabul testi/ }));
    const input = await screen.findByLabelText(/Ölçüm.*Priz gerilimi/);
    await userEvent.type(input, '230');
    await userEvent.tab();
    expect(upsert).toHaveBeenCalledWith('kalemler', 'k4', { olcum_deger: 230 });
  });
});
