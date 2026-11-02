// P0b: ui barrel 32 adı dışa aktarır (17 mevcut + 15 yeni). Sayfa/kabuk kodu yalnız bu barrel'ı kullanır.
// Barrel'ın çalışma zamanı yüklemesi (antd + Pro + Phosphor modül grafiğinin soğuk dönüşümü) yalnız bu dosyada,
// tek seferlik beforeAll içinde yapılır. Ölçüm (2026-11-02, Vitest 5 jsdom, makine yük ortalaması ~9): yalnız bu dosya
// 4,9 sn; 7 ui bileşen testiyle birlikte 5,7 sn. Test gövdesindeki import bu yüzden 5 sn testTimeout'unu aşıyordu.
// Süre bütçesi (BARREL_IMPORT_MS) kancaya açıkça verilir; genel testTimeout/hookTimeout yükseltilmez.
// boundary.test.ts ve scaffold.test.ts barrel adlarını index.ts kaynak metninden çözer ve antd grafiğini hiç yüklemez;
// aşağıdaki "kaynak = çalışma zamanı" testi bu çözümlemenin doğruluğunu bağlar.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** Soğuk barrel importu için süre bütçesi: yük altındaki gözlemin (5,7 sn) yaklaşık 10 katı; 50 paralel worktree payı. */
const BARREL_IMPORT_MS = 60_000;

const names = [
  'Button', 'IconButton', 'TextField', 'Select', 'Table', 'Drawer', 'Dialog', 'Tabs', 'Menu', 'Tag', 'StatusText',
  'Disclosure', 'FormFooter', 'LoadingShell', 'EmptyState', 'ErrorState', 'DataStatus',
  'ResponsiveTable', 'AccordionList', 'BottomSheet', 'OverflowActions', 'PivotStack', 'ConflictView', 'FilterArea',
  'ListRow', 'DetailPanel', 'Kanban', 'Timeline', 'Overview', 'Chart', 'Money', 'Icon',
];

/** ui/index.ts değer ihracatları (kaynak metinden). Yalnız `export { A } from './A'` ve `export type {…}` kabul edilir. */
function barrelValueExports(source: string): string[] {
  const statements = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').split(';').map((s) => s.trim()).filter(Boolean);
  return statements.flatMap((statement) => {
    if (/^export\s+type\s*\{[^}]*\}\s*from\s*['"][^'"]+['"]$/.test(statement)) return [];
    const match = /^export\s*\{([^}]*)\}\s*from\s*['"][^'"]+['"]$/.exec(statement);
    if (!match) throw new Error(`ui/index.ts desteklenmeyen deyim: ${statement}`);
    return match[1].split(',').map((part) => part.trim()).filter((part) => part && !/^type\s/.test(part)).map((part) => part.split(/\s+as\s+/).pop()!);
  });
}

const indexSource = readFileSync(resolve(__dirname, 'index.ts'), 'utf8');
let ui: Record<string, unknown>;

beforeAll(async () => {
  ui = { ...(await import('./index')) };
}, BARREL_IMPORT_MS);

describe('ui barrel', () => {
  it('exports exactly 32 component names', () => {
    expect(names).toHaveLength(32);
    expect(Object.keys(ui).sort()).toEqual([...names].sort());
    for (const name of names) expect(typeof ui[name], name).toBe('function');
  });

  it('kaynak metinden çözülen adlar çalışma zamanı ihracatlarıyla birebir aynıdır', () => {
    expect(barrelValueExports(indexSource).sort()).toEqual(Object.keys(ui).sort());
    expect(() => barrelValueExports(`${indexSource}\nexport * from './Button';`)).toThrow(/desteklenmeyen/);
    expect(barrelValueExports("export { A, B as C, type D } from './x';\nexport type { E } from './y';")).toEqual(['A', 'C']);
  });

  it('antd grafiğini çalışma zamanında yalnız bu dosya yükler (boundary/scaffold kaynak metinden okur)', () => {
    const runtimeBarrel = /(?:^\s*import\s+(?!type\b)[^;]*?from\s*|\bimport\s*\(\s*)['"]\.\/ui(?:\/index)?['"]/m;
    for (const file of ['boundary.test.ts', 'scaffold.test.ts']) {
      const source = readFileSync(resolve(__dirname, '..', file), 'utf8');
      expect(runtimeBarrel.test(source), `${file} ui barrel'ını çalışma zamanında import ediyor`).toBe(false);
    }
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
