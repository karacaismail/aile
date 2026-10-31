import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, userEvent, within } from '@/test-utils/render';
import type { QueuedOp } from '@/sync/queue';
import { resetStore, setState } from '@/sync/store';
import { SyncStatus } from './SyncStatus';
import * as controller from '@/sync/controller';

vi.mock('@/sync/controller', () => ({
  refresh: vi.fn(async () => undefined),
  retryRejected: vi.fn(async () => undefined),
  discardRejected: vi.fn(async () => undefined),
  upsert: vi.fn(() => 'L1'),
}));

const rejectedPerde: QueuedOp = {
  op: { op: 'upsert', table: 'kalemler', id: 'A', opId: 'op-a', baseVersion: 2, patch: { durum: 'yanlis', adet: 3 } },
  ts: '2099-01-01T10:00:00Z', attempts: 0,
  rejection: { at: '2099-01-01T10:00:05Z', code: 'invalid_enum', message: 'durum: izinli değerler fikir, karar', label: 'Perde' },
};

const statusButton = () => screen.getByTestId('sync-status');
const openDrawer = async () => { await userEvent.click(statusButton()); return screen.getByRole('dialog', { name: 'Senkron durumu' }); };

beforeEach(() => { resetStore(); setState({ hydrated: true, status: 'synced', lastSync: '2099-01-01T10:00:00Z' }); });
afterEach(() => { resetStore(); vi.clearAllMocks(); });

describe('SyncStatus · gönderilemeyen değişiklikler', () => {
  it('red varken yeşil "Eşitlendi" tek başına yazılmaz; rozet, etiket ve programatik durum reddi söyler', () => {
    setState({ rejected: [rejectedPerde] });
    render(<SyncStatus />);
    expect(statusButton()).toHaveAttribute('aria-label', expect.stringMatching(/1 değişiklik gönderilemedi/));
    expect(statusButton()).not.toHaveAttribute('aria-label', 'Senkron: Eşitlendi');
    expect(screen.getByRole('status')).toHaveTextContent('1 değişiklik gönderilemedi');
    expect(screen.getByText('1')).toBeInTheDocument(); // rozet: 0 bekleyen + 1 red
  });

  it('çekmece kaydı adıyla, değişen alanlarıyla ve sunucunun nedeniyle listeler; ham kod bloğu yok', async () => {
    setState({ rejected: [rejectedPerde] });
    render(<SyncStatus />);
    const drawer = await openDrawer();
    const item = within(drawer).getByTestId('sync-rejected-item');
    expect(item).toHaveTextContent('Perde');
    expect(item).toHaveTextContent('Düzenleme');
    expect(item).toHaveTextContent(/Durum/); // şema etiketi, ham anahtar değil
    expect(item).toHaveTextContent(/Adet/);
    expect(item).toHaveTextContent('durum: izinli değerler fikir, karar');
    expect(within(drawer).queryByText(/upsert A:/)).toBeNull();
    expect(within(item).getByRole('button', { name: 'Yeniden dene' })).toBeInTheDocument();
    expect(within(item).getByRole('button', { name: 'Vazgeç' })).toBeInTheDocument();
  });

  it('yeni kayıtta boş alanlar listelenmez, boolean evet/hayır okunur; düzenlemede boş değer "—" olarak kalır', async () => {
    const yeni: QueuedOp = { op: { op: 'upsert', table: 'kalemler', id: 'N', opId: 'op-n', patch: { tip: 'satinalma', ad: 'Perde', oda: '', linkler: [], mevcut: false } }, ts: 't', attempts: 0, rejection: { at: 't', code: 'bad_request', message: 'Yeni kayıt için zorunlu: ad', label: 'Perde' } };
    const duzenleme: QueuedOp = { op: { op: 'upsert', table: 'kalemler', id: 'E', opId: 'op-e', baseVersion: 1, patch: { not: '' } }, ts: 't', attempts: 0, rejection: { at: 't', code: 'not_found', message: 'Kayıt bulunamadı', label: 'Koltuk' } };
    setState({ rejected: [yeni, duzenleme] });
    render(<SyncStatus />);
    const drawer = await openDrawer();
    const [first, second] = within(drawer).getAllByTestId('sync-rejected-item');
    expect(first).toHaveTextContent('Yeni kayıt');
    expect(first).toHaveTextContent('Mevcut (elimizde): hayır');
    expect(first).not.toHaveTextContent(/Oda/);
    expect(first).not.toHaveTextContent(/Linkler/);
    expect(second).toHaveTextContent('Düzenleme');
    expect(second).toHaveTextContent('Not: —');
  });

  it('"Yeniden dene" aynı işlemi kuyruğa geri koyar', async () => {
    setState({ rejected: [rejectedPerde] });
    render(<SyncStatus />);
    const drawer = await openDrawer();
    await userEvent.click(within(drawer).getByRole('button', { name: 'Yeniden dene' }));
    expect(controller.retryRejected).toHaveBeenCalledWith('op-a');
  });

  it('"Vazgeç" onaysız silmez; onay metni kaydın adını söyler, onaydan sonra yalnız o red silinir', async () => {
    setState({ rejected: [rejectedPerde] });
    render(<SyncStatus />);
    const drawer = await openDrawer();
    await userEvent.click(within(drawer).getByRole('button', { name: 'Vazgeç' }));
    expect(controller.discardRejected).not.toHaveBeenCalled();
    const confirm = await screen.findByRole('dialog', { name: /vazgeç/i });
    expect(confirm).toHaveTextContent('Perde');
    expect(confirm).toHaveTextContent(/Sheets'e yazılmayacak/);
    await userEvent.click(within(confirm).getByRole('button', { name: 'Geri dön' }));
    expect(controller.discardRejected).not.toHaveBeenCalled();
    await userEvent.click(within(drawer).getByRole('button', { name: 'Vazgeç' }));
    await userEvent.click(within(await screen.findByRole('dialog', { name: /vazgeç/i })).getByRole('button', { name: 'Değişikliği sil' }));
    expect(controller.discardRejected).toHaveBeenCalledWith('op-a');
  });

  it('bekleyen ve çevrimdışı durumu programatik durum metninde; rutin eşitlenmiş durumda metin boş (gevezelik yok)', () => {
    render(<SyncStatus />);
    expect(screen.getByRole('status')).toHaveTextContent('');
    // Store dışarıdan değişir (controller); React dışı güncelleme act içinde akıtılır.
    act(() => { setState({ status: 'offline', outbox: [{ op: { op: 'upsert', table: 'kalemler', id: 'B', opId: 'op-b', patch: { adet: 1 } }, ts: 't', attempts: 0 }] }); });
    expect(screen.getByRole('status')).toHaveTextContent('Çevrimdışı · 1 bekleyen');
    expect(statusButton()).toHaveAttribute('aria-label', expect.stringMatching(/Çevrimdışı/));
  });

  it('kuyruk olağandan uzunsa çekmece bunu söyler, hiçbir işlem atılmış değildir', async () => {
    const outbox: QueuedOp[] = Array.from({ length: 201 }, (_, i) => ({ op: { op: 'upsert', table: 'kalemler', id: `K${i}`, opId: `op-${i}`, patch: { adet: i } }, ts: 't', attempts: 0 }));
    setState({ status: 'offline', outbox });
    render(<SyncStatus />);
    const drawer = await openDrawer();
    expect(drawer).toHaveTextContent('201 bekleyen');
    expect(drawer).toHaveTextContent(/olağandan uzun/);
  });
});

describe('SyncStatus · çakışmalar', () => {
  it('çakışan kayıt adıyla listelenir; "Benimki kalsın" değerimi yeniden gönderir ve çakışmayı kapatır', async () => {
    setState({
      items: [{ id: 'L1', tip: 'aydinlatma', ad: 'Salon tavan', version: 4 }],
      conflicts: [{ id: 'L1', table: 'kalemler', keys: ['lux_min'], serverValues: { lux_min: 100 }, myValues: { lux_min: 300 }, updatedBy: 'gul' }],
    });
    render(<SyncStatus />);
    expect(statusButton()).toHaveAttribute('aria-label', expect.stringMatching(/çakışma/));
    const drawer = await openDrawer();
    const row = within(drawer).getByTestId('sync-conflict-item');
    expect(row).toHaveTextContent('Salon tavan');
    expect(row).toHaveTextContent('gul');
    expect(row).toHaveTextContent('300');
    expect(row).toHaveTextContent('100');
    await userEvent.click(within(row).getByRole('button', { name: 'Benimki kalsın' }));
    expect(controller.upsert).toHaveBeenCalledWith('kalemler', 'L1', { lux_min: 300 });
    expect(within(drawer).queryByTestId('sync-conflict-item')).toBeNull();
  });

  it('"Sheets\'teki kalsın" yazım yapmadan çakışmayı kapatır', async () => {
    setState({ conflicts: [{ id: 'L1', table: 'kalemler', keys: ['lux_min'], serverValues: { lux_min: 100 }, myValues: { lux_min: 300 } }] });
    render(<SyncStatus />);
    const drawer = await openDrawer();
    await userEvent.click(within(drawer).getByRole('button', { name: "Sheets'teki kalsın" }));
    expect(controller.upsert).not.toHaveBeenCalled();
    expect(within(drawer).queryByTestId('sync-conflict-item')).toBeNull();
  });
});
