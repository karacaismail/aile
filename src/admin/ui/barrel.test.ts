// P0b: ui barrel 32 adı dışa aktarır (17 mevcut + 15 yeni). Sayfa/kabuk kodu yalnız bu barrel'ı kullanır.
// Statik import: antd + Pro + Phosphor grafiğinin soğuk dönüşümü dosya toplama aşamasında yüklenir (diğer ui
// testleri gibi); test gövdesinde dinamik import bu maliyeti 5 s test süresine yüklüyor ve tam takımda zaman aşımı veriyordu.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as ui from './index';

const names = [
  'Button', 'IconButton', 'TextField', 'Select', 'Table', 'Drawer', 'Dialog', 'Tabs', 'Menu', 'Tag', 'StatusText',
  'Disclosure', 'FormFooter', 'LoadingShell', 'EmptyState', 'ErrorState', 'DataStatus',
  'ResponsiveTable', 'AccordionList', 'BottomSheet', 'OverflowActions', 'PivotStack', 'ConflictView', 'FilterArea',
  'ListRow', 'DetailPanel', 'Kanban', 'Timeline', 'Overview', 'Chart', 'Money', 'Icon',
];

describe('ui barrel', () => {
  it('exports exactly 32 component names', () => {
    expect(names).toHaveLength(32);
    expect(Object.keys(ui).sort()).toEqual([...names].sort());
    for (const name of names) expect(typeof (ui as Record<string, unknown>)[name], name).toBe('function');
  });

  it('keeps raw antd/pro/phosphor/echarts imports inside src/admin/ui', () => {
    const root = resolve(__dirname, '..');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) { if (entry !== 'ui') walk(path); continue; }
        if (!/\.(tsx?|mts)$/.test(entry) || /\.test\./.test(entry)) continue;
        const source = readFileSync(path, 'utf8');
        if (/from\s+['"](antd|@ant-design\/|@phosphor-icons\/|echarts|@mantine\/)/.test(source)) offenders.push(path.slice(root.length + 1));
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
