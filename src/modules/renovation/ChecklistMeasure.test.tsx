import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, userEvent, within } from '@/test-utils/render';
import { applyRead, resetStore, setState } from '@/sync/store';
import { upsert } from '@/sync/controller';
import { ChecklistScreen } from './ChecklistScreen';
import { readFull } from './testData';

vi.mock('@/sync/controller', () => ({ upsert: vi.fn(), remove: vi.fn(), restore: vi.fn() }));
beforeEach(() => { resetStore(); vi.mocked(upsert).mockClear(); setState({ hydrated: true, status: 'synced' }); });

const source = (value: number, over: Record<string, unknown> = {}) => {
  const data = readFull();
  data.items = data.items.map((item) => (item.id === 'k4' ? { ...item, olcum_deger: value, ...over } : item));
  return data;
};
const openKabul = async () => {
  await userEvent.click(screen.getByRole('button', { name: /Kabul testi/ }));
  return screen.findByLabelText(/Ölçüm.*Priz gerilimi/);
};

// Root RED'leri (round-05-evidence/root-checklist.test.tsx), bu modüle uyarlanmış kopya.
describe('Kontrol ölçümü: kaynak güncellemesi (root RED)', () => {
  it('a pristine measurement follows refreshed source and blur never writes the old value back', async () => {
    applyRead(source(220)); render(<ChecklistScreen />);
    const input = await openKabul();
    await userEvent.click(input);
    act(() => applyRead(source(230)));
    await userEvent.tab();
    expect(upsert).not.toHaveBeenCalled();
    expect(input).toHaveValue('230');
  });
  it('a dirty measurement cannot silently overwrite the same field changed in the source', async () => {
    applyRead(source(220)); render(<ChecklistScreen />);
    const input = await openKabul();
    await userEvent.clear(input); await userEvent.type(input, '225');
    act(() => applyRead(source(230)));
    await userEvent.tab();
    expect(input).toHaveValue('225');
    expect(upsert).not.toHaveBeenCalled();
  });
  it('a cold checklist does not present an empty completed source before hydration', () => {
    setState({ hydrated: false, status: 'loading' }); render(<ChecklistScreen />);
    expect(screen.queryByText('Madde yok.')).not.toBeInTheDocument();
    expect(screen.queryByText('0 / 0')).not.toBeInTheDocument();
  });
});

describe('Kontrol ölçümü: açık seçim ve kopya (Tur 5)', () => {
  afterEach(() => vi.restoreAllMocks());
  const conflictAfterBlur = async () => {
    applyRead(source(220)); render(<ChecklistScreen />);
    const input = await openKabul();
    await userEvent.clear(input); await userEvent.type(input, '225');
    act(() => applyRead(source(230)));
    await userEvent.tab();
    return { input, alert: screen.getByRole('alert') };
  };
  it('çakışma iki değeri birimle gösterir; "225 V kalsın" yalnız o ölçümü yazar', async () => {
    const { alert } = await conflictAfterBlur();
    expect(alert).toHaveTextContent('Priz gerilimi');
    expect(alert).toHaveTextContent('225 V');
    expect(alert).toHaveTextContent('230 V');
    await userEvent.click(within(alert).getByRole('button', { name: '225 V kalsın' }));
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith('kalemler', 'k4', { olcum_deger: 225 });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('"230 V kalsın" alanı kaynak değerine alır ve yazmaz', async () => {
    const { input, alert } = await conflictAfterBlur();
    await userEvent.click(within(alert).getByRole('button', { name: '230 V kalsın' }));
    expect(upsert).not.toHaveBeenCalled();
    expect(input).toHaveValue('230');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('kaynak değişmediyse düzenlenen ölçüm odak çıkınca yazılır', async () => {
    applyRead(source(220)); render(<ChecklistScreen />);
    const input = await openKabul();
    await userEvent.clear(input); await userEvent.type(input, '225');
    await userEvent.tab();
    expect(upsert).toHaveBeenCalledWith('kalemler', 'k4', { olcum_deger: 225 });
  });
  it('yenilemeden sonra kopyalanan metin ekrandaki maddeyle aynıdır', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    applyRead(source(220)); render(<ChecklistScreen />);
    await openKabul();
    act(() => applyRead(source(230, { esik: '230' })));
    const panel = screen.getByTestId('group-kabul');
    expect(within(panel).getByText(/eşik: 230 V/)).toBeInTheDocument();
    expect(within(panel).getByLabelText(/Ölçüm.*Priz gerilimi/)).toHaveValue('230');
    await userEvent.click(within(panel).getByRole('button', { name: 'Metni kopyala' }));
    expect(writeText).toHaveBeenCalledWith('1. Priz gerilimi — eşik: 230 V');
    vi.unstubAllGlobals();
  });
});
