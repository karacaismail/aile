import { beforeEach, expect, it, vi } from 'vitest';
import { act, render, screen, userEvent, within } from '@/test-utils/render';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { SCHEMA_VERSION, type Item } from '@shared/schema';
import { applyRead, resetStore, setState } from '@/sync/store';
import { upsert } from '@/sync/controller';
import { LayerForm } from './LayerForm';

vi.mock('@/sync/controller', () => ({ upsert: vi.fn(() => 'PARTIAL-LAYER'), remove: vi.fn(), restore: vi.fn() }));

const initial: Item = {
  id: 'PARTIAL-LAYER', tip: 'aydinlatma', ad: 'Sentetik katman', oda: 'salon', katman_tur: 'ana',
  katman_ad: 'Sentetik katman', cct_min: 2700, cct_max: 4000, cri_min: 95, version: 1,
};
const refresh = (record: Item) => act(() => applyRead({
  ok: true, fingerprint: `partial-${record.version}`, serverTime: '2098-01-01T00:00:00Z', schemaVersion: SCHEMA_VERSION,
  items: [record], settings: [{ id: 'PARTIAL-ROOM', tip: 'oda', anahtar: 'salon', deger: JSON.stringify({ kopek_erisim: 'kapali' }) }],
}));
beforeEach(() => { resetStore(); vi.mocked(upsert).mockClear(); setState({ hydrated: true, status: 'synced' }); });

it('moving the lower slider after accepting a remotely cleared upper bound never recreates that upper bound', async () => {
  refresh(initial);
  const loc = memoryLocation({ path: '/aydinlatma/salon/PARTIAL-LAYER', static: false, record: true });
  render(<Router hook={loc.hook}><LayerForm oda="salon" id="PARTIAL-LAYER" /></Router>);
  await userEvent.click(screen.getByLabelText('Not')); // Settle the modal opening focus before moving the thumb.
  const upper = screen.getByRole('slider', { name: 'CCT max' });
  act(() => upper.focus());
  await userEvent.keyboard('{ArrowRight}'.repeat(10));
  expect(screen.getByTestId('cct-value')).toHaveTextContent('2700–5000 K');

  refresh({ ...initial, cct_max: undefined, version: 2 });
  await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
  expect(upsert).not.toHaveBeenCalled();
  const conflict = screen.getByRole('alert');
  expect(conflict).toHaveTextContent('Renk sıcaklığı (üst)');
  await userEvent.click(within(conflict).getByRole('button', { name: "Sheets'teki kalsın" }));

  const lower = screen.getByRole('slider', { name: 'CCT min' });
  act(() => lower.focus());
  expect(lower).toHaveFocus();
  await userEvent.keyboard('{ArrowLeft}'.repeat(3));
  expect(lower).toHaveAttribute('aria-valuenow', '2400');
  await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
  expect(upsert).toHaveBeenCalledExactlyOnceWith('kalemler', 'PARTIAL-LAYER', { tip: 'aydinlatma', cct_min: 2400 });
  expect(vi.mocked(upsert).mock.calls[0][2]).not.toHaveProperty('cct_max');
});
