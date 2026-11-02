// Projeler ve görevler sayfası: sentetik nesil (fixtures/generation-synthetic) → GenerationProvider + FixtureGenerationSource.
// Doğrulananlar: başlık iskeleti, özet (plan ve gerçek ayrı), yükleniyor/boş/hata/eski durumları gerçek veri durumundan,
// görev tablosu (durum, plan ve gerçek ayrı sütun, eksik bilgi adıyla), Kanban (workflow sırası), Gantt (yalnız
// başlangıç+bitişi olanlar; tarihsizler yanda), kontroller (geçti/kaldı/eksik ayrı), şablonlar (gerçek görev değil).
// Seçiciler role/label ile; antd iç sınıflarına bağlı seçici yok.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReactNode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { FixtureGenerationSource, GenerationProvider } from '../data';
import { DeviceContext } from '../device';
import type { Device } from '../shell/contracts';
import { ProjelerPage, ganttPlan } from './ProjelerPage';

// --- Sentetik nesil → bellek -------------------------------------------------------------------------
const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = join(here, '../../../fixtures/generation-synthetic');
const GENERATION_ID = readdirSync(FIXTURE_ROOT).find(name => statSync(join(FIXTURE_ROOT, name)).isDirectory())!;
const GENERATION_DIR = join(FIXTURE_ROOT, GENERATION_ID);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.json')) out.push(full);
  }
  return out;
}

const FILES: Record<string, string> = Object.fromEntries(
  walk(GENERATION_DIR)
    .map(full => relative(GENERATION_DIR, full))
    .filter(rel => rel === 'manifest.json' || rel.startsWith('data/'))
    .map(rel => [rel, readFileSync(join(GENERATION_DIR, rel), 'utf8')]),
);

interface ManifestLike { files: { path: string; kind: string; collection?: string }[]; counts: Record<string, number> }

/** Nesilde iki koleksiyon hiç yokmuş gibi: manifest'ten parçaları ve sayımları düşer (depo "boş ve hatasız" döner). */
function manifestWithout(collections: readonly string[]): string {
  const manifest = JSON.parse(FILES['manifest.json']!) as ManifestLike;
  manifest.files = manifest.files.filter(file => !(file.kind === 'partition' && collections.includes(file.collection ?? '')));
  for (const name of collections) delete manifest.counts[name];
  return JSON.stringify(manifest);
}

function fixtureSource(overrides: Record<string, string | null> = {}): FixtureGenerationSource {
  const files = { ...FILES };
  for (const [path, text] of Object.entries(overrides)) {
    if (text === null) delete files[path];
    else files[path] = text;
  }
  return new FixtureGenerationSource(files, 'sentetik');
}

// Sabit "bugün": fixture tarihleri 2026-11 … 2027-09; geciken/bu hafta hesabı test gününe bağlı olmasın.
const NOW = new Date('2026-11-02T09:00:00+03:00');

function renderPage({ device = 'desktop', source = fixtureSource() }: { device?: Device; source?: FixtureGenerationSource } = {}) {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <DeviceContext.Provider value={device}>
      <GenerationProvider source={source} cache={null} changeSet={null}>
        {children}
      </GenerationProvider>
    </DeviceContext.Provider>
  );
  return render(<ProjelerPage now={() => NOW} />, { wrapper: Wrapper });
}

const gorevTablosu = () => screen.findByRole('table', { name: 'Görevler' });
const hucre = (satir: HTMLElement, sutun: string) => within(satir).getByRole('cell', { name: sutun });

describe('ProjelerPage › başlık ve özet', () => {
  it('bölüm → h1 → amaç; tazelik satırı nesil okununca "Son okuma" ve "Nesil" yazar', async () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Projeler ve görevler' })).toBeInTheDocument();
    expect(screen.getByText('İşler')).toBeInTheDocument();
    expect(screen.getByText('Ev projelerini ve görevlerini kim, ne zaman ve hangi sırayla yapacak, görün.')).toBeInTheDocument();
    // Kök neden (tam takımda düşüyordu): depo işleri sıralıdır; her koleksiyon okuması durumu "checking"e çevirir ve
    // tazelik satırı ancak son koleksiyon da okununca "Nesil …" der. Tek findByText bütün zinciri (soğuk ilk render +
    // altı koleksiyon) tek bekleme penceresine sığdırmaya çalışıyordu. Sayfanın kendi aşama sinyalleri sırayla beklenir:
    // görev tablosu → hiçbir bölüm iskeleti kalmaz → tazelik satırı "fresh".
    await gorevTablosu();
    await waitFor(() => expect(screen.queryAllByRole('status', { busy: true })).toHaveLength(0));
    const durum = await screen.findByText(`Nesil ${GENERATION_ID.slice(0, 6)}`);
    expect(durum).toBeInTheDocument();
    expect(durum).toHaveAttribute('data-generation-id', GENERATION_ID);
    expect(screen.getByText(/^Son okuma /)).toBeInTheDocument();
  });

  it('özet en çok üç ölçü; Planlanan ve Gerçekleşen ayrı girdilerdir, eksikler sayıyla adlandırılır', async () => {
    renderPage();
    await gorevTablosu();
    const ozet = screen.getByRole('list', { name: 'Özet' });
    const olcular = within(ozet).getAllByRole('listitem');
    expect(olcular).toHaveLength(3);
    expect(olcular[0]).toHaveTextContent('Açık görev');
    expect(olcular[0]).toHaveTextContent('9');
    // 8 iş: 290.400,00 planlanan; 4 kilometre taşının fiyatı yok.
    expect(olcular[1]).toHaveTextContent('Planlanan');
    expect(olcular[1]).toHaveTextContent('₺290.400,00');
    expect(olcular[1]).toHaveTextContent('4 fiyatsız');
    // Gerçekleşen yalnız 3 kurulan işte; plan ile toplanmaz.
    expect(olcular[2]).toHaveTextContent('Gerçekleşen');
    expect(olcular[2]).toHaveTextContent('₺103.300,00');
    expect(olcular[2]).toHaveTextContent('9 henüz yok');
    expect(ozet).not.toHaveTextContent('₺393.700,00');
  });
});

describe('ProjelerPage › veri durumları', () => {
  it('okunurken LoadingShell (iskelet, aria-busy; döner simge yok), veri gelince kaybolur', async () => {
    renderPage();
    const iskeletler = screen.getAllByRole('status', { busy: true });
    expect(iskeletler.length).toBeGreaterThan(0);
    expect(iskeletler[0]).toHaveTextContent('Yükleniyor');
    await gorevTablosu();
    await waitFor(() => expect(screen.queryAllByRole('status', { busy: true })).toHaveLength(0));
  });

  it('nesilde görev koleksiyonu yoksa dürüst metin: "Kaynakta görev kaydı yok"', async () => {
    renderPage({ source: fixtureSource({ 'manifest.json': manifestWithout(['work_orders', 'milestones']) }) });
    expect(await screen.findByRole('heading', { name: 'Kaynakta görev kaydı yok' })).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Görevler' })).not.toBeInTheDocument();
    // Kontroller ve şablonlar yine de okunur: bölüm başlıkları durur.
    expect(await screen.findByRole('heading', { name: 'Kontroller' })).toBeInTheDocument();
  });

  it('manifest okunamazsa ErrorState "Hata: …" + "Yeniden dene"; eski tutar gösterilmez', async () => {
    renderPage({ source: fixtureSource({ 'manifest.json': '{bozuk' }) });
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('heading')).toHaveTextContent(/^Hata: /);
    expect(within(alert).getByRole('button', { name: 'Yeniden dene' })).toBeInTheDocument();
    expect(screen.queryByText('₺290.400,00')).not.toBeInTheDocument();
  });

  it('kontrol parçası bozuksa yalnız o bölüm hatayı söyler, görevler gösterilir', async () => {
    renderPage({ source: fixtureSource({ 'data/inspections/household/00000.json': null }) });
    await gorevTablosu();
    const kontroller = screen.getByRole('region', { name: 'Kontroller' });
    expect(within(kontroller).getByRole('alert')).toHaveTextContent(/^Hata: /);
  });
});

describe('ProjelerPage › görev tablosu (masaüstü)', () => {
  it('iş ve kilometre taşları tek tabloda; durum sözcükle; Planlanan ve Gerçekleşen ayrı sütun; eksik bilgi adıyla', async () => {
    renderPage();
    const tablo = await gorevTablosu();
    const is2 = within(tablo).getByRole('row', { name: /Örnek tadilat işi 2/ });
    expect(hucre(is2, 'Kuruldu')).toBeInTheDocument();
    expect(hucre(is2, '₺17.000,00')).toBeInTheDocument();
    expect(hucre(is2, '₺8.200,00')).toBeInTheDocument();
    expect(within(is2).getByRole('cell', { name: /IS-2/ })).toBeInTheDocument();
    expect(within(is2).getByRole('cell', { name: /03\.12\.2026/ })).toBeInTheDocument();
    expect(within(is2).getByRole('cell', { name: /20\.12\.2026/ })).toBeInTheDocument();

    const kt1 = within(tablo).getByRole('row', { name: /Örnek kilometre taşı 1/ });
    expect(hucre(kt1, 'Fiyat yok')).toBeInTheDocument();
    expect(hucre(kt1, 'Henüz yok')).toBeInTheDocument();
    expect(within(kt1).getAllByRole('cell', { name: 'Bilinmiyor' })).toHaveLength(2); // oda ve sorumlu yok

    // Kontroller görev tablosunda değil.
    expect(within(tablo).queryByRole('row', { name: /Örnek kontrol 1/ })).not.toBeInTheDocument();
    // Gövde satırı: 8 iş + 4 kilometre taşı (antd başlığı ayrı tabloda tutar; adlı tablo gövdedir).
    expect(within(tablo).getAllByRole('row')).toHaveLength(12);
  });

  it('arama kayıt adını ve kodunu daraltır; sonuç yoksa etkin filtre yazılır ve temizlenebilir', async () => {
    const user = userEvent.setup();
    renderPage();
    await gorevTablosu();
    const ara = screen.getByRole('searchbox', { name: 'Ara' });
    await user.type(ara, 'KT-3');
    const tablo = await gorevTablosu();
    expect(within(tablo).getAllByRole('row')).toHaveLength(1);
    await user.clear(ara);
    await user.type(ara, 'yok böyle bir görev');
    expect(await screen.findByRole('heading', { name: 'Bu filtrelerle kayıt yok' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Filtreleri temizle' }));
    expect(within(await gorevTablosu()).getAllByRole('row')).toHaveLength(12);
  });
});

describe('ProjelerPage › görünüm modları', () => {
  it('Liste, Zaman çizelgesi ve Pivot devre dışı; gerekçesi yazılır', async () => {
    renderPage();
    await gorevTablosu();
    const mod = screen.getByRole('radiogroup', { name: 'Görünüm modu' });
    expect(within(mod).getByRole('radio', { name: 'Pivot' })).toBeDisabled();
    expect(within(mod).getByRole('radio', { name: 'Kanban' })).toBeEnabled();
    expect(within(mod).getByRole('radio', { name: 'Gantt' })).toBeEnabled();
    expect(screen.getByText(/Pivot kullanılamaz: görevlerde toplanacak tutar alanı yok\./)).toBeInTheDocument();
  });

  it('Kanban: sütunlar teslimat iş akışının sırasıyla; kayıt sayıları durum sözcüğüyle', async () => {
    const user = userEvent.setup();
    renderPage();
    await gorevTablosu();
    // Segment radyosu görsel gizli (pointer-events none); etiketine tıklanır (Tabs.test ile aynı).
    await user.click(screen.getByText('Kanban'));
    const pano = await screen.findByRole('region', { name: 'Duruma göre görevler' });
    const sutunlar = within(pano).getAllByRole('region').map(sutun => sutun.getAttribute('aria-label'));
    // fulfillment iş akışı: Alınacak → Sipariş edildi → Teslim edildi → Kuruldu (→ İptal); kilometre taşları Karar verildi.
    expect(sutunlar.slice(0, 4)).toEqual(['Alınacak', 'Sipariş edildi', 'Teslim edildi', 'Kuruldu']);
    expect(sutunlar).toContain('Karar verildi');
    expect(within(within(pano).getByRole('region', { name: 'Kuruldu' })).getByText('3 kayıt')).toBeInTheDocument();
    expect(within(within(pano).getByRole('region', { name: 'Alınacak' })).getByText('5 kayıt')).toBeInTheDocument();
    expect(within(within(pano).getByRole('region', { name: 'Sipariş edildi' })).getByText('Bu durumda kayıt yok.')).toBeInTheDocument();
  });

  it('Gantt: haftalık çizelge yalnız başlangıç ve bitişi olan iş/kilometre taşı için; tarihsizler yanda adıyla', async () => {
    const user = userEvent.setup();
    renderPage();
    await gorevTablosu();
    await user.click(screen.getByText('Gantt'));
    const cizelge = await screen.findByRole('region', { name: 'Gantt çizelgesi, yana kaydırılabilir' });
    // Hafta başlıkları: ilk hafta 02.11 (NOW'un pazartesisi), fixture'ın son bitişi 15.09.2027'yi kapsar.
    expect(within(cizelge).getByRole('columnheader', { name: /02\.11/ })).toBeInTheDocument();
    expect(within(cizelge).getByText('Bu hafta')).toBeInTheDocument();
    expect(within(cizelge).getByRole('columnheader', { name: /13\.09/ })).toBeInTheDocument();
    // 12 çubuk: 8 iş + 4 kilometre taşı; kontroller yok.
    const cubuklar = within(cizelge).getAllByRole('img');
    expect(cubuklar).toHaveLength(12);
    expect(within(cizelge).getByRole('img', { name: 'Örnek tadilat işi 2: 03.12.2026 – 20.12.2026' })).toBeInTheDocument();
    expect(within(cizelge).queryByText(/Örnek kontrol/)).not.toBeInTheDocument();
    const tarihsiz = screen.getByRole('region', { name: 'Tarihsiz' });
    expect(tarihsiz).toHaveTextContent('Tarihsiz kayıt yok');
  });

  // Parça içeriği değişince manifest sha256'sı tutmaz (IntegrityError); tarihsiz kayıt Gantt planının saf yardımcısıyla sınanır.
  it('ganttPlan: yalnız başlangıç ve bitişi olan kayıt çubuk olur; tek tarihli ya da tarihsiz kayıt "Tarihsiz" listesine gider', () => {
    const plan = ganttPlan(
      [
        { id: 'a', label: 'İkisi var', start: '2026-11-03', end: '2026-11-20' },
        { id: 'b', label: 'Yalnız başlangıç', start: '2026-11-03', end: null },
        { id: 'c', label: 'Yalnız bitiş', start: null, end: '2026-12-01' },
        { id: 'd', label: 'Hiç yok', start: null, end: null },
        { id: 'e', label: 'Ters tarih', start: '2026-12-01', end: '2026-11-01' },
      ],
      NOW,
    );
    expect(plan.dated.map(row => row.id)).toEqual(['a']);
    expect(plan.undated.map(row => row.label)).toEqual(['Yalnız başlangıç', 'Yalnız bitiş', 'Hiç yok', 'Ters tarih']);
    // Hafta sütunları NOW'un pazartesisinden (02.11.2026) başlar; çubuk 1. ve 3. hafta arasında (03.11 → 20.11).
    expect(plan.weeks[0]!.label).toBe('02.11');
    expect(plan.weeks[0]!.current).toBe(true);
    expect(plan.dated[0]).toMatchObject({ startWeek: 0, endWeek: 2 });
  });
});

describe('ProjelerPage › kontroller ve şablonlar', () => {
  it('kontrol sonuçları ayrı sayılır: Geçti / Kaldı / Eksik; sonuç sözcükle yazılır', async () => {
    renderPage();
    await gorevTablosu();
    const bolum = screen.getByRole('region', { name: 'Kontroller' });
    const sayimlar = within(bolum).getByRole('list', { name: 'Kontrol sonuçları' });
    expect(within(sayimlar).getByText('Geçti')).toBeInTheDocument();
    expect(within(sayimlar).getByText('Kaldı')).toBeInTheDocument();
    expect(within(sayimlar).getByText('Eksik')).toBeInTheDocument();
    const [gecti, kaldi, eksik] = within(sayimlar).getAllByRole('listitem');
    expect(gecti).toHaveTextContent('2');
    expect(kaldi).toHaveTextContent('0');
    expect(eksik).toHaveTextContent('3');
    const liste = within(bolum).getByRole('table', { name: 'Kontroller' });
    const k1 = within(liste).getByRole('row', { name: /Örnek kontrol 1/ });
    expect(hucre(k1, 'Geçti')).toBeInTheDocument();
    const k4 = within(liste).getByRole('row', { name: /Örnek kontrol 4/ });
    expect(hucre(k4, 'Eksik')).toBeInTheDocument();
  });

  it('görev şablonları ayrı bölümde, gerçek görev olmadığı yazılı; 15 şablon başlığıyla listelenir', async () => {
    renderPage();
    await gorevTablosu();
    const bolum = screen.getByRole('region', { name: 'Önerilen görev şablonları' });
    expect(bolum).toHaveTextContent('Bunlar gerçek görev değil');
    expect(bolum).toHaveTextContent('15 şablon');
    expect(within(bolum).getByText('Ev ve taşınma kapsamını belirle')).toBeInTheDocument();
    expect(within(bolum).getByText('Yeni veya kapsamı değişen ev projesi')).toBeInTheDocument();
  });
});

describe('ProjelerPage › telefon', () => {
  it('tablo akordeona döner, durum grupları başlık olur; Gantt dar biçimde yana kayar', async () => {
    const user = userEvent.setup();
    renderPage({ device: 'phone' });
    await waitFor(() => expect(screen.queryAllByRole('status', { busy: true })).toHaveLength(0));
    expect(screen.queryByRole('table', { name: 'Görevler' })).not.toBeInTheDocument();
    // Akordeon grup başlığı: durum sözcüğü + sayım ("Kuruldu 3").
    expect(screen.getByRole('heading', { name: /^Kuruldu/ })).toHaveTextContent('3');
    expect(screen.getByRole('heading', { name: /^Alınacak/ })).toHaveTextContent('5');
    // Telefonda mod seçimi combobox'a düşer (5+ seçenek).
    await user.click(screen.getByRole('combobox', { name: 'Görünüm modu' }));
    await user.click(await screen.findByRole('option', { name: /^Gantt/ }));
    const cizelge = await screen.findByRole('region', { name: 'Gantt çizelgesi, yana kaydırılabilir' });
    expect(cizelge).toHaveAttribute('data-narrow', 'true');
  });
});
