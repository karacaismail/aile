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
    expect(within(first).getAllByRole('term').map((t) => t.textContent)).toEqual(['Tip', 'Ad', 'Mevcut (elimizde)']);
    expect(within(first).getAllByRole('definition').map((d) => d.textContent)).toEqual(['Satınalma', 'Perde', 'hayır']);
    expect(first).not.toHaveTextContent(/Oda/);
    expect(first).not.toHaveTextContent(/Linkler/);
    expect(second).toHaveTextContent('Düzenleme');
    expect(within(second).getAllByRole('term').map((t) => t.textContent)).toEqual(['Not']);
    expect(within(second).getByRole('definition')).toHaveTextContent('—');
  });

  it('okuma sırası: kayıt adı → neden → eylemler → alan değerleri (etiket/değer listesi, her zaman açık)', async () => {
    setState({ rejected: [rejectedPerde] });
    render(<SyncStatus />);
    const drawer = await openDrawer();
    const item = within(drawer).getByTestId('sync-rejected-item');
    const reason = within(item).getByText(/izinli değerler/);
    const retry = within(item).getByRole('button', { name: 'Yeniden dene' });
    const details = within(item).getByRole('group', { name: 'Kaydedilen değerler' });
    const before = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(before(reason, retry)).toBe(true);
    expect(before(retry, details)).toBe(true);
    // Değerler anlamsal etiket/değer çiftleri; noktalı tek paragraf değil.
    expect(within(details).getAllByRole('term').map((t) => t.textContent)).toEqual(['Durum', 'Adet']);
    expect(within(details).getAllByRole('definition').map((d) => d.textContent)).toEqual(['yanlis', '3']);
    expect(within(item).queryByText(/Durum: yanlis · Adet: 3/)).toBeNull();
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

  // Son durum kontrolü: jsdom, Mantine'in 10 ms odak-dönüş zamanlamasını üretmez (bu test düzeltmeden önce de geçiyordu).
  // Gerçek regresyon kapısı e2e/sync-recovery.spec.ts "klavyeyle onaylanan Vazgeç" (Chromium 320 + WebKit).
  for (const count of [1, 2]) it(`klavyeyle onaylanan "Vazgeç" sonrası odak çekmecede kalır (${count} red)`, async () => {
    const second: QueuedOp = { ...rejectedPerde, op: { ...rejectedPerde.op, id: 'B', opId: 'op-b' }, rejection: { ...rejectedPerde.rejection!, label: 'Koltuk' } };
    setState({ rejected: count === 1 ? [rejectedPerde] : [rejectedPerde, second] });
    // Gerçek controller gibi: red kaydı store'dan kalkar (Vazgeç satırı DOM'dan silinir).
    vi.mocked(controller.discardRejected).mockImplementation(async (opId) => { setState((s) => ({ rejected: s.rejected.filter((q) => q.op.opId !== opId) })); });
    render(<SyncStatus />);
    const drawer = await openDrawer();
    const discard = within(drawer).getAllByRole('button', { name: 'Vazgeç' })[0];
    discard.focus();
    await userEvent.keyboard('{Enter}');
    const confirm = await screen.findByRole('dialog', { name: /vazgeç/i });
    within(confirm).getByRole('button', { name: 'Değişikliği sil' }).focus();
    await userEvent.keyboard('{Enter}');
    await vi.waitFor(() => expect(screen.queryByRole('dialog', { name: /vazgeç/i })).toBeNull());
    expect(within(drawer).queryAllByTestId('sync-rejected-item')).toHaveLength(count - 1);
    await vi.waitFor(() => expect(document.activeElement).not.toBe(document.body));
    expect(drawer.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(count === 1 ? within(drawer).getByRole('button', { name: 'Şimdi eşitle' }) : within(drawer).getByRole('heading', { name: 'Gönderilemeyen değişiklikler' }));
  });

  it('bekleyen ve çevrimdışı durumu programatik durum metninde; rutin eşitlenmiş durumda metin boş (gevezelik yok)', () => {
    render(<SyncStatus />);
    expect(screen.getByRole('status')).toHaveTextContent('');
    // Store dışarıdan değişir (controller); React dışı güncelleme act içinde akıtılır.
    act(() => { setState({ status: 'offline', outbox: [{ op: { op: 'upsert', table: 'kalemler', id: 'B', opId: 'op-b', patch: { adet: 1 } }, ts: 't', attempts: 0 }] }); });
    expect(screen.getByRole('status')).toHaveTextContent('Çevrimdışı · 1 bekleyen');
    expect(statusButton()).toHaveAttribute('aria-label', expect.stringMatching(/Çevrimdışı/));
    // Çevrimiçi kaydetmedeki anlık "1 bekleyen" duyurulmaz (her kayıtta gevezelik olmasın); rozet ve etiket yine sayar.
    act(() => { setState({ status: 'syncing' }); });
    expect(screen.getByRole('status')).toHaveTextContent('');
    expect(statusButton()).toHaveAttribute('aria-label', 'Senkron: Eşitleniyor · 1 bekleyen');
  });

  it('red varken çevrimdışı/ayarsız/hata durumu etiketten ve başlıktan düşmez', async () => {
    setState({ status: 'offline', rejected: [rejectedPerde], outbox: [{ op: { op: 'upsert', table: 'kalemler', id: 'B', opId: 'op-b', patch: { adet: 1 } }, ts: 't', attempts: 0 }] });
    render(<SyncStatus />);
    expect(statusButton()).toHaveAttribute('aria-label', 'Senkron: 1 değişiklik gönderilemedi · Çevrimdışı · 1 bekleyen');
    expect(screen.getByRole('status')).toHaveTextContent('Çevrimdışı · 1 bekleyen · 1 değişiklik gönderilemedi');
    const drawer = await openDrawer();
    expect(within(drawer).getByText('1 değişiklik gönderilemedi · Çevrimdışı')).toBeInTheDocument();
    act(() => { setState({ status: 'unconfigured' }); });
    expect(statusButton()).toHaveAttribute('aria-label', expect.stringMatching(/Sheets bağlantısı ayarlanmadı/));
  });

  it('not_found reddinde yeniden denemenin satır geri gelmeden başarmayacağı söylenir', async () => {
    setState({ rejected: [{ ...rejectedPerde, op: { op: 'delete', table: 'kalemler', id: 'A', opId: 'op-del' }, rejection: { at: 't', code: 'not_found', message: "Kayıt bulunamadı (Sheets'te silinmiş olabilir)", label: 'Perde' } }] });
    render(<SyncStatus />);
    const drawer = await openDrawer();
    const item = within(drawer).getByTestId('sync-rejected-item');
    expect(item).toHaveTextContent('Silme');
    expect(item).toHaveTextContent(/yeniden deneme başarmaz/);
  });

  it('klavyeyle "Yeniden dene" sonrası odak çekmecede kalır (satır kalkınca "Şimdi eşitle" düğmesine)', async () => {
    setState({ rejected: [rejectedPerde] });
    render(<SyncStatus />);
    const drawer = await openDrawer();
    const retry = within(drawer).getByRole('button', { name: 'Yeniden dene' });
    retry.focus();
    await userEvent.keyboard('{Enter}');
    expect(controller.retryRejected).toHaveBeenCalledWith('op-a');
    act(() => { setState({ rejected: [] }); }); // controller kuyruğa taşıdı, satır kalktı
    expect(within(drawer).queryByTestId('sync-rejected-item')).toBeNull();
    expect(within(drawer).getByRole('button', { name: 'Şimdi eşitle' })).toHaveFocus();
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
