import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { ChangeSet, FixtureGenerationSource, GenerationProvider, createMemoryStorage } from './data';
import { DeviceContext } from './device';
import { adminPages, settingsLink } from './shell/navigation';
import { AntApp, ConfigProvider } from './ui/antd';
import { AdminRoutes } from './routes';

// Rota → sayfa eşlemesi: her nav yolu kendi sayfasını React.lazy ile yükler; yüklenirken aynı PageHeader (başlık
// korunur) + LoadingShell; /alimlar/:id ayrıntı AlimlarPage'e gider; bilinmeyen konum /genel'e (Genel durum) yönlenir.
// Sayfa modülleri gerçektir; yalnız "hangi sayfa hangi props ile çizildi" kaydı için ince bir sarmalayıcı eklenir.

const rendered = vi.hoisted(() => new Map<string, Record<string, unknown>>());
const track = vi.hoisted(() => async (mod: Record<string, unknown>, name: string) => {
  const { createElement } = await import('react');
  const Real = mod[name] as Parameters<typeof createElement>[0];
  const Tracked = (props: Record<string, unknown>) => {
    rendered.set(name, props);
    return createElement(Real, props);
  };
  return { ...mod, [name]: Tracked };
});

vi.mock('./pages/GenelPage', async importOriginal => track(await importOriginal(), 'GenelPage'));
vi.mock('./pages/ButcePage', async importOriginal => track(await importOriginal(), 'ButcePage'));
vi.mock('./pages/OdemelerPage', async importOriginal => track(await importOriginal(), 'OdemelerPage'));
vi.mock('./pages/HesaplarPage', async importOriginal => track(await importOriginal(), 'HesaplarPage'));
vi.mock('./pages/AlimlarPage', async importOriginal => track(await importOriginal(), 'AlimlarPage'));
vi.mock('./pages/EvPage', async importOriginal => track(await importOriginal(), 'EvPage'));
vi.mock('./pages/ProjelerPage', async importOriginal => track(await importOriginal(), 'ProjelerPage'));
vi.mock('./pages/TaraflarPage', async importOriginal => track(await importOriginal(), 'TaraflarPage'));
vi.mock('./pages/RaporlarPage', async importOriginal => track(await importOriginal(), 'RaporlarPage'));
vi.mock('./pages/SozluklerPage', async importOriginal => track(await importOriginal(), 'SozluklerPage'));
vi.mock('./pages/VeriPage', async importOriginal => track(await importOriginal(), 'VeriPage'));
vi.mock('./pages/AyarlarPage', async importOriginal => track(await importOriginal(), 'AyarlarPage'));

// ECharts çekirdeği jsdom'da çizilmez (sayfa testleriyle aynı mock).
vi.mock('echarts/core', () => ({ init: vi.fn(() => ({ setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() })), use: vi.fn(), registerTheme: vi.fn() }));
vi.mock('echarts/charts', () => ({ BarChart: {}, LineChart: {} }));
vi.mock('echarts/components', () => ({ GridComponent: {}, TooltipComponent: {}, LegendComponent: {} }));
vi.mock('echarts/renderers', () => ({ CanvasRenderer: {} }));

// --- Sentetik nesil → bellek -----------------------------------------------------------------------------------
const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = join(here, '../../fixtures/generation-synthetic');
const GENERATION_DIR = join(FIXTURE_ROOT, readdirSync(FIXTURE_ROOT).find(name => statSync(join(FIXTURE_ROOT, name)).isDirectory())!);

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

function renderAt(path: string) {
  const memory = memoryLocation({ path, record: true });
  const changeSet = () => ChangeSet.load({ storage: createMemoryStorage() });
  const view = render(
    <ConfigProvider>
      <AntApp>
        <DeviceContext.Provider value="desktop">
          <GenerationProvider source={new FixtureGenerationSource(FILES, 'sentetik')} cache={null} changeSet={changeSet}>
            <Router hook={memory.hook}>
              <AdminRoutes />
            </Router>
          </GenerationProvider>
        </DeviceContext.Provider>
      </AntApp>
    </ConfigProvider>,
  );
  return { ...view, memory };
}

const ROUTES: readonly { path: string; title: string; page: string }[] = [
  { path: '/genel', page: 'GenelPage' },
  { path: '/butce', page: 'ButcePage' },
  { path: '/odemeler', page: 'OdemelerPage' },
  { path: '/hesaplar', page: 'HesaplarPage' },
  { path: '/alimlar', page: 'AlimlarPage' },
  { path: '/ev', page: 'EvPage' },
  { path: '/projeler', page: 'ProjelerPage' },
  { path: '/taraflar', page: 'TaraflarPage' },
  { path: '/raporlar', page: 'RaporlarPage' },
  { path: '/sozlukler', page: 'SozluklerPage' },
  { path: '/veri', page: 'VeriPage' },
  { path: settingsLink.path, page: 'AyarlarPage' },
].map(route => ({ ...route, title: [...adminPages, settingsLink].find(link => link.path === route.path)!.label }));

const h1 = (name: string) => screen.getByRole('heading', { level: 1, name });

beforeEach(() => {
  rendered.clear();
  // Canlı GViz / Apps Script okumaları ağa çıkmasın; sayfalar bunu "Hata: …" olarak gösterir.
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('ağ yok'))));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AdminRoutes › yüklenirken', () => {
  it('sayfa modülü gelmeden aynı başlık (bölüm + h1 + amaç) ve LoadingShell çizilir', async () => {
    renderAt('/veri');
    // İlk kare: lazy modül henüz çözülmedi.
    expect(rendered.has('VeriPage')).toBe(false);
    expect(h1('Veri kalitesi ve içe aktarma')).toBeInTheDocument();
    expect(screen.getByText('E-tablodan gelen veriyi içe aktarın, eşleşmeyen satırları ve çakışmaları çözün.')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Yükleniyor');
    await waitFor(() => expect(rendered.has('VeriPage')).toBe(true));
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(h1('Veri kalitesi ve içe aktarma')).toBeInTheDocument();
  });
});

describe('AdminRoutes › 12 rota', () => {
  it.each(ROUTES)('$path → $page (lazy) ve h1 "$title"', async ({ path, title, page }) => {
    renderAt(path);
    await waitFor(() => expect(rendered.has(page)).toBe(true), { timeout: 10_000 });
    expect(rendered.size).toBe(1);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(h1(title)).toBeInTheDocument();
  }, 20_000);
});

describe('AdminRoutes › ayrıntı ve yönlendirme', () => {
  it('/alimlar/:id ayrıntısı AlimlarPage ile açılır; sayfa kendi yolunu (/alimlar) alır, seçimi hash\'ten okur', async () => {
    const { memory } = renderAt('/alimlar/2f1c0a64-6a39-5f0c-9d64-000000000001');
    await waitFor(() => expect(rendered.has('AlimlarPage')).toBe(true), { timeout: 10_000 });
    expect(rendered.get('AlimlarPage')).toMatchObject({ location: '/alimlar' });
    expect(h1('Alımlar ve eşyalar')).toBeInTheDocument();
    expect(memory.history).toEqual(['/alimlar/2f1c0a64-6a39-5f0c-9d64-000000000001']);
  }, 20_000);

  it.each(['/yok', '/', '', '/alimlarx', '/genel-eski'])('bilinmeyen "%s" → /genel (replace; geçmişe kayıt eklemez)', async path => {
    const { memory } = renderAt(path);
    await waitFor(() => expect(memory.history.at(-1)).toBe('/genel'));
    expect(memory.history).toEqual(['/genel']);
    await waitFor(() => expect(rendered.has('GenelPage')).toBe(true), { timeout: 10_000 });
    expect(rendered.has('AlimlarPage')).toBe(false);
    expect(h1('Genel durum')).toBeInTheDocument();
  }, 20_000);

  it('iç içe yol üst sayfada kalır (/raporlar/aylik → Raporlar)', async () => {
    renderAt('/raporlar/aylik');
    await waitFor(() => expect(rendered.has('RaporlarPage')).toBe(true), { timeout: 10_000 });
    expect(h1('Raporlar')).toBeInTheDocument();
  }, 20_000);

  it('sayfa içi gezinme mutlak yoldur: Genel › "Aylık rapor" /raporlar\'a gider (/genel/raporlar değil)', async () => {
    const user = userEvent.setup();
    const { memory } = renderAt('/genel');
    await waitFor(() => expect(rendered.has('GenelPage')).toBe(true), { timeout: 10_000 });
    await user.click(screen.getByRole('button', { name: 'Aylık rapor' }));
    await waitFor(() => expect(memory.history.at(-1)).toBe('/raporlar'));
    await waitFor(() => expect(rendered.has('RaporlarPage')).toBe(true), { timeout: 10_000 });
    expect(h1('Raporlar')).toBeInTheDocument();
  }, 20_000);
});
