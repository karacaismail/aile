import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, userEvent, within } from '@/test-utils/render';
import type { Item } from '@shared/schema';
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
  it('yeni işte boş Ad ile Kaydet: yazmaz, odak Ad alanına döner, hata sayısı duyurulur', async () => {
    applyRead(readFull());
    mount();
    await userEvent.click(screen.getByTestId('fab'));
    const form = await screen.findByTestId('task-detail');
    await userEvent.click(within(form).getByLabelText('Not'));
    await userEvent.click(within(form).getByRole('button', { name: 'Kaydet' }));
    expect(upsert).not.toHaveBeenCalled();
    expect(within(form).getByLabelText(/^Ad\b/)).toHaveFocus();
    expect(within(form).getByRole('status')).toHaveTextContent('1 alan düzeltilmeli');
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

describe('TaskDetail: alan sahipliği (Tur 5)', () => {
  const T1 = readFull().items.find((i) => i.id === 't1')!;
  const T2 = readFull().items.find((i) => i.id === 't2')!;
  const open = async (id: string) => {
    applyRead(readFull());
    mount(`/tadilat/isler/${id}`);
    return screen.findByTestId('task-detail');
  };
  const refresh = (record: Item) => act(() => { applyRead(readFull({ items: [...readFull().items.filter((i) => i.id !== record.id), record], fingerprint: 'g' })); });
  const lastPatch = () => vi.mocked(upsert).mock.calls.at(-1)![2];

  it('yalnız Not değişince, sunucuda değişen durum, işi yapan ve bağımlılık geri yazılmaz', async () => {
    const form = await open('t1');
    await userEvent.type(within(form).getByLabelText('Not'), ' ek');
    refresh({ ...T1, durum: 'karar', is_kim: ['ben'], bagimlilik: ['T9'], version: 2 });
    await userEvent.click(within(form).getByRole('button', { name: 'Kaydet' }));
    expect(lastPatch()).toEqual({ tip: 'tadilat', not: 'İş notu ek' });
  });

  it('aynı alanı (Not) sunucu da değiştirdiyse yazmaz; çakışma iki değerle görünür, seçim sonrası Kaydet yalnız o alanı yazar', async () => {
    const form = await open('t1');
    await userEvent.clear(within(form).getByLabelText('Not'));
    await userEvent.type(within(form).getByLabelText('Not'), 'Benim notum');
    refresh({ ...T1, not: 'Sunucudaki not', durum: 'karar', version: 2 });
    await userEvent.click(within(form).getByRole('button', { name: 'Kaydet' }));
    expect(upsert).not.toHaveBeenCalled();
    const alert = within(form).getByRole('alert');
    expect(alert).toHaveTextContent('Not');
    expect(alert).toHaveTextContent('Benim notum');
    expect(alert).toHaveTextContent('Sunucudaki not');
    expect(within(form).getByLabelText('Not')).toHaveValue('Benim notum');
    await userEvent.click(within(alert).getByRole('button', { name: 'Benim değerim kalsın' }));
    await userEvent.click(within(form).getByRole('button', { name: 'Kaydet' }));
    expect(lastPatch()).toEqual({ tip: 'tadilat', not: 'Benim notum' });
  });

  it('"Sheets\'teki kalsın" alanı sunucu değerine alır; sonra Kaydet yazmaz', async () => {
    const form = await open('t1');
    await userEvent.type(within(form).getByLabelText('Not'), ' ek');
    refresh({ ...T1, not: 'Sunucudaki not', version: 2 });
    await userEvent.click(within(form).getByRole('button', { name: 'Kaydet' }));
    await userEvent.click(within(within(form).getByRole('alert')).getByRole('button', { name: "Sheets'teki kalsın" }));
    expect(within(form).getByLabelText('Not')).toHaveValue('Sunucudaki not');
    await userEvent.click(within(form).getByRole('button', { name: 'Kaydet' }));
    expect(upsert).not.toHaveBeenCalled();
  });

  it('yalnız boşluk değişikliği (Ad) sunucu adı değiştirse de yazmaz', async () => {
    const form = await open('t1');
    await userEvent.type(within(form).getByLabelText(/^Ad/), '  ');
    refresh({ ...T1, ad: 'Sunucudaki ad', version: 2 });
    await userEvent.click(within(form).getByRole('button', { name: 'Kaydet' }));
    expect(upsert).not.toHaveBeenCalled();
  });

  it('bağımlılık bütün dizi olarak karşılaştırılır: yalnız biçim değişikliği sunucu dizisi değişse de yazmaz', async () => {
    const form = await open('t2');
    const deps = within(form).getByLabelText(/Bağımlılık/);
    await userEvent.type(deps, ' ,');
    refresh({ ...T2, bagimlilik: ['T1', 'T3'], version: 2 });
    await userEvent.click(within(form).getByRole('button', { name: 'Kaydet' }));
    expect(upsert).not.toHaveBeenCalled();
    expect(screen.queryByTestId('task-detail')).not.toBeInTheDocument();
  });

  it('bağımlılıkta sunucudaki farklı dizi ile kullanıcının farklı dizisi çakışmadır', async () => {
    const form = await open('t2');
    const deps = within(form).getByLabelText(/Bağımlılık/);
    await userEvent.clear(deps);
    await userEvent.type(deps, 'T1, T10');
    refresh({ ...T2, bagimlilik: ['T1', 'T3'], version: 2 });
    await userEvent.click(within(form).getByRole('button', { name: 'Kaydet' }));
    expect(upsert).not.toHaveBeenCalled();
    const alert = within(form).getByRole('alert');
    expect(alert).toHaveTextContent('Bağımlılık');
    expect(alert).toHaveTextContent('T1, T10');
    expect(alert).toHaveTextContent('T1, T3');
  });

  it('işi yapan bütün dizi olarak yazılır; dokunulmamış bağımlılığın sunucu değeri korunur', async () => {
    const form = await open('t2');
    await userEvent.click(within(form).getByRole('checkbox', { name: 'Marangoz' }));
    refresh({ ...T2, bagimlilik: ['T3'], version: 2 });
    await userEvent.click(within(form).getByRole('button', { name: 'Kaydet' }));
    expect(lastPatch()).toEqual({ tip: 'tadilat', is_kim: ['boyaci', 'ben', 'marangoz'] });
  });
});

describe('İş kartı: kayıt dili (Tur 5)', () => {
  it('kimlik kod + ad; tek renkli etiket durumdur; işi yapan düz metin; bağımlılık cümle; izin dikkat maddesi', () => {
    applyRead(readFull());
    mount();
    const [t1, t2] = screen.getAllByTestId('task-card');
    expect(within(t1).getByRole('heading', { level: 3 })).toHaveTextContent('T1 Elektrik altyapı');
    expect(t1.querySelectorAll('.mantine-Badge-root')).toHaveLength(1);
    expect(within(t1).getByText('Elektrikçi').closest('.record-meta')).not.toBeNull();
    const attention = within(t1).getByRole('list', { name: /dikkat/i });
    expect(within(attention).getByRole('listitem')).toHaveTextContent('İzin gerekli · İstenecek');
    expect(within(t2).getByText(/Bağımlı/)).toHaveTextContent('Bağımlı: T1 bitince başlar');
    expect(within(t2).getByText('Boyacı').closest('.record-meta')).not.toBeNull();
  });
  it('takvim bilgisi her kartta aynı çift: Planlanan başlangıç + Süre ve/veya Bitiş', () => {
    applyRead(readFull({ items: [
      { id: 'a', tip: 'tadilat', kod: 'T1', ad: 'Süreli', planlanan_tarih: '2099-01-15', sure_gun: 3 },
      { id: 'b', tip: 'tadilat', kod: 'T2', ad: 'Bitişli', planlanan_tarih: '2099-01-15', bitis_tarihi: '2099-01-20' },
      { id: 'c', tip: 'tadilat', kod: 'T3', ad: 'İkisi', planlanan_tarih: '2099-01-15', sure_gun: 2, bitis_tarihi: '2099-01-20' },
      { id: 'd', tip: 'tadilat', kod: 'T4', ad: 'Hiçbiri' },
    ] }));
    mount();
    const terms = (c: HTMLElement) => within(c).getAllByRole('term').map((t) => t.textContent);
    const [a, b, c, d] = screen.getAllByTestId('task-card');
    expect(terms(a)).toEqual(['Planlanan başlangıç', 'Süre']);
    expect(terms(b)).toEqual(['Planlanan başlangıç', 'Bitiş']);
    expect(terms(c)).toEqual(['Planlanan başlangıç', 'Süre', 'Bitiş']);
    expect(terms(d)).toEqual(['Planlanan başlangıç', 'Süre ve bitiş']);
    expect(within(d).getAllByText('Belirtilmedi')).toHaveLength(2);
  });
});
