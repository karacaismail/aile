import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, userEvent, within } from '@/test-utils/render';
import { Router, Route } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { applyRead, resetStore, setState } from '@/sync/store';
import { upsert } from '@/sync/controller';
import { RenovationModule } from './index';
import { readFull } from './testData';
import { TaskDetail, toTaskPatch } from './TaskDetail';

vi.mock('@/sync/controller', () => ({ upsert: vi.fn(), remove: vi.fn(), restore: vi.fn() }));

function mount(path = '/tadilat/isler') {
  const { hook } = memoryLocation({ path, static: false });
  return render(<Router hook={hook}><Route path="/tadilat" nest><RenovationModule /></Route></Router>);
}

beforeEach(() => { resetStore(); vi.mocked(upsert).mockClear(); setState({ hydrated: true, status: 'synced' }); });

describe('İşler', () => {
  it('kod sırasıyla kartlar; yerel durum etiketi, işi yapan, izin ve bağımlılık rozetleri', () => {
    applyRead(readFull());
    mount();
    const cards = screen.getAllByTestId('task-card');
    expect(cards.map((c) => within(c).getByTestId('task-kod').textContent)).toEqual(['T1', 'T2', 'T10']);
    expect(within(cards[0]).getByText('Planlandı')).toBeInTheDocument();
    expect(within(cards[0]).getByText('Elektrikçi')).toBeInTheDocument();
    expect(within(cards[0]).getByText(/İzin/)).toHaveTextContent('İstenecek');
    expect(within(cards[0]).getByText('15 Oca 2099')).toBeInTheDocument();
    expect(within(cards[0]).getByText(/3 gün/)).toBeInTheDocument();
    expect(within(cards[1]).getByText('Devam ediyor')).toBeInTheDocument();
    expect(within(cards[1]).getByText(/Bağımlı/)).toHaveTextContent('T1');
    expect(within(cards[2]).getByText('Bitti')).toBeInTheDocument();
  });
  it('boş liste boş durum gösterir', () => {
    applyRead(readFull({ items: [] }));
    mount();
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
  });
  it('karta dokununca detay; ad değişip kaydedilince upsert', async () => {
    applyRead(readFull());
    mount();
    await userEvent.click(screen.getByRole('link', { name: /Elektrik altyapı/ }));
    const form = await screen.findByTestId('task-detail');
    const ad = within(form).getByLabelText(/^Ad/);
    expect(ad).toHaveValue('Elektrik altyapı');
    await userEvent.clear(ad);
    await userEvent.type(ad, 'Yeni ad');
    await userEvent.click(within(form).getByRole('button', { name: 'Kaydet' }));
    expect(upsert).toHaveBeenCalledWith('kalemler', 't1', expect.objectContaining({ tip: 'tadilat', ad: 'Yeni ad' }));
  });
  it('Fab yeni iş modalını açar', async () => {
    applyRead(readFull());
    mount();
    await userEvent.click(screen.getByTestId('fab'));
    expect(await screen.findByTestId('task-detail')).toBeInTheDocument();
    expect(screen.getByText('Yeni iş')).toBeInTheDocument();
  });
});

describe('TaskDetail: kayıt zamanlaması', () => {
  const mountDetail = (id: string) => {
    const { hook } = memoryLocation({ path: `/tadilat/isler/${id}`, static: false });
    return render(<Router hook={hook}><TaskDetail id={id} /></Router>);
  };
  it('derin bağlantıda kayıt sonradan gelince form dolu açılır (önce iskelet, form kurulmaz)', async () => {
    setState({ hydrated: false, status: 'loading' });
    mountDetail('t2');
    expect(screen.getByTestId('task-detail-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('task-detail')).not.toBeInTheDocument();
    applyRead(readFull());
    expect(await screen.findByTestId('task-detail')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Ad/)).toHaveValue('Boya');
    expect(screen.getByLabelText(/Bağımlılık/)).toHaveValue('T1');
  });
  it('yükleme bitti ve kayıt yoksa "bulunamadı"', () => {
    applyRead(readFull());
    mountDetail('yok');
    expect(screen.getByText(/İş bulunamadı/)).toBeInTheDocument();
  });
  it('kaydet yalnız değişen alanı patch\'ler; bağımlılık metni kodlara bölünür, boş alanlar null ile silinmez', async () => {
    applyRead(readFull());
    mountDetail('t2');
    const deps = screen.getByLabelText(/Bağımlılık/);
    await userEvent.clear(deps);
    await userEvent.type(deps, 'T1, T10,');
    await userEvent.tab(); // odak çıkınca metin normalize edilir
    expect(deps).toHaveValue('T1, T10');
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    expect(upsert).toHaveBeenCalledWith('kalemler', 't2', { tip: 'tadilat', bagimlilik: ['T1', 'T10'] });
  });
});

describe('toTaskPatch', () => {
  it('yeni işte tüm alanlar; var olanda yalnız değişenler', () => {
    const base = { kod: 'T5', ad: 'X', is_kim: ['ben'], planlanan_tarih: null, bitis_tarihi: null, sure_gun: null, bagimlilik: '', izin_gerekli: false, izin_durumu: undefined, sartname: '', durum: 'fikir', not: '' };
    expect(toTaskPatch(base)).toMatchObject({ tip: 'tadilat', kod: 'T5', ad: 'X', is_kim: ['ben'], bagimlilik: null, sartname: null, durum: 'fikir' });
    expect(toTaskPatch({ ...base, bagimlilik: 'T1, t2  T3,' })).toMatchObject({ bagimlilik: ['T1', 't2', 'T3'] });
    const prev = { id: 'a', tip: 'tadilat' as const, kod: 'T5', ad: 'X', is_kim: ['ben'], durum: 'fikir' as const };
    expect(toTaskPatch({ ...base, ad: 'Y' }, prev)).toEqual({ tip: 'tadilat', ad: 'Y' });
  });
});
