import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { BOUNDARY_RULES, UI_BARREL_NAMES, boundaryViolations, scanBoundary } from './boundary';
// Barrel statik yüklenir: antd + pro modül grafiği toplama (collection) aşamasında dönüşür; test gövdesindeki
// dinamik import bu soğuk maliyeti test süresine yazıyor ve tam koşuda zaman aşımına yol açıyordu.
import * as ui from './ui';

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
    expect(Object.keys(ui).sort()).toEqual([...UI_BARREL_NAMES].sort());
  });
});
