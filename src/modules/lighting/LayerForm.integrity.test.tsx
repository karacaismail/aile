// Permanent regression coverage from root's independent probes (Round 5 follow-up; RED executed before the fix):
// the owned patch is validated together with the latest stored record, and CCT bounds are owned one by one.
import { beforeEach, expect, it, vi } from 'vitest';
import { act, render, screen, userEvent, within } from '@/test-utils/render';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import type { Item } from '@shared/schema';
import { applyRead, resetStore, setState } from '@/sync/store';
import { upsert } from '@/sync/controller';
import { LayerForm } from './LayerForm';

vi.mock('@/sync/controller', () => ({ upsert: vi.fn(() => 'PROBE'), remove: vi.fn(), restore: vi.fn() }));
const initial: Item = {
  id: 'PROBE-LAYER', tip: 'aydinlatma', ad: 'Sentetik katman', oda: 'salon', katman_tur: 'ana',
  katman_ad: 'Sentetik katman', lux_min: 100, lux_max: 1000, cct_min: 2700, cct_max: 4000, cri_min: 95,
  tahmini_tl_min: 100, tahmini_tl_max: 1000, fiyat_guven: 'tahmini', version: 1,
};
const refresh = (record: Item) => act(() => applyRead({
  ok: true, fingerprint: `probe-${record.version}`, serverTime: '2098-01-01T00:00:00Z', schemaVersion: 1,
  items: [record], settings: [{ id: 'PROBE-ROOM', tip: 'oda', anahtar: 'salon', deger: JSON.stringify({ kopek_erisim: 'kapali' }) }],
}));
const mount = () => {
  refresh(initial);
  const loc = memoryLocation({ path: '/aydinlatma/salon/PROBE-LAYER', static: false, record: true });
  render(<Router hook={loc.hook}><LayerForm oda="salon" id="PROBE-LAYER" /></Router>);
  return loc;
};
const replace = async (label: string, value: string) => {
  await userEvent.clear(screen.getByLabelText(label));
  await userEvent.type(screen.getByLabelText(label), value);
};
beforeEach(() => { resetStore(); vi.mocked(upsert).mockClear(); setState({ hydrated: true, status: 'synced' }); });

it('rejects latest plus owned lux range when local and remote drafts are separately valid', async () => {
  mount();
  await replace('Lux min', '700'); // Local 700–1000 is valid.
  refresh({ ...initial, lux_max: 500, version: 2 }); // Remote 100–500 is valid.
  await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
  expect(upsert).not.toHaveBeenCalled(); // Merging the patch would persist 700–500.
  expect(screen.getByLabelText('Lux min')).toHaveValue('700');
  expect(screen.getByTestId('merged-invalid')).toHaveTextContent('Lux max');
  expect(screen.getByTestId('merged-invalid')).toHaveTextContent('500');
});

it('rejects latest plus owned price range when local and remote drafts are separately valid', async () => {
  mount();
  await replace('Tahmini (min)', '700');
  refresh({ ...initial, tahmini_tl_max: 500, version: 2 });
  await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
  expect(upsert).not.toHaveBeenCalled();
});

it('validates owned CRI against the latest layer type before enqueueing a write', async () => {
  mount();
  await replace('CRI min', '80'); // Local Ana + CRI80 is valid.
  refresh({ ...initial, katman_tur: 'gorev', version: 2 }); // Remote Görev + CRI95 is valid.
  await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
  expect(upsert).not.toHaveBeenCalled(); // Merging would make Görev + CRI80, below the required90.
  expect(screen.getByLabelText('CRI min')).toHaveValue('80');
  expect(screen.getByTestId('merged-invalid')).toHaveTextContent('Görev katmanında CRI ≥ 90 olmalı');
});

it('resolving only the CCT upper-bound conflict never takes ownership of untouched lower bound', async () => {
  mount();
  await userEvent.click(screen.getByLabelText('Not')); // Let the modal's opening focus settle through a real input action.
  const upper = screen.getByRole('slider', { name: 'CCT max' });
  act(() => upper.focus());
  expect(upper).toHaveFocus();
  await userEvent.keyboard('{ArrowRight}'.repeat(10));
  expect(screen.getByTestId('cct-value')).toHaveTextContent('2700–5000 K');
  refresh({ ...initial, cct_min: 3000, cct_max: 4500, version: 2 });
  await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
  expect(upsert).not.toHaveBeenCalled();
  const conflict = screen.getByRole('alert');
  expect(conflict).toHaveTextContent('Renk sıcaklığı (üst)');
  expect(conflict).not.toHaveTextContent('Renk sıcaklığı (alt)');
  await userEvent.click(within(conflict).getByRole('button', { name: 'Benim değerim kalsın' }));
  await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
  expect(upsert).toHaveBeenCalledTimes(1);
  const patch = vi.mocked(upsert).mock.calls[0][2];
  expect(patch).toEqual({ tip: 'aydinlatma', cct_max: 5000 });
  expect({ ...initial, cct_min: 3000, cct_max: 4500, ...patch }).toMatchObject({ cct_min: 3000, cct_max: 5000 });
});

// Coverage added after the fix (not TDD): taking the server's upper bound changes only that bound in the draft.
it('choosing the server value for the CCT upper bound keeps the local lower bound and writes nothing it does not own', async () => {
  mount();
  await userEvent.click(screen.getByLabelText('Not'));
  const upper = screen.getByRole('slider', { name: 'CCT max' });
  act(() => upper.focus());
  await userEvent.keyboard('{ArrowRight}'.repeat(10));
  refresh({ ...initial, cct_min: 3000, cct_max: 4500, version: 2 });
  await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
  await userEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: "Sheets'teki kalsın" }));
  expect(screen.getByTestId('cct-value')).toHaveTextContent('2700–4500 K');
  await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
  expect(upsert).not.toHaveBeenCalled();
});

// Root reviewer regression (copied verbatim from the integration tree; RED before the fix).
it('resolving upper-bound conflict preserves remotely cleared untouched lower bound', async () => {
  mount();
  await userEvent.click(screen.getByLabelText('Not')); // Let the modal's opening focus settle through a real input action.
  const upper = screen.getByRole('slider', { name: 'CCT max' });
  act(() => upper.focus());
  expect(upper).toHaveFocus();
  await userEvent.keyboard('{ArrowRight}'.repeat(10));
  expect(screen.getByTestId('cct-value')).toHaveTextContent('2700–5000 K');
  refresh({ ...initial, cct_min: undefined, cct_max: undefined, version: 2 });
  await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
  expect(upsert).not.toHaveBeenCalled();
  const conflict = screen.getByRole('alert');
  expect(conflict).toHaveTextContent('Renk sıcaklığı (üst)');
  expect(conflict).not.toHaveTextContent('Renk sıcaklığı (alt)');
  await userEvent.click(within(conflict).getByRole('button', { name: 'Benim değerim kalsın' }));
  await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
  expect(upsert).toHaveBeenCalledTimes(1);
  const patch = vi.mocked(upsert).mock.calls[0][2];
  expect(patch).toEqual({ tip: 'aydinlatma', cct_max: 5000 });
  expect({ ...initial, cct_min: undefined, cct_max: undefined, ...patch }).toMatchObject({ cct_min: undefined, cct_max: 5000 });
});

// Reviewer focus candidate (RED first): an invalid merged CCT range names the owned bound on the slider and focuses it.
it('a merged CCT range that would be reversed shows the error on the slider and focuses the bound the user moved', async () => {
  mount();
  await userEvent.click(screen.getByLabelText('Not'));
  const lower = screen.getByRole('slider', { name: 'CCT min' });
  act(() => lower.focus());
  await userEvent.keyboard('{ArrowRight}'.repeat(8));
  expect(screen.getByTestId('cct-value')).toHaveTextContent('3500–4000 K');
  refresh({ ...initial, cct_max: 3000, version: 2 }); // Remote 2700–3000 is valid; merged 3500–3000 is not.
  await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
  expect(upsert).not.toHaveBeenCalled();
  expect(screen.getByTestId('merged-invalid')).toHaveTextContent('Renk sıcaklığı (üst)');
  expect(screen.getByTestId('cct-error')).toHaveTextContent("CCT min, max'tan büyük olamaz");
  await vi.waitFor(() => expect(screen.getByRole('slider', { name: 'CCT min' })).toHaveFocus());
});

// Coverage added after the fix (not TDD): the same bound-level ownership for the lower bound and for a single cleared bound.
const moveThumb = async (name: 'CCT min' | 'CCT max', key: string, times: number) => {
  await userEvent.click(screen.getByLabelText('Not'));
  const thumb = screen.getByRole('slider', { name });
  act(() => thumb.focus());
  await userEvent.keyboard(key.repeat(times));
};
it('resolving a lower-bound conflict preserves a remotely cleared untouched upper bound', async () => {
  mount();
  await moveThumb('CCT min', '{ArrowLeft}', 3);
  expect(screen.getByTestId('cct-value')).toHaveTextContent('2400–4000 K');
  refresh({ ...initial, cct_min: undefined, cct_max: undefined, version: 2 });
  await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
  const conflict = screen.getByRole('alert');
  expect(conflict).toHaveTextContent('Renk sıcaklığı (alt)');
  expect(conflict).not.toHaveTextContent('Renk sıcaklığı (üst)');
  await userEvent.click(within(conflict).getByRole('button', { name: 'Benim değerim kalsın' }));
  await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
  expect(vi.mocked(upsert).mock.calls[0][2]).toEqual({ tip: 'aydinlatma', cct_min: 2400 });
});
it('a bound cleared on the server while the user moves only the other bound stays cleared', async () => {
  mount();
  await moveThumb('CCT min', '{ArrowRight}', 3);
  refresh({ ...initial, cct_max: undefined, version: 2 });
  await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
  expect(vi.mocked(upsert).mock.calls[0][2]).toEqual({ tip: 'aydinlatma', cct_min: 3000 });
});

// Coverage added after the fix (not TDD): a pre-existing invalid rule the user's own field still breaks names that field and focuses it.
it('an owned CRI that leaves an already-invalid Görev layer invalid marks the CRI field and focuses it', async () => {
  mount();
  await replace('CRI min', '85');
  refresh({ ...initial, katman_tur: 'gorev', cri_min: 80, version: 2 });
  await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
  await userEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Benim değerim kalsın' }));
  await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
  expect(upsert).not.toHaveBeenCalled();
  expect(screen.getByLabelText('CRI min')).toHaveAttribute('aria-invalid', 'true');
  await vi.waitFor(() => expect(screen.getByLabelText('CRI min')).toHaveFocus());
});

// Coverage added after the partial-slider fix (not TDD): a record with no CCT takes the visible pair as an explicit choice.
it('on a layer without any CCT, moving one thumb stores the visible pair the user chose', async () => {
  const { cct_min: _a, cct_max: _b, ...noCct } = initial;
  refresh({ ...noCct, version: 1 } as Item);
  const loc = memoryLocation({ path: '/aydinlatma/salon/PROBE-LAYER', static: false, record: true });
  render(<Router hook={loc.hook}><LayerForm oda="salon" id="PROBE-LAYER" /></Router>);
  await moveThumb('CCT max', '{ArrowRight}', 5);
  expect(screen.getByTestId('cct-value')).toHaveTextContent('2700–4500 K');
  await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
  expect(vi.mocked(upsert).mock.calls[0][2]).toEqual({ tip: 'aydinlatma', cct_min: 2700, cct_max: 4500 });
});

// Review follow-up (RED first): the slider error is associated with the thumbs, not only shown beside them.
it('a CCT error marks the slider thumbs invalid and describes them with the visible error text', async () => {
  mount();
  await moveThumb('CCT min', '{ArrowRight}', 8);
  refresh({ ...initial, cct_max: 3000, version: 2 });
  await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
  const error = screen.getByTestId('cct-error');
  for (const name of ['CCT min', 'CCT max'] as const) {
    const thumb = screen.getByRole('slider', { name });
    expect(thumb).toHaveAttribute('aria-invalid', 'true');
    expect(thumb).toHaveAccessibleDescription(error.textContent!);
    expect(thumb.getAttribute('aria-describedby')).toBe(error.id);
  }
});
