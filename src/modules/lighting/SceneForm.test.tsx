import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, userEvent, within } from '@/test-utils/render';
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

describe('SceneForm: hata odağı ve değişiklik koruması', () => {
  it('boş Ad ve katmansız seviye: yazmaz, odak sırayla ilk hatalı alana gider, hata sayısı duyurulur', async () => {
    setState({ hydrated: true, status: 'synced' });
    read([layer]);
    mount('yeni');
    await userEvent.click(screen.getByRole('button', { name: 'Seviye ekle' }));
    await userEvent.click(screen.getByLabelText('Not'));
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    expect(upsert).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('2 alan düzeltilmeli');
    expect(screen.getByLabelText(/^Ad\b/)).toHaveFocus();
    await userEvent.type(screen.getByLabelText(/^Ad\b/), 'Akşam');
    await userEvent.click(screen.getByLabelText('Not'));
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    expect(screen.getByRole('status')).toHaveTextContent('1 alan düzeltilmeli');
    expect(screen.getByRole('combobox', { name: 'Katman 1' })).toHaveFocus();
  });
  it('var olan sahnede değişiklik yoksa Kaydet Sheets\'e yazmaz ve form kapanır', async () => {
    setState({ hydrated: true, status: 'synced' });
    read([layer, scene]);
    const loc = mount('S1');
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    expect(upsert).not.toHaveBeenCalled();
    expect(loc.history.at(-1)).toBe('/aydinlatma');
  });
});

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

describe('Tur 5: SceneForm alan sahipliği — seviyeler tek bütün alandır', () => {
  const layer2: Item = { id: 'L2', tip: 'aydinlatma', ad: 'Salon gece', oda: 'salon', katman_tur: 'gece', katman_ad: 'Süpürgelik' };
  const base: Item = { ...scene, seviyeler: ['L1:40:2700', 'L2:10:2200'], not: 'İlk not', version: 1 };
  const refresh = (record: Item) => act(() => { read([layer, layer2, record]); });
  const open = (record: Item) => { setState({ hydrated: true, status: 'synced' }); read([layer, layer2, record]); return mount('S1'); };

  it('dokunulmamış tetik sunucuda değişince korunur: yalnız Not yazılır', async () => {
    open(base);
    await userEvent.type(screen.getByLabelText('Not'), ' ve perde');
    refresh({ ...base, tetik: 'sensor', version: 2 });
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    expect(vi.mocked(upsert).mock.calls.at(-1)![2]).toEqual({ tip: 'sahne', not: 'İlk not ve perde' });
  });

  it('aynı alan (Not) sunucuda da değiştiyse yazmaz ve çakışma gösterir', async () => {
    open(base);
    await userEvent.clear(screen.getByLabelText('Not'));
    await userEvent.type(screen.getByLabelText('Not'), 'Benim notum');
    refresh({ ...base, not: 'Sunucudaki not', version: 2 });
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    expect(upsert).not.toHaveBeenCalled();
    const conflict = screen.getByRole('alert');
    expect(conflict).toHaveTextContent('Not');
    expect(conflict).toHaveTextContent('Benim notum');
    expect(conflict).toHaveTextContent('Sunucudaki not');
  });

  it('seviyelerde kullanıcı 1. satırı, sunucu 2. satırı değiştirdiyse satır satır birleştirmez: çakışma, yazım yok; "Benim değerim kalsın" bütün diziyi yazar', async () => {
    open(base);
    const pct = screen.getAllByLabelText('Parlaklık %')[0];
    await userEvent.clear(pct);
    await userEvent.type(pct, '60');
    refresh({ ...base, seviyeler: ['L1:40:2700', 'L2:30:2200'], version: 2 });
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    expect(upsert).not.toHaveBeenCalled();
    const conflict = screen.getByRole('alert');
    expect(conflict).toHaveTextContent('Işık seviyeleri');
    expect(conflict).toHaveTextContent('%60');
    expect(conflict).toHaveTextContent('%30');
    await userEvent.click(within(conflict).getByRole('button', { name: 'Benim değerim kalsın' }));
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    expect(vi.mocked(upsert).mock.calls.at(-1)![2]).toEqual({ tip: 'sahne', seviyeler: ['L1:60:2700', 'L2:10:2200'] });
  });

  it('yalnız boşluk eklemek yazmaz ve formu kapatır', async () => {
    const loc = open(base);
    await userEvent.type(screen.getByLabelText(/^Ad\b/), '   ');
    refresh({ ...base, tetik: 'sensor', version: 2 });
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    expect(upsert).not.toHaveBeenCalled();
    expect(loc.history.at(-1)).toBe('/aydinlatma');
  });
});

describe('Tur 5: SceneForm seçili katman oda filtresi dışında da görünür kalır', () => {
  const kitchen: Item = { id: 'K1', tip: 'aydinlatma', ad: 'Mutfak tezgah', oda: 'mutfak', katman_tur: 'gorev', katman_ad: 'Tezgah altı' };
  const gone: Item = { id: 'G1', tip: 'aydinlatma', ad: 'Eski aplik', oda: 'salon', katman_tur: 'dekoratif', katman_ad: 'Eski aplik', deleted_at: '2026-10-01T00:00:00Z' };
  const spanning: Item = { ...scene, seviyeler: ['L1:40:2700', 'K1:80:4000', 'G1:10:', 'YOK1:5:'] };
  const open = () => { setState({ hydrated: true, status: 'synced' }); read([layer, kitchen, gone, spanning]); return mount('S1'); };

  it('başka odadaki seçili katman adı ve odasıyla görünür; silinmiş ve bulunamayan katman açıkça yazılır; liste kapsamı söylenir', () => {
    open();
    expect(screen.getByRole('combobox', { name: 'Katman 1' })).toHaveValue('Salon · Tavan');
    expect(screen.getByRole('combobox', { name: 'Katman 2' })).toHaveValue('Mutfak · Tezgah altı');
    expect(screen.getByRole('combobox', { name: 'Katman 3' })).toHaveValue('Salon · Eski aplik · silinmiş katman');
    expect(screen.getByRole('combobox', { name: 'Katman 4' })).toHaveValue('Bulunamayan katman · YOK1');
    expect(screen.getByTestId('scene-level-scope')).toHaveTextContent('Salon');
  });

  it('oda değişince seçili katmanlar korunur ve görünür kalır; yalnız Not değişince seviyeler yazılmaz', async () => {
    open();
    await userEvent.click(screen.getByRole('combobox', { name: 'Oda' }));
    await userEvent.click(screen.getByRole('option', { name: 'Mutfak' }));
    expect(screen.getByRole('combobox', { name: 'Katman 1' })).toHaveValue('Salon · Tavan');
    expect(screen.getByTestId('scene-level-scope')).toHaveTextContent('Mutfak');
    await userEvent.type(screen.getByLabelText('Not'), 'perde');
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    expect(vi.mocked(upsert).mock.calls.at(-1)![2]).toEqual({ tip: 'sahne', oda: 'mutfak', not: 'perde' });
  });
});
