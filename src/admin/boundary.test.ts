import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { importsOf, stripComments } from './adaptive/sourceRules';
import { BOUNDARY_RULES, UI_BARREL_NAMES, boundaryViolations, scanBoundary } from './boundary';
// Barrel adları ui/index.ts kaynak metninden çözülür: antd + Pro + Phosphor grafiğini çalışma zamanında yüklemek bu
// kapı için gereksizdi ve tam pakette yük altında 5 sn zaman aşımına yol açıyordu. Çalışma zamanı ihracatlarının
// (ve her adın bileşen olmasının) tek doğrulayıcısı ui/barrel.test.ts'tir.

/** ui/index.ts değer ihracatları (kaynak metinden). Yalnız `export { A } from './A'` ve `export type {…}` kabul edilir.
 *  Aynı çözümleyici ui/barrel.test.ts'te çalışma zamanı ihracatlarıyla birebir karşılaştırılır. */
function barrelValueExports(source: string): string[] {
  const statements = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').split(';').map((s) => s.trim()).filter(Boolean);
  return statements.flatMap((statement) => {
    if (/^export\s+type\s*\{[^}]*\}\s*from\s*['"][^'"]+['"]$/.test(statement)) return [];
    const match = /^export\s*\{([^}]*)\}\s*from\s*['"][^'"]+['"]$/.exec(statement);
    if (!match) throw new Error(`ui/index.ts desteklenmeyen deyim: ${statement}`);
    return match[1].split(',').map((part) => part.trim()).filter((part) => part && !/^type\s/.test(part)).map((part) => part.split(/\s+as\s+/).pop()!);
  });
}

// Kapı: antd/pro/phosphor/echarts yalnız src/admin/ui içinde; admin içinde Mantine yok; eski uygulamaya antd sızmaz.
describe('boundaryViolations (saf)', () => {
  it('flags @mantine imports anywhere under src/admin', () => {
    expect(boundaryViolations('src/admin/shell/Nav.tsx', "import { Button } from '@mantine/core';")).toEqual([
      { rule: 'mantine-in-admin', path: 'src/admin/shell/Nav.tsx', specifier: '@mantine/core' },
    ]);
    expect(boundaryViolations('src/admin/ui/Select.tsx', "import { useDisclosure } from '@mantine/hooks';").map(v => v.rule)).toEqual(['mantine-in-admin']);
  });

  it('flags raw antd/@ant-design/@phosphor-icons/echarts in src/admin outside ui/', () => {
    const source = [
      "import { Table } from 'antd';",
      "import trTR from 'antd/locale/tr_TR';",
      "import { ProTable } from '@ant-design/pro-components';",
      "import { Plus } from '@phosphor-icons/react/dist/csr/Plus';",
      "import * as echarts from 'echarts/core';",
    ].join('\n');
    const found = boundaryViolations('src/admin/shell/Page.tsx', source);
    expect(found.map(v => v.rule)).toEqual(['raw-lib-outside-ui', 'raw-lib-outside-ui', 'raw-lib-outside-ui', 'raw-lib-outside-ui', 'raw-lib-outside-ui']);
    expect(found.map(v => v.specifier)).toEqual(['antd', 'antd/locale/tr_TR', '@ant-design/pro-components', '@phosphor-icons/react/dist/csr/Plus', 'echarts/core']);
  });

  it('allows raw libraries inside src/admin/ui and barrel imports elsewhere in admin', () => {
    expect(boundaryViolations('src/admin/ui/antd.ts', "export { Table, ConfigProvider } from 'antd';\nimport trTR from 'antd/locale/tr_TR';")).toEqual([]);
    expect(boundaryViolations('src/admin/ui/Chart.tsx', "const core = await import('echarts/core');")).toEqual([]);
    expect(boundaryViolations('src/admin/shell/Page.tsx', "import { Button, Icon } from '../ui';\nimport { ConfigProvider } from '../ui/antd';\nimport { fetchBudget } from '../../dashboard/data';")).toEqual([]);
  });

  it('flags antd/@ant-design outside src/admin', () => {
    expect(boundaryViolations('src/modules/budget/BudgetHome.tsx', "import { Button } from 'antd';")).toEqual([
      { rule: 'antd-outside-admin', path: 'src/modules/budget/BudgetHome.tsx', specifier: 'antd' },
    ]);
    expect(boundaryViolations('src/app/shell/Fab.tsx', "import { ProCard } from '@ant-design/pro-components';").map(v => v.rule)).toEqual(['antd-outside-admin']);
  });

  it('exempts existing echarts usage in src/dashboard, src/vehicle and src/finance only', () => {
    const source = "import * as echarts from 'echarts';";
    expect(boundaryViolations('src/dashboard/Charts.tsx', source)).toEqual([]);
    expect(boundaryViolations('src/vehicle/PaymentChart.tsx', source)).toEqual([]);
    expect(boundaryViolations('src/finance/FinanceTrends.tsx', source)).toEqual([]);
    expect(boundaryViolations('src/modules/budget/BudgetHome.tsx', source).map(v => v.rule)).toEqual(['antd-outside-admin']);
  });

  it('treats @phosphor-icons as the legacy icon library outside admin, but exemptions are configurable', () => {
    const source = "import { Plus } from '@phosphor-icons/react/dist/csr/Plus';";
    expect(boundaryViolations('src/components/LinksField.tsx', source)).toEqual([]);
    expect(boundaryViolations('src/components/LinksField.tsx', source, { exempt: [] }).map(v => v.rule)).toEqual(['antd-outside-admin']);
  });

  it('catches dynamic import(), require() and side-effect imports; ignores lookalikes and relative paths', () => {
    expect(boundaryViolations('src/admin/shell/A.tsx', "const m = await import('antd');").map(v => v.specifier)).toEqual(['antd']);
    expect(boundaryViolations('src/admin/shell/A.tsx', "const m = require('@ant-design/icons');").map(v => v.specifier)).toEqual(['@ant-design/icons']);
    expect(boundaryViolations('src/admin/shell/A.tsx', "import 'antd/dist/reset.css';").map(v => v.specifier)).toEqual(['antd/dist/reset.css']);
    expect(boundaryViolations('src/admin/shell/A.tsx', "import x from 'antd-mobile';\nimport y from './antd';\nimport z from 'echarts-for-react';")).toEqual([]);
  });

  it('normalises absolute and backslash paths to repo-relative posix paths', () => {
    const root = '/repo';
    expect(boundaryViolations('/repo/src/admin/shell/A.tsx', "import { Button } from 'antd';", { root }).map(v => v.path)).toEqual(['src/admin/shell/A.tsx']);
    expect(boundaryViolations('src\\admin\\shell\\A.tsx', "import { Button } from 'antd';").map(v => v.path)).toEqual(['src/admin/shell/A.tsx']);
  });

  it('exposes the three rules', () => {
    expect(BOUNDARY_RULES).toEqual(['mantine-in-admin', 'antd-outside-admin', 'raw-lib-outside-ui']);
  });
});

describe('boundary (depo taraması)', () => {
  const root = resolve(__dirname, '../..');

  it('src/** has no boundary violations', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) { walk(path); continue; }
        // Test dosyaları fixture/mock dizgisi içerir (bu dosya dahil); kapı üretim kaynağını denetler.
        if (/\.(tsx?|mts|cts|jsx?|mjs)$/.test(entry) && !/\.test\./.test(entry)) files.push(path);
      }
    };
    walk(resolve(root, 'src'));
    expect(files.length).toBeGreaterThan(50);
    const violations = scanBoundary(files.map(path => ({ path: relative(root, path), source: readFileSync(path, 'utf8') })));
    expect(violations).toEqual([]);
  });

  it('ui barrel exports exactly the 32 names the contract lists', () => {
    expect(UI_BARREL_NAMES).toHaveLength(32);
    expect(new Set(UI_BARREL_NAMES).size).toBe(32);
    expect(barrelValueExports(readFileSync(resolve(root, 'src/admin/ui/index.ts'), 'utf8')).sort()).toEqual([...UI_BARREL_NAMES].sort());
  });
});

// Geçiş kesimi (plan D8): antd yüzeyi tek dosyada (ui/antd.ts) ve yalnız geniş profilin sağlayıcısı onu değer olarak
// içe aktarır (adaptive/WideProviders.tsx, tembel); antd teması yalnız türünü alır. ui/antd.ts kullanılmayan ad taşımaz:
// her ad src/admin içinde (üretim ya da test) içe aktarılır; Pro Components ihracı yok.
describe('antd yüzeyi (geçiş kesimi)', () => {
  const root = resolve(__dirname, '../..');
  const adminDir = resolve(root, 'src/admin');
  const ANTD_SURFACE = 'src/admin/ui/antd.ts';
  const rel = (path: string) => relative(root, path).split('\\').join('/');

  function adminSources(): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(tsx?|mts)$/.test(entry)) out.push(path);
      }
    };
    walk(adminDir);
    return out;
  }

  /** `export { A, B as C } from '…'` ve `export type { … } from '…'` biçimlerinden dışa açılan adlar (as sonrası). */
  function surfaceExports(source: string): { name: string; from: string; typeOnly: boolean }[] {
    const found: { name: string; from: string; typeOnly: boolean }[] = [];
    for (const match of stripComments(source).matchAll(/export\s+(type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
      for (const part of match[2].split(',').map(item => item.trim()).filter(Boolean)) {
        found.push({ name: part.replace(/^type\s+/, '').split(/\s+as\s+/).pop()!, from: match[3], typeOnly: Boolean(match[1]) || /^type\s/.test(part) });
      }
    }
    return found;
  }

  /** Dosyanın ui/antd.ts'ten içe aktardığı adlar (as öncesi) ve içe aktarmanın türü. */
  function namedImportsFromSurface(path: string, source: string): { names: string[]; typeOnly: boolean }[] {
    const target = (specifier: string) => specifier.startsWith('.') && rel(resolve(dirname(path), specifier)).replace(/\.ts$/, '') === ANTD_SURFACE.replace(/\.ts$/, '');
    const out: { names: string[]; typeOnly: boolean }[] = [];
    for (const match of stripComments(source).matchAll(/import\s+(type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
      if (!target(match[3])) continue;
      const parts = match[2].split(',').map(item => item.trim()).filter(Boolean);
      out.push({
        names: parts.map(part => part.replace(/^type\s+/, '').split(/\s+as\s+/)[0]),
        typeOnly: Boolean(match[1]) || parts.every(part => /^type\s/.test(part)),
      });
    }
    return out;
  }

  it('ui/antd.ts exports no Pro Components and only names that src/admin still imports (grep kanıtı)', () => {
    const surface = readFileSync(resolve(root, ANTD_SURFACE), 'utf8');
    expect(importsOf(surface).map(ref => ref.specifier).filter(spec => /^@ant-design\//.test(spec))).toEqual([]);
    const exported = surfaceExports(surface);
    expect(exported.length).toBeGreaterThan(0);
    const used = new Set(adminSources().filter(path => rel(path) !== ANTD_SURFACE)
      .flatMap(path => namedImportsFromSurface(path, readFileSync(path, 'utf8')).flatMap(ref => ref.names)));
    expect(exported.filter(item => !used.has(item.name)).map(item => item.name)).toEqual([]);
  });

  it('only adaptive/WideProviders.tsx imports ui/antd.ts values in production code; theme/antdTheme.ts takes types only', () => {
    const production = adminSources().filter(path => !/\.test\.(tsx?|mts)$/.test(path) && rel(path) !== ANTD_SURFACE);
    const valueImporters: string[] = [];
    const typeImporters: string[] = [];
    for (const path of production) {
      for (const ref of namedImportsFromSurface(path, readFileSync(path, 'utf8'))) (ref.typeOnly ? typeImporters : valueImporters).push(rel(path));
    }
    expect([...new Set(valueImporters)].sort()).toEqual(['src/admin/adaptive/WideProviders.tsx']);
    expect([...new Set(typeImporters)].sort()).toEqual(['src/admin/theme/antdTheme.ts']);
  });
});
