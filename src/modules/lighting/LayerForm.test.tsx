import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, userEvent, within } from '@/test-utils/render';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import type { Item } from '@shared/schema';
import { applyRead, resetStore, setState } from '@/sync/store';
import { upsert, remove } from '@/sync/controller';
import { LayerForm, toLayerPatch, toForm } from './LayerForm';
import { MSG } from './rules';

vi.mock('@/sync/controller', () => ({ upsert: vi.fn(() => 'NEWID'), remove: vi.fn(), restore: vi.fn() }));

const purchase: Item = { id: 'P1', tip: 'satinalma', ad: 'Şerit LED 24V', oda: 'salon', faz: '1' };
const existing: Item = { id: 'L1', tip: 'aydinlatma', ad: 'Tavan', oda: 'salon', katman_tur: 'ana', katman_ad: 'Tavan', cct_min: 2700, cct_max: 4000, lux_min: 150, cri_min: 80, kim: ['E'], bagli_idler: ['P1'] };

function mount(id: string, oda = 'salon') {
  const loc = memoryLocation({ path: `/aydinlatma/${oda}/${id}`, static: false, record: true });
  render(<Router hook={loc.hook}><LayerForm oda={oda} id={id} /></Router>);
  return loc;
}

beforeEach(() => {
  resetStore();
  vi.mocked(upsert).mockClear();
  vi.mocked(remove).mockClear();
  setState({ hydrated: true, status: 'synced' });
  applyRead({ ok: true, fingerprint: 'f', serverTime: 't', schemaVersion: 1, items: [purchase, existing], settings: [
    { id: 'S1', tip: 'oda', anahtar: 'salon', deger: JSON.stringify({ kopek_erisim: 'serbest' }) },
  ] });
});

describe('LayerForm', () => {
  it('yeni katman: tür zorunlu; görev + CRI 80 doğrulama hatası; düzeltince kaydeder', async () => {
    const loc = mount('yeni');
    const form = screen.getByTestId('layer-form');
    expect(within(form).getByTestId('cct-value')).toHaveTextContent('2700–4000 K');
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    expect(await screen.findByText('Katman türü gerekli')).toBeInTheDocument();
    expect(upsert).not.toHaveBeenCalled();
    await userEvent.selectOptions(screen.getByLabelText(/Katman türü/), 'gorev');
    await userEvent.type(screen.getByLabelText('CRI min'), '80');
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    expect(await screen.findByText(MSG.gorevCri)).toBeInTheDocument();
    expect(upsert).not.toHaveBeenCalled();
    await userEvent.clear(screen.getByLabelText('CRI min'));
    await userEvent.type(screen.getByLabelText('CRI min'), '95');
    await userEvent.type(screen.getByLabelText('Katman adı'), 'Masa lambası');
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    expect(upsert).toHaveBeenCalledTimes(1);
    const [table, id, patch] = vi.mocked(upsert).mock.calls[0];
    expect(table).toBe('kalemler');
    expect(id).toBeUndefined();
    expect(patch).toMatchObject({ tip: 'aydinlatma', oda: 'salon', katman_tur: 'gorev', katman_ad: 'Masa lambası', ad: 'Masa lambası', cri_min: 95 });
    expect(patch).not.toHaveProperty('cct_min'); // CCT modu seçilmedi: kaydırıcı varsayılanı yazılmaz
    expect(loc.history.at(-1)).toBe('/aydinlatma/salon');
  });
  it('köpek kuralı: açıkta + 30 cm hata; uzun şerit uyarı metni', async () => {
    mount('yeni');
    await userEvent.selectOptions(screen.getByLabelText(/Katman türü/), 'ana');
    await userEvent.click(screen.getByLabelText('Açıkta (şerit/kablo görünür)'));
    await userEvent.type(screen.getByLabelText('Montaj yüksekliği (cm)'), '30');
    await userEvent.type(screen.getByLabelText('Uzunluk (m)'), '6');
    expect(await screen.findByText(MSG.longStrip)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    expect(await screen.findByText(MSG.dog)).toBeInTheDocument();
    expect(upsert).not.toHaveBeenCalled();
  });
  it('var olan katman: değerler dolu, bağlı ürün seçili, sil onayı remove çağırır', async () => {
    mount('L1');
    expect(screen.getByLabelText('Katman adı')).toHaveValue('Tavan');
    expect(screen.getByLabelText(/Katman türü/)).toHaveValue('ana');
    expect(screen.getByRole('checkbox', { name: 'Şerit LED 24V' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Elektrikçi' })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Sil' }));
    const confirm = await screen.findByRole('dialog', { name: 'Katmanı sil?' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Sil' }));
    expect(remove).toHaveBeenCalledWith('kalemler', 'L1');
  });
});

describe('LayerForm: kayıt zamanlaması', () => {
  it('derin bağlantıda kayıt sonradan gelince form dolu açılır (önce iskelet, form kurulmaz)', async () => {
    resetStore();
    setState({ hydrated: false, status: 'loading' });
    mount('L1');
    expect(screen.getByTestId('layer-form-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('layer-form')).not.toBeInTheDocument();
    applyRead({ ok: true, fingerprint: 'f', serverTime: 't', schemaVersion: 1, items: [purchase, existing], settings: [] });
    expect(await screen.findByTestId('layer-form')).toBeInTheDocument();
    expect(screen.getByLabelText('Katman adı')).toHaveValue('Tavan');
    expect(screen.getByLabelText('Lux min')).toHaveValue('150');
  });
  it('yükleme bitti ve kayıt yoksa "bulunamadı"', () => {
    mount('YOK');
    expect(screen.getByText(/Katman bulunamadı/)).toBeInTheDocument();
    expect(screen.queryByTestId('layer-form')).not.toBeInTheDocument();
  });
  it('kaydet yalnız değişen alanı patch\'ler; boş alanlar null ile silinmez', async () => {
    mount('L1');
    await userEvent.type(screen.getByLabelText('Amaç'), 'Okuma');
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith('kalemler', 'L1', { tip: 'aydinlatma', amac: 'Okuma' });
  });
});

describe('toLayerPatch', () => {
  it('yeni katmanda ad türetilir; var olanda yalnız değişenler', () => {
    const v = toForm(undefined);
    v.katman_tur = 'gece';
    const p = toLayerPatch(v, 'cocuk');
    expect(p).toMatchObject({ tip: 'aydinlatma', oda: 'cocuk', katman_tur: 'gece', ad: 'Çocuk odası Gece', acikta: false, kim: null, bagli_idler: null });
    // CCT modu seçilmeden kaydırıcının varsayılanı yazılmaz (isComplete şişmez); mod seçilince yazılır.
    expect(p).not.toHaveProperty('cct_min');
    expect(p).not.toHaveProperty('cct_max');
    expect(toLayerPatch({ ...v, cct_mod: 'sabit' }, 'cocuk')).toMatchObject({ cct_mod: 'sabit', cct_min: 2700, cct_max: 4000 });
    const v2 = toForm(existing);
    v2.lux_min = 200;
    expect(toLayerPatch(v2, 'salon', existing)).toEqual({ tip: 'aydinlatma', lux_min: 200 });
  });
  it('kayıtta CCT varsa mod seçilmese de korunur; değişmeyen alanlar null ile silinmez', () => {
    const v = toForm(existing); // cct_mod yok, cct_min/max var
    expect(toLayerPatch(v, 'salon', existing)).toEqual({ tip: 'aydinlatma' });
    v.cct = [3000, 4000];
    expect(toLayerPatch(v, 'salon', existing)).toEqual({ tip: 'aydinlatma', cct_min: 3000 });
  });
});
