import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentType } from 'react';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { reloadPage } from './adaptive/reload';
import { importsOf } from './adaptive/sourceRules';
import { DeviceContext } from './device';
import { createAdminRoutes, type AdminRouteKey, type PageLoader, type RoutePageProps } from './routes';
import { adminLeads, adminPages, settingsLink } from './shell/navigation';

// Rota tablosunun yükleme ve kurtarma sözleşmesi, sahte sayfa yükleyicileriyle (gerçek sayfa modülü yüklenmez):
//  - Her sayfa kendi React.lazy parçasıdır; yalnız ziyaret edilen sayfanın yükleyicisi çağrılır (spekülatif ön yükleme yok).
//  - Parça indirilemezse bir kez kendiliğinden yeniden denenir; yine olmazsa rota düzeyindeki hata sınırı aynı başlığı
//    (bölüm + h1 + amaç) korur; kabuk ve diğer rotalar etkilenmez.
//  - Çevrim içiyken parça hatası sürüm kaymasıdır (eski index.html'in parçası artık sunucuda yok): WideNotice
//    "Yeni sürüm var · Yenile" sayfayı yeniden yükler (adaptive/reload). W0 lazyWide ile aynı ayrım.
//  - Çevrim dışı parça hatası ya da parça dışı hata (modül değerlendirme, çizim): ErrorState "Yeniden dene" lazy sayfayı
//    yeniden kurar (React.lazy'nin önbelleğe aldığı ret kullanılmaz) ve odağı main'e taşır.

const KEYS: readonly AdminRouteKey[] = [...adminPages.map(item => item.key as AdminRouteKey), 'ayarlar'];
const LABEL = Object.fromEntries([...adminPages, settingsLink].map(link => [link.path, link.label])) as Record<string, string>;
const chunkError = (file: string) => new TypeError(`Failed to fetch dynamically imported module: http://127.0.0.1/aile/assets/${file}-AbCd1234.js`);

/** Sahte sayfa: kendi yolunu ve anahtarını yazar. */
const stubPage = (key: AdminRouteKey): ComponentType<RoutePageProps> =>
  function Stub({ location }: RoutePageProps) {
    return <p>{`${key} içeriği · ${location}`}</p>;
  };

function makeLoaders(overrides: Partial<Record<AdminRouteKey, PageLoader>> = {}) {
  const loaders = Object.fromEntries(
    KEYS.map(key => [key, vi.fn<PageLoader>(overrides[key] ?? (() => Promise.resolve(stubPage(key))))]),
  ) as Record<AdminRouteKey, ReturnType<typeof vi.fn<PageLoader>>>;
  const called = () => KEYS.filter(key => loaders[key].mock.calls.length > 0);
  return { loaders, called };
}

function renderRoutes(path: string, loaders: Record<AdminRouteKey, PageLoader>) {
  const Routes = createAdminRoutes(loaders, { retryDelayMs: 0 });
  const memory = memoryLocation({ path, record: true });
  const view = render(
    <DeviceContext.Provider value="phone">
      <Router hook={memory.hook}>
        <main id="admin-content" tabIndex={-1}>
          <Routes />
        </main>
      </Router>
    </DeviceContext.Provider>,
  );
  return { ...view, memory };
}

const h1 = () => screen.getByRole('heading', { level: 1 });
/** a, belge sırasında b'den önce mi. */
const before = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('createAdminRoutes › yükleme', () => {
  it('yalnız ziyaret edilen sayfanın parçası yüklenir; başka sayfa ya da parça önceden istenmez', async () => {
    const { loaders, called } = makeLoaders();
    const { memory } = renderRoutes('/genel', loaders);
    expect(await screen.findByText('genel içeriği · /genel')).toBeInTheDocument();
    expect(called()).toEqual(['genel']);
    expect(loaders.genel).toHaveBeenCalledTimes(1);

    act(() => memory.navigate('/butce'));
    expect(await screen.findByText('butce içeriği · /butce')).toBeInTheDocument();
    expect(called()).toEqual(['genel', 'butce']);

    // Geri dönüş yeniden indirmez (lazy önbelleği).
    act(() => memory.navigate('/genel'));
    expect(await screen.findByText('genel içeriği · /genel')).toBeInTheDocument();
    expect(loaders.genel).toHaveBeenCalledTimes(1);
  });

  it('iç içe yol üst sayfanın parçasını kullanır; /alimlar/:id ayrıntısı Alımlar sayfasıdır ve sayfa kendi yolunu alır', async () => {
    const { loaders, called } = makeLoaders();
    const { memory } = renderRoutes('/alimlar/kayit-1', loaders);
    expect(await screen.findByText('alimlar içeriği · /alimlar')).toBeInTheDocument();
    act(() => memory.navigate('/alimlar/kayit-2'));
    expect(await screen.findByText('alimlar içeriği · /alimlar')).toBeInTheDocument();
    expect(loaders.alimlar).toHaveBeenCalledTimes(1);
    expect(called()).toEqual(['alimlar']);
    expect(memory.history).toEqual(['/alimlar/kayit-1', '/alimlar/kayit-2']);
  });

  it('bilinmeyen rota /genel\'e yönlenir (replace) ve yalnız Genel parçasını yükler', async () => {
    const { loaders, called } = makeLoaders();
    const { memory } = renderRoutes('/eski-sayfa', loaders);
    expect(await screen.findByText('genel içeriği · /genel')).toBeInTheDocument();
    expect(memory.history).toEqual(['/genel']);
    expect(called()).toEqual(['genel']);
  });
});

vi.mock('./adaptive/reload', () => ({ reloadPage: vi.fn() }));

/** Rota sınırının sürüm kayması bildirimi (WideNotice stale-build). */
const staleNotice = () => document.querySelector<HTMLElement>('.aile-wide-notice[data-kind="stale-build"]');

describe('createAdminRoutes › kurtarılabilir hata sınırı', () => {
  beforeEach(() => {
    // React yakalanan hataları console.error'a yazar; beklenen hatalar test çıktısını kirletmesin.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(reloadPage).mockClear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Sınır görünümünde başlık korunur: bölüm + tek h1 (menü etiketi) + amaç; iskelet (aria-busy) kalmaz. */
  function expectHeaderKept(path: string) {
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(h1()).toHaveTextContent(LABEL[path]);
    expect(screen.getByText(adminLeads[path])).toBeInTheDocument();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  }

  it('çevrim içi parça hatası (sürüm kayması): bir otomatik yeniden deneme, sonra başlık + "Yeni sürüm var · Yenile"; Yenile sayfayı yeniden yükler', async () => {
    const user = userEvent.setup();
    const { loaders } = makeLoaders({ veri: () => Promise.reject(chunkError('VeriPage')) });
    renderRoutes('/veri', loaders);

    const notice = await screen.findByText('Yeni sürüm var');
    expect(loaders.veri).toHaveBeenCalledTimes(2);
    expect(staleNotice()).not.toBeNull();
    expect(staleNotice()).toHaveAttribute('role', 'status');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Yeniden dene' })).toBeNull();
    expectHeaderKept('/veri');
    expect(screen.getByText('Yapı', { selector: 'p' })).toBeInTheDocument();
    expect(before(h1(), notice)).toBe(true);

    await user.click(within(staleNotice()!).getByRole('button', { name: 'Yenile' }));
    expect(reloadPage).toHaveBeenCalledTimes(1);
    // Yenileme sayfanın işidir; sınır kendiliğinden yeniden indirmez.
    expect(loaders.veri).toHaveBeenCalledTimes(2);
  });

  it('çevrim dışı parça hatası: ErrorState "Yeniden dene" (yenileme değil); deneme parçayı yeniden indirir ve odak main\'e geçer', async () => {
    const user = userEvent.setup();
    const online = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    let failures = 2;
    const { loaders } = makeLoaders({
      veri: () => (failures-- > 0 ? Promise.reject(chunkError('VeriPage')) : Promise.resolve(stubPage('veri'))),
    });
    renderRoutes('/veri', loaders);

    const alert = await screen.findByRole('alert');
    expect(loaders.veri).toHaveBeenCalledTimes(2);
    expect(within(alert).getByRole('heading', { level: 2 })).toHaveTextContent('Hata: Sayfa yüklenemedi');
    expect(alert).toHaveTextContent('bağlantı yok');
    expect(staleNotice()).toBeNull();
    expectHeaderKept('/veri');

    online.mockReturnValue(true);
    await user.click(within(alert).getByRole('button', { name: 'Yeniden dene' }));
    expect(await screen.findByText('veri içeriği · /veri')).toBeInTheDocument();
    expect(loaders.veri).toHaveBeenCalledTimes(3);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('main')).toHaveFocus();
    expect(reloadPage).not.toHaveBeenCalled();
  });

  it('otomatik yeniden deneme başarılıysa hata hiç görünmez', async () => {
    let failures = 1;
    const { loaders } = makeLoaders({
      odemeler: () => (failures-- > 0 ? Promise.reject(chunkError('OdemelerPage')) : Promise.resolve(stubPage('odemeler'))),
    });
    renderRoutes('/odemeler', loaders);
    expect(await screen.findByText('odemeler içeriği · /odemeler')).toBeInTheDocument();
    expect(loaders.odemeler).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(staleNotice()).toBeNull();
  });

  it('parça dışı yükleme hatası (modül değerlendirilemedi): ErrorState "Yeniden dene" lazy sayfayı yeniden kurar', async () => {
    const user = userEvent.setup();
    let failures = 2;
    const { loaders } = makeLoaders({
      taraflar: () => (failures-- > 0 ? Promise.reject(new SyntaxError('Unexpected token')) : Promise.resolve(stubPage('taraflar'))),
    });
    renderRoutes('/taraflar', loaders);

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('heading', { level: 2 })).toHaveTextContent('Hata: Sayfa açılamadı');
    expect(staleNotice()).toBeNull();
    expectHeaderKept('/taraflar');

    await user.click(within(alert).getByRole('button', { name: 'Yeniden dene' }));
    expect(await screen.findByText('taraflar içeriği · /taraflar')).toBeInTheDocument();
    expect(loaders.taraflar).toHaveBeenCalledTimes(3);
    expect(reloadPage).not.toHaveBeenCalled();
  });

  it('sayfa çizilirken hata: "Hata: Sayfa açılamadı" + "Yeniden dene" sayfayı yeniden çizer', async () => {
    const user = userEvent.setup();
    let broken = true;
    function Fragile() {
      if (broken) throw new Error('beklenmeyen veri');
      return <p>ev içeriği</p>;
    }
    const { loaders } = makeLoaders({ ev: () => Promise.resolve(Fragile) });
    renderRoutes('/ev', loaders);

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('heading', { level: 2 })).toHaveTextContent('Hata: Sayfa açılamadı');
    expect(alert).not.toHaveTextContent('Uygulama güncellenmiş olabilir');
    expect(h1()).toHaveTextContent(LABEL['/ev']);

    broken = false;
    await user.click(within(alert).getByRole('button', { name: 'Yeniden dene' }));
    expect(await screen.findByText('ev içeriği')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('sayfa içinden atılan parça hatası da sürüm kaymasıdır (iç içe lazy parça): "Yeni sürüm var · Yenile"', async () => {
    function NeedsChunk(): never {
      throw chunkError('AlimlarTablo');
    }
    const { loaders } = makeLoaders({ projeler: () => Promise.resolve(NeedsChunk) });
    renderRoutes('/projeler', loaders);
    expect(await screen.findByText('Yeni sürüm var')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(h1()).toHaveTextContent(LABEL['/projeler']);
  });

  it('hata rotaya özeldir: başka sayfaya geçiş çalışır, geri dönüş parçayı yeniden indirir', async () => {
    let failures = 2;
    const { loaders } = makeLoaders({
      raporlar: () => (failures-- > 0 ? Promise.reject(chunkError('RaporlarPage')) : Promise.resolve(stubPage('raporlar'))),
    });
    const { memory } = renderRoutes('/raporlar', loaders);
    await screen.findByText('Yeni sürüm var');
    expect(loaders.raporlar).toHaveBeenCalledTimes(2);

    act(() => memory.navigate('/genel'));
    expect(await screen.findByText('genel içeriği · /genel')).toBeInTheDocument();
    expect(staleNotice()).toBeNull();

    act(() => memory.navigate('/raporlar'));
    expect(await screen.findByText('raporlar içeriği · /raporlar')).toBeInTheDocument();
    expect(loaders.raporlar).toHaveBeenCalledTimes(3);
    expect(staleNotice()).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('routes.tsx kaynağı (telefon teslimi)', () => {
  const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'routes.tsx'), 'utf8');
  const refs = importsOf(source).filter(ref => !ref.typeOnly);

  it('her sayfa yalnız dinamik import() ile, kendi parçasında; sayfa ya da geniş modül statik içe aktarılmaz', () => {
    const dynamicPages = refs.filter(ref => ref.kind === 'dynamic').map(ref => ref.specifier).sort();
    expect(dynamicPages).toEqual(
      ['Alimlar', 'Ayarlar', 'Butce', 'Ev', 'Genel', 'Hesaplar', 'Odemeler', 'Projeler', 'Raporlar', 'Sozlukler', 'Taraflar', 'Veri']
        .map(name => `./pages/${name}Page`).sort(),
    );
    expect(refs.filter(ref => ref.kind === 'static' && /\/pages\/|\.wide$/.test(ref.specifier))).toEqual([]);
  });

  it('ui barrel, antd, ECharts yok; yalnız çizdiği ui modülleri', () => {
    const specifiers = refs.filter(ref => ref.kind === 'static').map(ref => ref.specifier);
    expect(specifiers.filter(specifier => /^\.\/ui(?:\/index)?$/.test(specifier))).toEqual([]);
    expect(specifiers.filter(specifier => /(^|\/)(antd|@ant-design|echarts|zrender)(\/|$)|ui\/antd/.test(specifier))).toEqual([]);
    expect(specifiers.filter(specifier => specifier.startsWith('./ui/')).sort()).toEqual(['./ui/ErrorState', './ui/LoadingShell']);
  });
});
