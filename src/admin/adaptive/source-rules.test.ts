import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { PHONE_WITHOUT_ANTD } from './flags';
import { antdImportViolations, antdSurfaceViolations, importsOf, isAntdSurface, preloadErrorViolations, wideRuleViolations } from './sourceRules';

// Kaynak düzeyi kapılar (uyarlamalı teslim):
//  1) App.tsx, main.tsx ve src/admin/adaptive/** (WideProviders.tsx hariç) antd yüzeyini statik içe aktarmaz.
//  2) Geniş-özel modüller *.wide.ts(x) adını taşır, yalnız lazyWide/wideResource içindeki açık import() ile yüklenir,
//     hiçbir yerde statik içe aktarılmaz ve default export verir.
//  3) antd (ham paket ya da ui/antd) yalnız ui/antd.ts (yüzey), adaptive/WideProviders.tsx ve theme/antdTheme.ts'te
//     içe aktarılır: sayfa/kabuk/ui kodu antd'yi statik çekerse telefon onu her rotada indirir (check-delivery --strict
//     sayfa kapanışlarını da denetler; bu kural sorunu derlemeden önce yakalar).
//  4) Uygulama kodu Vite'ın `vite:preloadError` olayını dinlemez: olayı iptal etmek başarısız importu `undefined` ile
//     çözer (lazyWide/Chart kurtarması bozulur), kendiliğinden yenileme içe aktarılan nesli ve taslakları siler. Parça
//     hatası rota sınırına ve lazyWide'a düşer; "Yeni sürüm var · Yenile" kullanıcının seçimidir.
const repo = resolve(__dirname, '../../..');
const adminDir = resolve(repo, 'src/admin');
const read = (path: string) => readFileSync(path, 'utf8');
const rel = (path: string) => relative(repo, path).split('\\').join('/');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(tsx?|mts)$/.test(entry) && !/\.test\.(tsx?|mts)$/.test(entry)) out.push(path);
  }
  return out;
}

describe('sourceRules (saf; kapı ihlali yakalar)', () => {
  it('extracts static, dynamic and type-only imports, ignoring comments', () => {
    const source = [
      "import { Button } from 'antd';",
      "import type { ThemeConfig } from '../ui/antd';",
      "export { x } from './x';",
      "import './side.css';",
      "// import { Gone } from 'antd';",
      "/* import Nope from '@ant-design/pro-components'; */",
      "const Wide = lazyWide('tablo', () => import('./Tablo.wide'));",
    ].join('\n');
    expect(importsOf(source)).toEqual([
      { specifier: 'antd', kind: 'static', typeOnly: false },
      { specifier: '../ui/antd', kind: 'static', typeOnly: true },
      { specifier: './x', kind: 'static', typeOnly: false },
      { specifier: './side.css', kind: 'static', typeOnly: false },
      { specifier: './Tablo.wide', kind: 'dynamic', typeOnly: false },
    ]);
  });

  it('recognises the antd surface (raw packages, ui/antd, antd theme, ui wrappers)', () => {
    for (const spec of ['antd', 'antd/locale/tr_TR', '@ant-design/pro-components', '../ui/antd', './ui/antd', '../theme/antdTheme', './theme/antdTheme', '../ui', './ui', '../ui/Button', '@/admin/ui/Table']) {
      expect(isAntdSurface(spec), spec).toBe(true);
    }
    for (const spec of ['react', 'antd-mobile', './build', '../design/tokens.ts', './adaptive/context', '../quick']) {
      expect(isAntdSurface(spec), spec).toBe(false);
    }
  });

  it('flags a static antd surface import in a guarded file but not a type-only or dynamic one', () => {
    expect(antdSurfaceViolations('src/admin/adaptive/x.tsx', "import { AntApp } from '../ui/antd';")).toEqual(['src/admin/adaptive/x.tsx: statik antd yüzeyi ../ui/antd']);
    expect(antdSurfaceViolations('src/admin/adaptive/x.tsx', "import { WideProviders } from './WideProviders';")).toEqual(['src/admin/adaptive/x.tsx: statik antd yüzeyi ./WideProviders']);
    expect(antdSurfaceViolations('src/admin/adaptive/x.tsx', "import type { ThemeConfig } from '../ui/antd';\nconst m = () => import('../ui/antd');")).toEqual([]);
  });

  it('flags static imports of wide modules, non-literal loaders, non-.wide targets and missing default exports', () => {
    expect(wideRuleViolations('src/admin/pages/A.tsx', "import Tablo from './Tablo.wide';")).toEqual(['src/admin/pages/A.tsx: geniş modül statik içe aktarılmış ./Tablo.wide']);
    expect(wideRuleViolations('src/admin/pages/A.tsx', "import type { Props } from './Tablo.wide';")).toEqual([]);
    expect(wideRuleViolations('src/admin/pages/A.tsx', "const T = lazyWide('tablo', loader);")).toEqual(["src/admin/pages/A.tsx: lazyWide/wideResource açık () => import('…') ile çağrılmalı"]);
    expect(wideRuleViolations('src/admin/pages/A.tsx', "const T = lazyWide('tablo', () => import('./Tablo'));")).toEqual(['src/admin/pages/A.tsx: geniş modül adı *.wide olmalı: ./Tablo']);
    expect(wideRuleViolations('src/admin/pages/A.tsx', "const T = lazyWide('tablo', () => import('./Tablo.wide'));\nconst P = wideResource('providers', () => import('./adaptive/WideProviders'));")).toEqual([]);
    expect(wideRuleViolations('src/admin/ui/wide/Tablo.wide.tsx', 'export function Tablo() { return null; }')).toEqual(['src/admin/ui/wide/Tablo.wide.tsx: *.wide modülü default export vermeli']);
    expect(wideRuleViolations('src/admin/ui/wide/Tablo.wide.tsx', 'export default function Tablo() { return null; }')).toEqual([]);
  });

  // İnceleme bulgusu (minor): tür argümanlı çağrı (GenelPage.tsx: lazyWide<GenelSunumProps>(…)) iki düzenli ifadeye de
  // girmiyordu; sabit olmayan yükleyici ya da .wide olmayan hedef kuraldan geçiyordu.
  it('sees generic lazyWide<P>(…) / wideResource<M>(…) calls: non-literal loaders and non-.wide targets are flagged', () => {
    expect(wideRuleViolations('src/admin/pages/A.tsx', "const T = lazyWide<Props>('tablo', loader);")).toEqual(["src/admin/pages/A.tsx: lazyWide/wideResource açık () => import('…') ile çağrılmalı"]);
    expect(wideRuleViolations('src/admin/pages/A.tsx', "const T = lazyWide<Props>('tablo', () => import('./Tablo'));")).toEqual(['src/admin/pages/A.tsx: geniş modül adı *.wide olmalı: ./Tablo']);
    expect(wideRuleViolations('src/admin/pages/A.tsx', "const R = wideResource<{ default: Modul<string> }>('r', () => import('./Hesap'));")).toEqual(['src/admin/pages/A.tsx: geniş modül adı *.wide olmalı: ./Hesap']);
    expect(wideRuleViolations('src/admin/pages/A.tsx', "const T = lazyWide<Props>('tablo', () => import('./Tablo.wide'));\nconst R = wideResource < Modul > ('r', () => import('./r/Hesap.wide'));")).toEqual([]);
  });

  it('flags static antd imports (raw package or ui/antd) outside ui/antd.ts, adaptive/WideProviders.tsx and theme/antdTheme.ts', () => {
    expect(antdImportViolations('src/admin/pages/OdemelerPage.tsx', "import { ConfigProvider } from '../ui/antd';")).toEqual(['src/admin/pages/OdemelerPage.tsx: antd yalnız ui/antd.ts, adaptive/WideProviders.tsx ve theme/antdTheme.ts içinde: ../ui/antd']);
    expect(antdImportViolations('src/admin/shell/Page.tsx', "import { Button } from 'antd';\nimport { ProTable } from '@ant-design/pro-components';")).toEqual([
      'src/admin/shell/Page.tsx: antd yalnız ui/antd.ts, adaptive/WideProviders.tsx ve theme/antdTheme.ts içinde: antd',
      'src/admin/shell/Page.tsx: antd yalnız ui/antd.ts, adaptive/WideProviders.tsx ve theme/antdTheme.ts içinde: @ant-design/pro-components',
    ]);
    expect(antdImportViolations('src/admin/ui/Table.tsx', "export { Table } from './antd';")).toEqual(['src/admin/ui/Table.tsx: antd yalnız ui/antd.ts, adaptive/WideProviders.tsx ve theme/antdTheme.ts içinde: ./antd']);
    expect(antdImportViolations('src/admin/pages/alimlar/Tablo.wide.tsx', "import { Table } from '@/admin/ui/antd';")).toEqual(['src/admin/pages/alimlar/Tablo.wide.tsx: antd yalnız ui/antd.ts, adaptive/WideProviders.tsx ve theme/antdTheme.ts içinde: @/admin/ui/antd']);
    // İzinli dosyalar, tür importu ve benzer adlar ihlal değildir.
    expect(antdImportViolations('src/admin/ui/antd.ts', "export { ConfigProvider, theme } from 'antd';")).toEqual([]);
    expect(antdImportViolations('src/admin/adaptive/WideProviders.tsx', "import { ConfigProvider, trTR } from '../ui/antd';")).toEqual([]);
    expect(antdImportViolations('src/admin/theme/antdTheme.ts', "import type { ThemeConfig } from '../ui/antd';")).toEqual([]);
    expect(antdImportViolations('src/admin/pages/A.tsx', "import type { ThemeConfig } from '../ui/antd';\nimport { x } from '../ui/antdish';\nimport { y } from './antd-mobile';")).toEqual([]);
  });

  it('flags any vite:preloadError listener in application code', () => {
    expect(preloadErrorViolations('src/admin/main.tsx', "window.addEventListener('vite:preloadError', event => { event.preventDefault(); location.reload(); });")).toEqual(['src/admin/main.tsx: vite:preloadError dinlenmez (parça hatası rota sınırına ve lazyWide kurtarmasına düşer)']);
    expect(preloadErrorViolations('src/admin/x.ts', 'const EVENT = "vite:preloadError";')).toEqual(['src/admin/x.ts: vite:preloadError dinlenmez (parça hatası rota sınırına ve lazyWide kurtarmasına düşer)']);
    expect(preloadErrorViolations('src/admin/x.ts', "// 'vite:preloadError' yalnız yorumda\nconst a = 1;")).toEqual([]);
  });
});

describe('uyarlamalı teslim kapıları (depo taraması)', () => {
  it('App.tsx, main.tsx and src/admin/adaptive/** (except WideProviders.tsx) import no antd surface statically', () => {
    const guarded = [resolve(adminDir, 'App.tsx'), resolve(adminDir, 'main.tsx'), ...walk(resolve(adminDir, 'adaptive'))]
      .filter(path => !/[\\/]adaptive[\\/]WideProviders\.tsx$/.test(path));
    expect(guarded.length).toBeGreaterThan(5);
    const violations = guarded.flatMap(path => {
      const name = rel(path);
      // App.tsx geçiş süresince WideProviders'ı statik bağlar; bayrak çevrilince bu da tembel olmalı.
      const found = antdSurfaceViolations(name, read(path));
      return name === 'src/admin/App.tsx' && !PHONE_WITHOUT_ANTD ? found.filter(v => !/WideProviders$/.test(v)) : found;
    });
    expect(violations).toEqual([]);
  });

  it('the adaptive barrel does not re-export WideProviders (keeps antd out of its graph)', () => {
    const barrel = read(resolve(adminDir, 'adaptive/index.ts'));
    expect(importsOf(barrel).map(ref => ref.specifier)).not.toContainEqual(expect.stringMatching(/WideProviders/));
  });

  it('src/admin imports antd only in ui/antd.ts, adaptive/WideProviders.tsx and theme/antdTheme.ts', () => {
    const files = walk(adminDir);
    expect(files.length).toBeGreaterThan(50);
    expect(files.flatMap(path => antdImportViolations(rel(path), read(path)))).toEqual([]);
  });

  it('src/admin never listens to (or cancels) vite:preloadError; there is no automatic reload on a chunk error', () => {
    const files = walk(adminDir).filter(path => !/[\\/]adaptive[\\/]sourceRules\.ts$/.test(path));
    expect(files.flatMap(path => preloadErrorViolations(rel(path), read(path)))).toEqual([]);
  });

  it('src/admin follows the *.wide rule', () => {
    const files = walk(adminDir).filter(path => !/[\\/]adaptive[\\/](loader|sourceRules)\.ts$/.test(path));
    expect(files.flatMap(path => wideRuleViolations(rel(path), read(path)))).toEqual([]);
  });

  it('application code never imports the vitest-only adaptive/testing helper', () => {
    const offenders = walk(adminDir)
      .filter(path => importsOf(read(path)).some(ref => /(^|\/)adaptive\/testing$|^\.\/testing$/.test(ref.specifier)))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it('main.tsx imports the fonts.css placeholder owned by the E03 font task', () => {
    const fonts = resolve(adminDir, 'fonts.css');
    expect(existsSync(fonts)).toBe(true);
    expect(read(fonts)).toContain('Sahibi E03 font görevi');
    expect(importsOf(read(resolve(adminDir, 'main.tsx'))).map(ref => ref.specifier)).toContain('./fonts.css');
  });
});
