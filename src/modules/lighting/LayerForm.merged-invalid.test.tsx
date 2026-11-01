import { beforeEach, expect, it, vi } from 'vitest';
import { act, render, screen, userEvent, within } from '@/test-utils/render';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { SCHEMA_VERSION, type Item } from '@shared/schema';
import { applyRead, resetStore, setState } from '@/sync/store';
import { upsert } from '@/sync/controller';
import { LayerForm } from './LayerForm';

vi.mock('@/sync/controller', () => ({ upsert: vi.fn(() => 'MERGED-LAYER'), remove: vi.fn(), restore: vi.fn() }));

const initial: Item = {
  id: 'MERGED-LAYER', tip: 'aydinlatma', ad: 'Sentetik katman', oda: 'salon', katman_tur: 'ana',
  katman_ad: 'Sentetik katman', cri_min: 95, version: 1,
};
const refresh = (record: Item) => act(() => applyRead({
  ok: true, fingerprint: `merged-${record.version}`, serverTime: '2098-01-01T00:00:00Z', schemaVersion: SCHEMA_VERSION,
  items: [record], settings: [{ id: 'MERGED-ROOM', tip: 'oda', anahtar: 'salon', deger: JSON.stringify({ kopek_erisim: 'kapali' }) }],
}));
function mount() {
  refresh(initial);
  const loc = memoryLocation({ path: '/aydinlatma/salon/MERGED-LAYER', static: false, record: true });
  render(<Router hook={loc.hook}><LayerForm oda="salon" id="MERGED-LAYER" /></Router>);
}
beforeEach(() => { resetStore(); vi.mocked(upsert).mockClear(); setState({ hydrated: true, status: 'synced' }); });

it('blocks an owned CRI change worsening an already-invalid latest layer even when the error message is identical', async () => {
  mount();
  await userEvent.clear(screen.getByLabelText('CRI min'));
  await userEvent.type(screen.getByLabelText('CRI min'), '70'); // Ana has no task-layer CRI floor.
  refresh({ ...initial, katman_tur: 'gorev', cri_min: 80, version: 2 }); // Already invalid: Görev needs at least 90.
  await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
  expect(upsert).not.toHaveBeenCalled();
  // Resolve the same-field conflict explicitly; that is not permission to persist an invalid merged record.
  const conflict = screen.getByRole('alert');
  expect(conflict).toHaveTextContent('CRI min');
  await userEvent.click(within(conflict).getByRole('button', { name: 'Benim değerim kalsın' }));
  await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
  expect(upsert).not.toHaveBeenCalled();
  expect(screen.getByLabelText('CRI min')).toHaveValue('70');
  expect(screen.getByTestId('merged-invalid')).toHaveTextContent('Görev katmanında CRI ≥ 90 olmalı');
});

it('allows an unrelated note edit while leaving the latest invalid CRI and layer type untouched', async () => {
  mount();
  await userEvent.type(screen.getByLabelText('Not'), 'Yeni açıklama');
  refresh({ ...initial, katman_tur: 'gorev', cri_min: 80, version: 2 });
  await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
  expect(upsert).toHaveBeenCalledExactlyOnceWith('kalemler', 'MERGED-LAYER', { tip: 'aydinlatma', not: 'Yeni açıklama' });
  expect({ ...initial, katman_tur: 'gorev', cri_min: 80, ...vi.mocked(upsert).mock.calls[0][2] })
    .toMatchObject({ katman_tur: 'gorev', cri_min: 80, not: 'Yeni açıklama' });
});
