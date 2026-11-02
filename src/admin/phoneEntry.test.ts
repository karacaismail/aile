import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => vi.stubEnv('VITE_BUDGET_SHEET_ID', 'synthetic-budget-sheet-2098'));
import { sheetUrl } from '../dashboard/data';
import { importsOf } from './adaptive/sourceRules';
import { sheetLink } from './shell/navigation';

// Telefon ilk rotası JS bütçesi (scripts/budgets.json phone-js, 120 KB): yönetim girişinin (src/admin/main.tsx) kaynak
// düzeyi statik kapanışı ilk boyamada gerekmeyen katmanları taşımaz. Bu, derlemedeki statik kapanışın üst kümesidir
// (ağaç sarsması yok sayılır): burada yoksa derlemede de girişte yoktur. Ölçüm ve önce/sonra: docs/ADMIN-BUDGETS.md.
//  - Zod ve sözleşme şemaları (data/contract.ts): doğrulama nesil okunurken store.ts'ten tembel iner.
//  - src/dashboard/data.ts (GViz okuyucusu + Zod): kabuk e-tablo adresini kendisi kurar.
//  - Veri barrel'ı (data/index.ts): giriş sağlayıcıyı doğrudan modülünden alır; barrel her katmanı (canlı veri, görünüm
//    kataloğu, CSV) statik bağlardı.
//  - İndeks ve sorgu katmanı (indexes.ts, query.ts): yalnız useRows/useQuery kullanan sayfalar çeker.
//  - Sayfalar çekmecesi (shell/MobileNavDrawer.tsx): kapalıyken çizilmez, ilk niyette iner.

const ROOT = resolve(__dirname, '../..');
const ALIASES: Readonly<Record<string, string>> = { '@/': 'src/', '@shared/': 'shared/' };
const EXTENSIONS = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];

type Exists = (file: string) => boolean;

/** Göreli ya da takma adlı belirteci depo içi dosyaya çözer; paket belirteci için null. */
function resolveLocal(fromFile: string, specifier: string, exists: Exists): string | null {
  let base: string | null = null;
  if (/^\.{1,2}\//.test(specifier)) base = join(dirname(fromFile), specifier);
  for (const [alias, target] of Object.entries(ALIASES)) if (specifier.startsWith(alias)) base = join(ROOT, target, specifier.slice(alias.length));
  if (base === null) return null;
  for (const extension of EXTENSIONS) {
    const candidate = `${base}${extension}`;
    if (exists(candidate) && /\.(?:ts|tsx|js|mjs)$/.test(candidate)) return candidate;
  }
  return /\.(?:css|svg|json)$/.test(specifier) ? null : `${base}?çözülemedi`;
}

/** Paket adı: '@kapsam/ad/alt/yol' → '@kapsam/ad', 'ad/alt' → 'ad'. */
const packageName = (specifier: string) => specifier.split('/').slice(0, specifier.startsWith('@') ? 2 : 1).join('/');

interface Closure { files: Set<string>; packages: Set<string>; unresolved: string[] }

/**
 * Girişten statik (tür-yalnız olmayan) import ve yeniden dışa verim (`export … from`) kenarlarıyla erişilen dosyalar ve
 * paketler. Dinamik import() kenarı izlenmez: o modül ayrı, tembel bir parçadır.
 */
function staticClosure(
  entry: string,
  read: (file: string) => string = (file) => readFileSync(file, 'utf8'),
  exists: Exists = existsSync,
): Closure {
  const files = new Set<string>();
  const packages = new Set<string>();
  const unresolved: string[] = [];
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift()!;
    if (files.has(file)) continue;
    files.add(file);
    for (const ref of importsOf(read(file))) {
      if (ref.kind !== 'static' || ref.typeOnly) continue;
      const local = resolveLocal(file, ref.specifier, exists);
      if (local === null) {
        if (!/^\.{1,2}\//.test(ref.specifier) && !/\.(?:css|svg|json)$/.test(ref.specifier)) packages.add(packageName(ref.specifier));
        continue;
      }
      if (local.endsWith('?çözülemedi')) unresolved.push(`${relative(ROOT, file)} → ${ref.specifier}`);
      else queue.push(local);
    }
  }
  return { files, packages, unresolved };
}

const rel = (files: Iterable<string>) => [...files].map((file) => relative(ROOT, file)).sort();

describe('telefon girişi (src/admin/main.tsx) statik kapanışı', () => {
  const closure = staticClosure(join(ROOT, 'src/admin/main.tsx'));
  const files = rel(closure.files);

  it('her yerel import çözülür (kapanış eksiksiz)', () => {
    expect(closure.unresolved).toEqual([]);
    expect(files).toEqual(expect.arrayContaining([
      'src/admin/App.tsx',
      'src/admin/routes.tsx',
      'src/admin/shell/WorkspaceShell.tsx',
      'src/admin/data/useGeneration.provider.tsx',
      'src/admin/data/store.ts',
    ]));
  });

  it('Zod, sözleşme şemaları ve dashboard veri okuyucusu girişte yok (doğrulama nesil okunurken iner)', () => {
    expect([...closure.packages].sort()).not.toContain('zod');
    expect(files).not.toContain('src/admin/data/contract.ts');
    expect(files).not.toContain('src/dashboard/data.ts');
  });

  it('veri barrel ı, canlı veri, görünüm, CSV, indeks ve sorgu katmanları girişte yok', () => {
    const forbidden = ['index.ts', 'live.ts', 'views.ts', 'csv.ts', 'indexes.ts', 'query.ts', 'useGeneration.rows.tsx', 'useGeneration.tsx']
      .map((name) => `src/admin/data/${name}`);
    expect(files.filter((file) => forbidden.includes(file))).toEqual([]);
  });

  it('Sayfalar çekmecesi (MobileNavDrawer) girişte yok; üst çubuk simgesi ShellIcon statik', () => {
    expect(files).not.toContain('src/admin/shell/MobileNavDrawer.tsx');
    expect(files).toContain('src/admin/shell/ShellIcon.tsx');
  });

  it('öz denetim: barrel ve yeniden dışa verim kenarlarını izler, dinamik importu ve tür importunu izlemez', () => {
    const at = (name: string) => join(ROOT, 'src/admin', name);
    const sources: Record<string, string> = {
      [at('main.tsx')]: "import { A } from './a'; import type { T } from './t'; const lazy = () => import('./lazy');",
      [at('a.ts')]: "export * from './b';\nimport { z } from 'zod/mini';",
      [at('b.ts')]: "export {\n  x,\n  type Y,\n} from '@/admin/c';\nexport type { W } from './w';",
      [at('c.ts')]: "import './c.css';\nexport const x = 1;",
      [at('t.ts')]: '', [at('lazy.ts')]: '', [at('w.ts')]: '',
    };
    const fake = staticClosure(at('main.tsx'), (file) => sources[file] ?? '', (file) => file in sources);
    expect(fake.unresolved).toEqual([]);
    expect(rel(fake.files)).toEqual(['src/admin/a.ts', 'src/admin/b.ts', 'src/admin/c.ts', 'src/admin/main.tsx']);
    expect([...fake.packages]).toEqual(['zod']);
  });
});

// Telefon ilk rotası = giriş + ilk sayfa (Genel durum) parçası. PageHeader her sayfada statiktir; "Diğer" tetiği
// (OverflowActions → menü düğmesi) statik kalır, ama açılır gövde (Menu listesi, açılır panel) ve alt sayfa (BottomSheet +
// kipli katman) yalnız ilk niyette dinamik import() ile iner. Genel durum "Diğer" çizmez; gövde ilk rotaya girmez.
describe('telefon ilk rotası (giriş + Genel durum) statik kapanışında menü gövdesi ve alt sayfa yok', () => {
  const at = (name: string) => join(ROOT, 'src/admin', name);
  const firstRoute = new Set(rel([...staticClosure(at('main.tsx')).files, ...staticClosure(at('pages/GenelPage.tsx')).files]));
  const MENU_BODY = ['src/admin/ui/Menu.tsx', 'src/admin/ui/Menu.panel.tsx', 'src/admin/ui/BottomSheet.tsx', 'src/admin/ui/BottomSheet.layer.ts'];

  it('PageHeader ve "Diğer" tetiği (OverflowActions) statik; Menu gövdesi, BottomSheet ve kipli katman yok', () => {
    expect([...firstRoute]).toEqual(expect.arrayContaining(['src/admin/shell/PageHeader.tsx', 'src/admin/ui/OverflowActions.tsx']));
    expect([...firstRoute].filter((file) => MENU_BODY.includes(file))).toEqual([]);
  });

  it('tetiğin statik kapanışı gövdeyi yalnız dinamik import() ile ister (tek parça: Menu.panel)', () => {
    const trigger = staticClosure(at('ui/OverflowActions.tsx'));
    expect(rel(trigger.files).filter((file) => MENU_BODY.includes(file))).toEqual([]);
    // `typeof import('…')` tür ifadesi de dinamik kenar olarak görünür; kenarlar tekilleştirilir.
    const dynamic = new Set([...trigger.files].flatMap((file) => importsOf(readFileSync(file, 'utf8'))
      .filter((ref) => ref.kind === 'dynamic')
      .map((ref) => `${relative(ROOT, file)} → ${ref.specifier}`)));
    expect([...dynamic].filter((edge) => /Menu\.panel|BottomSheet/.test(edge))).toEqual(['src/admin/ui/Menu.lazy.tsx → ./Menu.panel']);
  });
});

describe('kabuğun e-tablo bağlantısı dashboard modülünü içe aktarmadan aynı adresi kurar', () => {
  it('sheetLink.href === src/dashboard/data.ts sheetUrl', () => {
    // Kimlik sentetik değere sabitlenir: ortam değişkeni boşken iki taraf da ".../d//edit" olur ve yanlış değişken adı
    // da eşitliği geçerdi.
    expect(sheetLink.href).toBe('https://docs.google.com/spreadsheets/d/synthetic-budget-sheet-2098/edit');
    expect(sheetLink.href).toBe(sheetUrl);
    expect(sheetLink.path).toBe(sheetUrl);
  });
});

describe('depo sözleşme doğrulamasını tembel yükler', () => {
  it('store.ts contract.ts i statik değil, yalnız dinamik import() ile alır', () => {
    const refs = importsOf(readFileSync(join(ROOT, 'src/admin/data/store.ts'), 'utf8')).filter((ref) => /\/contract$/.test(ref.specifier));
    expect(refs.filter((ref) => ref.kind === 'static' && !ref.typeOnly)).toEqual([]);
    // import('./contract') hem çalışma zamanı importu hem `typeof import('./contract')` tür ifadesi olarak geçer.
    expect([...new Set(refs.filter((ref) => ref.kind === 'dynamic').map((ref) => ref.specifier))]).toEqual(['./contract']);
  });
});
