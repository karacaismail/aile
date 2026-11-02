import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReactNode } from 'react';
import { FixtureGenerationSource, GenerationProvider, type BudgetObservation, type GenerationSource } from '../data';
import { DeviceContext } from '../device';
import type { Device } from '../shell/contracts';
import { RaporlarPage, REPORTS, periodLabel, toCsv } from './RaporlarPage';
import { TOTAL_UNAVAILABLE_TEXT } from '../data';

// Tasarım: SayfaRaporlar / SayfaRaporlarDar + bundle.js Aile.Pages.Raporlar (masaüstünde solda rapor menüsü, dar
// ekranda "Rapor" seçimi; Dönem seçimi "Son 6 ay"; "Raporu dışa aktar"; plan acik-mavi / gerçek eylem çubukları ve
// yanında tablo). Veri: budget_observations. Gerçekleşen actuals.ts anlamıyla: gelecek dönem "Henüz yok", kanıtsız
// yazılı değer "Kaynakta yazılı" (oran yok); plan ve gerçek tek sayıda birleşmez. Bütçe gözlemleri toplanmaz: nesilde
// satır düzeyinde yaprak sahipliği haritası yok (views: pivotMeasures yalnız sayım, sumUnavailableReason); tutar yerine
// "Toplam kullanılamaz" ve kayıt sayıları. Geniş yetenekler (rapor menüsü, ECharts grafiği) lazyWide ile yalnız geniş
// profilde gelir; telefon onları hiç yüklemez. Saat sabit: 2 Kasım 2026 İstanbul.

// Chart: echarts tembel yüklenir; burada yalnız sözleşmesi (role=img + aria-label, açıklama görünür) taklit edilir.
vi.mock('../ui/Chart', () => ({
  Chart: (p: { ariaLabel: string; description: ReactNode }) => (
    <div>
      <div role="img" aria-label={p.ariaLabel} />
      <div>{p.description}</div>
    </div>
  ),
}));
// Telefonda Select alttan sayfada açılır; burada yalnız sözleşmesi (dialog + Kapat) taklit edilir.
vi.mock('../ui/BottomSheet', () => ({
  BottomSheet: (p: { title: string; children?: ReactNode; onClose?: () => void; open?: boolean }) =>
    p.open === false ? null : (
      <div role="dialog" aria-modal="true" aria-label={p.title}>
        <button type="button" onClick={p.onClose}>Kapat</button>
        {p.children}
      </div>
    ),
}));

// --- Sentetik nesil → bellek -------------------------------------------------------------------------
const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = join(here, '../../../fixtures/generation-synthetic');
const GENERATION_ID = readdirSync(FIXTURE_ROOT).find((name) => statSync(join(FIXTURE_ROOT, name)).isDirectory())!;
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
    .map((full) => relative(GENERATION_DIR, full))
    .filter((rel) => rel === 'manifest.json' || rel.startsWith('data/'))
    .map((rel) => [rel, readFileSync(join(GENERATION_DIR, rel), 'utf8')]),
);
interface ManifestLike { files: { path: string; collection?: string }[]; counts: Record<string, number> }
const MANIFEST = JSON.parse(FILES['manifest.json']!) as ManifestLike;
const OBS: BudgetObservation[] = MANIFEST.files
  .filter((file) => file.collection === 'budget_observations')
  .flatMap((file) => (JSON.parse(FILES[file.path]!) as { records: BudgetObservation[] }).records);

const TODAY = new Date('2026-11-02T10:00:00+03:00');
const now = () => TODAY;
const SON_ALTI_AY = ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'];
const YIL_2027 = Array.from({ length: 12 }, (_, i) => `2027-${String(i + 1).padStart(2, '0')}`);

/** Beklenen toplam: kuruş bigint ile (kayan nokta yok) → "₺8.500,00". */
function tl(basis: string, periods: readonly string[], label?: string): string {
  let kurus = 0n;
  for (const row of OBS) {
    if (row.deleted_at || row.basis !== basis || !periods.includes(row.period) || row.value.decimal === null) continue;
    if (label && row.label !== label) continue;
    const [whole, fraction = ''] = row.value.decimal.split('.');
    kurus += BigInt(whole!) * 100n + BigInt(`${fraction}00`.slice(0, 2));
  }
  const text = `${kurus / 100n}.${String(kurus % 100n).padStart(2, '0')}`;
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(text as `${number}`);
}

function fixtureSource(overrides: Record<string, string | null> = {}): FixtureGenerationSource {
  const files = { ...FILES };
  for (const [path, text] of Object.entries(overrides)) {
    if (text === null) delete files[path];
    else files[path] = text;
  }
  return new FixtureGenerationSource(files, 'sentetik');
}

function withoutCollection(collection: string): FixtureGenerationSource {
  const manifest: ManifestLike = {
    ...MANIFEST,
    files: MANIFEST.files.filter((file) => file.collection !== collection),
    counts: { ...MANIFEST.counts, [collection]: 0 },
  };
  return fixtureSource({ 'manifest.json': JSON.stringify(manifest) });
}

/** İlk okuma başarılı, sonra her okuma başarısız: refresh → stale (son iyi nesil korunur). */
class FlakySource implements GenerationSource {
  readonly kind = 'fixture' as const;
  readonly label = 'kesintili';
  failing = false;
  private readonly inner = fixtureSource();
  async readText(path: string): Promise<string> {
    if (this.failing) throw new Error('bağlantı kesildi');
    return this.inner.readText(path);
  }
}

/** Oda koleksiyonu kapı açılana kadar gelmez: alımlar oda adları olmadan önce okunur (yük altındaki tarayıcı gibi). */
const ROOM_PATHS = new Set(MANIFEST.files.filter((file) => file.collection === 'rooms').map((file) => file.path));
class SlowRoomsSource implements GenerationSource {
  readonly kind = 'fixture' as const;
  readonly label = 'yavaş odalar';
  private readonly inner = fixtureSource();
  release: () => void = () => {};
  private readonly gate = new Promise<void>((resolve) => { this.release = resolve; });
  async readText(path: string): Promise<string> {
    if (ROOM_PATHS.has(path)) await this.gate;
    return this.inner.readText(path);
  }
}

function renderPage(device: Device = 'desktop', source: GenerationSource = fixtureSource()) {
  return render(
    <DeviceContext.Provider value={device}>
      <GenerationProvider source={source} cache={null} changeSet={null}>
        <RaporlarPage location="/raporlar" now={now} />
      </GenerationProvider>
    </DeviceContext.Provider>,
  );
}

const WAIT = { timeout: 4000 };
/** Çok adımlı kullanıcı yolculuğu (antd + tembel geniş modül, yüklü makinede): routes.test.tsx ile aynı süre bütçesi. */
const JOURNEY_MS = 20_000;
async function waitForReport(name: string) {
  return await screen.findByRole('table', { name }, WAIT);
}
const region = (name: string) => screen.getByRole('region', { name });
/**
 * Yerel Table (ui/Table) başlık satırını gövdeyle aynı adlandırılmış <table> içinde (thead) çizer. Sütun başlıkları ve
 * gövde satırları o tablodan okunur; başlık satırı (sütun başlığı taşıyan satır) gövde satırı sayılmaz.
 */
const headerTitles = (table: HTMLElement) => within(table).getAllByRole('columnheader').map((th) => th.textContent);
const bodyRows = (table: HTMLElement) =>
  within(table).getAllByRole('row').filter((row) => within(row).queryAllByRole('columnheader').length === 0);
const summaryItem = (label: string) =>
  within(screen.getByRole('list', { name: 'Özet' })).getAllByRole('listitem').find((li) => li.textContent?.includes(label))!;
/**
 * Masaüstü rapor seçimi (raporlar/RaporMenu.wide): sayfa içi seçimdir, gezinme değildir. Yerel düğme listesi
 * (ul "Rapor seçimi" > li > button), seçili rapor aria-current="true"; menü rolü ve aria-current="page" yok.
 */
const REPORT_PICKER = 'Rapor seçimi';
const reportPicker = () => screen.findByRole('list', { name: REPORT_PICKER }, WAIT);
async function pickReport(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await within(await reportPicker()).findByRole('button', { name }, WAIT));
}

// --- Saf yardımcılar -----------------------------------------------------------------------------------
describe('Raporlar › yardımcılar', () => {
  it('REPORTS tasarımdaki beş hazır rapordur, cümle düzeninde', () => {
    expect(REPORTS.map((r) => r.label)).toEqual([
      'Aylık plan ve gerçek', 'Kaleme göre harcama', 'Borç ödeme planı', 'Oda bazında alımlar', 'Veri güveni özeti',
    ]);
  });

  it('periodLabel YYYY-MM dönemini Türkçe ay adıyla yazar; bozuk dönem olduğu gibi kalır', () => {
    expect(periodLabel('2026-11')).toBe('Kasım 2026');
    expect(periodLabel('2027-01')).toBe('Ocak 2027');
    expect(periodLabel('bilinmiyor')).toBe('bilinmiyor');
  });

  it('toCsv noktalı virgülle ayırır, ayırıcı ve tırnak içeren hücreyi tırnaklar, BOM ile başlar; formül başlangıcını etkisizleştirir', () => {
    const csv = toCsv([['Ay', 'Planlanan'], ['Kasım 2026', '8500.00 TRY'], ['Not; "a"', 'Henüz yok'], ['=1+1', '-1250.00']]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1)).toBe(`Ay;Planlanan\r\nKasım 2026;8500.00 TRY\r\n"Not; ""a""";Henüz yok\r\n'=1+1;-1250.00`);
  });

  it('telefon yolu geniş-özel kodu statik içe aktarmaz: grafik ve rapor menüsü yalnız *.wide modülünde', () => {
    const source = readFileSync(join(here, 'RaporlarPage.tsx'), 'utf8');
    const model = readFileSync(join(here, 'raporlar/model.ts'), 'utf8');
    const specifiers = [...`${source}\n${model}`.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    expect(specifiers.filter((s) => /(^|\/)ui$|ui\/(Chart|Menu|Table|antd)$|^antd|^@ant-design|echarts|\.wide$/.test(s!))).toEqual([]);
    expect(source).toMatch(/lazyWide\('raporlar-grafik', \(\) => import\('\.\/raporlar\/RaporGrafik\.wide'\)\)/);
    expect(source).toMatch(/lazyWide\('raporlar-menu', \(\) => import\('\.\/raporlar\/RaporMenu\.wide'\)\)/);
  });
});

// --- Sayfa ---------------------------------------------------------------------------------------------
describe('RaporlarPage › başlık ve durumlar', () => {
  it('bölüm, h1, amaç ve masaüstü rapor menüsü (geniş modül); tazelik satırı nesil kimliğiyle dolar', async () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Raporlar' })).toBeInTheDocument();
    expect(screen.getByText('Rapor', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText('Hazır raporları açın; her rakamın hangi kayıtlardan geldiğini görün.')).toBeInTheDocument();

    // Rapor seçimi sayfa içi seçimdir: menü/menuitem rolü ve aria-current="page" yok; yerel düğmeler, seçili "true".
    const picker = await reportPicker();
    const buttons = within(picker).getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual(REPORTS.map((report) => report.label));
    for (const button of buttons) {
      expect(button.tagName).toBe('BUTTON');
      expect(button).toHaveAttribute('type', 'button');
      expect(button.closest('li')?.parentElement).toBe(picker);
      // Satırı dolduran düğme satır taşıyıcısıdır (admin.css [data-focus-line='row']): odak çizgisi kendi alt kenarında.
      expect(button).toHaveAttribute('data-focus-line', 'row');
    }
    expect(within(picker).getByRole('button', { name: 'Aylık plan ve gerçek' })).toHaveAttribute('aria-current', 'true');
    expect(buttons.filter((button) => button.hasAttribute('aria-current'))).toHaveLength(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
    expect(document.querySelector('[aria-current="page"]')).toBeNull();

    await waitForReport('Aylık plan ve gerçek');
    const status = screen.getAllByRole('status').find((el) => el.getAttribute('data-state'))!;
    expect(status).toHaveAttribute('data-state', 'fresh');
    expect(status.textContent).toContain('Nesil');
  }, JOURNEY_MS);

  it('yüklenirken iskelet gösterir; döner simge yok', () => {
    renderPage();
    const loading = screen.getAllByRole('status').find((el) => el.getAttribute('aria-busy') === 'true');
    expect(loading).toBeDefined();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  }, JOURNEY_MS);

  it('manifest bozuksa hata durumu "Hata: …" ve "Yeniden dene" sunar; eski tutar gösterilmez', async () => {
    renderPage('desktop', fixtureSource({ 'manifest.json': '{bozuk' }));
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('heading', { level: 2 }).textContent).toMatch(/^Hata: /);
    expect(within(alert).getByRole('button', { name: 'Yeniden dene' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText(/₺/)).not.toBeInTheDocument();
  }, JOURNEY_MS);

  it('ilk okuma başarısızsa "Yeniden dene" kaynak düzelince raporu getirir; hata kalmaz', async () => {
    const source = new FlakySource();
    source.failing = true;
    renderPage('desktop', source);
    const alert = await screen.findByRole('alert', {}, WAIT);
    expect(screen.queryByText(/₺/)).not.toBeInTheDocument();
    source.failing = false;
    await userEvent.click(within(alert).getByRole('button', { name: 'Yeniden dene' }));
    await waitForReport('Aylık plan ve gerçek');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(summaryItem('Planlanan').textContent).toContain(TOTAL_UNAVAILABLE_TEXT);
  }, JOURNEY_MS);

  it('nesilde bütçe gözlemi yoksa dürüstçe "Kaynakta bütçe gözlemi kaydı yok" der', async () => {
    renderPage('desktop', withoutCollection('budget_observations'));
    await screen.findByRole('heading', { level: 2, name: 'Kaynakta bütçe gözlemi kaydı yok' }, WAIT);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Özet' })).not.toBeInTheDocument();
  }, JOURNEY_MS);

  it('yenileme başarısızsa eski veri kalır; tazelik satırı "yenilenemedi" der', async () => {
    const source = new FlakySource();
    renderPage('desktop', source);
    await waitForReport('Aylık plan ve gerçek');
    source.failing = true;
    await userEvent.click(screen.getByRole('button', { name: 'Yenile' }));
    const status = () => screen.getAllByRole('status').find((el) => el.getAttribute('data-state'))!;
    await waitFor(() => expect(status()).toHaveAttribute('data-state', 'stale'));
    expect(status().textContent).toContain('yenilenemedi');
    expect(screen.getByRole('table', { name: 'Aylık plan ve gerçek' })).toBeInTheDocument();
  }, JOURNEY_MS);
});

describe('RaporlarPage › rapor seçimi (masaüstü, raporlar/RaporMenu.wide)', () => {
  const read = (name: string) => readFileSync(join(here, name), 'utf8');
  const stripCss = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '');

  it('kaynak: geniş modül antd, @ant-design ve ui/Menu içe aktarmaz; varsayılan dışa aktarım; stil yalnız --aile-* tokenlarıyla', () => {
    const source = read('raporlar/RaporMenu.wide.tsx');
    const specifiers = [...source.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]!);
    expect(specifiers.filter((s) => /^antd|^@ant-design|(^|\/)antd$|ui\/Menu$|(^|\/)ui$/.test(s))).toEqual([]);
    expect(specifiers).toContain('./RaporMenu.wide.css');
    expect(source).toMatch(/export default function RaporMenu/);
    expect(source).not.toMatch(/role=["'](menu|menuitem|navigation|tablist)["']/);
    expect(source).not.toMatch(/aria-current=\{[^}]*'page'/);

    const css = stripCss(read('raporlar/RaporMenu.wide.css'));
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/rgba?\(/);
    expect(css).not.toMatch(/\boutline\s*:/);
    expect(css).not.toMatch(/box-shadow\s*:/);
    // Vurgu kenarı yok (kenarlık şeridi, pseudo şerit); seçili durum yüzey tonu + 600. Düğme kenarlığı yalnız sıfırlanır.
    const borders = [...css.matchAll(/(border(?:-[a-z-]+)?)\s*:\s*([^;]+);/g)].filter((m) => m[1] !== 'border-radius');
    expect(borders.map((m) => `${m[1]}: ${m[2]!.trim()}`)).toEqual(['border: 0']);
    expect(css).not.toMatch(/::(before|after)/);
    expect(css).toMatch(/\[aria-current='true'\]\s*\{[^}]*background:\s*var\(--aile-secili\)[^}]*font-weight:\s*600/);
    // Dokunma hedefi merkezi tokenla (44, kaba girişte 48); metin ≥ 14 px; hareket 240 ms tek eğri, reduced-motion 0 s.
    expect(css).toMatch(/min-height:\s*var\(--aile-dokunma-hedefi\)/);
    const sizes = [...css.matchAll(/font-size:\s*([\d.]+)px/g)].map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(0);
    for (const size of sizes) expect(size).toBeGreaterThanOrEqual(14);
    for (const m of css.matchAll(/transition:\s*([^;]+);/g)) {
      for (const part of m[1]!.split(',')) expect(part.trim()).toMatch(/^[a-z-]+ var\(--aile-sure\) var\(--aile-egri\)$/);
    }
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[^{}]*\{[^}]*transition-duration:\s*0s/);
    // Hover yalnız hover destekleyen birincil işaretçide (hibrit dokunmatikte takılı kalmaz).
    expect(css).toMatch(/@media \(hover: hover\)\s*\{[^{}]*:hover/);
    expect(css.replace(/@media \(hover: hover\)\s*\{[^{}]*\{[^}]*\}\s*\}/g, '')).not.toMatch(/:hover/);
  });

  it('klavye: her rapor düğmesi doğal Tab sırasında; Enter ve Boşluk seçer, odak düğmede kalır; oklar ve Escape seçimi değiştirmez', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitForReport('Aylık plan ve gerçek');
    const picker = await reportPicker();
    const button = (name: string) => within(picker).getByRole('button', { name });
    for (const item of within(picker).getAllByRole('button')) expect(item).not.toHaveAttribute('tabindex');

    button('Aylık plan ve gerçek').focus();
    await user.tab();
    expect(button('Kaleme göre harcama')).toHaveFocus();
    await user.keyboard('{Enter}');
    await waitForReport('Kaleme göre harcama');
    expect(button('Kaleme göre harcama')).toHaveFocus();
    expect(button('Kaleme göre harcama')).toHaveAttribute('aria-current', 'true');
    expect(button('Aylık plan ve gerçek')).not.toHaveAttribute('aria-current');

    // Oklar ve Escape: düğme listesi bileşik pencere öğesi değildir; odak ve seçim yerinde kalır.
    for (const key of ['{ArrowDown}', '{ArrowUp}', '{Home}', '{End}', '{Escape}']) {
      await user.keyboard(key);
      expect(button('Kaleme göre harcama'), key).toHaveFocus();
    }
    expect(button('Kaleme göre harcama')).toHaveAttribute('aria-current', 'true');

    await user.tab();
    await user.tab();
    expect(button('Oda bazında alımlar')).toHaveFocus();
    await user.keyboard(' ');
    await waitForReport('Oda bazında alımlar');
    expect(button('Oda bazında alımlar')).toHaveFocus();
    expect(button('Oda bazında alımlar')).toHaveAttribute('aria-current', 'true');
    await user.tab({ shift: true });
    expect(button('Borç ödeme planı')).toHaveFocus();
    expect(within(picker).getAllByRole('button').filter((item) => item.hasAttribute('aria-current'))).toHaveLength(1);
  }, JOURNEY_MS);

  it('Pointer Events: basılı yüzey pointerdown ile; pointercancel (kaydırma) siler ve seçmez; dokunuş seçer', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitForReport('Aylık plan ve gerçek');
    const picker = await reportPicker();
    const guven = within(picker).getByRole('button', { name: 'Veri güveni özeti' });
    fireEvent.pointerDown(guven, { pointerType: 'touch', button: 0, isPrimary: true });
    expect(guven).toHaveAttribute('data-pressed');
    fireEvent.pointerCancel(guven, { pointerType: 'touch' });
    expect(guven).not.toHaveAttribute('data-pressed');
    expect(guven).not.toHaveAttribute('aria-current');
    expect(within(picker).getByRole('button', { name: 'Aylık plan ve gerçek' })).toHaveAttribute('aria-current', 'true');
    // İkincil fare düğmesi basılı görünmez.
    fireEvent.pointerDown(guven, { pointerType: 'mouse', button: 2 });
    expect(guven).not.toHaveAttribute('data-pressed');
    fireEvent.pointerDown(guven, { pointerType: 'mouse', button: 0, isPrimary: true });
    expect(guven).toHaveAttribute('data-pressed');
    fireEvent.pointerUp(guven, { pointerType: 'mouse', button: 0 });
    expect(guven).not.toHaveAttribute('data-pressed');
    await user.click(guven);
    await waitForReport('Veri güveni özeti');
    expect(guven).toHaveAttribute('aria-current', 'true');
  }, JOURNEY_MS);
});

describe('RaporlarPage › Aylık plan ve gerçek', () => {
  it('varsayılan Son 6 ay; plan ve gerçek ayrı sütun ve ayrı özet; toplam üretilmez ("Toplam kullanılamaz", nedeni yazılı); durum actuals anlamıyla, oran yok; kayıt grafiği genişte', async () => {
    renderPage();
    const table = await waitForReport('Aylık plan ve gerçek');

    expect(headerTitles(table)).toEqual(['Ay', 'Planlanan', 'Gerçekleşen', 'Durum', 'Kayıt']);
    expect(bodyRows(table)).toHaveLength(SON_ALTI_AY.length);
    expect(within(region('Aylık plan ve gerçek')).getByText('Haziran – Kasım 2026 · Kasım sürüyor')).toBeInTheDocument();

    // Nesilde satır düzeyinde yaprak sahipliği haritası yok: ayın satırları (gelir, ara toplam, genel toplam, adet olabilir)
    // tek bir Planlanan/Gerçekleşen sayısında toplanmaz.
    const kasim = within(table).getByRole('row', { name: /Kasım 2026/ });
    expect(within(kasim).getAllByText(TOTAL_UNAVAILABLE_TEXT)).toHaveLength(2);
    expect(kasim.textContent).toContain('Kaynakta yazılı');
    expect(table.textContent).not.toContain('₺');
    expect(table.textContent).not.toMatch(/%\d|harcandı|Plan üstü|Plan altı/);
    expect(within(region('Aylık plan ve gerçek')).getByText(/^Toplam kullanılamaz: bütçe gözlemlerinin /)).toBeInTheDocument();

    const plan = summaryItem('Planlanan').textContent!;
    const gercek = summaryItem('Gerçekleşen').textContent!;
    expect(plan).toContain(TOTAL_UNAVAILABLE_TEXT);
    expect(gercek).toContain(TOTAL_UNAVAILABLE_TEXT);
    expect(screen.getByRole('list', { name: 'Özet' }).textContent).not.toContain('₺');
    // Kayıt sayısı da plan ve gerçek için ayrı yazılır; ikisi tek sayıda toplanmaz.
    const live = OBS.filter((o) => !o.deleted_at && SON_ALTI_AY.includes(o.period));
    const planKayit = live.filter((o) => o.basis === 'planned').length;
    const gercekKayit = live.filter((o) => o.basis === 'recorded_aggregate').length;
    expect(summaryItem('Kayıt').textContent).toContain(`${planKayit} plan · ${gercekKayit} gerçekleşen`);
    expect(screen.getByRole('list', { name: 'Özet' }).textContent).not.toContain(`${planKayit + gercekKayit} kayıt`);

    // Grafik tutar değil kayıt sayısını çizer (tutar yok); değerler tabloda.
    expect(await screen.findByRole('img', { name: /^Aylara göre planlanan ve gerçekleşen kayıt sayısı/ }, WAIT)).toBeInTheDocument();
    expect(screen.getByText(/Tahminler .*toplanmaz/)).toBeInTheDocument();
  }, JOURNEY_MS);

  it('gelecek yıl: Gerçekleşen her ayda "Henüz yok", özet de "Henüz yok"; plan "Toplam kullanılamaz"', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitForReport('Aylık plan ve gerçek');

    await user.click(screen.getByRole('combobox', { name: 'Dönem' }));
    await user.click(await screen.findByRole('option', { name: '2027' }));
    await waitFor(() => expect(bodyRows(screen.getByRole('table', { name: 'Aylık plan ve gerçek' }))).toHaveLength(12));
    const table = screen.getByRole('table', { name: 'Aylık plan ve gerçek' });
    for (const row of bodyRows(table)) {
      expect(row.textContent).toContain('Henüz yok');
      expect(row.textContent).toContain(TOTAL_UNAVAILABLE_TEXT);
    }
    expect(table.textContent).not.toContain('Kaynakta yazılı');
    expect(table.textContent).not.toContain('₺');
    expect(summaryItem('Gerçekleşen').textContent).toContain('Henüz yok');
    expect(summaryItem('Planlanan').textContent).toContain(TOTAL_UNAVAILABLE_TEXT);
    expect(summaryItem('Planlanan').textContent).not.toContain(tl('planned', YIL_2027));
  }, JOURNEY_MS);

  it('Tüm dönemler 24 ay; Gerçekleşen kaydı yalnız gelecek olmayan aylardan sayılır; tutar özeti yok', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitForReport('Aylık plan ve gerçek');
    await user.click(screen.getByRole('combobox', { name: 'Dönem' }));
    await user.click(await screen.findByRole('option', { name: 'Tüm dönemler' }));
    await waitFor(() => expect(bodyRows(screen.getByRole('table', { name: 'Aylık plan ve gerçek' }))).toHaveLength(24));
    const live = OBS.filter((o) => !o.deleted_at);
    const planKayit = live.filter((o) => o.basis === 'planned').length;
    const gercekKayit = live.filter((o) => o.basis === 'recorded_aggregate' && o.period <= '2026-11').length;
    expect(summaryItem('Kayıt').textContent).toContain(`${planKayit} plan · ${gercekKayit} gerçekleşen`);
    expect(summaryItem('Gerçekleşen').textContent).toContain(TOTAL_UNAVAILABLE_TEXT);
    expect(summaryItem('Planlanan').textContent).toContain(TOTAL_UNAVAILABLE_TEXT);
    expect(screen.getByRole('list', { name: 'Özet' }).textContent).not.toContain('₺');
  }, JOURNEY_MS);

  it('"Raporu dışa aktar" yalnız görünen satırları CSV olarak istemci tarafında indirir; gelecek ay "Henüz yok"', async () => {
    const user = userEvent.setup();
    const blobs: Blob[] = [];
    const createObjectURL = vi.fn((blob: Blob) => { blobs.push(blob); return 'blob:aile-rapor'; });
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toMatch(/^aile-rapor-aylik-plan-ve-gercek-\d{8}\.csv$/);
      expect(this.href).toBe('blob:aile-rapor');
    });
    try {
      renderPage();
      await waitForReport('Aylık plan ve gerçek');
      await user.click(screen.getByRole('combobox', { name: 'Dönem' }));
      await user.click(await screen.findByRole('option', { name: '2026' }));
      await waitFor(() => expect(bodyRows(screen.getByRole('table', { name: 'Aylık plan ve gerçek' }))).toHaveLength(12));
      // Görünen satırların kaydı etkide yenilenir; tıklamadan önce bekleyen etkiler işlenir.
      await act(async () => {});
      await user.click(screen.getByRole('button', { name: 'Raporu dışa aktar' }));
      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(blobs[0]!.type).toBe('text/csv;charset=utf-8');
      const text = await blobs[0]!.text();
      const lines = text.replace(/^﻿/, '').split('\r\n');
      expect(lines[0]).toBe('Ay;Planlanan;Gerçekleşen;Durum;Plan kaydı;Gerçekleşen kaydı');
      expect(lines).toHaveLength(13);
      expect(lines.find((line) => line.startsWith('Aralık 2026;'))).toBe(`Aralık 2026;${TOTAL_UNAVAILABLE_TEXT};Henüz yok;Henüz yok;8;0`);
      expect(lines.find((line) => line.startsWith('Kasım 2026;'))).toBe(`Kasım 2026;${TOTAL_UNAVAILABLE_TEXT};${TOTAL_UNAVAILABLE_TEXT};Kaynakta yazılı;8;8`);
      expect(text).not.toContain('TRY');
      expect(click).toHaveBeenCalledTimes(1);
      // İndirme başlamadan bağlantı geri alınmaz (WebKit): revoke ertelenir.
      expect(revokeObjectURL).not.toHaveBeenCalled();
      await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:aile-rapor'), { timeout: 3000 });
    } finally {
      click.mockRestore();
    }
  }, JOURNEY_MS);

  it('view_definitions yoksa da toplam yok: tutar ve özet tutarı yok, gerekçe yazılı', async () => {
    renderPage('desktop', withoutCollection('view_definitions'));
    const table = await waitForReport('Aylık plan ve gerçek');
    expect(headerTitles(table)).toEqual(['Ay', 'Planlanan', 'Gerçekleşen', 'Durum', 'Kayıt']);
    expect(table.textContent).not.toContain('₺');
    expect(within(region('Aylık plan ve gerçek')).getByText(/^Toplam kullanılamaz: /)).toBeInTheDocument();
    expect(screen.queryByText(/₺/)).not.toBeInTheDocument();
  }, JOURNEY_MS);
});

describe('RaporlarPage › Kaleme göre harcama (pivot)', () => {
  it('ölçü seçici yalnız sayım sunar (toplam ölçüsü sahipsiz, nedeni yazılı); hücreler kalem × dönem kayıt sayısı', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitForReport('Aylık plan ve gerçek');
    await pickReport(user, 'Kaleme göre harcama');

    const table = await waitForReport('Kaleme göre harcama');
    const headers = headerTitles(table);
    expect(headers[0]).toBe('Kalem');
    expect(headers).toContain(periodLabel('2026-11'));
    expect(headers[headers.length - 1]).toBe('Toplam');
    expect(bodyRows(table)).toHaveLength(8 + 1);

    const KALEM = 'Örnek gider satırı 1';
    const row1 = within(table).getByRole('row', { name: new RegExp(KALEM) });
    expect(row1.textContent).toContain('6 plan · 6 gerçekleşen');
    expect(row1.textContent).not.toContain(tl('planned', SON_ALTI_AY, KALEM));
    expect(table.textContent).not.toContain('₺');
    expect(within(region('Kaleme göre harcama')).getByText(/^Toplam kullanılamaz: bütçe gözlemlerinin /)).toBeInTheDocument();

    await user.click(screen.getByRole('combobox', { name: 'Ölçü' }));
    const list = await screen.findByRole('listbox');
    expect(within(list).getAllByRole('option').map((o) => o.textContent)).toEqual(['Kayıt sayısı']);

    expect(await screen.findByRole('img', { name: /kalem/i }, WAIT)).toBeInTheDocument();
    expect(screen.getByText(/Tahminler .*toplanmaz/)).toBeInTheDocument();
  }, JOURNEY_MS);

  it('gelecek dönemde Gerçekleşen kaydı sayılmaz; tutar yazılmaz', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitForReport('Aylık plan ve gerçek');
    await user.click(screen.getByRole('combobox', { name: 'Dönem' }));
    await user.click(await screen.findByRole('option', { name: '2027' }));
    await pickReport(user, 'Kaleme göre harcama');
    expect(headerTitles(await waitForReport('Kaleme göre harcama'))).toContain(periodLabel('2027-12'));
    const KALEM = 'Örnek gider satırı 1';
    await waitFor(() => expect(screen.getByRole('row', { name: new RegExp(KALEM) }).textContent).toContain('12 plan · 0 gerçekleşen'));
    expect(screen.getByRole('row', { name: new RegExp(KALEM) }).textContent).not.toContain('₺');
  }, JOURNEY_MS);

  it('rapor değişince dışa aktarma yeni raporun satırlarıyla etkin kalır', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitForReport('Aylık plan ve gerçek');
    // Rapor satırlarını tablo çizildikten sonra (etkide) kaydeder; düğme bir sonraki çizimde etkinleşir.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Raporu dışa aktar' })).toBeEnabled());
    await pickReport(user, 'Kaleme göre harcama');
    await waitForReport('Kaleme göre harcama');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Raporu dışa aktar' })).toBeEnabled());
    await pickReport(user, 'Oda bazında alımlar');
    await waitForReport('Oda bazında alımlar');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Raporu dışa aktar' })).toBeEnabled());
  }, JOURNEY_MS);

  it('view_definitions nesilde yoksa pivot gerekçesiyle kullanılamaz', async () => {
    const user = userEvent.setup();
    renderPage('desktop', withoutCollection('view_definitions'));
    await waitForReport('Aylık plan ve gerçek');
    await pickReport(user, 'Kaleme göre harcama');
    await screen.findByText(/^Pivot kullanılamaz: /);
    expect(screen.queryByRole('combobox', { name: 'Ölçü' })).not.toBeInTheDocument();
  }, JOURNEY_MS);
});

describe('RaporlarPage › diğer raporlar', () => {
  it('Borç ödeme planı: payments koleksiyonu nesilde yok, dürüstçe söylenir', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitForReport('Aylık plan ve gerçek');
    await pickReport(user, 'Borç ödeme planı');
    expect(await screen.findByRole('heading', { level: 2, name: 'Kaynakta ödeme kaydı yok' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Raporu dışa aktar' })).not.toBeInTheDocument();
  }, JOURNEY_MS);

  it('Oda bazında alımlar: odaya göre sayar, tutar toplamaz (sahipliği belirlenmiş ölçü yok); odasız "Bilinmiyor"', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitForReport('Aylık plan ve gerçek');
    await pickReport(user, 'Oda bazında alımlar');
    const table = await waitForReport('Oda bazında alımlar');
    expect(headerTitles(table)).toEqual(['Oda', 'Alım', 'Plan tutarı yazılı', 'Gerçekleşen tutarı yazılı']);
    expect(bodyRows(table).length).toBeGreaterThan(0);
    expect(table.textContent).not.toContain('₺');
    expect(within(table).getByRole('row', { name: /Bilinmiyor/ })).toBeInTheDocument();
    expect(within(region('Oda bazında alımlar')).getByText(/^Tutar toplanmaz: alımların sahipliği belirlenmiş toplanabilir ölçüsü yok/)).toBeInTheDocument();
    const purchases = MANIFEST.files
      .filter((file) => file.collection === 'purchase_needs')
      .flatMap((file) => (JSON.parse(FILES[file.path]!) as { records: { deleted_at?: string | null }[] }).records)
      .filter((record) => !record.deleted_at);
    const counts = bodyRows(table).map((row) => Number(/^(\d+) alım$/.exec(within(row).getAllByRole('cell')[1]!.textContent ?? '')?.[1] ?? 'NaN'));
    expect(counts.reduce((a, b) => a + b, 0)).toBe(purchases.length);
  }, JOURNEY_MS);

  it('Veri güveni özeti: sorun kayıtlarını kod ve önemle sayar', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitForReport('Aylık plan ve gerçek');
    await pickReport(user, 'Veri güveni özeti');
    const table = await waitForReport('Veri güveni özeti');
    expect(headerTitles(table)).toEqual(['Kod', 'Önem', 'Kayıt']);
    const issues = MANIFEST.files
      .filter((file) => file.collection === 'issues')
      .flatMap((file) => (JSON.parse(FILES[file.path]!) as { records: { code: string; severity: string }[] }).records);
    const distinct = new Set(issues.map((issue) => `${issue.code}|${issue.severity}`)).size;
    expect(bodyRows(table)).toHaveLength(distinct);
  }, JOURNEY_MS);
});

describe('RaporlarPage › telefon', () => {
  it('rapor menüsü ve grafik yok; "Rapor" seçimi alt sayfada; sonuç akordeon, ilk satır açık', async () => {
    const user = userEvent.setup();
    renderPage('phone');
    expect(screen.queryByRole('navigation', { name: 'Raporlar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: REPORT_PICKER })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Rapor' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Raporu dışa aktar' })).toBeEnabled(), WAIT);
    const aylik = region('Aylık plan ve gerçek');
    const first = await within(aylik).findByRole('button', { name: /^Haziran 2026/ }, WAIT);
    expect(first).toHaveAttribute('aria-expanded', 'true');
    expect(within(aylik).getByRole('button', { name: /^Kasım 2026/ }).textContent).toContain('Kaynakta yazılı');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();

    await user.click(screen.getByRole('combobox', { name: 'Rapor' }));
    const sheet = screen.getByRole('dialog', { name: 'Rapor' });
    await user.click(within(sheet).getByRole('option', { name: 'Kaleme göre harcama' }));
    const kalem = await screen.findByRole('region', { name: 'Kaleme göre harcama' }, WAIT);
    expect(await within(kalem).findByRole('button', { name: /^Örnek gider satırı 1/ }, WAIT)).toHaveAttribute('aria-expanded', 'true');
    // Telefon profilinde geniş modül hiç istenmez (yükleme bitse de gelmez): grafik ve menü yok.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: REPORT_PICKER })).not.toBeInTheDocument();
  }, JOURNEY_MS);

  it('dönem değişince yeni sonucun ilk satırı açık gelir (akordeon önceki açık satırı taşımaz)', async () => {
    const user = userEvent.setup();
    renderPage('phone');
    const aylik = await screen.findByRole('region', { name: 'Aylık plan ve gerçek' }, WAIT);
    expect(await within(aylik).findByRole('button', { name: /^Haziran 2026/ }, WAIT)).toHaveAttribute('aria-expanded', 'true');

    await user.click(screen.getByRole('combobox', { name: 'Dönem' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Dönem' })).getByRole('option', { name: '2027' }));
    const ocak = await within(region('Aylık plan ve gerçek')).findByRole('button', { name: /^Ocak 2027/ }, WAIT);
    expect(ocak).toHaveAttribute('aria-expanded', 'true');
    expect(ocak.textContent).toContain('Henüz yok');
    const acik = within(region('Aylık plan ve gerçek')).getAllByRole('button', { expanded: true });
    expect(acik.map((b) => b.textContent?.slice(0, 9))).toEqual(['Ocak 2027']);
  }, JOURNEY_MS);

  it('Oda raporu oda adları gelmeden çizilmez; ilk oda açık, odasız "Bilinmiyor" sonda', async () => {
    const user = userEvent.setup();
    const source = new SlowRoomsSource();
    expect(ROOM_PATHS.size).toBeGreaterThan(0);
    renderPage('phone', source);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Raporu dışa aktar' })).toBeEnabled(), WAIT);
    await user.click(screen.getByRole('combobox', { name: 'Rapor' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Rapor' })).getByRole('option', { name: 'Oda bazında alımlar' }));
    // Odalar okunmadan sonuç yok: her alım "Bilinmiyor" odada sayılmaz, dışa aktarma da beklemede.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); });
    expect(screen.queryByRole('region', { name: 'Oda bazında alımlar' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Raporu dışa aktar' })).toBeDisabled();

    await act(async () => { source.release(); });
    const oda = await screen.findByRole('region', { name: 'Oda bazında alımlar' }, WAIT);
    const odalar = await within(oda).findAllByRole('button', { name: / alım/ }, WAIT);
    expect(odalar.length).toBeGreaterThan(1);
    expect(odalar[0]).toHaveAttribute('aria-expanded', 'true');
    expect(odalar[0]!.textContent).not.toMatch(/^Bilinmiyor/);
    expect(odalar.at(-1)!.textContent).toMatch(/^Bilinmiyor/);
  }, JOURNEY_MS);
});
