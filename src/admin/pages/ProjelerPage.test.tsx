// Projeler ve görevler sayfası: sentetik nesil (fixtures/generation-synthetic) → GenerationProvider + FixtureGenerationSource.
// Doğrulananlar: başlık iskeleti (bölüm, h1, amaç, ana eylem), özet (plan ve gerçek ayrı), veri durumları (yükleniyor,
// boş, hata, eski veri) adıyla; telefon yolculuğu (proje listesi → proje ayrıntısı → görevler, alttan açılan seçim,
// "Listeye dön" odağı); geniş görünüm (lazyWide: tablo, arama, Kanban, Gantt, Proje filtresi); kontroller (geçti / kaldı /
// eksik ayrı); şablonlar (Türkçe ad + sürüm; ham makine anahtarı yalnız ayrıntıda "Teknik anahtar" etiketiyle); telefon
// yolunun geniş-özel kodu statik içe aktarmadığı. Seçiciler role/label ile; antd iç sınıflarına bağlı seçici yok.
//
// Bekleme kalıbı (tam paketteki "Nesil d062d4" zaman aşımının kökü): depo koleksiyonları sırayla okur ve her okuma
// durumu checking → ready çevirir. Sayfa eskiden yalnız üç koleksiyonu beklerken görev satırlarını çiziyordu; useRows'un
// istediği odalar/ilişkiler/medya/sözlükler hâlâ okunurken tablo görünür, "Nesil" ise ancak en son koleksiyonla
// gelirdi; test her aşamayı ayrı 1 sn'lik pencerede bekliyordu. Artık sayfa okuduğu her koleksiyon gelene kadar
// iskeleti (aria-busy) korur; testler tek bir gerçek hazır sinyalini bekler: hiçbir aria-busy kalmadı VE tazelik satırı
// "Nesil …" diyor. Bu G/Ç bekleyişinin bütçesi VERI_BEKLEME_MS'dir (routes.test.tsx ile aynı kalıp); doğrulama eşiği değildir.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { importsOf } from '../adaptive/sourceRules';
import { FixtureGenerationSource, GenerationProvider, type GenerationSource, type TaskTemplate } from '../data';
import { DeviceContext } from '../device';
import type { Device } from '../shell/contracts';
import { ProjelerPage, ganttPlan, projeGruplari, sablonGorunumleri, type GorevSatiri } from './ProjelerPage';

// --- Sentetik nesil → bellek -------------------------------------------------------------------------
const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = join(here, '../../../fixtures/generation-synthetic');
const GENERATION_ID = readdirSync(FIXTURE_ROOT).find(name => statSync(join(FIXTURE_ROOT, name)).isDirectory())!;
const GENERATION_DIR = join(FIXTURE_ROOT, GENERATION_ID);
const NESIL = `Nesil ${GENERATION_ID.slice(0, 6)}`;

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

/** Belirli dosyaların okunmasını test açana kadar bekletir (koleksiyonlar sırayla gelir; ara durum gözlenir). */
class KapiliKaynak implements GenerationSource {
  readonly kind = 'fixture' as const;
  readonly label = 'kapılı';
  private readonly inner = fixtureSource();
  private readonly kapilar = new Map<string, { promise: Promise<void>; ac(): void }>();
  constructor(kapali: readonly string[]) {
    for (const path of kapali) {
      let ac = () => {};
      const promise = new Promise<void>(resolve => { ac = resolve; });
      this.kapilar.set(path, { promise, ac });
    }
  }
  async readText(path: string): Promise<string> {
    await this.kapilar.get(path)?.promise;
    return this.inner.readText(path);
  }
  ac(path: string): void { this.kapilar.get(path)?.ac(); }
}

/** İlk okuma sağlam; sonra manifest okunamaz (ağ hatası) → depo son iyi nesli korur: "eski veri" (stale). */
class BozulanKaynak implements GenerationSource {
  readonly kind = 'fixture' as const;
  readonly label = 'bozulan';
  bozuk = false;
  private readonly inner = fixtureSource();
  async readText(path: string): Promise<string> {
    if (this.bozuk && path === 'manifest.json') throw new Error('ağ yok');
    return this.inner.readText(path);
  }
}

// Sabit "bugün": fixture tarihleri 2026-11 … 2027-09; geciken/bu hafta hesabı test gününe bağlı olmasın.
const NOW = new Date('2026-11-02T09:00:00+03:00');
/** Gerçek veri okumasının (sha256 doğrulamalı, sıralı) G/Ç bütçesi; bkz. dosya başı. */
const VERI_BEKLEME_MS = 10_000;
const TEST_MS = 30_000;

function renderPage({ device = 'desktop', source = fixtureSource() }: { device?: Device; source?: GenerationSource } = {}) {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <DeviceContext.Provider value={device}>
      <GenerationProvider source={source} cache={null} changeSet={null}>
        {children}
      </GenerationProvider>
    </DeviceContext.Provider>
  );
  return render(<ProjelerPage now={() => NOW} />, { wrapper: Wrapper });
}

/** Gerçek hazır sinyali: hiçbir iskelet aria-busy değil ve tazelik satırı nesli yazıyor. */
async function sayfaHazir() {
  await waitFor(() => {
    expect(document.querySelectorAll('[aria-busy="true"]')).toHaveLength(0);
    expect(screen.getByText(NESIL)).toBeInTheDocument();
  }, { timeout: VERI_BEKLEME_MS });
}

/** Geniş profil: sayfa hazır + geniş modül (lazyWide) yüklendi; görev tablosunu döndürür. */
async function genisHazir() {
  await sayfaHazir();
  return screen.findByRole('table', { name: 'Görevler' }, { timeout: VERI_BEKLEME_MS });
}

/** Gövde satırları (en az bir hücresi olan satır); başlık satırının nerede durduğundan bağımsız. */
const govdeSatirlari = (tablo: HTMLElement) => within(tablo).getAllByRole('row').filter(row => within(row).queryAllByRole('cell').length > 0);
const hucre = (satir: HTMLElement, sutun: string) => within(satir).getByRole('cell', { name: sutun });
const gorevDugmeleri = (kap: HTMLElement) => within(kap).getAllByRole('button', { name: /^Örnek (tadilat işi|kilometre taşı) \d/ });

describe('ProjelerPage › başlık ve özet', () => {
  it('bölüm → h1 → amaç → ana eylem (nedeni yazılı); tazelik satırı hazır olunca "Son okuma" ve "Nesil" yazar', async () => {
    renderPage({ device: 'phone' });
    expect(screen.getByRole('heading', { level: 1, name: 'Projeler ve görevler' })).toBeInTheDocument();
    expect(screen.getByText('İşler')).toBeInTheDocument();
    expect(screen.getByText('Ev projelerini ve görevlerini kim, ne zaman ve hangi sırayla yapacak, görün.')).toBeInTheDocument();
    const ekle = screen.getByRole('button', { name: 'Görev ekle' });
    expect(ekle).toBeDisabled();
    expect(ekle).toHaveAccessibleDescription('Proje ve görev kaydı bu sürümde yalnız e-tablodan gelir; panelden ekleme henüz yok.');
    await sayfaHazir();
    const durum = screen.getByText(NESIL);
    expect(durum).toHaveAttribute('data-generation-id', GENERATION_ID);
    expect(screen.getByText(/^Son okuma /)).toBeInTheDocument();
  }, TEST_MS);

  it('özet en çok üç ölçü; Planlanan ve Gerçekleşen ayrı girdilerdir, eksikler sayıyla adlandırılır', async () => {
    renderPage({ device: 'phone' });
    await sayfaHazir();
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
  }, TEST_MS);
});

describe('ProjelerPage › veri durumları', () => {
  it('yükleniyor: LoadingShell iskeleti (aria-busy; döner simge yok), tazelik satırı "Okunuyor…"; veri gelince kaybolur', async () => {
    renderPage({ device: 'phone' });
    const iskeletler = screen.getAllByRole('status', { busy: true });
    expect(iskeletler.length).toBeGreaterThan(0);
    expect(iskeletler[0]).toHaveTextContent('Yükleniyor');
    expect(screen.getByText('Okunuyor…')).toBeInTheDocument();
    await sayfaHazir();
    expect(screen.queryAllByRole('status', { busy: true })).toHaveLength(0);
  }, TEST_MS);

  it('hazır sinyali: sayfanın okuduğu her koleksiyon gelmeden (ör. sözlükler) görev ve proje çizilmez; iskelet ile "Nesil" birlikte biter', async () => {
    // Sözlükler useRows'un en son istediği koleksiyondur; depo sırayla okuduğu için bekletilince ondan öncekiler gelir
    // (iş, kilometre taşı, terimler, odalar …). Eski sayfa bu ara durumda görevleri çiziyordu; tazelik satırı ise hâlâ
    // "Okunuyor…" diyordu (testlerin "Nesil" bekleyişi bu aralıkta zaman aşımına düşüyordu).
    const SOZLUKLER = 'data/vocabularies/global/00000.json';
    const kaynak = new KapiliKaynak([SOZLUKLER]);
    renderPage({ device: 'phone', source: kaynak });
    await waitFor(() => expect(screen.getAllByRole('status', { busy: true }).length).toBeGreaterThan(0));
    // Bekletilen dosyadan önceki okumalar bitsin (G/Ç sırası); sayfa hâlâ iskelette kalmalı.
    await waitFor(() => expect(screen.getByText('Okunuyor…')).toBeInTheDocument());
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(screen.queryByRole('region', { name: 'Projeler' })).not.toBeInTheDocument();
    expect(screen.queryAllByText(/^Örnek tadilat işi/)).toHaveLength(0);
    expect(screen.queryByRole('list', { name: 'Özet' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('status', { busy: true }).length).toBeGreaterThan(0);
    kaynak.ac(SOZLUKLER);
    await sayfaHazir();
    expect(screen.getByRole('button', { name: 'Taşınma öncesi' })).toBeInTheDocument();
  }, TEST_MS);

  it('boş: nesilde görev koleksiyonu yoksa dürüst metin "Kaynakta görev kaydı yok"; kontroller ve şablonlar yine okunur', async () => {
    renderPage({ device: 'phone', source: fixtureSource({ 'manifest.json': manifestWithout(['work_orders', 'milestones']) }) });
    expect(await screen.findByRole('heading', { name: 'Kaynakta görev kaydı yok' }, { timeout: VERI_BEKLEME_MS })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Projeler' })).not.toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Kontroller' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Önerilen görev şablonları' })).toBeInTheDocument();
  }, TEST_MS);

  it('hata: manifest okunamazsa ErrorState "Hata: …" + "Yeniden dene"; eski ya da kısmi tutar gösterilmez', async () => {
    renderPage({ device: 'phone', source: fixtureSource({ 'manifest.json': '{bozuk' }) });
    const alert = await screen.findByRole('alert', {}, { timeout: VERI_BEKLEME_MS });
    expect(within(alert).getByRole('heading')).toHaveTextContent(/^Hata: /);
    expect(within(alert).getByRole('button', { name: 'Yeniden dene' })).toBeInTheDocument();
    expect(screen.queryByText('₺290.400,00')).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Özet' })).not.toBeInTheDocument();
  }, TEST_MS);

  it('kısmi hata: kontrol parçası yoksa yalnız o bölüm hatayı söyler; projeler gösterilir', async () => {
    renderPage({ device: 'phone', source: fixtureSource({ 'data/inspections/household/00000.json': null }) });
    const kontroller = await screen.findByRole('region', { name: 'Kontroller' }, { timeout: VERI_BEKLEME_MS });
    expect(await within(kontroller).findByRole('alert', {}, { timeout: VERI_BEKLEME_MS })).toHaveTextContent(/^Hata: /);
    expect(screen.getByRole('region', { name: 'Projeler' })).toBeInTheDocument();
  }, TEST_MS);

  it('eski veri: yenileme başarısızsa son iyi nesil gösterilmeye devam eder, tazelik satırı "yenilenemedi" der', async () => {
    const user = userEvent.setup();
    const kaynak = new BozulanKaynak();
    renderPage({ device: 'phone', source: kaynak });
    await sayfaHazir();
    kaynak.bozuk = true;
    await user.click(screen.getByRole('button', { name: 'Yenile' }));
    await waitFor(() => expect(screen.getByText('yenilenemedi')).toBeInTheDocument(), { timeout: VERI_BEKLEME_MS });
    expect(screen.getByText(/^Son başarılı nesil /)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Yeniden dene' })).toBeInTheDocument();
    // Son iyi veri yerinde: projeler ve özet okunur.
    expect(screen.getByRole('button', { name: 'Taşınma öncesi' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Özet' })).toHaveTextContent('₺290.400,00');
  }, TEST_MS);
});

describe('ProjelerPage › telefon yolculuğu (proje listesi → proje ayrıntısı → görevler)', () => {
  it('proje listesi: kaynakta proje kaydı olmadığı yazılı; görevler proje aşamasına göre iki projede, plan ve gerçek ayrı', async () => {
    renderPage({ device: 'phone' });
    await sayfaHazir();
    const projeler = screen.getByRole('region', { name: 'Projeler' });
    expect(projeler).toHaveTextContent('Kaynakta ayrı proje kaydı yok; görevler proje aşamasına göre toplanır.');
    expect(projeler).toHaveTextContent('2 proje · 12 görev');
    const dugmeler = within(projeler).getAllByRole('button');
    expect(dugmeler.map(dugme => dugme.getAttribute('data-proje-ad'))).toEqual(['Taşınma öncesi', 'Taşınma sonrası']);

    const once = within(projeler).getByRole('button', { name: 'Taşınma öncesi' });
    expect(once).toHaveAccessibleDescription(/10 görev · 7 açık/);
    expect(once).toHaveAccessibleDescription(/03\.11\.2026 – 20\.06\.2027/);
    expect(within(once).getByText('Planlanan')).toBeInTheDocument();
    expect(within(once).getByText('₺290.400,00')).toBeInTheDocument();
    expect(within(once).getByText('Gerçekleşen')).toBeInTheDocument();
    expect(within(once).getByText('₺103.300,00')).toBeInTheDocument();
    expect(once).not.toHaveTextContent('₺393.700,00');

    const sonra = within(projeler).getByRole('button', { name: 'Taşınma sonrası' });
    expect(sonra).toHaveAccessibleDescription(/2 görev · 2 açık/);
    expect(within(sonra).getByText('Fiyat yok')).toBeInTheDocument();
    expect(within(sonra).getByText('Henüz yok')).toBeInTheDocument();

    // Telefon geniş-özel görünümleri çizmez: tablo, sorgu çubuğu, görünüm modu, Kanban, Gantt yok.
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('search', { name: 'Sorgu' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Görünüm modu' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Duruma göre görevler' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Gantt çizelgesi, yana kaydırılabilir' })).not.toBeInTheDocument();
  }, TEST_MS);

  it('projeye dokununca tam sayfa ayrıntı: odak başlıkta, Planlanan | Gerçekleşen ayrı, görevler akordeonda (ilk satır açık)', async () => {
    const user = userEvent.setup();
    renderPage({ device: 'phone' });
    await sayfaHazir();
    await user.click(screen.getByRole('button', { name: 'Taşınma öncesi' }));

    const ayrinti = screen.getByRole('region', { name: 'Taşınma öncesi' });
    expect(within(ayrinti).getByRole('heading', { level: 2, name: 'Taşınma öncesi' })).toHaveFocus();
    expect(within(ayrinti).getByRole('button', { name: 'Listeye dön' })).toBeInTheDocument();
    // Tam sayfa: liste ve diğer bölümler o sırada çizilmez.
    expect(screen.queryByRole('region', { name: 'Projeler' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Kontroller' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Önerilen görev şablonları' })).not.toBeInTheDocument();

    // Plan | Gerçek: ayrıntının ilk tanım listesi (görev akordeonunun gövdesinde de "Gerçekleşen" etiketi var).
    const tanim = (terim: string) => within(ayrinti).getAllByRole('term').find(el => el.textContent === terim)!.nextElementSibling;
    expect(tanim('Planlanan')).toHaveTextContent('₺290.400,00');
    expect(tanim('Planlanan')).toHaveTextContent('2 fiyatsız');
    expect(tanim('Gerçekleşen')).toHaveTextContent('₺103.300,00');
    expect(tanim('Gerçekleşen')).toHaveTextContent('7 henüz yok');

    // Görevler: akordeon (tablo yok), 10 görev; başlangıca göre ilk görev (IS-1, 03.11.2026) açık gelir.
    expect(within(ayrinti).getByRole('heading', { level: 3, name: 'Görevler' })).toBeInTheDocument();
    expect(within(ayrinti).queryByRole('table')).not.toBeInTheDocument();
    expect(gorevDugmeleri(ayrinti)).toHaveLength(10);
    expect(within(ayrinti).getByRole('button', { name: /^Örnek tadilat işi 1(?!\d)/ })).toHaveAttribute('aria-expanded', 'true');
    expect(within(ayrinti).getByRole('button', { name: /^Örnek tadilat işi 2(?!\d)/ })).toHaveAttribute('aria-expanded', 'false');
    // Durum grupları başlık olur ("Kuruldu 3"); diğer projenin görevleri burada yok.
    expect(within(ayrinti).getByRole('heading', { name: /^Kuruldu/ })).toHaveTextContent('3');
    expect(within(ayrinti).queryByRole('button', { name: /Örnek kilometre taşı 3/ })).not.toBeInTheDocument();
  }, TEST_MS);

  it('"Göster" seçimi alttan açılan sayfada; "Açık görevler" biten görevleri gizler, sayımlar seçenekte yazılı', async () => {
    const user = userEvent.setup();
    renderPage({ device: 'phone' });
    await sayfaHazir();
    await user.click(screen.getByRole('button', { name: 'Taşınma öncesi' }));
    const ayrinti = screen.getByRole('region', { name: 'Taşınma öncesi' });
    await user.click(within(ayrinti).getByRole('combobox', { name: 'Göster' }));
    const sayfa = await screen.findByRole('dialog', { name: 'Göster' });
    const secenekler = within(sayfa).getAllByRole('option').map(option => option.textContent);
    expect(secenekler).toEqual(expect.arrayContaining([
      expect.stringContaining('Tüm görevler (10)'),
      expect.stringContaining('Açık görevler (7)'),
      expect.stringContaining('Geciken görevler (0)'),
      expect.stringContaining('Biten görevler (3)'),
    ]));
    await user.click(within(sayfa).getByRole('option', { name: /^Açık görevler/ }));
    await waitFor(() => expect(gorevDugmeleri(ayrinti)).toHaveLength(7));
    expect(within(ayrinti).queryByRole('button', { name: /^Örnek tadilat işi 1(?!\d)/ })).not.toBeInTheDocument();
  }, TEST_MS);

  it('"Listeye dön" listeyi geri getirir ve odağı açılan projeye döndürür', async () => {
    const user = userEvent.setup();
    renderPage({ device: 'phone' });
    await sayfaHazir();
    await user.click(screen.getByRole('button', { name: 'Taşınma sonrası' }));
    const ayrinti = screen.getByRole('region', { name: 'Taşınma sonrası' });
    expect(gorevDugmeleri(ayrinti)).toHaveLength(2);
    await user.click(within(ayrinti).getByRole('button', { name: 'Listeye dön' }));
    expect(screen.getByRole('region', { name: 'Projeler' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Taşınma sonrası' })).toHaveFocus();
    expect(screen.getByRole('region', { name: 'Kontroller' })).toBeInTheDocument();
  }, TEST_MS);
});

describe('ProjelerPage › geniş görünüm (lazyWide)', () => {
  it('iş ve kilometre taşları tek tabloda; Proje sütunu; durum sözcükle; Planlanan ve Gerçekleşen ayrı; eksik bilgi adıyla', async () => {
    renderPage();
    const tablo = await genisHazir();
    const is2 = within(tablo).getByRole('row', { name: /Örnek tadilat işi 2/ });
    expect(hucre(is2, 'Kuruldu')).toBeInTheDocument();
    expect(hucre(is2, '₺17.000,00')).toBeInTheDocument();
    expect(hucre(is2, '₺8.200,00')).toBeInTheDocument();
    expect(hucre(is2, 'Taşınma öncesi')).toBeInTheDocument();
    expect(within(is2).getByRole('cell', { name: /IS-2/ })).toBeInTheDocument();
    expect(within(is2).getByRole('cell', { name: /03\.12\.2026/ })).toBeInTheDocument();
    expect(within(is2).getByRole('cell', { name: /20\.12\.2026/ })).toBeInTheDocument();

    const kt1 = within(tablo).getByRole('row', { name: /Örnek kilometre taşı 1/ });
    expect(hucre(kt1, 'Fiyat yok')).toBeInTheDocument();
    expect(hucre(kt1, 'Henüz yok')).toBeInTheDocument();
    expect(within(kt1).getAllByRole('cell', { name: 'Bilinmiyor' })).toHaveLength(2); // oda ve sorumlu yok
    expect(hucre(within(tablo).getByRole('row', { name: /Örnek kilometre taşı 3/ }), 'Taşınma sonrası')).toBeInTheDocument();

    // Kontroller görev tablosunda değil; gövde: 8 iş + 4 kilometre taşı.
    expect(within(tablo).queryByRole('row', { name: /Örnek kontrol 1/ })).not.toBeInTheDocument();
    expect(govdeSatirlari(tablo)).toHaveLength(12);
    // Geniş görünümde telefonun proje listesi yok (temel sunum yalnız yüklenirken).
    expect(screen.queryByRole('region', { name: 'Projeler' })).not.toBeInTheDocument();
  }, TEST_MS);

  it('arama kayıt adını ve kodunu daraltır; sonuç yoksa etkin filtre yazılır ve temizlenebilir', async () => {
    const user = userEvent.setup();
    renderPage();
    await genisHazir();
    const ara = screen.getByRole('searchbox', { name: 'Ara' });
    await user.type(ara, 'KT-3');
    await waitFor(async () => expect(govdeSatirlari(await screen.findByRole('table', { name: 'Görevler' }))).toHaveLength(1));
    await user.clear(ara);
    await user.type(ara, 'yok böyle bir görev');
    expect(await screen.findByRole('heading', { name: 'Bu filtrelerle kayıt yok' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Filtreleri temizle' }));
    expect(govdeSatirlari(await screen.findByRole('table', { name: 'Görevler' }))).toHaveLength(12);
  }, TEST_MS);

  it('Proje filtresi: proje aşaması sayımıyla; "Taşınma sonrası" yalnız o projenin iki görevini bırakır', async () => {
    const user = userEvent.setup();
    renderPage();
    await genisHazir();
    await user.click(screen.getByRole('button', { name: 'Filtreleri göster' }));
    await user.click(screen.getByRole('checkbox', { name: 'Taşınma sonrası' }));
    await waitFor(async () => expect(govdeSatirlari(await screen.findByRole('table', { name: 'Görevler' }))).toHaveLength(2));
    expect(screen.getByText('Proje: Taşınma sonrası')).toBeInTheDocument();
  }, TEST_MS);

  it('Liste, Zaman çizelgesi ve Pivot devre dışı; gerekçesi yazılır', async () => {
    renderPage();
    await genisHazir();
    const mod = screen.getByRole('radiogroup', { name: 'Görünüm modu' });
    expect(within(mod).getByRole('radio', { name: 'Pivot' })).toBeDisabled();
    expect(within(mod).getByRole('radio', { name: 'Kanban' })).toBeEnabled();
    expect(within(mod).getByRole('radio', { name: 'Gantt' })).toBeEnabled();
    expect(screen.getByText(/Pivot kullanılamaz: görevlerde toplanacak tutar alanı yok\./)).toBeInTheDocument();
  }, TEST_MS);

  it('Kanban: sütunlar teslimat iş akışının sırasıyla; kayıt sayıları durum sözcüğüyle', async () => {
    const user = userEvent.setup();
    renderPage();
    await genisHazir();
    // Segment radyosu görsel gizli (pointer-events none); etiketine tıklanır (Tabs.test ile aynı).
    await user.click(screen.getByText('Kanban'));
    const pano = await screen.findByRole('region', { name: 'Duruma göre görevler' });
    const sutunlar = within(pano).getAllByRole('region').map(sutun => sutun.getAttribute('aria-label'));
    // fulfillment iş akışı: Alınacak → Sipariş edildi → Teslim edildi → Kuruldu (→ İptal); kilometre taşları Karar verildi.
    expect(sutunlar.slice(0, 4)).toEqual(['Alınacak', 'Sipariş edildi', 'Teslim edildi', 'Kuruldu']);
    expect(sutunlar).toContain('Karar verildi');
    expect(within(within(pano).getByRole('region', { name: 'Kuruldu' })).getByText('3 kayıt')).toBeInTheDocument();
    expect(within(within(pano).getByRole('region', { name: 'Alınacak' })).getByText('5 kayıt')).toBeInTheDocument();
  }, TEST_MS);

  it('Gantt: proje satırı (aşamanın ilk başlangıcı – son bitişi) ve altında görevleri; tarihsizler yanda adıyla', async () => {
    const user = userEvent.setup();
    renderPage();
    await genisHazir();
    await user.click(screen.getByText('Gantt'));
    const cizelge = await screen.findByRole('region', { name: 'Gantt çizelgesi, yana kaydırılabilir' });
    // Odak (b04): kaydırma kabı klavyeyle odaklanır; tek alt çizgiyi kaydırmayan sarmalayıcı çizer (admin.css
    // [data-focus-line]:has(:focus-visible)). Kabın kendisinde çizgi kaydırma içinde kırpılırdı.
    expect(cizelge).toHaveAttribute('tabindex', '0');
    expect(cizelge).not.toHaveAttribute('data-focus-line');
    expect(cizelge.parentElement).toHaveAttribute('data-focus-line');
    // Klavye: ←/→ çizelgeyi bir hafta sütunu kaydırır, Home başa döner (WebKit odaklı kabı kendiliğinden kaydırmaz;
    // tarayıcının kendi kaydırması iki kez kaymasın diye olay tüketilir). ↑/↓ sayfaya kalır.
    cizelge.focus();
    expect(fireEvent.keyDown(cizelge, { key: 'ArrowRight' }), '→ tüketilir').toBe(false);
    const hafta = cizelge.scrollLeft;
    expect(hafta).toBeGreaterThan(0);
    fireEvent.keyDown(cizelge, { key: 'ArrowRight' });
    expect(cizelge.scrollLeft).toBe(2 * hafta);
    fireEvent.keyDown(cizelge, { key: 'ArrowLeft' });
    expect(cizelge.scrollLeft).toBe(hafta);
    fireEvent.keyDown(cizelge, { key: 'Home' });
    expect(cizelge.scrollLeft).toBe(0);
    expect(fireEvent.keyDown(cizelge, { key: 'ArrowDown' }), '↓ sayfanın').toBe(true);
    // Hafta başlıkları: ilk hafta 02.11 (NOW'un pazartesisi), fixture'ın son bitişi 15.09.2027'yi kapsar.
    expect(within(cizelge).getByRole('columnheader', { name: /02\.11/ })).toBeInTheDocument();
    expect(within(cizelge).getByText('Bu hafta')).toBeInTheDocument();
    expect(within(cizelge).getByRole('columnheader', { name: /13\.09/ })).toBeInTheDocument();
    // 12 görev çubuğu (8 iş + 4 kilometre taşı; kontroller yok) + 2 proje çubuğu.
    expect(within(cizelge).getAllByRole('img', { name: /^Örnek/ })).toHaveLength(12);
    expect(within(cizelge).getByRole('img', { name: 'Örnek tadilat işi 2: 03.12.2026 – 20.12.2026' })).toBeInTheDocument();
    expect(within(cizelge).getByRole('img', { name: 'Proje Taşınma öncesi: 03.11.2026 – 20.06.2027' })).toBeInTheDocument();
    expect(within(cizelge).getByRole('img', { name: 'Proje Taşınma sonrası: 01.06.2027 – 15.09.2027' })).toBeInTheDocument();
    // Satır sırası: proje başlığı → o projenin görevleri (başlangıca göre) → sonraki proje.
    const satirAdlari = within(cizelge).getAllByRole('rowheader').map(th => th.getAttribute('data-gantt-ad'));
    expect(satirAdlari[0]).toBe('Taşınma öncesi');
    expect(satirAdlari[1]).toBe('Örnek tadilat işi 1');
    expect(satirAdlari.indexOf('Taşınma sonrası')).toBe(11);
    expect(satirAdlari.slice(12)).toEqual(['Örnek kilometre taşı 3', 'Örnek kilometre taşı 4']);
    expect(within(cizelge).queryByText(/Örnek kontrol/)).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Tarihsiz' })).toHaveTextContent('Tarihsiz kayıt yok');
  }, TEST_MS);
});

describe('ProjelerPage › kontroller ve şablonlar', () => {
  it('kontrol sonuçları ayrı sayılır: Geçti / Kaldı / Eksik; telefonda akordeon, sonuç sözcükle', async () => {
    renderPage({ device: 'phone' });
    await sayfaHazir();
    const bolum = screen.getByRole('region', { name: 'Kontroller' });
    const sayimlar = within(bolum).getByRole('list', { name: 'Kontrol sonuçları' });
    const [gecti, kaldi, eksik] = within(sayimlar).getAllByRole('listitem');
    expect(gecti).toHaveTextContent('Geçti2');
    expect(kaldi).toHaveTextContent('Kaldı0');
    expect(eksik).toHaveTextContent('Eksik3');
    expect(within(bolum).queryByRole('table')).not.toBeInTheDocument();
    expect(within(bolum).getByRole('heading', { name: /^Geçti/ })).toHaveTextContent('2');
    expect(within(bolum).getByRole('heading', { name: /^Eksik/ })).toHaveTextContent('3');
  }, TEST_MS);

  it('masaüstünde kontroller tabloda; sonuç hücrede sözcükle', async () => {
    renderPage();
    await genisHazir();
    const liste = within(screen.getByRole('region', { name: 'Kontroller' })).getByRole('table', { name: 'Kontroller' });
    expect(hucre(within(liste).getByRole('row', { name: /Örnek kontrol 1/ }), 'Geçti')).toBeInTheDocument();
    expect(hucre(within(liste).getByRole('row', { name: /Örnek kontrol 4/ }), 'Eksik')).toBeInTheDocument();
  }, TEST_MS);

  it('şablon satırı Türkçe ad + "Sürüm 1"; ham makine anahtarı görünmez, yalnız ayrıntıda "Teknik anahtar" etiketiyle', async () => {
    const user = userEvent.setup();
    renderPage({ device: 'phone' });
    await sayfaHazir();
    const bolum = screen.getByRole('region', { name: 'Önerilen görev şablonları' });
    expect(bolum).toHaveTextContent('Bunlar gerçek görev değil');
    expect(bolum).toHaveTextContent('15 şablon');
    // Kusur: şablon adının altında "register_warranty_and_maintenance · sürüm 1" görünüyordu.
    expect(within(bolum).queryByText(/register_warranty_and_maintenance · sürüm/)).not.toBeInTheDocument();
    for (const anahtar of ['register_warranty_and_maintenance', 'define_project_scope', 'inspect_and_accept']) {
      for (const el of within(bolum).queryAllByText(anahtar)) expect(el).not.toBeVisible();
    }
    // Kapalı satır: Türkçe ad, sürüm ve hangi durumda önerildiği.
    const garanti = within(bolum).getByRole('button', { name: /^Garanti ve bakım bilgilerini kaydet/ });
    expect(garanti).toHaveTextContent('Sürüm 1 · Bir ürün/iş için garanti veya bakım bilgisi mevcut');
    expect(garanti).not.toHaveTextContent('register_warranty_and_maintenance');
    expect(garanti).toHaveAttribute('aria-expanded', 'false');

    await user.click(garanti);
    expect(garanti).toHaveAttribute('aria-expanded', 'true');
    const panel = document.getElementById(garanti.getAttribute('aria-controls')!)!;
    // Bağımlılık makine anahtarıyla değil, şablonun Türkçe adıyla.
    expect(within(panel).getByText('Önce yapılacak')).toBeVisible();
    expect(within(panel).getByText('İşin kabul kontrolünü kaydet')).toBeVisible();
    expect(within(panel).queryByText('inspect_and_accept')).not.toBeInTheDocument();
    expect(within(panel).getByText('Teknik anahtar')).toBeVisible();
    expect(within(panel).getByText('register_warranty_and_maintenance')).toBeVisible();
  }, TEST_MS);
});

describe('ProjelerPage › saf yardımcılar', () => {
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
    expect(plan.weeks[0]!.label).toBe('02.11');
    expect(plan.weeks[0]!.current).toBe(true);
    expect(plan.dated[0]).toMatchObject({ startWeek: 0, endWeek: 2 });
  });

  it('projeGruplari: aşamasız görev "Bilinmiyor" projesinde sonda; tarih aralığı ve plan/gerçek ayrı toplanır', () => {
    const satir = (id: string, extra: Partial<GorevSatiri>): GorevSatiri => ({
      id, code: id, label: id, kind: 'work_order', status: { label: 'Alınacak', tone: 'notr' }, planned: null, actual: null,
      kod: id, tur: 'İş', startOn: null, endOn: null, acik: true, gecikti: false, projeId: 'p1', projeAdi: 'Taşınma öncesi', ...extra,
    });
    const projeler = projeGruplari([
      satir('x', { projeId: '', projeAdi: 'Bilinmiyor', startOn: '2026-10-01', endOn: '2026-10-05' }),
      satir('a', { startOn: '2026-11-03', endOn: '2026-11-20', planned: { amount: '100.00', currency: 'TRY' } }),
      satir('b', { startOn: '2026-12-01', endOn: null, actual: { amount: '40.50', currency: 'TRY' }, acik: false }),
      satir('c', { gecikti: true }),
    ]);
    expect(projeler.map(proje => proje.ad)).toEqual(['Taşınma öncesi', 'Bilinmiyor']);
    const [once, bilinmiyor] = projeler;
    expect(once).toMatchObject({ acik: 2, geciken: 1, bitti: 1, baslangic: '2026-11-03', bitis: '2026-11-20' });
    expect(once!.gorevler.map(gorev => gorev.id)).toEqual(['a', 'b', 'c']);
    expect(once!.planlanan).toEqual({ parts: ['₺100,00'], eksik: 2 });
    expect(once!.gerceklesen).toEqual({ parts: ['₺40,50'], eksik: 2 });
    expect(bilinmiyor!.gorevler.map(gorev => gorev.id)).toEqual(['x']);
  });

  it('sablonGorunumleri: başlık yoksa "Adı bilinmiyor" (ham anahtar başlık olmaz); sürüm sözcükle; bağımlılık Türkçe adla', () => {
    const sablon = (extra: Partial<TaskTemplate>): TaskTemplate => ({
      id: 't', tenant_id: 'x', key: 'raw_key', kind: 'task_template', version: 2, workflow_id: 'w', dependency_template_ids: [], ...extra,
    }) as TaskTemplate;
    const [b, a] = [
      sablon({ id: 'b', key: 'second_key', title: 'Bölümü ölç', dependency_template_ids: ['a', 'yok'], applies_when: 'Ölçü yoksa' }),
      sablon({ id: 'a', key: 'first_key', version: Number.NaN }),
    ];
    const gorunumler = sablonGorunumleri([b!, a!]);
    expect(gorunumler.map(g => g.baslik)).toEqual(['Adı bilinmiyor', 'Bölümü ölç']);
    expect(gorunumler[0]).toMatchObject({ surum: 'Sürüm bilinmiyor', kosul: 'Koşul yazılmamış', anahtar: 'first_key', once: [] });
    expect(gorunumler[1]).toMatchObject({ surum: 'Sürüm 2', kosul: 'Ölçü yoksa', anahtar: 'second_key', once: ['Adı bilinmiyor', 'Bilinmiyor'] });
  });
});

describe('ProjelerPage › teslim: telefon geniş-özel kodu indirmez', () => {
  const PAGES = here;
  const read = (path: string) => readFileSync(path, 'utf8');
  /** ProjelerPage.tsx'ten başlayıp göreli, geniş olmayan yerel modüllere statik importla ulaşılan sayfa dosyaları. */
  function telefonKapanisi(): string[] {
    const seen = new Set<string>();
    const queue = [join(PAGES, 'ProjelerPage.tsx')];
    while (queue.length) {
      const file = queue.shift()!;
      if (seen.has(file)) continue;
      seen.add(file);
      for (const ref of importsOf(read(file))) {
        if (ref.kind !== 'static' || ref.typeOnly || !ref.specifier.startsWith('./')) continue;
        const base = resolve(dirname(file), ref.specifier);
        const candidate = ['.tsx', '.ts'].map(ext => base + ext).find(path => { try { return statSync(path).isFile(); } catch { return false; } });
        if (candidate && candidate.startsWith(PAGES)) queue.push(candidate);
      }
    }
    return [...seen];
  }

  it('telefon yolu Kanban, Gantt, sorgu çubuğu, filtre, tablo ya da *.wide / wide/ modülünü statik içe aktarmaz', () => {
    const files = telefonKapanisi();
    expect(files.length).toBeGreaterThan(1);
    const yasak = /(^|\/)(Kanban|QueryBar|FilterArea|FilterDrawer|FilterPanel|Table|Chart|Gantt)$|\.wide$|(^|\/)wide\/|^(antd|@ant-design|echarts)(\/|$)/;
    const ihlaller = files.flatMap(file => importsOf(read(file))
      .filter(ref => ref.kind === 'static' && !ref.typeOnly && yasak.test(ref.specifier))
      .map(ref => `${relative(PAGES, file)} → ${ref.specifier}`));
    expect(ihlaller).toEqual([]);
  });

  it('geniş görünüm tek lazyWide anahtarıyla ve açık import() ile yüklenir; geniş modül default export verir', () => {
    const sayfa = read(join(PAGES, 'ProjelerPage.tsx'));
    expect(sayfa).toMatch(/lazyWide(<[^>]*>)?\(\s*'projeler-genis',\s*\(\)\s*=>\s*import\('\.\/projeler\/ProjelerGenis\.wide'\)\s*\)/);
    expect(read(join(PAGES, 'projeler/ProjelerGenis.wide.tsx'))).toMatch(/export default function ProjelerGenis\b/);
  });
});
