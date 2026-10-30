import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, userEvent } from '@/test-utils/render';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import type { Item } from '@shared/schema';
import { applyRead, resetStore, setState } from '@/sync/store';
import { upsert } from '@/sync/controller';
import { SceneForm, toSceneForm, toScenePatch } from './SceneForm';

vi.mock('@/sync/controller', () => ({ upsert: vi.fn(() => 'NEWID'), remove: vi.fn(), restore: vi.fn() }));

const layer: Item = { id: 'L1', tip: 'aydinlatma', ad: 'Salon ana', oda: 'salon', katman_tur: 'ana', katman_ad: 'Tavan' };
const scene: Item = { id: 'S1', tip: 'sahne', ad: 'Akşam filmi', oda: 'salon', tetik: 'dugme', seviyeler: ['L1:40:2700'] };
const read = (items: Item[]) => applyRead({ ok: true, fingerprint: 'f', serverTime: 't', schemaVersion: 1, items, settings: [] });

function mount(id: string) {
  const loc = memoryLocation({ path: `/aydinlatma/sahne/${id}`, static: false, record: true });
  render(<Router hook={loc.hook}><SceneForm id={id} /></Router>);
  return loc;
}

beforeEach(() => { resetStore(); vi.mocked(upsert).mockClear(); });

describe('SceneForm: kayıt zamanlaması', () => {
  it('derin bağlantıda kayıt sonradan gelince form dolu açılır (önce iskelet, form kurulmaz)', async () => {
    setState({ hydrated: false, status: 'loading' });
    mount('S1');
    expect(screen.getByTestId('scene-form-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('scene-form')).not.toBeInTheDocument();
    read([layer, scene]);
    expect(await screen.findByTestId('scene-form')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Ad/)).toHaveValue('Akşam filmi');
    expect(screen.getByRole('combobox', { name: 'Katman 1' })).toHaveValue('Salon · Tavan');
    expect(screen.getByLabelText('Parlaklık %')).toHaveValue('40');
  });
  it('yükleme bitti ve kayıt yoksa "bulunamadı"', () => {
    setState({ hydrated: true, status: 'synced' });
    read([layer]);
    mount('S1');
    expect(screen.getByText(/Sahne bulunamadı/)).toBeInTheDocument();
  });
  it('kaydet yalnız değişen alanı patch\'ler; boş alanlar null ile silinmez', async () => {
    setState({ hydrated: true, status: 'synced' });
    read([layer, scene]);
    const loc = mount('S1');
    await userEvent.type(screen.getByLabelText('Not'), 'perde kapalı');
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    expect(upsert).toHaveBeenCalledWith('kalemler', 'S1', { tip: 'sahne', not: 'perde kapalı' });
    expect(loc.history.at(-1)).toBe('/aydinlatma');
  });
});

describe('toScenePatch', () => {
  it('değişmeyen kayıt yalnız tip; seviyeler biçimlenir', () => {
    expect(toScenePatch(toSceneForm(scene), scene)).toEqual({ tip: 'sahne' });
    const v = toSceneForm(scene);
    v.seviyeler = [{ layerId: 'L1', pct: 20, cct: null }];
    expect(toScenePatch(v, scene)).toEqual({ tip: 'sahne', seviyeler: ['L1:20:'] });
  });
});
