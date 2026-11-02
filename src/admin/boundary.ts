// Mimari kapı: antd/pro/phosphor/echarts ham importu yalnız src/admin/ui içinde kalır; src/admin içinde Mantine yok;
// eski (Mantine) uygulamaya antd sızmaz. Saf fonksiyon; dosya sistemi erişimi test/çağıran tarafındadır.

export const BOUNDARY_RULES = ['mantine-in-admin', 'antd-outside-admin', 'raw-lib-outside-ui'] as const;
export type BoundaryRule = (typeof BOUNDARY_RULES)[number];

export interface BoundaryViolation {
  rule: BoundaryRule;
  /** Depo köküne göre posix yol (src/...). */
  path: string;
  /** Kaynak koddaki modül belirteci, olduğu gibi. */
  specifier: string;
}

/** Admin dışında belirli bir klasör altında (prefix) belirli paketlerin mevcut kullanımı serbesttir. */
export interface BoundaryExemption {
  /** 'src/dashboard' gibi klasör öneki; '*' bütün admin dışı src için. */
  dir: string;
  packages: readonly string[];
}

export interface BoundaryOptions {
  /** Mutlak yolları göreli yapmak için depo kökü. */
  root?: string;
  /** antd-outside-admin için muafiyetler; varsayılan DEFAULT_EXEMPTIONS. */
  exempt?: readonly BoundaryExemption[];
}

/** src/admin/ui dışında ham kullanımı yasak olan paketler (admin içinde) / eski uygulamaya sızması yasak paketler. */
export const RAW_LIB_PACKAGES = ['antd', '@ant-design', '@phosphor-icons', 'echarts'] as const;
export const MANTINE_PACKAGES = ['@mantine'] as const;

/**
 * Admin dışındaki mevcut kullanım. echarts: eski panolar. @phosphor-icons: eski uygulamanın simge kütüphanesi,
 * admin de aynı simgeleri kullanır; antd ve @ant-design için muafiyet yoktur.
 */
export const DEFAULT_EXEMPTIONS: readonly BoundaryExemption[] = [
  { dir: 'src/dashboard', packages: ['echarts'] },
  { dir: 'src/vehicle', packages: ['echarts'] },
  { dir: 'src/finance', packages: ['echarts'] },
  { dir: '*', packages: ['@phosphor-icons'] },
];

/** ui barrel'ın dışa aktardığı 32 ad; sayfa/kabuk kodu yalnız bunları kullanır. */
export const UI_BARREL_NAMES = [
  'Button', 'IconButton', 'TextField', 'Select', 'Table', 'Drawer', 'Dialog', 'Tabs', 'Menu', 'Tag', 'StatusText',
  'Disclosure', 'FormFooter', 'LoadingShell', 'EmptyState', 'ErrorState', 'DataStatus',
  'ResponsiveTable', 'AccordionList', 'BottomSheet', 'OverflowActions', 'PivotStack', 'ConflictView', 'FilterArea',
  'ListRow', 'DetailPanel', 'Kanban', 'Timeline', 'Overview', 'Chart', 'Money', 'Icon',
] as const;

const ADMIN_DIR = 'src/admin';
const UI_DIR = 'src/admin/ui';

// import x from 'y' | export ... from 'y' | import 'y' | import('y') | require('y')
const SPECIFIER_RE = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"]([^'"\n]+)['"]/g;

const isUnder = (path: string, dir: string) => path === dir || path.startsWith(`${dir}/`);

/** '@scope/name/deep' → '@scope', 'antd/locale/tr_TR' → 'antd'; göreli/mutlak yollar → null. */
export function packageOf(specifier: string): string | null {
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:')) return null;
  const [first] = specifier.split('/');
  return first || null;
}

export function normalizePath(path: string, root?: string): string {
  let posix = path.replace(/\\/g, '/');
  if (root) {
    const base = root.replace(/\\/g, '/').replace(/\/+$/, '');
    if (posix === base) posix = '';
    else if (posix.startsWith(`${base}/`)) posix = posix.slice(base.length + 1);
  }
  return posix.replace(/^\.\//, '');
}

export function moduleSpecifiers(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(SPECIFIER_RE)) found.push(match[1]);
  return found;
}

const inList = (pkg: string, list: readonly string[]) => list.includes(pkg);

function isExempt(path: string, pkg: string, exempt: readonly BoundaryExemption[]): boolean {
  return exempt.some(entry => inList(pkg, entry.packages) && (entry.dir === '*' || isUnder(path, entry.dir)));
}

export function boundaryViolations(path: string, source: string, options: BoundaryOptions = {}): BoundaryViolation[] {
  const relativePath = normalizePath(path, options.root);
  const exempt = options.exempt ?? DEFAULT_EXEMPTIONS;
  const inAdmin = isUnder(relativePath, ADMIN_DIR);
  const inUi = isUnder(relativePath, UI_DIR);
  const violations: BoundaryViolation[] = [];

  for (const specifier of moduleSpecifiers(source)) {
    const pkg = packageOf(specifier);
    if (!pkg) continue;
    const push = (rule: BoundaryRule) => violations.push({ rule, path: relativePath, specifier });
    if (inAdmin) {
      if (inList(pkg, MANTINE_PACKAGES)) push('mantine-in-admin');
      else if (!inUi && inList(pkg, RAW_LIB_PACKAGES)) push('raw-lib-outside-ui');
    } else if (inList(pkg, RAW_LIB_PACKAGES) && !isExempt(relativePath, pkg, exempt)) {
      push('antd-outside-admin');
    }
  }
  return violations;
}

export function scanBoundary(files: Iterable<{ path: string; source: string }>, options: BoundaryOptions = {}): BoundaryViolation[] {
  const violations: BoundaryViolation[] = [];
  for (const file of files) violations.push(...boundaryViolations(file.path, file.source, options));
  return violations;
}
